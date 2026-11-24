//! The [`Transport`] abstraction: send one command APDU, receive one response.
//!
//! Implementations: [`crate::hid::HidTransport`] (feature `hid`),
//! [`crate::speculos::SpeculosTransport`] (feature `speculos`), and the mock
//! transports in [`crate::mock`] (feature `mock`).
//!
//! A transport MUST NOT apply a short timeout to an exchange: the response to
//! an APDU that triggers on-device review waits for the user (spec §10.4).

use std::sync::Arc;

use thiserror::Error;

/// A transport-level failure.  After any transport error the operation must be
/// restarted from chunk 0 (spec §10.4); the device client never resumes.
#[derive(Debug, Error)]
pub enum TransportError {
    /// No Ledger device was found.
    #[error("no Ledger device found: connect the device, unlock it and open the Thru app")]
    NoDevice,
    /// I/O failure (TCP, file descriptors).
    #[error("Ledger transport I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// HID library failure.
    #[error("Ledger USB HID error: {0}")]
    Hid(String),
    /// The peer closed the connection or answered with a malformed frame.
    #[error("Ledger transport protocol error: {0}")]
    Framing(String),
    /// The transport has no scripted answer (mock only) or another failure.
    #[error("Ledger transport error: {0}")]
    Other(String),
}

/// Send one command APDU (`CLA INS P1 P2 Lc data`) and return the raw
/// response (`data ‖ SW1 SW2`).
///
/// The trait is object-safe and `Send + Sync`, so a signer can hold a
/// `Box<dyn Transport>`.  Implementations serialize concurrent exchanges
/// internally (a Ledger handles one APDU at a time).
pub trait Transport: Send + Sync {
    /// Exchange one APDU.
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError>;
}

impl<T: Transport + ?Sized> Transport for Box<T> {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        (**self).exchange(command)
    }
}

impl<T: Transport + ?Sized> Transport for Arc<T> {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        (**self).exchange(command)
    }
}

impl<T: Transport + ?Sized> Transport for &T {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        (**self).exchange(command)
    }
}
