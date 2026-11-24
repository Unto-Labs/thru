//! Account management command implementations

use base64::Engine;
use std::sync::Arc;
use std::time::Duration;
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_account::{TN_ACCOUNT_META_FOOTPRINT, TnAccountMeta};
use thru_base::{StateProof, TransactionBuilder};

use crate::cli::AccountCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::keys::LoadedKey;
use crate::output;
use crate::signing::{ResolvedSigner, resolve_signer, resolve_signer_reusing_ledger};
use crate::utils::format_vm_error;
use thru_base::signer::{EoaAuthKind, sign_eoa_auth_with};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::EOA_PROGRAM;
use thru_client::{Client, ClientBuilder};

/// Helper function to resolve fee payer and target account
fn resolve_fee_payer_and_target(
    config: &Config,
    fee_payer: Option<&str>,
    target_account: &str,
) -> Result<(Arc<LoadedKey>, thru_base::tn_tools::Pubkey), CliError> {
    let fee_payer_keypair = config.keys.load_key(fee_payer.unwrap_or("default"))?;

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
        AccountCommands::CreateEoa {
            account,
            ledger,
            fee_payer,
        } => {
            let (name, require_ledger) = match (account, ledger) {
                (Some(a), None) => (a, false),
                (None, Some(l)) => (l, true),
                _ => {
                    return Err(CliError::Validation(
                        "Pass the account key either as an argument or with --ledger".into(),
                    ));
                }
            };
            create_eoa(
                config,
                &name,
                require_ledger,
                fee_payer.as_deref(),
                json_format,
            )
            .await
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

    // Resolve the key to use (local key, Ledger key, or `ledger://` URI)
    let key_name = key_name.unwrap_or("default");
    let signer = resolve_signer(config, key_name)?;
    let account_pubkey = &signer.address;

    if !json_format {
        output::print_info(&format!("Account public key: {}", account_pubkey));
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current locally executed slot (the transaction start-slot clock)
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
    })?;

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    let current_slot = block_height.locally_executed_height;

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
    let transaction = TransactionBuilder::build_create_with_fee_payer_proof(
        signer.public_key,
        current_slot,
        &state_proof,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    if !json_format {
        output::print_info("Signing transaction...");
    }

    // Set chain ID and sign the transaction
    let mut transaction = transaction.with_chain_id(chain_info.chain_id);
    let transaction_bytes = crate::signing::sign_transaction_for(&mut transaction, &signer, |e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {e}"))
    })?;

    if !json_format {
        output::print_info("Submitting transaction...");
    }

    // Submit exactly the signed bytes
    let timeout = Duration::from_secs(config.timeout_seconds);
    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(CliError::from)?;

    // Check if transaction was successful
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, _) = vm_error_strings(transaction_details.vm_error);

        let error_msg = format!(
            "Transaction failed with execution result: {}{}",
            transaction_details.execution_result as i64, vm_error_msg
        );

        let response = output::create_account_create_response(
            key_name,
            account_pubkey.as_str(),
            transaction_details.signature.as_str(),
            "failed",
        );
        let response = signer.add_ledger_preview(response, "account_create");
        let response = signer.add_trezor_preview(response, "account_create");
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
    let response = signer.add_ledger_preview(response, "account_create");
    let response = signer.add_trezor_preview(response, "account_create");
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

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    let start_slot = block_height.executed_height + 1;

    if !json_format {
        output::print_info(&format!("Using start slot: {}", start_slot));
    }

    let account_info = client
        .get_account_info(&target_pubkey, None, None)
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
        .get_account_info(&target_pubkey, None, None)
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
        .get_account_info(&fee_payer_keypair.address_string, None, None)
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
        config.get_system_test_program_pubkey()?.to_bytes()?,
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

    // Set reasonable resource limits and chain ID
    transaction = transaction
        .with_compute_units(100_300 + account_size * 2)
        .with_state_units(0)
        .with_memory_units(10_000)
        .with_expiry_after(100)
        .with_chain_id(chain_info.chain_id);

    if !json_format {
        output::print_info("Signing transaction...");
    }

    // Sign the transaction with fee payer's private key
    crate::signing::sign_transaction(&mut transaction, &fee_payer_keypair).map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
    })?;

    if !json_format {
        output::print_info("Executing transaction...");
    }

    // Execute the transaction and wait for completion
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);
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
                transaction_details.execution_result as i64, vm_error_label, vm_error_msg
            ));
        }
    }

    // Check for execution errors
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let (vm_error_msg, vm_error_label) = vm_error_strings(transaction_details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
            transaction_details.execution_result as i64,
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

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    let start_slot = block_height.executed_height + 1;

    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
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
            chain_info.chain_id,
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
    fee_payer_keypair: &Arc<LoadedKey>,
    target_pubkey: &thru_base::tn_tools::Pubkey,
    decomp_data: &[u8],
    state_proof_bytes: &[u8],
    nonce: u64,
    start_slot: u64,
    chain_id: u16,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        output::print_info("Using direct decompression (data fits in single transaction)");
    }

    let transaction = TransactionBuilder::build_decompress_account(
        fee_payer_keypair.public_key, // Fee payer
        config.get_system_test_program_pubkey()?.to_bytes()?,
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

    // Set chain ID and sign the transaction with fee payer's private key
    let mut transaction = transaction.with_chain_id(chain_id);
    crate::signing::sign_transaction(&mut transaction, fee_payer_keypair).map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
    })?;

    if !json_format {
        output::print_info("Executing transaction...");
    }

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Execute the transaction and wait for completion
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);
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
            transaction_details.execution_result as i64,
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
    fee_payer_keypair: &Arc<LoadedKey>,
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
    rand::RngExt::fill(&mut rand::rng(),&mut seed_bytes);
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
    let uploader = crate::commands::uploader::UploaderManager::new_with_keypair(
        &uploader_config,
        Arc::clone(fee_payer_keypair),
    )
    .await?;

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

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
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
        config.get_system_test_program_pubkey()?.to_bytes()?,
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

    // Set chain ID and sign
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, fee_payer_keypair).map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
    })?;

    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(config.timeout_seconds);
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
            transaction_details.execution_result as i64,
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
    fee_payer_keypair: &Arc<LoadedKey>,
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
    rand::RngExt::fill(&mut rand::rng(),&mut meta_seed_bytes);
    let meta_seed = hex::encode(meta_seed_bytes);

    // Generate a different seed for buffer account
    let mut buffer_seed_bytes = [2u8; 16];
    rand::RngExt::fill(&mut rand::rng(),&mut buffer_seed_bytes);
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
    let uploader = crate::commands::uploader::UploaderManager::new_with_keypair(
        &uploader_config,
        Arc::clone(fee_payer_keypair),
    )
    .await?;

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
    let buffer_uploader = crate::commands::uploader::UploaderManager::new_with_keypair(
        &uploader_config,
        fee_payer_keypair.clone(),
    )
    .await?;

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

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    // Get current nonce for fee payer account
    let fee_payer_account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
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
        config.get_system_test_program_pubkey()?.to_bytes()?,
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

    // Set chain ID and sign
    transaction = transaction.with_chain_id(chain_info.chain_id);
    crate::signing::sign_transaction(&mut transaction, fee_payer_keypair).map_err(|e| {
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
            transaction_details.execution_result as i64,
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

    let account_pubkey =
        thru_base::tn_tools::Pubkey::from_bytes(&config.keys.resolve_public_key(account)?);

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

/// EOA program CREATE_ACCOUNT discriminant (`tn_eoa_program.h`).
const EOA_INSTRUCTION_CREATE_ACCOUNT: u32 = 0;

/// Build the EOA program CREATE_ACCOUNT instruction:
/// `[discriminant u32][proof_size u64][eoa_account_idx u16][signature 64][proof]`
/// (`tn_eoa_create_account_args_t`, little-endian).
pub fn build_eoa_create_instruction(
    eoa_account_idx: u16,
    signature: &[u8; 64],
    proof: &[u8],
) -> Vec<u8> {
    let mut data = Vec::with_capacity(4 + 8 + 2 + 64 + proof.len());
    data.extend_from_slice(&EOA_INSTRUCTION_CREATE_ACCOUNT.to_le_bytes());
    data.extend_from_slice(&(proof.len() as u64).to_le_bytes());
    data.extend_from_slice(&eoa_account_idx.to_le_bytes());
    data.extend_from_slice(signature);
    data.extend_from_slice(proof);
    data
}

/// Build the EOA-creation transaction: `fee_payer` pays, the EOA program
/// creates `account` (the only read-write account, index 2) after the runtime
/// verifies `signature` (the account key's `tn_eoa_create_v1` authorization).
pub fn build_eoa_create_transaction(
    fee_payer: [u8; 32],
    account: [u8; 32],
    signature: &[u8; 64],
    proof: &[u8],
    nonce: u64,
    start_slot: u64,
    chain_id: u16,
) -> Transaction {
    Transaction::new(fee_payer, EOA_PROGRAM, 1, nonce)
        .with_start_slot(start_slot)
        .with_chain_id(chain_id)
        .add_rw_account(account)
        .with_instructions(build_eoa_create_instruction(2, signature, proof))
        .with_expiry_after(100)
        .with_compute_units(1_000_000)
        .with_memory_units(10_000)
        .with_state_units(1)
}

/// What a key does in `account create-eoa`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EoaRole {
    /// The new account: its key signs the EOA create authorization.
    Account,
    /// The key that pays: it signs the creation transaction.
    FeePayer,
}

/// Whether the key `reference` selects may play `role`. Every key may be the
/// account: a Trezor signs the authorization, which the app shows. A Trezor
/// key may not pay: the creation transaction is one the Thru app does not show,
/// and the app does not sign blind. Decided from the configuration alone, so
/// that nothing touches a device or a node when it is refused.
fn check_eoa_role(
    keys: &crate::keys::KeyManager,
    reference: &str,
    role: EoaRole,
) -> Result<(), CliError> {
    match role {
        EoaRole::Account => Ok(()),
        EoaRole::FeePayer => {
            if keys.trezor_source(reference)?.is_some() {
                return Err(CliError::Validation(
                    "a Trezor key cannot pay for an EOA creation: the Thru app on the Trezor \
                     does not show that transaction and does not sign blind; pass --fee-payer \
                     with a local or a Ledger key"
                        .to_string(),
                ));
            }
            Ok(())
        }
    }
}

fn sign_eoa_authorization(
    signer: &ResolvedSigner,
    chain_id: u16,
    fee_payer: &[u8; 32],
) -> Result<[u8; 64], CliError> {
    if let Some(trezor) = &signer.trezor {
        let review = crate::trezor_preview::eoa_auth_review(
            EoaAuthKind::Create,
            chain_id,
            fee_payer,
            &signer.public_key,
            &trezor.pubkey(),
            trezor.path(),
        );
        signer.set_trezor_review(review.clone());
        return crate::signing::eprint_trezor_review_then(review.as_ref(), || {
            trezor.try_sign_eoa_auth(EoaAuthKind::Create, chain_id, fee_payer, &signer.public_key)
        })
        .map_err(crate::signing::trezor_error);
    }
    if let Some(ledger) = &signer.ledger {
        return ledger
            .try_sign_eoa_auth(EoaAuthKind::Create, chain_id, fee_payer, &signer.public_key)
            .map_err(crate::signing::ledger_error);
    }
    sign_eoa_auth_with(
        signer.signer.as_ref(),
        EoaAuthKind::Create,
        chain_id,
        fee_payer,
        &signer.public_key,
    )
    .map_err(|e| CliError::Crypto(format!("Failed to sign EOA authorization: {e}")))
}

/// `thru account create-eoa`: create an EOA for `account` (typically a Ledger
/// or a Trezor key) with the fee paid by another key.  The account key signs the EOA
/// create authorization (SIGN_EOA_AUTH on a Ledger, the EOA authorization of
/// the Thru app on a Trezor); the fee payer signs the
/// transaction.
pub async fn create_eoa(
    config: &Config,
    account: &str,
    require_ledger: bool,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_name = fee_payer.unwrap_or("default");
    // Refuse before connecting to (and pairing with) a Trezor that cannot do it.
    check_eoa_role(&config.keys, account, EoaRole::Account)?;
    check_eoa_role(&config.keys, fee_payer_name, EoaRole::FeePayer)?;

    let account_ledger = config.keys.ledger_source(account)?;
    if require_ledger && account_ledger.is_none() {
        return Err(CliError::Validation(format!(
            "Key '{}' is not a Ledger key; add one with 'thru keys add-ledger' or drop --ledger",
            account
        )));
    }
    // Refuse the same key before contacting a device: the same Ledger path, or
    // the same registered (or explicitly selected) local key.
    let fee_payer_ledger = config.keys.ledger_source(fee_payer_name)?;
    let same_key = match (&account_ledger, &fee_payer_ledger) {
        (Some((account_path, _)), Some((fee_payer_path, _))) => account_path == fee_payer_path,
        (None, None) => match config.keys.trezor_source(account)? {
            // The Trezor is not asked before the fee payer is known to differ;
            // an unregistered one is compared after both are connected.
            Some(target) => target.expected() == Some(config.keys.public_key(fee_payer_name)?),
            None => config.keys.public_key(account)? == config.keys.public_key(fee_payer_name)?,
        },
        _ => false,
    };
    if same_key {
        return Err(CliError::Validation(
            "The new account cannot pay for its own EOA creation; pass --fee-payer <funded key> \
             (or use 'thru account create' for a fee-payer-proof self creation)"
                .to_string(),
        ));
    }

    // Both paths on one Ledger must use one HID connection and device lock.
    let account_signer = resolve_signer(config, account)?;
    let fee_payer_signer =
        resolve_signer_reusing_ledger(config, fee_payer_name, account_signer.ledger.as_deref())?;
    if account_signer.public_key == fee_payer_signer.public_key {
        return Err(CliError::Validation(
            "The fee payer and the new account are the same key".to_string(),
        ));
    }

    if !json_format {
        output::print_info(&format!(
            "Creating EOA {} (fee payer {})",
            account_signer.address, fee_payer_signer.address
        ));
    }

    let client = create_rpc_client(config)?;

    if let Some(existing) = client
        .get_account_info(&account_signer.address, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?
        && !existing.is_new
    {
        return Err(CliError::Validation(format!(
            "Account {} already exists",
            account_signer.address
        )));
    }

    let nonce = client
        .get_account_info(&fee_payer_signer.address, None, None)
        .await
        .map_err(|e| CliError::NonceManagement(format!("Failed to get fee payer info: {}", e)))?
        .map(|a| a.nonce)
        .ok_or_else(|| {
            CliError::AccountNotFound(format!(
                "Fee payer account {} not found",
                fee_payer_signer.address
            ))
        })?;
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
    })?;
    let chain_id = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?
        .chain_id;

    let proof = crate::commands::state_proof::make_state_proof(
        &client,
        &account_signer.address,
        ProofType::Creating,
        None,
    )
    .await?;

    let authorization =
        sign_eoa_authorization(&account_signer, chain_id, &fee_payer_signer.public_key)?;

    let mut transaction = build_eoa_create_transaction(
        fee_payer_signer.public_key,
        account_signer.public_key,
        &authorization,
        &proof,
        nonce,
        block_height.locally_executed_height,
        chain_id,
    );
    let wire = crate::signing::sign_transaction_for(&mut transaction, &fee_payer_signer, |e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {e}"))
    })?;

    let timeout = Duration::from_secs(config.timeout_seconds);
    let details = client
        .execute_transaction(&wire, timeout)
        .await
        .map_err(CliError::from)?;
    let failed = details.execution_result != 0 || details.vm_error != 0;
    let response = serde_json::json!({
        "account_create_eoa": {
            "account": account,
            "public_key": account_signer.address.as_str(),
            "fee_payer": fee_payer_signer.address.as_str(),
            "ledger": account_signer.is_ledger(),
            "signature": details.signature.as_str(),
            "status": if failed { "failed" } else { "success" },
            // The EOA authorization reviewed on the account's Ledger, and the
            // transaction reviewed on the fee payer's Ledger (null for
            // local keys).
            "ledger_preview": account_signer.ledger_preview_json(),
            "fee_payer_ledger_preview": fee_payer_signer.ledger_preview_json(),
        }
    });
    // The EOA authorization reviewed on the account's Trezor (a Trezor cannot
    // be the fee payer).
    let response = account_signer.add_trezor_preview(response, "account_create_eoa");
    output::print_output(response, json_format);
    if failed {
        let (vm_error_msg, _) = vm_error_strings(details.vm_error);
        return Err(CliError::TransactionSubmission(format!(
            "EOA creation failed with execution result: {}{}",
            details.execution_result as i64, vm_error_msg
        )));
    }
    if !json_format {
        output::print_success(&format!(
            "EOA {} created. Signature: {}",
            account_signer.address,
            details.signature.as_str()
        ));
    }
    Ok(())
}

/// Create an RPC client from configuration
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.rpc_auth_token())
        .announce_pending_signature(config.announce_pending_signature)
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

    #[test]
    fn fee_payer_accepts_unregistered_file_reference() {
        let (_guard, keys) =
            crate::keys::KeyManager::test_fixture(&[("payer", [1u8; 32]), ("target", [2u8; 32])]);
        let mut config = Config {
            keys,
            ..Config::default()
        };
        let expected_payer = config.keys.public_key("payer").unwrap();
        let expected_target = config.keys.public_key("target").unwrap();
        let reference = config.keys.get_entry("payer").unwrap().reference();
        config.keys.remove_key("payer").unwrap();
        let mut target = config.keys.get_entry("target").unwrap().clone();
        target.source = crate::keys::KeySource::MacosKeychain {
            id: "unavailable-account-public-metadata-test".to_string(),
        };
        config.keys.insert_entry("target", target, true).unwrap();

        let (payer, target) =
            resolve_fee_payer_and_target(&config, Some(&reference), "target").unwrap();
        assert_eq!(payer.public_key, expected_payer);
        assert_eq!(target.to_bytes().unwrap(), expected_target);
    }

    #[test]
    fn fee_payer_preserves_explicit_source_error() {
        let guard = tempfile::tempdir().unwrap();
        let reference = format!("file:{}", guard.path().join("missing.key").display());
        let config = Config::default();
        let expected = config.keys.load_key(&reference).unwrap_err().to_string();
        let error = resolve_fee_payer_and_target(&config, Some(&reference), "target").unwrap_err();
        assert_eq!(error.to_string(), expected);
    }

    #[tokio::test]
    async fn test_create_rpc_client() {
        let config = Config::default();
        let client = create_rpc_client(&config);
        assert!(client.is_ok());
    }

    /// The EOA creation transaction built for a Ledger account: the device
    /// signs the 82-byte authorization (SIGN_EOA_AUTH), a local fee payer
    /// signs the transaction, and the layout matches tn_eoa_create_account_args_t.
    #[test]
    fn eoa_create_with_ledger_authorization() {
        use std::sync::Arc;
        use thru_base::signer::Signer;
        use thru_ledger::DerivationPath;
        use thru_ledger::mock::{Review, SoftDevice};

        let dev = Arc::new(SoftDevice::abandon());
        let ledger =
            crate::signing::connect_ledger_with(dev.clone(), DerivationPath::new(0).unwrap(), None)
                .unwrap();
        let fee_payer = crate::crypto::keypair_from_hex(&"11".repeat(32)).unwrap();
        let proof = vec![0xABu8; 40];
        let auth = sign_eoa_auth_with(
            &ledger,
            EoaAuthKind::Create,
            1,
            &fee_payer.public_key,
            &ledger.public_key(),
        )
        .unwrap();
        assert!(matches!(
            dev.reviews().last(),
            Some(Review::EoaAuth {
                kind: 0,
                chain_id: 1,
                ..
            })
        ));

        let ix = build_eoa_create_instruction(2, &auth, &proof);
        assert_eq!(ix.len(), 78 + proof.len());
        assert_eq!(&ix[0..4], &0u32.to_le_bytes());
        assert_eq!(&ix[4..12], &(proof.len() as u64).to_le_bytes());
        assert_eq!(&ix[12..14], &2u16.to_le_bytes());
        assert_eq!(&ix[14..78], &auth);

        let mut tx = build_eoa_create_transaction(
            fee_payer.public_key,
            ledger.public_key(),
            &auth,
            &proof,
            7,
            100,
            1,
        );
        crate::signing::sign_transaction(&mut tx, &fee_payer).unwrap();
        assert!(tx.verify());
        assert_eq!(tx.rw_accs.as_deref(), Some(&[ledger.public_key()][..]));
    }

    #[test]
    fn eoa_creation_with_two_paths_on_one_ledger() {
        use std::sync::Arc;
        use thru_ledger::DerivationPath;
        use thru_ledger::mock::{Review, SoftDevice};

        let device = Arc::new(SoftDevice::abandon());
        let account_path = DerivationPath::new(0).unwrap();
        let fee_path = DerivationPath::new(1).unwrap();
        let ledger =
            crate::signing::connect_ledger_with(device.clone(), account_path, None).unwrap();
        let account = ResolvedSigner::from_ledger("account", account_path, ledger);
        let fee_entry = |public_key: String| crate::keys::KeyEntry {
            public_key,
            source: crate::keys::KeySource::Ledger { path: fee_path },
        };
        let mut config = Config::default();

        // A key registered from a different device or passphrase is still rejected.
        config
            .keys
            .insert_entry("fee", fee_entry(account.address.to_string()), false)
            .unwrap();
        let error = resolve_signer_reusing_ledger(&config, "fee", account.ledger.as_deref())
            .err()
            .expect("wrong registered key must fail");
        assert!(matches!(error, CliError::Ledger { ref code, .. } if code == "key_mismatch"));
        config
            .keys
            .insert_entry(
                "fee",
                fee_entry(crate::signing::address_string(&device.pubkey(&fee_path))),
                true,
            )
            .unwrap();

        let fee = resolve_signer_reusing_ledger(&config, "fee", account.ledger.as_deref()).unwrap();
        assert_ne!(account.public_key, fee.public_key);
        let authorization = sign_eoa_authorization(&account, 1, &fee.public_key).unwrap();
        let mut transaction = build_eoa_create_transaction(
            fee.public_key,
            account.public_key,
            &authorization,
            &[0xAB; 40],
            7,
            100,
            1,
        );
        crate::signing::sign_transaction_for(&mut transaction, &fee, |e| {
            CliError::TransactionSubmission(e.to_string())
        })
        .unwrap();
        assert!(transaction.verify());
        assert!(matches!(
            device.reviews().as_slice(),
            [Review::EoaAuth { .. }, Review::Transaction { .. }]
        ));
        assert!(matches!(
            account.ledger_preview(),
            Some(thru_ledger::Preview::EoaAuth(_))
        ));
        assert!(matches!(
            fee.ledger_preview(),
            Some(thru_ledger::Preview::Transaction(_))
        ));
    }

    #[test]
    fn eoa_authorization_preserves_ledger_rejection() {
        use std::sync::Arc;
        use thru_ledger::DerivationPath;
        use thru_ledger::mock::SoftDevice;

        let device = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let ledger = crate::signing::connect_ledger_with(device.clone(), path, None).unwrap();
        let account = ResolvedSigner::from_ledger("account", path, ledger);
        device.set_approver(|_| false);
        let error = sign_eoa_authorization(&account, 1, &[42; 32]).unwrap_err();
        assert!(matches!(
            error,
            CliError::Ledger { ref code, status_word: Some(0x6985), .. } if code == "user_rejected"
        ));
    }

    #[test]
    fn eoa_authorization_with_local_account() {
        let (_directory, keys) = crate::keys::KeyManager::test_fixture(&[("default", [1; 32])]);
        let config = Config {
            keys,
            ..Config::default()
        };
        let account = resolve_signer(&config, "default").unwrap();
        let fee_payer = [42; 32];
        let signature = sign_eoa_authorization(&account, 1, &fee_payer).unwrap();
        let message = thru_base::signer::build_eoa_auth_message(
            EoaAuthKind::Create,
            1,
            &fee_payer,
            &account.public_key,
        );
        assert!(
            thru_base::tn_signature::verify_message(&message, &signature, &account.public_key)
                .is_ok()
        );
    }

    fn trezor_registration(public_key: &str, passphrase: bool) -> crate::keys::KeyEntry {
        crate::keys::KeyEntry {
            public_key: public_key.to_owned(),
            source: crate::keys::KeySource::Trezor {
                path: thru_trezor::DerivationPath::new(0).unwrap(),
                passphrase,
            },
        }
    }

    /// Which keys may play which role in `create-eoa`: a Trezor key may be the
    /// account, by alias or by URI (the standard wallet or a passphrase
    /// wallet), and may not pay; every other key may play both.
    #[test]
    fn eoa_roles_admit_a_trezor_account_and_refuse_a_trezor_fee_payer() {
        let (_directory, mut keys) = crate::keys::KeyManager::test_fixture(&[("local", [1; 32])]);
        let address = thru_base::tn_tools::Pubkey::from_bytes(&[9; 32]).to_string();
        keys.insert_entry("tz", trezor_registration(&address, false), false)
            .unwrap();
        keys.insert_entry("hid", trezor_registration(&address, true), false)
            .unwrap();
        let uri = "trezor://44'/8478'/0'/0'";

        for reference in ["tz", "alias:tz", "hid", "alias:hid", uri, "local"] {
            check_eoa_role(&keys, reference, EoaRole::Account)
                .unwrap_or_else(|e| panic!("{reference} as the account: {e}"));
        }
        for reference in ["local", "ledger://44'/8478'/0'/0'"] {
            check_eoa_role(&keys, reference, EoaRole::FeePayer)
                .unwrap_or_else(|e| panic!("{reference} as the fee payer: {e}"));
        }
        for reference in ["tz", "alias:tz", "hid", "alias:hid", uri] {
            let error = check_eoa_role(&keys, reference, EoaRole::FeePayer).unwrap_err();
            assert!(matches!(error, CliError::Validation(_)), "{error:?}");
            assert_eq!(
                error.to_string(),
                "Validation error: a Trezor key cannot pay for an EOA creation: the Thru app \
                 on the Trezor does not show that transaction and does not sign blind; pass \
                 --fee-payer with a local or a Ledger key",
                "{reference}"
            );
        }
    }

    /// With the emulator (`test-host.sh`): a Trezor account signs the EOA
    /// authorization through `sign_eoa_authorization`, and the chain would
    /// accept the signature. Skipped unless `THRU_TREZOR_EMULATOR` and
    /// `THRU_TREZOR_APP` are set.
    #[cfg(feature = "trezor-emulator")]
    #[test]
    fn trezor_emulator_signs_an_eoa_authorization() {
        if std::env::var(crate::signing::ENV_TREZOR_EMULATOR).is_err() {
            eprintln!(
                "skipped: {} is not set",
                crate::signing::ENV_TREZOR_EMULATOR
            );
            return;
        }
        let config = Config::default();
        let account = resolve_signer(&config, "trezor://44'/8478'/0'/0'").unwrap();
        assert!(account.is_trezor());
        let fee_payer = [42; 32];
        let signature = sign_eoa_authorization(&account, 1, &fee_payer).unwrap();
        let message = thru_base::signer::build_eoa_auth_message(
            EoaAuthKind::Create,
            1,
            &fee_payer,
            &account.public_key,
        );
        assert!(
            thru_base::tn_signature::verify_message(&message, &signature, &account.public_key)
                .is_ok()
        );
    }

    /// One vector of the shared EOA authorization corpus
    /// (`THRU_TEST_EOA_VECTOR`), through the CLI's own path on the Trezor
    /// emulator: the review is `eoa_auth_review` (printed before the request,
    /// and written to `THRU_TEST_PREVIEW_OUT` for the script to compare with
    /// what the device showed), a `create` goes through
    /// `sign_eoa_authorization` and a `delete` (which no command sends yet)
    /// through the same steps.  A valid vector must give the corpus signature.
    /// A rejected one must be refused with the corpus reason; the host crate
    /// may stop it first, and then the error is reported as `eoa-outcome:
    /// host-refused` for the script to show; `THRU_TEST_EXPECT_CODE` names the
    /// error code expected when the person refuses on the device.  Run by
    /// `trezor/scripts/test-host.sh` once for each vector; skipped unless a
    /// vector is named.
    #[cfg(feature = "trezor-emulator")]
    #[test]
    fn trezor_emulator_signs_an_eoa_vector_with_its_review() {
        if std::env::var(crate::signing::ENV_TREZOR_EMULATOR).is_err() {
            eprintln!(
                "skipped: {} is not set",
                crate::signing::ENV_TREZOR_EMULATOR
            );
            return;
        }
        let Ok(name) = std::env::var("THRU_TEST_EOA_VECTOR") else {
            eprintln!("skipped: THRU_TEST_EOA_VECTOR is not set");
            return;
        };
        let corpus: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../../contrib/test/vectors/signing/eoa_auth_vectors.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let vector = corpus
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == name.as_str())
            .unwrap_or_else(|| panic!("no EOA vector {name}"));
        let key = |field: &str| -> [u8; 32] {
            hex::decode(vector[field].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap()
        };
        let kind = match vector["kind"].as_str().unwrap() {
            "create" => EoaAuthKind::Create,
            _ => EoaAuthKind::Delete,
        };
        let chain_id = u16::try_from(vector["chain_id"].as_u64().unwrap()).unwrap();
        let (fee_payer, account) = (key("fee_payer_hex"), key("account_hex"));
        let uri = format!(
            "trezor://{}",
            vector["signer_path"]
                .as_str()
                .unwrap()
                .trim_start_matches("m/")
        );
        let signer = resolve_signer(&Config::default(), &uri).unwrap();
        let trezor = signer.trezor.as_ref().expect("a Trezor signer");
        let result = if kind == EoaAuthKind::Create && account == signer.public_key {
            sign_eoa_authorization(&signer, chain_id, &fee_payer)
        } else {
            let review = crate::trezor_preview::eoa_auth_review(
                kind,
                chain_id,
                &fee_payer,
                &account,
                &trezor.pubkey(),
                trezor.path(),
            );
            signer.set_trezor_review(review.clone());
            crate::signing::eprint_trezor_review_then(review.as_ref(), || {
                trezor.try_sign_eoa_auth(kind, chain_id, &fee_payer, &account)
            })
            .map_err(crate::signing::trezor_error)
        };
        if let Ok(path) = std::env::var("THRU_TEST_PREVIEW_OUT") {
            std::fs::write(
                path,
                serde_json::to_string_pretty(&signer.trezor_preview_json()).unwrap(),
            )
            .unwrap();
        }
        // The person may refuse on the device: then the code of the error is
        // what is expected.
        if let Ok(code) = std::env::var("THRU_TEST_EXPECT_CODE") {
            match result {
                Err(CliError::Trezor { code: got, .. }) => assert_eq!(got, code, "{name}"),
                other => panic!("{name}: want the error {code}, got {other:?}"),
            }
            eprintln!("eoa vector {name}: ok");
            return;
        }
        match vector["category"].as_str().unwrap() {
            "valid" => {
                let signature = result.unwrap_or_else(|e| panic!("{name}: {e:?}"));
                assert_eq!(
                    hex::encode(signature),
                    vector["signature_hex"].as_str().unwrap(),
                    "{name}"
                );
            }
            _ => {
                let reason = vector["reject_reason"].as_str().unwrap();
                match result {
                    Err(CliError::Trezor {
                        reason: Some(got), ..
                    }) => {
                        assert_eq!(got, reason, "{name}");
                        eprintln!("eoa-outcome: app-refused {got}");
                    }
                    // The host's own check of the request, with the sentence
                    // for this reason; any other error (a timeout, a lost
                    // connection, a cancellation) is not a refusal.
                    Err(CliError::Trezor {
                        code,
                        message,
                        reason: None,
                    }) if code == "invalid_request" => {
                        let sentence = match reason {
                            "account_mismatch" => "must be this Trezor key",
                            "bad_chain_id" => "the chain id of an EOA authorization is not zero",
                            other => panic!("{name}: the host has no refusal for {other}"),
                        };
                        assert!(message.contains(sentence), "{name}: {message}");
                        eprintln!("eoa-outcome: host-refused {message}");
                    }
                    Err(other) => panic!("{name}: want the refusal {reason}, got {other:?}"),
                    Ok(_) => panic!("{name}: signed, want the refusal {reason}"),
                }
            }
        }
        eprintln!("eoa vector {name}: ok");
    }

    /// A Trezor fee payer for `create-eoa` is refused up front too, before any
    /// signer is resolved; no device, `THRU_TREZOR_*` variable or node is used.
    #[tokio::test]
    async fn eoa_creation_with_a_trezor_fee_payer_is_refused() {
        let (_directory, keys) = crate::keys::KeyManager::test_fixture(&[("local", [1; 32])]);
        let config = Config {
            keys,
            ..Config::default()
        };
        let error = create_eoa(
            &config,
            "local",
            false,
            Some("trezor://44'/8478'/0'/0'"),
            true,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, CliError::Validation(_)), "{error:?}");
        assert!(
            error.to_string().contains(
                "a Trezor key cannot pay for an EOA creation: the Thru app on the Trezor \
                 does not show that transaction and does not sign blind"
            ),
            "{error}"
        );
    }

    /// With no `--fee-payer` the key named `default` pays; a registered Trezor
    /// `default` key is refused the same way.
    #[tokio::test]
    async fn eoa_creation_with_a_trezor_default_fee_payer_is_refused() {
        let (_directory, mut keys) = crate::keys::KeyManager::test_fixture(&[("local", [1; 32])]);
        keys.insert_entry(
            "default",
            crate::keys::KeyEntry {
                public_key: thru_base::tn_tools::Pubkey::from_bytes(&[9; 32]).to_string(),
                source: crate::keys::KeySource::Trezor {
                    path: thru_trezor::DerivationPath::new(0).unwrap(),
                    passphrase: false,
                },
            },
            false,
        )
        .unwrap();
        let config = Config {
            keys,
            ..Config::default()
        };
        let error = create_eoa(&config, "local", false, None, true)
            .await
            .unwrap_err();
        assert!(matches!(error, CliError::Validation(_)), "{error:?}");
        assert!(
            error.to_string().contains(
                "a Trezor key cannot pay for an EOA creation: the Thru app on the Trezor \
                 does not show that transaction and does not sign blind"
            ),
            "{error}"
        );
    }
}
