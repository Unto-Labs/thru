//! [`ThruLedger`]: a typed client for the Thru device app over any
//! [`Transport`].
//!
//! This layer speaks the APDU protocol only: it sends the exact request
//! sequences of the spec, maps every status word to a [`LedgerError`], and
//! reports progress.
//!
//! **Exclusive sessions (§11.0):** each multi-APDU operation
//! ([`ThruLedger::sign_txn`], [`ThruLedger::sign_message`]) sends all of its
//! APDUs back to back from one call; any other APDU sent to the device in
//! between aborts the device session.  Do not share one transport between
//! threads without serializing whole operations ([`crate::LedgerSigner`] holds
//! its client behind a mutex for exactly this reason).  It does **not** verify signatures; [`crate::LedgerSigner`]
//! adds the host-side obligations of spec §11 (pre-validation and strict
//! verification).

use std::sync::Arc;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use thru_base::signer::EoaAuthKind;

use crate::apdu::{self, AppConfig, AppVersion, Command, Response};
use crate::consts::{APDU_PROTOCOL_VERSION, THRU_APP_NAME};
use crate::error::LedgerError;
use crate::error::sw::SDK_CMD_NOT_ACCEPTED;
use crate::path::DerivationPath;
use crate::transport::Transport;

/// The operation a [`Progress`] event belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    /// GET_PUBKEY with on-device address verification.
    VerifyAddress,
    /// SIGN_TXN.
    SignTransaction,
    /// SIGN_MESSAGE pass 1 (ends with on-device review).
    SignMessagePass1,
    /// SIGN_MESSAGE pass 2 (no UI).
    SignMessagePass2,
    /// SIGN_EOA_AUTH.
    SignEoaAuth,
}

/// A progress event, emitted before each APDU of a multi-APDU or interactive
/// operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    /// Operation.
    pub operation: Operation,
    /// APDUs already sent and acknowledged in this operation (or pass).
    pub chunks_sent: usize,
    /// Total APDUs in this operation (or pass), including chunk 0.
    pub chunks_total: usize,
    /// Payload bytes already sent (body or message bytes; excludes chunk 0).
    pub bytes_sent: usize,
    /// Total payload bytes.
    pub bytes_total: usize,
    /// `true` when the APDU about to be sent waits for the user to review and
    /// approve on the device (the host must not time out; spec §10.4).
    pub awaiting_user: bool,
}

/// Progress callback.
pub type ProgressFn = Arc<dyn Fn(&Progress) + Send + Sync>;

/// How long to keep retrying an APDU answered with `0x6901` (spec §5.2).
///
/// The Ledger Rust SDK draws the status page after a review synchronously
/// (about 3 s) and answers every APDU that arrives meanwhile with `0x6901`
/// without passing it to the app, so the APDU had no effect and resending it
/// is safe.  Delays double from `initial_delay` up to `max_delay`; once
/// `budget` has elapsed the error is [`LedgerError::Busy`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BusyRetry {
    /// Total time to keep retrying one APDU.
    pub budget: Duration,
    /// First delay.
    pub initial_delay: Duration,
    /// Largest delay.
    pub max_delay: Duration,
}

impl Default for BusyRetry {
    fn default() -> Self {
        Self {
            budget: Duration::from_secs(5),
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_millis(500),
        }
    }
}

impl BusyRetry {
    /// Never retry: `0x6901` is returned as [`LedgerError::Busy`] at once.
    pub const NONE: Self = Self {
        budget: Duration::ZERO,
        initial_delay: Duration::ZERO,
        max_delay: Duration::ZERO,
    };
}

/// Typed client for the Thru device app.
pub struct ThruLedger<T: Transport> {
    transport: T,
    progress: Option<ProgressFn>,
    busy_retry: BusyRetry,
}

impl<T: Transport> ThruLedger<T> {
    /// Wrap a transport.
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            progress: None,
            busy_retry: BusyRetry::default(),
        }
    }

    /// Change the `0x6901` retry policy (default: about 5 s).
    pub fn set_busy_retry(&mut self, retry: BusyRetry) {
        self.busy_retry = retry;
    }

    /// Install a progress callback.
    pub fn set_progress(&mut self, progress: Option<ProgressFn>) {
        self.progress = progress;
    }

    /// The underlying transport.
    pub fn transport(&self) -> &T {
        &self.transport
    }

    fn report(&self, p: Progress) {
        if let Some(cb) = &self.progress {
            cb(&p);
        }
    }

    /// Send one command and return its data on `0x9000`.  Status words are
    /// mapped in the context of the command's INS (§5.3).
    ///
    /// `0x6901` (the SDK busy with a status page; the app never saw the APDU)
    /// is retried with a short backoff under [`BusyRetry`].
    pub fn exchange(&self, cmd: &Command) -> Result<Vec<u8>, LedgerError> {
        let encoded = cmd.encode()?;
        let started = Instant::now();
        let mut delay = self.busy_retry.initial_delay;
        loop {
            let raw = self.transport.exchange(&encoded)?;
            let response = Response::decode(&raw)?;
            if response.sw != SDK_CMD_NOT_ACCEPTED {
                return response.into_result_for(cmd.ins);
            }
            let elapsed = started.elapsed();
            if elapsed >= self.busy_retry.budget {
                return Err(LedgerError::Busy);
            }
            std::thread::sleep(delay.min(self.busy_retry.budget - elapsed));
            delay = (delay * 2).min(self.busy_retry.max_delay);
        }
    }

    /// Like [`Self::exchange`] but requires an empty `0x9000` response
    /// (intermediate chunks, end of message pass 1).
    fn exchange_empty(&self, cmd: &Command) -> Result<(), LedgerError> {
        let data = self.exchange(cmd)?;
        if !data.is_empty() {
            return Err(LedgerError::UnexpectedResponse(format!(
                "expected an empty response, got {} bytes",
                data.len()
            )));
        }
        Ok(())
    }

    /// GET_VERSION.
    pub fn get_version(&self) -> Result<AppVersion, LedgerError> {
        apdu::parse_version(&self.exchange(&apdu::get_version())?)
    }

    /// GET_APP_NAME.
    pub fn get_app_name(&self) -> Result<String, LedgerError> {
        let data = self.exchange(&apdu::get_app_name())?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    }

    /// GET_APP_CONFIG.
    pub fn get_app_config(&self) -> Result<AppConfig, LedgerError> {
        apdu::parse_app_config(&self.exchange(&apdu::get_app_config())?)
    }

    /// OS GET_APP_AND_VERSION (`B0 01`): `(app name, version string)`.
    pub fn get_app_and_version(&self) -> Result<(String, String), LedgerError> {
        apdu::parse_app_and_version(&self.exchange(&apdu::os_get_app_and_version())?)
    }

    /// Confirm the Thru app is open and speaks our protocol (spec §11.1 step 2).
    ///
    /// Uses `B0 01` first; if the firmware does not answer it (for example an
    /// emulator), falls back to GET_APP_NAME.  Then checks
    /// `apdu_protocol_version`.
    pub fn ensure_app(&self) -> Result<AppConfig, LedgerError> {
        let name = match self.get_app_and_version() {
            Ok((name, _)) => name,
            Err(e @ (LedgerError::Locked | LedgerError::Busy | LedgerError::Transport(_))) => {
                return Err(e);
            }
            Err(_) => self.get_app_name()?,
        };
        if name != THRU_APP_NAME {
            return Err(LedgerError::WrongApp {
                detail: format!("the open app is \"{name}\"; open the Thru app"),
            });
        }
        let cfg = self.get_app_config()?;
        if cfg.apdu_protocol_version != APDU_PROTOCOL_VERSION {
            return Err(LedgerError::UnsupportedAppVersion {
                device: cfg.apdu_protocol_version,
                host: APDU_PROTOCOL_VERSION,
            });
        }
        Ok(cfg)
    }

    /// GET_PUBKEY.  With `display`, the device shows the address and path and
    /// waits for the user (no timeout).
    pub fn get_pubkey(
        &self,
        path: &DerivationPath,
        display: bool,
    ) -> Result<[u8; 32], LedgerError> {
        if display {
            self.report(Progress {
                operation: Operation::VerifyAddress,
                chunks_sent: 0,
                chunks_total: 1,
                bytes_sent: 0,
                bytes_total: 0,
                awaiting_user: true,
            });
        }
        apdu::parse_pubkey(&self.exchange(&apdu::get_pubkey(path, display))?)
    }

    /// SIGN_TXN: stream the full body and return the raw device signature.
    ///
    /// The caller must verify the signature before use (spec §11.2);
    /// [`crate::LedgerSigner`] does.
    pub fn sign_txn(&self, path: &DerivationPath, body: &[u8]) -> Result<[u8; 64], LedgerError> {
        self.sign_txn_with_hint(path, body, None)
    }

    /// [`Self::sign_txn`] with an optional token hint in chunk 0 (§7.2.1).
    pub fn sign_txn_with_hint(
        &self,
        path: &DerivationPath,
        body: &[u8],
        hint: Option<&crate::TokenHint>,
    ) -> Result<[u8; 64], LedgerError> {
        let cmds = apdu::sign_txn_with_hint(path, body, hint)?;
        let total = cmds.len();
        let mut bytes_sent = 0;
        let last = total - 1;
        for (i, cmd) in cmds.iter().enumerate() {
            self.report(Progress {
                operation: Operation::SignTransaction,
                chunks_sent: i,
                chunks_total: total,
                bytes_sent,
                bytes_total: body.len(),
                awaiting_user: i == last,
            });
            if i == last {
                return apdu::parse_signature(&self.exchange(cmd)?);
            }
            self.exchange_empty(cmd)?;
            if i > 0 {
                bytes_sent += cmd.data.len();
            }
        }
        unreachable!("sign_txn always has a last chunk")
    }

    /// SIGN_MESSAGE: chunk 0, pass 1 (approval on its last chunk), pass 2 from
    /// the same immutable buffer; returns the raw device signature.
    ///
    /// The host hashes the bytes it actually sends in each pass and refuses to
    /// send the last pass-2 chunk if they differ (spec §11.4).
    pub fn sign_message(
        &self,
        path: &DerivationPath,
        message: &[u8],
    ) -> Result<[u8; 64], LedgerError> {
        let start = apdu::sign_message_start(path, message.len())?;
        self.exchange_empty(&start)?;

        let pass = apdu::sign_message_pass(message)?;
        let total = pass.len();

        // Pass 1.
        let mut h1 = Sha256::new();
        let mut sent = 0;
        for (i, cmd) in pass.iter().enumerate() {
            self.report(Progress {
                operation: Operation::SignMessagePass1,
                chunks_sent: i,
                chunks_total: total,
                bytes_sent: sent,
                bytes_total: message.len(),
                awaiting_user: i + 1 == total,
            });
            h1.update(&cmd.data);
            self.exchange_empty(cmd)?;
            sent += cmd.data.len();
        }
        let d1 = h1.finalize();

        // Pass 2: rebuild the chunks from the same buffer.
        let pass2 = apdu::sign_message_pass(message)?;
        let mut h2 = Sha256::new();
        let mut sent = 0;
        for (i, cmd) in pass2.iter().enumerate() {
            self.report(Progress {
                operation: Operation::SignMessagePass2,
                chunks_sent: i,
                chunks_total: total,
                bytes_sent: sent,
                bytes_total: message.len(),
                awaiting_user: false,
            });
            h2.update(&cmd.data);
            if i + 1 == total {
                if h2.clone().finalize() != d1 {
                    return Err(LedgerError::ProtocolError {
                        sw: crate::error::sw::MSG_PASS_MISMATCH,
                        reason: "host refused to finish: message passes differ",
                    });
                }
                return apdu::parse_signature(&self.exchange(cmd)?);
            }
            self.exchange_empty(cmd)?;
            sent += cmd.data.len();
        }
        unreachable!("a non-empty message always has a last chunk")
    }

    /// SIGN_EOA_AUTH: returns the raw device signature over the 82-byte M.
    pub fn sign_eoa_auth(
        &self,
        path: &DerivationPath,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], LedgerError> {
        self.report(Progress {
            operation: Operation::SignEoaAuth,
            chunks_sent: 0,
            chunks_total: 1,
            bytes_sent: 0,
            bytes_total: 0,
            awaiting_user: true,
        });
        let cmd = apdu::sign_eoa_auth(path, kind, chain_id, fee_payer, account);
        apdu::parse_signature(&self.exchange(&cmd)?)
    }
}
