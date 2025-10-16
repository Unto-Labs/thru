//! Tests for uploader program transaction building

#[cfg(test)]
mod uploader_tests {
    use super::super::tn_tools::{KeyPair, Pubkey};
    use super::super::txn_tools::*;

    #[test]
    fn test_uploader_create_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test accounts
        let meta_account = Pubkey::from_bytes(&[2u8; 32]);
        let buffer_account = Pubkey::from_bytes(&[3u8; 32]);

        // Test data
        let program_hash = [0u8; 32]; // Dummy hash
        let seed = "test_seed";

        // Test CREATE transaction
        let create_tx = TransactionBuilder::build_uploader_create(
            fee_payer.public_key,
            uploader_program.to_bytes().unwrap(),
            meta_account.to_bytes().unwrap(),
            buffer_account.to_bytes().unwrap(),
            1024, // buffer size
            program_hash,
            seed.as_bytes(),
            1000, // fee
            1,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            create_tx.instructions.is_some(),
            "CREATE transaction should have instructions"
        );

        // Verify discriminant (first 4 bytes should be 0 for CREATE)
        let instructions = create_tx.instructions.as_ref().unwrap();
        assert_eq!(
            &instructions[0..4],
            &TN_UPLOADER_PROGRAM_INSTRUCTION_CREATE.to_le_bytes()
        );

        // Verify transaction has correct accounts
        assert_eq!(
            create_tx.rw_accs.as_ref().unwrap().len(),
            2,
            "CREATE transaction should have 2 additional accounts"
        );
    }

    #[test]
    fn test_uploader_write_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test accounts
        let meta_account = Pubkey::from_bytes(&[2u8; 32]);
        let buffer_account = Pubkey::from_bytes(&[3u8; 32]);

        // Test data
        let test_data = b"Hello, Thru blockchain!";

        // Test WRITE transaction
        let write_tx = TransactionBuilder::build_uploader_write(
            fee_payer.public_key,
            uploader_program.to_bytes().unwrap(),
            meta_account.to_bytes().unwrap(),
            buffer_account.to_bytes().unwrap(),
            test_data,
            0,    // offset
            1000, // fee
            2,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            write_tx.instructions.is_some(),
            "WRITE transaction should have instructions"
        );

        // Verify discriminant (first 4 bytes should be 1 for WRITE)
        let instructions = write_tx.instructions.as_ref().unwrap();
        assert_eq!(
            &instructions[0..4],
            &TN_UPLOADER_PROGRAM_INSTRUCTION_WRITE.to_le_bytes()
        );

        // Verify instruction contains the test data
        assert!(
            instructions.len() >= test_data.len(),
            "WRITE instruction should contain test data"
        );

        // Verify transaction has correct accounts
        assert_eq!(
            write_tx.rw_accs.as_ref().unwrap().len(),
            2,
            "WRITE transaction should have 2 additional accounts"
        );
    }

    #[test]
    fn test_uploader_finalize_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test accounts
        let meta_account = Pubkey::from_bytes(&[2u8; 32]);
        let buffer_account = Pubkey::from_bytes(&[3u8; 32]);

        // Test data
        let program_hash = [0u8; 32]; // Dummy hash

        // Test FINALIZE transaction
        let finalize_tx = TransactionBuilder::build_uploader_finalize(
            fee_payer.public_key,
            uploader_program.to_bytes().unwrap(),
            meta_account.to_bytes().unwrap(),
            buffer_account.to_bytes().unwrap(),
            1024,
            program_hash,
            1000, // fee
            3,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            finalize_tx.instructions.is_some(),
            "FINALIZE transaction should have instructions"
        );

        // Verify discriminant (first 4 bytes should be 3 for FINALIZE)
        let instructions = finalize_tx.instructions.as_ref().unwrap();
        assert_eq!(
            &instructions[0..4],
            &TN_UPLOADER_PROGRAM_INSTRUCTION_FINALIZE.to_le_bytes()
        );

        // Verify transaction has correct accounts
        assert_eq!(
            finalize_tx.rw_accs.as_ref().unwrap().len(),
            2,
            "FINALIZE transaction should have 2 additional accounts"
        );
    }

    #[test]
    fn test_uploader_destroy_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test accounts
        let meta_account = Pubkey::from_bytes(&[2u8; 32]);
        let buffer_account = Pubkey::from_bytes(&[3u8; 32]);

        // Test DESTROY transaction
        let destroy_tx = TransactionBuilder::build_uploader_destroy(
            fee_payer.public_key,
            uploader_program.to_bytes().unwrap(),
            meta_account.to_bytes().unwrap(),
            buffer_account.to_bytes().unwrap(),
            1000, // fee
            4,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            destroy_tx.instructions.is_some(),
            "DESTROY transaction should have instructions"
        );

        // Verify discriminant (first 4 bytes should be 2 for DESTROY)
        let instructions = destroy_tx.instructions.as_ref().unwrap();
        assert_eq!(
            &instructions[0..4],
            &TN_UPLOADER_PROGRAM_INSTRUCTION_DESTROY.to_le_bytes()
        );

        // Verify transaction has correct accounts
        assert_eq!(
            destroy_tx.rw_accs.as_ref().unwrap().len(),
            2,
            "DESTROY transaction should have 2 additional accounts"
        );
    }

    #[test]
    fn test_uploader_instruction_discriminants() {
        // Verify the discriminant constants are correct
        assert_eq!(TN_UPLOADER_PROGRAM_INSTRUCTION_CREATE, 0x00);
        assert_eq!(TN_UPLOADER_PROGRAM_INSTRUCTION_WRITE, 0x01);
        assert_eq!(TN_UPLOADER_PROGRAM_INSTRUCTION_DESTROY, 0x02);
        assert_eq!(TN_UPLOADER_PROGRAM_INSTRUCTION_FINALIZE, 0x03);
    }
}

#[cfg(test)]
mod test_uploader_tests {
    use super::super::tn_tools::{KeyPair, Pubkey};
    use super::super::txn_tools::*;

    #[test]
    fn test_test_uploader_create_ephemeral_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let test_uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test target account
        let target_account = Pubkey::from_bytes(&[2u8; 32]);

        // Test data
        let seed = b"test_seed_123";

        // Test CREATE ephemeral transaction
        let create_tx = TransactionBuilder::build_test_uploader_create(
            fee_payer.public_key,
            test_uploader_program.to_bytes().unwrap(),
            target_account.to_bytes().unwrap(),
            1024, // account_sz
            seed,
            true, // is_ephemeral
            None, // no state proof for ephemeral
            1000, // fee
            1,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            create_tx.instructions.is_some(),
            "CREATE transaction should have instructions"
        );

        // Verify discriminant (first byte should be 0 for CREATE)
        let instructions = create_tx.instructions.as_ref().unwrap();
        assert_eq!(
            instructions[0],
            TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_CREATE
        );

        // Verify transaction has correct accounts
        assert_eq!(
            create_tx.rw_accs.as_ref().unwrap().len(),
            1,
            "CREATE transaction should have 1 additional account"
        );
    }

    #[test]
    fn test_test_uploader_create_with_proof_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let test_uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test target account
        let target_account = Pubkey::from_bytes(&[2u8; 32]);

        // Test data
        let seed = b"test_seed_123";
        let state_proof = b"dummy_state_proof_data";

        // Test CREATE with state proof transaction
        let create_tx = TransactionBuilder::build_test_uploader_create(
            fee_payer.public_key,
            test_uploader_program.to_bytes().unwrap(),
            target_account.to_bytes().unwrap(),
            2048, // account_sz
            seed,
            false,             // not ephemeral
            Some(state_proof), // with state proof
            1000,              // fee
            1,                 // nonce
            100,               // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            create_tx.instructions.is_some(),
            "CREATE transaction should have instructions"
        );

        // Verify discriminant (first byte should be 0 for CREATE)
        let instructions = create_tx.instructions.as_ref().unwrap();
        assert_eq!(
            instructions[0],
            TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_CREATE
        );

        // Verify instruction contains the state proof
        assert!(
            instructions.len() >= state_proof.len(),
            "CREATE instruction should contain state proof"
        );
    }

    #[test]
    fn test_test_uploader_write_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey
        let test_uploader_program = Pubkey::from_bytes(&[1u8; 32]);

        // Create test target account
        let target_account = Pubkey::from_bytes(&[2u8; 32]);

        // Test data
        let test_data = b"Hello, test uploader program!";
        let offset = 42u32;

        // Test WRITE transaction
        let write_tx = TransactionBuilder::build_test_uploader_write(
            fee_payer.public_key,
            test_uploader_program.to_bytes().unwrap(),
            target_account.to_bytes().unwrap(),
            offset,
            test_data,
            1000, // fee
            2,    // nonce
            100,  // start_slot
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            write_tx.instructions.is_some(),
            "WRITE transaction should have instructions"
        );

        // Verify discriminant (first byte should be 1 for WRITE)
        let instructions = write_tx.instructions.as_ref().unwrap();
        assert_eq!(instructions[0], TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_WRITE);

        // Verify instruction contains the test data
        assert!(
            instructions.len() >= test_data.len(),
            "WRITE instruction should contain test data"
        );

        // Verify transaction has correct accounts
        assert_eq!(
            write_tx.rw_accs.as_ref().unwrap().len(),
            1,
            "WRITE transaction should have 1 additional account"
        );
    }

    #[test]
    fn test_test_uploader_discriminants() {
        // Verify the discriminant constants are correct
        assert_eq!(TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_CREATE, 0x00);
        assert_eq!(TN_TEST_UPLOADER_PROGRAM_DISCRIMINANT_WRITE, 0x01);
    }
}

#[cfg(test)]
mod system_program_tests {
    use super::super::tn_tools::{KeyPair, Pubkey};
    use super::super::txn_tools::*;

    #[test]
    fn test_decompress2_account_transaction() {
        // Create test keypair
        let private_key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let fee_payer = KeyPair::from_hex_private_key("test", private_key_hex).unwrap();

        // Create test program pubkey (system program)
        let system_program = Pubkey::from_bytes(&[0u8; 32]);

        // Create test accounts
        let target_account = Pubkey::from_bytes(&[1u8; 32]);
        let meta_account = Pubkey::from_bytes(&[2u8; 32]);
        let data_account = Pubkey::from_bytes(&[3u8; 32]);

        // Test data
        let data_offset = 64u32;
        let state_proof = b"dummy_state_proof_for_decompress2";

        // Test DECOMPRESS2 transaction
        let decompress2_tx = TransactionBuilder::build_decompress2(
            fee_payer.public_key,
            system_program.to_bytes().unwrap(),
            target_account.to_bytes().unwrap(),
            meta_account.to_bytes().unwrap(),
            data_account.to_bytes().unwrap(),
            data_offset,
            state_proof,
            1000, // fee
            1,    // nonce
            100,  // start_slot
            1024,
        )
        .unwrap();

        // Verify transaction has instruction data
        assert!(
            decompress2_tx.instructions.is_some(),
            "DECOMPRESS2 transaction should have instructions"
        );

        // Verify discriminant (first byte should be 0x08 for DECOMPRESS2)
        let instructions = decompress2_tx.instructions.as_ref().unwrap();
        assert_eq!(
            instructions[0], 0x08,
            "First byte should be DECOMPRESS2 discriminant"
        );

        // Verify instruction contains the state proof
        assert!(
            instructions.len() >= state_proof.len(),
            "DECOMPRESS2 instruction should contain state proof"
        );

        // Verify transaction has correct accounts (target is RW, meta and data are R)
        assert_eq!(
            decompress2_tx.rw_accs.as_ref().unwrap().len(),
            1,
            "DECOMPRESS2 transaction should have 1 RW account"
        );
        assert_eq!(
            decompress2_tx.r_accs.as_ref().unwrap().len(),
            2,
            "DECOMPRESS2 transaction should have 2 R accounts"
        );
    }

    #[test]
    fn test_decompress2_instruction_format() {
        // Test the instruction format directly
        let target_account_idx = 2u16;
        let meta_account_idx = 3u16;
        let data_account_idx = 4u16;
        let data_offset = 128u32;
        let state_proof = b"test_proof_data";

        let instruction = build_decompress2_instruction(
            target_account_idx,
            meta_account_idx,
            data_account_idx,
            data_offset,
            state_proof,
        )
        .unwrap();

        // Verify discriminant
        assert_eq!(instruction[0], 0x08);

        // Verify minimum instruction size (discriminant + args + proof)
        let expected_min_size =
            1 + std::mem::size_of::<SystemProgramDecompress2Args>() + state_proof.len();
        assert_eq!(instruction.len(), expected_min_size);

        // Verify instruction ends with state proof
        let proof_start = instruction.len() - state_proof.len();
        assert_eq!(&instruction[proof_start..], state_proof);
    }
}
