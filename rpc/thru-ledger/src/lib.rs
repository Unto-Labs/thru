//! Ledger hardware-wallet support for Thru.
//!
//! This crate implements the host side of the Thru device app protocol
//! (`specs/ledger/app-thru-apdu.md`):
//!
//! * [`path`]: derivation-path policy, parsing and the `ledger://` URI form;
//! * [`apdu`]: byte-exact request builders and response parsers for every INS;
//! * [`error`]: status words and the typed [`LedgerError`];
//! * [`transport`]: the [`Transport`] trait, with USB HID ([`hid`], feature
//!   `hid`, default), Speculos TCP ([`speculos`], feature `speculos`) and test
//!   doubles ([`mock`], feature `mock`);
//! * [`device`]: [`ThruLedger`], a typed client that streams transactions and
//!   messages in 255-byte chunks and reports [`Progress`];
//! * [`preview`]: the review the device will show (§7.7, §8.6, §9.4), with
//!   the Appendix B formatters, for host-side preview parity (§11.3);
//! * [`signer`]: [`LedgerSigner`], a [`thru_base::signer::Signer`] that adds
//!   the host obligations (pre-validation, preview, strict verification).
//!
//! ```no_run
//! # #[cfg(feature = "hid")]
//! # fn demo(body: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
//! use thru_base::signer::sign_transaction_body_with;
//! use thru_ledger::{DerivationPath, HidTransport, LedgerSigner};
//!
//! let signer = LedgerSigner::connect(HidTransport::open()?, DerivationPath::new(0)?)?;
//! println!("Ledger address: {}", signer.address());
//! let signed_wire = sign_transaction_body_with(&signer, body)?;
//! # let _ = signed_wire; Ok(()) }
//! ```

#![deny(missing_docs)]

pub mod apdu;
pub mod consts;
pub mod device;
pub mod error;
#[cfg(feature = "hid")]
pub mod hid;
#[cfg(feature = "mock")]
pub mod mock;
pub mod path;
pub mod preview;
pub mod signer;
#[cfg(feature = "speculos")]
pub mod speculos;
pub mod token_hint;
pub mod transfer;
pub mod transport;

pub use apdu::{AppConfig, AppVersion};
pub use device::{BusyRetry, Operation, Progress, ProgressFn, ThruLedger};
pub use error::{LedgerError, RequestReject, TxnReject};
#[cfg(feature = "hid")]
pub use hid::HidTransport;
pub use path::{DerivationPath, LEDGER_URI_SCHEME, PathError, is_ledger_uri};
pub use preview::{MessageDisplay, MessagePreview, Preview, TransactionPreview};
pub use signer::{LedgerSigner, PreviewFn};
#[cfg(feature = "speculos")]
pub use speculos::SpeculosTransport;
pub use token_hint::{TokenHint, TokenIdentity, token_account_address, verify_token_hint};
pub use transfer::{CheckedToken, ClearTransfer, TransferKind, decode_clear_transfer};
pub use transport::{Transport, TransportError};
