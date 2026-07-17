//! Feature gate account address helpers and byte-level ABI decoder.
//!
//! The on-chain account stores only machine-readable state. Human metadata such
//! as names and descriptions lives in the registry TOML, so this module keeps
//! the address derivation and raw account decoding separate from display logic.

use thru_base::tn_public_address::create_program_defined_account_address;
use thru_base::tn_tools::Pubkey;

use crate::error::CliError;

// These sizes and sentinels mirror src/thru/runtime/tn_feature_gate_abi.h.
pub const FEATURE_GATE_VALUE_SIZE: usize = 64;
pub const FEATURE_GATE_ACCOUNT_HEADER_SIZE: usize = 240;
pub const FEATURE_GATE_ENTRY_SIZE: usize = 152;
pub const FEATURE_GATE_ARMED_SLOT_SENTINEL: u64 = u64::MAX;
pub const FEATURE_GATE_ARMED_INDEX_SENTINEL: u32 = u32::MAX;
pub const FEATURE_GATE_CHANGE_SLOT_SENTINEL: u64 = u64::MAX;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFeatureGateAccount {
    pub entry_count: u32,
    pub creation_admin: Pubkey,
    pub pending_creation_admin: Pubkey,
    pub management_admin: Pubkey,
    pub pending_management_admin: Pubkey,
    pub config_admin: Pubkey,
    pub pending_config_admin: Pubkey,
    pub min_arming_lead_slots: u64,
    pub min_gap_between_armings_slots: u64,
    pub min_dwell_slots: u64,
    pub no_disarm_window_slots: u64,
    pub currently_armed_index: Option<u32>,
    pub most_recent_change_slot: Option<u64>,
    pub entries: Vec<DecodedFeatureGateEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFeatureGateEntry {
    pub current_value: [u8; FEATURE_GATE_VALUE_SIZE],
    pub armed_value: [u8; FEATURE_GATE_VALUE_SIZE],
    pub transition_slot: Option<u64>,
    pub last_change_slot: Option<u64>,
    pub next_change_lead_slots: u64,
}

pub fn decode_feature_gate_account(data: &[u8]) -> Result<DecodedFeatureGateAccount, CliError> {
    // The account is exact-sized: fixed header followed by entry_count entries.
    if data.len() < FEATURE_GATE_ACCOUNT_HEADER_SIZE {
        return Err(CliError::Validation(format!(
            "global feature-gate account data is too small: got {} bytes, need at least {}",
            data.len(),
            FEATURE_GATE_ACCOUNT_HEADER_SIZE
        )));
    }

    let entry_count = read_u32(data, 0)?;
    // Reject trailing or missing bytes so the CLI never decodes a stale/new ABI
    // as if it were the current one.
    let entries_size = (entry_count as usize)
        .checked_mul(FEATURE_GATE_ENTRY_SIZE)
        .ok_or_else(|| {
            CliError::Validation("global feature-gate account size overflow".to_string())
        })?;
    let expected_size = FEATURE_GATE_ACCOUNT_HEADER_SIZE
        .checked_add(entries_size)
        .ok_or_else(|| {
            CliError::Validation("global feature-gate account size overflow".to_string())
        })?;
    if data.len() != expected_size {
        return Err(CliError::Validation(format!(
            "global feature-gate account data size mismatch: got {} bytes, expected {} for {} entries",
            data.len(),
            expected_size,
            entry_count
        )));
    }

    let mut entries = Vec::with_capacity(entry_count as usize);
    for index in 0..entry_count as usize {
        let offset = FEATURE_GATE_ACCOUNT_HEADER_SIZE + index * FEATURE_GATE_ENTRY_SIZE;
        entries.push(DecodedFeatureGateEntry {
            current_value: read_value(data, offset)?,
            armed_value: read_value(data, offset + FEATURE_GATE_VALUE_SIZE)?,
            // Entry offsets are pinned by the C static asserts.
            transition_slot: decode_slot_sentinel(
                read_u64(data, offset + 128)?,
                FEATURE_GATE_ARMED_SLOT_SENTINEL,
            ),
            last_change_slot: decode_slot_sentinel(
                read_u64(data, offset + 136)?,
                FEATURE_GATE_CHANGE_SLOT_SENTINEL,
            ),
            next_change_lead_slots: read_u64(data, offset + 144)?,
        });
    }

    Ok(DecodedFeatureGateAccount {
        entry_count,
        creation_admin: read_pubkey(data, 4)?,
        pending_creation_admin: read_pubkey(data, 36)?,
        management_admin: read_pubkey(data, 68)?,
        pending_management_admin: read_pubkey(data, 100)?,
        config_admin: read_pubkey(data, 132)?,
        pending_config_admin: read_pubkey(data, 164)?,
        min_arming_lead_slots: read_u64(data, 196)?,
        min_gap_between_armings_slots: read_u64(data, 204)?,
        min_dwell_slots: read_u64(data, 212)?,
        no_disarm_window_slots: read_u64(data, 220)?,
        currently_armed_index: decode_index_sentinel(read_u32(data, 228)?),
        most_recent_change_slot: decode_slot_sentinel(
            read_u64(data, 232)?,
            FEATURE_GATE_CHANGE_SLOT_SENTINEL,
        ),
        entries,
    })
}

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey, CliError> {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(read_slice(data, offset, 32)?);
    Ok(Pubkey::from_bytes(&bytes))
}

fn read_value(data: &[u8], offset: usize) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    let mut value = [0u8; FEATURE_GATE_VALUE_SIZE];
    value.copy_from_slice(read_slice(data, offset, FEATURE_GATE_VALUE_SIZE)?);
    Ok(value)
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, CliError> {
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(read_slice(data, offset, 4)?);
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64, CliError> {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(read_slice(data, offset, 8)?);
    Ok(u64::from_le_bytes(bytes))
}

fn read_slice(data: &[u8], offset: usize, len: usize) -> Result<&[u8], CliError> {
    data.get(offset..offset + len).ok_or_else(|| {
        CliError::Validation(format!(
            "global feature-gate account data is truncated at offset {} length {}",
            offset, len
        ))
    })
}

// On-chain sentinel values become Option::None for CLI display/JSON.
fn decode_slot_sentinel(slot: u64, sentinel: u64) -> Option<u64> {
    if slot == sentinel {
        None
    } else {
        Some(slot)
    }
}

fn decode_index_sentinel(index: u32) -> Option<u32> {
    if index == FEATURE_GATE_ARMED_INDEX_SENTINEL {
        None
    } else {
        Some(index)
    }
}

// The feature-gate program is manager-owned/upgradable.  Genesis derives the
// program account through this manager pubkey and the program meta seed below.
const FEATURE_GATE_MANAGER_PROGRAM_PUBKEY: [u8; 32] = {
    let mut pubkey = [0u8; 32];
    pubkey[31] = 0x04;
    pubkey
};
const FEATURE_GATE_PROGRAM_META_SEED: &str = "feature_gate_program";
const FEATURE_GATE_GLOBAL_ACCOUNT_SEED: &str = "global_feature_gate_account";
const FEATURE_GATE_SEED_SIZE: usize = 32;

pub fn feature_gate_program_pubkey() -> Pubkey {
    Pubkey::from_bytes(&feature_gate_program_pubkey_bytes())
}

pub fn feature_gate_global_account_pubkey() -> Pubkey {
    Pubkey::from_bytes(&feature_gate_global_account_pubkey_bytes())
}

fn feature_gate_program_pubkey_bytes() -> [u8; 32] {
    let meta_pubkey = feature_gate_program_meta_pubkey_bytes();
    create_program_defined_account_address(
        &FEATURE_GATE_MANAGER_PROGRAM_PUBKEY,
        false,
        &meta_pubkey,
    )
}

fn feature_gate_program_meta_pubkey_bytes() -> [u8; 32] {
    create_program_defined_account_address(
        &FEATURE_GATE_MANAGER_PROGRAM_PUBKEY,
        false,
        &seed_bytes(FEATURE_GATE_PROGRAM_META_SEED),
    )
}

fn feature_gate_global_account_pubkey_bytes() -> [u8; 32] {
    let program_pubkey = feature_gate_program_pubkey_bytes();
    create_program_defined_account_address(
        &program_pubkey,
        false,
        &seed_bytes(FEATURE_GATE_GLOBAL_ACCOUNT_SEED),
    )
}

// PDA seeds are fixed-width, zero-padded 32-byte strings in the C implementation.
fn seed_bytes(seed: &str) -> [u8; FEATURE_GATE_SEED_SIZE] {
    let mut out = [0u8; FEATURE_GATE_SEED_SIZE];
    let seed_bytes = seed.as_bytes();
    out[..seed_bytes.len()].copy_from_slice(seed_bytes);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pubkey(seed: u8) -> Pubkey {
        Pubkey::from_bytes(&[seed; 32])
    }

    fn write_pubkey(data: &mut [u8], offset: usize, seed: u8) {
        data[offset..offset + 32].copy_from_slice(&[seed; 32]);
    }

    fn write_u32(data: &mut [u8], offset: usize, value: u32) {
        data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn write_u64(data: &mut [u8], offset: usize, value: u64) {
        data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn decodes_feature_gate_account_bytes() {
        let mut data = vec![0u8; FEATURE_GATE_ACCOUNT_HEADER_SIZE + FEATURE_GATE_ENTRY_SIZE];
        write_u32(&mut data, 0, 1);
        write_pubkey(&mut data, 4, 1);
        write_pubkey(&mut data, 36, 2);
        write_pubkey(&mut data, 68, 3);
        write_pubkey(&mut data, 100, 4);
        write_pubkey(&mut data, 132, 5);
        write_pubkey(&mut data, 164, 6);
        write_u64(&mut data, 196, 7);
        write_u64(&mut data, 204, 8);
        write_u64(&mut data, 212, 9);
        write_u64(&mut data, 220, 10);
        write_u32(&mut data, 228, FEATURE_GATE_ARMED_INDEX_SENTINEL);
        write_u64(&mut data, 232, FEATURE_GATE_CHANGE_SLOT_SENTINEL);

        let entry = FEATURE_GATE_ACCOUNT_HEADER_SIZE;
        data[entry] = 1;
        data[entry + FEATURE_GATE_VALUE_SIZE] = 2;
        write_u64(&mut data, entry + 128, 123);
        write_u64(&mut data, entry + 136, 456);
        write_u64(&mut data, entry + 144, 789);

        let account = decode_feature_gate_account(&data).expect("account decodes");
        assert_eq!(account.entry_count, 1);
        assert_eq!(account.creation_admin, test_pubkey(1));
        assert_eq!(account.pending_creation_admin, test_pubkey(2));
        assert_eq!(account.management_admin, test_pubkey(3));
        assert_eq!(account.pending_management_admin, test_pubkey(4));
        assert_eq!(account.config_admin, test_pubkey(5));
        assert_eq!(account.pending_config_admin, test_pubkey(6));
        assert_eq!(account.min_arming_lead_slots, 7);
        assert_eq!(account.min_gap_between_armings_slots, 8);
        assert_eq!(account.min_dwell_slots, 9);
        assert_eq!(account.no_disarm_window_slots, 10);
        assert_eq!(account.currently_armed_index, None);
        assert_eq!(account.most_recent_change_slot, None);
        assert_eq!(account.entries[0].current_value[0], 1);
        assert_eq!(account.entries[0].armed_value[0], 2);
        assert_eq!(account.entries[0].transition_slot, Some(123));
        assert_eq!(account.entries[0].last_change_slot, Some(456));
        assert_eq!(account.entries[0].next_change_lead_slots, 789);
    }

    #[test]
    fn rejects_truncated_or_mismatched_account_bytes() {
        let truncated = vec![0u8; FEATURE_GATE_ACCOUNT_HEADER_SIZE - 1];
        assert!(decode_feature_gate_account(&truncated).is_err());

        let mut mismatch = vec![0u8; FEATURE_GATE_ACCOUNT_HEADER_SIZE];
        write_u32(&mut mismatch, 0, 1);
        assert!(decode_feature_gate_account(&mismatch).is_err());
    }

    #[test]
    fn derives_stable_feature_gate_addresses() {
        assert_eq!(feature_gate_program_meta_pubkey_bytes().len(), 32);
        assert_eq!(feature_gate_program_pubkey_bytes().len(), 32);
        assert_eq!(feature_gate_global_account_pubkey_bytes().len(), 32);

        assert_ne!(
            feature_gate_program_meta_pubkey_bytes(),
            FEATURE_GATE_MANAGER_PROGRAM_PUBKEY
        );
        assert_ne!(
            feature_gate_program_pubkey_bytes(),
            feature_gate_program_meta_pubkey_bytes()
        );
        assert_ne!(
            feature_gate_global_account_pubkey_bytes(),
            feature_gate_program_pubkey_bytes()
        );
    }
}
