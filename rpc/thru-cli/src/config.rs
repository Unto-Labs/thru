//! Configuration management for the Thru CLI

use anyhow::Result;
use rand::TryRngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thru_base::tn_tools::Pubkey;
use url::Url;

use crate::error::{CliError, ConfigError};

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
        let mut rng = OsRng;
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

        // Validate key format
        if key.len() != 64 {
            return Err(CliError::Validation(
                "Key must be exactly 64 hexadecimal characters".to_string(),
            ));
        }

        hex::decode(key)
            .map_err(|_| CliError::Validation("Invalid hexadecimal key format".to_string()))?;

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
        let mut rng = OsRng;
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

    /// Normalize key name to lowercase
    fn normalize_key_name(name: &str) -> String {
        name.to_lowercase()
    }
}

/// Configuration structure for the Thru CLI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Base URL for RPC requests
    pub rpc_base_url: String,

    /// Key management
    pub keys: KeyManager,

    /// Uploader program public key
    pub uploader_program_public_key: String,

    /// Manager program public key
    pub manager_program_public_key: String,

    /// Token program public key
    pub token_program_public_key: String,

    /// Request timeout in seconds
    pub timeout_seconds: u64,

    /// Maximum number of retries for failed requests
    pub max_retries: u32,

    /// Optional authorization token for HTTP requests
    pub auth_token: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            rpc_base_url: "http://localhost:8080".to_string(),
            keys: KeyManager::new(),
            uploader_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB"
                .to_string(),
            manager_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD"
                .to_string(),
            token_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq"
                .to_string(),
            timeout_seconds: 30,
            max_retries: 3,
            auth_token: None,
        }
    }
}

impl Config {
    /// Load configuration from the default location
    pub async fn load() -> Result<Self, CliError> {
        let config_path = Self::get_config_path()?;

        if !config_path.exists() {
            // Create default config if it doesn't exist
            Self::create_default_config().await?;
        }

        let config_content = tokio::fs::read_to_string(&config_path).await?;
        let config: Config =
            serde_yaml::from_str(&config_content).map_err(ConfigError::InvalidFormat)?;

        // Validate the configuration
        config.validate()?;

        Ok(config)
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), CliError> {
        // Validate URL
        Url::parse(&self.rpc_base_url).map_err(|e| ConfigError::InvalidUrl(e.to_string()))?;

        // Validate default key exists
        self.keys
            .get_default_key()
            .map_err(|e| ConfigError::InvalidPrivateKey(e.to_string()))?;

        // Validate uploader program public key
        Pubkey::new(self.uploader_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()))?;

        Ok(())
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
        let config_dir = Self::get_config_dir()?;
        let config_path = Self::get_config_path()?;

        // Create directory if it doesn't exist
        if !config_dir.exists() {
            tokio::fs::create_dir_all(&config_dir)
                .await
                .map_err(ConfigError::DirectoryCreation)?;
        }

        // Create default config
        let default_config = Config::default();
        let config_content = Self::generate_config_template(&default_config);

        tokio::fs::write(&config_path, config_content).await?;

        println!(
            "Created default configuration at: {}",
            config_path.display()
        );
        println!("Please edit the configuration file to set your private key and RPC endpoint.");

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

    /// Get the RPC client URL
    pub fn get_rpc_url(&self) -> Result<Url, CliError> {
        let full_url = self.rpc_base_url.clone() + "/api";
        Url::parse(&full_url).map_err(|e| ConfigError::InvalidUrl(e.to_string()).into())
    }

    /// Get the RPC-WS client URL
    #[allow(dead_code)]
    pub fn get_rpc_ws_url(&self) -> Result<Url, CliError> {
        let full_url = self.rpc_base_url.clone() + "/ws";
        Url::parse(&full_url).map_err(|e| ConfigError::InvalidUrl(e.to_string()).into())
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

    /// Get the token program public key
    pub fn get_token_program_pubkey(&self) -> Result<Pubkey, CliError> {
        Pubkey::new(self.token_program_public_key.clone())
            .map_err(|e| ConfigError::InvalidPublicKey(e.to_string()).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_validation() {
        let config = Config::default();
        // Default config should be valid
        assert!(config.validate().is_ok());
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
}
