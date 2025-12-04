//! Token program command implementation

use anyhow::Result;

/// 0 fee for now
const TOKEN_PROGRAM_FEE: u64 = 0;

use crate::cli::TokenCommands;
use crate::commands::state_proof::make_state_proof;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::{format_vm_error, parse_seed_bytes, validate_address_or_hex};
use std::time::Duration;
use thru_base::crypto_utils::derive_program_address;
use thru_base::rpc_types::ProofType;
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_tools::TransactionBuilder;
use thru_client::{Client, ClientBuilder, TransactionDetails};

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

    KeyPair::from_hex_private_key(fee_payer.unwrap_or("default"), fee_payer_private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to create fee payer keypair: {}", e)))
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

/// Helper function to check transaction execution results and return appropriate errors
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
                    "message": error_msg,
                    "execution_result": signed_execution_result,
                    "vm_error": transaction_details.vm_error,
                    "vm_error_name": vm_error_label,
                    "user_error_code": signed_user_error,
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
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    let client = ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .build()?;

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
    token_program: Option<&str>,
) -> Result<TransactionContext, CliError> {
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
) -> Result<TransactionDetails, CliError> {
    // Sign transaction
    transaction
        .sign(&context.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

    let transaction_details = context
        .client
        .execute_transaction(&transaction_bytes, timeout)
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
        } => {
            transfer(
                config,
                &from,
                &to,
                amount,
                fee_payer.as_deref(),
                token_program.as_deref(),
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
        } => {
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
        } => {
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
        } => {
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
        } => {
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
        } => {
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

    // Resolve addresses
    let creator_pubkey = validate_address_or_hex(creator)?;
    let mint_authority_pubkey = validate_address_or_hex(mint_authority_str)?;
    let freeze_authority_pubkey = match freeze_authority {
        Some(addr) => Some(validate_address_or_hex(addr)?),
        None => None,
    };

    // Resolve token program and fee payer
    let (token_program_pubkey, token_program_bytes) = resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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

    // Resolve token program and fee payer
    let (token_program_pubkey, token_program_bytes) = resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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

/// Transfer tokens between accounts
async fn transfer(
    config: &Config,
    from: &str,
    to: &str,
    amount: u64,
    fee_payer: Option<&str>,
    token_program: Option<&str>,
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
    let context = setup_transaction_context(config, fee_payer, token_program)
        .await
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
    token_program: Option<&str>,
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
    let context = setup_transaction_context(config, fee_payer, token_program)
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

    // Resolve configuration
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Resolve configuration
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Resolve configuration
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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
    let authority_pubkey = validate_address_or_hex(authority)?;

    // Resolve configuration
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program(config, token_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
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
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Sign transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);

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
    let (token_program_pubkey, _) = resolve_token_program(config, token_program)?;

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
                "seed": hex::encode(&seed_bytes)
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
