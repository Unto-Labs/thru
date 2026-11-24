//! Named protocol constants (`specs/ledger/app-thru-apdu.md` §2.2, §3.3).
//!
//! The spec requires every implementation to define these as single named
//! constants and never inline the literals.

/// APDU class byte of every Thru command.
pub const THRU_CLA: u8 = 0xE0;

/// Registered SLIP-44 coin type used in `m/44'/COIN_TYPE'/…`.
pub const THRU_COIN_TYPE: u32 = 8478;

/// BIP-44 purpose.
pub const THRU_PURPOSE: u32 = 44;

/// Hardened-derivation bit of a path component.
pub const HARDENED: u32 = 0x8000_0000;

/// Maximum APDU data length (short APDUs only).
pub const APDU_MAX_DATA: usize = 255;

/// Transaction header size (`TN_TXN_HDR_V1_SZ`).
pub const TXN_HDR_SZ: usize = 112;

/// Transaction MTU, including the 64-byte signature (`TN_TXN_MTU`).
pub const TXN_MTU: usize = 32_768;

/// Maximum transaction body length (`TXN_MTU − 64`).
pub const TXN_BODY_MAX: usize = TXN_MTU - 64;

/// Maximum number of accounts in a transaction (fee payer + program + rw + ro).
pub const TXN_MAX_ACCOUNTS: usize = 1024;

/// Fee-payer state-proof header size.
pub const STATE_PROOF_HDR_SZ: usize = 40;

/// Account meta size (`sizeof(tn_account_meta_t)`).
pub const ACCOUNT_META_SZ: usize = 64;

/// Maximum off-chain message length (`TN_SIGNATURE_CTX_MAX`).
pub const MSG_MAX: usize = 32_768;

/// Printable-ASCII messages up to this length are shown in full on the device.
pub const MSG_DISPLAY_MAX: usize = 512;

/// Device RAM bound for the rw∩ro disjointness check.
pub const RW_CACHE_MAX: usize = 32;

/// Read-only keys the device keeps: the mint of a checked token transfer
/// resolves only among the first `RO_CACHE_MAX` read-only accounts.
pub const RO_CACHE_MAX: usize = 4;

/// Fee above which the device shows a "High fee" warning (base units).
/// 0.1 THRU, confirmed in plan D13.
pub const FEE_WARN_THRESHOLD: u64 = 100_000_000;

/// APDU protocol version implemented by this host (reported by GET_APP_CONFIG).
pub const APDU_PROTOCOL_VERSION: u8 = 1;

/// Native THRU decimals.
pub const THRU_DECIMALS: u32 = 9;

/// Name the device app reports (GET_APP_NAME and the OS GET_APP_AND_VERSION).
pub const THRU_APP_NAME: &str = "Thru";

/// Instruction codes (§3.3).  INS `0x01` is reserved and never assigned to a
/// Thru command, because generic host tooling probes it (§11.0).
pub mod ins {
    /// Reserved; never sent by this crate.
    pub const RESERVED_01: u8 = 0x01;
    /// GET_VERSION.
    pub const GET_VERSION: u8 = 0x03;
    /// GET_APP_NAME.
    pub const GET_APP_NAME: u8 = 0x04;
    /// GET_APP_CONFIG.
    pub const GET_APP_CONFIG: u8 = 0x05;
    /// GET_PUBKEY.
    pub const GET_PUBKEY: u8 = 0x06;
    /// SIGN_TXN.
    pub const SIGN_TXN: u8 = 0x07;
    /// SIGN_MESSAGE.
    pub const SIGN_MESSAGE: u8 = 0x08;
    /// SIGN_EOA_AUTH.
    pub const SIGN_EOA_AUTH: u8 = 0x09;
}

/// P2 value for "more chunks follow".
pub const P2_MORE: u8 = 0x80;
/// P2 value for the last chunk (of the command, or of a SIGN_MESSAGE pass).
pub const P2_LAST: u8 = 0x00;

/// GET_PUBKEY P1: silent.
pub const P1_SILENT: u8 = 0x00;
/// GET_PUBKEY P1: display the address and ask the user to confirm.
pub const P1_DISPLAY: u8 = 0x01;

/// Ledger OS (dashboard) command class.
pub const OS_CLA: u8 = 0xB0;
/// Ledger OS GET_APP_AND_VERSION instruction (`B0 01 00 00 00`).
pub const OS_INS_GET_APP_AND_VERSION: u8 = 0x01;

/// GET_APP_CONFIG flags bit 0: blind signing enabled.
pub const APP_FLAG_BLIND_SIGNING: u8 = 0x01;

/// SIGN_EOA_AUTH `kind` byte for a create authorization.
pub const EOA_KIND_CREATE: u8 = 0x00;
/// SIGN_EOA_AUTH `kind` byte for a delete authorization.
pub const EOA_KIND_DELETE: u8 = 0x01;
