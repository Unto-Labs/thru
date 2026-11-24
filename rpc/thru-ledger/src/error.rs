//! Status words and typed errors (`specs/ledger/app-thru-apdu.md` §5, §11.5).
//!
//! Every status word maps to a [`LedgerError`] variant.  The `Display` text of
//! the variants a user can fix themselves (locked device, wrong app, blind
//! signing disabled, fee payer mismatch, path rejected, ...) states the fix.

use thiserror::Error;

use crate::path::PathError;
use crate::transport::TransportError;

/// Status-word constants (§5.1, §5.2, Appendix C).
pub mod sw {
    /// Success.
    pub const OK: u16 = 0x9000;
    /// `Lc` inconsistent with the INS or chunk.
    pub const WRONG_DATA_LENGTH: u16 = 0x6700;
    /// The user rejected on the device.
    pub const USER_DENIED: u16 = 0x6985;
    /// P1/P2 not allowed for this INS or chunk.
    pub const WRONG_P1P2: u16 = 0x6A86;
    /// Unknown INS.
    pub const INS_NOT_SUPPORTED: u16 = 0x6D00;
    /// CLA ≠ 0xE0.
    pub const CLA_NOT_SUPPORTED: u16 = 0x6E00;
    /// Internal device failure.
    pub const INTERNAL_ERROR: u16 = 0x6F00;
    /// Structural or length violation.
    pub const TXN_INVALID_FORMAT: u16 = 0x6801;
    /// `version ≠ 1`.
    pub const TXN_INVALID_VERSION: u16 = 0x6802;
    /// Unknown flag bits.
    pub const TXN_INVALID_FLAGS: u16 = 0x6803;
    /// `chain_id == 0` (SIGN_TXN header or SIGN_EOA_AUTH request).
    pub const CHAIN_ID_ZERO: u16 = 0x6804;
    /// Fee-payer state-proof type UPDATING (1) or 3.
    pub const TXN_INVALID_PROOF_TYPE: u16 = 0x6805;
    /// `2 + rw + ro > 1024`.
    pub const TXN_ACCOUNT_LIMIT: u16 = 0x6806;
    /// Duplicate account.
    pub const TXN_DUPLICATE_ACCOUNT: u16 = 0x6807;
    /// Blind-signing setting is off.
    pub const BLIND_SIGNING_DISABLED: u16 = 0x6808;
    /// rw list not strictly ascending.
    pub const TXN_UNSORTED_RW: u16 = 0x6809;
    /// ro list not strictly ascending.
    pub const TXN_UNSORTED_RO: u16 = 0x680A;
    /// Header fee payer ≠ derived pubkey.
    pub const FEE_PAYER_MISMATCH: u16 = 0x6810;
    /// Header pad ≠ 0.
    pub const TXN_PAD_NONZERO: u16 = 0x6811;
    /// `rw_cnt > RW_CACHE_MAX` and `ro_cnt > 0`.
    pub const TXN_RW_CACHE_EXCEEDED: u16 = 0x6812;
    /// SIGN_TXN chunk 0: the hint after the path has an unknown kind.
    pub const TXN_HINT_INVALID: u16 = 0x6813;
    /// SIGN_TXN: the token hint does not prove the transaction's token
    /// accounts, or the transaction is not a recognized token transfer.
    pub const TOKEN_HINT_MISMATCH: u16 = 0x6814;
    /// Path fails §4.2.
    pub const PATH_REJECTED: u16 = 0x6820;
    /// Wrong chunk sequence or no session.
    pub const CHUNK_OUT_OF_ORDER: u16 = 0x6830;
    /// SIGN_MESSAGE streamed length ≠ `msg_len`.
    pub const LENGTH_MISMATCH: u16 = 0x6831;
    /// `msg_len == 0` or `> MSG_MAX`.
    pub const MSG_INVALID_LENGTH: u16 = 0x6840;
    /// Pass-2 bytes differ from pass-1 bytes.
    pub const MSG_PASS_MISMATCH: u16 = 0x6841;
    /// SIGN_EOA_AUTH `account ≠` derived pubkey.
    pub const EOA_ACCOUNT_MISMATCH: u16 = 0x6850;
    /// SIGN_EOA_AUTH `kind ∉ {0, 1}`.
    pub const EOA_INVALID_KIND: u16 = 0x6851;
    /// OS: device locked.
    pub const OS_LOCKED: u16 = 0x5515;
    /// OS: app not open / wrong app (firmware-dependent).
    pub const OS_WRONG_APP_6E01: u16 = 0x6E01;
    /// OS: app not open / wrong app (firmware-dependent).
    pub const OS_WRONG_APP_6511: u16 = 0x6511;
    /// OS: app not open / wrong app (firmware-dependent).
    pub const OS_WRONG_APP_6D02: u16 = 0x6D02;
    /// Ledger Rust SDK (`CmdNotAccepted`): the app is showing a synchronous
    /// screen (the status page after a review, about 3 s) and the SDK
    /// answered the APDU without passing it to the app.  Retryable.
    pub const SDK_CMD_NOT_ACCEPTED: u16 = 0x6901;
    /// Ledger Rust SDK (`BadLen`): the SDK refused a malformed APDU (length
    /// fields inconsistent) before the app saw it.
    pub const SDK_BAD_LEN: u16 = 0x6E03;
}

/// Transaction-validity reasons the device reports (`0x6801`-`0x680A`,
/// `0x6811`, `0x6812`).  [`TxnReject::class`] names match the corpus
/// `sw_class` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxnReject {
    /// `0x6801`: size, truncation or trailing bytes.
    InvalidFormat,
    /// `0x6802`.
    InvalidVersion,
    /// `0x6803`.
    InvalidFlags,
    /// `0x6804`.
    ChainIdZero,
    /// `0x6805`.
    InvalidProofType,
    /// `0x6806`.
    AccountLimit,
    /// `0x6807`.
    DuplicateAccount,
    /// `0x6809`.
    UnsortedReadWrite,
    /// `0x680A`.
    UnsortedReadOnly,
    /// `0x6811` (device-only policy).
    PadNonzero,
    /// `0x6812` (device-only policy).
    RwCacheExceeded,
}

impl TxnReject {
    /// Map a status word to a reason, if it is one.
    pub fn from_sw(code: u16) -> Option<Self> {
        Some(match code {
            sw::TXN_INVALID_FORMAT => Self::InvalidFormat,
            sw::TXN_INVALID_VERSION => Self::InvalidVersion,
            sw::TXN_INVALID_FLAGS => Self::InvalidFlags,
            sw::CHAIN_ID_ZERO => Self::ChainIdZero,
            sw::TXN_INVALID_PROOF_TYPE => Self::InvalidProofType,
            sw::TXN_ACCOUNT_LIMIT => Self::AccountLimit,
            sw::TXN_DUPLICATE_ACCOUNT => Self::DuplicateAccount,
            sw::TXN_UNSORTED_RW => Self::UnsortedReadWrite,
            sw::TXN_UNSORTED_RO => Self::UnsortedReadOnly,
            sw::TXN_PAD_NONZERO => Self::PadNonzero,
            sw::TXN_RW_CACHE_EXCEEDED => Self::RwCacheExceeded,
            _ => return None,
        })
    }

    /// The status word for this reason.
    pub fn sw(self) -> u16 {
        match self {
            Self::InvalidFormat => sw::TXN_INVALID_FORMAT,
            Self::InvalidVersion => sw::TXN_INVALID_VERSION,
            Self::InvalidFlags => sw::TXN_INVALID_FLAGS,
            Self::ChainIdZero => sw::CHAIN_ID_ZERO,
            Self::InvalidProofType => sw::TXN_INVALID_PROOF_TYPE,
            Self::AccountLimit => sw::TXN_ACCOUNT_LIMIT,
            Self::DuplicateAccount => sw::TXN_DUPLICATE_ACCOUNT,
            Self::UnsortedReadWrite => sw::TXN_UNSORTED_RW,
            Self::UnsortedReadOnly => sw::TXN_UNSORTED_RO,
            Self::PadNonzero => sw::TXN_PAD_NONZERO,
            Self::RwCacheExceeded => sw::TXN_RW_CACHE_EXCEEDED,
        }
    }

    /// Reason class name, as in the corpus `sw_class` field.
    pub fn class(self) -> &'static str {
        match self {
            Self::InvalidFormat => "format",
            Self::InvalidVersion => "version",
            Self::InvalidFlags => "flags",
            Self::ChainIdZero => "chain_id_zero",
            Self::InvalidProofType => "proof_type",
            Self::AccountLimit => "too_many_accounts",
            Self::DuplicateAccount => "duplicate_account",
            Self::UnsortedReadWrite => "rw_unsorted",
            Self::UnsortedReadOnly => "ro_unsorted",
            Self::PadNonzero => "pad_nonzero",
            Self::RwCacheExceeded => "rw_cache_exceeded",
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::InvalidFormat => "malformed transaction (size, truncation or trailing bytes)",
            Self::InvalidVersion => "unsupported transaction version",
            Self::InvalidFlags => "unknown transaction flags",
            Self::ChainIdZero => "chain id is 0",
            Self::InvalidProofType => "invalid fee-payer state-proof type",
            Self::AccountLimit => "too many accounts",
            Self::DuplicateAccount => "duplicate account",
            Self::UnsortedReadWrite => "read-write accounts are not sorted",
            Self::UnsortedReadOnly => "read-only accounts are not sorted",
            Self::PadNonzero => "header padding is not zero (rejected by Ledger policy)",
            Self::RwCacheExceeded => {
                "more than 32 read-write accounts together with read-only accounts \
                 (rejected by Ledger policy)"
            }
        }
    }
}

impl std::fmt::Display for TxnReject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (0x{:04X})", self.describe(), self.sw())
    }
}

/// Reasons the device refuses a request that is not a transaction body
/// (spec §5.3 `InvalidRequest`).  Names match `@thru/ledger`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestReject {
    /// `0x6840`: message length 0 or above 32768 bytes.
    MessageLength,
    /// `0x6851`: SIGN_EOA_AUTH kind not create (0) or delete (1).
    EoaKind,
    /// `0x6804` from SIGN_EOA_AUTH: chain id 0.
    ChainIdZero,
    /// `0x6814`: the token hint does not match the transaction's token
    /// accounts (also refused by the host before streaming).
    TokenHint,
}

impl RequestReject {
    /// The status word for this reason.
    pub fn sw(self) -> u16 {
        match self {
            Self::MessageLength => sw::MSG_INVALID_LENGTH,
            Self::EoaKind => sw::EOA_INVALID_KIND,
            Self::ChainIdZero => sw::CHAIN_ID_ZERO,
            Self::TokenHint => sw::TOKEN_HINT_MISMATCH,
        }
    }

    /// Reason class name.
    pub fn class(self) -> &'static str {
        match self {
            Self::MessageLength => "msg_invalid_length",
            Self::EoaKind => "eoa_invalid_kind",
            Self::ChainIdZero => "chain_id_zero",
            Self::TokenHint => "token_hint",
        }
    }
}

impl std::fmt::Display for RequestReject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let what = match self {
            Self::MessageLength => format!(
                "message length must be between 1 and {} bytes",
                crate::consts::MSG_MAX
            ),
            Self::EoaKind => "EOA authorization kind must be create or delete".to_string(),
            Self::ChainIdZero => "chain id must not be 0".to_string(),
            Self::TokenHint => {
                "the token hint does not match the transaction's token accounts".to_string()
            }
        };
        write!(f, "{what} (0x{:04X})", self.sw())
    }
}

/// Every error the Ledger signer can return.
#[derive(Debug, Error)]
pub enum LedgerError {
    /// `0x6985`.
    #[error("the request was rejected on the Ledger device")]
    UserRejected,
    /// `0x6808`.
    #[error(
        "blind signing is disabled on the Ledger: open the Thru app, go to Settings, \
         enable \"Blind signing\", then retry"
    )]
    BlindSigningDisabled,
    /// `0x6810`: the transaction fee payer is not this device's key.
    #[error(
        "the transaction fee payer is not the Ledger account for this path: use the \
         Ledger key as fee payer or select the matching derivation path"
    )]
    FeePayerMismatch,
    /// `0x6820`: the device refused the derivation path.
    #[error(
        "the Ledger refused the derivation path: Thru accounts use m/44'/{coin}'/<account>'/0'",
        coin = crate::consts::THRU_COIN_TYPE
    )]
    PathRejected,
    /// `0x6850`: the EOA authorization is not for this device's key.
    #[error("the EOA account is not the Ledger account for this path")]
    EoaAccountMismatch,
    /// `0x6801`-`0x680A`, `0x6811`, `0x6812`.
    #[error("the Ledger rejected the transaction: {0}")]
    InvalidTransaction(TxnReject),
    /// `0x6840`, `0x6851`, `0x6814`, and `0x6804` from SIGN_EOA_AUTH.
    #[error("invalid signing request: {0}")]
    InvalidRequest(RequestReject),
    /// `0x6700`, `0x6A86`, `0x6830`, `0x6831`, `0x6841`: a host /
    /// device protocol disagreement (a bug, or an app older/newer than this host).
    #[error("Ledger protocol error (status 0x{sw:04X}): {reason}")]
    ProtocolError {
        /// The status word.
        sw: u16,
        /// What it means.
        reason: &'static str,
    },
    /// `0x5515`.
    #[error("the Ledger device is locked: unlock it with your PIN and open the Thru app")]
    Locked,
    /// `0x6E01`/`0x6511`/`0x6D02`, `0x6E00`, or the open app is not "Thru".
    #[error("the Thru app is not open on the Ledger: {detail}")]
    WrongApp {
        /// What was observed.
        detail: String,
    },
    /// `0x6D00`: the app does not know the instruction (outdated app), or
    /// `0x6813`: it does not know the token hint kind.
    #[error("the Thru Ledger app does not support this request (0x{sw:04X}): update the Thru app")]
    Unsupported {
        /// The status word.
        sw: u16,
    },
    /// The app speaks a different APDU protocol version.
    #[error(
        "the Thru Ledger app uses APDU protocol version {device}, but this client supports \
         version {host}: update the Thru app and this client"
    )]
    UnsupportedAppVersion {
        /// Version reported by the device.
        device: u8,
        /// Version this host implements.
        host: u8,
    },
    /// `0x6F00`.
    #[error(
        "internal error on the Ledger device; retry, and reinstall the Thru app if it persists"
    )]
    DeviceError,
    /// `0x6901` for longer than the host's retry budget: the device kept
    /// showing a screen (normally the status page after a review) and did
    /// not accept commands.
    #[error(
        "the Ledger is busy showing a previous result (0x6901): wait for the Thru app home \
         screen, then retry"
    )]
    Busy,
    /// Any status word not defined by the spec.
    #[error("unexpected Ledger status word 0x{0:04X}")]
    Unknown(u16),
    /// The device answered `0x9000` with data of the wrong shape.
    #[error("unexpected response from the Ledger: {0}")]
    UnexpectedResponse(String),
    /// Transport failure (USB HID, TCP).
    #[error("{0}")]
    Transport(#[from] TransportError),
    /// Host-side path policy failure (the device is never contacted).
    #[error(transparent)]
    InvalidPath(#[from] PathError),
    /// Host-side input validation failure (the device is never contacted).
    #[error("invalid signing request: {0}")]
    InvalidInput(String),
    /// The device key is not the key the caller expected (for example the
    /// configured pubkey for a `ledger://` key, or a body's fee payer).
    #[error(
        "Ledger key mismatch: expected {expected}, device has {got} (wrong device, wrong \
         passphrase, or wrong account path)"
    )]
    KeyMismatch {
        /// Expected `ta…` address.
        expected: String,
        /// Device `ta…` address.
        got: String,
    },
    /// The device signature failed strict verification.
    #[error("the Ledger returned a signature that does not verify; it was not used")]
    InvalidSignature,
}

impl LedgerError {
    /// Map a non-`0x9000` status word to its typed error (§5.3, §5.2),
    /// without knowing which command produced it.  `0x6804` maps to
    /// `InvalidTransaction(ChainIdZero)`; use [`Self::from_sw_for`] when the
    /// INS is known.
    pub fn from_sw(code: u16) -> Self {
        Self::from_sw_for(crate::consts::ins::SIGN_TXN, code)
    }

    /// Map a status word returned for a command with instruction `ins`
    /// (§5.3: `0x6804` from SIGN_EOA_AUTH is `InvalidRequest(ChainIdZero)`).
    pub fn from_sw_for(ins: u8, code: u16) -> Self {
        if code == sw::CHAIN_ID_ZERO && ins == crate::consts::ins::SIGN_EOA_AUTH {
            return Self::InvalidRequest(RequestReject::ChainIdZero);
        }
        if let Some(reason) = TxnReject::from_sw(code) {
            return Self::InvalidTransaction(reason);
        }
        match code {
            sw::USER_DENIED => Self::UserRejected,
            sw::BLIND_SIGNING_DISABLED => Self::BlindSigningDisabled,
            sw::FEE_PAYER_MISMATCH => Self::FeePayerMismatch,
            sw::PATH_REJECTED => Self::PathRejected,
            sw::EOA_ACCOUNT_MISMATCH => Self::EoaAccountMismatch,
            sw::MSG_INVALID_LENGTH => Self::InvalidRequest(RequestReject::MessageLength),
            sw::EOA_INVALID_KIND => Self::InvalidRequest(RequestReject::EoaKind),
            sw::TOKEN_HINT_MISMATCH => Self::InvalidRequest(RequestReject::TokenHint),
            // An app that does not know this hint kind.
            sw::TXN_HINT_INVALID => Self::Unsupported { sw: code },
            sw::WRONG_DATA_LENGTH => Self::ProtocolError {
                sw: code,
                reason: "wrong data length",
            },
            sw::WRONG_P1P2 => Self::ProtocolError {
                sw: code,
                reason: "P1/P2 not allowed",
            },
            sw::CHUNK_OUT_OF_ORDER => Self::ProtocolError {
                sw: code,
                reason: "chunk out of order or no active session",
            },
            sw::LENGTH_MISMATCH => Self::ProtocolError {
                sw: code,
                reason: "streamed message length does not match the declared length",
            },
            sw::MSG_PASS_MISMATCH => Self::ProtocolError {
                sw: code,
                reason: "the two message passes differ",
            },
            sw::INS_NOT_SUPPORTED => Self::Unsupported { sw: code },
            sw::CLA_NOT_SUPPORTED => Self::WrongApp {
                detail: "the open app does not accept Thru commands (0x6E00); open the Thru app"
                    .into(),
            },
            sw::INTERNAL_ERROR => Self::DeviceError,
            sw::SDK_CMD_NOT_ACCEPTED => Self::Busy,
            sw::SDK_BAD_LEN => Self::ProtocolError {
                sw: code,
                reason: "the Ledger SDK rejected the APDU length",
            },
            sw::OS_LOCKED => Self::Locked,
            sw::OS_WRONG_APP_6E01 | sw::OS_WRONG_APP_6511 | sw::OS_WRONG_APP_6D02 => {
                Self::WrongApp {
                    detail: format!(
                        "no app or another app is open (0x{code:04X}); open the Thru app"
                    ),
                }
            }
            other => Self::Unknown(other),
        }
    }

    /// The canonical reason class (corpus `sw_class`, spec §5.3 / §13.3) for
    /// `InvalidTransaction` and `InvalidRequest`, whether the device or the
    /// host pre-validation refused.
    pub fn reason_class(&self) -> Option<&'static str> {
        match self {
            Self::InvalidTransaction(r) => Some(r.class()),
            Self::InvalidRequest(r) => Some(r.class()),
            _ => None,
        }
    }

    /// The status word this error came from (or, for a host pre-validation
    /// refusal, the status word the device would return).
    pub fn status_word(&self) -> Option<u16> {
        Some(match self {
            Self::UserRejected => sw::USER_DENIED,
            Self::BlindSigningDisabled => sw::BLIND_SIGNING_DISABLED,
            Self::FeePayerMismatch => sw::FEE_PAYER_MISMATCH,
            Self::PathRejected => sw::PATH_REJECTED,
            Self::EoaAccountMismatch => sw::EOA_ACCOUNT_MISMATCH,
            Self::InvalidTransaction(r) => r.sw(),
            Self::InvalidRequest(r) => r.sw(),
            Self::ProtocolError { sw, .. } => *sw,
            Self::Locked => sw::OS_LOCKED,
            Self::Unsupported { sw } => *sw,
            Self::DeviceError => sw::INTERNAL_ERROR,
            Self::Busy => sw::SDK_CMD_NOT_ACCEPTED,
            Self::Unknown(code) => *code,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_txn_reason_round_trips() {
        for code in [
            0x6801u16, 0x6802, 0x6803, 0x6804, 0x6805, 0x6806, 0x6807, 0x6809, 0x680A, 0x6811,
            0x6812,
        ] {
            let r = TxnReject::from_sw(code).unwrap();
            assert_eq!(r.sw(), code);
            let e = LedgerError::from_sw(code);
            assert!(matches!(e, LedgerError::InvalidTransaction(x) if x == r));
            assert_eq!(e.status_word(), Some(code));
        }
        assert_eq!(TxnReject::from_sw(0x6808), None);
        assert_eq!(TxnReject::from_sw(0x6810), None);
    }

    #[test]
    fn spec_mapping_table() {
        use LedgerError as E;
        let check = |code: u16, f: fn(&E) -> bool| {
            let e = E::from_sw(code);
            assert!(f(&e), "0x{code:04X} -> {e:?}");
        };
        check(0x6985, |e| matches!(e, E::UserRejected));
        check(0x6808, |e| matches!(e, E::BlindSigningDisabled));
        check(0x6810, |e| matches!(e, E::FeePayerMismatch));
        check(0x6820, |e| matches!(e, E::PathRejected));
        check(0x6850, |e| matches!(e, E::EoaAccountMismatch));
        check(0x6840, |e| {
            matches!(e, E::InvalidRequest(RequestReject::MessageLength))
        });
        check(0x6851, |e| {
            matches!(e, E::InvalidRequest(RequestReject::EoaKind))
        });
        check(0x6804, |e| {
            matches!(e, E::InvalidTransaction(TxnReject::ChainIdZero))
        });
        let eoa = E::from_sw_for(crate::consts::ins::SIGN_EOA_AUTH, 0x6804);
        assert!(matches!(eoa, E::InvalidRequest(RequestReject::ChainIdZero)));
        assert_eq!(eoa.status_word(), Some(0x6804));
        for code in [0x6700, 0x6A86, 0x6830, 0x6831, 0x6841] {
            let e = E::from_sw(code);
            assert!(
                matches!(e, E::ProtocolError { sw, .. } if sw == code),
                "{e:?}"
            );
            assert_eq!(e.status_word(), Some(code));
        }
        check(0x6D00, |e| matches!(e, E::Unsupported { sw: 0x6D00 }));
        check(0x6813, |e| matches!(e, E::Unsupported { sw: 0x6813 }));
        check(
            0x6814,
            |e| matches!(e, E::InvalidRequest(r) if *r == RequestReject::TokenHint),
        );
        check(0x6E00, |e| matches!(e, E::WrongApp { .. }));
        check(0x6F00, |e| matches!(e, E::DeviceError));
        check(0x5515, |e| matches!(e, E::Locked));
        for code in [0x6E01, 0x6511, 0x6D02] {
            check(code, |e| matches!(e, E::WrongApp { .. }));
        }
        check(0x6901, |e| matches!(e, E::Busy));
        assert_eq!(E::Busy.status_word(), Some(0x6901));
        check(0x6E03, |e| matches!(e, E::ProtocolError { sw: 0x6E03, .. }));
        for code in [0x6A80, 0x6A88, 0x6800, 0x680B, 0x1234] {
            check(code, |e| matches!(e, E::Unknown(_)));
        }
    }

    #[test]
    fn actionable_messages() {
        assert!(LedgerError::Locked.to_string().contains("unlock"));
        assert!(
            LedgerError::BlindSigningDisabled
                .to_string()
                .contains("Blind signing")
        );
        assert!(
            LedgerError::from_sw(0x6E01)
                .to_string()
                .contains("open the Thru app")
        );
        assert!(
            LedgerError::PathRejected
                .to_string()
                .contains("m/44'/8478'")
        );
        assert!(
            LedgerError::FeePayerMismatch
                .to_string()
                .contains("fee payer")
        );
    }
}
