//! Account management command implementations

use base64::Engine;
use thru_base::txn_tools::SYSTEM_PROGRAM;
use std::time::Duration;
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_account::{TN_ACCOUNT_META_FOOTPRINT, TnAccountMeta};
use thru_base::{StateProof, TransactionBuilder};

use crate::cli::AccountCommands;
use crate::config::Config;
use crate::crypto::keypair_from_hex;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use thru_client::{Client, ClientBuilder};

/// Helper function to resolve fee payer and target account
fn resolve_fee_payer_and_target(
    config: &Config,
    fee_payer: Option<&str>,
    target_account: &str,
) -> Result<(thru_base::tn_tools::KeyPair, thru_base::tn_tools::Pubkey), CliError> {
    // Resolve fee payer using resolve_account_input for validation
    let _fee_payer_pubkey = crate::commands::rpc::resolve_account_input(fee_payer, config)?;

    // Get the private key for the fee payer to create the keypair for signing
    let fee_payer_private_key = if let Some(fee_payer_name) = fee_payer {
        config.keys.get_key(fee_payer_name).map_err(|_| {
            CliError::Validation(format!(
                "Fee payer key '{}' not found in configuration",
                fee_payer_name
            ))
        })?
    } else {
        config.keys.get_default_key()?
    };
    let fee_payer_keypair = keypair_from_hex(fee_payer_private_key)?;

    // Resolve target account using resolve_account_input
    let target_pubkey = crate::commands::rpc::resolve_account_input(Some(target_account), config)?;

    Ok((fee_payer_keypair, target_pubkey))
}

/// Handle account subcommands
pub async fn handle_account_command(
    config: &Config,
    subcommand: AccountCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        AccountCommands::Create { key_name } => {
            create_account(config, key_name.as_deref(), json_format).await
        }
        AccountCommands::Info { key_name } => {
            get_account_info(config, key_name.as_deref(), json_format).await
        }
        AccountCommands::Transactions {
            account,
            page_size,
            page_token,
        } => {
            list_account_transactions(
                config,
                account.as_deref(),
                page_size,
                page_token,
                json_format,
            )
            .await
        }
        AccountCommands::Compress {
            target_account,
            fee_payer,
        } => compress_account(config, fee_payer.as_deref(), &target_account, json_format).await,
        AccountCommands::Decompress {
            target_account,
            fee_payer,
        } => decompress_account(config, fee_payer.as_deref(), &target_account, json_format).await,
        AccountCommands::PrepareDecompression { account } => {
            prepare_account_decompression(config, &account, json_format).await
        }
    }
}

async fn list_account_transactions(
    config: &Config,
    account_input: Option<&str>,
    page_size: Option<u32>,
    page_token: Option<String>,
    json_format: bool,
) -> Result<(), CliError> {
    let account_pubkey = crate::commands::rpc::resolve_account_input(account_input, config)?;
    let client = create_rpc_client(config)?;

    let page = client
        .list_transactions_for_account(&account_pubkey, page_size, page_token)
        .await?;

    let account_str = account_pubkey.to_string();
    let next_page_token = page.next_page_token.clone();
    let signatures: Vec<String> = page.signatures.iter().map(|sig| sig.to_string()).collect();

    let response =
        output::create_account_transactions_response(&account_str, signatures, next_page_token);
    output::print_output(response, json_format);
    Ok(())
}

/// Create a new account with fee payer proof
async fn create_account(
    config: &Config,
    key_name: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Creating account with fee payer proof...");
    }

    // Resolve the key to use
    let key_name = key_name.unwrap_or("default");
    let private_key_hex = config.keys.get_key(key_name).map_err(|_| {
        CliError::Validation(format!("Key '{}' not found in configuration", key_name))
    })?;

    // Create keypair from private key
    let keypair = keypair_from_hex(private_key_hex)?;
    let account_pubkey = &keypair.address_string;

    if !json_format {
        output::print_info(&format!("Account public key: {}", account_pubkey));
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current finalized slot
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
    })?;

    let current_slot = block_height.finalized_height;

    if !json_format {
        output::print_info(&format!("Using slot: {}", current_slot));
    }

    // Create state proof configuration for Creating proof type
    let state_proof_config = MakeStateProofConfig {
        proof_type: ProofType::Creating,
        slot: None,
    };

    if !json_format {
        output::print_info("Calling makeStateProof RPC method...");
    }

    // Call makeStateProof RPC method
    let state_proof_bytes = client
        .make_state_proof(account_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    // Deserialize state proof from bytes
    let state_proof = StateProof::from_wire(&state_proof_bytes).ok_or_else(|| {
        CliError::TransactionSubmission("Failed to parse state proof response".to_string())
    })?;

    if !json_format {
        output::print_success("State proof created successfully");
        output::print_info("Building transaction with fee payer proof...");
    }

    // Build transaction using TransactionBuilder::build_create_with_fee_payer_proof
    let mut transaction = TransactionBuilder::build_create_with_fee_payer_proof(
        keypair.public_key,
        current_slot,
        &state_proof,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    if !json_format {
        output::print_info("Signing transaction...");
    }

    // Sign the transaction
    transaction.sign(&keypair.private_key).map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
    })?;

    if !json_format {
        output::print_info("Submitting transaction...");
    }

    // Submit the transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to submit transaction: {}", e))
        })?;

    // Check if transaction was successful
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, _) = vm_error_strings(transaction_details.vm_error);

        let error_msg = format!(
            "Transaction failed with execution result: {}{}",
            transaction_details.execution_result, vm_error_msg
        );

        let response = output::create_account_create_response(
            key_name,
            account_pubkey.as_str(),
            transaction_details.signature.as_str(),
            "failed",
        );
        output::print_output(response, json_format);

        return Err(CliError::TransactionSubmission(error_msg));
    }

    // Create response
    let response = output::create_account_create_response(
        key_name,
        account_pubkey.as_str(),
        transaction_details.signature.as_str(),
        "success",
    );
    output::print_output(response, json_format);

    if !json_format {
        output::print_success(&format!(
            "Account creation transaction completed. Signature: {}",
            transaction_details.signature.as_str()
        ));
    }

    Ok(())
}

/// Get account information (alias to getaccountinfo)
async fn get_account_info(
    config: &Config,
    key_name: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // This is an alias to the existing getaccountinfo functionality
    // We can reuse the existing implementation (no data_start/data_len for account info subcommand)
    crate::commands::rpc::get_account_info(config, key_name, None, None, json_format).await
}

/// Compress an account
async fn compress_account(
    config: &Config,
    fee_payer: Option<&str>,
    target_account: &str,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Compressing account...");
    }

    // Resolve fee payer and target account
    let (fee_payer_keypair, target_pubkey) =
        resolve_fee_payer_and_target(config, fee_payer, target_account)?;

    if !json_format {
        let fee_payer_name = fee_payer.unwrap_or("default");
        output::print_info(&format!(
            "Fee payer: {} ({})",
            fee_payer_name,
            fee_payer_keypair.address_string.as_str()
        ));
        output::print_info(&format!("Target account: {}", target_pubkey.as_str()));
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current block height
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current block height: {}", e))
    })?;
    let start_slot = block_height.executed_height + 1;

    if !json_format {
        output::print_info(&format!("Using start slot: {}", start_slot));
    }

    let account_info = client
        .get_account_info(&target_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Target account {} does not exist or is already compressed",
                target_pubkey.as_str()
            ))
        })?;

    // Create state proof configuration for Updating proof type (account should exist)
    let state_proof_config = MakeStateProofConfig {
        proof_type: if account_info.is_new {
            ProofType::Creating
        } else {
            ProofType::Updating
        },
        slot: None,
    };

    if !json_format {
        output::print_info("Creating state proof for target account...");
    }

    // Call makeStateProof RPC method for the target account
    let state_proof_bytes = client
        .make_state_proof(&target_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    if !json_format {
        output::print_success("State proof created successfully");
        output::print_info("Building compression transaction...");
    }

    // Get account info to determine account size for compute units calculation
    let account_info = client
        .get_account_info(&target_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account info: {}", e)))?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Target account {} does not exist or is already compressed",
                target_pubkey.as_str()
            ))
        })?;

    let account_size = account_info.data_size as u32;

    if !json_format {
        output::print_info(&format!("Account size: {} bytes", account_size));
    }

    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get fee payer account info: {}", e))
        })?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Fee payer account {} not found. Please ensure the account is funded.",
                fee_payer_keypair.address_string.as_str()
            ))
        })?;

    let nonce = fee_payer_account_info.nonce;

    if !json_format {
        output::print_info(&format!("Fee payer nonce: {}", nonce));
    }

    // Build compression transaction using system program (all zeros)
    let mut transaction = TransactionBuilder::build_compress_account(
        fee_payer_keypair.public_key, // Fee payer
        SYSTEM_PROGRAM,               // System program
        target_pubkey.to_bytes()?,    // Target account to compress
        &state_proof_bytes,           // State proof
        1,                            // Fee
        nonce,                        // Current nonce from blockchain
        start_slot,                   // Start slot
        account_size,                 // Account size for compute units
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build compression transaction: {}", e))
    })?;

    // Set reasonable resource limits
    transaction = transaction
        .with_compute_units(100_300 + account_size * 2)
        .with_state_units(10_000)
        .with_memory_units(10_000)
        .with_expiry_after(100);

    if !json_format {
        output::print_info("Signing transaction...");
    }

    // Sign the transaction with fee payer's private key
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    if !json_format {
        output::print_info("Executing transaction...");
    }

    // Execute the transaction and wait for completion
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    if !json_format {
        output::print_success(&format!(
            "Transaction completed: {}",
            transaction_details.signature.as_str()
        ));

        // Check execution result
        if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
            let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
            output::print_warning(&format!(
                "Transaction completed with execution result: {} vm_error: {}{}",
                transaction_details.execution_result, vm_error_label, vm_error_msg
            ));
        }
    }

    // Check for execution errors
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
            transaction_details.execution_result,
            vm_error_label,
            vm_error_msg,
            transaction_details.user_error_code
        )));
    }

    // Create response
    if json_format {
        let response = serde_json::json!({
            "account_compress": {
                "fee_payer": fee_payer_keypair.address_string.as_str(),
                "target_account": target_pubkey.as_str(),
                "signature": transaction_details.signature.as_str(),
                "status": "success",
                "execution_result": transaction_details.execution_result,
                "vm_error": transaction_details.vm_error,
                "vm_error_name": vm_error_strings(transaction_details.vm_error).1,
                "user_error_code": transaction_details.user_error_code,
                "compute_units_consumed": transaction_details.compute_units_consumed,
                "slot": transaction_details.slot
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("Account compression completed successfully");
        println!("Fee payer: {}", fee_payer_keypair.address_string.as_str());
        println!("Target account: {}", target_pubkey.as_str());
        println!("Signature: {}", transaction_details.signature.as_str());
        println!("Slot: {}", transaction_details.slot);
        println!(
            "Compute units consumed: {}",
            transaction_details.compute_units_consumed
        );
    }

    Ok(())
}

/// Decompress an account
async fn decompress_account(
    config: &Config,
    fee_payer: Option<&str>,
    target_account: &str,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Decompressing account...");
    }

    // Prevent decompressing default account
    if target_account == "default" {
        let error_msg =
            "Cannot decompress 'default' account. Please specify a different target account.";
        if json_format {
            let response = serde_json::json!({
                "error": error_msg
            });
            output::print_output(response, true);
        } else {
            output::print_error(error_msg);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    // Resolve fee payer and target account
    let (fee_payer_keypair, target_pubkey) =
        resolve_fee_payer_and_target(config, fee_payer, target_account)?;

    if !json_format {
        let fee_payer_name = fee_payer.unwrap_or("default");
        output::print_info(&format!(
            "Fee payer: {} ({})",
            fee_payer_name,
            fee_payer_keypair.address_string.as_str()
        ));
        output::print_info(&format!("Target account: {}", target_pubkey.as_str()));
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get decompression data from prepareAccountDecompression
    if !json_format {
        output::print_info("Preparing account decompression...");
    }

    let decomp_response = client
        .prepare_account_decompression(&target_pubkey)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!(
                "Failed to prepare account decompression: {}",
                e
            ))
        })?;

    let decomp_data = base64::engine::general_purpose::STANDARD
        .decode(&decomp_response.account_data)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to decode decompression data: {}", e))
        })?;

    let state_proof_bytes = base64::engine::general_purpose::STANDARD
        .decode(&decomp_response.state_proof)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to decode state proof: {}", e))
        })?;

    if !json_format {
        output::print_info(&format!(
            "Decompression data size: {} bytes",
            decomp_data.len()
        ));
        output::print_info(&format!(
            "State proof size: {} bytes",
            state_proof_bytes.len()
        ));
    }
    if decomp_data.len() < TN_ACCOUNT_META_FOOTPRINT {
        return Err(CliError::Validation(
            "Decompression data is too small to contain metadata".to_string(),
        ));
    }

    // Get current block height
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current block height: {}", e))
    })?;
    let start_slot = block_height.executed_height + 1;

    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get fee payer account info: {}", e))
        })?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Fee payer account {} not found. Please ensure the account is funded.",
                fee_payer_keypair.address_string.as_str()
            ))
        })?;

    let nonce = fee_payer_account_info.nonce;

    // Check if data can fit in a single transaction (32KB limit minus overhead)
    const MAX_TRANSACTION_SIZE: usize = 32_768;
    const TRANSACTION_OVERHEAD: usize = 1024; // Conservative estimate for headers, accounts, etc.
    const MAX_DATA_IN_TRANSACTION: usize = MAX_TRANSACTION_SIZE - TRANSACTION_OVERHEAD;
    const MAX_UPLOADER_SIZE: usize = 16 * 1024 * 1024; // 16MB limit

    if decomp_data.len() <= MAX_DATA_IN_TRANSACTION {
        decompress_direct(
            config,
            &fee_payer_keypair,
            &target_pubkey,
            &decomp_data,
            &state_proof_bytes,
            nonce,
            start_slot,
            json_format,
        )
        .await
    } else if decomp_data.len() <= MAX_UPLOADER_SIZE {
        decompress_with_uploader(
            config,
            &fee_payer_keypair,
            &target_pubkey,
            &decomp_data,
            json_format,
        )
        .await
    } else {
        decompress_with_uploader_huge(
            config,
            &fee_payer_keypair,
            &target_pubkey,
            &decomp_data,
            json_format,
        )
        .await
    }
}

/// Direct decompression using build_decompress_account (for small data)
async fn decompress_direct(
    config: &Config,
    fee_payer_keypair: &thru_base::tn_tools::KeyPair,
    target_pubkey: &thru_base::tn_tools::Pubkey,
    decomp_data: &[u8],
    state_proof_bytes: &[u8],
    nonce: u64,
    start_slot: u64,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Using direct decompression (data fits in single transaction)");
    }

    let mut transaction = TransactionBuilder::build_decompress_account(
        fee_payer_keypair.public_key, // Fee payer
        SYSTEM_PROGRAM,               // System program
        target_pubkey.to_bytes()?,    // Target account to decompress
        decomp_data,                  // Account data
        state_proof_bytes,            // State proof
        1,                            // Fee
        nonce,                        // Current nonce from blockchain
        start_slot,                   // Start slot
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build decompression transaction: {}", e))
    })?;

    if !json_format {
        output::print_info("Signing transaction...");
    }

    // Sign the transaction with fee payer's private key
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    if !json_format {
        output::print_info("Executing transaction...");
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Execute the transaction and wait for completion
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check for execution errors
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
            transaction_details.execution_result,
            vm_error_label,
            vm_error_msg,
            transaction_details.user_error_code
        )));
    }

    // Create response
    if json_format {
        let response = serde_json::json!({
            "account_decompress": {
                "fee_payer": fee_payer_keypair.address_string.as_str(),
                "target_account": target_pubkey.as_str(),
                "signature": transaction_details.signature.as_str(),
                "status": "success",
                "method": "direct",
                "execution_result": transaction_details.execution_result,
                "vm_error": transaction_details.vm_error,
                "vm_error_name": vm_error_strings(transaction_details.vm_error).1,
                "user_error_code": transaction_details.user_error_code,
                "compute_units_consumed": transaction_details.compute_units_consumed,
                "slot": transaction_details.slot
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("Account decompression completed successfully");
        println!("Fee payer: {}", fee_payer_keypair.address_string.as_str());
        println!("Target account: {}", target_pubkey.as_str());
        println!("Signature: {}", transaction_details.signature.as_str());
        println!("Slot: {}", transaction_details.slot);
        println!(
            "Compute units consumed: {}",
            transaction_details.compute_units_consumed
        );
    }

    Ok(())
}

/// Uploader-based decompression using DECOMPRESS2 (for large data)
async fn decompress_with_uploader(
    config: &Config,
    fee_payer_keypair: &thru_base::tn_tools::KeyPair,
    target_pubkey: &thru_base::tn_tools::Pubkey,
    decomp_data: &[u8],
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info(
            "Using uploader-based decompression (data too large for single transaction)",
        );
    }

    let parsed_account_meta = TnAccountMeta::from_wire(&decomp_data[0..TN_ACCOUNT_META_FOOTPRINT])
        .ok_or_else(|| CliError::Validation("Failed to parse account meta".to_string()))?;
    if !json_format {
        output::print_info(&format!("parsed account meta: {:?}", parsed_account_meta));
    }

    // Get uploader program public key
    let uploader_program_pubkey = config.get_uploader_pubkey()?;

    // Generate a random seed for ephemeral accounts
    let mut seed_bytes = [3u8; 16];
    rand::Rng::fill(&mut rand::rng(), &mut seed_bytes);
    let seed = hex::encode(seed_bytes);

    // Derive ephemeral accounts for the uploader
    let (meta_account, buffer_account) =
        crate::crypto::derive_uploader_accounts_from_seed(&seed, &uploader_program_pubkey)?;

    if !json_format {
        output::print_info(&format!("Creating ephemeral accounts for decompression:"));
        output::print_info(&format!("  Meta account: {}", meta_account));
        output::print_info(&format!("  Buffer account: {}", buffer_account));
    }

    // Create uploader manager for uploading decompression data
    let mut uploader_config = config.clone();
    uploader_config.uploader_program_public_key = uploader_program_pubkey.to_string();
    let uploader = crate::commands::uploader::UploaderManager::new(&uploader_config).await?;

    // Upload the decompression data using the uploader
    const CHUNK_SIZE: usize = 31 * 1024;
    let _upload_session = uploader
        .upload_program(&seed, decomp_data, CHUNK_SIZE, json_format)
        .await?;

    if !json_format {
        output::print_success("Decompression data uploaded successfully");
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Determine if we need separate meta and data accounts
    let meta_size = thru_base::tn_account::TN_ACCOUNT_META_FOOTPRINT;

    // need to get state proof again, because while uploading we created many transaction, and proof we have is too old now
    let state_proof_config = MakeStateProofConfig {
        proof_type: ProofType::Existing,
        slot: None,
    };
    let state_proof_bytes = client
        .make_state_proof(&target_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    if !json_format {
        output::print_info(&format!("State proof size: {}", state_proof_bytes.len()));
    }
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current block height: {}", e))
    })?;
    let start_slot = block_height.executed_height + 1;
    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get fee payer account info: {}", e))
        })?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Fee payer account {} not found. Please ensure the account is funded.",
                fee_payer_keypair.address_string.as_str()
            ))
        })?;

    let nonce = fee_payer_account_info.nonce;
    if !json_format {
        output::print_info(&format!("Decompression data size: {}", decomp_data.len()));
    }

    let mut transaction = TransactionBuilder::build_decompress2(
        fee_payer_keypair.public_key,
        SYSTEM_PROGRAM, // System program
        target_pubkey.to_bytes()?,
        buffer_account.to_bytes()?, // meta_account (same as data_account)
        buffer_account.to_bytes()?, // data_account (same as meta_account)
        meta_size as u32,           // data_offset = meta size
        &state_proof_bytes,
        1,
        nonce,
        start_slot,
        decomp_data.len() as u32,
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build DECOMPRESS2 transaction: {}", e))
    })?;

    // Sign and execute
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(30);
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check for execution errors
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
            transaction_details.execution_result,
            vm_error_label,
            vm_error_msg,
            transaction_details.user_error_code
        )));
    }

    // Create response
    if json_format {
        let method = if decomp_data.len() > meta_size {
            "uploader_separate_accounts"
        } else {
            "uploader_single_account"
        };
        let mut response = serde_json::json!({
            "account_decompress": {
                "fee_payer": fee_payer_keypair.address_string.as_str(),
                "target_account": target_pubkey.as_str(),
                "signature": transaction_details.signature.as_str(),
                "status": "success",
                "method": method,
                "execution_result": transaction_details.execution_result,
                "vm_error": transaction_details.vm_error,
                "vm_error_name": vm_error_strings(transaction_details.vm_error).1,
                "user_error_code": transaction_details.user_error_code,
                "compute_units_consumed": transaction_details.compute_units_consumed,
                "slot": transaction_details.slot
            }
        });

        if decomp_data.len() > meta_size {
            response["account_decompress"]["meta_account"] =
                serde_json::Value::String(meta_account.to_string());
            response["account_decompress"]["buffer_account"] =
                serde_json::Value::String(buffer_account.to_string());
        } else {
            response["account_decompress"]["ephemeral_account"] =
                serde_json::Value::String(buffer_account.to_string());
        }

        output::print_output(response, true);
    } else {
        if decomp_data.len() > meta_size {
            output::print_success(
                "Account decompression completed successfully using separate accounts",
            );
            println!("Meta account: {}", meta_account);
            println!("Buffer account: {}", buffer_account);
        } else {
            output::print_success(
                "Account decompression completed successfully using single ephemeral account",
            );
            println!("Ephemeral account: {}", buffer_account);
        }
        println!("Fee payer: {}", fee_payer_keypair.address_string.as_str());
        println!("Target account: {}", target_pubkey.as_str());
        println!("Signature: {}", transaction_details.signature.as_str());
        println!("Slot: {}", transaction_details.slot);
        println!(
            "Compute units consumed: {}",
            transaction_details.compute_units_consumed
        );
    }

    // Clean up ephemeral accounts
    if !json_format {
        output::print_info("Cleaning up ephemeral accounts...");
    }

    match uploader.cleanup_program(&seed, json_format).await {
        Ok(()) => {
            if !json_format {
                output::print_success("Ephemeral accounts cleaned up successfully");
            }
        }
        Err(e) => {
            if !json_format {
                output::print_warning(&format!("Failed to clean up ephemeral accounts: {}", e));
            }
            // Don't fail the whole operation for cleanup issues
        }
    }

    Ok(())
}

/// Uploader-based decompression for huge data (>16MB) using DECOMPRESS2 with separate accounts
async fn decompress_with_uploader_huge(
    config: &Config,
    fee_payer_keypair: &thru_base::tn_tools::KeyPair,
    target_pubkey: &thru_base::tn_tools::Pubkey,
    decomp_data: &[u8],
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Using uploader-based decompression for huge data (>16MB)");
    }

    // Get uploader program public key
    let uploader_program_pubkey = config.get_uploader_pubkey()?;

    // Generate a random seed for ephemeral accounts
    let mut meta_seed_bytes = [1u8; 16];
    rand::Rng::fill(&mut rand::rng(), &mut meta_seed_bytes);
    let meta_seed = hex::encode(meta_seed_bytes);

    // Generate a different seed for buffer account
    let mut buffer_seed_bytes = [2u8; 16];
    rand::Rng::fill(&mut rand::rng(), &mut buffer_seed_bytes);
    let buffer_seed = hex::encode(buffer_seed_bytes);

    // Derive ephemeral accounts for the uploader - meta account from first seed, buffer account from second seed
    let (_, meta_account) =
        crate::crypto::derive_uploader_accounts_from_seed(&meta_seed, &uploader_program_pubkey)?;
    let (_, buffer_account) =
        crate::crypto::derive_uploader_accounts_from_seed(&buffer_seed, &uploader_program_pubkey)?;

    if !json_format {
        output::print_info(&format!(
            "Creating ephemeral accounts for huge decompression:"
        ));
        output::print_info(&format!(
            "  Meta account: {} (seed: {})",
            meta_account, meta_seed
        ));
        output::print_info(&format!(
            "  Buffer account: {} (seed: {})",
            buffer_account, buffer_seed
        ));
    }

    // Create uploader manager for uploading decompression data
    let mut uploader_config = config.clone();
    uploader_config.uploader_program_public_key = uploader_program_pubkey.to_string();
    let uploader = crate::commands::uploader::UploaderManager::new(&uploader_config).await?;

    // Split the data: first 64 bytes go to meta account, rest goes to buffer account
    if decomp_data.len() < TN_ACCOUNT_META_FOOTPRINT {
        return Err(CliError::Validation(
            "Decompression data is too small to contain metadata".to_string(),
        ));
    }

    let meta_data = &decomp_data[..TN_ACCOUNT_META_FOOTPRINT];
    let buffer_data = &decomp_data[TN_ACCOUNT_META_FOOTPRINT..];

    if !json_format {
        output::print_info(&format!(
            "Uploading metadata ({} bytes) to meta account",
            meta_data.len()
        ));
    }

    // Upload metadata to meta account (using the first derived account as buffer for metadata)
    const CHUNK_SIZE: usize = 31 * 1024;
    let _meta_upload_session = uploader
        .upload_program(&meta_seed, meta_data, CHUNK_SIZE, json_format)
        .await?;

    if !json_format {
        output::print_info(&format!(
            "Uploading buffer data ({} bytes) to buffer account",
            buffer_data.len()
        ));
    }

    // Create a separate uploader manager for the buffer data
    let buffer_uploader = crate::commands::uploader::UploaderManager::new(&uploader_config).await?;

    // Upload buffer data to buffer account using a different seed
    let _buffer_upload_session = buffer_uploader
        .upload_program(&buffer_seed, buffer_data, CHUNK_SIZE, json_format)
        .await?;

    if !json_format {
        output::print_success("Huge decompression data uploaded successfully");
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    if !json_format {
        output::print_info("Creating DECOMPRESS2 transaction for huge data");
    }

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current block height: {}", e))
    })?;
    let start_slot = block_height.executed_height + 1;
    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get fee payer account info: {}", e))
        })?
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Fee payer account {} not found. Please ensure the account is funded.",
                fee_payer_keypair.address_string.as_str()
            ))
        })?;

    let nonce = fee_payer_account_info.nonce;

    // need to get state proof again, because while uploading we created many transaction, and proof we have is too old now
    let state_proof_config = MakeStateProofConfig {
        proof_type: ProofType::Existing,
        slot: None,
    };
    let state_proof_bytes = client
        .make_state_proof(&target_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    // Create DECOMPRESS2 transaction using separate meta and data accounts
    let mut transaction = TransactionBuilder::build_decompress2(
        fee_payer_keypair.public_key,
        SYSTEM_PROGRAM, // System program
        target_pubkey.to_bytes()?,
        meta_account.to_bytes()?,   // meta_account
        buffer_account.to_bytes()?, // data_account (buffer_account)
        0,                          // data_offset = 0 (data starts at beginning of buffer_account)
        &state_proof_bytes,
        1,
        nonce,
        start_slot,
        buffer_data.len() as u32, // Only count the buffer data size
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build DECOMPRESS2 transaction: {}", e))
    })?;

    // Set reasonable resource limits for huge data
    // transaction = transaction
    //     .with_compute_units(100_300 + decomp_data.len() as u32 * 2)
    //     .with_state_units(20_000)  // Increased for huge data
    //     .with_memory_units(20_000) // Increased for huge data
    //     .with_expiry_after(100);

    // Sign and execute
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(60); // Increased timeout for huge data
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    // Check for execution errors
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
            transaction_details.execution_result,
            vm_error_label,
            vm_error_msg,
            transaction_details.user_error_code
        )));
    }

    // Create response
    if json_format {
        let response = serde_json::json!({
            "account_decompress": {
                "fee_payer": fee_payer_keypair.address_string.as_str(),
                "target_account": target_pubkey.as_str(),
                "signature": transaction_details.signature.as_str(),
                "status": "success",
                "method": "uploader_huge_separate_accounts",
                "execution_result": transaction_details.execution_result,
                "vm_error": transaction_details.vm_error,
                "vm_error_name": vm_error_strings(transaction_details.vm_error).1,
                "user_error_code": transaction_details.user_error_code,
                "compute_units_consumed": transaction_details.compute_units_consumed,
                "slot": transaction_details.slot,
                "meta_account": meta_account.to_string(),
                "buffer_account": buffer_account.to_string(),
                "total_data_size": decomp_data.len(),
                "meta_data_size": meta_data.len(),
                "buffer_data_size": buffer_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success(
            "Huge account decompression completed successfully using separate accounts",
        );
        println!("Meta account: {}", meta_account);
        println!("Buffer account: {}", buffer_account);
        println!("Fee payer: {}", fee_payer_keypair.address_string.as_str());
        println!("Target account: {}", target_pubkey.as_str());
        println!("Signature: {}", transaction_details.signature.as_str());
        println!("Slot: {}", transaction_details.slot);
        println!(
            "Compute units consumed: {}",
            transaction_details.compute_units_consumed
        );
        println!("Total data size: {} bytes", decomp_data.len());
        println!("Meta data size: {} bytes", meta_data.len());
        println!("Buffer data size: {} bytes", buffer_data.len());
    }

    // Clean up ephemeral accounts
    if !json_format {
        output::print_info("Cleaning up ephemeral accounts...");
    }

    // Clean up meta account
    match uploader.cleanup_program(&meta_seed, json_format).await {
        Ok(()) => {
            if !json_format {
                output::print_success("Meta account cleaned up successfully");
            }
        }
        Err(e) => {
            if !json_format {
                output::print_warning(&format!("Failed to clean up meta account: {}", e));
            }
            // Don't fail the whole operation for cleanup issues
        }
    }

    // Clean up buffer account
    match buffer_uploader
        .cleanup_program(&buffer_seed, json_format)
        .await
    {
        Ok(()) => {
            if !json_format {
                output::print_success("Buffer account cleaned up successfully");
            }
        }
        Err(e) => {
            if !json_format {
                output::print_warning(&format!("Failed to clean up buffer account: {}", e));
            }
            // Don't fail the whole operation for cleanup issues
        }
    }

    Ok(())
}

/// Prepare account decompression data and proof
async fn prepare_account_decompression(
    config: &Config,
    account: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;

    // Resolve account address (either from config key name or direct address)
    let account_pubkey = if account.starts_with("ta") && account.len() == 46 {
        // Direct ta... address
        thru_base::tn_tools::Pubkey::new(account.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid account address: {}", e)))?
    } else {
        // Try to resolve from config keys
        let private_key_hex = config.keys.get_key(account)
            .map_err(|_| CliError::Validation(format!("Account '{}' not found in configuration. Use a ta... address or add the key to configuration.", account)))?;

        let keypair = crate::crypto::keypair_from_hex(private_key_hex)?;
        keypair.address_string
    };

    if !json_format {
        output::print_info(&format!(
            "Preparing decompression for account: {}",
            account_pubkey.as_str()
        ));
    }

    // Call the RPC method
    match client.prepare_account_decompression(&account_pubkey).await {
        Ok(response) => {
            if json_format {
                let result = serde_json::json!({
                    "status": "success",
                    "account": account_pubkey.as_str(),
                    "account_data": response.account_data,
                    "state_proof": response.state_proof
                });
                output::print_output(result, true);
            } else {
                output::print_success(&format!(
                    "Account decompression prepared for: {}",
                    account_pubkey.as_str()
                ));
                println!("Account Data (base64): {}", response.account_data);
                println!("State Proof (base64): {}", response.state_proof);
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to prepare account decompression: {}", e);
            if json_format {
                let result = serde_json::json!({
                    "status": "error",
                    "account": account_pubkey.as_str(),
                    "error": error_msg
                });
                output::print_output(result, true);
            } else {
                output::print_error(&error_msg);
            }
            return Err(CliError::Validation(error_msg));
        }
    }

    Ok(())
}

/// Create an RPC client from configuration
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .build()
        .map_err(|e| e.into())
}

fn vm_error_strings(code: i32) -> (String, String) {
    let label = format_vm_error(code);
    let message = if code != 0 {
        format!(" (VM error: {})", label)
    } else {
        String::new()
    };
    (message, label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_rpc_client() {
        let config = Config::default();
        let client = create_rpc_client(&config);
        assert!(client.is_ok());
    }
}
