//! Configuration management for the Thru CLI

use anyhow::Result;
use rand::TryRng;
use rand::rngs::SysRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use thru_base::tn_tools::Pubkey;
use thru_base::bootstrap_addresses as programs;
use tokio::io::AsyncWriteExt;
use url::Url;

use crate::error::{CliError, ConfigError};

pub(crate) async fn write_key_file(path: &Path, content: &str) -> Result<(), CliError> {
    if let Some(directory) = path.parent() {
        let mut builder = tokio::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        builder.mode(0o700);
        builder
            .create(directory)
            .await
            .map_err(ConfigError::DirectoryCreation)?;
        #[cfg(unix)]
        tokio::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(ConfigError::DirectoryCreation)?;
    }

    // Resolve symlinks so the atomic replacement preserves the config link.
    let mut target = path.to_path_buf();
    for hops in 0..=40 {
        let metadata = match tokio::fs::symlink_metadata(&target).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_symlink() {
            break;
        }
        if hops == 40 {
            return Err(std::io::Error::other("Config symlink chain exceeds 40 hops").into());
        }
        let link = tokio::fs::read_link(&target).await?;
        target = target
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(link);
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = target.with_extension(format!("{}.{nanos}.tmp", std::process::id()));

    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temp_path).await?;
    let result = async {
        file.write_all(content.as_bytes()).await?;
        file.flush().await?;
        file.sync_all().await?;
        drop(file);
        tokio::fs::rename(&temp_path, &target).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_path).await;
    }
    result.map_err(Into::into)
}

/// Key management service for the Thru CLI
#[derive(Debug, Clone)]
pub struct KeyManager {
    keys: HashMap<String, String>,
}

impl Serialize for KeyManager {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.keys.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for KeyManager {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let keys = HashMap::deserialize(deserializer)?;
        Ok(KeyManager { keys })
    }
}

impl KeyManager {
    /// Create a new KeyManager with default key
    pub fn new() -> Self {
        let mut keys = HashMap::new();

        // Generate a cryptographically secure random 32-byte private key for default
        let mut private_key_bytes = [0u8; 32];
        let mut rng = SysRng;
        rng.try_fill_bytes(&mut private_key_bytes).unwrap();
        let private_key_hex = hex::encode(private_key_bytes);

        keys.insert("default".to_string(), private_key_hex);

        Self { keys }
    }

    /// List all key names
    pub fn list_keys(&self) -> Vec<String> {
        let mut key_names: Vec<String> = self.keys.keys().cloned().collect();
        key_names.sort();
        key_names
    }

    /// Add a new key
    pub fn add_key(&mut self, name: &str, key: &str, overwrite: bool) -> Result<(), CliError> {
        let normalized_name = Self::normalize_key_name(name);

        Self::validate_key_value(&normalized_name, key)?;

        // Check for existing key
        if self.keys.contains_key(&normalized_name) && !overwrite {
            return Err(CliError::Validation(format!(
                "Key '{}' already exists. Use --overwrite to replace it",
                normalized_name
            )));
        }

        self.keys.insert(normalized_name, key.to_string());
        Ok(())
    }

    /// Get a key value
    pub fn get_key(&self, name: &str) -> Result<&str, CliError> {
        let normalized_name = Self::normalize_key_name(name);
        self.keys
            .get(&normalized_name)
            .map(|s| s.as_str())
            .ok_or_else(|| CliError::Validation(format!("Key '{}' not found", normalized_name)))
    }

    /// Generate a new random key
    pub fn generate_key(&mut self, name: &str, overwrite: bool) -> Result<String, CliError> {
        let normalized_name = Self::normalize_key_name(name);

        // Check for existing key
        if self.keys.contains_key(&normalized_name) && !overwrite {
            return Err(CliError::Validation(format!(
                "Key '{}' already exists. Use --overwrite to replace it",
                normalized_name
            )));
        }

        // Generate new key
        let mut private_key_bytes = [0u8; 32];
        let mut rng = SysRng;
        rng.try_fill_bytes(&mut private_key_bytes).unwrap();
        let private_key_hex = hex::encode(private_key_bytes);

        self.keys.insert(normalized_name, private_key_hex.clone());
        Ok(private_key_hex)
    }

    /// Remove a key
    pub fn remove_key(&mut self, name: &str) -> Result<(), CliError> {
        let normalized_name = Self::normalize_key_name(name);

        if !self.keys.contains_key(&normalized_name) {
            return Err(CliError::Validation(format!(
                "Key '{}' not found",
                normalized_name
            )));
        }

        self.keys.remove(&normalized_name);
        Ok(())
    }

    /// Check if a key exists
    #[allow(dead_code)]
    pub fn has_key(&self, name: &str) -> bool {
        let normalized_name = Self::normalize_key_name(name);
        self.keys.contains_key(&normalized_name)
    }

    /// Get the default key (for backward compatibility)
    pub fn get_default_key(&self) -> Result<&str, CliError> {
        self.get_key("default")
    }

    /// Check whether a key name resolves to the default key
    pub fn is_default_key_name(name: &str) -> bool {
        Self::normalize_key_name(name) == "default"
    }

    /// Normalize key name to lowercase
    fn normalize_key_name(name: &str) -> String {
        name.to_lowercase()
    }

    fn validate_key_value(name: &str, key: &str) -> Result<(), CliError> {
        if key.len() != 64 {
            return Err(CliError::Validation(format!(
                "Key '{}' must be exactly 64 hexadecimal characters",
                name
            )));
        }

        hex::decode(key).map_err(|_| {
            CliError::Validation(format!("Key '{}' has invalid hexadecimal format", name))
        })?;

        Ok(())
    }

    fn validate_all_keys(&self) -> Result<(), CliError> {
        for (name, key) in &self.keys {
            Self::validate_key_value(name, key)
                .map_err(|e| ConfigError::InvalidPrivateKey(e.to_string()))?;
        }

        Ok(())
    }
}

/// Canonical block-producer bond program for a freshly bootstrapped network.
fn default_bp_program_public_key() -> String {
    programs::BLOCK_PRODUCER_PROGRAM_ADDRESS.to_string()
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
/// key would be sent, so the OS keychain is not touched otherwise.
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
    /// Whether a provisioned key is recorded. Must not read the secret (and so
    /// must not touch the OS keychain).
    fn present(&self) -> bool;
    /// Reads the secret. May touch the OS keychain; called at most once.
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
pub struct Config {
    /// Endpoint for gRPC requests (e.g. http://127.0.0.1:8472 or https://rpc.alphanet.thru.org)
    pub rpc_base_url: String,

    /// Key management
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
    /// serialized, so no `save()` path can persist it. Only sent to official
    /// endpoints; read it through [`Config::rpc_auth_token`].
    #[serde(skip)]
    pub env_api_key: Option<String>,

    /// Runtime-only: org API key provisioned by `thru auth login`, read from the
    /// OS keychain (or its owner-only file fallback) only when it would be sent.
    /// Never serialized, so no `save()` path can persist it. Only sent to
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
            consensus_validator_program_public_key:
                programs::CONSENSUS_VALIDATOR_PROGRAM_ADDRESS.to_string(),
            consensus_attestor_table_public_key: programs::ATTESTOR_TABLE_ADDRESS.to_string(),
            consensus_converted_vault_public_key: programs::CONVERTED_VAULT_ADDRESS.to_string(),
            consensus_unclaimed_vault_public_key: programs::UNCLAIMED_VAULT_ADDRESS.to_string(),
            wthru_program_public_key: programs::WTHRU_PROGRAM_ADDRESS.to_string(),
            bp_program_public_key: default_bp_program_public_key(),
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
    /// Load configuration from the default location
    pub async fn load() -> Result<Self, CliError> {
        let config = Self::load_unvalidated().await?;

        // Validate the configuration
        config.validate()?;

        Ok(config)
    }

    /// Load configuration for key-management commands.
    ///
    /// Kept as a compatibility alias now that all configuration loading permits
    /// a missing default key.
    pub async fn load_for_key_management() -> Result<Self, CliError> {
        Self::load().await
    }

    async fn load_unvalidated() -> Result<Self, CliError> {
        let config_path = Self::get_config_path()?;

        if !config_path.exists() {
            // Create default config if it doesn't exist
            Self::create_default_config().await?;
        }

        let config_content = tokio::fs::read_to_string(&config_path).await?;

        // Try to parse normally first
        let config: Config = match serde_yaml::from_str(&config_content) {
            Ok(c) => c,
            Err(e) => {
                // Check if it's a missing field error
                let error_msg = e.to_string();
                if error_msg.contains("missing field") {
                    // Try to migrate the config
                    Self::migrate_config(&config_path, &config_content).await?
                } else {
                    return Err(ConfigError::InvalidFormat(e).into());
                }
            }
        };

        Ok(config)
    }

    /// Migrate an old config by adding missing fields with default values
    async fn migrate_config(config_path: &PathBuf, config_content: &str) -> Result<Self, CliError> {
        // Parse existing config as a generic YAML value
        let mut existing: serde_yaml::Value =
            serde_yaml::from_str(config_content).map_err(|e| ConfigError::InvalidFormat(e))?;

        // Get default config as YAML value
        let default_config = Config::default();
        let default_yaml: serde_yaml::Value =
            serde_yaml::to_value(&default_config).map_err(|e| ConfigError::InvalidFormat(e))?;

        // Track what fields were added
        let mut added_fields: Vec<String> = Vec::new();

        // Merge missing fields from default into existing
        if let (Some(existing_map), Some(default_map)) =
            (existing.as_mapping_mut(), default_yaml.as_mapping())
        {
            for (key, default_value) in default_map {
                if !existing_map.contains_key(key) {
                    if let Some(key_str) = key.as_str() {
                        added_fields.push(key_str.to_string());
                    }
                    existing_map.insert(key.clone(), default_value.clone());
                }
            }
        }

        // Try to deserialize the merged config
        let config: Config =
            serde_yaml::from_value(existing.clone()).map_err(|e| ConfigError::InvalidFormat(e))?;

        // Save the updated config
        let updated_content = Self::generate_config_template(&config);
        write_key_file(config_path, &updated_content).await?;

        // Notify user about the migration
        if !added_fields.is_empty() {
            eprintln!(
                "Config migrated: added missing field(s): {}",
                added_fields.join(", ")
            );
            eprintln!("Updated config saved to: {}", config_path.display());
        }

        Ok(config)
    }

    /// Save configuration to the default location
    pub async fn save(&self) -> Result<(), CliError> {
        let config_path = Self::get_config_path()?;
        let config_content = Self::generate_config_template(self);
        write_key_file(&config_path, &config_content).await?;
        Ok(())
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), CliError> {
        self.validate_common()
    }

    /// Validate key-management configuration.
    ///
    /// Kept as a compatibility alias for [`Self::validate`].
    pub fn validate_for_key_management(&self) -> Result<(), CliError> {
        self.validate()
    }

    fn validate_common(&self) -> Result<(), CliError> {
        // Validate URL
        Url::parse(&self.rpc_base_url).map_err(|e| ConfigError::InvalidUrl(e.to_string()))?;

        // Validate all network URLs
        for (name, network) in &self.networks {
            Url::parse(&network.url)
                .map_err(|e| ConfigError::InvalidUrl(format!("network '{}': {}", name, e)))?;
        }

        // Validate every configured key, but only require `keys.default` when
        // a command actually falls back to it. Explicit named-key operations
        // must remain usable without an unrelated default key.
        self.keys.validate_all_keys()?;

        // Validate uploader program public key
        Pubkey::new(self.uploader_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate manager program public key
        Pubkey::new(self.manager_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate ABI manager program public key
        Pubkey::new(self.abi_manager_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate token program public key
        Pubkey::new(self.token_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate consensus validator program public key
        Pubkey::new(self.consensus_validator_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate consensus attestor table public key
        Pubkey::new(self.consensus_attestor_table_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate consensus converted vault public key
        Pubkey::new(self.consensus_converted_vault_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        // Validate consensus unclaimed vault public key
        Pubkey::new(self.consensus_unclaimed_vault_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

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

        // Create default config
        let default_config = Config::default();
        let config_content = Self::generate_config_template(&default_config);

        write_key_file(&config_path, &config_content).await?;

        eprintln!(
            "Created default configuration at: {}",
            config_path.display()
        );
        eprintln!("Please edit the configuration file to set your private key and RPC endpoint.");

        Ok(())
    }

    /// Generate a configuration template with comments
    fn generate_config_template(config: &Config) -> String {
        // Use serde to serialize the config to YAML format
        let yaml_content = serde_yaml::to_string(config).unwrap_or_default();

        format!(
            r#"# Thru CLI Configuration File
# This file contains settings for the Thru command-line interface
# WARNING: Keep this file secure and never share your private keys

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

    /// Get the default private key as bytes
    #[allow(dead_code)]
    pub fn get_private_key_bytes(&self) -> Result<[u8; 32], CliError> {
        let default_key = self.keys.get_default_key()?;
        let bytes =
            hex::decode(default_key).map_err(|e| ConfigError::InvalidPrivateKey(e.to_string()))?;

        if bytes.len() != 32 {
            return Err(ConfigError::InvalidPrivateKey(
                "Private key must be exactly 32 bytes".to_string(),
            )
            .into());
        }

        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(key)
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
            assert!(Config::default().save().await.is_err());
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
        std::fs::write(&path, format!("{}stale content", expected)).unwrap();
        config.save().await.unwrap();
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
        assert_eq!(config.get_system_test_program_pubkey().unwrap().to_bytes().unwrap(),
                   programs::SYSTEM_TEST_PROGRAM_BYTES);
        config.system_test_program_public_key = Some("invalid".into());
        assert!(config.get_system_test_program_pubkey().is_err());
    }

    #[test]
    fn canonical_defaults_preserve_explicit_network_addresses() {
        let config = Config::default();
        assert_eq!(config.token_program_public_key, programs::TOKEN_PROGRAM_ADDRESS);
        assert_eq!(config.abi_manager_program_public_key, programs::ABI_MANAGER_PROGRAM_ADDRESS);
        assert_eq!(config.wthru_program_public_key, programs::WTHRU_PROGRAM_ADDRESS);
        assert_eq!(config.bp_program_public_key, programs::BLOCK_PRODUCER_PROGRAM_ADDRESS);
        assert_eq!(config.consensus_attestor_table_public_key, programs::ATTESTOR_TABLE_ADDRESS);

        let mut saved = serde_yaml::to_value(&config).unwrap();
        saved["token_program_public_key"] = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq".into();
        saved["bp_program_public_key"] = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEO".into();
        let loaded: Config = serde_yaml::from_value(saved).unwrap();
        assert_eq!(loaded.token_program_public_key, "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq");
        assert_eq!(loaded.bp_program_public_key, "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEO");
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
            assert!(!called.get(), "keychain read for {url}");
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

        // A configured token or env key wins without touching the keychain.
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
    fn test_config_validation_accepts_missing_default_key() {
        let mut config = Config::default();
        config.keys.remove_key("default").unwrap();

        assert!(config.validate().is_ok());
        assert!(config.keys.get_default_key().is_err());
    }

    #[test]
    fn test_key_management_validation_accepts_missing_default_key() {
        let mut config = Config::default();
        config.keys.remove_key("default").unwrap();

        assert!(config.validate_for_key_management().is_ok());
    }

    #[test]
    fn test_key_management_validation_rejects_malformed_key() {
        let mut config = Config::default();
        config
            .keys
            .keys
            .insert("bad".to_string(), "invalid".to_string());

        assert!(config.validate().is_err());
        assert!(config.validate_for_key_management().is_err());
    }

    #[test]
    fn test_invalid_private_key() {
        let mut config = Config::default();
        // Test with invalid key in the key manager
        assert!(config.keys.add_key("default", "invalid", true).is_err());
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
