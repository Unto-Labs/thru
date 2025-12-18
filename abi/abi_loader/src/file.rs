use abi_types::TypeDef;
use serde_derive::{Deserialize, Serialize};

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

    /* ABI specification version */
    pub abi_version: u32,

    /* This package's semantic version */
    pub package_version: String,

    /* File description */
    pub description: String,

    /* List of imported ABI files */
    #[serde(default)]
    pub imports: Vec<String>,

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

    /* Get the imports */
    pub fn imports(&self) -> &[String] {
        &self.abi.imports
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

    /* Get the events type name */
    pub fn events_type(&self) -> Option<&str> {
        self.abi.options.program_metadata.root_types.events.as_deref()
    }
}
