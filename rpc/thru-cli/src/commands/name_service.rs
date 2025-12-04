//! Registrar and name service command implementation

use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use sha2::{Digest, Sha256};

use crate::cli::{NameServiceCommands, RegistrarCommands};
use crate::commands::state_proof::make_state_proof;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::validate_address_or_hex;
use std::convert::TryInto;
use std::time::Duration;
use thru_base::crypto_utils::derive_program_address;
use thru_base::rpc_types::ProofType;
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_tools::{
    TransactionBuilder, TN_NAME_SERVICE_MAX_DOMAIN_LENGTH, TN_NAME_SERVICE_MAX_KEY_LENGTH,
    TN_NAME_SERVICE_MAX_VALUE_LENGTH,
};
use thru_client::{Client, ClientBuilder, TransactionDetails};

/// 0 fee for now
const THRU_REGISTRAR_PROGRAM_FEE: u64 = 0;
const NAME_SERVICE_PROGRAM_FEE: u64 = 0;

/// Token account data layout offsets
const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
const TOKEN_ACCOUNT_FROZEN_OFFSET: usize = 64 + 8; // owner (32) + amount (8) + frozen (1)

/// Helper function to resolve fee payer keypair from configuration
fn resolve_fee_payer_keypair(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<KeyPair, CliError> {
    let (key_name, fee_payer_private_key) = if let Some(fee_payer_name) = fee_payer {
        let key = config.keys.get_key(fee_payer_name).map_err(|_| {
            CliError::Validation(format!(
                "Fee payer key '{}' not found in configuration",
                fee_payer_name
            ))
        })?;
        (fee_payer_name, key)
    } else {
        let key = config.keys.get_key("default")?;
        ("default", key)
    };

    KeyPair::from_hex_private_key(key_name, fee_payer_private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to create fee payer keypair: {}", e)))
}

/// Resolve the thru registrar program pubkey, optionally overriding with command-line input.
fn resolve_thru_registrar_program(
    config: &Config,
    thru_registrar_program: Option<&str>,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    let program_str = thru_registrar_program
        .unwrap_or_else(|| config.thru_registrar_program_public_key.as_str());
    let bytes = validate_address_or_hex(program_str)?;
    let pubkey = Pubkey::from_bytes(&bytes);
    Ok((pubkey, bytes))
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
    pub client: Client,
}

/// Common context for base name service operations
struct FeePayerContext {
    pub fee_payer_keypair: KeyPair,
    pub client: Client,
    pub nonce: u64,
    pub start_slot: u64,
}

/// Validate a token account matches expected mint, token program, and optionally owner
async fn validate_token_account(
    client: &Client,
    account_pubkey: &Pubkey,
    expected_mint: [u8; 32],
    expected_token_program: &Pubkey,
    expected_owner: Option<[u8; 32]>,
    account_label: &str,
) -> Result<(), CliError> {
    let account_info = client
        .get_account_info(account_pubkey, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!(
                "Failed to fetch {} account: {}",
                account_label, e
            ))
        })?
        .ok_or_else(|| {
            CliError::Validation(format!("{} account not found on chain", account_label))
        })?;

    if account_info.owner != *expected_token_program {
        return Err(CliError::Validation(format!(
            "{} account owner does not match token program",
            account_label
        )));
    }

    if let Some(data_b64) = account_info.data {
        let data = general_purpose::STANDARD.decode(data_b64).map_err(|e| {
            CliError::Validation(format!("Failed to decode {} account data: {}", account_label, e))
        })?;

        // Validate mint
        let mint_bytes: [u8; 32] = data[TOKEN_ACCOUNT_MINT_OFFSET..TOKEN_ACCOUNT_MINT_OFFSET + 32]
            .try_into()
            .map_err(|_| {
                CliError::Validation(format!("Failed to parse {} mint bytes", account_label))
            })?;
        if mint_bytes != expected_mint {
            return Err(CliError::Validation(format!(
                "{} token account mint does not match expected mint",
                account_label
            )));
        }

        // Validate owner if specified
        if let Some(expected_owner_bytes) = expected_owner {
            let owner_bytes: [u8; 32] =
                data[TOKEN_ACCOUNT_OWNER_OFFSET..TOKEN_ACCOUNT_OWNER_OFFSET + 32]
                    .try_into()
                    .map_err(|_| {
                        CliError::Validation(format!("Failed to parse {} owner bytes", account_label))
                    })?;
            if owner_bytes != expected_owner_bytes {
                return Err(CliError::Validation(format!(
                    "{} token account owner does not match expected owner",
                    account_label
                )));
            }
        }

        // Validate not frozen
        if data.len() > TOKEN_ACCOUNT_FROZEN_OFFSET {
            let is_frozen = data[TOKEN_ACCOUNT_FROZEN_OFFSET];
            if is_frozen != 0 {
                return Err(CliError::Validation(format!(
                    "{} token account is frozen",
                    account_label
                )));
            }
        }
    }

    Ok(())
}

/// Setup fee payer context for base name service operations
async fn setup_fee_payer_context(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<FeePayerContext, CliError> {
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let client = create_rpc_client(config)?;

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

    Ok(FeePayerContext {
        fee_payer_keypair,
        client,
        nonce,
        start_slot: block_height.finalized_height,
    })
}

fn resolve_name_service_program(
    config: &Config,
    name_service_program: Option<&str>,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    let program_str = name_service_program
        .unwrap_or_else(|| config.name_service_program_public_key.as_str());
    let program_bytes = validate_address_or_hex(program_str)?;
    let program_pubkey = Pubkey::from_bytes(&program_bytes);
    Ok((program_pubkey, program_bytes))
}

fn derive_root_registrar_account_pubkey(
    name_service_program_pubkey: &Pubkey,
    root_name: &str,
) -> Result<Pubkey, CliError> {
    let root_bytes = root_name.as_bytes();
    if root_bytes.is_empty() || root_bytes.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        return Err(CliError::Validation(format!(
            "Root name length must be between 1 and {} characters",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        )));
    }
    let mut seed_bytes = [0u8; 32];
    seed_bytes[..root_bytes.len()].copy_from_slice(root_bytes);

    derive_program_address(&seed_bytes, name_service_program_pubkey, false)
        .map_err(|e| CliError::Crypto(format!("Failed to derive registrar pubkey: {}", e)))
}

fn derive_domain_account_pubkey(
    name_service_program_pubkey: &Pubkey,
    parent_account: &Pubkey,
    domain_name: &str,
) -> Result<Pubkey, CliError> {
    let domain_bytes = domain_name.as_bytes();
    if domain_bytes.is_empty() || domain_bytes.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        return Err(CliError::Validation(format!(
            "Domain name length must be between 1 and {} characters",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        )));
    }
    let parent_bytes = parent_account.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert parent account to bytes: {}",
            e
        ))
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&parent_bytes);
    hasher.update(domain_bytes);
    let hash = hasher.finalize();
    let mut seed_bytes = [0u8; 32];
    seed_bytes.copy_from_slice(&hash);

    derive_program_address(&seed_bytes, name_service_program_pubkey, false)
        .map_err(|e| CliError::Crypto(format!("Failed to derive domain pubkey: {}", e)))
}

fn resolve_signing_account(
    account: Option<&str>,
    fee_payer_keypair: &KeyPair,
    label: &str,
) -> Result<[u8; 32], CliError> {
    let account_bytes = if let Some(account_str) = account {
        validate_address_or_hex(account_str)?
    } else {
        fee_payer_keypair.public_key
    };

    if account_bytes != fee_payer_keypair.public_key {
        return Err(CliError::Validation(format!(
            "{} must match the fee payer ({}), as only the fee payer signature is included",
            label, fee_payer_keypair.address_string
        )));
    }
    Ok(account_bytes)
}

/// Helper function to check transaction execution results and return appropriate errors
fn check_transaction_result(
    transaction_details: &TransactionDetails,
    json_format: bool,
) -> Result<(), CliError> {
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let signed_execution_result = transaction_details.execution_result as i64;
        let signed_user_error = transaction_details.user_error_code as i64;

        let vm_error_label = crate::utils::format_vm_error(transaction_details.vm_error);
        let vm_error_msg = if transaction_details.vm_error != 0 {
            format!(" (VM error: {})", vm_error_label)
        } else {
            String::new()
        };

        let user_error_msg = if signed_user_error != 0 {
            format!(" (NameServiceError: {})", signed_user_error)
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

/// Derive config account address using "config" seed
fn derive_config_account_pubkey(
    thru_registrar_program_pubkey: &Pubkey,
) -> Result<Pubkey, CliError> {
    let config_seed = b"config";
    let mut seed_bytes = [0u8; 32];
    seed_bytes[..config_seed.len()].copy_from_slice(config_seed);

    derive_program_address(&seed_bytes, thru_registrar_program_pubkey, false)
        .map_err(|e| CliError::Crypto(format!("Failed to derive config account address: {}", e)))
}

/// Derive lease account address from domain name
fn derive_lease_account_pubkey(
    thru_registrar_program_pubkey: &Pubkey,
    domain_name: &str,
) -> Result<Pubkey, CliError> {
    // Hash "lease:" + domain name to create deterministic seed (matches program logic)
    let mut hasher = Sha256::new();
    hasher.update(b"lease:");
    hasher.update(domain_name.as_bytes());
    let hash = hasher.finalize();
    let mut seed_bytes = [0u8; 32];
    seed_bytes.copy_from_slice(&hash);

    derive_program_address(&seed_bytes, thru_registrar_program_pubkey, false)
        .map_err(|e| CliError::Crypto(format!("Failed to derive lease account address: {}", e)))
}

/// Handle registrar program commands
pub async fn handle_registrar_command(
    config: &Config,
    subcommand: RegistrarCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        RegistrarCommands::InitializeRegistry {
            name_service_program,
            root_registrar_account,
            treasurer_account,
            token_mint_account,
            token_program,
            price_per_year,
            root_domain_name,
            config_proof,
            registrar_proof,
            fee_payer,
            thru_registrar_program,
        } => {
            initialize_registry(
                config,
                name_service_program.as_deref(),
                &root_registrar_account,
                &treasurer_account,
                &token_mint_account,
                token_program.as_deref(),
                price_per_year,
                &root_domain_name,
                config_proof.as_deref(),
                registrar_proof.as_deref(),
                fee_payer.as_deref(),
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
        RegistrarCommands::PurchaseDomain {
            domain_name,
            years,
            config_account,
            lease_proof,
            domain_proof,
            payer_token_account,
            fee_payer,
            thru_registrar_program,
        } => {
            purchase_domain(
                config,
                &domain_name,
                years,
                lease_proof.as_deref(),
                domain_proof.as_deref(),
                &config_account,
                &payer_token_account,
                fee_payer.as_deref(),
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
        RegistrarCommands::RenewLease {
            lease_account,
            years,
            config_account,
            payer_token_account,
            fee_payer,
            thru_registrar_program,
        } => {
            renew_lease(
                config,
                &lease_account,
                years,
                &config_account,
                &payer_token_account,
                fee_payer.as_deref(),
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
        RegistrarCommands::ClaimExpiredDomain {
            lease_account,
            years,
            config_account,
            payer_token_account,
            fee_payer,
            thru_registrar_program,
        } => {
            claim_expired_domain(
                config,
                &lease_account,
                years,
                &config_account,
                &payer_token_account,
                fee_payer.as_deref(),
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
    }
}

/// Handle name service program commands
pub async fn handle_name_service_command(
    config: &Config,
    subcommand: NameServiceCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        NameServiceCommands::DeriveLeaseAccount {
            domain_name,
            thru_registrar_program,
        } => {
            derive_lease_account(
                config,
                &domain_name,
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::DeriveConfigAccount {
            thru_registrar_program,
        } => {
            derive_config_account(
                config,
                thru_registrar_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::InitRoot {
            root_name,
            name_service_program,
            registrar_account,
            authority,
            proof,
            fee_payer,
        } => {
            initialize_root_registrar(
                config,
                &root_name,
                name_service_program.as_deref(),
                registrar_account.as_deref(),
                authority.as_deref(),
                proof.as_deref(),
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::RegisterSubdomain {
            domain_name,
            parent_account,
            name_service_program,
            domain_account,
            owner,
            authority,
            proof,
            fee_payer,
        } => {
            register_subdomain(
                config,
                &domain_name,
                &parent_account,
                name_service_program.as_deref(),
                domain_account.as_deref(),
                owner.as_deref(),
                authority.as_deref(),
                proof.as_deref(),
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::AppendRecord {
            domain_account,
            key,
            value,
            owner,
            fee_payer,
            name_service_program,
        } => {
            append_record(
                config,
                &domain_account,
                &key,
                &value,
                owner.as_deref(),
                fee_payer.as_deref(),
                name_service_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::DeleteRecord {
            domain_account,
            key,
            owner,
            fee_payer,
            name_service_program,
        } => {
            delete_record(
                config,
                &domain_account,
                &key,
                owner.as_deref(),
                fee_payer.as_deref(),
                name_service_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::UnregisterSubdomain {
            domain_account,
            owner,
            fee_payer,
            name_service_program,
        } => {
            unregister_subdomain(
                config,
                &domain_account,
                owner.as_deref(),
                fee_payer.as_deref(),
                name_service_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::Resolve {
            domain_account,
            key,
            name_service_program,
        } => {
            resolve_domain(
                config,
                &domain_account,
                key.as_deref(),
                name_service_program.as_deref(),
                json_format,
            )
            .await
        }
        NameServiceCommands::ListRecords {
            domain_account,
            name_service_program,
        } => list_records(config, &domain_account, name_service_program.as_deref(), json_format).await,
        NameServiceCommands::DeriveDomainAccount {
            parent_account,
            domain_name,
            name_service_program,
        } => derive_domain_account(
            config,
            &parent_account,
            &domain_name,
            name_service_program.as_deref(),
            json_format,
        )
        .await,
        NameServiceCommands::DeriveRegistrarAccount {
            root_name,
            name_service_program,
        } => derive_registrar_account(
            config,
            &root_name,
            name_service_program.as_deref(),
            json_format,
        )
        .await,
    }
}

/// Initialize the .thru registry
async fn initialize_registry(
    config: &Config,
    name_service_program: Option<&str>,
    root_registrar_account: &str,
    treasurer_account: &str,
    token_mint_account: &str,
    token_program: Option<&str>,
    price_per_year: u64,
    root_domain_name: &str,
    config_proof: Option<&str>,
    registrar_proof: Option<&str>,
    fee_payer: Option<&str>,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if root_domain_name.len() > 64 {
        let error_msg = "Root domain name must be 64 characters or less";
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_initialize_registry": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Initialize registry:");
        println!(
            "  Name Service Program: {}",
            name_service_program.unwrap_or("<from config>")
        );
        println!("  Root Registrar Account: {}", root_registrar_account);
        println!("  Treasurer Account: {}", treasurer_account);
        println!("  Token Mint Account: {}", token_mint_account);
        println!(
            "  Token Program: {}",
            token_program.unwrap_or("<from config>")
        );
        println!("  Root Domain Name: {}", root_domain_name);
        println!("  Price Per Year: {}", price_per_year);
    }

    // Resolve addresses
    let (_name_service_program_pubkey, name_service_program_bytes) =
        resolve_name_service_program(config, name_service_program)?;
    let root_registrar_account_pubkey = validate_address_or_hex(root_registrar_account)?;
    let treasurer_account_pubkey = validate_address_or_hex(treasurer_account)?;
    let token_mint_account_pubkey = validate_address_or_hex(token_mint_account)?;
    let token_program_pubkey = {
        let token_prog = token_program
            .unwrap_or_else(|| config.token_program_public_key.as_str());
        validate_address_or_hex(token_prog)?
    };
    let token_program_pubkey_struct = Pubkey::from_bytes(&token_program_pubkey);

    // Resolve thru registrar program and fee payer
    let (thru_registrar_program_pubkey, thru_registrar_program_bytes) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;

    // Create RPC client
    let client = create_rpc_client(config)?;

    // Registrar must be new/inactive; wrapper will create it
    let root_registrar_pubkey = Pubkey::from_bytes(&root_registrar_account_pubkey);
    if let Some(existing) = client
        .get_account_info(&root_registrar_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get registrar account info: {}", e)))?
    {
        if !existing.is_new {
            return Err(CliError::Validation(
                "Root registrar account already exists; the thru registrar initializes it. Use an unused registrar address for creation."
                    .to_string(),
            ));
        }
    }

    // Basic sanity checks for mint/treasurer owners against token program
    if let Some(mint_info) = client
        .get_account_info(&Pubkey::from_bytes(&token_mint_account_pubkey), None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get token mint account info: {}", e)))?
    {
        if mint_info.owner != token_program_pubkey_struct {
            return Err(CliError::Validation(format!(
                "Token mint account owner {} does not match token program {}",
                tn_pubkey_to_address_string(&mint_info.owner.to_bytes().unwrap_or_default()),
                tn_pubkey_to_address_string(&token_program_pubkey)
            )));
        }

    }

    if let Some(treasurer_info) = client
        .get_account_info(&Pubkey::from_bytes(&treasurer_account_pubkey), None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get treasurer account info: {}", e)))?
    {
        if treasurer_info.owner != token_program_pubkey_struct {
            return Err(CliError::Validation(format!(
                "Treasurer account owner {} does not match token program {}",
                tn_pubkey_to_address_string(&treasurer_info.owner.to_bytes().unwrap_or_default()),
                tn_pubkey_to_address_string(&token_program_pubkey)
            )));
        }

        // Decode treasurer token account data to verify mint matches
        if let Some(data_b64) = treasurer_info.data {
            let data = general_purpose::STANDARD
                .decode(data_b64)
                .map_err(|e| CliError::Validation(format!("Failed to decode treasurer account data: {}", e)))?;
            let mint_bytes = &data[..32];
            if mint_bytes != token_mint_account_pubkey {
                return Err(CliError::Validation(format!(
                    "Treasurer token account mint {} does not match provided mint {}",
                    tn_pubkey_to_address_string(&mint_bytes.try_into().unwrap_or([0u8;32])),
                    tn_pubkey_to_address_string(&token_mint_account_pubkey)
                )));
            }
            if data.len() > TOKEN_ACCOUNT_FROZEN_OFFSET {
                let is_frozen = data[TOKEN_ACCOUNT_FROZEN_OFFSET];
                if is_frozen != 0 {
                    return Err(CliError::Validation(
                        "Treasurer token account is frozen; must be active to receive payments".to_string(),
                    ));
                }
            }
        }
        }

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

    // Derive config account address
    let config_account_pubkey = derive_config_account_pubkey(&thru_registrar_program_pubkey)?;
    let config_account_bytes = config_account_pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert config pubkey to bytes: {}", e)))?;
    if let Some(existing_config) = client
        .get_account_info(&config_account_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get config account info: {}", e)))?
    {
        if !existing_config.is_new {
            return Err(CliError::Validation(
                "Config account already exists; initialize-registry expects a fresh config account."
                    .to_string(),
            ));
        }
    }

    // Use provided state proofs or auto-generate them
    let config_proof_bytes = if let Some(proof_hex) = config_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid config proof hex: {}", e)))?
    } else {
        make_state_proof(
            &client,
            &config_account_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    let registrar_proof_bytes = if let Some(proof_hex) = registrar_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid registrar proof hex: {}", e)))?
    } else {
        let registrar_pubkey = Pubkey::from_bytes(&root_registrar_account_pubkey);
        make_state_proof(
            &client,
            &registrar_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    // Build transaction using TransactionBuilder
    let mut transaction = TransactionBuilder::build_thru_registrar_initialize_registry(
        fee_payer_keypair.public_key,
        thru_registrar_program_bytes,
        config_account_bytes,
        name_service_program_bytes,
        root_registrar_account_pubkey,
        treasurer_account_pubkey,
        token_mint_account_pubkey,
        token_program_pubkey,
        root_domain_name,
        price_per_year,
        config_proof_bytes,
        registrar_proof_bytes,
        THRU_REGISTRAR_PROGRAM_FEE,
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

    // Convert config account address to string for output
    let config_account_address =
        tn_pubkey_to_address_string(&config_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_initialize_registry": {
                "status": "success",
                "config_account": config_account_address,
                "root_domain_name": root_domain_name,
                "price_per_year": price_per_year,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Registry initialized successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Config account: {}", config_account_address);
    }

    Ok(())
}

/// Purchase a .thru domain
async fn purchase_domain(
    config: &Config,
    domain_name: &str,
    years: u8,
    lease_proof: Option<&str>,
    domain_proof: Option<&str>,
    config_account: &str,
    payer_token_account: &str,
    fee_payer: Option<&str>,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if domain_name.len() > 64 {
        let error_msg = "Domain name must be 64 characters or less";
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_purchase_domain": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if years == 0 {
        let error_msg = "Years must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_purchase_domain": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Purchase domain:");
        println!("  Domain Name: {}", domain_name);
        println!("  Years: {}", years);
    }

    // Resolve thru program and fee payer
    let (thru_program_pubkey, thru_program_bytes) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;
    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;

    // Determine config account
    let config_pubkey_bytes_raw = validate_address_or_hex(config_account)?;
    let config_pubkey = Pubkey::from_bytes(&config_pubkey_bytes_raw);
    let config_pubkey_bytes = config_pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert config pubkey to bytes: {}", e)))?;

    // Fetch and parse config account
    let client = create_rpc_client(config)?;
    let config_info = client
        .get_account_info(&config_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch config account: {}", e)))?
        .ok_or_else(|| CliError::Validation("Config account not found".to_string()))?;

    if config_info.owner != thru_program_pubkey {
        return Err(CliError::Validation(
            "Config account owner does not match thru registrar program".to_string(),
        ));
    }

    let config_data_b64 = config_info.data.ok_or_else(|| {
        CliError::Validation("Config account has no data (is it initialized?)".to_string())
    })?;
    let config_data = general_purpose::STANDARD
        .decode(config_data_b64)
        .map_err(|e| CliError::Validation(format!("Failed to decode config account data: {}", e)))?;

    let cfg_name_service_program_bytes: [u8; 32] = config_data[0..32]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse name service program id".to_string()))?;
    let cfg_root_registrar_bytes: [u8; 32] = config_data[32..64]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse root registrar".to_string()))?;
    let cfg_treasurer_bytes: [u8; 32] = config_data[64..96]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse treasurer".to_string()))?;
    let cfg_token_mint_bytes: [u8; 32] = config_data[96..128]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token mint".to_string()))?;
    let cfg_token_program_bytes: [u8; 32] = config_data[128..160]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token program".to_string()))?;

    // Resolve programs
    let name_service_program_pubkey = Pubkey::from_bytes(&cfg_name_service_program_bytes);

    // Derive lease and domain accounts
    let lease_account_pubkey =
        derive_lease_account_pubkey(&thru_program_pubkey, domain_name)?;
    let domain_account_pubkey =
        derive_domain_account_pubkey(&name_service_program_pubkey, &Pubkey::from_bytes(&cfg_root_registrar_bytes), domain_name)?;

    // Payer token account
    let payer_token_account_bytes = validate_address_or_hex(payer_token_account)?;

    // Generate proofs if not provided
    let lease_proof_bytes = if let Some(lp) = lease_proof {
        hex::decode(lp)
            .map_err(|e| CliError::Validation(format!("Invalid lease proof hex: {}", e)))?
    } else {
        make_state_proof(
            &client,
            &lease_account_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    let domain_proof_bytes = if let Some(dp) = domain_proof {
        hex::decode(dp)
            .map_err(|e| CliError::Validation(format!("Invalid domain proof hex: {}", e)))?
    } else {
        make_state_proof(
            &client,
            &domain_account_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    let lease_account_bytes = lease_account_pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert lease pubkey to bytes: {}", e)))?;
    let domain_account_bytes = domain_account_pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert domain pubkey to bytes: {}", e)))?;

    let token_program_pubkey = Pubkey::from_bytes(&cfg_token_program_bytes);

    // Validate treasurer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&cfg_treasurer_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        None,
        "Treasurer",
    )
    .await?;

    // Validate payer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&payer_token_account_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        Some(fee_ctx.fee_payer_keypair.public_key),
        "Payer",
    )
    .await?;

    let transaction = TransactionBuilder::build_thru_registrar_purchase_domain(
        fee_ctx.fee_payer_keypair.public_key,
        thru_program_bytes,
        config_pubkey_bytes,
        lease_account_bytes,
        domain_account_bytes,
        cfg_name_service_program_bytes,
        cfg_root_registrar_bytes,
        cfg_treasurer_bytes,
        payer_token_account_bytes,
        cfg_token_mint_bytes,
        cfg_token_program_bytes,
        domain_name,
        years,
        lease_proof_bytes,
        domain_proof_bytes,
        THRU_REGISTRAR_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "nameservice_purchase_domain": {
                "status": "success",
                "domain_name": domain_name,
                "lease_account": tn_pubkey_to_address_string(&lease_account_bytes),
                "domain_account": tn_pubkey_to_address_string(&domain_account_bytes),
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Purchased domain {}", domain_name);
        println!(
            "  Lease account: {}",
            tn_pubkey_to_address_string(&lease_account_bytes)
        );
        println!(
            "  Domain account: {}",
            tn_pubkey_to_address_string(&domain_account_bytes)
        );
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Renew an existing domain lease
async fn renew_lease(
    config: &Config,
    lease_account: &str,
    years: u8,
    config_account: &str,
    payer_token_account: &str,
    fee_payer: Option<&str>,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if years == 0 {
        let error_msg = "Years must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_renew_lease": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Renew lease:");
        println!("  Lease Account: {}", lease_account);
        println!("  Years: {}", years);
    }

    let (thru_program_pubkey, thru_program_bytes) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;
    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;

    let config_pubkey_bytes_raw = validate_address_or_hex(config_account)?;
    let config_pubkey = Pubkey::from_bytes(&config_pubkey_bytes_raw);
    let lease_pubkey_bytes = validate_address_or_hex(lease_account)?;
    let lease_pubkey = Pubkey::from_bytes(&lease_pubkey_bytes);
    let payer_token_account_bytes = validate_address_or_hex(payer_token_account)?;

    let client = create_rpc_client(config)?;

    // Fetch and parse config account
    let config_info = client
        .get_account_info(&config_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch config account: {}", e)))?
        .ok_or_else(|| CliError::Validation("Config account not found".to_string()))?;
    if config_info.owner != thru_program_pubkey {
        return Err(CliError::Validation(
            "Config account owner does not match thru registrar program".to_string(),
        ));
    }
    let config_data_b64 = config_info.data.ok_or_else(|| {
        CliError::Validation("Config account has no data (is it initialized?)".to_string())
    })?;
    let config_data = general_purpose::STANDARD
        .decode(config_data_b64)
        .map_err(|e| CliError::Validation(format!("Failed to decode config account data: {}", e)))?;
    let cfg_treasurer_bytes: [u8; 32] = config_data[64..96]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse treasurer".to_string()))?;
    let cfg_token_mint_bytes: [u8; 32] = config_data[96..128]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token mint".to_string()))?;
    let cfg_token_program_bytes: [u8; 32] = config_data[128..160]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token program".to_string()))?;
    let token_program_pubkey = Pubkey::from_bytes(&cfg_token_program_bytes);

    // Validate lease account exists and owned by thru program
    let lease_info = client
        .get_account_info(&lease_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch lease account: {}", e)))?
        .ok_or_else(|| CliError::Validation("Lease account not found".to_string()))?;
    if lease_info.owner != thru_program_pubkey {
        return Err(CliError::Validation(
            "Lease account owner does not match thru registrar program".to_string(),
        ));
    }

    // Validate treasurer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&cfg_treasurer_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        None,
        "Treasurer",
    )
    .await?;

    // Validate payer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&payer_token_account_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        Some(fee_ctx.fee_payer_keypair.public_key),
        "Payer",
    )
    .await?;

    let transaction = TransactionBuilder::build_thru_registrar_renew_lease(
        fee_ctx.fee_payer_keypair.public_key,
        thru_program_bytes,
        config_pubkey_bytes_raw,
        lease_pubkey_bytes,
        cfg_treasurer_bytes,
        payer_token_account_bytes,
        cfg_token_mint_bytes,
        cfg_token_program_bytes,
        years,
        THRU_REGISTRAR_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "nameservice_renew_lease": {
                "status": "success",
                "lease_account": lease_account,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Renewed lease for {}", lease_account);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Claim an expired domain
async fn claim_expired_domain(
    config: &Config,
    lease_account: &str,
    years: u8,
    config_account: &str,
    payer_token_account: &str,
    fee_payer: Option<&str>,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if years == 0 {
        let error_msg = "Years must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_claim_expired_domain": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if !json_format {
        println!("Claim expired domain:");
        println!("  Lease Account: {}", lease_account);
        println!("  Years: {}", years);
    }

    let (thru_program_pubkey, thru_program_bytes) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;
    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;

    let config_pubkey_bytes_raw = validate_address_or_hex(config_account)?;
    let config_pubkey = Pubkey::from_bytes(&config_pubkey_bytes_raw);
    let lease_pubkey_bytes = validate_address_or_hex(lease_account)?;
    let lease_pubkey = Pubkey::from_bytes(&lease_pubkey_bytes);
    let payer_token_account_bytes = validate_address_or_hex(payer_token_account)?;

    let client = create_rpc_client(config)?;

    // Fetch and parse config account
    let config_info = client
        .get_account_info(&config_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch config account: {}", e)))?
        .ok_or_else(|| CliError::Validation("Config account not found".to_string()))?;
    if config_info.owner != thru_program_pubkey {
        return Err(CliError::Validation(
            "Config account owner does not match thru registrar program".to_string(),
        ));
    }
    let config_data_b64 = config_info.data.ok_or_else(|| {
        CliError::Validation("Config account has no data (is it initialized?)".to_string())
    })?;
    let config_data = general_purpose::STANDARD
        .decode(config_data_b64)
        .map_err(|e| CliError::Validation(format!("Failed to decode config account data: {}", e)))?;
    let cfg_treasurer_bytes: [u8; 32] = config_data[64..96]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse treasurer".to_string()))?;
    let cfg_token_mint_bytes: [u8; 32] = config_data[96..128]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token mint".to_string()))?;
    let cfg_token_program_bytes: [u8; 32] = config_data[128..160]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token program".to_string()))?;
    let token_program_pubkey = Pubkey::from_bytes(&cfg_token_program_bytes);

    // Validate lease account exists and owned by thru program
    let lease_info = client
        .get_account_info(&lease_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch lease account: {}", e)))?
        .ok_or_else(|| CliError::Validation("Lease account not found".to_string()))?;
    if lease_info.owner != thru_program_pubkey {
        return Err(CliError::Validation(
            "Lease account owner does not match thru registrar program".to_string(),
        ));
    }

    // Validate treasurer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&cfg_treasurer_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        None,
        "Treasurer",
    )
    .await?;

    // Validate payer token account
    validate_token_account(
        &client,
        &Pubkey::from_bytes(&payer_token_account_bytes),
        cfg_token_mint_bytes,
        &token_program_pubkey,
        Some(fee_ctx.fee_payer_keypair.public_key),
        "Payer",
    )
    .await?;

    let transaction = TransactionBuilder::build_thru_registrar_claim_expired_domain(
        fee_ctx.fee_payer_keypair.public_key,
        thru_program_bytes,
        config_pubkey_bytes_raw,
        lease_pubkey_bytes,
        cfg_treasurer_bytes,
        payer_token_account_bytes,
        cfg_token_mint_bytes,
        cfg_token_program_bytes,
        years,
        THRU_REGISTRAR_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "nameservice_claim_expired_domain": {
                "status": "success",
                "lease_account": lease_account,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Claimed expired domain for lease {}", lease_account);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Derive lease account address from domain name
async fn derive_lease_account(
    config: &Config,
    domain_name: &str,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!("Derive lease account:");
        println!("  Domain Name: {}", domain_name);
    }

    let (thru_registrar_program_pubkey, _) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;

    let lease_account_pubkey = derive_lease_account_pubkey(&thru_registrar_program_pubkey, domain_name)?;

    let lease_account_bytes = lease_account_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert lease account pubkey to bytes: {}",
            e
        ))
    })?;

    let lease_account_address = tn_pubkey_to_address_string(&lease_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "derive_lease_account": {
                "lease_account_address": lease_account_address,
                "domain_name": domain_name
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived lease account address: {}", lease_account_address);
    }

    Ok(())
}

/// Derive config account address
async fn derive_config_account(
    config: &Config,
    thru_registrar_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!("Derive config account");
    }

    let (thru_registrar_program_pubkey, _) =
        resolve_thru_registrar_program(config, thru_registrar_program)?;

    let config_account_pubkey = derive_config_account_pubkey(&thru_registrar_program_pubkey)?;

    let config_account_bytes = config_account_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert config account pubkey to bytes: {}",
            e
        ))
    })?;

    let config_account_address = tn_pubkey_to_address_string(&config_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "derive_config_account": {
                "config_account_address": config_account_address
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived config account address: {}", config_account_address);
    }

    Ok(())
}

/// Initialize a root registrar for the base name service program
async fn initialize_root_registrar(
    config: &Config,
    root_name: &str,
    name_service_program: Option<&str>,
    registrar_account: Option<&str>,
    authority: Option<&str>,
    state_proof: Option<&str>,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if root_name.is_empty() || root_name.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        let error_msg = format!(
            "Root name must be between 1 and {} characters",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        );
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_init_root": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    let (name_service_program_pubkey, name_service_program_bytes) =
        resolve_name_service_program(config, name_service_program)?;

    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;
    let authority_bytes =
        resolve_signing_account(authority, &fee_ctx.fee_payer_keypair, "Authority")?;

    let registrar_pubkey = if let Some(registrar_str) = registrar_account {
        let registrar_bytes = validate_address_or_hex(registrar_str)?;
        Pubkey::from_bytes(&registrar_bytes)
    } else {
        derive_root_registrar_account_pubkey(&name_service_program_pubkey, root_name)?
    };
    let registrar_bytes = registrar_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert registrar pubkey to bytes: {}",
            e
        ))
    })?;

    let proof_bytes = if let Some(proof_hex) = state_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?
    } else {
        make_state_proof(
            &fee_ctx.client,
            &registrar_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    let transaction = TransactionBuilder::build_name_service_initialize_root(
        fee_ctx.fee_payer_keypair.public_key,
        name_service_program_bytes,
        registrar_bytes,
        authority_bytes,
        root_name,
        proof_bytes,
        NAME_SERVICE_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client: fee_ctx.client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let registrar_address = tn_pubkey_to_address_string(&registrar_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_init_root": {
                "status": "success",
                "registrar_account": registrar_address,
                "root_name": root_name,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Initialized root registrar");
        println!("  Root name: {}", root_name);
        println!("  Registrar account: {}", registrar_address);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Register a subdomain under a parent (root registrar or domain)
async fn register_subdomain(
    config: &Config,
    domain_name: &str,
    parent_account: &str,
    name_service_program: Option<&str>,
    domain_account: Option<&str>,
    owner: Option<&str>,
    authority: Option<&str>,
    state_proof: Option<&str>,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if domain_name.is_empty() || domain_name.len() > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        let error_msg = format!(
            "Domain name must be between 1 and {} characters",
            TN_NAME_SERVICE_MAX_DOMAIN_LENGTH
        );
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_register_subdomain": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    let (name_service_program_pubkey, name_service_program_bytes) =
        resolve_name_service_program(config, name_service_program)?;
    let parent_account_bytes = validate_address_or_hex(parent_account)?;
    let parent_pubkey = Pubkey::from_bytes(&parent_account_bytes);

    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;
    let owner_bytes = resolve_signing_account(owner, &fee_ctx.fee_payer_keypair, "Owner")?;
    let authority_bytes =
        resolve_signing_account(authority, &fee_ctx.fee_payer_keypair, "Authority")?;

    let domain_pubkey = if let Some(domain_str) = domain_account {
        let domain_bytes = validate_address_or_hex(domain_str)?;
        Pubkey::from_bytes(&domain_bytes)
    } else {
        derive_domain_account_pubkey(&name_service_program_pubkey, &parent_pubkey, domain_name)?
    };

    let domain_bytes = domain_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert domain pubkey to bytes: {}",
            e
        ))
    })?;

    let proof_bytes = if let Some(proof_hex) = state_proof {
        hex::decode(proof_hex)
            .map_err(|e| CliError::Validation(format!("Invalid state proof hex: {}", e)))?
    } else {
        make_state_proof(
            &fee_ctx.client,
            &domain_pubkey,
            ProofType::Creating,
            None,
        )
        .await?
    };

    let transaction = TransactionBuilder::build_name_service_register_subdomain(
        fee_ctx.fee_payer_keypair.public_key,
        name_service_program_bytes,
        domain_bytes,
        parent_account_bytes,
        owner_bytes,
        authority_bytes,
        domain_name,
        proof_bytes,
        NAME_SERVICE_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client: fee_ctx.client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let domain_address = tn_pubkey_to_address_string(&domain_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_register_subdomain": {
                "status": "success",
                "domain_account": domain_address,
                "domain_name": domain_name,
                "parent_account": tn_pubkey_to_address_string(&parent_account_bytes),
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Registered subdomain '{}'", domain_name);
        println!("  Domain account: {}", domain_address);
        println!(
            "  Parent account: {}",
            tn_pubkey_to_address_string(&parent_account_bytes)
        );
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Append a record to a domain
async fn append_record(
    config: &Config,
    domain_account: &str,
    key: &str,
    value: &str,
    owner: Option<&str>,
    fee_payer: Option<&str>,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let key_bytes = key.as_bytes();
    let value_bytes = value.as_bytes();
    if key_bytes.is_empty() || key_bytes.len() > TN_NAME_SERVICE_MAX_KEY_LENGTH {
        let error_msg = format!(
            "Record key must be between 1 and {} bytes",
            TN_NAME_SERVICE_MAX_KEY_LENGTH
        );
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_append_record": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }
    if value_bytes.len() > TN_NAME_SERVICE_MAX_VALUE_LENGTH {
        let error_msg = format!(
            "Record value must be <= {} bytes",
            TN_NAME_SERVICE_MAX_VALUE_LENGTH
        );
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_append_record": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    let (_program_pubkey, program_bytes) =
        resolve_name_service_program(config, name_service_program)?;
    let domain_account_bytes = validate_address_or_hex(domain_account)?;

    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;
    let owner_bytes = resolve_signing_account(owner, &fee_ctx.fee_payer_keypair, "Owner")?;

    let transaction = TransactionBuilder::build_name_service_append_record(
        fee_ctx.fee_payer_keypair.public_key,
        program_bytes,
        domain_account_bytes,
        owner_bytes,
        key_bytes,
        value_bytes,
        NAME_SERVICE_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client: fee_ctx.client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let domain_address = tn_pubkey_to_address_string(&domain_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_append_record": {
                "status": "success",
                "domain_account": domain_address,
                "key": key,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Appended record to domain {}", domain_address);
        println!("  Key: {}", key);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Delete a record from a domain
async fn delete_record(
    config: &Config,
    domain_account: &str,
    key: &str,
    owner: Option<&str>,
    fee_payer: Option<&str>,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let key_bytes = key.as_bytes();
    if key_bytes.is_empty() || key_bytes.len() > TN_NAME_SERVICE_MAX_KEY_LENGTH {
        let error_msg = format!(
            "Record key must be between 1 and {} bytes",
            TN_NAME_SERVICE_MAX_KEY_LENGTH
        );
        if json_format {
            let error_response = serde_json::json!({
                "nameservice_delete_record": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    let (_program_pubkey, program_bytes) =
        resolve_name_service_program(config, name_service_program)?;
    let domain_account_bytes = validate_address_or_hex(domain_account)?;

    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;
    let owner_bytes = resolve_signing_account(owner, &fee_ctx.fee_payer_keypair, "Owner")?;

    let transaction = TransactionBuilder::build_name_service_delete_record(
        fee_ctx.fee_payer_keypair.public_key,
        program_bytes,
        domain_account_bytes,
        owner_bytes,
        key_bytes,
        NAME_SERVICE_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client: fee_ctx.client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let domain_address = tn_pubkey_to_address_string(&domain_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_delete_record": {
                "status": "success",
                "domain_account": domain_address,
                "key": key,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Deleted record from domain {}", domain_address);
        println!("  Key: {}", key);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

/// Unregister (delete) a subdomain
async fn unregister_subdomain(
    config: &Config,
    domain_account: &str,
    owner: Option<&str>,
    fee_payer: Option<&str>,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let (_program_pubkey, program_bytes) =
        resolve_name_service_program(config, name_service_program)?;
    let domain_account_bytes = validate_address_or_hex(domain_account)?;

    let fee_ctx = setup_fee_payer_context(config, fee_payer).await?;
    let owner_bytes = resolve_signing_account(owner, &fee_ctx.fee_payer_keypair, "Owner")?;

    let transaction = TransactionBuilder::build_name_service_unregister_subdomain(
        fee_ctx.fee_payer_keypair.public_key,
        program_bytes,
        domain_account_bytes,
        owner_bytes,
        NAME_SERVICE_PROGRAM_FEE,
        fee_ctx.nonce,
        fee_ctx.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let context = TransactionContext {
        fee_payer_keypair: fee_ctx.fee_payer_keypair,
        client: fee_ctx.client,
    };

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let domain_address = tn_pubkey_to_address_string(&domain_account_bytes);

    if json_format {
        let response = serde_json::json!({
            "nameservice_unregister_subdomain": {
                "status": "success",
                "domain_account": domain_address,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Unregistered subdomain {}", domain_address);
        println!("  Signature: {}", transaction_details.signature);
    }

    Ok(())
}

#[derive(Debug)]
struct ParsedRecord {
    key: Vec<u8>,
    value: Vec<u8>,
}

#[derive(Debug)]
struct ParsedDomainAccount {
    parent: [u8; 32],
    owner: [u8; 32],
    name: String,
    registration_time: u64,
    records: Vec<ParsedRecord>,
}

#[derive(Debug)]
struct ParsedRootRegistrar {
    authority: [u8; 32],
    root_name: String,
    total_subdomains: u64,
}

const DOMAIN_BASE_SIZE: usize =
    32 + 32 + TN_NAME_SERVICE_MAX_DOMAIN_LENGTH + 4 + 8 + 4;
const RECORD_SIZE: usize =
    4 + TN_NAME_SERVICE_MAX_KEY_LENGTH + 4 + TN_NAME_SERVICE_MAX_VALUE_LENGTH;
const ROOT_BASE_SIZE: usize = 32 + TN_NAME_SERVICE_MAX_DOMAIN_LENGTH + 4 + 8;

fn parse_domain_account_data(data: &[u8]) -> Result<ParsedDomainAccount, CliError> {
    if data.len() < DOMAIN_BASE_SIZE {
        return Err(CliError::Validation(
            "Account data too small to be a domain account".to_string(),
        ));
    }
    let mut offset = 0usize;
    let parent: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| CliError::Validation("Invalid parent pubkey length".to_string()))?;
    offset += 32;
    let owner: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| CliError::Validation("Invalid owner pubkey length".to_string()))?;
    offset += 32;

    let name_bytes = &data[offset..offset + TN_NAME_SERVICE_MAX_DOMAIN_LENGTH];
    offset += TN_NAME_SERVICE_MAX_DOMAIN_LENGTH;

    let name_length = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| CliError::Validation("Invalid name length encoding".to_string()))?,
    ) as usize;
    offset += 4;

    if name_length > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        return Err(CliError::Validation(
            "Domain name length exceeds maximum".to_string(),
        ));
    }

    let registration_time = u64::from_le_bytes(
        data[offset..offset + 8]
            .try_into()
            .map_err(|_| CliError::Validation("Invalid registration time encoding".to_string()))?,
    );
    offset += 8;

    let record_count = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| CliError::Validation("Invalid record count encoding".to_string()))?,
    ) as usize;
    offset += 4;

    let expected_size = DOMAIN_BASE_SIZE + record_count * RECORD_SIZE;
    if data.len() != expected_size {
        return Err(CliError::Validation(format!(
            "Unexpected domain account size: expected {}, got {}",
            expected_size,
            data.len()
        )));
    }

    let name = String::from_utf8_lossy(&name_bytes[..name_length]).to_string();

    let mut records = Vec::with_capacity(record_count);
    for i in 0..record_count {
        let record_offset = offset + i * RECORD_SIZE;
        let key_length = u32::from_le_bytes(
            data[record_offset..record_offset + 4]
                .try_into()
                .map_err(|_| CliError::Validation("Invalid key length encoding".to_string()))?,
        ) as usize;
        if key_length == 0 || key_length > TN_NAME_SERVICE_MAX_KEY_LENGTH {
            return Err(CliError::Validation(format!(
                "Invalid key length {} in record {}",
                key_length, i
            )));
        }
        let key_start = record_offset + 4;
        let key_end = key_start + TN_NAME_SERVICE_MAX_KEY_LENGTH;
        let key = data[key_start..key_start + key_length].to_vec();

        let value_length = u32::from_le_bytes(
            data[key_end..key_end + 4]
                .try_into()
                .map_err(|_| CliError::Validation("Invalid value length encoding".to_string()))?,
        ) as usize;
        if value_length > TN_NAME_SERVICE_MAX_VALUE_LENGTH {
            return Err(CliError::Validation(format!(
                "Invalid value length {} in record {}",
                value_length, i
            )));
        }
        let value_start = key_end + 4;
        let value = data[value_start..value_start + value_length].to_vec();

        records.push(ParsedRecord { key, value });
    }

    Ok(ParsedDomainAccount {
        parent,
        owner,
        name,
        registration_time,
        records,
    })
}

fn parse_root_registrar_account_data(data: &[u8]) -> Result<ParsedRootRegistrar, CliError> {
    if data.len() < ROOT_BASE_SIZE {
        return Err(CliError::Validation(
            "Account data too small to be a root registrar account".to_string(),
        ));
    }
    let mut offset = 0usize;
    let authority: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| CliError::Validation("Invalid authority pubkey length".to_string()))?;
    offset += 32;

    let root_name_bytes = &data[offset..offset + TN_NAME_SERVICE_MAX_DOMAIN_LENGTH];
    offset += TN_NAME_SERVICE_MAX_DOMAIN_LENGTH;

    let root_name_length = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| CliError::Validation("Invalid root name length encoding".to_string()))?,
    ) as usize;
    offset += 4;

    if root_name_length > TN_NAME_SERVICE_MAX_DOMAIN_LENGTH {
        return Err(CliError::Validation(
            "Root name length exceeds maximum".to_string(),
        ));
    }

    let total_subdomains = u64::from_le_bytes(
        data[offset..offset + 8]
            .try_into()
            .map_err(|_| CliError::Validation("Invalid total subdomains encoding".to_string()))?,
    );

    let root_name =
        String::from_utf8_lossy(&root_name_bytes[..root_name_length]).to_string();

    Ok(ParsedRootRegistrar {
        authority,
        root_name,
        total_subdomains,
    })
}

fn render_record_value(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

/// Resolve a domain account and optionally retrieve a specific record
async fn resolve_domain(
    config: &Config,
    domain_account: &str,
    key: Option<&str>,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let (name_service_program_pubkey, _) =
        resolve_name_service_program(config, name_service_program)?;
    let domain_bytes = validate_address_or_hex(domain_account)?;
    let domain_address = tn_pubkey_to_address_string(&domain_bytes);
    let domain_pubkey = Pubkey::from_bytes(&domain_bytes);

    let client = create_rpc_client(config)?;
    let account_info = client
        .get_account_info(&domain_pubkey, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch account info: {}", e)))?
        .ok_or_else(|| CliError::Validation(format!("Account {} not found", domain_address)))?;

    if account_info.owner != name_service_program_pubkey {
        return Err(CliError::Validation(format!(
            "Account {} is not owned by the provided name service program",
            domain_address
        )));
    }

    let data_b64 = account_info.data.ok_or_else(|| {
        CliError::Validation(format!(
            "Account {} has no data to parse",
            domain_address
        ))
    })?;
    let data = general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| CliError::Validation(format!("Failed to decode account data: {}", e)))?;

    // Determine if this is a domain or root registrar based on data length
    if data.len() < DOMAIN_BASE_SIZE {
        let registrar = parse_root_registrar_account_data(&data)?;
        let authority_address = tn_pubkey_to_address_string(&registrar.authority);
        if json_format {
            let response = serde_json::json!({
                "nameservice_resolve": {
                    "account": domain_address,
                    "type": "root_registrar",
                    "root_name": registrar.root_name,
                    "authority": authority_address,
                    "total_subdomains": registrar.total_subdomains
                }
            });
            crate::output::print_output(response, true);
        } else {
            println!("Root registrar {}", domain_address);
            println!("  Root name: {}", registrar.root_name);
            println!("  Authority: {}", authority_address);
            println!("  Total subdomains: {}", registrar.total_subdomains);
        }
        return Ok(());
    }

    let domain = parse_domain_account_data(&data)?;
    let owner_address = tn_pubkey_to_address_string(&domain.owner);
    let parent_address = tn_pubkey_to_address_string(&domain.parent);

    if let Some(key_str) = key {
        let key_bytes = key_str.as_bytes();
        let value = domain
            .records
            .iter()
            .find(|r| r.key.as_slice() == key_bytes)
            .map(|r| render_record_value(&r.value));

        if json_format {
            let response = serde_json::json!({
                "nameservice_resolve": {
                    "account": domain_address,
                    "type": "domain",
                    "domain_name": domain.name,
                    "parent": parent_address,
                    "owner": owner_address,
                    "registration_time": domain.registration_time,
                    "record": key_str,
                    "value": value
                }
            });
            crate::output::print_output(response, true);
        } else {
            println!("Domain {}", domain_address);
            println!("  Name: {}", domain.name);
            println!("  Parent: {}", parent_address);
            println!("  Owner: {}", owner_address);
            println!("  Registration time: {}", domain.registration_time);
            match value {
                Some(v) => println!("  {} => {}", key_str, v),
                None => println!("  Key '{}' not found", key_str),
            }
        }
        return Ok(());
    }

    if json_format {
        let records: Vec<_> = domain
            .records
            .iter()
            .map(|r| {
                serde_json::json!({
                    "key": render_record_value(&r.key),
                    "value": render_record_value(&r.value)
                })
            })
            .collect();
        let response = serde_json::json!({
            "nameservice_resolve": {
                "account": domain_address,
                "type": "domain",
                "domain_name": domain.name,
                "parent": parent_address,
                "owner": owner_address,
                "registration_time": domain.registration_time,
                "records": records
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Domain {}", domain_address);
        println!("  Name: {}", domain.name);
        println!("  Parent: {}", parent_address);
        println!("  Owner: {}", owner_address);
        println!("  Registration time: {}", domain.registration_time);
        if domain.records.is_empty() {
            println!("  Records: none");
        } else {
            println!("  Records:");
            for r in domain.records {
                println!(
                    "    {} => {}",
                    render_record_value(&r.key),
                    render_record_value(&r.value)
                );
            }
        }
    }

    Ok(())
}

/// List all records for a domain
async fn list_records(
    config: &Config,
    domain_account: &str,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    resolve_domain(config, domain_account, None, name_service_program, json_format).await
}

/// Derive a domain account address from parent and name
async fn derive_domain_account(
    config: &Config,
    parent_account: &str,
    domain_name: &str,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let (name_service_program_pubkey, _) =
        resolve_name_service_program(config, name_service_program)?;
    let parent_bytes = validate_address_or_hex(parent_account)?;
    let parent_pubkey = Pubkey::from_bytes(&parent_bytes);

    let domain_pubkey =
        derive_domain_account_pubkey(&name_service_program_pubkey, &parent_pubkey, domain_name)?;
    let domain_bytes = domain_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert domain pubkey to bytes: {}",
            e
        ))
    })?;
    let domain_address = tn_pubkey_to_address_string(&domain_bytes);

    if json_format {
        let response = serde_json::json!({
            "derive_domain_account": {
                "parent_account": tn_pubkey_to_address_string(&parent_bytes),
                "domain_name": domain_name,
                "domain_account": domain_address
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived domain account: {}", domain_address);
    }

    Ok(())
}

/// Derive a root registrar account address
async fn derive_registrar_account(
    config: &Config,
    root_name: &str,
    name_service_program: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let (name_service_program_pubkey, _) =
        resolve_name_service_program(config, name_service_program)?;
    let registrar_pubkey =
        derive_root_registrar_account_pubkey(&name_service_program_pubkey, root_name)?;
    let registrar_bytes = registrar_pubkey.to_bytes().map_err(|e| {
        CliError::Crypto(format!(
            "Failed to convert registrar pubkey to bytes: {}",
            e
        ))
    })?;
    let registrar_address = tn_pubkey_to_address_string(&registrar_bytes);

    if json_format {
        let response = serde_json::json!({
            "derive_registrar_account": {
                "root_name": root_name,
                "registrar_account": registrar_address
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Derived registrar account: {}", registrar_address);
    }

    Ok(())
}
