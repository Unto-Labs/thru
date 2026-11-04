//! Org API key that `thru auth login` provisions for this machine.
//!
//! The plaintext lives in the OS keychain (service [`KEYCHAIN_SERVICE`], account
//! = Developers origin). On Unix, when the keychain is unavailable (Linux
//! without a secret service, CI) or owner-only file storage was explicitly
//! selected with `THRU_DEVELOPERS_CREDENTIAL_STORE=file`, it falls back to an
//! owner-only (0600) file beside the Developers credentials; elsewhere a key
//! the keychain refuses is not stored. Metadata (key id, name, prefix,
//! organization, origin and where the secret lives; never the secret) is
//! always a file there, owner-only on Unix, so status checks never touch the
//! keychain. Nothing here is ever written to the CLI config file.
use super::storage::{
    ensure_private_dir, inspect_private_dir, read_private, remove_private, storage_error,
};
use super::valid_token;
use crate::error::CliError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};

/// OS keychain service name for provisioned API keys.
pub(super) const KEYCHAIN_SERVICE: &str = "thru-cli";
const MAX_KEY_LEN: usize = 1024;
const MAX_TEXT_LEN: usize = 256;

/// The OS keychain could not be used.
#[derive(Debug)]
pub(super) struct KeychainUnavailable;

/// Secret storage. The OS keychain in production; a fake in tests.
pub(super) trait Keychain: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, KeychainUnavailable>;
    fn set(&self, account: &str, secret: &str) -> Result<(), KeychainUnavailable>;
    /// Removes the entry; an absent entry is success.
    fn delete(&self, account: &str) -> Result<(), KeychainUnavailable>;
}

/// The platform keychain through the `keyring` crate. Calls block; on Linux
/// they must not run on an async worker thread (see `keyring` tokio caveat).
struct OsKeychain;
impl OsKeychain {
    fn entry(account: &str) -> Result<keyring::Entry, KeychainUnavailable> {
        keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|_| KeychainUnavailable)
    }
}
impl Keychain for OsKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, KeychainUnavailable> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KeychainUnavailable),
        }
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), KeychainUnavailable> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|_| KeychainUnavailable)
    }
    fn delete(&self, account: &str) -> Result<(), KeychainUnavailable> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(KeychainUnavailable),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum SecretLocation {
    Keychain,
    File,
}

/// Non-secret description of the provisioned key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct KeyMetadata {
    pub origin: String,
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub organization_id: String,
    pub organization_name: String,
    pub location: SecretLocation,
}

/// A key id is used as a URL path segment, so it is restricted to a safe alphabet.
pub(super) fn valid_key_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Display text from the server: bounded and free of control characters, so
/// it cannot rewrite the terminal.
pub(super) fn valid_text(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= MAX_TEXT_LEN && !text.chars().any(char::is_control)
}

pub(super) fn valid_api_key(key: &str) -> bool {
    key.len() > "thru_".len()
        && key.len() <= MAX_KEY_LEN
        && key.starts_with("thru_")
        && valid_token(key)
}

impl KeyMetadata {
    fn valid(&self) -> bool {
        valid_key_id(&self.id)
            && [
                &self.name,
                &self.prefix,
                &self.organization_id,
                &self.organization_name,
            ]
            .iter()
            .all(|text| valid_text(text))
    }
}

#[derive(Clone)]
pub(super) struct KeyStore {
    root: PathBuf,
    origin: String,
    /// `None` when the keychain must not be used (explicit file storage, or
    /// no native keychain on this platform).
    keychain: Option<Arc<dyn Keychain>>,
}

impl KeyStore {
    /// Store for `origin`, honouring `THRU_DEVELOPERS_CREDENTIAL_STORE` like the
    /// Developers credential store does. Does not create any file.
    pub(super) fn configured(origin: &str) -> Result<Self, CliError> {
        let keychain: Option<Arc<dyn Keychain>> =
            match std::env::var("THRU_DEVELOPERS_CREDENTIAL_STORE").as_deref() {
                Err(std::env::VarError::NotPresent) | Ok("keyring") => {
                    // Without a native backend `keyring` would silently use an
                    // in-memory mock, which would lose the key.
                    if cfg!(any(
                        target_os = "linux",
                        target_os = "macos",
                        target_os = "windows"
                    )) {
                        Some(Arc::new(OsKeychain))
                    } else {
                        None
                    }
                }
                Ok("file") => None,
                _ => {
                    return Err(storage_error(
                        "THRU_DEVELOPERS_CREDENTIAL_STORE must be keyring or explicitly file",
                    ));
                }
            };
        let root = crate::config::Config::get_config_dir()?.join("auth");
        Ok(Self::new(root, origin, keychain))
    }

    pub(super) fn new(root: PathBuf, origin: &str, keychain: Option<Arc<dyn Keychain>>) -> Self {
        Self {
            root,
            origin: origin.to_owned(),
            keychain,
        }
    }

    fn path(&self, extension: &str) -> PathBuf {
        self.root.join(format!(
            "{}.{extension}",
            hex::encode(Sha256::digest(self.origin.as_bytes()))
        ))
    }
    fn metadata_path(&self) -> PathBuf {
        self.path("cli-key")
    }
    fn secret_path(&self) -> PathBuf {
        self.path("cli-key-secret")
    }

    /// Recorded key metadata, without reading the secret.
    pub(super) fn load_metadata(&self) -> Result<Option<KeyMetadata>, CliError> {
        if !inspect_private_dir(&self.root)? {
            return Ok(None);
        }
        let Some(raw) = read_private(&self.metadata_path(), 16 * 1024)? else {
            return Ok(None);
        };
        let metadata: KeyMetadata = serde_json::from_str(&raw)
            .map_err(|_| storage_error("Invalid stored CLI API key metadata; log in again"))?;
        if metadata.origin != self.origin || !metadata.valid() {
            return Err(storage_error(
                "Stored CLI API key does not match this Developers origin",
            ));
        }
        Ok(Some(metadata))
    }

    /// The provisioned key's plaintext, if one is recorded.
    pub(super) fn load_secret(&self) -> Result<Option<String>, CliError> {
        let Some(metadata) = self.load_metadata()? else {
            return Ok(None);
        };
        let secret = match metadata.location {
            SecretLocation::Keychain => self
                .keychain
                .as_ref()
                .ok_or_else(|| {
                    storage_error(
                        "The CLI API key is in the OS keychain, but keychain storage is disabled",
                    )
                })?
                .get(&self.origin)
                .map_err(|_| storage_error("OS keychain unavailable or locked"))?,
            SecretLocation::File => read_private(&self.secret_path(), MAX_KEY_LEN as u64)?,
        };
        match secret {
            Some(secret) if valid_api_key(&secret) => Ok(Some(secret)),
            Some(_) => Err(storage_error("Invalid stored CLI API key; log in again")),
            None => Err(storage_error("Stored CLI API key is missing; log in again")),
        }
    }

    /// Stores `secret` (keychain first, owner-only file fallback on Unix), then
    /// its metadata. On failure nothing new is left behind.
    pub(super) fn save(
        &self,
        mut metadata: KeyMetadata,
        secret: &str,
    ) -> Result<KeyMetadata, CliError> {
        metadata.origin = self.origin.clone();
        if !metadata.valid() || !valid_api_key(secret) {
            return Err(storage_error("Refusing invalid CLI API key"));
        }
        ensure_private_dir(&self.root)?;
        let in_keychain = self
            .keychain
            .as_ref()
            .is_some_and(|keychain| keychain.set(&self.origin, secret).is_ok());
        if in_keychain {
            metadata.location = SecretLocation::Keychain;
            // A fallback file from an earlier login holds a now-revoked key.
            let _ = remove_private(&self.secret_path());
        } else {
            metadata.location = SecretLocation::File;
            self.write_secret_file(secret)?;
        }
        let raw = serde_json::to_vec(&metadata)
            .map_err(|_| storage_error("Could not serialize CLI API key metadata"))?;
        if let Err(error) = self.write_metadata(&raw) {
            let _ = self.remove_secret(metadata.location);
            return Err(error);
        }
        Ok(metadata)
    }

    /// Owner-only (0600) fallback file for the secret.
    #[cfg(unix)]
    fn write_secret_file(&self, secret: &str) -> Result<(), CliError> {
        super::storage::write_private(&self.root, &self.secret_path(), secret.as_bytes())
    }
    /// Without Unix permissions the secret is never written to a file.
    #[cfg(not(unix))]
    fn write_secret_file(&self, _: &str) -> Result<(), CliError> {
        Err(storage_error(
            "OS keychain unavailable; the CLI API key file fallback is supported only on Unix",
        ))
    }

    /// The metadata holds no secret. On Unix it is still owner-only like the
    /// rest of the directory; elsewhere it is written without Unix checks.
    #[cfg(unix)]
    fn write_metadata(&self, raw: &[u8]) -> Result<(), CliError> {
        super::storage::write_private(&self.root, &self.metadata_path(), raw)
    }
    #[cfg(not(unix))]
    fn write_metadata(&self, raw: &[u8]) -> Result<(), CliError> {
        super::storage::write_plain(&self.root, &self.metadata_path(), raw)
    }

    fn remove_secret(&self, location: SecretLocation) -> Result<(), CliError> {
        match location {
            SecretLocation::Keychain => match &self.keychain {
                Some(keychain) => keychain.delete(&self.origin).map_err(|_| {
                    storage_error("Could not remove the CLI API key from the OS keychain")
                }),
                None => Ok(()),
            },
            SecretLocation::File => remove_private(&self.secret_path()),
        }
    }

    /// Removes the secret from wherever it is stored, then the metadata.
    pub(super) fn clear(&self) -> Result<(), CliError> {
        if !inspect_private_dir(&self.root)? {
            return Ok(());
        }
        let location = self.load_metadata().ok().flatten().map(|m| m.location);
        let mut result = Ok(());
        // Unknown location (unreadable metadata): clean both places.
        if location != Some(SecretLocation::File) {
            if let Err(error) = self.remove_secret(SecretLocation::Keychain) {
                if location == Some(SecretLocation::Keychain) {
                    result = Err(error);
                }
            }
        }
        if let Err(error) = remove_private(&self.secret_path()) {
            result = result.and(Err(error));
        }
        if let Err(error) = remove_private(&self.metadata_path()) {
            result = result.and(Err(error));
        }
        result
    }
}

#[cfg(test)]
pub(super) mod fake {
    use super::{Keychain, KeychainUnavailable};
    use std::{collections::HashMap, sync::Mutex};

    /// In-memory keychain; `available = false` behaves like a missing secret service.
    #[derive(Default)]
    pub(in crate::commands::developers) struct FakeKeychain {
        pub available: bool,
        pub entries: Mutex<HashMap<String, String>>,
    }
    impl FakeKeychain {
        pub fn available() -> Self {
            Self {
                available: true,
                ..Self::default()
            }
        }
        fn check(&self) -> Result<(), KeychainUnavailable> {
            if self.available {
                Ok(())
            } else {
                Err(KeychainUnavailable)
            }
        }
    }
    impl Keychain for FakeKeychain {
        fn get(&self, account: &str) -> Result<Option<String>, KeychainUnavailable> {
            self.check()?;
            Ok(self.entries.lock().unwrap().get(account).cloned())
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), KeychainUnavailable> {
            self.check()?;
            self.entries
                .lock()
                .unwrap()
                .insert(account.to_owned(), secret.to_owned());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), KeychainUnavailable> {
            self.check()?;
            self.entries.lock().unwrap().remove(account);
            Ok(())
        }
    }
}
