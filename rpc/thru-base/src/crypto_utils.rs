//! Cryptographic utilities for the Thru ecosystem

use crate::tn_tools::Pubkey;
use sha2::{Digest, Sha256};

const TN_UPLOADER_PROGRAM_SEED_SIZE: usize = 32;

/// Derives both meta and buffer account pubkeys for an uploader program
///
/// # Arguments
/// * `seed` - The seed bytes for account derivation (must not be empty)
/// * `program_id` - The program ID pubkey
///
/// # Returns
/// A Result containing a tuple of (meta_account_pubkey, buffer_account_pubkey)
///
/// # Errors
/// Returns an error if the seed is empty
pub fn derive_uploader_program_accounts(
    seed: &[u8],
    program_id: &Pubkey,
) -> Result<(Pubkey, Pubkey), Box<dyn std::error::Error>> {
    if seed.is_empty() {
        return Err("Seed cannot be empty".into());
    }
    if seed.len() > TN_UPLOADER_PROGRAM_SEED_SIZE {
        return Err("Seed cannot be greater than 32 bytes".into());
    }
    // pad seed to 32 bytes with zeros
    let mut padded_seed = [0u8; TN_UPLOADER_PROGRAM_SEED_SIZE];
    padded_seed[..seed.len()].copy_from_slice(seed);

    // Meta account derivation
    let meta_account = derive_program_address(&padded_seed, program_id, true)?;

    // Buffer account derivation
    let meta_bytes = meta_account.to_bytes()?;
    let buffer_account = derive_program_address(&meta_bytes, program_id, true)?;

    Ok((meta_account, buffer_account))
}

/// Derives both meta and program account pubkeys for a manager program
///
/// # Arguments
/// * `seed` - The seed bytes for account derivation (must not be empty)
/// * `program_id` - The program ID pubkey
/// * `is_ephemeral` - Whether the program is ephemeral
///
/// # Returns
/// A Result containing a tuple of (meta_account_pubkey, program_account_pubkey)
///
/// # Errors
/// Returns an error if the seed is empty
pub fn derive_manager_program_accounts(
    seed: &[u8],
    program_id: &Pubkey,
    is_ephemeral: bool,
) -> Result<(Pubkey, Pubkey), Box<dyn std::error::Error>> {
    if seed.is_empty() {
        return Err("Seed cannot be empty".into());
    }
    if seed.len() > TN_UPLOADER_PROGRAM_SEED_SIZE {
        return Err("Seed cannot be greater than 32 bytes".into());
    }
    // pad seed to 32 bytes with zeros
    let mut padded_seed = [0u8; TN_UPLOADER_PROGRAM_SEED_SIZE];
    padded_seed[..seed.len()].copy_from_slice(seed);

    // Meta account derivation
    let meta_account = derive_program_address(&padded_seed, program_id, is_ephemeral)?;

    // Program account derivation - use meta account's bytes as seed for program account
    let meta_bytes = meta_account.to_bytes()?;
    let program_account = derive_program_address(&meta_bytes, program_id, is_ephemeral)?;

    Ok((meta_account, program_account))
}

/// Derives a program address from seed components and program ID
///
/// This function creates a deterministic address by hashing the program ID,
/// an ephemeral account flag, and the provided seed components.
///
/// # Arguments
/// * `seeds` - Array of byte slices to use as seed components
/// * `program_id` - The program ID pubkey
///
/// # Returns
/// A Result containing a tuple of (derived_pubkey, bump_seed)
/// The bump_seed is always 0 in this implementation as we don't use bump seed derivation
///
/// # Errors
/// Returns an error if the program_id cannot be converted to bytes
pub fn derive_program_address(
    seed: &[u8; 32],
    program_id: &Pubkey,
    is_ephemeral: bool,
) -> Result<Pubkey, Box<dyn std::error::Error>> {
    // Get program ID bytes
    let program_bytes = program_id
        .to_bytes()
        .map_err(|e| format!("Failed to convert program_id to bytes: {}", e))?;

    // Create derivation by hashing program_id + ephemeral flag + seeds
    let mut hasher = Sha256::new();
    hasher.update(&program_bytes);

    // Add ephemeral account flag
    hasher.update(&[if is_ephemeral { 1u8 } else { 0u8 }]); // ephemeral account flag

    // Add seed
    hasher.update(seed);

    let hash = hasher.finalize();

    // Use first 32 bytes as the derived address
    let mut derived_bytes = [0u8; 32];
    derived_bytes.copy_from_slice(&hash[..32]);

    Ok(Pubkey::from_bytes(&derived_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_uploader_program_accounts() {
        // Create test program ID
        let program_bytes = [1u8; 32];
        let program_id = Pubkey::from_bytes(&program_bytes);

        // Test with valid seed
        let seed = b"test_seed";
        let result = derive_uploader_program_accounts(seed, &program_id);
        assert!(result.is_ok());

        let (meta_account, buffer_account) = result.unwrap();
        assert_ne!(meta_account, buffer_account);

        // Test deterministic derivation - same inputs should produce same outputs
        let result2 = derive_uploader_program_accounts(seed, &program_id);
        let (meta_account2, buffer_account2) = result2.unwrap();
        assert_eq!(meta_account, meta_account2);
        assert_eq!(buffer_account, buffer_account2);
    }

    #[test]
    fn test_derive_uploader_program_accounts_empty_seed() {
        let program_bytes = [1u8; 32];
        let program_id = Pubkey::from_bytes(&program_bytes);

        // Test with empty seed should return error
        let empty_seed = b"";
        let result = derive_uploader_program_accounts(empty_seed, &program_id);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "Seed cannot be empty");
    }

    #[test]
    fn test_derive_program_address_different_seeds() {
        let program_bytes = [1u8; 32];
        let program_id = Pubkey::from_bytes(&program_bytes);

        let mut seed1 = [0u8; 32];
        seed1[..4].copy_from_slice(b"test");
        let mut seed2 = [0u8; 32];
        seed2[..4].copy_from_slice(b"seed");

        let pubkey1 = derive_program_address(&seed1, &program_id, false).unwrap();
        let pubkey2 = derive_program_address(&seed2, &program_id, false).unwrap();

        // Different seeds should produce different addresses
        assert_ne!(pubkey1, pubkey2);
    }
}
