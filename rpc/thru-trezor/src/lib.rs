//! Trezor signer for Thru (see specs/trezor/cli-host-plan.md and
//! specs/trezor/safe5-plan.md).
//!
//! The host side of the Thru app that runs on a Trezor. Two wire protocols,
//! found by probing the connection once ([`Trezor::connect`]):
//!
//! - the Trezor Host Protocol, which the Safe 7 speaks: an encrypted channel
//!   ([`thp`]) with pairing and stored credentials;
//! - the older protocol of every Trezor before the Safe 7, which the Safe 5
//!   speaks: 64-byte packets with no encryption, no pairing and no
//!   credentials. It is accepted from the emulator only: the answer to the
//!   probe is not authenticated, so on any other transport a device that
//!   answers in it is refused ([`TrezorError::OlderProtocolRefused`]), where
//!   the backend is chosen. The device still shows, and the person still confirms on
//!   it, everything that is signed; but nothing on the wire is authenticated
//!   or secret, so whatever sits between the computer and the device can read
//!   and change what is sent. The Safe 5 can load apps only in the emulator
//!   (retail firmware loads none, on any model), so this backend is proven
//!   against the emulator and has not been run on a device. On it every
//!   connection starts a session of its own and the wallet the key asks for
//!   is honoured or refused before a key is derived (`v1`).
//!
//! Above the choice everything is the same: sessions and calls ([`client`]),
//! loading the app image, which must be built for the device's model
//! ([`extapp`]), the app's own protocol ([`app`]) and a
//! [`thru_base::signer::Signer`] on top ([`signer`]).

pub mod app;
pub mod client;
mod codec_v1;
mod cpace;
pub mod credentials;
pub mod error;
pub mod extapp;
pub mod messages;
pub mod path;
mod probe;
mod random;
pub mod signer;
#[cfg(test)]
mod testing;
pub mod thp;
pub mod transport;
#[cfg(feature = "usb")]
pub mod usb;
mod v1;
#[cfg(test)]
mod v1_tests;
#[cfg(test)]
mod vectors;

pub use app::{TOKEN_HINT_LEN, ThruApp};
pub use client::{ConnectOptions, Trezor, Ui};
pub use credentials::{
    Credential, CredentialStorage, FileCredentialStorage, MemoryCredentialStorage,
};
pub use error::{Result, TrezorError};
pub use extapp::{AppImage, load};
pub use path::{DerivationPath, PathError, TREZOR_URI_SCHEME, is_trezor_uri};
pub use probe::Protocol;
pub use signer::{MESSAGE_MAX, TrezorSigner};
pub use thp::DeviceProperties;
#[cfg(feature = "emulator")]
pub use transport::UdpTransport;
pub use transport::{PACKET_LEN, Transport, TransportError};
#[cfg(feature = "usb")]
pub use usb::UsbTransport;
