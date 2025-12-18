//! ABI management command implementations

use std::fs;
use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::TransactionBuilder;
use thru_client::Client as RpcClient;

use crate::cli::AbiCommands;
use crate::commands::uploader::UploaderManager;
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use serde_json::json;
use std::convert::TryInto;

const ABI_SEED_MAX_LEN: usize = 32;

pub async fn handle_abi_command(
    config: &Config,
    subcommand: AbiCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        AbiCommands::Create {
            ephemeral,
            seed,
            fee_payer,
            authority,
            abi_file,
        } => {
            create_abi_account(
                config,
                ephemeral,
                &seed,
                authority.as_deref(),
                fee_payer.as_deref(),
                &abi_file,
                json_format,
            )
            .await
        }
        AbiCommands::Upgrade {
            ephemeral,
            seed,
            fee_payer,
            authority,
            abi_file,
        } => {
            upgrade_abi_account(
                config,
                ephemeral,
                &seed,
                authority.as_deref(),
                fee_payer.as_deref(),
                &abi_file,
                json_format,
            )
            .await
        }
        AbiCommands::Finalize {
            ephemeral,
            seed,
            fee_payer,
            authority,
        } => {
            finalize_abi_account(
                config,
                ephemeral,
                &seed,
                authority.as_deref(),
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        AbiCommands::Close {
            ephemeral,
            seed,
            fee_payer,
            authority,
        } => {
            close_abi_account(
                config,
                ephemeral,
                &seed,
                authority.as_deref(),
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        AbiCommands::Get {
            ephemeral,
            program_account,
            data,
            out,
        } => {
            let show_data = matches!(data.to_ascii_lowercase().as_str(), "y" | "yes" | "true" | "1");
            get_abi_account_info(
                config,
                ephemeral,
                &program_account,
                show_data,
                out.as_deref(),
                json_format,
            )
            .await
        }
    }
}

struct AbiProgramManager {
    rpc_client: RpcClient,
    fee_payer_keypair: KeyPair,
}

impl AbiProgramManager {
    /// Create new ABI program manager with optional fee payer override
    async fn new(config: &Config, fee_payer_name: Option<&str>) -> Result<Self, CliError> {
        let rpc_url = config.get_grpc_url()?;
        let rpc_client = RpcClient::builder()
            .http_endpoint(rpc_url)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .auth_token(config.auth_token.clone())
            .build()?;

        // Ensure the configured manager program key is valid even if unused directly
        let _ = config.get_manager_pubkey()?;

        let fee_payer_key_hex = if let Some(name) = fee_payer_name {
            config.keys.get_key(name)?
        } else {
            config.keys.get_default_key()?
        };
        let fee_payer_keypair = crypto::keypair_from_hex(fee_payer_key_hex)?;

        Ok(Self {
            rpc_client,
            fee_payer_keypair,
        })
    }

    fn fee_payer(&self) -> &KeyPair {
        &self.fee_payer_keypair
    }

    fn rpc_client(&self) -> &RpcClient {
        &self.rpc_client
    }


    async fn get_current_nonce(&self) -> Result<u64, CliError> {
        match self
            .rpc_client
            .get_account_info(&self.fee_payer_keypair.address_string, None, None)
            .await
        {
            Ok(Some(account)) => Ok(account.nonce),
            Ok(None) => Err(CliError::NonceManagement(
                "Fee payer account not found. Please ensure the account is funded.".to_string(),
            )),
            Err(e) => Err(CliError::NonceManagement(format!(
                "Failed to retrieve account nonce: {}",
                e
            ))),
        }
    }

    async fn get_current_slot(&self) -> Result<u64, CliError> {
        let block_height = self.rpc_client.get_block_height().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
        })?;
        Ok(block_height.finalized_height)
    }

    async fn submit_and_verify_transaction(
        &self,
        transaction: &Transaction,
    ) -> Result<(), CliError> {
        let wire_bytes = transaction.to_wire();
        let timeout = Duration::from_secs(30);

        let transaction_details = self
            .rpc_client
            .execute_transaction(&wire_bytes, timeout)
            .await
            .map_err(|e| CliError::TransactionSubmission(e.to_string()))?;

        let has_failure =
            transaction_details.execution_result != 0 || transaction_details.vm_error != 0;
        let vm_error_label = format_vm_error(transaction_details.vm_error);
        let vm_error_suffix = if transaction_details.vm_error != 0 {
            format!(" ({})", vm_error_label)
        } else {
            String::new()
        };
        let user_error_label = if transaction_details.user_error_code != 0 {
            format!("0x{:04X}", transaction_details.user_error_code)
        } else {
            "None".to_string()
        };
        let user_error_suffix = if transaction_details.user_error_code != 0 {
            format!(" - Manager program error: {}", user_error_label)
        } else {
            String::new()
        };

        output::print_success(&format!(
            "Transaction completed: {}",
            transaction_details.signature.as_str()
        ));

        if has_failure {
            output::print_warning(&format!(
                "Transaction completed with execution result: {} (hex 0x{:X}) vm_error: {}{}{}",
                transaction_details.execution_result,
                transaction_details.execution_result,
                vm_error_label,
                vm_error_suffix,
                user_error_suffix
            ));
        }

        if has_failure {
            let vm_error_display = if transaction_details.vm_error != 0 {
                format!("{}{}", transaction_details.vm_error, vm_error_suffix)
            } else {
                "0".to_string()
            };
            let message = format!(
                "Transaction failed (execution_result={} (hex 0x{:X}), vm_error={}, manager_error={})",
                transaction_details.execution_result,
                transaction_details.execution_result,
                vm_error_display,
                user_error_label
            );

            return Err(CliError::TransactionFailed {
                message,
                execution_result: transaction_details.execution_result,
                vm_error: transaction_details.vm_error,
                vm_error_label,
                user_error_code: transaction_details.user_error_code,
                user_error_label,
                signature: transaction_details.signature.as_str().to_string(),
            });
        }

        Ok(())
    }
}

fn seed_with_suffix(base_seed: &str, suffix: &str) -> (String, bool) {
    let combined = format!("{}_{}", base_seed, suffix);
    if combined.len() <= ABI_SEED_MAX_LEN {
        (combined, false)
    } else {
        let digest = crypto::calculate_sha256(combined.as_bytes());
        let hashed = hex::encode(&digest[..ABI_SEED_MAX_LEN / 2]);
        (hashed, true)
    }
}

fn derive_abi_seed_bytes(program_account: &Pubkey) -> Result<[u8; 32], CliError> {
    let mut base = program_account
        .to_bytes()
        .map_err(|e| CliError::Crypto(e.to_string()))?
        .to_vec();
    base.extend_from_slice(b"_abi_account");
    let digest = crypto::calculate_sha256(&base);
    Ok(digest)
}


async fn create_abi_account(
    config: &Config,
    ephemeral: bool,
    program_seed: &str,
    authority: Option<&str>,
    fee_payer: Option<&str>,
    abi_file: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let abi_path = Path::new(abi_file);
    if !abi_path.exists() {
        let error_msg = format!("ABI file not found: {}", abi_file);
        if json_format {
            output::print_output(json!({ "error": error_msg }), true);
        } else {
            output::print_error(&error_msg);
        }
        return Err(CliError::Generic { message: error_msg });
    }

    let is_yaml = abi_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("yaml"))
        .unwrap_or(false);
    if !is_yaml {
        let error_msg = format!("ABI file must have .yaml extension: {}", abi_file);
        if json_format {
            output::print_output(json!({ "error": error_msg }), true);
        } else {
            output::print_error(&error_msg);
        }
        return Err(CliError::Validation(error_msg));
    }

    let abi_data = fs::read(abi_path).map_err(CliError::Io)?;

    if !json_format {
        output::print_info(&format!(
            "Creating ABI account from file: {} ({} bytes)",
            abi_file,
            abi_data.len()
        ));
        output::print_info(&format!("Program seed: {}", program_seed));
    }

    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;

    let authority_pubkey = if let Some(auth_name) = authority {
        let auth_key = config.keys.get_key(auth_name)?;
        let auth_keypair = crypto::keypair_from_hex(auth_key)?;
        auth_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    // Step 1: Upload ABI data to temporary buffer
    let (temp_seed, temp_seed_hashed) = seed_with_suffix(program_seed, "abi_temp");

    if !json_format {
        output::print_info(&format!(
            "Step 1: Uploading ABI data to temporary buffer (seed: {})",
            temp_seed
        ));
        if temp_seed_hashed {
            output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seed");
        }
    }

    let uploader_manager = UploaderManager::new(config).await?;
    let upload_session = uploader_manager
        .upload_program(&temp_seed, &abi_data, 30 * 1024, json_format)
        .await?;

    if !json_format {
        output::print_success("✓ ABI data uploaded to temporary buffer successfully");
        output::print_info(&format!(
            "Temporary meta account: {}",
            upload_session.meta_account
        ));
        output::print_info(&format!(
            "Temporary buffer account: {}",
            upload_session.buffer_account
        ));
    }

    // Step 2: Invoke ABI manager program
    if !json_format {
        output::print_info("Step 2: Creating ABI account via ABI manager program");
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    config_with_manager.abi_manager_program_public_key = abi_manager_program_pubkey.to_string();
    let abi_program_manager = AbiProgramManager::new(&config_with_manager, fee_payer).await?;

    let nonce = abi_program_manager.get_current_nonce().await?;
    let start_slot = abi_program_manager.get_current_slot().await?;

    let (program_meta_account, program_account) = crypto::derive_manager_accounts_from_seed(
        program_seed,
        &manager_program_pubkey,
        ephemeral,
    )?;
    let abi_seed_bytes = derive_abi_seed_bytes(&program_account)?;
    let abi_account = thru_base::crypto_utils::derive_program_address(
        &abi_seed_bytes,
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    if !json_format {
        output::print_info(&format!("Associated Program: {}", program_account));
        output::print_info(&format!("ABI account: {}", abi_account));
        output::print_info(&format!(
            "Fee payer: {}",
            abi_program_manager.fee_payer().address_string
        ));
    }

    let abi_proof = if !ephemeral {
        if !json_format {
            output::print_info("Creating state proof for ABI account...");
        }
        let proof_config = MakeStateProofConfig {
            proof_type: ProofType::Creating,
            slot: None,
        };
        Some(
            abi_program_manager
                .rpc_client()
                .make_state_proof(&abi_account, &proof_config)
                .await
                .map_err(|e| {
                    CliError::ProgramUpload(format!(
                        "Failed to create ABI account state proof: {}",
                        e
                    ))
                })?,
        )
    } else {
        None
    };

    let mut transaction = TransactionBuilder::build_abi_manager_create(
        abi_program_manager.fee_payer().public_key,
        abi_manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        abi_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        upload_session
            .buffer_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_pubkey,
        0,
        abi_data.len() as u32,
        &abi_seed_bytes,
        ephemeral,
        abi_proof.as_deref(),
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&abi_program_manager.fee_payer().private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    abi_program_manager
        .submit_and_verify_transaction(&transaction)
        .await?;

    if !json_format {
        output::print_success("✓ ABI account created successfully");
        output::print_info("Step 3: Cleaning up temporary buffer account");
    }

    match uploader_manager
        .cleanup_program(&temp_seed, json_format)
        .await
    {
        Ok(()) => {
            if !json_format {
                output::print_success("✓ Temporary buffer account cleaned up successfully");
            }
        }
        Err(e) => {
            if !json_format {
                output::print_warning(&format!(
                    "Warning: Failed to clean up temporary buffer account: {}",
                    e
                ));
                output::print_info("You may need to manually clean it up later using:");
                output::print_info(&format!("  thru-cli uploader cleanup {}", temp_seed));
            }
        }
    }

    if json_format {
        let response = json!({
            "abi_create": {
                "status": "success",
                "ephemeral": ephemeral,
                "program_meta_account": program_meta_account.to_string(),
                "abi_account": abi_account.to_string(),
                "program_seed": program_seed,
                "temp_seed": temp_seed,
                "abi_size": abi_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("🎉 ABI account created successfully!");
        output::print_info(&format!("Program meta account: {}", program_meta_account));
        output::print_info(&format!("ABI account: {}", abi_account));
    }

    Ok(())
}

async fn upgrade_abi_account(
    config: &Config,
    ephemeral: bool,
    program_seed: &str,
    authority: Option<&str>,
    fee_payer: Option<&str>,
    abi_file: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let abi_path = Path::new(abi_file);
    if !abi_path.exists() {
        let error_msg = format!("ABI file not found: {}", abi_file);
        if json_format {
            output::print_output(json!({ "error": error_msg }), true);
        } else {
            output::print_error(&error_msg);
        }
        return Err(CliError::Generic { message: error_msg });
    }

    let is_yaml = abi_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("yaml"))
        .unwrap_or(false);
    if !is_yaml {
        let error_msg = format!("ABI file must have .yaml extension: {}", abi_file);
        if json_format {
            output::print_output(json!({ "error": error_msg }), true);
        } else {
            output::print_error(&error_msg);
        }
        return Err(CliError::Validation(error_msg));
    }

    let abi_data = fs::read(abi_path).map_err(CliError::Io)?;

    if !json_format {
        output::print_info(&format!(
            "Upgrading ABI account from file: {} ({} bytes)",
            abi_file,
            abi_data.len()
        ));
        output::print_info(&format!("Program seed: {}", program_seed));
    }

    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;

    let authority_pubkey = if let Some(auth_name) = authority {
        let auth_key = config.keys.get_key(auth_name)?;
        let auth_keypair = crypto::keypair_from_hex(auth_key)?;
        auth_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    // Step 1: Upload ABI data to temporary buffer
    let (temp_seed, temp_seed_hashed) = seed_with_suffix(program_seed, "abi_upgrade");

    if !json_format {
        output::print_info(&format!(
            "Step 1: Uploading ABI upgrade data to temporary buffer (seed: {})",
            temp_seed
        ));
        if temp_seed_hashed {
            output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seed");
        }
    }

    let uploader_manager = UploaderManager::new(config).await?;
    let upload_session = uploader_manager
        .upload_program(&temp_seed, &abi_data, 30 * 1024, json_format)
        .await?;

    if !json_format {
        output::print_success("✓ ABI upgrade data uploaded to temporary buffer successfully");
        output::print_info(&format!(
            "Temporary meta account: {}",
            upload_session.meta_account
        ));
        output::print_info(&format!(
            "Temporary buffer account: {}",
            upload_session.buffer_account
        ));
    }

    // Step 2: Upgrade ABI via ABI manager program
    if !json_format {
        output::print_info("Step 2: Upgrading ABI account via ABI manager program");
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    config_with_manager.abi_manager_program_public_key = abi_manager_program_pubkey.to_string();
    let abi_program_manager = AbiProgramManager::new(&config_with_manager, fee_payer).await?;

    let nonce = abi_program_manager.get_current_nonce().await?;
    let start_slot = abi_program_manager.get_current_slot().await?;

    let (program_meta_account, program_account) = crypto::derive_manager_accounts_from_seed(
        program_seed,
        &manager_program_pubkey,
        ephemeral,
    )?;
    let abi_seed_bytes = derive_abi_seed_bytes(&program_account)?;
    let abi_account = thru_base::crypto_utils::derive_program_address(
        &abi_seed_bytes,
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    if !json_format {
        output::print_info(&format!("Associated Program: {}", program_account));
        output::print_info(&format!("ABI account: {}", abi_account));
        output::print_info(&format!(
            "Fee payer: {}",
            abi_program_manager.fee_payer().address_string
        ));
    }

    let mut transaction = TransactionBuilder::build_abi_manager_upgrade(
        abi_program_manager.fee_payer().public_key,
        abi_manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        abi_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        upload_session
            .buffer_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_pubkey,
        0,
        abi_data.len() as u32,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&abi_program_manager.fee_payer().private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    abi_program_manager
        .submit_and_verify_transaction(&transaction)
        .await?;

    if !json_format {
        output::print_success("✓ ABI account upgraded successfully");
        output::print_info("Step 3: Cleaning up temporary buffer account");
    }

    match uploader_manager
        .cleanup_program(&temp_seed, json_format)
        .await
    {
        Ok(()) => {
            if !json_format {
                output::print_success("✓ Temporary buffer account cleaned up successfully");
            }
        }
        Err(e) => {
            if !json_format {
                output::print_warning(&format!(
                    "Warning: Failed to clean up temporary buffer account: {}",
                    e
                ));
                output::print_info("You may need to manually clean it up later using:");
                output::print_info(&format!("  thru-cli uploader cleanup {}", temp_seed));
            }
        }
    }

    if json_format {
        let response = json!({
            "abi_upgrade": {
                "status": "success",
                "ephemeral": ephemeral,
                "program_meta_account": program_meta_account.to_string(),
                "abi_account": abi_account.to_string(),
                "program_seed": program_seed,
                "temp_seed": temp_seed,
                "abi_size": abi_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("🎉 ABI account upgraded successfully!");
        output::print_info(&format!("Program meta account: {}", program_meta_account));
        output::print_info(&format!("ABI account: {}", abi_account));
    }

    Ok(())
}

/// Finalize an ABI account to prevent further upgrades
async fn finalize_abi_account(
    config: &Config,
    ephemeral: bool,
    program_seed: &str,
    authority: Option<&str>,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;

    let authority_pubkey = if let Some(auth_name) = authority {
        let auth_key = config.keys.get_key(auth_name)?;
        let auth_keypair = crypto::keypair_from_hex(auth_key)?;
        auth_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    if !json_format {
        output::print_info("Finalizing ABI account via ABI manager program");
        output::print_info(&format!("Program seed: {}", program_seed));
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    config_with_manager.abi_manager_program_public_key = abi_manager_program_pubkey.to_string();
    let abi_program_manager = AbiProgramManager::new(&config_with_manager, fee_payer).await?;

    let nonce = abi_program_manager.get_current_nonce().await?;
    let start_slot = abi_program_manager.get_current_slot().await?;

    let (program_meta_account, program_account) = crypto::derive_manager_accounts_from_seed(
        program_seed,
        &manager_program_pubkey,
        ephemeral,
    )?;
    let abi_seed_bytes = derive_abi_seed_bytes(&program_account)?;
    let abi_account = thru_base::crypto_utils::derive_program_address(
        &abi_seed_bytes,
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    if !json_format {
        output::print_info(&format!("Associated Program: {}", program_account));
        output::print_info(&format!("ABI account: {}", abi_account));
        output::print_info(&format!(
            "Fee payer: {}",
            abi_program_manager.fee_payer().address_string
        ));
    }

    let mut transaction = TransactionBuilder::build_abi_manager_finalize(
        abi_program_manager.fee_payer().public_key,
        abi_manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        abi_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_pubkey,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&abi_program_manager.fee_payer().private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    abi_program_manager
        .submit_and_verify_transaction(&transaction)
        .await?;

    if json_format {
        let response = json!({
            "abi_finalize": {
                "status": "success",
                "ephemeral": ephemeral,
                "program_meta_account": program_meta_account.to_string(),
                "abi_account": abi_account.to_string(),
                "program_seed": program_seed
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("🎉 ABI account finalized successfully!");
        output::print_info(&format!("Program meta account: {}", program_meta_account));
        output::print_info(&format!("ABI account: {}", abi_account));
    }

    Ok(())
}

/// Close an ABI account to reclaim rent once finalized
async fn close_abi_account(
    config: &Config,
    ephemeral: bool,
    program_seed: &str,
    authority: Option<&str>,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;

    let authority_pubkey = if let Some(auth_name) = authority {
        let auth_key = config.keys.get_key(auth_name)?;
        let auth_keypair = crypto::keypair_from_hex(auth_key)?;
        auth_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    if !json_format {
        output::print_info("Closing ABI account via ABI manager program");
        output::print_info(&format!("Program seed: {}", program_seed));
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    config_with_manager.abi_manager_program_public_key = abi_manager_program_pubkey.to_string();
    let abi_program_manager = AbiProgramManager::new(&config_with_manager, fee_payer).await?;

    let nonce = abi_program_manager.get_current_nonce().await?;
    let start_slot = abi_program_manager.get_current_slot().await?;

    let (program_meta_account, program_account) = crypto::derive_manager_accounts_from_seed(
        program_seed,
        &manager_program_pubkey,
        ephemeral,
    )?;
    let abi_seed_bytes = derive_abi_seed_bytes(&program_account)?;
    let abi_account = thru_base::crypto_utils::derive_program_address(
        &abi_seed_bytes,
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    if !json_format {
        output::print_info(&format!("Associated Program: {}", program_account));
        output::print_info(&format!("ABI account: {}", abi_account));
        output::print_info(&format!(
            "Fee payer: {}",
            abi_program_manager.fee_payer().address_string
        ));
    }

    let mut transaction = TransactionBuilder::build_abi_manager_close(
        abi_program_manager.fee_payer().public_key,
        abi_manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        abi_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_pubkey,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&abi_program_manager.fee_payer().private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    abi_program_manager
        .submit_and_verify_transaction(&transaction)
        .await?;

    if json_format {
        let response = json!({
            "abi_close": {
                "status": "success",
                "ephemeral": ephemeral,
                "program_meta_account": program_meta_account.to_string(),
                "abi_account": abi_account.to_string(),
                "program_seed": program_seed
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success("🎉 ABI account closed successfully!");
        output::print_info(&format!("Program meta account: {}", program_meta_account));
        output::print_info(&format!("ABI account: {}", abi_account));
    }

    Ok(())
}

/// Retrieve ABI account metadata and optional YAML contents
async fn get_abi_account_info(
    config: &Config,
    ephemeral: bool,
    program_account_str: &str,
    include_data: bool,
    out_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    config_with_manager.abi_manager_program_public_key = abi_manager_program_pubkey.to_string();
    let abi_program_manager = AbiProgramManager::new(&config_with_manager, None).await?;

    let program_account = Pubkey::new(program_account_str.to_string()).map_err(|e| {
        CliError::Validation(format!("Invalid program account public key: {}", e))
    })?;
    let abi_seed_bytes = derive_abi_seed_bytes(&program_account)?;
    let abi_account = thru_base::crypto_utils::derive_program_address(
        &abi_seed_bytes,
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    let account_info_opt = abi_program_manager
        .rpc_client()
        .get_account_info(&abi_account, None, None)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to fetch ABI account info: {}", e),
        })?;

    let account_info = match account_info_opt {
        Some(info) => info,
        None => {
            let msg = format!("ABI account {} not found on-chain", abi_account);
            if json_format {
                output::print_output(json!({ "error": msg }), true);
            } else {
                output::print_error(&msg);
            }
            return Err(CliError::Generic { message: msg });
        }
    };

    let data_b64 = account_info.data.clone().ok_or_else(|| {
        CliError::Generic {
            message: format!("ABI account {} has no data", abi_account),
        }
    })?;

    let data_bytes = general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| CliError::Generic {
            message: format!("Failed to decode ABI account data: {}", e),
        })?;

    const HEADER_LEN: usize = 32 + 8 + 1 + 4;
    if data_bytes.len() < HEADER_LEN {
        return Err(CliError::Generic {
            message: format!(
                "ABI account data too small ({} bytes, expected at least {})",
                data_bytes.len(),
                HEADER_LEN
            ),
        });
    }

    let mut meta_bytes = [0u8; 32];
    meta_bytes.copy_from_slice(&data_bytes[0..32]);
    let associated_program_meta = Pubkey::from_bytes(&meta_bytes);
    let revision =
        u64::from_le_bytes(data_bytes[32..40].try_into().expect("slice length checked"));
    let state_raw = data_bytes[40];
    let state_label = match state_raw {
        0 => "OPEN",
        1 => "FINALIZED",
        _ => "UNKNOWN",
    };
    let content_sz =
        u32::from_le_bytes(data_bytes[41..45].try_into().expect("slice length checked")) as usize;

    if HEADER_LEN + content_sz > data_bytes.len() {
        return Err(CliError::Generic {
            message: format!(
                "ABI account content size {} exceeds available data {}",
                content_sz,
                data_bytes.len() - HEADER_LEN
            ),
        });
    }

    let contents = &data_bytes[HEADER_LEN..HEADER_LEN + content_sz];
    let yaml_string = String::from_utf8_lossy(contents).to_string();

    if let Some(path) = out_path {
        fs::write(path, contents).map_err(CliError::Io)?;
        if !json_format {
            println!("Full ABI YAML written to {}", path);
        }
    }

    if json_format {
        let mut response = json!({
            "abi_account": {
                "public_key": abi_account.to_string(),
                "program_account": program_account.to_string(),
                "associated_program_meta": associated_program_meta.to_string(),
                "revision": revision,
                "state": state_label,
                "state_raw": state_raw,
                "stored_yaml_size": content_sz
            }
        });

        if include_data {
            if let Some(obj) = response["abi_account"].as_object_mut() {
                obj.insert("data".to_string(), json!(yaml_string));
            }
        }

        if let Some(path) = out_path {
            if let Some(obj) = response["abi_account"].as_object_mut() {
                obj.insert("output_path".to_string(), json!(path));
            }
        }

        output::print_output(response, true);
    } else {
        println!("\x1b[1;38;2;255;112;187mABI Account Information\x1b[0m");
        println!("  Public Key: {}", abi_account);
        println!("  Program Account: {}", program_account);
        println!(
            "  Associated Program Meta: {}",
            associated_program_meta.to_string()
        );
        println!("  Version: {}", revision);
        println!("  State: {}", state_label);
        println!("  Stored YAML Size: {}", content_sz);
        if include_data {
            println!("\x1b[1;38;2;255;112;187mRetrieved ABI Data\x1b[0m\n{}", yaml_string);
        }
    }

    Ok(())
}
