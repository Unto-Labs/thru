//! Program + official ABI deploys in one Multicall transaction.
//!
//! The Public Manager and the ABI Manager both read their new contents from
//! uploader buffers. These builders put the program change and the official
//! ABI change into a single Multicall instruction so both land or neither
//! does. The authority is always the fee payer (account index 0), which the
//! callee programs treat as authorized.

use anyhow::{Result, bail};

use crate::txn_lib::{TnPubkey, Transaction};
use crate::txn_tools::{
    ABI_ACCOUNT_HEADER_SIZE, ABI_MANAGER_INSTRUCTION_CREATE_ABI_OFFICIAL_EPHEMERAL,
    ABI_MANAGER_INSTRUCTION_CREATE_ABI_OFFICIAL_PERMANENT,
    ABI_MANAGER_INSTRUCTION_CREATE_META_OFFICIAL_EPHEMERAL,
    ABI_MANAGER_INSTRUCTION_CREATE_META_OFFICIAL_PERMANENT, MANAGER_INSTRUCTION_CREATE_EPHEMERAL,
    MANAGER_INSTRUCTION_CREATE_PERMANENT, account_state_units,
    build_abi_manager_create_abi_official_instruction,
    build_abi_manager_create_meta_official_instruction,
    build_abi_manager_upgrade_abi_official_instruction, build_manager_create_instruction,
    build_manager_upgrade_instruction,
};

/// Transaction MTU; a Multicall instruction must fit inside it.
const TXN_MTU: usize = 32_768;

/// Compute budget for a combined deploy (both managers copy buffers).
pub const PROGRAM_ABI_COMPUTE_UNITS: u32 = 500_000_000;

/// Memory budget for a combined deploy, matching the TypeScript SDK.
pub const PROGRAM_ABI_MEMORY_UNITS: u16 = 10_000;

/// Encode Multicall instruction data: a u16 call count, then for each call
/// the u16 account index of the callee program, the u64 length of its
/// instruction data, and the data itself (all little-endian).
pub fn build_multicall_instruction(calls: &[(u16, Vec<u8>)]) -> Result<Vec<u8>> {
    if calls.is_empty() {
        bail!("multicall needs at least one call");
    }
    let count = u16::try_from(calls.len())?;
    let mut out = Vec::new();
    out.extend_from_slice(&count.to_le_bytes());
    for (program_idx, data) in calls {
        out.extend_from_slice(&program_idx.to_le_bytes());
        out.extend_from_slice(&(data.len() as u64).to_le_bytes());
        out.extend_from_slice(data);
    }
    if out.len() > TXN_MTU {
        bail!(
            "multicall instruction is {} bytes, over the {} byte transaction limit",
            out.len(),
            TXN_MTU
        );
    }
    Ok(out)
}

/// Accounts touched by a program + official ABI deploy.
#[derive(Debug, Clone, Copy)]
pub struct ProgramAbiAccounts {
    pub manager_program: TnPubkey,
    pub abi_manager_program: TnPubkey,
    pub program_meta: TnPubkey,
    pub program: TnPubkey,
    pub abi_meta: TnPubkey,
    pub abi: TnPubkey,
    pub program_buffer: TnPubkey,
    pub abi_buffer: TnPubkey,
}

/// What happens to the managed program.
#[derive(Debug, Clone)]
pub enum ProgramStep<'a> {
    /// Create a new managed program from `seed`. Proofs are required for a
    /// permanent program and must be absent for an ephemeral one.
    Create {
        seed: &'a [u8],
        meta_proof: Option<&'a [u8]>,
        program_proof: Option<&'a [u8]>,
    },
    /// Upgrade an existing managed program.
    Upgrade,
}

/// What happens to the program's official ABI.
#[derive(Debug, Clone)]
pub enum AbiStep<'a> {
    /// Create the ABI meta account and the ABI account.
    CreateMetaAndAbi {
        meta_proof: Option<&'a [u8]>,
        abi_proof: Option<&'a [u8]>,
    },
    /// The ABI meta account exists; create the ABI account.
    CreateAbi { abi_proof: Option<&'a [u8]> },
    /// Upgrade the existing ABI account.
    Upgrade,
}

/// SHA-256 of the new program image and of the new ABI content. Each manager
/// instruction commits to its digest and installs only buffer bytes that hash
/// to it, so the buffers cannot be swapped after the transaction (or a
/// multisig request) is built.
#[derive(Debug, Clone, Copy)]
pub struct ProgramAbiDigests {
    pub program: [u8; 32],
    pub abi: [u8; 32],
}

/// Sizes used to size the deploy's state-unit budget.
#[derive(Debug, Clone, Copy)]
pub struct ProgramAbiSizes {
    /// New program image size.
    pub program: u32,
    /// New ABI content size.
    pub abi: u32,
    /// Current program account data size (upgrades only).
    pub current_program_data: Option<u64>,
    /// Current ABI content size (ABI upgrades only).
    pub current_abi: Option<u64>,
}

/// State units the deploy needs: new pages for created accounts, and the
/// page growth of upgraded accounts.
pub fn program_abi_state_units(
    program_step: &ProgramStep<'_>,
    abi_step: &AbiStep<'_>,
    sizes: &ProgramAbiSizes,
) -> Result<u16> {
    let pages = |bytes: u64| -> Result<u64> { Ok(u64::from(account_state_units(bytes)?)) };
    let mut units: u64 = 0;
    match program_step {
        // Program account plus the one-page manager meta account.
        ProgramStep::Create { .. } => units += pages(u64::from(sizes.program) + 4096)?,
        ProgramStep::Upgrade => {
            let current = sizes
                .current_program_data
                .unwrap_or(u64::from(sizes.program));
            units += pages(u64::from(sizes.program))?.saturating_sub(pages(current)?);
        }
    }
    let abi_bytes = u64::from(sizes.abi) + ABI_ACCOUNT_HEADER_SIZE;
    match abi_step {
        AbiStep::CreateMetaAndAbi { .. } => units += 1 + pages(abi_bytes)?,
        AbiStep::CreateAbi { .. } => units += pages(abi_bytes)?,
        AbiStep::Upgrade => {
            let current =
                sizes.current_abi.unwrap_or(u64::from(sizes.abi)) + ABI_ACCOUNT_HEADER_SIZE;
            units += pages(abi_bytes)?.saturating_sub(pages(current)?);
        }
    }
    Ok(u16::try_from(units)?)
}

/// Sorted account layout: index 0 is the fee payer, 1 the Multicall
/// program, then read-write accounts and read-only accounts, each sorted.
struct Layout {
    rw: Vec<TnPubkey>,
    ro: Vec<TnPubkey>,
}

impl Layout {
    fn new(mut rw: Vec<TnPubkey>, mut ro: Vec<TnPubkey>) -> Result<Self> {
        rw.sort();
        ro.sort();
        let mut all: Vec<TnPubkey> = rw.iter().chain(ro.iter()).copied().collect();
        let total = all.len();
        all.sort();
        all.dedup();
        if all.len() != total {
            bail!("program and ABI deploy accounts must be distinct");
        }
        Ok(Self { rw, ro })
    }

    fn idx(&self, key: &TnPubkey) -> Result<u16> {
        let pos = self
            .rw
            .iter()
            .chain(self.ro.iter())
            .position(|k| k == key)
            .ok_or_else(|| anyhow::anyhow!("account missing from deploy layout"))?;
        Ok(u16::try_from(pos + 2)?)
    }
}

/// Build the Multicall instruction calls for a program + official ABI
/// deploy against `idx`, which maps each account to its transaction index.
/// `authority_idx` is the index of the program authority (0 when the fee
/// payer signs directly).
#[allow(clippy::too_many_arguments)]
pub fn build_program_abi_calls(
    idx: &dyn Fn(&TnPubkey) -> Result<u16>,
    accounts: &ProgramAbiAccounts,
    program_step: &ProgramStep<'_>,
    abi_step: &AbiStep<'_>,
    program_size: u32,
    abi_size: u32,
    digests: &ProgramAbiDigests,
    authority_idx: u16,
    ephemeral: bool,
) -> Result<Vec<(u16, Vec<u8>)>> {
    let manager_idx = idx(&accounts.manager_program)?;
    let abi_manager_idx = idx(&accounts.abi_manager_program)?;
    let program_meta_idx = idx(&accounts.program_meta)?;
    let program_idx = idx(&accounts.program)?;
    let abi_meta_idx = idx(&accounts.abi_meta)?;
    let abi_idx = idx(&accounts.abi)?;
    let program_buffer_idx = idx(&accounts.program_buffer)?;
    let abi_buffer_idx = idx(&accounts.abi_buffer)?;

    let mut calls = Vec::with_capacity(3);
    match program_step {
        ProgramStep::Create {
            seed,
            meta_proof,
            program_proof,
        } => {
            let proof = match (meta_proof, program_proof) {
                (Some(meta), Some(program)) if !ephemeral => {
                    let mut proof = Vec::with_capacity(meta.len() + program.len());
                    proof.extend_from_slice(meta);
                    proof.extend_from_slice(program);
                    Some(proof)
                }
                (None, None) if ephemeral => None,
                _ => bail!(
                    "program creation proofs must be given exactly when the program is permanent"
                ),
            };
            let discriminant = if ephemeral {
                MANAGER_INSTRUCTION_CREATE_EPHEMERAL
            } else {
                MANAGER_INSTRUCTION_CREATE_PERMANENT
            };
            calls.push((
                manager_idx,
                build_manager_create_instruction(
                    discriminant,
                    program_meta_idx,
                    program_idx,
                    program_buffer_idx,
                    authority_idx,
                    0,
                    program_size,
                    digests.program,
                    seed,
                    proof.as_deref(),
                )?,
            ));
        }
        ProgramStep::Upgrade => calls.push((
            manager_idx,
            build_manager_upgrade_instruction(
                program_meta_idx,
                program_idx,
                program_buffer_idx,
                0,
                program_size,
                digests.program,
            )?,
        )),
    }

    let check_proof = |proof: &Option<&[u8]>, what: &str| -> Result<()> {
        if proof.is_some() == ephemeral {
            bail!("{what} creation proof must be given exactly when the ABI is permanent");
        }
        Ok(())
    };
    let create_abi = |proof: Option<&[u8]>| -> Result<(u16, Vec<u8>)> {
        let discriminant = if ephemeral {
            ABI_MANAGER_INSTRUCTION_CREATE_ABI_OFFICIAL_EPHEMERAL
        } else {
            ABI_MANAGER_INSTRUCTION_CREATE_ABI_OFFICIAL_PERMANENT
        };
        Ok((
            abi_manager_idx,
            build_abi_manager_create_abi_official_instruction(
                discriminant,
                abi_meta_idx,
                program_meta_idx,
                abi_idx,
                abi_buffer_idx,
                0,
                abi_size,
                digests.abi,
                authority_idx,
                proof,
            )?,
        ))
    };
    match abi_step {
        AbiStep::CreateMetaAndAbi {
            meta_proof,
            abi_proof,
        } => {
            check_proof(meta_proof, "ABI meta")?;
            check_proof(abi_proof, "ABI")?;
            let discriminant = if ephemeral {
                ABI_MANAGER_INSTRUCTION_CREATE_META_OFFICIAL_EPHEMERAL
            } else {
                ABI_MANAGER_INSTRUCTION_CREATE_META_OFFICIAL_PERMANENT
            };
            calls.push((
                abi_manager_idx,
                build_abi_manager_create_meta_official_instruction(
                    discriminant,
                    abi_meta_idx,
                    program_meta_idx,
                    authority_idx,
                    *meta_proof,
                )?,
            ));
            calls.push(create_abi(*abi_proof)?);
        }
        AbiStep::CreateAbi { abi_proof } => {
            check_proof(abi_proof, "ABI")?;
            calls.push(create_abi(*abi_proof)?);
        }
        AbiStep::Upgrade => calls.push((
            abi_manager_idx,
            build_abi_manager_upgrade_abi_official_instruction(
                abi_meta_idx,
                program_meta_idx,
                abi_idx,
                abi_buffer_idx,
                0,
                abi_size,
                digests.abi,
                authority_idx,
            )?,
        )),
    }
    Ok(calls)
}

/// Which accounts the deploy writes and which it only reads.
pub fn program_abi_account_access(
    accounts: &ProgramAbiAccounts,
    abi_step: &AbiStep<'_>,
) -> (Vec<TnPubkey>, Vec<TnPubkey>) {
    let mut rw = vec![accounts.program_meta, accounts.program, accounts.abi];
    let mut ro = vec![
        accounts.manager_program,
        accounts.abi_manager_program,
        accounts.program_buffer,
        accounts.abi_buffer,
    ];
    match abi_step {
        AbiStep::CreateMetaAndAbi { .. } => rw.push(accounts.abi_meta),
        AbiStep::CreateAbi { .. } | AbiStep::Upgrade => ro.push(accounts.abi_meta),
    }
    (rw, ro)
}

/// Build a fee-payer-signed transaction that creates or upgrades a managed
/// program and creates or upgrades its official ABI in one Multicall.
#[allow(clippy::too_many_arguments)]
pub fn build_program_abi_transaction(
    fee_payer: TnPubkey,
    multicall_program: TnPubkey,
    accounts: &ProgramAbiAccounts,
    program_step: &ProgramStep<'_>,
    abi_step: &AbiStep<'_>,
    sizes: &ProgramAbiSizes,
    digests: &ProgramAbiDigests,
    ephemeral: bool,
    fee: u64,
    nonce: u64,
    start_slot: u64,
) -> Result<Transaction> {
    let (rw, ro) = program_abi_account_access(accounts, abi_step);
    let layout = Layout::new(rw, ro)?;
    let calls = build_program_abi_calls(
        &|key| layout.idx(key),
        accounts,
        program_step,
        abi_step,
        sizes.program,
        sizes.abi,
        digests,
        0,
        ephemeral,
    )?;
    let instructions = build_multicall_instruction(&calls)?;
    let state_units = program_abi_state_units(program_step, abi_step, sizes)?;

    Ok(Transaction::new(fee_payer, multicall_program, fee, nonce)
        .with_start_slot(start_slot)
        .with_expiry_after(10000)
        .with_compute_units(PROGRAM_ABI_COMPUTE_UNITS)
        .with_memory_units(PROGRAM_ABI_MEMORY_UNITS)
        .with_state_units(state_units)
        .with_rw_accounts(layout.rw)
        .with_r_accounts(layout.ro)
        .with_instructions(instructions))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(b: u8) -> TnPubkey {
        [b; 32]
    }

    const DIGESTS: ProgramAbiDigests = ProgramAbiDigests {
        program: [0xA1; 32],
        abi: [0xB2; 32],
    };

    fn accounts() -> ProgramAbiAccounts {
        ProgramAbiAccounts {
            manager_program: key(10),
            abi_manager_program: key(11),
            program_meta: key(5),
            program: key(4),
            abi_meta: key(3),
            abi: key(2),
            program_buffer: key(9),
            abi_buffer: key(8),
        }
    }

    /// Split multicall data back into (program index, instruction data).
    fn decode(data: &[u8]) -> Vec<(u16, Vec<u8>)> {
        let count = u16::from_le_bytes([data[0], data[1]]) as usize;
        let mut off = 2;
        let mut out = Vec::new();
        for _ in 0..count {
            let idx = u16::from_le_bytes([data[off], data[off + 1]]);
            let len = u64::from_le_bytes(data[off + 2..off + 10].try_into().unwrap()) as usize;
            out.push((idx, data[off + 10..off + 10 + len].to_vec()));
            off += 10 + len;
        }
        assert_eq!(off, data.len());
        out
    }

    #[test]
    fn multicall_encoding_round_trips() {
        let data = build_multicall_instruction(&[(3, vec![1, 2]), (7, vec![])]).unwrap();
        assert_eq!(decode(&data), vec![(3, vec![1, 2]), (7, vec![])]);
        assert!(build_multicall_instruction(&[]).is_err());
        assert!(build_multicall_instruction(&[(2, vec![0; TXN_MTU])]).is_err());
    }

    #[test]
    fn create_matches_individual_instructions() {
        let a = accounts();
        let seed = b"my_seed";
        let (mp, pp, amp, ap) = (
            vec![1u8; 104],
            vec![2u8; 136],
            vec![3u8; 104],
            vec![4u8; 104],
        );
        let program_step = ProgramStep::Create {
            seed,
            meta_proof: Some(&mp),
            program_proof: Some(&pp),
        };
        let abi_step = AbiStep::CreateMetaAndAbi {
            meta_proof: Some(&amp),
            abi_proof: Some(&ap),
        };
        let sizes = ProgramAbiSizes {
            program: 5000,
            abi: 300,
            current_program_data: None,
            current_abi: None,
        };
        let tx = build_program_abi_transaction(
            key(1),
            key(12),
            &a,
            &program_step,
            &abi_step,
            &sizes,
            &DIGESTS,
            false,
            0,
            7,
            100,
        )
        .unwrap();

        // rw sorted: abi(2) abi_meta(3) program(4) program_meta(5);
        // ro sorted: abi_buffer(8) program_buffer(9) manager(10) abi_manager(11).
        let (rw, ro) = (tx.rw_accs.clone().unwrap(), tx.r_accs.clone().unwrap());
        assert_eq!(rw, vec![key(2), key(3), key(4), key(5)]);
        assert_eq!(ro, vec![key(8), key(9), key(10), key(11)]);

        let calls = decode(tx.instructions.as_ref().unwrap());
        assert_eq!(calls.len(), 3);
        let mut proof = mp.clone();
        proof.extend_from_slice(&pp);
        assert_eq!(
            calls[0],
            (
                8,
                build_manager_create_instruction(
                    MANAGER_INSTRUCTION_CREATE_PERMANENT,
                    5,
                    4,
                    7,
                    0,
                    0,
                    5000,
                    DIGESTS.program,
                    seed,
                    Some(&proof)
                )
                .unwrap()
            )
        );
        assert_eq!(
            calls[1],
            (
                9,
                build_abi_manager_create_meta_official_instruction(
                    ABI_MANAGER_INSTRUCTION_CREATE_META_OFFICIAL_PERMANENT,
                    3,
                    5,
                    0,
                    Some(&amp)
                )
                .unwrap()
            )
        );
        assert_eq!(
            calls[2],
            (
                9,
                build_abi_manager_create_abi_official_instruction(
                    ABI_MANAGER_INSTRUCTION_CREATE_ABI_OFFICIAL_PERMANENT,
                    3,
                    5,
                    2,
                    6,
                    0,
                    300,
                    DIGESTS.abi,
                    0,
                    Some(&ap)
                )
                .unwrap()
            )
        );
        // Program + manager meta (3 pages) + ABI meta (1) + ABI (1).
        assert_eq!(tx.req_state_units, 3 + 1 + 1);
    }

    #[test]
    fn upgrade_reads_abi_meta_and_charges_growth_only() {
        let a = accounts();
        let sizes = ProgramAbiSizes {
            program: 9000,
            abi: 100,
            current_program_data: Some(5000),
            current_abi: Some(4000),
        };
        let tx = build_program_abi_transaction(
            key(1),
            key(12),
            &a,
            &ProgramStep::Upgrade,
            &AbiStep::Upgrade,
            &sizes,
            &DIGESTS,
            false,
            0,
            1,
            1,
        )
        .unwrap();
        assert_eq!(tx.rw_accs.clone().unwrap(), vec![key(2), key(4), key(5)]);
        assert_eq!(
            tx.r_accs.clone().unwrap(),
            vec![key(3), key(8), key(9), key(10), key(11)]
        );
        let calls = decode(tx.instructions.as_ref().unwrap());
        assert_eq!(
            calls,
            vec![
                (
                    8,
                    build_manager_upgrade_instruction(4, 3, 7, 0, 9000, DIGESTS.program).unwrap()
                ),
                (
                    9,
                    build_abi_manager_upgrade_abi_official_instruction(5, 4, 2, 6, 0, 100, DIGESTS.abi, 0)
                        .unwrap()
                ),
            ]
        );
        // Program grows 2 -> 3 pages; ABI shrinks, which costs nothing.
        assert_eq!(tx.req_state_units, 1);
    }

    #[test]
    fn proofs_must_match_permanence() {
        let a = accounts();
        let sizes = ProgramAbiSizes {
            program: 10,
            abi: 10,
            current_program_data: Some(10),
            current_abi: None,
        };
        let missing = AbiStep::CreateAbi { abi_proof: None };
        assert!(
            build_program_abi_transaction(
                key(1),
                key(12),
                &a,
                &ProgramStep::Upgrade,
                &missing,
                &sizes,
                &DIGESTS,
                false,
                0,
                1,
                1
            )
            .is_err()
        );
        assert!(
            build_program_abi_transaction(
                key(1),
                key(12),
                &a,
                &ProgramStep::Upgrade,
                &missing,
                &sizes,
                &DIGESTS,
                true,
                0,
                1,
                1
            )
            .is_ok()
        );
    }

    #[test]
    fn duplicate_accounts_are_rejected() {
        let mut a = accounts();
        a.abi_buffer = a.program_buffer;
        let sizes = ProgramAbiSizes {
            program: 10,
            abi: 10,
            current_program_data: Some(10),
            current_abi: Some(10),
        };
        assert!(
            build_program_abi_transaction(
                key(1),
                key(12),
                &a,
                &ProgramStep::Upgrade,
                &AbiStep::Upgrade,
                &sizes,
                &DIGESTS,
                false,
                0,
                1,
                1
            )
            .is_err()
        );
    }
}
