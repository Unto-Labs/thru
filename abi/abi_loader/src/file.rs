use abi_types::TypeDef;
use serde_derive::{Deserialize, Serialize};

/* ============================================================================
   Import Source Types
   ============================================================================ */

/* Target type for on-chain ABI imports */
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OnchainTarget {
    /* Official ABI derived from a program account */
    #[default]
    Program,
    /* ABI derived from an ABI meta account */
    AbiMeta,
    /* ABI account address provided directly */
    Abi,
}

/* Revision specifier for on-chain imports */
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum RevisionSpec {
    /* Exact revision number (e.g., revision: 5) */
    Exact(u64),
    /* String specifier: minimum (e.g., ">=5") or "latest" */
    Specifier(String),
}

impl RevisionSpec {
    /* Check if this is a "latest" specifier */
    pub fn is_latest(&self) -> bool {
        matches!(self, RevisionSpec::Specifier(s) if s == "latest")
    }

    /* Check if this is a minimum specifier (e.g., ">=5") */
    pub fn is_minimum(&self) -> bool {
        matches!(self, RevisionSpec::Specifier(s) if s.starts_with(">="))
    }

    /* Parse minimum value from ">=N" specifier */
    pub fn minimum_value(&self) -> Option<u64> {
        match self {
            RevisionSpec::Specifier(s) if s.starts_with(">=") => {
                s[2..].parse().ok()
            }
            _ => None,
        }
    }

    /* Get exact value if this is an exact specifier */
    pub fn exact_value(&self) -> Option<u64> {
        match self {
            RevisionSpec::Exact(v) => Some(*v),
            _ => None,
        }
    }

    /* Check if a given revision satisfies this spec */
    pub fn satisfies(&self, revision: u64) -> bool {
        match self {
            RevisionSpec::Exact(v) => revision == *v,
            RevisionSpec::Specifier(s) if s == "latest" => true,
            RevisionSpec::Specifier(s) if s.starts_with(">=") => {
                s[2..].parse::<u64>().map(|min| revision >= min).unwrap_or(false)
            }
            _ => false,
        }
    }
}

impl Default for RevisionSpec {
    fn default() -> Self {
        RevisionSpec::Specifier("latest".to_string())
    }
}

/* Import source specification */
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ImportSource {
    /* Local file path import */
    Path {
        /* Relative or absolute path to the ABI file */
        path: String,
    },

    /* Git repository import */
    Git {
        /* Repository URL (https:// or ssh://) */
        url: String,
        /* Git reference: branch name, tag, or commit hash */
        #[serde(rename = "ref")]
        git_ref: String,
        /* Path within the repository to the ABI file */
        path: String,
    },

    /* HTTP/HTTPS URL import */
    Http {
        /* Direct URL to the ABI YAML file */
        url: String,
    },

    /* On-chain ABI import */
    Onchain {
        /* Thru address or TNS name (ending in .thru) */
        address: String,
        /* Whether this is a program meta-derived ABI, ABI meta-derived ABI, or direct ABI */
        #[serde(default)]
        target: OnchainTarget,
        /* Network name (e.g., "mainnet", "testnet") or chain ID */
        network: String,
        /* Revision specifier: exact number, ">=N" minimum, or "latest" */
        #[serde(default)]
        revision: RevisionSpec,
    },
}

impl ImportSource {
    /* Check if this is a remote import (not local path) */
    pub fn is_remote(&self) -> bool {
        !matches!(self, ImportSource::Path { .. })
    }

    /* Check if this is a local path import */
    pub fn is_path(&self) -> bool {
        matches!(self, ImportSource::Path { .. })
    }

    /* Get the path for path imports */
    pub fn path(&self) -> Option<&str> {
        match self {
            ImportSource::Path { path } => Some(path),
            _ => None,
        }
    }

    /* Get a canonical identifier for this import source (for cycle detection) */
    pub fn canonical_id(&self) -> String {
        match self {
            ImportSource::Path { path } => format!("path:{}", path),
            ImportSource::Git { url, git_ref, path } => {
                format!("git:{}@{}:{}", url, git_ref, path)
            }
            ImportSource::Http { url } => format!("http:{}", url),
            ImportSource::Onchain { address, target, network, revision } => {
                let target_str = match target {
                    OnchainTarget::Program => "program",
                    OnchainTarget::AbiMeta => "abi-meta",
                    OnchainTarget::Abi => "abi",
                };
                let rev_str = match revision {
                    RevisionSpec::Exact(v) => format!("{}", v),
                    RevisionSpec::Specifier(s) => s.clone(),
                };
                format!("onchain:{}:{}@{}?rev={}", network, target_str, address, rev_str)
            }
        }
    }
}

/* Root type names for program reflection */
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "kebab-case")]
pub struct RootTypes {
    /* Type name for the instruction envelope */
    #[serde(default)]
    pub instruction_root: Option<String>,

    /* Type name for account state */
    #[serde(default)]
    pub account_root: Option<String>,

    /* Type name for program errors */
    #[serde(default)]
    pub errors: Option<String>,

    /* Type name for program events */
    #[serde(default)]
    pub events: Option<String>,
}

/* Program-specific metadata */
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "kebab-case")]
pub struct ProgramMetadata {
    /* Root type names for the program */
    #[serde(default)]
    pub root_types: RootTypes,
}

/* ABI file options */
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "kebab-case")]
pub struct AbiOptions {
    /* Program-specific metadata */
    #[serde(default)]
    pub program_metadata: ProgramMetadata,
}

/* Metadata for an ABI file */
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AbiMetadata {
    /* Fully qualified domain name package identifier (e.g., "thru.ammdex") */
    pub package: String,

    /* Optional human-readable display name (e.g., "Token Program") */
    #[serde(default)]
    pub name: Option<String>,

    /* ABI specification version */
    pub abi_version: u32,

    /* This package's semantic version */
    pub package_version: String,

    /* File description */
    pub description: String,

    /* List of imported ABI sources */
    #[serde(default)]
    pub imports: Vec<ImportSource>,

    /* Optional configuration options */
    #[serde(default)]
    pub options: AbiOptions,
}

/* Complete ABI file structure with metadata and type definitions */
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AbiFile {
    /* ABI file metadata */
    pub abi: AbiMetadata,

    /* Type definitions */
    #[serde(default)]
    pub types: Vec<TypeDef>,
}

impl AbiFile {
    /* Create a new ABI file with the given metadata */
    pub fn new(metadata: AbiMetadata) -> Self {
        Self {
            abi: metadata,
            types: Vec::new(),
        }
    }

    /* Add a type definition to this ABI file */
    pub fn add_type(&mut self, typedef: TypeDef) {
        self.types.push(typedef);
    }

    /* Get all type definitions */
    pub fn get_types(&self) -> &[TypeDef] {
        &self.types
    }

    /* Get the package identifier */
    pub fn package(&self) -> &str {
        &self.abi.package
    }

    /* Get the human-readable display name */
    pub fn name(&self) -> Option<&str> {
        self.abi.name.as_deref()
    }

    /* Get the imports */
    pub fn imports(&self) -> &[ImportSource] {
        &self.abi.imports
    }

    /* Check if this file has any remote imports */
    pub fn has_remote_imports(&self) -> bool {
        self.abi.imports.iter().any(|i| i.is_remote())
    }

    /* Check if this file has any local (path) imports */
    pub fn has_local_imports(&self) -> bool {
        self.abi.imports.iter().any(|i| i.is_path())
    }

    /* Get the ABI version */
    pub fn abi_version(&self) -> u32 {
        self.abi.abi_version
    }

    /* Get the package version */
    pub fn package_version(&self) -> &str {
        &self.abi.package_version
    }

    /* Get the description */
    pub fn description(&self) -> &str {
        &self.abi.description
    }

    /* Get the root types configuration */
    pub fn root_types(&self) -> &RootTypes {
        &self.abi.options.program_metadata.root_types
    }

    /* Get the instruction root type name */
    pub fn instruction_root(&self) -> Option<&str> {
        self.abi.options.program_metadata.root_types.instruction_root.as_deref()
    }

    /* Get the account root type name */
    pub fn account_root(&self) -> Option<&str> {
        self.abi.options.program_metadata.root_types.account_root.as_deref()
    }

    /* Get the errors type name */
    pub fn errors_type(&self) -> Option<&str> {
        self.abi.options.program_metadata.root_types.errors.as_deref()
    }

    /* Get the options */
    pub fn options(&self) -> &AbiOptions {
        &self.abi.options
    }

    /* Get the events type name */
    pub fn events_type(&self) -> Option<&str> {
        self.abi.options.program_metadata.root_types.events.as_deref()
    }
}
