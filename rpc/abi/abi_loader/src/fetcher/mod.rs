//! Import Fetcher Infrastructure
//!
//! This module provides a pluggable fetcher system for resolving ABI imports
//! from various sources: local paths, git repositories, HTTP URLs, and on-chain.

#[cfg(not(target_arch = "wasm32"))]
pub mod git;
#[cfg(not(target_arch = "wasm32"))]
pub mod http;
#[cfg(not(target_arch = "wasm32"))]
pub mod onchain;
pub mod path;

use crate::file::ImportSource;
use std::path::PathBuf;

/* ============================================================================
   Fetcher Configuration
   ============================================================================ */

/* Configuration for which import types are allowed */
#[derive(Debug, Clone)]
pub struct FetcherConfig {
    /* Allow local path imports */
    pub allow_path: bool,
    /* Allow git repository imports */
    pub allow_git: bool,
    /* Allow HTTP/HTTPS URL imports */
    pub allow_http: bool,
    /* Allow on-chain imports */
    pub allow_onchain: bool,

    /* Git-specific configuration */
    pub git_config: GitFetcherConfig,

    /* On-chain specific configuration */
    pub onchain_config: OnchainFetcherConfig,

    /* Caching configuration */
    pub cache_config: CacheConfig,
}

impl Default for FetcherConfig {
    fn default() -> Self {
        Self::cli_default()
    }
}

impl FetcherConfig {
    /* Default configuration for CLI usage - all import types allowed */
    pub fn cli_default() -> Self {
        Self {
            allow_path: true,
            allow_git: true,
            allow_http: true,
            allow_onchain: true,
            git_config: GitFetcherConfig::default(),
            onchain_config: OnchainFetcherConfig::default(),
            cache_config: CacheConfig::default(),
        }
    }

    /* Configuration for WASM runtime - no remote fetching */
    pub fn wasm_default() -> Self {
        Self {
            allow_path: false,
            allow_git: false,
            allow_http: false,
            allow_onchain: false,
            git_config: GitFetcherConfig::default(),
            onchain_config: OnchainFetcherConfig::default(),
            cache_config: CacheConfig::disabled(),
        }
    }

    /* Configuration for production builds - only on-chain allowed */
    pub fn production_build() -> Self {
        Self {
            allow_path: false,
            allow_git: false,
            allow_http: false,
            allow_onchain: true,
            git_config: GitFetcherConfig::default(),
            onchain_config: OnchainFetcherConfig::default(),
            cache_config: CacheConfig::default(),
        }
    }

    /* Configuration for local development - only path imports */
    pub fn local_only() -> Self {
        Self {
            allow_path: true,
            allow_git: false,
            allow_http: false,
            allow_onchain: false,
            git_config: GitFetcherConfig::default(),
            onchain_config: OnchainFetcherConfig::default(),
            cache_config: CacheConfig::disabled(),
        }
    }

    /* Check if a given import source is allowed by this configuration */
    pub fn is_allowed(&self, source: &ImportSource) -> bool {
        match source {
            ImportSource::Path { .. } => self.allow_path,
            ImportSource::Git { .. } => self.allow_git,
            ImportSource::Http { .. } => self.allow_http,
            ImportSource::Onchain { .. } => self.allow_onchain,
        }
    }
}

/* Git fetcher configuration */
#[derive(Debug, Clone, Default)]
pub struct GitFetcherConfig {
    /* Path to SSH key for authentication (optional, uses ssh-agent by default) */
    pub ssh_key_path: Option<PathBuf>,
    /* Use git credential helper for HTTPS auth */
    pub use_credential_helper: bool,
    /* HTTP/HTTPS proxy URL */
    pub proxy: Option<String>,
    /* Timeout for git operations in seconds */
    pub timeout_seconds: u64,
}

impl GitFetcherConfig {
    /* Create with default timeout */
    pub fn new() -> Self {
        Self {
            ssh_key_path: None,
            use_credential_helper: true,
            proxy: None,
            timeout_seconds: 60,
        }
    }
}

/* On-chain fetcher configuration */
#[derive(Debug, Clone)]
pub struct OnchainFetcherConfig {
    /* Map of network name to RPC endpoint URL */
    pub rpc_endpoints: std::collections::HashMap<String, String>,
    /* Default network to use if not specified in import */
    pub default_network: String,
    /* Timeout for RPC calls in seconds */
    pub timeout_seconds: u64,
    /* ABI manager program public key (Thru address) */
    pub abi_manager_program_id: String,
    /* Whether ABI manager accounts are ephemeral */
    pub abi_manager_is_ephemeral: bool,
}

impl Default for OnchainFetcherConfig {
    fn default() -> Self {
        let mut rpc_endpoints = std::collections::HashMap::new();
        rpc_endpoints.insert("mainnet".to_string(), "https://rpc.thru.network".to_string());
        rpc_endpoints.insert(
            "testnet".to_string(),
            "https://rpc-testnet.thru.network".to_string(),
        );

        Self {
            rpc_endpoints,
            default_network: "mainnet".to_string(),
            timeout_seconds: 30,
            abi_manager_program_id: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACrG7".to_string(),
            abi_manager_is_ephemeral: false,
        }
    }
}

impl OnchainFetcherConfig {
    /* Get the RPC endpoint for a given network */
    pub fn get_endpoint(&self, network: &str) -> Option<&str> {
        self.rpc_endpoints.get(network).map(|s| s.as_str())
    }

    /* Add or update an RPC endpoint */
    pub fn set_endpoint(&mut self, network: impl Into<String>, endpoint: impl Into<String>) {
        self.rpc_endpoints.insert(network.into(), endpoint.into());
    }
}

/* Cache configuration */
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /* Enable caching */
    pub enabled: bool,
    /* Directory for cached imports */
    pub cache_dir: PathBuf,
    /* Maximum age of cached items in seconds (0 = no expiry) */
    pub max_age_seconds: u64,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cache_dir: default_cache_dir(),
            max_age_seconds: 3600, /* 1 hour */
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn default_cache_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".thru")
        .join("abi-cache")
}

#[cfg(target_arch = "wasm32")]
fn default_cache_dir() -> PathBuf {
    PathBuf::new()
}

impl CacheConfig {
    /* Create a disabled cache configuration */
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            cache_dir: PathBuf::new(),
            max_age_seconds: 0,
        }
    }

    /* Create with custom cache directory */
    pub fn with_dir(cache_dir: PathBuf) -> Self {
        Self {
            enabled: true,
            cache_dir,
            max_age_seconds: 3600,
        }
    }
}

/* ============================================================================
   Fetch Context
   ============================================================================ */

/* Context passed to fetchers during resolution */
#[derive(Debug, Clone)]
pub struct FetchContext {
    /* Base path for resolving relative path imports */
    pub base_path: Option<PathBuf>,
    /* True if the parent import was from a remote source */
    pub parent_is_remote: bool,
    /* Include directories for path resolution */
    pub include_dirs: Vec<PathBuf>,
}

impl FetchContext {
    /* Create a new fetch context for a root file */
    pub fn for_root(file_path: Option<PathBuf>, include_dirs: Vec<PathBuf>) -> Self {
        Self {
            base_path: file_path,
            parent_is_remote: false,
            include_dirs,
        }
    }

    /* Create a child context for an import from this context */
    pub fn child_context(&self, source: &ImportSource, resolved_path: Option<PathBuf>) -> Self {
        Self {
            base_path: resolved_path,
            parent_is_remote: source.is_remote(),
            include_dirs: self.include_dirs.clone(),
        }
    }
}

/* ============================================================================
   Fetch Result
   ============================================================================ */

/* Result of successfully fetching an ABI file */
#[derive(Debug, Clone)]
pub struct FetchResult {
    /* Raw YAML content of the ABI file */
    pub content: String,
    /* Canonical location identifier (for caching and cycle detection) */
    pub canonical_location: String,
    /* Whether the source is remote (git, http, onchain) */
    pub is_remote: bool,
    /* Resolved file path (for path imports only) */
    pub resolved_path: Option<PathBuf>,
}

/* ============================================================================
   Fetch Error
   ============================================================================ */

/* Errors that can occur during fetching */
#[derive(Debug)]
pub enum FetchError {
    /* Import source type not supported by this fetcher */
    UnsupportedSource(String),
    /* Import source type not allowed by configuration */
    NotAllowed(ImportSource),
    /* Local import from remote parent not allowed */
    LocalFromRemote(String),
    /* File not found */
    NotFound(String),
    /* IO error */
    Io(std::io::Error),
    /* Git operation failed */
    Git(String),
    /* HTTP request failed */
    Http { status: u16, message: String },
    /* On-chain fetch failed */
    Onchain(String),
    /* Parse error */
    Parse(String),
    /* Network not configured */
    UnknownNetwork(String),
    /* Revision mismatch */
    RevisionMismatch { required: String, actual: u64 },
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::UnsupportedSource(s) => write!(f, "Unsupported import source: {}", s),
            FetchError::NotAllowed(s) => write!(f, "Import type not allowed: {:?}", s),
            FetchError::LocalFromRemote(s) => {
                write!(f, "Local import '{}' not allowed from remote source", s)
            }
            FetchError::NotFound(s) => write!(f, "Import not found: {}", s),
            FetchError::Io(e) => write!(f, "IO error: {}", e),
            FetchError::Git(s) => write!(f, "Git error: {}", s),
            FetchError::Http { status, message } => {
                write!(f, "HTTP error {}: {}", status, message)
            }
            FetchError::Onchain(s) => write!(f, "On-chain fetch error: {}", s),
            FetchError::Parse(s) => write!(f, "Parse error: {}", s),
            FetchError::UnknownNetwork(s) => write!(f, "Unknown network: {}", s),
            FetchError::RevisionMismatch { required, actual } => {
                write!(f, "Revision mismatch: required {}, got {}", required, actual)
            }
        }
    }
}

impl std::error::Error for FetchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FetchError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for FetchError {
    fn from(e: std::io::Error) -> Self {
        FetchError::Io(e)
    }
}

/* ============================================================================
   Fetcher Trait
   ============================================================================ */

/* Trait for import source fetchers */
pub trait ImportFetcher: Send + Sync {
    /* Check if this fetcher handles the given import source type */
    fn handles(&self, source: &ImportSource) -> bool;

    /* Fetch the ABI content from the source */
    fn fetch(&self, source: &ImportSource, ctx: &FetchContext) -> Result<FetchResult, FetchError>;
}

/* ============================================================================
   Composite Fetcher
   ============================================================================ */

/* Composite fetcher that delegates to the appropriate backend */
pub struct CompositeFetcher {
    fetchers: Vec<Box<dyn ImportFetcher>>,
    config: FetcherConfig,
}

impl CompositeFetcher {
    /* Create a new composite fetcher with the given configuration */
    pub fn new(config: FetcherConfig) -> Result<Self, FetchError> {
        let mut fetchers: Vec<Box<dyn ImportFetcher>> = Vec::new();

        if config.allow_path {
            fetchers.push(Box::new(path::PathFetcher::new()));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if config.allow_git {
            fetchers.push(Box::new(git::GitFetcher::new(&config.git_config)));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if config.allow_http {
            fetchers.push(Box::new(http::HttpFetcher::new()?));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if config.allow_onchain {
            fetchers.push(Box::new(onchain::OnchainFetcher::new(&config.onchain_config)));
        }

        Ok(Self { fetchers, config })
    }

    /* Fetch an import source */
    pub fn fetch(
        &self,
        source: &ImportSource,
        ctx: &FetchContext,
    ) -> Result<FetchResult, FetchError> {
        /* Check if source type is allowed */
        if !self.config.is_allowed(source) {
            return Err(FetchError::NotAllowed(source.clone()));
        }

        /* Find appropriate fetcher */
        for fetcher in &self.fetchers {
            if fetcher.handles(source) {
                return fetcher.fetch(source, ctx);
            }
        }

        Err(FetchError::UnsupportedSource(format!("{:?}", source)))
    }

    /* Get the configuration */
    pub fn config(&self) -> &FetcherConfig {
        &self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fetcher_config_is_allowed() {
        let config = FetcherConfig::local_only();

        let path_import = ImportSource::Path {
            path: "test.abi.yaml".to_string(),
        };
        let git_import = ImportSource::Git {
            url: "https://github.com/test/repo".to_string(),
            git_ref: "main".to_string(),
            path: "abi.yaml".to_string(),
        };

        assert!(config.is_allowed(&path_import));
        assert!(!config.is_allowed(&git_import));
    }

    #[test]
    fn test_cache_config_default() {
        let config = CacheConfig::default();
        assert!(config.enabled);
        assert!(config.cache_dir.to_string_lossy().contains(".thru"));
    }
}
