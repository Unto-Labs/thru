//! USB transport for a Trezor Safe 7: 64-byte packets over the WebUSB
//! interface of the firmware, through the pure-Rust `nusb` crate (no libusb).
//!
//! The protocol interface is interface 0 (vendor class), with interrupt
//! endpoints OUT `0x01` and IN `0x81`. This is the interface the Python host
//! (`trezorlib`, `transport/webusb.py`) uses.
//!
//! Operating system notes:
//!
//! - macOS: no driver or entitlement is needed. If Trezor Suite or `trezord`
//!   holds the interface, claiming it fails with a "busy" error.
//! - Linux: a udev rule must give the user access to `1209:53c1`. The vendor
//!   class interface has no kernel driver, so nothing is detached (`nusb`'s
//!   `detach_and_claim_interface` is deliberately not used).
//! - Windows: the interface must be bound to the WinUSB driver, which the
//!   firmware requests through its Microsoft OS descriptors. If Windows
//!   lists the same device twice (a known quirk when it also knows the device
//!   as HID), this module reports [`TransportError::Ambiguous`].

use std::time::Duration;

use nusb::descriptors::TransferType;
use nusb::transfer::{Buffer, In, Interrupt, Out, TransferError};
use nusb::{Device, DeviceInfo, Endpoint, ErrorKind, Interface, MaybeFuture};

use crate::transport::{PACKET_LEN, Transport, TransportError};

/// USB vendor id of SatoshiLabs devices.
const VENDOR_ID: u16 = 0x1209;
/// Product id of Trezor firmware: the mode this transport talks to.
const PRODUCT_ID_FIRMWARE: u16 = 0x53C1;
/// Product id of the Trezor bootloader: not usable here.
const PRODUCT_ID_BOOTLOADER: u16 = 0x53C0;

/// The protocol interface.
const INTERFACE: u8 = 0;
/// Interrupt OUT endpoint of the protocol interface.
const ENDPOINT_OUT: u8 = 0x01;
/// Interrupt IN endpoint of the protocol interface.
const ENDPOINT_IN: u8 = 0x81;
/// Interface class "vendor specific".
const CLASS_VENDOR: u8 = 0xFF;

/// How long one packet write may take before it is given up as failed.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// A Trezor firmware reached over USB.
///
/// Dropping it cancels any pending transfer and releases interface 0.
pub struct UsbTransport {
    // Field order is drop order: the endpoints go first, then the interface
    // is released, then the device is closed.
    ep_in: Endpoint<Interrupt, In>,
    ep_out: Endpoint<Interrupt, Out>,
    _interface: Interface,
    _device: Device,
}

impl UsbTransport {
    /// Finds the one Trezor in firmware mode, claims its protocol interface
    /// and opens the packet endpoints.
    ///
    /// Fails with [`TransportError::NotFound`] if there is no such device (or
    /// only one in bootloader mode), and with [`TransportError::Ambiguous`]
    /// if there is more than one.
    pub fn open() -> Result<Self, TransportError> {
        let devices: Vec<DeviceInfo> = nusb::list_devices()
            .wait()
            .map_err(|e| io_error("listing USB devices", &e))?
            .collect();
        let ids: Vec<(u16, u16)> = devices
            .iter()
            .map(|d| (d.vendor_id(), d.product_id()))
            .collect();
        let info = &devices[pick(&ids)?];

        let device = info
            .open()
            .wait()
            .map_err(|e| io_error("opening the device", &e))?;
        let interface = device
            .claim_interface(INTERFACE)
            .wait()
            .map_err(|e| io_error("claiming USB interface 0", &e))?;
        check_interface(&interface)?;
        let ep_out = interface
            .endpoint::<Interrupt, Out>(ENDPOINT_OUT)
            .map_err(|e| io_error("opening endpoint 0x01", &e))?;
        let ep_in = interface
            .endpoint::<Interrupt, In>(ENDPOINT_IN)
            .map_err(|e| io_error("opening endpoint 0x81", &e))?;
        Ok(UsbTransport {
            ep_in,
            ep_out,
            _interface: interface,
            _device: device,
        })
    }
}

impl Transport for UsbTransport {
    fn write_packet(&mut self, packet: &[u8]) -> Result<(), TransportError> {
        if packet.len() != PACKET_LEN {
            return Err(TransportError::Io(format!(
                "packet is {} bytes, expected {PACKET_LEN}",
                packet.len()
            )));
        }
        let mut buffer = Buffer::new(PACKET_LEN);
        buffer.extend_from_slice(packet);
        // Nothing is ever left pending on the OUT endpoint, so the transfer
        // is always the only one. On timeout it is cancelled and reaped.
        let completion = self.ep_out.transfer_blocking(buffer, WRITE_TIMEOUT);
        match completion.status {
            Ok(()) if completion.actual_len == PACKET_LEN => Ok(()),
            Ok(()) => Err(TransportError::Io(format!(
                "USB write sent {} of {PACKET_LEN} bytes",
                completion.actual_len
            ))),
            Err(TransferError::Cancelled) => Err(TransportError::Io(format!(
                "USB write timed out after {WRITE_TIMEOUT:?}"
            ))),
            Err(e) => Err(transfer_error("USB write", e)),
        }
    }

    fn read_packet(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, TransportError> {
        // The IN transfer is submitted only when none is pending, and is never
        // cancelled when the wait times out. A packet that arrives after the
        // timeout therefore completes that same transfer, and the next call
        // returns it.
        if self.ep_in.pending() == 0 {
            self.ep_in.submit(Buffer::new(PACKET_LEN));
        }
        let Some(completion) = self.ep_in.wait_next_complete(timeout) else {
            return Ok(None);
        };
        completion
            .status
            .map_err(|e| transfer_error("USB read", e))?;
        if completion.actual_len != PACKET_LEN {
            return Err(TransportError::Io(format!(
                "USB read returned {} bytes, expected {PACKET_LEN}",
                completion.actual_len
            )));
        }
        Ok(Some(completion.buffer.into_vec()))
    }
}

/// Chooses which listed `(vendor id, product id)` pair to use.
///
/// Returns its index, or the error for none, a bootloader only, or several.
fn pick(ids: &[(u16, u16)]) -> Result<usize, TransportError> {
    let mut firmware = ids
        .iter()
        .enumerate()
        .filter(|(_, id)| **id == (VENDOR_ID, PRODUCT_ID_FIRMWARE))
        .map(|(index, _)| index);
    let first = firmware.next();
    if firmware.next().is_some() {
        return Err(TransportError::Ambiguous);
    }
    if let Some(index) = first {
        return Ok(index);
    }
    if ids.contains(&(VENDOR_ID, PRODUCT_ID_BOOTLOADER)) {
        return Err(TransportError::NotFound(
            "the Trezor is in bootloader mode; reconnect it to start the firmware".into(),
        ));
    }
    Err(TransportError::NotFound(
        "no Trezor (USB 1209:53c1) is connected".into(),
    ))
}

/// Checks from the descriptors that the claimed interface is the vendor-class
/// protocol interface with the expected 64-byte interrupt endpoints.
fn check_interface(interface: &Interface) -> Result<(), TransportError> {
    let bad = |what: String| TransportError::Io(format!("unexpected USB layout: {what}"));
    let Some(descriptor) = interface.descriptor() else {
        return Err(bad("interface 0 has no descriptor".into()));
    };
    if descriptor.class() != CLASS_VENDOR {
        return Err(bad(format!(
            "interface 0 has class {:#04x}, expected vendor class {CLASS_VENDOR:#04x}",
            descriptor.class()
        )));
    }
    for address in [ENDPOINT_OUT, ENDPOINT_IN] {
        let Some(endpoint) = descriptor.endpoints().find(|e| e.address() == address) else {
            return Err(bad(format!("endpoint {address:#04x} is missing")));
        };
        if endpoint.transfer_type() != TransferType::Interrupt {
            return Err(bad(format!(
                "endpoint {address:#04x} is {:?}, expected interrupt",
                endpoint.transfer_type()
            )));
        }
        if endpoint.max_packet_size() != PACKET_LEN {
            return Err(bad(format!(
                "endpoint {address:#04x} has packet size {}, expected {PACKET_LEN}",
                endpoint.max_packet_size()
            )));
        }
    }
    Ok(())
}

/// Turns an `nusb` error into an `Io` error with a hint for the common causes.
fn io_error(context: &str, e: &nusb::Error) -> TransportError {
    let hint = match e.kind() {
        ErrorKind::Busy => " (another program uses the Trezor; close Trezor Suite or the bridge)",
        ErrorKind::PermissionDenied => {
            " (permission denied; on Linux install the Trezor udev rules)"
        }
        ErrorKind::Disconnected => " (the Trezor was disconnected)",
        _ => "",
    };
    TransportError::Io(format!("{context}: {e}{hint}"))
}

/// Turns a failed USB transfer into an `Io` error.
fn transfer_error(context: &str, e: TransferError) -> TransportError {
    let text = match e {
        TransferError::Cancelled => "cancelled".to_string(),
        TransferError::Stall => "endpoint stalled".to_string(),
        TransferError::Disconnected => "the Trezor was disconnected".to_string(),
        TransferError::Fault => "hardware fault or protocol violation".to_string(),
        TransferError::InvalidArgument => "invalid argument".to_string(),
        other => format!("{other:?}"),
    };
    TransportError::Io(format!("{context}: {text}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FW: (u16, u16) = (VENDOR_ID, PRODUCT_ID_FIRMWARE);
    const BL: (u16, u16) = (VENDOR_ID, PRODUCT_ID_BOOTLOADER);

    #[test]
    fn picks_the_only_firmware() {
        assert!(matches!(pick(&[(0x1234, 0x5678), FW]), Ok(1)));
    }

    #[test]
    fn nothing_is_not_found() {
        assert!(matches!(
            pick(&[(0x1234, 0x5678)]),
            Err(TransportError::NotFound(_))
        ));
    }

    #[test]
    fn bootloader_says_so() {
        match pick(&[BL]) {
            Err(TransportError::NotFound(text)) => assert!(text.contains("bootloader")),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn two_firmwares_are_ambiguous() {
        assert!(matches!(pick(&[FW, FW]), Err(TransportError::Ambiguous)));
    }
}
