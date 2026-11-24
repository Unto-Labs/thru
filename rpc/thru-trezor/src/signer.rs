//! [`TrezorSigner`]: a `thru_base` [`Signer`] whose key lives on a Trezor.
//!
//! One signer is one connection: it opens the channel, loads the Thru app,
//! reads the public key of its path once and keeps the connection (behind a
//! lock) for signing. The device reviews every transaction itself; the host
//! checks only that the fee payer is the signer's key before involving the
//! device, and that the signature verifies afterwards. Text messages
//! (`tn_msg_sign_v1__` domain) and EOA authorizations are signed the same way.

use std::sync::Mutex;

use thru_base::signer::{
    EoaAuthKind, SignError, Signer, SigningMessage, build_eoa_auth_message,
    build_transaction_signing_message,
};
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_signature::{self, SignatureDomain};

use crate::app::{TOKEN_HINT_LEN, ThruApp};
use crate::client::{ConnectOptions, Trezor, Ui};
use crate::credentials::CredentialStorage;
use crate::error::{Result, TrezorError};
use crate::extapp::{AppImage, load};
use crate::path::DerivationPath;
use crate::transport::Transport;

/// The longest message the app signs (its inbox holds no more). The device
/// accepts only text of 1 to this many bytes.
pub const MESSAGE_MAX: usize = 512;

/// A Thru signer whose key lives on a Trezor.
///
/// The public key is read once (without showing it on the device) when the
/// signer is created, and every signature is checked against it.
pub struct TrezorSigner {
    app: Mutex<ThruApp<Box<dyn Transport + Send>>>,
    path: DerivationPath,
    pubkey: [u8; 32],
}

impl std::fmt::Debug for TrezorSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TrezorSigner")
            .field("path", &self.path)
            .field("address", &self.address())
            .finish()
    }
}

fn address(pubkey: &[u8; 32]) -> String {
    tn_pubkey_to_address_string(pubkey)
}

impl TrezorSigner {
    /// Connects over `transport` (pairing if the device does not know this
    /// host; the credential goes to `storage`), loads `image`, and reads the
    /// key at `path`.
    ///
    /// The address the device returns must equal the address the host
    /// computes from the key, else this fails with [`TrezorError::App`].
    pub fn connect(
        transport: impl Transport + Send + 'static,
        options: &ConnectOptions,
        image: &AppImage,
        path: DerivationPath,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
    ) -> Result<Self> {
        let transport: Box<dyn Transport + Send> = Box::new(transport);
        let mut trezor = Trezor::connect(transport, options, storage, ui)?;
        let instance_id = load(&mut trezor, image)?;
        let mut app = ThruApp::new(trezor, instance_id);
        let (pubkey, device_address) = app.public_key(path.components(), false)?;
        check_address(&pubkey, &device_address)?;
        Ok(TrezorSigner {
            app: Mutex::new(app),
            path,
            pubkey,
        })
    }

    /// Like [`Self::connect`], then requires the device key to equal
    /// `expected` (for example the key cached in a CLI config). A mismatch
    /// means another device, seed or passphrase.
    pub fn connect_expecting(
        transport: impl Transport + Send + 'static,
        options: &ConnectOptions,
        image: &AppImage,
        path: DerivationPath,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
        expected: &[u8; 32],
    ) -> Result<Self> {
        let signer = Self::connect(transport, options, image, path, storage, ui)?;
        if signer.pubkey != *expected {
            return Err(TrezorError::KeyMismatch {
                expected: address(expected),
                got: signer.address(),
            });
        }
        Ok(signer)
    }

    /// The derivation path.
    pub fn path(&self) -> &DerivationPath {
        &self.path
    }

    /// The public key read at connect time.
    pub fn pubkey(&self) -> [u8; 32] {
        self.pubkey
    }

    /// The `ta...` address of the key.
    pub fn address(&self) -> String {
        address(&self.pubkey)
    }

    fn with_app<R>(&self, f: impl FnOnce(&mut ThruApp<Box<dyn Transport + Send>>) -> R) -> R {
        // The lock only serializes calls; a panic in one leaves the
        // connection as usable (or unusable) as the device says.
        let mut app = self.app.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut app)
    }

    /// Shows the address and path on the device and waits for the user to
    /// confirm. Fails with [`TrezorError::KeyMismatch`] if the device now
    /// returns another key than the one read at connect time.
    pub fn verify_address_on_device(&self) -> Result<[u8; 32]> {
        let (pubkey, device_address) =
            self.with_app(|app| app.public_key(self.path.components(), true))?;
        check_address(&pubkey, &device_address)?;
        if pubkey != self.pubkey {
            return Err(TrezorError::KeyMismatch {
                expected: self.address(),
                got: address(&pubkey),
            });
        }
        Ok(pubkey)
    }

    /// Has the device sign a transaction body (the wire bytes before the
    /// trailing signature), after the user reviewed it there. The signature
    /// is verified under this signer's key before it is returned.
    ///
    /// This does not look at the body: the device does. [`Signer::sign_transaction_body`]
    /// first checks that the body's fee payer is this key.
    pub fn try_sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64]> {
        self.sign_body(body, None)
    }

    /// Like [`Self::try_sign_transaction_body`], with the token hint the
    /// device checks against the transaction (129 opaque bytes, passed on as
    /// they are).
    pub fn try_sign_transaction_body_with_token_hint(
        &self,
        body: &[u8],
        hint: &[u8; TOKEN_HINT_LEN],
    ) -> Result<[u8; 64]> {
        self.sign_body(body, Some(hint))
    }

    fn sign_body(&self, body: &[u8], hint: Option<&[u8; TOKEN_HINT_LEN]>) -> Result<[u8; 64]> {
        let signature =
            self.with_app(|app| app.sign_transaction(self.path.components(), body, hint))?;
        tn_signature::verify_transaction(body, &signature, &self.pubkey).map_err(|_| {
            TrezorError::App("the signature the device returned does not verify".into())
        })?;
        Ok(signature)
    }

    /// Has the device sign a text message in the `tn_msg_sign_v1__` domain,
    /// after the user reviewed it there. The message must be 1 to
    /// [`MESSAGE_MAX`] bytes, else nothing is sent. The signature is verified
    /// under this signer's key before it is returned.
    ///
    /// Whether the message is text is the device's to decide; it refuses
    /// anything else with [`TrezorError::AppRefused`].
    pub fn try_sign_message(&self, message: &[u8]) -> Result<[u8; 64]> {
        check_message_length(message)?;
        let signature = self.with_app(|app| app.sign_message(self.path.components(), message))?;
        verify_message_signature(message, &signature, &self.pubkey)?;
        Ok(signature)
    }

    /// Has the device sign an EOA authorization of `kind` for `account`, after
    /// the user reviewed it there. `account` must be this signer's key and
    /// `chain_id` must not be zero, else nothing is sent. The signature is
    /// verified under this signer's key over the authorization message of
    /// that kind before it is returned.
    pub fn try_sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64]> {
        check_eoa_auth_request(chain_id, account, &self.pubkey)?;
        let signature = self.with_app(|app| {
            app.sign_eoa_auth(self.path.components(), kind, chain_id, fee_payer, account)
        })?;
        verify_eoa_auth_signature(kind, chain_id, fee_payer, account, &signature, &self.pubkey)?;
        Ok(signature)
    }
}

/// An authorization the app would refuse is not sent: the chain id is not
/// zero, and the account is the signer's own key (the chain verifies the
/// signature under the account).
fn check_eoa_auth_request(chain_id: u16, account: &[u8; 32], pubkey: &[u8; 32]) -> Result<()> {
    if chain_id == 0 {
        return Err(TrezorError::InvalidRequest(
            "the chain id of an EOA authorization is not zero".into(),
        ));
    }
    if account != pubkey {
        return Err(TrezorError::InvalidRequest(format!(
            "the account of an EOA authorization must be this Trezor key ({}), not {}",
            address(pubkey),
            address(account)
        )));
    }
    Ok(())
}

/// Strict verification of an EOA authorization signature under `pubkey` over
/// the authorization message of `kind`.
fn verify_eoa_auth_signature(
    kind: EoaAuthKind,
    chain_id: u16,
    fee_payer: &[u8; 32],
    account: &[u8; 32],
    signature: &[u8; 64],
    pubkey: &[u8; 32],
) -> Result<()> {
    let message = build_eoa_auth_message(kind, chain_id, fee_payer, account);
    tn_signature::verify_message(&message, signature, pubkey)
        .map_err(|_| TrezorError::App("the signature the device returned does not verify".into()))
}

/// A message the app would not take, or that would not fit its inbox, is not
/// sent.
fn check_message_length(message: &[u8]) -> Result<()> {
    if message.is_empty() || message.len() > MESSAGE_MAX {
        return Err(TrezorError::InvalidRequest(format!(
            "the Trezor signs messages of 1 to {MESSAGE_MAX} bytes, this one has {}",
            message.len()
        )));
    }
    Ok(())
}

/// Strict verification of a message signature under `pubkey`.
fn verify_message_signature(message: &[u8], signature: &[u8; 64], pubkey: &[u8; 32]) -> Result<()> {
    tn_signature::verify(SignatureDomain::Msg, message, signature, pubkey)
        .map_err(|_| TrezorError::App("the signature the device returned does not verify".into()))
}

/// The address the device returned must be the address of the key it
/// returned, or the device (or the app) is not what it claims.
fn check_address(pubkey: &[u8; 32], device_address: &str) -> Result<()> {
    let computed = address(pubkey);
    if computed != device_address {
        return Err(TrezorError::App(format!(
            "the device returned address {device_address} for a key whose address is {computed}"
        )));
    }
    Ok(())
}

/// The body's fee payer must be `pubkey`, or the signature would verify under
/// a key the chain does not look at. Also refuses a body shorter than the
/// transaction header.
fn check_fee_payer(body: &[u8], pubkey: &[u8; 32]) -> std::result::Result<(), SignError> {
    let message = build_transaction_signing_message(body)?;
    if message.expected_pubkey() != pubkey {
        return Err(SignError::KeyMismatch {
            expected: *message.expected_pubkey(),
            got: *pubkey,
        });
    }
    Ok(())
}

/// How a device error reaches the caller of the `Signer` trait: a refusal on
/// the device is a rejection, anything else a backend error with its text.
fn sign_error(error: TrezorError) -> SignError {
    match error {
        TrezorError::Cancelled => SignError::Rejected,
        other => SignError::Backend(other.to_string()),
    }
}

impl Signer for TrezorSigner {
    fn public_key(&self) -> [u8; 32] {
        self.pubkey
    }

    /// The opaque `SigningMessage` carries its body, so the device is given
    /// that body (never the 48-byte message).
    fn sign(&self, msg: &SigningMessage) -> std::result::Result<[u8; 64], SignError> {
        self.sign_transaction_body(msg.body())
    }

    fn sign_transaction_body(&self, body: &[u8]) -> std::result::Result<[u8; 64], SignError> {
        check_fee_payer(body, &self.pubkey)?;
        self.try_sign_transaction_body(body).map_err(sign_error)
    }

    fn sign_message(&self, message: &[u8]) -> std::result::Result<[u8; 64], SignError> {
        self.try_sign_message(message).map_err(sign_error)
    }

    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> std::result::Result<[u8; 64], SignError> {
        self.try_sign_eoa_auth(kind, chain_id, fee_payer, account)
            .map_err(sign_error)
    }

    fn supports_legacy_scheme(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thru_base::signer::LocalSigner;

    /// A minimal transaction body whose fee payer (offset 48) is `fee_payer`.
    fn body_with_fee_payer(fee_payer: &[u8; 32]) -> Vec<u8> {
        let mut body = vec![0u8; 112 + 8];
        body[48..80].copy_from_slice(fee_payer);
        body
    }

    #[test]
    fn signer_and_connection_can_move_between_threads() {
        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}
        assert_send::<Trezor<Box<dyn Transport + Send>>>();
        assert_send::<ThruApp<Box<dyn Transport + Send>>>();
        assert_send::<TrezorSigner>();
        assert_sync::<TrezorSigner>();
    }

    #[test]
    fn the_fee_payer_must_be_the_key() {
        let key = LocalSigner::from_seed([1; 32]).public_key();
        let other = LocalSigner::from_seed([2; 32]).public_key();
        assert!(check_fee_payer(&body_with_fee_payer(&key), &key).is_ok());
        match check_fee_payer(&body_with_fee_payer(&other), &key) {
            Err(SignError::KeyMismatch { expected, got }) => {
                assert_eq!(expected, other);
                assert_eq!(got, key);
            }
            other => panic!("expected a key mismatch, got {other:?}"),
        }
        // A body shorter than the header is not a transaction.
        assert!(matches!(
            check_fee_payer(&[0u8; 20], &key),
            Err(SignError::Backend(_))
        ));
    }

    #[test]
    fn device_errors_map_to_sign_errors() {
        assert!(matches!(
            sign_error(TrezorError::Cancelled),
            SignError::Rejected
        ));
        assert!(matches!(
            sign_error(TrezorError::DeviceLocked),
            SignError::Backend(text) if text.contains("locked")
        ));
        assert!(matches!(
            sign_error(TrezorError::Failure { code: 3, message: "bad".into() }),
            SignError::Backend(text) if text.contains("bad")
        ));
    }

    #[test]
    fn message_length_is_checked_before_the_device() {
        assert!(check_message_length(b"a").is_ok());
        assert!(check_message_length(&[b'a'; MESSAGE_MAX]).is_ok());
        for message in [&[][..], &[b'a'; MESSAGE_MAX + 1][..]] {
            assert!(matches!(
                check_message_length(message),
                Err(TrezorError::InvalidRequest(_))
            ));
        }
    }

    #[test]
    fn a_message_signature_must_verify_in_the_message_domain() {
        let seed = [1u8; 32];
        let key = LocalSigner::from_seed(seed).public_key();
        let message = b"hello";
        let signature = tn_signature::sign_message(message, &key, &seed).expect("signs");
        assert!(verify_message_signature(message, &signature, &key).is_ok());
        // Another message, another key, a flipped bit and a transaction-domain
        // signature over the same bytes are all refused.
        let other = LocalSigner::from_seed([2; 32]).public_key();
        let mut flipped = signature;
        flipped[10] ^= 1;
        let txn_domain = tn_signature::sign_transaction(message, &key, &seed).expect("signs");
        assert!(verify_message_signature(b"hellp", &signature, &key).is_err());
        assert!(verify_message_signature(message, &signature, &other).is_err());
        assert!(verify_message_signature(message, &flipped, &key).is_err());
        assert!(verify_message_signature(message, &txn_domain, &key).is_err());
    }

    #[test]
    fn the_returned_address_must_belong_to_the_key() {
        let key = LocalSigner::from_seed([1; 32]).public_key();
        let other = LocalSigner::from_seed([2; 32]).public_key();
        assert!(check_address(&key, &address(&key)).is_ok());
        assert!(matches!(
            check_address(&key, &address(&other)),
            Err(TrezorError::App(_))
        ));
        assert!(matches!(
            check_address(&key, "not an address"),
            Err(TrezorError::App(_))
        ));
    }

    const CORPUS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../contrib/test/vectors/signing/eoa_auth_vectors.json"
    ));

    fn hex32(value: &serde_json::Value) -> [u8; 32] {
        hex::decode(value.as_str().expect("string"))
            .expect("hex")
            .try_into()
            .expect("32 bytes")
    }

    fn kind_of(name: &str) -> EoaAuthKind {
        match name {
            "create" => EoaAuthKind::Create,
            "delete" => EoaAuthKind::Delete,
            other => panic!("kind {other}"),
        }
    }

    struct Vector {
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: [u8; 32],
        account: [u8; 32],
        signature: [u8; 64],
    }

    /// The accepted vectors of the shared corpus.
    fn corpus_vectors() -> Vec<Vector> {
        let vectors: Vec<serde_json::Value> = serde_json::from_str(CORPUS).expect("corpus");
        vectors
            .iter()
            .filter(|v| v["category"] == "valid")
            .map(|v| Vector {
                kind: kind_of(v["kind"].as_str().expect("kind")),
                chain_id: u16::try_from(v["chain_id"].as_u64().expect("chain id")).expect("u16"),
                fee_payer: hex32(&v["fee_payer_hex"]),
                account: hex32(&v["account_hex"]),
                signature: hex::decode(v["signature_hex"].as_str().expect("signature"))
                    .expect("hex")
                    .try_into()
                    .expect("64 bytes"),
            })
            .collect()
    }

    #[test]
    fn eoa_auth_requests_are_checked_before_the_device() {
        let key = LocalSigner::from_seed([1; 32]).public_key();
        let other = LocalSigner::from_seed([2; 32]).public_key();
        assert!(check_eoa_auth_request(1, &key, &key).is_ok());
        assert!(check_eoa_auth_request(u16::MAX, &key, &key).is_ok());
        let wrong_account = check_eoa_auth_request(1, &other, &key).expect_err("other account");
        assert!(
            matches!(&wrong_account, TrezorError::InvalidRequest(m) if m.contains(&address(&key)) && m.contains(&address(&other))),
            "{wrong_account}"
        );
        assert!(matches!(
            check_eoa_auth_request(0, &key, &key),
            Err(TrezorError::InvalidRequest(m)) if m.contains("chain id")
        ));
        // Both wrong: the chain id is named, as the app does.
        assert!(matches!(
            check_eoa_auth_request(0, &other, &key),
            Err(TrezorError::InvalidRequest(m)) if m.contains("chain id")
        ));
    }

    #[test]
    fn corpus_signatures_verify_and_nothing_else_does() {
        let vectors = corpus_vectors();
        assert!(vectors.len() >= 8, "{} valid vectors", vectors.len());
        for Vector {
            kind,
            chain_id,
            fee_payer,
            account,
            signature,
        } in vectors
        {
            let verify = |kind, chain_id, fee_payer: &[u8; 32], account: &[u8; 32], key| {
                verify_eoa_auth_signature(kind, chain_id, fee_payer, account, &signature, key)
            };
            assert!(verify(kind, chain_id, &fee_payer, &account, &account).is_ok());

            let other_kind = match kind {
                EoaAuthKind::Create => EoaAuthKind::Delete,
                EoaAuthKind::Delete => EoaAuthKind::Create,
            };
            let mut other_fee_payer = fee_payer;
            other_fee_payer[0] ^= 1;
            let other_key = LocalSigner::from_seed([9; 32]).public_key();
            assert!(verify(other_kind, chain_id, &fee_payer, &account, &account).is_err());
            assert!(verify(kind, chain_id, &other_fee_payer, &account, &account).is_err());
            assert!(verify(kind, chain_id ^ 1, &fee_payer, &account, &account).is_err());
            assert!(verify(kind, chain_id, &fee_payer, &account, &other_key).is_err());
            let mut other_account = account;
            other_account[31] ^= 1;
            assert!(verify(kind, chain_id, &fee_payer, &other_account, &account).is_err());
            let mut flipped = signature;
            flipped[40] ^= 1;
            assert!(
                verify_eoa_auth_signature(kind, chain_id, &fee_payer, &account, &flipped, &account)
                    .is_err()
            );
        }
    }

    #[test]
    fn a_local_authorization_verifies_like_the_device_one_would() {
        let seed = [3u8; 32];
        let local = LocalSigner::from_seed(seed);
        let key = local.public_key();
        let fee_payer = LocalSigner::from_seed([4; 32]).public_key();
        let signature = local
            .sign_eoa_auth(EoaAuthKind::Delete, 7, &fee_payer, &key)
            .expect("signs");
        assert!(
            verify_eoa_auth_signature(EoaAuthKind::Delete, 7, &fee_payer, &key, &signature, &key)
                .is_ok()
        );
        // The kind is part of the message: the other kind does not verify.
        assert!(
            verify_eoa_auth_signature(EoaAuthKind::Create, 7, &fee_payer, &key, &signature, &key)
                .is_err()
        );
    }
}
