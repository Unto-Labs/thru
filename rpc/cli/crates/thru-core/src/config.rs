//! Configuration management for the Thru CLI

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use thru_base::bootstrap_addresses as programs;
use url::Url;

use crate::error::{CliError, ConfigError};
use crate::keys::{KeyManager, MigrationKeys, StoredEntry, UNQUOTED_SEED_ERROR, decode_seed};
use thru_base::tn_tools::Pubkey;
use zeroize::Zeroizing;

/// All writers share this lock, acquired before reloading the document.
pub(crate) struct MutationLock(std::fs::File);

impl Drop for MutationLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

fn prepare_config_directory(directory: &Path) -> Result<(), CliError> {
    // Only the CLI-owned directory may be tightened. Never chmod through a
    // symlink or change permissions on a directory belonging to another user.
    match std::fs::symlink_metadata(directory) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(CliError::Validation(format!(
                    "Config directory '{}' must be a non-symlink directory",
                    directory.display()
                )));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.uid() != unsafe { libc::geteuid() } {
                    return Err(CliError::Validation(format!(
                        "Config directory '{}' must be owned by this user",
                        directory.display()
                    )));
                }
            }
            #[cfg(unix)]
            if metadata.permissions().mode() & 0o077 != 0 {
                let mut options = std::fs::OpenOptions::new();
                use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
                options
                    .read(true)
                    .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
                let file = options
                    .open(directory)
                    .map_err(|error| config_io(directory, error))?;
                let opened = file
                    .metadata()
                    .map_err(|error| config_io(directory, error))?;
                if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
                    return Err(CliError::Validation(format!(
                        "Config directory '{}' changed",
                        directory.display()
                    )));
                }
                file.set_permissions(std::fs::Permissions::from_mode(
                    metadata.permissions().mode() & !0o077,
                ))
                .map_err(|error| config_io(directory, error))?;
                thru_base::key_file::validate_owner(
                    &file
                        .metadata()
                        .map_err(|error| config_io(directory, error))?,
                    directory,
                )?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            thru_base::key_file::ensure_private_dir(directory)?;
            Ok(())
        }
        Err(error) => Err(config_io(directory, error)),
    }
}

fn config_io(path: &Path, error: std::io::Error) -> CliError {
    CliError::Generic {
        message: format!("Config '{}': {error}", path.display()),
    }
}

pub(crate) async fn lock_config(path: &Path) -> Result<MutationLock, CliError> {
    let directory = path.parent().unwrap_or(Path::new(".")).to_owned();
    tokio::task::spawn_blocking(move || {
        prepare_config_directory(&directory)?;
        let path = directory.join(".keys.lock");
        let file = thru_base::key_file::secure_open(&path, true, true)?;
        fs2::FileExt::lock_exclusive(&file).map_err(|error| config_io(&path, error))?;
        Ok(MutationLock(file))
    })
    .await
    .map_err(|_| CliError::Generic {
        message: "Config lock task failed".into(),
    })?
}

#[cfg(test)]
async fn write_key_file(path: &Path, content: &str) -> Result<(), CliError> {
    write_config_atomic(path, content).map(|_| ())
}

/// Rename commits the registration; a subsequent directory-sync failure cannot
/// roll it back. Return whether it is durable so callers retain old secrets if
/// durability cannot be confirmed.
pub(crate) fn write_config_atomic(path: &Path, content: &str) -> Result<bool, CliError> {
    write_config(path, content, true).map(|(_, durable)| durable)
}

fn write_config(path: &Path, content: &str, overwrite: bool) -> Result<(bool, bool), CliError> {
    use std::io::Write;
    if let Some(directory) = path.parent() {
        prepare_config_directory(directory)?;
    }
    // Preserve an existing config symlink; signing key files never follow links.
    let mut target = path.to_path_buf();
    for hops in 0..=40 {
        let metadata = match std::fs::symlink_metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(config_io(&target, error)),
        };
        if !metadata.file_type().is_symlink() {
            break;
        }
        if hops == 40 {
            return Err(CliError::Validation(format!(
                "Config '{}' symlink chain exceeds 40 hops",
                path.display()
            )));
        }
        let link = std::fs::read_link(&target).map_err(|error| config_io(&target, error))?;
        target = target.parent().unwrap_or_else(|| Path::new("")).join(link);
    }
    // All CLI writers hold MutationLock. The presence check and rename are
    // serialized without requiring filesystem hard-link support.
    if !overwrite
        && target
            .try_exists()
            .map_err(|error| config_io(&target, error))?
    {
        return Ok((false, true));
    }
    #[cfg(unix)]
    let directory = std::fs::File::open(target.parent().unwrap_or(Path::new(".")))
        .map_err(|error| config_io(&target, error))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = target.with_extension(format!("{}.{nanos}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| config_io(&temporary, error))?;
    let result = (|| {
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, &target).map(|_| true)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    let created = result.map_err(|error| config_io(&target, error))?;
    #[cfg(unix)]
    if created {
        if let Err(error) = directory.sync_all() {
            eprintln!(
                "Config '{}' committed, but directory sync failed: {error}; prior signing secrets will be retained",
                target.display()
            );
            return Ok((true, false));
        }
    }
    Ok((created, true))
}

fn document_error(field: String, error: &serde_yaml::Error) -> CliError {
    // YAML error messages can quote secret values; expose metadata only.
    let location = error
        .location()
        .map(|location| format!(" at line {}, column {}", location.line(), location.column()))
        .unwrap_or_default();
    CliError::Validation(format!(
        "Invalid CLI config field '{field}'{location}; invalid YAML syntax, structure, or field type"
    ))
}

/// Recover an original YAML field location without exposing its value.
fn field_error(raw: &str, field: &str) -> CliError {
    struct Locate<'a>(&'a str);
    #[derive(Deserialize)]
    enum InvalidValue {}
    impl<'de> serde::de::Visitor<'de> for Locate<'_> {
        type Value = ();
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("configuration mapping")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
            while let Some(key) = map.next_key::<String>()? {
                if key == self.0 {
                    let value: InvalidValue = map.next_value()?;
                    match value {}
                } else {
                    map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
            Ok(())
        }
    }
    impl<'de> serde::de::DeserializeSeed<'de> for Locate<'_> {
        type Value = ();
        fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
            deserializer.deserialize_map(self)
        }
    }
    let root = field.split(['.', '[']).next().unwrap_or(field);
    match serde::de::DeserializeSeed::deserialize(
        Locate(root),
        serde_yaml::Deserializer::from_str(raw),
    ) {
        Err(error) => document_error(field.to_owned(), &error),
        Ok(()) => CliError::Validation(format!("Invalid CLI config field '{field}'")),
    }
}

/// Canonical block-producer bond program for a freshly bootstrapped network.
fn default_bp_program_public_key() -> String {
    programs::BLOCK_PRODUCER_PROGRAM_ADDRESS.to_string()
}

/// Canonical multisig program for a freshly bootstrapped network.
fn default_multisig_program_public_key() -> String {
    programs::MULTISIG_PROGRAM_ADDRESS.to_string()
}

/// Canonical Multicall program for a freshly bootstrapped network.
fn default_multicall_program_public_key() -> String {
    programs::MULTICALL_PROGRAM_ADDRESS.to_string()
}

/// Hostnames of the official Thru RPC endpoints. This is the single source of
/// truth for which endpoints may receive a developer API key the user did not
/// configure for that network: the environment key (`THRU_API_KEY` /
/// `THRU_DEVELOPERS_API_KEY`) or the key `thru auth login` provisioned.
/// Matching is exact: no wildcards, no subdomains.
pub const OFFICIAL_RPC_HOSTS: &[&str] = &["rpc.alphanet.thru.org", "rpc.betanet.thru.org"];

/// Whether `rpc_base_url` is an official Thru RPC endpoint reached over HTTPS:
/// scheme `https`, host exactly one of [`OFFICIAL_RPC_HOSTS`], default port
/// 443, and no userinfo. Anything that fails to parse is untrusted.
pub fn is_official_rpc_endpoint(rpc_base_url: &str) -> bool {
    let Ok(url) = Url::parse(rpc_base_url) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(url.host(), Some(url::Host::Domain(host)) if OFFICIAL_RPC_HOSTS.contains(&host))
}

/// Whether an API key the user did not configure for this network may be sent:
/// only to an official endpoint (see [`is_official_rpc_endpoint`]) with TLS
/// verification on.
pub fn api_key_eligible_endpoint(rpc_base_url: &str, insecure: bool) -> bool {
    !insecure && is_official_rpc_endpoint(rpc_base_url)
}

/// Bearer token to send to the RPC endpoint. Precedence: an explicitly
/// configured token (any endpoint), else, only for an official endpoint with
/// TLS verification on, the environment API key, else the key provisioned by
/// `thru auth login`, else none. `provisioned_key` is called only when its
/// key would be sent, so its file is not read otherwise.
pub fn resolve_rpc_auth_token(
    configured: Option<&str>,
    env_api_key: Option<&str>,
    provisioned_key: impl FnOnce() -> Option<String>,
    rpc_base_url: &str,
    insecure: bool,
) -> Option<String> {
    if let Some(token) = configured {
        return Some(token.to_string());
    }
    if !api_key_eligible_endpoint(rpc_base_url, insecure) {
        return None;
    }
    match env_api_key {
        Some(key) => Some(key.to_string()),
        None => provisioned_key(),
    }
}

/// Where the API key provisioned by `thru auth login` comes from.
pub trait ProvisionedKeySource: Send + Sync {
    /// Whether a provisioned key is recorded. Must not read the secret.
    fn present(&self) -> bool;
    /// Reads the secret; called at most once.
    fn load(&self) -> Option<String>;
}

/// Runtime-only handle to the provisioned API key, read on first use. Never
/// serialized, and its `Debug` output never contains the secret.
#[derive(Clone, Default)]
pub struct ProvisionedApiKey {
    source: Option<Arc<dyn ProvisionedKeySource>>,
    loaded: Arc<OnceLock<Option<String>>>,
}

impl ProvisionedApiKey {
    pub fn new(source: Arc<dyn ProvisionedKeySource>) -> Self {
        Self {
            source: Some(source),
            loaded: Arc::default(),
        }
    }

    /// Whether a provisioned key is recorded, without reading the secret.
    pub fn is_present(&self) -> bool {
        match self.loaded.get() {
            Some(loaded) => loaded.is_some(),
            None => self.source.as_ref().is_some_and(|source| source.present()),
        }
    }

    /// The secret, loaded from its source on first call.
    pub fn get(&self) -> Option<String> {
        let source = self.source.as_ref()?;
        self.loaded.get_or_init(|| source.load()).clone()
    }
}

impl std::fmt::Debug for ProvisionedApiKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProvisionedApiKey")
            .field("configured", &self.source.is_some())
            .finish_non_exhaustive()
    }
}

/// Named network profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub url: String,
    pub auth_token: Option<String>,
}

/// Configuration structure for the Thru CLI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Endpoint for gRPC requests (e.g. http://127.0.0.1:8472 or https://rpc.alphanet.thru.org)
    pub rpc_base_url: String,

    /// Key management
    #[serde(default)]
    pub keys: KeyManager,

    /// Uploader program public key
    pub uploader_program_public_key: String,

    /// Manager program public key
    pub manager_program_public_key: String,

    /// Optional, explicitly uploaded test fixture for compression debug commands.
    /// No System program is installed by production genesis or bootstrap.
    #[serde(default)]
    pub system_test_program_public_key: Option<String>,

    /// ABI manager program public key
    pub abi_manager_program_public_key: String,

    /// Token program public key
    pub token_program_public_key: String,

    /// Consensus validator program public key
    pub consensus_validator_program_public_key: String,

    /// Consensus attestor table public key
    pub consensus_attestor_table_public_key: String,

    /// Consensus converted vault public key
    pub consensus_converted_vault_public_key: String,

    /// Consensus unclaimed vault public key
    pub consensus_unclaimed_vault_public_key: String,

    /// WTHRU program public key
    pub wthru_program_public_key: String,

    /// Block-producer (BP) bond program public key
    #[serde(default = "default_bp_program_public_key")]
    pub bp_program_public_key: String,

    /// Multisig program public key
    #[serde(default = "default_multisig_program_public_key")]
    pub multisig_program_public_key: String,

    /// Multicall program public key (program + ABI deploys)
    #[serde(default = "default_multicall_program_public_key")]
    pub multicall_program_public_key: String,

    /// Base name service program public key
    pub name_service_program_public_key: String,

    /// Thru registrar program public key
    pub thru_registrar_program_public_key: String,

    /// Request timeout in seconds
    pub timeout_seconds: u64,

    /// Maximum number of retries for failed requests
    pub max_retries: u32,

    /// Optional authorization token for HTTP requests
    pub auth_token: Option<String>,

    /// Custom toolchain installation path
    pub toolchain_path: Option<PathBuf>,

    /// Installed toolchain version
    pub toolchain_version: Option<String>,

    /// Custom SDK installation paths (by language)
    pub sdk_paths: Option<std::collections::HashMap<String, PathBuf>>,

    /// Installed SDK versions (by language)
    pub sdk_versions: Option<std::collections::HashMap<String, String>>,

    /// GitHub repository for SDK and toolchain downloads (format: "owner/repo")
    pub github_repo: Option<String>,

    /// Named network profiles (e.g. "local", "alphanet")
    #[serde(default)]
    pub networks: HashMap<String, NetworkConfig>,

    /// Which named network profile is active by default
    #[serde(default)]
    pub default_network: Option<String>,

    /// Skip TLS certificate verification for HTTPS endpoints. Set per-invocation
    /// from the global `--insecure` flag; never persisted to the config file.
    #[serde(default, skip_serializing)]
    pub insecure: bool,

    /// Runtime-only: whether transaction-submitting commands should print the
    /// pending signature to stderr before sending. Set from the CLI flags in
    /// `run` (enabled outside `--json`/`--quiet`); never persisted to disk.
    #[serde(skip)]
    pub announce_pending_signature: bool,

    /// Runtime-only: developer API key read from the environment. Never
    /// serialized, so no config mutation can persist it. Only sent to official
    /// endpoints; read it through [`Config::rpc_auth_token`].
    #[serde(skip)]
    pub env_api_key: Option<String>,

    /// Runtime-only: org API key provisioned by `thru auth login`, read from the
    /// owner-only files under `~/.thru/cli/auth` only when it would be sent.
    /// Never serialized, so no config mutation can persist it. Only sent to
    /// official endpoints; read it through [`Config::rpc_auth_token`].
    #[serde(skip)]
    pub provisioned_api_key: ProvisionedApiKey,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            rpc_base_url: "https://rpc.alphanet.thru.org".to_string(),
            keys: KeyManager::new(),
            uploader_program_public_key: programs::UPLOADER_PROGRAM_ADDRESS.to_string(),
            manager_program_public_key: programs::MANAGER_PROGRAM_ADDRESS.to_string(),
            system_test_program_public_key: None,
            abi_manager_program_public_key: programs::ABI_MANAGER_PROGRAM_ADDRESS.to_string(),
            token_program_public_key: programs::TOKEN_PROGRAM_ADDRESS.to_string(),
            consensus_validator_program_public_key: programs::CONSENSUS_VALIDATOR_PROGRAM_ADDRESS
                .to_string(),
            consensus_attestor_table_public_key: programs::ATTESTOR_TABLE_ADDRESS.to_string(),
            consensus_converted_vault_public_key: programs::CONVERTED_VAULT_ADDRESS.to_string(),
            consensus_unclaimed_vault_public_key: programs::UNCLAIMED_VAULT_ADDRESS.to_string(),
            wthru_program_public_key: programs::WTHRU_PROGRAM_ADDRESS.to_string(),
            bp_program_public_key: default_bp_program_public_key(),
            multisig_program_public_key: default_multisig_program_public_key(),
            multicall_program_public_key: default_multicall_program_public_key(),
            name_service_program_public_key: programs::NAME_SERVICE_PROGRAM_ADDRESS.to_string(),
            thru_registrar_program_public_key: programs::THRU_REGISTRAR_PROGRAM_ADDRESS.to_string(),
            timeout_seconds: 30,
            max_retries: 3,
            auth_token: None,
            toolchain_path: None,
            toolchain_version: None,
            sdk_paths: None,
            sdk_versions: None,
            github_repo: None,
            networks: HashMap::new(),
            default_network: None,
            insecure: false,
            announce_pending_signature: false,
            env_api_key: None,
            provisioned_api_key: ProvisionedApiKey::default(),
        }
    }
}

impl Config {
    /// Load existing configuration without rewriting it. Defaults are in-memory.
    /// Only a missing configuration is initialized, without any signing secret.
    pub async fn load() -> Result<Self, CliError> {
        let config_path = Self::get_config_path()?;
        if !config_path.exists() {
            Self::create_default_config().await?;
        }
        Self::load_existing_path(&config_path).await
    }

    async fn load_existing_path(config_path: &Path) -> Result<Self, CliError> {
        let raw = Self::read_document(config_path).await?;
        let config = Self::from_document(config_path, &raw)?;
        config.validate().map_err(|error| {
            if let CliError::Validation(message) = &error {
                if let Some(field) = message
                    .strip_prefix("Invalid CLI config field '")
                    .and_then(|message| message.split('\'').next())
                {
                    return field_error(&raw, field);
                }
            }
            error
        })?;
        Ok(config)
    }

    /// Caller holds the mutation lock; validation occurs once, at commit.
    pub(crate) async fn load_for_update(config_path: &Path) -> Result<Self, CliError> {
        match Self::read_document(config_path).await {
            Ok(raw) => {
                // Writing a config read with inline entries would drop their
                // seeds, so every writer requires migration first.
                let config = Self::from_document(config_path, &raw)?;
                config.require_writable_at(config_path)?;
                Ok(config)
            }
            Err(CliError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut config = Self::default();
                config
                    .keys
                    .set_base_dir(config_path.parent().unwrap_or(Path::new(".")).to_owned());
                Ok(config)
            }
            Err(error) => Err(error),
        }
    }

    /// Fail before a command's side effects (installing or deleting files) when
    /// its later config update would be refused: every config writer requires
    /// legacy inline signing keys to be migrated first.
    pub fn require_writable(&self) -> Result<(), CliError> {
        match Self::get_config_path() {
            Ok(path) => self.require_writable_at(&path),
            Err(_) => self.require_writable_at(Path::new("The CLI config")),
        }
    }

    fn require_writable_at(&self, config_path: &Path) -> Result<(), CliError> {
        let inline = self.keys.unmigrated_aliases();
        if inline.is_empty() {
            return Ok(());
        }
        Err(CliError::Validation(format!(
            "{} still stores signing keys inline ({}); run 'thru keys migrate' before changing the config",
            config_path.display(),
            inline.join(", ")
        )))
    }

    /// Legacy inline entries do not block reading: only their alias names are
    /// kept (the seeds are dropped here and stay in the file), so commands that
    /// never sign keep working and a lookup of such an alias points at
    /// `thru keys migrate`. Writers refuse them in `load_for_update`.
    fn from_document(config_path: &Path, raw: &str) -> Result<Self, CliError> {
        let (mut config, inline) = Self::parse_document(raw)?;
        config
            .keys
            .set_unmigrated(inline.into_iter().map(|(name, _seed)| name));
        config
            .keys
            .set_base_dir(config_path.parent().unwrap_or(Path::new(".")).to_owned());
        Ok(config)
    }

    pub(crate) async fn read_document(path: &Path) -> Result<Zeroizing<String>, CliError> {
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            use std::io::Read;
            const LIMIT: u64 = 1024 * 1024;
            let context = |error: std::io::Error| {
                std::io::Error::new(
                    error.kind(),
                    format!("Config '{}': {error}", path.display()),
                )
            };
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NONBLOCK);
            }
            let mut file = options.open(&path).map_err(context)?;
            let metadata = file.metadata().map_err(context)?;
            if !metadata.is_file() || metadata.len() > LIMIT {
                return Err(CliError::Validation(format!(
                    "Config '{}' must be a regular file of at most 1 MiB",
                    path.display()
                )));
            }
            // A fixed, zeroizing allocation prevents secret-bearing reallocations.
            // One spare byte detects growth while the config is being read.
            let mut bytes = Zeroizing::new(vec![0; metadata.len() as usize + 1]);
            let mut length = 0;
            loop {
                if length == bytes.len() {
                    return Err(CliError::Validation(format!(
                        "Config '{}' changed while being read",
                        path.display()
                    )));
                }
                let read = file.read(&mut bytes[length..]).map_err(context)?;
                if read == 0 {
                    break;
                }
                length += read;
            }
            bytes.truncate(length);
            match String::from_utf8(std::mem::take(&mut *bytes)) {
                Ok(raw) => Ok(Zeroizing::new(raw)),
                Err(error) => {
                    let _invalid_bytes = Zeroizing::new(error.into_bytes());
                    Err(CliError::Validation(format!(
                        "Config '{}' is not valid UTF-8",
                        path.display()
                    )))
                }
            }
        })
        .await
        .map_err(|_| CliError::Generic {
            message: "Config read task failed".into(),
        })?
    }

    /// Parse legacy seeds directly into zeroizing ownership, never a generic
    /// YAML value that could be serialized back to disk or displayed in errors.
    pub(crate) fn parse_document(
        raw: &str,
    ) -> Result<(Self, Vec<(String, Zeroizing<[u8; 32]>)>), CliError> {
        #[derive(Deserialize)]
        struct Document {
            #[serde(default)]
            keys: MigrationKeys,
            #[serde(flatten)]
            fields: serde_yaml::Mapping,
        }
        let document: Document =
            serde_path_to_error::deserialize(serde_yaml::Deserializer::from_str(raw))
                .map_err(|error| document_error(error.path().to_string(), error.inner()))?;
        let mut keys = KeyManager::new();
        let mut inline = Vec::new();
        for (name, entry) in document.keys.0 {
            match entry {
                StoredEntry::Reference(entry) => keys
                    .insert_migrated_entry(&name, entry, false)
                    .map_err(|_| field_error(raw, "keys"))?,
                StoredEntry::Inline(seed) => inline.push((
                    name,
                    decode_seed(seed.as_bytes()).map_err(|_| field_error(raw, "keys"))?,
                )),
                StoredEntry::UnquotedNumber => {
                    let mut error = field_error(raw, "keys");
                    if let CliError::Validation(message) = &mut error {
                        message.push_str("; ");
                        message.push_str(UNQUOTED_SEED_ERROR);
                    }
                    return Err(error);
                }
            }
        }
        let mut fields = document.fields;
        fields.insert(
            "keys".into(),
            serde_yaml::to_value(keys).map_err(ConfigError::InvalidFormat)?,
        );
        let config: Config = serde_path_to_error::deserialize(serde_yaml::Value::Mapping(fields))
            .map_err(|error| field_error(raw, &error.path().to_string()))?;
        Ok((config, inline))
    }

    /// Apply field-level intent to the latest document under the shared lock.
    pub async fn update(
        apply: impl FnOnce(&mut Self) -> Result<(), CliError>,
    ) -> Result<Self, CliError> {
        Self::update_path(&Self::get_config_path()?, apply).await
    }

    async fn update_path(
        path: &Path,
        apply: impl FnOnce(&mut Self) -> Result<(), CliError>,
    ) -> Result<Self, CliError> {
        let lock = lock_config(path).await?;
        let mut config = Self::load_for_update(path).await?;
        apply(&mut config)?;
        config.validate()?;
        let raw = Self::generate_config_template(&config);
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let _lock = lock;
            write_config_atomic(&path, &raw)?;
            Ok::<_, CliError>(config)
        })
        .await
        .map_err(|_| CliError::Generic {
            message: "Config update task failed".into(),
        })?
    }

    /// Validate the configuration without reading signing secrets.
    pub fn validate(&self) -> Result<(), CliError> {
        let invalid =
            |field: &str| CliError::Validation(format!("Invalid CLI config field '{field}'"));
        Url::parse(&self.rpc_base_url).map_err(|error| {
            CliError::Validation(format!("Invalid RPC URL in 'rpc_base_url': {error}"))
        })?;
        for (name, network) in &self.networks {
            Url::parse(&network.url).map_err(|error| {
                CliError::Validation(format!("Invalid network URL for profile {name:?}: {error}"))
            })?;
        }
        self.keys.validate_all_keys().map_err(|_| invalid("keys"))?;
        for (field, value) in [
            (
                "uploader_program_public_key",
                &self.uploader_program_public_key,
            ),
            (
                "manager_program_public_key",
                &self.manager_program_public_key,
            ),
            (
                "abi_manager_program_public_key",
                &self.abi_manager_program_public_key,
            ),
            ("token_program_public_key", &self.token_program_public_key),
            (
                "consensus_validator_program_public_key",
                &self.consensus_validator_program_public_key,
            ),
            (
                "consensus_attestor_table_public_key",
                &self.consensus_attestor_table_public_key,
            ),
            (
                "consensus_converted_vault_public_key",
                &self.consensus_converted_vault_public_key,
            ),
            (
                "consensus_unclaimed_vault_public_key",
                &self.consensus_unclaimed_vault_public_key,
            ),
        ] {
            Pubkey::new(value.clone()).map_err(|_| invalid(field))?;
        }

        Ok(())
    }

    /// Get the consensus validator program public key
    pub fn get_consensus_validator_program_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.consensus_validator_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the consensus attestor table public key
    pub fn get_consensus_attestor_table_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.consensus_attestor_table_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the consensus converted vault public key
    pub fn get_consensus_converted_vault_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.consensus_converted_vault_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the consensus unclaimed vault public key
    pub fn get_consensus_unclaimed_vault_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.consensus_unclaimed_vault_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Resolve the configured WTHRU program public key or return a helpful error
    pub fn get_wthru_program_pubkey(&self) -> Result<Pubkey, CliError> {
        if self.wthru_program_public_key.trim().is_empty() {
            return Err(CliError::Validation(
                "wthru_program_public_key is not configured; set it in config.yaml or pass --program".to_string(),
            ));
        }

        Pubkey::new(self.wthru_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Resolve the configured block-producer bond program public key
    pub fn get_bp_program_pubkey(&self) -> Result<Pubkey, CliError> {
        let key = if self.bp_program_public_key.trim().is_empty() {
            default_bp_program_public_key()
        } else {
            self.bp_program_public_key.clone()
        };

        Pubkey::new(key).map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the configuration file path
    pub fn get_config_path() -> Result<PathBuf, CliError> {
        let home_dir = dirs::home_dir().ok_or_else(|| CliError::Generic {
            message: "Could not find home directory".to_string(),
        })?;

        Ok(home_dir.join(".thru").join("cli").join("config.yaml"))
    }

    /// Get the configuration directory path
    pub fn get_config_dir() -> Result<PathBuf, CliError> {
        let home_dir = dirs::home_dir().ok_or_else(|| CliError::Generic {
            message: "Could not find home directory".to_string(),
        })?;

        Ok(home_dir.join(".thru").join("cli"))
    }

    /// Create the default configuration file
    pub async fn create_default_config() -> Result<(), CliError> {
        let config_path = Self::get_config_path()?;
        let lock = lock_config(&config_path).await?;

        // Create default config
        let default_config = Config::default();
        let config_content = Self::generate_config_template(&default_config);

        let creating = config_path.clone();
        let (created, _) = tokio::task::spawn_blocking(move || {
            let _lock = lock;
            write_config(&creating, &config_content, false)
        })
        .await
        .map_err(|_| CliError::Generic {
            message: "Config creation task failed".into(),
        })??;
        if created {
            eprintln!(
                "Created default configuration at: {}",
                config_path.display()
            );
            eprintln!(
                "Create a signing key with 'thru keys generate default', or register one with 'thru keys add default --file <path>'."
            );
        }

        Ok(())
    }

    /// Generate a configuration template with comments
    pub(crate) fn generate_config_template(config: &Config) -> String {
        // Use serde to serialize the config to YAML format
        let yaml_content = serde_yaml::to_string(config).unwrap_or_default();

        format!(
            r#"# Thru CLI Configuration File
# This file contains settings for the Thru command-line interface
# Signing keys are stored separately; this file contains only key references.

{}
"#,
            yaml_content
        )
    }

    /// Get the gRPC endpoint as a host:port URL string suitable for tonic
    pub fn get_grpc_url(&self) -> Result<Url, CliError> {
        let mut url =
            Url::parse(&self.rpc_base_url).map_err(|e| ConfigError::InvalidUrl(e.to_string()))?;

        let scheme = url.scheme().to_string();
        if scheme != "http" && scheme != "https" {
            return Err(ConfigError::InvalidUrl(format!(
                "unsupported scheme '{}'; expected http or https",
                scheme
            ))
            .into());
        }

        if url.host_str().is_none() {
            return Err(
                ConfigError::InvalidUrl("missing host in gRPC endpoint".to_string()).into(),
            );
        }

        // Paths other than "/" are not supported for gRPC endpoints
        if url.path() != "/" && !url.path().is_empty() {
            return Err(ConfigError::InvalidUrl(
                "gRPC endpoint must not include a path".to_string(),
            )
            .into());
        }

        // Ensure path is exactly "/"
        url.set_path("/");

        // Set default ports only if not explicitly specified
        if url.port().is_none() {
            match scheme.as_str() {
                "http" => {
                    let _ = url.set_port(Some(80));
                }
                "https" => {
                    let _ = url.set_port(Some(443));
                }
                _ => {}
            }
        }

        Ok(url)
    }

    /// Get the uploader program public key
    pub fn get_uploader_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.uploader_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the manager program public key
    pub fn get_manager_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.manager_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    pub fn get_system_test_program_pubkey(&self) -> Result<Pubkey, CliError> {
        let address = self.system_test_program_public_key.as_ref().ok_or_else(|| {
            CliError::Validation("This debug command requires an explicitly uploaded System test program; set system_test_program_public_key in the CLI config. Production bootstrap does not install it.".into())
        })?;
        Pubkey::new(address.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the ABI manager program public key
    pub fn get_abi_manager_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.abi_manager_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the token program public key
    pub fn get_token_program_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.token_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the multisig program public key
    pub fn get_multisig_program_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.multisig_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Get the Multicall program public key
    pub fn get_multicall_program_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.multicall_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }

    /// Bearer token for RPC requests; see [`resolve_rpc_auth_token`].
    pub fn rpc_auth_token(&self) -> Option<String> {
        resolve_rpc_auth_token(
            self.auth_token.as_deref(),
            self.env_api_key.as_deref(),
            || self.provisioned_api_key.get(),
            &self.rpc_base_url,
            self.insecure,
        )
    }

    /// Whether [`Config::rpc_auth_token`] would return a token, without reading
    /// the key `thru auth login` provisioned (so its secret file is not
    /// touched). A recorded but unreadable provisioned key counts as present.
    pub fn rpc_auth_token_present(&self) -> bool {
        self.auth_token.is_some()
            || (api_key_eligible_endpoint(&self.rpc_base_url, self.insecure)
                && (self.env_api_key.is_some() || self.provisioned_api_key.is_present()))
    }

    /// Whether an environment API key is present but withheld because the
    /// endpoint is not trusted and no token is configured for it.
    pub fn env_api_key_withheld(&self) -> bool {
        self.auth_token.is_none()
            && self.env_api_key.is_some()
            && !api_key_eligible_endpoint(&self.rpc_base_url, self.insecure)
    }

    /// Whether the key provisioned by `thru auth login` is recorded but
    /// withheld because the endpoint is not trusted, and no configured token or
    /// environment key would have been used instead. Never reads the secret.
    pub fn provisioned_api_key_withheld(&self) -> bool {
        self.auth_token.is_none()
            && self.env_api_key.is_none()
            && !api_key_eligible_endpoint(&self.rpc_base_url, self.insecure)
            && self.provisioned_api_key.is_present()
    }

    /// List all configured network profile names (sorted)
    pub fn list_network_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.networks.keys().cloned().collect();
        names.sort();
        names
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn partial_commented_readonly_config_is_never_rewritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let raw =
            "# Preserve this operator comment\nrpc_base_url: http://localhost:8472\nkeys: {}\n";
        std::fs::write(&path, raw).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        let config = Config::load_existing_path(&path).await.unwrap();
        assert_eq!(config.timeout_seconds, Config::default().timeout_seconds);
        assert!(config.keys.list_keys().is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            before
        );
        assert_eq!(
            std::fs::metadata(directory.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o500
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn invalid_yaml_reports_field_location_without_values() {
        let seed = hex::encode([73; 32]);
        for raw in [
            format!("timeout_seconds: '{seed}'\nkeys: {{}}\n"),
            format!("keys:\n  old: '{seed}'\ntimeout_seconds: [1]\n"),
            format!("keys:\n  old: wrong-{seed}\n"),
        ] {
            let error = Config::parse_document(&raw).unwrap_err().to_string();
            assert!(error.contains("field"));
            assert!(error.contains("line"));
            assert!(error.contains("column"));
            assert!(!error.contains(&seed));
            if raw.contains("timeout_seconds") {
                assert!(error.contains("timeout_seconds"));
            } else {
                assert!(error.contains("keys"));
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn config_mutation_repairs_only_owned_real_directory() {
        let directory = tempfile::tempdir().unwrap();
        let cli = directory.path().join("cli");
        std::fs::create_dir(&cli).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = cli.join("config.yaml");
        std::fs::write(&path, "keys: {}\n").unwrap();
        Config::update_path(&path, |config| {
            config.timeout_seconds = 91;
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(
            std::fs::metadata(&cli).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .starts_with("# Thru CLI Configuration File")
        );
        let link = directory.path().join("linked");
        std::os::unix::fs::symlink(&cli, &link).unwrap();
        let error = Config::update_path(&link.join("config.yaml"), |_| Ok(()))
            .await
            .unwrap_err();
        assert!(error.to_string().contains(link.to_str().unwrap()));
    }

    #[tokio::test]
    async fn concurrent_field_intents_preserve_keys_networks_and_dev_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let (_secrets, keys) = KeyManager::test_fixture(&[("new-key", [74; 32])]);
        let entry = keys.get_entry("new-key").unwrap().clone();
        let (key_write, network_write, dev_write) = tokio::join!(
            Config::update_path(&path, |config| config
                .keys
                .insert_entry("new-key", entry, false)),
            Config::update_path(&path, |config| {
                config.networks.insert(
                    "new-network".into(),
                    NetworkConfig {
                        url: "http://localhost:8472".into(),
                        auth_token: None,
                    },
                );
                Ok(())
            }),
            Config::update_path(&path, |config| {
                config
                    .sdk_versions
                    .get_or_insert_with(Default::default)
                    .insert("rust".into(), "v1".into());
                Ok(())
            }),
        );
        key_write.unwrap();
        network_write.unwrap();
        dev_write.unwrap();
        let loaded = Config::load_existing_path(&path).await.unwrap();
        assert!(loaded.keys.has_key("new-key"));
        assert!(loaded.networks.contains_key("new-network"));
        assert_eq!(loaded.sdk_versions.unwrap()["rust"], "v1");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_writes_through_symlinked_config() {
        let directory = tempfile::tempdir().unwrap();
        let real_directory = directory.path().join("real");
        std::fs::create_dir(&real_directory).unwrap();
        let real_path = real_directory.join("config.yaml");
        std::fs::write(&real_path, "old\n").unwrap();
        std::fs::set_permissions(&real_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let cli_directory = directory.path().join("cli");
        std::fs::create_dir(&cli_directory).unwrap();
        let cli_link_path = cli_directory.join("config.yaml");
        std::os::unix::fs::symlink(&real_path, &cli_link_path).unwrap();

        write_key_file(&cli_link_path, "new\n").await.unwrap();

        assert!(
            std::fs::symlink_metadata(&cli_link_path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(&real_path).unwrap(), "new\n");
        assert_eq!(
            std::fs::metadata(&real_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let entries: Vec<_> = std::fs::read_dir(&real_directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("config.yaml")]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_creates_missing_symlink_target() {
        let directory = tempfile::tempdir().unwrap();
        let real_directory = directory.path().join("real");
        std::fs::create_dir(&real_directory).unwrap();
        let real_path = real_directory.join("config.yaml");
        let cli_link_path = directory.path().join("config.yaml");
        std::os::unix::fs::symlink("real/config.yaml", &cli_link_path).unwrap();

        write_key_file(&cli_link_path, "new\n").await.unwrap();

        assert!(
            std::fs::symlink_metadata(&cli_link_path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(&real_path).unwrap(), "new\n");
        assert_eq!(
            std::fs::metadata(&real_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let entries: Vec<_> = std::fs::read_dir(&real_directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("config.yaml")]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_save_keeps_existing_config() {
        if std::env::var_os("THRU_FAILED_SAVE_CHILD").is_some() {
            // RLIMIT_FSIZE forces a write failure where an owner cannot force a chmod failure.
            unsafe {
                assert_ne!(libc::signal(libc::SIGXFSZ, libc::SIG_IGN), libc::SIG_ERR);
                let limit = libc::rlimit {
                    rlim_cur: 64,
                    rlim_max: 64,
                };
                assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
            }
            let path = Config::get_config_path().unwrap();
            assert!(
                write_key_file(&path, &Config::generate_config_template(&Config::default()))
                    .await
                    .is_err()
            );
            return;
        }

        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".thru/cli/config.yaml");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "original keys\n").unwrap();

        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "config::tests::failed_save_keeps_existing_config",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("HOME", home.path())
            .env("THRU_FAILED_SAVE_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original keys\n");
        let entries: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("config.yaml")]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_config_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        if std::env::var_os("THRU_PERMISSIONS_CHILD").is_none() {
            let home = tempfile::tempdir().unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "config::tests::test_config_file_permissions",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env("HOME", home.path())
                .env("THRU_PERMISSIONS_CHILD", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "stdout: {}\nstderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        }

        Config::create_default_config().await.unwrap();
        let directory = Config::get_config_dir().unwrap();
        let path = Config::get_config_path().unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let config = Config::default();
        let expected = Config::generate_config_template(&config);
        std::fs::write(&path, &expected).unwrap();
        Config::update(|_| Ok(())).await.unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), expected);
    }

    #[test]
    fn system_test_program_requires_explicit_configuration() {
        let mut config = Config::default();
        assert!(config.get_system_test_program_pubkey().is_err());
        config.system_test_program_public_key = Some(programs::SYSTEM_TEST_PROGRAM_ADDRESS.into());
        assert_eq!(
            config
                .get_system_test_program_pubkey()
                .unwrap()
                .to_bytes()
                .unwrap(),
            programs::SYSTEM_TEST_PROGRAM_BYTES
        );
        config.system_test_program_public_key = Some("invalid".into());
        assert!(config.get_system_test_program_pubkey().is_err());
    }

    #[test]
    fn canonical_defaults_preserve_explicit_network_addresses() {
        let config = Config::default();
        assert_eq!(
            config.token_program_public_key,
            programs::TOKEN_PROGRAM_ADDRESS
        );
        assert_eq!(
            config.abi_manager_program_public_key,
            programs::ABI_MANAGER_PROGRAM_ADDRESS
        );
        assert_eq!(
            config.wthru_program_public_key,
            programs::WTHRU_PROGRAM_ADDRESS
        );
        assert_eq!(
            config.bp_program_public_key,
            programs::BLOCK_PRODUCER_PROGRAM_ADDRESS
        );
        assert_eq!(
            config.consensus_attestor_table_public_key,
            programs::ATTESTOR_TABLE_ADDRESS
        );

        let mut saved = serde_yaml::to_value(&config).unwrap();
        saved["token_program_public_key"] = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq".into();
        saved["bp_program_public_key"] = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEO".into();
        let loaded: Config = serde_yaml::from_value(saved).unwrap();
        assert_eq!(
            loaded.token_program_public_key,
            "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq"
        );
        assert_eq!(
            loaded.bp_program_public_key,
            "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEO"
        );
        assert_eq!(loaded.rpc_base_url, config.rpc_base_url);
    }

    #[test]
    fn official_rpc_endpoint_predicate() {
        for url in [
            "https://rpc.alphanet.thru.org",
            "https://rpc.alphanet.thru.org/",
            "https://rpc.alphanet.thru.org:443",
            "https://RPC.Betanet.Thru.Org",
            "https://rpc.betanet.thru.org",
        ] {
            assert!(is_official_rpc_endpoint(url), "{url} should be trusted");
        }
        for url in [
            "http://rpc.alphanet.thru.org",
            "http://rpc.betanet.thru.org:443",
            "https://rpc.alphanet.thru.org:8443",
            "https://other.example",
            "https://thru.org",
            "https://dev.thru.org",
            "https://evil.thru.org",
            "https://x.rpc.alphanet.thru.org",
            "https://rpc.alphanet.thru.org.evil.com",
            "https://rpc.alphanet.thru.org.",
            "https://rpc-alphanet.thru.org",
            "https://rpc.alphanet.thru.org@evil.com",
            "https://user@rpc.alphanet.thru.org",
            "https://user:pass@rpc.alphanet.thru.org",
            "https://evil.com#@rpc.alphanet.thru.org",
            "https://evil.com\\@rpc.alphanet.thru.org",
            "https://127.0.0.1",
            "https://[::1]",
            "https://34.120.0.1:443",
            "rpc.alphanet.thru.org",
            "not a url",
            "",
        ] {
            assert!(!is_official_rpc_endpoint(url), "{url} should be untrusted");
        }
    }

    #[test]
    fn rpc_auth_token_precedence() {
        let no_key = || None;
        let official = "https://rpc.alphanet.thru.org";
        let other = "https://other.example";
        // Configured token wins for any endpoint, even with an env key present.
        for url in [official, other, "http://localhost:8472"] {
            assert_eq!(
                resolve_rpc_auth_token(Some("configured"), Some("env"), no_key, url, false)
                    .as_deref(),
                Some("configured")
            );
            assert_eq!(
                resolve_rpc_auth_token(Some("configured"), None, no_key, url, true).as_deref(),
                Some("configured")
            );
        }
        // Env key only for a trusted endpoint with TLS verification on.
        assert_eq!(
            resolve_rpc_auth_token(None, Some("env"), no_key, official, false).as_deref(),
            Some("env")
        );
        assert_eq!(
            resolve_rpc_auth_token(None, Some("env"), no_key, other, false),
            None
        );
        assert_eq!(
            resolve_rpc_auth_token(
                None,
                Some("env"),
                no_key,
                "http://rpc.alphanet.thru.org",
                false
            ),
            None
        );
        assert_eq!(
            resolve_rpc_auth_token(None, Some("env"), no_key, official, true),
            None
        );
        assert_eq!(
            resolve_rpc_auth_token(None, None, no_key, official, false),
            None
        );

        let mut config = Config {
            env_api_key: Some("env".into()),
            rpc_base_url: other.into(),
            ..Config::default()
        };
        assert_eq!(config.rpc_auth_token(), None);
        assert!(config.env_api_key_withheld());
        config.rpc_base_url = official.into();
        assert_eq!(config.rpc_auth_token().as_deref(), Some("env"));
        assert!(!config.env_api_key_withheld());
        config.rpc_base_url = other.into();
        config.auth_token = Some("configured".into());
        assert_eq!(config.rpc_auth_token().as_deref(), Some("configured"));
        assert!(!config.env_api_key_withheld());
    }

    #[test]
    fn saving_never_writes_env_api_key() {
        let config = Config {
            rpc_base_url: "https://rpc.alphanet.thru.org".into(),
            env_api_key: Some("tk_env_secret_value".into()),
            ..Config::default()
        };
        assert_eq!(
            config.rpc_auth_token().as_deref(),
            Some("tk_env_secret_value")
        );

        let saved = Config::generate_config_template(&config);
        assert!(!saved.contains("tk_env_secret_value"), "{saved}");
        assert!(!saved.contains("env_api_key"), "{saved}");
        let loaded: Config = serde_yaml::from_str(&saved).unwrap();
        assert_eq!(loaded.auth_token, None);
        assert_eq!(loaded.env_api_key, None);
        assert_eq!(loaded.rpc_auth_token(), None);
    }

    /// Provisioned-key source that records how often each method is called.
    #[derive(Default)]
    struct CountingSource {
        key: Option<&'static str>,
        present_calls: std::sync::atomic::AtomicUsize,
        load_calls: std::sync::atomic::AtomicUsize,
    }

    impl ProvisionedKeySource for CountingSource {
        fn present(&self) -> bool {
            self.present_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.key.is_some()
        }
        fn load(&self) -> Option<String> {
            self.load_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.key.map(str::to_string)
        }
    }

    fn with_provisioned(key: Option<&'static str>) -> (Arc<CountingSource>, Config) {
        let source = Arc::new(CountingSource {
            key,
            ..CountingSource::default()
        });
        let config = Config {
            provisioned_api_key: ProvisionedApiKey::new(source.clone()),
            ..Config::default()
        };
        (source, config)
    }

    fn loads(source: &CountingSource) -> usize {
        source.load_calls.load(std::sync::atomic::Ordering::SeqCst)
    }

    #[test]
    fn provisioned_key_precedence() {
        let official = "https://rpc.alphanet.thru.org";
        let provisioned = || Some("thru_provisioned".to_string());
        // Configured token > env key > provisioned key, for an official endpoint.
        assert_eq!(
            resolve_rpc_auth_token(
                Some("configured"),
                Some("env"),
                provisioned,
                official,
                false
            )
            .as_deref(),
            Some("configured")
        );
        assert_eq!(
            resolve_rpc_auth_token(None, Some("env"), provisioned, official, false).as_deref(),
            Some("env")
        );
        assert_eq!(
            resolve_rpc_auth_token(None, None, provisioned, official, false).as_deref(),
            Some("thru_provisioned")
        );
        // Never to an untrusted, plain-HTTP, non-443 or --insecure endpoint.
        for (url, insecure) in [
            ("https://other.example", false),
            ("http://rpc.alphanet.thru.org", false),
            ("https://rpc.alphanet.thru.org:8443", false),
            ("http://localhost:8472", false),
            (official, true),
        ] {
            let called = std::cell::Cell::new(false);
            let token = resolve_rpc_auth_token(
                None,
                None,
                || {
                    called.set(true);
                    Some("thru_provisioned".to_string())
                },
                url,
                insecure,
            );
            assert_eq!(token, None, "{url} insecure={insecure}");
            assert!(!called.get(), "provisioned key read for {url}");
        }
    }

    #[test]
    fn provisioned_key_is_loaded_lazily_once_and_only_when_sent() {
        // Official endpoint, nothing configured: loaded once, then cached.
        let (source, config) = with_provisioned(Some("thru_provisioned"));
        assert_eq!(loads(&source), 0);
        assert_eq!(config.rpc_auth_token().as_deref(), Some("thru_provisioned"));
        assert_eq!(config.rpc_auth_token().as_deref(), Some("thru_provisioned"));
        assert_eq!(loads(&source), 1);
        assert!(!config.provisioned_api_key_withheld());

        // A configured token or env key wins without reading the provisioned key.
        let (source, mut config) = with_provisioned(Some("thru_provisioned"));
        config.auth_token = Some("configured".into());
        assert_eq!(config.rpc_auth_token().as_deref(), Some("configured"));
        config.auth_token = None;
        config.env_api_key = Some("env".into());
        assert_eq!(config.rpc_auth_token().as_deref(), Some("env"));
        assert_eq!(loads(&source), 0);

        // Untrusted endpoints never read the secret, but report it withheld.
        for (url, insecure) in [
            ("https://other.example", false),
            ("http://rpc.alphanet.thru.org", false),
            ("https://rpc.betanet.thru.org:8443", false),
            ("https://rpc.alphanet.thru.org", true),
        ] {
            let (source, mut config) = with_provisioned(Some("thru_provisioned"));
            config.rpc_base_url = url.into();
            config.insecure = insecure;
            assert_eq!(config.rpc_auth_token(), None, "{url}");
            assert!(config.provisioned_api_key_withheld(), "{url}");
            assert!(!config.env_api_key_withheld(), "{url}");
            assert_eq!(loads(&source), 0, "{url}");
            // Withheld only matters if the provisioned key would have been used.
            config.env_api_key = Some("env".into());
            assert!(!config.provisioned_api_key_withheld());
            assert!(config.env_api_key_withheld());
            config.env_api_key = None;
            config.auth_token = Some("configured".into());
            assert!(!config.provisioned_api_key_withheld());
        }

        // No provisioned key: nothing to withhold.
        let (_source, mut config) = with_provisioned(None);
        config.rpc_base_url = "https://other.example".into();
        assert!(!config.provisioned_api_key_withheld());
        assert!(!Config::default().provisioned_api_key_withheld());
        assert_eq!(Config::default().rpc_auth_token(), None);
    }

    #[test]
    fn saving_never_writes_provisioned_api_key() {
        let (source, config) = with_provisioned(Some("thru_provisioned_secret_value"));
        assert_eq!(
            config.rpc_auth_token().as_deref(),
            Some("thru_provisioned_secret_value")
        );
        let saved = Config::generate_config_template(&config);
        assert!(!saved.contains("thru_provisioned_secret_value"), "{saved}");
        assert!(!saved.contains("provisioned"), "{saved}");
        let yaml = serde_yaml::to_string(&config).unwrap();
        assert!(!yaml.contains("thru_provisioned_secret_value"), "{yaml}");
        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains("thru_provisioned_secret_value"), "{json}");
        assert!(!format!("{config:?}").contains("thru_provisioned_secret_value"));
        let loaded: Config = serde_yaml::from_str(&saved).unwrap();
        assert!(!loaded.provisioned_api_key.is_present());
        assert_eq!(loaded.rpc_auth_token(), None);
        assert_eq!(loads(&source), 1);
    }

    #[test]
    fn test_default_config_validation() {
        let config = Config::default();
        // Default config should be valid
        assert!(config.validate().is_ok());
    }

    #[test]
    fn empty_default_configuration_is_valid() {
        let config = Config::default();
        assert!(config.keys.list_keys().is_empty());
        assert!(config.validate().is_ok());
        assert!(config.keys.load_key("default").is_err());
    }

    #[test]
    fn inline_config_rejection_does_not_echo_seed() {
        let seed = hex::encode([41; 32]);
        let mut value = serde_yaml::to_value(Config::default()).unwrap();
        value["keys"] = serde_yaml::from_str(&format!("default: '{seed}'")).unwrap();
        let raw = serde_yaml::to_string(&value).unwrap();
        let error = serde_yaml::from_str::<Config>(&raw).unwrap_err();
        assert!(!error.to_string().contains(&seed));
        let (config, inline) = Config::parse_document(&raw).unwrap();
        assert_eq!(*inline[0].1, [41; 32]);
        assert!(config.keys.list_keys().is_empty());
        assert!(!Config::generate_config_template(&config).contains(&seed));
    }

    #[tokio::test]
    async fn inline_keys_load_for_reading_but_block_writers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let seed = hex::encode([42; 32]);
        let raw = format!("keys:\n  Default: '{seed}'\n  'acc:1': '{seed}'\n");
        std::fs::write(&path, &raw).unwrap();

        // Reading keeps only the alias names; the seeds are not retained.
        let config = Config::load_existing_path(&path).await.unwrap();
        assert_eq!(config.keys.unmigrated_aliases(), ["acc:1", "default"]);
        assert!(config.keys.list_keys().is_empty());
        assert!(!format!("{config:?}").contains(&seed));
        let error = config.keys.load_fee_payer(None).unwrap_err().to_string();
        assert!(error.contains("thru keys migrate") && error.contains("\"default\""));
        assert!(!Config::generate_config_template(&config).contains(&seed));

        // Every writer refuses, naming the file and the aliases.
        let error = Config::load_for_update(&path)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("thru keys migrate"), "{error}");
        assert!(error.contains("acc:1, default"), "{error}");
        assert!(error.contains(&path.display().to_string()), "{error}");
        assert!(!error.contains(&seed));
        assert!(
            Config::update_path(&path, |_| Ok(()))
                .await
                .unwrap_err()
                .to_string()
                .contains("thru keys migrate")
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
    }

    #[tokio::test]
    async fn loaded_reference_paths_use_config_directory_without_rewriting() {
        let (directory, keys) = KeyManager::test_fixture(&[("default", [43; 32])]);
        let mut entry = keys.get_entry("default").unwrap().clone();
        let crate::keys::KeySource::File { path, .. } = &mut entry.source else {
            unreachable!()
        };
        *path = path.file_name().unwrap().into();
        let raw = format!(
            "keys:\n  default:\n{}",
            serde_yaml::to_string(&entry)
                .unwrap()
                .lines()
                .map(|line| format!("    {line}\n"))
                .collect::<String>()
        );
        let path = directory.path().join("config.yaml");
        std::fs::write(&path, &raw).unwrap();
        let loaded = Config::load_existing_path(&path).await.unwrap();
        assert_eq!(
            loaded.keys.load_key("default").unwrap().public_key,
            keys.public_key("default").unwrap()
        );
        let saved = std::fs::read_to_string(path).unwrap();
        assert_eq!(saved, raw);
        assert!(!saved.contains(&hex::encode([43; 32])));
        assert!(serde_yaml::from_str::<Config>(&saved).is_ok());
    }

    #[test]
    fn initialization_never_overwrites_a_concurrent_registration() {
        let (directory, keys) = KeyManager::test_fixture(&[("default", [44; 32])]);
        let path = directory.path().join("config.yaml");
        let registered = Config {
            keys,
            ..Config::default()
        };
        let registered_raw = Config::generate_config_template(&registered);
        let empty_raw = Config::generate_config_template(&Config::default());
        write_config(&path, &registered_raw, false).unwrap();
        write_config(&path, &empty_raw, false).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), registered_raw);
        assert!(registered.keys.load_key("default").is_ok());
    }

    #[test]
    fn document_migration_preserves_supported_configuration_fields() {
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:1234".into();
        config.auth_token = Some("configured-api-token".into());
        config.timeout_seconds = 72;
        config.max_retries = 9;
        config.toolchain_path = Some(PathBuf::from("/custom/toolchain"));
        config.toolchain_version = Some("custom-version".into());
        config.sdk_paths = Some(HashMap::from([(
            "rust".into(),
            PathBuf::from("/custom/sdk"),
        )]));
        config.sdk_versions = Some(HashMap::from([("rust".into(), "custom-sdk".into())]));
        config.github_repo = Some("custom/repository".into());
        config.networks.insert(
            "local".into(),
            NetworkConfig {
                url: "http://localhost:5678".into(),
                auth_token: Some("local-token".into()),
            },
        );
        config.default_network = Some("local".into());
        config.system_test_program_public_key = Some(programs::SYSTEM_TEST_PROGRAM_ADDRESS.into());
        let raw = serde_yaml::to_string(&config).unwrap();
        let (loaded, inline) = Config::parse_document(&raw).unwrap();
        assert!(inline.is_empty());
        assert_eq!(
            serde_yaml::to_value(loaded).unwrap(),
            serde_yaml::to_value(config).unwrap()
        );
    }

    #[test]
    fn test_invalid_url() {
        let mut config = Config::default();
        config.rpc_base_url = "not-a-url".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_grpc_url_http_default_port() {
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port_or_known_default(), Some(80));
    }

    #[test]
    fn test_grpc_url_https_default_port() {
        let mut config = Config::default();
        config.rpc_base_url = "https://rpc.alphanet.thru.org".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port_or_known_default(), Some(443));
    }

    #[test]
    fn test_grpc_url_explicit_port_443() {
        let mut config = Config::default();
        config.rpc_base_url = "https://rpc.alphanet.thru.org:443".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port_or_known_default(), Some(443));
    }

    #[test]
    fn test_grpc_url_explicit_port_8443() {
        let mut config = Config::default();
        config.rpc_base_url = "https://rpc.alphanet.thru.org:8443".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port(), Some(8443));
    }

    #[test]
    fn test_grpc_url_explicit_port_8472() {
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:8472".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port(), Some(8472));
    }

    #[test]
    fn test_grpc_url_explicit_port_8080() {
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:8080".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port(), Some(8080));
    }

    #[test]
    fn test_grpc_url_explicit_port_9000() {
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:9000".to_string();
        let grpc_url = config.get_grpc_url().unwrap();
        assert_eq!(grpc_url.port(), Some(9000));
    }
}
