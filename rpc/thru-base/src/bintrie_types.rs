use std::fmt;

use crate::bintrie_error::BinTrieError;
use crate::tn_public_address::tn_public_address_encode;

/// 32-byte hash value compatible with the C implementation
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Hash(pub [u8; 32]);

/// 32-byte public key value compatible with the C implementation
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Pubkey(pub [u8; 32]);

impl Hash {
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn from_slice(slice: &[u8]) -> Result<Self, BinTrieError> {
        if slice.len() != 32 {
            return Err(BinTrieError::InvalidHashLength);
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(slice);
        Ok(Self(bytes))
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }
}

impl Pubkey {
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn from_slice(slice: &[u8]) -> Result<Self, BinTrieError> {
        if slice.len() != 32 {
            return Err(BinTrieError::InvalidPubkeyLength);
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(slice);
        Ok(Self(bytes))
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }

    /// Get the bit at the specified index (0-255)
    /// This matches the C implementation: (pubkey->ul[idx/64] >> (idx%64)) & 1UL
    pub fn get_bit(&self, bit_idx: u8) -> bool {
        let qword_idx = (bit_idx / 64) as usize;
        let bit_offset = bit_idx % 64;
        if qword_idx >= 4 {
            return false;
        }
        // Convert to u64 manually to match C implementation
        let mut qwords = [0u64; 4];
        for i in 0..4 {
            let start = i * 8;
            qwords[i] = u64::from_le_bytes([
                self.0[start],
                self.0[start + 1],
                self.0[start + 2],
                self.0[start + 3],
                self.0[start + 4],
                self.0[start + 5],
                self.0[start + 6],
                self.0[start + 7],
            ]);
        }
        (qwords[qword_idx] >> bit_offset) & 1 == 1
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(&self.0))
    }
}

impl fmt::Display for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(&self.0))
    }
}

impl fmt::Debug for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(&self.0))
    }
}

impl fmt::Debug for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut out = [0u8; 46];
        tn_public_address_encode(&mut out, &self.0);
        write!(
            f,
            "{}(0x{})",
            String::from_utf8_lossy(&out).to_string(),
            hex::encode(&self.0)
        )
    }
}
