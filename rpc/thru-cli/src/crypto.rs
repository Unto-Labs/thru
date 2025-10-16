//! Cryptographic utilities for the Thru CLI

use anyhow::Result;
use sha2::{Digest, Sha256};
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::{derive_manager_program_accounts, derive_uploader_program_accounts};

use crate::error::CliError;

/// Generate a keypair from a private key hex string
pub fn keypair_from_hex(private_key_hex: &str) -> Result<KeyPair, CliError> {
    KeyPair::from_hex_private_key("cli", private_key_hex)
        .map_err(|e| CliError::Crypto(e.to_string()))
}

pub fn derive_manager_accounts_from_seed(
    seed: &str,
    program_id: &Pubkey,
    is_ephemeral: bool,
) -> Result<(Pubkey, Pubkey), CliError> {
    let seed_bytes = seed.as_bytes();
    derive_manager_program_accounts(seed_bytes, program_id, is_ephemeral)
        .map_err(|e| CliError::Crypto(e.to_string()))
}

pub fn derive_uploader_accounts_from_seed(
    seed: &str,
    program_id: &Pubkey,
) -> Result<(Pubkey, Pubkey), CliError> {
    let seed_bytes = seed.as_bytes();
    derive_uploader_program_accounts(seed_bytes, program_id)
        .map_err(|e| CliError::Crypto(e.to_string()))
}

/// Calculate SHA256 hash of data
pub fn calculate_sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hasher.finalize();

    let mut result = [0u8; 32];
    result.copy_from_slice(&hash);
    result
}

/// Validate that a string is a valid hex-encoded private key
///
/// This function checks that the provided string is exactly 64 hex characters
/// (representing 32 bytes) and contains only valid hexadecimal characters.
///
/// # Arguments
/// * `hex_str` - The hex string to validate
///
/// # Returns
/// * `Ok(())` if the private key is valid
/// * `Err(CliError::Crypto)` if the private key is invalid
///
/// # Examples
/// ```
/// use thru_cli::crypto::validate_private_key_hex;
///
/// let valid_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/// assert!(validate_private_key_hex(valid_key).is_ok());
///
/// let invalid_key = "invalid";
/// assert!(validate_private_key_hex(invalid_key).is_err());
/// ```
#[allow(dead_code)]
pub fn validate_private_key_hex(hex_str: &str) -> Result<(), CliError> {
    if hex_str.len() != 64 {
        return Err(CliError::Crypto(
            "Private key must be exactly 64 hex characters".to_string(),
        ));
    }

    hex::decode(hex_str)
        .map_err(|e| CliError::Crypto(format!("Invalid hex private key: {}", e)))?;

    Ok(())
}

/// Convert bytes to hex string
///
/// This function converts a byte array to its hexadecimal string representation.
/// Each byte is represented as two lowercase hexadecimal characters.
///
/// # Arguments
/// * `bytes` - The byte slice to convert
///
/// # Returns
/// A lowercase hexadecimal string representation of the input bytes
///
/// # Examples
/// ```
/// use thru_cli::crypto::bytes_to_hex;
///
/// let bytes = vec![0x01, 0x23, 0x45, 0x67];
/// let hex_str = bytes_to_hex(&bytes);
/// assert_eq!(hex_str, "01234567");
/// ```
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Convert hex string to bytes
///
/// This function converts a hexadecimal string to its byte array representation.
/// The input string must contain an even number of valid hexadecimal characters.
///
/// # Arguments
/// * `hex_str` - The hexadecimal string to convert (case-insensitive)
///
/// # Returns
/// * `Ok(Vec<u8>)` containing the decoded bytes if successful
/// * `Err(CliError::Crypto)` if the hex string is invalid
///
/// # Examples
/// ```
/// use thru_cli::crypto::hex_to_bytes;
///
/// let hex_str = "01234567";
/// let bytes = hex_to_bytes(hex_str).unwrap();
/// assert_eq!(bytes, vec![0x01, 0x23, 0x45, 0x67]);
///
/// let invalid_hex = "invalid";
/// assert!(hex_to_bytes(invalid_hex).is_err());
/// ```
#[allow(dead_code)]
pub fn hex_to_bytes(hex_str: &str) -> Result<Vec<u8>, CliError> {
    hex::decode(hex_str).map_err(|e| CliError::Crypto(format!("Invalid hex string: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_private_key_hex() {
        // Valid private key
        let valid_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert!(validate_private_key_hex(valid_key).is_ok());

        // Too short
        let short_key = "0123456789abcdef";
        assert!(validate_private_key_hex(short_key).is_err());

        // Too long
        let long_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef00";
        assert!(validate_private_key_hex(long_key).is_err());

        // Invalid hex
        let invalid_key = "0123456789abcdefghij456789abcdef0123456789abcdef0123456789abcdef";
        assert!(validate_private_key_hex(invalid_key).is_err());
    }

    #[test]
    fn test_calculate_sha256() {
        let data = b"hello world";
        let hash = calculate_sha256(data);

        // Verify it's 32 bytes
        assert_eq!(hash.len(), 32);

        // Verify it's deterministic
        let hash2 = calculate_sha256(data);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_hex_conversion() {
        let bytes = vec![0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
        let hex_str = bytes_to_hex(&bytes);
        assert_eq!(hex_str, "0123456789abcdef");

        let converted_back = hex_to_bytes(&hex_str).unwrap();
        assert_eq!(bytes, converted_back);
    }
}
