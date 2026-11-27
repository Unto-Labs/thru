//! `--via-multisig` for admin commands: instead of signing the action
//! directly, propose it as a multisig invoke request. The child instruction
//! is encoded against the multisig transaction's account layout, with the
//! multisig account as the authority.

use super::{Ctx, ProposeSpec, addr, pk_bytes, propose};
use crate::cli::{FeatureGateAdminRole, MultisigCommonArgs, MultisigProposeArgs, ViaMultisigArgs};
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::feature_gate_account::{
    feature_gate_global_account_pubkey, feature_gate_program_pubkey,
};
use thru_base::multisig::MultisigLayout;
use thru_base::tn_tools::Pubkey;
use thru_base::txn_lib::TnPubkey;
use thru_base::txn_tools as tt;

fn ix(l: &MultisigLayout, k: &TnPubkey) -> Result<u16, CliError> {
    l.idx(k).map_err(|e| CliError::Validation(e.to_string()))
}

fn enc(r: anyhow::Result<Vec<u8>>) -> Result<Vec<u8>, CliError> {
    r.map_err(|e| CliError::Validation(e.to_string()))
}

struct Via<'a> {
    ctx: Ctx<'a>,
    multisig: TnPubkey,
    multisig_str: String,
    pa: MultisigProposeArgs,
}

impl<'a> Via<'a> {
    fn new(
        config: &'a Config,
        via: &ViaMultisigArgs,
        fee_payer: Option<&str>,
        json: bool,
    ) -> Result<Self, CliError> {
        let ms_str = via
            .via_multisig
            .clone()
            .ok_or_else(|| CliError::Validation("--via-multisig is required".into()))?;
        let ctx = Ctx::with_program(config, via.multisig_program.as_deref(), json)?;
        let multisig = ctx.resolve(&ms_str)?;
        let pa = MultisigProposeArgs {
            no_approve: via.no_approve,
            common: MultisigCommonArgs {
                fee_payer: fee_payer.map(str::to_string),
                program: via.multisig_program.clone(),
            },
        };
        Ok(Via {
            ctx,
            multisig,
            multisig_str: ms_str,
            pa,
        })
    }

    /// The command's authority argument must name the multisig.
    fn check_authority(&self, authority: &str) -> Result<(), CliError> {
        let a = self.ctx.resolve(authority)?;
        if a != self.multisig {
            return Err(CliError::Validation(format!(
                "with --via-multisig the authority must be the multisig {} (got {})",
                addr(&self.multisig),
                addr(&a)
            )));
        }
        Ok(())
    }

    /// Token program: the override, or the on-chain owner of `account`.
    async fn token_program(
        &self,
        override_addr: Option<&str>,
        account: &TnPubkey,
    ) -> Result<TnPubkey, CliError> {
        if let Some(p) = override_addr {
            return self.ctx.resolve(p);
        }
        let (acct, _) = self
            .ctx
            .account(account)
            .await?
            .ok_or_else(|| CliError::AccountNotFound(addr(account)))?;
        pk_bytes(&acct.owner)
    }

    async fn propose(&self, spec: ProposeSpec) -> Result<(), CliError> {
        propose(&self.ctx, &self.multisig_str, &self.pa, spec).await
    }
}

/* ---------------- token ---------------- */

#[allow(clippy::too_many_arguments)]
pub async fn token_mint_to(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    mint: &str,
    to: &str,
    authority: &str,
    amount: u64,
    token_program: Option<&str>,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    v.check_authority(authority)?;
    let (mint, to) = (v.ctx.resolve(mint)?, v.ctx.resolve(to)?);
    let tp = v.token_program(token_program, &mint).await?;
    let summary = format!(
        "token mint-to {} of {} to {}",
        amount,
        addr(&mint),
        addr(&to)
    );
    v.propose(ProposeSpec::invoke(
        summary,
        tp,
        vec![mint, to],
        vec![],
        move |l, ms| {
            enc(tt::build_token_mint_to_instruction(
                ix(l, &mint)?,
                ix(l, &to)?,
                ix(l, ms)?,
                amount,
            ))
        },
    ))
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn token_burn(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    account: &str,
    mint: &str,
    authority: &str,
    amount: u64,
    token_program: Option<&str>,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    v.check_authority(authority)?;
    let (account, mint) = (v.ctx.resolve(account)?, v.ctx.resolve(mint)?);
    let tp = v.token_program(token_program, &mint).await?;
    let summary = format!("token burn {} from {}", amount, addr(&account));
    v.propose(ProposeSpec::invoke(
        summary,
        tp,
        vec![account, mint],
        vec![],
        move |l, ms| {
            enc(tt::build_token_burn_instruction(
                ix(l, &account)?,
                ix(l, &mint)?,
                ix(l, ms)?,
                amount,
            ))
        },
    ))
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn token_transfer(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    from: &str,
    to: &str,
    amount: u64,
    unchecked: bool,
    token_program: Option<&str>,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let (from, to) = (v.ctx.resolve(from)?, v.ctx.resolve(to)?);
    let tp = v.token_program(token_program, &from).await?;
    let checked = if unchecked {
        None
    } else {
        Some(
            crate::commands::token::read_checked_transfer_inputs(&v.ctx.client, &from, &tp, json)
                .await?,
        )
    };
    let summary = match &checked {
        Some(inputs) => format!(
            "token transfer {} from {} to {} (mint: {}; ticker: \"{}\"; decimals: {})",
            super::decode::format_token_amount(amount, inputs.decimals),
            addr(&from),
            addr(&to),
            addr(&inputs.mint),
            inputs.ticker.escape_ascii(),
            inputs.decimals,
        ),
        None => format!(
            "token transfer {} (raw units) from {} to {}",
            amount,
            addr(&from),
            addr(&to),
        ),
    };
    if !json {
        println!("Proposing: {summary}");
    }
    v.propose(ProposeSpec::invoke(
        summary,
        tp,
        vec![from, to],
        checked.as_ref().map(|inputs| vec![inputs.mint]).unwrap_or_default(),
        move |l, _| {
            enc(match &checked {
                Some(inputs) => tt::build_token_transfer_checked_instruction(
                    ix(l, &from)?,
                    ix(l, &to)?,
                    ix(l, &inputs.mint)?,
                    amount,
                    inputs.decimals,
                    &inputs.ticker,
                ),
                None => tt::build_token_transfer_instruction(ix(l, &from)?, ix(l, &to)?, amount),
            })
        },
    ))
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn token_freeze_thaw(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    account: &str,
    mint: &str,
    authority: &str,
    freeze: bool,
    token_program: Option<&str>,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    v.check_authority(authority)?;
    let (account, mint) = (v.ctx.resolve(account)?, v.ctx.resolve(mint)?);
    let tp = v.token_program(token_program, &mint).await?;
    let summary = format!(
        "token {} {}",
        if freeze { "freeze" } else { "thaw" },
        addr(&account)
    );
    v.propose(ProposeSpec::invoke(
        summary,
        tp,
        vec![account, mint],
        vec![],
        move |l, ms| {
            let (a, m, au) = (ix(l, &account)?, ix(l, &mint)?, ix(l, ms)?);
            enc(if freeze {
                tt::build_token_freeze_account_instruction(a, m, au)
            } else {
                tt::build_token_thaw_account_instruction(a, m, au)
            })
        },
    ))
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn token_close_account(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    account: &str,
    destination: &str,
    authority: &str,
    token_program: Option<&str>,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    v.check_authority(authority)?;
    let (account, dest) = (v.ctx.resolve(account)?, v.ctx.resolve(destination)?);
    let tp = v.token_program(token_program, &account).await?;
    let summary = format!("token close-account {} to {}", addr(&account), addr(&dest));
    v.propose(ProposeSpec::invoke(
        summary,
        tp,
        vec![account, dest],
        vec![],
        move |l, ms| {
            enc(tt::build_token_close_account_instruction(
                ix(l, &account)?,
                ix(l, &dest)?,
                ix(l, ms)?,
            ))
        },
    ))
    .await
}

/* ---------------- program manager ---------------- */

fn manager_accounts(
    v: &Via<'_>,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
) -> Result<(TnPubkey, TnPubkey, TnPubkey), CliError> {
    let manager = match manager {
        Some(m) => v.ctx.resolve(m)?,
        None => pk_bytes(&v.ctx.config.get_manager_pubkey()?)?,
    };
    let (meta, program) =
        crypto::derive_manager_accounts_from_seed(seed, &Pubkey::from_bytes(&manager), ephemeral)?;
    Ok((manager, pk_bytes(&meta)?, pk_bytes(&program)?))
}

#[allow(clippy::too_many_arguments)]
pub async fn program_set_authority(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    candidate: &str,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let (mgr, meta, program) = manager_accounts(&v, manager, seed, ephemeral)?;
    let cand = v.ctx.resolve(candidate)?;
    let summary = format!(
        "program set-authority {} -> {}",
        addr(&program),
        addr(&cand)
    );
    v.propose(ProposeSpec::invoke(
        summary,
        mgr,
        vec![meta, program],
        vec![],
        move |l, _| {
            enc(tt::build_manager_set_authority_instruction(
                ix(l, &meta)?,
                ix(l, &program)?,
                cand,
            ))
        },
    ))
    .await
}

pub async fn program_claim_authority(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let (mgr, meta, program) = manager_accounts(&v, manager, seed, ephemeral)?;
    let summary = format!("program claim-authority {}", addr(&program));
    v.propose(ProposeSpec::invoke(
        summary,
        mgr,
        vec![meta, program],
        vec![],
        move |l, _| {
            enc(tt::build_manager_header_instruction(
                tt::MANAGER_INSTRUCTION_CLAIM_AUTHORITY,
                ix(l, &meta)?,
                ix(l, &program)?,
            ))
        },
    ))
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn program_set_pause(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    paused: bool,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let (mgr, meta, program) = manager_accounts(&v, manager, seed, ephemeral)?;
    let summary = format!(
        "program {} {}",
        if paused { "pause" } else { "unpause" },
        addr(&program)
    );
    v.propose(ProposeSpec::invoke(
        summary,
        mgr,
        vec![meta, program],
        vec![],
        move |l, _| {
            enc(tt::build_manager_set_pause_instruction(
                ix(l, &meta)?,
                ix(l, &program)?,
                paused,
            ))
        },
    ))
    .await
}

/* ---------------- feature gates ---------------- */

fn feature_gate_accounts() -> Result<(TnPubkey, TnPubkey), CliError> {
    Ok((
        pk_bytes(&feature_gate_program_pubkey())?,
        pk_bytes(&feature_gate_global_account_pubkey())?,
    ))
}

pub async fn feature_gate_propose_admin(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    role: FeatureGateAdminRole,
    new_admin: &str,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let admin = v.ctx.resolve(new_admin)?;
    let (program, global) = feature_gate_accounts()?;
    let role_byte = crate::commands::feature_gates::role_discriminant(role);
    let summary = format!("feature-gates propose-admin {:?} -> {}", role, addr(&admin));
    v.propose(ProposeSpec::invoke(
        summary,
        program,
        vec![global],
        vec![],
        move |l, ms| {
            Ok(
                crate::commands::feature_gates::encode_propose_admin_instruction_at(
                    ix(l, &global)?,
                    ix(l, ms)?,
                    role_byte,
                    &admin,
                ),
            )
        },
    ))
    .await
}

pub async fn feature_gate_accept_admin(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    role: FeatureGateAdminRole,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    let (program, global) = feature_gate_accounts()?;
    let role_byte = crate::commands::feature_gates::role_discriminant(role);
    let summary = format!("feature-gates accept-admin {:?}", role);
    v.propose(ProposeSpec::invoke(
        summary,
        program,
        vec![global],
        vec![],
        move |l, ms| {
            Ok(
                crate::commands::feature_gates::encode_accept_admin_instruction_at(
                    ix(l, &global)?,
                    ix(l, ms)?,
                    role_byte,
                ),
            )
        },
    ))
    .await
}

/// Any feature-gate write instruction. Every one of them carries the global
/// account index and the authority index at bytes 4..8, which are re-pointed
/// at the multisig layout.
pub async fn feature_gate_instruction(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    label: &str,
    instruction: Vec<u8>,
    json: bool,
) -> Result<(), CliError> {
    if instruction.len() < 8 {
        return Err(CliError::Validation(
            "feature-gate instruction too short".into(),
        ));
    }
    let v = Via::new(config, via, fee_payer, json)?;
    let (program, global) = feature_gate_accounts()?;
    let summary = format!("feature-gates {}", label);
    v.propose(ProposeSpec::invoke(
        summary,
        program,
        vec![global],
        vec![],
        move |l, ms| {
            let mut d = instruction.clone();
            d[4..6].copy_from_slice(&ix(l, &global)?.to_le_bytes());
            d[6..8].copy_from_slice(&ix(l, ms)?.to_le_bytes());
            Ok(d)
        },
    ))
    .await
}

/* ---------------- program upgrade ---------------- */

/// Uploads the new code to a buffer owned by the proposer, then proposes the
/// manager upgrade that installs it. The buffer stays until the proposer
/// cleans it up after execution.
#[allow(clippy::too_many_arguments)]
pub async fn program_upgrade(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    program_file: &str,
    skip_program_image_validation: bool,
    chunk_size: usize,
    skip_elf_check: bool,
    abi: Option<(String, Vec<u8>)>,
    json: bool,
) -> Result<(), CliError> {
    use crate::commands::program::{seed_with_suffix, validate_program_file_or_report};
    use crate::commands::uploader::UploaderManager;

    let v = Via::new(config, via, fee_payer, json)?;
    let (mgr, meta, program) = manager_accounts(&v, manager, seed, ephemeral)?;
    if program == v.ctx.program {
        return Err(CliError::Validation(
            "a multisig request can't rewrite the multisig program itself (it occupies the transaction's program slot); use `thru governance` with a Multicall wrapper".into(),
        ));
    }
    let data = std::fs::read(program_file).map_err(CliError::Io)?;
    validate_program_file_or_report(program_file, &data, skip_program_image_validation, json)?;
    let size = u32::try_from(data.len())
        .map_err(|_| CliError::Validation("program file too large".into()))?;
    let code_digest = crypto::calculate_sha256(&data);
    let code_hash = hex::encode(code_digest);

    if let Some((abi_path, abi_data)) = abi {
        return program_upgrade_with_abi(
            &v, config, fee_payer, seed, ephemeral, (mgr, meta, program), &data, chunk_size,
            skip_elf_check, &abi_path, abi_data, json,
        )
        .await;
    }

    let (buffer_seed, _) = seed_with_suffix(seed, "multisig_upgrade");
    if !json {
        crate::output::print_info(&format!(
            "Uploading {} bytes (sha256 {}) to buffer seed '{}'",
            data.len(),
            code_hash,
            buffer_seed
        ));
    }
    let uploader = UploaderManager::new_with_fee_payer(config, fee_payer).await?;
    let session = uploader
        .upload_program_with_options(&buffer_seed, &data, chunk_size, skip_elf_check, json)
        .await?;
    let buffer = pk_bytes(&session.buffer_account)?;

    let summary = format!(
        "program upgrade {} to {} bytes (sha256 {}); after execution clean up with: thru uploader cleanup {}",
        addr(&program),
        size,
        code_hash,
        buffer_seed
    );
    v.propose(ProposeSpec::invoke(
        summary,
        mgr,
        vec![meta, program],
        vec![buffer],
        move |l, _| {
            enc(tt::build_manager_upgrade_instruction(
                ix(l, &meta)?,
                ix(l, &program)?,
                ix(l, &buffer)?,
                0,
                size,
                code_digest,
            ))
        },
    ))
    .await
}

/// `program upgrade --abi --via-multisig`: propose one Invoke of Multicall
/// that upgrades the program and its official ABI, with the multisig as the
/// authority of both. Multicall passes no auth of its own, so the
/// multisig's invoke-auth for its account reaches both managers.
///
/// The official ABI must already exist: creating one needs creation state
/// proofs, which would go stale while members approve.
#[allow(clippy::too_many_arguments)]
async fn program_upgrade_with_abi(
    v: &Via<'_>,
    config: &Config,
    fee_payer: Option<&str>,
    seed: &str,
    ephemeral: bool,
    (mgr, meta, program): (TnPubkey, TnPubkey, TnPubkey),
    data: &[u8],
    chunk_size: usize,
    skip_elf_check: bool,
    abi_path: &str,
    abi_data: Vec<u8>,
    json: bool,
) -> Result<(), CliError> {
    use crate::commands::abi::official_abi_accounts;
    use crate::commands::program::seed_with_suffix;
    use crate::commands::program_abi::{ABI_APPEND_ONLY_TIP, OfficialAbiState, official_abi_state};
    use crate::commands::uploader::UploaderManager;
    use thru_base::program_abi::{
        AbiStep, ProgramAbiAccounts, ProgramAbiDigests, ProgramStep, build_multicall_instruction,
        build_program_abi_calls,
    };

    let abi_manager = config.get_abi_manager_pubkey()?;
    let multicall = pk_bytes(&config.get_multicall_program_pubkey()?)?;
    let (abi_meta, abi) = official_abi_accounts(&program, &abi_manager, ephemeral)?;
    let (abi_meta_bytes, abi_bytes) = (pk_bytes(&abi_meta)?, pk_bytes(&abi)?);
    let revision = match official_abi_state(&v.ctx.client, &abi_meta, &abi).await? {
        OfficialAbiState::Present { revision, .. } => revision,
        OfficialAbiState::Missing | OfficialAbiState::MetaOnly => {
            return Err(CliError::Validation(format!(
                "program {} has no official ABI yet, and a multisig request can't create one \
                 (creation proofs expire before members approve). Upgrade with \
                 --dangerously-exclude-abi, or publish the ABI before moving authority to the multisig",
                addr(&program)
            )));
        }
    };

    let size = u32::try_from(data.len())
        .map_err(|_| CliError::Validation("program file too large".into()))?;
    let abi_size = u32::try_from(abi_data.len())
        .map_err(|_| CliError::Validation("ABI file too large".into()))?;
    // Each manager instruction commits to its digest (UNTO-3561), so the
    // request binds the reviewed bytes, not just the buffers.
    let digests = ProgramAbiDigests {
        program: crypto::calculate_sha256(data),
        abi: crypto::calculate_sha256(&abi_data),
    };
    let code_hash = hex::encode(digests.program);
    let abi_hash = hex::encode(digests.abi);

    let (program_buffer_seed, _) = seed_with_suffix(seed, "multisig_upgrade");
    let (abi_buffer_seed, _) = seed_with_suffix(seed, "multisig_abi");
    if !json {
        crate::output::print_info(&format!(
            "Uploading program ({} bytes, sha256 {}) to buffer seed '{}'",
            data.len(),
            code_hash,
            program_buffer_seed
        ));
    }
    let uploader = UploaderManager::new_with_fee_payer(config, fee_payer).await?;
    let program_session = uploader
        .upload_program_with_options(&program_buffer_seed, data, chunk_size, skip_elf_check, json)
        .await?;
    if !json {
        crate::output::print_info(&format!(
            "Uploading ABI {} ({} bytes, sha256 {}) to buffer seed '{}'",
            abi_path,
            abi_data.len(),
            abi_hash,
            abi_buffer_seed
        ));
    }
    let abi_session = uploader
        .upload_program(&abi_buffer_seed, &abi_data, chunk_size, json)
        .await?;

    let accounts = ProgramAbiAccounts {
        manager_program: mgr,
        abi_manager_program: pk_bytes(&abi_manager)?,
        program_meta: meta,
        program,
        abi_meta: abi_meta_bytes,
        abi: abi_bytes,
        program_buffer: pk_bytes(&program_session.buffer_account)?,
        abi_buffer: pk_bytes(&abi_session.buffer_account)?,
    };
    let summary = format!(
        "program upgrade {} to {} bytes (sha256 {}) with ABI revision {} -> {} ({} bytes, sha256 {}) in one Multicall; after execution clean up with: thru uploader cleanup {} && thru uploader cleanup {}",
        addr(&program),
        size,
        code_hash,
        revision,
        revision + 1,
        abi_size,
        abi_hash,
        program_buffer_seed,
        abi_buffer_seed
    );
    v.propose(ProposeSpec::invoke(
        summary,
        multicall,
        vec![meta, program, abi_bytes],
        vec![
            mgr,
            accounts.abi_manager_program,
            abi_meta_bytes,
            accounts.program_buffer,
            accounts.abi_buffer,
        ],
        move |l, multisig| {
            let calls = build_program_abi_calls(
                &|k| l.idx(k),
                &accounts,
                &ProgramStep::Upgrade,
                &AbiStep::Upgrade,
                size,
                abi_size,
                &digests,
                ix(l, multisig)?,
                ephemeral,
            )
            .map_err(|e| CliError::Validation(e.to_string()))?;
            enc(build_multicall_instruction(&calls))
        },
    ))
    .await?;
    if !json {
        crate::output::print_info(ABI_APPEND_ONLY_TIP);
    }
    Ok(())
}

/* ---------------- consensus validator manager ---------------- */

/// The proposal for a CV manager instruction to `program`. When the
/// instruction needs more than the execute default and `program` isn't a
/// CV program this CLI knows, the executor's CLI won't know it either, so
/// the execute command names it with `--consensus-program`.
fn cv_manager_spec(
    ctx: &Ctx<'_>,
    label: &str,
    program: TnPubkey,
    attestor_table: TnPubkey,
    program_meta: Option<TnPubkey>,
    encode: impl Fn(u64, Option<u16>) -> Vec<u8> + Send + 'static,
) -> ProposeSpec {
    // The executor's CLI budgets the call only for a CV program it knows.
    let name_program = tt::cv_manager_compute_units(&encode(0, None)).is_some()
        && !super::decode::is_consensus_validator(ctx, &program);
    let mut spec = ProposeSpec::invoke(
        format!("consensus validator {}", label),
        program,
        vec![attestor_table],
        program_meta.into_iter().collect(),
        move |l, _| {
            let meta_idx = match program_meta {
                Some(meta) => Some(ix(l, &meta)?),
                None => None,
            };
            Ok(encode(u64::from(ix(l, &attestor_table)?), meta_idx))
        },
    );
    if name_program {
        spec.execute_args = vec!["--consensus-program".to_string(), addr(&program)];
    }
    spec
}

/// A consensus validator manager instruction from a multisig: the manager,
/// or for InitValidatorManager the program's application authority. The
/// child writes the attestor table (and Init reads the program's metadata);
/// the CV program authorizes the multisig as the instruction's caller.
/// `manager` is the table's current validator manager when the instruction
/// needs one; it must be the multisig. The instruction runs when the
/// request executes, as it would at the top level: ManagerActivate,
/// ManagerDeactivate and ManagerSetWeight update the consensus state and
/// emit their events then. `thru multisig execute` requests the compute
/// budget the direct command would (`decode::cv_manager_hints`) for a CV
/// program it knows; for another `--program`, the proposal's execute
/// command (and its JSON `execute_args`) adds `--consensus-program`, and
/// `request show` notes it for whoever executes.
#[allow(clippy::too_many_arguments)]
pub async fn cv_manager_instruction(
    config: &Config,
    via: &ViaMultisigArgs,
    fee_payer: Option<&str>,
    label: &str,
    program: TnPubkey,
    attestor_table: TnPubkey,
    program_meta: Option<TnPubkey>,
    manager: Option<TnPubkey>,
    encode: impl Fn(u64, Option<u16>) -> Vec<u8> + Send + 'static,
    json: bool,
) -> Result<(), CliError> {
    let v = Via::new(config, via, fee_payer, json)?;
    if let Some(manager) = manager {
        if manager != v.multisig {
            return Err(CliError::Validation(format!(
                "the validator manager is {}, not the multisig {}",
                addr(&manager),
                addr(&v.multisig)
            )));
        }
    }
    let spec = cv_manager_spec(&v.ctx, label, program, attestor_table, program_meta, encode);
    let name_program = !spec.execute_args.is_empty();
    v.propose(spec).await?;
    if name_program && !json {
        crate::output::print_info(&format!(
            "whoever executes this request should pass --consensus-program {}: the CLI gives this call its compute budget only for a consensus validator program it knows",
            addr(&program)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use thru_base::bootstrap_addresses as programs;

    /* A proposal to a CV program the proposer's CLI doesn't know names it
       for the executor (the execute command and the --json execute_args)
       when the instruction needs a budget.  The bootstrap program and the
       header-only instructions need no flag. */
    #[tokio::test]
    async fn cv_manager_proposals_name_an_unknown_program_for_the_executor() {
        let mut config = Config::default();
        config.rpc_base_url = "http://127.0.0.1:1".to_string();
        let ctx = Ctx::with_program(&config, None, true).expect("context");
        let custom: TnPubkey = [0x5c; 32];
        let table: TnPubkey = [0x33; 32];
        let execute_args = |program: TnPubkey, d: Vec<u8>| {
            cv_manager_spec(&ctx, "op", program, table, None, move |_, _| d.clone()).execute_args
        };
        let activate = tt::build_cv_manager_activate_instruction(2, [7; 32], [1; 96], [2; 192], [3; 32], 100);
        let deactivate = tt::build_cv_manager_deactivate_instruction(2, [7; 32]);
        let set_weight = tt::build_cv_manager_set_weight_instruction(2, [7; 32], 300);
        let self_service = tt::build_cv_set_self_service_instruction(2, true);

        let named = vec!["--consensus-program".to_string(), addr(&custom)];
        for d in [activate.clone(), deactivate, set_weight] {
            assert_eq!(execute_args(custom, d), named);
        }
        assert!(execute_args(custom, self_service).is_empty());
        assert!(execute_args(programs::CONSENSUS_VALIDATOR_PROGRAM_BYTES, activate).is_empty());
    }
}
