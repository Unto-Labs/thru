//! Transfer command implementation

use std::time::Duration;
use thru_base::{tn_tools::Pubkey, txn_tools::EOA_PROGRAM};
use thru_base::txn_lib::TnPubkey;
use thru_base::txn_tools::TransactionBuilder;

use crate::config::Config;
use crate::crypto::keypair_from_hex;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use thru_client::{Client, ClientBuilder};

/// Handle the transfer command
pub async fn handle_transfer_command(
    config: &Config,
    src: &str,
    dst: &str,
    value: u64,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate transfer amount
    if value == 0 {
        return Err(CliError::Validation(
            "Transfer amount must be greater than 0".to_string(),
        ));
    }

    // Resolve source key
    let src_private_key = config.keys.get_key(src).map_err(|_| {
        CliError::Validation(format!("Source key '{}' not found in configuration", src))
    })?;

    // Create keypair from source private key
    let src_keypair = keypair_from_hex(src_private_key)?;

    // Resolve destination public key
    let dst_pubkey = resolve_destination_key(config, dst)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and balance for the source account
    let src_account_info = client
        .get_account_info(&src_keypair.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get source account info: {}", e))
        })?;

    let (nonce, balance) = match src_account_info {
        Some(account) => (account.nonce, account.balance),
        None => {
            return Err(CliError::TransactionSubmission(
                "Source account not found".to_string(),
            ));
        }
    };

    // Balance check
    let transfer_fee: u64 = 1; // note currently fixed as 1
    let total_required = value + transfer_fee;
    if balance < total_required {
        return Err(CliError::Validation(format!(
            "Insufficient balance. Required: {} (transfer: {} + fee: {}), Available: {}",
            total_required, value, transfer_fee, balance
        )));
    }

    // Get current slot
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
    })?;


    // Build transfer transaction
    let mut transaction = TransactionBuilder::build_transfer(
        src_keypair.public_key,        // fee_payer
        EOA_PROGRAM,                
        dst_pubkey,                    // to_account
        value,                         // amount
        transfer_fee,                  // fee (fixed for now)
        nonce,                         // nonce (increment by 1)
        block_height.finalized_height, // start_slot
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build transfer transaction: {}", e))
    })?;

    // Sign the transaction
    transaction.sign(&src_keypair.private_key).map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
    })?;

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
        let vm_error_msg = if transaction_details.vm_error != 0 {
            format!(
                " (VM error: {})",
                format_vm_error(transaction_details.vm_error)
            )
        } else {
            String::new()
        };

        let error_msg = format!(
            "Transaction failed with execution result: {}{}",
            transaction_details.execution_result as i64, vm_error_msg
        );

        let response = output::create_transfer_response(
            src,
            dst,
            value,
            transaction_details.signature.as_str(),
            "failed",
        );
        output::print_output(response, json_format);

        return Err(CliError::TransactionSubmission(error_msg));
    }

    // Format and display the result
    let response = output::create_transfer_response(
        src,
        dst,
        value,
        transaction_details.signature.as_str(),
        "success",
    );
    output::print_output(response, json_format);

    if !json_format {
        output::print_success(&format!(
            "Transfer completed successfully. Transaction signature: {}",
            transaction_details.signature.as_str()
        ));
    }

    Ok(())
}

/// Resolve destination key - try as key name first, then as public address
fn resolve_destination_key(config: &Config, dst: &str) -> Result<TnPubkey, CliError> {
    // First try to resolve as key name from config
    if let Ok(key_hex) = config.keys.get_key(dst) {
        let keypair = keypair_from_hex(key_hex)?;
        return Ok(keypair.public_key);
    }

    // If not found as key name, try to parse as public address
    if dst.starts_with("ta") && dst.len() == 46 {
        let pubkey = Pubkey::new(dst.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid destination address: {}", e)))?;

        // Convert Pubkey to TnPubkey
        let pubkey_bytes = pubkey.to_bytes().map_err(|e| {
            CliError::Validation(format!("Failed to convert destination address: {}", e))
        })?;

        return Ok(pubkey_bytes);
    }

    Err(CliError::Validation(format!(
        "Destination '{}' is neither a valid key name nor a valid public address (taXX format)",
        dst
    )))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_destination_key_with_invalid_address() {
        let config = Config::default();
        let result = resolve_destination_key(&config, "invalid_address");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_destination_key_with_short_address() {
        let config = Config::default();
        let result = resolve_destination_key(&config, "ta123");
        assert!(result.is_err());
    }
}
