//! [`LedgerSigner`]: a [`thru_base::signer::Signer`] backed by the Thru
//! Ledger app.
//!
//! Host obligations (spec §11) implemented here:
//!
//! * the app is checked (`B0 01` name and `apdu_protocol_version`) when the
//!   signer connects;
//! * transaction bodies are validated locally with the reference validator and
//!   the fee payer is checked against the device key **before** any APDU is
//!   streamed;
//! * a review preview (§7.7 / §8.6 / §9.4 values, Appendix B formats,
//!   including the transaction or message hash) is built from the exact
//!   bytes about to be streamed and handed to an optional preview hook
//!   ([`LedgerSigner::with_preview`]) before the first APDU, so the host can
//!   show it for comparison with the device (§11.3);
//! * the full body is streamed (never `M`, never a digest);
//! * every returned signature is verified strictly (canonical encodings,
//!   `verify_strict`) against the expected key before it is returned;
//! * the legacy (pre-RFC-8032) signing scheme is not supported
//!   (`supports_legacy_scheme() == false`, decision D11).

use std::sync::{Arc, Mutex};

use thru_base::signer::{
    EoaAuthKind, SignError, Signer, SigningMessage, build_eoa_auth_message,
    build_transaction_signing_message,
};
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_signature::{self, SignatureDomain};
use thru_base::txn_lib::{RpcError, validate_wire_transaction};

use crate::apdu::AppConfig;
use crate::consts::{MSG_MAX, TXN_BODY_MAX, TXN_HDR_SZ};
use crate::device::{ProgressFn, ThruLedger};
use crate::error::{LedgerError, TxnReject};
use crate::path::DerivationPath;
use crate::preview::{EoaAuthPreview, MessagePreview, Preview, TransactionPreview};
use crate::transport::Transport;

/// A Thru signer whose key lives on a Ledger device.
///
/// The public key is fetched once (silent GET_PUBKEY) when the signer is
/// created and cached; every signature is checked against it.
pub struct LedgerSigner {
    device: Arc<Mutex<ThruLedger<Box<dyn Transport>>>>,
    path: DerivationPath,
    pubkey: [u8; 32],
    config: AppConfig,
    preview_hook: Option<PreviewFn>,
    last_preview: Mutex<Option<Preview>>,
}

/// Preview callback: receives what the device is about to show, before the
/// first APDU of the operation is sent.
pub type PreviewFn = Arc<dyn Fn(&Preview) + Send + Sync>;

impl std::fmt::Debug for LedgerSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LedgerSigner")
            .field("path", &self.path)
            .field("address", &self.address())
            .finish()
    }
}

fn address(pk: &[u8; 32]) -> String {
    tn_pubkey_to_address_string(pk)
}

impl LedgerSigner {
    /// Connect over `transport`: check the open app and protocol version, then
    /// read the public key for `path` (silently).
    pub fn connect(
        transport: impl Transport + 'static,
        path: DerivationPath,
    ) -> Result<Self, LedgerError> {
        let device = ThruLedger::new(Box::new(transport) as Box<dyn Transport>);
        let config = device.ensure_app()?;
        let pubkey = device.get_pubkey(&path, false)?;
        Ok(Self {
            device: Arc::new(Mutex::new(device)),
            path,
            pubkey,
            config,
            preview_hook: None,
            last_preview: Mutex::new(None),
        })
    }

    /// Like [`Self::connect`], then require the device key to equal
    /// `expected` (for example the pubkey cached in a CLI config).  A mismatch
    /// means a different device, seed or passphrase.
    pub fn connect_expecting(
        transport: impl Transport + 'static,
        path: DerivationPath,
        expected: &[u8; 32],
    ) -> Result<Self, LedgerError> {
        let signer = Self::connect(transport, path)?;
        if signer.pubkey != *expected {
            return Err(LedgerError::KeyMismatch {
                expected: address(expected),
                got: signer.address(),
            });
        }
        Ok(signer)
    }

    /// Resolve another path on this connection, checking its cached key if
    /// supplied. All signers share the operation-wide device lock.
    pub fn for_path(
        &self,
        path: DerivationPath,
        expected: Option<[u8; 32]>,
    ) -> Result<Self, LedgerError> {
        let pubkey = self.with_device(|device| device.get_pubkey(&path, false))?;
        if let Some(expected) = expected
            && pubkey != expected
        {
            return Err(LedgerError::KeyMismatch {
                expected: address(&expected),
                got: address(&pubkey),
            });
        }
        Ok(Self {
            device: Arc::clone(&self.device),
            path,
            pubkey,
            config: self.config,
            preview_hook: self.preview_hook.clone(),
            last_preview: Mutex::new(None),
        })
    }

    /// Install (or clear) a progress callback, used for long bodies and to tell
    /// the user when the device is waiting for approval.
    pub fn with_progress(self, progress: Option<ProgressFn>) -> Self {
        self.device
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_progress(progress);
        self
    }

    /// Install (or clear) a preview callback.  It is called with the review
    /// the device is about to show (built from the exact bytes that will be
    /// streamed) after the host checks pass and before the first APDU, so the
    /// host can print the values, including the transaction or message hash,
    /// for the user to compare with the device (spec §11.3).
    pub fn with_preview(mut self, hook: Option<PreviewFn>) -> Self {
        self.preview_hook = hook;
        self
    }

    /// The preview of the most recent signing request that passed the host
    /// checks (whether or not the device then approved it).
    pub fn last_preview(&self) -> Option<Preview> {
        self.last_preview
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The §7.7 review the device will show for `body`, after the same host
    /// checks [`Self::try_sign_transaction_body`] runs (pre-validation, fee
    /// payer equals this device key).  Does not contact the device.
    pub fn preview_transaction_body(&self, body: &[u8]) -> Result<TransactionPreview, LedgerError> {
        self.preview_body(body, None)
    }

    /// [`Self::preview_transaction_body`] with the token hint that will be
    /// sent: the hinted token review, or `InvalidRequest(TokenHint)`.
    pub fn preview_transaction_body_with_token_hint(
        &self,
        body: &[u8],
        hint: &crate::TokenHint,
    ) -> Result<TransactionPreview, LedgerError> {
        self.preview_body(body, Some(hint))
    }

    fn preview_body(
        &self,
        body: &[u8],
        hint: Option<&crate::TokenHint>,
    ) -> Result<TransactionPreview, LedgerError> {
        let mut preview = TransactionPreview::from_body(body)?;
        if preview.fee_payer_key != self.pubkey {
            return Err(LedgerError::KeyMismatch {
                expected: preview.fee_payer.clone(),
                got: self.address(),
            });
        }
        if let Some(hint) = hint {
            preview.apply_token_hint(body, hint)?;
        }
        Ok(preview)
    }

    /// The §8.6 review the device will show for `message` (text or hash
    /// mode, with the message hash).  Does not contact the device.
    pub fn preview_message(&self, message: &[u8]) -> Result<MessagePreview, LedgerError> {
        MessagePreview::new(&self.pubkey, message)
    }

    fn emit_preview(&self, preview: Preview) {
        if let Some(hook) = &self.preview_hook {
            hook(&preview);
        }
        *self.last_preview.lock().unwrap_or_else(|e| e.into_inner()) = Some(preview);
    }

    /// The derivation path.
    pub fn path(&self) -> &DerivationPath {
        &self.path
    }

    /// The cached public key.
    pub fn pubkey(&self) -> [u8; 32] {
        self.pubkey
    }

    /// The `ta…` address.
    pub fn address(&self) -> String {
        address(&self.pubkey)
    }

    /// The app config read at connect time (version, blind-signing flag).
    pub fn app_config(&self) -> AppConfig {
        self.config
    }

    fn with_device<R>(&self, f: impl FnOnce(&ThruLedger<Box<dyn Transport>>) -> R) -> R {
        let guard = self.device.lock().unwrap_or_else(|e| e.into_inner());
        f(&guard)
    }

    /// Re-read the app config (for proactive "enable blind signing" UX).
    ///
    /// Fails with `UnsupportedAppVersion` if the app now reports another APDU
    /// protocol version (for example the app was replaced while connected).
    pub fn refresh_app_config(&self) -> Result<AppConfig, LedgerError> {
        let cfg = self.with_device(|d| d.get_app_config())?;
        if cfg.apdu_protocol_version != crate::consts::APDU_PROTOCOL_VERSION {
            return Err(LedgerError::UnsupportedAppVersion {
                device: cfg.apdu_protocol_version,
                host: crate::consts::APDU_PROTOCOL_VERSION,
            });
        }
        Ok(cfg)
    }

    /// Show the address and path on the device and wait for the user to
    /// confirm (GET_PUBKEY P1 = 1).  Fails with `KeyMismatch` if the device
    /// returns a different key than the cached one.
    pub fn verify_address_on_device(&self) -> Result<[u8; 32], LedgerError> {
        let pk = self.with_device(|d| d.get_pubkey(&self.path, true))?;
        if pk != self.pubkey {
            return Err(LedgerError::KeyMismatch {
                expected: self.address(),
                got: address(&pk),
            });
        }
        Ok(pk)
    }

    /// Sign a transaction body on the device, with the §11 host checks and a
    /// strict verification of the result.  Returns the 64-byte signature.
    ///
    /// The preview hook (if any) receives the §7.7 review, computed from
    /// `body` itself, before the first APDU; `body` is then streamed as is.
    pub fn try_sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], LedgerError> {
        self.sign_body(body, None)
    }

    /// [`Self::try_sign_transaction_body`] for a token transfer, with the
    /// token hint (§7.2.1): the device then shows the account owners and the
    /// mint instead of the token accounts.  The hint is checked against
    /// `body` first ([`crate::verify_token_hint`]); a mismatch is
    /// `InvalidRequest(TokenHint)` and the device is not contacted.
    pub fn try_sign_transaction_body_with_token_hint(
        &self,
        body: &[u8],
        hint: &crate::TokenHint,
    ) -> Result<[u8; 64], LedgerError> {
        self.sign_body(body, Some(hint))
    }

    fn sign_body(
        &self,
        body: &[u8],
        hint: Option<&crate::TokenHint>,
    ) -> Result<[u8; 64], LedgerError> {
        let preview = self.preview_body(body, hint)?;
        self.emit_preview(Preview::Transaction(preview));
        let sig = self.with_device(|d| d.sign_txn_with_hint(&self.path, body, hint))?;
        tn_signature::verify_transaction(body, &sig, &self.pubkey)
            .map_err(|_| LedgerError::InvalidSignature)?;
        Ok(sig)
    }

    /// Sign an off-chain message (`tn_msg_sign_v1__` domain), 1..=32768 bytes,
    /// verifying the result strictly.
    pub fn try_sign_message(&self, message: &[u8]) -> Result<[u8; 64], LedgerError> {
        if message.is_empty() || message.len() > MSG_MAX {
            return Err(LedgerError::InvalidRequest(
                crate::error::RequestReject::MessageLength,
            ));
        }
        let preview = self.preview_message(message)?;
        self.emit_preview(Preview::Message(preview));
        let sig = self.with_device(|d| d.sign_message(&self.path, message))?;
        tn_signature::verify(SignatureDomain::Msg, message, &sig, &self.pubkey)
            .map_err(|_| LedgerError::InvalidSignature)?;
        Ok(sig)
    }

    /// Sign an EOA create/delete authorization for this device's own account,
    /// verifying the result strictly over the canonical 82-byte message.
    pub fn try_sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], LedgerError> {
        if *account != self.pubkey {
            return Err(LedgerError::KeyMismatch {
                expected: address(account),
                got: self.address(),
            });
        }
        if chain_id == 0 {
            return Err(LedgerError::InvalidRequest(
                crate::error::RequestReject::ChainIdZero,
            ));
        }
        self.emit_preview(Preview::EoaAuth(EoaAuthPreview::new(
            kind, chain_id, fee_payer, account,
        )));
        let sig =
            self.with_device(|d| d.sign_eoa_auth(&self.path, kind, chain_id, fee_payer, account))?;
        let m = build_eoa_auth_message(kind, chain_id, fee_payer, account);
        tn_signature::verify_message(&m, &sig, &self.pubkey)
            .map_err(|_| LedgerError::InvalidSignature)?;
        Ok(sig)
    }
}

/// Host-side pre-validation of a body (spec §11.1 step 3) with the reference
/// validator.  `validate_wire_transaction` needs `body ‖ sig` and ends with a
/// signature check; a zero signature reaches that check only when every
/// structural and account-layout rule passed, so `InvalidTransactionSignature`
/// means the body is valid.
///
/// A refused body is reported as [`LedgerError::InvalidTransaction`] with the
/// same reason class the device (and the corpus `sw_class`) uses (§5.3,
/// §13.3), so host and device errors can be compared.
pub fn precheck_body(body: &[u8]) -> Result<(), LedgerError> {
    if body.len() < TXN_HDR_SZ || body.len() > TXN_BODY_MAX {
        return Err(LedgerError::InvalidTransaction(TxnReject::InvalidFormat));
    }
    let mut wire = Vec::with_capacity(body.len() + 64);
    wire.extend_from_slice(body);
    wire.extend_from_slice(&[0u8; 64]);
    match validate_wire_transaction(&wire) {
        Ok(()) | Err(RpcError::InvalidTransactionSignature) => Ok(()),
        Err(e) => Err(LedgerError::InvalidTransaction(txn_reject_from_rpc(&e))),
    }
}

/// Map a reference-validator error to the device / corpus reason class
/// (spec §13.3 table).
pub fn txn_reject_from_rpc(e: &RpcError) -> TxnReject {
    match e {
        RpcError::InvalidTransactionSize { .. }
        | RpcError::TrailingBytes { .. }
        | RpcError::InvalidFormat
        | RpcError::InvalidParams(_)
        // Unreachable here (handled by the caller); a signature problem is
        // not a body-format reason, but `format` is the closest class.
        | RpcError::InvalidTransactionSignature => TxnReject::InvalidFormat,
        RpcError::InvalidVersion => TxnReject::InvalidVersion,
        RpcError::InvalidFlags => TxnReject::InvalidFlags,
        RpcError::InvalidChainId => TxnReject::ChainIdZero,
        RpcError::InvalidFeePayerStateProofType => TxnReject::InvalidProofType,
        RpcError::TooManyAccounts { .. } => TxnReject::AccountLimit,
        RpcError::DuplicateAccount => TxnReject::DuplicateAccount,
        RpcError::UnsortedReadwriteAccounts => TxnReject::UnsortedReadWrite,
        RpcError::UnsortedReadonlyAccounts => TxnReject::UnsortedReadOnly,
    }
}

impl From<LedgerError> for SignError {
    fn from(e: LedgerError) -> Self {
        match e {
            LedgerError::UserRejected => SignError::Rejected,
            LedgerError::InvalidSignature => SignError::InvalidSignature,
            other => SignError::Backend(other.to_string()),
        }
    }
}

/// Map a key mismatch with known raw keys into the thru-base error.
fn key_mismatch(expected: &[u8; 32], got: &[u8; 32]) -> SignError {
    SignError::KeyMismatch {
        expected: *expected,
        got: *got,
    }
}

impl Signer for LedgerSigner {
    fn public_key(&self) -> [u8; 32] {
        self.pubkey
    }

    /// The opaque `SigningMessage` carries its body snapshot, so the device
    /// streams that body (never `M`).
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError> {
        self.sign_transaction_body(msg.body())
    }

    fn sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], SignError> {
        // Reuse the thru-base builder for the fee-payer extraction so the
        // KeyMismatch carries raw keys.
        let msg = build_transaction_signing_message(body)?;
        if *msg.expected_pubkey() != self.pubkey {
            return Err(key_mismatch(msg.expected_pubkey(), &self.pubkey));
        }
        Ok(self.try_sign_transaction_body(body)?)
    }

    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        Ok(self.try_sign_message(message)?)
    }

    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], SignError> {
        if *account != self.pubkey {
            return Err(key_mismatch(account, &self.pubkey));
        }
        Ok(self.try_sign_eoa_auth(kind, chain_id, fee_payer, account)?)
    }

    fn supports_legacy_scheme(&self) -> bool {
        false
    }
}

/// Shared handle so one connected signer can be used from several places.
pub type SharedLedgerSigner = Arc<LedgerSigner>;
