//! Errors of the Trezor signer.

use crate::transport::TransportError;

/// `Failure.code` values of Trezor's `messages-common.proto` this crate names.
pub mod failure_code {
    pub const UNEXPECTED_MESSAGE: i32 = 1;
    pub const DATA_ERROR: i32 = 3;
    pub const ACTION_CANCELLED: i32 = 4;
    pub const PIN_CANCELLED: i32 = 6;
    pub const PROCESS_ERROR: i32 = 9;
    pub const NOT_INITIALIZED: i32 = 11;
    /// What a device of the Trezor Host Protocol answers a message of the
    /// older protocol with.
    pub const INVALID_PROTOCOL: i32 = 17;
    pub const FIRMWARE_ERROR: i32 = 99;
}

/// Everything that can go wrong between the host and the device.
#[derive(Debug, thiserror::Error)]
pub enum TrezorError {
    /// The packet transport (USB, UDP) failed.
    #[error(transparent)]
    Transport(#[from] TransportError),

    /// The device did not answer in time. The text says what was awaited.
    #[error("timed out waiting for the Trezor: {0}")]
    Timeout(&'static str),

    /// The device is locked and did not unlock for the connection.
    #[error("the Trezor is locked: unlock it and try again")]
    DeviceLocked,

    /// The Trezor Host Protocol channel failed: a protocol violation, a
    /// cryptographic failure, or a transport error reported by the device.
    #[error("Trezor Host Protocol error: {0}")]
    Protocol(String),

    /// The device sent a message that could not be decoded, or one that the
    /// exchange in progress does not allow.
    #[error("unexpected answer from the Trezor: {0}")]
    Unexpected(String),

    /// The user refused on the device.
    #[error("cancelled on the Trezor")]
    Cancelled,

    /// The device answered `Failure`.
    #[error(
        "the Trezor reported failure {code}: {message}{}",
        failure_hint(message)
    )]
    Failure { code: i32, message: String },

    /// The Thru app refused the request: a `DataError` failure whose text is
    /// one lower-case token, such as `message_not_text` or
    /// `token_hint_mismatch`. See [`TrezorError::app_refusal`].
    #[error("the Thru app on the Trezor refused the request: {0}")]
    AppRefused(String),

    /// The request was refused on the host, before anything was sent to the
    /// device.
    #[error("invalid request: {0}")]
    InvalidRequest(String),

    /// Pairing did not complete.
    #[error("pairing with the Trezor failed: {0}")]
    Pairing(String),

    /// The stored pairing credentials could not be read or written.
    #[error("Trezor pairing storage: {0}")]
    Credentials(String),

    /// The app image, its proof or its root packet is missing or malformed,
    /// or the image was built for another model than the device's.
    #[error("Thru app image: {0}")]
    AppImage(String),

    /// The Thru app answered something its protocol does not allow.
    #[error("the Thru app on the Trezor misbehaved: {0}")]
    App(String),

    /// The device is set to take the passphrase on the device only, and
    /// refused a session that carried one (also the empty one).
    #[error(
        "the Trezor is set to take the passphrase on the device only, and refused a passphrase \
         sent by the computer (also an empty one)"
    )]
    PassphraseOnDeviceOnly,

    /// A passphrase wallet was asked for on a device of the older protocol
    /// whose passphrase protection is off: it would not ask for a passphrase
    /// and would open the standard wallet instead.
    #[error(
        "the Trezor has passphrase protection turned off, so it would not ask for a passphrase \
         and would open the standard wallet instead; turn passphrase protection on in the \
         Trezor's settings, or use a key of the standard wallet"
    )]
    PassphraseProtectionOff,

    /// The device answered the protocol probe in the older protocol on a
    /// connection that is not the emulator. That protocol has no encryption
    /// and no pairing, so nothing proves who answered; it is accepted from the
    /// emulator only, and nothing was sent after the probe.
    #[error(
        "the Trezor answered in the older Trezor protocol, which has no encryption and no \
         pairing, and this program accepts that protocol from the emulator only; a Trezor Safe 7 \
         that answers this way is not answering as itself: reconnect it and try again, and if it \
         happens again do not use this connection"
    )]
    OlderProtocolRefused,

    /// The device's key is not the one that was expected (another device,
    /// seed or passphrase).
    #[error("the Trezor's key is {got}, expected {expected}")]
    KeyMismatch { expected: String, got: String },
}

impl TrezorError {
    /// The reason the Thru app gave for refusing, if this is such a refusal.
    pub fn app_refusal(&self) -> Option<&str> {
        match self {
            TrezorError::AppRefused(reason) => Some(reason),
            _ => None,
        }
    }

    /// Turns a `DataError` failure whose text is one lower-case token (the
    /// form of the Thru app's refusals) into [`TrezorError::AppRefused`]. Any
    /// other error, `Cancelled` and every other failure included, is returned
    /// as it is.
    pub(crate) fn into_app_refusal(self) -> Self {
        match self {
            TrezorError::Failure { code, message }
                if code == failure_code::DATA_ERROR && is_reason_token(&message) =>
            {
                TrezorError::AppRefused(message)
            }
            other => other,
        }
    }

    /// Turns the failure of a session request into
    /// [`TrezorError::PassphraseOnDeviceOnly`] when it is the refusal of a
    /// device set to "passphrase always on device": a `DataError` whose text
    /// is the firmware's (`core/src/apps/common/passphrase.py`, `get_passphrase`),
    /// which names the setting `PASSPHRASE_ALWAYS_ON_DEVICE`. No other failure
    /// of a session request mentions it. Anything else is returned as it is.
    pub(crate) fn into_session_refusal(self) -> Self {
        match self {
            TrezorError::Failure { code, message }
                if code == failure_code::DATA_ERROR
                    && message.contains(PASSPHRASE_ALWAYS_ON_DEVICE) =>
            {
                TrezorError::PassphraseOnDeviceOnly
            }
            other => other,
        }
    }

    /// Builds the error for a `Failure` message.
    pub(crate) fn from_failure(code: Option<i32>, message: Option<String>) -> Self {
        let code = code.unwrap_or(0);
        if code == failure_code::ACTION_CANCELLED || code == failure_code::PIN_CANCELLED {
            return TrezorError::Cancelled;
        }
        TrezorError::Failure {
            code,
            message: message.unwrap_or_default(),
        }
    }
}

/// The name of the device setting in the firmware's refusal text.
const PASSPHRASE_ALWAYS_ON_DEVICE: &str = "PASSPHRASE_ALWAYS_ON_DEVICE";

/// One or more of `a-z`, `0-9` and `_`, as the app's refusal reasons are.
fn is_reason_token(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// The text with which the device refuses to load an app.
const FAILED_TO_LOAD_APP: &str = "Failed to load app";

/// What a person can check after a failure that has known causes; empty for
/// any other. The device gives this text when its loader fails with its
/// general error, which a refused root packet is one case of (several other
/// failures have texts of their own), so the hint names a cause and does not
/// claim it. The cause that an intact set of files meets: a device that has
/// loaded a newer build of the app (a newer root packet) remembers it in its
/// storage and refuses an older one, also after a restart, until it is
/// wiped.
fn failure_hint(message: &str) -> &'static str {
    if message == FAILED_TO_LOAD_APP {
        "; one cause: a device that has loaded a newer build of the app refuses an older one \
         until it is wiped, so load the newest build; otherwise check that the image, its \
         proof and the root packet are from the same build"
    } else {
        ""
    }
}

/// Shorthand for results of this crate.
pub type Result<T> = std::result::Result<T, TrezorError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn failure(code: i32, message: &str) -> TrezorError {
        TrezorError::from_failure(Some(code), Some(message.into()))
    }

    #[test]
    fn a_refused_older_build_gets_the_hint_and_no_other_failure_does() {
        let text = failure(failure_code::FIRMWARE_ERROR, "Failed to load app").to_string();
        assert!(text.starts_with("the Trezor reported failure"), "{text}");
        assert!(
            text.ends_with(
                "; one cause: a device that has loaded a newer build of the app refuses an \
                 older one until it is wiped, so load the newest build; otherwise check that \
                 the image, its proof and the root packet are from the same build"
            ),
            "{text}"
        );
        for other in ["App image verification failed", "Failed to load app.", ""] {
            let text = failure(failure_code::FIRMWARE_ERROR, other).to_string();
            assert!(!text.contains("newer build"), "{text}");
        }
    }

    #[test]
    fn data_error_with_a_token_is_a_refusal() {
        let error = failure(failure_code::DATA_ERROR, "message_not_text").into_app_refusal();
        assert_eq!(error.app_refusal(), Some("message_not_text"));
        assert!(error.to_string().contains("message_not_text"));
    }

    #[test]
    fn everything_else_keeps_its_kind() {
        for (code, text) in [
            (failure_code::DATA_ERROR, "Unexpected message"),
            (failure_code::DATA_ERROR, ""),
            (failure_code::PROCESS_ERROR, "token_hint_mismatch"),
            (failure_code::FIRMWARE_ERROR, "unsupported_transaction"),
        ] {
            let error = failure(code, text).into_app_refusal();
            assert!(matches!(error, TrezorError::Failure { .. }), "{error}");
            assert_eq!(error.app_refusal(), None);
        }
        let cancelled = failure(failure_code::ACTION_CANCELLED, "x").into_app_refusal();
        assert!(matches!(cancelled, TrezorError::Cancelled));
        assert!(matches!(
            TrezorError::DeviceLocked.into_app_refusal(),
            TrezorError::DeviceLocked
        ));
    }

    #[test]
    fn the_always_on_device_refusal_is_told_apart() {
        // The firmware's text, verbatim.
        let refusal = failure(
            failure_code::DATA_ERROR,
            "Providing passphrase in message is not allowed when PASSPHRASE_ALWAYS_ON_DEVICE is True.",
        )
        .into_session_refusal();
        assert!(matches!(refusal, TrezorError::PassphraseOnDeviceOnly));
        let text = refusal.to_string();
        assert!(text.contains("on the device only"), "{text}");
        assert!(!text.contains("--"), "no CLI flag in {text}");

        // Other session failures keep their kind.
        for (code, text) in [
            (
                failure_code::DATA_ERROR,
                "Passphrase provided when it shouldn't be!",
            ),
            (
                failure_code::DATA_ERROR,
                "Maximum passphrase length is 128 bytes",
            ),
            (
                failure_code::PROCESS_ERROR,
                "Providing passphrase in message is not allowed when PASSPHRASE_ALWAYS_ON_DEVICE is True.",
            ),
        ] {
            assert!(matches!(
                failure(code, text).into_session_refusal(),
                TrezorError::Failure { .. }
            ));
        }
        // A cancelled passphrase entry is the ordinary cancellation.
        assert!(matches!(
            failure(failure_code::ACTION_CANCELLED, "Passphrase entry cancelled")
                .into_session_refusal(),
            TrezorError::Cancelled
        ));
    }
}
