use crate::{
    StateProof,
    tn_public_address::tn_pubkey_to_address_string,
    txn_lib::{TnPubkey, Transaction},
};
use anyhow::Result;
use hex;

/// No-op program identifier (32-byte array with 0x03 in the last byte)
pub const NOOP_PROGRAM: [u8; 32] = {
    let mut arr = [0u8; 32];
    arr[31] = 0x03;
    arr
};
pub const SYSTEM_PROGRAM: [u8; 32] = {
    let mut arr = [0u8; 32];
    arr[31] = 0x01;
    arr
};
pub const EOA_PROGRAM: [u8; 32] = {
    let arr = [0u8; 32];
    arr
};

pub const UPLOADER_PROGRAM: [u8; 32] = {
    let mut arr = [0u8; 32];
    arr[31] = 0x02;
    arr
};

#[derive(Debug, Clone)]
pub struct TransactionBuilder {
    // fee_payer: FdPubkey,
    // program: FdPubkey,
    // fee: u64,
    // nonce: u64,
}

impl TransactionBuilder {
    /// Build balance transfer transaction
    pub fn build_create_with_fee_payer_proof(
        fee_payer: TnPubkey,
        start_slot: u64,
        fee_payer_state_proof: &StateProof,
    ) -> Result<Transaction> {
        let tx = Transaction::new(fee_payer, NOOP_PROGRAM, 0, 0)
            .with_fee_payer_state_proof(fee_payer_state_proof)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(10_000)
            .with_memory_units(10_000)
            .with_state_units(10_000);
        Ok(tx)
    }

    /// Build balance transfer transaction for EOA program (tn_eoa_program.c)
    ///
    /// This creates a transaction that calls the TRANSFER instruction of the EOA program,
    /// which transfers balance from one account to another.
    ///
    /// # Arguments
    /// * `fee_payer` - The account paying the transaction fee (also the from_account for the transfer)
    /// * `program` - The EOA program pubkey (typically EOA_PROGRAM constant = all zeros)
    /// * `to_account` - The destination account receiving the transfer
    /// * `amount` - The amount to transfer
    /// * `fee` - Transaction fee
    /// * `nonce` - Account nonce
    /// * `start_slot` - Starting slot for transaction validity
    pub fn build_transfer(
        fee_payer: TnPubkey,
        program: TnPubkey,
        to_account: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Create transfer instruction data for EOA program
        // Account layout: [0: fee_payer/from_account, 1: program, 2: to_account]
        let from_account_idx = 0u16; // fee_payer is also the from_account
        let to_account_idx = 2u16; // to_account added via add_rw_account
        let instruction_data =
            build_transfer_instruction(from_account_idx, to_account_idx, amount)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .add_rw_account(to_account) // Destination account (receives transfer)
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(10000)
            .with_memory_units(10000)
            .with_state_units(10000);

        Ok(tx)
    }

    /// Build regular account creation transaction (with optional state proof)
    pub fn build_create_account(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        seed: &str,
        state_proof: Option<&[u8]>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data =
            build_create_account_instruction(target_account_idx, seed, state_proof)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .add_rw_account(target_account)
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(10_000)
            .with_memory_units(10_000)
            .with_state_units(10_000);

        Ok(tx)
    }

    /// Build account creation transaction
    pub fn build_create_ephemeral_account(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        seed: &[u8; 32],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data = build_ephemeral_account_instruction(target_account_idx, seed)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .add_rw_account(target_account)
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(50_000)
            .with_memory_units(10_000)
            .with_state_units(10_000);
        Ok(tx)
    }

    /// Build account resize transaction
    pub fn build_resize_account(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        new_size: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data = build_resize_instruction(target_account_idx, new_size)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(100032)
            .with_state_units(1 + new_size.checked_div(4096).unwrap() as u16)
            .with_memory_units(10000)
            .add_rw_account(target_account)
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(10_000 + 2 * new_size as u32)
            .with_memory_units(10_000)
            .with_state_units(10_000);

        Ok(tx)
    }

    /// Build account compression transaction
    pub fn build_compress_account(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        state_proof: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
        account_size: u32,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data = build_compress_instruction(target_account_idx, state_proof)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .with_may_compress_account()
            .add_rw_account(target_account)
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(100_300 + account_size * 2)
            .with_memory_units(10000)
            .with_state_units(10000);

        Ok(tx)
    }

    /// Build account decompression transaction
    pub fn build_decompress_account(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        account_data: &[u8],
        state_proof: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data =
            build_decompress_instruction(target_account_idx, account_data, state_proof)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .add_rw_account(target_account)
            .with_instructions(instruction_data)
            .with_compute_units(100_300 + account_data.len() as u32 * 2)
            .with_state_units(10_000)
            .with_memory_units(10_000)
            .with_expiry_after(100);
        Ok(tx)
    }

    /// Build data write transaction
    pub fn build_write_data(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        offset: u16,
        data: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account]
        let target_account_idx = 2u16; // target_account added via add_rw_account
        let instruction_data = build_write_instruction(target_account_idx, offset, data)?;

        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(100045)
            .with_state_units(10000)
            .with_memory_units(10000)
            .add_rw_account(target_account)
            .with_instructions(instruction_data);

        Ok(tx)
    }
}

/// Build transfer instruction for EOA program (tn_eoa_program.c)
///
/// Instruction format (matching tn_eoa_instruction_t and tn_eoa_transfer_args_t):
/// - Discriminant: u32 (4 bytes) = TN_EOA_INSTRUCTION_TRANSFER (1)
/// - Amount: u64 (8 bytes)
/// - From account index: u16 (2 bytes)
/// - To account index: u16 (2 bytes)
/// Total: 16 bytes
fn build_transfer_instruction(
    from_account_idx: u16,
    to_account_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_EOA_INSTRUCTION_TRANSFER = 1 (u32, 4 bytes little-endian)
    instruction.extend_from_slice(&1u32.to_le_bytes());

    // tn_eoa_transfer_args_t structure:
    // - amount (u64, 8 bytes little-endian)
    instruction.extend_from_slice(&amount.to_le_bytes());

    // - from_account_idx (u16, 2 bytes little-endian)
    instruction.extend_from_slice(&from_account_idx.to_le_bytes());

    // - to_account_idx (u16, 2 bytes little-endian)
    instruction.extend_from_slice(&to_account_idx.to_le_bytes());

    Ok(instruction)
}

/// Build regular account creation instruction (TN_SYS_PROG_DISCRIMINANT_ACCOUNT_CREATE = 0x00)
fn build_create_account_instruction(
    target_account_idx: u16,
    seed: &str,
    state_proof: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_ACCOUNT_CREATE = 0x00
    instruction.push(0x00);

    // Target account index (little-endian u16) - matching tn_system_program_account_create_args_t
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());

    // Seed should be hex-decoded (to match addrtool behavior)
    let seed_bytes =
        hex::decode(seed).map_err(|e| anyhow::anyhow!("Failed to decode hex seed: {}", e))?;

    // Seed length (little-endian u64) - matching tn_system_program_account_create_args_t.seed_len
    instruction.extend_from_slice(&(seed_bytes.len() as u64).to_le_bytes());

    // has_proof flag (1 byte) - matching tn_system_program_account_create_args_t.has_proof
    let has_proof = state_proof.is_some();
    instruction.push(if has_proof { 1u8 } else { 0u8 });

    // Seed data (seed_len bytes follow)
    instruction.extend_from_slice(&seed_bytes);

    // Proof data (if present, proof follows seed)
    if let Some(proof) = state_proof {
        instruction.extend_from_slice(proof);
    }

    Ok(instruction)
}

/// Build ephemeral account creation instruction
fn build_ephemeral_account_instruction(
    target_account_idx: u16,
    seed: &[u8; 32],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_ACCOUNT_CREATE_EPHEMERAL = 01
    instruction.push(0x01);

    // Target account index (little-endian u16)
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());

    // Seed length (little-endian u64)
    instruction.extend_from_slice(&(seed.len() as u64).to_le_bytes());

    // Seed data
    instruction.extend_from_slice(seed);

    Ok(instruction)
}

/// Build account resize instruction
fn build_resize_instruction(target_account_idx: u16, new_size: u64) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_ACCOUNT_RESIZE = 04
    instruction.push(0x04);

    // Target account index (little-endian u16)
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());

    // New size (little-endian u64)
    instruction.extend_from_slice(&new_size.to_le_bytes());

    Ok(instruction)
}

/// Build data write instruction
fn build_write_instruction(target_account_idx: u16, offset: u16, data: &[u8]) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_WRITE = C8
    instruction.push(0xC8);

    // Target account index (little-endian u16)
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());

    // Offset (little-endian u16)
    instruction.extend_from_slice(&offset.to_le_bytes());

    // Data length (little-endian u16)
    instruction.extend_from_slice(&(data.len() as u16).to_le_bytes());

    // Data
    instruction.extend_from_slice(data);

    Ok(instruction)
}

/// Build account compression instruction
fn build_compress_instruction(target_account_idx: u16, state_proof: &[u8]) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_ACCOUNT_COMPRESS - based on C test, this appears to be different from other discriminants
    // Looking at the C test pattern and other system discriminants, compression is likely 0x05
    instruction.push(0x05);

    // Target account index (little-endian u16)
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());

    // State proof bytes
    instruction.extend_from_slice(state_proof);

    Ok(instruction)
}

fn build_decompress_instruction(
    target_account_idx: u16,
    account_data: &[u8],
    state_proof: &[u8],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // TN_SYS_PROG_DISCRIMINANT_ACCOUNT_DECOMPRESS = 0x06
    instruction.push(0x06);

    // tn_system_program_account_decompress_args_t: account_idx (u16) + data_len (u64)
    instruction.extend_from_slice(&target_account_idx.to_le_bytes());
    instruction.extend_from_slice(&(account_data.len() as u64).to_le_bytes());

    // Account data
    instruction.extend_from_slice(account_data);

    // State proof bytes
    instruction.extend_from_slice(state_proof);

    Ok(instruction)
}

/// Generate ephemeral account address from seed
/// This replaces the `addrtool --ephemeral` functionality
/// Based on create_program_defined_account_address from tn_vm_syscalls.c
/// Note: For ephemeral accounts, the owner is always the system program (all zeros)
pub fn generate_ephemeral_address(seed: &str) -> Result<String> {
    // Owner is always system program (all zeros) for ephemeral accounts
    let owner_pubkey = [0u8; 32];

    // Convert seed string to hex bytes (addrtool expects hex-encoded seed)
    let seed_bytes =
        hex::decode(seed).map_err(|e| anyhow::anyhow!("Failed to decode hex seed: {}", e))?;

    // Pad or truncate to exactly 32 bytes (matching C implementation)
    let mut seed_32 = [0u8; 32];
    let copy_len = std::cmp::min(seed_bytes.len(), 32);
    seed_32[..copy_len].copy_from_slice(&seed_bytes[..copy_len]);

    // Use the new implementation from tn_public_address
    Ok(
        crate::tn_public_address::create_program_defined_account_address_string(
            &owner_pubkey,
            true, // is_ephemeral = true
            &seed_32,
        ),
    )
}

pub fn generate_system_derived_address(seed: &str, is_ephemeral: bool) -> Result<String> {
    // Convert seed string to hex bytes (addrtool expects hex-encoded seed)
    let seed_bytes =
        hex::decode(seed).map_err(|e| anyhow::anyhow!("Failed to decode hex seed: {}", e))?;

    let pubkey = generate_derived_address(&seed_bytes, &[0u8; 32], is_ephemeral)?;

    Ok(tn_pubkey_to_address_string(&pubkey))
}

pub fn generate_derived_address(
    seed: &[u8],
    owner_pubkey: &[u8; 32],
    is_ephemeral: bool,
) -> Result<[u8; 32]> {
    use sha2::{Digest, Sha256};

    // Create SHA256 hasher
    let mut hasher = Sha256::new();

    // Hash owner pubkey (32 bytes) - system program
    hasher.update(&owner_pubkey);

    // Hash is_ephemeral flag (1 byte)
    hasher.update(&[is_ephemeral as u8]);

    // Hash seed bytes
    hasher.update(&seed);

    // Finalize hash to get 32-byte result
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ephemeral_address_generation() {
        // Test with hex-encoded seeds (as addrtool expects)
        let hex_seed1 = hex::encode("test_seed_123");
        let hex_seed2 = hex::encode("test_seed_123");
        let hex_seed3 = hex::encode("different_seed");

        let addr1 = generate_ephemeral_address(&hex_seed1).unwrap();
        let addr2 = generate_ephemeral_address(&hex_seed2).unwrap();
        let addr3 = generate_ephemeral_address(&hex_seed3).unwrap();

        // Same inputs should produce same address
        assert_eq!(addr1, addr2);

        // Different seeds should produce different addresses
        assert_ne!(addr1, addr3);

        // All addresses should be ta... format
        assert!(addr1.starts_with("ta"));
        assert!(addr2.starts_with("ta"));
        assert!(addr3.starts_with("ta"));

        // All addresses should be 46 characters
        assert_eq!(addr1.len(), 46);
        assert_eq!(addr2.len(), 46);
        assert_eq!(addr3.len(), 46);
    }

    #[test]
    fn test_eoa_transfer_instruction_format() {
        // Test that the transfer instruction matches the EOA program's expected format
        let from_idx = 0u16;
        let to_idx = 2u16;
        let amount = 1000u64;

        let instruction = build_transfer_instruction(from_idx, to_idx, amount).unwrap();

        // Expected format (matching tn_eoa_program.c):
        // - Discriminant: u32 (4 bytes) = 1
        // - Amount: u64 (8 bytes)
        // - From account index: u16 (2 bytes)
        // - To account index: u16 (2 bytes)
        // Total: 16 bytes

        assert_eq!(instruction.len(), 16, "Instruction should be 16 bytes");

        // Check discriminant (TN_EOA_INSTRUCTION_TRANSFER = 1)
        let discriminant = u32::from_le_bytes([
            instruction[0],
            instruction[1],
            instruction[2],
            instruction[3],
        ]);
        assert_eq!(discriminant, 1, "Discriminant should be 1 for TRANSFER");

        // Check amount
        let parsed_amount = u64::from_le_bytes([
            instruction[4],
            instruction[5],
            instruction[6],
            instruction[7],
            instruction[8],
            instruction[9],
            instruction[10],
            instruction[11],
        ]);
        assert_eq!(parsed_amount, amount, "Amount should match input");

        // Check from_account_idx
        let parsed_from = u16::from_le_bytes([instruction[12], instruction[13]]);
        assert_eq!(parsed_from, from_idx, "From index should match input");

        // Check to_account_idx
        let parsed_to = u16::from_le_bytes([instruction[14], instruction[15]]);
        assert_eq!(parsed_to, to_idx, "To index should match input");
    }
}

/// Uploader program instruction discriminants
pub const TN_UPLOADER_PROGRAM_INSTRUCTION_CREATE: u32 = 0x00;
pub const TN_UPLOADER_PROGRAM_INSTRUCTION_WRITE: u32 = 0x01;
pub const TN_UPLOADER_PROGRAM_INSTRUCTION_DESTROY: u32 = 0x02;
pub const TN_UPLOADER_PROGRAM_INSTRUCTION_FINALIZE: u32 = 0x03;

/// Uploader program CREATE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct UploaderCreateArgs {
    pub buffer_account_idx: u16,
    pub meta_account_idx: u16,
    pub authority_account_idx: u16,
    pub buffer_account_sz: u32,
    pub expected_account_hash: [u8; 32],
    pub seed_len: u32,
    // seed bytes follow
}

/// Uploader program WRITE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct UploaderWriteArgs {
    pub buffer_account_idx: u16,
    pub meta_account_idx: u16,
    pub data_len: u32,
    pub data_offset: u32,
    // data bytes follow
}

/// Uploader program FINALIZE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct UploaderFinalizeArgs {
    pub buffer_account_idx: u16,
    pub meta_account_idx: u16,
    pub expected_account_hash: [u8; 32],
}

/// Uploader program DESTROY instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct UploaderDestroyArgs {
    pub buffer_account_idx: u16,
    pub meta_account_idx: u16,
}

/// Manager program instruction discriminants (matches C defines)
pub const MANAGER_INSTRUCTION_CREATE_PERMANENT: u8 = 0x00;
pub const MANAGER_INSTRUCTION_CREATE_EPHEMERAL: u8 = 0x01;
pub const MANAGER_INSTRUCTION_UPGRADE: u8 = 0x02;
pub const MANAGER_INSTRUCTION_SET_PAUSE: u8 = 0x03;
pub const MANAGER_INSTRUCTION_DESTROY: u8 = 0x04;
pub const MANAGER_INSTRUCTION_FINALIZE: u8 = 0x05;
pub const MANAGER_INSTRUCTION_SET_AUTHORITY: u8 = 0x06;
pub const MANAGER_INSTRUCTION_CLAIM_AUTHORITY: u8 = 0x07;

/// Manager program header arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ManagerHeaderArgs {
    pub discriminant: u8,
    pub meta_account_idx: u16,
    pub program_account_idx: u16,
}

/// Manager program CREATE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ManagerCreateArgs {
    pub discriminant: u8,
    pub meta_account_idx: u16,
    pub program_account_idx: u16,
    pub srcbuf_account_idx: u16,
    pub srcbuf_offset: u32,
    pub srcbuf_size: u32,
    pub authority_account_idx: u16,
    pub seed_len: u32,
    // seed bytes and proof bytes follow
}

/// Manager program UPGRADE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ManagerUpgradeArgs {
    pub discriminant: u8,
    pub meta_account_idx: u16,
    pub program_account_idx: u16,
    pub srcbuf_account_idx: u16,
    pub srcbuf_offset: u32,
    pub srcbuf_size: u32,
}

/// Manager program SET_PAUSE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ManagerSetPauseArgs {
    pub discriminant: u8,
    pub meta_account_idx: u16,
    pub program_account_idx: u16,
    pub is_paused: u8,
}

/// Manager program SET_AUTHORITY instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct ManagerSetAuthorityArgs {
    pub discriminant: u8,
    pub meta_account_idx: u16,
    pub program_account_idx: u16,
    pub authority_candidate: [u8; 32],
}

/// Test uploader program instruction discriminants (matches C defines)
pub const TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_CREATE: u8 = 0x00;
pub const TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_WRITE: u8 = 0x01;

/// Test uploader program CREATE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct TestUploaderCreateArgs {
    pub account_idx: u16,
    pub is_ephemeral: u8,
    pub account_sz: u32,
    pub seed_len: u32,
    // seed bytes follow, then optional state proof
}

/// Test uploader program WRITE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct TestUploaderWriteArgs {
    pub target_account_idx: u16,
    pub target_offset: u32,
    pub data_len: u32,
    // data bytes follow
}

/// System program DECOMPRESS2 instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct SystemProgramDecompress2Args {
    pub target_account_idx: u16,
    pub meta_account_idx: u16,
    pub data_account_idx: u16,
    pub data_offset: u32,
}

impl TransactionBuilder {
    /// Build uploader program CREATE transaction
    pub fn build_uploader_create(
        fee_payer: TnPubkey,
        uploader_program: TnPubkey,
        meta_account: TnPubkey,
        buffer_account: TnPubkey,
        buffer_size: u32,
        expected_hash: [u8; 32],
        seed: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: uploader_program, 2: meta_account, 3: buffer_account]
        let authority_account_idx = 0u16;

        let mut tx = Transaction::new(fee_payer, uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10)
            .with_compute_units(50_000 + 2 * buffer_size as u32)
            .with_memory_units(10_000)
            .with_state_units(10_000);

        let mut meta_account_idx = 2u16;
        let mut buffer_account_idx = 3u16;
        if meta_account > buffer_account {
            meta_account_idx = 3u16;
            buffer_account_idx = 2u16;
            tx = tx
                .add_rw_account(buffer_account)
                .add_rw_account(meta_account)
        } else {
            tx = tx
                .add_rw_account(meta_account)
                .add_rw_account(buffer_account)
        }

        let instruction_data = build_uploader_create_instruction(
            buffer_account_idx,
            meta_account_idx,
            authority_account_idx,
            buffer_size,
            expected_hash,
            seed,
        )?;

        tx = tx.with_instructions(instruction_data);

        Ok(tx)
    }

    /// Build uploader program WRITE transaction
    pub fn build_uploader_write(
        fee_payer: TnPubkey,
        uploader_program: TnPubkey,
        meta_account: TnPubkey,
        buffer_account: TnPubkey,
        data: &[u8],
        offset: u32,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: uploader_program, 2: meta_account, 3: buffer_account]
        let mut tx = Transaction::new(fee_payer, uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        let mut meta_account_idx = 2u16;
        let mut buffer_account_idx = 3u16;
        if meta_account > buffer_account {
            meta_account_idx = 3u16;
            buffer_account_idx = 2u16;
            tx = tx
                .add_rw_account(buffer_account)
                .add_rw_account(meta_account)
        } else {
            tx = tx
                .add_rw_account(meta_account)
                .add_rw_account(buffer_account)
        }

        let instruction_data =
            build_uploader_write_instruction(buffer_account_idx, meta_account_idx, data, offset)?;

        tx = tx.with_instructions(instruction_data);

        Ok(tx)
    }

    /// Build uploader program FINALIZE transaction
    pub fn build_uploader_finalize(
        fee_payer: TnPubkey,
        uploader_program: TnPubkey,
        meta_account: TnPubkey,
        buffer_account: TnPubkey,
        buffer_size: u32,
        expected_hash: [u8; 32],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(50_000 + 180 * buffer_size as u32)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Account layout: [0: fee_payer, 1: uploader_program, 2: meta_account, 3: buffer_account]
        let mut meta_account_idx = 2u16;
        let mut buffer_account_idx = 3u16;
        if meta_account > buffer_account {
            meta_account_idx = 3u16;
            buffer_account_idx = 2u16;
            tx = tx
                .add_rw_account(buffer_account)
                .add_rw_account(meta_account)
        } else {
            tx = tx
                .add_rw_account(meta_account)
                .add_rw_account(buffer_account)
        }

        let instruction_data = build_uploader_finalize_instruction(
            buffer_account_idx,
            meta_account_idx,
            expected_hash,
        )?;

        tx = tx.with_instructions(instruction_data);

        Ok(tx)
    }

    /// Build uploader program DESTROY transaction
    pub fn build_uploader_destroy(
        fee_payer: TnPubkey,
        uploader_program: TnPubkey,
        meta_account: TnPubkey,
        buffer_account: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(50000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Account layout: [0: fee_payer, 1: uploader_program, 2: meta_account, 3: buffer_account]
        let mut meta_account_idx = 2u16;
        let mut buffer_account_idx = 3u16;
        if meta_account > buffer_account {
            meta_account_idx = 3u16;
            buffer_account_idx = 2u16;
            tx = tx
                .add_rw_account(buffer_account)
                .add_rw_account(meta_account)
        } else {
            tx = tx
                .add_rw_account(meta_account)
                .add_rw_account(buffer_account)
        }

        let instruction_data =
            build_uploader_destroy_instruction(buffer_account_idx, meta_account_idx)?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build manager program CREATE transaction
    pub fn build_manager_create(
        fee_payer: TnPubkey,
        manager_program: TnPubkey,
        meta_account: TnPubkey,
        program_account: TnPubkey,
        srcbuf_account: TnPubkey,
        authority_account: TnPubkey,
        srcbuf_offset: u32,
        srcbuf_size: u32,
        seed: &[u8],
        is_ephemeral: bool,
        meta_proof: Option<&[u8]>,
        program_proof: Option<&[u8]>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Check if authority_account is the same as fee_payer
        let authority_is_fee_payer = authority_account == fee_payer;

        // Separate accounts by access type and sort each group by pubkey
        let mut rw_accounts = vec![(meta_account, "meta"), (program_account, "program")];

        let mut r_accounts = vec![(srcbuf_account, "srcbuf")];

        // Only add authority_account if it's different from fee_payer
        if !authority_is_fee_payer {
            r_accounts.push((authority_account, "authority"));
        }

        // Sort read-write accounts by pubkey
        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        // Sort read-only accounts by pubkey
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        // Combine sorted accounts: read-write first, then read-only
        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut meta_account_idx = 0u16;
        let mut program_account_idx = 0u16;
        let mut srcbuf_account_idx = 0u16;
        let mut authority_account_idx = if authority_is_fee_payer {
            0u16 // Use fee_payer index (0) when authority is the same as fee_payer
        } else {
            0u16 // Will be set in the loop below
        };

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16; // Skip fee_payer (0) and program (1)
            match *account_type {
                "meta" => {
                    meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "program" => {
                    program_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "srcbuf" => {
                    srcbuf_account_idx = idx;
                    tx = tx.add_r_account(*account);
                }
                "authority" => {
                    authority_account_idx = idx;
                    tx = tx.add_r_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let discriminant = if is_ephemeral {
            MANAGER_INSTRUCTION_CREATE_EPHEMERAL
        } else {
            MANAGER_INSTRUCTION_CREATE_PERMANENT
        };

        // Concatenate proofs if both are provided (for permanent programs)
        let combined_proof = if let (Some(meta), Some(program)) = (meta_proof, program_proof) {
            let mut combined = Vec::with_capacity(meta.len() + program.len());
            combined.extend_from_slice(meta);
            combined.extend_from_slice(program);
            Some(combined)
        } else {
            None
        };

        let instruction_data = build_manager_create_instruction(
            discriminant,
            meta_account_idx,
            program_account_idx,
            srcbuf_account_idx,
            authority_account_idx,
            srcbuf_offset,
            srcbuf_size,
            seed,
            combined_proof.as_deref(),
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build manager program UPGRADE transaction
    pub fn build_manager_upgrade(
        fee_payer: TnPubkey,
        manager_program: TnPubkey,
        meta_account: TnPubkey,
        program_account: TnPubkey,
        srcbuf_account: TnPubkey,
        srcbuf_offset: u32,
        srcbuf_size: u32,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Separate accounts by access type and sort each group by pubkey
        let mut rw_accounts = vec![(meta_account, "meta"), (program_account, "program")];

        let mut r_accounts = vec![(srcbuf_account, "srcbuf")];

        // Sort read-write accounts by pubkey
        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        // Sort read-only accounts by pubkey
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        // Combine sorted accounts: read-write first, then read-only
        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut meta_account_idx = 0u16;
        let mut program_account_idx = 0u16;
        let mut srcbuf_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16; // Skip fee_payer (0) and program (1)
            match *account_type {
                "meta" => {
                    meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "program" => {
                    program_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "srcbuf" => {
                    srcbuf_account_idx = idx;
                    tx = tx.add_r_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let instruction_data = build_manager_upgrade_instruction(
            meta_account_idx,
            program_account_idx,
            srcbuf_account_idx,
            srcbuf_offset,
            srcbuf_size,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build manager program SET_PAUSE transaction
    pub fn build_manager_set_pause(
        fee_payer: TnPubkey,
        manager_program: TnPubkey,
        meta_account: TnPubkey,
        program_account: TnPubkey,
        is_paused: bool,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(100_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Add accounts in sorted order
        let mut accounts = vec![(meta_account, "meta"), (program_account, "program")];
        accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut meta_account_idx = 0u16;
        let mut program_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "program" => {
                    program_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let instruction_data =
            build_manager_set_pause_instruction(meta_account_idx, program_account_idx, is_paused)?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build manager program simple transactions (DESTROY, FINALIZE, CLAIM_AUTHORITY)
    pub fn build_manager_simple(
        fee_payer: TnPubkey,
        manager_program: TnPubkey,
        meta_account: TnPubkey,
        program_account: TnPubkey,
        instruction_type: u8,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(100_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Add accounts in sorted order
        let mut accounts = vec![(meta_account, "meta"), (program_account, "program")];
        accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut meta_account_idx = 0u16;
        let mut program_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "program" => {
                    program_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let instruction_data = build_manager_header_instruction(
            instruction_type,
            meta_account_idx,
            program_account_idx,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build manager program SET_AUTHORITY transaction
    pub fn build_manager_set_authority(
        fee_payer: TnPubkey,
        manager_program: TnPubkey,
        meta_account: TnPubkey,
        program_account: TnPubkey,
        authority_candidate: [u8; 32],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(100_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        // Add accounts in sorted order
        let mut accounts = vec![(meta_account, "meta"), (program_account, "program")];
        accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut meta_account_idx = 0u16;
        let mut program_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "program" => {
                    program_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let instruction_data = build_manager_set_authority_instruction(
            meta_account_idx,
            program_account_idx,
            authority_candidate,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build test uploader program CREATE transaction
    pub fn build_test_uploader_create(
        fee_payer: TnPubkey,
        test_uploader_program: TnPubkey,
        target_account: TnPubkey,
        account_sz: u32,
        seed: &[u8],
        is_ephemeral: bool,
        state_proof: Option<&[u8]>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: test_uploader_program, 2: target_account]
        let target_account_idx = 2u16;

        let tx = Transaction::new(fee_payer, test_uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(100_000 + account_sz)
            .with_memory_units(10_000)
            .with_state_units(10_000)
            .add_rw_account(target_account);

        let instruction_data = build_test_uploader_create_instruction(
            target_account_idx,
            account_sz,
            seed,
            is_ephemeral,
            state_proof,
        )?;

        let tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build test uploader program WRITE transaction
    pub fn build_test_uploader_write(
        fee_payer: TnPubkey,
        test_uploader_program: TnPubkey,
        target_account: TnPubkey,
        offset: u32,
        data: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: test_uploader_program, 2: target_account]
        let target_account_idx = 2u16;

        let tx = Transaction::new(fee_payer, test_uploader_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10_000)
            .with_compute_units(100_000 + 18 * data.len() as u32)
            .with_memory_units(10_000)
            .with_state_units(10_000)
            .add_rw_account(target_account);

        let instruction_data =
            build_test_uploader_write_instruction(target_account_idx, offset, data)?;

        let tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build account decompression transaction using DECOMPRESS2 (separate meta and data accounts)
    pub fn build_decompress2(
        fee_payer: TnPubkey,
        program: TnPubkey,
        target_account: TnPubkey,
        meta_account: TnPubkey,
        data_account: TnPubkey,
        data_offset: u32,
        state_proof: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
        data_sz: u32,
    ) -> Result<Transaction> {
        // Account layout: [0: fee_payer, 1: program, 2: target_account, 3+: meta/data accounts]
        let mut tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(10_000 + 2 * data_sz)
            .with_memory_units(10_000)
            .with_state_units(10);

        // Add target account (read-write)
        let target_account_idx = 2u16;
        tx = tx.add_rw_account(target_account);

        let mut meta_account_idx = 0u16;
        let mut data_account_idx = 0u16;

        // Handle meta and data accounts - if they're the same, add only once; if different, add both and sort
        if meta_account == data_account {
            // Same account for both meta and data
            let account_idx = 3u16;
            meta_account_idx = account_idx;
            data_account_idx = account_idx;
            tx = tx.add_r_account(meta_account);
        } else {
            // Different accounts - add both and sort by pubkey
            let mut read_accounts = vec![(meta_account, "meta"), (data_account, "data")];
            read_accounts.sort_by(|a, b| a.0.cmp(&b.0));

            for (i, (account, account_type)) in read_accounts.iter().enumerate() {
                let idx = (3 + i) as u16; // Start from index 3
                match *account_type {
                    "meta" => {
                        meta_account_idx = idx;
                        tx = tx.add_r_account(*account);
                    }
                    "data" => {
                        data_account_idx = idx;
                        tx = tx.add_r_account(*account);
                    }
                    _ => unreachable!(),
                }
            }
        }

        let instruction_data = build_decompress2_instruction(
            target_account_idx,
            meta_account_idx,
            data_account_idx,
            data_offset,
            state_proof,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }
}

/// Build uploader CREATE instruction data
fn build_uploader_create_instruction(
    buffer_account_idx: u16,
    meta_account_idx: u16,
    authority_account_idx: u16,
    buffer_size: u32,
    expected_hash: [u8; 32],
    seed: &[u8],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (4 bytes, little-endian)
    instruction.extend_from_slice(&TN_UPLOADER_PROGRAM_INSTRUCTION_CREATE.to_le_bytes());

    // Create args struct
    let args = UploaderCreateArgs {
        buffer_account_idx,
        meta_account_idx,
        authority_account_idx,
        buffer_account_sz: buffer_size,
        expected_account_hash: expected_hash,
        seed_len: seed.len() as u32,
    };

    // Serialize args (unsafe due to packed struct)
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<UploaderCreateArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Append seed bytes
    instruction.extend_from_slice(seed);

    Ok(instruction)
}

/// Build uploader WRITE instruction data
fn build_uploader_write_instruction(
    buffer_account_idx: u16,
    meta_account_idx: u16,
    data: &[u8],
    offset: u32,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (4 bytes, little-endian)
    instruction.extend_from_slice(&TN_UPLOADER_PROGRAM_INSTRUCTION_WRITE.to_le_bytes());

    // Write args
    let args = UploaderWriteArgs {
        buffer_account_idx,
        meta_account_idx,
        data_len: data.len() as u32,
        data_offset: offset,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<UploaderWriteArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Append data
    instruction.extend_from_slice(data);

    Ok(instruction)
}

/// Build uploader FINALIZE instruction data
fn build_uploader_finalize_instruction(
    buffer_account_idx: u16,
    meta_account_idx: u16,
    expected_hash: [u8; 32],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (4 bytes, little-endian)
    instruction.extend_from_slice(&TN_UPLOADER_PROGRAM_INSTRUCTION_FINALIZE.to_le_bytes());

    // Finalize args
    let args = UploaderFinalizeArgs {
        buffer_account_idx,
        meta_account_idx,
        expected_account_hash: expected_hash,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<UploaderFinalizeArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build uploader DESTROY instruction data
fn build_uploader_destroy_instruction(
    buffer_account_idx: u16,
    meta_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (4 bytes, little-endian)
    instruction.extend_from_slice(&TN_UPLOADER_PROGRAM_INSTRUCTION_DESTROY.to_le_bytes());

    // Destroy args
    let args = UploaderDestroyArgs {
        buffer_account_idx,
        meta_account_idx,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<UploaderDestroyArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build manager CREATE instruction data
fn build_manager_create_instruction(
    discriminant: u8,
    meta_account_idx: u16,
    program_account_idx: u16,
    srcbuf_account_idx: u16,
    authority_account_idx: u16,
    srcbuf_offset: u32,
    srcbuf_size: u32,
    seed: &[u8],
    proof: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Create args
    let args = ManagerCreateArgs {
        discriminant,
        meta_account_idx,
        program_account_idx,
        srcbuf_account_idx,
        srcbuf_offset,
        srcbuf_size,
        authority_account_idx,
        seed_len: seed.len() as u32,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const ManagerCreateArgs as *const u8,
            std::mem::size_of::<ManagerCreateArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Add seed bytes
    instruction.extend_from_slice(seed);

    // Add proof bytes (only for permanent accounts)
    if let Some(proof_bytes) = proof {
        instruction.extend_from_slice(proof_bytes);
    }

    Ok(instruction)
}

/// Build manager UPGRADE instruction data
fn build_manager_upgrade_instruction(
    meta_account_idx: u16,
    program_account_idx: u16,
    srcbuf_account_idx: u16,
    srcbuf_offset: u32,
    srcbuf_size: u32,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    let args = ManagerUpgradeArgs {
        discriminant: MANAGER_INSTRUCTION_UPGRADE,
        meta_account_idx,
        program_account_idx,
        srcbuf_account_idx,
        srcbuf_offset,
        srcbuf_size,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const ManagerUpgradeArgs as *const u8,
            std::mem::size_of::<ManagerUpgradeArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build manager SET_PAUSE instruction data
fn build_manager_set_pause_instruction(
    meta_account_idx: u16,
    program_account_idx: u16,
    is_paused: bool,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    let args = ManagerSetPauseArgs {
        discriminant: MANAGER_INSTRUCTION_SET_PAUSE,
        meta_account_idx,
        program_account_idx,
        is_paused: if is_paused { 1 } else { 0 },
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const ManagerSetPauseArgs as *const u8,
            std::mem::size_of::<ManagerSetPauseArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build manager header-only instruction data (DESTROY, FINALIZE, CLAIM_AUTHORITY)
fn build_manager_header_instruction(
    discriminant: u8,
    meta_account_idx: u16,
    program_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    let args = ManagerHeaderArgs {
        discriminant,
        meta_account_idx,
        program_account_idx,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const ManagerHeaderArgs as *const u8,
            std::mem::size_of::<ManagerHeaderArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build manager SET_AUTHORITY instruction data
fn build_manager_set_authority_instruction(
    meta_account_idx: u16,
    program_account_idx: u16,
    authority_candidate: [u8; 32],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    let args = ManagerSetAuthorityArgs {
        discriminant: MANAGER_INSTRUCTION_SET_AUTHORITY,
        meta_account_idx,
        program_account_idx,
        authority_candidate,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const ManagerSetAuthorityArgs as *const u8,
            std::mem::size_of::<ManagerSetAuthorityArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    Ok(instruction)
}

/// Build test uploader CREATE instruction data
fn build_test_uploader_create_instruction(
    account_idx: u16,
    account_sz: u32,
    seed: &[u8],
    is_ephemeral: bool,
    state_proof: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (1 byte)
    instruction.push(TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_CREATE);

    // Create args struct
    let args = TestUploaderCreateArgs {
        account_idx,
        is_ephemeral: if is_ephemeral { 1u8 } else { 0u8 },
        account_sz,
        seed_len: seed.len() as u32,
    };

    // Serialize args (unsafe due to packed struct)
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<TestUploaderCreateArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Append seed bytes
    instruction.extend_from_slice(seed);

    // Append state proof if provided (for non-ephemeral accounts)
    if let Some(proof) = state_proof {
        instruction.extend_from_slice(proof);
    }

    Ok(instruction)
}

/// Build test uploader WRITE instruction data
fn build_test_uploader_write_instruction(
    target_account_idx: u16,
    target_offset: u32,
    data: &[u8],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (1 byte)
    instruction.push(TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_WRITE);

    // Write args
    let args = TestUploaderWriteArgs {
        target_account_idx,
        target_offset,
        data_len: data.len() as u32,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<TestUploaderWriteArgs>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Append data
    instruction.extend_from_slice(data);

    Ok(instruction)
}

/// Build system program DECOMPRESS2 instruction data
pub fn build_decompress2_instruction(
    target_account_idx: u16,
    meta_account_idx: u16,
    data_account_idx: u16,
    data_offset: u32,
    state_proof: &[u8],
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Discriminant (1 byte) - TN_SYS_PROG_DISCRIMINANT_ACCOUNT_DECOMPRESS2 = 0x08
    instruction.push(0x08);

    // DECOMPRESS2 args
    let args = SystemProgramDecompress2Args {
        target_account_idx,
        meta_account_idx,
        data_account_idx,
        data_offset,
    };

    // Serialize args
    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<SystemProgramDecompress2Args>(),
        )
    };
    instruction.extend_from_slice(args_bytes);

    // Append state proof bytes
    instruction.extend_from_slice(state_proof);

    Ok(instruction)
}

/// Token program instruction discriminants
pub const TOKEN_INSTRUCTION_INITIALIZE_MINT: u8 = 0x00;
pub const TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT: u8 = 0x01;
pub const TOKEN_INSTRUCTION_TRANSFER: u8 = 0x02;
pub const TOKEN_INSTRUCTION_MINT_TO: u8 = 0x03;
pub const TOKEN_INSTRUCTION_BURN: u8 = 0x04;
pub const TOKEN_INSTRUCTION_CLOSE_ACCOUNT: u8 = 0x05;
pub const TOKEN_INSTRUCTION_FREEZE_ACCOUNT: u8 = 0x06;
pub const TOKEN_INSTRUCTION_THAW_ACCOUNT: u8 = 0x07;

/// Helper function to add sorted accounts and return their indices
fn add_sorted_accounts(tx: Transaction, accounts: &[(TnPubkey, bool)]) -> (Transaction, Vec<u16>) {
    let mut sorted_accounts: Vec<_> = accounts.iter().enumerate().collect();
    sorted_accounts.sort_by(|a, b| a.1.0.cmp(&b.1.0));

    let mut updated_tx = tx;
    let mut indices = vec![0u16; accounts.len()];

    for (original_idx, (i, (account, writable))) in sorted_accounts.iter().enumerate() {
        let account_idx = (original_idx + 2) as u16; // Skip fee_payer(0) and program(1)
        indices[*i] = account_idx;

        if *writable {
            updated_tx = updated_tx.add_rw_account(*account);
        } else {
            updated_tx = updated_tx.add_r_account(*account);
        }
    }

    (updated_tx, indices)
}

/// Helper function to get authority index (0 if fee_payer, else add as readonly)
fn add_sorted_rw_accounts(mut tx: Transaction, accounts: &[TnPubkey]) -> (Transaction, Vec<u16>) {
    if accounts.is_empty() {
        return (tx, Vec::new());
    }

    let mut sorted: Vec<(usize, TnPubkey)> = accounts.iter().cloned().enumerate().collect();
    sorted.sort_by(|a, b| a.1.cmp(&b.1));

    let mut indices = vec![0u16; accounts.len()];
    for (pos, (orig_idx, account)) in sorted.into_iter().enumerate() {
        let idx = (2 + pos) as u16;
        indices[orig_idx] = idx;
        tx = tx.add_rw_account(account);
    }

    (tx, indices)
}

fn add_sorted_ro_accounts(
    mut tx: Transaction,
    base_idx: u16,
    accounts: &[TnPubkey],
) -> (Transaction, Vec<u16>) {
    if accounts.is_empty() {
        return (tx, Vec::new());
    }

    let mut sorted: Vec<(usize, TnPubkey)> = accounts.iter().cloned().enumerate().collect();
    sorted.sort_by(|a, b| a.1.cmp(&b.1));

    let mut indices = vec![0u16; accounts.len()];
    for (pos, (orig_idx, account)) in sorted.into_iter().enumerate() {
        let idx = base_idx + pos as u16;
        indices[orig_idx] = idx;
        tx = tx.add_r_account(account);
    }

    (tx, indices)
}

impl TransactionBuilder {
    /// Build token program InitializeMint transaction
    pub fn build_token_initialize_mint(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        mint_account: TnPubkey,
        mint_authority: TnPubkey,
        freeze_authority: Option<TnPubkey>,
        decimals: u8,
        ticker: &str,
        seed: [u8; 32],
        state_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx =
            Transaction::new(fee_payer, token_program, fee, nonce).with_start_slot(start_slot);
        let (tx, indices) = add_sorted_rw_accounts(base_tx, &[mint_account]);
        let mint_account_idx = indices[0];

        let instruction_data = build_token_initialize_mint_instruction(
            mint_account_idx,
            decimals,
            mint_authority,
            freeze_authority,
            ticker,
            seed,
            state_proof,
        )?;

        let tx = tx
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        Ok(tx)
    }

    /// Build token program InitializeAccount transaction
    pub fn build_token_initialize_account(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        token_account: TnPubkey,
        mint_account: TnPubkey,
        owner: TnPubkey,
        seed: [u8; 32],
        state_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let owner_is_fee_payer = owner == fee_payer;

        let mut rw_accounts = vec![token_account];
        rw_accounts.sort();

        let mut ro_accounts = vec![mint_account];
        if !owner_is_fee_payer {
            ro_accounts.push(owner);
            ro_accounts.sort();
        }

        let mut tx =
            Transaction::new(fee_payer, token_program, fee, nonce).with_start_slot(start_slot);

        let mut token_account_idx = 0u16;
        for (i, account) in rw_accounts.iter().enumerate() {
            let idx = (2 + i) as u16;
            if *account == token_account {
                token_account_idx = idx;
            }
            tx = tx.add_rw_account(*account);
        }

        let base_ro_idx = 2 + rw_accounts.len() as u16;
        let mut mint_account_idx = 0u16;
        let mut owner_account_idx = if owner_is_fee_payer { 0u16 } else { 0u16 };
        for (i, account) in ro_accounts.iter().enumerate() {
            let idx = base_ro_idx + i as u16;
            if *account == mint_account {
                mint_account_idx = idx;
            } else if !owner_is_fee_payer && *account == owner {
                owner_account_idx = idx;
            }
            tx = tx.add_r_account(*account);
        }

        let instruction_data = build_token_initialize_account_instruction(
            token_account_idx,
            mint_account_idx,
            owner_account_idx,
            seed,
            state_proof,
        )?;

        let tx = tx
            .with_instructions(instruction_data)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        Ok(tx)
    }

    /// Build token program Transfer transaction
    pub fn build_token_transfer(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        source_account: TnPubkey,
        dest_account: TnPubkey,
        _authority: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let is_self_transfer = source_account == dest_account;
        let (source_account_idx, dest_account_idx) = if is_self_transfer {
            // For self-transfers, add the account only once and use same index
            tx = tx.add_rw_account(source_account);
            (2u16, 2u16)
        } else {
            // Add source and dest accounts in sorted order
            let accounts = &[(source_account, true), (dest_account, true)];
            let (updated_tx, indices) = add_sorted_accounts(tx, accounts);
            tx = updated_tx;
            (indices[0], indices[1])
        };

        // Note: For transfers, the authority (source account owner) must sign the transaction
        // The token program will verify the signature matches the source account owner

        let instruction_data =
            build_token_transfer_instruction(source_account_idx, dest_account_idx, amount)?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build token program MintTo transaction
    pub fn build_token_mint_to(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        mint_account: TnPubkey,
        dest_account: TnPubkey,
        authority: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let (tx_after_rw, rw_indices) =
            add_sorted_rw_accounts(base_tx, &[mint_account, dest_account]);
        let mint_account_idx = rw_indices[0];
        let dest_account_idx = rw_indices[1];

        let mut tx = tx_after_rw;
        let authority_account_idx = if authority == fee_payer {
            0u16
        } else {
            let base_ro_idx = 2 + rw_indices.len() as u16;
            let (tx_after_ro, ro_indices) = add_sorted_ro_accounts(tx, base_ro_idx, &[authority]);
            tx = tx_after_ro;
            ro_indices[0]
        };

        let instruction_data = build_token_mint_to_instruction(
            mint_account_idx,
            dest_account_idx,
            authority_account_idx,
            amount,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build token program Burn transaction
    pub fn build_token_burn(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        token_account: TnPubkey,
        mint_account: TnPubkey,
        authority: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let (tx_after_rw, rw_indices) =
            add_sorted_rw_accounts(base_tx, &[token_account, mint_account]);
        let token_account_idx = rw_indices[0];
        let mint_account_idx = rw_indices[1];

        let mut tx = tx_after_rw;
        let authority_account_idx = if authority == fee_payer {
            0u16
        } else {
            let base_ro_idx = 2 + rw_indices.len() as u16;
            let (tx_after_ro, ro_indices) = add_sorted_ro_accounts(tx, base_ro_idx, &[authority]);
            tx = tx_after_ro;
            ro_indices[0]
        };

        let instruction_data = build_token_burn_instruction(
            token_account_idx,
            mint_account_idx,
            authority_account_idx,
            amount,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build token program FreezeAccount transaction
    pub fn build_token_freeze_account(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        token_account: TnPubkey,
        mint_account: TnPubkey,
        authority: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let (tx_after_rw, rw_indices) =
            add_sorted_rw_accounts(base_tx, &[token_account, mint_account]);
        let token_account_idx = rw_indices[0];
        let mint_account_idx = rw_indices[1];

        let mut tx = tx_after_rw;
        let authority_account_idx = if authority == fee_payer {
            0u16
        } else {
            let base_ro_idx = 2 + rw_indices.len() as u16;
            let (tx_after_ro, ro_indices) = add_sorted_ro_accounts(tx, base_ro_idx, &[authority]);
            tx = tx_after_ro;
            ro_indices[0]
        };

        let instruction_data = build_token_freeze_account_instruction(
            token_account_idx,
            mint_account_idx,
            authority_account_idx,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build token program ThawAccount transaction
    pub fn build_token_thaw_account(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        token_account: TnPubkey,
        mint_account: TnPubkey,
        authority: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let (tx_after_rw, rw_indices) =
            add_sorted_rw_accounts(base_tx, &[token_account, mint_account]);
        let token_account_idx = rw_indices[0];
        let mint_account_idx = rw_indices[1];

        let mut tx = tx_after_rw;
        let authority_account_idx = if authority == fee_payer {
            0u16
        } else {
            let base_ro_idx = 2 + rw_indices.len() as u16;
            let (tx_after_ro, ro_indices) = add_sorted_ro_accounts(tx, base_ro_idx, &[authority]);
            tx = tx_after_ro;
            ro_indices[0]
        };

        let instruction_data = build_token_thaw_account_instruction(
            token_account_idx,
            mint_account_idx,
            authority_account_idx,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build token program CloseAccount transaction
    pub fn build_token_close_account(
        fee_payer: TnPubkey,
        token_program: TnPubkey,
        token_account: TnPubkey,
        destination: TnPubkey,
        authority: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let base_tx = Transaction::new(fee_payer, token_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let mut rw_accounts = vec![token_account];
        let destination_in_accounts = destination != fee_payer;
        if destination_in_accounts {
            rw_accounts.push(destination);
        }

        let (tx_after_rw, rw_indices) = add_sorted_rw_accounts(base_tx, &rw_accounts);
        let token_account_idx = rw_indices[0];
        let destination_idx = if destination_in_accounts {
            rw_indices[1]
        } else {
            0u16
        };

        let mut tx = tx_after_rw;
        let authority_account_idx = if authority == fee_payer {
            0u16
        } else {
            let base_ro_idx = 2 + rw_indices.len() as u16;
            let (tx_after_ro, ro_indices) = add_sorted_ro_accounts(tx, base_ro_idx, &[authority]);
            tx = tx_after_ro;
            ro_indices[0]
        };

        let instruction_data = build_token_close_account_instruction(
            token_account_idx,
            destination_idx,
            authority_account_idx,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }
}

/// Build token InitializeMint instruction data
fn build_token_initialize_mint_instruction(
    mint_account_idx: u16,
    decimals: u8,
    mint_authority: TnPubkey,
    freeze_authority: Option<TnPubkey>,
    ticker: &str,
    seed: [u8; 32],
    state_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_INITIALIZE_MINT);

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // decimals (u8)
    instruction_data.push(decimals);

    // mint_authority (32 bytes)
    instruction_data.extend_from_slice(&mint_authority);

    // freeze_authority (32 bytes) and has_freeze_authority flag
    let (freeze_auth, has_freeze_auth) = match freeze_authority {
        Some(auth) => (auth, 1u8),
        None => ([0u8; 32], 0u8),
    };
    instruction_data.extend_from_slice(&freeze_auth);
    instruction_data.push(has_freeze_auth);

    // ticker_len and ticker_bytes (max 8 bytes)
    let ticker_bytes = ticker.as_bytes();
    if ticker_bytes.len() > 8 {
        return Err(anyhow::anyhow!("Ticker must be 8 characters or less"));
    }

    instruction_data.push(ticker_bytes.len() as u8);
    let mut ticker_padded = [0u8; 8];
    ticker_padded[..ticker_bytes.len()].copy_from_slice(ticker_bytes);
    instruction_data.extend_from_slice(&ticker_padded);

    // seed (32 bytes)
    instruction_data.extend_from_slice(&seed);

    // state proof (variable length)
    instruction_data.extend_from_slice(&state_proof);

    Ok(instruction_data)
}

/// Build token InitializeAccount instruction data
fn build_token_initialize_account_instruction(
    token_account_idx: u16,
    mint_account_idx: u16,
    owner_account_idx: u16,
    seed: [u8; 32],
    state_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT);

    // token_account_index (u16)
    instruction_data.extend_from_slice(&token_account_idx.to_le_bytes());

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // owner_account_index (u16)
    instruction_data.extend_from_slice(&owner_account_idx.to_le_bytes());

    // seed (32 bytes)
    instruction_data.extend_from_slice(&seed);

    // state proof (variable length)
    instruction_data.extend_from_slice(&state_proof);

    Ok(instruction_data)
}

/// Build token Transfer instruction data
fn build_token_transfer_instruction(
    source_account_idx: u16,
    dest_account_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_TRANSFER);

    // source_account_index (u16)
    instruction_data.extend_from_slice(&source_account_idx.to_le_bytes());

    // dest_account_index (u16)
    instruction_data.extend_from_slice(&dest_account_idx.to_le_bytes());

    // amount (u64)
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

/// Build token MintTo instruction data
fn build_token_mint_to_instruction(
    mint_account_idx: u16,
    dest_account_idx: u16,
    authority_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_MINT_TO);

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // dest_account_index (u16)
    instruction_data.extend_from_slice(&dest_account_idx.to_le_bytes());

    // authority_index (u16)
    instruction_data.extend_from_slice(&authority_idx.to_le_bytes());

    // amount (u64)
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

/// Build token Burn instruction data
fn build_token_burn_instruction(
    token_account_idx: u16,
    mint_account_idx: u16,
    authority_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_BURN);

    // token_account_index (u16)
    instruction_data.extend_from_slice(&token_account_idx.to_le_bytes());

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // authority_index (u16)
    instruction_data.extend_from_slice(&authority_idx.to_le_bytes());

    // amount (u64)
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

/// Build token FreezeAccount instruction data
fn build_token_freeze_account_instruction(
    token_account_idx: u16,
    mint_account_idx: u16,
    authority_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_FREEZE_ACCOUNT);

    // token_account_index (u16)
    instruction_data.extend_from_slice(&token_account_idx.to_le_bytes());

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // authority_index (u16)
    instruction_data.extend_from_slice(&authority_idx.to_le_bytes());

    Ok(instruction_data)
}

/// Build token ThawAccount instruction data
fn build_token_thaw_account_instruction(
    token_account_idx: u16,
    mint_account_idx: u16,
    authority_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_THAW_ACCOUNT);

    // token_account_index (u16)
    instruction_data.extend_from_slice(&token_account_idx.to_le_bytes());

    // mint_account_index (u16)
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());

    // authority_index (u16)
    instruction_data.extend_from_slice(&authority_idx.to_le_bytes());

    Ok(instruction_data)
}

/// Build token CloseAccount instruction data
fn build_token_close_account_instruction(
    token_account_idx: u16,
    destination_idx: u16,
    authority_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Instruction tag
    instruction_data.push(TOKEN_INSTRUCTION_CLOSE_ACCOUNT);

    // token_account_index (u16)
    instruction_data.extend_from_slice(&token_account_idx.to_le_bytes());

    // destination_index (u16)
    instruction_data.extend_from_slice(&destination_idx.to_le_bytes());

    // authority_index (u16)
    instruction_data.extend_from_slice(&authority_idx.to_le_bytes());

    Ok(instruction_data)
}
