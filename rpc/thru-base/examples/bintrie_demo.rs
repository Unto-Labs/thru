use thru_base::bintrie::*;
use thru_base::bintrie_types::{Hash, Pubkey};

fn main() {
    println!("Binary Trie Demo");
    println!("================");

    // Create a new empty trie
    let mut trie = BinTrie::new();

    // Create some test keys and values
    let key1 = Pubkey::new([1u8; 32]);
    let value1 = Hash::new([11u8; 32]);

    let key2 = Pubkey::new([2u8; 32]);
    let value2 = Hash::new([22u8; 32]);

    let key3 = Pubkey::new([3u8; 32]);
    let value3 = Hash::new([33u8; 32]);

    // Insert keys into the trie
    println!("\n1. Inserting keys into the trie:");
    trie.insert(key1, value1).expect("Failed to insert key1");
    println!("Inserted key1");

    trie.insert(key2, value2).expect("Failed to insert key2");
    println!("Inserted key2");

    trie.insert(key3, value3).expect("Failed to insert key3");
    println!("Inserted key3");

    // Display the trie structure
    println!("\n2. Trie structure:");
    trie.print();

    // Query for keys
    println!("\n3. Querying keys:");
    match trie.query(&key1) {
        Some(pair) => println!("Found key1 with value: {}", pair.value_hash),
        None => println!("Key1 not found"),
    }

    match trie.query(&key2) {
        Some(pair) => println!("Found key2 with value: {}", pair.value_hash),
        None => println!("Key2 not found"),
    }

    // Try to query a non-existent key
    let missing_key = Pubkey::new([99u8; 32]);
    match trie.query(&missing_key) {
        Some(pair) => println!("Found missing key with value: {}", pair.value_hash),
        None => println!("Missing key not found (as expected)"),
    }

    // Generate proofs
    println!("\n4. Generating proofs:");

    // Proof of existence
    match trie.prove_existence(&key1) {
        Ok((proof, value_hash)) => {
            println!("Generated existence proof for key1:");
            println!("  - Proof steps: {}", proof.proof_indices.len());
            println!("  - Value hash: {}", value_hash);
        }
        Err(e) => println!("Failed to generate existence proof: {}", e),
    }

    // Proof of non-existence
    match trie.prove_non_existence(&missing_key) {
        Ok(non_existence_proof) => {
            println!("Generated non-existence proof for missing key:");
            println!(
                "  - Proof steps: {}",
                non_existence_proof.proof.proof_indices.len()
            );
            println!("  - Existing key: {}", non_existence_proof.existing_pubkey);
        }
        Err(e) => println!("Failed to generate non-existence proof: {}", e),
    }

    // Update a value
    println!("\n5. Updating a value:");
    let new_value1 = Hash::new([111u8; 32]);
    trie.update_hash(&key1, new_value1)
        .expect("Failed to update key1");
    match trie.query(&key1) {
        Some(pair) => println!("Updated key1 value: {}", pair.value_hash),
        None => println!("Key1 not found after update"),
    }

    // Show final state root
    println!("\n6. Final state root: {}", trie.state_root());

    println!("\nDemo completed!");
}
