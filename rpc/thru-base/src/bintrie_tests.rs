#[cfg(test)]
mod tests {
    use crate::BinTrieError;
    use crate::bintrie::test_helpers::*;
    use crate::bintrie::*;
    use crate::bintrie_proof::Proof;
    use crate::bintrie_types::{Hash, Pubkey};
    use crate::tn_public_address::tn_public_address_decode;

    /// Create a pubkey from a u64 value for testing
    fn test_pubkey(value: u64) -> Pubkey {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&value.to_le_bytes());
        Pubkey::new(bytes)
    }

    fn test_pubkey_from_str(value: &str) -> Pubkey {
        let mut bytes = [0u8; 32];
        tn_public_address_decode(&mut bytes, value.as_bytes()).unwrap();
        Pubkey::new(bytes)
    }

    /// Create a hash from a u64 value for testing
    fn test_hash(value: u64) -> Hash {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&value.to_le_bytes());
        Hash::new(bytes)
    }

    fn test_hash_from_str(value: &str) -> Hash {
        // decode from hex string
        let mut bytes = [0u8; 32];
        hex::decode_to_slice(value, &mut bytes).unwrap();
        Hash::new(bytes)
    }

    fn hash_to_str(hash: &Hash) -> String {
        hex::encode(hash.as_bytes())
    }

    #[test]
    fn test_empty_trie() {
        let trie = BinTrie::new();
        assert!(trie.is_empty());
        assert_eq!(trie.state_root(), Hash::default());

        // Query should return None
        let key = test_pubkey(0);
        assert!(trie.query(&key).is_none());

        // Prove non-existence should work
        let non_existence_proof = trie.prove_non_existence(&key).unwrap();
        assert!(non_existence_proof.proof.proof_indices.is_empty());
        assert!(non_existence_proof.existing_pubkey.is_zero());
        assert!(non_existence_proof.existing_hash.is_zero());

        // Prove existence should fail
        assert!(trie.prove_existence(&key).is_err());
    }

    #[test]
    fn test_single_insert() {
        let mut trie = BinTrie::new();
        let key = test_pubkey(1);
        let value = test_hash(2);

        // Insert should succeed
        assert!(trie.insert(key, value).is_ok());
        assert!(!trie.is_empty());

        // Query should find it
        let pair = trie.query(&key).unwrap();
        assert_eq!(pair.pubkey, key);
        assert_eq!(pair.value_hash, value);
        assert!(!pair.is_sibling_hash);

        // Should be able to prove existence
        let (proof, existing_hash) = trie.prove_existence(&key).unwrap();
        assert_eq!(proof.proof_indices.len(), 0); // Single element, no path
        assert_eq!(existing_hash, value);

        // Update should work
        let new_value = test_hash(4);
        assert!(trie.update_hash(&key, new_value).is_ok());
        let pair = trie.query(&key).unwrap();
        assert_eq!(pair.value_hash, new_value);

        // Inserting same key should fail
        assert!(matches!(
            trie.insert(key, value),
            Err(BinTrieError::KeyExists)
        ));
    }

    #[test]
    fn test_multiple_inserts() {
        let mut trie = BinTrie::new();

        // Insert first key: binary ...100 (bit pattern 4)
        let key1 = test_pubkey(4);
        let value1 = test_hash(4);
        assert!(trie.insert(key1, value1).is_ok());
        trie.print();

        // Insert second key: binary ...010 (bit pattern 2)
        let key2 = test_pubkey(2);
        let value2 = test_hash(4);
        assert!(trie.insert(key2, value2).is_ok());
        trie.print();

        // Verify both keys are present
        let pair1 = trie.query(&key1).unwrap();
        let pair2 = trie.query(&key2).unwrap();
        assert_eq!(pair1.value_hash, value1);
        assert_eq!(pair2.value_hash, value2);

        // Should be able to generate existence proofs for both
        let (proof1, _) = trie.prove_existence(&key1).unwrap();
        let (proof2, _) = trie.prove_existence(&key2).unwrap();
        assert!(!proof1.proof_indices.is_empty());
        assert!(!proof2.proof_indices.is_empty());

        // Should be able to prove non-existence of a third key
        let key3 = test_pubkey(7);
        let non_existence_proof = trie.prove_non_existence(&key3).unwrap();
        assert!(!non_existence_proof.proof.proof_indices.is_empty());
    }

    #[test]
    fn test_multiple_inserts_2() {
        let mut trie = BinTrie::new();

        let key1 = test_pubkey_from_str("taszX_6beOWkdcB8at4p9A_jPz4giAq5k2p5R1L7bXc5fL");
        let value1 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key1, value1).is_ok());
        // trie.print_verbose();

        let key2 = test_pubkey_from_str("tar5JmX6vCYYsGIGsdBy1YRHEs37USuRemdRGjtVUxhkzM");
        let value2 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key2, value2).is_ok());
        // trie.print_verbose();

        let root = trie.state_root();
        trie.print_verbose();
        println!("Root: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "200f7f92a525898a76b3b0d5df8fd507924bef153a856ce8ed6f9b2a4aa7ff96"
        );

        let key3 = test_pubkey_from_str("tahEZftOMEds4fJU8vfbZHJdNQYhUUDmbFagmReCnga-cn");
        let value3 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key3, value3).is_ok());
        trie.print_verbose();

        let root = trie.state_root();
        println!("Root: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "b7fab652d0ee39cac03513d872c7131de9aa80d7f708f4ec092bfcd7225e2009"
        );
    }

    #[test]
    fn test_multiple_inserts_3() {
        let mut trie = BinTrie::new();

        let key1 = test_pubkey_from_str("taHyuh6QOTRVcYSPBaQRtZVASGCUAoAWBOX1f8JgIWux8t");
        let value1 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key1, value1).is_ok());
        // trie.print_verbose();

        let key2 = test_pubkey_from_str("taak28LsX9H7_RMHQX5dD3cJBlBH0HzT9m9IIkFtHGoR_f");
        let value2 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key2, value2).is_ok());
        // trie.print_verbose();

        let root = trie.state_root();
        trie.print_verbose();
        println!("--------");
        // println!("Root: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "bc37589a9d5046a9053f7fb2e86a7324f11b880760a1f59fbeec053ba7795299"
        );

        let key3 = test_pubkey_from_str("taFo1oRHta5pVDaXzfL3QIn_jxFqSb6WyAjhYdVYT38xif");
        let value3 =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");
        assert!(trie.insert(key3, value3).is_ok());
        trie.print_verbose();

        let root = trie.state_root();
        println!("Root: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "79b7dbf586889dcd322e9f9e5880abe76f156fdf6007c7292e2fb497b09109ec"
        );
    }

    #[test]
    fn test_c_log_trie_structure() {
        let mut trie = BinTrie::new();

        // All keys use the same value hash as shown in the C log
        let value_hash =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");

        // Insert all 10 keys from the C log output
        // The order of insertion will affect the tree structure, so we need to insert them
        // in an order that creates the exact tree structure shown in the log

        let keys = [
            "taQo4lVoshYW7UArcfAJlgwfXtUOPkpjTJUu3KuCEShVma", // bit_idx=3 left leaf
            "taGsiDlBDcD69nhK-x43iE97rrxtBYEnx1Ph4fXGNa63xV", // bit_idx=3 right leaf
            "ta5o6yzKQSPKAuTTRdhF9HQr5q3VNojabnQE8vTPeM25fV", // bit_idx=4 left leaf
            "taFtGtT2HKOi-iqTE5xamty0lXlsM_sOPwepdjwMqPaRbZ", // bit_idx=4 right leaf
            "taeRfuqHnr55ANz6k-Cwq7UtUHHTq9AL7T9kmLISRUQTZB", // bit_idx=2 left leaf (right side)
            "taTSWh7CwXpdKpjeY5SprYz_9lT85L9AYEsTaAmveVxBrO", // bit_idx=5 left leaf
            "tabbtW2hOnib7CP4gZV05c1_NAGeEWWuiht6hYaesx0S81", // bit_idx=5 right leaf
            "taO2P86A50fjwaWY_avatmSOZ22tGxt3UTt1-y1rTqn_h6", // bit_idx=2 left leaf (right side)
            "tatyGlycOrWP9-l6ab9qhCk147rfgbrky-dPQYPBDyg0Fn", // bit_idx=3 left leaf (right side)
            "taL9LC3h-paoQey-dRodlCbS7fLNoVISlIcu4NPawuGwX_", // bit_idx=3 right leaf (right side)
        ];

        // Insert keys one by one
        for key_str in &keys {
            let key = test_pubkey_from_str(key_str);
            assert!(trie.insert(key, value_hash).is_ok());
        }

        // Print the structure to compare with C log
        trie.print_verbose();

        // Verify the root hash matches the C implementation
        let root = trie.state_root();
        println!("Root hash: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "b5fa3463d03e827b6511726410af4785c1177a373fe0aaa1b75a669cdbc4f4a5"
        );
        let proof = trie
            .prove_non_existence(&test_pubkey_from_str(
                "ta_GMlusG3k9Ll7A8r6lOfBukVPUpgnk4xq8hKwP3AtTIr",
            ))
            .unwrap();
        println!("Proof: {:?}", proof);
    }

    #[test]
    fn test_c_log_trie_structure_2() {
        let mut trie = BinTrie::new();

        // All keys use the same value hash as shown in the C log
        let value_hash =
            test_hash_from_str("7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e");

        let keys = [
            "taEDnJzAolq1snEE1j4v-p1r0ZKUzngk0bixFge3PlH6MH",
            "taeA45MISEJVY-KX0nE879eUotE9BG2cqCBOBiLEcZSAO2",
            "tarPxBA5EfBMiIQkfSRLG0PlOsOMoXpTPrGiqJuhXFrT9a",
            "taLnpxiIR3AUb7QeHMGe0za9u_bUZngIqamTAoyKnaw-mw",
            "taEWp_1Zra79aE3xfEIkbo4Fdch3WQDIqi4kF8MXjvsCn9",
            "taWfR8BpehFNqMS9rDnM8xEGxuYXqCjNTaFvFk6ZFt80QP",
            "tazYK54gu9CbHgddg9jc17c5xQ1KDrYkmGXypme6fh8uRi",
        ];

        // Insert keys one by one
        for key_str in &keys {
            let key = test_pubkey_from_str(key_str);
            assert!(trie.insert(key, value_hash).is_ok());
        }

        // Print the structure to compare with C log
        trie.print_verbose();

        // Verify the root hash matches the C implementation
        let root = trie.state_root();
        println!("Root hash: {}", hash_to_str(&root));
        assert_eq!(
            hash_to_str(&root),
            "73ad095cbc4f2e382451f19951c507b8f53cf672de0a1632239ff4b0c9090b6c"
        );
        let proof = trie
            .prove_non_existence(&test_pubkey_from_str(
                "taTaOVSdF1Vt7S0ci7hSMT9WjGkOY-PAIlddQbG--4Zx8P",
            ))
            .unwrap();
        println!("Proof: {:?}", proof);
        assert_eq!(
            hash_to_str(&proof.existing_hash),
            "7f8c379a435cd6f1a6ccd8f9632b7f1560fa800f0f79ce57b39ddffc7eeb890e"
        );
        assert_eq!(
            proof.existing_pubkey,
            test_pubkey_from_str("tazYK54gu9CbHgddg9jc17c5xQ1KDrYkmGXypme6fh8uRi")
        );
        assert_eq!(
            hash_to_str(&proof.proof.sibling_hashes[0]),
            "b959ed9af957c7b3a387840a002f23ea8634f2749af5d86557531134071b639e"
        );
        assert_eq!(
            hash_to_str(&proof.proof.sibling_hashes[1]),
            "1e0d6e73b1883f9a54170246ed80ffad185f94efaa5caae4b78478aae25ccf68"
        );
    }

    #[test]
    fn test_key_not_found_errors() {
        let mut trie = BinTrie::new();
        let key = test_pubkey(1);
        let new_hash = test_hash(4);

        // Update non-existent key should fail
        assert!(matches!(
            trie.update_hash(&key, new_hash),
            Err(BinTrieError::KeyNotFound)
        ));

        // Query non-existent key should return None
        assert!(trie.query(&key).is_none());
    }

    #[test]
    fn test_proof_empty_trie() {
        let mut trie = BinTrie::new();
        let key = test_pubkey(1);
        let value = test_hash(2);

        // Empty proof for empty trie should succeed
        let proof = Proof::new();
        assert!(trie.insert_with_proof(key, value, &proof).is_ok());

        // Verify the leaf was inserted correctly
        let pair = trie.query(&key).unwrap();
        assert_eq!(pair.pubkey, key);
        assert_eq!(pair.value_hash, value);
        assert!(!pair.is_sibling_hash);
    }

    #[test]
    fn test_proof_insertion_complex() {
        let mut trie = BinTrie::new();

        // Create keys with specific bit patterns
        let key1 = test_pubkey(0); // 0b...00
        let value1 = test_hash(1);
        let key2 = test_pubkey(1); // 0b...01
        let value2 = test_hash(2);
        let _key3 = test_pubkey(2); // 0b...10
        let _value3 = test_hash(3);
        let _key4 = test_pubkey(3); // 0b...11
        let _value4 = test_hash(4);

        // Step 1: Insert first key with a multi-level proof
        let mut proof = Proof::new();
        proof.proof_indices.push(0); // First bit test
        proof.proof_indices.push(1); // Second bit test

        // Create dummy sibling hashes
        let dummy_hash1 = test_hash(0xAAAA);
        let dummy_hash2 = test_hash(0xBBBB);
        proof.sibling_hashes.push(dummy_hash1);
        proof.sibling_hashes.push(dummy_hash2);

        assert!(trie.insert_with_proof(key1, value1, &proof).is_ok());
        trie.print();

        // Step 2: Insert key2 with matching proof structure
        let mut proof2 = Proof::new();
        proof2.proof_indices.push(0);
        proof2.proof_indices.push(1);

        let key1_hash = hash_leaf(&key1, &value1);
        proof2.sibling_hashes.push(dummy_hash1);
        proof2.sibling_hashes.push(key1_hash);

        assert!(trie.insert_with_proof(key2, value2, &proof2).is_ok());
        trie.print();

        // Verify both keys exist
        assert!(trie.query(&key1).is_some());
        assert!(trie.query(&key2).is_some());
    }

    #[test]
    fn test_hash_consistency() {
        // Test that our hash functions match expected patterns from C implementation
        let key = test_pubkey(1);
        let value = test_hash(2);

        // Test leaf hash
        let leaf_hash = hash_leaf(&key, &value);
        assert!(!leaf_hash.is_zero());

        // Test node hash
        let left_hash = test_hash(3);
        let right_hash = test_hash(4);
        let node_hash = hash_node(&left_hash, &right_hash);
        assert!(!node_hash.is_zero());
        assert_ne!(node_hash, leaf_hash);

        // Different inputs should produce different hashes
        let different_key = test_pubkey(2);
        let different_leaf_hash = hash_leaf(&different_key, &value);
        assert_ne!(leaf_hash, different_leaf_hash);
    }

    #[test]
    fn test_state_root_changes() {
        let mut trie = BinTrie::new();

        // Empty trie has zero root
        assert_eq!(trie.state_root(), Hash::default());

        // Add first key
        let key1 = test_pubkey(1);
        let value1 = test_hash(2);
        trie.insert(key1, value1).unwrap();
        let root1 = trie.state_root();
        assert!(!root1.is_zero());

        // Add second key - root should change
        let key2 = test_pubkey(3);
        let value2 = test_hash(4);
        trie.insert(key2, value2).unwrap();
        let root2 = trie.state_root();
        assert_ne!(root1, root2);

        // Update existing key - root should change
        let new_value1 = test_hash(5);
        trie.update_hash(&key1, new_value1).unwrap();
        let root3 = trie.state_root();
        assert_ne!(root2, root3);
    }

    #[test]
    fn test_pubkey_bit_operations() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0b10101010; // Set specific bit pattern in first byte
        bytes[1] = 0b01010101; // Set specific bit pattern in second byte

        let pubkey = Pubkey::new(bytes);

        // Test bit extraction from first byte
        // bytes[0] = 0b10101010 means bits 1,3,5,7 are set (little endian)
        assert!(!pubkey.get_bit(0)); // bit 0 should be clear
        assert!(pubkey.get_bit(1)); // bit 1 should be set
        assert!(!pubkey.get_bit(2)); // bit 2 should be clear
        assert!(pubkey.get_bit(3)); // bit 3 should be set
        assert!(!pubkey.get_bit(4)); // bit 4 should be clear
        assert!(pubkey.get_bit(5)); // bit 5 should be set
        assert!(!pubkey.get_bit(6)); // bit 6 should be clear
        assert!(pubkey.get_bit(7)); // bit 7 should be set

        // Test bit extraction from second byte
        // bytes[1] = 0b01010101 means bits 8,10,12,14 are set
        assert!(pubkey.get_bit(8)); // bit 8 (first bit of second byte) should be set
        assert!(!pubkey.get_bit(9)); // bit 9 should be clear

        // Test out of bounds
        assert!(!pubkey.get_bit(255)); // Should return false for bit 255 when byte is 0
    }

    #[test]
    fn test_creation_proof() {
        let mut trie = BinTrie::new();

        let pubkey = test_pubkey(1);
        let value_hash = test_hash(2);
        let existing_pubkey = test_pubkey(3);
        let existing_value_hash = test_hash(4);

        // Empty proof for creation in empty trie
        let proof = Proof::new();
        assert!(
            trie.insert_with_creation_proof(
                pubkey,
                value_hash,
                existing_pubkey,
                existing_value_hash,
                &proof
            )
            .is_ok()
        );

        // Both keys should now exist
        assert!(trie.query(&pubkey).is_some());
        assert!(trie.query(&existing_pubkey).is_some());
    }

    #[test]
    fn test_error_conditions() {
        let mut trie = BinTrie::new();
        let key = test_pubkey(1);
        let value = test_hash(2);

        // Insert key
        trie.insert(key, value).unwrap();

        // Try to insert same key again - should fail
        assert!(matches!(
            trie.insert(key, value),
            Err(BinTrieError::KeyExists)
        ));

        // Prove existence of non-existent key should fail
        let missing_key = test_pubkey(999);
        assert!(matches!(
            trie.prove_existence(&missing_key),
            Err(BinTrieError::KeyNotFound)
        ));

        // Prove non-existence of existing key should fail
        assert!(matches!(
            trie.prove_non_existence(&key),
            Err(BinTrieError::KeyExists)
        ));

        // Update non-existent key should fail
        let new_value = test_hash(999);
        assert!(matches!(
            trie.update_hash(&missing_key, new_value),
            Err(BinTrieError::KeyNotFound)
        ));
    }

    #[test]
    fn test_hash_and_pubkey_from_slice() {
        // Valid 32-byte slice
        let bytes = [1u8; 32];
        let hash = Hash::from_slice(&bytes).unwrap();
        assert_eq!(hash.as_bytes(), &bytes);

        let pubkey = Pubkey::from_slice(&bytes).unwrap();
        assert_eq!(pubkey.as_bytes(), &bytes);

        // Invalid length should fail
        let short_bytes = [1u8; 16];
        assert!(matches!(
            Hash::from_slice(&short_bytes),
            Err(BinTrieError::InvalidHashLength)
        ));
        assert!(matches!(
            Pubkey::from_slice(&short_bytes),
            Err(BinTrieError::InvalidPubkeyLength)
        ));

        let long_bytes = [1u8; 64];
        assert!(matches!(
            Hash::from_slice(&long_bytes),
            Err(BinTrieError::InvalidHashLength)
        ));
        assert!(matches!(
            Pubkey::from_slice(&long_bytes),
            Err(BinTrieError::InvalidPubkeyLength)
        ));
    }

    #[test]
    fn test_display_formatting() {
        let hash = test_hash(0x123456789ABCDEF0);
        let hash_str = format!("{}", hash);
        assert!(hash_str.starts_with("0x"));
        assert!(hash_str.len() > 2); // Should have hex content

        let pubkey = test_pubkey(0x123456789ABCDEF0);
        let pubkey_str = format!("{}", pubkey);
        assert!(pubkey_str.starts_with("0x"));
        assert!(pubkey_str.len() > 2); // Should have hex content
    }

    #[test]
    fn test_zero_detection() {
        let zero_hash = Hash::default();
        assert!(zero_hash.is_zero());

        let non_zero_hash = test_hash(1);
        assert!(!non_zero_hash.is_zero());

        let zero_pubkey = Pubkey::default();
        assert!(zero_pubkey.is_zero());

        let non_zero_pubkey = test_pubkey(1);
        assert!(!non_zero_pubkey.is_zero());
    }

    #[test]
    fn test_bintrie_pair_types() {
        let pubkey = test_pubkey(1);
        let value_hash = test_hash(2);

        // Regular pair
        let pair = BinTriePair::new(pubkey, value_hash);
        assert_eq!(pair.pubkey, pubkey);
        assert_eq!(pair.value_hash, value_hash);
        assert!(!pair.is_sibling_hash);

        // Sibling hash pair
        let sibling_hash = test_hash(3);
        let sibling_pair = BinTriePair::new_sibling_hash(sibling_hash);
        assert_eq!(sibling_pair.value_hash, sibling_hash);
        assert!(sibling_pair.is_sibling_hash);
        assert!(sibling_pair.pubkey.is_zero());
    }

    #[test]
    fn test_leaf_hash_computation() {
        let pubkey = test_pubkey(1);
        let value_hash = test_hash(2);

        // Regular leaf
        let pair = BinTriePair::new(pubkey, value_hash);
        let leaf = BinTrieLeaf::new(pair.clone());
        let expected_hash = hash_leaf(&pubkey, &value_hash);
        assert_eq!(leaf.hash, expected_hash);

        // Sibling hash leaf
        let sibling_hash = test_hash(3);
        let sibling_pair = BinTriePair::new_sibling_hash(sibling_hash);
        let sibling_leaf = BinTrieLeaf::new(sibling_pair);
        assert_eq!(sibling_leaf.hash, sibling_hash);
    }

    #[test]
    fn test_non_existence_proof_to_wire() {
        let mut trie = BinTrie::new();

        // Insert a key to create a non-empty trie
        let existing_key = test_pubkey(1);
        let existing_value = test_hash(2);
        trie.insert(existing_key, existing_value).unwrap();

        // Prove non-existence of a different key
        let missing_key = test_pubkey(3);
        let non_existence_proof = trie.prove_non_existence(&missing_key).unwrap();

        // Convert to wire format
        let slot = 12345u64;
        let wire_data = non_existence_proof.to_wire(slot);

        // Verify the header structure
        assert!(wire_data.len() >= 40); // At least header size

        // Extract and verify type_slot
        let type_slot = u64::from_le_bytes([
            wire_data[0],
            wire_data[1],
            wire_data[2],
            wire_data[3],
            wire_data[4],
            wire_data[5],
            wire_data[6],
            wire_data[7],
        ]);

        // Verify slot and type
        let extracted_slot = type_slot & 0x3FFFFFFFFFFFFFFF; // Low 62 bits
        let extracted_type = (type_slot >> 62) & 0x3; // High 2 bits
        assert_eq!(extracted_slot, slot);
        assert_eq!(extracted_type, 2); // CREATION type

        // Verify path bitset is present (32 bytes)
        assert!(wire_data.len() >= 40);

        // Verify body contains existing pubkey (32 bytes) + existing hash (32 bytes) + sibling hashes
        let expected_body_size = 64 + non_existence_proof.proof.sibling_hashes.len() * 32;
        assert_eq!(wire_data.len(), 40 + expected_body_size);

        // Verify existing pubkey in body
        let body_start = 40;
        let pubkey_bytes = &wire_data[body_start..body_start + 32];
        assert_eq!(pubkey_bytes, non_existence_proof.existing_pubkey.as_bytes());

        // Verify existing hash in body
        let hash_bytes = &wire_data[body_start + 32..body_start + 64];
        assert_eq!(hash_bytes, non_existence_proof.existing_hash.as_bytes());
    }

    #[test]
    fn test_empty_trie_non_existence_proof_to_wire() {
        let trie = BinTrie::new();
        let missing_key = test_pubkey(1);
        let non_existence_proof = trie.prove_non_existence(&missing_key).unwrap();

        // Empty trie should have empty proof
        assert!(non_existence_proof.proof.proof_indices.is_empty());
        assert!(non_existence_proof.proof.sibling_hashes.is_empty());
        assert!(non_existence_proof.existing_pubkey.is_zero());
        assert!(non_existence_proof.existing_hash.is_zero());

        // Convert to wire format
        let slot = 0u64;
        let wire_data = non_existence_proof.to_wire(slot);

        // Should have header (40 bytes) + existing pubkey (32) + existing hash (32) + no sibling hashes
        assert_eq!(wire_data.len(), 40 + 64);

        // Verify type_slot
        let type_slot = u64::from_le_bytes([
            wire_data[0],
            wire_data[1],
            wire_data[2],
            wire_data[3],
            wire_data[4],
            wire_data[5],
            wire_data[6],
            wire_data[7],
        ]);
        assert_eq!(type_slot & 0x3FFFFFFFFFFFFFFF, slot);
        assert_eq!((type_slot >> 62) & 0x3, 2); // CREATION type

        // Verify path bitset is all zeros (empty proof)
        let path_bitset = &wire_data[8..40];
        assert!(path_bitset.iter().all(|&b| b == 0));

        // Verify body contains zero pubkey and hash
        let pubkey_bytes = &wire_data[40..72];
        let hash_bytes = &wire_data[72..104];
        assert!(pubkey_bytes.iter().all(|&b| b == 0));
        assert!(hash_bytes.iter().all(|&b| b == 0));
    }

    #[test]
    fn test_path_bitset_encoding() {
        // Test the path bitset encoding matches C implementation
        let mut trie = BinTrie::new();

        // Insert keys with specific bit patterns to create predictable proof indices
        let key1 = test_pubkey(0b000); // All zeros initially
        let key2 = test_pubkey(0b100); // Differs at bit 2
        trie.insert(key1, test_hash(1)).unwrap();
        trie.insert(key2, test_hash(2)).unwrap();

        // Prove non-existence of a key that would create a specific proof path
        let missing_key = test_pubkey(0b010); // Differs at bit 1
        let non_existence_proof = trie.prove_non_existence(&missing_key).unwrap();

        // Convert to wire format
        let wire_data = non_existence_proof.to_wire(0);

        // Extract path bitset
        let path_bitset = &wire_data[8..40];

        // Manually verify that the bits are set correctly
        // The proof indices should be encoded in the bitset
        for &idx in &non_existence_proof.proof.proof_indices {
            let bit_idx = (idx % 64) as usize;
            let word_idx = (idx / 64) as usize;
            if word_idx < 4 {
                let start = word_idx * 8;
                let word_bytes = &path_bitset[start..start + 8];
                let word = u64::from_le_bytes([
                    word_bytes[0],
                    word_bytes[1],
                    word_bytes[2],
                    word_bytes[3],
                    word_bytes[4],
                    word_bytes[5],
                    word_bytes[6],
                    word_bytes[7],
                ]);
                assert!(
                    (word >> bit_idx) & 1 == 1,
                    "Bit {} should be set in word {}",
                    bit_idx,
                    word_idx
                );
            }
        }
    }
}
