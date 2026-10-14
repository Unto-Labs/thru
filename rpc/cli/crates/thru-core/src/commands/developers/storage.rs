//! Origin-isolated OAuth storage. File fallback requires explicit user selection.
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
    file_backend: bool,
}

pub(super) struct Guard(File);
impl Drop for Guard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

fn storage_error(message: &str) -> CliError {
    failure("CREDENTIAL_STORE", message, None)
}

#[cfg(unix)]
fn validate_owner(metadata: &fs::Metadata) -> Result<(), CliError> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    // geteuid reads process identity; it does not touch or disclose credentials.
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.permissions().mode() & 0o077 != 0 {
        return Err(storage_error(
            "Developers credential storage must be owned by this user with owner-only permissions",
        ));
    }
    Ok(())
}
#[cfg(not(unix))]
fn validate_owner(_: &fs::Metadata) -> Result<(), CliError> {
    Ok(())
}

fn secure_open(path: &Path, write: bool, create: bool) -> Result<File, CliError> {
    let mut options = OpenOptions::new();
    options.read(true).write(write).create(create);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(storage_error("Refusing unsafe Developers credential file"));
        }
        validate_owner(&meta)?;
    }
    let file = options
        .open(path)
        .map_err(|_| storage_error("Could not open owner-only Developers credential storage"))?;
    validate_owner(
        &file
            .metadata()
            .map_err(|_| storage_error("Could not inspect credential file permissions"))?,
    )?;
    Ok(file)
}

impl Store {
    pub(super) fn configured(origin: &str) -> Result<Self, CliError> {
        let file_backend = match std::env::var("THRU_DEVELOPERS_CREDENTIAL_STORE").as_deref() {
            Err(std::env::VarError::NotPresent) | Ok("keyring") => false,
            Ok("file") => true,
            _ => {
                return Err(storage_error(
                    "THRU_DEVELOPERS_CREDENTIAL_STORE must be keyring or explicitly file",
                ));
            }
        };
        #[cfg(not(unix))]
        if file_backend {
            return Err(storage_error(
                "File credential fallback is supported only on Unix; use the OS keyring",
            ));
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        if !file_backend {
            return Err(storage_error(
                "No native keyring backend for this platform; explicitly select owner-only file storage",
            ));
        }
        let root = crate::config::Config::get_config_dir()?.join("auth");
        Self::new(root, origin, file_backend)
    }

    fn new(root: PathBuf, origin: &str, file_backend: bool) -> Result<Self, CliError> {
        if let Ok(meta) = fs::symlink_metadata(&root) {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(storage_error(
                    "Refusing unsafe Developers credential directory",
                ));
            }
            validate_owner(&meta)?;
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(&root)
                    .map_err(|_| {
                        storage_error("Could not create owner-only Developers credential directory")
                    })?;
            }
            #[cfg(not(unix))]
            fs::create_dir_all(&root).map_err(|_| {
                storage_error("Could not create Developers credential lock directory")
            })?;
        }
        Ok(Self {
            root,
            origin: origin.to_owned(),
            file_backend,
        })
    }

    fn path(&self, extension: &str) -> PathBuf {
        self.root.join(format!(
            "{}.{extension}",
            hex::encode(Sha256::digest(self.origin.as_bytes()))
        ))
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

    fn entry(&self) -> Result<keyring::Entry, CliError> {
        keyring::Entry::new("org.thru.developers.cli", &self.origin)
            .map_err(|_| Self::keyring_error())
    }
    fn keyring_error() -> CliError {
        storage_error(
            "OS keyring unavailable or locked. Unlock it, or explicitly allow owner-only file storage with THRU_DEVELOPERS_CREDENTIAL_STORE=file",
        )
    }

    pub(super) async fn load(&self) -> Result<Option<Credentials>, CliError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            let raw = if store.file_backend {
                if !store
                    .path("json")
                    .try_exists()
                    .map_err(|_| storage_error("Could not inspect Developers credentials"))?
                {
                    return Ok(None);
                }
                let mut raw = String::new();
                secure_open(&store.path("json"), false, false)?
                    .take(65537)
                    .read_to_string(&mut raw)
                    .map_err(|_| storage_error("Could not read Developers credentials"))?;
                raw
            } else {
                match store.entry()?.get_password() {
                    Ok(raw) => raw,
                    Err(keyring::Error::NoEntry) => return Ok(None),
                    Err(_) => return Err(Self::keyring_error()),
                }
            };
            if raw.len() > 65536 {
                return Err(storage_error("Invalid stored Developers credentials"));
            }
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
            if !store.file_backend {
                return store
                    .entry()?
                    .set_password(&raw)
                    .map_err(|_| Self::keyring_error());
            }
            #[cfg(not(unix))]
            return Err(storage_error(
                "File credential fallback is unsupported on this platform",
            ));
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                let path = store.path("json");
                if path.exists() {
                    let _ = secure_open(&path, false, false)?;
                }
                let temporary = store.path(&format!("tmp-{}", rand::random::<u64>()));
                let result = (|| {
                    let mut file = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .custom_flags(libc::O_NOFOLLOW)
                        .open(&temporary)
                        .map_err(|_| storage_error("Could not create private credential file"))?;
                    file.write_all(raw.as_bytes())
                        .map_err(|_| storage_error("Could not write Developers credentials"))?;
                    file.sync_all()
                        .map_err(|_| storage_error("Could not persist Developers credentials"))?;
                    fs::rename(&temporary, &path).map_err(|_| {
                        storage_error("Could not atomically replace Developers credentials")
                    })?;
                    File::open(&store.root)
                        .and_then(|directory| directory.sync_all())
                        .map_err(|_| storage_error("Could not persist credential directory"))?;
                    Ok(())
                })();
                if result.is_err() {
                    let _ = fs::remove_file(&temporary);
                }
                result
            }
        })
        .await
        .map_err(|_| storage_error("Credential storage task failed"))?
    }

    pub(super) async fn clear(&self) -> Result<(), CliError> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            if store.file_backend {
                if !store
                    .path("json")
                    .try_exists()
                    .map_err(|_| storage_error("Could not inspect Developers credentials"))?
                {
                    return Ok(());
                }
                let _ = secure_open(&store.path("json"), false, false)?;
                fs::remove_file(store.path("json"))
                    .map_err(|_| storage_error("Could not clear Developers credentials"))
            } else {
                match store.entry()?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(_) => Err(Self::keyring_error()),
                }
            }
        })
        .await
        .map_err(|_| storage_error("Credential storage task failed"))?
    }

    #[cfg(test)]
    pub(super) fn fixture(root: PathBuf, origin: &str) -> Self {
        Self::new(root, origin, true).unwrap()
    }
}
