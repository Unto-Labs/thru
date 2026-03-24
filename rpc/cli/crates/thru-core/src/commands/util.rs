//! Utility command implementations for format conversion

use anyhow::Result;
use thru_base::tn_tools::{Pubkey, Signature};

use crate::cli::{ConvertCommands, PubkeyConvertCommands, SignatureConvertCommands, UtilCommands};
use crate::error::CliError;
use crate::output::OutputFormat;

/// Execute utility commands
pub fn execute_util_command(cmd: UtilCommands, output_format: OutputFormat) -> Result<()> {
    match cmd {
        UtilCommands::Convert { subcommand } => execute_convert_command(subcommand, output_format),
    }
}

/// Execute conversion commands
fn execute_convert_command(cmd: ConvertCommands, output_format: OutputFormat) -> Result<()> {
    match cmd {
        ConvertCommands::Pubkey { subcommand } => {
            execute_pubkey_convert_command(subcommand, output_format)
        }
        ConvertCommands::Signature { subcommand } => {
            execute_signature_convert_command(subcommand, output_format)
        }
    }
}

/// Execute public key conversion commands
fn execute_pubkey_convert_command(
    cmd: PubkeyConvertCommands,
    output_format: OutputFormat,
) -> Result<()> {
    match cmd {
        PubkeyConvertCommands::HexToThruFmt { hex_pubkey } => {
            convert_hex_to_thru_pubkey(hex_pubkey, output_format)
        }
        PubkeyConvertCommands::ThruFmtToHex { thrufmt_pubkey } => {
            convert_thru_to_hex_pubkey(thrufmt_pubkey, output_format)
        }
    }
}

/// Execute signature conversion commands
fn execute_signature_convert_command(
    cmd: SignatureConvertCommands,
    output_format: OutputFormat,
) -> Result<()> {
    match cmd {
        SignatureConvertCommands::HexToThruFmt { hex_signature } => {
            convert_hex_to_thru_signature(hex_signature, output_format)
        }
        SignatureConvertCommands::ThruFmtToHex { thrufmt_signature } => {
            convert_thru_to_hex_signature(thrufmt_signature, output_format)
        }
    }
}

/// Convert hex public key to thru format
fn convert_hex_to_thru_pubkey(hex_pubkey: String, output_format: OutputFormat) -> Result<()> {
    // Validate hex input
    if hex_pubkey.len() != 64 {
        return Err(CliError::Crypto(format!(
            "Invalid hex public key length: expected 64 characters, got {}",
            hex_pubkey.len()
        ))
        .into());
    }

    // Decode hex to bytes
    let pubkey_bytes = hex::decode(&hex_pubkey)
        .map_err(|e| CliError::Crypto(format!("Invalid hex public key: {}", e)))?;

    // Convert to 32-byte array (guaranteed to be 32 bytes since we validated 64 hex chars)
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&pubkey_bytes);

    // Create Pubkey from bytes (this will encode to ta... format)
    let thru_pubkey = Pubkey::from_bytes(&bytes);

    // Output result
    match output_format {
        OutputFormat::Json => {
            let result = serde_json::json!({
                "hex_pubkey": hex_pubkey,
                "thru_pubkey": thru_pubkey.as_str()
            });
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        OutputFormat::Text => {
            println!("Hex public key:  {}", hex_pubkey);
            println!("Thru public key: {}", thru_pubkey.as_str());
        }
    }

    Ok(())
}

/// Convert thru format public key to hex
fn convert_thru_to_hex_pubkey(thrufmt_pubkey: String, output_format: OutputFormat) -> Result<()> {
    // Parse and validate thru format pubkey
    let pubkey = Pubkey::new(thrufmt_pubkey.clone())
        .map_err(|e| CliError::Crypto(format!("Invalid thru format public key: {}", e)))?;

    // Convert to bytes
    let bytes = pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode public key: {}", e)))?;

    // Convert to hex
    let hex_pubkey = hex::encode(bytes);

    // Output result
    match output_format {
        OutputFormat::Json => {
            let result = serde_json::json!({
                "thru_pubkey": thrufmt_pubkey,
                "hex_pubkey": hex_pubkey
            });
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        OutputFormat::Text => {
            println!("Thru public key: {}", thrufmt_pubkey);
            println!("Hex public key:  {}", hex_pubkey);
        }
    }

    Ok(())
}

/// Convert hex signature to thru format
fn convert_hex_to_thru_signature(hex_signature: String, output_format: OutputFormat) -> Result<()> {
    // Validate hex input
    if hex_signature.len() != 128 {
        return Err(CliError::Crypto(format!(
            "Invalid hex signature length: expected 128 characters, got {}",
            hex_signature.len()
        ))
        .into());
    }

    // Decode hex to bytes
    let signature_bytes = hex::decode(&hex_signature)
        .map_err(|e| CliError::Crypto(format!("Invalid hex signature: {}", e)))?;

    // Convert to 64-byte array (guaranteed to be 64 bytes since we validated 128 hex chars)
    let mut bytes = [0u8; 64];
    bytes.copy_from_slice(&signature_bytes);

    // Create Signature from bytes (this will encode to ts... format)
    let thru_signature = Signature::from_bytes(&bytes);

    // Output result
    match output_format {
        OutputFormat::Json => {
            let result = serde_json::json!({
                "hex_signature": hex_signature,
                "thru_signature": thru_signature.as_str()
            });
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        OutputFormat::Text => {
            println!("Hex signature:  {}", hex_signature);
            println!("Thru signature: {}", thru_signature.as_str());
        }
    }

    Ok(())
}

/// Convert thru format signature to hex
fn convert_thru_to_hex_signature(
    thrufmt_signature: String,
    output_format: OutputFormat,
) -> Result<()> {
    // Parse and validate thru format signature
    let signature = Signature::new(thrufmt_signature.clone())
        .map_err(|e| CliError::Crypto(format!("Invalid thru format signature: {}", e)))?;

    // Convert to bytes
    let bytes = signature
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode signature: {}", e)))?;

    // Convert to hex
    let hex_signature = hex::encode(bytes);

    // Output result
    match output_format {
        OutputFormat::Json => {
            let result = serde_json::json!({
                "thru_signature": thrufmt_signature,
                "hex_signature": hex_signature
            });
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        OutputFormat::Text => {
            println!("Thru signature: {}", thrufmt_signature);
            println!("Hex signature:  {}", hex_signature);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::OutputFormat;

    #[test]
    fn test_pubkey_hex_to_thru_conversion() {
        let hex_pubkey =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string();
        let result = convert_hex_to_thru_pubkey(hex_pubkey, OutputFormat::Text);
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_hex_pubkey() {
        let invalid_hex = "invalid".to_string();
        let result = convert_hex_to_thru_pubkey(invalid_hex, OutputFormat::Text);
        assert!(result.is_err());
    }

    #[test]
    fn test_signature_hex_to_thru_conversion() {
        let hex_signature = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string();
        let result = convert_hex_to_thru_signature(hex_signature, OutputFormat::Text);
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_hex_signature() {
        let invalid_hex = "invalid".to_string();
        let result = convert_hex_to_thru_signature(invalid_hex, OutputFormat::Text);
        assert!(result.is_err());
    }
}
