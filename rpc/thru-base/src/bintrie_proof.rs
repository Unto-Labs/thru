use crate::bintrie_types::{Hash, Pubkey};

// State proof type constants (matching C implementation in tn_state_proof.h)
pub const TN_STATE_PROOF_TYPE_EXISTING: u64 = 0x0;
pub const TN_STATE_PROOF_TYPE_UPDATING: u64 = 0x1;
pub const TN_STATE_PROOF_TYPE_CREATION: u64 = 0x2;

/// Proof structure for existence/non-existence proofs
#[derive(Debug, Clone)]
pub struct Proof {
    pub proof_indices: Vec<u8>,
    pub sibling_hashes: Vec<Hash>,
    pub existing_leaf_hash: Option<Hash>,
}

impl Proof {
    pub fn new() -> Self {
        Self {
            proof_indices: Vec::new(),
            sibling_hashes: Vec::new(),
            existing_leaf_hash: None,
        }
    }
    pub fn to_wire(&self, slot: u64) -> Vec<u8> {
        // Convert proof indices to path bitset (matching C tn_state_proof_idx_list_to_path_bitset)
        let mut path_bitset = [0u8; 32];
        for &idx in &self.proof_indices {
            let bit_idx = (idx % 64) as usize;
            let word_idx = (idx / 64) as usize;
            if word_idx < 4 {
                // Convert to little-endian u64 array like C implementation
                let start = word_idx * 8;
                let mut word_bytes = [0u8; 8];
                word_bytes.copy_from_slice(&path_bitset[start..start + 8]);
                let mut word = u64::from_le_bytes(word_bytes);
                word |= 1u64 << bit_idx;
                path_bitset[start..start + 8].copy_from_slice(&word.to_le_bytes());
            }
        }

        // Create header: type_slot (8 bytes) + path_bitset (32 bytes)
        let mut result = Vec::with_capacity(40 + 64 + self.sibling_hashes.len() * 32);

        // Encode type_slot: slot in low 62 bits, type (EXISTING=0) in high 2 bits
        let type_slot = slot
            | (if self.existing_leaf_hash.is_some() {
                TN_STATE_PROOF_TYPE_UPDATING
            } else {
                TN_STATE_PROOF_TYPE_EXISTING
            } << 62);
        result.extend_from_slice(&type_slot.to_le_bytes());

        // Add path bitset
        result.extend_from_slice(&path_bitset);

        if let Some(existing_leaf_hash) = self.existing_leaf_hash {
            result.extend_from_slice(existing_leaf_hash.as_bytes());
        }

        for sibling_hash in &self.sibling_hashes {
            result.extend_from_slice(sibling_hash.as_bytes());
        }

        result
    }
}

/// Result of a non-existence proof
#[derive(Debug, Clone)]
pub struct NonExistenceProof {
    pub proof: Proof,
    pub existing_pubkey: Pubkey,
    pub existing_hash: Hash,
}

impl NonExistenceProof {
    /// Convert the non-existence proof to wire format compatible with C tn_state_proof_t
    /// This creates a CREATION type state proof with the proof data
    ///
    /// Wire format layout:
    /// - Header (40 bytes):
    ///   - type_slot (8 bytes): slot in low 62 bits, proof type (2=CREATION) in high 2 bits
    ///   - path_bitset (32 bytes): bitset indicating which proof indices are used
    /// - Body (variable length):
    ///   - existing_leaf_pubkey (32 bytes): pubkey of the existing leaf found
    ///   - existing_leaf_hash (32 bytes): hash of the existing leaf value
    ///   - sibling_hashes (32 * n bytes): sibling hashes for the proof path
    ///
    /// # Arguments
    /// * `slot` - The slot number to encode in the proof header
    ///
    /// # Returns
    /// A Vec<u8> containing the binary representation compatible with C tn_state_proof_t
    ///
    /// # Example
    /// ```
    /// use thru_base::bintrie::BinTrie;
    /// use thru_base::bintrie_types::{Pubkey, Hash};
    ///
    /// let mut trie = BinTrie::new();
    /// let existing_key = Pubkey::new([1u8; 32]);
    /// let existing_value = Hash::new([2u8; 32]);
    /// trie.insert(existing_key, existing_value).unwrap();
    ///
    /// let missing_key = Pubkey::new([3u8; 32]);
    /// let proof = trie.prove_non_existence(&missing_key).unwrap();
    ///
    /// let wire_data = proof.to_wire(12345);
    /// assert!(wire_data.len() >= 104); // At least header + existing pubkey + hash
    /// ```
    pub fn to_wire(&self, slot: u64) -> Vec<u8> {
        // Convert proof indices to path bitset (matching C tn_state_proof_idx_list_to_path_bitset)
        let mut path_bitset = [0u8; 32];
        for &idx in &self.proof.proof_indices {
            let bit_idx = (idx % 64) as usize;
            let word_idx = (idx / 64) as usize;
            if word_idx < 4 {
                // Convert to little-endian u64 array like C implementation
                let start = word_idx * 8;
                let mut word_bytes = [0u8; 8];
                word_bytes.copy_from_slice(&path_bitset[start..start + 8]);
                let mut word = u64::from_le_bytes(word_bytes);
                word |= 1u64 << bit_idx;
                path_bitset[start..start + 8].copy_from_slice(&word.to_le_bytes());
            }
        }

        // Create header: type_slot (8 bytes) + path_bitset (32 bytes)
        let mut result = Vec::with_capacity(40 + 64 + self.proof.sibling_hashes.len() * 32);

        // Encode type_slot: slot in low 62 bits, type (CREATION=2) in high 2 bits
        let type_slot = slot | (TN_STATE_PROOF_TYPE_CREATION << 62);
        result.extend_from_slice(&type_slot.to_le_bytes());

        // Add path bitset
        result.extend_from_slice(&path_bitset);

        // Add body for CREATION type:
        // 1. existing_leaf_pubkey (32 bytes)
        // 2. existing_leaf_hash (32 bytes)
        // 3. sibling_hashes (32 bytes each)
        result.extend_from_slice(self.existing_pubkey.as_bytes());
        result.extend_from_slice(self.existing_hash.as_bytes());

        for sibling_hash in &self.proof.sibling_hashes {
            result.extend_from_slice(sibling_hash.as_bytes());
        }

        result
    }
}
