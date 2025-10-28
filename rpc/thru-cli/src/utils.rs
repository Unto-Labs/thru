//! Shared utility functions

use crate::error::CliError;
use thru_base::tn_tools::Pubkey;

/// Validate and parse an address that can be either a ta... address or 64-char hex string
/// returns 32-byte representation
pub fn validate_address_or_hex(input: &str) -> Result<[u8; 32], CliError> {
    // check ta... address
    if input.starts_with("ta") && input.len() == 46 {
        let pubkey = Pubkey::new(input.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid address: {}", e)))?;
        pubkey
            .to_bytes()
            .map_err(|e| CliError::Validation(format!("Failed to convert address to bytes: {}", e)))
    // check if hex key
    } else if input.len() == 64 {
        let bytes = hex::decode(input)
            .map_err(|e| CliError::Validation(format!("Invalid hex string '{}': {}", input, e)))?;

        if bytes.len() != 32 {
            return Err(CliError::Validation(format!(
                "Address must be exactly 32 bytes, got {} bytes: {}",
                bytes.len(),
                input
            )));
        }

        let mut result = [0u8; 32];
        result.copy_from_slice(&bytes);
        Ok(result)
    } else {
        Err(CliError::Validation(format!(
            "Address must be ta... address (46 chars) or 64-char hex string, got {} characters: {}",
            input.len(),
            input
        )))
    }
}

/// Parse a 64-character hex string to 32-byte array
pub fn parse_seed_bytes(hex_string: &str) -> Result<[u8; 32], CliError> {
    if hex_string.len() != 64 {
        return Err(CliError::Validation(format!(
            "Hex string must be exactly 64 characters (32 bytes), got {} characters",
            hex_string.len()
        )));
    }

    let bytes = hex::decode(hex_string)
        .map_err(|e| CliError::Validation(format!("Invalid hex string: {}", e)))?;

    if bytes.len() != 32 {
        return Err(CliError::Validation(format!(
            "Decoded hex must be exactly 32 bytes, got {} bytes",
            bytes.len()
        )));
    }

    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}
