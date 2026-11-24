//! Transfer command implementation

use std::time::Duration;
use thru_base::txn_lib::TnPubkey;
use thru_base::txn_tools::EOA_PROGRAM;
use thru_base::txn_tools::TransactionBuilder;

use crate::config::Config;
use crate::error::CliError;
use crate::output;
use crate::signing::resolve_signer;
use crate::utils::format_vm_error;
use thru_client::{Client, ClientBuilder};

/// Handle the transfer command
pub async fn handle_transfer_command(
    config: &Config,
    src: &str,
    dst: &str,
    value: u64,
    transfer_fee: u64,
    build_only: bool,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate transfer amount
    if value == 0 {
        return Err(CliError::Validation(
            "Transfer amount must be greater than 0".to_string(),
        ));
    }

    // Resolve destination public key
    let dst_pubkey = resolve_destination_key(config, dst)?;

    // Resolve the signer last: for a Ledger this connects to the device.
    let src_signer = resolve_signer(config, src)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Get current nonce and balance for the source account
    let src_account_info = client
        .get_account_info(&src_signer.address, None, None)
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
    let total_required = value.checked_add(transfer_fee).ok_or_else(|| {
        CliError::Validation(format!(
            "Transfer amount plus fee overflows: {value} + {transfer_fee}"
        ))
    })?;
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

    // Get chain ID
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    // Build transfer transaction
    let mut transaction = TransactionBuilder::build_transfer(
        src_signer.public_key, // fee_payer
        EOA_PROGRAM,
        dst_pubkey,                    // to_account
        value,                         // amount
        transfer_fee,                  // fee
        nonce,                         // nonce (increment by 1)
        block_height.locally_executed_height, // start_slot
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build transfer transaction: {}", e))
    })?
    .with_chain_id(chain_info.chain_id);

    // Sign the transaction; `wire` is exactly the signed body plus signature.
    let wire = crate::signing::sign_transaction_for(&mut transaction, &src_signer, |e| {
        CliError::TransactionSubmission(format!("Failed to sign transaction: {e}"))
    })?;

    // Build-only: emit the signed txn as base64 and skip submit. Used to embed a
    // fee-paying transfer into an externally-produced block (e.g. the
    // send-block fee-distribution e2e).
    if build_only {
        use base64::{Engine, engine::general_purpose};
        let base64_transaction = general_purpose::STANDARD.encode(&wire);
        if json_format {
            let response = serde_json::json!({
                "transfer": {
                    "status": "success",
                    "build_only": true,
                    "base64_transaction": base64_transaction,
                    "size_bytes": wire.len(),
                }
            });
            let response = src_signer.add_ledger_preview(response, "transfer");
            let response = src_signer.add_trezor_preview(response, "transfer");
            output::print_output(response, json_format);
        } else {
            println!("{}", base64_transaction);
        }
        return Ok(());
    }

    // Submit the transaction
    let transaction_bytes = wire;
    let timeout = Duration::from_secs(config.timeout_seconds);
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
        let response = src_signer.add_ledger_preview(response, "transfer");
        let response = src_signer.add_trezor_preview(response, "transfer");
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
    let response = src_signer.add_ledger_preview(response, "transfer");
    let response = src_signer.add_trezor_preview(response, "transfer");
    output::print_output(response, json_format);

    if !json_format {
        output::print_success(&format!(
            "Transfer completed successfully. Transaction signature: {}",
            transaction_details.signature.as_str()
        ));
    }

    Ok(())
}

/// Resolve destination public metadata or an explicit public address/source.
fn resolve_destination_key(config: &Config, dst: &str) -> Result<TnPubkey, CliError> {
    config.keys.resolve_public_key(dst)
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
