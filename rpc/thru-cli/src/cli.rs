//! CLI argument parsing and command definitions

use clap::{Parser, Subcommand};

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
#[command(name = "thru-cli")]
#[command(about = "Command-line interface for the Thru blockchain")]
#[command(version = thru_base::get_version!())]
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

    #[command(subcommand)]
    pub command: Commands,
}

/// Available CLI commands
#[derive(Subcommand)]
pub enum Commands {
    /// Get version information from the Thru node
    #[command(name = "getversion")]
    GetVersion,

    /// Get health status of the Thru node
    #[command(name = "gethealth")]
    GetHealth,

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

    /// Get slot metrics (state counters, collected fees)
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
        /// Source key name from configuration
        src: String,

        /// Destination (key name from config or public address in taXX format)
        dst: String,

        /// Amount to transfer
        value: u64,
    },

    /// Program upload and management commands
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
        subcommand: NetworkCommands,
    },
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

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// Program file to upload and create managed program from
        program_file: String,

        /// Chunk size for upload (1024-31000 bytes, default: 30720)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,
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

        /// Program file to upload and upgrade managed program with
        program_file: String,

        /// Chunk size for upload (1024-31000 bytes, default: 30720)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,
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

        /// Fee payer account name from config (optional, defaults to 'default')
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

        /// Fee payer account name from config (optional, defaults to 'default')
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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
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
    /// Create an official ABI account for a managed program
    Create {
        /// Program type (ephemeral matches the managed program)
        #[arg(long)]
        ephemeral: bool,

        /// Seed for the managed program meta account
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Create a third-party ABI account for a target program
    CreateThirdParty {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Target program account public key (Thru address)
        target_program: String,

        /// 32-byte hex seed for the third-party ABI meta
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Create a standalone ABI account (not associated with any program)
    CreateStandalone {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Seed string used to derive the standalone ABI meta seed
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Upgrade an existing official ABI account
    Upgrade {
        /// Program type (ephemeral matches the managed program)
        #[arg(long)]
        ephemeral: bool,

        /// Seed for the managed program meta account
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Upgrade an existing third-party ABI account
    UpgradeThirdParty {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Target program account public key (Thru address)
        target_program: String,

        /// 32-byte hex seed for the third-party ABI meta
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Upgrade an existing standalone ABI account
    UpgradeStandalone {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Seed string used to derive the standalone ABI meta seed
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,

        /// ABI definition file to upload
        abi_file: String,
    },

    /// Finalize an official ABI account so it becomes immutable
    Finalize {
        /// Program type (ephemeral matches the managed program)
        #[arg(long)]
        ephemeral: bool,

        /// Seed for the managed program meta account
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Finalize a third-party ABI account so it becomes immutable
    FinalizeThirdParty {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Target program account public key (Thru address)
        target_program: String,

        /// 32-byte hex seed for the third-party ABI meta
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Finalize a standalone ABI account so it becomes immutable
    FinalizeStandalone {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Seed string used to derive the standalone ABI meta seed
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Close an official ABI account and reclaim its lamports
    Close {
        /// Program type (ephemeral matches the managed program)
        #[arg(long)]
        ephemeral: bool,

        /// Seed for the managed program meta account
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Close a third-party ABI account and reclaim its lamports
    CloseThirdParty {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Target program account public key (Thru address)
        target_program: String,

        /// 32-byte hex seed for the third-party ABI meta
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Close a standalone ABI account and reclaim its lamports
    CloseStandalone {
        /// Program type (ephemeral flag for ABI accounts)
        #[arg(long)]
        ephemeral: bool,

        /// Seed string used to derive the standalone ABI meta seed
        seed: String,

        /// Fee payer account (optional, defaults to config default)
        #[arg(long = "fee-payer")]
        fee_payer: Option<String>,

        /// Authority account name from config (optional, defaults to 'default')
        #[arg(long)]
        authority: Option<String>,
    },

    /// Inspect an ABI account's metadata and optionally dump its YAML contents
    Get {
        /// ABI account public key (Thru address)
        abi_account: String,

        /// Whether to include ABI YAML contents in the CLI output (Y/N, defaults to N)
        #[arg(long = "data", default_value = "N")]
        data: String,

        /// Optional file path to write the ABI YAML contents
        #[arg(long = "out")]
        out: Option<String>,
    },
}

/// Uploader-related subcommands
#[derive(Subcommand)]
pub enum UploaderCommands {
    /// Upload a program to the blockchain
    Upload {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

        /// Chunk size for upload transactions (1024-31000 bytes)
        #[arg(long, value_parser = parse_chunk_size, default_value = "30720")]
        chunk_size: usize,

        /// Seed for account derivation
        seed: String,

        /// Path to the program binary file
        program_file: String,
    },

    /// Clean up program accounts
    Cleanup {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

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

/// Key management subcommands
#[derive(Subcommand)]
pub enum KeysCommands {
    /// List all key names
    List,

    /// Add a new key
    Add {
        /// Overwrite existing key
        #[arg(long)]
        overwrite: bool,

        /// Key name (case-insensitive)
        name: String,

        /// Private key (64 hex characters)
        key: String,
    },

    /// Get a key value
    Get {
        /// Key name to retrieve
        name: String,
    },

    /// Generate a new random key
    Generate {
        /// Key name for the new key
        name: String,
    },

    /// Remove a key
    #[command(name = "rm")]
    Remove {
        /// Key name to remove
        name: String,
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

    /// Set the default network profile
    #[command(name = "set-default")]
    SetDefault {
        /// Network profile name to use as default
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

    /// List all configured network profiles
    List,

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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Transaction fee (optional, defaults to 1)
        #[arg(long, default_value = "1")]
        fee: u64,

        /// Compute units (optional, defaults to 1000000000)
        #[arg(long, default_value = "1000000000")]
        compute_units: u32,

        /// State units (optional, defaults to 10000)
        #[arg(long, default_value = "10000")]
        state_units: u16,

        /// Memory units (optional, defaults to 10000)
        #[arg(long, default_value = "10000")]
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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Transaction fee (optional, defaults to 1)
        #[arg(long, default_value = "1")]
        fee: u64,

        /// Compute units (optional, defaults to 1000000000)
        #[arg(long, default_value = "300000000")]
        compute_units: u32,

        /// State units (optional, defaults to 10000)
        #[arg(long, default_value = "10000")]
        state_units: u16,

        /// Memory units (optional, defaults to 10000)
        #[arg(long, default_value = "10000")]
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
        /// Key name from configuration (optional, defaults to 'default')
        key_name: Option<String>,
    },

    /// Get account information (alias to getaccountinfo)
    Info {
        /// Key name from configuration (optional, defaults to 'default')
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
        /// Fee payer account (key name from config or ta... address, optional - defaults to 'default')
        fee_payer: Option<String>,
    },

    /// Decompress an account
    Decompress {
        /// Target account to decompress (key name from config or ta... address)
        target_account: String,
        /// Fee payer account (key name from config or ta... address, optional - defaults to 'default')
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
        /// Creator address (must be authorized to create)
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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
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

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Mint new tokens to an account
    MintTo {
        /// Mint account address
        mint: String,

        /// Destination token account address
        to: String,

        /// Mint authority address
        authority: String,

        /// Amount to mint
        amount: u64,

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Burn tokens from an account
    Burn {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Account authority address
        authority: String,

        /// Amount to burn
        amount: u64,

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Close a token account
    CloseAccount {
        /// Token account address
        account: String,

        /// Destination for remaining balance
        destination: String,

        /// Account authority address
        authority: String,

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Freeze a token account
    FreezeAccount {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Freeze authority address
        authority: String,

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Unfreeze a token account
    ThawAccount {
        /// Token account address
        account: String,

        /// Mint account address
        mint: String,

        /// Freeze authority address
        authority: String,

        /// Fee payer account (optional, defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
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

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },

    /// Derive mint account address from creator and seed
    DeriveMintAccount {
        /// Creator address
        creator: String,

        /// Seed for derivation (32 bytes hex)
        seed: String,

        /// Override token program address (ta... or hex)
        #[arg(long = "token-program")]
        token_program: Option<String>,
    },
}

/// Faucet program subcommands
#[derive(Subcommand)]
pub enum FaucetCommands {
    /// Deposit tokens into the faucet
    Deposit {
        /// Account identifier (key name or ta.../hex pubkey) to use as depositor (must match fee payer)
        account: String,

        /// Amount to deposit
        amount: u64,

        /// Fee payer account name (defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
    },

    /// Withdraw tokens from the faucet
    Withdraw {
        /// Account identifier (key name or ta.../hex pubkey) to use as recipient
        account: String,

        /// Amount to withdraw (max 10000 per transaction)
        amount: u64,

        /// Fee payer account name (defaults to 'default')
        #[arg(long)]
        fee_payer: Option<String>,
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

        /// Fee payer account (optional, defaults to 'default')
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

        /// Fee payer account (optional, defaults to 'default')
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

        /// Fee payer account (optional, defaults to 'default')
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

        /// Fee payer account (optional, defaults to 'default')
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

        /// Fee payer account (defaults to 'default')
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

        /// Fee payer account (defaults to 'default')
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

        /// Fee payer account (defaults to 'default')
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

        /// Fee payer account (defaults to 'default')
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

        /// Fee payer account (defaults to 'default')
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
        /// Fee payer account name (defaults to 'default')
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
    Deposit {
        /// Destination WTHRU token account address
        dest_token_account: String,

        /// Amount of native THRU to wrap (lamports)
        amount: u64,

        /// Fee payer account name (defaults to 'default')
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

        /// Fee payer/owner account name (defaults to 'default')
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
