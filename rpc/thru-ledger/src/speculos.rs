//! Speculos emulator transport (feature `speculos`).
//!
//! Speculos exposes a raw APDU server (default TCP port 9999, `--apdu-port`).
//! Framing, as used by Ledger's `ledgercomm` / `ragger` TCP clients:
//!
//! * request: `u32 big-endian length ‖ command APDU`;
//! * response: `u32 big-endian length of the data ‖ data ‖ SW1 SW2` (the
//!   length excludes the 2-byte status word).
//!
//! Button presses / screen taps are driven separately through the Speculos
//! REST API (default port 5000); this transport only moves APDUs.  Reads have
//! no timeout because the response to a review APDU waits for the (automated)
//! user.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

use crate::transport::{Transport, TransportError};

/// Default Speculos APDU port.
pub const DEFAULT_APDU_PORT: u16 = 9999;

/// Environment variable naming the Speculos APDU port for integration tests.
pub const ENV_APDU_PORT: &str = "SPECULOS_APDU_PORT";

/// A TCP connection to the Speculos APDU server.
pub struct SpeculosTransport {
    stream: Mutex<TcpStream>,
}

impl SpeculosTransport {
    /// Connect to `addr` (for example `127.0.0.1:9999`).
    pub fn connect(addr: impl ToSocketAddrs) -> Result<Self, TransportError> {
        let mut last = None;
        for a in addr.to_socket_addrs()? {
            match TcpStream::connect_timeout(&a, Duration::from_secs(5)) {
                Ok(stream) => {
                    stream.set_nodelay(true)?;
                    return Ok(Self {
                        stream: Mutex::new(stream),
                    });
                }
                Err(e) => last = Some(e),
            }
        }
        Err(last.map(TransportError::Io).unwrap_or_else(|| {
            TransportError::Other("Speculos address resolved to nothing".into())
        }))
    }

    /// Connect to `127.0.0.1:<port>`.
    pub fn connect_local(port: u16) -> Result<Self, TransportError> {
        Self::connect(("127.0.0.1", port))
    }
}

/// Write one framed request.
pub fn write_frame(w: &mut impl Write, command: &[u8]) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(4 + command.len());
    buf.extend_from_slice(&(command.len() as u32).to_be_bytes());
    buf.extend_from_slice(command);
    w.write_all(&buf)?;
    w.flush()
}

/// Read one framed response and return `data ‖ SW`.
pub fn read_frame(r: &mut impl Read) -> Result<Vec<u8>, TransportError> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len > 0x1_0000 {
        return Err(TransportError::Framing(format!(
            "response length {len} is implausible"
        )));
    }
    let mut out = vec![0u8; len + 2];
    r.read_exact(&mut out)?;
    Ok(out)
}

impl Transport for SpeculosTransport {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        let mut stream = self.stream.lock().unwrap_or_else(|e| e.into_inner());
        write_frame(&mut *stream, command)?;
        read_frame(&mut *stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_round_trip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, &[0xE0, 0x03, 0, 0, 0]).unwrap();
        assert_eq!(buf, vec![0, 0, 0, 5, 0xE0, 0x03, 0, 0, 0]);

        let resp = [0u8, 0, 0, 3, 1, 0, 0, 0x90, 0x00];
        let got = read_frame(&mut &resp[..]).unwrap();
        assert_eq!(got, vec![1, 0, 0, 0x90, 0x00]);

        let err_only = [0u8, 0, 0, 0, 0x69, 0x85];
        assert_eq!(read_frame(&mut &err_only[..]).unwrap(), vec![0x69, 0x85]);

        assert!(read_frame(&mut &[0u8, 0, 0, 3, 1][..]).is_err());
    }

    /// End-to-end over a real socket against a tiny in-process server.
    #[test]
    fn exchange_over_tcp() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            for _ in 0..2 {
                let mut len = [0u8; 4];
                s.read_exact(&mut len).unwrap();
                let mut cmd = vec![0u8; u32::from_be_bytes(len) as usize];
                s.read_exact(&mut cmd).unwrap();
                // echo INS as data, then 9000
                s.write_all(&[0, 0, 0, 1, cmd[1], 0x90, 0x00]).unwrap();
            }
        });
        let t = SpeculosTransport::connect_local(port).unwrap();
        assert_eq!(
            t.exchange(&[0xE0, 0x04, 0, 0, 0]).unwrap(),
            vec![4, 0x90, 0]
        );
        assert_eq!(
            t.exchange(&[0xE0, 0x05, 0, 0, 0]).unwrap(),
            vec![5, 0x90, 0]
        );
        server.join().unwrap();
    }
}
