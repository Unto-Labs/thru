//! SIGN_TXN token hint (`specs/ledger/app-thru-apdu.md` §7.2.1).
//!
//! A token Transfer names only two token accounts.  The hint tells the device
//! which mint they hold and who owns the recipient account.  The device
//! derives both accounts from it and, only if they equal the signed accounts,
//! shows the account owners and the mint instead of the token accounts;
//! otherwise it returns `0x6814`.  The hint is not signed.  A TransferChecked
//! names its mint itself, so there the hint must name the same mint and adds
//! only the owners.
//!
//! [`verify_token_hint`] applies the device's rule on the host, so a wrong
//! hint fails before the device is contacted.  The device stays
//! authoritative.

use sha2::{Digest, Sha256};
use thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES;
use thru_base::tn_public_address::create_program_defined_account_address;

use crate::error::{LedgerError, RequestReject};
use crate::transfer::{TransferKind, decode_clear_transfer};

/// Hint kind byte for token-account identities.
pub const TOKEN_HINT_KIND: u8 = 0x01;

/// Encoded hint size: kind, mint, recipient owner, recipient seed, source seed.
pub const TOKEN_HINT_SZ: usize = 1 + 4 * 32;

/// User seed of wallet-created token accounts: 32 zero bytes.
pub const DEFAULT_TOKEN_ACCOUNT_SEED: [u8; 32] = [0u8; 32];

/// The mint and owners of a token transfer, sent after the SIGN_TXN path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenHint {
    /// Mint of both token accounts.
    pub mint: [u8; 32],
    /// Owner of the recipient token account.
    pub recipient_owner: [u8; 32],
    /// User seed of the recipient token account.
    pub recipient_seed: [u8; 32],
    /// User seed of the fee payer's source token account.
    pub source_seed: [u8; 32],
}

impl TokenHint {
    /// A hint for the default token accounts (seed of 32 zero bytes) of
    /// `mint`, sent to `recipient_owner`'s account.
    pub fn new(mint: [u8; 32], recipient_owner: [u8; 32]) -> Self {
        Self {
            mint,
            recipient_owner,
            recipient_seed: DEFAULT_TOKEN_ACCOUNT_SEED,
            source_seed: DEFAULT_TOKEN_ACCOUNT_SEED,
        }
    }

    /// `kind ‖ mint ‖ recipient_owner ‖ recipient_seed ‖ source_seed`.
    pub fn encode(&self) -> [u8; TOKEN_HINT_SZ] {
        let mut out = [0u8; TOKEN_HINT_SZ];
        out[0] = TOKEN_HINT_KIND;
        for (i, field) in [
            &self.mint,
            &self.recipient_owner,
            &self.recipient_seed,
            &self.source_seed,
        ]
        .into_iter()
        .enumerate()
        {
            out[1 + 32 * i..33 + 32 * i].copy_from_slice(field);
        }
        out
    }
}

/// What the device shows for a token transfer with a verified hint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenIdentity {
    /// Mint of both token accounts.
    pub mint: [u8; 32],
    /// Owner of the source token account: always the fee payer.
    pub source_owner: [u8; 32],
    /// Owner of the recipient token account.
    pub recipient_owner: [u8; 32],
}

/// Address of `owner`'s token account for `mint` created with `seed`:
/// `SHA-256(TOKEN_PROGRAM ‖ 0x00 ‖ SHA-256(owner ‖ mint ‖ seed))`.
pub fn token_account_address(owner: &[u8; 32], mint: &[u8; 32], seed: &[u8; 32]) -> [u8; 32] {
    let account_seed: [u8; 32] = Sha256::new()
        .chain_update(owner)
        .chain_update(mint)
        .chain_update(seed)
        .finalize()
        .into();
    create_program_defined_account_address(&TOKEN_PROGRAM_BYTES, false, &account_seed)
}

/// Check `hint` against `body` with the device's rule (§7.2.1): the body must
/// be a token transfer the device recognizes (Transfer or TransferChecked),
/// its source must be the fee payer's token account and its recipient
/// `recipient_owner`'s, both for `mint`; a TransferChecked must name `mint`
/// itself.  Returns what the device will show, or
/// `InvalidRequest(RequestReject::TokenHint)`.
pub fn verify_token_hint(body: &[u8], hint: &TokenHint) -> Result<TokenIdentity, LedgerError> {
    let mismatch = || LedgerError::InvalidRequest(RequestReject::TokenHint);
    let transfer = decode_clear_transfer(body)
        .filter(|t| t.kind == TransferKind::Token)
        .ok_or_else(mismatch)?;
    if transfer.checked.is_some_and(|c| c.mint != hint.mint) {
        return Err(mismatch());
    }
    let fee_payer: [u8; 32] = body
        .get(48..80)
        .and_then(|k| k.try_into().ok())
        .ok_or_else(mismatch)?;
    if transfer.source != token_account_address(&fee_payer, &hint.mint, &hint.source_seed)
        || transfer.recipient
            != token_account_address(&hint.recipient_owner, &hint.mint, &hint.recipient_seed)
    {
        return Err(mismatch());
    }
    Ok(TokenIdentity {
        mint: hint.mint,
        source_owner: fee_payer,
        recipient_owner: hint.recipient_owner,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h32(s: &str) -> [u8; 32] {
        hex::decode(s).unwrap().try_into().unwrap()
    }

    /* Shared with the device app's functional tests (`thru_txn.py`:
    `TOKEN_MINT`, `SIGNER`, `RECIPIENT`, `token_account`) and the
    TypeScript signer; the device accepted these accounts for this hint. */
    const SIGNER: &str = "1d65dd4d10f4f8a392d9e17c4d8cdea7c68e2a3eadc35997bbb6738e39cc0e6e";
    const RECIPIENT: &str = "546fdb52f2026f707260cf7c9c8ffdacd4c3c05624487893f6426168b5a1eb63";
    const MINT: &str = "266ca05e1a300a2be3d69bf25c25f8632808e7b4299279535da4d0f877fd5d30";

    #[test]
    fn derives_the_token_accounts_the_device_accepted() {
        let (signer, recipient, mint) = (h32(SIGNER), h32(RECIPIENT), h32(MINT));
        assert_eq!(
            hex::encode(token_account_address(
                &signer,
                &mint,
                &DEFAULT_TOKEN_ACCOUNT_SEED
            )),
            "1469debe9dfacd29cd2fd736b672d2b9c3178959d393f9fc21d2dd217cf9f4b1"
        );
        assert_eq!(
            hex::encode(token_account_address(
                &recipient,
                &mint,
                &DEFAULT_TOKEN_ACCOUNT_SEED
            )),
            "b1ccbc6a010085ee3e98b08940c20b9bc0708fa63061cdd0a4c46355e4feb8ab"
        );
        assert_eq!(
            hex::encode(token_account_address(&signer, &mint, &[0x44; 32])),
            "b29c3c668c4a337e874905feb655652cb0c2da5ee93aafb7c7907dc0a6d5992d"
        );
    }

    #[test]
    fn encodes_kind_then_four_fields() {
        let hint = TokenHint {
            source_seed: [0x44; 32],
            ..TokenHint::new(h32(MINT), h32(RECIPIENT))
        };
        let b = hint.encode();
        assert_eq!(b.len(), TOKEN_HINT_SZ);
        assert_eq!(b[0], TOKEN_HINT_KIND);
        assert_eq!(b[1..33], h32(MINT));
        assert_eq!(b[33..65], h32(RECIPIENT));
        assert_eq!(b[65..97], DEFAULT_TOKEN_ACCOUNT_SEED);
        assert_eq!(b[97..129], [0x44; 32]);
    }
}
