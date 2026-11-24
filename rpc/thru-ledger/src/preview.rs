//! Host-side review preview (`specs/ledger/app-thru-apdu.md` §7.7, §8.6,
//! §9.4, §11.3 and Appendix B).
//!
//! Before the device asks the user to approve, the host must be able to show
//! the same field values the device shows, formatted the same way, so the user
//! can compare them.  A canonical native, token or wallet transfer is shown in
//! clear (action, source, recipient, amount); everything else is shown blind,
//! and instruction data, account keys, flags and resource units are covered
//! only by the displayed **Transaction hash**, so the host's copy of that hash
//! is the user's only binding between what they asked for and what the device
//! signs.
//!
//! Every preview here is computed from the exact bytes that are then streamed
//! to the device ([`crate::LedgerSigner`] builds it from the same slice it
//! passes to SIGN_TXN / SIGN_MESSAGE).  The formatters mirror Appendix B and
//! the device app's `review.rs`; [`TransactionPreview::fields`] and
//! [`MessagePreview::fields`] return the device's labels in the device's
//! order.

use std::borrow::Cow;

use sha2::{Digest, Sha256};
use thru_base::bootstrap_addresses as programs;
use thru_base::signer::EoaAuthKind;
use thru_base::tn_public_address::tn_pubkey_to_address_string;

use crate::consts::{FEE_WARN_THRESHOLD, MSG_DISPLAY_MAX, MSG_MAX, THRU_DECIMALS, TXN_HDR_SZ};
use crate::error::{LedgerError, RequestReject, TxnReject};
use crate::token_hint::{TokenHint, TokenIdentity, verify_token_hint};
use crate::transfer::{
    CheckedToken, ClearTransfer, TOKEN_DECIMALS_MAX, TransferKind, decode_clear_transfer,
};

/// A base-unit amount with `decimals` fractional digits (at most 19), with no
/// thousands separators and trailing fractional zeros removed
/// (`1500000, 6 -> "1.5"`).
pub fn format_amount(base_units: u64, decimals: u32) -> String {
    assert!(
        decimals <= u32::from(TOKEN_DECIMALS_MAX),
        "{decimals} decimals"
    );
    let scale = 10u64.pow(decimals);
    let int = base_units / scale;
    let frac = base_units % scale;
    if frac == 0 {
        return int.to_string();
    }
    let digits = format!("{frac:0width$}", width = decimals as usize);
    format!("{int}.{}", digits.trim_end_matches('0'))
}

/// B.2: a base-unit amount as THRU (`"0.001 THRU"`, `"1.5 THRU"`).
pub fn format_thru_amount(base_units: u64) -> String {
    format!("{} THRU", format_amount(base_units, THRU_DECIMALS))
}

/// B.7: the amount of a checked token transfer in whole units (`"1.5"`). The
/// ticker is never appended: it is shown in its own `Ticker` field, because a
/// mint's creator chooses it and could make it read as part of the number.
pub fn format_token_amount(base_units: u64, token: &CheckedToken) -> String {
    format_amount(base_units, u32::from(token.decimals))
}

/// B.3: the network label for a chain id.
pub fn network_label(chain_id: u16) -> String {
    match chain_id {
        1 => "alphanet".to_string(),
        2 => "betanet".to_string(),
        other => format!("chain id {other}"),
    }
}

/// B.5: the known-program label, matched by exact 32-byte equality.  The
/// table comes from `thru_base::bootstrap_addresses`, the source the device
/// table is generated from.
pub fn known_program_label(program: &[u8; 32]) -> Option<&'static str> {
    const TABLE: [(&str, [u8; 32]); 5] = [
        ("EOA", programs::EOA_PROGRAM_BYTES),
        ("Token", programs::TOKEN_PROGRAM_BYTES),
        ("Multicall", programs::MULTICALL_PROGRAM_BYTES),
        ("Wallet", programs::WALLET_PROGRAM_BYTES),
        ("Compression", programs::COMPRESSION_PROGRAM_BYTES),
    ];
    TABLE
        .iter()
        .find(|(_, bytes)| bytes == program)
        .map(|(label, _)| *label)
}

/// B.4: 64 lowercase hex characters.
pub fn hash_hex(hash: &[u8; 32]) -> String {
    hex::encode(hash)
}

/// The last slot at which the node can execute a transaction whose window is
/// `start_slot <= slot < expiry_slot` (`tn_txn_check_expiry`), or `None` if
/// the window is empty (`expiry_after == 0`, or `start_slot == u64::MAX`).
pub fn last_valid_slot(start_slot: u64, expiry_slot: u64) -> Option<u64> {
    if expiry_slot > start_slot {
        expiry_slot.checked_sub(1)
    } else {
        None
    }
}

/// §7.7 row 6 `Valid slots`: `"<start_slot> to <last valid slot>"`, the
/// inclusive range of slots at which the node can execute the transaction,
/// or `"none"` (mirrors the device's `format_valid_slots`).
pub fn format_valid_slots(start_slot: u64, last_valid_slot: Option<u64>) -> String {
    match last_valid_slot {
        Some(last) => format!("{start_slot} to {last}"),
        None => "none".to_string(),
    }
}

/// The text of the device's `High fee` warning (§7.7 row 4).
pub fn high_fee_warning() -> String {
    format!("Fee is above {}", format_thru_amount(FEE_WARN_THRESHOLD))
}

/// The §7.7 transaction review, as the device will show it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionPreview {
    /// Raw chain id.
    pub chain_id: u16,
    /// `Network` (B.3).
    pub network: String,
    /// Raw fee payer key.
    pub fee_payer_key: [u8; 32],
    /// `Fee payer` (`ta…`).
    pub fee_payer: String,
    /// Raw program key.
    pub program_key: [u8; 32],
    /// Program `ta…` address.
    pub program_address: String,
    /// B.5 label, if the program is a known one.
    pub program_label: Option<&'static str>,
    /// `Program`, exactly as the device shows it: `"<label> / <address>"` for
    /// a known program, otherwise the address.
    pub program: String,
    /// Fee in base units.
    pub fee_base_units: u64,
    /// `Fee` (B.2).
    pub fee: String,
    /// `High fee` warning text when `fee > FEE_WARN_THRESHOLD`.
    pub high_fee_warning: Option<String>,
    /// `Nonce`.
    pub nonce: u64,
    /// Start slot.
    pub start_slot: u64,
    /// `sat_add(start_slot, expiry_after)` (`tn_txn_get_expiry_slot`): the
    /// first slot at which the node rejects the transaction as expired.
    pub expiry_slot: u64,
    /// Last slot at which the node can execute the transaction (the node
    /// window is `start_slot <= slot < expiry_slot`, `tn_txn_check_expiry`);
    /// `None` when that window is empty.
    pub last_valid_slot: Option<u64>,
    /// `Valid slots`: `"<start> to <last valid slot>"`, or `"none"`.
    pub valid_slots: String,
    /// Read-write account count.
    pub rw_cnt: u16,
    /// Read-only account count.
    pub ro_cnt: u16,
    /// `Accounts`: `"<rw> read-write, <ro> read-only"`.
    pub accounts: String,
    /// Instruction data size.
    pub instr_sz: u16,
    /// `Instruction data`: `"<n> bytes"`.
    pub instruction_data: String,
    /// `Transaction hash`: lowercase hex SHA-256 of the body (B.4).
    pub transaction_hash: String,
    /// Length of the body the hash covers.
    pub body_len: usize,
    /// The transfer the device reviews in clear, or `None` for a
    /// blind-signed transaction.
    pub transfer: Option<ClearTransfer>,
    /// Mint and owners shown for a token transfer with a verified hint.
    pub token_identity: Option<TokenIdentity>,
    /// `transfer.is_none()`: the device shows Ledger's blind-signing review
    /// and needs the app's blind-signing setting.
    pub requires_blind_signing: bool,
}

impl TransactionPreview {
    /// Validate `body` with the host pre-validation (§11.1 step 3) and build
    /// the preview from those exact bytes.
    pub fn from_body(body: &[u8]) -> Result<Self, LedgerError> {
        crate::signer::precheck_body(body)?;
        Self::from_header_unchecked(body)
    }

    /// [`Self::from_body`] for the token hint that will be sent: the device's
    /// hinted token review, or `InvalidRequest(TokenHint)` when the device
    /// would refuse the hint.
    pub fn from_body_with_hint(body: &[u8], hint: Option<&TokenHint>) -> Result<Self, LedgerError> {
        let mut preview = Self::from_body(body)?;
        if let Some(hint) = hint {
            preview.apply_token_hint(body, hint)?;
        }
        Ok(preview)
    }

    /// Show `body` with `hint` (§7.2.1), as the device does when the hint
    /// proves both token accounts.
    pub fn apply_token_hint(&mut self, body: &[u8], hint: &TokenHint) -> Result<(), LedgerError> {
        self.token_identity = Some(verify_token_hint(body, hint)?);
        Ok(())
    }

    /// Build the preview without the account-layout validation (for bodies
    /// the caller has already validated, or to show what a device-only reject
    /// would have displayed).  Only the header length is checked.
    pub fn from_header_unchecked(body: &[u8]) -> Result<Self, LedgerError> {
        if body.len() < TXN_HDR_SZ {
            return Err(LedgerError::InvalidTransaction(TxnReject::InvalidFormat));
        }
        let u16le = |o: usize| u16::from_le_bytes([body[o], body[o + 1]]);
        let u32le = |o: usize| u32::from_le_bytes([body[o], body[o + 1], body[o + 2], body[o + 3]]);
        let u64le = |o: usize| {
            let mut b = [0u8; 8];
            b.copy_from_slice(&body[o..o + 8]);
            u64::from_le_bytes(b)
        };
        let key = |o: usize| {
            let mut k = [0u8; 32];
            k.copy_from_slice(&body[o..o + 32]);
            k
        };
        let rw_cnt = u16le(2);
        let ro_cnt = u16le(4);
        let instr_sz = u16le(6);
        let fee_base_units = u64le(16);
        let nonce = u64le(24);
        let start_slot = u64le(32);
        let expiry_slot = start_slot.saturating_add(u64::from(u32le(40)));
        let last_valid_slot = last_valid_slot(start_slot, expiry_slot);
        let chain_id = u16le(44);
        let fee_payer_key = key(48);
        let program_key = key(80);
        let program_address = tn_pubkey_to_address_string(&program_key);
        let program_label = known_program_label(&program_key);
        let program = match program_label {
            Some(label) => format!("{label} / {program_address}"),
            None => program_address.clone(),
        };
        let hash: [u8; 32] = Sha256::digest(body).into();
        let transfer = decode_clear_transfer(body);
        Ok(Self {
            chain_id,
            network: network_label(chain_id),
            fee_payer_key,
            fee_payer: tn_pubkey_to_address_string(&fee_payer_key),
            program_key,
            program_address,
            program_label,
            program,
            fee_base_units,
            fee: format_thru_amount(fee_base_units),
            high_fee_warning: (fee_base_units > FEE_WARN_THRESHOLD).then(high_fee_warning),
            nonce,
            start_slot,
            expiry_slot,
            last_valid_slot,
            valid_slots: format_valid_slots(start_slot, last_valid_slot),
            rw_cnt,
            ro_cnt,
            accounts: format!("{rw_cnt} read-write, {ro_cnt} read-only"),
            instr_sz,
            instruction_data: format!("{instr_sz} bytes"),
            transaction_hash: hash_hex(&hash),
            body_len: body.len(),
            transfer,
            token_identity: None,
            requires_blind_signing: transfer.is_none(),
        })
    }

    /// The device's transfer fields (app-thru `review.rs`), shown before the
    /// envelope fields; empty for a blind-signed transaction.
    pub fn transfer_fields(&self) -> Vec<(Cow<'static, str>, String)> {
        let Some(t) = &self.transfer else {
            return Vec::new();
        };
        let token = self
            .token_identity
            .filter(|_| t.kind == TransferKind::Token);
        let mut out = vec![
            ("Action".into(), t.kind.action().to_string()),
            (
                "Source".into(),
                tn_pubkey_to_address_string(&token.map_or(t.source, |id| id.source_owner)),
            ),
            (
                "Recipient".into(),
                tn_pubkey_to_address_string(&token.map_or(t.recipient, |id| id.recipient_owner)),
            ),
        ];
        if let Some(checked) = &t.checked {
            // The transaction names the mint and binds the decimals and ticker.
            out.push(("Amount".into(), format_token_amount(t.amount, checked)));
            if !checked.ticker().is_empty() {
                out.push(("Ticker".into(), checked.ticker().to_string()));
            }
            out.push((
                "Token mint".into(),
                tn_pubkey_to_address_string(&checked.mint),
            ));
            let owners = if token.is_some() {
                "Token account owners"
            } else {
                "Token accounts"
            };
            out.push(("Address type".into(), owners.to_string()));
        } else if t.kind == TransferKind::Token {
            out.push(("Amount (base units)".into(), t.amount.to_string()));
            match token {
                Some(id) => {
                    out.push(("Token mint".into(), tn_pubkey_to_address_string(&id.mint)));
                    out.push(("Address type".into(), "Token account owners".to_string()));
                }
                None => {
                    out.push(("Address type".into(), "Token accounts".to_string()));
                    out.push((
                        "Token identity".into(),
                        "Not provided by transaction".to_string(),
                    ));
                }
            }
        } else {
            out.push(("Amount".into(), format_thru_amount(t.amount)));
        }
        if let Some(index) = t.authority_index {
            out.push(("Authority index".into(), index.to_string()));
        }
        out
    }

    /// The review fields in device order, with the device's labels: the
    /// transfer fields for a clear transfer, then the envelope.  A `High fee`
    /// field follows `Fee` when the fee is above the threshold.
    pub fn fields(&self) -> Vec<(Cow<'static, str>, String)> {
        let mut out = self.transfer_fields();
        out.extend([
            ("Network".into(), self.network.clone()),
            ("Fee payer".into(), self.fee_payer.clone()),
            ("Program".into(), self.program.clone()),
            ("Fee".into(), self.fee.clone()),
        ]);
        if let Some(w) = &self.high_fee_warning {
            out.push(("High fee".into(), w.clone()));
        }
        out.extend([
            ("Nonce".into(), self.nonce.to_string()),
            ("Valid slots".into(), self.valid_slots.clone()),
            ("Accounts".into(), self.accounts.clone()),
            ("Instruction data".into(), self.instruction_data.clone()),
            ("Transaction hash".into(), self.transaction_hash.clone()),
        ]);
        out
    }
}

/// How the device shows a message (§8.4 step 6).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MessageDisplay {
    /// Text mode follows the device's byte-level §8.7 rules, including
    /// unambiguous spaces, at most 16 lines, and the 512-byte bound.
    Text(String),
    /// Hash mode: the device shows the message hash and length, after
    /// Ledger's blind-signing warning.
    Hash,
}

/// The §8.6 message review, as the device will show it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessagePreview {
    /// `Signer` (`ta…`).
    pub signer: String,
    /// Text or hash mode.
    pub display: MessageDisplay,
    /// Lowercase hex SHA-256 of the raw message (no DST); shown as
    /// `Message hash` in hash mode.
    pub message_hash: String,
    /// Message length in bytes (`Length` in hash mode).
    pub len: usize,
}

/// Whether a byte is in the device's printable set (§8.4 step 3, §14 item 5).
pub fn is_display_printable(b: u8) -> bool {
    (0x20..=0x7E).contains(&b) || b == 0x0A
}

/// Device-independent text eligibility (§8.7). Keep the software device and
/// host preview on the same rule as the device parser's `is_text_message`.
/// The CLI applies it to Trezor keys too, which sign only messages that pass
/// it, so a message the Trezor would refuse is refused before it connects.
pub fn is_text_message(message: &[u8]) -> bool {
    if message.is_empty() || message.len() > MSG_DISPLAY_MAX {
        return false;
    }
    let mut lines = 1usize;
    let mut previous = None;
    let mut alternating = 0usize;
    for &byte in message {
        if !is_display_printable(byte) {
            return false;
        }
        if byte == b'\n' {
            if previous == Some(b' ') {
                return false;
            }
            lines += 1;
            if lines > 16 {
                return false;
            }
            previous = None;
            alternating = 0;
            continue;
        }
        if byte == b' ' {
            if !previous.is_some_and(|b| (b'!'..=b'~').contains(&b)) {
                return false;
            }
            alternating += 1;
        } else {
            alternating = if previous == Some(b' ') {
                alternating + 1
            } else {
                1
            };
            if alternating > 9 {
                return false;
            }
        }
        previous = Some(byte);
    }
    previous != Some(b' ')
}

impl MessagePreview {
    /// Build the preview for `message` signed by `signer`.  Fails for an
    /// empty message or one above `MSG_MAX` (the device refuses both).
    pub fn new(signer: &[u8; 32], message: &[u8]) -> Result<Self, LedgerError> {
        if message.is_empty() || message.len() > MSG_MAX {
            return Err(LedgerError::InvalidRequest(RequestReject::MessageLength));
        }
        let text_mode = is_text_message(message);
        let display = if text_mode {
            // Printable ASCII and LF only, so this is lossless.
            MessageDisplay::Text(message.iter().map(|&b| b as char).collect())
        } else {
            MessageDisplay::Hash
        };
        let hash: [u8; 32] = Sha256::digest(message).into();
        Ok(Self {
            signer: tn_pubkey_to_address_string(signer),
            display,
            message_hash: hash_hex(&hash),
            len: message.len(),
        })
    }

    /// Whether the device will use hash mode (and so needs blind signing).
    pub fn is_hash_mode(&self) -> bool {
        matches!(self.display, MessageDisplay::Hash)
    }

    /// The review fields in device order, with the device's labels.
    pub fn fields(&self) -> Vec<(Cow<'static, str>, String)> {
        match &self.display {
            MessageDisplay::Text(text) => {
                let line_count = text.bytes().filter(|&b| b == b'\n').count() + 1;
                let mut fields = Vec::with_capacity(line_count + 1);
                fields.push(("Signer".into(), self.signer.clone()));
                for (index, line) in text.split('\n').enumerate() {
                    let label = if line_count == 1 {
                        Cow::Borrowed("Message")
                    } else if line.is_empty() {
                        Cow::Owned(format!("Line {} (empty)", index + 1))
                    } else {
                        Cow::Owned(format!("Line {}", index + 1))
                    };
                    fields.push((label, line.to_owned()));
                }
                fields
            }
            MessageDisplay::Hash => vec![
                ("Signer".into(), self.signer.clone()),
                ("Message hash".into(), self.message_hash.clone()),
                ("Length".into(), format!("{} bytes", self.len)),
            ],
        }
    }
}

/// The §9.4 EOA authorization review (clear-signed).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EoaAuthPreview {
    /// `Authorize account creation` / `Authorize account deletion`.
    pub title: &'static str,
    /// `Network` (B.3).
    pub network: String,
    /// `Account` (`ta…`).
    pub account: String,
    /// `Fee payer` (`ta…`).
    pub fee_payer: String,
}

impl EoaAuthPreview {
    /// Build the preview of an EOA authorization request.
    pub fn new(kind: EoaAuthKind, chain_id: u16, fee_payer: &[u8; 32], account: &[u8; 32]) -> Self {
        Self {
            title: match kind {
                EoaAuthKind::Create => "Authorize account creation",
                EoaAuthKind::Delete => "Authorize account deletion",
            },
            network: network_label(chain_id),
            account: tn_pubkey_to_address_string(account),
            fee_payer: tn_pubkey_to_address_string(fee_payer),
        }
    }

    /// The review fields in device order.
    pub fn fields(&self) -> Vec<(Cow<'static, str>, String)> {
        vec![
            ("Network".into(), self.network.clone()),
            ("Account".into(), self.account.clone()),
            ("Fee payer".into(), self.fee_payer.clone()),
        ]
    }
}

/// A preview of whatever the device is about to ask the user to approve.
#[derive(Clone, Debug, PartialEq, Eq)]
// One preview is built per signing request; boxing the large variant would
// only complicate matching for callers.
#[allow(clippy::large_enum_variant)]
pub enum Preview {
    /// SIGN_TXN.
    Transaction(TransactionPreview),
    /// SIGN_MESSAGE.
    Message(MessagePreview),
    /// SIGN_EOA_AUTH.
    EoaAuth(EoaAuthPreview),
}

impl Preview {
    /// The device review title.
    pub fn title(&self) -> &'static str {
        match self {
            Preview::Transaction(_) => "Review transaction",
            Preview::Message(_) => "Sign message",
            Preview::EoaAuth(p) => p.title,
        }
    }

    /// The review fields in device order, with the device's labels.
    pub fn fields(&self) -> Vec<(Cow<'static, str>, String)> {
        match self {
            Preview::Transaction(p) => p.fields(),
            Preview::Message(p) => p.fields(),
            Preview::EoaAuth(p) => p.fields(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thru_amounts_match_appendix_b2() {
        for (v, s) in [
            (0u64, "0 THRU"),
            (1, "0.000000001 THRU"),
            (1000, "0.000001 THRU"),
            (1_000_000, "0.001 THRU"),
            (1_500_000_000, "1.5 THRU"),
            (1_000_000_000, "1 THRU"),
            (1_000_000_010, "1.00000001 THRU"),
            (u64::MAX, "18446744073.709551615 THRU"),
        ] {
            assert_eq!(format_thru_amount(v), s, "v={v}");
        }
    }

    #[test]
    fn token_amounts_match_appendix_b7() {
        let token = |decimals, ticker: &[u8]| CheckedToken::new([7; 32], decimals, ticker).unwrap();
        for (v, t, s) in [
            (1_500_000u64, token(6, b"USDC"), "1.5"),
            (250_000, token(6, b"USDC"), "0.25"),
            (1_000_000, token(6, b"USDC"), "1"),
            (0, token(6, b"USDC"), "0"),
            (1_500_000, token(9, b""), "0.0015"),
            (1_500_000, token(0, b"ABCDEFGH"), "1500000"),
            (u64::MAX, token(19, b"MAX"), "1.8446744073709551615"),
            (u64::MAX, token(0, b"MAX"), "18446744073709551615"),
        ] {
            assert_eq!(format_token_amount(v, &t), s, "v={v}");
        }
        // Not shown: too many decimals, a long, spaced or unprintable ticker.
        for (decimals, ticker) in [
            (20, &b"USDC"[..]),
            (6, b"ABCDEFGHI"),
            (6, b"US C"),
            (6, b"US\0C"),
            (6, b"\x7f"),
        ] {
            assert_eq!(
                CheckedToken::new([7; 32], decimals, ticker),
                None,
                "{ticker:?}"
            );
        }
    }

    /// A checked transfer shows the ticker in its own field after `Amount`,
    /// and no `Ticker` field when the ticker is empty.
    #[test]
    fn checked_transfer_shows_the_ticker_in_its_own_field() {
        let labels = |ticker: &[u8]| {
            let mut p = TransactionPreview::from_header_unchecked(&header(
                0,
                1,
                programs::TOKEN_PROGRAM_BYTES,
            ))
            .unwrap();
            p.transfer = Some(ClearTransfer {
                kind: TransferKind::Token,
                source: [1; 32],
                recipient: [2; 32],
                amount: 1_000_000,
                authority_index: None,
                checked: CheckedToken::new([3; 32], 6, ticker),
            });
            p.transfer_fields()
                .into_iter()
                .map(|(label, value)| format!("{label}={value}"))
                .collect::<Vec<_>>()
        };
        let mint = tn_pubkey_to_address_string(&[3; 32]);
        let with = labels(b"000USD");
        assert_eq!(
            &with[3..6],
            ["Amount=1", "Ticker=000USD", &format!("Token mint={mint}")]
        );
        let without = labels(b"");
        assert_eq!(&without[3..5], ["Amount=1", &format!("Token mint={mint}")]);
        assert!(!without.iter().any(|f| f.starts_with("Ticker=")));
    }

    /// §7.7 row 6 (amended for A-016): the node accepts
    /// `start_slot <= slot < expiry_slot`, so the shown range ends at
    /// `expiry_slot - 1`, and an empty window is `none`.
    #[test]
    fn valid_slots_follow_the_node_window() {
        let shown = |start: u64, after: u64| {
            format_valid_slots(start, last_valid_slot(start, start.saturating_add(after)))
        };
        assert_eq!(shown(100, 100), "100 to 199");
        assert_eq!(shown(100, 1), "100 to 100");
        assert_eq!(shown(100, 0), "none");
        assert_eq!(shown(u64::MAX, 5), "none");
        assert_eq!(
            shown(u64::MAX - 1, 5),
            format!("{} to {}", u64::MAX - 1, u64::MAX - 1)
        );
        assert_eq!(
            shown(0, u64::from(u32::MAX)),
            format!("0 to {}", u32::MAX - 1)
        );
    }

    #[test]
    fn network_labels_match_appendix_b3() {
        assert_eq!(network_label(1), "alphanet");
        assert_eq!(network_label(2), "betanet");
        assert_eq!(network_label(3), "chain id 3");
        assert_eq!(network_label(65535), "chain id 65535");
    }

    /// The B.5 program labels and addresses agree with the bootstrap programs.
    #[test]
    fn known_program_labels_match_appendix_b5() {
        for (label, addr, key) in [
            (
                "EOA",
                programs::EOA_PROGRAM_ADDRESS,
                programs::EOA_PROGRAM_BYTES,
            ),
            (
                "Token",
                programs::TOKEN_PROGRAM_ADDRESS,
                programs::TOKEN_PROGRAM_BYTES,
            ),
            (
                "Multicall",
                programs::MULTICALL_PROGRAM_ADDRESS,
                programs::MULTICALL_PROGRAM_BYTES,
            ),
            (
                "Wallet",
                programs::WALLET_PROGRAM_ADDRESS,
                programs::WALLET_PROGRAM_BYTES,
            ),
            (
                "Compression",
                programs::COMPRESSION_PROGRAM_ADDRESS,
                programs::COMPRESSION_PROGRAM_BYTES,
            ),
        ] {
            assert_eq!(known_program_label(&key), Some(label));
            assert_eq!(tn_pubkey_to_address_string(&key), addr);
        }
        assert_eq!(known_program_label(&[0u8; 32]), None);
        assert_eq!(known_program_label(&programs::MANAGER_PROGRAM_BYTES), None);
    }

    fn header(fee: u64, chain_id: u16, program: [u8; 32]) -> Vec<u8> {
        let mut b = vec![0u8; TXN_HDR_SZ];
        b[0] = 1;
        b[2..4].copy_from_slice(&2u16.to_le_bytes());
        b[4..6].copy_from_slice(&1u16.to_le_bytes());
        b[6..8].copy_from_slice(&13u16.to_le_bytes());
        b[16..24].copy_from_slice(&fee.to_le_bytes());
        b[24..32].copy_from_slice(&7u64.to_le_bytes());
        b[32..40].copy_from_slice(&(u64::MAX - 5).to_le_bytes());
        b[40..44].copy_from_slice(&100u32.to_le_bytes());
        b[44..46].copy_from_slice(&chain_id.to_le_bytes());
        b[48..80].copy_from_slice(&[0xA2; 32]);
        b[80..112].copy_from_slice(&program);
        b
    }

    #[test]
    fn transaction_fields_follow_the_device_order() {
        let body = header(1_500_000_000, 2, programs::TOKEN_PROGRAM_BYTES);
        let p = TransactionPreview::from_header_unchecked(&body).unwrap();
        assert_eq!(p.network, "betanet");
        assert_eq!(
            p.program,
            format!("Token / {}", programs::TOKEN_PROGRAM_ADDRESS)
        );
        assert_eq!(p.fee, "1.5 THRU");
        // Saturating expiry, as tn_txn_get_expiry_slot; the shown range ends
        // at the last slot the node accepts (expiry_slot - 1).
        assert_eq!(p.expiry_slot, u64::MAX);
        assert_eq!(
            p.valid_slots,
            format!("{} to {}", u64::MAX - 5, u64::MAX - 1)
        );
        assert_eq!(p.accounts, "2 read-write, 1 read-only");
        assert_eq!(p.instruction_data, "13 bytes");
        assert_eq!(p.transaction_hash, hex::encode(Sha256::digest(&body)));
        assert_eq!(p.transaction_hash.len(), 64);
        assert!(
            p.transaction_hash
                .bytes()
                .all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
        );

        // At the threshold there is no warning; unknown program shows only
        // the address.
        let p =
            TransactionPreview::from_header_unchecked(&header(FEE_WARN_THRESHOLD, 1, [0x55; 32]))
                .unwrap();
        assert!(p.high_fee_warning.is_none());
        assert_eq!(p.program, p.program_address);

        assert!(matches!(
            TransactionPreview::from_header_unchecked(&[1u8; 111]),
            Err(LedgerError::InvalidTransaction(TxnReject::InvalidFormat))
        ));
    }

    #[test]
    fn message_mode_rejects_ambiguous_spaces_and_excess_lines() {
        let pk = [0xA2; 32];
        for message in [
            &b" leading"[..],
            b"trailing ",
            b"two  spaces",
            b"line \nnext",
            b"line\n next",
            b"a b c d e f",
        ] {
            assert!(MessagePreview::new(&pk, message).unwrap().is_hash_mode());
        }
        for message in [&b"a b c d e"[..], b"hello world", b"\nhello\n\n"] {
            assert!(!MessagePreview::new(&pk, message).unwrap().is_hash_mode());
        }
        assert!(
            !MessagePreview::new(&pk, &[b'\n'; 15])
                .unwrap()
                .is_hash_mode()
        );
        assert!(
            MessagePreview::new(&pk, &[b'\n'; 16])
                .unwrap()
                .is_hash_mode()
        );
    }

    #[test]
    fn message_modes_follow_section_8_4() {
        let pk = [0xA2; 32];
        let p = MessagePreview::new(&pk, b"hello\nworld").unwrap();
        assert_eq!(p.display, MessageDisplay::Text("hello\nworld".into()));
        assert!(!p.is_hash_mode());
        // CR, TAB and non-ASCII force hash mode (§14 item 5).
        for m in [&b"a\rb"[..], b"a\tb", "caf\u{e9}".as_bytes(), &[0u8]] {
            assert!(MessagePreview::new(&pk, m).unwrap().is_hash_mode(), "{m:?}");
        }
        // Longer than MSG_DISPLAY_MAX: hash mode even if printable.
        let long = vec![b'a'; MSG_DISPLAY_MAX + 1];
        let p = MessagePreview::new(&pk, &long).unwrap();
        assert!(p.is_hash_mode());
        assert_eq!(
            p.fields(),
            vec![
                ("Signer".into(), tn_pubkey_to_address_string(&pk)),
                ("Message hash".into(), hex::encode(Sha256::digest(&long))),
                ("Length".into(), format!("{} bytes", MSG_DISPLAY_MAX + 1)),
            ]
        );
        assert!(
            !MessagePreview::new(&pk, &vec![b'a'; MSG_DISPLAY_MAX])
                .unwrap()
                .is_hash_mode()
        );
        assert!(MessagePreview::new(&pk, b"").is_err());
        assert!(MessagePreview::new(&pk, &vec![b'a'; MSG_MAX + 1]).is_err());
    }
}
