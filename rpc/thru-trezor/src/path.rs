//! Derivation paths of the Thru app and the `trezor://` key source.
//!
//! The policy is the Ledger app's, so a key has the same path on both:
//!
//! 1. depth is 3 or 4;
//! 2. every component is hardened;
//! 3. `component[0] == 44'`;
//! 4. `component[1] == 8478'` (Thru's coin type);
//! 5. at depth 4, `component[3] == 0'` exactly.
//!
//! The account index (`component[2]` without the hardened bit) may be anything
//! in `[0, 2^31 - 1]`.
//!
//! Textual forms: `m/44'/8478'/0'/0'` (display) and the key-source URI
//! `trezor://44'/8478'/0'/0'`.

use std::fmt;
use std::str::FromStr;

use thiserror::Error;

/// The bit that marks a hardened component.
pub const HARDENED: u32 = 0x8000_0000;
/// BIP-44 purpose.
pub const THRU_PURPOSE: u32 = 44;
/// Thru's SLIP-44 coin type.
pub const THRU_COIN_TYPE: u32 = 8478;

/// URI scheme of a Trezor key source, e.g. `trezor://44'/8478'/0'/0'`.
pub const TREZOR_URI_SCHEME: &str = "trezor://";

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
    /// Coin type is not 8478'.
    #[error("derivation path coin type must be {THRU_COIN_TYPE}', got {0}")]
    CoinType(String),
    /// Depth-4 change component is not exactly 0'.
    #[error("derivation path change must be 0', got {0}")]
    Change(String),
    /// The textual form could not be parsed.
    #[error("invalid derivation path '{0}': expected e.g. m/44'/{THRU_COIN_TYPE}'/0'/0'")]
    Syntax(String),
    /// The value is not a `trezor://` URI.
    #[error(
        "'{0}' is not a Trezor key source (expected {TREZOR_URI_SCHEME}44'/{THRU_COIN_TYPE}'/<account>'/0')"
    )]
    NotTrezorUri(String),
}

/// Renders one component as `<n>'` or `<n>`.
fn component_string(c: u32) -> String {
    if c & HARDENED != 0 {
        format!("{}'", c & !HARDENED)
    } else {
        format!("{c}")
    }
}

/// Checks `components` against the policy.
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

/// A derivation path that satisfies the Thru policy. It can only be built
/// through validating constructors, so holding one proves the path is one the
/// app accepts.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct DerivationPath {
    depth: u8,
    components: [u32; 4],
}

impl DerivationPath {
    /// The canonical depth-4 path `m/44'/8478'/{account}'/0'`. `account` must
    /// be below `2^31`.
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

    /// The depth-3 path `m/44'/8478'/{account}'`.
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

    /// Builds a path from raw components (hardened bit included), enforcing
    /// the policy.
    pub fn from_components(components: &[u32]) -> Result<Self, PathError> {
        validate_components(components)?;
        let mut c = [0u32; 4];
        c[..components.len()].copy_from_slice(components);
        Ok(Self {
            // `validate_components` allows only 3 and 4.
            depth: components.len() as u8,
            components: c,
        })
    }

    /// Path depth (3 or 4).
    pub fn depth(&self) -> usize {
        usize::from(self.depth)
    }

    /// Raw components, hardened bit included: what the app takes as
    /// `address_n`.
    pub fn components(&self) -> &[u32] {
        &self.components[..self.depth()]
    }

    /// The account index (component 2 without the hardened bit).
    pub fn account(&self) -> u32 {
        self.components[2] & !HARDENED
    }

    /// Parses `trezor://44'/8478'/0'/0'` (the scheme is case-insensitive; an
    /// optional `m/` after the scheme is accepted).
    pub fn from_uri(uri: &str) -> Result<Self, PathError> {
        let trimmed = uri.trim();
        let rest = strip_trezor_scheme(trimmed)
            .ok_or_else(|| PathError::NotTrezorUri(trimmed.to_string()))?;
        rest.parse()
    }

    /// The canonical URI: `trezor://44'/8478'/0'/0'`.
    pub fn to_uri(&self) -> String {
        let parts: Vec<String> = self
            .components()
            .iter()
            .map(|c| component_string(*c))
            .collect();
        format!("{TREZOR_URI_SCHEME}{}", parts.join("/"))
    }
}

/// If `value` starts with the `trezor://` scheme (case-insensitive), returns
/// the rest.
pub fn strip_trezor_scheme(value: &str) -> Option<&str> {
    let prefix = value.get(..TREZOR_URI_SCHEME.len())?;
    prefix
        .eq_ignore_ascii_case(TREZOR_URI_SCHEME)
        .then(|| &value[TREZOR_URI_SCHEME.len()..])
}

/// Whether `value` is a `trezor://` URI (leading whitespace ignored).
pub fn is_trezor_uri(value: &str) -> bool {
    strip_trezor_scheme(value.trim_start()).is_some()
}

impl FromStr for DerivationPath {
    type Err = PathError;

    /// Parses `m/44'/8478'/0'/0'` or `44'/8478'/0'/0'`. Hardened components use
    /// `'` (or `h`/`H`). Non-hardened components parse and are then rejected by
    /// the policy, so the error names the actual problem.
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
    /// The display form: `m/44'/8478'/0'/0'`.
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
        let p = DerivationPath::new(0).expect("path");
        assert_eq!(p.to_string(), "m/44'/8478'/0'/0'");
        assert_eq!(p.to_uri(), "trezor://44'/8478'/0'/0'");
        assert_eq!(
            p.components(),
            [0x8000_002c, 0x8000_211e, 0x8000_0000, 0x8000_0000]
        );
        assert_eq!(DerivationPath::from_uri(&p.to_uri()).expect("uri"), p);
        assert_eq!(
            "m/44'/8478'/0'/0'"
                .parse::<DerivationPath>()
                .expect("parse"),
            p
        );
    }

    #[test]
    fn max_account_is_accepted() {
        let p = DerivationPath::new(0x7FFF_FFFF).expect("path");
        assert_eq!(p.account(), 0x7FFF_FFFF);
        assert_eq!(p.to_string(), "m/44'/8478'/2147483647'/0'");
        assert!(DerivationPath::new(0x8000_0000).is_err());
    }

    #[test]
    fn depth3_is_accepted() {
        let p: DerivationPath = "m/44'/8478'/5'".parse().expect("parse");
        assert_eq!(p, DerivationPath::new_depth3(5).expect("path"));
        assert_eq!(p.depth(), 3);
        assert_eq!(p.components().len(), 3);
    }

    #[test]
    fn uri_forms() {
        for ok in [
            "trezor://44'/8478'/0'/0'",
            "TREZOR://44'/8478'/0'/0'",
            "  trezor://m/44'/8478'/0'/0'",
            "trezor://44h/8478h/0h/0h",
        ] {
            assert_eq!(
                DerivationPath::from_uri(ok).expect(ok),
                DerivationPath::new(0).expect("path"),
                "{ok}"
            );
            assert!(is_trezor_uri(ok));
        }
        assert!(matches!(
            DerivationPath::from_uri("44'/8478'/0'/0'"),
            Err(PathError::NotTrezorUri(_))
        ));
        assert!(matches!(
            DerivationPath::from_uri("ledger://44'/8478'/0'/0'"),
            Err(PathError::NotTrezorUri(_))
        ));
        assert!(!is_trezor_uri("trezor"));
        assert!(!is_trezor_uri("ledger://44'/8478'/0'/0'"));
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
            let err = s.parse::<DerivationPath>().expect_err(s);
            assert!(check(&err), "{s}: {err:?}");
        }
    }

    #[test]
    fn same_policy_as_the_ledger_app() {
        // The paths the Ledger crate accepts and refuses, so one key has one
        // path on both devices.
        assert!("m/44'/8478'/7'/0'".parse::<DerivationPath>().is_ok());
        assert!("m/44'/8478'/7'".parse::<DerivationPath>().is_ok());
        assert!("m/44'/8478'/7'/1'".parse::<DerivationPath>().is_err());
    }
}
