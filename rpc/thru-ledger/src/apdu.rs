//! APDU framing: command encoding, response decoding, and the request
//! builders for every INS (`specs/ledger/app-thru-apdu.md` §3, §6-§9).
//!
//! These functions are pure: they build the exact byte sequences a host sends
//! and parse what the device returns.  [`crate::device::ThruLedger`] drives
//! them over a [`crate::transport::Transport`].

use crate::consts::{
    APDU_MAX_DATA, APP_FLAG_BLIND_SIGNING, EOA_KIND_CREATE, EOA_KIND_DELETE, MSG_MAX, OS_CLA,
    OS_INS_GET_APP_AND_VERSION, P1_DISPLAY, P1_SILENT, P2_LAST, P2_MORE, THRU_CLA, TXN_BODY_MAX,
    ins,
};
use crate::error::{LedgerError, sw};
use crate::path::DerivationPath;
use thru_base::signer::EoaAuthKind;

/// A command APDU.
#[derive(Clone, PartialEq, Eq)]
pub struct Command {
    /// Class byte.
    pub cla: u8,
    /// Instruction.
    pub ins: u8,
    /// Parameter 1.
    pub p1: u8,
    /// Parameter 2.
    pub p2: u8,
    /// Data (at most [`APDU_MAX_DATA`] bytes).
    pub data: Vec<u8>,
}

impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{:02X} {:02X} {:02X} {:02X} {:02X} {}",
            self.cla,
            self.ins,
            self.p1,
            self.p2,
            self.data.len(),
            hex::encode(&self.data)
        )
    }
}

impl Command {
    /// A Thru (`CLA = 0xE0`) command.
    pub fn thru(ins: u8, p1: u8, p2: u8, data: Vec<u8>) -> Self {
        Self {
            cla: THRU_CLA,
            ins,
            p1,
            p2,
            data,
        }
    }

    /// Serialize as `CLA INS P1 P2 Lc data` (short APDU; `Lc = 0` when empty).
    ///
    /// Returns an error if the data cannot fit in a short APDU.
    pub fn encode(&self) -> Result<Vec<u8>, LedgerError> {
        let len = u8::try_from(self.data.len()).map_err(|_| {
            LedgerError::InvalidInput(format!(
                "APDU data is {} bytes; maximum is {APDU_MAX_DATA}",
                self.data.len()
            ))
        })?;
        let mut out = Vec::with_capacity(5 + self.data.len());
        out.extend_from_slice(&[self.cla, self.ins, self.p1, self.p2, len]);
        out.extend_from_slice(&self.data);
        Ok(out)
    }

    /// Parse a short command APDU.  `Lc` must equal the remaining length.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let (hdr, data) = bytes.split_at_checked(5)?;
        if hdr[4] as usize != data.len() {
            return None;
        }
        Some(Self {
            cla: hdr[0],
            ins: hdr[1],
            p1: hdr[2],
            p2: hdr[3],
            data: data.to_vec(),
        })
    }
}

/// A response APDU.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Response {
    /// Response data (empty for every error, §3.2).
    pub data: Vec<u8>,
    /// Status word.
    pub sw: u16,
}

impl Response {
    /// Split `data ‖ SW1 SW2`.
    pub fn decode(bytes: &[u8]) -> Result<Self, LedgerError> {
        if bytes.len() < 2 {
            return Err(LedgerError::UnexpectedResponse(format!(
                "response of {} bytes has no status word",
                bytes.len()
            )));
        }
        let (data, code) = bytes.split_at(bytes.len() - 2);
        Ok(Self {
            data: data.to_vec(),
            sw: u16::from_be_bytes([code[0], code[1]]),
        })
    }

    /// Serialize as `data ‖ SW1 SW2`.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = self.data.clone();
        out.extend_from_slice(&self.sw.to_be_bytes());
        out
    }

    /// `Ok(data)` on `0x9000`, otherwise the typed error for the status word.
    pub fn into_result(self) -> Result<Vec<u8>, LedgerError> {
        if self.sw == sw::OK {
            Ok(self.data)
        } else {
            Err(LedgerError::from_sw(self.sw))
        }
    }

    /// Like [`Self::into_result`], mapping the status word in the context of
    /// the command's instruction (§5.3).
    pub fn into_result_for(self, ins: u8) -> Result<Vec<u8>, LedgerError> {
        if self.sw == sw::OK {
            Ok(self.data)
        } else {
            Err(LedgerError::from_sw_for(ins, self.sw))
        }
    }
}

/// `E0 03 00 00 00`.
pub fn get_version() -> Command {
    Command::thru(ins::GET_VERSION, 0, 0, Vec::new())
}

/// `E0 04 00 00 00`.
pub fn get_app_name() -> Command {
    Command::thru(ins::GET_APP_NAME, 0, 0, Vec::new())
}

/// `E0 05 00 00 00`.
pub fn get_app_config() -> Command {
    Command::thru(ins::GET_APP_CONFIG, 0, 0, Vec::new())
}

/// OS command `B0 01 00 00 00` (GET_APP_AND_VERSION, §5.2).
pub fn os_get_app_and_version() -> Command {
    Command {
        cla: OS_CLA,
        ins: OS_INS_GET_APP_AND_VERSION,
        p1: 0,
        p2: 0,
        data: Vec::new(),
    }
}

/// GET_PUBKEY (§6.4): P1 = 0 silent, 1 display.
pub fn get_pubkey(path: &DerivationPath, display: bool) -> Command {
    let p1 = if display { P1_DISPLAY } else { P1_SILENT };
    Command::thru(ins::GET_PUBKEY, p1, 0, path.to_apdu_bytes())
}

/// Split `bytes` into data chunks of at most [`APDU_MAX_DATA`] bytes, numbered
/// from P1 = 1, with `P2 = 0x80` on all but the last.
///
/// P1 is a single byte and never wraps (§3.4): a stream that would need a
/// chunk index above 255 is refused instead of silently sending `P1 = 0`
/// (which the device treats as a new session).  With 255-byte chunks this
/// bounds a stream to 65025 bytes, far above `TXN_BODY_MAX` and `MSG_MAX`.
fn data_chunks(ins_code: u8, bytes: &[u8]) -> Result<Vec<Command>, LedgerError> {
    let n = bytes.len().div_ceil(APDU_MAX_DATA);
    if bytes.is_empty() || n > usize::from(u8::MAX) {
        return Err(LedgerError::InvalidInput(format!(
            "a {}-byte stream needs {n} data chunks; P1 allows 1..=255",
            bytes.len()
        )));
    }
    bytes
        .chunks(APDU_MAX_DATA)
        .enumerate()
        .map(|(i, chunk)| {
            let p2 = if i + 1 == n { P2_LAST } else { P2_MORE };
            let p1 = u8::try_from(i + 1).map_err(|_| {
                LedgerError::InvalidInput("chunk index does not fit in P1".to_string())
            })?;
            Ok(Command::thru(ins_code, p1, p2, chunk.to_vec()))
        })
        .collect()
}

/// The full SIGN_TXN (§7.2) command sequence: chunk 0 (path, `P2 = 0x80`), then
/// the body in 255-byte chunks, `P1 = 1..N`, `P2 = 0x00` on chunk N.
///
/// `body` is the transaction **body** (wire bytes without the signature), never
/// `M` or a digest.  It must be `1..=TXN_BODY_MAX` bytes.
pub fn sign_txn(path: &DerivationPath, body: &[u8]) -> Result<Vec<Command>, LedgerError> {
    sign_txn_with_hint(path, body, None)
}

/// [`sign_txn`] with an optional token hint appended to chunk 0 (§7.2.1).
/// The hint is only encoded here; check it against the body with
/// [`crate::verify_token_hint`].
pub fn sign_txn_with_hint(
    path: &DerivationPath,
    body: &[u8],
    hint: Option<&crate::TokenHint>,
) -> Result<Vec<Command>, LedgerError> {
    if body.is_empty() || body.len() > TXN_BODY_MAX {
        return Err(LedgerError::InvalidInput(format!(
            "transaction body is {} bytes; it must be 1..={TXN_BODY_MAX}",
            body.len()
        )));
    }
    let mut chunk0 = path.to_apdu_bytes();
    if let Some(hint) = hint {
        chunk0.extend_from_slice(&hint.encode());
    }
    let mut cmds = vec![Command::thru(ins::SIGN_TXN, 0, P2_MORE, chunk0)];
    cmds.extend(data_chunks(ins::SIGN_TXN, body)?);
    Ok(cmds)
}

/// SIGN_MESSAGE chunk 0 (§8.3): `path ‖ msg_len (u32 big-endian)`, `P2 = 0x80`.
pub fn sign_message_start(path: &DerivationPath, msg_len: usize) -> Result<Command, LedgerError> {
    if msg_len == 0 || msg_len > MSG_MAX {
        return Err(LedgerError::InvalidRequest(
            crate::error::RequestReject::MessageLength,
        ));
    }
    let mut data = path.to_apdu_bytes();
    data.extend_from_slice(&(msg_len as u32).to_be_bytes());
    Ok(Command::thru(ins::SIGN_MESSAGE, 0, P2_MORE, data))
}

/// The chunks of one SIGN_MESSAGE pass (§8.2): `P1 = 1..K`, `P2 = 0x00` on K.
/// Both passes use this same chunking.  `message` must be `1..=MSG_MAX`
/// bytes (the length checked by [`sign_message_start`]).
pub fn sign_message_pass(message: &[u8]) -> Result<Vec<Command>, LedgerError> {
    if message.is_empty() || message.len() > MSG_MAX {
        return Err(LedgerError::InvalidRequest(
            crate::error::RequestReject::MessageLength,
        ));
    }
    data_chunks(ins::SIGN_MESSAGE, message)
}

/// The SIGN_EOA_AUTH `kind` byte.
pub fn eoa_kind_byte(kind: EoaAuthKind) -> u8 {
    match kind {
        EoaAuthKind::Create => EOA_KIND_CREATE,
        EoaAuthKind::Delete => EOA_KIND_DELETE,
    }
}

/// SIGN_EOA_AUTH (§9.1): `path ‖ kind ‖ chain_id (u16 LE) ‖ fee_payer ‖ account`.
pub fn sign_eoa_auth(
    path: &DerivationPath,
    kind: EoaAuthKind,
    chain_id: u16,
    fee_payer: &[u8; 32],
    account: &[u8; 32],
) -> Command {
    let mut data = path.to_apdu_bytes();
    data.push(eoa_kind_byte(kind));
    data.extend_from_slice(&chain_id.to_le_bytes());
    data.extend_from_slice(fee_payer);
    data.extend_from_slice(account);
    Command::thru(ins::SIGN_EOA_AUTH, 0, 0, data)
}

/// App semantic version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppVersion {
    /// Major.
    pub major: u8,
    /// Minor.
    pub minor: u8,
    /// Patch.
    pub patch: u8,
}

impl std::fmt::Display for AppVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// GET_APP_CONFIG response (§6.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppConfig {
    /// Blind-signing setting (flags bit 0).  Advisory: the device re-checks.
    pub blind_signing_enabled: bool,
    /// App version.
    pub version: AppVersion,
    /// APDU protocol version.
    pub apdu_protocol_version: u8,
}

/// Parse a GET_VERSION response.
pub fn parse_version(data: &[u8]) -> Result<AppVersion, LedgerError> {
    match data {
        [major, minor, patch] => Ok(AppVersion {
            major: *major,
            minor: *minor,
            patch: *patch,
        }),
        _ => Err(LedgerError::UnexpectedResponse(format!(
            "GET_VERSION returned {} bytes, expected 3",
            data.len()
        ))),
    }
}

/// Parse a GET_APP_CONFIG response.  Reserved flag bits are ignored.
pub fn parse_app_config(data: &[u8]) -> Result<AppConfig, LedgerError> {
    match data {
        [flags, major, minor, patch, proto] => Ok(AppConfig {
            blind_signing_enabled: flags & APP_FLAG_BLIND_SIGNING != 0,
            version: AppVersion {
                major: *major,
                minor: *minor,
                patch: *patch,
            },
            apdu_protocol_version: *proto,
        }),
        _ => Err(LedgerError::UnexpectedResponse(format!(
            "GET_APP_CONFIG returned {} bytes, expected 5",
            data.len()
        ))),
    }
}

/// Parse a 32-byte GET_PUBKEY response.
pub fn parse_pubkey(data: &[u8]) -> Result<[u8; 32], LedgerError> {
    data.try_into().map_err(|_| {
        LedgerError::UnexpectedResponse(format!(
            "GET_PUBKEY returned {} bytes, expected 32",
            data.len()
        ))
    })
}

/// Parse a 64-byte signature response.
pub fn parse_signature(data: &[u8]) -> Result<[u8; 64], LedgerError> {
    data.try_into().map_err(|_| {
        LedgerError::UnexpectedResponse(format!(
            "signature response has {} bytes, expected 64",
            data.len()
        ))
    })
}

/// Parse the OS GET_APP_AND_VERSION response:
/// `format(=1) ‖ name_len ‖ name ‖ version_len ‖ version [‖ flags_len ‖ flags]`.
/// Returns `(name, version)`.
pub fn parse_app_and_version(data: &[u8]) -> Result<(String, String), LedgerError> {
    let bad = || LedgerError::UnexpectedResponse("malformed GET_APP_AND_VERSION response".into());
    let (&format, rest) = data.split_first().ok_or_else(bad)?;
    if format != 1 {
        return Err(bad());
    }
    let (&name_len, rest) = rest.split_first().ok_or_else(bad)?;
    let (name, rest) = rest.split_at_checked(name_len as usize).ok_or_else(bad)?;
    let (&ver_len, rest) = rest.split_first().ok_or_else(bad)?;
    let (ver, _) = rest.split_at_checked(ver_len as usize).ok_or_else(bad)?;
    Ok((
        String::from_utf8_lossy(name).into_owned(),
        String::from_utf8_lossy(ver).into_owned(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(s: &str) -> Vec<u8> {
        hex::decode(s.replace(' ', "")).unwrap()
    }

    fn path0() -> DerivationPath {
        DerivationPath::new(0).unwrap()
    }

    /// Appendix A.1.
    #[test]
    fn simple_commands() {
        assert_eq!(get_version().encode().unwrap(), h("E0 03 00 00 00"));
        assert_eq!(get_app_name().encode().unwrap(), h("E0 04 00 00 00"));
        assert_eq!(get_app_config().encode().unwrap(), h("E0 05 00 00 00"));
        assert_eq!(
            os_get_app_and_version().encode().unwrap(),
            h("B0 01 00 00 00")
        );
        assert_eq!(parse_version(&h("01 00 00")).unwrap().to_string(), "1.0.0");
        let cfg = parse_app_config(&h("01 01 00 00 01")).unwrap();
        assert!(cfg.blind_signing_enabled);
        assert_eq!(cfg.apdu_protocol_version, 1);
        // reserved flag bits are ignored
        assert!(
            !parse_app_config(&h("FE 01 00 00 01"))
                .unwrap()
                .blind_signing_enabled
        );
        assert!(parse_app_config(&h("01 01 00 00")).is_err());
        assert!(parse_version(&h("01 00")).is_err());
    }

    /// Appendix A.2.
    #[test]
    fn get_pubkey_examples() {
        assert_eq!(
            get_pubkey(&path0(), false).encode().unwrap(),
            h("E0 06 00 00 11 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00")
        );
        assert_eq!(
            get_pubkey(&path0(), true).encode().unwrap(),
            h("E0 06 01 00 11 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00")
        );
        let max = DerivationPath::new(0x7FFF_FFFF).unwrap();
        assert_eq!(
            get_pubkey(&max, false).encode().unwrap(),
            h("E0 06 00 00 11 04 80 00 00 2C 80 00 21 1E FF FF FF FF 80 00 00 00")
        );
        let pk = parse_pubkey(&h(
            "1D65DD4D10F4F8A392D9E17C4D8CDEA7C68E2A3EADC35997BBB6738E39CC0E6E",
        ))
        .unwrap();
        assert_eq!(
            thru_base::tn_public_address::tn_pubkey_to_address_string(&pk),
            "taHWXdTRD0-KOS2eF8TYzep8aOKj6tw1mXu7ZzjjnMDm6A"
        );
    }

    /// Appendix A.3: one data chunk of 112 bytes.
    #[test]
    fn sign_txn_minimal_framing() {
        let body = vec![0xAAu8; 112];
        let cmds = sign_txn(&path0(), &body).unwrap();
        assert_eq!(cmds.len(), 2);
        assert_eq!(
            cmds[0].encode().unwrap(),
            h("E0 07 00 80 11 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00")
        );
        assert_eq!(&cmds[1].encode().unwrap()[..5], &h("E0 07 01 00 70")[..]);
        assert_eq!(&cmds[1].encode().unwrap()[5..], &body[..]);
    }

    /// Appendix A.4: L = 600 → 255, 255, 90.
    #[test]
    fn sign_txn_chunking_600() {
        let body: Vec<u8> = (0..600u32).map(|i| i as u8).collect();
        let cmds = sign_txn(&path0(), &body).unwrap();
        let hdrs: Vec<Vec<u8>> = cmds
            .iter()
            .map(|c| c.encode().unwrap()[..5].to_vec())
            .collect();
        assert_eq!(
            hdrs,
            vec![
                h("E0 07 00 80 11"),
                h("E0 07 01 80 FF"),
                h("E0 07 02 80 FF"),
                h("E0 07 03 00 5A"),
            ]
        );
        let joined: Vec<u8> = cmds[1..].iter().flat_map(|c| c.data.clone()).collect();
        assert_eq!(joined, body);
    }

    #[test]
    fn sign_txn_max_body_is_129_chunks() {
        let body = vec![1u8; TXN_BODY_MAX];
        let cmds = sign_txn(&path0(), &body).unwrap();
        assert_eq!(cmds.len(), 130);
        assert_eq!(cmds[129].p1, 129);
        assert_eq!(cmds[129].p2, 0);
        assert_eq!(cmds[129].data.len(), TXN_BODY_MAX - 128 * 255);
        assert!(cmds.iter().all(|c| c.data.len() <= 255));
        assert!(sign_txn(&path0(), &vec![1u8; TXN_BODY_MAX + 1]).is_err());
        assert!(sign_txn(&path0(), &[]).is_err());
    }

    /// Appendix A.5.
    #[test]
    fn sign_message_hello() {
        assert_eq!(
            sign_message_start(&path0(), 5).unwrap().encode().unwrap(),
            h("E0 08 00 80 15 04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00 00 00 00 05")
        );
        let pass = sign_message_pass(b"hello").unwrap();
        assert_eq!(pass.len(), 1);
        assert_eq!(
            pass[0].encode().unwrap(),
            h("E0 08 01 00 05 68 65 6C 6C 6F")
        );
        assert!(sign_message_start(&path0(), 0).is_err());
        assert!(sign_message_start(&path0(), MSG_MAX + 1).is_err());
        assert!(sign_message_start(&path0(), MSG_MAX).is_ok());
    }

    /// Appendix A.6.
    /// Critic gap (U3/T4): P1 never wraps.  Every planner numbers data
    /// chunks 1..=N with N <= 255, at the size limits and beyond them.
    #[test]
    fn p1_never_wraps() {
        let check = |cmds: &[Command]| {
            for (i, c) in cmds.iter().enumerate() {
                assert_eq!(usize::from(c.p1), i + 1);
                assert!(!c.data.is_empty() && c.data.len() <= APDU_MAX_DATA);
            }
            assert_eq!(cmds.last().unwrap().p2, P2_LAST);
        };
        let msg = sign_message_pass(&vec![b'a'; MSG_MAX]).unwrap();
        assert_eq!(msg.len(), MSG_MAX.div_ceil(APDU_MAX_DATA));
        check(&msg);
        check(&sign_txn(&path0(), &vec![1u8; TXN_BODY_MAX]).unwrap()[1..]);
        // Beyond the limits: refused, never a chunk with P1 = 0.
        assert!(sign_message_pass(&vec![b'a'; MSG_MAX + 1]).is_err());
        assert!(sign_message_pass(&[]).is_err());
        assert!(data_chunks(ins::SIGN_MESSAGE, &vec![0u8; 255 * 255]).is_ok());
        assert!(data_chunks(ins::SIGN_MESSAGE, &vec![0u8; 255 * 255 + 1]).is_err());
        assert!(data_chunks(ins::SIGN_MESSAGE, &vec![0u8; 256 * 255]).is_err());
    }

    #[test]
    fn sign_eoa_auth_create() {
        let fee_payer: [u8; 32] =
            h("546FDB52F2026F707260CF7C9C8FFDACD4C3C05624487893F6426168B5A1EB63")
                .try_into()
                .unwrap();
        let account: [u8; 32] =
            h("1D65DD4D10F4F8A392D9E17C4D8CDEA7C68E2A3EADC35997BBB6738E39CC0E6E")
                .try_into()
                .unwrap();
        let cmd = sign_eoa_auth(&path0(), EoaAuthKind::Create, 1, &fee_payer, &account);
        assert_eq!(
            cmd.encode().unwrap(),
            h("E0 09 00 00 54
               04 80 00 00 2C 80 00 21 1E 80 00 00 00 80 00 00 00
               00
               01 00
               54 6F DB 52 F2 02 6F 70 72 60 CF 7C 9C 8F FD AC
               D4 C3 C0 56 24 48 78 93 F6 42 61 68 B5 A1 EB 63
               1D 65 DD 4D 10 F4 F8 A3 92 D9 E1 7C 4D 8C DE A7
               C6 8E 2A 3E AD C3 59 97 BB B6 73 8E 39 CC 0E 6E"
                .replace('\n', " ")
                .as_str())
        );
        let del = sign_eoa_auth(
            &DerivationPath::new_depth3(0).unwrap(),
            EoaAuthKind::Delete,
            0x1234,
            &fee_payer,
            &account,
        );
        assert_eq!(del.data.len(), 80);
        assert_eq!(del.data[13], 1);
        assert_eq!(&del.data[14..16], &[0x34, 0x12]);
    }

    #[test]
    fn command_and_response_round_trip() {
        let c = get_pubkey(&path0(), true);
        assert_eq!(Command::decode(&c.encode().unwrap()).unwrap(), c);
        assert!(Command::decode(&h("E0 06 00 00 02 01")).is_none());
        let r = Response::decode(&h("01 02 90 00")).unwrap();
        assert_eq!(r.sw, 0x9000);
        assert_eq!(r.data, vec![1, 2]);
        assert_eq!(r.encode(), h("01 02 90 00"));
        assert!(Response::decode(&h("90")).is_err());
        assert!(matches!(
            Response::decode(&h("69 85")).unwrap().into_result(),
            Err(LedgerError::UserRejected)
        ));
    }

    #[test]
    fn app_and_version_parse() {
        let mut data = vec![1, 4];
        data.extend_from_slice(b"Thru");
        data.push(5);
        data.extend_from_slice(b"1.0.0");
        data.extend_from_slice(&[1, 0]);
        assert_eq!(
            parse_app_and_version(&data).unwrap(),
            ("Thru".to_string(), "1.0.0".to_string())
        );
        assert!(parse_app_and_version(&[1, 10, b'x']).is_err());
        assert!(parse_app_and_version(&[2]).is_err());
    }
}
