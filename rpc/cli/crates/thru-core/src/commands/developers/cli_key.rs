//! Org API key that `thru auth login` provisions for this machine.
//!
//! The plaintext and its metadata (key id, name, prefix, organization and
//! origin; never the secret) are separate owner-only files under
//! `~/.thru/cli/auth`, keyed by the Developers origin. The OS keychain is
//! never used. Nothing here is ever written to the CLI config file.
use super::storage::{
    ensure_private_dir, inspect_private_dir, read_private, remove_private, storage_error,
    write_private,
};
use super::valid_token;
use crate::error::CliError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const MAX_KEY_LEN: usize = 1024;
const MAX_TEXT_LEN: usize = 256;

/// Non-secret description of the provisioned key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct KeyMetadata {
    pub origin: String,
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub organization_id: String,
    pub organization_name: String,
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
}

impl KeyStore {
    /// Store for `origin`. Does not create any file.
    pub(super) fn configured(origin: &str) -> Result<Self, CliError> {
        let root = crate::config::Config::get_config_dir()?.join("auth");
        Ok(Self::new(root, origin))
    }

    pub(super) fn new(root: PathBuf, origin: &str) -> Self {
        Self {
            root,
            origin: origin.to_owned(),
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
        if self.load_metadata()?.is_none() {
            return Ok(None);
        }
        match read_private(&self.secret_path(), MAX_KEY_LEN as u64)? {
            Some(secret) if valid_api_key(&secret) => Ok(Some(secret)),
            Some(_) => Err(storage_error("Invalid stored CLI API key; log in again")),
            None => Err(storage_error(
                "Stored CLI API key is missing; run `thru auth login` again",
            )),
        }
    }

    /// Stores `secret`, then its metadata. On failure nothing new is left behind.
    pub(super) fn save(
        &self,
        metadata: KeyMetadata,
        secret: &str,
    ) -> Result<KeyMetadata, CliError> {
        let metadata = KeyMetadata {
            origin: self.origin.clone(),
            ..metadata
        };
        if !metadata.valid() || !valid_api_key(secret) {
            return Err(storage_error("Refusing invalid CLI API key"));
        }
        ensure_private_dir(&self.root)?;
        write_private(&self.root, &self.secret_path(), secret.as_bytes())?;
        let raw = serde_json::to_vec(&metadata)
            .map_err(|_| storage_error("Could not serialize CLI API key metadata"))?;
        if let Err(error) = write_private(&self.root, &self.metadata_path(), &raw) {
            let _ = remove_private(&self.secret_path());
            return Err(error);
        }
        Ok(metadata)
    }

    /// Removes the secret, then the metadata.
    pub(super) fn clear(&self) -> Result<(), CliError> {
        if !inspect_private_dir(&self.root)? {
            return Ok(());
        }
        let secret = remove_private(&self.secret_path());
        let metadata = remove_private(&self.metadata_path());
        secret.and(metadata)
    }

    #[cfg(test)]
    pub(super) fn secret_stored(&self) -> bool {
        self.secret_path().exists()
    }
}
