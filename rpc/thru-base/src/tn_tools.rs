use crate::tn_public_address;
use crate::txn_lib::TnPubkey;
use crate::{tn_public_address::tn_pubkey_to_address_string, tn_signature_encoding};
use anyhow::Result;
use ed25519_dalek::SigningKey;
use hex;
use rand::TryRngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fmt;

use thiserror::Error;

pub fn gen_key() -> Result<[u8; 32]> {
    let mut private_key = [0u8; 32];
    let mut rng = OsRng;
    rng.try_fill_bytes(&mut private_key).unwrap();
    Ok(private_key)
}

#[derive(Debug, Clone)]
pub struct KeyPair {
    pub name: String,
    pub private_key: [u8; 32],
    pub public_key: TnPubkey,
    pub address_string: Pubkey,
}

impl KeyPair {
    pub fn generate(name: &str) -> Result<Self> {
        // Generate new key
        let mut private_key = [0u8; 32];
        let mut rng = OsRng;
        rng.try_fill_bytes(&mut private_key)?;
        // Derive public key
        let signing_key = SigningKey::from_bytes(&private_key);
        let verifying_key = signing_key.verifying_key();
        let public_key = verifying_key.to_bytes();

        // Generate proper ta... address string using thru-base utilities
        let address_string = Pubkey::from_bytes(&public_key);

        Ok(Self {
            name: name.to_string(),
            private_key,
            public_key,
            address_string,
        })
    }

    pub fn from_hex_private_key<P: AsRef<[u8]>>(name: &str, hex_private_key: P) -> Result<Self> {
        // Convert hex string to 32-byte array
        let private_key_bytes = hex::decode(hex_private_key)
            .map_err(|e| anyhow::anyhow!("Failed to decode hex private key: {}", e))?;

        if private_key_bytes.len() != 32 {
            return Err(anyhow::anyhow!(
                "Private key must be 32 bytes, got {}",
                private_key_bytes.len()
            ));
        }

        let mut private_key = [0u8; 32];
        private_key.copy_from_slice(&private_key_bytes);

        // Derive public key
        let signing_key = SigningKey::from_bytes(&private_key);
        let verifying_key = signing_key.verifying_key();
        let public_key = verifying_key.to_bytes();

        // Generate proper ta... address string using thru-base utilities
        let address_string = Pubkey::from_bytes(&public_key);

        Ok(Self {
            name: name.to_string(),
            private_key,
            public_key,
            address_string,
        })
    }

    pub fn public_key_hex(&self) -> String {
        hex::encode(self.public_key)
    }
    pub fn public_key_str(&self) -> String {
        tn_pubkey_to_address_string(&self.public_key)
    }
}

/// A public key on the blockchain
///
/// Public keys in Thru are encoded as 46-character strings starting with "ta"
/// using a custom base64-url encoding with checksum validation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Pubkey(String);

impl Pubkey {
    /// Create a new public key from a string
    ///
    /// The string must be a valid 46-character Thru address starting with "ta"
    pub fn new(key: String) -> Result<Self> {
        // Basic validation
        if key.is_empty() {
            return Err(ValidationError::InvalidPubkey("empty pubkey".to_string()).into());
        }

        // Validate format: should be 46 characters starting with "ta"
        if key.len() != 46 {
            return Err(ValidationError::InvalidPubkey(format!(
                "invalid pubkey length: expected 46, got {}",
                key.len()
            ))
            .into());
        }

        if !key.starts_with("ta") {
            return Err(
                ValidationError::InvalidPubkey("pubkey must start with 'ta'".to_string()).into(),
            );
        }

        // Validate by attempting to decode
        let mut decoded = [0u8; 32];
        match tn_public_address::tn_public_address_decode(&mut decoded, key.as_bytes()) {
            Ok(()) => Ok(Self(key)),
            Err(code) => Err(ValidationError::InvalidPubkey(format!(
                "invalid pubkey format: decode error {}",
                code
            ))
            .into()),
        }
    }

    /// Get the public key as a string
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Convert to bytes (decode the address)
    pub fn to_bytes(&self) -> Result<[u8; 32]> {
        let mut bytes = [0u8; 32];
        match tn_public_address::tn_public_address_decode(&mut bytes, self.0.as_bytes()) {
            Ok(()) => Ok(bytes),
            Err(code) => Err(ValidationError::InvalidPubkey(format!(
                "failed to decode pubkey: error {}",
                code
            ))
            .into()),
        }
    }

    /// Create a Pubkey from raw bytes
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let address = tn_public_address::tn_pubkey_to_address_string(bytes);
        // This should never fail since we're encoding from valid bytes
        Self(address)
    }
}

impl fmt::Display for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A transaction signature
///
/// Signatures in Thru are encoded as 90-character strings starting with "ts"
/// using a custom base64-url encoding with checksum validation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Signature(String);

impl Signature {
    /// Create a new signature from a string
    ///
    /// The string must be a valid 90-character Thru signature starting with "ts"
    pub fn new(sig: String) -> Result<Self> {
        // Basic validation
        if sig.is_empty() {
            return Err(ValidationError::InvalidSignature("empty signature".to_string()).into());
        }

        // Validate format: should be 90 characters starting with "ts"
        if sig.len() != 90 {
            return Err(ValidationError::InvalidSignature(format!(
                "invalid signature length: expected 90, got {}",
                sig.len()
            ))
            .into());
        }

        if !sig.starts_with("ts") {
            return Err(ValidationError::InvalidSignature(
                "signature must start with 'ts'".to_string(),
            )
            .into());
        }

        // Validate by attempting to decode
        let mut decoded = [0u8; 64];
        match tn_signature_encoding::tn_signature_decode(&mut decoded, sig.as_bytes()) {
            Ok(()) => Ok(Self(sig)),
            Err(code) => Err(ValidationError::InvalidSignature(format!(
                "invalid signature format: decode error {}",
                code
            ))
            .into()),
        }
    }

    /// Get the signature as a string
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Convert to bytes (decode the signature)
    pub fn to_bytes(&self) -> Result<[u8; 64]> {
        let mut bytes = [0u8; 64];
        match tn_signature_encoding::tn_signature_decode(&mut bytes, self.0.as_bytes()) {
            Ok(()) => Ok(bytes),
            Err(code) => Err(ValidationError::InvalidSignature(format!(
                "failed to decode signature: error {}",
                code
            ))
            .into()),
        }
    }

    /// Create a Signature from raw bytes
    pub fn from_bytes(bytes: &[u8; 64]) -> Self {
        let signature = tn_signature_encoding::tn_signature_to_string(bytes);
        // This should never fail since we're encoding from valid bytes
        Self(signature)
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Validation errors for input data
#[derive(Error, Debug)]
pub enum ValidationError {
    /// Invalid public key format
    #[error("Invalid public key: {0}")]
    InvalidPubkey(String),

    /// Invalid signature format
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_pubkey_validation() {
        // Create a valid pubkey using the encoding function
        let bytes = [1u8; 32];
        let valid_pubkey = tn_public_address::tn_pubkey_to_address_string(&bytes);
        assert!(Pubkey::new(valid_pubkey.to_string()).is_ok());

        // Empty pubkey
        assert!(Pubkey::new("".to_string()).is_err());

        // Wrong length
        assert!(Pubkey::new("ta111".to_string()).is_err());

        // Wrong prefix
        assert!(Pubkey::new("tb1111111111111111111111111111111111111111111".to_string()).is_err());

        // Invalid characters (not base64-url)
        assert!(Pubkey::new("ta!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!".to_string()).is_err());
    }

    #[test]
    fn test_signature_validation() {
        // Create a valid signature using the encoding function
        let bytes = [1u8; 64];
        let valid_signature = tn_signature_encoding::tn_signature_to_string(&bytes);
        assert!(Signature::new(valid_signature.to_string()).is_ok());

        // Empty signature
        assert!(Signature::new("".to_string()).is_err());

        // Wrong length
        assert!(Signature::new("ts111".to_string()).is_err());

        // Wrong prefix
        assert!(Signature::new("ta111111111111111111111111111111111111111111111111111111111111111111111111111111111111".to_string()).is_err());

        // Invalid characters (not base64-url)
        assert!(Signature::new("ts!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!".to_string()).is_err());
    }

    #[test]
    fn test_pubkey_roundtrip() {
        // Test encoding and decoding
        let bytes = [1u8; 32];
        let pubkey = Pubkey::from_bytes(&bytes);
        let decoded_bytes = pubkey.to_bytes().unwrap();
        assert_eq!(bytes, decoded_bytes);
    }

    #[test]
    fn test_signature_roundtrip() {
        // Test encoding and decoding
        let bytes = [1u8; 64];
        let signature = Signature::from_bytes(&bytes);
        let decoded_bytes = signature.to_bytes().unwrap();
        assert_eq!(bytes, decoded_bytes);
    }
}
