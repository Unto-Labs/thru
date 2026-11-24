//! Reference-only signing keys. Secrets never enter configuration or command output.

use crate::error::CliError;
use clap::ValueEnum;
use ed25519_dalek::SigningKey;
use rand::{TryRng, rngs::SysRng};
use serde::{
    Deserialize, Serialize,
    de::{self, MapAccess, Visitor},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use thru_base::{
    key_file,
    signer::{LocalSigner, SignError, Signer, SigningMessage},
    tn_tools::Pubkey,
};
use thru_ledger::DerivationPath;
use thru_trezor::DerivationPath as TrezorPath;
use zeroize::Zeroizing;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "org.thru.cli.signing-keys";

fn invalid(message: &str) -> CliError {
    CliError::Validation(message.to_owned())
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, ValueEnum)]
pub enum KeyStorage {
    #[default]
    File,
    Keychain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum KeySource {
    #[serde(rename = "file")]
    File {
        path: PathBuf,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        managed: bool,
    },
    #[serde(rename = "macos-keychain")]
    MacosKeychain { id: String },
    /// A key on a Ledger device at a policy-checked derivation path. The seed
    /// never leaves the device; the entry's `public_key` is the address the
    /// device reported when the key was registered.
    #[serde(rename = "ledger")]
    Ledger {
        #[serde(with = "ledger_path")]
        path: DerivationPath,
    },
    /// A key on a Trezor running the Thru app at a policy-checked derivation
    /// path. The seed never leaves the device; the entry's `public_key` is the
    /// address the device reported when the key was registered. With
    /// `passphrase` the key belongs to a passphrase (hidden) wallet whose
    /// passphrase the person types on the device at every connection; the flag
    /// is written only when set, so an entry of the standard wallet is
    /// unchanged and a CLI that does not know the flag refuses the entry.
    #[serde(rename = "trezor")]
    Trezor {
        #[serde(with = "trezor_path")]
        path: TrezorPath,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        passphrase: bool,
    },
}

/// A Ledger path in config as `44'/8478'/0'/0'`; parsing applies the device
/// path policy, so an invalid path never deserializes.
mod ledger_path {
    use serde::{Deserialize, Deserializer, Serializer, de};
    use thru_ledger::{DerivationPath, LEDGER_URI_SCHEME};

    pub fn serialize<S: Serializer>(path: &DerivationPath, s: S) -> Result<S::Ok, S::Error> {
        let uri = path.to_uri();
        s.serialize_str(uri.strip_prefix(LEDGER_URI_SCHEME).unwrap_or(&uri))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DerivationPath, D::Error> {
        String::deserialize(d)?
            .parse()
            .map_err(|_| de::Error::custom("Invalid Ledger derivation path"))
    }
}

/// A Trezor path in config as `44'/8478'/0'/0'`; parsing applies the app's
/// path policy, so an invalid path never deserializes.
mod trezor_path {
    use serde::{Deserialize, Deserializer, Serializer, de};
    use thru_trezor::{DerivationPath, TREZOR_URI_SCHEME};

    pub fn serialize<S: Serializer>(path: &DerivationPath, s: S) -> Result<S::Ok, S::Error> {
        let uri = path.to_uri();
        s.serialize_str(uri.strip_prefix(TREZOR_URI_SCHEME).unwrap_or(&uri))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DerivationPath, D::Error> {
        String::deserialize(d)?
            .parse()
            .map_err(|_| de::Error::custom("Invalid Trezor derivation path"))
    }
}

impl KeySource {
    fn validate(&self) -> Result<(), CliError> {
        match self {
            Self::File { path, .. } if path.as_os_str().is_empty() || path.to_str().is_none() => {
                Err(invalid("Key file path must be nonempty UTF-8"))
            }
            Self::MacosKeychain { id }
                if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) =>
            {
                Err(invalid(
                    "Keychain ID must be nonempty, at most 256 bytes, and contain no control characters",
                ))
            }
            _ => Ok(()),
        }
    }

    /// The reference of the source alone. For a Trezor key of a passphrase
    /// wallet this is the URI of its path, which selects the standard wallet,
    /// so nothing that is shown to a person may use it for such a key: use
    /// [`registration_reference`].
    pub fn reference(&self) -> String {
        match self {
            Self::File { path, .. } => format!("file:{}", path.display()),
            Self::MacosKeychain { id } => format!("keychain:{id}"),
            Self::Ledger { path } => path.to_uri(),
            Self::Trezor { path, .. } => path.to_uri(),
        }
    }

    /// Whether this is a Trezor key of a passphrase wallet.
    pub fn is_passphrase(&self) -> bool {
        matches!(
            self,
            Self::Trezor {
                passphrase: true,
                ..
            }
        )
    }

    pub fn is_ledger(&self) -> bool {
        matches!(self, Self::Ledger { .. })
    }

    pub fn is_trezor(&self) -> bool {
        matches!(self, Self::Trezor { .. })
    }
}

/// The reference a person can pass back as a key for the registration `alias`
/// holds with `source`. A key of a passphrase wallet is reachable by its alias
/// only (a `trezor://` URI always means the standard wallet), so it is
/// `alias:NAME`; every other key is the reference of its source.
pub fn registration_reference(alias: &str, source: &KeySource) -> String {
    if source.is_passphrase() {
        format!("alias:{}", alias.to_lowercase())
    } else {
        source.reference()
    }
}

/// Where a Trezor key is and what the connection must find there: the path,
/// whether the key belongs to a passphrase wallet, and the public key the key
/// is expected to have. The three travel together, so a connection to a
/// passphrase wallet cannot be opened without saying so, and the expected key
/// of a registration cannot be dropped on the way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrezorTarget {
    path: TrezorPath,
    passphrase: bool,
    expected: Option<[u8; 32]>,
}

impl TrezorTarget {
    /// A key that is not registered (yet): the connection reads its public key.
    pub fn unregistered(path: TrezorPath, passphrase: bool) -> Self {
        Self {
            path,
            passphrase,
            expected: None,
        }
    }

    /// A registered key: the connection must find `public_key`.
    pub fn registered(path: TrezorPath, passphrase: bool, public_key: [u8; 32]) -> Self {
        Self {
            path,
            passphrase,
            expected: Some(public_key),
        }
    }

    pub fn path(&self) -> TrezorPath {
        self.path
    }

    /// Whether the key belongs to a passphrase wallet.
    pub fn passphrase(&self) -> bool {
        self.passphrase
    }

    /// The public key the connection must find, if one is registered.
    pub fn expected(&self) -> Option<[u8; 32]> {
        self.expected
    }

    /// The source a registration of this key stores.
    pub fn source(&self) -> KeySource {
        KeySource::Trezor {
            path: self.path,
            passphrase: self.passphrase,
        }
    }
}

/// Refusal for commands that need a local secret but were given a Ledger key.
fn ledger_unsupported(path: &DerivationPath) -> CliError {
    CliError::Validation(format!(
        "this key is a Ledger key ({}) and this command does not support Ledger signing yet; \
         Ledger keys work with: {}",
        path.to_uri(),
        crate::crypto::LEDGER_CAPABLE_COMMANDS
    ))
}

/// Refusal for commands that need a local secret but were given a Trezor key.
fn trezor_unsupported(path: &TrezorPath, passphrase: bool) -> CliError {
    let which = if passphrase {
        format!("a Trezor key of a passphrase wallet ({path})")
    } else {
        format!("a Trezor key ({})", path.to_uri())
    };
    CliError::Validation(format!(
        "this key is {which} and this command does not support Trezor signing; \
         Trezor keys work with: {}",
        crate::crypto::TREZOR_CAPABLE_COMMANDS
    ))
}

/// The refusal for an operation the Thru app on the Trezor does not offer
/// (`what` completes "the Thru app on the Trezor does not support ...").
pub(crate) fn trezor_app_cannot(what: &str) -> CliError {
    CliError::Validation(format!(
        "the Thru app on the Trezor does not support {what}; use a local or a Ledger key for it"
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyEntry {
    pub public_key: String,
    pub source: KeySource,
}

impl KeyEntry {
    pub fn reference(&self) -> String {
        self.source.reference()
    }

    fn validate(&self) -> Result<(), CliError> {
        parse_stored_public_key(&self.public_key)?;
        self.source.validate()
    }
}

pub struct LoadedKey {
    pub private_key: Zeroizing<[u8; 32]>,
    pub public_key: [u8; 32],
    pub address_string: Pubkey,
}

impl fmt::Debug for LoadedKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoadedKey")
            .field("private_key", &"[REDACTED]")
            .field("public_key", &self.address_string)
            .finish()
    }
}

impl LoadedKey {
    pub(crate) fn from_seed(private_key: Zeroizing<[u8; 32]>) -> Self {
        let public_key = SigningKey::from_bytes(&private_key)
            .verifying_key()
            .to_bytes();
        Self {
            private_key,
            public_key,
            address_string: Pubkey::from_bytes(&public_key),
        }
    }

    fn local_signer(&self) -> LocalSigner {
        LocalSigner::from_seed(*self.private_key)
    }
}

/// A loaded local key signs through the same [`Signer`] path as a Ledger key;
/// every operation delegates to a [`LocalSigner`] over the same seed.
impl Signer for LoadedKey {
    fn public_key(&self) -> [u8; 32] {
        self.public_key
    }
    fn sign(&self, msg: &SigningMessage) -> Result<[u8; 64], SignError> {
        self.local_signer().sign(msg)
    }
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64], SignError> {
        self.local_signer().sign_message(message)
    }
    fn sign_eoa_auth(
        &self,
        kind: thru_base::signer::EoaAuthKind,
        chain_id: u16,
        fee_payer: &[u8; 32],
        account: &[u8; 32],
    ) -> Result<[u8; 64], SignError> {
        self.local_signer()
            .sign_eoa_auth(kind, chain_id, fee_payer, account)
    }
    fn supports_legacy_scheme(&self) -> bool {
        self.local_signer().supports_legacy_scheme()
    }
}

/// A command's cache ignores registration ownership metadata: aliases and
/// direct selectors for one backing secret must share the loaded identity.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum SourceIdentity {
    File(PathBuf),
    Keychain(String),
}

#[derive(Debug, Default)]
struct CommandKeys(Mutex<BTreeMap<SourceIdentity, Arc<LoadedKey>>>);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(transparent)]
pub struct KeyManager {
    keys: BTreeMap<String, KeyEntry>,
    #[serde(skip)]
    base_dir: PathBuf,
    #[serde(skip)]
    command_keys: Option<Arc<CommandKeys>>,
    /// Lowercased names of legacy inline entries left in the config file. Only
    /// the names are kept; the seeds stay in the file until `thru keys migrate`.
    #[serde(skip)]
    unmigrated: BTreeSet<String>,
}

pub(crate) const UNQUOTED_SEED_ERROR: &str = "Unquoted numeric signing key; quote the ORIGINAL seed digits in YAML before running 'thru keys migrate'. Do not use a rounded or converted number";

// An explicit visitor prevents serde's invalid-type diagnostic from echoing an
// old inline seed. Migration is the only consumer allowed to retain that seed.
pub(crate) enum StoredEntry {
    Reference(KeyEntry),
    Inline(Zeroizing<String>),
    UnquotedNumber,
}

impl<'de> Deserialize<'de> for StoredEntry {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EntryVisitor;
        impl<'de> Visitor<'de> for EntryVisitor {
            type Value = StoredEntry;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a signing key reference")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(StoredEntry::Inline(Zeroizing::new(value.to_owned())))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(StoredEntry::Inline(Zeroizing::new(value)))
            }
            // Numeric deserializers may already have rounded the original YAML
            // scalar. Retain neither the value nor a reconstructed seed.
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(StoredEntry::UnquotedNumber)
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(StoredEntry::UnquotedNumber)
            }
            fn visit_i128<E: de::Error>(self, _: i128) -> Result<Self::Value, E> {
                Ok(StoredEntry::UnquotedNumber)
            }
            fn visit_u128<E: de::Error>(self, _: u128) -> Result<Self::Value, E> {
                Ok(StoredEntry::UnquotedNumber)
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(StoredEntry::UnquotedNumber)
            }
            fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<Self::Value, M::Error> {
                KeyEntry::deserialize(de::value::MapAccessDeserializer::new(map))
                    .map(StoredEntry::Reference)
                    .map_err(|_| de::Error::custom("Invalid signing key reference metadata"))
            }
        }
        deserializer.deserialize_any(EntryVisitor)
    }
}

#[derive(Default)]
pub(crate) struct MigrationKeys(pub BTreeMap<String, StoredEntry>);

impl<'de> Deserialize<'de> for MigrationKeys {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct KeysVisitor;
        impl<'de> Visitor<'de> for KeysVisitor {
            type Value = MigrationKeys;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a map of signing key references")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut keys = BTreeMap::new();
                while let Some((name, entry)) = map.next_entry::<String, StoredEntry>()? {
                    if keys.insert(name.to_lowercase(), entry).is_some() {
                        return Err(de::Error::custom(
                            "Duplicate case-insensitive signing key alias",
                        ));
                    }
                }
                Ok(MigrationKeys(keys))
            }
        }
        deserializer.deserialize_map(KeysVisitor)
    }
}

impl<'de> Deserialize<'de> for KeyManager {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let entries = MigrationKeys::deserialize(deserializer)?;
        let mut manager = Self::new();
        for (name, entry) in entries.0 {
            match entry {
                StoredEntry::Reference(entry) => manager
                    .insert_migrated_entry(&name, entry, false)
                    .map_err(|_| de::Error::custom("Invalid signing key reference metadata"))?,
                StoredEntry::Inline(_) => {
                    return Err(de::Error::custom(
                        "Inline signing keys are no longer supported; run 'thru keys migrate'",
                    ));
                }
                StoredEntry::UnquotedNumber => {
                    return Err(de::Error::custom(UNQUOTED_SEED_ERROR));
                }
            }
        }
        Ok(manager)
    }
}

impl KeyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a fresh invocation. Subsequent clones share its loaded identities;
    /// ordinary library managers remain uncached unless explicitly opted in.
    pub fn begin_command(&mut self) {
        self.command_keys = Some(Arc::new(CommandKeys::default()));
    }

    pub fn set_base_dir(&mut self, directory: PathBuf) {
        self.base_dir = directory;
    }

    /// Record the aliases of legacy inline entries (names only, never seeds).
    pub(crate) fn set_unmigrated(&mut self, names: impl IntoIterator<Item = String>) {
        self.unmigrated = names.into_iter().map(|name| name.to_lowercase()).collect();
    }

    /// Aliases still stored inline in the config file, for notices and
    /// `keys list`. Names that look like key material are shown as "(hidden)".
    pub fn unmigrated_aliases(&self) -> Vec<String> {
        self.unmigrated
            .iter()
            .map(|name| {
                if looks_like_key_material(name) {
                    "(hidden)".to_string()
                } else {
                    name.clone()
                }
            })
            .collect()
    }

    /// Lookup failure for `name`, pointing at migration when the alias is
    /// still stored inline rather than reporting it as unknown.
    fn not_found(&self, name: &str) -> CliError {
        if !self.unmigrated.contains(&name.to_lowercase()) {
            return Self::missing_alias(name);
        }
        let alias = if looks_like_key_material(name) {
            String::new()
        } else {
            format!(" {name:?}")
        };
        invalid(&format!(
            "Signing key alias{alias} is still stored inline in the CLI config; run 'thru keys migrate' (or 'thru keys migrate --store keychain' on macOS) to use it"
        ))
    }

    pub fn list_keys(&self) -> Vec<String> {
        self.keys.keys().cloned().collect()
    }

    pub fn has_key(&self, name: &str) -> bool {
        self.keys.contains_key(&name.to_lowercase())
    }

    pub fn is_default_key_name(name: &str) -> bool {
        name.eq_ignore_ascii_case("default")
    }

    pub fn validate_name(name: &str) -> Result<(), CliError> {
        if name.is_empty()
            || name.trim() != name
            || name.chars().any(char::is_control)
            || explicit_source(name)?.is_some()
            || name.contains(':')
            || (name.strip_prefix("0x").unwrap_or(name).len() == 64
                && name
                    .strip_prefix("0x")
                    .unwrap_or(name)
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit()))
            || Pubkey::new(name.to_owned()).is_ok()
        {
            return Err(invalid(
                "Key aliases cannot be empty, public keys, or reserved file/keychain selectors",
            ));
        }
        Ok(())
    }

    fn missing_alias(name: &str) -> CliError {
        if Self::is_default_key_name(name) {
            return invalid(
                "Default signing key alias 'default' not found; run 'thru keys generate default' or select an existing signer",
            );
        }
        // Never echo input that looks like key material: a run of 16 or more
        // hex digits anywhere (covers an optional 0x, selector prefixes, and
        // truncated seeds of any length). Any other syntactically valid alias
        // is named regardless of length.
        if looks_like_key_material(name) {
            return invalid(
                "Signing key alias not found; raw private keys are not signer references. Use 'thru keys list' or import with 'thru keys add <name> --stdin'",
            );
        }
        invalid(&format!(
            "Signing key alias {name:?} not found; use 'thru keys list' or 'thru keys generate <name>'"
        ))
    }

    pub fn get_entry(&self, name: &str) -> Result<&KeyEntry, CliError> {
        self.keys
            .get(&name.to_lowercase())
            .ok_or_else(|| self.not_found(name))
    }

    pub fn insert_entry(
        &mut self,
        name: &str,
        entry: KeyEntry,
        overwrite: bool,
    ) -> Result<(), CliError> {
        Self::validate_name(name)?;
        self.insert_migrated_entry(name, entry, overwrite)
    }

    /// Preserve previously legal aliases during explicit legacy migration.
    pub(crate) fn insert_migrated_entry(
        &mut self,
        name: &str,
        mut entry: KeyEntry,
        overwrite: bool,
    ) -> Result<(), CliError> {
        entry.validate()?;
        entry.public_key =
            Pubkey::from_bytes(&parse_stored_public_key(&entry.public_key)?).to_string();
        let name = name.to_lowercase();
        if self.keys.contains_key(&name) && !overwrite {
            return Err(invalid(
                "Signing key alias already exists; use --overwrite to replace it",
            ));
        }
        self.keys.insert(name, entry);
        Ok(())
    }

    pub fn remove_key(&mut self, name: &str) -> Result<KeyEntry, CliError> {
        let removed = self.keys.remove(&name.to_lowercase());
        removed.ok_or_else(|| self.not_found(name))
    }

    pub(crate) fn validate_all_keys(&self) -> Result<(), CliError> {
        for entry in self.keys.values() {
            entry.validate()?;
        }
        Ok(())
    }

    pub(crate) fn resolved_source(&self, entry: &KeyEntry) -> KeySource {
        match &entry.source {
            KeySource::File { path, managed } => KeySource::File {
                path: self.base_dir.join(path),
                managed: *managed,
            },
            source => source.clone(),
        }
    }

    fn load_resolved_source(&self, source: &KeySource) -> Result<Arc<LoadedKey>, CliError> {
        let Some(command) = &self.command_keys else {
            return load_source(source).map(Arc::new);
        };
        let identity = match source {
            KeySource::Ledger { path } => return Err(ledger_unsupported(path)),
            KeySource::Trezor { path, passphrase } => {
                return Err(trezor_unsupported(path, *passphrase));
            }
            KeySource::File { path, .. } => {
                let absolute = if path.is_absolute() {
                    path.clone()
                } else {
                    std::env::current_dir()?.join(path)
                };
                // Components remove redundant "." without resolving symlinks or
                // re-opening a file whose identity is already pinned.
                SourceIdentity::File(absolute.components().collect())
            }
            KeySource::MacosKeychain { id } => SourceIdentity::Keychain(id.clone()),
        };
        let mut loaded = command
            .0
            .lock()
            .map_err(|_| invalid("Signing key command cache is unavailable"))?;
        if let Some(key) = loaded.get(&identity) {
            return Ok(Arc::clone(key));
        }
        // Keep the lock through loading so concurrent clones never read the
        // same Keychain item twice or observe different file identities.
        let key = Arc::new(load_source(source)?);
        loaded.insert(identity, Arc::clone(&key));
        Ok(key)
    }

    pub fn load_fee_payer(&self, reference: Option<&str>) -> Result<Arc<LoadedKey>, CliError> {
        self.load_key(reference.unwrap_or("default"))
    }

    pub fn load_key(&self, reference: &str) -> Result<Arc<LoadedKey>, CliError> {
        let alias = reference.strip_prefix("alias:");
        if alias.is_none() && parse_public_key(reference).is_ok() {
            return Err(invalid(
                "A public key is not a signer reference; select a registered alias, file, or Keychain item. Use 'alias:<name>' for a legacy address-shaped alias",
            ));
        }
        let (source, expected) = match if alias.is_some() {
            None
        } else {
            explicit_source(reference)?
        } {
            Some(source) => (source, None),
            None => {
                let entry = self.get_entry(alias.unwrap_or(reference))?;
                (
                    self.resolved_source(entry),
                    Some(parse_stored_public_key(&entry.public_key)?),
                )
            }
        };
        let key = self.load_resolved_source(&source)?;
        if expected.is_some_and(|expected| key.public_key != expected) {
            return Err(invalid(
                "Signing key does not match its registered public key; registration was not changed",
            ));
        }
        Ok(key)
    }

    pub fn public_key(&self, reference: &str) -> Result<[u8; 32], CliError> {
        if let Some(alias) = reference.strip_prefix("alias:") {
            return parse_stored_public_key(&self.get_entry(alias)?.public_key);
        }
        if parse_public_key(reference).is_ok() {
            return Err(invalid(
                "A public key is not a signing key alias; use 'alias:<name>' for a legacy address-shaped alias",
            ));
        }
        if let Some(source) = explicit_source(reference)? {
            return self.source_public_key(&source);
        }
        parse_stored_public_key(&self.get_entry(reference)?.public_key)
    }

    pub fn resolve_public_key(&self, input: &str) -> Result<[u8; 32], CliError> {
        if let Some(alias) = input.strip_prefix("alias:") {
            return parse_stored_public_key(&self.get_entry(alias)?.public_key);
        }
        if let Some(source) = explicit_source(input)? {
            return self.source_public_key(&source);
        }
        // Address-shaped legacy aliases need an explicit alias selector; never
        // silently reinterpret an address as a different registered identity.
        if let Ok(public_key) = parse_public_key(input) {
            return Ok(public_key);
        }
        if let Some(entry) = self.keys.get(&input.to_lowercase()) {
            return parse_stored_public_key(&entry.public_key);
        }
        if (input.starts_with("ta") && input.len() == 46)
            || input.strip_prefix("0x").unwrap_or(input).len() == 64
        {
            return Err(invalid(
                "Invalid destination public address; use a valid Thru address, 64 hexadecimal public-key characters, or 'alias:<name>' for a registered alias",
            ));
        }
        Err(self.not_found(input))
    }

    /// Public key of an explicit (unregistered) source. A `ledger://` path uses
    /// the address registered for that path when there is one, and otherwise
    /// asks the device (no on-device confirmation).
    fn source_public_key(&self, source: &KeySource) -> Result<[u8; 32], CliError> {
        if let KeySource::Ledger { path } = source {
            if let Some(public_key) = self.registered_ledger_public_key(path)? {
                return Ok(public_key);
            }
            return Ok(crate::signing::connect_ledger(*path, None)?.pubkey());
        }
        if let KeySource::Trezor { path, .. } = source {
            // A URI is the standard wallet, whatever flag the source carries.
            if let Some(public_key) = self.registered_trezor_public_key(path)? {
                return Ok(public_key);
            }
            return Ok(
                crate::signing::connect_trezor(TrezorTarget::unregistered(*path, false))?.pubkey(),
            );
        }
        self.load_resolved_source(source).map(|key| key.public_key)
    }

    /// The Ledger path and expected public key when `reference` selects a
    /// Ledger key: a registered Ledger alias (expecting its registered public
    /// key) or an explicit `ledger://…` source (expecting the public key
    /// registered for that path, if any). `None` for every other reference;
    /// [`Self::load_key`] reports their errors.
    pub fn ledger_source(
        &self,
        reference: &str,
    ) -> Result<Option<(DerivationPath, Option<[u8; 32]>)>, CliError> {
        let entry = match reference.strip_prefix("alias:") {
            Some(alias) => self.keys.get(&alias.to_lowercase()),
            None if parse_public_key(reference).is_ok() => return Ok(None),
            None => match explicit_source(reference)? {
                Some(KeySource::Ledger { path }) => {
                    return Ok(Some((path, self.registered_ledger_public_key(&path)?)));
                }
                Some(_) => return Ok(None),
                None => self.keys.get(&reference.to_lowercase()),
            },
        };
        match entry {
            Some(KeyEntry {
                public_key,
                source: KeySource::Ledger { path },
            }) => Ok(Some((*path, Some(parse_stored_public_key(public_key)?)))),
            _ => Ok(None),
        }
    }

    /// The Trezor key `reference` selects: a registered Trezor alias (expecting
    /// its registered public key, and carrying its passphrase flag) or an
    /// explicit `trezor://…` source (the standard wallet, expecting the public
    /// key registered for that path, if any). `None` for every other
    /// reference.
    pub fn trezor_source(&self, reference: &str) -> Result<Option<TrezorTarget>, CliError> {
        let entry = match reference.strip_prefix("alias:") {
            Some(alias) => self.keys.get(&alias.to_lowercase()),
            None if parse_public_key(reference).is_ok() => return Ok(None),
            None => match explicit_source(reference)? {
                Some(KeySource::Trezor { path, .. }) => {
                    return Ok(Some(match self.registered_trezor_public_key(&path)? {
                        Some(public_key) => TrezorTarget::registered(path, false, public_key),
                        None => TrezorTarget::unregistered(path, false),
                    }));
                }
                Some(_) => return Ok(None),
                None => self.keys.get(&reference.to_lowercase()),
            },
        };
        match entry {
            Some(KeyEntry {
                public_key,
                source: KeySource::Trezor { path, passphrase },
            }) => Ok(Some(TrezorTarget::registered(
                *path,
                *passphrase,
                parse_stored_public_key(public_key)?,
            ))),
            _ => Ok(None),
        }
    }

    /// The public key registered for a Trezor path of the standard wallet; as
    /// for Ledger paths, aliases of one path that record different public keys
    /// make a raw `trezor://` reference ambiguous, which is an error naming
    /// them. Keys of passphrase wallets are not looked at: a URI never means
    /// one of them, and with only such keys on the path it is as if nothing
    /// were registered for it.
    fn registered_trezor_public_key(
        &self,
        path: &TrezorPath,
    ) -> Result<Option<[u8; 32]>, CliError> {
        let matches: Vec<(&String, &String)> = self
            .keys
            .iter()
            .filter(|(_, entry)| {
                matches!(
                    &entry.source,
                    KeySource::Trezor { path: p, passphrase: false } if p == path
                )
            })
            .map(|(name, entry)| (name, &entry.public_key))
            .collect();
        let mut distinct: Vec<&String> = matches.iter().map(|(_, key)| *key).collect();
        distinct.sort();
        distinct.dedup();
        if distinct.len() > 1 {
            let names: Vec<String> = matches
                .iter()
                .map(|(name, key)| format!("'{name}' ({key})"))
                .collect();
            return Err(invalid(&format!(
                "Trezor key source '{}' matches several registered keys with different public keys: {}. Use the key alias instead of the trezor:// URI.",
                path.to_uri(),
                names.join(", ")
            )));
        }
        distinct
            .first()
            .map(|key| parse_stored_public_key(key))
            .transpose()
    }

    /// The public key registered for a Ledger path, looked up in alias order.
    /// Aliases of one path that record different public keys (keys registered
    /// from two devices or passphrases) make a raw `ledger://` reference
    /// ambiguous, which is an error naming them rather than an arbitrary pick
    /// (audit A-040 / A-041).
    fn registered_ledger_public_key(
        &self,
        path: &DerivationPath,
    ) -> Result<Option<[u8; 32]>, CliError> {
        let matches: Vec<(&String, &String)> = self
            .keys
            .iter()
            .filter(
                |(_, entry)| matches!(&entry.source, KeySource::Ledger { path: p } if p == path),
            )
            .map(|(name, entry)| (name, &entry.public_key))
            .collect();
        let mut distinct: Vec<&String> = matches.iter().map(|(_, key)| *key).collect();
        distinct.sort();
        distinct.dedup();
        if distinct.len() > 1 {
            let names: Vec<String> = matches
                .iter()
                .map(|(name, key)| format!("'{name}' ({key})"))
                .collect();
            return Err(invalid(&format!(
                "Ledger key source '{}' matches several registered keys with different public keys: {}. Use the key alias instead of the ledger:// URI.",
                path.to_uri(),
                names.join(", ")
            )));
        }
        distinct
            .first()
            .map(|key| parse_stored_public_key(key))
            .transpose()
    }

    #[cfg(test)]
    pub fn test_fixture(seeds: &[(&str, [u8; 32])]) -> (tempfile::TempDir, Self) {
        let directory = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut manager = Self::new();
        manager.set_base_dir(directory.path().to_owned());
        for (name, seed) in seeds {
            let key = LoadedKey::from_seed(Zeroizing::new(*seed));
            let mut staged = stage_secret(KeyStorage::File, directory.path(), &key).unwrap();
            manager
                .insert_entry(name, staged.entry.clone(), false)
                .unwrap();
            staged.commit();
        }
        (directory, manager)
    }
}

fn explicit_source(reference: &str) -> Result<Option<KeySource>, CliError> {
    let source = if thru_ledger::is_ledger_uri(reference) {
        let path = DerivationPath::from_uri(reference).map_err(|error| {
            invalid(&format!(
                "Invalid Ledger key source '{}': {error}",
                reference.trim()
            ))
        })?;
        Some(KeySource::Ledger { path })
    } else if thru_trezor::is_trezor_uri(reference) {
        let path = TrezorPath::from_uri(reference).map_err(|error| {
            invalid(&format!(
                "Invalid Trezor key source '{}': {error}",
                reference.trim()
            ))
        })?;
        Some(KeySource::Trezor {
            path,
            passphrase: false,
        })
    } else if let Some(id) = reference.strip_prefix("keychain:") {
        Some(KeySource::MacosKeychain { id: id.to_owned() })
    } else if let Some(path) = reference.strip_prefix("file:") {
        Some(KeySource::File {
            path: path.into(),
            managed: false,
        })
    } else if Path::new(reference).is_absolute()
        || reference.starts_with("./")
        || reference.starts_with("../")
    {
        Some(KeySource::File {
            path: reference.into(),
            managed: false,
        })
    } else {
        None
    };
    if let Some(source) = &source {
        source.validate()?;
    }
    Ok(source)
}

/// True when the input contains a run of 16 or more hex digits, i.e. may be (part of) a seed.
fn looks_like_key_material(input: &str) -> bool {
    input
        .as_bytes()
        .split(|byte| !byte.is_ascii_hexdigit())
        .any(|run| run.len() >= 16)
}

/// Stored `public_key` metadata must be the canonical `ta` address, the only
/// form every config reader accepts. The error never echoes the value.
fn parse_stored_public_key(input: &str) -> Result<[u8; 32], CliError> {
    Pubkey::new(input.to_owned())
        .and_then(|key| key.to_bytes())
        .map_err(|_| invalid("Invalid public key metadata; expected a canonical 'ta' address"))
}

fn parse_public_key(input: &str) -> Result<[u8; 32], CliError> {
    let input = input.strip_prefix("0x").unwrap_or(input);
    if input.len() == 64 {
        let mut bytes = [0; 32];
        if hex::decode_to_slice(input, &mut bytes).is_ok() {
            return Ok(bytes);
        }
    }
    Pubkey::new(input.to_owned())
        .and_then(|key| key.to_bytes())
        .map_err(|_| invalid("Invalid public key metadata or public address"))
}

pub(crate) fn decode_seed(raw: &[u8]) -> Result<Zeroizing<[u8; 32]>, CliError> {
    key_file::decode_seed(raw).map_err(Into::into)
}

pub(crate) fn generate_seed() -> Result<Zeroizing<[u8; 32]>, CliError> {
    let mut seed = Zeroizing::new([0; 32]);
    SysRng
        .try_fill_bytes(seed.as_mut())
        .map_err(|_| invalid("Could not obtain secure randomness"))?;
    Ok(seed)
}

fn unique_id() -> Result<String, CliError> {
    let mut bytes = [0; 16];
    SysRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| invalid("Could not obtain secure randomness"))?;
    Ok(hex::encode(bytes))
}

pub(crate) fn private_directory(directory: &Path) -> Result<(), CliError> {
    key_file::ensure_private_dir(directory)?;
    Ok(())
}

pub(crate) fn open_key_file(path: &Path) -> Result<File, CliError> {
    key_file::open_key_file(path).map_err(Into::into)
}

pub(crate) fn read_seed(reader: impl Read) -> Result<Zeroizing<[u8; 32]>, CliError> {
    key_file::read_seed(reader).map_err(Into::into)
}

fn file_error(path: &Path, error: std::io::Error) -> CliError {
    std::io::Error::new(
        error.kind(),
        format!("Signing key file {}: {error}", path.display()),
    )
    .into()
}

pub(crate) fn load_source(source: &KeySource) -> Result<LoadedKey, CliError> {
    source.validate()?;
    let seed = match source {
        KeySource::File { path, .. } => {
            key_file::read_seed(open_key_file(path)?).map_err(|error| file_error(path, error))?
        }
        KeySource::MacosKeychain { id } => keychain_read(id)?,
        KeySource::Ledger { path } => return Err(ledger_unsupported(path)),
        KeySource::Trezor { path, passphrase } => {
            return Err(trezor_unsupported(path, *passphrase));
        }
    };
    Ok(LoadedKey::from_seed(seed))
}

/// A newly-created, unique secret. Until commit, failure or unwinding removes
/// only this new secret; an overwritten alias's old secret is never destroyed.
pub(crate) struct StagedSecret {
    pub entry: KeyEntry,
    committed: bool,
}

impl StagedSecret {
    pub fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for StagedSecret {
    fn drop(&mut self) {
        if !self.committed {
            if let Err(error) = delete_source(&self.entry.source) {
                eprintln!(
                    "Could not clean up unregistered signing key {}: {error}",
                    self.entry.reference()
                );
            }
        }
    }
}

pub(crate) fn stage_secret(
    store: KeyStorage,
    directory: &Path,
    key: &LoadedKey,
) -> Result<StagedSecret, CliError> {
    let source = match store {
        KeyStorage::File => {
            private_directory(directory)?;
            let path = directory.join(format!("{}.key", unique_id()?));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            }
            let mut file = options
                .open(&path)
                .map_err(|error| file_error(&path, error))?;
            // Version-1 JSON key file (see thru_base::key_file).
            let encoded = key_file::encode_key_file(&key.private_key);
            let result = file
                .write_all(encoded.as_bytes())
                .and_then(|_| file.sync_all());
            drop(file);
            if let Err(error) = result {
                let _ = fs::remove_file(&path);
                return Err(file_error(&path, error));
            }
            #[cfg(unix)]
            if let Err(error) = File::open(directory).and_then(|directory| directory.sync_all()) {
                let _ = fs::remove_file(&path);
                return Err(file_error(directory, error));
            }
            KeySource::File {
                path,
                managed: true,
            }
        }
        KeyStorage::Keychain => {
            let id = unique_id()?;
            keychain_create(&id, &key.private_key, &key.address_string.to_string())?;
            KeySource::MacosKeychain { id }
        }
    };
    let staged = StagedSecret {
        entry: KeyEntry {
            public_key: key.address_string.to_string(),
            source,
        },
        committed: false,
    };
    if load_source(&staged.entry.source)?.public_key != key.public_key {
        return Err(invalid("Stored signing key failed read-back verification"));
    }
    Ok(staged)
}

/// Rewrite a legacy hex key file as version-1 JSON in place: a temp file in the
/// same directory, fsync, rename over the original, directory fsync, read-back.
/// Returns false when the file is already JSON. The caller holds the config lock
/// and passes only CLI-managed files.
pub(crate) fn convert_key_file_to_json(path: &Path, public_key: &str) -> Result<bool, CliError> {
    let (seed, format) =
        key_file::read_key_file(open_key_file(path)?).map_err(|error| file_error(path, error))?;
    if format == key_file::KeyFileFormat::Json {
        return Ok(false);
    }
    let key = LoadedKey::from_seed(seed);
    if key.address_string.to_string() != public_key {
        return Err(invalid(
            "Signing key file does not match its registered public key; left unchanged",
        ));
    }
    let directory = path.parent().unwrap_or(Path::new("."));
    let temp = directory.join(format!(".{}.tmp", unique_id()?));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let written = (|| -> std::io::Result<()> {
        let mut file = options.open(&temp)?;
        file.write_all(key_file::encode_key_file(&key.private_key).as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        #[cfg(unix)]
        File::open(directory)?.sync_all()?;
        Ok(())
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(file_error(path, error));
    }
    let (check, format) =
        key_file::read_key_file(open_key_file(path)?).map_err(|error| file_error(path, error))?;
    if format != key_file::KeyFileFormat::Json || *check != *key.private_key {
        return Err(invalid(
            "Converted signing key file failed read-back verification",
        ));
    }
    Ok(true)
}

pub(crate) fn delete_source(source: &KeySource) -> Result<(), CliError> {
    match source {
        KeySource::File { path, .. } => {
            let _file = open_key_file(path)?;
            fs::remove_file(path).map_err(|error| file_error(path, error))?;
            Ok(())
        }
        KeySource::MacosKeychain { id } => keychain_delete(id),
        KeySource::Ledger { .. } => Err(invalid(
            "A Ledger key's secret stays on the device; there is nothing to delete",
        )),
        KeySource::Trezor { .. } => Err(invalid(
            "A Trezor key's secret stays on the device; there is nothing to delete",
        )),
    }
}

#[cfg(target_os = "macos")]
fn keychain_call<T: Send>(
    operation: impl FnOnce() -> Result<T, CliError> + Send,
) -> Result<T, CliError> {
    // Keychain APIs may present UI or wait on securityd. The synchronous signer
    // API bridges via an OS thread; async management uses spawn_blocking too.
    let run = || {
        std::thread::scope(|scope| scope.spawn(operation).join())
            .map_err(|_| invalid("macOS Keychain operation failed"))?
    };
    if tokio::runtime::Handle::try_current()
        .is_ok_and(|handle| handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread)
    {
        tokio::task::block_in_place(run)
    } else {
        run()
    }
}

#[cfg(target_os = "macos")]
fn keychain_error(operation: &str, error: impl fmt::Display) -> CliError {
    invalid(&format!(
        "macOS Keychain {operation} failed (no file fallback): {error}"
    ))
}

#[cfg(target_os = "macos")]
fn keychain_read(id: &str) -> Result<Zeroizing<[u8; 32]>, CliError> {
    keychain_call(|| {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, id)
            .map_err(|error| keychain_error("open", error))?;
        let bytes = Zeroizing::new(
            entry
                .get_secret()
                .map_err(|error| keychain_error("read", error))?,
        );
        if bytes.len() != 32 {
            return Err(invalid(
                "macOS Keychain signing secret must be exactly 32 raw bytes",
            ));
        }
        let mut seed = Zeroizing::new([0; 32]);
        seed.copy_from_slice(&bytes);
        Ok(seed)
    })
}

/// The item's comment holds the key's public address (public metadata only), so
/// the otherwise opaque random-ID item can be identified in Keychain Access.
#[cfg(target_os = "macos")]
fn keychain_create(id: &str, seed: &[u8; 32], address: &str) -> Result<(), CliError> {
    keychain_call(|| {
        use core_foundation::data::CFData;
        use security_framework::item::{ItemAddOptions, ItemAddValue, ItemClass, Location};
        use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|error| keychain_error("open", error))?;
        // CFData borrows a zeroizing copy of the seed, wiped when CF releases it.
        let data = CFData::from_arc(Arc::new(Zeroizing::new(*seed)));
        let mut options = ItemAddOptions::new(ItemAddValue::Data {
            class: ItemClass::generic_password(),
            data,
        });
        options
            .set_location(Location::FileKeychain(keychain))
            .set_service(KEYCHAIN_SERVICE)
            .set_account_name(id)
            .set_label(KEYCHAIN_SERVICE)
            .set_comment(address);
        // Unlike set_secret, SecItemAdd is atomic create-only: an existing
        // credential is never overwritten, even if a random ID collided.
        options
            .add()
            .map_err(|error| keychain_error("create", error))
    })
}

#[cfg(target_os = "macos")]
fn keychain_delete(id: &str) -> Result<(), CliError> {
    keychain_call(|| {
        security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, id)
            .map_err(|error| keychain_error("delete", error))
    })
}

/// Outcome of giving an existing Keychain item its public-address comment.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommentBackfill {
    /// The item had no comment; the public address was added.
    Added,
    /// The item already has a comment, which is never replaced.
    AlreadySet,
    /// No Keychain item has this ID.
    Missing,
}

#[cfg(target_os = "macos")]
impl CommentBackfill {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::AlreadySet => "already_set",
            Self::Missing => "missing",
        }
    }
}

/// Give an item created before address comments existed its public address as
/// the comment. Reads attributes only (never the secret) and never replaces an
/// existing comment.
#[cfg(target_os = "macos")]
pub(crate) fn keychain_backfill_comment(
    id: &str,
    address: &str,
) -> Result<CommentBackfill, CliError> {
    keychain_call(|| {
        use security_framework::item::{
            ItemClass, ItemSearchOptions, ItemUpdateOptions, update_item,
        };
        const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
        let query = || {
            let mut search = ItemSearchOptions::new();
            search
                .class(ItemClass::generic_password())
                .service(KEYCHAIN_SERVICE)
                .account(id);
            search
        };
        let found = match query().load_attributes(true).search() {
            Ok(found) => found,
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
                return Ok(CommentBackfill::Missing);
            }
            Err(error) => return Err(keychain_error("lookup", error)),
        };
        let Some(attributes) = found.first().and_then(|item| item.simplify_dict()) else {
            return Ok(CommentBackfill::Missing);
        };
        if attributes
            .get("icmt")
            .is_some_and(|comment| !comment.is_empty())
        {
            return Ok(CommentBackfill::AlreadySet);
        }
        let mut update = ItemUpdateOptions::new();
        update.set_comment(address);
        update_item(&query(), &update).map_err(|error| keychain_error("update", error))?;
        Ok(CommentBackfill::Added)
    })
}

#[cfg(not(target_os = "macos"))]
fn keychain_read(_: &str) -> Result<Zeroizing<[u8; 32]>, CliError> {
    Err(invalid(
        "Signing keychain storage is available only on macOS; no file fallback is used",
    ))
}
#[cfg(not(target_os = "macos"))]
fn keychain_create(_: &str, _: &[u8; 32], _: &str) -> Result<(), CliError> {
    Err(invalid(
        "Signing keychain storage is available only on macOS; no file fallback is used",
    ))
}
#[cfg(not(target_os = "macos"))]
fn keychain_delete(_: &str) -> Result<(), CliError> {
    Err(invalid(
        "Signing keychain storage is available only on macOS; no file fallback is used",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_aliases_and_public_metadata() {
        let (_directory, manager) = KeyManager::test_fixture(&[("Alice", [7; 32])]);
        let entry = manager.get_entry("ALICE").unwrap();
        let key = manager.load_key("alice").unwrap();
        assert_eq!(manager.list_keys(), vec!["alice"]);
        assert_eq!(
            manager.load_key(&entry.reference()).unwrap().public_key,
            key.public_key
        );
        assert_eq!(
            manager.resolve_public_key(&entry.public_key).unwrap(),
            key.public_key
        );
        assert_eq!(
            manager
                .resolve_public_key(&hex::encode(key.public_key))
                .unwrap(),
            key.public_key
        );
        assert_eq!(
            manager
                .resolve_public_key(&format!("0x{}", hex::encode(key.public_key)))
                .unwrap(),
            key.public_key
        );
        assert!(manager.load_key(&hex::encode([7; 32])).is_err());
        assert!(manager.load_key("file:/missing/key").is_err());
        assert!(manager.load_key("keychain:").is_err());
        assert!(manager.load_key("file:").is_err());
        for alias in ["file:x", "keychain:x", "./x", "../x", "/x", "", " default"] {
            assert!(KeyManager::validate_name(alias).is_err());
        }
    }

    #[test]
    fn relative_registered_paths_use_config_directory_not_cwd() {
        let (directory, mut manager) = KeyManager::test_fixture(&[("default", [8; 32])]);
        let mut entry = manager.get_entry("default").unwrap().clone();
        if let KeySource::File { path, .. } = &mut entry.source {
            *path = path.file_name().unwrap().into();
        }
        manager
            .insert_entry("default", entry.clone(), true)
            .unwrap();
        assert!(manager.load_key("default").is_ok());
        assert!(manager.load_key(&entry.reference()).is_err());
        manager.set_base_dir(directory.path().join("absent"));
        assert!(manager.load_key("default").is_err());
    }

    #[test]
    fn public_lookups_never_open_secret_and_signing_rejects_mismatch() {
        let (_directory, mut manager) =
            KeyManager::test_fixture(&[("default", [1; 32]), ("other", [2; 32])]);
        let mut entry = manager.get_entry("default").unwrap().clone();
        entry.public_key = manager.get_entry("other").unwrap().public_key.clone();
        manager
            .insert_entry("default", entry.clone(), true)
            .unwrap();
        assert!(manager.load_key("default").is_err());
        delete_source(&entry.source).unwrap();
        assert_eq!(
            manager.public_key("default").unwrap(),
            manager.public_key("other").unwrap()
        );
        assert!(manager.load_key("default").is_err());
    }

    #[test]
    fn serialization_and_errors_never_disclose_seed() {
        let seed = hex::encode([31; 32]);
        let (_directory, manager) = KeyManager::test_fixture(&[("default", [31; 32])]);
        assert!(!serde_json::to_string(&manager).unwrap().contains(&seed));
        assert!(!serde_yaml::to_string(&manager).unwrap().contains(&seed));
        assert!(!format!("{:?}", manager.load_key("default").unwrap()).contains(&seed));
        let error = serde_yaml::from_str::<KeyManager>(&format!("default: '{seed}'")).unwrap_err();
        assert!(!error.to_string().contains(&seed));
        assert!(serde_yaml::from_str::<KeyManager>("Alice: {}\nalice: {}\n").is_err());
        assert!(KeyManager::new().list_keys().is_empty());
    }

    #[test]
    fn numeric_legacy_seeds_require_original_quoted_digits() {
        let seed = "19".repeat(32);
        for number in [seed.as_str(), "1234", "-1234", "1.25"] {
            let yaml = format!("default: {number}\n");
            let migration: MigrationKeys = serde_yaml::from_str(&yaml).unwrap();
            assert!(matches!(
                migration.0.get("default"),
                Some(StoredEntry::UnquotedNumber)
            ));
            let error = serde_yaml::from_str::<KeyManager>(&yaml)
                .unwrap_err()
                .to_string();
            assert!(error.contains(UNQUOTED_SEED_ERROR));
            assert!(!error.contains(number));
        }
        let migration: MigrationKeys =
            serde_yaml::from_str(&format!("default: '{seed}'\n")).unwrap();
        let Some(StoredEntry::Inline(original)) = migration.0.get("default") else {
            panic!("quoted seed must retain its original digits");
        };
        assert_eq!(original.as_str(), seed);
        assert_eq!(*decode_seed(original.as_bytes()).unwrap(), [0x19; 32]);
    }

    #[test]
    fn legacy_aliases_survive_migration_and_reference_deserialization() {
        let (_directory, manager) = KeyManager::test_fixture(&[("default", [11; 32])]);
        let entry = manager.get_entry("default").unwrap().clone();
        let mut migrated = KeyManager::new();
        for alias in [
            "acc:1",
            "file:/missing/legacy",
            "keychain:legacy",
            "alias:old",
            "",
            " spaced ",
            "tab\tname",
        ] {
            let raw = format!("{alias:?}: '{}'\n", hex::encode([11; 32]));
            let legacy: MigrationKeys = serde_yaml::from_str(&raw).unwrap();
            assert!(matches!(legacy.0.get(alias), Some(StoredEntry::Inline(_))));
            let error = serde_yaml::from_str::<KeyManager>(&raw).unwrap_err();
            assert!(error.to_string().contains("migrate"));
            assert!(!error.to_string().contains(&hex::encode([11; 32])));
            migrated
                .insert_migrated_entry(alias, entry.clone(), false)
                .unwrap();
            assert!(KeyManager::validate_name(alias).is_err());
        }
        let encoded = serde_yaml::to_string(&migrated).unwrap();
        let restored: KeyManager = serde_yaml::from_str(&encoded).unwrap();
        restored.validate_all_keys().unwrap();
        assert_eq!(
            restored.load_key("ACC:1").unwrap().public_key,
            manager.public_key("default").unwrap()
        );
        assert_eq!(
            restored
                .load_key("alias:FILE:/missing/legacy")
                .unwrap()
                .public_key,
            manager.public_key("default").unwrap()
        );
        assert!(restored.load_key("file:/missing/legacy").is_err());
        for alias in restored.list_keys() {
            assert_eq!(
                restored
                    .load_key(&format!("alias:{alias}"))
                    .unwrap()
                    .public_key,
                manager.public_key("default").unwrap()
            );
        }
    }

    #[test]
    fn legacy_address_aliases_require_explicit_selection() {
        let (_directory, mut manager) = KeyManager::test_fixture(&[("default", [12; 32])]);
        let entry = manager.get_entry("default").unwrap().clone();
        let address = Pubkey::from_bytes(&[13; 32]).to_string();
        manager
            .insert_migrated_entry(&address, entry, false)
            .unwrap();
        assert_eq!(manager.resolve_public_key(&address).unwrap(), [13; 32]);
        assert!(manager.load_key(&address).is_err());
        assert!(manager.public_key(&address).is_err());
        let selector = format!("alias:{address}");
        assert_eq!(
            manager.resolve_public_key(&selector).unwrap(),
            manager.public_key("default").unwrap()
        );
        assert!(manager.load_key(&selector).is_ok());
    }

    #[test]
    fn missing_alias_redacts_key_material_but_names_long_aliases() {
        let manager = KeyManager::new();
        for secret in [
            "ab".repeat(20),
            "1".repeat(63),
            format!("0x{}", "cd".repeat(10)),
            format!("alias:{}", "ef".repeat(24)),
        ] {
            let message = manager.get_entry(&secret).unwrap_err().to_string();
            assert!(!message.contains(&secret[secret.len() - 16..]));
            assert!(message.contains("raw private keys"));
        }
        for alias in [
            "x".repeat(50),
            "prod-signer-with-a-long-name".repeat(2),
            "bob".into(),
        ] {
            assert!(
                manager
                    .get_entry(&alias)
                    .unwrap_err()
                    .to_string()
                    .contains(&alias)
            );
        }
    }

    #[test]
    fn unmigrated_aliases_point_at_migration_and_hide_key_material() {
        let (_directory, mut manager) = KeyManager::test_fixture(&[("bob", [5; 32])]);
        let hexish = "ab".repeat(10);
        manager.set_unmigrated(["Alice".to_string(), "default".into(), hexish.clone()]);
        assert_eq!(
            manager.unmigrated_aliases(),
            ["(hidden)", "alice", "default"]
        );
        for error in [
            manager.load_fee_payer(None).unwrap_err(),
            manager.load_key("ALICE").unwrap_err(),
            manager.load_key("alias:alice").unwrap_err(),
            manager.public_key("alice").unwrap_err(),
            manager.resolve_public_key("alice").unwrap_err(),
            manager.remove_key("alice").unwrap_err(),
        ] {
            let message = error.to_string();
            assert!(message.contains("stored inline"), "{message}");
            assert!(message.contains("thru keys migrate"), "{message}");
        }
        let message = manager.get_entry(&hexish).unwrap_err().to_string();
        assert!(message.contains("stored inline") && !message.contains(&hexish));
        // Registered and unknown aliases behave as before.
        assert!(manager.load_key("bob").is_ok());
        let message = manager.get_entry("carol").unwrap_err().to_string();
        assert!(message.contains("not found") && !message.contains("migrate"));
    }

    #[test]
    fn stored_public_key_must_be_canonical_address() {
        let (_directory, mut manager) = KeyManager::test_fixture(&[("default", [3; 32])]);
        let mut entry = manager.get_entry("default").unwrap().clone();
        let address = entry.public_key.clone();
        entry.public_key = hex::encode(LoadedKey::from_seed(Zeroizing::new([3; 32])).public_key);
        let error = manager
            .insert_entry("hexed", entry.clone(), false)
            .unwrap_err()
            .to_string();
        assert!(!error.contains(&entry.public_key));
        entry.public_key = address;
        manager.insert_entry("canon", entry, false).unwrap();
    }

    #[test]
    fn missing_alias_and_destination_errors_are_actionable_and_redacted() {
        let manager = KeyManager::new();
        let default = manager.load_fee_payer(None).unwrap_err().to_string();
        assert!(default.contains("default"));
        assert!(default.contains("thru keys generate default"));
        for alias in ["misspelled", "tanya", "ta-invalid", "0xname"] {
            for error in [
                manager.load_key(alias).unwrap_err(),
                manager.resolve_public_key(alias).unwrap_err(),
                manager.public_key(alias).unwrap_err(),
                manager.get_entry(alias).unwrap_err(),
            ] {
                assert!(matches!(error, CliError::Validation(_)));
                let message = error.to_string();
                assert!(message.contains(alias));
                assert!(message.contains("alias"));
                assert!(message.contains("thru keys list"));
            }
        }
        let destination = manager
            .resolve_public_key(&format!("ta{}!", "a".repeat(43)))
            .unwrap_err()
            .to_string();
        assert!(destination.contains("address"));
        assert!(destination.contains("alias:"));
    }

    #[test]
    fn prefix_only_aliases_resolve_as_registered_names() {
        let (_directory, manager) =
            KeyManager::test_fixture(&[("tanya", [17; 32]), ("0xname", [18; 32])]);
        for alias in ["tanya", "0xname"] {
            let public_key = manager.load_key(alias).unwrap().public_key;
            assert_eq!(manager.public_key(alias).unwrap(), public_key);
            assert_eq!(manager.resolve_public_key(alias).unwrap(), public_key);
            assert_eq!(
                manager
                    .resolve_public_key(&format!("alias:{alias}"))
                    .unwrap(),
                public_key
            );
        }
    }

    #[test]
    fn unknown_full_and_near_seeds_are_redacted_by_public_lookups() {
        let mut manager = KeyManager::new();
        let seed = hex::encode([19; 32]);
        for material in [
            seed.clone(),
            seed[..63].to_owned(),
            format!("{}g", &seed[..63]),
            format!("{}!", seed),
        ] {
            for reference in [
                material.clone(),
                format!("0x{material}"),
                format!("alias:{material}"),
                format!("alias:0x{material}"),
            ] {
                for error in [
                    manager.load_key(&reference).unwrap_err(),
                    manager.public_key(&reference).unwrap_err(),
                    manager.get_entry(&reference).unwrap_err(),
                    manager.remove_key(&reference).unwrap_err(),
                ] {
                    let message = error.to_string();
                    assert!(!message.contains(&material));
                    assert!(!message.contains(&material[..32]));
                }
                // Valid full hex remains a supported public destination, not a
                // signer; malformed and explicit alias forms must fail safely.
                if !reference.starts_with("alias:") && parse_public_key(&reference).is_ok() {
                    assert!(manager.resolve_public_key(&reference).is_ok());
                } else {
                    let message = manager
                        .resolve_public_key(&reference)
                        .unwrap_err()
                        .to_string();
                    assert!(!message.contains(&material));
                    assert!(!message.contains(&material[..32]));
                }
            }
        }
    }

    #[test]
    fn command_cache_pins_source_across_clones_and_resets_between_invocations() {
        let (_directory, mut manager) = KeyManager::test_fixture(&[("default", [21; 32])]);
        let entry = manager.get_entry("default").unwrap().clone();
        let reference = entry.reference();
        let KeySource::File { path, .. } = &entry.source else {
            unreachable!()
        };
        manager.begin_command();
        let first = manager.resolve_public_key(&reference).unwrap();
        let clone = manager.clone();
        let loaded = manager.load_key(&reference).unwrap();
        fs::write(path, hex::encode([22; 32])).unwrap();
        assert_eq!(clone.public_key(&reference).unwrap(), first);
        assert!(Arc::ptr_eq(&loaded, &clone.load_fee_payer(None).unwrap()));
        assert!(Arc::ptr_eq(
            &loaded,
            &manager.load_key("alias:default").unwrap()
        ));
        assert!(!format!("{manager:?}").contains(&hex::encode([21; 32])));
        manager.begin_command();
        let next = manager.load_key(&reference).unwrap();
        assert_ne!(next.public_key, loaded.public_key);
        assert!(!Arc::ptr_eq(&next, &loaded));
        assert!(manager.load_key("default").is_err());
        assert!(Arc::ptr_eq(&loaded, &clone.load_key("default").unwrap()));
    }

    #[test]
    fn command_cache_deduplicates_sources_but_rechecks_alias_metadata() {
        let (directory, mut manager) =
            KeyManager::test_fixture(&[("default", [23; 32]), ("other", [24; 32])]);
        let mut entry = manager.get_entry("default").unwrap().clone();
        let KeySource::File { path, managed } = &mut entry.source else {
            unreachable!()
        };
        let reference = format!("file:{}", path.display());
        *path = path.file_name().unwrap().into();
        *managed = false;
        manager
            .insert_entry("duplicate", entry.clone(), false)
            .unwrap();
        manager.begin_command();
        let loaded = manager.load_key(&reference).unwrap();
        assert!(Arc::ptr_eq(
            &loaded,
            &manager.load_key("duplicate").unwrap()
        ));
        assert!(Arc::ptr_eq(&loaded, &manager.load_key("default").unwrap()));
        entry.public_key = manager.get_entry("other").unwrap().public_key.clone();
        manager.insert_entry("duplicate", entry, true).unwrap();
        assert!(manager.load_key("duplicate").is_err());
        let relative = directory.path().join(".").join(
            Path::new(reference.strip_prefix("file:").unwrap())
                .file_name()
                .unwrap(),
        );
        assert!(Arc::ptr_eq(
            &loaded,
            &manager
                .load_key(&format!("file:{}", relative.display()))
                .unwrap()
        ));
    }

    #[test]
    fn ordinary_managers_do_not_cache_and_public_aliases_do_not_load_secrets() {
        let (_directory, mut manager) = KeyManager::test_fixture(&[("default", [25; 32])]);
        let entry = manager.get_entry("default").unwrap().clone();
        let reference = entry.reference();
        let KeySource::File { path, .. } = &entry.source else {
            unreachable!()
        };
        let first = manager.load_key(&reference).unwrap();
        fs::write(path, hex::encode([26; 32])).unwrap();
        assert_ne!(
            manager.load_key(&reference).unwrap().public_key,
            first.public_key
        );
        manager.begin_command();
        fs::remove_file(path).unwrap();
        assert_eq!(
            manager.public_key("alias:default").unwrap(),
            first.public_key
        );
        assert_eq!(
            manager.resolve_public_key("default").unwrap(),
            first.public_key
        );
        assert!(manager.load_key("default").is_err());
    }

    #[test]
    fn file_metadata_defaults_external_and_created_files_are_managed() {
        let external: KeySource =
            serde_json::from_str(r#"{"type":"file","path":"legacy.key"}"#).unwrap();
        assert!(matches!(external, KeySource::File { managed: false, .. }));
        assert!(
            !serde_json::to_string(&external)
                .unwrap()
                .contains("managed")
        );
        let (_directory, manager) = KeyManager::test_fixture(&[("default", [27; 32])]);
        assert!(matches!(
            &manager.get_entry("default").unwrap().source,
            KeySource::File { managed: true, .. }
        ));
    }

    #[test]
    fn malformed_file_diagnostics_include_path_without_seed_contents() {
        let (_directory, manager) = KeyManager::test_fixture(&[("default", [28; 32])]);
        let entry = manager.get_entry("default").unwrap();
        let KeySource::File { path, .. } = &entry.source else {
            unreachable!()
        };
        let secret = format!("{}!", hex::encode([28; 32]));
        fs::write(path, &secret).unwrap();
        let error = manager.load_key("default").unwrap_err().to_string();
        assert!(error.contains(path.to_str().unwrap()));
        assert!(!error.contains(&secret));
        fs::remove_file(path).unwrap();
        assert!(
            manager
                .load_key("default")
                .unwrap_err()
                .to_string()
                .contains(path.to_str().unwrap())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an unlocked native macOS Keychain; creates and removes a unique test entry"]
    fn command_cache_reuses_keychain_read_across_public_alias_and_signing_roles() {
        let directory = tempfile::tempdir().unwrap();
        let key = LoadedKey::from_seed(Zeroizing::new([29; 32]));
        let staged = stage_secret(KeyStorage::Keychain, directory.path(), &key).unwrap();
        let reference = staged.entry.reference();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("default", staged.entry.clone(), false)
            .unwrap();
        manager.begin_command();
        assert_eq!(
            manager.resolve_public_key(&reference).unwrap(),
            key.public_key
        );
        let clone = manager.clone();
        let loaded = manager.load_key(&reference).unwrap();
        drop(staged);
        // Deleting the backing item makes any accidental second read fail.
        assert!(Arc::ptr_eq(&loaded, &clone.load_fee_payer(None).unwrap()));
        assert!(Arc::ptr_eq(
            &loaded,
            &manager.load_key("alias:default").unwrap()
        ));
        assert_eq!(clone.public_key(&reference).unwrap(), key.public_key);
        manager.begin_command();
        assert!(manager.load_key(&reference).is_err());
    }

    #[test]
    fn bounded_key_input_accepts_only_seed_hex() {
        assert_eq!(
            *read_seed(format!(" \n{}\t", hex::encode([9; 32])).as_bytes()).unwrap(),
            [9; 32]
        );
        for raw in [
            vec![b'1'; 63],
            vec![b'1'; 65],
            vec![b'g'; 64],
            vec![b' '; 4097],
        ] {
            assert!(read_seed(raw.as_slice()).is_err());
        }
    }

    #[test]
    fn staged_failure_preserves_existing_key_and_removes_only_new_secret() {
        let (directory, manager) = KeyManager::test_fixture(&[("default", [3; 32])]);
        let old = manager.get_entry("default").unwrap().reference();
        let new_reference;
        {
            let key = LoadedKey::from_seed(Zeroizing::new([4; 32]));
            let staged = stage_secret(KeyStorage::File, directory.path(), &key).unwrap();
            new_reference = staged.entry.reference();
            assert!(manager.load_key(&new_reference).is_ok());
        }
        assert!(manager.load_key(&old).is_ok());
        assert!(manager.load_key(&new_reference).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unsafe_permissions_and_links_are_rejected() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let (directory, manager) = KeyManager::test_fixture(&[("default", [6; 32])]);
        let KeySource::File { path, .. } = &manager.get_entry("default").unwrap().source else {
            unreachable!()
        };
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(manager.load_key("default").is_err());
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        let link = directory.path().join("link");
        symlink(path, &link).unwrap();
        assert!(
            manager
                .load_key(&format!("file:{}", link.display()))
                .is_err()
        );
        let hardlink = directory.path().join("hardlink");
        fs::hard_link(path, &hardlink).unwrap();
        assert!(manager.load_key("default").is_err());
        fs::remove_file(hardlink).unwrap();
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(manager.load_key("default").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an unlocked native macOS Keychain; creates and removes a unique test entry"]
    fn native_keychain_uses_raw_binary_and_never_overwrites() {
        let id = format!("test-{}", unique_id().unwrap());
        let seed = Zeroizing::new([0xff; 32]);
        let address = LoadedKey::from_seed(Zeroizing::new([0xff; 32]))
            .address_string
            .to_string();
        keychain_create(&id, &seed, &address).unwrap();
        let cleanup = StagedSecret {
            entry: KeyEntry {
                public_key: address.clone(),
                source: KeySource::MacosKeychain { id: id.clone() },
            },
            committed: false,
        };
        assert_eq!(*keychain_read(&id).unwrap(), [0xff; 32]);
        // Attributes only (no secret read): the comment is the public address
        // and the name stays the service, as before.
        let found = security_framework::item::ItemSearchOptions::new()
            .class(security_framework::item::ItemClass::generic_password())
            .service(KEYCHAIN_SERVICE)
            .account(&id)
            .load_attributes(true)
            .search()
            .unwrap();
        let attributes = found[0].simplify_dict().unwrap();
        assert_eq!(attributes.get("icmt"), Some(&address));
        assert_eq!(
            attributes.get("labl").map(String::as_str),
            Some(KEYCHAIN_SERVICE)
        );
        // A comment that is already set is never replaced by the backfill.
        assert_eq!(
            keychain_backfill_comment(&id, "ta-other").unwrap(),
            CommentBackfill::AlreadySet
        );
        assert!(keychain_create(&id, &[0; 32], &address).is_err());
        assert_eq!(*keychain_read(&id).unwrap(), [0xff; 32]);
        assert!(
            KeyManager::new()
                .load_key(&cleanup.entry.reference())
                .is_ok()
        );
        drop(cleanup);
        assert!(keychain_read(&id).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an unlocked native macOS Keychain; creates and removes a unique test entry"]
    fn keychain_backfill_adds_address_comment_to_items_without_one() {
        use security_framework::item::{ItemClass, ItemSearchOptions};
        use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
        let comment = |id: &str| {
            ItemSearchOptions::new()
                .class(ItemClass::generic_password())
                .service(KEYCHAIN_SERVICE)
                .account(id)
                .load_attributes(true)
                .search()
                .unwrap()[0]
                .simplify_dict()
                .unwrap()
                .get("icmt")
                .cloned()
        };
        let id = format!("test-{}", unique_id().unwrap());
        let address = LoadedKey::from_seed(Zeroizing::new([0xee; 32]))
            .address_string
            .to_string();
        // An item as created before comments existed: no comment attribute.
        SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .unwrap()
            .add_generic_password(KEYCHAIN_SERVICE, &id, &[0xee; 32])
            .unwrap();
        let cleanup = StagedSecret {
            entry: KeyEntry {
                public_key: address.clone(),
                source: KeySource::MacosKeychain { id: id.clone() },
            },
            committed: false,
        };
        assert_eq!(comment(&id).filter(|c| !c.is_empty()), None);
        assert_eq!(
            keychain_backfill_comment(&id, &address).unwrap(),
            CommentBackfill::Added
        );
        assert_eq!(comment(&id), Some(address.clone()));
        assert_eq!(
            keychain_backfill_comment(&id, &address).unwrap(),
            CommentBackfill::AlreadySet
        );
        // The secret is untouched.
        assert_eq!(*keychain_read(&id).unwrap(), [0xee; 32]);
        drop(cleanup);
        assert_eq!(
            keychain_backfill_comment(&id, &address).unwrap(),
            CommentBackfill::Missing
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_keychain_never_creates_file_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let key = LoadedKey::from_seed(Zeroizing::new([5; 32]));
        assert!(stage_secret(KeyStorage::Keychain, directory.path(), &key).is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
        assert!(KeyManager::new().load_key("keychain:test").is_err());
    }

    fn ledger_entry(public_key: &str, account: u32) -> KeyEntry {
        KeyEntry {
            public_key: public_key.to_owned(),
            source: KeySource::Ledger {
                path: DerivationPath::new(account).unwrap(),
            },
        }
    }

    /// A Ledger key registers as a reference like any other key, `ledger://`
    /// selects a path directly, and commands that need a local secret refuse
    /// it clearly.
    #[test]
    fn ledger_sources_register_select_and_refuse_local_use() {
        let path = DerivationPath::new(0).unwrap();
        let uri = path.to_uri();
        let address = Pubkey::from_bytes(&[9; 32]).to_string();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("hw", ledger_entry(&address, 0), false)
            .unwrap();
        manager.validate_all_keys().unwrap();
        assert_eq!(manager.get_entry("HW").unwrap().reference(), uri);

        // Round trip; paths outside the device policy never load.
        let yaml = serde_yaml::to_string(&manager).unwrap();
        let back: KeyManager = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            back.get_entry("hw").unwrap().source,
            KeySource::Ledger { path }
        );
        let bad_uri = uri.replace("/0'/0'", "/0'/1'");
        // Includes the pre-registration coin type 9999.
        for bad in [
            bad_uri.as_str(),
            "ledger://44'/9999'/0'/0'",
            "ledger://44'/60'/0'/0'",
        ] {
            let stored = bad.strip_prefix("ledger://").unwrap();
            let yaml = format!(
                "hw:\n  public_key: {address}\n  source:\n    type: ledger\n    path: \"{stored}\"\n"
            );
            assert!(serde_yaml::from_str::<KeyManager>(&yaml).is_err(), "{bad}");
            let error = manager.ledger_source(bad).unwrap_err().to_string();
            assert!(error.contains("Invalid Ledger key source"), "{error}");
        }

        // A registered alias and its raw path select the same key and expect
        // the registered address; public lookups never contact the device.
        let expected = Some((path, Some([9; 32])));
        assert_eq!(manager.ledger_source("hw").unwrap(), expected);
        assert_eq!(manager.ledger_source("alias:HW").unwrap(), expected);
        assert_eq!(
            manager
                .ledger_source(&uri.replacen("ledger://", "LEDGER://m/", 1))
                .unwrap(),
            expected
        );
        assert_eq!(manager.public_key("hw").unwrap(), [9; 32]);
        assert_eq!(manager.public_key(&uri).unwrap(), [9; 32]);
        assert_eq!(manager.resolve_public_key(&uri).unwrap(), [9; 32]);
        let other = DerivationPath::new(1).unwrap();
        assert_eq!(
            manager.ledger_source(&other.to_uri()).unwrap(),
            Some((other, None))
        );

        // Commands without Ledger support refuse a Ledger key clearly.
        for reference in ["hw", uri.as_str()] {
            let error = manager.load_key(reference).unwrap_err().to_string();
            assert!(error.contains("does not support Ledger signing"), "{error}");
        }
        // A URI is a selector, never an alias.
        assert!(KeyManager::validate_name(&uri).is_err());

        // Local keys and unknown references are not Ledger sources.
        let (_directory, local) = KeyManager::test_fixture(&[("k", [2; 32])]);
        assert_eq!(local.ledger_source("k").unwrap(), None);
        assert_eq!(local.ledger_source("missing").unwrap(), None);
        let public = Pubkey::from_bytes(&[2; 32]).to_string();
        assert_eq!(local.ledger_source(&public).unwrap(), None);
    }

    /// Audit A-040 / A-041: a raw `ledger://` URI shared by several aliases
    /// resolves deterministically: one registered address is used, and
    /// different addresses are an ambiguity error naming them (never whichever
    /// alias comes first).
    #[test]
    fn ledger_uri_lookup_is_deterministic() {
        let addr_a = Pubkey::from_bytes(&[5; 32]).to_string();
        let addr_b = Pubkey::from_bytes(&[7; 32]).to_string();
        let path = DerivationPath::new(0).unwrap();
        let uri = path.to_uri();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("hw_a", ledger_entry(&addr_a, 0), false)
            .unwrap();
        manager
            .insert_entry("hw_c", ledger_entry(&addr_a, 0), false)
            .unwrap();
        assert_eq!(manager.public_key(&uri).unwrap(), [5; 32]);

        manager
            .insert_entry("hw_b", ledger_entry(&addr_b, 0), false)
            .unwrap();
        for _ in 0..16 {
            let error = manager.ledger_source(&uri).unwrap_err().to_string();
            assert!(error.contains("several registered keys"), "{error}");
            assert!(
                error.contains("'hw_a'") && error.contains("'hw_b'"),
                "{error}"
            );
            assert!(manager.clone().public_key(&uri).is_err());
        }
        // Aliases stay unambiguous; another path is unaffected.
        assert_eq!(
            manager.ledger_source("hw_b").unwrap(),
            Some((path, Some([7; 32])))
        );
        let other = DerivationPath::new(1).unwrap();
        assert_eq!(
            manager.ledger_source(&other.to_uri()).unwrap(),
            Some((other, None))
        );
    }

    fn trezor_entry(public_key: &str, account: u32) -> KeyEntry {
        KeyEntry {
            public_key: public_key.to_owned(),
            source: KeySource::Trezor {
                path: TrezorPath::new(account).unwrap(),
                passphrase: false,
            },
        }
    }

    /// A Trezor key registers as a reference like any other key, `trezor://`
    /// selects a path directly, it is never mistaken for a Ledger or a local
    /// key, and commands that need a local secret refuse it clearly.
    #[test]
    fn trezor_sources_register_select_and_refuse_local_use() {
        let path = TrezorPath::new(0).unwrap();
        let uri = path.to_uri();
        assert_eq!(uri, "trezor://44'/8478'/0'/0'");
        let address = Pubkey::from_bytes(&[9; 32]).to_string();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("tz", trezor_entry(&address, 0), false)
            .unwrap();
        manager.validate_all_keys().unwrap();
        assert_eq!(manager.get_entry("TZ").unwrap().reference(), uri);
        assert!(manager.get_entry("tz").unwrap().source.is_trezor());
        assert!(!manager.get_entry("tz").unwrap().source.is_ledger());

        // Serialized like the Ledger path: no scheme, tag "trezor"; paths
        // outside the policy never load.
        let yaml = serde_yaml::to_string(&manager).unwrap();
        assert!(yaml.contains("type: trezor"), "{yaml}");
        assert!(yaml.contains("path: 44'/8478'/0'/0'"), "{yaml}");
        let back: KeyManager = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            back.get_entry("tz").unwrap().source,
            KeySource::Trezor {
                path,
                passphrase: false
            }
        );
        for bad in [
            "trezor://44'/8478'/0'/1'",
            "trezor://44'/9999'/0'/0'",
            "trezor://44'/8478'/0/0'",
            "trezor://garbage",
        ] {
            let stored = bad.strip_prefix("trezor://").unwrap();
            let yaml = format!(
                "tz:\n  public_key: {address}\n  source:\n    type: trezor\n    path: \"{stored}\"\n"
            );
            assert!(serde_yaml::from_str::<KeyManager>(&yaml).is_err(), "{bad}");
            let error = manager.trezor_source(bad).unwrap_err().to_string();
            assert!(error.contains("Invalid Trezor key source"), "{error}");
        }

        // A registered alias and its raw path select the same key and expect
        // the registered address; public lookups never contact the device.
        let expected = Some(TrezorTarget::registered(path, false, [9; 32]));
        assert_eq!(manager.trezor_source("tz").unwrap(), expected);
        assert_eq!(manager.trezor_source("alias:TZ").unwrap(), expected);
        assert_eq!(
            manager
                .trezor_source(&uri.replacen("trezor://", "TREZOR://m/", 1))
                .unwrap(),
            expected
        );
        assert_eq!(manager.public_key("tz").unwrap(), [9; 32]);
        assert_eq!(manager.public_key(&uri).unwrap(), [9; 32]);
        assert_eq!(manager.resolve_public_key(&uri).unwrap(), [9; 32]);
        let other = TrezorPath::new(1).unwrap();
        assert_eq!(
            manager.trezor_source(&other.to_uri()).unwrap(),
            Some(TrezorTarget::unregistered(other, false))
        );

        // A Trezor key is not a Ledger key, and the reverse.
        assert_eq!(manager.ledger_source("tz").unwrap(), None);
        assert_eq!(manager.ledger_source(&uri).unwrap(), None);
        let ledger_uri = DerivationPath::new(0).unwrap().to_uri();
        assert_eq!(manager.trezor_source(&ledger_uri).unwrap(), None);

        // Commands without Trezor support refuse a Trezor key clearly.
        for reference in ["tz", uri.as_str()] {
            let error = manager.load_key(reference).unwrap_err().to_string();
            assert!(error.contains("does not support Trezor signing"), "{error}");
            assert!(error.contains("transfer"), "{error}");
        }
        // A URI is a selector, never an alias.
        assert!(KeyManager::validate_name(&uri).is_err());
        // Deleting a Trezor key's secret makes no sense.
        let source = manager.get_entry("tz").unwrap().source.clone();
        assert!(
            delete_source(&source)
                .unwrap_err()
                .to_string()
                .contains("stays on the device")
        );

        // Local keys and unknown references are not Trezor sources.
        let (_directory, local) = KeyManager::test_fixture(&[("k", [2; 32])]);
        assert_eq!(local.trezor_source("k").unwrap(), None);
        assert_eq!(local.trezor_source("missing").unwrap(), None);
        let public = Pubkey::from_bytes(&[2; 32]).to_string();
        assert_eq!(local.trezor_source(&public).unwrap(), None);
    }

    /// As for Ledger paths: one registered address is used, different
    /// addresses behind one `trezor://` path are an ambiguity error.
    #[test]
    fn trezor_uri_lookup_is_deterministic() {
        let addr_a = Pubkey::from_bytes(&[1; 32]).to_string();
        let addr_b = Pubkey::from_bytes(&[2; 32]).to_string();
        let uri = TrezorPath::new(0).unwrap().to_uri();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("tz_a", trezor_entry(&addr_a, 0), false)
            .unwrap();
        manager
            .insert_entry("tz_c", trezor_entry(&addr_a, 0), false)
            .unwrap();
        assert_eq!(manager.public_key(&uri).unwrap(), [1; 32]);
        manager
            .insert_entry("tz_b", trezor_entry(&addr_b, 0), false)
            .unwrap();
        let error = manager.trezor_source(&uri).unwrap_err().to_string();
        assert!(error.contains("several registered keys"), "{error}");
        assert!(error.contains("tz_a") && error.contains("tz_b"), "{error}");
        // The alias is unambiguous.
        assert_eq!(
            manager.trezor_source("tz_b").unwrap(),
            Some(TrezorTarget::registered(
                TrezorPath::new(0).unwrap(),
                false,
                [2; 32]
            ))
        );
    }

    fn passphrase_entry(public_key: &str, account: u32) -> KeyEntry {
        KeyEntry {
            public_key: public_key.to_owned(),
            source: KeySource::Trezor {
                path: TrezorPath::new(account).unwrap(),
                passphrase: true,
            },
        }
    }

    /// The shape an older CLI knows: no `passphrase` field in a Trezor source.
    #[derive(Debug, Deserialize)]
    #[serde(tag = "type", deny_unknown_fields)]
    #[allow(dead_code)]
    enum PreviousKeySource {
        #[serde(rename = "trezor")]
        Trezor { path: String },
    }

    /// X2: the flag is written only when set, a file written before it
    /// existed reads as the standard wallet, and a CLI without the flag
    /// refuses an entry that has it.
    #[test]
    fn the_passphrase_flag_is_written_only_when_set() {
        let address = Pubkey::from_bytes(&[9; 32]).to_string();
        let path = TrezorPath::new(0).unwrap();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("std", trezor_entry(&address, 0), false)
            .unwrap();
        let yaml = serde_yaml::to_string(&manager).unwrap();
        assert_eq!(
            yaml,
            format!(
                "std:\n  public_key: {address}\n  source:\n    type: trezor\n    path: 44'/8478'/0'/0'\n"
            )
        );
        let json = serde_json::to_value(&manager.get_entry("std").unwrap().source).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"type": "trezor", "path": "44'/8478'/0'/0'"})
        );

        // A file written before the flag existed.
        let back: KeyManager = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            back.get_entry("std").unwrap().source,
            KeySource::Trezor {
                path,
                passphrase: false
            }
        );

        // The flag survives a round trip, in YAML and in JSON.
        manager
            .insert_entry("hid", passphrase_entry(&address, 0), false)
            .unwrap();
        let yaml = serde_yaml::to_string(&manager).unwrap();
        assert!(yaml.contains("passphrase: true"), "{yaml}");
        assert_eq!(yaml.matches("passphrase").count(), 1, "{yaml}");
        let back: KeyManager = serde_yaml::from_str(&yaml).unwrap();
        assert!(back.get_entry("hid").unwrap().source.is_passphrase());
        assert!(!back.get_entry("std").unwrap().source.is_passphrase());
        let json = serde_json::to_value(&manager.get_entry("hid").unwrap().source).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"type": "trezor", "path": "44'/8478'/0'/0'", "passphrase": true})
        );
        let entry: KeyEntry =
            serde_json::from_value(serde_json::json!({"public_key": address, "source": json}))
                .unwrap();
        assert!(entry.source.is_passphrase());

        // A CLI that does not know the flag refuses the entry instead of using
        // the standard wallet; it still reads the entry without the flag.
        let old = |source: serde_json::Value| serde_json::from_value::<PreviousKeySource>(source);
        assert!(old(serde_json::json!({"type": "trezor", "path": "44'/8478'/0'/0'"})).is_ok());
        let error = old(
            serde_json::json!({"type": "trezor", "path": "44'/8478'/0'/0'", "passphrase": true}),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("unknown field `passphrase`"), "{error}");
        // The current format refuses other unknown fields too.
        assert!(
            serde_json::from_value::<KeySource>(
                serde_json::json!({"type": "trezor", "path": "44'/8478'/0'/0'", "hidden": true})
            )
            .is_err()
        );
    }

    /// X3: a `trezor://` URI is the standard wallet. With a standard key, a
    /// passphrase key only, or a standard key and two passphrase keys on one
    /// path, the URI never resolves to a passphrase key; each alias resolves
    /// to its own key and carries its flag to the connection.
    #[test]
    fn a_trezor_uri_never_resolves_to_a_passphrase_key() {
        let path = TrezorPath::new(0).unwrap();
        let uri = path.to_uri();
        let address = |byte: u8| Pubkey::from_bytes(&[byte; 32]).to_string();

        // Only a standard key.
        let mut manager = KeyManager::new();
        manager
            .insert_entry("std", trezor_entry(&address(1), 0), false)
            .unwrap();
        let standard = Some(TrezorTarget::registered(path, false, [1; 32]));
        assert_eq!(manager.trezor_source(&uri).unwrap(), standard);
        assert_eq!(manager.public_key(&uri).unwrap(), [1; 32]);
        assert_eq!(manager.resolve_public_key(&uri).unwrap(), [1; 32]);

        // Only a passphrase key: as if nothing were registered for the path.
        let mut only = KeyManager::new();
        only.insert_entry("hid_a", passphrase_entry(&address(2), 0), false)
            .unwrap();
        let none = Some(TrezorTarget::unregistered(path, false));
        assert_eq!(only.trezor_source(&uri).unwrap(), none);
        assert_eq!(only.registered_trezor_public_key(&path).unwrap(), None);
        assert_eq!(
            only.trezor_source("hid_a").unwrap(),
            Some(TrezorTarget::registered(path, true, [2; 32]))
        );

        // A standard key and two passphrase keys on one path.
        manager
            .insert_entry("hid_a", passphrase_entry(&address(2), 0), false)
            .unwrap();
        manager
            .insert_entry("hid_b", passphrase_entry(&address(3), 0), false)
            .unwrap();
        assert_eq!(manager.trezor_source(&uri).unwrap(), standard);
        assert_eq!(manager.public_key(&uri).unwrap(), [1; 32]);
        assert_eq!(manager.resolve_public_key(&uri).unwrap(), [1; 32]);
        assert_eq!(
            manager.registered_trezor_public_key(&path).unwrap(),
            Some([1; 32])
        );
        for (reference, expected) in [
            ("std", TrezorTarget::registered(path, false, [1; 32])),
            ("hid_a", TrezorTarget::registered(path, true, [2; 32])),
            ("alias:hid_a", TrezorTarget::registered(path, true, [2; 32])),
            ("HID_B", TrezorTarget::registered(path, true, [3; 32])),
            ("alias:HID_B", TrezorTarget::registered(path, true, [3; 32])),
        ] {
            assert_eq!(
                manager.trezor_source(reference).unwrap(),
                Some(expected),
                "{reference}"
            );
        }
        // Aliases give the registered keys without touching a device.
        assert_eq!(manager.public_key("hid_a").unwrap(), [2; 32]);
        assert_eq!(manager.resolve_public_key("alias:hid_b").unwrap(), [3; 32]);

        // Passphrase keys never take part in the ambiguity of a path.
        manager
            .insert_entry("std_b", trezor_entry(&address(4), 0), false)
            .unwrap();
        let error = manager.trezor_source(&uri).unwrap_err().to_string();
        assert!(
            error.contains("'std'") && error.contains("'std_b'"),
            "{error}"
        );
        assert!(!error.contains("hid_"), "{error}");
    }

    /// A passphrase key is not a source that commands needing a local secret
    /// can load, and the refusal does not offer the bare URI.
    #[test]
    fn commands_without_trezor_support_refuse_a_passphrase_key() {
        let address = Pubkey::from_bytes(&[9; 32]).to_string();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("hid", passphrase_entry(&address, 0), false)
            .unwrap();
        let error = manager.load_key("hid").unwrap_err().to_string();
        assert!(error.contains("passphrase wallet"), "{error}");
        assert!(error.contains("does not support Trezor signing"), "{error}");
        assert!(!error.contains("trezor://"), "{error}");
    }

    /// The reference of a registration: the alias for a key of a passphrase
    /// wallet, the reference of its source for every other key.
    #[test]
    fn the_reference_of_a_passphrase_key_is_its_alias() {
        let address = Pubkey::from_bytes(&[9; 32]).to_string();
        let mut manager = KeyManager::new();
        manager
            .insert_entry("std", trezor_entry(&address, 0), false)
            .unwrap();
        manager
            .insert_entry("hid", passphrase_entry(&address, 0), false)
            .unwrap();
        let source = |name: &str| manager.get_entry(name).unwrap().source.clone();
        assert_eq!(
            registration_reference("STD", &source("std")),
            "trezor://44'/8478'/0'/0'"
        );
        let reference = registration_reference("HID", &source("hid"));
        assert_eq!(reference, "alias:hid");
        // It resolves back to that key, not to the standard wallet.
        assert_eq!(
            manager.trezor_source(&reference).unwrap(),
            Some(TrezorTarget::registered(
                TrezorPath::new(0).unwrap(),
                true,
                [9; 32]
            ))
        );
        let ledger = KeySource::Ledger {
            path: DerivationPath::new(0).unwrap(),
        };
        assert_eq!(registration_reference("x", &ledger), ledger.reference());
        let file = KeySource::File {
            path: "/k.key".into(),
            managed: false,
        };
        assert_eq!(registration_reference("x", &file), "file:/k.key");
    }
}
