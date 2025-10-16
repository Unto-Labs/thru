//! Token program command implementation

use anyhow::Result;

/// 0 fee for now
const TOKEN_PROGRAM_FEE: u64 = 0;

use std::time::Duration;
use crate::cli::TokenCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::{validate_address_or_hex, parse_seed_bytes};
use thru_base::tn_tools::KeyPair;
use thru_base::crypto_utils::derive_program_address;
use thru_base::txn_tools::TransactionBuilder;
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_rpc_client::{Client, ClientBuilder};

/// Helper function to resolve fee payer keypair from configuration
fn resolve_fee_payer_keypair(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<KeyPair, CliError> {
    let fee_payer_private_key = if let Some(fee_payer_name) = fee_payer {
        config.keys.get_key(fee_payer_name).map_err(|_| {
            CliError::Validation(format!(
                "Fee payer key '{}' not found in configuration",
                fee_payer_name
            ))
        })?
    } else {
        config.keys.get_key("default")?
    };

    KeyPair::from_hex_private_key(
        fee_payer.unwrap_or("default"),
        fee_payer_private_key
    ).map_err(|e| CliError::Crypto(format!("Failed to create fee payer keypair: {}", e)))
}

/// Helper function to check transaction execution results and return appropriate errors
fn check_transaction_result(transaction_details: &thru_rpc_client::TransactionDetails, json_format: bool) -> Result<(), CliError> {
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let vm_error_msg = if transaction_details.vm_error != 0 {
            format!(" (VM error: {})", transaction_details.vm_error)
        } else {
            String::new()
        };

        let user_error_msg = if transaction_details.user_error_code != 0 {
            format!(" (TokenError: {})", transaction_details.user_error_code)
        } else {
            String::new()
        };

        let error_msg = format!(
            "Transaction failed with execution result: {}{}{}",
            transaction_details.execution_result,
            vm_error_msg,
            user_error_msg
        );

        if json_format {
            let error_response = serde_json::json!({
                "error": {
                    "message": error_msg,
                    "execution_result": transaction_details.execution_result,
                    "vm_error": transaction_details.vm_error,
                    "user_error_code": transaction_details.user_error_code,
                    "signature": transaction_details.signature.as_str()
                }
            });
            crate::output::print_output(error_response, true);
        }

        return Err(CliError::TransactionSubmission(error_msg));
    }
    Ok(())
}

/// Helper function to handle AccountNotFound errors with JSON output
fn handle_account_not_found_error(error: CliError, operation: &str, json_format: bool) -> CliError {
    if let CliError::AccountNotFound(msg) = &error {
        if json_format {
            let error_response = serde_json::json!({
                operation: {
                    "status": "failed",
                    "error": msg
                }
            });
            crate::output::print_output(error_response, true);
        }
    }
    error
}

/// Create RPC client from configuration
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_rpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    let client = ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .build();

    Ok(client)
}

/// Common transaction execution context
struct TransactionContext {
    pub fee_payer_keypair: KeyPair,
    pub token_program_bytes: [u8; 32],
    pub client: Client,
    pub nonce: u64,
    pub start_slot: u64,
}

/// Setup common transaction context (config, keypair, client, nonce, block height)
async fn setup_transaction_context(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<TransactionContext, CliError> {
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    Ok(TransactionContext {
        fee_payer_keypair,
        token_program_bytes,
        client,
        nonce,
        start_slot: block_height.finalized_height,
    })
}

/// Execute a transaction (sign, submit, check result)
async fn execute_transaction(
    mut transaction: thru_base::txn_lib::Transaction,
    context: &TransactionContext,
    json_format: bool,
) -> Result<thru_rpc_client::TransactionDetails, CliError> {
    // Sign transaction
    transaction.sign(&context.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = context.client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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
            mint_authority,
            freeze_authority,
            decimals,
            ticker,
            seed,
            state_proof,
            fee_payer,
        } => {
            initialize_mint(
                config,
                &mint_authority,
                freeze_authority.as_deref(),
                decimals,
                &ticker,
                &seed,
                &state_proof,
                fee_payer.as_deref(),
                json_format,
            ).await
        }
        TokenCommands::InitializeAccount { mint, owner, seed, state_proof, fee_payer } => {
            initialize_account(config, &mint, &owner, &seed, &state_proof, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::Transfer { from, to, amount, fee_payer } => {
            transfer(config, &from, &to, amount, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::MintTo { mint, to, authority, amount, fee_payer } => {
            mint_to(config, &mint, &to, &authority, amount, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::Burn { account, mint, authority, amount, fee_payer } => {
            burn(config, &account, &mint, &authority, amount, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::CloseAccount { account, destination, authority, fee_payer } => {
            close_account(config, &account, &destination, &authority, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::FreezeAccount { account, mint, authority, fee_payer } => {
            freeze_account(config, &account, &mint, &authority, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::ThawAccount { account, mint, authority, fee_payer } => {
            thaw_account(config, &account, &mint, &authority, fee_payer.as_deref(), json_format).await
        }
        TokenCommands::DeriveTokenAccount { mint, owner, seed } => {
            derive_token_account(config, &mint, &owner, seed.as_deref(), json_format).await
        }
        TokenCommands::DeriveMintAccount { mint_authority, seed } => {
            derive_mint_account(config, &mint_authority, &seed, json_format).await
        }
    }
}

/// Initialize a new token mint
async fn initialize_mint(
    config: &Config,
    mint_authority: &str,
    freeze_authority: Option<&str>,
    decimals: u8,
    ticker: &str,
    seed: &str,
    state_proof: &str,
    fee_payer: Option<&str>,
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

    if !json_format {
        println!("Initialize mint:");
        println!("  Mint Authority: {}", mint_authority);
        if let Some(freeze_auth) = freeze_authority {
            println!("  Freeze Authority: {}", freeze_auth);
        }
        println!("  Decimals: {}", decimals);
        println!("  Ticker: {}", ticker);
        println!("  Seed: {}", seed);
    }

    // Parse seed
    let seed_bytes = parse_seed_bytes(seed)?;

    // Parse state proof from hex
    let state_proof_bytes = hex::decode(state_proof)
        .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?;

    // Resolve addresses
    let mint_authority_pubkey = validate_address_or_hex(mint_authority)?;
    let freeze_authority_pubkey = match freeze_authority {
        Some(addr) => Some(validate_address_or_hex(addr)?),
        None => None,
    };

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    // Get token program as bytes for address derivation
    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Convert token program Pubkey to thru_base Pubkey for address derivation
    let token_program_base_pubkey = thru_base::tn_tools::Pubkey::from_bytes(&token_program_bytes);

    // Derive mint account address using the provided seed and token program as owner
    let mint_account_base_pubkey = derive_program_address(
        &seed_bytes,
        &token_program_base_pubkey,
        false, // mint accounts are not ephemeral
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive mint address: {}", e)))?;

    let mint_account_pubkey = mint_account_base_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert mint pubkey to bytes: {}", e)))?;

    // Build transaction using TransactionBuilder

    let mut transaction = TransactionBuilder::build_token_initialize_mint(
        fee_payer_keypair.public_key,
        token_program_bytes,
        mint_account_pubkey,
        mint_authority_pubkey,
        freeze_authority_pubkey,
        decimals,
        ticker,
        seed_bytes,
        state_proof_bytes,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

    // Check if transaction was successful
    check_transaction_result(&transaction_details, json_format)?;

    // Convert mint account address to string for output
    let mint_account_address = thru_base::tn_public_address::tn_pubkey_to_address_string(&mint_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "token_initialize_mint": {
                "status": "success",
                "mint_account": mint_account_address,
                "ticker": ticker,
                "decimals": decimals,
                "mint_authority": mint_authority,
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
    state_proof: &str,
    fee_payer: Option<&str>,
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

    // Parse state proof from hex
    let state_proof_bytes = hex::decode(state_proof)
        .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?;

    // Resolve mint and owner addresses
    let mint_pubkey = validate_address_or_hex(mint)?;
    let owner_pubkey = validate_address_or_hex(owner)?;

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    // Derive token account address using SHA256(owner + mint + seed) then PDA derivation=
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(&owner_pubkey);  // owner_pubkey.0
    hasher.update(&mint_pubkey);   // mint_pubkey.0
    hasher.update(&seed_bytes);    // new_account_seed

    let token_seed_hash = hasher.finalize();
    let mut token_seed = [0u8; 32];
    token_seed.copy_from_slice(&token_seed_hash);

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Convert token program Pubkey to thru_base Pubkey for address derivation
    let token_program_base_pubkey = thru_base::tn_tools::Pubkey::from_bytes(&token_program_bytes);

    let token_account_base_pubkey = derive_program_address(
        &token_seed,
        &token_program_base_pubkey,
        false, // token accounts are not ephemeral
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive token account address: {}", e)))?;

    let token_account = token_account_base_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token account pubkey to bytes: {}", e)))?;

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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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

/// Transfer tokens between accounts
async fn transfer(
    config: &Config,
    from: &str,
    to: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Transfer amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "token_transfer": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
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

    // Setup transaction context
    let context = setup_transaction_context(config, fee_payer).await
        .map_err(|e| handle_account_not_found_error(e, "token_transfer", json_format))?;

    // Build transaction using TransactionBuilder
    // For transfers, the fee payer acts as the authority (source account owner)
    let transaction = TransactionBuilder::build_token_transfer(
        context.fee_payer_keypair.public_key,
        context.token_program_bytes,
        from_pubkey,
        to_pubkey,
        context.fee_payer_keypair.public_key, // Use fee payer as authority
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
            "token_transfer": {
                "status": "success",
                "from": from,
                "to": to,
                "amount": amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Transfer completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Transferred {} tokens from {} to {}", amount, from, to);
    }

    Ok(())
}

/// Mint new tokens to an account
async fn mint_to(
    config: &Config,
    mint: &str,
    to: &str,
    authority: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Mint amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "token_mint_to": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Mint tokens:");
        println!("  Mint: {}", mint);
        println!("  To: {}", to);
        println!("  Authority: {}", authority);
        println!("  Amount: {}", amount);
    }

    // Resolve mint, to, and authority addresses
    let mint_pubkey = validate_address_or_hex(mint)?;
    let to_pubkey = validate_address_or_hex(to)?;
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Setup transaction context
    let context = setup_transaction_context(config, fee_payer).await
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
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Burn amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "token_burn": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_close_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        destination_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_freeze_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        mint_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Get configuration
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string
        )));
    };

    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get block height: {}", e)))?;

    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_token_thaw_account(
        fee_payer_keypair.public_key,
        token_program_bytes,
        account_pubkey,
        mint_pubkey,
        authority_pubkey,
        TOKEN_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction.sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e)))?;

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

/// Derive token account address from mint, owner, and seed
async fn derive_token_account(
    config: &Config,
    mint: &str,
    owner: &str,
    seed: Option<&str>,
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
    hasher.update(&owner_pubkey);  // owner_pubkey.0
    hasher.update(&mint_pubkey);   // mint_pubkey.0
    hasher.update(&seed_bytes);    // new_account_seed

    let token_seed_hash = hasher.finalize();
    let mut token_seed = [0u8; 32];
    token_seed.copy_from_slice(&token_seed_hash);

    // Use the token_seed for PDA derivation with token program as owner
    // This matches account_create() call in process.rs line 87-92
    let token_program_pubkey = config.get_token_program_pubkey()?;
    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    // Convert token program Pubkey to thru_base Pubkey for address derivation
    let token_program_base_pubkey = thru_base::tn_tools::Pubkey::from_bytes(&token_program_bytes);

    // Derive the final token account address using the token_seed
    let token_account_base_pubkey = thru_base::crypto_utils::derive_program_address(
        &token_seed,
        &token_program_base_pubkey,
        false, // token accounts are not ephemeral
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive token account address: {}", e)))?;

    let token_account_pubkey = token_account_base_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token account pubkey to bytes: {}", e)))?;

    // Convert to thru address format
    let token_account_address = thru_base::tn_public_address::tn_pubkey_to_address_string(&token_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "derive_token_account": {
                "token_account_address": token_account_address,
                "mint": mint,
                "owner": owner,
                "seed": hex::encode(&seed_bytes)
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived token account address: {}", token_account_address);
    }

    Ok(())
}

/// Derive mint account address from mint authority and seed
async fn derive_mint_account(
    config: &Config,
    mint_authority: &str,
    seed: &str,
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

    let mint_authority_pubkey = validate_address_or_hex(mint_authority)?;

    if !json_format {
        println!("Derive mint account:");
        println!("  Mint Authority: {}", mint_authority);
        println!("  Seed: {}", seed);
    }

    // sha256[mint authority + seed]
    // then put through PDA fcn
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(&mint_authority_pubkey);  // mint_authority.0
    hasher.update(&seed_bytes);             // seed

    let mint_seed_hash = hasher.finalize();
    let mut derived_seed = [0u8; 32];
    derived_seed.copy_from_slice(&mint_seed_hash);

    let token_program_pubkey = config.get_token_program_pubkey()?;
    let token_program_bytes = token_program_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;

    let token_program_base_pubkey = thru_base::tn_tools::Pubkey::from_bytes(&token_program_bytes);

    let mint_account_base_pubkey = thru_base::crypto_utils::derive_program_address(
        &derived_seed,
        &token_program_base_pubkey,
        false,
    )
    .map_err(|e| CliError::Crypto(format!("Failed to derive mint account address: {}", e)))?;

    let mint_account_pubkey = mint_account_base_pubkey.to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert mint account pubkey to bytes: {}", e)))?;

    let mint_account_address = thru_base::tn_public_address::tn_pubkey_to_address_string(&mint_account_pubkey);

    if json_format {
        let response = serde_json::json!({
            "derive_mint_account": {
                "mint_account_address": mint_account_address,
                "mint_authority": mint_authority,
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
    fn test_resolve_fee_payer_keypair_with_nonexistent_key() {
        let config = Config::default();
        let result = resolve_fee_payer_keypair(&config, Some("nonexistent"));
        assert!(result.is_err(), "Should fail for nonexistent fee payer key");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("nonexistent"));
    }

    #[test]
    fn test_check_transaction_result_success() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = thru_rpc_client::TransactionDetails {
            compute_units_consumed: 1000,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 0,
            pages_used: 1,
            state_units_consumed: 100,
            user_error_code: 0,
            vm_error: 0,
            signature: test_signature,
            rw_accounts: vec![],
            ro_accounts: vec![],
            slot: 1000,
            proof_slot: 1000,
            events: vec![],
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_ok(), "Should succeed for successful transaction");
    }

    #[test]
    fn test_check_transaction_result_execution_error() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = thru_rpc_client::TransactionDetails {
            compute_units_consumed: 1000,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 1,
            pages_used: 1,
            state_units_consumed: 100,
            user_error_code: 0,
            vm_error: 0,
            signature: test_signature,
            rw_accounts: vec![],
            ro_accounts: vec![],
            slot: 1000,
            proof_slot: 1000,
            events: vec![],
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_err(), "Should fail for transaction with execution error");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("execution result: 1"));
    }

    #[test]
    fn test_check_transaction_result_vm_error() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = thru_rpc_client::TransactionDetails {
            compute_units_consumed: 1000,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 0,
            pages_used: 1,
            state_units_consumed: 100,
            user_error_code: 0,
            vm_error: 100,
            signature: test_signature,
            rw_accounts: vec![],
            ro_accounts: vec![],
            slot: 1000,
            proof_slot: 1000,
            events: vec![],
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_err(), "Should fail for transaction with VM error");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("VM error: 100"));
    }

    #[test]
    fn test_check_transaction_result_both_errors() {
        let test_sig_bytes = [1u8; 64];
        let test_signature = thru_base::tn_tools::Signature::from_bytes(&test_sig_bytes);

        let transaction_details = thru_rpc_client::TransactionDetails {
            compute_units_consumed: 1000,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 1,
            pages_used: 1,
            state_units_consumed: 100,
            user_error_code: 0,
            vm_error: 100,
            signature: test_signature,
            rw_accounts: vec![],
            ro_accounts: vec![],
            slot: 1000,
            proof_slot: 1000,
            events: vec![],
        };

        let result = check_transaction_result(&transaction_details, false);
        assert!(result.is_err(), "Should fail for transaction with both errors");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("execution result: 1"));
        assert!(error_msg.contains("VM error: 100"));
    }
}
