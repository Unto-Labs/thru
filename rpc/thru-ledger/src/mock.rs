//! Test transports (feature `mock`).
//!
//! * [`MockTransport`]: a scripted transport that checks each command against
//!   an expected byte sequence and returns a canned response.  Used to test
//!   framing and status-word mapping.
//! * [`SoftDevice`]: a software emulator of the Thru device app that
//!   implements `specs/ledger/app-thru-apdu.md` (path policy, sessions, the
//!   streaming transaction parser of §7.5, the two-pass message flow and EOA
//!   authorization) and signs with SLIP-10 keys derived from a BIP-39 seed.
//!   It is a host-side test double, not the device implementation: it buffers
//!   messages instead of using an Ed25519 stream, but it must agree with the
//!   device on every status word.

use std::collections::VecDeque;
use std::sync::Mutex;

use ed25519_dalek::{Signer as _, SigningKey};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use sha2_10::Sha512;
use thru_base::tn_public_address::tn_pubkey_to_address_string;

use crate::apdu::{Command, Response};
use crate::consts::{
    ACCOUNT_META_SZ, APDU_MAX_DATA, APDU_PROTOCOL_VERSION, APP_FLAG_BLIND_SIGNING, EOA_KIND_CREATE,
    EOA_KIND_DELETE, MSG_DISPLAY_MAX, MSG_MAX, OS_CLA, OS_INS_GET_APP_AND_VERSION, P1_DISPLAY,
    P1_SILENT, P2_LAST, P2_MORE, RW_CACHE_MAX, STATE_PROOF_HDR_SZ, THRU_APP_NAME, THRU_CLA,
    TXN_BODY_MAX, TXN_HDR_SZ, TXN_MAX_ACCOUNTS, ins,
};
use crate::error::sw;
use crate::path::{DerivationPath, PathError};
use crate::transport::{Transport, TransportError};

// ---------------------------------------------------------------------------
// MockTransport
// ---------------------------------------------------------------------------

/// One scripted exchange: optional expected command, then the response.
type ScriptEntry = (Option<Vec<u8>>, Vec<u8>);

/// A scripted transport.  Each exchange pops the next `(expected, response)`
/// pair; if `expected` is `Some`, the command must match it exactly.
#[derive(Default)]
pub struct MockTransport {
    script: Mutex<VecDeque<ScriptEntry>>,
    sent: Mutex<Vec<Vec<u8>>>,
}

impl MockTransport {
    /// Empty script.
    pub fn new() -> Self {
        Self::default()
    }

    /// Expect exactly `command` next and answer `response` (`data ‖ SW`).
    pub fn expect(&self, command: impl Into<Vec<u8>>, response: impl Into<Vec<u8>>) -> &Self {
        self.script
            .lock()
            .unwrap()
            .push_back((Some(command.into()), response.into()));
        self
    }

    /// Answer `response` to whatever is sent next.
    pub fn respond(&self, response: impl Into<Vec<u8>>) -> &Self {
        self.script
            .lock()
            .unwrap()
            .push_back((None, response.into()));
        self
    }

    /// Answer `data ‖ status` to whatever is sent next.
    pub fn respond_sw(&self, data: &[u8], status: u16) -> &Self {
        self.respond(
            Response {
                data: data.to_vec(),
                sw: status,
            }
            .encode(),
        )
    }

    /// Every command sent so far.
    pub fn sent(&self) -> Vec<Vec<u8>> {
        self.sent.lock().unwrap().clone()
    }

    /// Number of scripted exchanges not yet consumed.
    pub fn remaining(&self) -> usize {
        self.script.lock().unwrap().len()
    }
}

impl Transport for MockTransport {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        self.sent.lock().unwrap().push(command.to_vec());
        let (expected, response) = self
            .script
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| TransportError::Other("mock script exhausted".into()))?;
        if let Some(expected) = expected
            && expected != command
        {
            return Err(TransportError::Other(format!(
                "unexpected command: sent {}, expected {}",
                hex::encode(command),
                hex::encode(&expected)
            )));
        }
        Ok(response)
    }
}

// ---------------------------------------------------------------------------
// SLIP-10
// ---------------------------------------------------------------------------

/// BIP-39 seed of `abandon ×11 about` with an empty passphrase (the corpus and
/// APDU-spec worked-example seed).
pub const ABANDON_SEED_HEX: &str = "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4";

/// SLIP-10 Ed25519 private-key derivation (hardened components only).
pub fn slip10_ed25519(seed: &[u8], components: &[u32]) -> [u8; 32] {
    type HmacSha512 = Hmac<Sha512>;
    let mut mac = HmacSha512::new_from_slice(b"ed25519 seed").expect("any key length");
    mac.update(seed);
    let i = mac.finalize().into_bytes();
    let (mut k, mut c) = ([0u8; 32], [0u8; 32]);
    k.copy_from_slice(&i[..32]);
    c.copy_from_slice(&i[32..]);
    for idx in components {
        let mut mac = HmacSha512::new_from_slice(&c).expect("any key length");
        mac.update(&[0u8]);
        mac.update(&k);
        mac.update(&idx.to_be_bytes());
        let i = mac.finalize().into_bytes();
        k.copy_from_slice(&i[..32]);
        c.copy_from_slice(&i[32..]);
    }
    k
}

// ---------------------------------------------------------------------------
// SoftDevice
// ---------------------------------------------------------------------------

/// What the emulated device showed the user.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Review {
    /// GET_PUBKEY with display.
    Address {
        /// `ta…` address.
        address: String,
        /// Path display string.
        path: String,
    },
    /// SIGN_TXN review (§7.7 values, raw).
    Transaction {
        /// Lowercase hex SHA-256 of the body.
        hash_hex: String,
        /// Chain id.
        chain_id: u16,
        /// Fee.
        fee: u64,
        /// Nonce.
        nonce: u64,
        /// Fee payer address.
        fee_payer: String,
        /// Program address.
        program: String,
        /// rw count.
        rw_cnt: u16,
        /// ro count.
        ro_cnt: u16,
        /// Instruction data size.
        instr_sz: u16,
        /// `Action` for a clear transfer (§7.7), `None` for a blind review.
        action: Option<&'static str>,
        /// `Token mint` (`ta…`) when a token hint proved the accounts.
        token_mint: Option<String>,
    },
    /// SIGN_MESSAGE review.
    Message {
        /// Signer `ta…` address.
        signer: String,
        /// Text mode: the message; hash mode: `None`.
        text: Option<String>,
        /// Lowercase hex SHA-256 of the raw message.
        hash_hex: String,
        /// Message length.
        len: usize,
    },
    /// SIGN_EOA_AUTH review.
    EoaAuth {
        /// 0 = create, 1 = delete.
        kind: u8,
        /// Chain id.
        chain_id: u16,
        /// Fee payer address.
        fee_payer: String,
        /// Account address.
        account: String,
    },
}

/// Emulated device settings.
#[derive(Clone, Copy, Debug)]
pub struct SoftDeviceSettings {
    /// Blind-signing setting.
    pub blind_signing: bool,
    /// Device locked (every APDU returns `0x5515`).
    pub locked: bool,
    /// Thru app open (otherwise the dashboard: Thru INS return `0x6E01`).
    pub app_open: bool,
    /// Reported APDU protocol version.
    pub apdu_protocol_version: u8,
}

impl Default for SoftDeviceSettings {
    fn default() -> Self {
        Self {
            blind_signing: true,
            locked: false,
            app_open: true,
            apdu_protocol_version: APDU_PROTOCOL_VERSION,
        }
    }
}

type Approver = Box<dyn FnMut(&Review) -> bool + Send>;

/// Software emulator of the Thru device app.
pub struct SoftDevice {
    seed: Vec<u8>,
    inner: Mutex<Inner>,
}

struct Inner {
    settings: SoftDeviceSettings,
    session: Session,
    approver: Approver,
    reviews: Vec<Review>,
    log: Vec<Vec<u8>>,
}

enum Session {
    Idle,
    Txn(Box<TxnSession>),
    Msg(Box<MsgSession>),
}

struct TxnSession {
    pubkey: [u8; 32],
    path: DerivationPath,
    expected_p1: u8,
    hasher: Sha256,
    parser: TxnParser,
    /// The streamed body, for the clear-transfer and hint checks.
    body: Vec<u8>,
    /// Chunk-0 token hint without its kind byte (§7.2.1).
    hint: Option<[u8; 128]>,
}

struct MsgSession {
    path: DerivationPath,
    pubkey: [u8; 32],
    msg_len: usize,
    pass2: bool,
    expected_p1: u8,
    buf1: Vec<u8>,
    buf2: Vec<u8>,
}

impl SoftDevice {
    /// Emulator holding `bip39_seed` (64 bytes), approving every review.
    pub fn new(bip39_seed: &[u8]) -> Self {
        Self {
            seed: bip39_seed.to_vec(),
            inner: Mutex::new(Inner {
                settings: SoftDeviceSettings::default(),
                session: Session::Idle,
                approver: Box::new(|_| true),
                reviews: Vec::new(),
                log: Vec::new(),
            }),
        }
    }

    /// Emulator with the `abandon ×11 about` seed (corpus signer keys).
    pub fn abandon() -> Self {
        Self::new(&hex::decode(ABANDON_SEED_HEX).expect("valid hex"))
    }

    /// Change settings.
    pub fn set_settings(&self, settings: SoftDeviceSettings) {
        self.inner.lock().unwrap().settings = settings;
    }

    /// Current settings.
    pub fn settings(&self) -> SoftDeviceSettings {
        self.inner.lock().unwrap().settings
    }

    /// Decide approvals with `f` (return `true` to approve).
    pub fn set_approver(&self, f: impl FnMut(&Review) -> bool + Send + 'static) {
        self.inner.lock().unwrap().approver = Box::new(f);
    }

    /// Every review shown so far.
    pub fn reviews(&self) -> Vec<Review> {
        self.inner.lock().unwrap().reviews.clone()
    }

    /// Every command APDU received so far.
    pub fn apdu_log(&self) -> Vec<Vec<u8>> {
        self.inner.lock().unwrap().log.clone()
    }

    /// The private seed for `path` (SLIP-10).
    pub fn private_seed(&self, path: &DerivationPath) -> [u8; 32] {
        slip10_ed25519(&self.seed, path.components())
    }

    /// The public key for `path`.
    pub fn pubkey(&self, path: &DerivationPath) -> [u8; 32] {
        SigningKey::from_bytes(&self.private_seed(path))
            .verifying_key()
            .to_bytes()
    }

    fn sign(&self, path: &DerivationPath, m: &[u8]) -> [u8; 64] {
        SigningKey::from_bytes(&self.private_seed(path))
            .sign(m)
            .to_bytes()
    }

    /// Process one command APDU and return `data ‖ SW`.
    pub fn process(&self, raw: &[u8]) -> Vec<u8> {
        let mut inner = self.inner.lock().unwrap();
        inner.log.push(raw.to_vec());
        let resp = match self.dispatch(&mut inner, raw) {
            Ok(data) => Response { data, sw: sw::OK },
            Err(code) => {
                inner.session = Session::Idle;
                Response {
                    data: Vec::new(),
                    sw: code,
                }
            }
        };
        resp.encode()
    }

    fn dispatch(&self, inner: &mut Inner, raw: &[u8]) -> Result<Vec<u8>, u16> {
        if inner.settings.locked {
            return Err(sw::OS_LOCKED);
        }
        let cmd = Command::decode(raw).ok_or(sw::WRONG_DATA_LENGTH)?;
        if cmd.cla == OS_CLA && cmd.ins == OS_INS_GET_APP_AND_VERSION {
            // Handled by the OS: the app never sees it, so a session survives
            // (§10.2).
            let (name, ver): (&str, &str) = if inner.settings.app_open {
                (THRU_APP_NAME, "1.0.0")
            } else {
                ("BOLOS", "2.2.3")
            };
            let mut out = vec![1u8, name.len() as u8];
            out.extend_from_slice(name.as_bytes());
            out.push(ver.len() as u8);
            out.extend_from_slice(ver.as_bytes());
            out.extend_from_slice(&[1, 0]);
            return Ok(out);
        }
        if !inner.settings.app_open {
            return Err(sw::OS_WRONG_APP_6E01);
        }
        if cmd.cla != THRU_CLA {
            inner.session = Session::Idle;
            return Err(sw::CLA_NOT_SUPPORTED);
        }
        // A different INS aborts any session (§10.2).
        let session_ins = match &inner.session {
            Session::Idle => None,
            Session::Txn(_) => Some(ins::SIGN_TXN),
            Session::Msg(_) => Some(ins::SIGN_MESSAGE),
        };
        if session_ins.is_some_and(|i| i != cmd.ins) {
            inner.session = Session::Idle;
        }
        match cmd.ins {
            ins::GET_VERSION | ins::GET_APP_NAME | ins::GET_APP_CONFIG => {
                if cmd.p1 != 0 || cmd.p2 != 0 {
                    return Err(sw::WRONG_P1P2);
                }
                if !cmd.data.is_empty() {
                    return Err(sw::WRONG_DATA_LENGTH);
                }
                Ok(match cmd.ins {
                    ins::GET_VERSION => vec![1, 0, 0],
                    ins::GET_APP_NAME => THRU_APP_NAME.as_bytes().to_vec(),
                    _ => vec![
                        if inner.settings.blind_signing {
                            APP_FLAG_BLIND_SIGNING
                        } else {
                            0
                        },
                        1,
                        0,
                        0,
                        inner.settings.apdu_protocol_version,
                    ],
                })
            }
            ins::GET_PUBKEY => self.get_pubkey(inner, &cmd),
            ins::SIGN_TXN => self.sign_txn(inner, &cmd),
            ins::SIGN_MESSAGE => self.sign_message(inner, &cmd),
            ins::SIGN_EOA_AUTH => self.sign_eoa(inner, &cmd),
            _ => Err(sw::INS_NOT_SUPPORTED),
        }
    }

    fn get_pubkey(&self, inner: &mut Inner, cmd: &Command) -> Result<Vec<u8>, u16> {
        if (cmd.p1 != P1_SILENT && cmd.p1 != P1_DISPLAY) || cmd.p2 != 0 {
            return Err(sw::WRONG_P1P2);
        }
        let path = parse_path_exact(&cmd.data, 0)?;
        let pk = self.pubkey(&path);
        if cmd.p1 == P1_DISPLAY {
            review(
                inner,
                Review::Address {
                    address: tn_pubkey_to_address_string(&pk),
                    path: path.to_string(),
                },
            )?;
        }
        Ok(pk.to_vec())
    }

    fn sign_txn(&self, inner: &mut Inner, cmd: &Command) -> Result<Vec<u8>, u16> {
        if cmd.p1 == 0 {
            inner.session = Session::Idle;
            if cmd.p2 != P2_MORE {
                return Err(sw::WRONG_P1P2);
            }
            /* §7.3: total length (the path, or the path plus a 129-byte hint),
            then the path policy, then the hint kind.  No blind-signing gate
            before the instruction is known. */
            let path_len = 1 + 4 * *cmd.data.first().ok_or(sw::WRONG_DATA_LENGTH)? as usize;
            let extra = cmd
                .data
                .len()
                .checked_sub(path_len)
                .ok_or(sw::WRONG_DATA_LENGTH)?;
            if extra != 0 && extra != HINT_LEN {
                return Err(sw::WRONG_DATA_LENGTH);
            }
            let path = parse_path_exact(&cmd.data, extra)?;
            let hint = match cmd.data.get(path_len..) {
                Some([0x01, rest @ ..]) => {
                    Some(<[u8; 128]>::try_from(rest).map_err(|_| sw::WRONG_DATA_LENGTH)?)
                }
                Some([]) | None => None,
                Some(_) => return Err(sw::TXN_HINT_INVALID),
            };
            let pubkey = self.pubkey(&path);
            inner.session = Session::Txn(Box::new(TxnSession {
                pubkey,
                path,
                expected_p1: 1,
                hasher: Sha256::new(),
                parser: TxnParser::new(pubkey),
                body: Vec::new(),
                hint,
            }));
            return Ok(Vec::new());
        }
        let Session::Txn(s) = &mut inner.session else {
            return Err(sw::CHUNK_OUT_OF_ORDER);
        };
        if s.expected_p1 != cmd.p1 {
            return Err(sw::CHUNK_OUT_OF_ORDER);
        }
        if cmd.p2 != P2_MORE && cmd.p2 != P2_LAST {
            return Err(sw::WRONG_P1P2);
        }
        if cmd.data.is_empty() || cmd.data.len() > APDU_MAX_DATA {
            return Err(sw::WRONG_DATA_LENGTH);
        }
        for &b in &cmd.data {
            s.parser.feed(b)?;
        }
        s.hasher.update(&cmd.data);
        s.body.extend_from_slice(&cmd.data);
        if cmd.p2 == P2_MORE {
            if s.parser.is_done() {
                return Err(sw::TXN_INVALID_FORMAT);
            }
            s.expected_p1 = s.expected_p1.checked_add(1).ok_or(sw::CHUNK_OUT_OF_ORDER)?;
            return Ok(Vec::new());
        }
        if !s.parser.is_done() {
            return Err(sw::TXN_INVALID_FORMAT);
        }
        let Session::Txn(s) = std::mem::replace(&mut inner.session, Session::Idle) else {
            unreachable!()
        };
        let h: [u8; 32] = s.hasher.finalize().into();
        let transfer = crate::transfer::decode_clear_transfer(&s.body);
        /* §7.7: a checked token transfer names its mint; a plain one shows a
        mint only from a verified hint. */
        let token_mint = match &s.hint {
            Some(hint) if !hint_proves_token_accounts(&s.body, hint) => {
                return Err(sw::TOKEN_HINT_MISMATCH);
            }
            Some(hint) => Some(tn_pubkey_to_address_string(hint[..32].try_into().unwrap())),
            None => transfer
                .and_then(|t| t.checked)
                .map(|c| tn_pubkey_to_address_string(&c.mint)),
        };
        /* §7.6: only a transaction without a clear transfer needs the setting. */
        if transfer.is_none() && !inner.settings.blind_signing {
            return Err(sw::BLIND_SIGNING_DISABLED);
        }
        let hdr = &s.parser.hdr;
        let u16le = |o: usize| u16::from_le_bytes([hdr[o], hdr[o + 1]]);
        let u64le = |o: usize| u64::from_le_bytes(hdr[o..o + 8].try_into().unwrap());
        review(
            inner,
            Review::Transaction {
                hash_hex: hex::encode(h),
                chain_id: u16le(44),
                fee: u64le(16),
                nonce: u64le(24),
                fee_payer: tn_pubkey_to_address_string(&s.parser.fee_payer),
                program: tn_pubkey_to_address_string(&s.parser.program),
                rw_cnt: u16le(2),
                ro_cnt: u16le(4),
                instr_sz: u16le(6),
                action: transfer.map(|t| t.kind.action()),
                token_mint,
            },
        )?;
        if self.pubkey(&s.path) != s.pubkey {
            return Err(sw::INTERNAL_ERROR);
        }
        let mut m = b"tn_txn_sign_v1__".to_vec();
        m.extend_from_slice(&h);
        Ok(self.sign(&s.path, &m).to_vec())
    }

    fn sign_message(&self, inner: &mut Inner, cmd: &Command) -> Result<Vec<u8>, u16> {
        if cmd.p1 == 0 {
            inner.session = Session::Idle;
            if cmd.p2 != P2_MORE {
                return Err(sw::WRONG_P1P2);
            }
            let path = parse_path_exact(&cmd.data, 4)?;
            let n = cmd.data.len();
            let msg_len = u32::from_be_bytes(cmd.data[n - 4..].try_into().unwrap()) as usize;
            if msg_len == 0 || msg_len > MSG_MAX {
                return Err(sw::MSG_INVALID_LENGTH);
            }
            if msg_len > MSG_DISPLAY_MAX && !inner.settings.blind_signing {
                return Err(sw::BLIND_SIGNING_DISABLED);
            }
            inner.session = Session::Msg(Box::new(MsgSession {
                pubkey: self.pubkey(&path),
                path,
                msg_len,
                pass2: false,
                expected_p1: 1,
                buf1: Vec::new(),
                buf2: Vec::new(),
            }));
            return Ok(Vec::new());
        }
        let Session::Msg(s) = &mut inner.session else {
            return Err(sw::CHUNK_OUT_OF_ORDER);
        };
        if s.expected_p1 != cmd.p1 {
            return Err(sw::CHUNK_OUT_OF_ORDER);
        }
        if cmd.p2 != P2_MORE && cmd.p2 != P2_LAST {
            return Err(sw::WRONG_P1P2);
        }
        if cmd.data.is_empty() || cmd.data.len() > APDU_MAX_DATA {
            return Err(sw::WRONG_DATA_LENGTH);
        }
        let buf = if s.pass2 { &mut s.buf2 } else { &mut s.buf1 };
        if buf.len() + cmd.data.len() > s.msg_len {
            return Err(sw::LENGTH_MISMATCH);
        }
        buf.extend_from_slice(&cmd.data);
        let count = buf.len();
        if (cmd.p2 == P2_MORE && count == s.msg_len) || (cmd.p2 == P2_LAST && count < s.msg_len) {
            return Err(sw::LENGTH_MISMATCH);
        }
        if cmd.p2 == P2_MORE {
            s.expected_p1 = s.expected_p1.checked_add(1).ok_or(sw::CHUNK_OUT_OF_ORDER)?;
            return Ok(Vec::new());
        }
        if !s.pass2 {
            let text_mode = crate::preview::is_text_message(&s.buf1);
            let hash_hex = hex::encode(Sha256::digest(&s.buf1));
            if !text_mode && !inner.settings.blind_signing {
                return Err(sw::BLIND_SIGNING_DISABLED);
            }
            let text = text_mode.then(|| String::from_utf8_lossy(&s.buf1).into_owned());
            let len = s.msg_len;
            let signer = tn_pubkey_to_address_string(&s.pubkey);
            review(
                inner,
                Review::Message {
                    signer,
                    text,
                    hash_hex,
                    len,
                },
            )?;
            let Session::Msg(s) = &mut inner.session else {
                unreachable!()
            };
            s.pass2 = true;
            s.expected_p1 = 1;
            return Ok(Vec::new());
        }
        let Session::Msg(s) = std::mem::replace(&mut inner.session, Session::Idle) else {
            unreachable!()
        };
        if Sha256::digest(&s.buf1) != Sha256::digest(&s.buf2) {
            return Err(sw::MSG_PASS_MISMATCH);
        }
        let mut m = b"tn_msg_sign_v1__".to_vec();
        m.extend_from_slice(&s.buf2);
        Ok(self.sign(&s.path, &m).to_vec())
    }

    fn sign_eoa(&self, inner: &mut Inner, cmd: &Command) -> Result<Vec<u8>, u16> {
        if cmd.p1 != 0 || cmd.p2 != 0 {
            return Err(sw::WRONG_P1P2);
        }
        let path = parse_path_exact(&cmd.data, 67)?;
        let rest = &cmd.data[path.apdu_len()..];
        let kind = rest[0];
        let chain_id = u16::from_le_bytes([rest[1], rest[2]]);
        let fee_payer: [u8; 32] = rest[3..35].try_into().unwrap();
        let account: [u8; 32] = rest[35..67].try_into().unwrap();
        if kind != EOA_KIND_CREATE && kind != EOA_KIND_DELETE {
            return Err(sw::EOA_INVALID_KIND);
        }
        if chain_id == 0 {
            return Err(sw::CHAIN_ID_ZERO);
        }
        if account != self.pubkey(&path) {
            return Err(sw::EOA_ACCOUNT_MISMATCH);
        }
        review(
            inner,
            Review::EoaAuth {
                kind,
                chain_id,
                fee_payer: tn_pubkey_to_address_string(&fee_payer),
                account: tn_pubkey_to_address_string(&account),
            },
        )?;
        let mut m: Vec<u8> = if kind == EOA_KIND_CREATE {
            b"tn_eoa_create_v1".to_vec()
        } else {
            b"tn_eoa_delete_v1".to_vec()
        };
        m.extend_from_slice(&chain_id.to_le_bytes());
        m.extend_from_slice(&fee_payer);
        m.extend_from_slice(&account);
        Ok(self.sign(&path, &m).to_vec())
    }
}

fn review(inner: &mut Inner, r: Review) -> Result<(), u16> {
    let ok = (inner.approver)(&r);
    inner.reviews.push(r);
    if ok { Ok(()) } else { Err(sw::USER_DENIED) }
}

/// §7.2.1 token hint after the chunk-0 path: kind `0x01`, then four 32-byte fields.
const HINT_LEN: usize = 129;

/// §7.6/§7.7: does `hint` (the 128 bytes after the kind) prove the body's
/// token accounts?  Written from the spec, independently of `token_hint.rs`.
fn hint_proves_token_accounts(body: &[u8], hint: &[u8; 128]) -> bool {
    let Some(t) = crate::transfer::decode_clear_transfer(body) else {
        return false;
    };
    if t.kind != crate::transfer::TransferKind::Token {
        return false;
    }
    let mint = &hint[..32];
    /* A checked token transfer names its own mint; the hint must name it too. */
    if t.checked.is_some_and(|c| c.mint[..] != *mint) {
        return false;
    }
    let derive = |owner: &[u8], seed: &[u8]| -> [u8; 32] {
        let inner: [u8; 32] = Sha256::new()
            .chain_update(owner)
            .chain_update(mint)
            .chain_update(seed)
            .finalize()
            .into();
        Sha256::new()
            .chain_update(thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES)
            .chain_update([0u8])
            .chain_update(inner)
            .finalize()
            .into()
    };
    t.source == derive(&body[48..80], &hint[96..128])
        && t.recipient == derive(&hint[32..64], &hint[64..96])
}

/// Parse a path occupying exactly `data.len() - extra` bytes at the start of
/// `data` (§4.2 length and policy rules).
fn parse_path_exact(data: &[u8], extra: usize) -> Result<DerivationPath, u16> {
    let depth = *data.first().ok_or(sw::WRONG_DATA_LENGTH)? as usize;
    if data.len() != 1 + 4 * depth + extra {
        return Err(sw::WRONG_DATA_LENGTH);
    }
    match DerivationPath::from_apdu_bytes(data) {
        Ok((p, _)) => Ok(p),
        Err(PathError::Truncated) => Err(sw::WRONG_DATA_LENGTH),
        Err(_) => Err(sw::PATH_REJECTED),
    }
}

impl Transport for SoftDevice {
    fn exchange(&self, command: &[u8]) -> Result<Vec<u8>, TransportError> {
        Ok(self.process(command))
    }
}

// ---------------------------------------------------------------------------
// Streaming transaction parser (§7.5)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PState {
    Header,
    Rw,
    Ro,
    Instr,
    ProofHdr,
    ProofBody,
    Meta,
    Done,
}

/// Byte-at-a-time envelope parser with the §7.5 checks in stream order.
struct TxnParser {
    device_key: [u8; 32],
    state: PState,
    /// Bytes left in the current state.
    left: usize,
    /// Running body length.
    offset: usize,
    hdr: Vec<u8>,
    key: Vec<u8>,
    proof_hdr: Vec<u8>,
    flags: u8,
    rw_cnt: usize,
    ro_cnt: usize,
    instr_sz: usize,
    fixed_len: usize,
    fee_payer: [u8; 32],
    program: [u8; 32],
    prev: Option<[u8; 32]>,
    rw_cache: Vec<[u8; 32]>,
    cursor: usize,
    proof_type: u8,
}

impl TxnParser {
    fn new(device_key: [u8; 32]) -> Self {
        Self {
            device_key,
            state: PState::Header,
            left: TXN_HDR_SZ,
            offset: 0,
            hdr: Vec::with_capacity(TXN_HDR_SZ),
            key: Vec::with_capacity(32),
            proof_hdr: Vec::with_capacity(STATE_PROOF_HDR_SZ),
            flags: 0,
            rw_cnt: 0,
            ro_cnt: 0,
            instr_sz: 0,
            fixed_len: 0,
            fee_payer: [0; 32],
            program: [0; 32],
            prev: None,
            rw_cache: Vec::new(),
            cursor: 0,
            proof_type: 0,
        }
    }

    fn is_done(&self) -> bool {
        self.state == PState::Done
    }

    /// Move to the first non-empty state at or after `from`.
    fn enter(&mut self, from: PState) {
        let mut st = from;
        loop {
            let len = match st {
                PState::Rw => 32 * self.rw_cnt,
                PState::Ro => 32 * self.ro_cnt,
                PState::Instr => self.instr_sz,
                PState::ProofHdr => {
                    if self.flags & 1 != 0 {
                        STATE_PROOF_HDR_SZ
                    } else {
                        0
                    }
                }
                PState::ProofBody => {
                    if self.flags & 1 != 0 {
                        let pop: u32 = self.proof_hdr[8..40].iter().map(|b| b.count_ones()).sum();
                        (self.proof_type as usize + pop as usize) * 32
                    } else {
                        0
                    }
                }
                PState::Meta => {
                    if self.flags & 1 != 0 && self.proof_type == 0 {
                        ACCOUNT_META_SZ
                    } else {
                        0
                    }
                }
                PState::Header | PState::Done => {
                    self.state = PState::Done;
                    self.left = 0;
                    return;
                }
            };
            if len > 0 {
                self.state = st;
                self.left = len;
                self.prev = None;
                return;
            }
            st = match st {
                PState::Rw => PState::Ro,
                PState::Ro => PState::Instr,
                PState::Instr => PState::ProofHdr,
                PState::ProofHdr => PState::ProofBody,
                PState::ProofBody => PState::Meta,
                _ => PState::Done,
            };
        }
    }

    fn feed(&mut self, b: u8) -> Result<(), u16> {
        if self.state == PState::Done {
            return Err(sw::TXN_INVALID_FORMAT);
        }
        self.offset += 1;
        if self.offset > TXN_BODY_MAX {
            return Err(sw::TXN_INVALID_FORMAT);
        }
        self.left -= 1;
        match self.state {
            PState::Header => {
                self.hdr.push(b);
                match self.hdr.len() {
                    1 if b != 1 => return Err(sw::TXN_INVALID_VERSION),
                    2 if b & 0xFC != 0 => return Err(sw::TXN_INVALID_FLAGS),
                    TXN_HDR_SZ => self.header_done()?,
                    _ => {}
                }
            }
            PState::Rw | PState::Ro => {
                self.key.push(b);
                if self.key.len() == 32 {
                    let k: [u8; 32] = self.key[..].try_into().unwrap();
                    self.key.clear();
                    self.account_done(k)?;
                }
                if self.left == 0 {
                    let next = if self.state == PState::Rw {
                        PState::Ro
                    } else {
                        PState::Instr
                    };
                    self.enter(next);
                }
            }
            PState::Instr | PState::ProofBody | PState::Meta => {
                if self.left == 0 {
                    let next = match self.state {
                        PState::Instr => PState::ProofHdr,
                        PState::ProofBody => PState::Meta,
                        _ => PState::Done,
                    };
                    self.enter(next);
                }
            }
            PState::ProofHdr => {
                self.proof_hdr.push(b);
                if self.left == 0 {
                    self.proof_type = self.proof_hdr[7] >> 6;
                    if self.proof_type != 0 && self.proof_type != 2 {
                        return Err(sw::TXN_INVALID_PROOF_TYPE);
                    }
                    let pop: usize = self.proof_hdr[8..40]
                        .iter()
                        .map(|x| x.count_ones() as usize)
                        .sum();
                    let body = (self.proof_type as usize + pop) * 32;
                    let meta = if self.proof_type == 0 {
                        ACCOUNT_META_SZ
                    } else {
                        0
                    };
                    if self.fixed_len + body + meta > TXN_BODY_MAX {
                        return Err(sw::TXN_INVALID_FORMAT);
                    }
                    self.enter(PState::ProofBody);
                }
            }
            PState::Done => unreachable!(),
        }
        Ok(())
    }

    fn header_done(&mut self) -> Result<(), u16> {
        let h = &self.hdr;
        let u16le = |o: usize| u16::from_le_bytes([h[o], h[o + 1]]) as usize;
        self.flags = h[1];
        self.rw_cnt = u16le(2);
        self.ro_cnt = u16le(4);
        self.instr_sz = u16le(6);
        let chain_id = u16le(44);
        let pad = u16le(46);
        self.fee_payer = h[48..80].try_into().unwrap();
        self.program = h[80..112].try_into().unwrap();
        if chain_id == 0 {
            return Err(sw::CHAIN_ID_ZERO);
        }
        if pad != 0 {
            return Err(sw::TXN_PAD_NONZERO);
        }
        if self.fee_payer != self.device_key {
            return Err(sw::FEE_PAYER_MISMATCH);
        }
        if self.fee_payer == self.program {
            return Err(sw::TXN_DUPLICATE_ACCOUNT);
        }
        self.fixed_len = TXN_HDR_SZ
            + 32 * (self.rw_cnt + self.ro_cnt)
            + self.instr_sz
            + if self.flags & 1 != 0 {
                STATE_PROOF_HDR_SZ
            } else {
                0
            };
        if self.fixed_len > TXN_BODY_MAX {
            return Err(sw::TXN_INVALID_FORMAT);
        }
        if 2 + self.rw_cnt + self.ro_cnt > TXN_MAX_ACCOUNTS {
            return Err(sw::TXN_ACCOUNT_LIMIT);
        }
        if self.rw_cnt > RW_CACHE_MAX && self.ro_cnt > 0 {
            return Err(sw::TXN_RW_CACHE_EXCEEDED);
        }
        self.enter(PState::Rw);
        Ok(())
    }

    fn account_done(&mut self, k: [u8; 32]) -> Result<(), u16> {
        let rw = self.state == PState::Rw;
        if let Some(prev) = self.prev {
            if prev == k {
                return Err(sw::TXN_DUPLICATE_ACCOUNT);
            }
            if prev > k {
                return Err(if rw {
                    sw::TXN_UNSORTED_RW
                } else {
                    sw::TXN_UNSORTED_RO
                });
            }
        }
        if k == self.fee_payer || k == self.program {
            return Err(sw::TXN_DUPLICATE_ACCOUNT);
        }
        if rw {
            if self.ro_cnt > 0 {
                self.rw_cache.push(k);
            }
        } else {
            while self.cursor < self.rw_cache.len() && self.rw_cache[self.cursor] < k {
                self.cursor += 1;
            }
            if self.cursor < self.rw_cache.len() && self.rw_cache[self.cursor] == k {
                return Err(sw::TXN_DUPLICATE_ACCOUNT);
            }
        }
        self.prev = Some(k);
        Ok(())
    }
}
