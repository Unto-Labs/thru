//! Transaction signing and execution commands

use crate::cli::TxnCommands;
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;
use base64::Engine;
use base64::engine::general_purpose;
use std::time::Duration;
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::{TnPubkey, Transaction};

use crate::grpc_client::{Client, ClientBuilder};

/// Handle transaction-related commands
pub async fn handle_txn_command(
    config: &Config,
    subcommand: TxnCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        TxnCommands::Sign {
            program,
            instruction_data,
            fee_payer,
            fee,
            compute_units,
            state_units,
            memory_units,
            expiry_after,
            readwrite_accounts,
            readonly_accounts,
        } => {
            sign_transaction(
                config,
                &program,
                &instruction_data,
                fee_payer.as_deref(),
                fee,
                compute_units,
                state_units,
                memory_units,
                expiry_after,
                &readwrite_accounts,
                &readonly_accounts,
                json_format,
            )
            .await
        }
        TxnCommands::Execute {
            program,
            instruction_data,
            fee_payer,
            fee,
            compute_units,
            state_units,
            memory_units,
            expiry_after,
            timeout,
            readwrite_accounts,
            readonly_accounts,
        } => {
            execute_transaction(
                config,
                &program,
                &instruction_data,
                fee_payer.as_deref(),
                fee,
                compute_units,
                state_units,
                memory_units,
                expiry_after,
                timeout,
                &readwrite_accounts,
                &readonly_accounts,
                json_format,
            )
            .await
        }
        TxnCommands::MakeStateProof {
            proof_type,
            account,
            slot,
        } => make_state_proof(config, &proof_type, &account, slot, json_format).await,
    }
}

/// Sign a transaction and output as base64 string
async fn sign_transaction(
    config: &Config,
    program: &str,
    instruction_data: &str,
    fee_payer: Option<&str>,
    fee: u64,
    compute_units: u32,
    state_units: u16,
    memory_units: u16,
    expiry_after: u32,
    readwrite_accounts: &[String],
    readonly_accounts: &[String],
    json_format: bool,
) -> Result<(), CliError> {
    // Parse instruction data from hex
    let instruction_bytes = hex::decode(instruction_data)
        .map_err(|e| CliError::Validation(format!("Invalid hex instruction data: {}", e)))?;

    // Build and sign transaction
    let transaction = build_and_sign_transaction(
        config,
        program,
        &instruction_bytes,
        fee_payer,
        fee,
        compute_units,
        state_units,
        memory_units,
        expiry_after,
        readwrite_accounts,
        readonly_accounts,
    )
    .await?;

    // Convert to wire format and encode as base64
    let transaction_bytes = transaction.to_wire();
    let base64_transaction = general_purpose::STANDARD.encode(&transaction_bytes);

    if json_format {
        let response = serde_json::json!({
            "transaction_sign": {
                "status": "success",
                "base64_transaction": base64_transaction,
                "size_bytes": transaction_bytes.len()
            }
        });
        output::print_output(response, true);
    } else {
        println!("{}", base64_transaction);
    }

    Ok(())
}

/// Execute a transaction and print response
async fn execute_transaction(
    config: &Config,
    program: &str,
    instruction_data: &str,
    fee_payer: Option<&str>,
    fee: u64,
    compute_units: u32,
    state_units: u16,
    memory_units: u16,
    expiry_after: u32,
    timeout: u64,
    readwrite_accounts: &[String],
    readonly_accounts: &[String],
    json_format: bool,
) -> Result<(), CliError> {
    // Parse instruction data from hex
    let instruction_bytes = hex::decode(instruction_data)
        .map_err(|e| CliError::Validation(format!("Invalid hex instruction data: {}", e)))?;

    // Build and sign transaction
    let transaction = build_and_sign_transaction(
        config,
        program,
        &instruction_bytes,
        fee_payer,
        fee,
        compute_units,
        state_units,
        memory_units,
        expiry_after,
        readwrite_accounts,
        readonly_accounts,
    )
    .await?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Submit and execute transaction
    let transaction_bytes = transaction.to_wire();
    let timeout_duration = Duration::from_secs(timeout);

    let transaction_details = client
        .execute_transaction(&transaction_bytes, timeout_duration)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {:?}", e))
        })?;

    // Format and display the result
    if json_format {
        let mut events_json = Vec::new();

        // Parse events for JSON output
        for event in &transaction_details.events {
            let mut event_json = serde_json::Map::new();
            event_json.insert(
                "call_idx".to_string(),
                serde_json::Value::Number(serde_json::Number::from(event.call_idx as u64)),
            );
            event_json.insert(
                "program_idx".to_string(),
                serde_json::Value::Number(serde_json::Number::from(event.program_idx as u64)),
            );

            if let Some(event_id) = &event.event_id {
                event_json.insert(
                    "event_id".to_string(),
                    serde_json::Value::String(event_id.clone()),
                );
            }

            if let Some(program) = &event.program {
                event_json.insert(
                    "program".to_string(),
                    serde_json::Value::String(program.as_str().to_string()),
                );
            }

            if event.data.len() > 8 {
                // Extract first 8 bytes as event type
                let event_type_bytes = &event.data[0..8];
                let event_type = u64::from_le_bytes([
                    event_type_bytes[0],
                    event_type_bytes[1],
                    event_type_bytes[2],
                    event_type_bytes[3],
                    event_type_bytes[4],
                    event_type_bytes[5],
                    event_type_bytes[6],
                    event_type_bytes[7],
                ]);
                event_json.insert(
                    "event_type".to_string(),
                    serde_json::Value::Number(serde_json::Number::from(event_type)),
                );

                // Process remaining data
                let remaining_data = &event.data[8..];
                if !remaining_data.is_empty() {
                    let parsed_data = parse_event_data_for_json(remaining_data);
                    event_json.insert("data".to_string(), parsed_data);
                }
            } else if !event.data.is_empty() {
                event_json.insert(
                    "data_hex".to_string(),
                    serde_json::Value::String(hex::encode(&event.data)),
                );
            }

            events_json.push(serde_json::Value::Object(event_json));
        }

        let response = serde_json::json!({
            "transaction_execute": {
                "status": "success",
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed,
                "state_units_consumed": transaction_details.state_units_consumed,
                "execution_result": transaction_details.execution_result,
                "vm_error": transaction_details.vm_error,
                "user_error_code": transaction_details.user_error_code,
                "events_count": transaction_details.events_cnt,
                "events_size": transaction_details.events_sz,
                "pages_used": transaction_details.pages_used,
                "readwrite_accounts": transaction_details.rw_accounts.iter().map(|pk| pk.as_str().to_string()).collect::<Vec<_>>(),
                "readonly_accounts": transaction_details.ro_accounts.iter().map(|pk| pk.as_str().to_string()).collect::<Vec<_>>(),
                "events": events_json
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success(&format!("Transaction executed successfully"));
        println!("Signature: {}", transaction_details.signature.as_str());
        println!("Slot: {}", transaction_details.slot);
        println!(
            "Compute Units Consumed: {}",
            transaction_details.compute_units_consumed
        );
        println!(
            "State Units Consumed: {}",
            transaction_details.state_units_consumed
        );
        println!("Execution Result: {}", transaction_details.execution_result);
        println!("VM Error: {}", transaction_details.vm_error);
        println!("User Error Code: {}", transaction_details.user_error_code);
        println!("Events Count: {}", transaction_details.events_cnt);
        println!("Events Size: {}", transaction_details.events_sz);
        println!("Pages Used: {}", transaction_details.pages_used);

        if !transaction_details.rw_accounts.is_empty() {
            println!("\nRead-write Accounts:");
            for account in &transaction_details.rw_accounts {
                println!("  {}", account.as_str());
            }
        }

        if !transaction_details.ro_accounts.is_empty() {
            println!("\nRead-only Accounts:");
            for account in &transaction_details.ro_accounts {
                println!("  {}", account.as_str());
            }
        }

        // Display events if any are present
        if transaction_details.events_cnt > 0 {
            println!("\nEvents:");
            for (i, event) in transaction_details.events.iter().enumerate() {
                println!(
                    "  Event {}: call_idx={}, program_idx={}",
                    i + 1,
                    event.call_idx,
                    event.program_idx
                );

                if let Some(event_id) = &event.event_id {
                    println!("    Event ID: {}", event_id);
                }
                if let Some(program) = &event.program {
                    println!("    Program: {}", program.as_str());
                }

                if event.data.len() > 8 {
                    // Extract first 8 bytes as event type
                    let event_type_bytes = &event.data[0..8];
                    let event_type = u64::from_le_bytes([
                        event_type_bytes[0],
                        event_type_bytes[1],
                        event_type_bytes[2],
                        event_type_bytes[3],
                        event_type_bytes[4],
                        event_type_bytes[5],
                        event_type_bytes[6],
                        event_type_bytes[7],
                    ]);
                    println!("    Event type: {}", event_type);

                    // Process remaining data
                    let remaining_data = &event.data[8..];
                    if !remaining_data.is_empty() {
                        display_event_data(remaining_data);
                    }
                } else if !event.data.is_empty() {
                    // If data is 8 bytes or less, just display as hex
                    println!("    Data (hex): {}", hex::encode(&event.data));
                }
            }
        }

        if transaction_details.execution_result != 0 {
            output::print_warning(&format!(
                "Transaction completed with execution result: {}",
                transaction_details.execution_result
            ));
        }
        if transaction_details.vm_error != 0 {
            output::print_warning(&format!(
                "Transaction completed with VM error: {}",
                transaction_details.vm_error
            ));
        }
    }

    Ok(())
}

/// Build and sign a transaction with the given parameters
async fn build_and_sign_transaction(
    config: &Config,
    program: &str,
    instruction_data: &[u8],
    fee_payer: Option<&str>,
    fee: u64,
    compute_units: u32,
    state_units: u16,
    memory_units: u16,
    expiry_after: u32,
    readwrite_accounts: &[String],
    readonly_accounts: &[String],
) -> Result<Transaction, CliError> {
    // Resolve fee payer account
    let fee_payer_key = fee_payer.unwrap_or("default");
    let fee_payer_private_key = config.keys.get_key(fee_payer_key)?;
    let fee_payer_keypair = KeyPair::from_hex_private_key(fee_payer_key, fee_payer_private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to create fee payer keypair: {}", e)))?;

    // Resolve program public key
    let program_pubkey = resolve_program_public_key(config, program)?;

    // Create RPC client to get current nonce and slot
    let client = create_rpc_client(config)?;

    // Get current nonce from fee payer account
    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None)
        .await
        .map_err(|e| CliError::NonceManagement(format!("Failed to get account info: {}", e)))?;

    let nonce = if let Some(account) = account_info {
        account.nonce
    } else {
        return Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer_keypair.address_string.as_str()
        )));
    };

    // Get current block height
    let block_height = client
        .get_block_height()
        .await
        .map_err(|e| CliError::NonceManagement(format!("Failed to get block height: {}", e)))?;

    // Parse account lists
    let rw_accounts: Result<Vec<TnPubkey>, CliError> = readwrite_accounts
        .iter()
        .map(|addr| crate::utils::validate_address_or_hex(addr))
        .collect();
    let rw_accounts = validate_and_process_accounts(rw_accounts?)?;

    let r_accounts: Result<Vec<TnPubkey>, CliError> = readonly_accounts
        .iter()
        .map(|addr| crate::utils::validate_address_or_hex(addr))
        .collect();
    let r_accounts = validate_and_process_accounts(r_accounts?)?;

    // Build transaction
    let mut transaction =
        Transaction::new(fee_payer_keypair.public_key, program_pubkey, fee, nonce)
            .with_instructions(instruction_data.to_vec())
            .with_compute_units(compute_units)
            .with_state_units(state_units)
            .with_memory_units(memory_units)
            .with_expiry_after(expiry_after)
            .with_start_slot(block_height.finalized_height);

    // Add account lists if provided
    if !rw_accounts.is_empty() {
        transaction = transaction.with_rw_accounts(rw_accounts);
    }
    if !r_accounts.is_empty() {
        transaction = transaction.with_r_accounts(r_accounts);
    }

    // Sign the transaction
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    Ok(transaction)
}

/// Resolve program public key from string (either ta... address or key name from config)
fn resolve_program_public_key(config: &Config, program: &str) -> Result<TnPubkey, CliError> {
    // Try as ta... address first
    if program.starts_with("ta") && program.len() == 46 {
        let pubkey = Pubkey::new(program.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid program public key: {}", e)))?;
        return pubkey.to_bytes().map_err(|e| {
            CliError::Validation(format!("Failed to decode program public key: {}", e))
        });
    }

    // Try as key name from config
    if let Ok(private_key_hex) = config.keys.get_key(program) {
        let keypair = KeyPair::from_hex_private_key(program, private_key_hex).map_err(|e| {
            CliError::Validation(format!("Failed to resolve program key from config: {}", e))
        })?;
        return Ok(keypair.public_key);
    }

    // If neither works, try as hex public key
    if program.len() == 64 {
        let program_bytes = crypto::hex_to_bytes(program).map_err(|e| {
            CliError::Validation(format!("Failed to decode hex program key: {}", e))
        })?;
        if program_bytes.len() == 32 {
            let mut pubkey = [0u8; 32];
            pubkey.copy_from_slice(&program_bytes);
            return Ok(pubkey);
        }
    }

    Err(CliError::Validation(format!(
        "Invalid program identifier: {}. Must be a ta... address, key name from config, or 64-character hex public key",
        program
    )))
}

/// Display event data as string if human-readable, otherwise as hex
fn display_event_data(data: &[u8]) {
    // Remove trailing zeros
    let trimmed_data = data
        .iter()
        .rposition(|&b| b != 0)
        .map(|pos| &data[..=pos])
        .unwrap_or(&[]);

    if trimmed_data.is_empty() {
        println!("    Data: (empty)");
        return;
    }

    // Try to convert to UTF-8 string
    if let Ok(string_data) = std::str::from_utf8(trimmed_data) {
        // Check if it's reasonably printable (no control characters except common whitespace)
        let is_printable = string_data
            .chars()
            .all(|c| c.is_ascii_graphic() || c == ' ' || c == '\t' || c == '\n' || c == '\r');

        if is_printable && !string_data.is_empty() {
            println!("    Data (string): \"{}\"", string_data);
            return;
        }
    }

    // If not a valid string, display as hex
    println!("    Data (hex): {}", hex::encode(trimmed_data));
}

/// Parse event data for JSON output - returns either string or hex
fn parse_event_data_for_json(data: &[u8]) -> serde_json::Value {
    // Remove trailing zeros
    let trimmed_data = data
        .iter()
        .rposition(|&b| b != 0)
        .map(|pos| &data[..=pos])
        .unwrap_or(&[]);

    if trimmed_data.is_empty() {
        return serde_json::json!({
            "type": "empty"
        });
    }

    // Try to convert to UTF-8 string
    if let Ok(string_data) = std::str::from_utf8(trimmed_data) {
        // Check if it's reasonably printable (no control characters except common whitespace)
        let is_printable = string_data
            .chars()
            .all(|c| c.is_ascii_graphic() || c == ' ' || c == '\t' || c == '\n' || c == '\r');

        if is_printable && !string_data.is_empty() {
            return serde_json::json!({
                "type": "string",
                "value": string_data
            });
        }
    }

    // If not a valid string, return as hex
    serde_json::json!({
        "type": "hex",
        "value": hex::encode(trimmed_data)
    })
}

/// Create a cryptographic state proof for a given account
async fn make_state_proof(
    config: &Config,
    proof_type: &str,
    account: &str,
    slot: Option<u64>,
    json_format: bool,
) -> Result<(), CliError> {
    // Parse proof type
    let parsed_proof_type = match proof_type.to_lowercase().as_str() {
        "creating" => ProofType::Creating,
        "updating" => ProofType::Updating,
        "existing" => ProofType::Existing,
        _ => {
            return Err(CliError::Validation(format!(
                "Invalid proof type: {}. Must be one of: creating, updating, existing",
                proof_type
            )));
        }
    };

    // Parse account public key
    let account_pubkey = if account.starts_with("ta") && account.len() == 46 {
        // It's a ta... address
        Pubkey::new(account.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid account public key: {}", e)))?
    } else if let Ok(private_key_hex) = config.keys.get_key(account) {
        // It's a key name from config - get the public key
        let keypair = KeyPair::from_hex_private_key(account, private_key_hex).map_err(|e| {
            CliError::Validation(format!("Failed to resolve account key from config: {}", e))
        })?;
        keypair.address_string
    } else if account.len() == 64 {
        // Try as hex public key
        let account_bytes = crypto::hex_to_bytes(account).map_err(|e| {
            CliError::Validation(format!("Failed to decode hex account key: {}", e))
        })?;
        if account_bytes.len() == 32 {
            let mut pubkey_bytes = [0u8; 32];
            pubkey_bytes.copy_from_slice(&account_bytes);
            Pubkey::from_bytes(&pubkey_bytes)
        } else {
            return Err(CliError::Validation(format!(
                "Hex account key must be exactly 32 bytes (64 hex characters), got {} bytes",
                account_bytes.len()
            )));
        }
    } else {
        return Err(CliError::Validation(format!(
            "Invalid account identifier: {}. Must be a ta... address, key name from config, or 64-character hex public key",
            account
        )));
    };

    // Create state proof config
    let state_proof_config = MakeStateProofConfig {
        proof_type: parsed_proof_type,
        slot,
    };

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Call makeStateProof
    let proof_data = client
        .make_state_proof(&account_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    // Encode proof as base64
    let base64_proof = general_purpose::STANDARD.encode(&proof_data);
    let hex_proof = hex::encode(&proof_data);

    if json_format {
        let response = serde_json::json!({
            "makeStateProof": {
                "status": "success",
                "account": account_pubkey.to_string(),
                "proof_type": proof_type,
                "slot": slot,
                "proof_data": base64_proof,
                "proof_data_hex": hex_proof,
                "proof_size_bytes": proof_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("State proof created successfully");
        println!("Account: {}", account_pubkey.to_string());
        println!("Proof Type: {}", proof_type);
        if let Some(slot_num) = slot {
            println!("Slot: {}", slot_num);
        }
        println!("Proof Size: {} bytes", proof_data.len());
        println!("Proof Data (base64): {}", base64_proof);
        println!("Proof Data (hex): {}", hex_proof);
    }

    Ok(())
}

/// Create RPC client from config
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;

    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(Duration::from_secs(config.timeout_seconds))
        .auth_token(config.auth_token.clone())
        .build()
}

/// Check account list size, deduplicate, and return sorted
fn validate_and_process_accounts(mut accounts: Vec<TnPubkey>) -> Result<Vec<TnPubkey>, CliError> {
    // Check maximum account limit (1024 as defined in docs)
    if accounts.len() > 1024 {
        return Err(CliError::Validation(format!(
            "Too many accounts: {} (maximum 1024 allowed)",
            accounts.len(),
        )));
    }

    accounts.sort();
    accounts.dedup();

    Ok(accounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::KeyManager;

    fn create_test_config() -> Config {
        let mut keys = KeyManager::new();
        // Add a test key
        keys.add_key(
            "test",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            false,
        )
        .unwrap();

        Config {
            rpc_base_url: "http://localhost:8080".to_string(),
            keys,
            uploader_program_public_key: "ta1111111111111111111111111111111111111111111"
                .to_string(),
            manager_program_public_key: "ta1111111111111111111111111111111111111111111".to_string(),
            token_program_public_key: "ta1111111111111111111111111111111111111111111".to_string(),
            timeout_seconds: 30,
            max_retries: 3,
            auth_token: None,
        }
    }

    #[test]
    fn test_resolve_program_public_key_hex() {
        let config = create_test_config();
        let hex_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let result = resolve_program_public_key(&config, hex_key);
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_program_public_key_key_name() {
        let config = create_test_config();
        let result = resolve_program_public_key(&config, "test");
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_program_public_key_invalid() {
        let config = create_test_config();
        let result = resolve_program_public_key(&config, "invalid");
        assert!(result.is_err());
    }
}
