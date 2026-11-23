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
//!
//! Beyond the opaque 48-byte transaction message, a `Signer` can also be asked to
//! sign in terms of *semantic* inputs: the full transaction body
//! ([`Signer::sign_transaction_body`]), a user message ([`Signer::sign_message`])
//! or an EOA create/delete authorization ([`Signer::sign_eoa_auth`]).  Hardware
//! signers (e.g. a Ledger) need these inputs rather than pre-built bytes so they
//! can parse and display what is being signed and construct the domain-separated
//! message themselves.  The `*_with` helpers wrap each operation with a
//! fail-fast key check and a strict verify of the returned signature.

use crate::tn_signature::{self, SignatureDomain};
use crate::txn_lib::TnPubkey;
use crate::txn_tools::{build_eoa_create_message, build_eoa_delete_message};
use ed25519_dalek::{Signer as _, SigningKey};
use std::fmt;

/// Maximum size, in bytes, of an off-chain message accepted by
/// [`sign_message_with`] (`tn_msg_sign_v1__` domain).
pub const MAX_MESSAGE_SZ: usize = 32 * 1024;

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
    /// The signer does not support this operation (for example a signer that
    /// only signs transactions was asked to sign an EOA authorization).
    Unsupported(String),
}

impl fmt::Display for SignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SignError::KeyMismatch { .. } => {
                write!(f, "signer public key does not match expected key")
            }
            SignError::InvalidSignature => write!(f, "invalid signature"),
            SignError::Rejected => write!(f, "signing rejected"),
            SignError::Backend(s) => write!(f, "signer backend error: {s}"),
            SignError::Unsupported(s) => write!(f, "operation not supported by signer: {s}"),
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

/// Kind of EOA authorization (`tn_eoa_create_v1` / `tn_eoa_delete_v1` domain).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EoaAuthKind {
    /// Authorize creating the EOA (`tsys_account_create_eoa`).
    Create,
    /// Authorize deleting the EOA (`tsys_account_delete`).
    Delete,
}

impl EoaAuthKind {
    /// The signature domain this authorization is signed under.
    pub fn domain(self) -> SignatureDomain {
        match self {
            EoaAuthKind::Create => SignatureDomain::EoaCreate,
            EoaAuthKind::Delete => SignatureDomain::EoaDelete,
        }
    }
}

/// Build the canonical 82-byte EOA authorization message
/// `DST ‖ chain_id LE ‖ fee_payer ‖ account` for `kind`.  Byte-identical to
/// [`build_eoa_create_message`] / [`build_eoa_delete_message`].
pub fn build_eoa_auth_message(
    kind: EoaAuthKind,
    chain_id: u16,
    fee_payer: &TnPubkey,
    account: &TnPubkey,
) -> Vec<u8> {
    match kind {
        EoaAuthKind::Create => build_eoa_create_message(chain_id, fee_payer, account).to_vec(),
        EoaAuthKind::Delete => build_eoa_delete_message(chain_id, fee_payer, account).to_vec(),
    }
}

/// An Ed25519 signer over an opaque `SigningMessage`.  Implementations must sign
/// `msg.as_bytes()` with standard RFC-8032 Ed25519 and return the raw 64 bytes.
///
/// Only [`Signer::public_key`] and [`Signer::sign`] are required.  The other
/// methods take *semantic* inputs so a hardware signer can show the user what
/// is being signed and build the domain-separated message itself:
///
/// * [`Signer::sign_transaction_body`] has a default that builds the
///   `SigningMessage` and calls [`Signer::sign`]; a hardware signer overrides
///   it to stream the body to the device.
/// * [`Signer::sign_message`] and [`Signer::sign_eoa_auth`] default to
///   [`SignError::Unsupported`]; key-holding signers implement them.
///
/// Callers should go through the `*_with` helpers ([`sign_transaction_body_with`],
/// [`sign_message_with`], [`sign_eoa_auth_with`]), which verify the returned
/// signature strictly before it is used.
pub trait Signer {
    /// The 32-byte public key (== the Thru address) this signer produces.
    fn public_key(&self) -> [u8; 32];
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError>;

    /// Sign a full transaction body (the wire bytes preceding the trailing
    /// signature) under the `tn_txn_sign_v1__` domain.  The default builds the
    /// 48-byte `SigningMessage` and calls [`Signer::sign`].
    fn sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], SignError> {
        let msg = build_transaction_signing_message(body)?;
        self.sign(&msg)
    }

    /// Sign an off-chain user message under the `tn_msg_sign_v1__` domain
    /// (`M = DST_MSG ‖ message`).  `message` is the raw user message, never a
    /// pre-built `M`.
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        let _ = message;
        Err(SignError::Unsupported("message signing".into()))
    }

    /// Sign an EOA create/delete authorization for `account` (which must be
    /// this signer's own public key): `M = DST_kind ‖ chain_id LE ‖ fee_payer ‖
    /// account` (82 bytes).
    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &TnPubkey,
        account: &TnPubkey,
    ) -> Result<[u8; 64], SignError> {
        let _ = (kind, chain_id, fee_payer, account);
        Err(SignError::Unsupported("EOA authorization signing".into()))
    }

    /// Whether this signer can produce signatures under the legacy
    /// (pre-RFC-8032, in-hash domain) scheme of [`crate::tn_signature_legacy`].
    /// Hardware signers return `false` (decision D11): a client configured for
    /// a legacy-scheme network must refuse with a clear error before involving
    /// the device.  Only key-holding software signers can return `true`.
    fn supports_legacy_scheme(&self) -> bool {
        false
    }
}

/// A shared signer signs exactly as the signer it shares (every method,
/// including overridden defaults, forwards to `T`).
impl<T: Signer + ?Sized> Signer for std::sync::Arc<T> {
    fn public_key(&self) -> [u8; 32] {
        (**self).public_key()
    }
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError> {
        (**self).sign(msg)
    }
    fn sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], SignError> {
        (**self).sign_transaction_body(body)
    }
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        (**self).sign_message(message)
    }
    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &TnPubkey,
        account: &TnPubkey,
    ) -> Result<[u8; 64], SignError> {
        (**self).sign_eoa_auth(kind, chain_id, fee_payer, account)
    }
    fn supports_legacy_scheme(&self) -> bool {
        (**self).supports_legacy_scheme()
    }
}

/// Fail fast, before a potentially slow (hardware / remote) sign, if the
/// signer's key is not the one the signature must verify under.
fn check_key(signer_pk: [u8; 32], expected: &[u8; 32]) -> Result<(), SignError> {
    if signer_pk != *expected {
        return Err(SignError::KeyMismatch {
            expected: *expected,
            got: signer_pk,
        });
    }
    Ok(())
}

/// Sign a message with any `Signer`: a fail-fast expected-key check *before* the
/// (potentially slow) sign, then verify-before-attach.  Returns the complete
/// signed transaction wire (`body ‖ sig`).
pub fn sign_with(signer: &dyn Signer, msg: &SigningMessage) -> Result<Vec<u8>, SignError> {
    check_key(signer.public_key(), msg.expected_pubkey())?;
    let sig = signer.sign(msg)?;
    attach_signature(msg, sig)
}

/// Sign a transaction body with any `Signer` via
/// [`Signer::sign_transaction_body`]: fail-fast check that the signer's key is
/// the body's fee payer, then verify-before-attach.  Returns the complete
/// signed transaction wire (`body ‖ sig`); the trailing 64 bytes are the
/// signature.
pub fn sign_transaction_body_with<S: Signer + ?Sized>(
    signer: &S,
    body: &[u8],
) -> Result<Vec<u8>, SignError> {
    let msg = build_transaction_signing_message(body)?;
    check_key(signer.public_key(), msg.expected_pubkey())?;
    let sig = signer.sign_transaction_body(msg.body())?;
    attach_signature(&msg, sig)
}

/// Sign an off-chain message with any `Signer` via [`Signer::sign_message`],
/// then verify the signature strictly under the signer's public key.  Rejects
/// messages larger than [`MAX_MESSAGE_SZ`].
pub fn sign_message_with<S: Signer + ?Sized>(
    signer: &S,
    message: &[u8],
) -> Result<[u8; 64], SignError> {
    if message.len() > MAX_MESSAGE_SZ {
        return Err(SignError::Backend(format!(
            "message {} bytes exceeds the {}-byte limit",
            message.len(),
            MAX_MESSAGE_SZ
        )));
    }
    let pk = signer.public_key();
    let sig = signer.sign_message(message)?;
    tn_signature::verify_wallet_message(message, &sig, &pk)
        .map_err(|_| SignError::InvalidSignature)?;
    Ok(sig)
}

/// Sign an EOA create/delete authorization with any `Signer` via
/// [`Signer::sign_eoa_auth`]: fail-fast check that `account` is the signer's
/// own key (the runtime verifies the signature under `account`), then verify
/// the signature strictly over the canonical 82-byte message.
pub fn sign_eoa_auth_with<S: Signer + ?Sized>(
    signer: &S,
    kind: EoaAuthKind,
    chain_id: u16,
    fee_payer: &TnPubkey,
    account: &TnPubkey,
) -> Result<[u8; 64], SignError> {
    check_key(signer.public_key(), account)?;
    let sig = signer.sign_eoa_auth(kind, chain_id, fee_payer, account)?;
    let m = build_eoa_auth_message(kind, chain_id, fee_payer, account);
    tn_signature::verify_message(&m, &sig, account).map_err(|_| SignError::InvalidSignature)?;
    Ok(sig)
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
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        let m = tn_signature::signing_message(SignatureDomain::Msg, message);
        Ok(self.signing_key.sign(&m).to_bytes())
    }
    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &TnPubkey,
        account: &TnPubkey,
    ) -> Result<[u8; 64], SignError> {
        // The runtime verifies the authorization under `account`, so only the
        // account's own key may sign it.
        check_key(self.public_key(), account)?;
        let m = build_eoa_auth_message(kind, chain_id, fee_payer, account);
        Ok(self.signing_key.sign(&m).to_bytes())
    }
    /// A local signer holds the raw seed, so it can also sign under the legacy
    /// scheme (`tn_signature_legacy`).
    fn supports_legacy_scheme(&self) -> bool {
        true
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
        assert_eq!(
            msg.expected_pubkey(),
            &pk,
            "expected key is the body's fee-payer"
        );
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
        assert!(matches!(
            sign_with(&s, &msg),
            Err(SignError::KeyMismatch { .. })
        ));
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

    #[test]
    fn sign_transaction_body_default_matches_sign_over_m() {
        let s = LocalSigner::from_seed([9u8; 32]);
        let body = body_with_fee_payer(&s.public_key());
        let msg = build_transaction_signing_message(&body).unwrap();
        assert_eq!(
            s.sign_transaction_body(&body).unwrap(),
            s.sign(&msg).unwrap()
        );
        let signed = sign_transaction_body_with(&s, &body).unwrap();
        assert_eq!(signed, sign_with(&s, &msg).unwrap());
    }

    #[test]
    fn sign_transaction_body_with_is_fail_fast_on_key_mismatch() {
        let s = LocalSigner::from_seed([1u8; 32]);
        let body = body_with_fee_payer(&[2u8; 32]);
        assert!(matches!(
            sign_transaction_body_with(&s, &body),
            Err(SignError::KeyMismatch { .. })
        ));
    }

    /// A signer that returns garbage from `sign_transaction_body` (like a
    /// misbehaving device) is caught by verify-before-attach.
    struct GarbageSigner([u8; 32]);
    impl Signer for GarbageSigner {
        fn public_key(&self) -> [u8; 32] {
            self.0
        }
        fn sign(&self, _msg: &SigningMessage) -> Result<[u8; 64], SignError> {
            Ok([0x11u8; 64])
        }
    }

    #[test]
    fn sign_transaction_body_with_rejects_bad_signature() {
        let pk = LocalSigner::from_seed([4u8; 32]).public_key();
        let body = body_with_fee_payer(&pk);
        assert!(matches!(
            sign_transaction_body_with(&GarbageSigner(pk), &body),
            Err(SignError::InvalidSignature)
        ));
    }

    #[test]
    fn default_semantic_methods_are_unsupported() {
        let g = GarbageSigner([0u8; 32]);
        assert!(matches!(
            g.sign_message(b"hi"),
            Err(SignError::Unsupported(_))
        ));
        assert!(matches!(
            g.sign_eoa_auth(EoaAuthKind::Create, 1, &[1u8; 32], &[0u8; 32]),
            Err(SignError::Unsupported(_))
        ));
        assert!(!g.supports_legacy_scheme());
    }

    #[test]
    fn local_sign_message_matches_tn_signature() {
        let seed = [5u8; 32];
        let s = LocalSigner::from_seed(seed);
        let pk = s.public_key();
        let msg = b"hello thru";
        let sig = sign_message_with(&s, msg).unwrap();
        assert_eq!(sig, tn_signature::sign_message(msg, &pk, &seed).unwrap());
        assert!(tn_signature::verify_wallet_message(msg, &sig, &pk).is_ok());
    }

    #[test]
    fn sign_message_with_enforces_size_limit() {
        let s = LocalSigner::from_seed([5u8; 32]);
        assert!(sign_message_with(&s, &vec![0u8; MAX_MESSAGE_SZ]).is_ok());
        assert!(sign_message_with(&s, &vec![0u8; MAX_MESSAGE_SZ + 1]).is_err());
    }

    #[test]
    fn local_sign_eoa_auth_matches_existing_builders() {
        let seed = [6u8; 32];
        let s = LocalSigner::from_seed(seed);
        let pk = s.public_key();
        let fee_payer = [8u8; 32];
        let create = sign_eoa_auth_with(&s, EoaAuthKind::Create, 2, &fee_payer, &pk).unwrap();
        assert_eq!(
            create,
            crate::txn_tools::bp_sign_eoa_creation(&seed, 2, &fee_payer, &pk)
        );
        let delete = sign_eoa_auth_with(&s, EoaAuthKind::Delete, 2, &fee_payer, &pk).unwrap();
        let sk = SigningKey::from_bytes(&seed);
        assert_eq!(
            delete,
            sk.sign(&build_eoa_delete_message(2, &fee_payer, &pk))
                .to_bytes()
        );
        // The domain tag in the built message is the domain's DST.
        for kind in [EoaAuthKind::Create, EoaAuthKind::Delete] {
            let m = build_eoa_auth_message(kind, 2, &fee_payer, &pk);
            assert_eq!(m.len(), 82);
            assert_eq!(&m[..16], kind.domain().dst());
        }
        assert_ne!(create, delete);
    }

    #[test]
    fn sign_eoa_auth_rejects_foreign_account() {
        let s = LocalSigner::from_seed([6u8; 32]);
        assert!(matches!(
            sign_eoa_auth_with(&s, EoaAuthKind::Create, 1, &[8u8; 32], &[7u8; 32]),
            Err(SignError::KeyMismatch { .. })
        ));
        assert!(matches!(
            s.sign_eoa_auth(EoaAuthKind::Delete, 1, &[8u8; 32], &[7u8; 32]),
            Err(SignError::KeyMismatch { .. })
        ));
    }
}
