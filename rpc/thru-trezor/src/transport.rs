//! Packet transports: how 64-byte Trezor Host Protocol packets reach the
//! device.

use std::time::Duration;

/// Length of every packet on USB and UDP.
pub const PACKET_LEN: usize = 64;

/// A transport failure.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    /// No device (or emulator) to talk to.
    #[error("no Trezor found: {0}")]
    NotFound(String),
    /// More than one device is connected and nothing says which to use.
    #[error("more than one Trezor is connected; connect only one")]
    Ambiguous,
    /// The connection broke or the operating system refused an operation.
    #[error("Trezor connection: {0}")]
    Io(String),
}

/// Moves whole packets to and from one device.
pub trait Transport {
    /// Sends one packet of [`PACKET_LEN`] bytes.
    fn write_packet(&mut self, packet: &[u8]) -> Result<(), TransportError>;

    /// Waits up to `timeout` for one packet. `Ok(None)` means nothing came.
    fn read_packet(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, TransportError>;

    /// Whether this is the Trezor emulator rather than a device. Only a
    /// transport that cannot reach a device says so (the UDP transport): the
    /// default is `false`, and pairing without a code is allowed on a
    /// transport that answers `true` only.
    fn is_emulator(&self) -> bool {
        false
    }
}

impl<T: Transport + ?Sized> Transport for Box<T> {
    fn write_packet(&mut self, packet: &[u8]) -> Result<(), TransportError> {
        (**self).write_packet(packet)
    }

    fn read_packet(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, TransportError> {
        (**self).read_packet(timeout)
    }

    fn is_emulator(&self) -> bool {
        (**self).is_emulator()
    }
}

#[cfg(feature = "emulator")]
pub use udp::UdpTransport;

#[cfg(feature = "emulator")]
mod udp {
    use super::{PACKET_LEN, Transport, TransportError};
    use std::io::ErrorKind;
    use std::net::UdpSocket;
    use std::time::Duration;

    /// UDP transport of the Trezor emulator (default port 21324). It is not
    /// a device: anything listening on the port is taken for one.
    pub struct UdpTransport {
        socket: UdpSocket,
    }

    impl UdpTransport {
        /// The emulator's default address.
        pub const DEFAULT_ADDR: &'static str = "127.0.0.1:21324";

        /// Connects to the emulator at `addr` (`host:port`) and checks that it
        /// answers.
        pub fn connect(addr: &str) -> Result<Self, TransportError> {
            let io = |e: std::io::Error| TransportError::Io(format!("emulator at {addr}: {e}"));
            let socket = UdpSocket::bind("127.0.0.1:0").map_err(io)?;
            socket.connect(addr).map_err(io)?;
            let transport = UdpTransport { socket };
            if !transport.ping()? {
                return Err(TransportError::NotFound(format!(
                    "no emulator answers at {addr}"
                )));
            }
            Ok(transport)
        }

        /// The emulator answers `PINGPING` with `PONGPONG` outside the protocol.
        fn ping(&self) -> Result<bool, TransportError> {
            let io = |e: std::io::Error| TransportError::Io(e.to_string());
            self.socket.send(b"PINGPING").map_err(io)?;
            self.socket
                .set_read_timeout(Some(Duration::from_millis(500)))
                .map_err(io)?;
            let mut answer = [0u8; PACKET_LEN];
            match self.socket.recv(&mut answer) {
                Ok(len) => Ok(&answer[..len] == b"PONGPONG"),
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::ConnectionRefused
                    ) =>
                {
                    Ok(false)
                }
                Err(e) => Err(io(e)),
            }
        }
    }

    impl Transport for UdpTransport {
        fn is_emulator(&self) -> bool {
            true
        }

        fn write_packet(&mut self, packet: &[u8]) -> Result<(), TransportError> {
            self.socket
                .send(packet)
                .map(|_| ())
                .map_err(|e| TransportError::Io(e.to_string()))
        }

        fn read_packet(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, TransportError> {
            let io = |e: std::io::Error| TransportError::Io(e.to_string());
            // A zero timeout would mean "block for ever" to the socket.
            let timeout = timeout.max(Duration::from_millis(1));
            self.socket.set_read_timeout(Some(timeout)).map_err(io)?;
            let mut packet = vec![0u8; PACKET_LEN];
            match self.socket.recv(&mut packet) {
                Ok(len) => {
                    packet.truncate(len);
                    Ok(Some(packet))
                }
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    Ok(None)
                }
                Err(e) => Err(io(e)),
            }
        }
    }
}
