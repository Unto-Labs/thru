//! Faucet program command implementation

use anyhow::Result;
use std::time::Duration;

use crate::cli::FaucetCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::{format_vm_error, validate_address_or_hex};
#[cfg(test)]
use hex;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_tools::{TransactionBuilder, FAUCET_PROGRAM, EOA_PROGRAM};
use thru_client::{Client, ClientBuilder, TransactionDetails};

/// Faucet program fee (0 for now)
const FAUCET_PROGRAM_FEE: u64 = 0;

/// Withdraw limit per transaction (matches TN_FAUCET_WITHDRAW_LIMIT)
const FAUCET_WITHDRAW_LIMIT: u64 = 10000;

/// Faucet account pubkey in Thru format from genesis file
/// Computed from private key "5555..." using Ed25519
/// This is the fixed pubkey for the faucet account as specified in genesis
const FAUCET_ACCOUNT_ADDRESS: &str = "taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn";

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
    pub faucet_program_bytes: [u8; 32],
    pub faucet_account_bytes: [u8; 32],
    pub client: Client,
    pub nonce: u64,
    pub start_slot: u64,
}

/// Setup common transaction context (config, keypair, client, nonce, block height)
async fn setup_transaction_context(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<TransactionContext, CliError> {
    let faucet_program_bytes = FAUCET_PROGRAM;
    let faucet_account_bytes = validate_address_or_hex(FAUCET_ACCOUNT_ADDRESS)?;
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
        faucet_program_bytes,
        faucet_account_bytes,
        client,
        nonce,
        start_slot: block_height.finalized_height,
    })
}

/// Helper function to check transaction execution results and return appropriate errors
fn check_transaction_result(
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
            format!(" (FaucetError: {})", signed_user_error)
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

/// Handle faucet program commands
pub async fn handle_faucet_command(
    config: &Config,
    subcommand: FaucetCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        FaucetCommands::Deposit {
            account,
            amount,
            fee_payer,
        } => {
            deposit(
                config,
                &account,
                amount,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FaucetCommands::Withdraw {
            account,
            amount,
            fee_payer,
        } => {
            withdraw(
                config,
                &account,
                amount,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
    }
}

/// Deposit tokens into the faucet
async fn deposit(
    config: &Config,
    account: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Deposit amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "faucet_deposit": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    // Resolve depositor account either from explicit address or key name
    let direct_account_input =
        (account.starts_with("ta") && account.len() == 46) || account.len() == 64;
    let (depositor_account_bytes, depositor_address_display) = if direct_account_input {
        let bytes = validate_address_or_hex(account)?;
        let display = if account.starts_with("ta") && account.len() == 46 {
            account.to_string()
        } else {
            Pubkey::from_bytes(&bytes).to_string()
        };
        (bytes, display)
    } else {
        let depositor_private_key = config.keys.get_key(account).map_err(|_| {
            CliError::Validation(format!("Key '{}' not found in configuration", account))
        })?;
        let depositor_keypair = KeyPair::from_hex_private_key(account, depositor_private_key)
            .map_err(|e| CliError::Crypto(format!("Failed to create depositor keypair: {}", e)))?;
        (
            depositor_keypair.public_key,
            depositor_keypair.address_string.to_string(),
        )
    };

    if !json_format {
        println!("Deposit to faucet:");
        println!("  Depositor: {}", account);
        println!("  Amount: {}", amount);
    }

    // Setup transaction context
    let context = setup_transaction_context(config, fee_payer)
        .await
        .map_err(|e| {
            if json_format {
                let error_response = serde_json::json!({
                    "faucet_deposit": {
                        "status": "failed",
                        "error": e.to_string()
                    }
                });
                crate::output::print_output(error_response, true);
            }
            e
        })?;

    if context.fee_payer_keypair.public_key != depositor_account_bytes {
        let error_msg = format!(
            "Depositor '{}' resolves to {} but the active fee payer is {}. They must match.",
            account,
            depositor_address_display,
            context.fee_payer_keypair.address_string
        );
        if json_format {
            let error_response = serde_json::json!({
                "faucet_deposit": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    // Build transaction - include EOA program account for faucet program to invoke
    let transaction = TransactionBuilder::build_faucet_deposit(
        context.fee_payer_keypair.public_key,
        context.faucet_program_bytes,
        context.faucet_account_bytes,
        depositor_account_bytes,
        EOA_PROGRAM,
        amount,
        FAUCET_PROGRAM_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Execute transaction
    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "faucet_deposit": {
                "status": "success",
                "depositor": account,
                "amount": amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Deposit completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Deposited {} tokens to faucet from {}", amount, account);
    }

    Ok(())
}

/// Withdraw tokens from the faucet
async fn withdraw(
    config: &Config,
    account: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Withdraw amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "faucet_withdraw": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if amount > FAUCET_WITHDRAW_LIMIT {
        let error_msg = format!(
            "Withdraw amount {} exceeds limit of {}",
            amount, FAUCET_WITHDRAW_LIMIT
        );
        if json_format {
            let error_response = serde_json::json!({
                "faucet_withdraw": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    // Resolve recipient account either from explicit address/hex or key name
    let recipient_account_bytes = if (account.starts_with("ta") && account.len() == 46)
        || account.len() == 64
    {
        validate_address_or_hex(account)?
    } else {
        let recipient_private_key = config.keys.get_key(account).map_err(|_| {
            CliError::Validation(format!("Key '{}' not found in configuration", account))
        })?;
        let recipient_keypair = KeyPair::from_hex_private_key(account, recipient_private_key)
            .map_err(|e| CliError::Crypto(format!("Failed to create recipient keypair: {}", e)))?;
        recipient_keypair.public_key
    };

    if !json_format {
        println!("Withdraw from faucet:");
        println!("  Recipient: {}", account);
        println!("  Amount: {}", amount);
        println!("  Withdraw limit: {}", FAUCET_WITHDRAW_LIMIT);
    }

    // Setup transaction context
    let context = setup_transaction_context(config, fee_payer)
        .await
        .map_err(|e| {
            if json_format {
                let error_response = serde_json::json!({
                    "faucet_withdraw": {
                        "status": "failed",
                        "error": e.to_string()
                    }
                });
                crate::output::print_output(error_response, true);
            }
            e
        })?;

    // Build transaction
    let transaction = TransactionBuilder::build_faucet_withdraw(
        context.fee_payer_keypair.public_key,
        context.faucet_program_bytes,
        context.faucet_account_bytes,
        recipient_account_bytes,
        amount,
        FAUCET_PROGRAM_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Execute transaction
    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "faucet_withdraw": {
                "status": "success",
                "recipient": account,
                "amount": amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Withdraw completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Withdrew {} tokens from faucet to {}", amount, account);
    }

    Ok(())
}
