//! State proof structures and utilities
//!
//! Rust equivalent of the C tn_state_proof.h structures

use crate::txn_lib::{
    TN_STATE_PROOF_TYPE_CREATION, TN_STATE_PROOF_TYPE_EXISTING, TN_STATE_PROOF_TYPE_UPDATING,
    TnHash, TnPubkey,
};

/// Maximum number of keys in a state proof
pub const TN_STATE_PROOF_KEYS_MAX: usize = 256;

/// State proof type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateProofType {
    Existing = 0,
    Updating = 1,
    Creation = 2,
}

impl StateProofType {
    /// Convert from u64 value
    pub fn from_u64(value: u64) -> Option<Self> {
        match value {
            TN_STATE_PROOF_TYPE_EXISTING => Some(Self::Existing),
            TN_STATE_PROOF_TYPE_UPDATING => Some(Self::Updating),
            TN_STATE_PROOF_TYPE_CREATION => Some(Self::Creation),
            _ => None,
        }
    }

    /// Convert to u64 value
    pub fn to_u64(self) -> u64 {
        match self {
            Self::Existing => TN_STATE_PROOF_TYPE_EXISTING,
            Self::Updating => TN_STATE_PROOF_TYPE_UPDATING,
            Self::Creation => TN_STATE_PROOF_TYPE_CREATION,
        }
    }
}

/// State proof header
#[derive(Debug, Clone)]
pub struct StateProofHeader {
    pub proof_type: StateProofType,
    pub slot: u64,
    pub path_bitset: TnHash,
}

impl StateProofHeader {
    /// Create a new state proof header
    pub fn new(proof_type: StateProofType, slot: u64, path_bitset: TnHash) -> Self {
        Self {
            proof_type,
            slot,
            path_bitset,
        }
    }

    /// Encode type and slot into type_slot field
    pub fn encode_type_slot(&self) -> u64 {
        self.slot | (self.proof_type.to_u64() << 62)
    }

    /// Decode type_slot field into type and slot
    pub fn decode_type_slot(type_slot: u64) -> (StateProofType, u64) {
        let proof_type =
            StateProofType::from_u64((type_slot >> 62) & 0x3).unwrap_or(StateProofType::Existing);
        let slot = type_slot & 0x3FFFFFFFFFFFFFFF; // Extract low 62 bits
        (proof_type, slot)
    }

    /// Serialize header to bytes
    pub fn to_wire(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(40);
        result.extend_from_slice(&self.encode_type_slot().to_le_bytes());
        result.extend_from_slice(&self.path_bitset);
        result
    }

    /// Deserialize header from bytes
    pub fn from_wire(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 40 {
            return None;
        }

        let type_slot = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);

        let (proof_type, slot) = Self::decode_type_slot(type_slot);

        let mut path_bitset = [0u8; 32];
        path_bitset.copy_from_slice(&bytes[8..40]);

        Some(Self {
            proof_type,
            slot,
            path_bitset,
        })
    }
}

/// State proof body variants
#[derive(Debug, Clone)]
pub enum StateProofBody {
    /// For existing entries - just sibling hashes
    Existing { sibling_hashes: Vec<TnHash> },
    /// For updating entries - existing leaf hash + sibling hashes
    Updating {
        existing_leaf_hash: TnHash,
        sibling_hashes: Vec<TnHash>,
    },
    /// For creation entries - existing leaf pubkey and hash + sibling hashes
    Creation {
        existing_leaf_pubkey: TnPubkey,
        existing_leaf_hash: TnHash,
        sibling_hashes: Vec<TnHash>,
    },
}

impl StateProofBody {
    /// Get the number of sibling hashes
    pub fn sibling_hash_count(&self) -> usize {
        match self {
            StateProofBody::Existing { sibling_hashes } => sibling_hashes.len(),
            StateProofBody::Updating { sibling_hashes, .. } => sibling_hashes.len(),
            StateProofBody::Creation { sibling_hashes, .. } => sibling_hashes.len(),
        }
    }

    /// Calculate the number of hashes this body contains (for footprint calculation)
    pub fn hash_count(&self) -> usize {
        match self {
            StateProofBody::Existing { sibling_hashes } => sibling_hashes.len(),
            StateProofBody::Updating { sibling_hashes, .. } => 1 + sibling_hashes.len(),
            StateProofBody::Creation { sibling_hashes, .. } => 2 + sibling_hashes.len(),
        }
    }

    /// Serialize body to bytes
    pub fn to_wire(&self) -> Vec<u8> {
        let mut result = Vec::new();

        match self {
            StateProofBody::Existing { sibling_hashes } => {
                for hash in sibling_hashes {
                    result.extend_from_slice(hash);
                }
            }
            StateProofBody::Updating {
                existing_leaf_hash,
                sibling_hashes,
            } => {
                result.extend_from_slice(existing_leaf_hash);
                for hash in sibling_hashes {
                    result.extend_from_slice(hash);
                }
            }
            StateProofBody::Creation {
                existing_leaf_pubkey,
                existing_leaf_hash,
                sibling_hashes,
            } => {
                result.extend_from_slice(existing_leaf_pubkey);
                result.extend_from_slice(existing_leaf_hash);
                for hash in sibling_hashes {
                    result.extend_from_slice(hash);
                }
            }
        }

        result
    }

    /// Deserialize body from bytes given the proof type and sibling hash count
    pub fn from_wire(
        bytes: &[u8],
        proof_type: StateProofType,
        sibling_hash_count: usize,
    ) -> Option<Self> {
        let mut offset = 0;

        match proof_type {
            StateProofType::Existing => {
                if bytes.len() < sibling_hash_count * 32 {
                    return None;
                }

                let mut sibling_hashes = Vec::with_capacity(sibling_hash_count);
                for _ in 0..sibling_hash_count {
                    let mut hash = [0u8; 32];
                    hash.copy_from_slice(&bytes[offset..offset + 32]);
                    sibling_hashes.push(hash);
                    offset += 32;
                }

                Some(StateProofBody::Existing { sibling_hashes })
            }
            StateProofType::Updating => {
                if bytes.len() < 32 + sibling_hash_count * 32 {
                    return None;
                }

                let mut existing_leaf_hash = [0u8; 32];
                existing_leaf_hash.copy_from_slice(&bytes[offset..offset + 32]);
                offset += 32;

                let mut sibling_hashes = Vec::with_capacity(sibling_hash_count);
                for _ in 0..sibling_hash_count {
                    let mut hash = [0u8; 32];
                    hash.copy_from_slice(&bytes[offset..offset + 32]);
                    sibling_hashes.push(hash);
                    offset += 32;
                }

                Some(StateProofBody::Updating {
                    existing_leaf_hash,
                    sibling_hashes,
                })
            }
            StateProofType::Creation => {
                if bytes.len() < 64 + sibling_hash_count * 32 {
                    return None;
                }

                let mut existing_leaf_pubkey = [0u8; 32];
                existing_leaf_pubkey.copy_from_slice(&bytes[offset..offset + 32]);
                offset += 32;

                let mut existing_leaf_hash = [0u8; 32];
                existing_leaf_hash.copy_from_slice(&bytes[offset..offset + 32]);
                offset += 32;

                let mut sibling_hashes = Vec::with_capacity(sibling_hash_count);
                for _ in 0..sibling_hash_count {
                    let mut hash = [0u8; 32];
                    hash.copy_from_slice(&bytes[offset..offset + 32]);
                    sibling_hashes.push(hash);
                    offset += 32;
                }

                Some(StateProofBody::Creation {
                    existing_leaf_pubkey,
                    existing_leaf_hash,
                    sibling_hashes,
                })
            }
        }
    }
}

/// Complete state proof structure
#[derive(Debug, Clone)]
pub struct StateProof {
    pub header: StateProofHeader,
    pub body: StateProofBody,
}

impl StateProof {
    /// Create a new state proof
    pub fn new(header: StateProofHeader, body: StateProofBody) -> Self {
        Self { header, body }
    }

    /// Create a zeroed creation state proof
    pub fn zero_creation(slot: u64) -> Self {
        let header = StateProofHeader::new(StateProofType::Creation, slot, [0u8; 32]);
        let body = StateProofBody::Creation {
            existing_leaf_pubkey: [0u8; 32],
            existing_leaf_hash: [0u8; 32],
            sibling_hashes: vec![],
        };
        Self { header, body }
    }

    /// Create an existing state proof
    pub fn existing(slot: u64, path_bitset: TnHash, sibling_hashes: Vec<TnHash>) -> Self {
        let header = StateProofHeader::new(StateProofType::Existing, slot, path_bitset);
        let body = StateProofBody::Existing { sibling_hashes };
        Self { header, body }
    }

    /// Create an updating state proof
    pub fn updating(
        slot: u64,
        path_bitset: TnHash,
        existing_leaf_hash: TnHash,
        sibling_hashes: Vec<TnHash>,
    ) -> Self {
        let header = StateProofHeader::new(StateProofType::Updating, slot, path_bitset);
        let body = StateProofBody::Updating {
            existing_leaf_hash,
            sibling_hashes,
        };
        Self { header, body }
    }

    /// Create a creation state proof
    pub fn creation(
        slot: u64,
        path_bitset: TnHash,
        existing_leaf_pubkey: TnPubkey,
        existing_leaf_hash: TnHash,
        sibling_hashes: Vec<TnHash>,
    ) -> Self {
        let header = StateProofHeader::new(StateProofType::Creation, slot, path_bitset);
        let body = StateProofBody::Creation {
            existing_leaf_pubkey,
            existing_leaf_hash,
            sibling_hashes,
        };
        Self { header, body }
    }

    /// Calculate the footprint (size in bytes) when serialized
    pub fn footprint(&self) -> usize {
        // Header is always 40 bytes (8 bytes type_slot + 32 bytes path_bitset)
        let header_size = 40;
        // Body size is number of hashes * 32 bytes per hash
        let body_size = self.body.hash_count() * 32;
        header_size + body_size
    }

    /// Calculate footprint from proof type and sibling hash count
    pub fn footprint_from_counts(proof_type: StateProofType, sibling_hash_count: usize) -> usize {
        let header_size = 40;
        let body_hash_count = match proof_type {
            StateProofType::Existing => sibling_hash_count,
            StateProofType::Updating => 1 + sibling_hash_count,
            StateProofType::Creation => 2 + sibling_hash_count,
        };
        header_size + body_hash_count * 32
    }

    /// Calculate footprint from path bitset (count set bits for sibling hashes)
    pub fn footprint_from_header(header: &StateProofHeader) -> usize {
        let sibling_hash_count = count_set_bits(&header.path_bitset);
        Self::footprint_from_counts(header.proof_type, sibling_hash_count)
    }

    /// Serialize to wire format
    pub fn to_wire(&self) -> Vec<u8> {
        let mut result = self.header.to_wire();
        result.extend_from_slice(&self.body.to_wire());
        result
    }

    /// Deserialize from wire format
    pub fn from_wire(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 40 {
            return None;
        }

        let header = StateProofHeader::from_wire(&bytes[0..40])?;
        let sibling_hash_count = count_set_bits(&header.path_bitset);

        let body_bytes = &bytes[40..];
        let body = StateProofBody::from_wire(body_bytes, header.proof_type, sibling_hash_count)?;

        Some(Self { header, body })
    }

    /// Get the proof type
    pub fn proof_type(&self) -> StateProofType {
        self.header.proof_type
    }

    /// Get the slot
    pub fn slot(&self) -> u64 {
        self.header.slot
    }

    /// Get the path bitset
    pub fn path_bitset(&self) -> &TnHash {
        &self.header.path_bitset
    }
}

/// Count the number of set bits in a hash (used for calculating sibling hash count)
fn count_set_bits(hash: &TnHash) -> usize {
    let mut count = 0;
    for i in 0..4 {
        let start = i * 8;
        let word = u64::from_le_bytes([
            hash[start],
            hash[start + 1],
            hash[start + 2],
            hash[start + 3],
            hash[start + 4],
            hash[start + 5],
            hash[start + 6],
            hash[start + 7],
        ]);
        count += word.count_ones() as usize;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_proof_type_conversion() {
        assert_eq!(
            StateProofType::Existing.to_u64(),
            TN_STATE_PROOF_TYPE_EXISTING
        );
        assert_eq!(
            StateProofType::Updating.to_u64(),
            TN_STATE_PROOF_TYPE_UPDATING
        );
        assert_eq!(
            StateProofType::Creation.to_u64(),
            TN_STATE_PROOF_TYPE_CREATION
        );

        assert_eq!(
            StateProofType::from_u64(TN_STATE_PROOF_TYPE_EXISTING),
            Some(StateProofType::Existing)
        );
        assert_eq!(
            StateProofType::from_u64(TN_STATE_PROOF_TYPE_UPDATING),
            Some(StateProofType::Updating)
        );
        assert_eq!(
            StateProofType::from_u64(TN_STATE_PROOF_TYPE_CREATION),
            Some(StateProofType::Creation)
        );
        assert_eq!(StateProofType::from_u64(999), None);
    }

    #[test]
    fn test_header_type_slot_encoding() {
        let header = StateProofHeader::new(StateProofType::Creation, 0x1FFFFFFFFFFFFFFF, [0u8; 32]);
        let encoded = header.encode_type_slot();
        let (decoded_type, decoded_slot) = StateProofHeader::decode_type_slot(encoded);

        assert_eq!(decoded_type, StateProofType::Creation);
        assert_eq!(decoded_slot, 0x1FFFFFFFFFFFFFFF);
    }

    #[test]
    fn test_header_serialization() {
        let path_bitset = [1u8; 32];
        let header = StateProofHeader::new(StateProofType::Updating, 12345, path_bitset);

        let serialized = header.to_wire();
        assert_eq!(serialized.len(), 40);

        let deserialized = StateProofHeader::from_wire(&serialized).unwrap();
        assert_eq!(deserialized.proof_type, StateProofType::Updating);
        assert_eq!(deserialized.slot, 12345);
        assert_eq!(deserialized.path_bitset, path_bitset);
    }

    #[test]
    fn test_existing_proof_serialization() {
        let sibling_hashes = vec![[1u8; 32], [2u8; 32]];
        // Create a path_bitset with 2 bits set to match the 2 sibling hashes
        let mut path_bitset = [0u8; 32];
        path_bitset[0] = 0b11; // Set first 2 bits
        let proof = StateProof::existing(100, path_bitset, sibling_hashes.clone());

        assert_eq!(proof.footprint(), 40 + 2 * 32); // header + 2 hashes

        let serialized = proof.to_wire();
        let deserialized = StateProof::from_wire(&serialized).unwrap();

        assert_eq!(deserialized.proof_type(), StateProofType::Existing);
        assert_eq!(deserialized.slot(), 100);

        if let StateProofBody::Existing {
            sibling_hashes: deser_hashes,
        } = deserialized.body
        {
            assert_eq!(deser_hashes, sibling_hashes);
        } else {
            panic!("Expected Existing proof body");
        }
    }

    #[test]
    fn test_creation_proof_serialization() {
        let existing_leaf_pubkey = [3u8; 32];
        let existing_leaf_hash = [4u8; 32];
        let sibling_hashes = vec![[5u8; 32]];

        // Create a path_bitset with 1 bit set to match the 1 sibling hash
        let mut path_bitset = [0u8; 32];
        path_bitset[0] = 0b1; // Set first bit

        let proof = StateProof::creation(
            200,
            path_bitset,
            existing_leaf_pubkey,
            existing_leaf_hash,
            sibling_hashes.clone(),
        );

        assert_eq!(proof.footprint(), 40 + 3 * 32); // header + pubkey + hash + 1 sibling

        let serialized = proof.to_wire();
        let deserialized = StateProof::from_wire(&serialized).unwrap();

        assert_eq!(deserialized.proof_type(), StateProofType::Creation);
        assert_eq!(deserialized.slot(), 200);

        if let StateProofBody::Creation {
            existing_leaf_pubkey: deser_pubkey,
            existing_leaf_hash: deser_hash,
            sibling_hashes: deser_hashes,
        } = deserialized.body
        {
            assert_eq!(deser_pubkey, existing_leaf_pubkey);
            assert_eq!(deser_hash, existing_leaf_hash);
            assert_eq!(deser_hashes, sibling_hashes);
        } else {
            panic!("Expected Creation proof body");
        }
    }

    #[test]
    fn test_count_set_bits() {
        let mut hash = [0u8; 32];
        assert_eq!(count_set_bits(&hash), 0);

        hash[0] = 0b10101010; // 4 bits set
        hash[1] = 0b11110000; // 4 bits set
        assert_eq!(count_set_bits(&hash), 8);
    }

    #[test]
    fn test_footprint_calculation() {
        assert_eq!(
            StateProof::footprint_from_counts(StateProofType::Existing, 5),
            40 + 5 * 32
        );
        assert_eq!(
            StateProof::footprint_from_counts(StateProofType::Updating, 3),
            40 + 4 * 32
        );
        assert_eq!(
            StateProof::footprint_from_counts(StateProofType::Creation, 2),
            40 + 4 * 32
        );
    }
}
