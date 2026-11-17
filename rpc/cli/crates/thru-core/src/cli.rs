//! CLI argument parsing and command definitions

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

use crate::keys::KeyStorage;

/// Parse and validate chunk size (1024-31000 bytes)
fn parse_chunk_size(s: &str) -> Result<usize, String> {
    let size: usize = s
        .parse()
        .map_err(|_| format!("'{}' is not a valid number", s))?;
    if size < 1024 {
        return Err(format!("chunk size {} is too small (minimum: 1024)", size));
    }
    if size > 31000 {
        return Err(format!("chunk size {} is too large (maximum: 31000)", size));
    }
    Ok(size)
}

/// Thru CLI - Command-line interface for the Thru blockchain
#[derive(Parser)]
#[command(name = "thru")]
#[command(about = "Command-line interface for the Thru blockchain")]
#[command(version = thru_base::get_version!())]
#[command(
    after_help = "Signing key references: /absolute/path, ./relative/path, file:<path>, keychain:<id>, a configured alias, or alias:<name> for reserved legacy names. Relative command-line paths use the current directory. Omitted signers use the 'default' alias."
)]
pub struct Cli {
    /// Output results in JSON format
    #[arg(long, global = true)]
    pub json: bool,

    /// Suppress non-essential output (disables version check notifications)
    #[arg(long, global = true)]
    pub quiet: bool,

    /// Override RPC URL for this invocation
    #[arg(long = "url", global = true)]
    pub url: Option<String>,

    /// Use a named network profile for this invocation
    #[arg(long = "network", global = true)]
    pub network: Option<String>,

    /// Skip TLS certificate verification (insecure; for self-signed or
    /// direct-IP HTTPS endpoints). Disables peer authentication.
    #[arg(long, global = true)]
    pub insecure: bool,

    #[command(subcommand)]
    pub command: Commands,
}

/// Available CLI commands
#[derive(Subcommand)]
pub enum Commands {
    /// Core, Multisig and official-ABI governance with reviewed bound plans.
    Governance {
        #[command(subcommand)]
        subcommand: crate::commands::governance::GovernanceCommands,
    },
    /// Get version information from the Thru node
    #[command(name = "getversion")]
    GetVersion,

    /// Get health status of the Thru node
    #[command(name = "gethealth")]
    GetHealth,

    /// Get the node's operational status (consensus, repair, heights)
    #[command(name = "getstatus")]
    GetStatus,

    /// Get cluster block heights
    #[command(name = "getheight")]
    GetHeight,

    /// Get account information for a specific account
    #[command(name = "getaccountinfo")]
    GetAccountInfo {
        /// Account identifier (key name from config or public key)
        /// If omitted, uses the 'default' key from config
        account: Option<String>,

        /// Starting offset in account data to display (in bytes)
        #[arg(long)]
        data_start: Option<usize>,

        /// Length of account data to display (in bytes)
        #[arg(long)]
        data_len: Option<usize>,
    },

    /// Get balance for a specific account
    #[command(name = "getbalance")]
    GetBalance {
        /// Account identifier (key name from config or public key)
        /// If omitted, uses the 'default' key from config
        account: Option<String>,
    },

    /// Get slot metrics (state counters, distributed fees)
    #[command(name = "getslotmetrics")]
    GetSlotMetrics {
        /// Start slot number (required)
        slot: u64,

        /// End slot number (optional, if provided returns range of slots)
        end_slot: Option<u64>,
    },

    /// Transfer tokens between accounts
    #[command(name = "transfer")]
    Transfer {
        /// Source signing key reference (file path, keychain:<id>, or config alias)
        src: String,

        /// Destination (key name from config or public address in taXX format)
        dst: String,

        /// Amount to transfer
        value: u64,

        /// Build and sign the transfer but emit it as base64 instead of
        /// submitting (for inclusion in an externally-produced block).
        #[arg(long = "build-only")]
        build_only: bool,
    },

    /// Uploader account commands for arbitrary file payloads
    #[command(name = "uploader")]
    Uploader {
        #[command(subcommand)]
        subcommand: UploaderCommands,
    },

    /// ABI management commands
    #[command(name = "abi")]
    Abi {
        #[command(subcommand)]
        subcommand: AbiCommands,
    },

    /// Key management commands
    #[command(name = "keys")]
    Keys {
        #[command(subcommand)]
        subcommand: KeysCommands,
    },

    /// Account management commands
    #[command(name = "account")]
    Account {
        #[command(subcommand)]
        subcommand: AccountCommands,
    },

    /// Program management commands
    #[command(name = "program")]
    Program {
        #[command(subcommand)]
        subcommand: ProgramCommands,
    },

    /// Transaction signing and execution commands
    #[command(name = "txn")]
    Txn {
        #[command(subcommand)]
        subcommand: TxnCommands,
    },

    /// Utility commands for format conversion
    #[command(name = "util")]
    Util {
        #[command(subcommand)]
        subcommand: UtilCommands,
    },

    /// Token program commands
    #[command(name = "token")]
    Token {
        #[command(subcommand)]
        subcommand: TokenCommands,
    },

    /// Sign in to Thru Developers without exporting wallet keys
    #[command(name = "auth")]
    Auth {
        #[command(subcommand)]
        subcommand: AuthCommands,
    },

    /// Faucet program commands
    #[command(name = "faucet")]
    Faucet {
        #[command(subcommand)]
        subcommand: FaucetCommands,
    },

    /// Registrar program commands
    #[command(name = "registrar")]
    Registrar {
        #[command(subcommand)]
        subcommand: RegistrarCommands,
    },

    /// Name service program commands
    #[command(name = "nameservice")]
    NameService {
        #[command(subcommand)]
        subcommand: NameServiceCommands,
    },

    /// Wrapped Thru (WTHRU) program commands
    #[command(name = "wthru")]
    Wthru {
        #[command(subcommand)]
        subcommand: WthruCommands,
    },

    /// M-of-N multisig: create, propose, approve, execute
    #[command(name = "multisig")]
    Multisig {
        #[command(subcommand)]
        subcommand: MultisigCommands,
    },

    /// Block-producer (BP) bond program commands
    #[command(name = "bond")]
    Bond {
        #[command(subcommand)]
        subcommand: BondCommands,
    },

    /// Validator program commands
    #[command(name = "validator")]
    Validator {
        #[command(subcommand)]
        subcommand: ValidatorCommands,
    },

    /// Feature gate / chain param commands
    #[command(name = "feature-gates")]
    FeatureGates {
        /// Registry TOML path; defaults to specs/releases/feature-gates-registry.toml
        #[arg(long)]
        registry: Option<PathBuf>,

        #[command(subcommand)]
        subcommand: FeatureGatesCommands,
    },

    /// Developer tools for toolchain and project management
    #[command(name = "dev")]
    Dev {
        #[command(subcommand)]
        subcommand: DevCommands,
    },

    /// Network profile management commands
    #[command(name = "network")]
    Network {
        #[command(subcommand)]
        subcommand: Option<NetworkCommands>,
    },

    /// Debug commands for transaction analysis
    #[command(name = "debug")]
    Debug {
        #[command(subcommand)]
        subcommand: DebugCommands,
    },
}

/// Feature gate / chain param subcommands
#[derive(Subcommand)]
pub enum FeatureGatesCommands {
    /// List registry entries
    List {
        /// Filter entries by kind
        #[arg(long, value_enum, default_value = "all")]
        kind: FeatureGateListKind,
    },

    /// Show one registry entry by name or index
    Show {
        /// Registry name or numeric index
        target: String,
    },

    /// Append the next registry entry to the on-chain account
    CreateEntry {
        /// Registry name or numeric index to create
        target: String,

        /// Initial value: active/inactive for gates; decimal for u8-u128 params; 0x hex for u256/u512 params
        #[arg(long)]
        value: String,

        /// First-change stabilization lead slots
        #[arg(long, default_value = "0")]
        next_change_lead_slots: u64,

        /// Fee payer key reference; must be the creation admin signer
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Arm a value transition at an activation slot
    Arm {
        /// Registry name or numeric index to arm
        target: String,

        /// Armed value: active/inactive for gates; decimal for u8-u128 params; 0x hex for u256/u512 params
        #[arg(long)]
        value: String,

        /// Activation slot
        #[arg(long)]
        slot: u64,

        /// Fee payer key reference; must be the management admin signer
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Cancel an armed transition
    Disarm {
        /// Registry name or numeric index to disarm
        target: String,

        /// Fee payer key reference; must be the management admin signer
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Update global timing knobs atomically
    UpdateTimingKnobs {
        #[arg(long)]
        min_arming_lead_slots: u64,

        #[arg(long)]
        min_gap_between_armings_slots: u64,

        #[arg(long)]
        min_dwell_slots: u64,

        #[arg(long)]
        no_disarm_window_slots: u64,

        /// Fee payer key reference; must be the config admin signer
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Propose a new admin for a role
    ProposeAdmin {
        /// Role to hand off
        #[arg(long, value_enum)]
        role: FeatureGateAdminRole,

        /// New admin pubkey
        #[arg(long)]
        new_admin: String,

        /// Fee payer key reference; must be the current admin signer for the role
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Accept a pending admin role handoff
    AcceptAdmin {
        /// Role to accept
        #[arg(long, value_enum)]
        role: FeatureGateAdminRole,

        /// Fee payer key reference; must be the pending admin signer for the role
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum FeatureGateListKind {
    All,
    FeatureGate,
    ChainParam,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum FeatureGateAdminRole {
    Creation,
    Management,
    Config,
}

/// Program-related subcommands
#[derive(Subcommand)]
pub enum ProgramCommands {
    /// Create a new program from a program binary
    Create {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta account derivation
        seed: String,

        /// Authority key reference (defaults to and must match the fee payer)
        #[arg(long)]
        authority: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Program file to upload and create managed program from
        program_file: String,

        /// Skip local program image validation before upload
        #[arg(long)]
        skip_program_image_validation: bool,

        /// Chunk size for upload (1024-31000 bytes, default: 30720)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,

        /// Skip the ELF magic check for offset-zero uploader writes
        #[arg(long)]
        skip_elf_check: bool,

        #[command(flatten)]
        abi: ProgramAbiArgs,
    },

    /// Upgrade an existing managed program
    Upgrade {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// Fee payer/current authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Program file to upload and upgrade managed program with
        program_file: String,

        /// Skip local program image validation before upload
        #[arg(long)]
        skip_program_image_validation: bool,

        /// Chunk size for upload (1024-31000 bytes, default: 30720)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,

        /// Skip the ELF magic check for offset-zero uploader writes
        #[arg(long)]
        skip_elf_check: bool,

        #[command(flatten)]
        abi: ProgramAbiArgs,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Pause or unpause a managed program
    SetPause {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// Set paused state (true to pause, false to unpause)
        paused: String,

        /// Fee payer/current authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Destroy a managed program and its meta account
    Destroy {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// Fee payer/current authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// Finalize a managed program (make it immutable)
    Finalize {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// Fee payer/current authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// Set authority candidate for a managed program
    SetAuthority {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// New authority candidate public key
        authority_candidate: String,

        /// Fee payer/current authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Claim authority for a managed program
    ClaimAuthority {
        /// Manager program public key (optional)
        #[arg(long)]
        manager: Option<String>,

        /// Make the program ephemeral
        #[arg(long)]
        ephemeral: bool,

        /// Seed for meta and program account derivation
        seed: String,

        /// Fee payer/authority candidate key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Get the program derived address
    DeriveAddress {
        /// Program public key
        program_id: String,

        /// Seed (hex string or UTF-8 string)
        seed: String,

        /// Ephemeral flag
        #[arg(long)]
        ephemeral: bool,
    },

    /// Derive both meta and program account addresses from a seed
    DeriveManagerAccounts {
        /// Manager program public key (optional, uses config default if not specified)
        #[arg(long)]
        manager: Option<String>,

        /// Seed for account derivation (UTF-8 string, max 32 bytes)
        seed: String,

        /// Ephemeral flag
        #[arg(long)]
        ephemeral: bool,
    },

    /// Convert a UTF-8 seed string into zero-padded 32-byte hex
    SeedToHex {
        /// Seed string (UTF-8, maximum 32 bytes)
        seed: String,
    },

    /// Derive the managed program account address from a seed
    DeriveProgramAccount {
        /// Manager program public key (optional, uses config default if not specified)
        #[arg(long)]
        manager: Option<String>,

        /// Seed for account derivation (UTF-8 string, max 32 bytes)
        seed: String,

        /// Ephemeral flag
        #[arg(long)]
        ephemeral: bool,
    },

    /// Check status of program and related accounts
    Status {
        /// Manager program public key (optional, uses config default if not specified)
        #[arg(long)]
        manager: Option<String>,

        /// Seed for account derivation (UTF-8 string, max 32 bytes)
        seed: String,

        /// Ephemeral flag
        #[arg(long)]
        ephemeral: bool,
    },
}

/// ABI-related subcommands
#[derive(Subcommand)]
pub enum AbiCommands {
    /// On-chain ABI account management commands
    #[command(name = "account")]
    Account {
        #[command(subcommand)]
        subcommand: AbiAccountCommands,
    },

    /// Generate code from ABI type definitions
    Codegen {
        /// Input YAML files containing type definitions
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /// Include directories for imported type files
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /// Target language for code generation
        #[arg(short = 'l', long = "language", value_enum)]
        language: AbiLanguage,

        /// Output directory for generated code
        #[arg(
            short = 'o',
            long = "output",
            value_name = "DIR",
            default_value = "generated"
        )]
        output_dir: PathBuf,

        /// Enable verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,

        /// Go module path of the output root, written to go.mod (Go only;
        /// default `abigen`)
        #[arg(long = "go-module", value_name = "PATH")]
        go_module: Option<String>,
    },

    /// Analyze ABI type definitions and show detailed type information
    Analyze {
        /// Input YAML files containing type definitions
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /// Include directories for imported type files
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /// Print the shared layout IR after analysis
        #[arg(long = "print-ir")]
        print_ir: bool,

        /// Format to use when printing the shared layout IR
        #[arg(long = "ir-format", value_enum, default_value = "json")]
        ir_format: AbiIrFormat,

        /// Print the generated legacy + IR footprint helpers for a specific type
        #[arg(long = "print-footprint", value_name = "TYPE")]
        print_footprint: Option<String>,

        /// Print the generated legacy + IR validate helpers for a specific type
        #[arg(long = "print-validate", value_name = "TYPE")]
        print_validate: Option<String>,
    },

    /// Parse ABI binary data and print JSON reflection results
    Reflect {
        /// ABI file(s) to load
        #[arg(short = 'f', long = "abi-file", required = true)]
        abi_files: Vec<PathBuf>,

        /// Include directories for resolving imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Type name to parse
        #[arg(short = 't', long = "type-name", required = true)]
        type_name: String,

        /// Binary data file to parse
        #[arg(short = 'd', long = "data-file", required = true)]
        data_file: PathBuf,

        /// Pretty print JSON output
        #[arg(short = 'p', long = "pretty")]
        pretty: bool,

        /// Show only values (no type information)
        #[arg(
            long = "values-only",
            conflicts_with_all = ["validate_only", "include_byte_offsets"]
        )]
        values_only: bool,

        /// Only validate buffer without decoding
        #[arg(
            long = "validate-only",
            conflicts_with_all = ["values_only", "include_byte_offsets"]
        )]
        validate_only: bool,

        /// Print dynamic parameters inferred from the buffer
        #[arg(long = "show-params")]
        show_params: bool,

        /// Include byte offset information in the output
        #[arg(
            long = "include-byte-offsets",
            conflicts_with_all = ["validate_only", "values_only"]
        )]
        include_byte_offsets: bool,
    },

    /// Flatten an ABI file by resolving all imports
    Flatten {
        /// Input ABI file
        #[arg(short = 'f', long = "file", required = true)]
        file: PathBuf,

        /// Include directories for resolving imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Output file path
        #[arg(short = 'o', long = "output", required = true)]
        output: PathBuf,

        /// Verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },

    /// Prepare an ABI file for on-chain publishing
    #[command(name = "prep-for-publish")]
    PrepForPublish {
        /// Input ABI file
        #[arg(short = 'f', long = "file", required = true)]
        file: PathBuf,

        /// Include directories for resolving local imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Target network for validation (e.g., "mainnet", "testnet")
        #[arg(short = 'n', long = "target-network", required = true)]
        target_network: String,

        /// Output file path
        #[arg(short = 'o', long = "output", required = true)]
        output: PathBuf,

        /// Verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },

    /// Create a dependency manifest for WASM consumption
    Bundle {
        /// Input ABI file
        #[arg(short = 'f', long = "file", required = true)]
        file: PathBuf,

        /// Include directories for resolving imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Output manifest file path (JSON)
        #[arg(short = 'o', long = "output", required = true)]
        output: PathBuf,

        /// Verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum AbiAccountType {
    /// ABI account for a managed program
    Program,
    /// ABI account for an unmanaged target program
    #[value(name = "third-party")]
    ThirdParty,
    /// ABI account not associated with a program
    Standalone,
}

/// On-chain ABI account subcommands
#[derive(Subcommand)]
pub enum AbiAccountCommands {
    /// Create an ABI account
    Create {
        /// Program type (ephemeral matches the ABI account target)
        #[arg(long)]
        ephemeral: bool,

        /// ABI account type
        #[arg(long = "account-type", value_enum, default_value = "program")]
        account_type: AbiAccountType,

        /// Target program account public key (required for `third-party`)
        #[arg(long = "target-program")]
        target_program: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority key reference (`program` only; must match the fee payer)
        #[arg(long, conflicts_with = "publisher")]
        authority: Option<String>,

        /// Publisher key reference (`third-party` and `standalone` only; must match the fee payer)
        #[arg(long, conflicts_with = "authority")]
        publisher: Option<String>,

        /// Managed program seed, third-party 32-byte hex seed, or standalone seed string
        seed: String,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Upgrade an existing ABI account
    Upgrade {
        #[arg(long)]
        ephemeral: bool,

        #[arg(long = "account-type", value_enum, default_value = "program")]
        account_type: AbiAccountType,

        #[arg(long = "target-program")]
        target_program: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority key reference (`program` only; must match the fee payer)
        #[arg(long, conflicts_with = "publisher")]
        authority: Option<String>,

        /// Publisher key reference (`third-party` and `standalone` only; must match the fee payer)
        #[arg(long, conflicts_with = "authority")]
        publisher: Option<String>,

        seed: String,
        abi_file: String,
    },

    /// Finalize an ABI account so it becomes immutable
    Finalize {
        #[arg(long)]
        ephemeral: bool,

        #[arg(long = "account-type", value_enum, default_value = "program")]
        account_type: AbiAccountType,

        #[arg(long = "target-program")]
        target_program: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority key reference (`program` only; must match the fee payer)
        #[arg(long, conflicts_with = "publisher")]
        authority: Option<String>,

        /// Publisher key reference (`third-party` and `standalone` only; must match the fee payer)
        #[arg(long, conflicts_with = "authority")]
        publisher: Option<String>,

        seed: String,
    },

    /// Close an ABI account and reclaim its balance
    Close {
        #[arg(long)]
        ephemeral: bool,

        #[arg(long = "account-type", value_enum, default_value = "program")]
        account_type: AbiAccountType,

        #[arg(long = "target-program")]
        target_program: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority key reference (`program` only; must match the fee payer)
        #[arg(long, conflicts_with = "publisher")]
        authority: Option<String>,

        /// Publisher key reference (`third-party` and `standalone` only; must match the fee payer)
        #[arg(long, conflicts_with = "authority")]
        publisher: Option<String>,

        seed: String,
    },

    /// Inspect an ABI account's metadata and optionally dump its YAML contents
    Get {
        /// ABI account public key (Thru address)
        abi_account: String,

        /// Include ABI YAML contents in the CLI output
        #[arg(long = "include-data", alias = "data")]
        include_data: bool,

        /// Optional file path to write the ABI YAML contents
        #[arg(long = "out")]
        out: Option<String>,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum AbiLanguage {
    C,
    Rust,
    #[value(name = "typescript")]
    TypeScript,
    Go,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
pub enum AbiIrFormat {
    Json,
    Protobuf,
}

/// Uploader-related subcommands
#[derive(Subcommand)]
pub enum UploaderCommands {
    /// Upload a file payload through uploader accounts
    Upload {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Chunk size for upload transactions (1024-31000 bytes)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,

        /// Skip the ELF magic check for offset-zero uploader writes
        #[arg(long)]
        skip_elf_check: bool,

        /// Seed for account derivation
        seed: String,

        /// Path to the file payload to upload
        #[arg(value_name = "FILE")]
        program_file: String,
    },

    /// Clean up uploader accounts
    Cleanup {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Seed for account derivation
        seed: String,
    },

    /// Check status of uploader accounts
    Status {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

        /// Seed for account derivation
        seed: String,
    },
}

/// Reject obsolete positional secrets without letting clap format their value.
#[derive(Clone)]
struct RejectPositionalSeed;

impl clap::builder::TypedValueParser for RejectPositionalSeed {
    type Value = bool;

    fn parse_ref(
        &self,
        _command: &clap::Command,
        _argument: Option<&clap::Arg>,
        _value: &std::ffi::OsStr,
    ) -> Result<Self::Value, clap::Error> {
        Err(clap::Error::raw(
            clap::error::ErrorKind::ValueValidation,
            "Private keys cannot be passed as arguments; use --stdin or --file",
        ))
    }
}

/// Key management subcommands
#[derive(Subcommand)]
pub enum KeysCommands {
    /// List registered key references and public addresses
    List,

    /// Register a private-key file or import a seed from file/stdin
    Add {
        /// Replace a registration and clean up its unreferenced CLI-managed seed file
        #[arg(long)]
        overwrite: bool,

        /// Config alias (case-insensitive)
        name: String,

        /// Obsolete positional input is rejected before retaining its value.
        #[arg(hide = true, num_args = 1.., value_parser = RejectPositionalSeed)]
        legacy_seed: Vec<bool>,

        /// Read a 32-byte hex seed from this owner-only file
        #[arg(long, conflicts_with = "stdin")]
        file: Option<PathBuf>,

        /// Read a 32-byte hex seed from standard input, never a command-line argument
        #[arg(long, conflicts_with = "file")]
        stdin: bool,

        /// Secret storage backend; file input with file storage is registered in place
        #[arg(long, value_enum, default_value = "file")]
        store: KeyStorage,
    },

    /// Show a registered key's public address and source, never its private key
    Get {
        /// Config alias to retrieve
        name: String,
    },

    /// Generate a key directly into a dedicated file or macOS Keychain
    Generate {
        /// Replace a registration and clean up its unreferenced CLI-managed seed file
        #[arg(long)]
        overwrite: bool,

        /// Config alias for the new key
        name: String,

        /// Secret storage backend
        #[arg(long, value_enum, default_value = "file")]
        store: KeyStorage,
    },

    /// Unregister a key and clean up its unreferenced CLI-managed seed file
    #[command(name = "rm")]
    Remove {
        /// Allow unregistering the default key
        #[arg(long)]
        force: bool,

        /// Also delete an external file or Keychain entry instead of retaining it
        #[arg(long)]
        delete_secret: bool,

        /// Config alias to remove
        name: String,
    },

    /// Move registered keys between file and macOS Keychain storage
    Move {
        /// Config alias to move (omit with --all)
        #[arg(required_unless_present = "all", conflicts_with = "all")]
        name: Option<String>,
        /// Move every registered key
        #[arg(long)]
        all: bool,
        /// Destination storage
        #[arg(long, value_enum)]
        to: KeyStorage,
    },
    /// Move legacy inline config keys into files or macOS Keychain
    Migrate {
        /// Destination secret storage backend
        #[arg(long, value_enum, default_value = "file")]
        store: KeyStorage,
    },
}

/// Network profile management subcommands
#[derive(Subcommand)]
pub enum NetworkCommands {
    /// Add a new named network profile
    Add {
        /// Network profile name (case-insensitive)
        name: String,

        /// RPC endpoint URL
        #[arg(long)]
        url: String,

        /// Optional authorization token
        #[arg(long = "auth-token")]
        auth_token: Option<String>,
    },

    /// Use a named network profile
    #[command(name = "use")]
    Use {
        /// Network profile name to make active
        name: String,
    },

    /// Update fields on an existing network profile
    Set {
        /// Network profile name to update
        name: String,

        /// New RPC endpoint URL
        #[arg(long)]
        url: Option<String>,

        /// New authorization token (use empty string to clear)
        #[arg(long = "auth-token")]
        auth_token: Option<String>,
    },

    /// Remove a network profile
    #[command(name = "rm")]
    Remove {
        /// Network profile name to remove
        name: String,
    },
}

/// Transaction management subcommands
#[derive(Subcommand)]
pub enum TxnCommands {
    /// Create and sign a transaction, output as base64 string
    Sign {
        /// Program public key (ta... format or key name from config)
        program: String,

        /// Instruction data as hex string
        instruction_data: String,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Transaction fee (optional, defaults to 1)
        #[arg(long, default_value = "1")]
        fee: u64,

        /// Compute units (defaults to 0)
        #[arg(long, default_value = "0")]
        compute_units: u32,

        /// State units (defaults to 0)
        #[arg(long, default_value = "0")]
        state_units: u16,

        /// Memory units (defaults to 0)
        #[arg(long, default_value = "0")]
        memory_units: u16,

        /// Expiry after (optional, defaults to 100)
        #[arg(long, default_value = "100")]
        expiry_after: u32,

        /// Read-write account addresses in ascending order (optional)
        #[arg(long)]
        readwrite_accounts: Vec<String>,

        /// Read-only account addresses in ascending order (optional)
        #[arg(long)]
        readonly_accounts: Vec<String>,
    },

    /// Create, sign and execute a transaction, print response
    Execute {
        /// Program public key (ta... format or key name from config)
        program: String,

        /// Instruction data as hex string
        instruction_data: String,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Transaction fee (optional, defaults to 1)
        #[arg(long, default_value = "1")]
        fee: u64,

        /// Compute units (defaults to 0)
        #[arg(long, default_value = "0")]
        compute_units: u32,

        /// State units (defaults to 0)
        #[arg(long, default_value = "0")]
        state_units: u16,

        /// Memory units (defaults to 0)
        #[arg(long, default_value = "0")]
        memory_units: u16,

        /// Expiry after (optional, defaults to 100)
        #[arg(long, default_value = "100")]
        expiry_after: u32,

        /// Transaction timeout in seconds (optional, defaults to 30)
        #[arg(long, default_value = "30")]
        timeout: u64,

        /// Read-write account addresses in ascending order (optional)
        #[arg(long)]
        readwrite_accounts: Vec<String>,

        /// Read-only account addresses in ascending order (optional)
        #[arg(long)]
        readonly_accounts: Vec<String>,
    },

    /// Create a cryptographic state proof for a given account
    #[command(name = "make-state-proof")]
    MakeStateProof {
        /// Type of proof to create (creating, updating, existing)
        proof_type: String,

        /// Account public key for which to create the state proof
        account: String,

        /// Slot to create the proof for (optional)
        #[arg(long)]
        slot: Option<u64>,
    },

    /// Get transaction details by signature
    Get {
        /// Transaction signature (ts... format or 128 hex characters)
        signature: String,

        /// Number of retry attempts (1-60, default: 1)
        #[arg(long = "retry-count", value_name = "COUNT", default_value = "1", value_parser = clap::value_parser!(u32).range(1..=60))]
        retry_count: u32,
    },

    /// Debug a confirmed transaction
    Debug {
        /// Transaction signature (ts... format or 128 hex characters)
        signature: String,

        /// Include account state snapshots before execution
        #[arg(long = "state-before", alias = "include-state-before")]
        include_state_before: bool,

        /// Include account state snapshots after execution
        #[arg(long = "state-after", alias = "include-state-after")]
        include_state_after: bool,

        /// Include full account data in state snapshots
        #[arg(long = "account-data", alias = "include-account-data")]
        include_account_data: bool,

        /// Save VM execution trace to file
        #[arg(long, value_name = "FILE")]
        output_trace: Option<String>,

        /// Include the full trace string in JSON output
        #[arg(long)]
        inline_trace: bool,

        /// Include full memory dump (stack + heap pages)
        #[arg(long = "memory-dump", alias = "include-memory-dump")]
        include_memory_dump: bool,
    },

    /// Sort public keys for inclusion in transaction account lists
    Sort {
        /// Public keys to sort (hex or ta... format)
        pubkeys: Vec<String>,
    },
}

/// Account management subcommands
#[derive(Subcommand)]
pub enum AccountCommands {
    /// Create a new account with fee payer proof
    Create {
        /// Signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        key_name: Option<String>,
    },

    /// Get account information (alias to getaccountinfo)
    Info {
        /// Key reference (file path, keychain:<id>, or alias; defaults to 'default')
        key_name: Option<String>,
    },

    /// List transactions involving an account
    #[command(name = "transactions")]
    Transactions {
        /// Account identifier (key name from config or public key, defaults to 'default')
        account: Option<String>,

        /// Maximum number of transactions to return (defaults to server setting)
        #[arg(long = "page-size")]
        page_size: Option<u32>,

        /// Page token to continue from a previous request
        #[arg(long = "page-token")]
        page_token: Option<String>,
    },

    /// Compress an account
    Compress {
        /// Target account to compress (key name from config or ta... address)
        target_account: String,
        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        fee_payer: Option<String>,
    },

    /// Decompress an account
    Decompress {
        /// Target account to decompress (key name from config or ta... address)
        target_account: String,
        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        fee_payer: Option<String>,
    },

    /// Prepare account decompression - get account data and proof
    PrepareDecompression {
        /// Account address or key name from configuration
        account: String,
    },
}

/// Utility subcommands
#[derive(Subcommand)]
pub enum UtilCommands {
    /// Format conversion commands
    #[command(name = "convert")]
    Convert {
        #[command(subcommand)]
        subcommand: ConvertCommands,
    },

    /// Derive the ed25519 public key (or a full identity keyfile) from a private key.
    ///
    /// The private key (a 32-byte ed25519 seed, 64 hex chars, optional "0x") is
    /// taken from the positional argument, else --file, else (only when asked)
    /// --stdin. In text mode only the selected value is printed (pipe-friendly);
    /// --json emits the public forms, and private material only when it is
    /// asked for (--reveal-private-key, --format identity-json).
    #[command(name = "derive")]
    Derive {
        /// Hex private key / 32-byte ed25519 seed. If omitted, use --file or --stdin.
        private_key: Option<String>,

        /// Read the private key from this file instead of the argument.
        #[arg(long = "file")]
        file: Option<String>,

        /// Read the private key from stdin (only when explicitly requested).
        #[arg(long = "stdin")]
        stdin: bool,

        /// What to emit (text mode): hex public key, thru-format public key, or
        /// the identity keyfile JSON [seed||pubkey] (which includes the private key).
        /// In --json mode this also selects whether "identity_json" is emitted.
        #[arg(long = "format", value_enum, default_value = "hex")]
        format: DeriveFormat,

        /// Echo the private key back in --json output ("private_key_hex").
        /// Off by default so structured output carries no signing material.
        #[arg(long = "reveal-private-key")]
        reveal_private_key: bool,
    },
}

/// Output selection for `util derive`.
#[derive(Copy, Clone, PartialEq, Eq, Debug, ValueEnum)]
pub enum DeriveFormat {
    /// Public key as 64-char hex
    Hex,
    /// Public key in thru format (ta…)
    Thrufmt,
    /// Identity keyfile JSON array `[seed(32)..pubkey(32)]` (includes the private key) —
    /// the format `fullnode keys new identity` writes
    IdentityJson,
}

/// Format conversion subcommands
#[derive(Subcommand)]
pub enum ConvertCommands {
    /// Public key conversion commands
    #[command(name = "pubkey")]
    Pubkey {
        #[command(subcommand)]
        subcommand: PubkeyConvertCommands,
    },

    /// Signature conversion commands
    #[command(name = "signature")]
    Signature {
        #[command(subcommand)]
        subcommand: SignatureConvertCommands,
    },
}

/// Public key conversion subcommands
#[derive(Subcommand)]
pub enum PubkeyConvertCommands {
    /// Convert hex public key to thru format (ta...)
    #[command(name = "hex-to-thrufmt")]
    HexToThruFmt {
        /// Hex-encoded public key (64 hex characters)
        hex_pubkey: String,
    },

    /// Convert thru format public key (ta...) to hex
    #[command(name = "thrufmt-to-hex")]
    ThruFmtToHex {
        /// Thru format public key (46 characters starting with ta)
        thrufmt_pubkey: String,
    },
}

/// Signature conversion subcommands
#[derive(Subcommand)]
pub enum SignatureConvertCommands {
    /// Convert hex signature to thru format (ts...)
    #[command(name = "hex-to-thrufmt")]
    HexToThruFmt {
        /// Hex-encoded signature (128 hex characters)
        hex_signature: String,
    },

    /// Convert thru format signature (ts...) to hex
    #[command(name = "thrufmt-to-hex")]
    ThruFmtToHex {
        /// Thru format signature (90 characters starting with ts)
        thrufmt_signature: String,
    },
}

/// Token program subcommands
#[derive(Subcommand)]
pub enum TokenCommands {
    /// Initialize a new token mint
    InitializeMint {
        /// Creator address (must match the selected fee payer)
        creator: String,

        /// Mint authority address (optional, defaults to creator)
        #[arg(long)]
        mint_authority: Option<String>,

        /// Freeze authority address (optional)
        #[arg(long)]
        freeze_authority: Option<String>,

        /// Number of decimal places
        #[arg(long, default_value = "9")]
        decimals: u8,

        /// Token ticker symbol (max 8 characters)
        ticker: String,

        /// Seed for mint account derivation (32 bytes hex)
        seed: String,

        /// State proof for mint account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        state_proof: Option<String>,

        /// Fee payer/creator signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the configured
        /// token_program_public_key
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Initialize a new token account
    InitializeAccount {
        /// Mint account address
        mint: String,

        /// Account owner address
        owner: String,

        /// Seed for token account derivation (32 bytes hex)
        seed: String,

        /// State proof for token account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        state_proof: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Transfer tokens between accounts
    Transfer {
        /// Source token account address
        from: String,

        /// Destination token account address
        to: String,

        /// Amount to transfer
        amount: u64,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the token account
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Send the plain Transfer instruction instead of TransferChecked.
        /// TransferChecked makes the token program check the mint, its
        /// decimals and its ticker. Use this flag for a mint whose stored
        /// ticker is not canonical, or when the network's token program does
        /// not support TransferChecked yet (the transfer fails with
        /// TokenError 2). Not accepted with --via-multisig: a multisig
        /// proposal always carries the plain Transfer
        #[arg(long, conflicts_with = "via_multisig")]
        unchecked: bool,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Mint new tokens to an account
    MintTo {
        /// Mint account address
        mint: String,

        /// Destination token account address
        to: String,

        /// Mint authority address (must match the selected fee payer)
        authority: String,

        /// Amount to mint
        amount: u64,

        /// Fee payer/mint-authority signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Burn tokens from an account
    Burn {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Account authority address (must match the selected fee payer)
        authority: String,

        /// Amount to burn
        amount: u64,

        /// Fee payer/account-authority signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Close a token account
    CloseAccount {
        /// Token account address
        account: String,

        /// Destination for remaining balance
        destination: String,

        /// Account authority address (must match the selected fee payer)
        authority: String,

        /// Fee payer/account-authority signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the token account
        #[arg(long = "token-program")]
        token_program: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Freeze a token account
    FreezeAccount {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Freeze authority address (must match the selected fee payer)
        authority: String,

        /// Fee payer/freeze-authority signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Unfreeze a token account
    ThawAccount {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Freeze authority address (must match the selected fee payer)
        authority: String,

        /// Fee payer/freeze-authority signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,

        #[command(flatten)]
        via: ViaMultisigArgs,
    },

    /// Derive token account address from mint, owner, and seed
    DeriveTokenAccount {
        /// Mint account address
        mint: String,

        /// Account owner address
        owner: String,

        /// Seed for derivation (32 bytes hex, optional - defaults to all zeros)
        #[arg(long)]
        seed: Option<String>,

        /// Token program address (ta... or hex); defaults to the on-chain owner of
        /// the mint
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Derive mint account address from creator and seed
    DeriveMintAccount {
        /// Creator address
        creator: String,

        /// Seed for derivation (32 bytes hex)
        seed: String,

        /// Token program address (ta... or hex); defaults to the configured
        /// token_program_public_key
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Get the balance and metadata of a token account
    Balance {
        /// Token account address (ta... or hex)
        token_account: String,

        /// Override token program address (ta... or hex); when set, the account's
        /// owner program is asserted to match.
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },
}

/// Thru Developers account authentication
#[derive(Subcommand)]
pub enum AuthCommands {
    /// Approve this CLI installation in your browser
    Login {
        /// Display the approval URL/code without opening a browser
        #[arg(long)]
        no_browser: bool,
        /// Print the approval URL and code, save the pending login and exit
        /// without waiting; finish with `thru auth login --resume`. Never opens a browser
        #[arg(long, conflicts_with = "resume")]
        no_wait: bool,
        /// Wait for approval of the login started by `thru auth login --no-wait`, then finish it
        #[arg(long)]
        resume: bool,
    },
    /// Validate the current Developers account, refreshing credentials if needed
    Status,
    /// Revoke this installation and clear its local credentials
    Logout,
    /// Manage your organization's RPC API keys on Thru Developers
    Keys {
        #[command(subcommand)]
        subcommand: AuthKeysCommands,
    },
}

/// Organization API keys, managed with the `thru auth login` credentials
#[derive(Subcommand)]
pub enum AuthKeysCommands {
    /// List the organization's API keys
    List,
    /// Create a named API key; its secret is printed once
    Create {
        /// Name of the key, for example the service or CI job that uses it
        #[arg(long)]
        name: String,
        /// Hostname allowed to use the key from a browser (repeatable; `*.` prefix allowed)
        #[arg(long = "origin", value_name = "HOST")]
        origins: Vec<String>,
    },
    /// Revoke an API key by id (see `thru auth keys list`)
    Revoke {
        /// Id of the key to revoke
        key_id: String,
    },
}

/// THRU and test UUSD faucet commands
#[derive(Subcommand)]
pub enum FaucetCommands {
    /// Deposit THRU into the on-chain faucet
    Deposit {
        /// Account identifier (key name or ta.../hex pubkey) to use as depositor (must match fee payer)
        account: String,

        /// Amount to deposit in raw THRU balance units
        amount: u64,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// Withdraw THRU or test UUSD
    Withdraw {
        #[command(subcommand)]
        subcommand: FaucetWithdrawCommands,
    },
}

#[derive(Subcommand)]
pub enum FaucetWithdrawCommands {
    /// Fund an existing account with THRU through Thru Developers
    #[command(alias = "native")]
    Thru {
        /// Account identifier (key name or ta.../hex pubkey) to use as recipient
        account: String,

        /// Amount in raw THRU balance units (max 10000 per request)
        amount: u64,
    },

    /// Fund an existing test UUSD token account through Thru Developers
    Uusd {
        /// Existing ta... UUSD token-account address on the selected network
        account: String,

        /// Positive decimal token amount, such as 10 or 0.001
        amount: String,
    },
}

/// Thru registrar program subcommands
#[derive(Subcommand)]
pub enum RegistrarCommands {
    /// Initialize the .thru registry
    InitializeRegistry {
        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,

        /// Root registrar account address
        root_registrar_account: String,

        /// Treasurer token account address
        treasurer_account: String,

        /// Token mint address (the mint itself, not a holder account)
        token_mint_account: String,

        /// Token program address
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Price per year in base units
        price_per_year: u64,

        /// Root domain name (e.g., "thru")
        #[arg(default_value = "thru")]
        root_domain_name: String,

        /// State proof for config account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        config_proof: Option<String>,

        /// State proof for registrar account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        registrar_proof: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },

    /// Purchase a .thru domain
    PurchaseDomain {
        /// Domain name without .thru suffix (e.g., "example")
        domain_name: String,

        /// Number of years to purchase (must be > 0)
        years: u8,

        /// Config account address (must exist and be initialized)
        config_account: String,

        /// Payer token account (must be an account for the registry mint owned by fee payer)
        payer_token_account: String,

        /// State proof for lease account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        lease_proof: Option<String>,

        /// State proof for domain account creation (hex encoded, optional - will auto-generate if not provided)
        #[arg(long)]
        domain_proof: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },

    /// Renew an existing domain lease
    RenewLease {
        /// Lease account address
        lease_account: String,

        /// Number of years to extend the lease (must be > 0)
        years: u8,

        /// Config account address (must exist and be initialized)
        config_account: String,

        /// Payer token account (must be an account for the registry mint owned by fee payer)
        payer_token_account: String,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },

    /// Claim an expired domain
    ClaimExpiredDomain {
        /// Lease account address
        lease_account: String,

        /// Number of years to claim the domain (must be > 0)
        years: u8,

        /// Config account address (must exist and be initialized)
        config_account: String,

        /// Payer token account (must be an account for the registry mint owned by fee payer)
        payer_token_account: String,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },
}

/// Name service program subcommands
#[derive(Subcommand)]
pub enum NameServiceCommands {
    /// Append a key/value record to a domain
    #[command(name = "append-record")]
    AppendRecord {
        /// Domain account address
        domain_account: String,

        /// Record key (<=32 bytes)
        key: String,

        /// Record value (<=256 bytes)
        value: String,

        /// Owner account pubkey (defaults to fee payer)
        #[arg(long)]
        owner: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Delete a key/value record from a domain
    #[command(name = "delete-record")]
    DeleteRecord {
        /// Domain account address
        domain_account: String,

        /// Record key to delete
        key: String,

        /// Owner account pubkey (defaults to fee payer)
        #[arg(long)]
        owner: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Derive config account address
    DeriveConfigAccount {
        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },

    /// Derive a domain account address from parent and name
    #[command(name = "derive-domain-account")]
    DeriveDomainAccount {
        /// Parent registrar or domain account address
        parent_account: String,

        /// Domain name segment (e.g., "example")
        domain_name: String,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Derive lease account address from domain name
    DeriveLeaseAccount {
        /// Domain name without .thru suffix (e.g., "example")
        domain_name: String,

        /// Override thru registrar program address (ta... or hex)
        #[arg(long = "thru-registrar-program", alias = "thru-name-service-program")]
        thru_registrar_program: Option<String>,
    },

    /// Derive a root registrar account address from the root name
    #[command(name = "derive-registrar-account")]
    DeriveRegistrarAccount {
        /// Root domain name segment
        root_name: String,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Initialize a root registrar for the base name service program
    #[command(name = "init-root")]
    InitRoot {
        /// Root domain name (e.g., "thru")
        root_name: String,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,

        /// Registrar account address (derived automatically if omitted)
        #[arg(long)]
        registrar_account: Option<String>,

        /// Authority account pubkey (defaults to fee payer)
        #[arg(long)]
        authority: Option<String>,

        /// State proof for registrar account creation (hex encoded, optional - auto-generated if not provided)
        #[arg(long)]
        proof: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// List records stored on a domain
    #[command(name = "list-records")]
    ListRecords {
        /// Domain account address
        domain_account: String,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Register a subdomain under a parent registrar or domain
    #[command(name = "register-subdomain")]
    RegisterSubdomain {
        /// Subdomain name segment (e.g., "example")
        domain_name: String,

        /// Parent registrar or domain account address
        parent_account: String,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,

        /// Domain account address (derived automatically if omitted)
        #[arg(long)]
        domain_account: Option<String>,

        /// Owner account pubkey (defaults to fee payer)
        #[arg(long)]
        owner: Option<String>,

        /// Authority account pubkey (defaults to owner)
        #[arg(long)]
        authority: Option<String>,

        /// State proof for domain account creation (hex encoded, optional - auto-generated if not provided)
        #[arg(long)]
        proof: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// Resolve a domain account and optionally retrieve a record value
    #[command(name = "resolve")]
    Resolve {
        /// Domain account address
        domain_account: String,

        /// Optional record key to fetch
        #[arg(long)]
        key: Option<String>,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },

    /// Unregister (delete) a subdomain
    #[command(name = "unregister-subdomain")]
    UnregisterSubdomain {
        /// Domain account address
        domain_account: String,

        /// Owner account pubkey (defaults to fee payer)
        #[arg(long)]
        owner: Option<String>,

        /// Fee payer signing key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Name service program address
        #[arg(long = "name-service-program")]
        name_service_program: Option<String>,
    },
}

/// WTHRU program subcommands
#[derive(Subcommand)]
pub enum WthruCommands {
    /// Initialize the WTHRU mint and vault accounts
    Initialize {
        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override WTHRU program address (ta... or hex)
        #[arg(long = "program")]
        program: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Deposit native THRU and receive WTHRU tokens
    // The native transfer into the vault and the deposit instruction are sent
    // as two separate transactions. WTHRU is minted from the vault's balance
    // delta, which does not identify a depositor, so a concurrent caller can
    // claim the transferred amount in between. Use this only against a vault
    // that is not shared with untrusted depositors; otherwise batch the
    // transfer and the deposit into one transaction via the multicall program.
    Deposit {
        /// Destination WTHRU token account address
        dest_token_account: String,

        /// Amount of native THRU to wrap (lamports)
        amount: u64,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override WTHRU program address (ta... or hex)
        #[arg(long = "program")]
        program: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Skip the native transfer (only run the deposit instruction)
        #[arg(long = "skip-transfer")]
        skip_transfer: bool,
    },

    /// Withdraw native THRU by burning WTHRU tokens
    Withdraw {
        /// Source WTHRU token account address
        wthru_token_account: String,

        /// Recipient native account address (ta...)
        recipient: String,

        /// Amount of WTHRU to unwrap (lamports)
        amount: u64,

        /// Fee payer/owner key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override WTHRU program address (ta... or hex)
        #[arg(long = "program")]
        program: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },
}

/// Block-producer (BP) bond program subcommands
#[derive(Subcommand)]
pub enum BondCommands {
    /// Create a block-producer bond account (and its WTHRU token account).
    ///
    /// Mode is auto-selected: when --signer resolves to the same key as
    /// --fee-payer the bond is created self-pay (Mode 1); otherwise the signer
    /// EOA-signs a challenge and a third party pays (Mode 2).
    Create {
        /// Block-producer signing key reference (file path, keychain:<id>, or alias).
        /// Defaults to the --fee-payer key.
        #[arg(long)]
        signer: Option<String>,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Stored bond authority pubkey (key name, ta… or hex). Data only — not
        /// a signer. Defaults to the signer pubkey.
        #[arg(long)]
        authority: Option<String>,

        /// Override the bond token-account mint (defaults to canonical WTHRU)
        #[arg(long = "mint")]
        mint: Option<String>,

        /// Override BP program address (ta… or hex)
        #[arg(long = "program")]
        program: Option<String>,

        /// Override token program address (ta… or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Stage tokens into the bond from the operator's WTHRU token account
    Deposit {
        /// Block-producer signer (key name, ta… or hex) — derives the bond PDA
        signer: String,

        /// Source WTHRU token account (owned by the fee payer)
        source_ta: String,

        /// Amount to stage
        amount: u64,

        /// Fee payer/bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        #[arg(long = "mint")]
        mint: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,

        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Activate/deactivate bond (move staged<->active, raise unlock slot)
    Update {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        /// Target active_bond amount
        #[arg(long = "active")]
        active: u64,

        /// New unlock slot (raised to max(current, this)); default 0
        #[arg(long = "unlock-slot")]
        unlock_slot: Option<u64>,

        /// Fee payer/bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override attestor table address (defaults to config 0x0C02)
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,
    },

    /// Withdraw tokens out of the bond to a destination token account
    Withdraw {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        /// Destination WTHRU token account
        dest_ta: String,

        /// Amount to withdraw
        amount: u64,

        /// Withdraw from 'staged' (immediate) or 'active' (lockout-gated)
        #[arg(long = "from", default_value = "staged")]
        from: String,

        /// Fee payer/bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override attestor table address (defaults to config 0x0C02)
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        #[arg(long = "mint")]
        mint: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,

        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Rotate the bond authority
    SetAuthority {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        /// New bond authority pubkey (key name, ta… or hex)
        new_authority: String,

        /// Fee payer/current bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,
    },

    /// Sweep stray inbound transfers out of the bond token account
    Sweep {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        /// Destination WTHRU token account
        dest_ta: String,

        /// Fee payer/bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        #[arg(long = "mint")]
        mint: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,

        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Delete the bond account (requires active==0 && staged==0)
    Delete {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        /// Recipient of the returned native lamports (key name, ta… or hex)
        dest: String,

        /// Fee payer/bond authority key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,
    },

    /// Show the decoded bond account state
    Show {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        #[arg(long = "mint")]
        mint: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,

        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Print the derived bond account address for a signer
    DeriveAddress {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        #[arg(long = "program")]
        program: Option<String>,
    },

    /// Print the derived bond token account address for a signer
    DeriveTokenAccount {
        /// Block-producer signer (key name, ta… or hex)
        signer: String,

        #[arg(long = "mint")]
        mint: Option<String>,

        #[arg(long = "program")]
        program: Option<String>,

        #[arg(long = "token-program")]
        token_program: Option<String>,
    },
}

/// Validator program subcommands
#[derive(Subcommand)]
pub enum ValidatorCommands {
    /// Activate a validator in the validator program
    Activate {
        /// Source token account holding stake tokens
        #[arg(long = "source-token-account")]
        source_token_account: String,

        /// Amount of tokens to stake
        #[arg(long = "token-amount")]
        token_amount: u64,

        /// Validator BLS public key as 96-byte uncompressed hex
        #[arg(long = "bls-pubkey", requires = "bls_pop", conflicts_with_all = ["bls_seed", "bls_key"])]
        bls_pubkey: Option<String>,

        /// Identity-bound possession proof as 192-byte uncompressed hex
        #[arg(long = "bls-pop", requires = "bls_pubkey")]
        bls_pop: Option<String>,

        /// Deterministic test seed used to derive a valid BLS key pair
        #[arg(
            long = "bls-seed",
            conflicts_with = "bls_key",
            required_unless_present_any = ["bls_key", "bls_pubkey"]
        )]
        bls_seed: Option<u64>,

        /// Path to the node's bls.json (the canonical BLS key the node signs with)
        #[arg(long = "bls-key")]
        bls_key: Option<String>,

        /// Claim authority pubkey or key name (defaults to fee payer)
        #[arg(long = "claim-authority")]
        claim_authority: Option<String>,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override consensus validator program address
        #[arg(long = "program")]
        program: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        /// Override token program address
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Override converted vault address
        #[arg(long = "converted-vault")]
        converted_vault: Option<String>,
    },

    /// Deactivate a validator and withdraw unclaimed rewards
    Deactivate {
        /// Destination token account for unclaimed rewards
        #[arg(long = "dest-token-account")]
        dest_token_account: String,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override consensus validator program address
        #[arg(long = "program")]
        program: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        /// Override token program address
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Override unclaimed vault address
        #[arg(long = "unclaimed-vault")]
        unclaimed_vault: Option<String>,
    },

    /// Convert additional tokens into stake weight
    #[command(name = "convert-tokens")]
    ConvertTokens {
        /// Source token account holding additional stake tokens
        #[arg(long = "source-token-account")]
        source_token_account: String,

        /// Amount of tokens to convert
        #[arg(long = "token-amount")]
        token_amount: u64,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override consensus validator program address
        #[arg(long = "program")]
        program: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        /// Override token program address
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Override converted vault address
        #[arg(long = "converted-vault")]
        converted_vault: Option<String>,
    },

    /// Claim accumulated rewards for a validator subject
    Claim {
        /// Validator identity pubkey or key name whose rewards should be claimed
        #[arg(long = "subject-attestor")]
        subject_attestor: String,

        /// Destination token account for claimed rewards
        #[arg(long = "dest-token-account")]
        dest_token_account: String,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override consensus validator program address
        #[arg(long = "program")]
        program: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,

        /// Override token program address
        #[arg(long = "token-program")]
        token_program: Option<String>,

        /// Override unclaimed vault address
        #[arg(long = "unclaimed-vault")]
        unclaimed_vault: Option<String>,
    },

    /// Update the claim authority for a validator subject
    #[command(name = "set-claim-authority")]
    SetClaimAuthority {
        /// Validator identity pubkey or key name whose claim authority is changing
        #[arg(long = "subject-attestor")]
        subject_attestor: String,

        /// New claim authority pubkey or key name
        #[arg(long = "new-claim-authority")]
        new_claim_authority: String,

        /// Fee payer key reference (file path, keychain:<id>, or alias; defaults to 'default')
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Override consensus validator program address
        #[arg(long = "program")]
        program: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,
    },

    /// Show the validator table
    Table {
        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,
    },

    /// Show details for a specific validator by SID, address, or key name
    Info {
        /// Validator SID, address, or configured key name
        validator: String,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,
    },

    /// Derive and print the node's BLS public key from its bls.json
    #[command(name = "bls-pubkey")]
    BlsPubkey {
        /// Path to the node's bls.json (JSON byte array; first 32 bytes are the BLS scalar)
        #[arg(long = "bls-key")]
        bls_key: String,
    },

    /// Show this operator's validator status and turnover-window verdict
    Status {
        /// Validator identity pubkey or key name (defaults to the configured 'default' key)
        #[arg(long = "identity")]
        identity: Option<String>,

        /// Override attestor table account address
        #[arg(long = "attestor-table")]
        attestor_table: Option<String>,
    },
}

/// Developer tools subcommands
#[derive(Subcommand)]
pub enum DevCommands {
    /// Toolchain management commands
    #[command(name = "toolchain")]
    Toolchain {
        #[command(subcommand)]
        subcommand: ToolchainCommands,
    },

    /// SDK management commands
    #[command(name = "sdk")]
    Sdk {
        #[command(subcommand)]
        subcommand: SdkCommands,
    },

    /// Initialize new projects
    #[command(name = "init")]
    Init {
        #[command(subcommand)]
        subcommand: InitCommands,
    },
}

/// Toolchain management subcommands
#[derive(Subcommand)]
pub enum ToolchainCommands {
    /// Install toolchain from GitHub releases
    Install {
        /// Toolchain version (optional, defaults to latest)
        #[arg(long)]
        version: Option<String>,

        /// Installation path (optional, defaults to ~/.thru/sdk/toolchain/)
        #[arg(long)]
        path: Option<String>,

        /// GitHub repository (format: owner/repo, defaults to Unto-Labs/thru)
        #[arg(long)]
        repo: Option<String>,
    },

    /// Update toolchain to latest version
    Update {
        /// Installation path (optional, defaults to ~/.thru/sdk/toolchain/)
        #[arg(long)]
        path: Option<String>,

        /// GitHub repository (format: owner/repo, defaults to Unto-Labs/thru)
        #[arg(long)]
        repo: Option<String>,
    },

    /// Uninstall toolchain
    Uninstall {
        /// Installation path (optional, defaults to ~/.thru/sdk/toolchain/)
        #[arg(long)]
        path: Option<String>,

        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },

    /// Get toolchain installation path
    Path {
        /// Installation path (optional, defaults to ~/.thru/sdk/toolchain/)
        #[arg(long)]
        path: Option<String>,
    },
}

/// SDK management subcommands
#[derive(Subcommand)]
pub enum SdkCommands {
    /// Install SDK from GitHub releases
    Install {
        /// SDK language (c, cpp, rust)
        language: String,

        /// SDK version (optional, defaults to latest)
        #[arg(long)]
        version: Option<String>,

        /// Installation path (optional, defaults to ~/.thru/sdk/{language}/)
        #[arg(long)]
        path: Option<String>,

        /// GitHub repository (format: owner/repo, defaults to Unto-Labs/thru)
        #[arg(long)]
        repo: Option<String>,
    },

    /// Update SDK to latest version
    Update {
        /// SDK language (c, cpp, rust)
        language: String,

        /// Installation path (optional, defaults to ~/.thru/sdk/{language}/)
        #[arg(long)]
        path: Option<String>,

        /// GitHub repository (format: owner/repo, defaults to Unto-Labs/thru)
        #[arg(long)]
        repo: Option<String>,
    },

    /// Uninstall SDK
    Uninstall {
        /// SDK language (c, cpp, rust)
        language: String,

        /// Installation path (optional, defaults to ~/.thru/sdk/{language}/)
        #[arg(long)]
        path: Option<String>,

        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },

    /// Get SDK installation path
    Path {
        /// SDK language (c, cpp, rust)
        language: String,

        /// Installation path (optional, defaults to ~/.thru/sdk/{language}/)
        #[arg(long)]
        path: Option<String>,
    },
}

/// Project initialization subcommands
#[derive(Subcommand)]
pub enum InitCommands {
    /// Initialize a new C project
    #[command(name = "c")]
    C {
        /// Project name
        project_name: String,

        /// Project directory (optional, defaults to current directory)
        #[arg(long)]
        path: Option<String>,
    },

    /// Initialize a new C++ project (not yet implemented)
    #[command(name = "cpp")]
    Cpp {
        /// Project name
        project_name: String,

        /// Project directory (optional, defaults to current directory)
        #[arg(long)]
        path: Option<String>,
    },

    /// Initialize a new Rust project (not yet implemented)
    #[command(name = "rust")]
    Rust {
        /// Project name
        project_name: String,

        /// Project directory (optional, defaults to current directory)
        #[arg(long)]
        path: Option<String>,
    },
}

/// Debug subcommands
#[derive(Subcommand)]
pub enum DebugCommands {
    /// Resolve DWARF debug info for a transaction debug response
    ///
    /// Takes a program .elf (built with -g) and either a response JSON file or a
    /// transaction signature (calls transaction debug via gRPC). Produces a source-level
    /// error report with file:line mappings, call stack, variables, and annotated trace.
    #[command(name = "resolve")]
    Resolve {
        /// Path to the program .elf file with DWARF debug info
        #[arg(long)]
        elf: std::path::PathBuf,

        /// Path to the transaction debug response JSON file (mutually exclusive with --signature)
        #[arg(long, group = "input")]
        response: Option<std::path::PathBuf>,

        /// Transaction signature to debug via gRPC (mutually exclusive with --response)
        #[arg(long, group = "input")]
        signature: Option<String>,

        /// Number of trace lines to include before the fault
        #[arg(long, default_value = "20")]
        trace_tail: usize,

        /// Source context lines above/below the fault line
        #[arg(long, default_value = "5")]
        context: u32,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_resource_defaults_are_zero_and_overridable() {
        for command in ["sign", "execute"] {
            for explicit in [false, true] {
                let mut args = vec!["thru", "txn", command, "program", "00"];
                if explicit {
                    args.extend([
                        "--compute-units",
                        "123",
                        "--state-units",
                        "4",
                        "--memory-units",
                        "5",
                    ]);
                }
                let cli = Cli::try_parse_from(args).unwrap();
                match cli.command {
                    Commands::Txn {
                        subcommand:
                            TxnCommands::Sign {
                                compute_units,
                                state_units,
                                memory_units,
                                ..
                            }
                            | TxnCommands::Execute {
                                compute_units,
                                state_units,
                                memory_units,
                                ..
                            },
                    } => {
                        assert_eq!(
                            (compute_units, state_units, memory_units),
                            if explicit { (123, 4, 5) } else { (0, 0, 0) }
                        );
                    }
                    _ => panic!("unexpected command"),
                }
            }
        }
    }

    #[test]
    fn token_transfer_is_checked_unless_unchecked_is_passed() {
        for (flag, expected) in [(None, false), (Some("--unchecked"), true)] {
            let mut args = vec!["thru", "token", "transfer", "from", "to", "5"];
            args.extend(flag);
            let cli = Cli::try_parse_from(args).expect("token transfer should parse");

            match cli.command {
                Commands::Token {
                    subcommand: TokenCommands::Transfer { unchecked, .. },
                } => assert_eq!(unchecked, expected),
                _ => panic!("unexpected command"),
            }
        }
    }

    /* A multisig proposal always carries the plain Transfer, so the flag
     * would have no effect there. */
    #[test]
    fn token_transfer_rejects_unchecked_with_via_multisig() {
        let args = ["thru", "token", "transfer", "from", "to", "5"];

        let conflict = ["--unchecked", "--via-multisig", "ms"];
        match Cli::try_parse_from(args.into_iter().chain(conflict)) {
            Err(error) => assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict),
            Ok(_) => panic!("--unchecked must not combine with --via-multisig"),
        }

        let cli = Cli::try_parse_from(args.into_iter().chain(["--via-multisig", "ms"]))
            .expect("--via-multisig alone should parse");
        match cli.command {
            Commands::Token {
                subcommand: TokenCommands::Transfer { unchecked, via, .. },
            } => {
                assert!(!unchecked);
                assert_eq!(via.via_multisig.as_deref(), Some("ms"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_uploader_upload_skip_elf_check_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "uploader",
            "upload",
            "--skip-elf-check",
            "my-seed",
            "program.elf",
        ])
        .expect("uploader upload skip-elf-check should parse");

        match cli.command {
            Commands::Uploader {
                subcommand:
                    UploaderCommands::Upload {
                        seed,
                        program_file,
                        skip_elf_check,
                        ..
                    },
            } => {
                assert_eq!(seed, "my-seed");
                assert_eq!(program_file, "program.elf");
                assert!(skip_elf_check);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_uploader_fee_payer_overrides() {
        let upload = Cli::try_parse_from([
            "thru",
            "uploader",
            "upload",
            "--fee-payer",
            "deployer",
            "my-seed",
            "program.elf",
        ])
        .expect("uploader upload fee payer should parse");

        match upload.command {
            Commands::Uploader {
                subcommand: UploaderCommands::Upload { fee_payer, .. },
            } => assert_eq!(fee_payer.as_deref(), Some("deployer")),
            _ => panic!("unexpected command"),
        }

        let cleanup = Cli::try_parse_from([
            "thru",
            "uploader",
            "cleanup",
            "--fee-payer",
            "deployer",
            "my-seed",
        ])
        .expect("uploader cleanup fee payer should parse");

        match cleanup.command {
            Commands::Uploader {
                subcommand: UploaderCommands::Cleanup { fee_payer, .. },
            } => assert_eq!(fee_payer.as_deref(), Some("deployer")),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_create_skip_elf_check_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "create",
            "--skip-elf-check",
            "my-seed",
            "program.elf",
        ])
        .expect("program create skip-elf-check should parse");

        match cli.command {
            Commands::Program {
                subcommand:
                    ProgramCommands::Create {
                        seed,
                        program_file,
                        skip_elf_check,
                        ..
                    },
            } => {
                assert_eq!(seed, "my-seed");
                assert_eq!(program_file, "program.elf");
                assert!(skip_elf_check);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_create_skip_program_image_validation_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "create",
            "--skip-program-image-validation",
            "my-seed",
            "empty.bin",
        ])
        .expect("program create skip-program-image-validation should parse");

        match cli.command {
            Commands::Program {
                subcommand:
                    ProgramCommands::Create {
                        seed,
                        program_file,
                        skip_program_image_validation,
                        ..
                    },
            } => {
                assert_eq!(seed, "my-seed");
                assert_eq!(program_file, "empty.bin");
                assert!(skip_program_image_validation);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_upgrade_skip_elf_check_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "upgrade",
            "--skip-elf-check",
            "my-seed",
            "program.elf",
        ])
        .expect("program upgrade skip-elf-check should parse");

        match cli.command {
            Commands::Program {
                subcommand:
                    ProgramCommands::Upgrade {
                        seed,
                        program_file,
                        skip_elf_check,
                        ..
                    },
            } => {
                assert_eq!(seed, "my-seed");
                assert_eq!(program_file, "program.elf");
                assert!(skip_elf_check);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_upgrade_skip_program_image_validation_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "upgrade",
            "--skip-program-image-validation",
            "my-seed",
            "empty.bin",
        ])
        .expect("program upgrade skip-program-image-validation should parse");

        match cli.command {
            Commands::Program {
                subcommand:
                    ProgramCommands::Upgrade {
                        seed,
                        program_file,
                        skip_program_image_validation,
                        ..
                    },
            } => {
                assert_eq!(seed, "my-seed");
                assert_eq!(program_file, "empty.bin");
                assert!(skip_program_image_validation);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_create_fee_payer_and_authority() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "create",
            "--fee-payer",
            "deployer",
            "--authority",
            "owner",
            "my-seed",
            "program.bin",
        ])
        .expect("program create key overrides should parse");

        match cli.command {
            Commands::Program {
                subcommand:
                    ProgramCommands::Create {
                        fee_payer,
                        authority,
                        ..
                    },
            } => {
                assert_eq!(fee_payer.as_deref(), Some("deployer"));
                assert_eq!(authority.as_deref(), Some("owner"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_upgrade_fee_payer() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "upgrade",
            "--fee-payer",
            "owner",
            "my-seed",
            "program.bin",
        ])
        .expect("program upgrade fee payer should parse");

        match cli.command {
            Commands::Program {
                subcommand: ProgramCommands::Upgrade { fee_payer, .. },
            } => assert_eq!(fee_payer.as_deref(), Some("owner")),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_create_and_upgrade_abi_flags() {
        let cli = Cli::try_parse_from([
            "thru", "program", "create", "my-seed", "program.bin", "--abi", "my.abi.yaml",
        ])
        .expect("program create --abi should parse");
        match cli.command {
            Commands::Program {
                subcommand: ProgramCommands::Create { abi, .. },
            } => {
                assert_eq!(abi.abi.as_deref(), Some("my.abi.yaml"));
                assert!(!abi.dangerously_exclude_abi);
            }
            _ => panic!("unexpected command"),
        }

        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "upgrade",
            "my-seed",
            "program.bin",
            "--dangerously-exclude-abi",
            "--via-multisig",
            "team",
        ])
        .expect("program upgrade --dangerously-exclude-abi should parse");
        match cli.command {
            Commands::Program {
                subcommand: ProgramCommands::Upgrade { abi, via, .. },
            } => {
                assert_eq!(abi.abi, None);
                assert!(abi.dangerously_exclude_abi);
                assert_eq!(via.via_multisig.as_deref(), Some("team"));
            }
            _ => panic!("unexpected command"),
        }

        // Neither flag parses; the handler reports the missing choice.
        assert!(Cli::try_parse_from(["thru", "program", "upgrade", "s", "p.bin"]).is_ok());
    }

    #[test]
    fn rejects_abi_with_dangerously_exclude_abi() {
        for sub in ["create", "upgrade"] {
            assert!(
                Cli::try_parse_from([
                    "thru",
                    "program",
                    sub,
                    "s",
                    "p.bin",
                    "--abi",
                    "a.yaml",
                    "--dangerously-exclude-abi",
                ])
                .is_err(),
                "{sub} must reject both ABI flags"
            );
        }
    }

    #[test]
    fn parses_program_set_pause_fee_payer() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "set-pause",
            "--fee-payer",
            "owner",
            "my-seed",
            "true",
        ])
        .expect("program set-pause fee payer should parse");

        match cli.command {
            Commands::Program {
                subcommand: ProgramCommands::SetPause { fee_payer, .. },
            } => assert_eq!(fee_payer.as_deref(), Some("owner")),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_program_set_authority_fee_payer() {
        let cli = Cli::try_parse_from([
            "thru",
            "program",
            "set-authority",
            "--fee-payer",
            "owner",
            "my-seed",
            "ta-candidate",
        ])
        .expect("program set-authority fee payer should parse");

        match cli.command {
            Commands::Program {
                subcommand: ProgramCommands::SetAuthority { fee_payer, .. },
            } => assert_eq!(fee_payer.as_deref(), Some("owner")),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_codegen_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "codegen",
            "-f",
            "input.abi.yaml",
            "-l",
            "rust",
        ])
        .expect("codegen command should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Codegen {
                        files,
                        include_dirs,
                        language,
                        output_dir,
                        verbose,
                        go_module,
                    },
            } => {
                assert!(go_module.is_none());
                assert_eq!(files, vec![PathBuf::from("input.abi.yaml")]);
                assert!(include_dirs.is_empty());
                assert_eq!(language, AbiLanguage::Rust);
                assert_eq!(output_dir, PathBuf::from("generated"));
                assert!(!verbose);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_codegen_go_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "codegen",
            "-f",
            "input.abi.yaml",
            "-l",
            "go",
            "--go-module",
            "example.com/me/abi",
        ])
        .expect("go codegen command should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Codegen {
                        language,
                        go_module,
                        ..
                    },
            } => {
                assert_eq!(language, AbiLanguage::Go);
                assert_eq!(go_module.as_deref(), Some("example.com/me/abi"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_account_create_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "account",
            "create",
            "seed-1",
            "program.abi.yaml",
        ])
        .expect("abi account create should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Account {
                        subcommand:
                            AbiAccountCommands::Create {
                                ephemeral,
                                account_type,
                                target_program,
                                seed,
                                fee_payer,
                                authority,
                                publisher,
                                abi_file,
                            },
                    },
            } => {
                assert!(!ephemeral);
                assert_eq!(account_type, AbiAccountType::Program);
                assert_eq!(target_program, None);
                assert_eq!(seed, "seed-1");
                assert_eq!(fee_payer, None);
                assert_eq!(authority, None);
                assert_eq!(publisher, None);
                assert_eq!(abi_file, "program.abi.yaml");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_account_get_include_data_flag() {
        let cli = Cli::try_parse_from(["thru", "abi", "account", "get", "ta123", "--include-data"])
            .expect("abi account get should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Account {
                        subcommand:
                            AbiAccountCommands::Get {
                                abi_account,
                                include_data,
                                out,
                            },
                    },
            } => {
                assert_eq!(abi_account, "ta123");
                assert!(include_data);
                assert_eq!(out, None);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_account_upgrade_third_party_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "account",
            "upgrade",
            "--account-type",
            "third-party",
            "--target-program",
            "ta_target",
            "--publisher",
            "alice",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "program.abi.yaml",
        ])
        .expect("third-party abi account upgrade should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Account {
                        subcommand:
                            AbiAccountCommands::Upgrade {
                                account_type,
                                publisher,
                                authority,
                                target_program,
                                seed,
                                abi_file,
                                ..
                            },
                    },
            } => {
                assert_eq!(account_type, AbiAccountType::ThirdParty);
                assert_eq!(publisher.as_deref(), Some("alice"));
                assert_eq!(authority, None);
                assert_eq!(target_program.as_deref(), Some("ta_target"));
                assert_eq!(
                    seed,
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                );
                assert_eq!(abi_file, "program.abi.yaml");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_account_finalize_standalone_authority_alias() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "account",
            "finalize",
            "--account-type",
            "standalone",
            "--authority",
            "alice",
            "my-abi-seed",
        ])
        .expect("standalone abi account finalize should parse authority alias");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Account {
                        subcommand:
                            AbiAccountCommands::Finalize {
                                account_type,
                                target_program,
                                authority,
                                publisher,
                                seed,
                                ..
                            },
                    },
            } => {
                assert_eq!(account_type, AbiAccountType::Standalone);
                assert_eq!(target_program, None);
                assert_eq!(authority.as_deref(), Some("alice"));
                assert_eq!(publisher, None);
                assert_eq!(seed, "my-abi-seed");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_abi_account_close_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "account",
            "close",
            "--fee-payer",
            "bob",
            "--authority",
            "alice",
            "seed-1",
        ])
        .expect("abi account close should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::Account {
                        subcommand:
                            AbiAccountCommands::Close {
                                account_type,
                                target_program,
                                fee_payer,
                                authority,
                                publisher,
                                seed,
                                ..
                            },
                    },
            } => {
                assert_eq!(account_type, AbiAccountType::Program);
                assert_eq!(target_program, None);
                assert_eq!(fee_payer.as_deref(), Some("bob"));
                assert_eq!(authority.as_deref(), Some("alice"));
                assert_eq!(publisher, None);
                assert_eq!(seed, "seed-1");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn rejects_conflicting_abi_account_actor_flags() {
        let result = Cli::try_parse_from([
            "thru",
            "abi",
            "account",
            "create",
            "--account-type",
            "standalone",
            "--authority",
            "alice",
            "--publisher",
            "bob",
            "my-abi-seed",
            "program.abi.yaml",
        ]);

        assert!(
            result.is_err(),
            "conflicting abi account actor flags should fail"
        );
    }

    #[test]
    fn parses_network_use_command() {
        let cli =
            Cli::try_parse_from(["thru", "network", "use", "1"]).expect("network use should parse");

        match cli.command {
            Commands::Network {
                subcommand: Some(NetworkCommands::Use { name }),
            } => assert_eq!(name, "1"),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_bare_network_command() {
        let cli = Cli::try_parse_from(["thru", "network"]).expect("bare network should parse");

        match cli.command {
            Commands::Network { subcommand: None } => {}
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn rejects_legacy_network_set_default_alias() {
        let cli = Cli::try_parse_from(["thru", "network", "set-default", "1"]);

        assert!(
            cli.is_err(),
            "legacy network set-default alias should no longer parse"
        );
    }

    #[test]
    fn rejects_legacy_network_list_subcommand() {
        let cli = Cli::try_parse_from(["thru", "network", "list"]);

        assert!(
            cli.is_err(),
            "legacy network list subcommand should no longer parse"
        );
    }

    #[test]
    fn parses_network_remove_command() {
        let cli =
            Cli::try_parse_from(["thru", "network", "rm", "1"]).expect("network rm should parse");

        match cli.command {
            Commands::Network {
                subcommand: Some(NetworkCommands::Remove { name }),
            } => assert_eq!(name, "1"),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn rejects_conflicting_abi_reflect_flags() {
        let result = Cli::try_parse_from([
            "thru",
            "abi",
            "reflect",
            "-f",
            "input.abi.yaml",
            "-t",
            "MyType",
            "-d",
            "data.bin",
            "--validate-only",
            "--values-only",
        ]);

        assert!(result.is_err(), "conflicting reflect flags should fail");
    }

    #[test]
    fn abi_reflect_short_v_is_no_longer_values_only() {
        let result = Cli::try_parse_from([
            "thru",
            "abi",
            "reflect",
            "-f",
            "input.abi.yaml",
            "-t",
            "MyType",
            "-d",
            "data.bin",
            "-v",
        ]);

        assert!(
            result.is_err(),
            "short -v should no longer parse for abi reflect"
        );
    }

    #[test]
    fn parses_abi_prep_for_publish_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "abi",
            "prep-for-publish",
            "-f",
            "root.abi.yaml",
            "--target-network",
            "mainnet",
            "-o",
            "publish.abi.yaml",
        ])
        .expect("prep-for-publish command should parse");

        match cli.command {
            Commands::Abi {
                subcommand:
                    AbiCommands::PrepForPublish {
                        file,
                        include_dirs,
                        target_network,
                        output,
                        verbose,
                    },
            } => {
                assert_eq!(file, PathBuf::from("root.abi.yaml"));
                assert!(include_dirs.is_empty());
                assert_eq!(target_network, "mainnet");
                assert_eq!(output, PathBuf::from("publish.abi.yaml"));
                assert!(!verbose);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_txn_debug_inline_trace_flag() {
        let cli = Cli::try_parse_from([
            "thru",
            "txn",
            "debug",
            "ts11111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
            "--inline-trace",
            "--output-trace",
            "trace.log",
            "--state-before",
        ])
        .expect("txn debug command should parse");

        match cli.command {
            Commands::Txn {
                subcommand:
                    TxnCommands::Debug {
                        signature,
                        include_state_before,
                        include_state_after,
                        include_account_data,
                        output_trace,
                        inline_trace,
                        include_memory_dump,
                    },
            } => {
                assert_eq!(
                    signature,
                    "ts11111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
                );
                assert!(include_state_before);
                assert!(!include_state_after);
                assert!(!include_account_data);
                assert_eq!(output_trace.as_deref(), Some("trace.log"));
                assert!(inline_trace);
                assert!(!include_memory_dump);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_txn_debug_legacy_include_flag_aliases() {
        let cli = Cli::try_parse_from([
            "thru",
            "txn",
            "debug",
            "ts11111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
            "--include-state-after",
            "--include-account-data",
            "--include-memory-dump",
        ])
        .expect("legacy txn debug flag aliases should continue to parse");

        match cli.command {
            Commands::Txn {
                subcommand:
                    TxnCommands::Debug {
                        include_state_before,
                        include_state_after,
                        include_account_data,
                        include_memory_dump,
                        ..
                    },
            } => {
                assert!(!include_state_before);
                assert!(include_state_after);
                assert!(include_account_data);
                assert!(include_memory_dump);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_feature_gates_list_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "feature-gates",
            "--registry",
            "custom-registry.toml",
            "list",
            "--kind",
            "chain-param",
        ])
        .expect("feature-gates list should parse");

        match cli.command {
            Commands::FeatureGates {
                registry,
                subcommand: FeatureGatesCommands::List { kind },
            } => {
                assert_eq!(registry.unwrap(), PathBuf::from("custom-registry.toml"));
                assert_eq!(kind, FeatureGateListKind::ChainParam);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_feature_gates_show_command() {
        let cli = Cli::try_parse_from(["thru", "feature-gates", "show", "parallel_exec"])
            .expect("feature-gates show should parse");

        match cli.command {
            Commands::FeatureGates {
                registry,
                subcommand: FeatureGatesCommands::Show { target },
            } => {
                assert_eq!(registry, None);
                assert_eq!(target, "parallel_exec");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_feature_gates_create_entry_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "feature-gates",
            "create-entry",
            "parallel_exec",
            "--value",
            "inactive",
            "--next-change-lead-slots",
            "12",
            "--fee-payer",
            "creation-admin",
        ])
        .expect("feature-gates create-entry should parse");

        match cli.command {
            Commands::FeatureGates {
                subcommand:
                    FeatureGatesCommands::CreateEntry {
                        target,
                        value,
                        next_change_lead_slots,
                        fee_payer,
                        ..
                    },
                ..
            } => {
                assert_eq!(target, "parallel_exec");
                assert_eq!(value, "inactive");
                assert_eq!(next_change_lead_slots, 12);
                assert_eq!(fee_payer.unwrap(), "creation-admin");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_feature_gates_arm_and_disarm_commands() {
        let arm = Cli::try_parse_from([
            "thru",
            "feature-gates",
            "arm",
            "max_compute_units_per_txn",
            "--value",
            "1000",
            "--slot",
            "77",
        ])
        .expect("feature-gates arm should parse");
        match arm.command {
            Commands::FeatureGates {
                subcommand:
                    FeatureGatesCommands::Arm {
                        target,
                        value,
                        slot,
                        fee_payer,
                        ..
                    },
                ..
            } => {
                assert_eq!(target, "max_compute_units_per_txn");
                assert_eq!(value, "1000");
                assert_eq!(slot, 77);
                assert_eq!(fee_payer, None);
            }
            _ => panic!("unexpected command"),
        }

        let disarm = Cli::try_parse_from(["thru", "feature-gates", "disarm", "0"])
            .expect("feature-gates disarm should parse");
        match disarm.command {
            Commands::FeatureGates {
                subcommand: FeatureGatesCommands::Disarm {
                    target, fee_payer, ..
                },
                ..
            } => {
                assert_eq!(target, "0");
                assert_eq!(fee_payer, None);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_feature_gates_admin_and_timing_commands() {
        let timing = Cli::try_parse_from([
            "thru",
            "feature-gates",
            "update-timing-knobs",
            "--min-arming-lead-slots",
            "1",
            "--min-gap-between-armings-slots",
            "2",
            "--min-dwell-slots",
            "3",
            "--no-disarm-window-slots",
            "4",
        ])
        .expect("feature-gates update-timing-knobs should parse");
        match timing.command {
            Commands::FeatureGates {
                subcommand:
                    FeatureGatesCommands::UpdateTimingKnobs {
                        min_arming_lead_slots,
                        min_gap_between_armings_slots,
                        min_dwell_slots,
                        no_disarm_window_slots,
                        ..
                    },
                ..
            } => {
                assert_eq!(min_arming_lead_slots, 1);
                assert_eq!(min_gap_between_armings_slots, 2);
                assert_eq!(min_dwell_slots, 3);
                assert_eq!(no_disarm_window_slots, 4);
            }
            _ => panic!("unexpected command"),
        }

        let propose = Cli::try_parse_from([
            "thru",
            "feature-gates",
            "propose-admin",
            "--role",
            "management",
            "--new-admin",
            &"11".repeat(32),
        ])
        .expect("feature-gates propose-admin should parse");
        match propose.command {
            Commands::FeatureGates {
                subcommand:
                    FeatureGatesCommands::ProposeAdmin {
                        role, new_admin, ..
                    },
                ..
            } => {
                assert_eq!(role, FeatureGateAdminRole::Management);
                assert_eq!(new_admin, "11".repeat(32));
            }
            _ => panic!("unexpected command"),
        }

        let accept =
            Cli::try_parse_from(["thru", "feature-gates", "accept-admin", "--role", "config"])
                .expect("feature-gates accept-admin should parse");
        match accept.command {
            Commands::FeatureGates {
                subcommand: FeatureGatesCommands::AcceptAdmin { role, .. },
                ..
            } => assert_eq!(role, FeatureGateAdminRole::Config),
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_consensus_validator_activate_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "activate",
            "--source-token-account",
            "ta_source",
            "--token-amount",
            "1000",
            "--bls-seed",
            "17",
            "--claim-authority",
            "alice",
            "--fee-payer",
            "bob",
            "--converted-vault",
            "ta_vault",
        ])
        .expect("validator activate should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::Activate {
                        source_token_account,
                        token_amount,
                        bls_seed,
                        claim_authority,
                        fee_payer,
                        converted_vault,
                        ..
                    },
            } => {
                assert_eq!(source_token_account, "ta_source");
                assert_eq!(token_amount, 1000);
                assert_eq!(bls_seed, Some(17));
                assert_eq!(claim_authority.as_deref(), Some("alice"));
                assert_eq!(fee_payer.as_deref(), Some("bob"));
                assert_eq!(converted_vault.as_deref(), Some("ta_vault"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_consensus_validator_convert_tokens_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "convert-tokens",
            "--source-token-account",
            "ta_source",
            "--token-amount",
            "250",
            "--token-program",
            "ta_token",
        ])
        .expect("validator convert-tokens should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::ConvertTokens {
                        source_token_account,
                        token_amount,
                        token_program,
                        ..
                    },
            } => {
                assert_eq!(source_token_account, "ta_source");
                assert_eq!(token_amount, 250);
                assert_eq!(token_program.as_deref(), Some("ta_token"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_consensus_validator_set_claim_authority_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "set-claim-authority",
            "--subject-attestor",
            "alice",
            "--new-claim-authority",
            "bob",
            "--attestor-table",
            "ta_table",
        ])
        .expect("validator set-claim-authority should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::SetClaimAuthority {
                        subject_attestor,
                        new_claim_authority,
                        attestor_table,
                        ..
                    },
            } => {
                assert_eq!(subject_attestor, "alice");
                assert_eq!(new_claim_authority, "bob");
                assert_eq!(attestor_table.as_deref(), Some("ta_table"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_table_command() {
        let cli =
            Cli::try_parse_from(["thru", "validator", "table", "--attestor-table", "ta_table"])
                .expect("validator table should parse");

        match cli.command {
            Commands::Validator {
                subcommand: ValidatorCommands::Table { attestor_table },
            } => {
                assert_eq!(attestor_table.as_deref(), Some("ta_table"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_activate_with_bls_seed() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "activate",
            "--source-token-account",
            "ta_source",
            "--token-amount",
            "1000",
            "--bls-seed",
            "17",
        ])
        .expect("validator activate with bls seed should parse");

        match cli.command {
            Commands::Validator {
                subcommand: ValidatorCommands::Activate { bls_seed, .. },
            } => {
                assert_eq!(bls_seed, Some(17));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_info_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "info",
            "alice",
            "--attestor-table",
            "ta_table",
        ])
        .expect("validator info should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::Info {
                        validator,
                        attestor_table,
                    },
            } => {
                assert_eq!(validator, "alice");
                assert_eq!(attestor_table.as_deref(), Some("ta_table"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_bls_pubkey_command() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "bls-pubkey",
            "--bls-key",
            "/tmp/bls.json",
        ])
        .expect("validator bls-pubkey should parse");

        match cli.command {
            Commands::Validator {
                subcommand: ValidatorCommands::BlsPubkey { bls_key },
            } => {
                assert_eq!(bls_key, "/tmp/bls.json");
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn validator_bls_pubkey_requires_bls_key() {
        let result = Cli::try_parse_from(["thru", "validator", "bls-pubkey"]);
        assert!(result.is_err(), "bls-pubkey without --bls-key must fail");
    }

    #[test]
    fn parses_validator_status_command_with_identity() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "status",
            "--identity",
            "acc_0",
            "--attestor-table",
            "ta_table",
        ])
        .expect("validator status should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::Status {
                        identity,
                        attestor_table,
                    },
            } => {
                assert_eq!(identity.as_deref(), Some("acc_0"));
                assert_eq!(attestor_table.as_deref(), Some("ta_table"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_status_command_without_identity() {
        let cli = Cli::try_parse_from(["thru", "validator", "status"])
            .expect("validator status without identity should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::Status {
                        identity,
                        attestor_table,
                    },
            } => {
                assert_eq!(identity, None);
                assert_eq!(attestor_table, None);
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn parses_validator_activate_with_bls_key() {
        let cli = Cli::try_parse_from([
            "thru",
            "validator",
            "activate",
            "--source-token-account",
            "ta_source",
            "--token-amount",
            "1000",
            "--bls-key",
            "/tmp/bls.json",
        ])
        .expect("validator activate with bls key should parse");

        match cli.command {
            Commands::Validator {
                subcommand:
                    ValidatorCommands::Activate {
                        bls_seed, bls_key, ..
                    },
            } => {
                assert_eq!(bls_seed, None);
                assert_eq!(bls_key.as_deref(), Some("/tmp/bls.json"));
            }
            _ => panic!("unexpected command"),
        }
    }

    #[test]
    fn validator_activate_requires_a_bls_source() {
        // Neither --bls-seed nor --bls-key -> clap rejects.
        let result = Cli::try_parse_from([
            "thru",
            "validator",
            "activate",
            "--source-token-account",
            "ta_source",
            "--token-amount",
            "1000",
        ]);
        assert!(result.is_err(), "activate with no BLS source must fail");
    }

    #[test]
    fn validator_activate_rejects_conflicting_bls_sources() {
        // The two sources must conflict at parse time.
        for pair in [vec!["--bls-key", "/tmp/bls.json", "--bls-seed", "1"]] {
            let mut args = vec![
                "thru",
                "validator",
                "activate",
                "--source-token-account",
                "ta_source",
                "--token-amount",
                "1000",
            ];
            args.extend(pair.iter().copied());
            let result = Cli::try_parse_from(args);
            assert!(
                result.is_err(),
                "conflicting BLS sources {:?} must fail to parse",
                pair
            );
        }
    }

    #[test]
    fn rejects_debug_re_execute_command() {
        let result = Cli::try_parse_from([
            "thru",
            "debug",
            "re-execute",
            "ts11111111111111111111111111111111111111111111111111111111111111111111111111111111111111",
        ]);

        assert!(result.is_err(), "debug re-execute should no longer parse");
    }
}

/// Multisig program commands
#[derive(Subcommand)]
pub enum MultisigCommands {
    /// Create a multisig. The --fee-payer key must be one of the members.
    Create {
        /// Members: comma-separated key names or ta... addresses (2-32)
        #[arg(long, value_delimiter = ',', required = true)]
        members: Vec<String>,

        /// Approvals needed to execute an invoke request (M)
        #[arg(long)]
        threshold: u16,

        /// Seed for the multisig address (any label or 64 hex chars; random if omitted)
        #[arg(long)]
        seed: Option<String>,

        /// Print the address the multisig would get, without creating it
        #[arg(long)]
        dry_run: bool,

        #[command(flatten)]
        common: MultisigCommonArgs,
    },

    /// Show a multisig's members, threshold and state
    Show {
        /// Multisig address
        multisig: String,

        #[command(flatten)]
        common: MultisigCommonArgs,
    },

    /// List a multisig's open requests
    Requests {
        /// Multisig address
        multisig: String,

        /// Also list stale requests (proposed before the last config change)
        #[arg(long)]
        include_stale: bool,

        #[command(flatten)]
        common: MultisigCommonArgs,
    },

    /// Inspect a single request
    Request {
        #[command(subcommand)]
        subcommand: MultisigRequestCommands,
    },

    /// Propose an action. The proposer (--fee-payer) approves it too unless --no-approve.
    Propose {
        #[command(subcommand)]
        subcommand: MultisigProposeCommands,
    },

    /// Approve a request as the --fee-payer member
    Approve {
        /// Request address
        request: String,

        /// Skip the confirmation prompt
        #[arg(long, short = 'y')]
        yes: bool,

        #[command(flatten)]
        common: MultisigCommonArgs,

        /// SHA-256 (hex) of the code a program upgrade installs; required for upgrades
        #[arg(long)]
        expect_code_hash: Option<String>,

        /// SHA-256 (hex) of the ABI a program + ABI upgrade publishes; required for those
        #[arg(long)]
        expect_abi_hash: Option<String>,
    },

    /// Execute a request that has enough approvals (any key can execute)
    Execute {
        /// Request address
        request: String,

        /// Compute units for the execute transaction (default depends on the action)
        #[arg(long)]
        compute_units: Option<u32>,

        /// State units for the execute transaction (default depends on the action)
        #[arg(long)]
        state_units: Option<u16>,

        /// Skip the confirmation prompt
        #[arg(long, short = 'y')]
        yes: bool,

        #[command(flatten)]
        common: MultisigCommonArgs,

        /// SHA-256 (hex) of the code a program upgrade installs; required for upgrades
        #[arg(long)]
        expect_code_hash: Option<String>,

        /// SHA-256 (hex) of the ABI a program + ABI upgrade publishes; required for those
        #[arg(long)]
        expect_abi_hash: Option<String>,
    },

    /// Cancel a request: the proposer before any approvals, or any member once stale
    Cancel {
        /// Request address
        request: String,

        #[command(flatten)]
        common: MultisigCommonArgs,
    },
}

/// Inspect multisig requests
#[derive(Subcommand)]
pub enum MultisigRequestCommands {
    /// Decode and show a request
    Show {
        /// Request address
        request: String,

        #[command(flatten)]
        common: MultisigCommonArgs,
    },
}

/// Propose a multisig request
#[derive(Subcommand)]
pub enum MultisigProposeCommands {
    /// Call another program as the multisig.
    /// Run with --show-layout first to see the account indices to encode in --data.
    Invoke {
        /// Multisig address
        multisig: String,

        /// Program to call
        #[arg(long)]
        target: String,

        /// Instruction data (hex), encoded against the indices --show-layout prints
        #[arg(long, required_unless_present = "show_layout", requires = "request_seed")]
        data: Option<String>,

        /// Request seed printed by --show-layout; pins the request account so the
        /// account indices encoded in --data can't shift
        #[arg(long)]
        request_seed: Option<String>,

        /// Writable accounts the call uses (repeatable or comma-separated)
        #[arg(long, value_delimiter = ',')]
        rw: Vec<String>,

        /// Read-only accounts the call uses (repeatable or comma-separated)
        #[arg(long, value_delimiter = ',')]
        ro: Vec<String>,

        /// Print the transaction account indices and exit
        #[arg(long)]
        show_layout: bool,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Change the threshold M (needs a majority of all members)
    SetThreshold {
        /// Multisig address
        multisig: String,

        /// New threshold
        threshold: u16,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Replace the member list (needs a majority of all members)
    SetMembers {
        /// Multisig address
        multisig: String,

        /// The full new member list: key names or ta... addresses
        #[arg(long, value_delimiter = ',', required = true)]
        members: Vec<String>,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Add members (needs a majority of all members)
    AddMembers {
        /// Multisig address
        multisig: String,

        /// Members to add: key names or ta... addresses
        #[arg(long, value_delimiter = ',', required = true)]
        members: Vec<String>,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Remove members (needs a majority of all members; the threshold drops if it
    /// would exceed the new member count)
    RemoveMembers {
        /// Multisig address
        multisig: String,

        /// Members to remove: key names or ta... addresses
        #[arg(long, value_delimiter = ',', required = true)]
        members: Vec<String>,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Swap members, e.g. a lost key (needs a majority of all members)
    ReplaceMembers {
        /// Multisig address
        multisig: String,

        /// Current members to replace, in order
        #[arg(long, value_delimiter = ',', required = true)]
        old: Vec<String>,

        /// Their replacements, in the same order
        #[arg(long, value_delimiter = ',', required = true)]
        new: Vec<String>,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },

    /// Delete the multisig (needs a majority; must be the last live request)
    DeleteMultisig {
        /// Multisig address
        multisig: String,

        #[command(flatten)]
        propose: MultisigProposeArgs,
    },
}

/// Options shared by every multisig command
#[derive(clap::Args, Debug, Clone, Default)]
pub struct MultisigCommonArgs {
    /// Key that signs and pays; for propose/approve/cancel, the acting member (defaults to 'default')
    #[arg(long, visible_alias = "signer")]
    pub fee_payer: Option<String>,

    /// Multisig program address (defaults to multisig_program_public_key in config)
    #[arg(long)]
    pub program: Option<String>,
}

/// Options shared by propose commands
#[derive(clap::Args, Debug, Clone, Default)]
pub struct MultisigProposeArgs {
    /// Don't approve as the proposer
    #[arg(long)]
    pub no_approve: bool,

    #[command(flatten)]
    pub common: MultisigCommonArgs,
}

/// `--abi` / `--dangerously-exclude-abi` for program create and upgrade.
/// Exactly one is required; the handler reports a missing choice.
#[derive(clap::Args, Debug, Clone, Default)]
pub struct ProgramAbiArgs {
    /// Official ABI file to publish with the program in the same transaction
    #[arg(long = "abi", value_name = "ABI_FILE", conflicts_with = "dangerously_exclude_abi")]
    pub abi: Option<String>,

    /// Deploy the program without its ABI (the on-chain ABI may stop matching
    /// the program)
    #[arg(long = "dangerously-exclude-abi")]
    pub dangerously_exclude_abi: bool,
}

/// `--via-multisig` options for admin commands
#[derive(clap::Args, Debug, Clone, Default)]
pub struct ViaMultisigArgs {
    /// Propose this action from a multisig instead of signing it directly.
    /// --fee-payer is then the proposing member.
    #[arg(long = "via-multisig", value_name = "MULTISIG")]
    pub via_multisig: Option<String>,

    /// With --via-multisig: multisig program address override
    #[arg(long = "multisig-program", requires = "via_multisig")]
    pub multisig_program: Option<String>,

    /// With --via-multisig: don't approve as the proposer
    #[arg(long = "no-approve", requires = "via_multisig")]
    pub no_approve: bool,
}
