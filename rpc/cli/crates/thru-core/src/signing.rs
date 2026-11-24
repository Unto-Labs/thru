//! Signing for the Thru CLI.
//!
//! Every transaction the CLI signs goes through [`thru_base::signer::Signer`]
//! via [`sign_transaction`]: build the transaction, take its body with
//! `to_wire_for_signing()`, ask the signer to sign the body, strictly verify the
//! signature (`attach_signature`), and only then attach it.  Local keys (a
//! [`thru_base::tn_tools::KeyPair`] or a [`crate::keys::LoadedKey`]) produce
//! byte-identical signatures to the previous `Transaction::sign(&private_key)`
//! path, because Ed25519 is deterministic.
//!
//! A Ledger key is a registered key whose source is a Ledger derivation path,
//! or that path selected directly as `ledger://44'/8478'/0'/0'`.  Commands that
//! resolve their signer with [`resolve_signer`] sign on the Ledger when the
//! key (or the `--fee-payer` / key argument) is a Ledger key.
//!
//! Transport selection for Ledger keys: USB HID.  Builds with the
//! non-default `ledger-speculos` cargo feature (test harnesses only) also
//! accept `THRU_LEDGER_SPECULOS=host:port` for a Speculos emulator's APDU
//! port, with a loud warning on every connection; other builds refuse to run
//! when that variable is set.
//!
//! A Trezor key works the same way with `trezor://44'/8478'/0'/0'` (backend:
//! `rpc/thru-trezor`, the Thru app on a Trezor Safe 7).  Transport: USB.  Builds
//! with the non-default `trezor-emulator` cargo feature (test harnesses only)
//! also accept `THRU_TREZOR_EMULATOR=host:port` for the Trezor emulator, with a
//! loud warning on every connection; other builds refuse to run when that
//! variable is set.  The Thru app image comes from `THRU_TREZOR_APP`.  The app
//! signs transactions, text messages and EOA authorizations, and the device
//! shows its own review.
//!
//! Before the device asks for approval, the CLI prints the review the device
//! will show (spec §11.3), including the full transaction or message hash.  For
//! a Trezor key that review is [`crate::trezor_preview`]'s, printed right
//! before the signing request is sent and kept for the `trezor_preview` of the
//! `--json` output.

use std::sync::{Arc, Mutex};

use thru_base::signer::{
    EoaAuthKind, SignError, Signer, attach_signature, build_transaction_signing_message,
};
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_tools::Pubkey;
use thru_base::txn_lib::Transaction;
use thru_ledger::{
    DerivationPath, LedgerError, LedgerSigner, Operation, Preview, PreviewFn, Progress, ProgressFn,
    Transport,
};
use thru_trezor::{
    AppImage, ConnectOptions, FileCredentialStorage, Transport as TrezorTransport, TransportError,
    TrezorError, TrezorSigner, Ui,
};

use crate::config::Config;
use crate::error::CliError;
use crate::keys::TrezorTarget;
use crate::trezor_preview::{self, Review};

/// URI scheme that marks a Ledger key source, e.g. `ledger://44'/8478'/0'/0'`.
pub const LEDGER_URI_SCHEME: &str = thru_ledger::LEDGER_URI_SCHEME;

/// Environment variable selecting the Speculos transport (`host:port` of the
/// emulator's raw APDU server) instead of USB HID.
pub const ENV_LEDGER_SPECULOS: &str = "THRU_LEDGER_SPECULOS";

/// A connected Ledger shared between a [`ResolvedSigner`]'s `signer` and its
/// `ledger` handle (so the caller can read the last review preview).
struct SharedLedger(Arc<LedgerSigner>);

impl Signer for SharedLedger {
    fn public_key(&self) -> [u8; 32] {
        self.0.public_key()
    }
    fn sign(&self, msg: &thru_base::signer::SigningMessage) -> Result<[u8; 64], SignError> {
        self.0.sign(msg)
    }
    fn sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], SignError> {
        self.0.sign_transaction_body(body)
    }
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        self.0.sign_message(message)
    }
    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], SignError> {
        self.0.sign_eoa_auth(kind, chain_id, fee_payer, account)
    }
    fn supports_legacy_scheme(&self) -> bool {
        self.0.supports_legacy_scheme()
    }
}

/// Whether this build can talk to the Speculos emulator.  Only builds with
/// the non-default cargo feature `ledger-speculos` (test harnesses) can; a
/// release CLI never treats a TCP endpoint as a Ledger (audit A-018).
pub const SPECULOS_SUPPORTED: bool = cfg!(feature = "ledger-speculos");

/// The Speculos endpoint selected by [`ENV_LEDGER_SPECULOS`], if set.
fn speculos_endpoint() -> Option<String> {
    std::env::var(ENV_LEDGER_SPECULOS)
        .ok()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
}

/// Whether Ledger operations in this process go to the Speculos emulator
/// rather than a hardware device.  Approvals over this transport are not
/// approvals on a hardware wallet and are never reported as such.
pub fn ledger_is_emulator() -> bool {
    SPECULOS_SUPPORTED && speculos_endpoint().is_some()
}

/// Open the Ledger transport: the first USB HID device, or (only in builds
/// with the `ledger-speculos` feature) the Speculos emulator named by
/// [`ENV_LEDGER_SPECULOS`].  In other builds, setting the variable is an
/// error rather than being silently ignored.
pub fn open_ledger_transport() -> Result<Box<dyn Transport>, CliError> {
    if let Some(addr) = speculos_endpoint() {
        return open_speculos_transport(&addr);
    }
    let t =
        thru_ledger::HidTransport::open().map_err(|e| ledger_error(LedgerError::Transport(e)))?;
    Ok(Box::new(t))
}

/// The warning printed on every connection to the emulator.
pub fn speculos_warning(addr: &str) -> String {
    format!(
        "WARNING: {ENV_LEDGER_SPECULOS}={addr}: using the Speculos EMULATOR, NOT A HARDWARE \
         DEVICE. Keys and approvals come from whatever answers on that TCP port. Never use \
         this for real funds; unset {ENV_LEDGER_SPECULOS} to use a USB Ledger."
    )
}

#[cfg(feature = "ledger-speculos")]
fn open_speculos_transport(addr: &str) -> Result<Box<dyn Transport>, CliError> {
    eprintln!("{}", speculos_warning(addr));
    let t = thru_ledger::SpeculosTransport::connect(addr)
        .map_err(|e| ledger_error(LedgerError::Transport(e)))?;
    Ok(Box::new(t))
}

#[cfg(not(feature = "ledger-speculos"))]
fn open_speculos_transport(addr: &str) -> Result<Box<dyn Transport>, CliError> {
    Err(CliError::Ledger {
        code: "speculos_unsupported".to_string(),
        status_word: None,
        reason: None,
        message: format!(
            "{ENV_LEDGER_SPECULOS} is set ({addr}), but this thru build does not support the \
             Speculos emulator and will not treat a TCP endpoint as a Ledger. Unset \
             {ENV_LEDGER_SPECULOS} to use a USB Ledger (emulator support exists only in test \
             builds with the `ledger-speculos` cargo feature)."
        ),
    })
}

/// A progress hook that tells the user (on stderr) when the device is waiting
/// for them, and how far a long transaction stream has got.
pub fn ledger_progress_printer() -> ProgressFn {
    Arc::new(|p: &Progress| {
        if p.awaiting_user {
            let what = match p.operation {
                Operation::VerifyAddress => "Verify the address on your Ledger and approve it",
                Operation::SignTransaction => {
                    "Review the transaction on your Ledger; compare the transaction hash, then approve"
                }
                Operation::SignMessagePass1 => "Review the message on your Ledger and approve it",
                Operation::SignEoaAuth => {
                    "Review the account authorization on your Ledger and approve it"
                }
                Operation::SignMessagePass2 => return,
            };
            eprintln!("{what}...");
        } else if p.operation == Operation::SignTransaction
            && p.chunks_total > 16
            && p.chunks_sent % 16 == 0
        {
            eprintln!(
                "Sending transaction to Ledger: {}/{} bytes",
                p.bytes_sent, p.bytes_total
            );
        }
    })
}

/// Render a review preview as the lines the CLI prints before the device
/// prompt: the device's labels, in the device's order, with the exact values
/// (Appendix B formats; hashes in full as 64 lowercase hex characters).  A
/// text-mode message has one labelled field per LF-separated device line,
/// including empty lines. Ambiguous whitespace uses hash mode (§8.7).
pub fn format_ledger_preview(preview: &Preview) -> String {
    use std::fmt::Write;
    let fields = preview.fields();
    let width = fields.iter().map(|(l, _)| l.len()).max().unwrap_or(0) + 1;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Ledger review ({}): your device must show exactly these values",
        preview.title()
    );
    for (label, value) in &fields {
        let label = format!("{label}:");
        let _ = writeln!(out, "  {label:<width$} {value}");
    }
    match preview {
        Preview::Transaction(_) => {
            out.push_str(
                "  Reject on the device if any value differs, especially the transaction hash.\n",
            );
        }
        Preview::Message(m) if m.is_hash_mode() => {
            out.push_str("  Reject on the device if the message hash differs.\n");
        }
        _ => {}
    }
    out
}

/// The preview as JSON (also included in `--json` command output as
/// `ledger_preview`).
pub fn ledger_preview_json(preview: &Preview) -> serde_json::Value {
    use serde_json::json;
    let fields: Vec<serde_json::Value> = preview
        .fields()
        .into_iter()
        .map(|(label, value)| json!({ "label": label, "value": value }))
        .collect();
    match preview {
        Preview::Transaction(p) => json!({
            "kind": "transaction",
            "title": preview.title(),
            "fields": fields,
            "transaction_hash": p.transaction_hash,
            "network": p.network,
            "chain_id": p.chain_id,
            "fee_payer": p.fee_payer,
            "program": p.program_address,
            "program_label": p.program_label,
            "fee": p.fee,
            "fee_base_units": p.fee_base_units,
            "high_fee": p.high_fee_warning.is_some(),
            "nonce": p.nonce,
            "start_slot": p.start_slot,
            "expiry_slot": p.expiry_slot,
            "last_valid_slot": p.last_valid_slot,
            "valid_slots": p.valid_slots,
            "rw_accounts": p.rw_cnt,
            "ro_accounts": p.ro_cnt,
            "instruction_data_len": p.instr_sz,
            "body_len": p.body_len,
            "requires_blind_signing": p.requires_blind_signing,
        }),
        Preview::Message(p) => json!({
            "kind": "message",
            "title": preview.title(),
            "fields": fields,
            "display": if p.is_hash_mode() { "hash" } else { "text" },
            "signer": p.signer,
            "message_hash": p.message_hash,
            "message_len": p.len,
        }),
        Preview::EoaAuth(p) => json!({
            "kind": "eoa_auth",
            "title": preview.title(),
            "fields": fields,
            "network": p.network,
            "account": p.account,
            "fee_payer": p.fee_payer,
        }),
    }
}

/// A preview hook that prints the review (stderr) before anything is sent to
/// the device, so the user can compare it with the device screens (spec
/// §11.3).
pub fn ledger_preview_printer() -> PreviewFn {
    Arc::new(|p: &Preview| eprint!("{}", format_ledger_preview(p)))
}

/// Connect to the Ledger and read the key at `path`, optionally requiring it
/// to equal `expected`.
pub fn connect_ledger(
    path: DerivationPath,
    expected: Option<[u8; 32]>,
) -> Result<LedgerSigner, CliError> {
    connect_ledger_with(open_ledger_transport()?, path, expected)
}

/// [`connect_ledger`] over an explicit transport (used by tests).
pub fn connect_ledger_with(
    transport: impl Transport + 'static,
    path: DerivationPath,
    expected: Option<[u8; 32]>,
) -> Result<LedgerSigner, CliError> {
    let signer = match expected {
        Some(pk) => LedgerSigner::connect_expecting(transport, path, &pk),
        None => LedgerSigner::connect(transport, path),
    }
    .map_err(ledger_error)?;
    Ok(signer
        .with_progress(Some(ledger_progress_printer()))
        .with_preview(Some(ledger_preview_printer())))
}

/// Stable machine-readable class of a Ledger error (JSON `error.code`).
pub fn ledger_error_code(e: &LedgerError) -> &'static str {
    match e {
        LedgerError::UserRejected => "user_rejected",
        LedgerError::BlindSigningDisabled => "blind_signing_disabled",
        LedgerError::FeePayerMismatch => "fee_payer_mismatch",
        LedgerError::PathRejected | LedgerError::InvalidPath(_) => "path_rejected",
        LedgerError::EoaAccountMismatch => "eoa_account_mismatch",
        LedgerError::InvalidTransaction(_) => "invalid_transaction",
        LedgerError::InvalidRequest(_) => "invalid_request",
        LedgerError::ProtocolError { .. } => "protocol_error",
        LedgerError::Locked => "locked",
        LedgerError::WrongApp { .. } => "wrong_app",
        LedgerError::Unsupported { .. } | LedgerError::UnsupportedAppVersion { .. } => {
            "unsupported_app_version"
        }
        LedgerError::DeviceError => "device_error",
        LedgerError::Busy => "device_busy",
        LedgerError::Unknown(_) => "unknown_status",
        LedgerError::UnexpectedResponse(_) => "unexpected_response",
        LedgerError::Transport(thru_ledger::TransportError::NoDevice) => "no_device",
        LedgerError::Transport(_) => "transport",
        LedgerError::InvalidInput(_) => "invalid_input",
        LedgerError::KeyMismatch { .. } => "key_mismatch",
        LedgerError::InvalidSignature => "invalid_signature",
    }
}

/// Convert a Ledger error into a CLI error carrying the actionable message.
pub fn ledger_error(e: LedgerError) -> CliError {
    CliError::Ledger {
        code: ledger_error_code(&e).to_string(),
        status_word: e.status_word(),
        reason: e.reason_class().map(str::to_string),
        message: e.to_string(),
    }
}

/// URI scheme that marks a Trezor key source, e.g. `trezor://44'/8478'/0'/0'`.
pub const TREZOR_URI_SCHEME: &str = thru_trezor::TREZOR_URI_SCHEME;

/// Environment variable selecting the Trezor emulator (`host:port` of its UDP
/// port) instead of USB.
pub const ENV_TREZOR_EMULATOR: &str = "THRU_TREZOR_EMULATOR";

/// Environment variable naming the Thru app image (a `.tapp` file) to load on
/// the Trezor.
pub const ENV_TREZOR_APP: &str = "THRU_TREZOR_APP";

/// File, in the CLI's configuration directory, holding the pairing credentials.
pub const TREZOR_PAIRING_FILE: &str = "trezor-pairing.json";

/// What the device shows as the name of this host when it asks to pair.
const TREZOR_HOST_NAME: &str = "this computer";

/// A connected Trezor shared between a [`ResolvedSigner`]'s `signer` and its
/// `trezor` handle.
struct SharedTrezor(Arc<TrezorSigner>);

impl Signer for SharedTrezor {
    fn public_key(&self) -> [u8; 32] {
        self.0.public_key()
    }
    fn sign(&self, msg: &thru_base::signer::SigningMessage) -> Result<[u8; 64], SignError> {
        self.0.sign(msg)
    }
    fn sign_transaction_body(&self, body: &[u8]) -> Result<[u8; 64], SignError> {
        self.0.sign_transaction_body(body)
    }
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        self.0.sign_message(message)
    }
    fn sign_eoa_auth(
        &self,
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], SignError> {
        self.0.sign_eoa_auth(kind, chain_id, fee_payer, account)
    }
}

/// Whether this build can talk to the Trezor emulator.  Only builds with the
/// non-default cargo feature `trezor-emulator` (test harnesses) can; a release
/// CLI never treats a UDP endpoint as a Trezor.
pub const TREZOR_EMULATOR_SUPPORTED: bool = cfg!(feature = "trezor-emulator");

/// The emulator endpoint selected by [`ENV_TREZOR_EMULATOR`], if set.
fn trezor_emulator_endpoint() -> Option<String> {
    std::env::var(ENV_TREZOR_EMULATOR)
        .ok()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
}

/// Whether Trezor operations in this process go to the emulator rather than a
/// hardware device.  Approvals over this transport are not approvals on a
/// hardware wallet and are never reported as such.
pub fn trezor_is_emulator() -> bool {
    TREZOR_EMULATOR_SUPPORTED && trezor_emulator_endpoint().is_some()
}

/// The warning printed on every connection to the emulator.
pub fn trezor_emulator_warning(addr: &str) -> String {
    format!(
        "WARNING: {ENV_TREZOR_EMULATOR}={addr}: using the Trezor EMULATOR, NOT A HARDWARE \
         DEVICE. Keys and approvals come from whatever answers on that UDP port, and pairing \
         is skipped. Never use this for real funds; unset {ENV_TREZOR_EMULATOR} to use a USB \
         Trezor."
    )
}

/// Open the Trezor transport and say how to connect over it: the first USB
/// device, or (only in builds with the `trezor-emulator` feature) the emulator
/// named by [`ENV_TREZOR_EMULATOR`], the one transport on which pairing may be
/// skipped.  In other builds, setting the variable is an error rather than
/// being silently ignored.
pub fn open_trezor_transport() -> Result<(Box<dyn TrezorTransport + Send>, ConnectOptions), CliError>
{
    let options = ConnectOptions::new(TREZOR_HOST_NAME, "thru");
    if let Some(addr) = trezor_emulator_endpoint() {
        return open_trezor_emulator(&addr, options);
    }
    let t =
        thru_trezor::UsbTransport::open().map_err(|e| trezor_error(TrezorError::Transport(e)))?;
    Ok((Box::new(t), options))
}

#[cfg(feature = "trezor-emulator")]
fn open_trezor_emulator(
    addr: &str,
    options: ConnectOptions,
) -> Result<(Box<dyn TrezorTransport + Send>, ConnectOptions), CliError> {
    eprintln!("{}", trezor_emulator_warning(addr));
    let t = thru_trezor::UdpTransport::connect(addr)
        .map_err(|e| trezor_error(TrezorError::Transport(e)))?;
    // The one place that allows pairing without a code.
    Ok((Box::new(t), options.allow_skip_pairing(true)))
}

#[cfg(not(feature = "trezor-emulator"))]
fn open_trezor_emulator(
    addr: &str,
    _options: ConnectOptions,
) -> Result<(Box<dyn TrezorTransport + Send>, ConnectOptions), CliError> {
    Err(trezor_emulator_unsupported(addr))
}

#[cfg(not(feature = "trezor-emulator"))]
fn trezor_emulator_unsupported(addr: &str) -> CliError {
    CliError::Trezor {
        code: "emulator_unsupported".to_string(),
        reason: None,
        message: format!(
            "{ENV_TREZOR_EMULATOR} is set ({addr}), but this thru build does not support the \
             Trezor emulator and will not treat a UDP endpoint as a Trezor. Unset \
             {ENV_TREZOR_EMULATOR} to use a USB Trezor (emulator support exists only in test \
             builds with the `trezor-emulator` cargo feature)."
        ),
    }
}

/// Fail at once, before anything else is read or opened, when the emulator is
/// requested in a build that does not support it.
fn check_trezor_emulator_allowed() -> Result<(), CliError> {
    #[cfg(not(feature = "trezor-emulator"))]
    if let Some(addr) = trezor_emulator_endpoint() {
        return Err(trezor_emulator_unsupported(&addr));
    }
    Ok(())
}

/// The Thru app image named by [`ENV_TREZOR_APP`].
pub fn trezor_app_image() -> Result<AppImage, CliError> {
    let tell = |why: String| CliError::Trezor {
        code: "app_image".to_string(),
        reason: None,
        message: format!(
            "{why}. Set {ENV_TREZOR_APP} to the path of the Thru app image for your Trezor \
             (the .tapp file; its .proof file must be beside it)"
        ),
    };
    let path = std::env::var(ENV_TREZOR_APP)
        .ok()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .ok_or_else(|| tell(format!("{ENV_TREZOR_APP} is not set")))?;
    AppImage::read(&path).map_err(|e| tell(format!("cannot use {ENV_TREZOR_APP}={path}: {e}")))
}

/// What the person is told while the Trezor waits for a confirmation.
const TREZOR_CONFIRM_PROMPT: &str = "Confirm on the Trezor.";

/// What the person is told while the Trezor waits for the passphrase of a
/// passphrase wallet; the computer never sees it.
const TREZOR_PASSPHRASE_PROMPT: &str = "Enter the passphrase on the Trezor.";

/// The terminal side of a Trezor connection: prompts go to standard error, the
/// pairing code is read from standard input.
struct TerminalUi;

impl Ui for TerminalUi {
    fn confirm_on_device(&mut self) {
        eprintln!("{TREZOR_CONFIRM_PROMPT}");
    }

    fn enter_passphrase_on_device(&mut self) {
        eprintln!("{TREZOR_PASSPHRASE_PROMPT}");
    }

    fn pairing_code(&mut self) -> thru_trezor::Result<String> {
        read_pairing_code(&mut std::io::stdin().lock(), &mut std::io::stderr())
    }
}

/// Prompt on `out` and read one line of digits from `input` (the device shows
/// them as `123 456`).
fn read_pairing_code(
    input: &mut impl std::io::BufRead,
    out: &mut impl std::io::Write,
) -> thru_trezor::Result<String> {
    let _ = write!(out, "Code shown on the Trezor: ");
    let _ = out.flush();
    let mut line = String::new();
    let n = input
        .read_line(&mut line)
        .map_err(|e| TrezorError::Pairing(format!("could not read the code: {e}")))?;
    let code: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    if n == 0 || code.is_empty() {
        return Err(TrezorError::Pairing(
            "no code was entered; run the command again and type the digits the Trezor shows"
                .to_string(),
        ));
    }
    Ok(code)
}

/// Connect to the Trezor and read the key `target` names: at its path, in the
/// wallet of its passphrase flag (the passphrase is typed on the device), and
/// required to equal its expected public key if it has one.
pub fn connect_trezor(target: TrezorTarget) -> Result<TrezorSigner, CliError> {
    // Cheap local checks first: nothing may touch a device when they fail.
    check_trezor_emulator_allowed()?;
    let image = trezor_app_image()?;
    let storage = FileCredentialStorage::new(Config::get_config_dir()?.join(TREZOR_PAIRING_FILE));
    let (transport, options) = open_trezor_transport()?;
    connect_trezor_with(transport, &options, &image, &storage, target)
}

/// [`connect_trezor`] over an explicit transport (used by tests).
pub fn connect_trezor_with(
    transport: Box<dyn TrezorTransport + Send>,
    options: &ConnectOptions,
    image: &AppImage,
    storage: &FileCredentialStorage,
    target: TrezorTarget,
) -> Result<TrezorSigner, CliError> {
    let options = options.clone().passphrase_on_device(target.passphrase());
    match target.expected() {
        Some(pk) => TrezorSigner::connect_expecting(
            transport,
            &options,
            image,
            target.path(),
            storage,
            Box::new(TerminalUi),
            &pk,
        ),
        None => TrezorSigner::connect(
            transport,
            &options,
            image,
            target.path(),
            storage,
            Box::new(TerminalUi),
        ),
    }
    .map_err(|e| trezor_key_error(e, target.passphrase()))
}

/// Stable machine-readable class of a Trezor error (JSON `error.code`).
pub fn trezor_error_code(e: &TrezorError) -> &'static str {
    match e {
        TrezorError::Cancelled => "user_rejected",
        TrezorError::Transport(TransportError::NotFound(_)) => "not_found",
        TrezorError::Transport(TransportError::Ambiguous) => "ambiguous_device",
        TrezorError::Transport(TransportError::Io(_)) => "transport",
        TrezorError::Timeout(_) => "timeout",
        TrezorError::DeviceLocked => "locked",
        TrezorError::Protocol(_) | TrezorError::Unexpected(_) | TrezorError::App(_) => {
            "protocol_error"
        }
        TrezorError::Failure { .. } => "device_error",
        TrezorError::AppRefused(_) => "app_refused",
        TrezorError::InvalidRequest(_) => "invalid_request",
        TrezorError::PassphraseOnDeviceOnly => "passphrase_on_device_only",
        TrezorError::PassphraseProtectionOff => "passphrase_protection_off",
        TrezorError::OlderProtocolRefused => "older_protocol_refused",
        TrezorError::Pairing(_) => "pairing_failed",
        TrezorError::Credentials(_) => "credentials",
        TrezorError::AppImage(_) => "app_image",
        TrezorError::KeyMismatch { .. } => "key_mismatch",
    }
}

/// Convert a Trezor error into a CLI error carrying the actionable message.
pub fn trezor_error(e: TrezorError) -> CliError {
    let code = trezor_error_code(&e);
    let hint = match code {
        "not_found" => {
            " (connect the Trezor with a USB cable and unlock it, and close Trezor Suite)"
        }
        "app_image" => " (check THRU_TREZOR_APP: it must name the Thru app image for this device)",
        "passphrase_on_device_only" => {
            "; register this key as a key of a passphrase wallet \
             (thru keys add-trezor NAME --passphrase) and type its passphrase on the Trezor \
             (an empty passphrase gives the standard wallet)"
        }
        _ => "",
    };
    let reason = e.app_refusal().map(str::to_string);
    let message = match e.app_refusal() {
        Some(reason) => trezor_refusal_sentence(reason),
        None => format!("{e}{hint}"),
    };
    CliError::Trezor {
        code: code.to_string(),
        message,
        reason,
    }
}

/// [`trezor_error`] for a failure on the key of a wallet: when the key is of a
/// passphrase wallet, a key mismatch says that another passphrase may have
/// been typed on the device.
pub fn trezor_key_error(e: TrezorError, passphrase: bool) -> CliError {
    let mismatch = passphrase && matches!(e, TrezorError::KeyMismatch { .. });
    let mut error = trezor_error(e);
    if mismatch && let CliError::Trezor { message, .. } = &mut error {
        message.push_str(
            "; this key belongs to a passphrase wallet, so another passphrase may have been \
             typed on the Trezor",
        );
    }
    error
}

/// What the Thru app's refusal `reason` means for the person at the
/// keyboard.  A reason this CLI does not know is passed on as the app gave it.
fn trezor_refusal_sentence(reason: &str) -> String {
    match reason {
        "message_not_text" => format!(
            "the Trezor signs a message only if it can show it as text: {TREZOR_TEXT_RULE}; \
             sign other messages with a local or a Ledger key"
        ),
        "token_hint_length" => "the Thru app on the Trezor refused the token hint: it is not \
             129 bytes long (this is a fault of the CLI; report it)"
            .to_string(),
        "token_hint_kind" => "the Thru app on the Trezor refused the token hint: it is not a \
             token transfer hint (this is a fault of the CLI; report it)"
            .to_string(),
        "token_hint_mismatch" => "the Thru app on the Trezor refused the token hint: the mint \
             and the owners in it do not derive the token accounts of this transaction, or the \
             transaction is not a token transfer"
            .to_string(),
        "unsupported_transaction" => "the Thru app on the Trezor does not sign this \
             transaction: it signs only native transfers, token transfers in the layout the \
             CLI builds, wallet-program transfers whose accounts are exactly the wallet \
             account and the recipient, and the creation of the signing account"
            .to_string(),
        "fee_payer_mismatch" => "the transaction's fee payer is not the key of this Trezor; \
             the Trezor signs only transactions that this key pays for"
            .to_string(),
        other => format!("the Thru app on the Trezor refused the request: {other}"),
    }
}

/// What a message must be for a Trezor to sign it (the rule of
/// [`thru_ledger::preview::is_text_message`], which the Trezor app applies
/// too).
pub const TREZOR_TEXT_RULE: &str = "1 to 512 bytes of printable ASCII and line breaks, at most 16 \
     lines, no space at the start or end of a line, no two spaces in a row, and no long run of \
     one-character words separated by single spaces";

/// The token hint as the Trezor app takes it: the Ledger's encoding.
pub fn trezor_token_hint_bytes(hint: &thru_ledger::TokenHint) -> [u8; thru_trezor::TOKEN_HINT_LEN] {
    const _: () = assert!(thru_ledger::token_hint::TOKEN_HINT_SZ == thru_trezor::TOKEN_HINT_LEN);
    hint.encode()
}

/// Prints `review` (when there is one) and then sends the request.  Nothing is
/// sent before the review is printed; a request the app will refuse has no
/// review and is sent all the same, so the app's own refusal is the answer.
pub(crate) fn print_trezor_review_then<T>(
    review: Option<&Review>,
    print: impl FnOnce(&str),
    request: impl FnOnce() -> T,
) -> T {
    if let Some(review) = review {
        print(&trezor_preview::format_trezor_preview(review));
    }
    request()
}

/// [`print_trezor_review_then`] that prints to standard error.
pub(crate) fn eprint_trezor_review_then<T>(
    review: Option<&Review>,
    request: impl FnOnce() -> T,
) -> T {
    print_trezor_review_then(review, |text| eprint!("{text}"), request)
}

/// Puts `preview` under `trezor_preview` in the `section` object of a `--json`
/// response; a response without that object is returned as it is.
fn insert_trezor_preview(
    mut response: serde_json::Value,
    section: &str,
    preview: serde_json::Value,
) -> serde_json::Value {
    if let Some(obj) = response.get_mut(section).and_then(|v| v.as_object_mut()) {
        obj.insert("trezor_preview".to_string(), preview);
    }
    response
}

/// A signing identity resolved from a key name, a `ledger://` URI or a
/// `trezor://` URI.
pub struct ResolvedSigner {
    /// What the user typed (key name or URI).
    pub name: String,
    /// The Ledger derivation path, for a Ledger key.
    pub path: Option<DerivationPath>,
    /// The signer (local key, or a connected Ledger).
    pub signer: Box<dyn Signer + Send + Sync>,
    /// Raw public key.
    pub public_key: [u8; 32],
    /// `ta…` address.
    pub address: Pubkey,
    /// The connected Ledger, for a Ledger key (same device as `signer`).
    pub ledger: Option<Arc<LedgerSigner>>,
    /// The connected Trezor, for a Trezor key (same device as `signer`).
    pub trezor: Option<Arc<TrezorSigner>>,
    /// The review the Trezor was last asked to show (`None` before the first
    /// request, and after one the Thru app will refuse).
    trezor_review: Mutex<Option<Review>>,
}

impl ResolvedSigner {
    /// Whether the key lives on a Ledger.
    pub fn is_ledger(&self) -> bool {
        self.ledger.is_some()
    }

    /// Whether the key lives on a Trezor.
    pub fn is_trezor(&self) -> bool {
        self.trezor.is_some()
    }

    /// The review preview of the last request sent to the Ledger, if any.
    pub fn ledger_preview(&self) -> Option<Preview> {
        self.ledger.as_ref().and_then(|l| l.last_preview())
    }

    /// [`Self::ledger_preview`] as JSON (`null` for local keys), for the
    /// `ledger_preview` field of `--json` output.
    pub fn ledger_preview_json(&self) -> serde_json::Value {
        self.ledger_preview()
            .map(|p| ledger_preview_json(&p))
            .unwrap_or(serde_json::Value::Null)
    }

    /// Keeps the review of the request the Trezor is about to get.
    pub(crate) fn set_trezor_review(&self, review: Option<Review>) {
        *self.trezor_review.lock().unwrap_or_else(|e| e.into_inner()) = review;
    }

    /// The review of the last request sent to the Trezor, as the
    /// `trezor_preview` value (`null` when there was none).
    pub fn trezor_preview_json(&self) -> serde_json::Value {
        self.trezor_review
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map_or(serde_json::Value::Null, Review::to_json)
    }

    /// For a Trezor key, add `trezor_preview` to the `section` object of a
    /// `--json` response; every other key leaves the response unchanged.
    pub fn add_trezor_preview(
        &self,
        response: serde_json::Value,
        section: &str,
    ) -> serde_json::Value {
        if self.is_trezor() {
            insert_trezor_preview(response, section, self.trezor_preview_json())
        } else {
            response
        }
    }

    /// For a Ledger key, add `ledger_preview` to the `section` object of a
    /// `--json` response (for example `"transfer"`); local keys leave the
    /// response unchanged.
    pub fn add_ledger_preview(
        &self,
        mut response: serde_json::Value,
        section: &str,
    ) -> serde_json::Value {
        if self.is_ledger()
            && let Some(obj) = response.get_mut(section).and_then(|v| v.as_object_mut())
        {
            obj.insert("ledger_preview".to_string(), self.ledger_preview_json());
        }
        response
    }

    /// Wrap a connected Ledger signer (used by tests and by callers that
    /// connect explicitly).
    pub fn from_ledger(name: &str, path: DerivationPath, ledger: LedgerSigner) -> Self {
        let ledger = Arc::new(ledger);
        let public_key = ledger.pubkey();
        Self {
            name: name.to_string(),
            path: Some(path),
            signer: Box::new(SharedLedger(ledger.clone())),
            public_key,
            address: Pubkey::from_bytes(&public_key),
            ledger: Some(ledger),
            trezor: None,
            trezor_review: Mutex::new(None),
        }
    }

    /// Wrap a connected Trezor signer.
    pub fn from_trezor(name: &str, trezor: TrezorSigner) -> Self {
        let trezor = Arc::new(trezor);
        let public_key = trezor.pubkey();
        Self {
            name: name.to_string(),
            path: None,
            signer: Box::new(SharedTrezor(trezor.clone())),
            public_key,
            address: Pubkey::from_bytes(&public_key),
            ledger: None,
            trezor: Some(trezor),
            trezor_review: Mutex::new(None),
        }
    }
}

/// Resolve a signing key reference (alias, file, Keychain item, or a
/// `ledger://…` / `trezor://…` URI) to a signer.  Ledger and Trezor keys
/// connect to the device and are checked against the registered public key,
/// if any.
pub fn resolve_signer(config: &Config, name_or_uri: &str) -> Result<ResolvedSigner, CliError> {
    resolve_signer_reusing_ledger(config, name_or_uri, None)
}

/// Resolve another key on an already-connected Ledger when available.
pub(crate) fn resolve_signer_reusing_ledger(
    config: &Config,
    name_or_uri: &str,
    connected: Option<&LedgerSigner>,
) -> Result<ResolvedSigner, CliError> {
    if let Some((path, expected)) = config.keys.ledger_source(name_or_uri)? {
        let ledger = match connected {
            Some(ledger) => ledger.for_path(path, expected).map_err(ledger_error)?,
            None => connect_ledger(path, expected)?,
        };
        return Ok(ResolvedSigner::from_ledger(name_or_uri, path, ledger));
    }
    if let Some(target) = config.keys.trezor_source(name_or_uri)? {
        return Ok(ResolvedSigner::from_trezor(
            name_or_uri,
            connect_trezor(target)?,
        ));
    }
    let key = config.keys.load_key(name_or_uri)?;
    let public_key = key.public_key;
    Ok(ResolvedSigner {
        name: name_or_uri.to_string(),
        path: None,
        public_key,
        address: Pubkey::from_bytes(&public_key),
        signer: Box::new(key),
        ledger: None,
        trezor: None,
        trezor_review: Mutex::new(None),
    })
}

/// The `ta…` address string of a raw public key.
pub fn address_string(pk: &[u8; 32]) -> String {
    tn_pubkey_to_address_string(pk)
}

/// Sign `transaction` with `signer` through the [`Signer`] abstraction:
/// validate the account layout, sign the body (`to_wire_for_signing()`),
/// strictly verify the signature, then attach it.  The error type matches the
/// previous `Transaction::sign`, so existing error messages are unchanged.
///
/// Returns the signed wire (`body ‖ sig`) built from the exact body that was
/// signed; the signature is attached only if `transaction.to_wire()`
/// reproduces those bytes (audit A-042), so submitting either is the same.
pub fn sign_transaction<S: Signer + ?Sized>(
    transaction: &mut Transaction,
    signer: &S,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    transaction.sign_with_signer_wire(signer)
}

/// Sign with a resolved signer and return the signed wire to submit.
///
/// For a Ledger key, the body is frozen once (`build_transaction_signing_message`),
/// streamed to the device from that snapshot (after the host checks and the
/// review preview), the returned signature is verified over the snapshot
/// before it is attached (`attach_signature`), and the signed bytes are the
/// snapshot plus the signature.  Ledger errors keep their typed
/// [`CliError::Ledger`] (code, status word, reason class).  Every other error
/// is passed to `other`, so each command keeps its existing message.
pub fn sign_transaction_for(
    transaction: &mut Transaction,
    signer: &ResolvedSigner,
    other: impl Fn(Box<dyn std::error::Error>) -> CliError,
) -> Result<Vec<u8>, CliError> {
    sign_transaction_for_with_token_hint(transaction, signer, None, other)
}

/// [`sign_transaction_for`] for a token transfer: a Ledger or a Trezor signer
/// also sends `token_hint` (APDU spec §7.2.1), so the device shows the
/// token-account owners and the mint instead of the token accounts.  A Ledger
/// checks the hint against the transaction before the device is contacted;
/// the Trezor app checks it on the device.  Local keys ignore it.
pub fn sign_transaction_for_with_token_hint(
    transaction: &mut Transaction,
    signer: &ResolvedSigner,
    token_hint: Option<&thru_ledger::TokenHint>,
    other: impl Fn(Box<dyn std::error::Error>) -> CliError,
) -> Result<Vec<u8>, CliError> {
    if let Some(trezor) = &signer.trezor {
        return sign_transaction_on_trezor(transaction, trezor, signer, token_hint, other);
    }
    let Some(ledger) = &signer.ledger else {
        return sign_transaction(transaction, signer.signer.as_ref()).map_err(other);
    };
    transaction.validate().map_err(|e| other(Box::new(e)))?;
    let msg = build_transaction_signing_message(&transaction.to_wire_for_signing())
        .map_err(|e| other(Box::new(e)))?;
    let sig = match token_hint {
        Some(hint) => ledger.try_sign_transaction_body_with_token_hint(msg.body(), hint),
        None => ledger.try_sign_transaction_body(msg.body()),
    }
    .map_err(ledger_error)?;
    let signed = attach_signature(&msg, sig).map_err(|e| other(Box::new(e)))?;
    transaction
        .attach_signed_wire(&signed)
        .map_err(|e| other(Box::new(e)))?;
    Ok(signed)
}

/// [`sign_transaction_for`] for a Trezor key: the body is frozen once and sent
/// to the device (which reviews it, and checks `token_hint` against it when
/// there is one), and the signature is verified over the same snapshot before
/// it is attached.  Trezor errors keep their typed [`CliError::Trezor`].
fn sign_transaction_on_trezor(
    transaction: &mut Transaction,
    trezor: &TrezorSigner,
    signer: &ResolvedSigner,
    token_hint: Option<&thru_ledger::TokenHint>,
    other: impl Fn(Box<dyn std::error::Error>) -> CliError,
) -> Result<Vec<u8>, CliError> {
    sign_transaction_with_trezor_request(
        transaction,
        &trezor.pubkey(),
        trezor.path(),
        |review| signer.set_trezor_review(review),
        token_hint,
        other,
        |text| eprint!("{text}"),
        |body, hint| match hint {
            Some(hint) => trezor.try_sign_transaction_body_with_token_hint(body, hint),
            None => trezor.try_sign_transaction_body(body),
        },
    )
}

/// The steps of [`sign_transaction_on_trezor`] around the device exchange
/// `request`: validate, freeze the body, check the fee payer is `pubkey`, work
/// out the review the app will show, print it, and only then send the request.
/// The review is handed to `record`, which keeps it for the JSON output.  A shape the app will
/// refuse has no review and is sent anyway: the app's refusal is the answer
/// (see `trezor_refusal_sentence`), there is no second refusal here.
#[allow(clippy::too_many_arguments)]
fn sign_transaction_with_trezor_request(
    transaction: &mut Transaction,
    pubkey: &[u8; 32],
    path: &thru_trezor::DerivationPath,
    record: impl FnOnce(Option<Review>),
    token_hint: Option<&thru_ledger::TokenHint>,
    other: impl Fn(Box<dyn std::error::Error>) -> CliError,
    print: impl FnOnce(&str),
    request: impl FnOnce(&[u8], Option<&[u8; thru_trezor::TOKEN_HINT_LEN]>) -> thru_trezor::Result<[u8; 64]>,
) -> Result<Vec<u8>, CliError> {
    transaction.validate().map_err(|e| other(Box::new(e)))?;
    let msg = build_transaction_signing_message(&transaction.to_wire_for_signing())
        .map_err(|e| other(Box::new(e)))?;
    // The fee payer must be this key, or the signature would verify under a
    // key the chain does not look at; refuse before involving the device.
    if msg.expected_pubkey() != pubkey {
        return Err(other(Box::new(SignError::KeyMismatch {
            expected: *msg.expected_pubkey(),
            got: *pubkey,
        })));
    }
    let review = trezor_preview::transaction_review(msg.body(), pubkey, path, token_hint);
    record(review.clone());
    let hint = token_hint.map(trezor_token_hint_bytes);
    let sig = print_trezor_review_then(review.as_ref(), print, || {
        request(msg.body(), hint.as_ref())
    })
    .map_err(trezor_error)?;
    let signed = attach_signature(&msg, sig).map_err(|e| other(Box::new(e)))?;
    transaction
        .attach_signed_wire(&signed)
        .map_err(|e| other(Box::new(e)))?;
    Ok(signed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use thru_base::signer::LocalSigner;
    use thru_base::tn_tools::KeyPair;
    use thru_base::txn_tools::{EOA_PROGRAM, TransactionBuilder};
    use thru_ledger::mock::SoftDevice;

    const SEED_HEX: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    fn keypair() -> KeyPair {
        KeyPair::from_hex_private_key("test", SEED_HEX).unwrap()
    }

    /// The loaded form of the [`SEED_HEX`] key.
    fn local_key() -> crate::keys::LoadedKey {
        crate::keys::LoadedKey::from_seed(zeroize::Zeroizing::new([1u8; 32]))
    }

    /// A config whose `default` key is a registered key file holding [`SEED_HEX`].
    fn local_config() -> (tempfile::TempDir, Config) {
        let (directory, keys) = crate::keys::KeyManager::test_fixture(&[("default", [1u8; 32])]);
        (
            directory,
            Config {
                keys,
                ..Config::default()
            },
        )
    }

    /// Sign `tx` with the legacy `Transaction::sign(&private_key)` path and
    /// with [`sign_transaction`] (both via the `KeyPair` and via a loaded
    /// local key) and require byte-identical wire output.
    fn assert_identical(tx: Transaction) {
        let kp = keypair();
        let mut old = tx.clone();
        old.sign(&kp.private_key).unwrap();

        let mut via_keypair = tx.clone();
        sign_transaction(&mut via_keypair, &kp).unwrap();

        let loaded = local_key();
        let mut via_source = tx;
        sign_transaction(&mut via_source, &loaded).unwrap();

        assert_eq!(old.to_wire(), via_keypair.to_wire());
        assert_eq!(old.to_wire(), via_source.to_wire());
        assert!(via_keypair.verify());
    }

    #[test]
    fn transfer_txn_is_byte_identical() {
        let kp = keypair();
        let tx = TransactionBuilder::build_transfer(
            kp.public_key,
            EOA_PROGRAM,
            [7u8; 32],
            1_000,
            1,
            5,
            100,
        )
        .unwrap()
        .with_chain_id(1);
        assert_identical(tx);
    }

    #[test]
    fn token_transfer_txn_is_byte_identical() {
        let kp = keypair();
        let tx = TransactionBuilder::build_token_transfer(
            kp.public_key,
            [9u8; 32],
            [3u8; 32],
            [4u8; 32],
            kp.public_key,
            42,
            1,
            9,
            200,
        )
        .unwrap()
        .with_chain_id(2);
        assert_identical(tx);
    }

    #[test]
    fn faucet_deposit_txn_is_byte_identical() {
        let kp = keypair();
        let tx = TransactionBuilder::build_faucet_deposit(
            kp.public_key,
            [6u8; 32],
            [5u8; 32],
            kp.public_key,
            EOA_PROGRAM,
            500,
            1,
            3,
            300,
        )
        .unwrap()
        .with_chain_id(1);
        assert_identical(tx);
    }

    /// `bond create` (Mode 2) EOA authorization: the Signer path produces the
    /// same signature as the previous `bp_sign_eoa_creation(&private_key, ..)`.
    #[test]
    fn bond_eoa_authorization_is_byte_identical() {
        use thru_base::signer::{EoaAuthKind, sign_eoa_auth_with};
        use thru_base::txn_tools::bp_sign_eoa_creation;
        let kp = keypair();
        let fee_payer = [8u8; 32];
        let old = bp_sign_eoa_creation(&kp.private_key, 1, &fee_payer, &kp.public_key);
        let new =
            sign_eoa_auth_with(&kp, EoaAuthKind::Create, 1, &fee_payer, &kp.public_key).unwrap();
        assert_eq!(old, new);
    }

    #[test]
    fn invalid_layout_error_is_unchanged() {
        let kp = keypair();
        let mut tx = Transaction::new(kp.public_key, [2u8; 32], 1, 0);
        tx.rw_accs = Some(vec![[3u8; 32], [3u8; 32]]);
        let mut old = tx.clone();
        let old_err = old.sign(&kp.private_key).unwrap_err().to_string();
        let new_err = sign_transaction(&mut tx, &kp).unwrap_err().to_string();
        assert_eq!(old_err, new_err);
    }

    #[test]
    fn ledger_uri_parses_to_ledger_source() {
        let keys = crate::keys::KeyManager::new();
        for value in [
            "ledger://44'/8478'/0'/0'",
            "LEDGER://44'/8478'/0'/0'",
            "  ledger://44'/8478'/0'/0'",
        ] {
            assert!(thru_ledger::is_ledger_uri(value));
            let (path, expected) = keys.ledger_source(value).unwrap().unwrap();
            assert_eq!(path, DerivationPath::new(0).unwrap());
            assert_eq!(expected, None);
            assert_eq!(path.to_uri(), "ledger://44'/8478'/0'/0'");
        }
        let (depth3, _) = keys
            .ledger_source("ledger://44'/8478'/7'")
            .unwrap()
            .unwrap();
        assert_eq!(depth3, DerivationPath::new_depth3(7).unwrap());
        // Paths outside the device policy are refused up front.
        for bad in [
            "ledger://44'/8478'/0'/1'",
            "ledger://44'/501'/0'/0'",
            "ledger://44'/8478'/0/0'",
            "ledger://garbage",
        ] {
            let err = keys.ledger_source(bad).unwrap_err().to_string();
            assert!(err.contains("Invalid Ledger key source"), "{bad}: {err}");
        }
        assert!(!thru_ledger::is_ledger_uri(SEED_HEX));
        assert!(!thru_ledger::is_ledger_uri("ledger"));
    }

    #[test]
    fn local_key_source_resolves_to_matching_signer() {
        let (_directory, config) = local_config();
        assert_eq!(config.keys.ledger_source("default").unwrap(), None);
        let signer = resolve_signer(&config, "default").unwrap();
        assert!(!signer.is_ledger());
        assert_eq!(signer.path, None);
        assert_eq!(signer.public_key, keypair().public_key);
        assert_eq!(signer.signer.public_key(), keypair().public_key);
        assert!(signer.signer.supports_legacy_scheme());
        assert!(!format!("{:?}", local_key()).contains(SEED_HEX));
        assert!(resolve_signer(&config, "missing").is_err());
        assert!(resolve_signer(&config, SEED_HEX).is_err());
    }

    /// A transaction whose fee payer is a Ledger key is signed on the device
    /// (streaming the body) and is byte-identical to a local signature with
    /// the same derived seed.
    #[test]
    fn ledger_signer_signs_cli_transactions() {
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        assert!(!ledger.supports_legacy_scheme());
        let tx = TransactionBuilder::build_transfer(
            ledger.pubkey(),
            EOA_PROGRAM,
            [7u8; 32],
            1_000,
            1,
            5,
            100,
        )
        .unwrap()
        .with_chain_id(1);
        let mut via_ledger = tx.clone();
        sign_transaction(&mut via_ledger, &ledger).unwrap();
        let local = LocalSigner::from_seed(dev.private_seed(&path));
        let mut via_local = tx;
        sign_transaction(&mut via_local, &local).unwrap();
        assert_eq!(via_ledger.to_wire(), via_local.to_wire());
        assert!(
            dev.reviews()
                .iter()
                .any(|r| matches!(r, thru_ledger::mock::Review::Transaction { .. }))
        );
    }

    /// `token transfer` with a Ledger: the hint reaches the device, which
    /// then reviews the owners and the mint; the signature is the same as
    /// without the hint, and a wrong hint is refused before the device.
    #[test]
    fn token_transfer_sends_the_hint_to_the_ledger() {
        use thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES;
        use thru_ledger::{TokenHint, token_account_address};

        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        let signer = ResolvedSigner::from_ledger("ledger", path, ledger);
        let (mint, recipient) = ([0x33u8; 32], [0x22u8; 32]);
        let tx = TransactionBuilder::build_token_transfer(
            signer.public_key,
            TOKEN_PROGRAM_BYTES,
            token_account_address(&signer.public_key, &mint, &[0u8; 32]),
            token_account_address(&recipient, &mint, &[0u8; 32]),
            signer.public_key,
            25,
            0,
            1,
            100,
        )
        .unwrap()
        .with_chain_id(1);
        let other = |e: Box<dyn std::error::Error>| CliError::Crypto(e.to_string());

        let hint = TokenHint::new(mint, recipient);
        let hinted =
            sign_transaction_for_with_token_hint(&mut tx.clone(), &signer, Some(&hint), other)
                .unwrap();
        let Some(thru_ledger::mock::Review::Transaction {
            action, token_mint, ..
        }) = dev.reviews().pop()
        else {
            panic!("no device review")
        };
        assert_eq!(action, Some("Token transfer"));
        assert_eq!(token_mint, Some(address_string(&mint)));
        let text = format_ledger_preview(&signer.ledger_preview().unwrap());
        assert!(text.contains("Token mint:"), "{text}");
        assert!(text.contains(&address_string(&recipient)), "{text}");

        let plain = sign_transaction_for(&mut tx.clone(), &signer, other).unwrap();
        assert_eq!(hinted, plain);

        let n = dev.apdu_log().len();
        let wrong = TokenHint::new([0x44; 32], recipient);
        let err =
            sign_transaction_for_with_token_hint(&mut tx.clone(), &signer, Some(&wrong), other)
                .unwrap_err();
        assert!(
            matches!(err, CliError::Ledger { ref code, .. } if code == "invalid_request"),
            "{err:?}"
        );
        assert_eq!(dev.apdu_log().len(), n);
    }

    /// Audit A-042: commands submit the exact bytes that were signed.  With a
    /// Ledger key, `sign_transaction_for` streams one frozen body snapshot,
    /// verifies the device signature over it, and returns snapshot ‖ sig,
    /// which is also what `to_wire()` gives; the device saw the same body
    /// (its displayed hash is SHA-256 of the returned bytes minus the
    /// signature).  Device-side refusals keep their typed Ledger error.
    #[test]
    fn sign_transaction_for_returns_the_exact_signed_bytes() {
        use sha2::Digest;
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let signer = ResolvedSigner::from_ledger(
            "hw",
            path,
            connect_ledger_with(dev.clone(), path, None).unwrap(),
        );
        let build = || {
            TransactionBuilder::build_transfer(
                signer.public_key,
                EOA_PROGRAM,
                [7u8; 32],
                1_000,
                1,
                5,
                100,
            )
            .unwrap()
            .with_chain_id(1)
        };
        let mut tx = build();
        let wire = sign_transaction_for(&mut tx, &signer, |e| {
            CliError::Crypto(format!("Failed to sign transaction: {e}"))
        })
        .unwrap();
        assert_eq!(wire, tx.to_wire());
        let body = &wire[..wire.len() - 64];
        assert_eq!(body, &tx.to_wire_for_signing()[..]);
        let Some(thru_ledger::mock::Review::Transaction { hash_hex, .. }) = dev.reviews().pop()
        else {
            panic!("no device review")
        };
        assert_eq!(hash_hex, hex::encode(sha2::Sha256::digest(body)));
        // Local keys return the same bytes as before.
        let (_directory, config) = local_config();
        let local = resolve_signer(&config, "default").unwrap();
        let mut ltx = TransactionBuilder::build_transfer(
            local.public_key,
            EOA_PROGRAM,
            [7u8; 32],
            1_000,
            1,
            5,
            100,
        )
        .unwrap()
        .with_chain_id(1);
        let lwire =
            sign_transaction_for(&mut ltx, &local, |e| CliError::Crypto(e.to_string())).unwrap();
        assert_eq!(lwire, ltx.to_wire());

        // chain_id 0 passes the account-layout check but not the Ledger
        // host pre-validation: typed error with the corpus reason, nothing
        // attached, the device not contacted.
        let mut zero = build().with_chain_id(0);
        let before = dev.apdu_log().len();
        let err = sign_transaction_for(&mut zero, &signer, |e| CliError::Crypto(e.to_string()))
            .unwrap_err();
        match err {
            CliError::Ledger { code, reason, .. } => {
                assert_eq!(code, "invalid_transaction");
                assert_eq!(reason.as_deref(), Some("chain_id_zero"));
            }
            other => panic!("{other:?}"),
        }
        assert!(zero.signature.is_none());
        assert_eq!(dev.apdu_log().len(), before);
    }

    /// Child half of [`ledger_sign_shows_host_transaction_hash`]: sign a
    /// transfer on the soft Ledger with the CLI progress printer attached and
    /// print the expected hash on stdout for the parent to check stderr.
    #[test]
    fn ledger_sign_shows_host_transaction_hash_child() {
        if std::env::var("THRU_TEST_PREVIEW_CHILD").is_err() {
            return;
        }
        use sha2::Digest;
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        let mut tx = TransactionBuilder::build_transfer(
            ledger.pubkey(),
            EOA_PROGRAM,
            [7u8; 32],
            100,
            1,
            5,
            100,
        )
        .unwrap()
        .with_chain_id(1);
        let hash = hex::encode(sha2::Sha256::digest(tx.to_wire_for_signing()));
        println!("EXPECTED_HASH={hash}");
        sign_transaction(&mut tx, &ledger).unwrap();
    }

    /// Spec app-thru-apdu.md §11.3 / §12 T8: the progress output tells the
    /// user to "compare the transaction hash", so the host must display the
    /// lowercase-hex SHA-256 of the streamed body before the final SIGN_TXN
    /// chunk.  Runs the child test in a subprocess to capture real stderr.
    #[test]
    fn ledger_sign_shows_host_transaction_hash() {
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "signing::tests::ledger_sign_shows_host_transaction_hash_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("THRU_TEST_PREVIEW_CHILD", "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "child failed: {stdout}\n{stderr}");
        let hash = stdout
            .lines()
            .find_map(|l| l.split("EXPECTED_HASH=").nth(1).map(|h| &h[..64]))
            .expect("child printed expected hash")
            .to_string();
        assert!(
            stderr.contains("compare the transaction hash"),
            "printer did not run: {stderr}"
        );
        assert!(
            stderr.contains(&hash),
            "host never displayed SHA-256(body) {hash} for comparison; stderr was:\n{stderr}"
        );
    }

    /// Audit U3/T8 witness (spec app-thru-apdu.md §11.3, §12 T8): before the
    /// user approves a blind transaction, the CLI must print the same
    /// transaction hash the device displays. The test re-runs itself as a
    /// child process (so the real `ledger_progress_printer` writes to a real
    /// stderr), signs with a SoftDevice through `connect_ledger_with`, and
    /// requires the device's displayed hash to appear on stderr no later than
    /// the "Review the transaction" prompt.
    #[test]
    fn ledger_cli_prints_device_txn_hash_before_approval() {
        const CHILD_ENV: &str = "THRU_TEST_T8_PREVIEW_CHILD";
        if std::env::var(CHILD_ENV).is_ok() {
            let dev = Arc::new(SoftDevice::abandon());
            let path = DerivationPath::new(0).unwrap();
            let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
            let mut tx = TransactionBuilder::build_transfer(
                ledger.pubkey(),
                EOA_PROGRAM,
                [7u8; 32],
                1_000,
                1,
                5,
                100,
            )
            .unwrap()
            .with_chain_id(1);
            sign_transaction(&mut tx, &ledger).unwrap();
            let hash = dev
                .reviews()
                .iter()
                .find_map(|r| match r {
                    thru_ledger::mock::Review::Transaction { hash_hex, .. } => {
                        Some(hash_hex.clone())
                    }
                    _ => None,
                })
                .unwrap();
            println!("DEVICE_HASH={hash}");
            return;
        }
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "signing::tests::ledger_cli_prints_device_txn_hash_before_approval",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "child failed: {stdout}\n{stderr}");
        let hash = stdout
            .lines()
            .find_map(|l| l.split("DEVICE_HASH=").nth(1).map(|h| h.trim()))
            .unwrap_or_else(|| panic!("child printed no device hash: {stdout}\n{stderr}"))
            .to_string();
        assert_eq!(hash.len(), 64);
        let prompt_at = stderr
            .find("Review the transaction on your Ledger")
            .expect("approval prompt printed");
        let hash_at = stderr.find(&hash);
        assert!(
            matches!(hash_at, Some(i) if i <= prompt_at),
            "T8: CLI never shows the transaction hash the device displays \
             ({hash}) before asking the user to compare it; stderr was:\n{stderr}"
        );
    }

    /// The printed preview carries every §7.7 field the device shows, in the
    /// device's order, with Appendix B values and the full 64-hex hash; and
    /// the JSON form (`ledger_preview`) has the same hash.
    #[test]
    fn ledger_preview_text_and_json_match_the_device() {
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let signer = ResolvedSigner::from_ledger(
            "hw",
            path,
            connect_ledger_with(dev.clone(), path, None).unwrap(),
        );
        assert!(signer.ledger_preview().is_none());
        assert_eq!(signer.ledger_preview_json(), serde_json::Value::Null);
        let mut tx = TransactionBuilder::build_transfer(
            signer.public_key,
            EOA_PROGRAM,
            [7u8; 32],
            1_000,
            200_000_000,
            5,
            100,
        )
        .unwrap()
        .with_chain_id(2);
        sign_transaction(&mut tx, signer.signer.as_ref()).unwrap();
        let Some(thru_ledger::mock::Review::Transaction { hash_hex, .. }) = dev.reviews().pop()
        else {
            panic!("no device review")
        };
        let preview = signer.ledger_preview().expect("preview recorded");
        let text = format_ledger_preview(&preview);
        let labels: Vec<usize> = [
            "Action:",
            "Source:",
            "Recipient:",
            "Amount:",
            "Network:",
            "Fee payer:",
            "Program:",
            "Fee:",
            "High fee:",
            "Nonce:",
            "Valid slots:",
            "Accounts:",
            "Instruction data:",
            "Transaction hash:",
        ]
        .iter()
        .map(|l| {
            text.find(l)
                .unwrap_or_else(|| panic!("{l} missing:\n{text}"))
        })
        .collect();
        assert!(labels.windows(2).all(|w| w[0] < w[1]), "order:\n{text}");
        for want in [
            "betanet",
            &address_string(&signer.public_key),
            "Native transfer",
            "EOA / taEOApimkowJve0JG2gZqRXJj84GwzB9QmkNAJUFoxykj2",
            "0.2 THRU",
            "Fee is above 0.1 THRU",
            "1 read-write, 0 read-only",
            "Valid slots:      100 to 199",
            &hash_hex,
        ] {
            assert!(text.contains(want), "{want} missing:\n{text}");
        }
        let response = signer.add_ledger_preview(
            serde_json::json!({ "transfer": { "status": "success" } }),
            "transfer",
        );
        let p = &response["transfer"]["ledger_preview"];
        assert_eq!(p["kind"], "transaction");
        assert_eq!(p["transaction_hash"], hash_hex.as_str());
        assert_eq!(p["network"], "betanet");
        assert_eq!(p["high_fee"], true);
        // §7.7 row 6: the last slot the node accepts (expiry_slot - 1).
        assert_eq!(p["valid_slots"], "100 to 199");
        assert_eq!(p["last_valid_slot"], 199);
        // A native transfer is clear-signed: its fields come first.
        assert_eq!(p["requires_blind_signing"], false);
        assert_eq!(p["fields"][0]["label"], "Action");
        let fields = p["fields"].as_array().unwrap();
        assert_eq!(fields.len(), 14);
        assert_eq!(fields[13]["label"], "Transaction hash");
        assert_eq!(fields[13]["value"], hash_hex.as_str());

        // Local keys: no preview field.
        let (_directory, config) = local_config();
        let local = resolve_signer(&config, "default").unwrap();
        let unchanged = local.add_ledger_preview(serde_json::json!({ "transfer": {} }), "transfer");
        assert!(unchanged["transfer"].get("ledger_preview").is_none());
    }

    /// Whitespace changes remain distinguishable in the host preview;
    /// hash-mode messages expose the same digest as the device.
    #[test]
    fn ledger_message_preview_text() {
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        // Messages that differ only in whitespace print differently.
        let render = |m: &[u8]| {
            let (_, _, p) = crate::commands::message::sign_message_on_ledger(&ledger, m).unwrap();
            format_ledger_preview(&p.unwrap())
        };
        let variants = [
            &b"pay bob"[..],
            b"pay bob ",
            b"pay  bob",
            b"pay bob\n",
            b" pay bob",
        ];
        let shown: Vec<String> = variants.iter().map(|m| render(m)).collect();
        for i in 0..shown.len() {
            for j in i + 1..shown.len() {
                assert_ne!(shown[i], shown[j], "{:?} vs {:?}", variants[i], variants[j]);
            }
        }
        let msg = "caf\u{e9}".as_bytes();
        let (_, _, preview) =
            crate::commands::message::sign_message_on_ledger(&ledger, msg).unwrap();
        let preview = preview.unwrap();
        let text = format_ledger_preview(&preview);
        let hash = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(msg));
        assert!(text.contains(&format!("Message hash: {hash}")), "{text}");
        let Some(thru_ledger::mock::Review::Message { hash_hex, .. }) = dev.reviews().pop() else {
            panic!("no review")
        };
        assert_eq!(hash_hex, hash);
        let json = ledger_preview_json(&preview);
        assert_eq!(json["display"], "hash");
        assert_eq!(json["message_hash"], hash.as_str());
    }

    /// Child half of [`ledger_hash_mode_message_prints_hash_before_prompt`].
    #[test]
    fn ledger_hash_mode_message_prints_hash_before_prompt_child() {
        if std::env::var("THRU_TEST_MSG_PREVIEW_CHILD").is_err() {
            return;
        }
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        let msg = vec![0xFFu8; 600];
        crate::commands::message::sign_message_on_ledger(&ledger, &msg).unwrap();
        let Some(thru_ledger::mock::Review::Message { hash_hex, .. }) = dev.reviews().pop() else {
            panic!("no review")
        };
        println!("DEVICE_MSG_HASH={hash_hex}");
    }

    /// Spec §11.3: for a hash-mode message the CLI prints the message hash
    /// the device shows before the "Review the message" prompt.
    #[test]
    fn ledger_hash_mode_message_prints_hash_before_prompt() {
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "signing::tests::ledger_hash_mode_message_prints_hash_before_prompt_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("THRU_TEST_MSG_PREVIEW_CHILD", "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "child failed: {stdout}\n{stderr}");
        let hash = stdout
            .lines()
            .find_map(|l| {
                l.split("DEVICE_MSG_HASH=")
                    .nth(1)
                    .map(|h| h.trim().to_string())
            })
            .expect("child printed the device hash");
        let prompt = stderr
            .find("Review the message on your Ledger")
            .expect("prompt printed");
        assert!(
            matches!(stderr.find(&hash), Some(i) if i < prompt),
            "message hash {hash} not printed before the prompt:\n{stderr}"
        );
    }

    /// Audit A-019: a body the host pre-validation refuses keeps its corpus
    /// reason class through to the CLI error (`invalid_transaction`, reason
    /// `rw_unsorted`), and the device is never contacted.
    #[test]
    fn ledger_precheck_reject_keeps_reason_class() {
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = connect_ledger_with(dev.clone(), path, None).unwrap();
        let mut tx = Transaction::new(ledger.pubkey(), EOA_PROGRAM, 1, 0).with_chain_id(1);
        tx.rw_accs = Some(vec![[9u8; 32], [3u8; 32]]);
        let body = tx.to_wire_for_signing();
        let before = dev.apdu_log().len();
        let err = ledger_error(ledger.try_sign_transaction_body(&body).unwrap_err());
        assert_eq!(dev.apdu_log().len(), before, "device was contacted");
        match err {
            CliError::Ledger {
                code,
                reason,
                status_word,
                ..
            } => {
                assert_eq!(code, "invalid_transaction");
                assert_eq!(reason.as_deref(), Some("rw_unsorted"));
                assert_eq!(status_word, Some(0x6809));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn ledger_key_mismatch_and_errors_are_actionable() {
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let other = dev.pubkey(&DerivationPath::new(1).unwrap());
        let err = connect_ledger_with(dev.clone(), path, Some(other)).unwrap_err();
        assert!(matches!(&err, CliError::Ledger { code, .. } if code == "key_mismatch"));

        dev.set_settings(thru_ledger::mock::SoftDeviceSettings {
            locked: true,
            ..Default::default()
        });
        let err = connect_ledger_with(dev.clone(), path, None).unwrap_err();
        match err {
            CliError::Ledger {
                code,
                message,
                status_word,
                reason,
            } => {
                assert_eq!(reason, None);
                assert_eq!(code, "locked");
                assert_eq!(status_word, Some(0x5515));
                assert!(message.contains("unlock"));
            }
            other => panic!("{other:?}"),
        }
    }

    /// Critic gap (U3/T8): the CLI refuses an app speaking another APDU
    /// protocol version (GET_APP_CONFIG), and a Ledger key never claims the
    /// legacy (pre-RFC-8032) signing scheme, including through the
    /// `ResolvedSigner` wrapper.
    #[test]
    fn ledger_protocol_version_and_legacy_scheme() {
        let dev = Arc::new(SoftDevice::abandon());
        dev.set_settings(thru_ledger::mock::SoftDeviceSettings {
            apdu_protocol_version: 2,
            ..Default::default()
        });
        let path = DerivationPath::new(0).unwrap();
        let err = connect_ledger_with(dev.clone(), path, None).unwrap_err();
        assert!(
            matches!(&err, CliError::Ledger { code, .. } if code == "unsupported_app_version"),
            "{err:?}"
        );
        // Nothing beyond the app checks was sent (no GET_PUBKEY).
        assert!(
            dev.apdu_log()
                .iter()
                .all(|a| a[1] != thru_ledger::consts::ins::GET_PUBKEY)
        );

        dev.set_settings(thru_ledger::mock::SoftDeviceSettings::default());
        let signer = ResolvedSigner::from_ledger(
            "hw",
            path,
            connect_ledger_with(dev.clone(), path, None).unwrap(),
        );
        assert!(!signer.signer.supports_legacy_scheme());
        // (Local keys can; the CLI never selects the legacy scheme anyway.)
        assert!(local_key().supports_legacy_scheme());
    }

    /// Critic gap (U3/T5): `ledger://` key sources accept only paths the
    /// device accepts (§4.2), before any device contact, and canonicalize
    /// the accepted spellings.
    #[test]
    fn ledger_uri_path_policy_edge_cases() {
        for bad in [
            "ledger://44'/8478'/0/0'",           // non-hardened account
            "ledger://44'/8478'/0'/0",           // non-hardened change
            "ledger://44/8478'/0'/0'",           // non-hardened purpose
            "ledger://44'/8478/0'/0'",           // non-hardened coin type
            "ledger://44'/8478'/0'/1'",          // change != 0'
            "ledger://49'/8478'/0'/0'",          // wrong purpose
            "ledger://44'/501'/0'/0'",           // another coin type
            "ledger://44'/8478'",                // depth 2
            "ledger://44'/8478'/0'/0'/0'",       // depth 5
            "ledger://44'/8478'/2147483648'/0'", // account >= 2^31
            "ledger://44'/8478'/4294967295'/0'", // overflow into the hardened bit
            "ledger://44'/8478'/-1'/0'",
            "ledger://44'/8478'/+1'/0'",
            "ledger://44'/8478'/0'/0'/",
            "ledger://44'/8478'//0'",
            "ledger://",
            "ledger://m",
            "ledger://44'/8478'/0x1'/0'",
        ] {
            let err = crate::keys::KeyManager::new()
                .ledger_source(bad)
                .unwrap_err()
                .to_string();
            assert!(err.contains("Invalid Ledger key source"), "{bad}: {err}");
        }
        for (ok, canonical) in [
            (
                "ledger://44'/8478'/2147483647'/0'",
                "ledger://44'/8478'/2147483647'/0'",
            ),
            ("ledger://m/44'/8478'/3'/0'", "ledger://44'/8478'/3'/0'"),
            ("ledger://44h/8478H/3h/0h", "ledger://44'/8478'/3'/0'"),
            ("ledger://044'/8478'/003'/0'", "ledger://44'/8478'/3'/0'"),
            ("  ledger://44'/8478'/3'  ", "ledger://44'/8478'/3'"),
        ] {
            let (path, _) = crate::keys::KeyManager::new()
                .ledger_source(ok)
                .unwrap_or_else(|e| panic!("{ok}: {e}"))
                .unwrap();
            assert_eq!(path.to_uri(), canonical, "{ok}");
        }
        // `keys add-ledger --account N` uses the same policy.
        assert!(DerivationPath::new(0x7FFF_FFFF).is_ok());
        assert!(DerivationPath::new(0x8000_0000).is_err());
        // Config values are checked when loaded.
        assert!(
            serde_yaml::from_str::<crate::keys::KeySource>(
                "type: ledger\npath: \"44'/8478'/0'/1'\""
            )
            .is_err()
        );
    }

    /// Audit U3/T8: the release CLI honors `THRU_LEDGER_SPECULOS` with no
    /// build gate, so any TCP endpoint speaking the Speculos framing is
    /// accepted as "the Ledger" and its key is recorded as verified on the
    /// device.  A fake endpoint (a software device with an attacker seed)
    /// must be refused (or at least distinguishable) by the production path.
    ///
    /// Fixed: without the test-only `ledger-speculos` feature the variable is
    /// a hard error and no APDU is sent to the endpoint.
    #[cfg(not(feature = "ledger-speculos"))]
    #[test]
    fn speculos_env_endpoint_is_not_accepted_as_hardware_ledger() {
        let attacker = std::sync::Arc::new(SoftDevice::new(&[0xAA; 64]));
        let path = DerivationPath::new(0).unwrap();
        let attacker_pk = attacker.pubkey(&path);
        let addr = fake_speculos_endpoint(attacker.clone());

        // SAFETY: only this test touches THRU_LEDGER_SPECULOS.
        unsafe { std::env::set_var(ENV_LEDGER_SPECULOS, addr.to_string()) };
        let result = connect_ledger(path, None);
        unsafe { std::env::remove_var(ENV_LEDGER_SPECULOS) };

        if let Ok(signer) = &result {
            // Exactly what `thru keys add-ledger` does.
            let confirmed = signer
                .verify_address_on_device()
                .expect("fake endpoint passes on-device verification");
            assert_eq!(confirmed, attacker_pk);
            let mut config = Config::default();
            record_ledger_key_for_test(&mut config, "hw", &signer);
            assert_eq!(
                config.keys.get_entry("hw").unwrap().public_key,
                address_string(&attacker_pk)
            );
            panic!(
                "THRU_LEDGER_SPECULOS={addr} was honored by the production CLI path: \
                 attacker-controlled key {} was accepted and recorded as a \
                 device-verified Ledger key with no refusal or warning",
                address_string(&attacker_pk)
            );
        }
        match result {
            Err(CliError::Ledger { code, message, .. }) => {
                assert_eq!(code, "speculos_unsupported");
                assert!(message.contains(ENV_LEDGER_SPECULOS), "{message}");
            }
            Err(other) => panic!("unexpected error: {other:?}"),
            Ok(_) => unreachable!(),
        }
        assert!(!ledger_is_emulator());
        assert!(attacker.apdu_log().is_empty(), "the endpoint was contacted");
    }

    /// Test builds with `ledger-speculos`: the emulator works (for the e2e
    /// harness) but is always flagged as an emulator.
    #[cfg(feature = "ledger-speculos")]
    #[test]
    fn speculos_feature_flags_the_emulator() {
        let emu = std::sync::Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let addr = fake_speculos_endpoint(emu.clone());
        // SAFETY: only this test touches THRU_LEDGER_SPECULOS.
        unsafe { std::env::set_var(ENV_LEDGER_SPECULOS, addr.to_string()) };
        let emulator = ledger_is_emulator();
        let result = connect_ledger(path, None);
        unsafe { std::env::remove_var(ENV_LEDGER_SPECULOS) };
        assert!(emulator);
        assert_eq!(result.unwrap().pubkey(), emu.pubkey(&path));
        assert!(speculos_warning("127.0.0.1:9999").contains("EMULATOR, NOT A HARDWARE DEVICE"));
    }

    /// A TCP server speaking the Speculos APDU framing in front of `dev`.
    fn fake_speculos_endpoint(dev: std::sync::Arc<SoftDevice>) -> std::net::SocketAddr {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let Ok((mut s, _)) = listener.accept() else {
                return;
            };
            loop {
                let mut len = [0u8; 4];
                if std::io::Read::read_exact(&mut s, &mut len).is_err() {
                    return;
                }
                let mut cmd = vec![0u8; u32::from_be_bytes(len) as usize];
                if std::io::Read::read_exact(&mut s, &mut cmd).is_err() {
                    return;
                }
                let resp = dev.process(&cmd);
                let data_len = (resp.len() - 2) as u32;
                let mut out = data_len.to_be_bytes().to_vec();
                out.extend_from_slice(&resp);
                if s.write_all(&out).is_err() {
                    return;
                }
            }
        });
        addr
    }

    #[cfg(not(feature = "ledger-speculos"))]
    fn record_ledger_key_for_test(config: &mut Config, name: &str, signer: &LedgerSigner) {
        crate::commands::keys::record_ledger_key(config, name, signer, false).unwrap();
    }

    // ---- Trezor ----

    /// The `THRU_TREZOR_*` variables are process-wide: tests that set them
    /// take this lock and restore the previous values on drop.
    static TREZOR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TrezorEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        saved: Vec<(&'static str, Option<String>)>,
    }

    impl TrezorEnv {
        fn set(vars: &[(&'static str, Option<&str>)]) -> Self {
            let guard = TREZOR_ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut saved = Vec::new();
            for (name, value) in vars {
                saved.push((*name, std::env::var(name).ok()));
                // SAFETY: tests that touch THRU_TREZOR_* hold TREZOR_ENV_LOCK.
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
            Self {
                _guard: guard,
                saved,
            }
        }
    }

    impl Drop for TrezorEnv {
        fn drop(&mut self) {
            for (name, value) in self.saved.drain(..) {
                // SAFETY: the lock is still held (the guard drops last).
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }

    fn trezor_path0() -> thru_trezor::DerivationPath {
        thru_trezor::DerivationPath::new(0).unwrap()
    }

    #[test]
    fn trezor_uri_parses_to_trezor_source() {
        let keys = crate::keys::KeyManager::new();
        for value in [
            "trezor://44'/8478'/0'/0'",
            "TREZOR://44'/8478'/0'/0'",
            "  trezor://44'/8478'/0'/0'",
            "trezor://m/44'/8478'/0'/0'",
        ] {
            assert!(thru_trezor::is_trezor_uri(value));
            let target = keys.trezor_source(value).unwrap().unwrap();
            assert_eq!(target.path(), trezor_path0());
            assert_eq!(target.expected(), None);
            assert!(!target.passphrase());
            assert_eq!(target.path().to_uri(), "trezor://44'/8478'/0'/0'");
            // Never a Ledger key.
            assert_eq!(keys.ledger_source(value).unwrap(), None);
        }
        assert_eq!(TREZOR_URI_SCHEME, "trezor://");
        let depth3 = keys
            .trezor_source("trezor://44'/8478'/7'")
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(depth3, thru_trezor::DerivationPath::new_depth3(7).unwrap());
        for bad in [
            "trezor://44'/8478'/0'/1'",
            "trezor://44'/501'/0'/0'",
            "trezor://44'/8478'/0/0'",
            "trezor://garbage",
        ] {
            let err = keys.trezor_source(bad).unwrap_err().to_string();
            assert!(err.contains("Invalid Trezor key source"), "{bad}: {err}");
        }
        assert!(!thru_trezor::is_trezor_uri(SEED_HEX));
        assert!(!thru_trezor::is_trezor_uri("trezor"));
    }

    /// The release CLI never treats `THRU_TREZOR_EMULATOR` as a Trezor: it is
    /// a hard error, raised before the app image or the endpoint is touched.
    #[cfg(not(feature = "trezor-emulator"))]
    #[test]
    fn trezor_emulator_env_is_refused_without_the_feature() {
        let endpoint = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        endpoint.set_nonblocking(true).unwrap();
        let addr = endpoint.local_addr().unwrap().to_string();
        let _env = TrezorEnv::set(&[(ENV_TREZOR_EMULATOR, Some(&addr)), (ENV_TREZOR_APP, None)]);

        for result in [
            connect_trezor(TrezorTarget::unregistered(trezor_path0(), false)).map(|_| ()),
            open_trezor_transport().map(|_| ()),
        ] {
            match result {
                Err(CliError::Trezor { code, message, .. }) => {
                    assert_eq!(code, "emulator_unsupported");
                    assert!(message.contains(ENV_TREZOR_EMULATOR), "{message}");
                    assert!(message.contains(&addr), "{message}");
                }
                other => panic!("unexpected result: {other:?}"),
            }
        }
        assert!(!trezor_is_emulator());
        // The endpoint was never contacted.
        let mut packet = [0u8; 64];
        let heard = endpoint.recv(&mut packet);
        assert!(
            matches!(&heard, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
            "the endpoint was contacted: {heard:?}"
        );
    }

    /// Test builds with `trezor-emulator`: the emulator is accepted, loudly
    /// flagged, and is the one transport pairing may be skipped on.
    #[cfg(feature = "trezor-emulator")]
    #[test]
    fn trezor_emulator_feature_flags_the_emulator() {
        // Answers the transport's PINGPING once, as the emulator does.
        let endpoint = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = endpoint.local_addr().unwrap().to_string();
        let responder = std::thread::spawn(move || {
            let mut packet = [0u8; 64];
            let (n, from) = endpoint.recv_from(&mut packet).unwrap();
            assert_eq!(&packet[..n], b"PINGPING");
            endpoint.send_to(b"PONGPONG", from).unwrap();
        });
        let _env = TrezorEnv::set(&[(ENV_TREZOR_EMULATOR, Some(&addr))]);
        assert!(trezor_is_emulator());
        let result = open_trezor_transport();
        responder.join().unwrap();
        assert!(result.is_ok());
        let warning = trezor_emulator_warning("127.0.0.1:21324");
        assert!(
            warning.contains("EMULATOR, NOT A HARDWARE DEVICE"),
            "{warning}"
        );
        assert!(warning.contains(ENV_TREZOR_EMULATOR), "{warning}");
    }

    /// An unset or unreadable `THRU_TREZOR_APP` is an error that says what to
    /// set, found before any device is opened (the USB path is never reached).
    #[test]
    fn trezor_app_image_errors_say_what_to_set() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("thru.tapp");
        let missing = missing.to_str().unwrap();
        for value in [None, Some(""), Some("  "), Some(missing)] {
            let _env = TrezorEnv::set(&[(ENV_TREZOR_EMULATOR, None), (ENV_TREZOR_APP, value)]);
            for result in [
                trezor_app_image().map(|_| ()),
                connect_trezor(TrezorTarget::unregistered(trezor_path0(), false)).map(|_| ()),
            ] {
                match result {
                    Err(CliError::Trezor { code, message, .. }) => {
                        assert_eq!(code, "app_image", "{value:?}");
                        assert!(message.contains("Set THRU_TREZOR_APP"), "{message}");
                        if let Some(v) = value.filter(|v| v.starts_with('/')) {
                            assert!(message.contains(v), "{message}");
                        }
                    }
                    other => panic!("{value:?}: unexpected result: {other:?}"),
                }
            }
        }
    }

    /// A key mismatch of a key of a passphrase wallet says that another
    /// passphrase may have been typed; for a standard key it says what it
    /// always said.
    #[test]
    fn a_key_mismatch_of_a_passphrase_key_names_the_passphrase() {
        let mismatch = || TrezorError::KeyMismatch {
            expected: address_string(&[1; 32]),
            got: address_string(&[2; 32]),
        };
        let sentence = format!(
            "the Trezor's key is {}, expected {}",
            address_string(&[2; 32]),
            address_string(&[1; 32])
        );
        match trezor_key_error(mismatch(), false) {
            CliError::Trezor { code, message, .. } => {
                assert_eq!(code, "key_mismatch");
                assert_eq!(message, sentence);
            }
            other => panic!("unexpected {other:?}"),
        }
        match trezor_key_error(mismatch(), true) {
            CliError::Trezor { code, message, .. } => {
                assert_eq!(code, "key_mismatch");
                assert_eq!(
                    message,
                    format!(
                        "{sentence}; this key belongs to a passphrase wallet, so another \
                         passphrase may have been typed on the Trezor"
                    )
                );
            }
            other => panic!("unexpected {other:?}"),
        }
        // Other failures are not touched by the flag.
        for passphrase in [false, true] {
            match trezor_key_error(TrezorError::Cancelled, passphrase) {
                CliError::Trezor { code, message, .. } => {
                    assert_eq!(code, "user_rejected");
                    assert_eq!(message, "cancelled on the Trezor");
                }
                other => panic!("unexpected {other:?}"),
            }
        }
    }

    /// A device that takes the passphrase on the device only refuses the
    /// standard wallet's empty passphrase; the sentence says how to go on.
    #[test]
    fn the_on_device_passphrase_refusal_says_to_register_with_the_flag() {
        match trezor_error(TrezorError::PassphraseOnDeviceOnly) {
            CliError::Trezor { code, message, .. } => {
                assert_eq!(code, "passphrase_on_device_only");
                assert_eq!(
                    message,
                    "the Trezor is set to take the passphrase on the device only, and refused a \
                     passphrase sent by the computer (also an empty one); register this key as a \
                     key of a passphrase wallet (thru keys add-trezor NAME --passphrase) and \
                     type its passphrase on the Trezor (an empty passphrase gives the standard \
                     wallet)"
                );
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    /// The words the person reads while the device waits.
    #[test]
    fn trezor_prompts_name_what_the_device_waits_for() {
        assert_eq!(TREZOR_CONFIRM_PROMPT, "Confirm on the Trezor.");
        assert_eq!(
            TREZOR_PASSPHRASE_PROMPT,
            "Enter the passphrase on the Trezor."
        );
    }

    /// X3: a bare `trezor://` URI as a destination, with only a passphrase key
    /// registered for its path, is as if nothing were registered: it goes to
    /// the device for the standard wallet (here it stops at the missing app
    /// image) instead of answering with the hidden wallet's address.
    #[test]
    fn a_trezor_uri_destination_ignores_a_passphrase_key() {
        let _env = TrezorEnv::set(&[(ENV_TREZOR_EMULATOR, None), (ENV_TREZOR_APP, None)]);
        let mut keys = crate::keys::KeyManager::new();
        keys.insert_entry(
            "hid",
            crate::keys::KeyEntry {
                public_key: address_string(&[9; 32]),
                source: crate::keys::KeySource::Trezor {
                    path: trezor_path0(),
                    passphrase: true,
                },
            },
            false,
        )
        .unwrap();
        let uri = trezor_path0().to_uri();
        for result in [keys.resolve_public_key(&uri), keys.public_key(&uri)] {
            match result {
                Err(CliError::Trezor { code, .. }) => assert_eq!(code, "app_image"),
                other => panic!("the URI did not go to the device: {other:?}"),
            }
        }
        // The alias is the only way to the hidden wallet's key, without a device.
        assert_eq!(keys.resolve_public_key("alias:hid").unwrap(), [9; 32]);
        assert_eq!(keys.public_key("hid").unwrap(), [9; 32]);
    }

    #[test]
    fn trezor_errors_map_to_stable_codes() {
        let cases: Vec<(TrezorError, &str)> = vec![
            (TrezorError::Cancelled, "user_rejected"),
            (
                TrezorError::Transport(TransportError::NotFound("none".into())),
                "not_found",
            ),
            (
                TrezorError::Transport(TransportError::Ambiguous),
                "ambiguous_device",
            ),
            (
                TrezorError::Transport(TransportError::Io("x".into())),
                "transport",
            ),
            (TrezorError::Timeout("the button"), "timeout"),
            (TrezorError::DeviceLocked, "locked"),
            (TrezorError::Protocol("p".into()), "protocol_error"),
            (TrezorError::Unexpected("u".into()), "protocol_error"),
            (TrezorError::App("a".into()), "protocol_error"),
            (
                TrezorError::Failure {
                    code: 3,
                    message: "bad data".into(),
                },
                "device_error",
            ),
            (TrezorError::Pairing("wrong code".into()), "pairing_failed"),
            (TrezorError::Credentials("c".into()), "credentials"),
            (TrezorError::AppImage("i".into()), "app_image"),
            (
                TrezorError::KeyMismatch {
                    expected: "taA".into(),
                    got: "taB".into(),
                },
                "key_mismatch",
            ),
            (
                TrezorError::PassphraseProtectionOff,
                "passphrase_protection_off",
            ),
            (TrezorError::OlderProtocolRefused, "older_protocol_refused"),
        ];
        for (error, code) in cases {
            let text = error.to_string();
            match trezor_error(error) {
                CliError::Trezor {
                    code: got, message, ..
                } => {
                    assert_eq!(got, code);
                    assert!(message.contains(&text), "{message} / {text}");
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        let error = trezor_error(TrezorError::Failure {
            code: 3,
            message: "bad data".into(),
        });
        assert_eq!(
            error.to_string(),
            "Trezor: the Trezor reported failure 3: bad data"
        );
        // --json rendering.
        let json = crate::format_error_json(&trezor_error(TrezorError::Cancelled));
        assert_eq!(json["error"]["type"], "trezor");
        assert_eq!(json["error"]["code"], "user_rejected");
        assert!(
            json["error"]["message"]
                .as_str()
                .unwrap()
                .contains("cancelled on the Trezor")
        );
        let json = crate::format_error_json(&trezor_error(TrezorError::KeyMismatch {
            expected: "taA".into(),
            got: "taB".into(),
        }));
        assert_eq!(json["error"]["code"], "key_mismatch");
        assert!(json["error"]["reason"].is_null());
    }

    /// Each reason the app can refuse with has its own sentence; the code is
    /// `app_refused` and the reason stays available in the JSON error.
    #[test]
    fn trezor_app_refusals_have_a_sentence_and_keep_their_reason() {
        let cases = [
            ("message_not_text", "can show it as text"),
            ("token_hint_length", "not 129 bytes long"),
            ("token_hint_kind", "not a token transfer hint"),
            ("token_hint_mismatch", "do not derive the token accounts"),
            ("unsupported_transaction", "does not sign this transaction"),
            ("fee_payer_mismatch", "not the key of this Trezor"),
            ("some_new_reason", "refused the request: some_new_reason"),
        ];
        for (reason, phrase) in cases {
            let error = trezor_error(TrezorError::AppRefused(reason.into()));
            let json = crate::format_error_json(&error);
            assert_eq!(json["error"]["type"], "trezor", "{reason}");
            assert_eq!(json["error"]["code"], "app_refused", "{reason}");
            assert_eq!(json["error"]["reason"], reason);
            let message = json["error"]["message"].as_str().unwrap();
            assert!(message.contains(phrase), "{reason}: {message}");
            // A known reason is explained, not echoed.
            if reason != "some_new_reason" {
                assert!(!message.contains(reason), "{reason}: {message}");
            }
        }
        // The text sentence says what the device accepts and where else to sign.
        let CliError::Trezor { message, .. } =
            trezor_error(TrezorError::AppRefused("message_not_text".into()))
        else {
            panic!("not a Trezor error");
        };
        for part in [
            "1 to 512 bytes of printable ASCII",
            "at most 16 lines",
            "a local or a Ledger key",
        ] {
            assert!(message.contains(part), "{message}");
        }

        // A request refused on the host keeps its own code and no reason.
        let error = trezor_error(TrezorError::InvalidRequest("too long".into()));
        let json = crate::format_error_json(&error);
        assert_eq!(json["error"]["code"], "invalid_request");
        assert!(json["error"]["reason"].is_null());
        assert!(
            json["error"]["message"]
                .as_str()
                .unwrap()
                .contains("too long")
        );
    }

    /// The hint the Trezor app gets is the Ledger's encoding of it, 129 bytes.
    #[test]
    fn trezor_token_hint_is_the_ledger_encoding() {
        let hint = thru_ledger::TokenHint::new([0x33; 32], [0x22; 32]);
        let bytes = trezor_token_hint_bytes(&hint);
        assert_eq!(bytes.len(), 129);
        assert_eq!(bytes, hint.encode());
        assert_eq!(bytes[0], thru_ledger::token_hint::TOKEN_HINT_KIND);
        assert_eq!(&bytes[1..33], &[0x33; 32]);
        assert_eq!(&bytes[33..65], &[0x22; 32]);
        assert_eq!(&bytes[65..], &[0u8; 64][..]);
    }

    /// A Trezor alias and a `trezor://` URI with a message the device would
    /// not show as text are refused before anything is connected.  The
    /// emulator endpoint is bound and the app image is unset: a connection
    /// attempt would be a Trezor error (or, with the feature, a packet on the
    /// endpoint), never the validation error asserted here.
    #[test]
    fn trezor_message_that_is_not_text_is_refused_without_a_device() {
        use crate::commands::message::sign_message_bytes;
        let endpoint = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        endpoint.set_nonblocking(true).unwrap();
        let addr = endpoint.local_addr().unwrap().to_string();
        let _env = TrezorEnv::set(&[(ENV_TREZOR_EMULATOR, Some(&addr)), (ENV_TREZOR_APP, None)]);

        let mut keys = crate::keys::KeyManager::new();
        keys.insert_entry(
            "tz",
            crate::keys::KeyEntry {
                public_key: address_string(&[9; 32]),
                source: crate::keys::KeySource::Trezor {
                    path: trezor_path0(),
                    passphrase: false,
                },
            },
            false,
        )
        .unwrap();
        let config = Config {
            keys,
            ..Config::default()
        };
        let too_many_lines = "a\n".repeat(17).into_bytes();
        let messages: [&[u8]; 6] = [
            &[0, 1, 2],
            &[0xff, 0xfe],
            b"two  spaces",
            b"tab\there",
            &[b'a'; 513],
            &too_many_lines,
        ];
        for key in ["tz", "alias:tz", "trezor://44'/8478'/0'/0'"] {
            for message in messages {
                let error = sign_message_bytes(&config, key, message).unwrap_err();
                assert!(matches!(error, CliError::Validation(_)), "{key}: {error:?}");
                let text = error.to_string();
                for part in [
                    "can show it as text",
                    "512 bytes",
                    "a local or a Ledger key",
                ] {
                    assert!(text.contains(part), "{key}: {text}");
                }
            }
            // Text goes on to connect, which stops before any device is
            // opened: at the unset app image, or (a build without the
            // feature) at the emulator variable.
            let error = sign_message_bytes(&config, key, b"hello").unwrap_err();
            assert!(
                matches!(&error, CliError::Trezor { code, .. }
                    if code == "app_image" || code == "emulator_unsupported"),
                "{key}: {error:?}"
            );
        }
        let mut packet = [0u8; 64];
        let heard = endpoint.recv(&mut packet);
        assert!(
            matches!(&heard, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
            "the endpoint was contacted: {heard:?}"
        );
    }

    #[test]
    fn trezor_pairing_code_is_one_line_of_digits() {
        let mut out = Vec::new();
        let code = read_pairing_code(&mut std::io::Cursor::new(b" 123 456 \n".to_vec()), &mut out)
            .unwrap();
        assert_eq!(code, "123456");
        assert!(
            String::from_utf8(out)
                .unwrap()
                .starts_with("Code shown on the Trezor: ")
        );
        // End of input or an empty line is a pairing failure, not a wrong code.
        for input in [&b""[..], &b"\n"[..], &b"  \n"[..]] {
            let error =
                read_pairing_code(&mut std::io::Cursor::new(input.to_vec()), &mut Vec::new())
                    .unwrap_err();
            assert!(matches!(error, TrezorError::Pairing(_)), "{error:?}");
        }
    }

    /// Through the CLI's own code path (`resolve_signer`) on the Trezor
    /// emulator: the key is the shared vector's, and the signature of the
    /// fixture transfer equals the recorded one, both through the `Signer`
    /// the commands use and through `sign_transaction_for`.  Run by
    /// `trezor/scripts/test-host.sh`; skipped unless `THRU_TREZOR_EMULATOR`
    /// and `THRU_TREZOR_APP` are set.
    #[cfg(feature = "trezor-emulator")]
    #[test]
    fn trezor_emulator_signs_the_fixture_transfer_through_resolve_signer() {
        // The lock first: another test sets the variable for a moment, and
        // reading it before the lock would take that value for the caller's.
        let _env = TrezorEnv::set(&[]);
        if trezor_emulator_endpoint().is_none() {
            eprintln!("skipped: {ENV_TREZOR_EMULATOR} is not set");
            return;
        }
        let fixture: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../../trezor/app-thru/tests/fixtures/sign_tx.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "transfer_shared_corpus")
            .expect("case transfer_shared_corpus");
        let body = hex::decode(case["body_hex"].as_str().unwrap()).unwrap();
        let want = case["signature_hex"].as_str().unwrap();

        let config = Config::default();
        let signer = resolve_signer(&config, "trezor://44'/8478'/0'/0'").unwrap();
        assert!(signer.is_trezor());
        assert!(!signer.is_ledger());
        assert_eq!(
            signer.address.as_str(),
            "taHWXdTRD0-KOS2eF8TYzep8aOKj6tw1mXu7ZzjjnMDm6A"
        );
        assert_eq!(
            hex::encode(signer.signer.sign_transaction_body(&body).unwrap()),
            want
        );

        // The same transaction through the helper every command uses.
        let mut wire = body.clone();
        wire.extend_from_slice(&[0u8; 64]);
        let mut transaction = Transaction::from_wire(&wire).expect("fixture body parses");
        assert_eq!(transaction.to_wire_for_signing(), body);
        let signed = sign_transaction_for(&mut transaction, &signer, |e| {
            CliError::Crypto(format!("Failed to sign transaction: {e}"))
        })
        .unwrap();
        assert_eq!(hex::encode(&signed[body.len()..]), want);
        assert_eq!(signed[..body.len()], body[..]);
    }

    /// One case of the app's fixture, named by `THRU_TEST_FIXTURE_CASE`,
    /// through `sign_transaction_for_with_token_hint` on the Trezor emulator
    /// (what every command that sends a transaction calls), with the case's
    /// token hint when it has one.  A signed case must give the fixture's
    /// signature; a refused one must be refused by the app with the fixture's
    /// reason, which for a wrong hint proves that the hint reached the device.
    /// The review the CLI printed beforehand (`trezor_preview`) is written to
    /// the file named by `THRU_TEST_PREVIEW_OUT`, for the script to compare
    /// with what the device showed.  `THRU_TEST_EXPECT_CODE` names the error
    /// code expected instead when the person refuses on the device.  Run by
    /// `trezor/scripts/test-host.sh`, once for each case; skipped unless the
    /// case is named.
    #[cfg(feature = "trezor-emulator")]
    #[test]
    fn trezor_emulator_signs_a_fixture_case_with_its_token_hint() {
        let _env = TrezorEnv::set(&[]);
        if trezor_emulator_endpoint().is_none() {
            eprintln!("skipped: {ENV_TREZOR_EMULATOR} is not set");
            return;
        }
        let Ok(name) = std::env::var("THRU_TEST_FIXTURE_CASE") else {
            eprintln!("skipped: THRU_TEST_FIXTURE_CASE is not set");
            return;
        };
        let fixture: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../../trezor/app-thru/tests/fixtures/sign_tx.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name.as_str())
            .unwrap_or_else(|| panic!("no fixture case {name}"));
        let body = hex::decode(case["body_hex"].as_str().unwrap()).unwrap();
        let hint = case["token_hint_hex"].as_str().map(|text| {
            let bytes: [u8; thru_ledger::token_hint::TOKEN_HINT_SZ] = hex::decode(text)
                .unwrap()
                .try_into()
                .expect("a hint of 129 bytes");
            assert_eq!(bytes[0], thru_ledger::token_hint::TOKEN_HINT_KIND);
            let part = |i: usize| <[u8; 32]>::try_from(&bytes[1 + 32 * i..33 + 32 * i]).unwrap();
            let hint = thru_ledger::TokenHint {
                mint: part(0),
                recipient_owner: part(1),
                recipient_seed: part(2),
                source_seed: part(3),
            };
            assert_eq!(hint.encode(), bytes);
            hint
        });

        let uri = format!(
            "trezor://{}",
            case["path"].as_str().unwrap().trim_start_matches("m/")
        );
        let signer = resolve_signer(&Config::default(), &uri).unwrap();
        let mut wire = body.clone();
        wire.extend_from_slice(&[0u8; 64]);
        let mut transaction = Transaction::from_wire(&wire).expect("fixture body parses");
        let result =
            sign_transaction_for_with_token_hint(&mut transaction, &signer, hint.as_ref(), |e| {
                CliError::Crypto(format!("Failed to sign transaction: {e}"))
            });
        if let Ok(path) = std::env::var("THRU_TEST_PREVIEW_OUT") {
            std::fs::write(
                path,
                serde_json::to_string_pretty(&signer.trezor_preview_json()).unwrap(),
            )
            .unwrap();
        }
        // The person may refuse on the device: then the code of the error is
        // what is expected, whatever the fixture says of the transaction.
        if let Ok(code) = std::env::var("THRU_TEST_EXPECT_CODE") {
            match result {
                Err(CliError::Trezor { code: got, .. }) => assert_eq!(got, code, "{name}"),
                other => panic!("{name}: want the error {code}, got {other:?}"),
            }
            eprintln!("fixture case {name}: ok");
            return;
        }
        match case["outcome"].as_str().unwrap() {
            "signed" => {
                let signed = result.unwrap_or_else(|e| panic!("{name}: {e:?}"));
                assert_eq!(
                    hex::encode(&signed[body.len()..]),
                    case["signature_hex"].as_str().unwrap(),
                    "{name}"
                );
                assert_eq!(signed[..body.len()], body[..]);
            }
            reason => match result {
                Err(CliError::Trezor {
                    reason: Some(got), ..
                }) => {
                    assert_eq!(got, reason, "{name}")
                }
                other => panic!("{name}: want the app's refusal {reason}, got {other:?}"),
            },
        }
        eprintln!("fixture case {name}: ok");
    }
}

/// The review of a Trezor request: printed before the request is sent, and
/// the same value in the JSON output.
#[cfg(test)]
mod trezor_review_tests {
    use super::*;
    use std::cell::RefCell;
    use thru_base::txn_tools::{EOA_PROGRAM, TransactionBuilder};

    fn key() -> crate::keys::LoadedKey {
        crate::keys::LoadedKey::from_seed(zeroize::Zeroizing::new([1u8; 32]))
    }

    fn path() -> thru_trezor::DerivationPath {
        thru_trezor::DerivationPath::new(0).unwrap()
    }

    fn transfer(fee_payer: [u8; 32]) -> Transaction {
        TransactionBuilder::build_transfer(fee_payer, EOA_PROGRAM, [0x40; 32], 5, 1000, 7, 500)
            .unwrap()
    }

    fn local_resolved() -> ResolvedSigner {
        let key = key();
        let public_key = key.public_key;
        ResolvedSigner {
            name: "local".to_string(),
            path: None,
            signer: Box::new(key),
            public_key,
            address: Pubkey::from_bytes(&public_key),
            ledger: None,
            trezor: None,
            trezor_review: Mutex::new(None),
        }
    }

    /// Signs `transaction` through the Trezor path with a recording device: the
    /// log holds what happened, in order.
    fn run(
        transaction: &mut Transaction,
        hint: Option<&thru_ledger::TokenHint>,
        log: &RefCell<Vec<String>>,
        recorded: &RefCell<Option<Review>>,
    ) -> Result<Vec<u8>, CliError> {
        let key = key();
        sign_transaction_with_trezor_request(
            transaction,
            &key.public_key,
            &path(),
            |review| {
                log.borrow_mut().push("record".to_string());
                *recorded.borrow_mut() = review;
            },
            hint,
            |e| CliError::Crypto(e.to_string()),
            |text| log.borrow_mut().push(format!("print {}", text.lines().next().unwrap())),
            |body, hint| {
                log.borrow_mut()
                    .push(format!("request {} bytes, hint {}", body.len(), hint.is_some()));
                Ok(key.sign_transaction_body(body).unwrap())
            },
        )
    }

    #[test]
    fn the_review_is_printed_before_the_signing_request_is_sent() {
        let (log, recorded) = (RefCell::new(Vec::new()), RefCell::new(None));
        let mut tx = transfer(key().public_key);
        let signed = run(&mut tx, None, &log, &recorded).unwrap();
        let log = log.borrow();
        assert_eq!(log.len(), 3, "{log:?}");
        assert_eq!(log[0], "record");
        assert_eq!(
            log[1],
            "print Trezor review (Send): your device must show exactly these values"
        );
        assert_eq!(log[2], format!("request {} bytes, hint false", signed.len() - 64));
        assert_eq!(recorded.borrow().as_ref().unwrap().kind, "transfer");
    }

    /// A shape the app refuses has no review: nothing is printed, the request
    /// is still sent (the app's refusal is the answer), and no review is kept.
    #[test]
    fn a_shape_the_app_refuses_is_still_sent_without_a_review() {
        let (log, recorded) = (RefCell::new(Vec::new()), RefCell::new(None));
        let mut tx = transfer(key().public_key).with_may_compress_account();
        run(&mut tx, None, &log, &recorded).unwrap();
        let log = log.borrow();
        assert_eq!(log.len(), 2, "{log:?}");
        assert_eq!(log[0], "record");
        assert!(log[1].starts_with("request "), "{log:?}");
        assert!(recorded.borrow().is_none());
    }

    /// The device refusing (here: an error from the request) leaves the printed
    /// review in place and gives the app's refusal sentence, not a second one.
    #[test]
    fn an_app_refusal_is_the_apps_sentence() {
        let key = key();
        let mut tx = transfer(key.public_key).with_may_compress_account();
        let error = sign_transaction_with_trezor_request(
            &mut tx,
            &key.public_key,
            &path(),
            |_| {},
            None,
            |e| CliError::Crypto(e.to_string()),
            |_| panic!("no review to print"),
            |_, _| Err(TrezorError::AppRefused("unsupported_transaction".to_string())),
        )
        .unwrap_err();
        match error {
            CliError::Trezor { code, message, .. } => {
                assert_eq!(code, "app_refused");
                assert!(message.contains("does not sign this transaction"), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_fee_payer_that_is_not_the_key_never_reaches_the_device() {
        let (log, recorded) = (RefCell::new(Vec::new()), RefCell::new(None));
        let mut tx = transfer([0x99; 32]);
        assert!(run(&mut tx, None, &log, &recorded).is_err());
        assert!(log.borrow().is_empty());
    }

    #[test]
    fn a_token_hint_is_sent_with_the_request_and_proven_in_the_review() {
        let (log, recorded) = (RefCell::new(Vec::new()), RefCell::new(None));
        let fee_payer = key().public_key;
        let mint = [0x50; 32];
        let owner = [0x60; 32];
        let (source, dest) = (
            thru_ledger::token_account_address(&fee_payer, &mint, &[0x71; 32]),
            thru_ledger::token_account_address(&owner, &mint, &[0x72; 32]),
        );
        let hint = thru_ledger::TokenHint {
            mint,
            recipient_owner: owner,
            recipient_seed: [0x72; 32],
            source_seed: [0x71; 32],
        };
        let mut tx = TransactionBuilder::build_token_transfer(
            fee_payer,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            source,
            dest,
            fee_payer,
            9,
            1000,
            0,
            500,
        )
        .unwrap();
        run(&mut tx, Some(&hint), &log, &recorded).unwrap();
        assert!(log.borrow()[2].ends_with("hint true"), "{:?}", log.borrow());
        let review = recorded.borrow().clone().unwrap();
        let json = review.to_json();
        assert_eq!(json["kind"], "token_transfer");
        let parties = json["steps"][0]["items"].as_array().unwrap();
        let address_type = parties.iter().find(|i| i["label"] == "Address type").unwrap();
        assert_eq!(address_type["value"], "Token account owners");
    }

    /// Messages and EOA authorizations print through the same helper.
    #[test]
    fn nothing_is_sent_before_the_text_is_printed() {
        let log = RefCell::new(Vec::new());
        let review = crate::trezor_preview::message_review(b"hi", &[1; 32], &path()).unwrap();
        let out = print_trezor_review_then(
            Some(&review),
            |text| log.borrow_mut().push(format!("print {}", text.lines().next().unwrap())),
            || {
                log.borrow_mut().push("request".to_string());
                7
            },
        );
        assert_eq!(out, 7);
        assert_eq!(
            *log.borrow(),
            [
                "print Trezor review (Sign message): your device must show exactly these values",
                "request"
            ]
        );
        let out = print_trezor_review_then(None, |_| panic!("no review"), || 8);
        assert_eq!(out, 8);
    }

    #[test]
    fn json_gets_trezor_preview_only_for_a_trezor_key() {
        let response = serde_json::json!({ "transfer": { "status": "success" } });
        // A local key: the response is byte for byte the same.
        let local = local_resolved();
        assert_eq!(local.trezor_preview_json(), serde_json::Value::Null);
        assert_eq!(
            serde_json::to_string(&local.add_trezor_preview(response.clone(), "transfer")).unwrap(),
            serde_json::to_string(&response).unwrap()
        );
        // The insertion a Trezor key does.
        let review = crate::trezor_preview::message_review(b"hi", &[1; 32], &path()).unwrap();
        let with = insert_trezor_preview(response.clone(), "transfer", review.to_json());
        assert_eq!(with["transfer"]["status"], "success");
        assert_eq!(with["transfer"]["trezor_preview"], review.to_json());
        // A response without the section is returned as it is.
        assert_eq!(insert_trezor_preview(response.clone(), "other", review.to_json()), response);
        // A key that has made no request reports null, not a missing key.
        assert_eq!(
            insert_trezor_preview(response, "transfer", serde_json::Value::Null)["transfer"]
                ["trezor_preview"],
            serde_json::Value::Null
        );
    }
}
