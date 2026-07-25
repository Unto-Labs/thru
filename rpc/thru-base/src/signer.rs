//! Bring-your-own-signer surface (external-signer Workstream B).
//!
//! Lets a custody partner (e.g. one using a Blockdaemon Builder Vault TSM) sign
//! Thru transactions without the SDK ever holding a key: build the exact bytes
//! `M` the external signer must sign, hand `M` to the HSM/MPC backend, then
//! attach the returned signature with a verify-before-attach check.
//!
//! `SigningMessage` is opaque and constructible only by the domain builders, so
//! a caller cannot steer a signer to arbitrary bytes or a mismatched domain.
//! `attach_signature` runs the strict/canonical verifier before accepting a
//! signature, so a wrong-key or garbage signature fails locally rather than on
//! chain.  `LocalSigner` is a key-holding control implementation (kept out of any
//! key-free core).  See specs/mpc-hsm-signer-design.md §4.2.

use crate::tn_signature::{self, SignatureDomain};
use ed25519_dalek::{Signer as _, SigningKey};
use std::fmt;

#[derive(Debug)]
pub enum SignError {
    /// The signer's public key does not match the message's expected key.
    KeyMismatch { expected: [u8; 32], got: [u8; 32] },
    /// The signature does not verify over the message (wrong key or garbage;
    /// Ed25519 has no key recovery, so the two are indistinguishable here).
    InvalidSignature,
    /// The signer (or an approver) declined.
    Rejected,
    /// A backend-specific error.
    Backend(String),
}

impl fmt::Display for SignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SignError::KeyMismatch { .. } => write!(f, "signer public key does not match expected key"),
            SignError::InvalidSignature => write!(f, "invalid signature"),
            SignError::Rejected => write!(f, "signing rejected"),
            SignError::Backend(s) => write!(f, "signer backend error: {s}"),
        }
    }
}
impl std::error::Error for SignError {}

/// Byte offset of the fee-payer public key within a transaction body (the fixed
/// `WireTxnHdrV1` header; see `txn_lib::WireTxnHdrV1`).
const TXN_FEE_PAYER_OFFSET: usize = 48;
/// Length of the fixed transaction wire header — the minimum body length.
const TXN_HEADER_SZ: usize = 112;

/// An opaque, frozen transaction signing message: the exact bytes `M` an
/// external signer signs (48 bytes), the fee-payer key the signature must verify
/// under (derived from the body, never independent caller input), and an
/// immutable snapshot of the body so `attach_signature` can emit a self-consistent
/// signed wire even if the caller later mutates its original buffer.
#[derive(Clone)]
pub struct SigningMessage {
    m: Vec<u8>,
    expected_pubkey: [u8; 32],
    body: Vec<u8>,
}

impl SigningMessage {
    /// The exact bytes to sign — hand these to the HSM/MPC backend.
    pub fn as_bytes(&self) -> &[u8] {
        &self.m
    }
    /// The public key the signature must verify under: the fee-payer taken from
    /// the transaction body, so it cannot disagree with what the chain checks.
    pub fn expected_pubkey(&self) -> &[u8; 32] {
        &self.expected_pubkey
    }
    /// The transaction body snapshot these bytes were built from.
    pub fn body(&self) -> &[u8] {
        &self.body
    }
}

/// Build the signing message for a transaction: `M = DST_TXN ‖ SHA-256(body)`,
/// where `body` is the wire bytes preceding the trailing signature.  The
/// signature's expected key is the fee-payer taken from the body header (offset
/// 48), *not* an independent argument — so a caller cannot pair a body owned by
/// fee-payer A with a signer for key B and produce a locally-"valid" signature
/// the chain then rejects.  Errors if `body` is shorter than the wire header.
pub fn build_transaction_signing_message(body: &[u8]) -> Result<SigningMessage, SignError> {
    if body.len() < TXN_HEADER_SZ {
        return Err(SignError::Backend(format!(
            "transaction body {} bytes is shorter than the {}-byte header",
            body.len(),
            TXN_HEADER_SZ
        )));
    }
    let mut expected_pubkey = [0u8; 32];
    expected_pubkey.copy_from_slice(&body[TXN_FEE_PAYER_OFFSET..TXN_FEE_PAYER_OFFSET + 32]);
    Ok(SigningMessage {
        m: tn_signature::signing_message(SignatureDomain::Transaction, body),
        expected_pubkey,
        body: body.to_vec(),
    })
}

/// Verify `sig` (produced by an external signer) against the frozen message under
/// the strict/canonical policy, then return the complete signed transaction wire
/// (`body ‖ sig`).  Fails closed.  The returned buffer is freshly assembled from
/// the body snapshot, so a later mutation of the caller's original body cannot
/// desync the attached signature.  The trailing 64 bytes are the signature.
pub fn attach_signature(msg: &SigningMessage, sig: [u8; 64]) -> Result<Vec<u8>, SignError> {
    tn_signature::verify_message(&msg.m, &sig, &msg.expected_pubkey)
        .map_err(|_| SignError::InvalidSignature)?;
    let mut signed = Vec::with_capacity(msg.body.len() + 64);
    signed.extend_from_slice(&msg.body);
    signed.extend_from_slice(&sig);
    Ok(signed)
}

/// An Ed25519 signer over an opaque `SigningMessage`.  Implementations must sign
/// `msg.as_bytes()` with standard RFC-8032 Ed25519 and return the raw 64 bytes.
pub trait Signer {
    /// The 32-byte public key (== the Thru address) this signer produces.
    fn public_key(&self) -> [u8; 32];
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError>;
}

/// Sign a message with any `Signer`: a fail-fast expected-key check *before* the
/// (potentially slow) sign, then verify-before-attach.  Returns the complete
/// signed transaction wire (`body ‖ sig`).
pub fn sign_with(signer: &dyn Signer, msg: &SigningMessage) -> Result<Vec<u8>, SignError> {
    let pk = signer.public_key();
    if pk != *msg.expected_pubkey() {
        return Err(SignError::KeyMismatch {
            expected: *msg.expected_pubkey(),
            got: pk,
        });
    }
    let sig = signer.sign(msg)?;
    attach_signature(msg, sig)
}

/// A local, key-holding `Signer` — the control implementation for tests / CLI /
/// native use.  Holds a raw seed, so it belongs in a key-holding package, never a
/// key-free / browser-safe core.
pub struct LocalSigner {
    signing_key: SigningKey,
}

impl LocalSigner {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&seed),
        }
    }
}

impl Signer for LocalSigner {
    fn public_key(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError> {
        // standard RFC-8032 over the exact frozen bytes
        Ok(self.signing_key.sign(msg.as_bytes()).to_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal transaction body (>= header length) whose fee-payer field
    /// (offset 48) holds `pk`.
    fn body_with_fee_payer(pk: &[u8; 32]) -> Vec<u8> {
        let mut body = vec![0u8; TXN_HEADER_SZ + 8];
        body[TXN_FEE_PAYER_OFFSET..TXN_FEE_PAYER_OFFSET + 32].copy_from_slice(pk);
        body
    }

    #[test]
    fn local_signer_round_trip_produces_a_valid_signed_wire() {
        let s = LocalSigner::from_seed([7u8; 32]);
        let pk = s.public_key();
        let body = body_with_fee_payer(&pk);
        let msg = build_transaction_signing_message(&body).unwrap();
        assert_eq!(msg.as_bytes().len(), 48, "M = DST_TXN ‖ SHA-256(body)");
        assert_eq!(msg.expected_pubkey(), &pk, "expected key is the body's fee-payer");
        let signed = sign_with(&s, &msg).unwrap();
        // signed = body ‖ sig; the trailing 64 bytes verify as a txn signature.
        assert_eq!(signed.len(), body.len() + 64);
        assert_eq!(&signed[..body.len()], &body[..]);
        let sig: [u8; 64] = signed[body.len()..].try_into().unwrap();
        assert!(crate::tn_signature::verify_transaction(&body, &sig, &pk).is_ok());
    }

    #[test]
    fn key_mismatch_is_fail_fast() {
        // The body names fee-payer all-2s, but the signer holds a different key.
        let s = LocalSigner::from_seed([1u8; 32]);
        let body = body_with_fee_payer(&[2u8; 32]);
        let msg = build_transaction_signing_message(&body).unwrap();
        assert!(matches!(sign_with(&s, &msg), Err(SignError::KeyMismatch { .. })));
    }

    #[test]
    fn attach_rejects_tampered_signature() {
        let s = LocalSigner::from_seed([3u8; 32]);
        let pk = s.public_key();
        let body = body_with_fee_payer(&pk);
        let msg = build_transaction_signing_message(&body).unwrap();
        let mut sig = s.sign(&msg).unwrap();
        sig[40] ^= 1;
        assert!(attach_signature(&msg, sig).is_err());
    }

    #[test]
    fn short_body_is_rejected() {
        assert!(build_transaction_signing_message(b"too short").is_err());
    }
}
