//! Token program command implementation

use anyhow::Result;

/// 0 fee for now
const TOKEN_PROGRAM_FEE: u64 = 0;

use crate::cli::TokenCommands;
use crate::commands::state_proof::make_state_proof;
use crate::config::Config;
use crate::error::CliError;
use crate::keys::LoadedKey;
use crate::utils::{format_vm_error, parse_seed_bytes, validate_address_or_hex};
use abi_gen::abi::resolved::TypeResolver;
use abi_loader::AbiFile;
use abi_reflect::{ReflectedValue, Reflector, Value};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use thru_base::crypto_utils::derive_program_address;
use thru_base::rpc_types::ProofType;
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_tools::Pubkey;
use thru_base::txn_tools::{TOKEN_TICKER_MAX_LEN, TransactionBuilder};
use thru_client::{Client, ClientBuilder, TransactionDetails, VersionContext};

/// Resolve an on-chain actor that must have authorized the transaction.
/// Thru transactions currently carry only the fee payer signature, so the
/// supplied actor must be the fee payer's public key.
fn resolve_authorized_actor(
    config: &Config,
    actor: &str,
    label: &str,
    fee_payer_keypair: &LoadedKey,
) -> Result<[u8; 32], CliError> {
    let actor_pubkey = config.keys.resolve_public_key(actor)?;
    if actor_pubkey != fee_payer_keypair.public_key {
        let fee_payer_address = &fee_payer_keypair.address_string;
        return Err(CliError::Validation(format!(
            "{label} '{actor}' must match the fee payer ({fee_payer_address}), as only the fee payer signature is included"
        )));
    }
    Ok(actor_pubkey)
}

/// Resolve the token program pubkey, optionally overriding with command-line input.
fn resolve_token_program(
    config: &Config,
    token_program: Option<&str>,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    if let Some(program_str) = token_program {
        let bytes = validate_address_or_hex(program_str)?;
        let pubkey = Pubkey::from_bytes(&bytes);
        Ok((pubkey, bytes))
    } else {
        let pubkey = config.get_token_program_pubkey()?;
        let bytes = pubkey.to_bytes().map_err(|e| {
            CliError::Crypto(format!("Failed to convert token program pubkey: {}", e))
        })?;
        Ok((pubkey, bytes))
    }
}

/// Where a resolved token program address came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenProgramSource {
    /// `--token-program` was passed.
    Flag,
    /// Owner of the mint or token account the command names.
    OnChain,
    /// Config `token_program_public_key`.
    Config,
}

/// Pick the token program for a command that names an existing mint or token
/// account. An explicit `--token-program` wins; otherwise the account's
/// on-chain owner is the program that manages it; config is the last resort.
fn choose_token_program(
    flag_program: Option<[u8; 32]>,
    onchain_owner: Option<[u8; 32]>,
    config_program: [u8; 32],
) -> ([u8; 32], TokenProgramSource) {
    if let Some(bytes) = flag_program {
        (bytes, TokenProgramSource::Flag)
    } else if let Some(bytes) = onchain_owner {
        (bytes, TokenProgramSource::OnChain)
    } else {
        (config_program, TokenProgramSource::Config)
    }
}

/// Resolve the token program for a command that names an existing mint or
/// token account (`account`, described by `label`). Without `--token-program`
/// the account's owner is read from chain, so mints under any token program
/// deployment work without configuration. A failed lookup falls back to the
/// configured program and says so on stderr.
async fn resolve_token_program_for_account(
    config: &Config,
    client: &Client,
    token_program: Option<&str>,
    account: &[u8; 32],
    label: &str,
    json_format: bool,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    if token_program.is_some() {
        return resolve_token_program(config, token_program);
    }

    let (_config_pubkey, config_bytes) = resolve_token_program(config, None)?;
    let account_address = tn_pubkey_to_address_string(account);

    let lookup = client
        .get_account_info(
            &Pubkey::from_bytes(account),
            None,
            Some(VersionContext::Current),
        )
        .await;

    let (onchain_owner, fallback_reason) = match lookup {
        Ok(Some(info)) if !info.is_deleted => match info.owner.to_bytes() {
            // An EOA or unowned account is not a mint or token account.
            Ok(owner) if owner == thru_base::txn_tools::EOA_PROGRAM || owner == [0u8; 32] => (
                None,
                Some("it is a plain account, not owned by a token program".to_string()),
            ),
            Ok(owner) => (Some(owner), None),
            Err(e) => (None, Some(format!("its owner could not be decoded: {}", e))),
        },
        Ok(_) => (None, Some("it was not found on chain".to_string())),
        Err(e) => (None, Some(format!("the lookup failed: {}", e))),
    };

    let (bytes, source) = choose_token_program(None, onchain_owner, config_bytes);

    if !json_format {
        match source {
            TokenProgramSource::OnChain if bytes != config_bytes => {
                println!(
                    "  Token program: {} (owner of {} {})",
                    tn_pubkey_to_address_string(&bytes),
                    label,
                    account_address
                );
            }
            TokenProgramSource::Config => {
                eprintln!(
                    "Note: using configured token program {} because {} {} could not be used ({}). Pass --token-program to choose one.",
                    tn_pubkey_to_address_string(&bytes),
                    label,
                    account_address,
                    fallback_reason.unwrap_or_default()
                );
            }
            _ => {}
        }
    }

    Ok((Pubkey::from_bytes(&bytes), bytes))
}

fn derive_mint_account_pubkey(
    token_program_pubkey: &Pubkey,
    creator_pubkey: &[u8; 32],
    seed_bytes: &[u8; 32],
) -> Result<Pubkey, CliError> {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(creator_pubkey);
    hasher.update(seed_bytes);

    let hash = hasher.finalize();
    let mut derived_seed = [0u8; 32];
    derived_seed.copy_from_slice(&hash[..32]);

    thru_base::crypto_utils::derive_program_address(&derived_seed, token_program_pubkey, false)
        .map_err(|e| CliError::Crypto(format!("Failed to derive mint address: {}", e)))
}

/// Helper function to check transaction execution results and return appropriate errors.
///
/// In JSON mode the failure object printed here is the command's whole error
/// output, so the returned error tells the entry point not to print another.
/// The object carries the `type` and `message` the entry point would print
/// for the same error, next to the execution details.
pub(crate) fn check_transaction_result(
    transaction_details: &TransactionDetails,
    json_format: bool,
) -> Result<(), CliError> {
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let signed_execution_result = transaction_details.execution_result as i64;
        let signed_user_error = transaction_details.user_error_code as i64;

        let vm_error_label = format_vm_error(transaction_details.vm_error);
        let vm_error_msg = if transaction_details.vm_error != 0 {
            format!(" (VM error: {})", vm_error_label)
        } else {
            String::new()
        };

        let user_error_msg = if signed_user_error != 0 {
            format!(" (TokenError: {})", signed_user_error)
        } else {
            String::new()
        };

        let error_msg = format!(
            "Transaction failed with execution result: {}{}{}",
            signed_execution_result, vm_error_msg, user_error_msg
        );

        if json_format {
            let error_response = serde_json::json!({
                "error": {
                    "type": "transaction_submission",
                    "message": error_msg,
                    "execution_result": signed_execution_result,
                    "vm_error": transaction_details.vm_error,
                    "vm_error_name": vm_error_label,
                    "user_error_code": signed_user_error,
                    "signature": transaction_details.signature.as_str()
                }
            });
            crate::output::print_output(error_response, true);
            return Err(CliError::Reported);
        }

        return Err(CliError::TransactionSubmission(error_msg));
    }
    Ok(())
}

/// The JSON report of a token command that failed without a transaction
/// result. `operation` is the command's key in its JSON output. `error` is
/// the error this report stands in for: `error_type` is the `type` the entry
/// point would have printed for it, so the single report keeps the
/// classification.
fn token_failure_json(operation: &str, error_msg: &str, error: &CliError) -> serde_json::Value {
    let error_type = crate::format_error_json(error)["error"]["type"].clone();
    serde_json::json!({
        operation: {
            "status": "failed",
            "error": error_msg,
            "error_type": error_type
        }
    })
}

/// Report a token command that was refused before anything was signed or
/// sent. In JSON mode the failure object printed here is the command's
/// whole error output, so the returned error tells the entry point not to
/// print another. In text mode the entry point prints the returned error.
fn refuse_token_operation(operation: &str, error_msg: &str, json_format: bool) -> CliError {
    let error = CliError::Validation(error_msg.to_string());
    if json_format {
        crate::output::print_output(token_failure_json(operation, error_msg, &error), true);
        CliError::Reported
    } else {
        error
    }
}

/// Helper function to handle AccountNotFound errors with JSON output. In
/// JSON mode the command's failure object replaces the error; every other
/// error, and text mode, pass through.
fn handle_account_not_found_error(error: CliError, operation: &str, json_format: bool) -> CliError {
    match &error {
        CliError::AccountNotFound(msg) if json_format => {
            crate::output::print_output(token_failure_json(operation, msg, &error), true);
            CliError::Reported
        }
        _ => error,
    }
}

/// Create RPC client from configuration
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    let client = ClientBuilder::new()
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.rpc_auth_token())
        .announce_pending_signature(config.announce_pending_signature)
        .build()?;

    Ok(client)
}

/// Common transaction execution context
struct TransactionContext {
    pub fee_payer_keypair: Arc<LoadedKey>,
    pub token_program_bytes: [u8; 32],
    pub client: Client,
    pub nonce: u64,
    pub start_slot: u64,
    pub chain_id: u16,
    pub timeout_seconds: u64,
}

/// Setup common transaction context after all local inputs have been resolved.
async fn setup_transaction_context(
    config: &Config,
    client: Client,
    fee_payer_keypair: Arc<LoadedKey>,
    token_program_bytes: [u8; 32],
) -> Result<TransactionContext, CliError> {
    let chain = fee_payer_chain_state(&client, &fee_payer_keypair.address_string).await?;
    Ok(TransactionContext {
        fee_payer_keypair,
        token_program_bytes,
        client,
        nonce: chain.nonce,
        start_slot: chain.start_slot,
        chain_id: chain.chain_id,
        timeout_seconds: config.timeout_seconds,
    })
}

/// The fee payer's nonce and the chain's start slot and chain id.
struct ChainState {
    nonce: u64,
    start_slot: u64,
    chain_id: u16,
}

async fn fee_payer_chain_state(
    client: &Client,
    fee_payer: &Pubkey,
) -> Result<ChainState, CliError> {
    let account_info = client
        .get_account_info(fee_payer, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    Ok(ChainState {
        nonce,
        start_slot: block_height.locally_executed_height,
        chain_id: chain_info.chain_id,
    })
}

/// Execute a transaction (sign, submit, check result)
async fn execute_transaction(
    mut transaction: thru_base::txn_lib::Transaction,
    context: &TransactionContext,
    json_format: bool,
) -> Result<TransactionDetails, CliError> {
    // Set chain ID and sign transaction
    transaction = transaction.with_chain_id(context.chain_id);
    crate::signing::sign_transaction(&mut transaction, &context.fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    submit_transaction(
        &context.client,
        &transaction.to_wire(),
        context.timeout_seconds,
        json_format,
    )
    .await
}

/// Submit a signed transaction and check its result.
async fn submit_transaction(
    client: &Client,
    wire: &[u8],
    timeout_seconds: u64,
    json_format: bool,
) -> Result<TransactionDetails, CliError> {
    let transaction_details = client
        .execute_transaction(wire, Duration::from_secs(timeout_seconds))
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    Ok(transaction_details)
}

/// Handle token program commands
pub async fn handle_token_command(
    config: &Config,
    subcommand: TokenCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        TokenCommands::InitializeMint {
            creator,
            mint_authority,
            freeze_authority,
            decimals,
            ticker,
            seed,
            state_proof,
            fee_payer,
            token_program,
        } => {
            initialize_mint(
                config,
                &creator,
                mint_authority.as_deref(),
                freeze_authority.as_deref(),
                decimals,
                &ticker,
                &seed,
                state_proof.as_deref(),
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::InitializeAccount {
            mint,
            owner,
            seed,
            state_proof,
            fee_payer,
            token_program,
        } => {
            initialize_account(
                config,
                &mint,
                &owner,
                &seed,
                state_proof.as_deref(),
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::Transfer {
            from,
            to,
            amount,
            fee_payer,
            token_program,
            unchecked,
            via,
        } => {
            // A multisig proposal carries the plain Transfer: the proposal
            // builder and decoder know only that instruction. `--unchecked`
            // cannot be combined with `--via-multisig`, so `unchecked` is
            // false here. The note goes to text output only: callers of the
            // JSON output may read stderr together with stdout.
            if via.via_multisig.is_some() {
                if !json_format {
                    eprintln!(
                        "Note: a --via-multisig proposal carries the plain Transfer instruction, not TransferChecked."
                    );
                }
                return crate::commands::multisig::via::token_transfer(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &from,
                    &to,
                    amount,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            transfer(
                config,
                &from,
                &to,
                amount,
                fee_payer.as_deref(),
                token_program.as_deref(),
                unchecked,
                json_format,
            )
            .await
        }
        TokenCommands::MintTo {
            mint,
            to,
            authority,
            amount,
            fee_payer,
            token_program,
            via,
        } => {
            if via.via_multisig.is_some() {
                return crate::commands::multisig::via::token_mint_to(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &mint,
                    &to,
                    &authority,
                    amount,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            mint_to(
                config,
                &mint,
                &to,
                &authority,
                amount,
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::Burn {
            account,
            mint,
            authority,
            amount,
            fee_payer,
            token_program,
            via,
        } => {
            if via.via_multisig.is_some() {
                return crate::commands::multisig::via::token_burn(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &account,
                    &mint,
                    &authority,
                    amount,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            burn(
                config,
                &account,
                &mint,
                &authority,
                amount,
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::CloseAccount {
            account,
            destination,
            authority,
            fee_payer,
            token_program,
            via,
        } => {
            if via.via_multisig.is_some() {
                return crate::commands::multisig::via::token_close_account(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &account,
                    &destination,
                    &authority,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            close_account(
                config,
                &account,
                &destination,
                &authority,
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::FreezeAccount {
            account,
            mint,
            authority,
            fee_payer,
            token_program,
            via,
        } => {
            if via.via_multisig.is_some() {
                return crate::commands::multisig::via::token_freeze_thaw(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &account,
                    &mint,
                    &authority,
                    true,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            freeze_account(
                config,
                &account,
                &mint,
                &authority,
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::ThawAccount {
            account,
            mint,
            authority,
            fee_payer,
            token_program,
            via,
        } => {
            if via.via_multisig.is_some() {
                return crate::commands::multisig::via::token_freeze_thaw(
                    config,
                    &via,
                    fee_payer.as_deref(),
                    &account,
                    &mint,
                    &authority,
                    false,
                    token_program.as_deref(),
                    json_format,
                )
                .await;
            }
            thaw_account(
                config,
                &account,
                &mint,
                &authority,
                fee_payer.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::DeriveTokenAccount {
            mint,
            owner,
            seed,
            token_program,
        } => {
            derive_token_account(
                config,
                &mint,
                &owner,
                seed.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::DeriveMintAccount {
            creator,
            seed,
            token_program,
        } => {
            derive_mint_account(
                config,
                &creator,
                &seed,
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        TokenCommands::Balance {
            token_account,
            token_program,
        } => {
            token_balance(
                config,
                &token_account,
                token_program.as_deref(),
                json_format,
            )
            .await
        }
    }
}

/// Initialize a new token mint
async fn initialize_mint(
    config: &Config,
    creator: &str,
    mint_authority: Option<&str>,
    freeze_authority: Option<&str>,
    decimals: u8,
    ticker: &str,
    seed: &str,
    state_proof: Option<&str>,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if ticker.len() > 8 {
        let error_msg = "Ticker symbol must be 8 characters or less";
        if json_format {
            let error_response = serde_json::json!({
                "token_initialize_mint": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if seed.len() != 64 {
        let error_msg = "Seed must be 32 bytes (64 hex characters)";
        if json_format {
            let error_response = serde_json::json!({
                "token_initialize_mint": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    // Default mint_authority to creator if not provided
    let mint_authority_str = mint_authority.unwrap_or(creator);

    if !json_format {
        println!("Initialize mint:");
        println!("  Creator: {}", creator);
        println!("  Mint Authority: {}", mint_authority_str);
        if let Some(freeze_auth) = freeze_authority {
            println!("  Freeze Authority: {}", freeze_auth);
        }
        println!("  Decimals: {}", decimals);
        println!("  Ticker: {}", ticker);
        println!("  Seed: {}", seed);
    }

    // Parse seed
    let seed_bytes = parse_seed_bytes(seed)?;

    // Resolve the token program and the only transaction signer first so the
    // creator authorization can be validated before deriving or submitting.
    let (token_program_pubkey, token_program_bytes) = resolve_token_program(config, token_program)?;
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;

    // The creator is an authorized actor and must therefore be the fee payer.
    let creator_pubkey = resolve_authorized_actor(config, creator, "Creator", &fee_payer_keypair)?;
    let mint_authority_pubkey = config.keys.resolve_public_key(mint_authority_str)?;
    let freeze_authority_pubkey = match freeze_authority {
        Some(addr) => Some(config.keys.resolve_public_key(addr)?),
        None => None,
    };

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Derive mint account address using the creator and seed
    let mint_account_base_pubkey =
        derive_mint_account_pubkey(&token_program_pubkey, &creator_pubkey, &seed_bytes)?;

    let mint_account_pubkey = mint_account_base_pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert mint pubkey to bytes: {}", e)))?;

    // Use provided state proof or auto-generate it
    let state_proof_bytes = if let Some(proof_hex) = state_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?
    } else {
        make_state_proof(
            &client,
            &mint_account_base_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    // Build transaction using TransactionBuilder

    let mut transaction = TransactionBuilder::build_token_initialize_mint(
        fee_payer_keypair.public_key,
        token_program_bytes,
        mint_account_pubkey,
        creator_pubkey,
        mint_authority_pubkey,
        freeze_authority_pubkey,
        decimals,
        ticker,
        seed_bytes,
        state_proof_bytes,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    // Convert mint account address to string for output
    let mint_account_address =
        thru_base::tn_public_address::tn_pubkey_to_address_string(&mint_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "token_initialize_mint": {
                "status": "success",
                "mint_account": mint_account_address,
                "ticker": ticker,
                "decimals": decimals,
                "creator": creator,
                "mint_authority": mint_authority_str,
                "freeze_authority": freeze_authority,
                "seed": seed,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Mint initialized successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Mint account: {}", mint_account_address);
    }

    Ok(())
}

/// Initialize a new token account
async fn initialize_account(
    config: &Config,
    mint: &str,
    owner: &str,
    seed: &str,
    state_proof: Option<&str>,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if seed.len() != 64 {
        let error_msg = "Seed must be 32 bytes (64 hex characters)";
        if json_format {
            let error_response = serde_json::json!({
                "token_initialize_account": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Initialize token account:");
        println!("  Mint: {}", mint);
        println!("  Owner: {}", owner);
        println!("  Seed: {}", seed);
    }

    // Parse seed from hex
    let seed_bytes = parse_seed_bytes(seed)?;

    // Resolve mint and owner addresses
    let mint_pubkey = validate_address_or_hex(mint)?;
    let owner_pubkey = validate_address_or_hex(owner)?;

    // Resolve fee payer
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // The mint's owner is the token program that manages it
    let (token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &mint_pubkey,
        "mint",
        json_format,
    )
    .await?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Derive token account address using SHA256(owner + mint + seed) then PDA derivation=
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(&owner_pubkey); // owner_pubkey.0
    hasher.update(&mint_pubkey); // mint_pubkey.0
    hasher.update(&seed_bytes); // new_account_seed

    let token_seed_hash = hasher.finalize();
    let mut token_seed = [0u8; 32];
    token_seed.copy_from_slice(&token_seed_hash);

    let token_account_base_pubkey = derive_program_address(
        &token_seed,
        &token_program_pubkey,
        false, // token accounts are not ephemeral
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive token account address: {}", e)))?;

    let token_account = token_account_base_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert token account pubkey to bytes: {}",
            e
        ))
    })?;

    // Use provided state proof or auto-generate it
    let state_proof_bytes = if let Some(proof_hex) = state_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?
    } else {
        make_state_proof(
            &client,
            &token_account_base_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_initialize_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        token_account,
        mint_pubkey,
        owner_pubkey,
        seed_bytes,
        state_proof_bytes,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    let token_account_address = tn_pubkey_to_address_string(&token_account);

    if json_format {
        let response = serde_json::json!({
            "token_initialize_account": {
                "status": "success",
                "token_account": token_account_address,
                "mint": mint,
                "owner": owner,
                "seed": seed,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Token account initialized successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Token account address: {}", token_account_address);
    }

    Ok(())
}

/// What `TransferChecked` carries beyond the two token accounts and the
/// amount: the mint of the source account and the decimals and ticker stored
/// in that mint.
#[derive(Debug, PartialEq, Eq)]
struct CheckedTransferInputs {
    mint: [u8; 32],
    decimals: u8,
    /// The stored ticker: the first `ticker_len` bytes of the mint's ticker
    /// field.
    ticker: Vec<u8>,
}

impl CheckedTransferInputs {
    /// The ticker for display, escaped like a byte string literal: printable
    /// ASCII as it is, a backslash before `\`, `'` and `"`, every other byte
    /// escaped (`\x1b`, `\n`, `\xff`). The bytes come from the chain, so
    /// they must not reach the terminal as control sequences, and two
    /// different tickers must not look the same. The instruction carries the
    /// raw bytes.
    fn ticker_text(&self) -> String {
        self.ticker.escape_ascii().to_string()
    }
}

/// Appended to a refusal that a plain `Transfer` avoids: `Transfer` does not
/// read the mint account.
const UNCHECKED_HINT: &str =
    "Pass --unchecked to send a plain Transfer, which does not check the mint";

/// Owner and data of an account that exists on chain.
#[derive(Debug)]
struct FetchedAccount {
    owner: [u8; 32],
    data: Vec<u8>,
}

/// Read an account's owner and data at the current version. `None` when the
/// account does not exist.
async fn fetch_account(
    client: &Client,
    account: &[u8; 32],
) -> Result<Option<FetchedAccount>, CliError> {
    let info = client
        .get_account_info(
            &Pubkey::from_bytes(account),
            None,
            Some(VersionContext::Current),
        )
        .await?;
    let Some(info) = info.filter(|info| !info.is_deleted) else {
        return Ok(None);
    };

    let address = tn_pubkey_to_address_string(account);
    let owner = info.owner.to_bytes().map_err(|e| {
        CliError::Rpc(format!(
            "account {address}: the owner could not be decoded: {e}"
        ))
    })?;
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        info.data.unwrap_or_default(),
    )
    .map_err(|e| {
        CliError::Rpc(format!(
            "account {address}: the data could not be decoded: {e}"
        ))
    })?;
    Ok(Some(FetchedAccount { owner, data }))
}

/// The account, if it exists and `token_program` owns it. The token program
/// rejects every other account with `AccountNotOwnedByProgram`.
fn owned_by_token_program<'a>(
    account: Option<&'a FetchedAccount>,
    token_program: &[u8; 32],
) -> Result<&'a FetchedAccount, String> {
    let account = account.ok_or_else(|| "the account was not found on chain".to_string())?;
    if &account.owner != token_program {
        return Err(format!(
            "the account is owned by {}, not by the token program {}",
            tn_pubkey_to_address_string(&account.owner),
            tn_pubkey_to_address_string(token_program)
        ));
    }
    Ok(account)
}

/// Mint of the source token account. Tokens can only move out of an open
/// token account that `token_program` owns.
fn source_account_mint(
    source: Option<&FetchedAccount>,
    token_program: &[u8; 32],
) -> Result<[u8; 32], String> {
    let source = owned_by_token_program(source, token_program)?;
    let decoded = decode_token_account_blob(&source.data)?;
    if decoded.is_closed {
        return Err("the account is closed".to_string());
    }
    Ok(decoded.mint)
}

/// The `TransferChecked` inputs for `mint`, from the mint account. The token
/// program rejects a mint it does not own, and it can only match a ticker
/// field in canonical form.
fn checked_transfer_inputs(
    mint: [u8; 32],
    mint_account: Option<&FetchedAccount>,
    token_program: &[u8; 32],
) -> Result<CheckedTransferInputs, String> {
    let mint_account = owned_by_token_program(mint_account, token_program)?;
    let decoded = decode_mint_account_blob(&mint_account.data)?;
    let ticker = decoded.canonical_ticker().ok_or_else(|| {
        format!(
            "the stored ticker cannot be matched by TransferChecked (length {}, bytes 0x{})",
            decoded.ticker_len,
            hex::encode(decoded.ticker_bytes)
        )
    })?;
    Ok(CheckedTransferInputs {
        mint,
        decimals: decoded.decimals,
        ticker: ticker.to_vec(),
    })
}

/// Refusal for a source account that no transfer can move tokens out of.
/// A plain `Transfer` fails on it too, so the message does not suggest one.
fn source_refusal_message(source: &[u8; 32], why: &str) -> String {
    format!(
        "Cannot build TransferChecked: source token account {}: {}",
        tn_pubkey_to_address_string(source),
        why
    )
}

/// Refusal for a mint that `TransferChecked` cannot name. A plain `Transfer`
/// does not read the mint, so the message says how to send one.
fn mint_refusal_message(mint: &[u8; 32], why: &str) -> String {
    format!(
        "Cannot build TransferChecked: mint {}: {}. {}",
        tn_pubkey_to_address_string(mint),
        why,
        UNCHECKED_HINT
    )
}

/// Read what `TransferChecked` needs for a transfer out of `source`: the
/// source token account gives the mint, the mint account gives the decimals
/// and the ticker. A transfer that cannot be built is reported here, before
/// anything is signed; a failed read is returned as the RPC error it is.
///
/// The values are those of the current version. The token program has no
/// instruction that changes a mint's decimals or ticker after
/// `InitializeMint`; if they did differ at execution, the program would
/// reject the transfer.
async fn read_checked_transfer_inputs(
    client: &Client,
    source: &[u8; 32],
    token_program: &[u8; 32],
    json_format: bool,
) -> Result<CheckedTransferInputs, CliError> {
    let source_account = fetch_account(client, source).await?;
    let mint = source_account_mint(source_account.as_ref(), token_program)
        .map_err(|why| refuse_token_transfer(&source_refusal_message(source, &why), json_format))?;

    let mint_account = fetch_account(client, &mint).await?;
    checked_transfer_inputs(mint, mint_account.as_ref(), token_program)
        .map_err(|why| refuse_token_transfer(&mint_refusal_message(&mint, &why), json_format))
}

/// Report a transfer that was refused before anything was signed or sent.
fn refuse_token_transfer(error_msg: &str, json_format: bool) -> CliError {
    refuse_token_operation("token_transfer", error_msg, json_format)
}

/// Transfer tokens between accounts.
///
/// Sends `TransferChecked` unless `unchecked` is set: the instruction names
/// the mint of the source account and carries the decimals and ticker stored
/// in that mint, and the token program reverts unless they match. With
/// `unchecked` it sends the plain `Transfer`, which names only the two token
/// accounts.
#[allow(clippy::too_many_arguments)]
async fn transfer(
    config: &Config,
    from: &str,
    to: &str,
    amount: u64,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    unchecked: bool,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        return Err(refuse_token_transfer(
            "Transfer amount must be greater than 0",
            json_format,
        ));
    }

    if !json_format {
        println!("Transfer tokens:");
        println!("  From: {}", from);
        println!("  To: {}", to);
        println!("  Amount: {}", amount);
    }

    // Resolve token account addresses
    let from_pubkey = validate_address_or_hex(from)?;
    let to_pubkey = validate_address_or_hex(to)?;

    // Resolve the signer before making RPC requests; for a Ledger key this
    // connects to the device.
    let signer = crate::signing::resolve_signer(config, fee_payer.unwrap_or("default"))?;

    // The source token account's owner is the token program that manages it
    let client = create_rpc_client(config)?;
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &from_pubkey,
        "token account",
        json_format,
    )
    .await?;

    // TransferChecked names the mint and carries its decimals and ticker
    let checked = if unchecked {
        None
    } else {
        let inputs =
            read_checked_transfer_inputs(&client, &from_pubkey, &token_program_bytes, json_format)
                .await?;
        if !json_format {
            println!(
                "  Mint: {} (ticker {}, {} decimals)",
                tn_pubkey_to_address_string(&inputs.mint),
                inputs.ticker_text(),
                inputs.decimals
            );
        }
        Some(inputs)
    };

    let chain = fee_payer_chain_state(&client, &signer.address)
        .await
        .map_err(|e| handle_account_not_found_error(e, "token_transfer", json_format))?;

    // Build transaction using TransactionBuilder
    // For transfers, the fee payer acts as the authority (source account owner)
    let mut transaction = match &checked {
        Some(inputs) => TransactionBuilder::build_token_transfer_checked(
            signer.public_key,
            token_program_bytes,
            from_pubkey,
            to_pubkey,
            inputs.mint,
            amount,
            inputs.decimals,
            &inputs.ticker,
            TOKEN_PROGRAM_FEE,
            chain.nonce,
            chain.start_slot,
        ),
        None => TransactionBuilder::build_token_transfer(
            signer.public_key,
            token_program_bytes,
            from_pubkey,
            to_pubkey,
            signer.public_key, // Use fee payer as authority
            amount,
            TOKEN_PROGRAM_FEE,
            chain.nonce,
            chain.start_slot,
        ),
    }
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?
    .with_chain_id(chain.chain_id);

    // A Ledger shows the mint and the account owners when it gets a hint.
    let token_hint = if signer.is_ledger() {
        ledger_token_hint(&client, &transaction, &to_pubkey, json_format).await
    } else {
        None
    };
    let wire = crate::signing::sign_transaction_for_with_token_hint(
        &mut transaction,
        &signer,
        token_hint.as_ref(),
        |e| CliError::Crypto(format!("Failed to sign transaction: {e}")),
    )?;

    let transaction_details =
        submit_transaction(&client, &wire, config.timeout_seconds, json_format).await?;

    if json_format {
        let mut token_transfer = serde_json::json!({
            "status": "success",
            "from": from,
            "to": to,
            "amount": amount,
            "instruction": if checked.is_some() { "transfer_checked" } else { "transfer" },
            "signature": transaction_details.signature.as_str(),
            "slot": transaction_details.slot,
            "compute_units_consumed": transaction_details.compute_units_consumed
        });
        if let Some(inputs) = &checked {
            token_transfer["mint"] = serde_json::json!(tn_pubkey_to_address_string(&inputs.mint));
            token_transfer["decimals"] = serde_json::json!(inputs.decimals);
            token_transfer["ticker"] = serde_json::json!(inputs.ticker_text());
        }
        let response = serde_json::json!({ "token_transfer": token_transfer });
        let response = signer.add_ledger_preview(response, "token_transfer");
        crate::output::print_output(response, true);
    } else {
        println!("Transfer completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Transferred {} tokens from {} to {}", amount, from, to);
    }

    Ok(())
}

/// The token hint for a Ledger-signed transfer (APDU spec §7.2.1): the mint
/// and owner of the destination token account, read from chain, with the
/// default account seeds.  `None` when the account cannot be read or the hint
/// does not prove both accounts (for example a non-default seed); the Ledger
/// then shows the token accounts, which is still a correct review.
async fn ledger_token_hint(
    client: &Client,
    transaction: &thru_base::txn_lib::Transaction,
    destination: &[u8; 32],
    json_format: bool,
) -> Option<thru_ledger::TokenHint> {
    let note = |why: &str| {
        if !json_format {
            eprintln!("Note: the Ledger will show the token accounts, not their owners ({why}).");
        }
    };
    let account = match client
        .get_account_info(
            &Pubkey::from_bytes(destination),
            None,
            Some(VersionContext::Current),
        )
        .await
    {
        Ok(Some(account)) => account,
        _ => {
            note("the destination token account could not be read");
            return None;
        }
    };
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        account.data.unwrap_or_default(),
    )
    .unwrap_or_default();
    match destination_token_hint(&transaction.to_wire_for_signing(), &data) {
        Ok(hint) => Some(hint),
        Err(why) => {
            note(why);
            None
        }
    }
}

/// The hint for `body` built from the destination token account's data: its
/// mint and owner, default seeds.  Accepted only if it proves both accounts.
fn destination_token_hint(
    body: &[u8],
    destination_data: &[u8],
) -> Result<thru_ledger::TokenHint, &'static str> {
    let decoded = decode_token_account_blob(destination_data)
        .ok()
        .filter(|t| !t.is_closed)
        .ok_or("the destination is not an open token account")?;
    let hint = thru_ledger::TokenHint::new(decoded.mint, decoded.owner);
    thru_ledger::verify_token_hint(body, &hint)
        .map(|_| hint)
        .map_err(|_| "the token accounts are not the default accounts of their owners")
}

/// Mint new tokens to an account
async fn mint_to(
    config: &Config,
    mint: &str,
    to: &str,
    authority: &str,
    amount: u64,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        return Err(refuse_token_operation(
            "token_mint_to",
            "Mint amount must be greater than 0",
            json_format,
        ));
    }

    if !json_format {
        println!("Mint tokens:");
        println!("  Mint: {}", mint);
        println!("  To: {}", to);
        println!("  Authority: {}", authority);
        println!("  Amount: {}", amount);
    }

    // Resolve mint and destination addresses.
    let mint_pubkey = validate_address_or_hex(mint)?;
    let to_pubkey = validate_address_or_hex(to)?;

    // Resolve and validate every local transaction input before making RPC requests.
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
    let authority_pubkey =
        resolve_authorized_actor(config, authority, "Mint authority", &fee_payer_keypair)?;
    // The mint's owner is the token program that manages it
    let client = create_rpc_client(config)?;
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &mint_pubkey,
        "mint",
        json_format,
    )
    .await?;

    // Setup transaction context
    let context = setup_transaction_context(config, client, fee_payer_keypair, token_program_bytes)
        .await
        .map_err(|e| handle_account_not_found_error(e, "token_mint_to", json_format))?;

    // Build transaction using TransactionBuilder
    let transaction = TransactionBuilder::build_token_mint_to(
        context.fee_payer_keypair.public_key,
        context.token_program_bytes,
        mint_pubkey,
        to_pubkey,
        authority_pubkey,
        amount,
        TOKEN_PROGRAM_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Execute transaction
    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "token_mint_to": {
                "status": "success",
                "to": to,
                "amount": amount,
                "mint": mint,
                "authority": authority,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Mint to completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Minted {} tokens to {}", amount, to);
    }

    Ok(())
}

/// Burn tokens from an account
async fn burn(
    config: &Config,
    account: &str,
    mint: &str,
    authority: &str,
    amount: u64,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        return Err(refuse_token_operation(
            "token_burn",
            "Burn amount must be greater than 0",
            json_format,
        ));
    }

    if !json_format {
        println!("Burn tokens:");
        println!("  Account: {}", account);
        println!("  Mint: {}", mint);
        println!("  Authority: {}", authority);
        println!("  Amount: {}", amount);
    }

    // Resolve addresses
    let account_pubkey = validate_address_or_hex(account)?;
    let mint_pubkey = validate_address_or_hex(mint)?;

    // Resolve configuration
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
    let authority_pubkey =
        resolve_authorized_actor(config, authority, "Burn authority", &fee_payer_keypair)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // The mint's owner is the token program that manages it
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &mint_pubkey,
        "mint",
        json_format,
    )
    .await?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_burn(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        mint_pubkey,
        authority_pubkey,
        amount,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    if json_format {
        let response = serde_json::json!({
            "token_burn": {
                "status": "success",
                "account": account,
                "amount": amount,
                "mint": mint,
                "authority": authority,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Burn completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Burned {} tokens from {}", amount, account);
    }

    Ok(())
}

/// Close a token account
async fn close_account(
    config: &Config,
    account: &str,
    destination: &str,
    authority: &str,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!("Close token account:");
        println!("  Account: {}", account);
        println!("  Destination: {}", destination);
        println!("  Authority: {}", authority);
    }

    // Resolve addresses
    let account_pubkey = validate_address_or_hex(account)?;
    let destination_pubkey = validate_address_or_hex(destination)?;

    // Resolve configuration
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
    let authority_pubkey =
        resolve_authorized_actor(config, authority, "Close authority", &fee_payer_keypair)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // The token account's owner is the token program that manages it
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &account_pubkey,
        "token account",
        json_format,
    )
    .await?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_close_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        destination_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    if json_format {
        let response = serde_json::json!({
            "token_close_account": {
                "status": "success",
                "account": account,
                "destination": destination,
                "authority": authority,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Close account completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Freeze a token account
async fn freeze_account(
    config: &Config,
    account: &str,
    mint: &str,
    authority: &str,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!("Freeze token account:");
        println!("  Account: {}", account);
        println!("  Mint: {}", mint);
        println!("  Authority: {}", authority);
    }

    // Resolve addresses
    let account_pubkey = validate_address_or_hex(account)?;
    let mint_pubkey = validate_address_or_hex(mint)?;

    // Resolve configuration
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
    let authority_pubkey =
        resolve_authorized_actor(config, authority, "Freeze authority", &fee_payer_keypair)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // The mint's owner is the token program that manages it
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &mint_pubkey,
        "mint",
        json_format,
    )
    .await?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_freeze_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        mint_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    if json_format {
        let response = serde_json::json!({
            "token_freeze_account": {
                "status": "success",
                "account": account,
                "mint": mint,
                "authority": authority,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Freeze account completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Unfreeze a token account
async fn thaw_account(
    config: &Config,
    account: &str,
    mint: &str,
    authority: &str,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!("Unfreeze token account:");
        println!("  Account: {}", account);
        println!("  Mint: {}", mint);
        println!("  Authority: {}", authority);
    }

    // Resolve addresses
    let account_pubkey = validate_address_or_hex(account)?;
    let mint_pubkey = validate_address_or_hex(mint)?;

    // Resolve configuration
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
    let authority_pubkey =
        resolve_authorized_actor(config, authority, "Thaw authority", &fee_payer_keypair)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // The mint's owner is the token program that manages it
    let (_token_program_pubkey, token_program_bytes) = resolve_token_program_for_account(
        config,
        &client,
        token_program,
        &mint_pubkey,
        "mint",
        json_format,
    )
    .await?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_thaw_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        mint_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.locally_executed_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Set chain ID and sign transaction
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    if json_format {
        let response = serde_json::json!({
            "token_thaw_account": {
                "status": "success",
                "account": account,
                "mint": mint,
                "authority": authority,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Thaw account completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Embedded ABI for the Thru token program. The byte layout of token-program
/// accounts is derived from this at runtime via reflection rather than being
/// hardcoded here, so the ABI is the single source of truth for the wire
/// format. Keep this vendored copy inside `thru-core` so crates.io package
/// verification can build the crate without the surrounding monorepo.
static TOKEN_ABI_YAML: &str = include_str!("../../abi/tn_token_program.abi.yaml");

/// Account-root type in the token ABI: `account_type` (byte 0) then a
/// `payload` enum keyed on it, with the variants `mint_v1` and
/// `token_account_v1`.
const TOKEN_PROGRAM_ACCOUNT_TYPE: &str = "TokenProgramAccount";
const TOKEN_ACCOUNT_VARIANT: &str = "token_account_v1";
const TOKEN_MINT_VARIANT: &str = "mint_v1";

/// Lazily-built, process-wide reflector over the embedded token ABI.
fn token_reflector() -> Result<&'static Reflector, String> {
    static REFLECTOR: OnceLock<Result<Reflector, String>> = OnceLock::new();
    REFLECTOR
        .get_or_init(|| {
            let abi: AbiFile = serde_yml::from_str(TOKEN_ABI_YAML)
                .map_err(|e| format!("Failed to parse embedded token ABI: {}", e))?;
            let mut resolver = TypeResolver::new();
            for typedef in &abi.types {
                resolver.add_typedef(typedef.clone());
            }
            resolver
                .resolve_all()
                .map_err(|e| format!("Failed to resolve token ABI types: {:?}", e))?;
            Reflector::new(resolver).map_err(|e| format!("Failed to build token reflector: {}", e))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DecodedTokenAccount {
    pub(crate) mint: [u8; 32],
    pub(crate) owner: [u8; 32],
    pub(crate) amount: u64,
    pub(crate) is_frozen: bool,
    /// `close_account` zeroes the whole account in place, including the
    /// `account_type` byte (programs/rust/examples/token_program/process.rs),
    /// so a closed account no longer decodes; an all-zero account is reported
    /// as closed instead.
    pub(crate) is_closed: bool,
}

/// Strip TypeRef / union wrappers to reach the underlying value.
fn unwrap_reflected(v: &ReflectedValue) -> &ReflectedValue {
    match &v.value {
        Value::TypeRef { value, .. } => unwrap_reflected(value),
        /* Every union variant views the same bytes; the first is the one
         * this reader expects. */
        Value::Union { variants } => variants
            .first()
            .map_or(v, |(_, variant)| unwrap_reflected(variant)),
        Value::SizeDiscriminatedUnion { variant_value, .. } => unwrap_reflected(variant_value),
        Value::Enum { variant_value, .. } => unwrap_reflected(variant_value),
        _ => v,
    }
}

/// Read a primitive (possibly behind a TypeRef) as u64.
fn reflected_u64(v: &ReflectedValue) -> Option<u64> {
    match &v.value {
        Value::Primitive(p) => p.to_u64(),
        Value::TypeRef { value, .. } => reflected_u64(value),
        _ => None,
    }
}

/// Read a primitive (possibly behind a TypeRef) as u8.
fn reflected_u8(v: &ReflectedValue) -> Option<u8> {
    u8::try_from(reflected_u64(v)?).ok()
}

/// Read an array of exactly `N` bytes.
fn reflected_byte_array<const N: usize>(v: &ReflectedValue) -> Option<[u8; N]> {
    let elements = match &v.value {
        Value::Array { elements } => elements,
        _ => return None,
    };
    if elements.len() != N {
        return None;
    }
    let mut out = [0u8; N];
    for (i, e) in elements.iter().enumerate() {
        out[i] = reflected_u8(e)?;
    }
    Some(out)
}

/// A `Pubkey` reflects as a struct with a single 32-byte `bytes` array.
fn reflected_pubkey(v: &ReflectedValue) -> Option<[u8; 32]> {
    let s = unwrap_reflected(v);
    reflected_byte_array(s.get_struct_field("bytes")?)
}

/// Owner of a token account (decoded with the token ABI).
pub(crate) fn token_account_owner(data: &[u8]) -> Result<[u8; 32], String> {
    decode_token_account_blob(data).map(|t| t.owner)
}

/// Reflect account data against the account root. The `account_type` byte
/// selects the layout purely from the ABI; no hardcoded length or field
/// offsets live here.
fn reflect_token_program_account(data: &[u8]) -> Result<ReflectedValue, String> {
    token_reflector()?
        .reflect(data, TOKEN_PROGRAM_ACCOUNT_TYPE)
        .map_err(|e| e.to_string())
}

/// Variant name and body of a reflected account root. The token program
/// loads its accounts at their exact size, so the data must be exactly the
/// `account_type` byte plus the selected payload.
fn token_program_account_variant(
    reflected: &ReflectedValue,
    data_len: usize,
) -> Result<(&str, &ReflectedValue), String> {
    let payload = reflected
        .get_struct_field("payload")
        .ok_or_else(|| "token ABI: missing 'payload' field".to_string())?;

    let Value::Enum {
        variant_name,
        variant_value,
        ..
    } = &payload.value
    else {
        return Err("token ABI: 'payload' is not an enum".to_string());
    };
    let payload_size = variant_value
        .type_info
        .size
        .ok_or_else(|| format!("token ABI: '{variant_name}' has no fixed size"))?;
    let expected = 1 + usize::try_from(payload_size)
        .map_err(|_| format!("token ABI: '{variant_name}' size does not fit"))?;
    if data_len != expected {
        return Err(format!(
            "{variant_name} account data is {data_len} bytes (expected {expected})"
        ));
    }
    Ok((variant_name.as_str(), variant_value.as_ref()))
}

/// The fields of a mint account that `TransferChecked` must reproduce.
#[derive(Debug, PartialEq, Eq)]
struct DecodedMintAccount {
    decimals: u8,
    /// The stored ticker field: its length byte and all eight bytes.
    /// `initialize_mint` stores both as given
    /// (programs/rust/examples/token_program/process.rs:59-60), so the length
    /// can exceed eight and the bytes after it can be non-zero.
    ticker_len: u8,
    ticker_bytes: [u8; TOKEN_TICKER_MAX_LEN],
}

impl DecodedMintAccount {
    /// The stored ticker, if the field is canonical: at most
    /// `TOKEN_TICKER_MAX_LEN` bytes, followed only by zero bytes.
    /// `TransferChecked` rejects any other expected ticker, so it can never
    /// match a mint that stores one.
    fn canonical_ticker(&self) -> Option<&[u8]> {
        let (ticker, padding) = self
            .ticker_bytes
            .split_at_checked(usize::from(self.ticker_len))?;
        padding.iter().all(|b| *b == 0).then_some(ticker)
    }
}

fn decode_mint_account_blob(data: &[u8]) -> Result<DecodedMintAccount, String> {
    let reflected = reflect_token_program_account(data)
        .map_err(|e| format!("Failed to decode mint account: {e}"))?;
    let (variant, body) = token_program_account_variant(&reflected, data.len())?;

    if variant != TOKEN_MINT_VARIANT {
        return Err(format!(
            "account is not a mint account (ABI variant: {variant})"
        ));
    }

    let mint = unwrap_reflected(body);
    let decimals = mint
        .get_struct_field("decimals")
        .and_then(reflected_u8)
        .ok_or_else(|| "token ABI: missing/invalid 'decimals'".to_string())?;
    let ticker = mint
        .get_struct_field("ticker")
        .map(unwrap_reflected)
        .ok_or_else(|| "token ABI: missing 'ticker'".to_string())?;
    let ticker_len = ticker
        .get_struct_field("length")
        .and_then(reflected_u8)
        .ok_or_else(|| "token ABI: missing/invalid ticker 'length'".to_string())?;
    let ticker_bytes = ticker
        .get_struct_field("bytes")
        .and_then(reflected_byte_array)
        .ok_or_else(|| "token ABI: missing/invalid ticker 'bytes'".to_string())?;

    Ok(DecodedMintAccount {
        decimals,
        ticker_len,
        ticker_bytes,
    })
}

/// Decode a token account through the token ABI's account root.
pub(crate) fn decode_token_account_blob(data: &[u8]) -> Result<DecodedTokenAccount, String> {
    /* close_account zeroes the whole account; the invalid account_type 0
     * never decodes, so recognise the closed state before reflecting. */
    if !data.is_empty() && data.iter().all(|b| *b == 0) {
        return Ok(DecodedTokenAccount {
            mint: [0u8; 32],
            owner: [0u8; 32],
            amount: 0,
            is_frozen: false,
            is_closed: true,
        });
    }
    let reflected = reflect_token_program_account(data)
        .map_err(|e| format!("Failed to decode token account: {e}"))?;
    let (variant, body) = token_program_account_variant(&reflected, data.len())?;

    if variant != TOKEN_ACCOUNT_VARIANT {
        return Err(format!(
            "account is not a token account (ABI variant: {})",
            variant
        ));
    }

    let token = unwrap_reflected(body);
    let mint = token
        .get_struct_field("mint")
        .and_then(reflected_pubkey)
        .ok_or_else(|| "token ABI: missing/invalid 'mint'".to_string())?;
    let owner = token
        .get_struct_field("owner")
        .and_then(reflected_pubkey)
        .ok_or_else(|| "token ABI: missing/invalid 'owner'".to_string())?;
    let amount = token
        .get_struct_field("amount")
        .and_then(reflected_u64)
        .ok_or_else(|| "token ABI: missing/invalid 'amount'".to_string())?;
    let is_frozen = token
        .get_struct_field("is_frozen")
        .and_then(reflected_u64)
        .ok_or_else(|| "token ABI: missing/invalid 'is_frozen'".to_string())?
        != 0;

    Ok(DecodedTokenAccount {
        mint,
        owner,
        amount,
        is_frozen,
        is_closed: false,
    })
}

fn emit_token_balance_failure(addr: &str, msg: &str, json_format: bool) -> CliError {
    if json_format {
        let resp = serde_json::json!({
            "token_balance": {
                "status": "failed",
                "token_account": addr,
                "error": msg,
            }
        });
        crate::output::print_output(resp, true);
    } else {
        crate::output::print_error(msg);
    }
    CliError::Reported
}

fn emit_token_balance_not_found(addr: &str, json_format: bool) -> CliError {
    if json_format {
        let resp = serde_json::json!({
            "token_balance": {
                "status": "not_found",
                "token_account": addr,
                "error": "Account not found",
            }
        });
        crate::output::print_output(resp, true);
    } else {
        crate::output::print_error(&format!("Account not found: {}", addr));
    }
    CliError::Reported
}

/// Query a token account and emit its decoded balance + metadata.
async fn token_balance(
    config: &Config,
    token_account: &str,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let token_account_bytes = validate_address_or_hex(token_account)?;
    let token_account_pubkey = Pubkey::from_bytes(&token_account_bytes);
    let token_account_address = tn_pubkey_to_address_string(&token_account_bytes);

    let expected_program_bytes = if token_program.is_some() {
        Some(resolve_token_program(config, token_program)?.1)
    } else {
        None
    };

    let client = create_rpc_client(config)?;

    let account = client
        .get_account_info(&token_account_pubkey, None, Some(VersionContext::Current))
        .await
        .map_err(|e| {
            emit_token_balance_failure(
                &token_account_address,
                &format!("Failed to get account info: {}", e),
                json_format,
            )
        })?;

    let Some(account) = account else {
        return Err(emit_token_balance_not_found(
            &token_account_address,
            json_format,
        ));
    };

    let data_b64 = account.data.unwrap_or_default();
    let data_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &data_b64)
        .map_err(|e| {
            emit_token_balance_failure(
                &token_account_address,
                &format!("Failed to decode account data: {}", e),
                json_format,
            )
        })?;

    let decoded = decode_token_account_blob(&data_bytes)
        .map_err(|msg| emit_token_balance_failure(&token_account_address, &msg, json_format))?;

    let owning_program_bytes = account.owner.to_bytes().map_err(|e| {
        emit_token_balance_failure(
            &token_account_address,
            &format!("Failed to decode account owner pubkey: {}", e),
            json_format,
        )
    })?;

    if let Some(expected) = expected_program_bytes {
        if expected != owning_program_bytes {
            return Err(emit_token_balance_failure(
                &token_account_address,
                &format!(
                    "Token account is owned by {}, not the expected token program {}",
                    tn_pubkey_to_address_string(&owning_program_bytes),
                    tn_pubkey_to_address_string(&expected),
                ),
                json_format,
            ));
        }
    }

    let mint_address = tn_pubkey_to_address_string(&decoded.mint);
    let owner_address = tn_pubkey_to_address_string(&decoded.owner);
    let owning_program_address = tn_pubkey_to_address_string(&owning_program_bytes);

    let status = if decoded.is_closed {
        "closed"
    } else {
        "success"
    };

    if json_format {
        let resp = serde_json::json!({
            "token_balance": {
                "status": status,
                "token_account": token_account_address,
                "mint": mint_address,
                "owner": owner_address,
                "amount": decoded.amount,
                "is_frozen": decoded.is_frozen,
                "owning_program": owning_program_address,
            }
        });
        crate::output::print_output(resp, true);
    } else if decoded.is_closed {
        println!(
            "Token account: {} (closed - body zeroed)",
            token_account_address
        );
        println!("  Program: {}", owning_program_address);
    } else {
        println!("Token account: {}", token_account_address);
        println!("  Mint:    {}", mint_address);
        println!("  Owner:   {}", owner_address);
        println!("  Amount:  {}", decoded.amount);
        println!("  Frozen:  {}", decoded.is_frozen);
        println!("  Program: {}", owning_program_address);
    }

    Ok(())
}

/// Derive token account address from mint, owner, and seed
async fn derive_token_account(
    config: &Config,
    mint: &str,
    owner: &str,
    seed: Option<&str>,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Parse mint and owner addresses
    let mint_pubkey = validate_address_or_hex(mint)?;
    let owner_pubkey = validate_address_or_hex(owner)?;

    // Parse seed (defaults to all zeros if not provided)
    let seed_bytes = if let Some(seed_str) = seed {
        parse_seed_bytes(seed_str)?
    } else {
        [0u8; 32] // Default to all zeros
    };

    if !json_format {
        println!("Derive token account:");
        println!("  Mint: {}", mint);
        println!("  Owner: {}", owner);
        println!("  Seed: {}", hex::encode(&seed_bytes));
    }

    // Implement SHA256(owner_pubkey + mint_pubkey + new_account_seed) derivation
    // followed by PDA derivation with token program as owner
    // This matches the token program logic from process.rs
    use sha2::{Digest, Sha256};

    // SHA256 concatenation to get the token seed (matches lines 78-85 in process.rs)
    let mut hasher = Sha256::new();
    hasher.update(&owner_pubkey); // owner_pubkey.0
    hasher.update(&mint_pubkey); // mint_pubkey.0
    hasher.update(&seed_bytes); // new_account_seed

    let token_seed_hash = hasher.finalize();
    let mut token_seed = [0u8; 32];
    token_seed.copy_from_slice(&token_seed_hash);

    // Use the token_seed for PDA derivation with token program as owner
    // This matches account_create() call in process.rs line 87-92
    // The mint's owner is the token program that manages it
    let (token_program_pubkey, token_program_bytes) = if token_program.is_some() {
        resolve_token_program(config, token_program)?
    } else {
        let client = create_rpc_client(config)?;
        resolve_token_program_for_account(config, &client, None, &mint_pubkey, "mint", json_format)
            .await?
    };

    // Derive the final token account address using the token_seed
    let token_account_base_pubkey = thru_base::crypto_utils::derive_program_address(
        &token_seed,
        &token_program_pubkey,
        false, // token accounts are not ephemeral
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive token account address: {}", e)))?;

    let token_account_pubkey = token_account_base_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert token account pubkey to bytes: {}",
            e
        ))
    })?;

    // Convert to thru address format
    let token_account_address =
        thru_base::tn_public_address::tn_pubkey_to_address_string(&token_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "derive_token_account": {
                "token_account_address": token_account_address,
                "mint": mint,
                "owner": owner,
                "seed": hex::encode(&seed_bytes),
                "token_program": tn_pubkey_to_address_string(&token_program_bytes)
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived token account address: {}", token_account_address);
    }

    Ok(())
}

/// Derive mint account address from creator and seed
async fn derive_mint_account(
    config: &Config,
    creator: &str,
    seed: &str,
    token_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if seed.len() != 64 {
        let error_msg = "Seed must be 32 bytes (64 hex characters)";
        if json_format {
            let error_response = serde_json::json!({
                "derive_mint_account": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    let seed_bytes = parse_seed_bytes(seed)?;

    let creator_pubkey = validate_address_or_hex(creator)?;

    if !json_format {
        println!("Derive mint account:");
        println!("  Creator: {}", creator);
        println!("  Seed: {}", seed);
    }

    let (token_program_pubkey, _) = resolve_token_program(config, token_program)?;

    let mint_account_base_pubkey =
        derive_mint_account_pubkey(&token_program_pubkey, &creator_pubkey, &seed_bytes)?;

    let mint_account_pubkey = mint_account_base_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert mint account pubkey to bytes: {}",
            e
        ))
    })?;

    let mint_account_address =
        thru_base::tn_public_address::tn_pubkey_to_address_string(&mint_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "derive_mint_account": {
                "mint_account_address": mint_account_address,
                "creator": creator,
                "seed": seed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived mint account address: {}", mint_account_address);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_token_abi_is_standalone() {
        let abi: AbiFile = serde_yml::from_str(TOKEN_ABI_YAML).expect("packaged generated ABI");
        assert!(!abi.types.is_empty());
        token_reflector().expect("all reflected types resolve inside the package");
    }

    /* On-the-wire size of a token account (account_type, mint, owner,
     * amount, is_frozen). Declared locally in the tests as the fixture
     * contract; production code derives the size from the ABI via
     * reflection, not this constant. */
    const TOKEN_ACCOUNT_WIRE_LEN: usize = 1 + 32 + 32 + 8 + 1;
    /* Account discriminators (programs/rust/examples/token_program/types.rs). */
    const ACCOUNT_TYPE_MINT_V1: u8 = 1;
    const ACCOUNT_TYPE_TOKEN_ACCOUNT_V1: u8 = 2;
    use thru_base::tn_tools::KeyPair;

    #[test]
    fn authorized_actor_must_match_fee_payer() {
        let (_guard, keys) = crate::keys::KeyManager::test_fixture(&[("signer", [1; 32])]);
        let signer = keys.load_key("signer").unwrap();
        let other = KeyPair::from_hex_private_key("other", hex::encode([2u8; 32])).unwrap();
        let config = Config {
            keys,
            ..Config::default()
        };

        let actor = resolve_authorized_actor(
            &config,
            signer.address_string.as_str(),
            "Authority",
            &signer,
        )
        .unwrap();
        assert_eq!(actor, signer.public_key);
        assert_eq!(
            resolve_authorized_actor(&config, "signer", "Authority", &signer).unwrap(),
            signer.public_key
        );
        let reference = config.keys.get_entry("signer").unwrap().reference();
        assert_eq!(
            resolve_authorized_actor(&config, &reference, "Authority", &signer).unwrap(),
            signer.public_key
        );

        let error = resolve_authorized_actor(&config, other.address_string.as_str(), "Authority", &signer)
            .expect_err("a separately supplied token authority cannot sign the transaction");
        assert!(error.to_string().contains("must match the fee payer"));
    }

    #[tokio::test]
    async fn mint_to_rejects_mismatched_authority_before_rpc_setup() {
        let (_guard, keys) = crate::keys::KeyManager::test_fixture(&[("default", [1; 32])]);
        let config = Config {
            rpc_base_url: "not a valid RPC URL".to_string(),
            keys,
            ..Config::default()
        };

        let signer = KeyPair::from_hex_private_key("signer", hex::encode([1u8; 32])).unwrap();
        let other = KeyPair::from_hex_private_key("other", hex::encode([2u8; 32])).unwrap();

        let error = mint_to(
            &config,
            signer.address_string.as_str(),
            signer.address_string.as_str(),
            other.address_string.as_str(),
            1,
            None,
            None,
            true,
        )
        .await
        .expect_err("mismatched authority must fail before the invalid RPC URL is used");

        assert!(error.to_string().contains("must match the fee payer"));
    }

    #[test]
    fn token_program_prefers_flag_then_onchain_owner_then_config() {
        let flag = [1u8; 32];
        let owner = [2u8; 32];
        let configured = [3u8; 32];

        assert_eq!(
            choose_token_program(Some(flag), Some(owner), configured),
            (flag, TokenProgramSource::Flag)
        );
        assert_eq!(
            choose_token_program(None, Some(owner), configured),
            (owner, TokenProgramSource::OnChain)
        );
        assert_eq!(
            choose_token_program(None, None, configured),
            (configured, TokenProgramSource::Config)
        );
    }

    #[tokio::test]
    async fn derive_token_account_with_explicit_program_stays_offline() {
        let config = Config {
            rpc_base_url: "not a valid RPC URL".to_string(),
            ..Config::default()
        };
        let mint = KeyPair::from_hex_private_key("mint", hex::encode([4u8; 32])).unwrap();
        let owner = KeyPair::from_hex_private_key("owner", hex::encode([5u8; 32])).unwrap();
        let program = Config::default().token_program_public_key;

        derive_token_account(
            &config,
            mint.address_string.as_str(),
            owner.address_string.as_str(),
            None,
            Some(program.as_str()),
            true,
        )
        .await
        .expect("an explicit --token-program must not need the RPC endpoint");
    }

    fn build_token_account_blob(
        mint: [u8; 32],
        owner: [u8; 32],
        amount: u64,
        is_frozen: bool,
    ) -> Vec<u8> {
        let mut buf = Vec::with_capacity(TOKEN_ACCOUNT_WIRE_LEN);
        buf.push(ACCOUNT_TYPE_TOKEN_ACCOUNT_V1);
        buf.extend_from_slice(&mint);
        buf.extend_from_slice(&owner);
        buf.extend_from_slice(&amount.to_le_bytes());
        buf.push(if is_frozen { 1 } else { 0 });
        assert_eq!(buf.len(), TOKEN_ACCOUNT_WIRE_LEN);
        buf
    }

    /// A token transfer between the default token accounts of `MINT`, from
    /// `fee_payer` to `recipient`.
    fn default_accounts_transfer(fee_payer: [u8; 32], recipient: [u8; 32]) -> Vec<u8> {
        const MINT: [u8; 32] = [0x33; 32];
        let seed = [0u8; 32];
        TransactionBuilder::build_token_transfer(
            fee_payer,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            thru_ledger::token_account_address(&fee_payer, &MINT, &seed),
            thru_ledger::token_account_address(&recipient, &MINT, &seed),
            fee_payer,
            25,
            0,
            1,
            100,
        )
        .unwrap()
        .with_chain_id(1)
        .to_wire_for_signing()
    }

    #[test]
    fn destination_token_hint_proves_default_accounts_only() {
        let (fee_payer, recipient) = ([0x11; 32], [0x22; 32]);
        let body = default_accounts_transfer(fee_payer, recipient);
        let open = build_token_account_blob([0x33; 32], recipient, 0, false);
        assert_eq!(
            destination_token_hint(&body, &open),
            Ok(thru_ledger::TokenHint::new([0x33; 32], recipient))
        );
        // Another owner or mint does not derive the signed accounts.
        let other_owner = build_token_account_blob([0x33; 32], fee_payer, 0, false);
        assert!(destination_token_hint(&body, &other_owner).is_err());
        let other_mint = build_token_account_blob([0x44; 32], recipient, 0, false);
        assert!(destination_token_hint(&body, &other_mint).is_err());
        // A source owned by someone else than the fee payer.
        let foreign = default_accounts_transfer([0x55; 32], recipient);
        let mut foreign = foreign;
        foreign[48..80].copy_from_slice(&fee_payer);
        assert!(destination_token_hint(&foreign, &open).is_err());
        // Closed or unreadable accounts.
        let closed = build_token_account_blob([0u8; 32], [0u8; 32], 0, false);
        assert!(destination_token_hint(&body, &closed).is_err());
        assert!(destination_token_hint(&body, &[]).is_err());
    }

    /* The Ledger app reviews both transfers this command sends in clear: the
     * plain Transfer, and the TransferChecked built here, whose mint, decimals
     * and ticker it shows. The destination's token hint verifies for both. */
    #[test]
    fn ledger_clear_signs_both_token_transfers() {
        const MINT: [u8; 32] = [0x33; 32];
        let (fee_payer, recipient) = ([0x11; 32], [0x22; 32]);
        let seed = [0u8; 32];
        let plain = default_accounts_transfer(fee_payer, recipient);
        let token_account = build_token_account_blob(MINT, recipient, 0, false);
        let t = thru_ledger::decode_clear_transfer(&plain).unwrap();
        assert_eq!(t.checked, None);
        assert!(destination_token_hint(&plain, &token_account).is_ok());

        let checked = TransactionBuilder::build_token_transfer_checked(
            fee_payer,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            thru_ledger::token_account_address(&fee_payer, &MINT, &seed),
            thru_ledger::token_account_address(&recipient, &MINT, &seed),
            MINT,
            25,
            6,
            b"USDC",
            0,
            1,
            100,
        )
        .unwrap()
        .with_chain_id(1)
        .to_wire_for_signing();
        let t = thru_ledger::decode_clear_transfer(&checked).unwrap();
        let c = t.checked.unwrap();
        assert_eq!(
            (t.amount, c.mint, c.decimals, c.ticker()),
            (25, MINT, 6, "USDC")
        );
        assert!(destination_token_hint(&checked, &token_account).is_ok());
        // A hint for another mint does not prove this transfer.
        let other_mint = build_token_account_blob([0x44; 32], recipient, 0, false);
        assert!(destination_token_hint(&checked, &other_mint).is_err());
    }

    #[test]
    fn token_account_decode_happy_path() {
        let blob = build_token_account_blob([7u8; 32], [9u8; 32], 1_234_567, false);
        let decoded = decode_token_account_blob(&blob).expect("decode");
        assert_eq!(decoded.mint, [7u8; 32]);
        assert_eq!(decoded.owner, [9u8; 32]);
        assert_eq!(decoded.amount, 1_234_567);
        assert!(!decoded.is_frozen);
        assert!(!decoded.is_closed);
    }

    #[test]
    fn token_account_decode_frozen_flag() {
        let blob = build_token_account_blob([1u8; 32], [2u8; 32], 5, true);
        let decoded = decode_token_account_blob(&blob).expect("decode");
        assert!(decoded.is_frozen);
        assert!(!decoded.is_closed);
    }

    #[test]
    fn token_account_decode_little_endian_amount() {
        let mut blob = build_token_account_blob([1u8; 32], [2u8; 32], 0, false);
        blob[65..73].copy_from_slice(&0x0102_0304_0506_0708u64.to_le_bytes());
        let decoded = decode_token_account_blob(&blob).expect("decode");
        assert_eq!(decoded.amount, 0x0102_0304_0506_0708);
    }

    /* close_account zeroes the whole account, account_type included. */
    fn closed_token_account_blob() -> Vec<u8> {
        vec![0u8; TOKEN_ACCOUNT_WIRE_LEN]
    }

    #[test]
    fn token_account_decode_closed_sentinel() {
        let decoded = decode_token_account_blob(&closed_token_account_blob()).expect("decode");
        assert!(decoded.is_closed);
        assert_eq!(decoded.amount, 0);
        assert!(!decoded.is_frozen);
    }

    #[test]
    fn token_account_decode_wrong_length() {
        let blob = build_token_account_blob([1u8; 32], [2u8; 32], 5, false);
        assert!(decode_token_account_blob(&blob[..TOKEN_ACCOUNT_WIRE_LEN - 1]).is_err());
        let mut long = blob;
        long.push(0);
        assert!(decode_token_account_blob(&long).is_err());
    }

    #[test]
    fn token_account_decode_checks_the_account_type() {
        let mut blob = build_token_account_blob([1u8; 32], [2u8; 32], 5, false);
        for account_type in [0u8, ACCOUNT_TYPE_MINT_V1, 3, 0xff] {
            blob[0] = account_type;
            assert!(
                decode_token_account_blob(&blob).is_err(),
                "account_type {account_type}"
            );
        }
    }

    /* On-the-wire size of a mint account (account_type, decimals, supply,
     * creator, mint authority, freeze authority, has_freeze_authority, ticker
     * length, ticker bytes). A fixture contract, like TOKEN_ACCOUNT_WIRE_LEN. */
    const MINT_ACCOUNT_WIRE_LEN: usize = 1 + 1 + 8 + 32 + 32 + 32 + 1 + 1 + 8;

    const TOKEN_PROGRAM: [u8; 32] = [0x70; 32];
    const MINT: [u8; 32] = [0x31; 32];

    /* Every field before the ticker holds a value that differs from the
     * decimals and the ticker length, so a decoder that reads a neighbouring
     * byte is caught. */
    fn build_mint_account_blob(decimals: u8, ticker_len: u8, ticker_bytes: [u8; 8]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(MINT_ACCOUNT_WIRE_LEN);
        buf.push(ACCOUNT_TYPE_MINT_V1);
        buf.push(decimals);
        buf.extend_from_slice(&0x1112_1314_1516_1718u64.to_le_bytes());
        buf.extend_from_slice(&[0xc1; 32]);
        buf.extend_from_slice(&[0xa2; 32]);
        buf.extend_from_slice(&[0xf3; 32]);
        buf.push(1);
        buf.push(ticker_len);
        buf.extend_from_slice(&ticker_bytes);
        assert_eq!(buf.len(), MINT_ACCOUNT_WIRE_LEN);
        buf
    }

    fn ticker_field(ticker: &[u8]) -> [u8; 8] {
        let mut field = [0u8; 8];
        field[..ticker.len()].copy_from_slice(ticker);
        field
    }

    #[test]
    fn mint_account_decode_reads_decimals_and_the_ticker_field() {
        let blob = build_mint_account_blob(6, 4, ticker_field(b"USDC"));
        assert_eq!(
            decode_mint_account_blob(&blob).expect("decode"),
            DecodedMintAccount {
                decimals: 6,
                ticker_len: 4,
                ticker_bytes: *b"USDC\0\0\0\0",
            }
        );
    }

    #[test]
    fn mint_account_decode_keeps_the_ticker_field_as_stored() {
        let stored = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0xff];
        let blob = build_mint_account_blob(255, 200, stored);
        assert_eq!(
            decode_mint_account_blob(&blob).expect("decode"),
            DecodedMintAccount {
                decimals: 255,
                ticker_len: 200,
                ticker_bytes: stored,
            }
        );
    }

    #[test]
    fn mint_and_token_accounts_are_told_apart() {
        let mint_blob = build_mint_account_blob(6, 4, ticker_field(b"USDC"));
        let token_blob = build_token_account_blob(MINT, [9u8; 32], 5, false);

        let error = decode_mint_account_blob(&token_blob).unwrap_err();
        assert!(error.contains("not a mint account"), "{error}");
        let error = decode_token_account_blob(&mint_blob).unwrap_err();
        assert!(error.contains("not a token account"), "{error}");

        assert!(decode_mint_account_blob(&mint_blob[..MINT_ACCOUNT_WIRE_LEN - 1]).is_err());
        let mut long = mint_blob;
        long.push(0);
        assert!(decode_mint_account_blob(&long).is_err());
    }

    #[test]
    fn canonical_ticker_is_at_most_eight_bytes_then_zeros() {
        let mint = |ticker_len: u8, ticker_bytes: [u8; 8]| DecodedMintAccount {
            decimals: 0,
            ticker_len,
            ticker_bytes,
        };

        assert_eq!(
            mint(4, ticker_field(b"USDC")).canonical_ticker(),
            Some(&b"USDC"[..])
        );
        assert_eq!(mint(0, [0; 8]).canonical_ticker(), Some(&b""[..]));
        assert_eq!(
            mint(8, *b"EIGHTCHR").canonical_ticker(),
            Some(&b"EIGHTCHR"[..])
        );
        /* A zero byte inside the stated length is part of the ticker. */
        assert_eq!(
            mint(8, *b"EVECOIN\0").canonical_ticker(),
            Some(&b"EVECOIN\0"[..])
        );

        /* Non-zero bytes after the length. */
        assert_eq!(mint(4, *b"USDCoin\0").canonical_ticker(), None);
        assert_eq!(mint(0, *b"\0\0\0\0\0\0\0x").canonical_ticker(), None);
        /* A length above eight. */
        assert_eq!(mint(9, ticker_field(b"USDC")).canonical_ticker(), None);
        assert_eq!(mint(255, [0; 8]).canonical_ticker(), None);
    }

    /* An account as read from chain, owned by the token program. */
    fn owned(data: Vec<u8>) -> FetchedAccount {
        FetchedAccount {
            owner: TOKEN_PROGRAM,
            data,
        }
    }

    const OTHER_PROGRAM: [u8; 32] = [0x71; 32];

    #[test]
    fn source_account_mint_needs_an_open_token_account_of_the_program() {
        let open = owned(build_token_account_blob(MINT, [9u8; 32], 5, false));
        assert_eq!(source_account_mint(Some(&open), &TOKEN_PROGRAM), Ok(MINT));

        let error = source_account_mint(None, &TOKEN_PROGRAM).unwrap_err();
        assert!(error.contains("not found"), "{error}");

        /* A token account of another token program decodes, but the selected
         * program rejects it (reachable with an explicit --token-program). */
        let error = source_account_mint(Some(&open), &OTHER_PROGRAM).unwrap_err();
        assert!(error.contains("is owned by"), "{error}");

        let closed = owned(closed_token_account_blob());
        let error = source_account_mint(Some(&closed), &TOKEN_PROGRAM).unwrap_err();
        assert!(error.contains("closed"), "{error}");

        let mint_blob = owned(build_mint_account_blob(6, 4, ticker_field(b"USDC")));
        let error = source_account_mint(Some(&mint_blob), &TOKEN_PROGRAM).unwrap_err();
        assert!(error.contains("not a token account"), "{error}");
    }

    #[test]
    fn checked_transfer_inputs_carry_the_mint_decimals_and_stored_ticker() {
        let mint_account = owned(build_mint_account_blob(6, 4, ticker_field(b"USDC")));
        let inputs = checked_transfer_inputs(MINT, Some(&mint_account), &TOKEN_PROGRAM)
            .expect("a canonical mint of this token program");
        assert_eq!(
            inputs,
            CheckedTransferInputs {
                mint: MINT,
                decimals: 6,
                ticker: b"USDC".to_vec(),
            }
        );
        assert_eq!(inputs.ticker_text(), "USDC");
    }

    #[test]
    fn checked_transfer_inputs_refuse_a_mint_the_program_would_reject() {
        let canonical = owned(build_mint_account_blob(6, 4, ticker_field(b"USDC")));

        let error = checked_transfer_inputs(MINT, None, &TOKEN_PROGRAM).unwrap_err();
        assert!(error.contains("not found"), "{error}");

        let error = checked_transfer_inputs(MINT, Some(&canonical), &OTHER_PROGRAM).unwrap_err();
        assert!(error.contains("is owned by"), "{error}");

        for (ticker_len, ticker_bytes) in [(9, ticker_field(b"USDC")), (4, *b"USDCoin\0")] {
            let mint_account = owned(build_mint_account_blob(6, ticker_len, ticker_bytes));
            let error =
                checked_transfer_inputs(MINT, Some(&mint_account), &TOKEN_PROGRAM).unwrap_err();
            assert!(error.contains("cannot be matched"), "{error}");
            assert!(error.contains(&hex::encode(ticker_bytes)), "{error}");
        }

        let token_account = owned(build_token_account_blob(MINT, [9u8; 32], 5, false));
        let error =
            checked_transfer_inputs(MINT, Some(&token_account), &TOKEN_PROGRAM).unwrap_err();
        assert!(error.contains("not a mint account"), "{error}");
    }

    /* The instruction must repeat the stored ticker field byte for byte: the
     * program compares the length and all eight bytes. */
    #[test]
    fn checked_transfer_repeats_the_stored_mint_fields_in_the_instruction() {
        let stored = *b"EVECOIN\0";
        let blob = build_mint_account_blob(9, 8, stored);
        let inputs = checked_transfer_inputs(MINT, Some(&owned(blob.clone())), &TOKEN_PROGRAM)
            .expect("a canonical mint of this token program");

        let (fee_payer, source, destination) = ([0x01; 32], [0x51; 32], [0x52; 32]);
        let transaction = TransactionBuilder::build_token_transfer_checked(
            fee_payer,
            TOKEN_PROGRAM,
            source,
            destination,
            inputs.mint,
            250_000,
            inputs.decimals,
            &inputs.ticker,
            TOKEN_PROGRAM_FEE,
            7,
            100,
        )
        .expect("build");

        assert_eq!(transaction.rw_accs, Some(vec![source, destination]));
        assert_eq!(transaction.r_accs, Some(vec![MINT]));
        let instruction = transaction.instructions.expect("instruction data");
        assert_eq!(instruction.len(), 25);
        assert_eq!(instruction[0], 8);
        /* decimals, ticker length, ticker bytes: the tail of the mint blob. */
        assert_eq!(instruction[15], blob[1]);
        assert_eq!(instruction[16..], blob[MINT_ACCOUNT_WIRE_LEN - 9..]);
    }

    /* The ticker bytes come from the chain. Shown raw, a ticker could send
     * control sequences to the terminal, and different tickers could look
     * the same. */
    #[test]
    fn ticker_text_escapes_every_byte_that_is_not_printable_ascii() {
        let text = |ticker: &[u8]| {
            CheckedTransferInputs {
                mint: MINT,
                decimals: 0,
                ticker: ticker.to_vec(),
            }
            .ticker_text()
        };

        assert_eq!(text(b"USDC"), "USDC");
        assert_eq!(text(b""), "");
        assert_eq!(text(b"EVECOIN\0"), "EVECOIN\\x00");
        /* ESC [ 2 J: clear the screen. */
        assert_eq!(text(b"\x1b[2J"), "\\x1b[2J");
        assert_eq!(text(b"A\nB\rC"), "A\\nB\\rC");
        assert_eq!(text(b"A\\B"), "A\\\\B");
        /* Bytes that are not UTF-8 stay distinct, and so does UTF-8. */
        assert_eq!(text(&[0xff]), "\\xff");
        assert_eq!(text(&[0xfe]), "\\xfe");
        assert_eq!(text("€".as_bytes()), "\\xe2\\x82\\xac");

        for ticker in [&b"\x1b[2J"[..], b"\x07\x08\x7f", &[0x9b, 0x80]] {
            assert!(
                text(ticker).bytes().all(|b| (0x20..0x7f).contains(&b)),
                "{ticker:?}"
            );
        }
    }

    /* A plain Transfer does not read the mint, so only a mint refusal says
     * how to send one. It fails on a bad source account all the same. */
    #[test]
    fn only_a_mint_refusal_suggests_the_plain_transfer() {
        let source = source_refusal_message(&[0x51; 32], "the account is closed");
        assert!(source.starts_with("Cannot build TransferChecked: source token account ta"));
        assert!(source.ends_with(": the account is closed"), "{source}");
        assert!(!source.contains("--unchecked"), "{source}");

        let mint = mint_refusal_message(&MINT, "the account was not found on chain");
        assert!(mint.starts_with("Cannot build TransferChecked: mint ta"));
        assert!(
            mint.contains(": the account was not found on chain. "),
            "{mint}"
        );
        assert!(mint.ends_with(UNCHECKED_HINT), "{mint}");
    }

    /* In JSON mode the failure object is the command's whole error output.
     * Any error variant but `Reported` makes the entry point print a second
     * JSON document on stdout. In text mode the entry point prints the
     * returned error, once. */
    #[test]
    fn refused_token_operation_is_reported_once() {
        let error = refuse_token_operation("token_burn", "why", true);
        assert!(matches!(error, CliError::Reported), "{error:?}");
        let error = refuse_token_operation("token_burn", "why", false);
        assert!(
            matches!(&error, CliError::Validation(msg) if msg == "why"),
            "{error:?}"
        );

        let error = refuse_token_transfer("Cannot build TransferChecked: why", true);
        assert!(matches!(error, CliError::Reported), "{error:?}");

        /* The report keeps the classification of the error it replaces. */
        assert_eq!(
            token_failure_json(
                "token_transfer",
                "why",
                &CliError::Validation("why".to_string())
            ),
            serde_json::json!({
                "token_transfer": { "status": "failed", "error": "why", "error_type": "validation" }
            })
        );
        assert_eq!(
            token_failure_json(
                "token_mint_to",
                "no such account",
                &CliError::AccountNotFound("no such account".to_string())
            ),
            serde_json::json!({
                "token_mint_to": {
                    "status": "failed",
                    "error": "no such account",
                    "error_type": "account_not_found"
                }
            })
        );
    }

    #[test]
    fn account_not_found_is_reported_once() {
        let not_found = || CliError::AccountNotFound("no such account".to_string());

        let error = handle_account_not_found_error(not_found(), "token_transfer", true);
        assert!(matches!(error, CliError::Reported), "{error:?}");

        /* Text mode, and every other error, pass through unchanged. */
        let error = handle_account_not_found_error(not_found(), "token_transfer", false);
        assert!(
            matches!(&error, CliError::AccountNotFound(msg) if msg == "no such account"),
            "{error:?}"
        );
        let error = handle_account_not_found_error(
            CliError::Rpc("down".to_string()),
            "token_transfer",
            true,
        );
        assert!(
            matches!(&error, CliError::Rpc(msg) if msg == "down"),
            "{error:?}"
        );
    }

    /* A zero amount is refused before any key or RPC use, and reported once
     * like the other refusals. */
    #[tokio::test]
    async fn zero_amount_is_refused_before_rpc_setup() {
        let config = Config {
            rpc_base_url: "not a valid RPC URL".to_string(),
            ..Config::default()
        };

        for json_format in [true, false] {
            let errors = [
                transfer(&config, "from", "to", 0, None, None, false, json_format).await,
                transfer(&config, "from", "to", 0, None, None, true, json_format).await,
                mint_to(
                    &config,
                    "mint",
                    "to",
                    "authority",
                    0,
                    None,
                    None,
                    json_format,
                )
                .await,
                burn(
                    &config,
                    "account",
                    "mint",
                    "authority",
                    0,
                    None,
                    None,
                    json_format,
                )
                .await,
            ];
            for result in errors {
                let error = result.expect_err("a zero amount must be refused");
                if json_format {
                    assert!(matches!(error, CliError::Reported), "{error:?}");
                } else {
                    assert!(
                        matches!(&error, CliError::Validation(msg) if msg.ends_with("amount must be greater than 0")),
                        "{error:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn test_check_transaction_result_success() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = TransactionDetails {
            compute_units_consumed: 1000,
            state_units_consumed: 100,
            pages_used: 1,
            signature: test_signature,
            slot: 1000,
            proof_slot: 1000,
            ..Default::default()
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_ok(), "Should succeed for successful transaction");
    }

    #[test]
    fn test_check_transaction_result_execution_error() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = TransactionDetails {
            compute_units_consumed: 1000,
            state_units_consumed: 100,
            pages_used: 1,
            execution_result: 1,
            signature: test_signature,
            slot: 1000,
            proof_slot: 1000,
            ..Default::default()
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(
            result.is_err(),
            "Should fail for transaction with execution error"
        );

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("execution result: 1"));
    }

    #[test]
    fn test_check_transaction_result_vm_error() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = TransactionDetails {
            compute_units_consumed: 1000,
            state_units_consumed: 100,
            pages_used: 1,
            vm_error: 100,
            signature: test_signature,
            slot: 1000,
            proof_slot: 1000,
            ..Default::default()
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_err(), "Should fail for transaction with VM error");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("VM error: 100"));
    }

    /* In JSON mode the helper prints the failure object itself. Any error
     * variant but `Reported` makes the entry point print a second JSON
     * document. */
    #[test]
    fn failed_transaction_is_reported_once_in_json_mode() {
        let transaction_details = TransactionDetails {
            vm_error: 100,
            user_error_code: 23,
            execution_result: 1,
            signature: thru_base::tn_tools::Signature::from_bytes(&[1u8; 64]),
            ..Default::default()
        };

        let error = check_transaction_result(&transaction_details, true).unwrap_err();
        assert!(matches!(error, CliError::Reported), "{error:?}");

        let error = check_transaction_result(&transaction_details, false).unwrap_err();
        assert!(
            matches!(&error, CliError::TransactionSubmission(msg) if msg.contains("TokenError: 23")),
            "{error:?}"
        );
    }

    #[test]
    fn test_check_transaction_result_both_errors() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = TransactionDetails {
            compute_units_consumed: 1000,
            state_units_consumed: 100,
            pages_used: 1,
            execution_result: 1,
            vm_error: 100,
            signature: test_signature,
            slot: 1000,
            proof_slot: 1000,
            ..Default::default()
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(
            result.is_err(),
            "Should fail for transaction with both errors"
        );

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("execution result: 1"));
        assert!(error_msg.contains("VM error: 100"));
    }
}
