//! Off-chain message signing (`tn_msg_sign_v1__` domain).
//!
//! `thru message sign --key <name> <message>` signs with a local key, a
//! Ledger key (two-pass SIGN_MESSAGE, reviewed on the device) or a Trezor key
//! (text messages only, reviewed on the device) and prints the `ts…`
//! signature.  Every signature is verified strictly before it is printed.

use std::path::Path;

use serde_json::json;
use sha2::{Digest, Sha256};
use thru_base::signer::{MAX_MESSAGE_SZ, SignError, sign_message_with};
use thru_base::tn_signature_encoding::tn_signature_to_string;

use crate::cli::MessageCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use crate::signing::{
    TREZOR_TEXT_RULE, connect_ledger, connect_trezor, ledger_error, ledger_preview_json,
    trezor_error,
};
use crate::trezor_preview::{self, Review};
use thru_ledger::{LedgerSigner, Preview};
use thru_trezor::TrezorSigner;

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

/// Sign `message` with key `key` (signing key reference, `ledger://` or
/// `trezor://` URI); returns the raw public key, the strictly verified
/// signature and, for a Ledger key, the review preview that was printed before
/// the device prompt.  A Trezor key signs only a message it can show as text;
/// any other is refused before the device is contacted.
pub fn sign_message_bytes(
    config: &Config,
    key: &str,
    message: &[u8],
) -> Result<SignedMessage, CliError> {
    sign_message_bytes_reviewed(config, key, message).map(|(signed, _)| signed)
}

/// [`sign_message_bytes`] that also returns the review of a Trezor key (`Some`
/// exactly for a Trezor key: a message it signs is text, so it has one).
fn sign_message_bytes_reviewed(
    config: &Config,
    key: &str,
    message: &[u8],
) -> Result<(SignedMessage, Option<Review>), CliError> {
    if let Some(target) = config.keys.trezor_source(key)? {
        refuse_message_trezor_cannot_show(message)?;
        return sign_message_on_trezor_reviewed(&connect_trezor(target)?, message);
    }
    if let Some((path, expected)) = config.keys.ledger_source(key)? {
        let signed = sign_message_on_ledger(&connect_ledger(path, expected)?, message)?;
        return Ok((signed, None));
    }
    let signer = config.keys.load_key(key)?;
    let sig = sign_message_with(&*signer, message).map_err(|e| match e {
        SignError::Rejected => CliError::Crypto("signing rejected".to_string()),
        other => CliError::Crypto(format!("Failed to sign message: {other}")),
    })?;
    Ok(((signer.public_key, sig, None), None))
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

/// The refusal for a message the Trezor would not sign, found from the same
/// rule the device applies, so that nothing is connected or paired for it.
fn refuse_message_trezor_cannot_show(message: &[u8]) -> Result<(), CliError> {
    if thru_ledger::preview::is_text_message(message) {
        return Ok(());
    }
    Err(CliError::Validation(format!(
        "a Trezor signs a message only if it can show it as text: {TREZOR_TEXT_RULE}; sign other \
         messages with a local or a Ledger key"
    )))
}

/// Sign `message` on a connected Trezor, which reviews it on the device.
pub fn sign_message_on_trezor(
    signer: &TrezorSigner,
    message: &[u8],
) -> Result<SignedMessage, CliError> {
    sign_message_on_trezor_reviewed(signer, message).map(|(signed, _)| signed)
}

/// [`sign_message_on_trezor`] that prints the review the device must show (to
/// standard error, before the request is sent) and returns it.
fn sign_message_on_trezor_reviewed(
    signer: &TrezorSigner,
    message: &[u8],
) -> Result<(SignedMessage, Option<Review>), CliError> {
    let review = trezor_preview::message_review(message, &signer.pubkey(), signer.path());
    let sig = crate::signing::eprint_trezor_review_then(review.as_ref(), || {
        signer.try_sign_message(message)
    })
    .map_err(trezor_error)?;
    Ok(((signer.pubkey(), sig, None), review))
}

fn sign_message(
    config: &Config,
    key: &str,
    message: &[u8],
    json_format: bool,
) -> Result<(), CliError> {
    let ((pk, sig, preview), trezor_review) = sign_message_bytes_reviewed(config, key, message)?;
    let address = crate::signing::address_string(&pk);
    let signature = tn_signature_to_string(&sig);
    if json_format {
        let mut response = json!({
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
        });
        if let Some(review) = &trezor_review {
            response["message_sign"]["trezor_preview"] = review.to_json();
        }
        output::print_output(response, true);
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

    /// The rule the CLI checks before it connects to a Trezor is the Ledger
    /// host's text rule.  (A Trezor alias or URI with a message that is not
    /// text is refused without a device: see the test of that name in
    /// `signing.rs`, which controls the Trezor environment variables.)
    #[test]
    fn trezor_accepts_text_messages_only() {
        for text in [&b"hello"[..], b"two\nlines", b"a", &[b'a'; 512]] {
            assert!(refuse_message_trezor_cannot_show(text).is_ok());
        }
        for other in [
            &b""[..],
            &[0, 1],
            b"caf\xc3\xa9",
            b" lead",
            b"trail ",
            &[b'a'; 513],
        ] {
            let error = refuse_message_trezor_cannot_show(other).unwrap_err();
            assert!(matches!(error, CliError::Validation(_)), "{error:?}");
        }
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
