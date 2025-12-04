//! WTHRU program command implementation
use base64::{Engine, engine::general_purpose};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::convert::TryInto;
use std::time::Duration;

use crate::cli::WthruCommands;
use crate::commands::state_proof::make_state_proof;
use crate::commands::token::check_transaction_result;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use crate::utils::validate_address_or_hex;

use thru_base::rpc_types::ProofType;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::{EOA_PROGRAM, TransactionBuilder};
use thru_client::{Account as ChainAccount, Client, ClientBuilder, TransactionDetails};

const WTHRU_PROGRAM_FEE: u64 = 0;
const WTHRU_TRANSFER_FEE: u64 = 1;
const WTHRU_DECIMALS: u8 = 8;
const TX_TIMEOUT_SECS: u64 = 30;
const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
const TOKEN_ACCOUNT_AMOUNT_OFFSET: usize = 64;
const TOKEN_ACCOUNT_FROZEN_OFFSET: usize = 72;
const VAULT_METADATA_MINT_OFFSET: usize = 0;
const VAULT_METADATA_LAST_BALANCE_OFFSET: usize = 32;

/// Main WTHRU command router
pub async fn handle_wthru_command(
    config: &Config,
    subcommand: WthruCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        WthruCommands::Initialize {
            fee_payer,
            program,
            token_program,
        } => {
            initialize_wthru(
                config,
                fee_payer.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        WthruCommands::Deposit {
            dest_token_account,
            amount,
            fee_payer,
            program,
            token_program,
            skip_transfer,
        } => {
            deposit_wthru(
                config,
                &dest_token_account,
                amount,
                fee_payer.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                skip_transfer,
                json_format,
            )
            .await
        }
        WthruCommands::Withdraw {
            wthru_token_account,
            recipient,
            amount,
            fee_payer,
            program,
            token_program,
        } => {
            withdraw_wthru(
                config,
                &wthru_token_account,
                &recipient,
                amount,
                fee_payer.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
    }
}

async fn initialize_wthru(
    config: &Config,
    fee_payer_name: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer_name)?;
    let (wthru_program_pubkey, wthru_program_bytes) =
        resolve_wthru_program_pubkey(config, program_override)?;
    let (token_program_pubkey, token_program_bytes) =
        resolve_token_program_pubkey(config, token_program_override)?;

    let mint_seed = wthru_mint_seed();
    let mint_account_bytes =
        derive_mint_account_bytes(&token_program_bytes, &wthru_program_bytes, &mint_seed);
    let vault_account_bytes = derive_vault_account_bytes(&wthru_program_bytes);

    let mint_account_pubkey = Pubkey::from_bytes(&mint_account_bytes);
    let vault_account_pubkey = Pubkey::from_bytes(&vault_account_bytes);

    let client = create_rpc_client(config)?;

    ensure_account_absent(&client, &mint_account_pubkey, "mint").await?;
    ensure_account_absent(&client, &vault_account_pubkey, "vault").await?;

    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    let mint_proof =
        make_state_proof(&client, &mint_account_pubkey, ProofType::Creating, None).await?;
    let vault_proof =
        make_state_proof(&client, &vault_account_pubkey, ProofType::Creating, None).await?;

    let mut transaction = TransactionBuilder::build_wthru_initialize_mint(
        fee_payer_keypair.public_key,
        wthru_program_bytes,
        token_program_bytes,
        mint_account_bytes,
        vault_account_bytes,
        WTHRU_DECIMALS,
        mint_seed,
        mint_proof,
        vault_proof,
        WTHRU_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    let transaction_details = submit_transaction(&client, &transaction).await?;
    check_transaction_result(&transaction_details, json_format)?;

    let mint_addr = mint_account_pubkey.to_string();
    let vault_addr = vault_account_pubkey.to_string();
    let signature = transaction_details.signature.as_str().to_string();

    if json_format {
        let response = json!({
            "initialize": {
                "status": "success",
                "signature": signature,
                "mint": mint_addr,
                "vault": vault_addr,
                "decimals": WTHRU_DECIMALS,
                "token_program": token_program_pubkey.to_string(),
                "wthru_program": wthru_program_pubkey.to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        println!(
            "Initialized WTHRU mint {} (vault {})",
            mint_addr, vault_addr
        );
        println!("Transaction signature: {}", signature);
    }

    Ok(())
}

async fn deposit_wthru(
    config: &Config,
    dest_token_account: &str,
    amount: u64,
    fee_payer_name: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    skip_transfer: bool,
    json_format: bool,
) -> Result<(), CliError> {
    if amount == 0 {
        return Err(CliError::Validation(
            "Deposit amount must be greater than zero".to_string(),
        ));
    }

    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer_name)?;
    let (_wthru_program_pubkey, wthru_program_bytes) =
        resolve_wthru_program_pubkey(config, program_override)?;
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program_pubkey(config, token_program_override)?;

    let mint_seed = wthru_mint_seed();
    let mint_account_bytes =
        derive_mint_account_bytes(&token_program_bytes, &wthru_program_bytes, &mint_seed);
    let mint_account_pubkey = Pubkey::from_bytes(&mint_account_bytes);
    let vault_account_bytes = derive_vault_account_bytes(&wthru_program_bytes);
    let vault_account_pubkey = Pubkey::from_bytes(&vault_account_bytes);

    let dest_token_bytes = validate_address_or_hex(dest_token_account)?;
    let dest_token_pubkey = Pubkey::from_bytes(&dest_token_bytes);

    let client = create_rpc_client(config)?;

    let mint_info = fetch_account(&client, &mint_account_pubkey, "mint").await?;
    ensure_account_owner(&mint_info, &token_program_bytes, "mint")?;

    let (mut vault_meta, mut vault_balance) =
        fetch_vault_state(&client, &vault_account_pubkey).await?;
    if vault_meta.mint != mint_account_bytes {
        return Err(CliError::Validation(
            "Vault metadata mint does not match derived WTHRU mint".to_string(),
        ));
    }

    validate_token_account(
        &client,
        &dest_token_pubkey,
        &mint_account_bytes,
        &token_program_bytes,
        None,
    )
    .await?;

    let (mut nonce, balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;

    if !skip_transfer && vault_balance != vault_meta.last_balance {
        return Err(CliError::Validation(
            "Vault has pending deposits; settle them (use --skip-transfer if needed)".to_string(),
        ));
    }

    let mut transfer_signature = None;

    if !skip_transfer {
        let required = amount + WTHRU_TRANSFER_FEE;
        if balance < required {
            return Err(CliError::Validation(format!(
                "Insufficient balance. Required {} (deposit {} + fee {}), available {}",
                required, amount, WTHRU_TRANSFER_FEE, balance
            )));
        }

        let block_height = client.get_block_height().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
        })?;

        let mut transfer_tx = TransactionBuilder::build_transfer(
            fee_payer_keypair.public_key,
            EOA_PROGRAM,
            vault_account_bytes,
            amount,
            WTHRU_TRANSFER_FEE,
            nonce,
            block_height.finalized_height,
        )
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transfer: {}", e)))?;

        transfer_tx
            .sign(&fee_payer_keypair.private_key)
            .map_err(|e| {
                CliError::TransactionSubmission(format!("Failed to sign transfer: {}", e))
            })?;

        let transfer_details = submit_transaction(&client, &transfer_tx).await?;
        check_transaction_result(&transfer_details, json_format)?;
        transfer_signature = Some(transfer_details.signature.as_str().to_string());
        nonce = nonce.saturating_add(1);

        // Refresh vault balance after transfer
        let state = fetch_vault_state(&client, &vault_account_pubkey).await?;
        vault_meta = state.0;
        vault_balance = state.1;
    }

    let pending_amount = vault_balance
        .checked_sub(vault_meta.last_balance)
        .ok_or_else(|| {
            CliError::Validation("Vault balance dropped below recorded last balance".to_string())
        })?;

    if pending_amount == 0 {
        return Err(CliError::Validation(
            "No new native THRU detected in the vault; transfer funds first".to_string(),
        ));
    }

    if pending_amount != amount {
        return Err(CliError::Validation(format!(
            "Vault shows {} pending lamports but --amount={}. Adjust the amount or settle outstanding deposits",
            pending_amount, amount
        )));
    }

    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    let mut deposit_tx = TransactionBuilder::build_wthru_deposit(
        fee_payer_keypair.public_key,
        wthru_program_bytes,
        token_program_bytes,
        mint_account_bytes,
        vault_account_bytes,
        dest_token_bytes,
        WTHRU_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build deposit: {}", e)))?;

    deposit_tx
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign deposit transaction: {}", e))
        })?;

    let deposit_details = submit_transaction(&client, &deposit_tx).await?;
    check_transaction_result(&deposit_details, json_format)?;

    let deposit_signature = deposit_details.signature.as_str().to_string();
    if json_format {
        let response = json!({
            "deposit": {
                "status": "success",
                "native_transfer_signature": transfer_signature,
                "deposit_signature": deposit_signature,
                "amount": pending_amount,
                "mint": mint_account_pubkey.to_string(),
                "vault": vault_account_pubkey.to_string(),
                "dest_token_account": dest_token_pubkey.to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        if let Some(sig) = transfer_signature.as_ref() {
            println!("Native transfer signature: {}", sig);
        }
        println!(
            "Minted {} WTHRU into {} (deposit signature: {})",
            pending_amount, dest_token_pubkey, deposit_signature
        );
    }

    Ok(())
}

async fn withdraw_wthru(
    config: &Config,
    wthru_token_account: &str,
    recipient: &str,
    amount: u64,
    fee_payer_name: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if amount == 0 {
        return Err(CliError::Validation(
            "Withdraw amount must be greater than zero".to_string(),
        ));
    }

    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer_name)?;
    let (_wthru_program_pubkey, wthru_program_bytes) =
        resolve_wthru_program_pubkey(config, program_override)?;
    let (_token_program_pubkey, token_program_bytes) =
        resolve_token_program_pubkey(config, token_program_override)?;

    let mint_seed = wthru_mint_seed();
    let mint_account_bytes =
        derive_mint_account_bytes(&token_program_bytes, &wthru_program_bytes, &mint_seed);
    let mint_account_pubkey = Pubkey::from_bytes(&mint_account_bytes);
    let vault_account_bytes = derive_vault_account_bytes(&wthru_program_bytes);
    let vault_account_pubkey = Pubkey::from_bytes(&vault_account_bytes);

    let wthru_token_bytes = validate_address_or_hex(wthru_token_account)?;
    let wthru_token_pubkey = Pubkey::from_bytes(&wthru_token_bytes);
    let recipient_bytes = validate_address_or_hex(recipient)?;
    let recipient_pubkey = Pubkey::from_bytes(&recipient_bytes);

    let client = create_rpc_client(config)?;

    let mint_info = fetch_account(&client, &mint_account_pubkey, "mint").await?;
    ensure_account_owner(&mint_info, &token_program_bytes, "mint")?;

    let (vault_meta, vault_balance) = fetch_vault_state(&client, &vault_account_pubkey).await?;
    if vault_meta.mint != mint_account_bytes {
        return Err(CliError::Validation(
            "Vault metadata mint does not match derived WTHRU mint".to_string(),
        ));
    }

    if vault_meta.last_balance < amount {
        return Err(CliError::Validation(format!(
            "Vault only tracks {} lamports but {} requested",
            vault_meta.last_balance, amount
        )));
    }

    if vault_balance < amount {
        return Err(CliError::Validation(
            "Vault balance is lower than requested withdrawal amount".to_string(),
        ));
    }

    let token_state = validate_token_account(
        &client,
        &wthru_token_pubkey,
        &mint_account_bytes,
        &token_program_bytes,
        Some(&fee_payer_keypair.public_key),
    )
    .await?;

    if token_state.amount < amount {
        return Err(CliError::Validation(format!(
            "Token account only holds {} WTHRU",
            token_state.amount
        )));
    }

    ensure_account_exists(&client, &recipient_pubkey, "recipient").await?;

    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;

    let mut withdraw_tx = TransactionBuilder::build_wthru_withdraw(
        fee_payer_keypair.public_key,
        wthru_program_bytes,
        token_program_bytes,
        mint_account_bytes,
        vault_account_bytes,
        wthru_token_bytes,
        recipient_bytes,
        amount,
        WTHRU_PROGRAM_FEE,
        nonce,
        block_height.finalized_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build withdraw: {}", e)))?;

    withdraw_tx
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign withdraw transaction: {}", e))
        })?;

    let withdraw_details = submit_transaction(&client, &withdraw_tx).await?;
    check_transaction_result(&withdraw_details, json_format)?;

    let signature = withdraw_details.signature.as_str().to_string();
    if json_format {
        let response = json!({
            "withdraw": {
                "status": "success",
                "signature": signature,
                "amount": amount,
                "mint": mint_account_pubkey.to_string(),
                "vault": vault_account_pubkey.to_string(),
                "token_account": wthru_token_pubkey.to_string(),
                "recipient": recipient_pubkey.to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        println!(
            "Burned {} WTHRU from {} -> sent native THRU to {} (signature: {})",
            amount, wthru_token_pubkey, recipient_pubkey, signature
        );
    }

    Ok(())
}

fn resolve_fee_payer_keypair(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<KeyPair, CliError> {
    let key_name = fee_payer.unwrap_or("default");
    let key_hex = config.keys.get_key(key_name).map_err(|_| {
        CliError::Validation(format!(
            "Fee payer key '{}' not found in configuration",
            key_name
        ))
    })?;

    KeyPair::from_hex_private_key(key_name, key_hex)
        .map_err(|e| CliError::Crypto(format!("Failed to create fee payer keypair: {}", e)))
}

fn resolve_wthru_program_pubkey(
    config: &Config,
    override_addr: Option<&str>,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    if let Some(addr) = override_addr {
        let bytes = validate_address_or_hex(addr)?;
        return Ok((Pubkey::from_bytes(&bytes), bytes));
    }

    let pubkey = config.get_wthru_program_pubkey()?;
    let bytes = pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode WTHRU program pubkey: {}", e)))?;
    Ok((pubkey, bytes))
}

fn resolve_token_program_pubkey(
    config: &Config,
    override_addr: Option<&str>,
) -> Result<(Pubkey, [u8; 32]), CliError> {
    if let Some(addr) = override_addr {
        let bytes = validate_address_or_hex(addr)?;
        return Ok((Pubkey::from_bytes(&bytes), bytes));
    }

    let pubkey = config.get_token_program_pubkey()?;
    let bytes = pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode token program pubkey: {}", e)))?;
    Ok((pubkey, bytes))
}

fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .build()
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to create RPC client: {}", e)))
}

async fn submit_transaction(
    client: &Client,
    transaction: &Transaction,
) -> Result<TransactionDetails, CliError> {
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(TX_TIMEOUT_SECS);
    client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })
}

fn wthru_mint_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[..5].copy_from_slice(b"wthru");
    seed
}

fn derive_mint_account_bytes(
    token_program: &[u8; 32],
    wthru_program: &[u8; 32],
    mint_seed: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(wthru_program);
    hasher.update(mint_seed);
    let hash = hasher.finalize();
    let mut derived_seed = [0u8; 32];
    derived_seed.copy_from_slice(&hash[..32]);

    create_program_defined_account_address(token_program, false, &derived_seed)
}

fn derive_vault_account_bytes(wthru_program: &[u8; 32]) -> [u8; 32] {
    let seed = pad_seed(b"vault");
    create_program_defined_account_address(wthru_program, false, &seed)
}

fn create_program_defined_account_address(
    owner: &[u8; 32],
    is_ephemeral: bool,
    seed: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(owner);
    hasher.update(&[if is_ephemeral { 1u8 } else { 0u8 }]);
    hasher.update(seed);
    let hash = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&hash[..32]);
    out
}

fn pad_seed(seed: &[u8]) -> [u8; 32] {
    let mut padded = [0u8; 32];
    let len = seed.len().min(32);
    padded[..len].copy_from_slice(&seed[..len]);
    padded
}

async fn ensure_account_absent(
    client: &Client,
    account: &Pubkey,
    label: &str,
) -> Result<(), CliError> {
    if let Some(existing) = client.get_account_info(account, None).await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get {} account info: {}", label, e))
    })? {
        if !existing.is_new {
            return Err(CliError::Validation(format!(
                "{} account {} already exists",
                label, account
            )));
        }
    }
    Ok(())
}

async fn ensure_account_exists(
    client: &Client,
    account: &Pubkey,
    label: &str,
) -> Result<(), CliError> {
    if client
        .get_account_info(account, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get {} account info: {}", label, e))
        })?
        .is_none()
    {
        return Err(CliError::Validation(format!(
            "{} account {} not found",
            label, account
        )));
    }
    Ok(())
}

async fn fetch_nonce_and_balance(
    client: &Client,
    fee_payer: &KeyPair,
) -> Result<(u64, u64), CliError> {
    let account_info = client
        .get_account_info(&fee_payer.address_string, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;

    if let Some(account) = account_info {
        Ok((account.nonce, account.balance))
    } else {
        Err(CliError::AccountNotFound(format!(
            "Fee payer account {} not found",
            fee_payer.address_string
        )))
    }
}

async fn fetch_account(
    client: &Client,
    pubkey: &Pubkey,
    label: &str,
) -> Result<ChainAccount, CliError> {
    client
        .get_account_info(pubkey, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get {} account info: {}", label, e))
        })?
        .ok_or_else(|| CliError::Validation(format!("{} account {} not found", label, pubkey)))
}

fn ensure_account_owner(
    account: &ChainAccount,
    expected_owner: &[u8; 32],
    label: &str,
) -> Result<(), CliError> {
    let owner_bytes = account
        .owner
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode {} owner: {}", label, e)))?;
    if owner_bytes != *expected_owner {
        return Err(CliError::Validation(format!(
            "{} account owner does not match expected program",
            label
        )));
    }
    Ok(())
}

async fn fetch_vault_state(
    client: &Client,
    vault_pubkey: &Pubkey,
) -> Result<(VaultMetadata, u64), CliError> {
    let account = fetch_account(client, vault_pubkey, "vault").await?;
    let data = decode_account_data(&account, "vault")?;
    if data.len() < VAULT_METADATA_LAST_BALANCE_OFFSET + 8 {
        return Err(CliError::Validation(
            "Vault account data is too small".to_string(),
        ));
    }
    let meta = parse_vault_metadata(&data)?;
    Ok((meta, account.balance))
}

fn decode_account_data(account: &ChainAccount, label: &str) -> Result<Vec<u8>, CliError> {
    let encoded = account
        .data
        .as_ref()
        .ok_or_else(|| CliError::Validation(format!("{} account data is not available", label)))?;
    general_purpose::STANDARD.decode(encoded).map_err(|e| {
        CliError::Validation(format!("Failed to decode {} account data: {}", label, e))
    })
}

fn parse_vault_metadata(data: &[u8]) -> Result<VaultMetadata, CliError> {
    if data.len() < VAULT_METADATA_LAST_BALANCE_OFFSET + 8 {
        return Err(CliError::Validation(
            "Vault metadata is truncated".to_string(),
        ));
    }
    let mut mint = [0u8; 32];
    mint.copy_from_slice(&data[VAULT_METADATA_MINT_OFFSET..VAULT_METADATA_MINT_OFFSET + 32]);
    let last_balance_bytes: [u8; 8] = data
        [VAULT_METADATA_LAST_BALANCE_OFFSET..VAULT_METADATA_LAST_BALANCE_OFFSET + 8]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse vault last balance".to_string()))?;
    Ok(VaultMetadata {
        mint,
        last_balance: u64::from_le_bytes(last_balance_bytes),
    })
}

async fn validate_token_account(
    client: &Client,
    account_pubkey: &Pubkey,
    expected_mint: &[u8; 32],
    expected_token_program: &[u8; 32],
    expected_owner: Option<&[u8; 32]>,
) -> Result<TokenAccountData, CliError> {
    let account = fetch_account(client, account_pubkey, "token").await?;
    ensure_account_owner(&account, expected_token_program, "token")?;
    let data = decode_account_data(&account, "token")?;
    let parsed = parse_token_account(&data)?;
    if parsed.mint != *expected_mint {
        return Err(CliError::Validation(
            "Token account mint does not match WTHRU mint".to_string(),
        ));
    }
    if parsed.is_frozen {
        return Err(CliError::Validation("Token account is frozen".to_string()));
    }
    if let Some(owner) = expected_owner {
        if parsed.owner != *owner {
            return Err(CliError::Validation(
                "Token account owner must match the fee payer".to_string(),
            ));
        }
    }
    Ok(parsed)
}

fn parse_token_account(data: &[u8]) -> Result<TokenAccountData, CliError> {
    if data.len() <= TOKEN_ACCOUNT_FROZEN_OFFSET {
        return Err(CliError::Validation(
            "Token account data is truncated".to_string(),
        ));
    }
    let mut mint = [0u8; 32];
    mint.copy_from_slice(&data[TOKEN_ACCOUNT_MINT_OFFSET..TOKEN_ACCOUNT_MINT_OFFSET + 32]);
    let mut owner = [0u8; 32];
    owner.copy_from_slice(&data[TOKEN_ACCOUNT_OWNER_OFFSET..TOKEN_ACCOUNT_OWNER_OFFSET + 32]);
    let amount_bytes: [u8; 8] = data[TOKEN_ACCOUNT_AMOUNT_OFFSET..TOKEN_ACCOUNT_AMOUNT_OFFSET + 8]
        .try_into()
        .map_err(|_| CliError::Validation("Failed to parse token amount".to_string()))?;
    let amount = u64::from_le_bytes(amount_bytes);
    let is_frozen = data[TOKEN_ACCOUNT_FROZEN_OFFSET] != 0;
    Ok(TokenAccountData {
        mint,
        owner,
        amount,
        is_frozen,
    })
}

struct VaultMetadata {
    mint: [u8; 32],
    last_balance: u64,
}

struct TokenAccountData {
    mint: [u8; 32],
    owner: [u8; 32],
    amount: u64,
    is_frozen: bool,
}
