use crate::{
    StateProof,
    tn_public_address::tn_pubkey_to_address_string,
    txn_lib::{TnPubkey, Transaction},
};
use anyhow::Result;
use hex;
use std::collections::HashMap;

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
pub const FAUCET_PROGRAM: [u8; 32] = {
    let mut arr = [0u8; 32];
    arr[31] = 0xFA;
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

    #[test]
    fn test_faucet_deposit_instruction_layout_with_fee_payer_depositor() {
        let fee_payer = [1u8; 32];
        let faucet_program = FAUCET_PROGRAM;
        let faucet_account = [2u8; 32];
        let depositor_account = fee_payer;
        let amount = 500u64;

        let tx = TransactionBuilder::build_faucet_deposit(
            fee_payer,
            faucet_program,
            faucet_account,
            depositor_account,
            EOA_PROGRAM,
            amount,
            0,
            42,
            100,
        )
        .expect("build faucet deposit");

        let rw_accs = tx.rw_accs.expect("rw accounts must exist");
        assert_eq!(rw_accs.len(), 1);
        assert_eq!(rw_accs[0], faucet_account);

        let ro_accs = tx.r_accs.expect("ro accounts must exist");
        assert_eq!(ro_accs.len(), 1);
        assert_eq!(ro_accs[0], EOA_PROGRAM);

        let instruction = tx.instructions.expect("instruction bytes must exist");
        assert_eq!(instruction.len(), 18, "Deposit instruction must be 18 bytes");

        let discriminant =
            u32::from_le_bytes([instruction[0], instruction[1], instruction[2], instruction[3]]);
        assert_eq!(discriminant, 0, "Deposit discriminant should be 0");

        let faucet_idx = u16::from_le_bytes([instruction[4], instruction[5]]);
        let depositor_idx = u16::from_le_bytes([instruction[6], instruction[7]]);
        let eoa_idx = u16::from_le_bytes([instruction[8], instruction[9]]);
        let parsed_amount = u64::from_le_bytes([
            instruction[10],
            instruction[11],
            instruction[12],
            instruction[13],
            instruction[14],
            instruction[15],
            instruction[16],
            instruction[17],
        ]);

        assert_eq!(faucet_idx, 2, "Faucet account should be first RW account");
        assert_eq!(depositor_idx, 0, "Depositor shares the fee payer index");
        assert_eq!(eoa_idx, 3, "EOA program should follow RW accounts");
        assert_eq!(parsed_amount, amount, "Amount should match input");
    }

    #[test]
    fn test_build_token_initialize_mint() {
        // Create test keypairs and addresses
        let fee_payer = [1u8; 32];
        let token_program = [2u8; 32];
        let mint_account = [3u8; 32];
        let creator = [4u8; 32];
        let mint_authority = [5u8; 32];
        let freeze_authority = [6u8; 32];

        let decimals = 9u8;
        let ticker = "TEST";
        let seed = [7u8; 32];
        let state_proof = vec![8u8; 64];

        // Test with freeze authority
        let result = TransactionBuilder::build_token_initialize_mint(
            fee_payer,
            token_program,
            mint_account,
            creator,
            mint_authority,
            Some(freeze_authority),
            decimals,
            ticker,
            seed,
            state_proof.clone(),
            1000, // fee
            1,    // nonce
            100,  // start_slot
        );

        assert!(result.is_ok(), "Should build valid transaction with freeze authority");
        let tx = result.unwrap();
        assert!(tx.instructions.is_some(), "Transaction should have instructions");

        // Test without freeze authority
        let result_no_freeze = TransactionBuilder::build_token_initialize_mint(
            fee_payer,
            token_program,
            mint_account,
            creator,
            mint_authority,
            None,
            decimals,
            ticker,
            seed,
            state_proof,
            1000,
            1,
            100,
        );

        assert!(result_no_freeze.is_ok(), "Should build valid transaction without freeze authority");
    }

    #[test]
    fn test_build_token_initialize_mint_instruction_format() {
        let mint_account_idx = 2u16;
        let decimals = 9u8;
        let creator = [1u8; 32];
        let mint_authority = [2u8; 32];
        let freeze_authority = [3u8; 32];
        let ticker = "TST";
        let seed = [4u8; 32];
        let state_proof = vec![5u8; 10];

        let instruction = build_token_initialize_mint_instruction(
            mint_account_idx,
            decimals,
            creator,
            mint_authority,
            Some(freeze_authority),
            ticker,
            seed,
            state_proof.clone(),
        )
        .unwrap();

        // Verify instruction structure
        // Tag (1) + mint_account_idx (2) + decimals (1) + creator (32) + mint_authority (32) + 
        // freeze_authority (32) + has_freeze_authority (1) + ticker_len (1) + ticker_bytes (8) + seed (32) + proof
        let expected_min_size = 1 + 2 + 1 + 32 + 32 + 32 + 1 + 1 + 8 + 32 + state_proof.len();
        assert_eq!(instruction.len(), expected_min_size);

        // Verify tag
        assert_eq!(instruction[0], 0, "First byte should be InitializeMint tag (0)");

        // Verify mint account index
        let parsed_idx = u16::from_le_bytes([instruction[1], instruction[2]]);
        assert_eq!(parsed_idx, mint_account_idx);

        // Verify decimals
        assert_eq!(instruction[3], decimals);

        // Verify creator is at correct position (bytes 4-35)
        assert_eq!(&instruction[4..36], &creator);

        // Verify mint_authority is at correct position (bytes 36-67)
        assert_eq!(&instruction[36..68], &mint_authority);

        // Verify freeze_authority is at correct position (bytes 68-99)
        assert_eq!(&instruction[68..100], &freeze_authority);

        // Verify has_freeze_authority flag
        assert_eq!(instruction[100], 1);
    }

    #[test]
    fn test_token_initialize_mint_creator_vs_mint_authority() {
        // Test that creator and mint_authority can be different
        let fee_payer = [1u8; 32];
        let token_program = [2u8; 32];
        let mint_account = [3u8; 32];
        let creator = [4u8; 32];
        let mint_authority = [5u8; 32]; // Different from creator
        let seed = [6u8; 32];
        let state_proof = vec![7u8; 32];

        let result = TransactionBuilder::build_token_initialize_mint(
            fee_payer,
            token_program,
            mint_account,
            creator,
            mint_authority,
            None,
            9,
            "TEST",
            seed,
            state_proof,
            1000,
            1,
            100,
        );

        assert!(result.is_ok(), "Should allow different creator and mint_authority");

        // Test that creator and mint_authority can be the same
        let result_same = TransactionBuilder::build_token_initialize_mint(
            fee_payer,
            token_program,
            mint_account,
            creator,
            creator, // Same as creator
            None,
            9,
            "TEST",
            seed,
            vec![7u8; 32],
            1000,
            1,
            100,
        );

        assert!(result_same.is_ok(), "Should allow same creator and mint_authority");
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

pub const ABI_MANAGER_INSTRUCTION_CREATE_PERMANENT: u8 = 0x00;
pub const ABI_MANAGER_INSTRUCTION_CREATE_EPHEMERAL: u8 = 0x01;
pub const ABI_MANAGER_INSTRUCTION_UPGRADE: u8 = 0x02;
pub const ABI_MANAGER_INSTRUCTION_CLOSE: u8 = 0x03;
pub const ABI_MANAGER_INSTRUCTION_FINALIZE: u8 = 0x04;

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

/// ABI manager program CREATE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AbiManagerCreateArgs {
    pub program_meta_account_idx: u16,
    pub abi_account_idx: u16,
    pub srcbuf_account_idx: u16,
    pub srcbuf_offset: u32,
    pub srcbuf_size: u32,
    pub authority_account_idx: u16,
    pub seed: [u8; 32],  // Fixed 32-byte seed
}

/// ABI manager program UPGRADE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AbiManagerUpgradeArgs {
    pub program_meta_account_idx: u16,
    pub abi_account_idx: u16,
    pub srcbuf_account_idx: u16,
    pub srcbuf_offset: u32,
    pub srcbuf_size: u32,
    pub authority_account_idx: u16,
}

/// ABI manager program FINALIZE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AbiManagerFinalizeArgs {
    pub program_meta_account_idx: u16,
    pub abi_account_idx: u16,
    pub authority_account_idx: u16,
}

/// ABI manager program CLOSE instruction arguments (matches C struct)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct AbiManagerCloseArgs {
    pub program_meta_account_idx: u16,
    pub abi_account_idx: u16,
    pub authority_account_idx: u16,
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
            .with_compute_units(50_000 + 200 * buffer_size as u32)
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

    /// Build ABI manager program CREATE transaction
    #[allow(clippy::too_many_arguments)]
    pub fn build_abi_manager_create(
        fee_payer: TnPubkey,
        abi_manager_program: TnPubkey,
        program_meta_account: TnPubkey,
        abi_account: TnPubkey,
        srcbuf_account: TnPubkey,
        authority_account: TnPubkey,
        srcbuf_offset: u32,
        srcbuf_size: u32,
        seed: &[u8],
        is_ephemeral: bool,
        abi_proof: Option<&[u8]>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, abi_manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        let authority_is_fee_payer = authority_account == fee_payer;

        let mut rw_accounts = vec![(program_meta_account, "meta"), (abi_account, "abi")];

        let mut r_accounts = vec![(srcbuf_account, "srcbuf")];

        if !authority_is_fee_payer {
            r_accounts.push((authority_account, "authority"));
        }

        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut program_meta_account_idx = 0u16;
        let mut abi_account_idx = 0u16;
        let mut srcbuf_account_idx = 0u16;
        let mut authority_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    program_meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "abi" => {
                    abi_account_idx = idx;
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
            ABI_MANAGER_INSTRUCTION_CREATE_EPHEMERAL
        } else {
            ABI_MANAGER_INSTRUCTION_CREATE_PERMANENT
        };

        let instruction_data = build_abi_manager_create_instruction(
            discriminant,
            program_meta_account_idx,
            abi_account_idx,
            srcbuf_account_idx,
            srcbuf_offset,
            srcbuf_size,
            authority_account_idx,
            seed,
            abi_proof,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build ABI manager program UPGRADE transaction
    #[allow(clippy::too_many_arguments)]
    pub fn build_abi_manager_upgrade(
        fee_payer: TnPubkey,
        abi_manager_program: TnPubkey,
        program_meta_account: TnPubkey,
        abi_account: TnPubkey,
        srcbuf_account: TnPubkey,
        authority_account: TnPubkey,
        srcbuf_offset: u32,
        srcbuf_size: u32,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, abi_manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        let authority_is_fee_payer = authority_account == fee_payer;

        let mut rw_accounts = vec![(program_meta_account, "meta"), (abi_account, "abi")];
        let mut r_accounts = vec![(srcbuf_account, "srcbuf")];

        if !authority_is_fee_payer {
            r_accounts.push((authority_account, "authority"));
        }

        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut program_meta_account_idx = 0u16;
        let mut abi_account_idx = 0u16;
        let mut srcbuf_account_idx = 0u16;
        let mut authority_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    program_meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "abi" => {
                    abi_account_idx = idx;
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

        let authority_idx = if authority_is_fee_payer {
            0u16
        } else {
            authority_account_idx
        };

        let instruction_data = build_abi_manager_upgrade_instruction(
            program_meta_account_idx,
            abi_account_idx,
            srcbuf_account_idx,
            srcbuf_offset,
            srcbuf_size,
            authority_idx,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build ABI manager program FINALIZE transaction
    pub fn build_abi_manager_finalize(
        fee_payer: TnPubkey,
        abi_manager_program: TnPubkey,
        program_meta_account: TnPubkey,
        abi_account: TnPubkey,
        authority_account: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, abi_manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        let authority_is_fee_payer = authority_account == fee_payer;

        let mut rw_accounts = vec![(program_meta_account, "meta"), (abi_account, "abi")];
        let mut r_accounts = Vec::new();

        if !authority_is_fee_payer {
            r_accounts.push((authority_account, "authority"));
        }

        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut program_meta_account_idx = 0u16;
        let mut abi_account_idx = 0u16;
        let mut authority_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    program_meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "abi" => {
                    abi_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "authority" => {
                    authority_account_idx = idx;
                    tx = tx.add_r_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let authority_idx = if authority_is_fee_payer {
            0u16
        } else {
            authority_account_idx
        };

        let instruction_data = build_abi_manager_finalize_instruction(
            program_meta_account_idx,
            abi_account_idx,
            authority_idx,
        )?;

        tx = tx.with_instructions(instruction_data);
        Ok(tx)
    }

    /// Build ABI manager program CLOSE transaction
    pub fn build_abi_manager_close(
        fee_payer: TnPubkey,
        abi_manager_program: TnPubkey,
        program_meta_account: TnPubkey,
        abi_account: TnPubkey,
        authority_account: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, abi_manager_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(10000)
            .with_compute_units(500_000_000)
            .with_memory_units(5000)
            .with_state_units(5000);

        let authority_is_fee_payer = authority_account == fee_payer;

        let mut rw_accounts = vec![(program_meta_account, "meta"), (abi_account, "abi")];
        let mut r_accounts = Vec::new();

        if !authority_is_fee_payer {
            r_accounts.push((authority_account, "authority"));
        }

        rw_accounts.sort_by(|a, b| a.0.cmp(&b.0));
        r_accounts.sort_by(|a, b| a.0.cmp(&b.0));

        let mut accounts = rw_accounts;
        accounts.extend(r_accounts);

        let mut program_meta_account_idx = 0u16;
        let mut abi_account_idx = 0u16;
        let mut authority_account_idx = 0u16;

        for (i, (account, account_type)) in accounts.iter().enumerate() {
            let idx = (i + 2) as u16;
            match *account_type {
                "meta" => {
                    program_meta_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "abi" => {
                    abi_account_idx = idx;
                    tx = tx.add_rw_account(*account);
                }
                "authority" => {
                    authority_account_idx = idx;
                    tx = tx.add_r_account(*account);
                }
                _ => unreachable!(),
            }
        }

        let authority_idx = if authority_is_fee_payer {
            0u16
        } else {
            authority_account_idx
        };

        let instruction_data = build_abi_manager_close_instruction(
            program_meta_account_idx,
            abi_account_idx,
            authority_idx,
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

/// Build ABI manager CREATE instruction data
fn build_abi_manager_create_instruction(
    discriminant: u8,
    program_meta_account_idx: u16,
    abi_account_idx: u16,
    srcbuf_account_idx: u16,
    srcbuf_offset: u32,
    srcbuf_size: u32,
    authority_account_idx: u16,
    seed: &[u8],
    proof: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Prepare 32-byte seed: pad with zeros or hash if too long
    let mut seed_bytes = [0u8; 32];
    if seed.len() <= 32 {
        seed_bytes[..seed.len()].copy_from_slice(seed);
    } else {
        // Hash the seed if it's longer than 32 bytes
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(seed);
        seed_bytes.copy_from_slice(&hash);
    }

    // Write discriminant byte first
    instruction.push(discriminant);

    let args = AbiManagerCreateArgs {
        program_meta_account_idx,
        abi_account_idx,
        srcbuf_account_idx,
        srcbuf_offset,
        srcbuf_size,
        authority_account_idx,
        seed: seed_bytes,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const AbiManagerCreateArgs as *const u8,
            std::mem::size_of::<AbiManagerCreateArgs>(),
        )
    };

    instruction.extend_from_slice(args_bytes);
    // Note: seed is now part of the struct, no need to append separately

    if let Some(proof_bytes) = proof {
        instruction.extend_from_slice(proof_bytes);
    }

    Ok(instruction)
}

fn build_abi_manager_upgrade_instruction(
    program_meta_account_idx: u16,
    abi_account_idx: u16,
    srcbuf_account_idx: u16,
    srcbuf_offset: u32,
    srcbuf_size: u32,
    authority_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Write discriminant byte first
    instruction.push(ABI_MANAGER_INSTRUCTION_UPGRADE);

    let args = AbiManagerUpgradeArgs {
        program_meta_account_idx,
        abi_account_idx,
        srcbuf_account_idx,
        srcbuf_offset,
        srcbuf_size,
        authority_account_idx,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const AbiManagerUpgradeArgs as *const u8,
            std::mem::size_of::<AbiManagerUpgradeArgs>(),
        )
    };

    instruction.extend_from_slice(args_bytes);
    Ok(instruction)
}

fn build_abi_manager_finalize_instruction(
    program_meta_account_idx: u16,
    abi_account_idx: u16,
    authority_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Write discriminant byte first
    instruction.push(ABI_MANAGER_INSTRUCTION_FINALIZE);

    let args = AbiManagerFinalizeArgs {
        program_meta_account_idx,
        abi_account_idx,
        authority_account_idx,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const AbiManagerFinalizeArgs as *const u8,
            std::mem::size_of::<AbiManagerFinalizeArgs>(),
        )
    };

    instruction.extend_from_slice(args_bytes);
    Ok(instruction)
}

fn build_abi_manager_close_instruction(
    program_meta_account_idx: u16,
    abi_account_idx: u16,
    authority_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction = Vec::new();

    // Write discriminant byte first
    instruction.push(ABI_MANAGER_INSTRUCTION_CLOSE);

    let args = AbiManagerCloseArgs {
        program_meta_account_idx,
        abi_account_idx,
        authority_account_idx,
    };

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const AbiManagerCloseArgs as *const u8,
            std::mem::size_of::<AbiManagerCloseArgs>(),
        )
    };

    instruction.extend_from_slice(args_bytes);
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

/* WTHRU instruction discriminants */
pub const TN_WTHRU_INSTRUCTION_INITIALIZE_MINT: u32 = 0;
pub const TN_WTHRU_INSTRUCTION_DEPOSIT: u32 = 1;
pub const TN_WTHRU_INSTRUCTION_WITHDRAW: u32 = 2;
// lease, resolve (lil library), show lease info, 
// cost to lease, renew, record management, listing records for domain, 
// subdomain management 

/* Name service instruction discriminants */
pub const TN_NAME_SERVICE_INSTRUCTION_INITIALIZE_ROOT: u32 = 0;
pub const TN_NAME_SERVICE_INSTRUCTION_REGISTER_SUBDOMAIN: u32 = 1;
pub const TN_NAME_SERVICE_INSTRUCTION_APPEND_RECORD: u32 = 2;
pub const TN_NAME_SERVICE_INSTRUCTION_DELETE_RECORD: u32 = 3;
pub const TN_NAME_SERVICE_INSTRUCTION_UNREGISTER: u32 = 4;

/* Name service proof discriminants */
pub const TN_NAME_SERVICE_PROOF_INLINE: u32 = 0;

/* Name service limits */
pub const TN_NAME_SERVICE_MAX_DOMAIN_LENGTH: usize = 64;
pub const TN_NAME_SERVICE_MAX_KEY_LENGTH: usize = 32;
pub const TN_NAME_SERVICE_MAX_VALUE_LENGTH: usize = 256;

// Thru registrar instruction types (u32 discriminants)
pub const TN_THRU_REGISTRAR_INSTRUCTION_INITIALIZE_REGISTRY: u32 = 0;
pub const TN_THRU_REGISTRAR_INSTRUCTION_PURCHASE_DOMAIN: u32 = 1;
pub const TN_THRU_REGISTRAR_INSTRUCTION_RENEW_LEASE: u32 = 2;
pub const TN_THRU_REGISTRAR_INSTRUCTION_CLAIM_EXPIRED_DOMAIN: u32 = 3;

/// Helper function to add sorted accounts and return their indices
fn add_sorted_accounts(tx: Transaction, accounts: &[(TnPubkey, bool)]) -> (Transaction, Vec<u16>) {
    // Separate RW and RO accounts, sort each group separately
    let mut rw_accounts: Vec<_> = accounts.iter().enumerate()
        .filter(|(_, (_, writable))| *writable)
        .collect();
    let mut ro_accounts: Vec<_> = accounts.iter().enumerate()
        .filter(|(_, (_, writable))| !*writable)
        .collect();
    
    // Sort each group by pubkey
    rw_accounts.sort_by(|a, b| a.1.0.cmp(&b.1.0));
    ro_accounts.sort_by(|a, b| a.1.0.cmp(&b.1.0));

    let mut updated_tx = tx;
    let mut indices = vec![0u16; accounts.len()];
    let mut seen: HashMap<TnPubkey, u16> = HashMap::new();
    seen.insert(updated_tx.fee_payer, 0u16);
    seen.insert(updated_tx.program, 1u16);

    let mut next_idx = 2u16;

    // Process RW accounts first (in sorted order)
    for (i, (account, _)) in rw_accounts.iter() {
        if let Some(idx) = seen.get(account) {
            indices[*i] = *idx;
            continue;
        }

        let account_idx = next_idx;
        next_idx = next_idx.saturating_add(1);
        seen.insert(*account, account_idx);
        indices[*i] = account_idx;

        updated_tx = updated_tx.add_rw_account(*account);
    }

    // Then process RO accounts (in sorted order)
    for (i, (account, _)) in ro_accounts.iter() {
        if let Some(idx) = seen.get(account) {
            indices[*i] = *idx;
            continue;
        }

        let account_idx = next_idx;
        next_idx = next_idx.saturating_add(1);
        seen.insert(*account, account_idx);
        indices[*i] = account_idx;

        updated_tx = updated_tx.add_r_account(*account);
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
        creator: TnPubkey,
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
            creator,
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

    /// Build WTHRU initialize transaction
    pub fn build_wthru_initialize_mint(
        fee_payer: TnPubkey,
        wthru_program: TnPubkey,
        token_program: TnPubkey,
        mint_account: TnPubkey,
        vault_account: TnPubkey,
        decimals: u8,
        mint_seed: [u8; 32],
        mint_proof: Vec<u8>,
        vault_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, wthru_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(500_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [
            (mint_account, true),
            (vault_account, true),
            (token_program, false),
        ];

        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let mint_account_idx = indices[0];
        let vault_account_idx = indices[1];
        let token_program_idx = indices[2];

        let instruction_data = build_wthru_initialize_mint_instruction(
            token_program_idx,
            mint_account_idx,
            vault_account_idx,
            decimals,
            mint_seed,
            mint_proof,
            vault_proof,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build WTHRU deposit transaction
    pub fn build_wthru_deposit(
        fee_payer: TnPubkey,
        wthru_program: TnPubkey,
        token_program: TnPubkey,
        mint_account: TnPubkey,
        vault_account: TnPubkey,
        dest_token_account: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, wthru_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(400_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [
            (mint_account, true),
            (vault_account, true),
            (dest_token_account, true),
            (token_program, false),
        ];

        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let mint_account_idx = indices[0];
        let vault_account_idx = indices[1];
        let dest_account_idx = indices[2];
        let token_program_idx = indices[3];

        let instruction_data = build_wthru_deposit_instruction(
            token_program_idx,
            vault_account_idx,
            mint_account_idx,
            dest_account_idx,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build WTHRU withdraw transaction
    pub fn build_wthru_withdraw(
        fee_payer: TnPubkey,
        wthru_program: TnPubkey,
        token_program: TnPubkey,
        mint_account: TnPubkey,
        vault_account: TnPubkey,
        wthru_token_account: TnPubkey,
        recipient_account: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, wthru_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(400_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [
            (mint_account, true),
            (vault_account, true),
            (wthru_token_account, true),
            (recipient_account, true),
            (token_program, false),
        ];

        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let mint_account_idx = indices[0];
        let vault_account_idx = indices[1];
        let token_account_idx = indices[2];
        let recipient_account_idx = indices[3];
        let token_program_idx = indices[4];

        let owner_account_idx = 0u16; // fee payer/owner

        let instruction_data = build_wthru_withdraw_instruction(
            token_program_idx,
            vault_account_idx,
            mint_account_idx,
            token_account_idx,
            owner_account_idx,
            recipient_account_idx,
            amount,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build faucet program Deposit transaction
    /// The faucet program will invoke the EOA program to transfer from depositor to faucet account
    pub fn build_faucet_deposit(
        fee_payer: TnPubkey,
        faucet_program: TnPubkey,
        faucet_account: TnPubkey,
        depositor_account: TnPubkey,
        eoa_program: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let tx = Transaction::new(fee_payer, faucet_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let (tx, depositor_account_idx) = Self::ensure_rw_account(tx, depositor_account);
        let (tx, faucet_account_idx) = Self::ensure_rw_account(tx, faucet_account);
        let (tx, eoa_program_idx) = Self::ensure_ro_account(tx, eoa_program);

        let instruction_data = build_faucet_deposit_instruction(
            faucet_account_idx,
            depositor_account_idx,
            eoa_program_idx,
            amount,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    fn resolve_account_index(tx: &Transaction, target: &TnPubkey) -> Option<u16> {
        if *target == tx.fee_payer {
            return Some(0u16);
        }

        if *target == tx.program {
            return Some(1u16);
        }

        if let Some(ref rw) = tx.rw_accs {
            if let Some(pos) = rw.iter().position(|acc| acc == target) {
                return Some(2u16 + pos as u16);
            }
        }

        if let Some(ref ro) = tx.r_accs {
            let base = 2u16 + tx.rw_accs.as_ref().map_or(0u16, |v| v.len() as u16);
            if let Some(pos) = ro.iter().position(|acc| acc == target) {
                return Some(base + pos as u16);
            }
        }

        None
    }

    fn ensure_rw_account(mut tx: Transaction, account: TnPubkey) -> (Transaction, u16) {
        if let Some(idx) = Self::resolve_account_index(&tx, &account) {
            return (tx, idx);
        }

        tx = tx.add_rw_account(account);
        let idx = Self::resolve_account_index(&tx, &account)
            .expect("read-write account index should exist after insertion");

        (tx, idx)
    }

    fn ensure_ro_account(mut tx: Transaction, account: TnPubkey) -> (Transaction, u16) {
        if let Some(idx) = Self::resolve_account_index(&tx, &account) {
            return (tx, idx);
        }

        tx = tx.add_r_account(account);
        let idx = Self::resolve_account_index(&tx, &account)
            .expect("read-only account index should exist after insertion");

        (tx, idx)
    }

    /// Build faucet program Withdraw transaction
    pub fn build_faucet_withdraw(
        fee_payer: TnPubkey,
        faucet_program: TnPubkey,
        faucet_account: TnPubkey,
        recipient_account: TnPubkey,
        amount: u64,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, faucet_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        // Determine account indices, handling duplicates with fee_payer and between accounts
        // Check for duplicates first
        let faucet_is_fee_payer = faucet_account == fee_payer;
        let recipient_is_fee_payer = recipient_account == fee_payer;
        let recipient_is_faucet = recipient_account == faucet_account;

        let (faucet_account_idx, recipient_account_idx) = if faucet_is_fee_payer && recipient_is_fee_payer {
            // Both are fee_payer (same account)
            (0u16, 0u16)
        } else if faucet_is_fee_payer {
            // Faucet is fee_payer, recipient is different
            tx = tx.add_rw_account(recipient_account);
            (0u16, 2u16)
        } else if recipient_is_fee_payer {
            // Recipient is fee_payer, faucet is different
            tx = tx.add_rw_account(faucet_account);
            (2u16, 0u16)
        } else if recipient_is_faucet {
            // Both are same account (but not fee_payer)
            tx = tx.add_rw_account(faucet_account);
            (2u16, 2u16)
        } else {
            // Both are different accounts, add in sorted order
            if faucet_account < recipient_account {
                tx = tx.add_rw_account(faucet_account);
                tx = tx.add_rw_account(recipient_account);
                (2u16, 3u16)
            } else {
                tx = tx.add_rw_account(recipient_account);
                tx = tx.add_rw_account(faucet_account);
                (3u16, 2u16)
            }
        };

        let instruction_data = build_faucet_withdraw_instruction(
            faucet_account_idx,
            recipient_account_idx,
            amount,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build name service InitializeRoot transaction
    pub fn build_name_service_initialize_root(
        fee_payer: TnPubkey,
        name_service_program: TnPubkey,
        registrar_account: TnPubkey,
        authority_account: TnPubkey,
        root_name: &str,
        state_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, name_service_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(500_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [(registrar_account, true), (authority_account, false)];
        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let registrar_account_idx = indices[0];
        let authority_account_idx = indices[1];

        let instruction_data = build_name_service_initialize_root_instruction(
            registrar_account_idx,
            authority_account_idx,
            root_name,
            state_proof,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build name service RegisterSubdomain transaction
    pub fn build_name_service_register_subdomain(
        fee_payer: TnPubkey,
        name_service_program: TnPubkey,
        domain_account: TnPubkey,
        parent_account: TnPubkey,
        owner_account: TnPubkey,
        authority_account: TnPubkey,
        domain_name: &str,
        state_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, name_service_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(500_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [
            (domain_account, true),
            (parent_account, true),
            (owner_account, false),
            (authority_account, false),
        ];
        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let domain_account_idx = indices[0];
        let parent_account_idx = indices[1];
        let owner_account_idx = indices[2];
        let authority_account_idx = indices[3];

        let instruction_data = build_name_service_register_subdomain_instruction(
            domain_account_idx,
            parent_account_idx,
            owner_account_idx,
            authority_account_idx,
            domain_name,
            state_proof,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build name service AppendRecord transaction
    pub fn build_name_service_append_record(
        fee_payer: TnPubkey,
        name_service_program: TnPubkey,
        domain_account: TnPubkey,
        owner_account: TnPubkey,
        key: &[u8],
        value: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, name_service_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(250_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [(domain_account, true), (owner_account, false)];
        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let domain_account_idx = indices[0];
        let owner_account_idx = indices[1];

        let instruction_data = build_name_service_append_record_instruction(
            domain_account_idx,
            owner_account_idx,
            key,
            value,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build name service DeleteRecord transaction
    pub fn build_name_service_delete_record(
        fee_payer: TnPubkey,
        name_service_program: TnPubkey,
        domain_account: TnPubkey,
        owner_account: TnPubkey,
        key: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, name_service_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(200_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [(domain_account, true), (owner_account, false)];
        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let domain_account_idx = indices[0];
        let owner_account_idx = indices[1];

        let instruction_data = build_name_service_delete_record_instruction(
            domain_account_idx,
            owner_account_idx,
            key,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build name service UnregisterSubdomain transaction
    pub fn build_name_service_unregister_subdomain(
        fee_payer: TnPubkey,
        name_service_program: TnPubkey,
        domain_account: TnPubkey,
        owner_account: TnPubkey,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, name_service_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(200_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        let accounts = [(domain_account, true), (owner_account, false)];
        let (tx_with_accounts, indices) = add_sorted_accounts(tx, &accounts);
        tx = tx_with_accounts;

        let domain_account_idx = indices[0];
        let owner_account_idx = indices[1];

        let instruction_data = build_name_service_unregister_subdomain_instruction(
            domain_account_idx,
            owner_account_idx,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build thru registrar InitializeRegistry transaction
    pub fn build_thru_registrar_initialize_registry(
        fee_payer: TnPubkey,
        thru_registrar_program: TnPubkey,
        config_account: TnPubkey,
        name_service_program: TnPubkey,
        root_registrar_account: TnPubkey,
        treasurer_account: TnPubkey,
        token_mint_account: TnPubkey,
        token_program: TnPubkey,
        root_domain_name: &str,
        price_per_year: u64,
        config_proof: Vec<u8>,
        registrar_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, thru_registrar_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(500_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        // Add accounts in sorted order (read-write first, then read-only)
        // Registrar must be writable because the base name service CPI creates/resizes it.
        let mut rw_accounts = vec![config_account, root_registrar_account];
        rw_accounts.sort();

        let mut ro_accounts = vec![
            name_service_program,
            treasurer_account,
            token_mint_account,
            token_program,
        ];
        ro_accounts.sort();

        // Add RW accounts
        let mut config_account_idx = 0u16;
        let mut root_registrar_account_idx = 0u16;
        for (i, account) in rw_accounts.iter().enumerate() {
            let idx = (2 + i) as u16;
            if *account == config_account {
                config_account_idx = idx;
            } else if *account == root_registrar_account {
                root_registrar_account_idx = idx;
            }
            tx = tx.add_rw_account(*account);
        }

        // Add RO accounts
        let base_ro_idx = 2 + rw_accounts.len() as u16;
        let mut name_service_program_idx = 0u16;
        let mut treasurer_account_idx = 0u16;
        let mut token_mint_account_idx = 0u16;
        let mut token_program_idx = 0u16;

        for (i, account) in ro_accounts.iter().enumerate() {
            let idx = base_ro_idx + i as u16;
            if *account == name_service_program {
                name_service_program_idx = idx;
            } else if *account == root_registrar_account {
                root_registrar_account_idx = idx;
            } else if *account == treasurer_account {
                treasurer_account_idx = idx;
            } else if *account == token_mint_account {
                token_mint_account_idx = idx;
            } else if *account == token_program {
                token_program_idx = idx;
            }
            tx = tx.add_r_account(*account);
        }

        let instruction_data = build_thru_registrar_initialize_registry_instruction(
            config_account_idx,
            name_service_program_idx,
            root_registrar_account_idx,
            treasurer_account_idx,
            token_mint_account_idx,
            token_program_idx,
            root_domain_name,
            price_per_year,
            config_proof,
            registrar_proof,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build thru registrar PurchaseDomain transaction
    pub fn build_thru_registrar_purchase_domain(
        fee_payer: TnPubkey,
        thru_registrar_program: TnPubkey,
        config_account: TnPubkey,
        lease_account: TnPubkey,
        domain_account: TnPubkey,
        name_service_program: TnPubkey,
        root_registrar_account: TnPubkey,
        treasurer_account: TnPubkey,
        payer_token_account: TnPubkey,
        token_mint_account: TnPubkey,
        token_program: TnPubkey,
        domain_name: &str,
        years: u8,
        lease_proof: Vec<u8>,
        domain_proof: Vec<u8>,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, thru_registrar_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(500_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        // Add accounts in sorted order
        // Token accounts must be writable for transfer; lease/domain are created; root registrar and config are updated via CPI.
        let mut rw_accounts = vec![
            config_account,
            lease_account,
            domain_account,
            treasurer_account,
            payer_token_account,
            root_registrar_account,
        ];
        rw_accounts.sort();

        let mut ro_accounts = vec![
            name_service_program,
            token_mint_account,
            token_program,
        ];
        ro_accounts.sort();

        // Add RW accounts
        let mut config_account_idx = 0u16;
        let mut lease_account_idx = 0u16;
        let mut domain_account_idx = 0u16;
        let mut treasurer_account_idx = 0u16;
        let mut payer_token_account_idx = 0u16;
        let mut root_registrar_account_idx = 0u16;
        for (i, account) in rw_accounts.iter().enumerate() {
            let idx = (2 + i) as u16;
            if *account == config_account {
                config_account_idx = idx;
            } else if *account == lease_account {
                lease_account_idx = idx;
            } else if *account == domain_account {
                domain_account_idx = idx;
            } else if *account == treasurer_account {
                treasurer_account_idx = idx;
            } else if *account == payer_token_account {
                payer_token_account_idx = idx;
            } else if *account == root_registrar_account {
                root_registrar_account_idx = idx;
            }
            tx = tx.add_rw_account(*account);
        }

        // Add RO accounts
        let base_ro_idx = 2 + rw_accounts.len() as u16;
        let mut name_service_program_idx = 0u16;
        let mut token_mint_account_idx = 0u16;
        let mut token_program_idx = 0u16;

        for (i, account) in ro_accounts.iter().enumerate() {
            let idx = base_ro_idx + i as u16;
            if *account == config_account {
                config_account_idx = idx; // Should remain zero; config moved to RW set
            } else if *account == name_service_program {
                name_service_program_idx = idx;
            } else if *account == root_registrar_account {
                root_registrar_account_idx = idx;
            } else if *account == treasurer_account {
                treasurer_account_idx = idx;
            } else if *account == payer_token_account {
                payer_token_account_idx = idx;
            } else if *account == token_mint_account {
                token_mint_account_idx = idx;
            } else if *account == token_program {
                token_program_idx = idx;
            }
            tx = tx.add_r_account(*account);
        }

        let instruction_data = build_thru_registrar_purchase_domain_instruction(
            config_account_idx,
            lease_account_idx,
            domain_account_idx,
            name_service_program_idx,
            root_registrar_account_idx,
            treasurer_account_idx,
            payer_token_account_idx,
            token_mint_account_idx,
            token_program_idx,
            domain_name,
            years,
            lease_proof,
            domain_proof,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build thru registrar RenewLease transaction
    pub fn build_thru_registrar_renew_lease(
        fee_payer: TnPubkey,
        thru_registrar_program: TnPubkey,
        config_account: TnPubkey,
        lease_account: TnPubkey,
        treasurer_account: TnPubkey,
        payer_token_account: TnPubkey,
        token_mint_account: TnPubkey,
        token_program: TnPubkey,
        years: u8,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, thru_registrar_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        // Add accounts in sorted order
        // Token accounts must be writable for transfer.
        let mut rw_accounts = vec![lease_account, treasurer_account, payer_token_account];
        rw_accounts.sort();

        let mut ro_accounts = vec![
            config_account,
            token_mint_account,
            token_program,
        ];
        ro_accounts.sort();

        // Add RW accounts
        let mut lease_account_idx = 0u16;
        let mut treasurer_account_idx = 0u16;
        let mut payer_token_account_idx = 0u16;
        for (i, account) in rw_accounts.iter().enumerate() {
            let idx = (2 + i) as u16;
            if *account == lease_account {
                lease_account_idx = idx;
            } else if *account == treasurer_account {
                treasurer_account_idx = idx;
            } else if *account == payer_token_account {
                payer_token_account_idx = idx;
            }
            tx = tx.add_rw_account(*account);
        }

        // Add RO accounts
        let base_ro_idx = 2 + rw_accounts.len() as u16;
        let mut config_account_idx = 0u16;
        let mut token_mint_account_idx = 0u16;
        let mut token_program_idx = 0u16;

        for (i, account) in ro_accounts.iter().enumerate() {
            let idx = base_ro_idx + i as u16;
            if *account == config_account {
                config_account_idx = idx;
            } else if *account == token_mint_account {
                token_mint_account_idx = idx;
            } else if *account == token_program {
                token_program_idx = idx;
            }
            tx = tx.add_r_account(*account);
        }

        let instruction_data = build_thru_registrar_renew_lease_instruction(
            config_account_idx,
            lease_account_idx,
            treasurer_account_idx,
            payer_token_account_idx,
            token_mint_account_idx,
            token_program_idx,
            years,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }

    /// Build thru registrar ClaimExpiredDomain transaction
    pub fn build_thru_registrar_claim_expired_domain(
        fee_payer: TnPubkey,
        thru_registrar_program: TnPubkey,
        config_account: TnPubkey,
        lease_account: TnPubkey,
        treasurer_account: TnPubkey,
        payer_token_account: TnPubkey,
        token_mint_account: TnPubkey,
        token_program: TnPubkey,
        years: u8,
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction> {
        let mut tx = Transaction::new(fee_payer, thru_registrar_program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(300_000)
            .with_state_units(10_000)
            .with_memory_units(10_000);

        // Add accounts in sorted order
        // Token accounts must be writable for transfer.
        let mut rw_accounts = vec![lease_account, treasurer_account, payer_token_account];
        rw_accounts.sort();

        let mut ro_accounts = vec![
            config_account,
            token_mint_account,
            token_program,
        ];
        ro_accounts.sort();

        // Add RW accounts
        let mut lease_account_idx = 0u16;
        let mut treasurer_account_idx = 0u16;
        let mut payer_token_account_idx = 0u16;
        for (i, account) in rw_accounts.iter().enumerate() {
            let idx = (2 + i) as u16;
            if *account == lease_account {
                lease_account_idx = idx;
            } else if *account == treasurer_account {
                treasurer_account_idx = idx;
            } else if *account == payer_token_account {
                payer_token_account_idx = idx;
            }
            tx = tx.add_rw_account(*account);
        }

        // Add RO accounts
        let base_ro_idx = 2 + rw_accounts.len() as u16;
        let mut config_account_idx = 0u16;
        let mut token_mint_account_idx = 0u16;
        let mut token_program_idx = 0u16;

        for (i, account) in ro_accounts.iter().enumerate() {
            let idx = base_ro_idx + i as u16;
            if *account == config_account {
                config_account_idx = idx;
            } else if *account == token_mint_account {
                token_mint_account_idx = idx;
            } else if *account == token_program {
                token_program_idx = idx;
            }
            tx = tx.add_r_account(*account);
        }

        let instruction_data = build_thru_registrar_claim_expired_domain_instruction(
            config_account_idx,
            lease_account_idx,
            treasurer_account_idx,
            payer_token_account_idx,
            token_mint_account_idx,
            token_program_idx,
            years,
        )?;

        Ok(tx.with_instructions(instruction_data))
    }
}

/// Build token InitializeMint instruction data
fn build_token_initialize_mint_instruction(
    mint_account_idx: u16,
    decimals: u8,
    creator: TnPubkey,
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

    // creator (32 bytes)
    instruction_data.extend_from_slice(&creator);

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

fn build_wthru_initialize_mint_instruction(
    token_program_idx: u16,
    mint_account_idx: u16,
    vault_account_idx: u16,
    decimals: u8,
    mint_seed: [u8; 32],
    mint_proof: Vec<u8>,
    vault_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let mint_proof_len =
        u64::try_from(mint_proof.len()).map_err(|_| anyhow::anyhow!("mint proof too large"))?;
    let vault_proof_len =
        u64::try_from(vault_proof.len()).map_err(|_| anyhow::anyhow!("vault proof too large"))?;

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_WTHRU_INSTRUCTION_INITIALIZE_MINT.to_le_bytes());
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&vault_account_idx.to_le_bytes());
    instruction_data.push(decimals);
    instruction_data.extend_from_slice(&mint_seed);
    instruction_data.extend_from_slice(&mint_proof_len.to_le_bytes());
    instruction_data.extend_from_slice(&vault_proof_len.to_le_bytes());
    instruction_data.extend_from_slice(&mint_proof);
    instruction_data.extend_from_slice(&vault_proof);

    Ok(instruction_data)
}

fn build_wthru_deposit_instruction(
    token_program_idx: u16,
    vault_account_idx: u16,
    mint_account_idx: u16,
    dest_account_idx: u16,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_WTHRU_INSTRUCTION_DEPOSIT.to_le_bytes());
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    instruction_data.extend_from_slice(&vault_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&dest_account_idx.to_le_bytes());

    Ok(instruction_data)
}

fn build_wthru_withdraw_instruction(
    token_program_idx: u16,
    vault_account_idx: u16,
    mint_account_idx: u16,
    wthru_token_account_idx: u16,
    owner_account_idx: u16,
    recipient_account_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_WTHRU_INSTRUCTION_WITHDRAW.to_le_bytes());
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    instruction_data.extend_from_slice(&vault_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&mint_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&wthru_token_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&owner_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&recipient_account_idx.to_le_bytes());
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

/// Build faucet Deposit instruction data
fn build_faucet_deposit_instruction(
    faucet_account_idx: u16,
    depositor_account_idx: u16,
    eoa_program_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_FAUCET_INSTRUCTION_DEPOSIT = 0 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&0u32.to_le_bytes());

    // tn_faucet_deposit_args_t structure:
    // - faucet_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&faucet_account_idx.to_le_bytes());

    // - depositor_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&depositor_account_idx.to_le_bytes());

    // - eoa_program_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&eoa_program_idx.to_le_bytes());

    // - amount (u64, 8 bytes little-endian)
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

/// Build faucet Withdraw instruction data
fn build_faucet_withdraw_instruction(
    faucet_account_idx: u16,
    recipient_account_idx: u16,
    amount: u64,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_FAUCET_INSTRUCTION_WITHDRAW = 1 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&1u32.to_le_bytes());

    // tn_faucet_withdraw_args_t structure:
    // - faucet_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&faucet_account_idx.to_le_bytes());

    // - recipient_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&recipient_account_idx.to_le_bytes());

    // - amount (u64, 8 bytes little-endian)
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    Ok(instruction_data)
}

#[repr(C, packed)]
struct NameServiceInitializeRootArgs {
    registrar_account_idx: u16,
    authority_account_idx: u16,
    root_name: [u8; TN_NAME_SERVICE_MAX_DOMAIN_LENGTH],
    root_name_length: u32,
}

#[repr(C, packed)]
struct NameServiceRegisterSubdomainArgs {
    domain_account_idx: u16,
    parent_account_idx: u16,
    owner_account_idx: u16,
    authority_account_idx: u16,
    name: [u8; TN_NAME_SERVICE_MAX_DOMAIN_LENGTH],
    name_length: u32,
}

#[repr(C, packed)]
struct NameServiceAppendRecordArgs {
    domain_account_idx: u16,
    owner_account_idx: u16,
    key_length: u32,
    key: [u8; TN_NAME_SERVICE_MAX_KEY_LENGTH],
    value_length: u32,
    value: [u8; TN_NAME_SERVICE_MAX_VALUE_LENGTH],
}

#[repr(C, packed)]
struct NameServiceDeleteRecordArgs {
    domain_account_idx: u16,
    owner_account_idx: u16,
    key_length: u32,
    key: [u8; TN_NAME_SERVICE_MAX_KEY_LENGTH],
}

#[repr(C, packed)]
struct NameServiceUnregisterSubdomainArgs {
    domain_account_idx: u16,
    owner_account_idx: u16,
}

/// Build name service InitializeRoot instruction data
fn build_name_service_initialize_root_instruction(
    registrar_account_idx: u16,
    authority_account_idx: u16,
    root_name: &str,
    state_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let root_name_bytes = root_name.as_bytes();
    if root_name_bytes.is_empty()
        || root_name_bytes.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
    {
        return Err(anyhow::anyhow!(
            "Root name length must be between 1 and {}",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        ));
    }

    let mut args = NameServiceInitializeRootArgs {
        registrar_account_idx,
        authority_account_idx,
        root_name: [0u8; TN_NAME_SERVICE_MAX_DOMAIN_LENGTH],
        root_name_length: root_name_bytes.len() as u32,
    };
    args.root_name[..root_name_bytes.len()].copy_from_slice(root_name_bytes);

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_NAME_SERVICE_INSTRUCTION_INITIALIZE_ROOT.to_le_bytes());

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<NameServiceInitializeRootArgs>(),
        )
    };
    instruction_data.extend_from_slice(args_bytes);

    instruction_data.extend_from_slice(&TN_NAME_SERVICE_PROOF_INLINE.to_le_bytes());
    instruction_data.extend_from_slice(&state_proof);

    Ok(instruction_data)
}

/// Build name service RegisterSubdomain instruction data
fn build_name_service_register_subdomain_instruction(
    domain_account_idx: u16,
    parent_account_idx: u16,
    owner_account_idx: u16,
    authority_account_idx: u16,
    domain_name: &str,
    state_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let domain_bytes = domain_name.as_bytes();
    if domain_bytes.is_empty()
        || domain_bytes.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
    {
        return Err(anyhow::anyhow!(
            "Domain name length must be between 1 and {}",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        ));
    }

    let mut args = NameServiceRegisterSubdomainArgs {
        domain_account_idx,
        parent_account_idx,
        owner_account_idx,
        authority_account_idx,
        name: [0u8; TN_NAME_SERVICE_MAX_DOMAIN_LENGTH],
        name_length: domain_bytes.len() as u32,
    };
    args.name[..domain_bytes.len()].copy_from_slice(domain_bytes);

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_NAME_SERVICE_INSTRUCTION_REGISTER_SUBDOMAIN.to_le_bytes());

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<NameServiceRegisterSubdomainArgs>(),
        )
    };
    instruction_data.extend_from_slice(args_bytes);

    instruction_data.extend_from_slice(&TN_NAME_SERVICE_PROOF_INLINE.to_le_bytes());
    instruction_data.extend_from_slice(&state_proof);

    Ok(instruction_data)
}

/// Build name service AppendRecord instruction data
fn build_name_service_append_record_instruction(
    domain_account_idx: u16,
    owner_account_idx: u16,
    key: &[u8],
    value: &[u8],
) -> Result<Vec<u8>> {
    if key.is_empty() || key.len() > TN_NAME_SERVICE_MAX_KEY_LENGTH {
        return Err(anyhow::anyhow!(
            "Key length must be between 1 and {} bytes",
            TN_NAME_SERVICE_MAX_KEY_LENGTH
        ));
    }
    if value.len() > TN_NAME_SERVICE_MAX_VALUE_LENGTH {
        return Err(anyhow::anyhow!(
            "Value length must be <= {} bytes",
            TN_NAME_SERVICE_MAX_VALUE_LENGTH
        ));
    }

    let mut args = NameServiceAppendRecordArgs {
        domain_account_idx,
        owner_account_idx,
        key_length: key.len() as u32,
        key: [0u8; TN_NAME_SERVICE_MAX_KEY_LENGTH],
        value_length: value.len() as u32,
        value: [0u8; TN_NAME_SERVICE_MAX_VALUE_LENGTH],
    };
    args.key[..key.len()].copy_from_slice(key);
    args.value[..value.len()].copy_from_slice(value);

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_NAME_SERVICE_INSTRUCTION_APPEND_RECORD.to_le_bytes());

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<NameServiceAppendRecordArgs>(),
        )
    };
    instruction_data.extend_from_slice(args_bytes);

    Ok(instruction_data)
}

/// Build name service DeleteRecord instruction data
fn build_name_service_delete_record_instruction(
    domain_account_idx: u16,
    owner_account_idx: u16,
    key: &[u8],
) -> Result<Vec<u8>> {
    if key.is_empty() || key.len() > TN_NAME_SERVICE_MAX_KEY_LENGTH {
        return Err(anyhow::anyhow!(
            "Key length must be between 1 and {} bytes",
            TN_NAME_SERVICE_MAX_KEY_LENGTH
        ));
    }

    let mut args = NameServiceDeleteRecordArgs {
        domain_account_idx,
        owner_account_idx,
        key_length: key.len() as u32,
        key: [0u8; TN_NAME_SERVICE_MAX_KEY_LENGTH],
    };
    args.key[..key.len()].copy_from_slice(key);

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_NAME_SERVICE_INSTRUCTION_DELETE_RECORD.to_le_bytes());

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<NameServiceDeleteRecordArgs>(),
        )
    };
    instruction_data.extend_from_slice(args_bytes);

    Ok(instruction_data)
}

/// Build name service UnregisterSubdomain instruction data
fn build_name_service_unregister_subdomain_instruction(
    domain_account_idx: u16,
    owner_account_idx: u16,
) -> Result<Vec<u8>> {
    let args = NameServiceUnregisterSubdomainArgs {
        domain_account_idx,
        owner_account_idx,
    };

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(&TN_NAME_SERVICE_INSTRUCTION_UNREGISTER.to_le_bytes());

    let args_bytes = unsafe {
        std::slice::from_raw_parts(
            &args as *const _ as *const u8,
            std::mem::size_of::<NameServiceUnregisterSubdomainArgs>(),
        )
    };
    instruction_data.extend_from_slice(args_bytes);

    Ok(instruction_data)
}

/// Build thru registrar InitializeRegistry instruction data
fn build_thru_registrar_initialize_registry_instruction(
    config_account_idx: u16,
    name_service_program_idx: u16,
    root_registrar_account_idx: u16,
    treasurer_account_idx: u16,
    token_mint_account_idx: u16,
    token_program_idx: u16,
    root_domain_name: &str,
    price_per_year: u64,
    config_proof: Vec<u8>,
    registrar_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_THRU_REGISTRAR_INSTRUCTION_INITIALIZE_REGISTRY = 0 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&TN_THRU_REGISTRAR_INSTRUCTION_INITIALIZE_REGISTRY.to_le_bytes());

    // tn_thru_registrar_initialize_registry_args_t structure:
    // - config_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&config_account_idx.to_le_bytes());
    // - name_service_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&name_service_program_idx.to_le_bytes());
    // - root_registrar_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&root_registrar_account_idx.to_le_bytes());
    // - treasurer_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&treasurer_account_idx.to_le_bytes());
    // - token_mint_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_mint_account_idx.to_le_bytes());
    // - token_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    // - root_domain_name (64 bytes, padded with zeros)
    let domain_bytes = root_domain_name.as_bytes();
    if domain_bytes.len() > 64 {
        return Err(anyhow::anyhow!("Root domain name must be 64 characters or less"));
    }
    let mut domain_padded = [0u8; 64];
    domain_padded[..domain_bytes.len()].copy_from_slice(domain_bytes);
    instruction_data.extend_from_slice(&domain_padded);
    // - root_domain_name_length (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&(domain_bytes.len() as u32).to_le_bytes());
    // - price_per_year (u64, 8 bytes little-endian)
    instruction_data.extend_from_slice(&price_per_year.to_le_bytes());

    // Variable-length proofs follow:
    // - config_proof (variable length)
    instruction_data.extend_from_slice(&config_proof);
    // - registrar_proof (variable length)
    instruction_data.extend_from_slice(&registrar_proof);

    Ok(instruction_data)
}

/// Build thru registrar PurchaseDomain instruction data
fn build_thru_registrar_purchase_domain_instruction(
    config_account_idx: u16,
    lease_account_idx: u16,
    domain_account_idx: u16,
    name_service_program_idx: u16,
    root_registrar_account_idx: u16,
    treasurer_account_idx: u16,
    payer_token_account_idx: u16,
    token_mint_account_idx: u16,
    token_program_idx: u16,
    domain_name: &str,
    years: u8,
    lease_proof: Vec<u8>,
    domain_proof: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_THRU_REGISTRAR_INSTRUCTION_PURCHASE_DOMAIN = 1 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&TN_THRU_REGISTRAR_INSTRUCTION_PURCHASE_DOMAIN.to_le_bytes());

    // tn_thru_registrar_purchase_domain_args_t structure:
    // - config_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&config_account_idx.to_le_bytes());
    // - lease_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&lease_account_idx.to_le_bytes());
    // - domain_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&domain_account_idx.to_le_bytes());
    // - name_service_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&name_service_program_idx.to_le_bytes());
    // - root_registrar_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&root_registrar_account_idx.to_le_bytes());
    // - treasurer_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&treasurer_account_idx.to_le_bytes());
    // - payer_token_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&payer_token_account_idx.to_le_bytes());
    // - token_mint_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_mint_account_idx.to_le_bytes());
    // - token_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    // - domain_name (64 bytes, padded with zeros)
    let domain_bytes = domain_name.as_bytes();
    if domain_bytes.len() > 64 {
        return Err(anyhow::anyhow!("Domain name must be 64 characters or less"));
    }
    let mut domain_padded = [0u8; 64];
    domain_padded[..domain_bytes.len()].copy_from_slice(domain_bytes);
    instruction_data.extend_from_slice(&domain_padded);
    // - domain_name_length (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&(domain_bytes.len() as u32).to_le_bytes());
    // - years (u8, 1 byte)
    instruction_data.push(years);

    // Variable-length proofs follow:
    // - lease_proof (variable length)
    instruction_data.extend_from_slice(&lease_proof);
    // - domain_proof (variable length)
    instruction_data.extend_from_slice(&domain_proof);

    Ok(instruction_data)
}

/// Build thru registrar RenewLease instruction data
fn build_thru_registrar_renew_lease_instruction(
    config_account_idx: u16,
    lease_account_idx: u16,
    treasurer_account_idx: u16,
    payer_token_account_idx: u16,
    token_mint_account_idx: u16,
    token_program_idx: u16,
    years: u8,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_THRU_REGISTRAR_INSTRUCTION_RENEW_LEASE = 2 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&TN_THRU_REGISTRAR_INSTRUCTION_RENEW_LEASE.to_le_bytes());

    // tn_thru_registrar_renew_lease_args_t structure:
    // - config_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&config_account_idx.to_le_bytes());
    // - lease_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&lease_account_idx.to_le_bytes());
    // - treasurer_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&treasurer_account_idx.to_le_bytes());
    // - payer_token_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&payer_token_account_idx.to_le_bytes());
    // - token_mint_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_mint_account_idx.to_le_bytes());
    // - token_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    // - years (u8, 1 byte)
    instruction_data.push(years);

    Ok(instruction_data)
}

/// Build thru registrar ClaimExpiredDomain instruction data
fn build_thru_registrar_claim_expired_domain_instruction(
    config_account_idx: u16,
    lease_account_idx: u16,
    treasurer_account_idx: u16,
    payer_token_account_idx: u16,
    token_mint_account_idx: u16,
    token_program_idx: u16,
    years: u8,
) -> Result<Vec<u8>> {
    let mut instruction_data = Vec::new();

    // Discriminant: TN_THRU_REGISTRAR_INSTRUCTION_CLAIM_EXPIRED_DOMAIN = 3 (u32, 4 bytes little-endian)
    instruction_data.extend_from_slice(&TN_THRU_REGISTRAR_INSTRUCTION_CLAIM_EXPIRED_DOMAIN.to_le_bytes());

    // tn_thru_registrar_claim_expired_domain_args_t structure:
    // - config_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&config_account_idx.to_le_bytes());
    // - lease_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&lease_account_idx.to_le_bytes());
    // - treasurer_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&treasurer_account_idx.to_le_bytes());
    // - payer_token_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&payer_token_account_idx.to_le_bytes());
    // - token_mint_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_mint_account_idx.to_le_bytes());
    // - token_program_account_idx (u16, 2 bytes little-endian)
    instruction_data.extend_from_slice(&token_program_idx.to_le_bytes());
    // - years (u8, 1 byte)
    instruction_data.push(years);

    Ok(instruction_data)
}
