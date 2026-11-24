//! Canonical transfers the device reviews without blind signing
//! (`specs/ledger/app-thru-apdu.md` §7.7).
//!
//! A port of the device app's `thru-ledger-parser/src/transfer.rs`: any other
//! instruction shape is a blind-signed transaction and needs the app's
//! blind-signing setting.

use thru_base::bootstrap_addresses::{
    EOA_PROGRAM_BYTES, TOKEN_PROGRAM_BYTES, WALLET_PROGRAM_BYTES,
};

use crate::consts::{RO_CACHE_MAX, RW_CACHE_MAX, TXN_HDR_SZ};

/// Size of the ticker field of a checked token transfer.
pub const TICKER_MAX: usize = 8;

/// Most decimals the device shows for a checked token transfer.
pub const TOKEN_DECIMALS_MAX: u8 = 19;

/// The kind of a clear transfer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferKind {
    /// THRU from the fee payer (EOA program Transfer).
    Native,
    /// Token base units between token accounts (token program Transfer, or
    /// TransferChecked when [`ClearTransfer::checked`] is set).
    Token,
    /// THRU from a wallet (wallet program Validate calling its Transfer).
    Wallet,
}

impl TransferKind {
    /// The device's `Action` value.
    pub fn action(self) -> &'static str {
        match self {
            Self::Native => "Native transfer",
            Self::Token => "Token transfer",
            Self::Wallet => "Wallet transfer",
        }
    }
}

/// A transfer the device reviews in clear, with resolved account addresses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClearTransfer {
    /// What moves.
    pub kind: TransferKind,
    /// Debited account (a token account for [`TransferKind::Token`]).
    pub source: [u8; 32],
    /// Credited account (a token account for [`TransferKind::Token`]).
    pub recipient: [u8; 32],
    /// THRU base units, or raw token base units for [`TransferKind::Token`].
    pub amount: u64,
    /// Wallet authority selected by Validate (wallet transfers only).
    pub authority_index: Option<u8>,
    /// The token a checked token transfer moves (TransferChecked only).
    pub checked: Option<CheckedToken>,
}

/// What a checked token transfer names: the mint, and the decimals and ticker
/// the token program checks against it (the transfer reverts unless they
/// match), so the device can show them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CheckedToken {
    /// The mint, one of the first [`RO_CACHE_MAX`] read-only accounts.
    pub mint: [u8; 32],
    /// Decimals of the amount, at most [`TOKEN_DECIMALS_MAX`].
    pub decimals: u8,
    ticker: [u8; TICKER_MAX],
    ticker_len: u8,
}

impl CheckedToken {
    /// A token the device can show: `decimals` ≤ [`TOKEN_DECIMALS_MAX`] and a
    /// ticker of 0 to 8 printable ASCII bytes without space (`0x21..=0x7e`).
    /// `None` otherwise.
    pub fn new(mint: [u8; 32], decimals: u8, ticker: &[u8]) -> Option<Self> {
        if decimals > TOKEN_DECIMALS_MAX
            || ticker.len() > TICKER_MAX
            || !ticker.iter().all(|b| (0x21..=0x7e).contains(b))
        {
            return None;
        }
        let mut field = [0u8; TICKER_MAX];
        field[..ticker.len()].copy_from_slice(ticker);
        Some(Self {
            mint,
            decimals,
            ticker: field,
            ticker_len: ticker.len() as u8,
        })
    }

    /// The ticker: 0 to 8 printable ASCII characters without space.
    pub fn ticker(&self) -> &str {
        // Only printable ASCII is accepted, so this is always UTF-8.
        core::str::from_utf8(&self.ticker[..usize::from(self.ticker_len)]).unwrap_or_default()
    }
}

const EOA_TRANSFER_SZ: usize = 16;
const TOKEN_TRANSFER_SZ: usize = 13;
/// Tag, source, destination, mint, amount, decimals, ticker length, ticker.
const TOKEN_TRANSFER_CHECKED_SZ: usize = 25;
/// Validate tag, wallet, authority, zero signature and WebAuthn lengths, and
/// one 13-byte self-call to Transfer.
const WALLET_TRANSFER_SZ: usize = 95;

fn u16_at(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        data.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32_at(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        data.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn u64_at(data: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        data.get(offset..offset + 8)?.try_into().ok()?,
    ))
}

fn key_at(data: &[u8], offset: usize) -> Option<[u8; 32]> {
    data.get(offset..offset + 32)?.try_into().ok()
}

/// The clear transfer in `body`, or `None` when the device shows the
/// blind-signing review.  Any body is accepted (nothing panics); the result
/// is meaningful for a body that passes the envelope checks.
///
/// * EOA program, 16 bytes: `u32 1`, `u64 amount`, `u16 source = 0`, `u16 recipient`.
/// * Token program, 13 bytes: `u8 2`, `u16 source`, `u16 recipient`, `u64 amount`;
///   both indices ≥ 2.
/// * Token program, 25 bytes (TransferChecked): `u8 8`, `u16 source`,
///   `u16 recipient`, `u16 mint`, `u64 amount`, `u8 decimals`, `u8 ticker_len`,
///   `ticker[8]`; source and recipient ≥ 2; the mint one of the first
///   [`RO_CACHE_MAX`] read-only accounts; `decimals` ≤ [`TOKEN_DECIMALS_MAX`];
///   `ticker_len` ≤ 8, the ticker printable ASCII without space
///   (`0x21..=0x7e`) and zero after `ticker_len`.
/// * Wallet program, 95 bytes: Validate (`u8 1`, `u16 wallet ≥ 2`, `u8 authority`,
///   68 zero bytes of signature and WebAuthn lengths) calling program index 1
///   with a 13-byte Transfer (`u8 2`, `u16 wallet`, `u16 recipient`, `u64 amount`)
///   from the same wallet.
///
/// Both accounts must be writable (the fee payer or a read-write account) and
/// resolve to the fee payer or one of the first [`RW_CACHE_MAX`] read-write
/// accounts.  All integers are little-endian.
pub fn decode_clear_transfer(body: &[u8]) -> Option<ClearTransfer> {
    let rw_cnt = usize::from(u16_at(body, 2)?);
    let ro_cnt = usize::from(u16_at(body, 4)?);
    let instr_sz = usize::from(u16_at(body, 6)?);
    let fee_payer = key_at(body, 48)?;
    let program = key_at(body, 80)?;
    let at = TXN_HDR_SZ + 32 * (rw_cnt + ro_cnt);
    let data = body.get(at..at + instr_sz)?;

    // The device keeps only the first RO_CACHE_MAX read-only keys.
    let resolve_read_only = |index: u16| -> Option<[u8; 32]> {
        let slot = usize::from(index).checked_sub(2 + rw_cnt)?;
        if slot >= ro_cnt || slot >= RO_CACHE_MAX {
            return None;
        }
        key_at(body, TXN_HDR_SZ + 32 * (rw_cnt + slot))
    };

    let (kind, source, recipient, amount, authority_index, checked) =
        if program == EOA_PROGRAM_BYTES && instr_sz == EOA_TRANSFER_SZ {
            if u32_at(data, 0)? != 1 || u16_at(data, 12)? != 0 {
                return None;
            }
            (
                TransferKind::Native,
                0,
                u16_at(data, 14)?,
                u64_at(data, 4)?,
                None,
                None,
            )
        } else if program == TOKEN_PROGRAM_BYTES
            && instr_sz == TOKEN_TRANSFER_CHECKED_SZ
            && data.first() == Some(&8)
        {
            let (source, recipient) = (u16_at(data, 1)?, u16_at(data, 3)?);
            if source < 2 || recipient < 2 {
                return None;
            }
            let ticker = data.get(17..17 + TICKER_MAX)?;
            let (shown, padding) = ticker.split_at_checked(usize::from(*data.get(16)?))?;
            if padding.iter().any(|&b| b != 0) {
                return None;
            }
            let mint = resolve_read_only(u16_at(data, 5)?)?;
            let checked = CheckedToken::new(mint, *data.get(15)?, shown)?;
            (
                TransferKind::Token,
                source,
                recipient,
                u64_at(data, 7)?,
                None,
                Some(checked),
            )
        } else if program == TOKEN_PROGRAM_BYTES
            && instr_sz == TOKEN_TRANSFER_SZ
            && data.first() == Some(&2)
        {
            let (source, recipient) = (u16_at(data, 1)?, u16_at(data, 3)?);
            // The fee payer and the program are not token accounts.
            if source < 2 || recipient < 2 {
                return None;
            }
            (
                TransferKind::Token,
                source,
                recipient,
                u64_at(data, 5)?,
                None,
                None,
            )
        } else if program == WALLET_PROGRAM_BYTES
            && instr_sz == WALLET_TRANSFER_SZ
            && data.first() == Some(&1)
        {
            if data.get(4..72)?.iter().any(|&b| b != 0)
                || u16_at(data, 72)? != 1
                || u64_at(data, 74)? != TOKEN_TRANSFER_SZ as u64
                || data.get(82) != Some(&2)
            {
                return None;
            }
            let wallet = u16_at(data, 1)?;
            if wallet < 2 || u16_at(data, 83)? != wallet {
                return None;
            }
            (
                TransferKind::Wallet,
                wallet,
                u16_at(data, 85)?,
                u64_at(data, 87)?,
                Some(*data.get(3)?),
                None,
            )
        } else {
            return None;
        };

    let resolve = |index: u16| -> Option<[u8; 32]> {
        if index == 0 {
            return Some(fee_payer);
        }
        let slot = usize::from(index.checked_sub(2)?);
        if slot >= rw_cnt || slot >= RW_CACHE_MAX {
            return None;
        }
        key_at(body, TXN_HDR_SZ + 32 * slot)
    };
    Some(ClearTransfer {
        kind,
        source: resolve(source)?,
        recipient: resolve(recipient)?,
        amount,
        authority_index,
        checked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEE_PAYER: [u8; 32] = [0x11; 32];

    fn rw(i: u8) -> [u8; 32] {
        let mut k = [0x55; 32];
        k[0] = 0x20 + i;
        k
    }

    fn body(program: [u8; 32], rw_cnt: u8, ro_cnt: u8, instr: &[u8]) -> Vec<u8> {
        let mut b = vec![0u8; TXN_HDR_SZ];
        b[0] = 1;
        b[2..4].copy_from_slice(&u16::from(rw_cnt).to_le_bytes());
        b[4..6].copy_from_slice(&u16::from(ro_cnt).to_le_bytes());
        b[6..8].copy_from_slice(&(instr.len() as u16).to_le_bytes());
        b[48..80].copy_from_slice(&FEE_PAYER);
        b[80..112].copy_from_slice(&program);
        for i in 0..rw_cnt + ro_cnt {
            b.extend_from_slice(&rw(i));
        }
        b.extend_from_slice(instr);
        b
    }

    fn eoa(to: u16, tag: u32, from: u16) -> Vec<u8> {
        let mut i = tag.to_le_bytes().to_vec();
        i.extend_from_slice(&5u64.to_le_bytes());
        i.extend_from_slice(&from.to_le_bytes());
        i.extend_from_slice(&to.to_le_bytes());
        i
    }

    fn wallet(wallet: u16, recipient: u16, authority: u8) -> Vec<u8> {
        let mut i = vec![1];
        i.extend_from_slice(&wallet.to_le_bytes());
        i.push(authority);
        i.extend_from_slice(&[0u8; 68]);
        i.extend_from_slice(&1u16.to_le_bytes());
        i.extend_from_slice(&13u64.to_le_bytes());
        i.push(2);
        i.extend_from_slice(&wallet.to_le_bytes());
        i.extend_from_slice(&recipient.to_le_bytes());
        i.extend_from_slice(&7u64.to_le_bytes());
        i
    }

    #[test]
    fn native_resolves_the_fee_payer_and_read_write_accounts() {
        let t = decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 2, 0, &eoa(3, 1, 0))).unwrap();
        assert_eq!(
            (t.kind, t.source, t.recipient, t.amount),
            (TransferKind::Native, FEE_PAYER, rw(1), 5)
        );
        let to_self = decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 0, 0, &eoa(0, 1, 0))).unwrap();
        assert_eq!(to_self.recipient, FEE_PAYER);
        for bad in [eoa(3, 2, 0), eoa(3, 1, 2), eoa(1, 1, 0), eoa(4, 1, 0)] {
            assert_eq!(
                decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 2, 0, &bad)),
                None
            );
        }
        // Read-only recipient.
        assert_eq!(
            decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 1, 1, &eoa(3, 1, 0))),
            None
        );
    }

    #[test]
    fn only_the_first_32_read_write_accounts_resolve() {
        assert!(decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 33, 0, &eoa(33, 1, 0))).is_some());
        assert_eq!(
            decode_clear_transfer(&body(EOA_PROGRAM_BYTES, 33, 0, &eoa(34, 1, 0))),
            None
        );
    }

    #[test]
    fn wallet_needs_the_exact_validate_then_transfer_form() {
        let t = decode_clear_transfer(&body(WALLET_PROGRAM_BYTES, 3, 0, &wallet(2, 4, 9))).unwrap();
        assert_eq!(
            (t.kind, t.source, t.recipient, t.amount, t.authority_index),
            (TransferKind::Wallet, rw(0), rw(2), 7, Some(9))
        );
        for (offset, value) in [
            (4, 1),
            (68, 1),
            (70, 1),
            (72, 2),
            (74, 14),
            (82, 3),
            (83, 3),
        ] {
            let mut i = wallet(2, 4, 0);
            i[offset] = value;
            assert_eq!(
                decode_clear_transfer(&body(WALLET_PROGRAM_BYTES, 3, 0, &i)),
                None,
                "{offset}"
            );
        }
        assert_eq!(
            decode_clear_transfer(&body(WALLET_PROGRAM_BYTES, 3, 0, &wallet(0, 4, 0))),
            None
        );
    }

    #[test]
    fn token_needs_two_token_accounts_and_anything_else_is_blind() {
        let mut i = vec![2];
        i.extend_from_slice(&2u16.to_le_bytes());
        i.extend_from_slice(&3u16.to_le_bytes());
        i.extend_from_slice(&9u64.to_le_bytes());
        let t = decode_clear_transfer(&body(TOKEN_PROGRAM_BYTES, 2, 0, &i)).unwrap();
        assert_eq!(
            (t.kind, t.source, t.recipient, t.amount),
            (TransferKind::Token, rw(0), rw(1), 9)
        );
        let mut from_fee_payer = i.clone();
        from_fee_payer[1] = 0;
        assert_eq!(
            decode_clear_transfer(&body(TOKEN_PROGRAM_BYTES, 2, 0, &from_fee_payer)),
            None
        );
        let mut trailing = i.clone();
        trailing.push(0);
        assert_eq!(
            decode_clear_transfer(&body(TOKEN_PROGRAM_BYTES, 2, 0, &trailing)),
            None
        );
        assert_eq!(decode_clear_transfer(&body([0x55; 32], 2, 0, &i)), None);
        // Truncated or garbage input never panics.
        let full = body(TOKEN_PROGRAM_BYTES, 2, 0, &i);
        for n in 0..full.len() {
            let _ = decode_clear_transfer(&full[..n]);
        }
    }

    fn checked(
        source: u16,
        recipient: u16,
        mint: u16,
        decimals: u8,
        ticker_len: u8,
        ticker: &[u8; 8],
    ) -> Vec<u8> {
        let mut i = vec![8];
        i.extend_from_slice(&source.to_le_bytes());
        i.extend_from_slice(&recipient.to_le_bytes());
        i.extend_from_slice(&mint.to_le_bytes());
        i.extend_from_slice(&1_500_000u64.to_le_bytes());
        i.push(decimals);
        i.push(ticker_len);
        i.extend_from_slice(ticker);
        i
    }

    const USDC: &[u8; 8] = b"USDC\0\0\0\0";

    #[test]
    fn checked_token_resolves_the_mint_among_the_cached_read_only_keys() {
        let t = decode_clear_transfer(&body(
            TOKEN_PROGRAM_BYTES,
            2,
            1,
            &checked(2, 3, 4, 6, 4, USDC),
        ))
        .unwrap();
        let c = t.checked.unwrap();
        assert_eq!(
            (
                t.kind,
                t.source,
                t.recipient,
                t.amount,
                c.mint,
                c.decimals,
                c.ticker()
            ),
            (
                TransferKind::Token,
                rw(0),
                rw(1),
                1_500_000,
                rw(2),
                6,
                "USDC"
            )
        );
        // The 4th read-only key is the last one the device keeps.
        let last = decode_clear_transfer(&body(
            TOKEN_PROGRAM_BYTES,
            2,
            4,
            &checked(2, 3, 7, 6, 4, USDC),
        ));
        assert_eq!(last.unwrap().checked.unwrap().mint, rw(5));
        for (ro_cnt, mint) in [(5, 8), (1, 5), (1, 3), (1, 0), (1, 1)] {
            assert_eq!(
                decode_clear_transfer(&body(
                    TOKEN_PROGRAM_BYTES,
                    2,
                    ro_cnt,
                    &checked(2, 3, mint, 6, 4, USDC)
                )),
                None,
                "ro_cnt={ro_cnt} mint={mint}"
            );
        }
    }

    #[test]
    fn checked_token_shows_only_printable_tickers_and_at_most_19_decimals() {
        let decode = |i: &[u8]| decode_clear_transfer(&body(TOKEN_PROGRAM_BYTES, 2, 1, i));
        let empty = decode(&checked(2, 3, 4, 9, 0, &[0; 8]))
            .unwrap()
            .checked
            .unwrap();
        assert_eq!((empty.ticker(), empty.decimals), ("", 9));
        let full = decode(&checked(2, 3, 4, 19, 8, b"ABCDEFGH"))
            .unwrap()
            .checked
            .unwrap();
        assert_eq!((full.ticker(), full.decimals), ("ABCDEFGH", 19));
        for bad in [
            checked(2, 3, 4, 20, 4, USDC),
            checked(2, 3, 4, 6, 9, USDC),
            checked(2, 3, 4, 6, 4, b"USDC\0X\0\0"),
            checked(2, 3, 4, 6, 4, b"US C\0\0\0\0"),
            checked(2, 3, 4, 6, 4, b"USD\x7f\0\0\0\0"),
            checked(2, 3, 4, 6, 4, b"US\0C\0\0\0\0"),
            checked(0, 3, 4, 6, 4, USDC),
            checked(2, 4, 4, 6, 4, USDC),
        ] {
            assert_eq!(decode(&bad), None, "{bad:02x?}");
        }
        let mut long = checked(2, 3, 4, 6, 4, USDC);
        long.push(0);
        assert_eq!(decode(&long), None);
        let short = checked(2, 3, 4, 6, 4, USDC);
        assert_eq!(decode(&short[..24]), None);
    }
}
