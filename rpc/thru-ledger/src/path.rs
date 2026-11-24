//! Derivation paths: parsing, policy validation and APDU encoding
//! (`specs/ledger/app-thru-apdu.md` §4).
//!
//! Policy (§4.2), checked identically on the host and the device:
//!
//! 1. depth is 3 or 4;
//! 2. every component is hardened;
//! 3. `component[0] == 44'`;
//! 4. `component[1] == THRU_COIN_TYPE'`;
//! 5. at depth 4, `component[3] == 0'` exactly.
//!
//! The account index (`component[2]` without the hardened bit) may be anything
//! in `[0, 2^31 − 1]` inclusive.
//!
//! Textual forms: `m/44'/8478'/0'/0'` (display, §4.4) and the key-source URI
//! `ledger://44'/8478'/0'/0'`.

use std::fmt;
use std::str::FromStr;

use thiserror::Error;

use crate::consts::{HARDENED, THRU_COIN_TYPE, THRU_PURPOSE};

/// URI scheme of a Ledger key source, e.g. `ledger://44'/8478'/0'/0'`.
pub const LEDGER_URI_SCHEME: &str = "ledger://";

/// Why a path was refused.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PathError {
    /// Depth is not 3 or 4.
    #[error("derivation path depth must be 3 or 4, got {0}")]
    Depth(usize),
    /// A component lacks the hardened bit.
    #[error("every derivation path component must be hardened (component {index} is not)")]
    NotHardened {
        /// Zero-based component index.
        index: usize,
    },
    /// Purpose is not 44'.
    #[error("derivation path purpose must be 44', got {0}")]
    Purpose(String),
    /// Coin type is not `THRU_COIN_TYPE'`.
    #[error("derivation path coin type must be {THRU_COIN_TYPE}', got {0}")]
    CoinType(String),
    /// Depth-4 change component is not exactly 0'.
    #[error("derivation path change must be 0', got {0}")]
    Change(String),
    /// Encoded path is shorter than its declared depth (device: 0x6700).
    #[error("encoded derivation path is truncated")]
    Truncated,
    /// The textual form could not be parsed.
    #[error("invalid derivation path '{0}': expected e.g. m/44'/{THRU_COIN_TYPE}'/0'/0'")]
    Syntax(String),
    /// The value is not a `ledger://` URI.
    #[error(
        "'{0}' is not a Ledger key source (expected {LEDGER_URI_SCHEME}44'/{THRU_COIN_TYPE}'/<account>'/0')"
    )]
    NotLedgerUri(String),
}

/// Render one component as `<n>'` or `<n>`.
fn component_string(c: u32) -> String {
    if c & HARDENED != 0 {
        format!("{}'", c & !HARDENED)
    } else {
        format!("{c}")
    }
}

/// Check `components` against the §4.2 acceptance policy.
pub fn validate_components(components: &[u32]) -> Result<(), PathError> {
    if components.len() != 3 && components.len() != 4 {
        return Err(PathError::Depth(components.len()));
    }
    if let Some(index) = components.iter().position(|c| c & HARDENED == 0) {
        return Err(PathError::NotHardened { index });
    }
    if components[0] != HARDENED | THRU_PURPOSE {
        return Err(PathError::Purpose(component_string(components[0])));
    }
    if components[1] != HARDENED | THRU_COIN_TYPE {
        return Err(PathError::CoinType(component_string(components[1])));
    }
    if components.len() == 4 && components[3] != HARDENED {
        return Err(PathError::Change(component_string(components[3])));
    }
    Ok(())
}

/// A derivation path that satisfies the Thru policy (§4.2).  It can only be
/// constructed through validating constructors, so holding one proves the
/// path is acceptable to the device.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct DerivationPath {
    depth: u8,
    components: [u32; 4],
}

impl DerivationPath {
    /// The canonical depth-4 path `m/44'/COIN'/{account}'/0'`.
    /// `account` must be below `2^31`.
    pub fn new(account: u32) -> Result<Self, PathError> {
        if account & HARDENED != 0 {
            return Err(PathError::Syntax(format!(
                "account index {account} >= 2^31"
            )));
        }
        Self::from_components(&[
            HARDENED | THRU_PURPOSE,
            HARDENED | THRU_COIN_TYPE,
            HARDENED | account,
            HARDENED,
        ])
    }

    /// The depth-3 path `m/44'/COIN'/{account}'` (Solana-style tooling).
    pub fn new_depth3(account: u32) -> Result<Self, PathError> {
        if account & HARDENED != 0 {
            return Err(PathError::Syntax(format!(
                "account index {account} >= 2^31"
            )));
        }
        Self::from_components(&[
            HARDENED | THRU_PURPOSE,
            HARDENED | THRU_COIN_TYPE,
            HARDENED | account,
        ])
    }

    /// Build from raw components (hardened bit included), enforcing the policy.
    pub fn from_components(components: &[u32]) -> Result<Self, PathError> {
        validate_components(components)?;
        let mut c = [0u32; 4];
        c[..components.len()].copy_from_slice(components);
        Ok(Self {
            depth: components.len() as u8,
            components: c,
        })
    }

    /// Path depth (3 or 4).
    pub fn depth(&self) -> usize {
        self.depth as usize
    }

    /// Raw components, hardened bit included.
    pub fn components(&self) -> &[u32] {
        &self.components[..self.depth()]
    }

    /// Account index `a` (component 2 without the hardened bit).
    pub fn account(&self) -> u32 {
        self.components[2] & !HARDENED
    }

    /// APDU encoding: `u8 depth ‖ depth × u32 big-endian` (§4.1).
    pub fn to_apdu_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + 4 * self.depth());
        out.push(self.depth);
        for c in self.components() {
            out.extend_from_slice(&c.to_be_bytes());
        }
        out
    }

    /// Length of the APDU encoding (`1 + 4·depth`).
    pub fn apdu_len(&self) -> usize {
        1 + 4 * self.depth()
    }

    /// Decode the APDU encoding at the start of `data`, returning the path and
    /// the number of bytes consumed.  A truncated encoding is
    /// [`PathError::Truncated`] (device: `0x6700`); a well-formed encoding that
    /// fails policy is the policy error (device: `0x6820`).
    pub fn from_apdu_bytes(data: &[u8]) -> Result<(Self, usize), PathError> {
        let depth = *data.first().ok_or(PathError::Truncated)? as usize;
        let len = 1 + 4 * depth;
        if data.len() < len {
            return Err(PathError::Truncated);
        }
        let components: Vec<u32> = data[1..len]
            .chunks_exact(4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        Ok((Self::from_components(&components)?, len))
    }

    /// Parse `ledger://44'/8478'/0'/0'` (scheme is case-insensitive; an
    /// optional `m/` after the scheme is accepted).
    pub fn from_uri(uri: &str) -> Result<Self, PathError> {
        let trimmed = uri.trim();
        let rest = strip_ledger_scheme(trimmed)
            .ok_or_else(|| PathError::NotLedgerUri(trimmed.to_string()))?;
        rest.parse()
    }

    /// Canonical URI form: `ledger://44'/8478'/0'/0'`.
    pub fn to_uri(&self) -> String {
        let parts: Vec<String> = self
            .components()
            .iter()
            .map(|c| component_string(*c))
            .collect();
        format!("{LEDGER_URI_SCHEME}{}", parts.join("/"))
    }
}

/// If `value` starts with the `ledger://` scheme (case-insensitive), return the
/// remainder.
pub fn strip_ledger_scheme(value: &str) -> Option<&str> {
    let prefix = value.get(..LEDGER_URI_SCHEME.len())?;
    prefix
        .eq_ignore_ascii_case(LEDGER_URI_SCHEME)
        .then(|| &value[LEDGER_URI_SCHEME.len()..])
}

/// Whether `value` is a `ledger://` URI (leading whitespace ignored).
pub fn is_ledger_uri(value: &str) -> bool {
    strip_ledger_scheme(value.trim_start()).is_some()
}

impl FromStr for DerivationPath {
    type Err = PathError;

    /// Parse `m/44'/8478'/0'/0'` or `44'/8478'/0'/0'`.  Hardened components use
    /// `'` (or `h`/`H`).  Non-hardened components parse and are then rejected by
    /// policy, so the error names the actual problem.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let syntax = || PathError::Syntax(s.to_string());
        let body = s.trim();
        let body = body.strip_prefix("m/").unwrap_or(body);
        if body.is_empty() || body == "m" {
            return Err(PathError::Depth(0));
        }
        let mut components = Vec::new();
        for part in body.split('/') {
            let (digits, hardened) = match part.strip_suffix(['\'', 'h', 'H']) {
                Some(d) => (d, true),
                None => (part, false),
            };
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return Err(syntax());
            }
            let n: u32 = digits.parse().map_err(|_| syntax())?;
            if n & HARDENED != 0 {
                return Err(syntax());
            }
            components.push(if hardened { n | HARDENED } else { n });
        }
        Self::from_components(&components)
    }
}

impl fmt::Display for DerivationPath {
    /// §4.4 display form: `m/44'/8478'/0'/0'`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("m")?;
        for c in self.components() {
            write!(f, "/{}", component_string(*c))?;
        }
        Ok(())
    }
}

impl fmt::Debug for DerivationPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "DerivationPath({self})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_path_round_trips() {
        let p = DerivationPath::new(0).unwrap();
        assert_eq!(p.to_string(), "m/44'/8478'/0'/0'");
        assert_eq!(p.to_uri(), "ledger://44'/8478'/0'/0'");
        assert_eq!(
            hex::encode(p.to_apdu_bytes()),
            "048000002c8000211e8000000080000000"
        );
        assert_eq!(DerivationPath::from_uri(&p.to_uri()).unwrap(), p);
        assert_eq!("m/44'/8478'/0'/0'".parse::<DerivationPath>().unwrap(), p);
        assert_eq!(
            DerivationPath::from_apdu_bytes(&p.to_apdu_bytes()).unwrap(),
            (p, 17)
        );
    }

    #[test]
    fn max_account_is_accepted() {
        let p = DerivationPath::new(0x7FFF_FFFF).unwrap();
        assert_eq!(p.account(), 0x7FFF_FFFF);
        assert_eq!(p.to_string(), "m/44'/8478'/2147483647'/0'");
        assert!(DerivationPath::new(0x8000_0000).is_err());
    }

    #[test]
    fn depth3_is_accepted() {
        let p: DerivationPath = "m/44'/8478'/5'".parse().unwrap();
        assert_eq!(p, DerivationPath::new_depth3(5).unwrap());
        assert_eq!(p.apdu_len(), 13);
    }

    #[test]
    fn uri_forms() {
        for ok in [
            "ledger://44'/8478'/0'/0'",
            "LEDGER://44'/8478'/0'/0'",
            "  ledger://m/44'/8478'/0'/0'",
            "ledger://44h/8478h/0h/0h",
        ] {
            assert_eq!(
                DerivationPath::from_uri(ok).unwrap(),
                DerivationPath::new(0).unwrap(),
                "{ok}"
            );
            assert!(is_ledger_uri(ok));
        }
        assert!(matches!(
            DerivationPath::from_uri("44'/8478'/0'/0'"),
            Err(PathError::NotLedgerUri(_))
        ));
        assert!(!is_ledger_uri("ledger"));
    }

    #[test]
    fn policy_rejections() {
        type Check = fn(&PathError) -> bool;
        let cases: &[(&str, Check)] = &[
            ("m/44'/8478'/0'/1'", |e| matches!(e, PathError::Change(_))),
            ("m/44'/8478'/0'/0", |e| {
                matches!(e, PathError::NotHardened { index: 3 })
            }),
            ("m/44'/8478'/0/0'", |e| {
                matches!(e, PathError::NotHardened { index: 2 })
            }),
            ("m/44'/501'/0'/0'", |e| matches!(e, PathError::CoinType(_))),
            ("m/44'/9999'/0'/0'", |e| matches!(e, PathError::CoinType(_))),
            ("m/43'/8478'/0'/0'", |e| matches!(e, PathError::Purpose(_))),
            ("m/44'/8478'", |e| matches!(e, PathError::Depth(2))),
            ("m/44'/8478'/0'/0'/0'", |e| matches!(e, PathError::Depth(5))),
            ("m", |e| matches!(e, PathError::Depth(0))),
            ("m/44'/x'/0'", |e| matches!(e, PathError::Syntax(_))),
            ("m/44'/8478'/2147483648'/0'", |e| {
                matches!(e, PathError::Syntax(_))
            }),
            ("m/44'//0'", |e| matches!(e, PathError::Syntax(_))),
        ];
        for (s, check) in cases {
            let err = s.parse::<DerivationPath>().unwrap_err();
            assert!(check(&err), "{s}: {err:?}");
        }
    }

    #[test]
    fn apdu_truncation_vs_policy() {
        assert_eq!(
            DerivationPath::from_apdu_bytes(&[]),
            Err(PathError::Truncated)
        );
        assert_eq!(
            DerivationPath::from_apdu_bytes(&[4, 0x80, 0, 0, 0x2c]),
            Err(PathError::Truncated)
        );
        assert_eq!(
            DerivationPath::from_apdu_bytes(&[2, 0x80, 0, 0, 0x2c, 0x80, 0, 0x21, 0x1e]),
            Err(PathError::Depth(2))
        );
    }
}
