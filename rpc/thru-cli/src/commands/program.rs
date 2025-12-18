//! Program management command implementations

use std::fs;
use std::path::Path;
use std::time::Duration;
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::TransactionBuilder;

use crate::cli::ProgramCommands;
use crate::commands::uploader::UploaderManager;
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use thru_client::{Client as RpcClient, VersionContext};

const PROGRAM_SEED_MAX_LEN: usize = 32;

fn seed_with_suffix(base_seed: &str, suffix: &str) -> (String, bool) {
    let combined = format!("{}_{}", base_seed, suffix);
    if combined.len() <= PROGRAM_SEED_MAX_LEN {
        (combined, false)
    } else {
        let digest = crypto::calculate_sha256(combined.as_bytes());
        let hashed = hex::encode(&digest[..PROGRAM_SEED_MAX_LEN / 2]);
        (hashed, true)
    }
}

/// Handle program subcommands
pub async fn handle_program_command(
    config: &Config,
    subcommand: ProgramCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        ProgramCommands::Create {
            manager,
            ephemeral,
            seed,
            authority,
            program_file,
            chunk_size,
        } => {
            create_program(
                config,
                manager.as_deref(),
                ephemeral,
                &seed,
                authority.as_deref(),
                &program_file,
                chunk_size,
                json_format,
            )
            .await
        }
        ProgramCommands::Upgrade {
            manager,
            ephemeral,
            seed,
            program_file,
            chunk_size,
        } => {
            upgrade_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                &program_file,
                chunk_size,
                json_format,
            )
            .await
        }
        ProgramCommands::SetPause {
            manager,
            ephemeral,
            seed,
            paused,
        } => {
            // Parse paused string to boolean
            let paused_bool = match paused.to_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => true,
                "false" | "0" | "no" | "off" => false,
                _ => {
                    let error_msg = format!(
                        "Invalid paused value '{}'. Use: true/false, 1/0, yes/no, or on/off",
                        paused
                    );
                    if json_format {
                        let error_response = serde_json::json!({
                            "error": error_msg
                        });
                        output::print_output(error_response, true);
                    } else {
                        output::print_error(&error_msg);
                    }
                    return Err(CliError::Validation(error_msg));
                }
            };

            set_pause_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                paused_bool,
                json_format,
            )
            .await
        }
        ProgramCommands::Destroy {
            manager,
            ephemeral,
            seed,
            fee_payer,
        } => {
            destroy_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        ProgramCommands::Finalize {
            manager,
            ephemeral,
            seed,
            fee_payer,
        } => {
            finalize_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        ProgramCommands::SetAuthority {
            manager,
            ephemeral,
            seed,
            authority_candidate,
        } => {
            set_authority_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                &authority_candidate,
                json_format,
            )
            .await
        }
        ProgramCommands::ClaimAuthority {
            manager,
            seed,
            ephemeral,
            fee_payer,
        } => {
            claim_authority_program(
                config,
                manager.as_deref(),
                &seed,
                ephemeral,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        ProgramCommands::DeriveAddress {
            program_id,
            seed,
            ephemeral,
        } => derive_program_address(&program_id, &seed, ephemeral, json_format),
        ProgramCommands::DeriveManagerAccounts {
            manager,
            seed,
            ephemeral,
        } => derive_manager_accounts(config, manager.as_deref(), &seed, ephemeral, json_format),
        ProgramCommands::Status {
            manager,
            seed,
            ephemeral,
        } => get_program_status(config, manager.as_deref(), &seed, ephemeral, json_format).await,
    }
}

/// Program manager for transaction building and execution
pub struct ProgramManager {
    rpc_client: RpcClient,
    fee_payer_keypair: KeyPair,
}

impl ProgramManager {
    /// Create new program manager
    pub async fn new(config: &Config) -> Result<Self, CliError> {
        Self::new_with_fee_payer(config, None).await
    }

    /// Create new program manager with optional fee payer override
    pub async fn new_with_fee_payer(
        config: &Config,
        fee_payer_name: Option<&str>,
    ) -> Result<Self, CliError> {
        // Create RPC client
        let rpc_url = config.get_grpc_url()?;
        let rpc_client = RpcClient::builder()
            .http_endpoint(rpc_url)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .auth_token(config.auth_token.clone())
            .build()?;

        // Get manager program public key (though not stored in struct)
        let _manager_program_pubkey = config.get_manager_pubkey()?;

        // Create fee payer keypair from config
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

    /// Convert manager program user error code to human-readable string
    fn decode_manager_error(user_error_code: u64) -> String {
        if user_error_code == 0 {
            return "Success".to_string();
        }

        // Check if this is a syscall error (negative values when cast as i64)
        if user_error_code as i64 >= -41 && user_error_code as i64 <= -7 {
            return Self::decode_syscall_error(user_error_code);
        }

        // Error type constants (from tn_manager_program.h)
        const ERR_SIZE_ERROR: u64 = 0x0100;
        const ERR_VALUE_ERROR: u64 = 0x0200;
        const ERR_AUTHORIZATION_ERROR: u64 = 0x0300;
        const ERR_INDEX_ERROR: u64 = 0x0400;
        const ERR_NA_ERROR: u64 = 0x0500;
        const ERR_RELATIONSHIP_ERROR: u64 = 0x0600;
        const ERR_STATE_ERROR: u64 = 0x0700;
        const ERR_NOT_WRITABLE_ERROR: u64 = 0x0800;

        // Error object constants
        const ERR_INSTRUCTION: u64 = 0x01;
        const ERR_DISCRIMINANT: u64 = 0x02;
        const ERR_SRCBUF_ACC: u64 = 0x03;
        const ERR_META_ACC: u64 = 0x04;
        const ERR_PROGRAM_ACC: u64 = 0x05;
        const ERR_AUTHORITY_ACC: u64 = 0x06;
        const ERR_AUTHORITY_CANDIDATE_ACC: u64 = 0x07;

        // Extract error type (high byte) and error object (low byte)
        let error_type = user_error_code & 0xFF00;
        let error_object = user_error_code & 0x00FF;

        // Decode error type
        let error_type_str = match error_type {
            ERR_SIZE_ERROR => "Size error",
            ERR_VALUE_ERROR => "Value error",
            ERR_AUTHORIZATION_ERROR => "Authorization error",
            ERR_INDEX_ERROR => "Index error",
            ERR_NA_ERROR => "Account not available error",
            ERR_RELATIONSHIP_ERROR => "Account relationship error",
            ERR_STATE_ERROR => "State error",
            ERR_NOT_WRITABLE_ERROR => "Not writable error",
            _ => "Unknown error type",
        };

        // Decode error object
        let error_object_str = match error_object {
            ERR_INSTRUCTION => "in instruction",
            ERR_DISCRIMINANT => "invalid discriminant",
            ERR_SRCBUF_ACC => "in source buffer account",
            ERR_META_ACC => "in meta account",
            ERR_PROGRAM_ACC => "in program account",
            ERR_AUTHORITY_ACC => "in authority account",
            ERR_AUTHORITY_CANDIDATE_ACC => "in authority candidate account",
            _ => {
                if error_object == 0 {
                    ""
                } else {
                    "in unknown object"
                }
            }
        };

        // Combine error type and object
        if error_object == 0 || error_object_str.is_empty() {
            format!("{} (0x{:04X})", error_type_str, user_error_code)
        } else {
            format!(
                "{} {} (0x{:04X})",
                error_type_str, error_object_str, user_error_code
            )
        }
    }

    /// Decode syscall error codes (from tn_vm_base.h)
    fn decode_syscall_error(error_code: u64) -> String {
        let error_code_i64 = error_code as i64;
        let error_description = match error_code_i64 {
            -7 => "Bad segment table size",
            -8 => "Invalid account index",
            -9 => "Account does not exist",
            -10 => "Account not writable",
            -11 => "Balance overflow",
            -12 => "Account too big",
            -13 => "Invalid object reference kind",
            -14 => "Object not writable",
            -15 => "Account already exists",
            -16 => "Bad account address",
            -17 => "Account is not program",
            -18 => "Account has data",
            -19 => "Segment already mapped",
            -20 => "Bad parameters",
            -21 => "Invalid segment ID",
            -22 => "Invalid address",
            -23 => "Invalid state proof",
            -24 => "Call depth too deep",
            -25 => "Revert",
            -26 => "Insufficient pages",
            -27 => "Invalid account",
            -28 => "Invalid segment size",
            -29 => "Unfreeable page",
            -30 => "Log data too large",
            -31 => "Event too large",
            -32 => "Invalid proof length",
            -33 => "Invalid proof slot",
            -34 => "Account in compression timeout",
            -35 => "Invalid account data size",
            -36 => "Invalid seed length",
            -37 => "Transaction has compressed account",
            -38 => "Insufficient balance",
            -39 => "Invalid offset",
            -40 => "Compute units exceeded",
            -41 => "Invalid flags",
            _ => "Unknown syscall error",
        };

        format!("Syscall error: {} ({})", error_description, error_code_i64)
    }

    /// Get current nonce for fee payer account
    async fn get_current_nonce(&self) -> Result<u64, CliError> {
        match self
            .rpc_client
            .get_account_info(&self.fee_payer_keypair.address_string, None, Some(VersionContext::Current))
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

    /// Get current slot
    async fn get_current_slot(&self) -> Result<u64, CliError> {
        let block_height = self.rpc_client.get_block_height().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
        })?;
        Ok(block_height.finalized_height)
    }

    /// Submit and verify transaction
    async fn submit_and_verify_transaction(
        &self,
        transaction: &Transaction,
        json_format: bool,
        user_error_decoder: fn(u64) -> String,
    ) -> Result<(), CliError> {
        // Execute transaction and wait for completion
        let wire_bytes = transaction.to_wire();
        let timeout = Duration::from_secs(30); // 30 second timeout

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
            user_error_decoder(transaction_details.user_error_code)
        } else {
            "None".to_string()
        };
        let user_error_suffix = if transaction_details.user_error_code != 0 {
            format!(" - Manager program error: {}", user_error_label)
        } else {
            String::new()
        };

        if !json_format {
            output::print_success(&format!(
                "Transaction completed: {}",
                transaction_details.signature.as_str()
            ));

            if has_failure {
                output::print_warning(&format!(
                    "Transaction completed with execution result: {} (hex 0x{:X}) vm_error: {}{}{}",
                    transaction_details.execution_result as i64,
                    transaction_details.execution_result,
                    vm_error_label,
                    vm_error_suffix,
                    user_error_suffix
                ));
            }
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

/// Create a new managed program from a program file
async fn create_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    ephemeral: bool,
    seed: &str,
    authority: Option<&str>,
    program_file: &str,
    chunk_size: usize,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate program file exists
    let program_path = Path::new(program_file);
    if !program_path.exists() {
        let abs_path = std::env::current_dir()
            .map(|cwd| cwd.join(program_file).display().to_string())
            .unwrap_or_else(|_| program_file.to_string());
        if json_format {
            let error_response = serde_json::json!({
                "error": {
                    "type": "file_not_found",
                    "message": format!("Program file not found: {}", program_file),
                    "path": program_file,
                    "resolved_path": abs_path
                }
            });
            output::print_output(error_response, true);
        } else {
            output::print_error(&format!("Program file not found: {}", program_file));
            output::print_error(&format!("Resolved path: {}", abs_path));
        }
        return Err(CliError::Reported);
    }

    // Read program data
    let program_data = fs::read(program_path).map_err(|e| CliError::Io(e))?;

    if !json_format {
        output::print_info(&format!(
            "Creating {} managed program from file: {} ({} bytes)",
            if ephemeral { "ephemeral" } else { "permanent" },
            program_file,
            program_data.len()
        ));
        output::print_info(&format!("User seed: {}", seed));
    }

    // Get manager program public key
    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Get authority public key
    let authority_pubkey = if let Some(auth_name) = authority {
        let auth_key = config.keys.get_key(auth_name)?;
        let auth_keypair = crypto::keypair_from_hex(auth_key)?;
        auth_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    // Step 1: Upload program to temporary buffer account
    let (temp_seed, temp_seed_hashed) = seed_with_suffix(seed, "temporary");

    if !json_format {
        output::print_info(&format!(
            "Step 1: Uploading program to temporary buffer (seed: {})",
            temp_seed
        ));
        if temp_seed_hashed {
            output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seed");
        }
    }

    // Create uploader manager and upload the program
    let uploader_manager = UploaderManager::new(config).await?;
    let upload_session = uploader_manager
        .upload_program(&temp_seed, &program_data, chunk_size, json_format)
        .await?;

    if !json_format {
        output::print_success("✓ Program uploaded to temporary buffer successfully");
        output::print_info(&format!(
            "Temporary meta account: {}",
            upload_session.meta_account
        ));
        output::print_info(&format!(
            "Temporary buffer account: {}",
            upload_session.buffer_account
        ));
    }

    // Step 2: Create managed program from the temporary buffer
    if !json_format {
        output::print_info("Step 2: Creating managed program from temporary buffer");
    }

    // Create program manager
    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager = ProgramManager::new(&config_with_manager).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    // Derive meta and program account addresses for the managed program
    let (meta_account, program_account) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info(&format!(
            "Fee payer: {}",
            program_manager.fee_payer_keypair.address_string
        ));
        output::print_info(&format!("Manager program meta account: {}", meta_account));
        output::print_info(&format!("Manager program account: {}", program_account));
    }

    // Create state proofs if not ephemeral
    let (meta_proof, program_proof) = if !ephemeral {
        if !json_format {
            output::print_info("Creating state proofs for permanent program...");
        }

        let state_proof_config = MakeStateProofConfig {
            proof_type: ProofType::Creating,
            slot: None,
        };

        // Create proof for meta account
        let meta_proof_bytes = program_manager
            .rpc_client
            .make_state_proof(&meta_account, &state_proof_config)
            .await
            .map_err(|e| {
                CliError::ProgramUpload(format!("Failed to create meta account state proof: {}", e))
            })?;

        // Create proof for program account
        let program_proof_bytes = program_manager
            .rpc_client
            .make_state_proof(&program_account, &state_proof_config)
            .await
            .map_err(|e| {
                CliError::ProgramUpload(format!(
                    "Failed to create program account state proof: {}",
                    e
                ))
            })?;

        (Some(meta_proof_bytes), Some(program_proof_bytes))
    } else {
        (None, None)
    };

    // Build and submit transaction to create managed program
    let mut transaction = TransactionBuilder::build_manager_create(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        upload_session
            .buffer_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_pubkey,
        0,                         // source_offset
        program_data.len() as u32, // source_size
        seed.as_bytes(),
        ephemeral,
        meta_proof.as_deref(),    // meta_proof
        program_proof.as_deref(), // program_proof
        0,                        // fee
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    // Sign transaction
    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    // Submit and verify
    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    if !json_format {
        output::print_success("✓ Managed program created successfully");
    }

    // Step 3: Clean up temporary buffer account
    if !json_format {
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
            // Don't fail the whole operation for cleanup failures
        }
    }

    if json_format {
        let response = serde_json::json!({
            "program_create": {
                "status": "success",
                "ephemeral": ephemeral,
                "meta_account": meta_account.to_string(),
                "program_account": program_account.to_string(),
                "seed": seed,
                "temp_seed": temp_seed,
                "program_size": program_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success(&format!(
            "🎉 {} managed program created successfully!",
            if ephemeral { "Ephemeral" } else { "Permanent" }
        ));
        output::print_info(&format!("Meta account: {}", meta_account));
        output::print_info(&format!("Program account: {}", program_account));
    }

    Ok(())
}


/// Upgrade an existing managed program from a program file
async fn upgrade_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    program_file: &str,
    chunk_size: usize,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate program file exists
    let program_path = Path::new(program_file);
    if !program_path.exists() {
        let abs_path = std::env::current_dir()
            .map(|cwd| cwd.join(program_file).display().to_string())
            .unwrap_or_else(|_| program_file.to_string());
        if json_format {
            let error_response = serde_json::json!({
                "error": {
                    "type": "file_not_found",
                    "message": format!("Program file not found: {}", program_file),
                    "path": program_file,
                    "resolved_path": abs_path
                }
            });
            output::print_output(error_response, true);
        } else {
            output::print_error(&format!("Program file not found: {}", program_file));
            output::print_error(&format!("Resolved path: {}", abs_path));
        }
        return Err(CliError::Reported);
    }

    // Read program data
    let program_data = fs::read(program_path).map_err(|e| CliError::Io(e))?;

    if !json_format {
        output::print_info(&format!(
            "Upgrading managed program from file: {} ({} bytes)",
            program_file,
            program_data.len()
        ));
        output::print_info(&format!("User seed: {}", seed));
    }

    // Get manager program public key
    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Step 1: Upload program to temporary buffer account
    let (temp_seed, temp_seed_hashed) = seed_with_suffix(seed, "upgrade_temporary");

    if !json_format {
        output::print_info(&format!(
            "Step 1: Uploading program to temporary buffer (seed: {})",
            temp_seed
        ));
        if temp_seed_hashed {
            output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seed");
        }
    }

    // Create uploader manager and upload the program
    let uploader_manager = UploaderManager::new(config).await?;
    let upload_session = uploader_manager
        .upload_program(&temp_seed, &program_data, chunk_size, json_format)
        .await?;

    if !json_format {
        output::print_success("✓ Program uploaded to temporary buffer successfully");
        output::print_info(&format!(
            "Temporary meta account: {}",
            upload_session.meta_account
        ));
        output::print_info(&format!(
            "Temporary buffer account: {}",
            upload_session.buffer_account
        ));
    }

    // Step 2: Upgrade managed program from the temporary buffer
    if !json_format {
        output::print_info("Step 2: Upgrading managed program from temporary buffer");
    }

    // Create program manager
    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager = ProgramManager::new(&config_with_manager).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    // Derive meta and program account addresses for the managed program
    let (meta_account, program_account) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info(&format!(
            "Fee payer: {}",
            program_manager.fee_payer_keypair.address_string
        ));
        output::print_info(&format!("Manager program meta account: {}", meta_account));
        output::print_info(&format!("Manager program account: {}", program_account));
    }

    // Build and submit transaction to upgrade managed program
    let mut transaction = TransactionBuilder::build_manager_upgrade(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        upload_session
            .buffer_account
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        0,                         // source_offset
        program_data.len() as u32, // source_size
        0,                         // fee
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    // Sign transaction
    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    // Submit and verify
    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    if !json_format {
        output::print_success("✓ Managed program upgraded successfully");
    }

    // Step 3: Clean up temporary buffer account
    if !json_format {
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
            // Don't fail the whole operation for cleanup failures
        }
    }

    if json_format {
        let response = serde_json::json!({
            "program_upgrade": {
                "status": "success",
                "meta_account": meta_account.to_string(),
                "program_account": program_account.to_string(),
                "seed": seed,
                "temp_seed": temp_seed,
                "program_size": program_data.len()
            }
        });
        output::print_output(response, true);
    } else {
        output::print_success(&format!(
            "Program upgrade completed! New program size: {} bytes",
            program_data.len()
        ));
    }

    Ok(())
}

/// Set pause state of a managed program
async fn set_pause_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    paused: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Derive meta and program account addresses from seed
    let (meta_account_pubkey, program_account_pubkey) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info(&format!(
            "{} managed program...",
            if paused { "Pausing" } else { "Unpausing" }
        ));
        output::print_info(&format!("Seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account_pubkey));
        output::print_info(&format!("Program account: {}", program_account_pubkey));
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager = ProgramManager::new(&config_with_manager).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    let mut transaction = TransactionBuilder::build_manager_set_pause(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        paused,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    let response = if json_format {
        serde_json::json!({
            "program_set_pause": {
                "status": "success",
                "seed": seed,
                "meta_account": meta_account_pubkey.to_string(),
                "program_account": program_account_pubkey.to_string(),
                "paused": paused
            }
        })
    } else {
        output::print_success(&format!(
            "Program {} successfully",
            if paused { "paused" } else { "unpaused" }
        ));
        return Ok(());
    };

    if json_format {
        output::print_output(response, true);
    }

    Ok(())
}

/// Destroy a managed program
async fn destroy_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    use thru_base::txn_tools::MANAGER_INSTRUCTION_DESTROY;

    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Derive meta and program account addresses from seed
    let (meta_account_pubkey, program_account_pubkey) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info("Destroying managed program...");
        output::print_info(&format!("Seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account_pubkey));
        output::print_info(&format!("Program account: {}", program_account_pubkey));
        if let Some(name) = fee_payer {
            output::print_info(&format!("Fee payer override: {}", name));
        }
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager =
        ProgramManager::new_with_fee_payer(&config_with_manager, fee_payer).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    let mut transaction = TransactionBuilder::build_manager_simple(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        MANAGER_INSTRUCTION_DESTROY,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    if let Err(err) = program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await
    {
        if json_format {
            let mut failure_response = serde_json::json!({
                "program_destroy": {
                    "status": "failed",
                    "seed": seed,
                    "meta_account": meta_account_pubkey.to_string(),
                    "program_account": program_account_pubkey.to_string(),
                    "error": {
                        "message": err.to_string()
                    }
                }
            });

            if let Some(obj) = failure_response
                .as_object_mut()
                .and_then(|map| map.get_mut("program_destroy"))
                .and_then(|v| v.as_object_mut())
            {
                if let Some(name) = fee_payer {
                    obj.insert(
                        "fee_payer".to_string(),
                        serde_json::Value::String(name.to_string()),
                    );
                }

                if let Some(err_obj) = obj.get_mut("error").and_then(|v| v.as_object_mut()) {
                    match &err {
                        CliError::TransactionFailed {
                            message,
                            execution_result,
                            vm_error,
                            vm_error_label,
                            user_error_code,
                            user_error_label,
                            signature,
                        } => {
                            err_obj.insert(
                                "message".to_string(),
                                serde_json::Value::String(message.clone()),
                            );
                            err_obj.insert(
                                "execution_result".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(
                                    *execution_result,
                                )),
                            );
                            err_obj.insert(
                                "execution_result_hex".to_string(),
                                serde_json::Value::String(format!("0x{:X}", execution_result)),
                            );
                            err_obj.insert(
                                "vm_error".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(i64::from(
                                    *vm_error,
                                ))),
                            );
                            err_obj.insert(
                                "vm_error_label".to_string(),
                                serde_json::Value::String(vm_error_label.clone()),
                            );
                            err_obj.insert(
                                "user_error_code".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(
                                    *user_error_code,
                                )),
                            );
                            err_obj.insert(
                                "user_error_code_hex".to_string(),
                                serde_json::Value::String(format!("0x{:X}", user_error_code)),
                            );
                            err_obj.insert(
                                "user_error_label".to_string(),
                                serde_json::Value::String(user_error_label.clone()),
                            );
                            if !signature.is_empty() {
                                err_obj.insert(
                                    "signature".to_string(),
                                    serde_json::Value::String(signature.clone()),
                                );
                            }
                        }
                        CliError::TransactionSubmission(msg) => {
                            err_obj.insert(
                                "message".to_string(),
                                serde_json::Value::String(msg.clone()),
                            );
                        }
                        CliError::Generic { message } => {
                            err_obj.insert(
                                "message".to_string(),
                                serde_json::Value::String(message.clone()),
                            );
                        }
                        _ => {
                            err_obj.insert(
                                "message".to_string(),
                                serde_json::Value::String(err.to_string()),
                            );
                        }
                    }
                }
            }

            output::print_output(failure_response, true);
        }

        if json_format {
            return Err(CliError::Reported);
        }

        output::print_error(&err.to_string());
        return Err(CliError::Reported);
    }

    let response = if json_format {
        let mut resp = serde_json::json!({
            "program_destroy": {
                "status": "success",
                "seed": seed,
                "meta_account": meta_account_pubkey.to_string(),
                "program_account": program_account_pubkey.to_string()
            }
        });
        if let Some(name) = fee_payer {
            if let Some(obj) = resp
                .as_object_mut()
                .and_then(|map| map.get_mut("program_destroy"))
                .and_then(|v| v.as_object_mut())
            {
                obj.insert(
                    "fee_payer".to_string(),
                    serde_json::Value::String(name.to_string()),
                );
            }
        }
        resp
    } else {
        output::print_success("Program destroyed successfully");
        return Ok(());
    };

    if json_format {
        output::print_output(response, true);
    }

    Ok(())
}

/// Finalize a managed program (make it immutable)
async fn finalize_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    use thru_base::txn_tools::MANAGER_INSTRUCTION_FINALIZE;

    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Derive meta and program account addresses from seed
    let (meta_account_pubkey, program_account_pubkey) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info("Finalizing managed program...");
        output::print_info(&format!("Seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account_pubkey));
        output::print_info(&format!("Program account: {}", program_account_pubkey));
        if let Some(name) = fee_payer {
            output::print_info(&format!("Fee payer override: {}", name));
        }
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager =
        ProgramManager::new_with_fee_payer(&config_with_manager, fee_payer).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    let mut transaction = TransactionBuilder::build_manager_simple(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        MANAGER_INSTRUCTION_FINALIZE,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    let response = if json_format {
        let mut resp = serde_json::json!({
            "program_finalize": {
                "status": "success",
                "seed": seed,
                "meta_account": meta_account_pubkey.to_string(),
                "program_account": program_account_pubkey.to_string()
            }
        });
        if let Some(name) = fee_payer {
            if let Some(obj) = resp
                .as_object_mut()
                .and_then(|map| map.get_mut("program_finalize"))
                .and_then(|v| v.as_object_mut())
            {
                obj.insert(
                    "fee_payer".to_string(),
                    serde_json::Value::String(name.to_string()),
                );
            }
        }
        resp
    } else {
        output::print_success("Program finalized successfully");
        return Ok(());
    };

    if json_format {
        output::print_output(response, true);
    }

    Ok(())
}

/// Set authority candidate for a managed program
async fn set_authority_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    authority_candidate: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Derive meta and program account addresses from seed
    let (meta_account_pubkey, program_account_pubkey) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    let authority_candidate_pubkey = Pubkey::new(authority_candidate.to_string())
        .map_err(|e| CliError::Validation(format!("Invalid authority candidate: {}", e)))?;

    if !json_format {
        output::print_info("Setting authority candidate for managed program...");
        output::print_info(&format!("Seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account_pubkey));
        output::print_info(&format!("Program account: {}", program_account_pubkey));
        output::print_info(&format!("Authority candidate: {}", authority_candidate));
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager = ProgramManager::new(&config_with_manager).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    let mut transaction = TransactionBuilder::build_manager_set_authority(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        authority_candidate_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    let response = if json_format {
        serde_json::json!({
            "program_set_authority": {
                "status": "success",
                "seed": seed,
                "meta_account": meta_account_pubkey.to_string(),
                "program_account": program_account_pubkey.to_string(),
                "authority_candidate": authority_candidate
            }
        })
    } else {
        output::print_success("Authority candidate set successfully");
        return Ok(());
    };

    if json_format {
        output::print_output(response, true);
    }

    Ok(())
}

/// Claim authority for a managed program
async fn claim_authority_program(
    config: &Config,
    manager_pubkey: Option<&str>,
    seed: &str,
    ephemeral: bool,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    use thru_base::txn_tools::MANAGER_INSTRUCTION_CLAIM_AUTHORITY;

    let manager_program_pubkey = if let Some(custom_manager) = manager_pubkey {
        Pubkey::new(custom_manager.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid manager public key: {}", e)))?
    } else {
        config.get_manager_pubkey()?
    };

    // Derive meta and program account addresses from seed
    let (meta_account_pubkey, program_account_pubkey) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_program_pubkey, ephemeral)?;

    if !json_format {
        output::print_info("Claiming authority for managed program...");
        output::print_info(&format!("Seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account_pubkey));
        output::print_info(&format!("Program account: {}", program_account_pubkey));
        if let Some(name) = fee_payer {
            output::print_info(&format!("Fee payer override: {}", name));
        }
    }

    let mut config_with_manager = config.clone();
    config_with_manager.manager_program_public_key = manager_program_pubkey.to_string();
    let program_manager =
        ProgramManager::new_with_fee_payer(&config_with_manager, fee_payer).await?;

    let nonce = program_manager.get_current_nonce().await?;
    let start_slot = program_manager.get_current_slot().await?;

    let mut transaction = TransactionBuilder::build_manager_simple(
        program_manager.fee_payer_keypair.public_key,
        manager_program_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        meta_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        program_account_pubkey
            .to_bytes()
            .map_err(|e| CliError::Crypto(e.to_string()))?,
        MANAGER_INSTRUCTION_CLAIM_AUTHORITY,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

    transaction
        .sign(&program_manager.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;

    program_manager
        .submit_and_verify_transaction(
            &transaction,
            json_format,
            ProgramManager::decode_manager_error,
        )
        .await?;

    let response = if json_format {
        let mut resp = serde_json::json!({
            "program_claim_authority": {
                "status": "success",
                "seed": seed,
                "meta_account": meta_account_pubkey.to_string(),
                "program_account": program_account_pubkey.to_string()
            }
        });
        if let Some(name) = fee_payer {
            if let Some(obj) = resp
                .as_object_mut()
                .and_then(|map| map.get_mut("program_claim_authority"))
                .and_then(|v| v.as_object_mut())
            {
                obj.insert(
                    "fee_payer".to_string(),
                    serde_json::Value::String(name.to_string()),
                );
            }
        }
        resp
    } else {
        output::print_success("Authority claimed successfully");
        return Ok(());
    };

    if json_format {
        output::print_output(response, true);
    }

    Ok(())
}

/// program derived address
fn derive_program_address(
    program_id: &str,
    seed: &str,
    ephemeral: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let seed_bytes = if let Ok(hex_bytes) = hex::decode(seed) {
        if hex_bytes.len() != 32 {
            return Err(CliError::Validation(format!(
                "Hex seed must be exactly 32 bytes, got {}",
                hex_bytes.len()
            )));
        }
        hex_bytes
    } else {
        let mut utf8_bytes = seed.as_bytes().to_vec();
        if utf8_bytes.len() > 32 {
            return Err(CliError::Validation(format!(
                "UTF-8 seed too long: {} bytes, maximum 32",
                utf8_bytes.len()
            )));
        }
        utf8_bytes.resize(32, 0);
        utf8_bytes
    };

    // validate key
    let bytes = crate::utils::validate_address_or_hex(program_id)?;
    let program_pubkey = Pubkey::from_bytes(&bytes);

    let seed_array: [u8; 32] = seed_bytes
        .try_into()
        .map_err(|_| CliError::Validation("Seed must be exactly 32 bytes".to_string()))?;

    let derived_pubkey =
        thru_base::crypto_utils::derive_program_address(&seed_array, &program_pubkey, ephemeral)
            .map_err(|e| CliError::Validation(format!("Address derivation failed: {}", e)))?;

    if json_format {
        let response = serde_json::json!({
            "derive_address": {
                "program_id": program_id,
                "seed": seed,
                "ephemeral": ephemeral,
                "derived_address": derived_pubkey.to_string()
            }
        });
        output::print_output(response, true);
    } else {
        println!("Program ID: {}", program_id);
        println!("Seed: {}", seed);
        println!("Ephemeral: {}", ephemeral);
        println!("Derived Address: {}", derived_pubkey.to_string());
    }

    Ok(())
}

/// Derive both meta and program account addresses from a seed
fn derive_manager_accounts(
    config: &Config,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    json_format: bool,
) -> Result<(), CliError> {
    /* Get manager program pubkey */
    let manager_pubkey = if let Some(manager_str) = manager {
        let bytes = crate::utils::validate_address_or_hex(manager_str)?;
        Pubkey::from_bytes(&bytes)
    } else {
        config.get_manager_pubkey()?
    };

    /* Get uploader program pubkey */
    let uploader_pubkey = config.get_uploader_pubkey()?;

    /* Derive manager accounts */
    let (meta_account, program_account) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_pubkey, ephemeral)?;

    /* Derive uploader accounts (used during program create) */
    let (temp_seed, temp_seed_hashed) = seed_with_suffix(seed, "temporary");
    let (uploader_meta_account, uploader_buffer_account) =
        crypto::derive_uploader_accounts_from_seed(&temp_seed, &uploader_pubkey)?;

    if json_format {
        let response = serde_json::json!({
            "derive_manager_accounts": {
                "manager_program": manager_pubkey.to_string(),
                "uploader_program": uploader_pubkey.to_string(),
                "seed": seed,
                "ephemeral": ephemeral,
                "meta_account": meta_account.to_string(),
                "program_account": program_account.to_string(),
                "uploader": {
                    "temp_seed": temp_seed,
                    "temp_seed_hashed": temp_seed_hashed,
                    "meta_account": uploader_meta_account.to_string(),
                    "buffer_account": uploader_buffer_account.to_string()
                }
            }
        });
        output::print_output(response, true);
    } else {
        println!("Manager Program: {}", manager_pubkey.to_string());
        println!("Seed: {}", seed);
        println!("Ephemeral: {}", ephemeral);
        println!();
        println!("Program Accounts:");
        println!("  Meta Account: {}", meta_account.to_string());
        println!("  Program Account: {}", program_account.to_string());
        println!();
        println!("Uploader Accounts (temporary, used during create):");
        println!("  Temp Seed: {}{}", temp_seed, if temp_seed_hashed { " (hashed)" } else { "" });
        println!("  Meta Account: {}", uploader_meta_account.to_string());
        println!("  Buffer Account: {}", uploader_buffer_account.to_string());
    }

    Ok(())
}

/// Account status information
#[derive(Debug)]
struct AccountStatus {
    exists: bool,
    is_program: bool,
    data_size: u64,
    owner: Option<String>,
}

/// Get status of program and related accounts
async fn get_program_status(
    config: &Config,
    manager: Option<&str>,
    seed: &str,
    ephemeral: bool,
    json_format: bool,
) -> Result<(), CliError> {
    /* Get manager program pubkey */
    let manager_pubkey = if let Some(manager_str) = manager {
        let bytes = crate::utils::validate_address_or_hex(manager_str)?;
        Pubkey::from_bytes(&bytes)
    } else {
        config.get_manager_pubkey()?
    };

    /* Get uploader program pubkey */
    let uploader_pubkey = config.get_uploader_pubkey()?;

    /* Derive manager accounts */
    let (meta_account, program_account) =
        crypto::derive_manager_accounts_from_seed(seed, &manager_pubkey, ephemeral)?;

    /* Derive uploader accounts (used during program create) */
    let (temp_seed, _temp_seed_hashed) = seed_with_suffix(seed, "temporary");
    let (uploader_meta_account, uploader_buffer_account) =
        crypto::derive_uploader_accounts_from_seed(&temp_seed, &uploader_pubkey)?;

    /* Create RPC client */
    let rpc_url = config.get_grpc_url()?;
    let client = RpcClient::builder()
        .http_endpoint(rpc_url)
        .timeout(Duration::from_secs(config.timeout_seconds))
        .auth_token(config.auth_token.clone())
        .build()?;

    /* Query all accounts in parallel */
    let (meta_info, program_info, uploader_meta_info, uploader_buffer_info) = tokio::join!(
        client.get_account_info(&meta_account, None, Some(VersionContext::Current)),
        client.get_account_info(&program_account, None, Some(VersionContext::Current)),
        client.get_account_info(&uploader_meta_account, None, Some(VersionContext::Current)),
        client.get_account_info(&uploader_buffer_account, None, Some(VersionContext::Current)),
    );

    /* Convert to status */
    let meta_status = account_to_status(meta_info);
    let program_status = account_to_status(program_info);
    let uploader_meta_status = account_to_status(uploader_meta_info);
    let uploader_buffer_status = account_to_status(uploader_buffer_info);

    /* Detect corrupted accounts (exist but have 0 bytes) */
    let program_meta_corrupted = meta_status.exists && meta_status.data_size == 0;
    let program_account_corrupted = program_status.exists && program_status.data_size == 0;
    let uploader_meta_corrupted = uploader_meta_status.exists && uploader_meta_status.data_size == 0;
    let uploader_buffer_corrupted = uploader_buffer_status.exists && uploader_buffer_status.data_size == 0;
    let any_corrupted = program_meta_corrupted || program_account_corrupted || uploader_meta_corrupted || uploader_buffer_corrupted;

    let program_deployed = meta_status.exists && program_status.exists && program_status.is_program && program_status.data_size > 0;

    if json_format {
        let status = if program_deployed {
            "deployed"
        } else if any_corrupted {
            "corrupted"
        } else if !meta_status.exists && !program_status.exists {
            "not_deployed"
        } else {
            "invalid"
        };

        let response = serde_json::json!({
            "program_status": {
                "seed": seed,
                "ephemeral": ephemeral,
                "manager_program": manager_pubkey.to_string(),
                "uploader_program": uploader_pubkey.to_string(),
                "summary": {
                    "status": status,
                    "program_deployed": program_deployed,
                    "corrupted_accounts": {
                        "any": any_corrupted,
                        "program_meta": program_meta_corrupted,
                        "program_account": program_account_corrupted,
                        "uploader_meta": uploader_meta_corrupted,
                        "uploader_buffer": uploader_buffer_corrupted,
                    }
                },
                "program": {
                    "meta_account": {
                        "address": meta_account.to_string(),
                        "exists": meta_status.exists,
                        "is_program": meta_status.is_program,
                        "data_size": meta_status.data_size,
                        "owner": meta_status.owner,
                    },
                    "program_account": {
                        "address": program_account.to_string(),
                        "exists": program_status.exists,
                        "is_program": program_status.is_program,
                        "data_size": program_status.data_size,
                        "owner": program_status.owner,
                    }
                },
                "uploader": {
                    "temp_seed": temp_seed,
                    "meta_account": {
                        "address": uploader_meta_account.to_string(),
                        "exists": uploader_meta_status.exists,
                        "is_program": uploader_meta_status.is_program,
                        "data_size": uploader_meta_status.data_size,
                        "owner": uploader_meta_status.owner,
                    },
                    "buffer_account": {
                        "address": uploader_buffer_account.to_string(),
                        "exists": uploader_buffer_status.exists,
                        "is_program": uploader_buffer_status.is_program,
                        "data_size": uploader_buffer_status.data_size,
                        "owner": uploader_buffer_status.owner,
                    }
                }
            }
        });
        output::print_output(response, true);
    } else {
        println!("Program Status for seed: {}", seed);
        println!("Ephemeral: {}", ephemeral);
        println!();

        println!("Program Accounts:");
        print_account_status("  Meta Account", &meta_account.to_string(), &meta_status);
        print_account_status("  Program Account", &program_account.to_string(), &program_status);
        println!();

        println!("Uploader Accounts (temp_seed: {}):", temp_seed);
        print_account_status("  Meta Account", &uploader_meta_account.to_string(), &uploader_meta_status);
        print_account_status("  Buffer Account", &uploader_buffer_account.to_string(), &uploader_buffer_status);
        println!();

        let upload_in_progress = uploader_meta_status.exists || uploader_buffer_status.exists;

        println!("Summary:");
        if program_deployed {
            println!("  Program is DEPLOYED ({} bytes)", program_status.data_size);
        } else if any_corrupted {
            println!("  CORRUPTED STATE DETECTED - accounts exist but have no data:");
            if program_meta_corrupted {
                println!("    - Program meta account (0 bytes)");
            }
            if program_account_corrupted {
                println!("    - Program account (0 bytes)");
            }
            if uploader_meta_corrupted {
                println!("    - Uploader meta account (0 bytes)");
            }
            if uploader_buffer_corrupted {
                println!("    - Uploader buffer account (0 bytes)");
            }
            println!();
            println!("  To fix, delete all corrupted accounts:");
            if uploader_meta_corrupted || uploader_buffer_corrupted {
                println!("    thru-cli uploader cleanup {}", temp_seed);
            }
            if program_meta_corrupted || program_account_corrupted {
                println!("    thru-cli program destroy {} --ephemeral", seed);
            }
        } else if meta_status.exists && !program_status.exists {
            println!("  Program meta exists but program account missing (INVALID STATE)");
        } else if !meta_status.exists && !program_status.exists {
            println!("  Program is NOT DEPLOYED");
        }

        if upload_in_progress && !any_corrupted {
            println!("  Upload buffer exists (cleanup may be needed: thru-cli uploader cleanup {})", temp_seed);
        }
    }

    Ok(())
}

fn account_to_status(result: Result<Option<thru_client::Account>, thru_client::ClientError>) -> AccountStatus {
    match result {
        Ok(Some(account)) => AccountStatus {
            exists: true,
            is_program: account.program,
            data_size: account.data_size,
            owner: Some(account.owner.to_string()),
        },
        Ok(None) => AccountStatus {
            exists: false,
            is_program: false,
            data_size: 0,
            owner: None,
        },
        Err(_) => AccountStatus {
            exists: false,
            is_program: false,
            data_size: 0,
            owner: None,
        },
    }
}

fn print_account_status(label: &str, address: &str, status: &AccountStatus) {
    if status.exists {
        let program_flag = if status.is_program { " [PROGRAM]" } else { "" };
        println!("{}: {}", label, address);
        println!("    Status: EXISTS{}, {} bytes", program_flag, status.data_size);
        if let Some(owner) = &status.owner {
            println!("    Owner: {}", owner);
        }
    } else {
        println!("{}: {}", label, address);
        println!("    Status: NOT FOUND");
    }
}
