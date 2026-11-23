//! Off-chain message signing (`tn_msg_sign_v1__` domain).
//!
//! `thru message sign --key <name> <message>` signs with a local key or a
//! Ledger key (two-pass SIGN_MESSAGE, reviewed on the device) and prints the
//! `ts…` signature.  Every signature is verified strictly before it is printed.

use std::path::Path;

use serde_json::json;
use sha2::{Digest, Sha256};
use thru_base::signer::{MAX_MESSAGE_SZ, SignError, sign_message_with};
use thru_base::tn_signature_encoding::tn_signature_to_string;

use crate::cli::MessageCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use crate::signing::{connect_ledger, ledger_error, ledger_preview_json};
use thru_ledger::{LedgerSigner, Preview};

/// Handle `thru message …`.
pub async fn handle_message_command(
    config: &Config,
    subcommand: MessageCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        MessageCommands::Sign {
            key,
            message,
            file,
            hex,
        } => {
            let bytes = load_message(message.as_deref(), file.as_deref(), hex)?;
            sign_message(config, &key, &bytes, json_format)
        }
    }
}

/// The message bytes from the argument (UTF-8, or hex with `--hex`) or a file
/// (raw bytes, or hex text with `--hex`).
pub fn load_message(
    message: Option<&str>,
    file: Option<&Path>,
    hex_input: bool,
) -> Result<Vec<u8>, CliError> {
    let raw: Vec<u8> = match (message, file) {
        (Some(m), None) => m.as_bytes().to_vec(),
        (None, Some(path)) => std::fs::read(path)?,
        _ => {
            return Err(CliError::Validation(
                "Pass the message as an argument or with --file".to_string(),
            ));
        }
    };
    let bytes = if hex_input {
        let text = String::from_utf8(raw)
            .map_err(|_| CliError::Validation("--hex input is not text".to_string()))?;
        let text = text.trim();
        hex::decode(text.strip_prefix("0x").unwrap_or(text))
            .map_err(|e| CliError::Validation(format!("Invalid hex message: {e}")))?
    } else {
        raw
    };
    if bytes.is_empty() {
        return Err(CliError::Validation("The message is empty".to_string()));
    }
    if bytes.len() > MAX_MESSAGE_SZ {
        return Err(CliError::Validation(format!(
            "The message is {} bytes; the maximum is {}",
            bytes.len(),
            MAX_MESSAGE_SZ
        )));
    }
    Ok(bytes)
}

/// Public key, strictly verified signature, and (Ledger keys) the review
/// preview shown before the device prompt.
pub type SignedMessage = ([u8; 32], [u8; 64], Option<Preview>);

/// Sign `message` with key `key` (signing key reference or `ledger://` URI); returns the raw
/// public key, the strictly verified signature and, for a Ledger key, the
/// review preview that was printed before the device prompt.
pub fn sign_message_bytes(
    config: &Config,
    key: &str,
    message: &[u8],
) -> Result<SignedMessage, CliError> {
    if let Some((path, expected)) = config.keys.ledger_source(key)? {
        return sign_message_on_ledger(&connect_ledger(path, expected)?, message);
    }
    let signer = config.keys.load_key(key)?;
    let sig = sign_message_with(&*signer, message).map_err(|e| match e {
        SignError::Rejected => CliError::Crypto("signing rejected".to_string()),
        other => CliError::Crypto(format!("Failed to sign message: {other}")),
    })?;
    Ok((signer.public_key, sig, None))
}

/// Sign `message` on a connected Ledger.  The signer's preview hook (the CLI
/// printer, see [`crate::signing::connect_ledger`]) shows the message text or
/// hash before the device prompt; the preview is also returned.
pub fn sign_message_on_ledger(
    signer: &LedgerSigner,
    message: &[u8],
) -> Result<SignedMessage, CliError> {
    let sig = signer.try_sign_message(message).map_err(ledger_error)?;
    Ok((signer.pubkey(), sig, signer.last_preview()))
}

fn sign_message(
    config: &Config,
    key: &str,
    message: &[u8],
    json_format: bool,
) -> Result<(), CliError> {
    let (pk, sig, preview) = sign_message_bytes(config, key, message)?;
    let address = crate::signing::address_string(&pk);
    let signature = tn_signature_to_string(&sig);
    if json_format {
        output::print_output(
            json!({
                "message_sign": {
                    "key": key,
                    "public_key": address,
                    "signature": signature,
                    "signature_hex": hex::encode(sig),
                    "message_len": message.len(),
                    "message_sha256": hex::encode(Sha256::digest(message)),
                    "domain": "tn_msg_sign_v1__",
                    "ledger_preview": preview
                        .as_ref()
                        .map(ledger_preview_json)
                        .unwrap_or(serde_json::Value::Null),
                }
            }),
            true,
        );
    } else {
        eprintln!("Signer: {address}");
        println!("{signature}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use thru_base::tn_signature::verify_wallet_message;

    #[test]
    fn local_key_message_signature_verifies() {
        let (_directory, keys) = crate::keys::KeyManager::test_fixture(&[("default", [1u8; 32])]);
        let config = Config {
            keys,
            ..Config::default()
        };
        let (pk, sig, preview) = sign_message_bytes(&config, "default", b"hello").unwrap();
        assert!(preview.is_none());
        assert!(verify_wallet_message(b"hello", &sig, &pk).is_ok());
        assert_eq!(tn_signature_to_string(&sig).len(), 90);
    }

    #[test]
    fn message_input_forms() {
        assert_eq!(load_message(Some("hi"), None, false).unwrap(), b"hi");
        assert_eq!(load_message(Some("0x6869"), None, true).unwrap(), b"hi");
        assert!(load_message(Some(""), None, false).is_err());
        assert!(load_message(Some("zz"), None, true).is_err());
        assert!(load_message(None, None, false).is_err());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("m.bin");
        std::fs::write(&p, [0u8, 1, 2]).unwrap();
        assert_eq!(load_message(None, Some(&p), false).unwrap(), vec![0, 1, 2]);
        std::fs::write(&p, vec![b'a'; MAX_MESSAGE_SZ + 1]).unwrap();
        assert!(load_message(None, Some(&p), false).is_err());
    }
}
