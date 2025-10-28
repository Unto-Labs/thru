//! RPC command implementations

use std::collections::HashMap;
use std::convert::TryFrom;
use std::time::Duration;
use thru_base::tn_tools::Pubkey;
use tonic_health::pb::health_check_response::ServingStatus;

use crate::config::Config;
use crate::crypto::keypair_from_hex;
use crate::error::CliError;
use crate::grpc_client::{Client, ClientBuilder};
use crate::output;

/// Resolve account input to a public key
///
/// This function implements the key resolution logic:
/// 1. If input is None, use the default key from config
/// 2. If input is Some(value), try to parse as public key first
/// 3. If public key parsing fails, try to resolve as key name from config
/// 4. Provide helpful error messages for all failure cases
pub fn resolve_account_input(input: Option<&str>, config: &Config) -> Result<Pubkey, CliError> {
    match input {
        None => {
            // Use default key
            let private_key = config.keys.get_default_key()?;
            let keypair = keypair_from_hex(private_key)?;
            Ok(keypair.address_string)
        }
        Some(value) => {
            // Try as public key first
            match Pubkey::new(value.to_string()) {
                Ok(pubkey) => Ok(pubkey),
                Err(_) => {
                    // Try as key name
                    match config.keys.get_key(value) {
                        Ok(private_key) => {
                            let keypair = keypair_from_hex(private_key)?;
                            Ok(keypair.address_string)
                        }
                        Err(_) => Err(CliError::Validation(format!(
                            "Invalid input '{}': not a valid public key or key name. Available keys: {}",
                            value,
                            config.keys.list_keys().join(", ")
                        ))),
                    }
                }
            }
        }
    }
}

/// Execute the getVersion command
pub async fn get_version(config: &Config, json_format: bool) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;
    let versions = client.get_version().await?;

    let thru_node = versions
        .get("thru-node")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    let thru_rpc = versions
        .get("thru-rpc")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());

    if json_format {
        let response = output::create_version_response(&thru_node, &thru_rpc);
        output::print_output(response, true);
    } else {
        println!("thru-node: {}", thru_node);
        println!("thru-rpc: {}", thru_rpc);
    }

    Ok(())
}

/// Execute the getHealth command
pub async fn get_health(config: &Config, json_format: bool) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;
    let response = client.get_health().await?;

    let status = ServingStatus::try_from(response.status).unwrap_or(ServingStatus::Unknown);
    let status_str = health_status_to_str(status);
    if json_format {
        let response_json = output::create_health_response(status_str);
        output::print_output(response_json, true);
    } else {
        println!("Status: {}", status_str);
    }

    if status != ServingStatus::Serving {
        return Err(CliError::Rpc(format!(
            "service not healthy: {}",
            status_str
        )));
    }

    Ok(())
}

pub async fn get_height(config: &Config, json_format: bool) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;
    let heights = client.get_block_height().await?;

    if json_format {
        let response = serde_json::json!({
            "getheight": {
                "status": "success",
                "finalized": heights.finalized_height,
                "locally_executed": heights.locally_executed_height,
                "cluster_executed": heights.cluster_executed_height,
            }
        });
        output::print_output(response, true);
    } else {
        println!("Finalized Height: {}", heights.finalized_height);
        println!(
            "Locally Executed Height: {}",
            heights.locally_executed_height
        );
        println!(
            "Cluster Executed Height: {}",
            heights.cluster_executed_height
        );
    }

    Ok(())
}

/// Execute the getAccountInfo command
pub async fn get_account_info(
    config: &Config,
    account_input: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;

    // Resolve account input to public key
    let pubkey = resolve_account_input(account_input, config)?;

    match client.get_account_info(&pubkey, None).await {
        Ok(Some(account)) => {
            let mut account_data = HashMap::new();
            account_data.insert(
                "pubkey".to_string(),
                serde_json::Value::String(pubkey.to_string()),
            );
            account_data.insert(
                "balance".to_string(),
                serde_json::Value::Number(account.balance.into()),
            );
            account_data.insert(
                "owner".to_string(),
                serde_json::Value::String(account.owner.to_string()),
            );
            account_data.insert(
                "dataSize".to_string(),
                serde_json::Value::Number(account.data_size.into()),
            );
            account_data.insert(
                "nonce".to_string(),
                serde_json::Value::Number(account.nonce.into()),
            );
            account_data.insert(
                "stateCounter".to_string(),
                serde_json::Value::Number(account.state_counter.into()),
            );
            account_data.insert(
                "program".to_string(),
                serde_json::Value::Bool(account.program),
            );
            account_data.insert("isNew".to_string(), serde_json::Value::Bool(account.is_new));
            account_data.insert(
                "data".to_string(),
                serde_json::Value::String(account.data.unwrap_or_default()),
            );

            let response = output::create_account_info_response(account_data);
            output::print_output(response, json_format);
            Ok(())
        }
        Ok(None) => {
            let error_msg = "Account not found";
            if json_format {
                let error_response = serde_json::json!({
                    "error": error_msg,
                    "pubkey": pubkey.to_string()
                });
                output::print_output(error_response, true);
            } else {
                output::print_error(&format!(
                    "{} for address: {}",
                    error_msg,
                    pubkey.to_string()
                ));
            }
            Err(CliError::Generic {
                message: error_msg.to_string(),
            })
        }
        Err(e) => {
            let error_msg = format!("Failed to get account info: {}", e);
            if json_format {
                let error_response = serde_json::json!({
                    "error": error_msg
                });
                output::print_output(error_response, true);
            } else {
                output::print_error(&error_msg);
            }
            Err(e)
        }
    }
}

/// Execute the getBalance command
pub async fn get_balance(
    config: &Config,
    account_input: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;

    // Resolve account input to public key
    let pubkey = resolve_account_input(account_input, config)?;

    match client.get_balance(&pubkey).await {
        Ok(balance) => {
            let response = output::create_balance_response(&pubkey.to_string(), balance);
            output::print_output(response, json_format);
            Ok(())
        }
        Err(e) => {
            let error_msg = format!("Failed to get balance: {}", e);
            if json_format {
                let error_response = serde_json::json!({
                    "error": error_msg
                });
                output::print_output(error_response, true);
            } else {
                output::print_error(&error_msg);
            }
            Err(e)
        }
    }
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
}

fn health_status_to_str(status: ServingStatus) -> &'static str {
    match status {
        ServingStatus::Serving => "serving",
        ServingStatus::NotServing => "not_serving",
        ServingStatus::ServiceUnknown => "service_unknown",
        _ => "unknown",
    }
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

    #[test]
    fn test_resolve_account_input_with_none() {
        let config = Config::default();
        let result = resolve_account_input(None, &config);
        assert!(result.is_ok(), "Should resolve default key successfully");
    }

    #[test]
    fn test_resolve_account_input_with_valid_public_key() {
        let config = Config::default();
        // Create a valid public key using the same method as the code
        let default_key = config.keys.get_default_key().unwrap();
        let keypair = keypair_from_hex(default_key).unwrap();
        let valid_pubkey = keypair.address_string.to_string();

        let result = resolve_account_input(Some(&valid_pubkey), &config);
        assert!(
            result.is_ok(),
            "Should resolve valid public key successfully"
        );
        assert_eq!(result.unwrap().to_string(), valid_pubkey);
    }

    #[test]
    fn test_resolve_account_input_with_key_name() {
        let config = Config::default();
        let result = resolve_account_input(Some("default"), &config);
        assert!(
            result.is_ok(),
            "Should resolve key name 'default' successfully"
        );
    }

    #[test]
    fn test_resolve_account_input_with_invalid_key_name() {
        let config = Config::default();
        let result = resolve_account_input(Some("nonexistent"), &config);
        assert!(result.is_err(), "Should fail for nonexistent key name");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Invalid input 'nonexistent'"));
        assert!(error_msg.contains("Available keys: default"));
    }

    #[test]
    fn test_resolve_account_input_with_invalid_public_key() {
        let config = Config::default();
        let result = resolve_account_input(Some("invalid_pubkey"), &config);
        assert!(result.is_err(), "Should fail for invalid public key format");

        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Invalid input 'invalid_pubkey'"));
        assert!(error_msg.contains("Available keys: default"));
    }
}
