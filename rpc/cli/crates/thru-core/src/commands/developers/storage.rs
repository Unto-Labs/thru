//! Origin-isolated OAuth storage in owner-only files under `~/.thru/cli/auth`.
//! The OS keychain is never used: on macOS every new CLI binary would prompt
//! for Keychain access again.
use super::{Credentials, failure};
use crate::error::CliError;
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone)]
pub(super) struct Store {
    root: PathBuf,
    origin: String,
}

pub(super) struct Guard(File);
impl Drop for Guard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

pub(super) fn storage_error(message: &str) -> CliError {
    failure("CREDENTIAL_STORE", message, None)
}

pub(super) fn secure_open(path: &Path, write: bool, create: bool) -> Result<File, CliError> {
    thru_base::key_file::secure_open(path, write, create)
        .map_err(|error| storage_error(&format!("Could not open Developers credential storage: {error}")))
}

/// Whether the credential directory exists; errors if it exists but is unsafe.
pub(super) fn inspect_private_dir(root: &Path) -> Result<bool, CliError> {
    thru_base::key_file::inspect_private_dir(root)
        .map(|metadata| metadata.is_some())
        .map_err(|error| storage_error(&format!("Unsafe Developers credential directory: {error}")))
}

/// Validates an existing credential directory, or creates it owner-only.
pub(super) fn ensure_private_dir(root: &Path) -> Result<(), CliError> {
    thru_base::key_file::ensure_private_dir(root)
        .map(|_| ())
        .map_err(|error| storage_error(&format!("Could not create Developers credential directory: {error}")))
}

/// Atomically replaces `path` (inside `root`) with an owner-only (0600) file
/// holding `raw`. Refuses to replace symlinks or files with unsafe ownership.
#[cfg(unix)]
pub(super) fn write_private(root: &Path, path: &Path, raw: &[u8]) -> Result<(), CliError> {
    use std::os::unix::fs::OpenOptionsExt;
    if path.exists() {
        let _ = secure_open(path, false, false)?;
    }
    let temporary = root.join(format!(".tmp-{}", rand::random::<u64>()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)
            .map_err(|_| storage_error("Could not create private credential file"))?;
        file.write_all(raw)
            .map_err(|_| storage_error("Could not write Developers credentials"))?;
        file.sync_all()
            .map_err(|_| storage_error("Could not persist Developers credentials"))?;
        fs::rename(&temporary, path)
            .map_err(|_| storage_error("Could not atomically replace Developers credentials"))?;
        File::open(root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| storage_error("Could not persist credential directory"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Without Unix modes, files are written like the CLI config (which holds
/// signing keys): in the per-user profile directory, without mode handling.
#[cfg(not(unix))]
pub(super) fn write_private(root: &Path, path: &Path, raw: &[u8]) -> Result<(), CliError> {
    write_plain(root, path, raw)
}

/// Atomically replaces `path` (inside `root`) with `raw`, without Unix
/// ownership or mode handling. Refuses to replace a symlink or non-file.
#[cfg(not(unix))]
pub(super) fn write_plain(root: &Path, path: &Path, raw: &[u8]) -> Result<(), CliError> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(storage_error("Refusing unsafe Developers credential file"));
        }
    }
    let temporary = root.join(format!(".tmp-{}", rand::random::<u64>()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| storage_error("Could not create Developers credential file"))?;
        file.write_all(raw)
            .map_err(|_| storage_error("Could not write Developers credentials"))?;
        file.sync_all()
            .map_err(|_| storage_error("Could not persist Developers credentials"))?;
        drop(file);
        // Replaces an existing file on Windows too (MoveFileEx REPLACE_EXISTING).
        fs::rename(&temporary, path)
            .map_err(|_| storage_error("Could not atomically replace Developers credentials"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Reads an owner-only file of at most `limit` bytes; `None` when absent.
pub(super) fn read_private(path: &Path, limit: u64) -> Result<Option<String>, CliError> {
    if !path
        .try_exists()
        .map_err(|_| storage_error("Could not inspect Developers credentials"))?
    {
        return Ok(None);
    }
    let mut raw = String::new();
    secure_open(path, false, false)?
        .take(limit + 1)
        .read_to_string(&mut raw)
        .map_err(|_| storage_error("Could not read Developers credentials"))?;
    if raw.len() as u64 > limit {
        return Err(storage_error("Invalid stored Developers credentials"));
    }
    Ok(Some(raw))
}

/// Removes an owner-only file after checking it is safe to touch; absent is fine.
pub(super) fn remove_private(path: &Path) -> Result<(), CliError> {
    if !path
        .try_exists()
        .map_err(|_| storage_error("Could not inspect Developers credentials"))?
    {
        return Ok(());
    }
    let _ = secure_open(path, false, false)?;
    fs::remove_file(path).map_err(|_| storage_error("Could not clear Developers credentials"))
}

impl Store {
    pub(super) fn configured(origin: &str) -> Result<Self, CliError> {
        let root = crate::config::Config::get_config_dir()?.join("auth");
        Self::new(root, origin)
    }

    fn new(root: PathBuf, origin: &str) -> Result<Self, CliError> {
        ensure_private_dir(&root)?;
        Ok(Self {
            root,
            origin: origin.to_owned(),
        })
    }

    fn path(&self, extension: &str) -> PathBuf {
        self.root.join(format!(
            "{}.{extension}",
            hex::encode(Sha256::digest(self.origin.as_bytes()))
        ))
    }

    /// Owner-only file holding the device authorization that
    /// `thru auth login --no-wait` started, until `--resume` finishes it.
    pub(super) fn pending_login_path(&self) -> PathBuf {
        self.path("login-pending")
    }

    /// Replaces the pending login file with `raw` (0600 on Unix).
    pub(super) fn save_pending_login(&self, raw: &[u8]) -> Result<(), CliError> {
        ensure_private_dir(&self.root)?;
        super::write_owner_only_file(&self.root, &self.pending_login_path(), raw)
    }

    /// The pending login file's contents; `None` when there is none.
    pub(super) fn load_pending_login(&self) -> Result<Option<String>, CliError> {
        if !inspect_private_dir(&self.root)? {
            return Ok(None);
        }
        read_private(&self.pending_login_path(), 16 * 1024)
    }

    /// Removes the pending login file; absent is fine.
    pub(super) fn clear_pending_login(&self) -> Result<(), CliError> {
        remove_private(&self.pending_login_path())
    }

    /// Owner-only file holding the key request that
    /// `thru auth keys create --no-wait` started, until `--resume` finishes it.
    pub(super) fn pending_key_request_path(&self) -> PathBuf {
        self.path("key-request-pending")
    }

    /// Replaces the pending key request file with `raw` (0600 on Unix).
    pub(super) fn save_pending_key_request(&self, raw: &[u8]) -> Result<(), CliError> {
        ensure_private_dir(&self.root)?;
        super::write_owner_only_file(&self.root, &self.pending_key_request_path(), raw)
    }

    /// The pending key request file's contents; `None` when there is none.
    pub(super) fn load_pending_key_request(&self) -> Result<Option<String>, CliError> {
        if !inspect_private_dir(&self.root)? {
            return Ok(None);
        }
        read_private(&self.pending_key_request_path(), 16 * 1024)
    }

    /// Removes the pending key request file; absent is fine.
    pub(super) fn clear_pending_key_request(&self) -> Result<(), CliError> {
        remove_private(&self.pending_key_request_path())
    }

    pub(super) async fn lock(&self) -> Result<Guard, CliError> {
        let file = secure_open(&self.path("lock"), true, true)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Guard(file)),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err(storage_error(
                            "Another CLI process is using these Developers credentials; retry after it finishes",
                        ));
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(_) => return Err(storage_error("Could not lock Developers credentials")),
            }
        }
    }

    pub(super) async fn load(&self) -> Result<Option<Credentials>, CliError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            let Some(raw) = read_private(&store.path("json"), 65536)? else {
                return Ok(None);
            };
            let credentials: Credentials = serde_json::from_str(&raw).map_err(|_| {
                storage_error("Invalid stored Developers credentials; log in again")
            })?;
            if credentials.origin != store.origin || !credentials.valid() {
                return Err(storage_error(
                    "Stored Developers credentials do not match this origin",
                ));
            }
            Ok(Some(credentials))
        })
        .await
        .map_err(|_| storage_error("Credential storage task failed"))?
    }

    pub(super) async fn save(&self, credentials: &Credentials) -> Result<(), CliError> {
        if credentials.origin != self.origin || !credentials.valid() {
            return Err(storage_error("Refusing invalid Developers credentials"));
        }
        let raw = serde_json::to_string(credentials)
            .map_err(|_| storage_error("Could not serialize Developers credentials"))?;
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            write_private(&store.root, &store.path("json"), raw.as_bytes())
        })
        .await
        .map_err(|_| storage_error("Credential storage task failed"))?
    }

    pub(super) async fn clear(&self) -> Result<(), CliError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || remove_private(&store.path("json")))
            .await
            .map_err(|_| storage_error("Credential storage task failed"))?
    }

    #[cfg(test)]
    pub(super) fn fixture(root: PathBuf, origin: &str) -> Self {
        Self::new(root, origin).unwrap()
    }
}
