//! CLI argument parsing and command definitions

use clap::{Parser, Subcommand};

/// Thru CLI - Command-line interface for the Thru blockchain
#[derive(Parser)]
#[command(name = "thru-cli")]
#[command(about = "Command-line interface for the Thru blockchain")]
#[command(version = env!("CARGO_PKG_VERSION"))]
pub struct Cli {
    /// Output results in JSON format
    #[arg(long, global = true)]
    pub json: bool,

    /// Suppress non-essential output (disables version check notifications)
    #[arg(long, global = true)]
    pub quiet: bool,

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

    /// Developer tools for toolchain and project management
    #[command(name = "dev")]
    Dev {
        #[command(subcommand)]
        subcommand: DevCommands,
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
}

/// Uploader-related subcommands
#[derive(Subcommand)]
pub enum UploaderCommands {
    /// Upload a program to the blockchain
    Upload {
        /// Custom uploader program public key (optional)
        #[arg(long)]
        uploader: Option<String>,

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
        /// Mint authority address
        mint_authority: String,

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

    /// Derive mint account address from mint authority and seed
    DeriveMintAccount {
        /// Mint authority address
        mint_authority: String,

        /// Seed for derivation (32 bytes hex)
        seed: String,

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
