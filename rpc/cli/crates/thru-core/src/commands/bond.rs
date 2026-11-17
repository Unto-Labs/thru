//! Block-producer (BP) bond program command implementation.
//!
//! Manages `tn_block_producer_program` (genesis 0x0D01, UNTO-1291). The bond is
//! keyed by the block-producer signer identity; its account address is a PDA
//! derived from the signer. Mutating ops use the single-signer model: the bond
//! authority signs by being the fee payer (`--fee-payer <authority_key>`).
use base64::{Engine, engine::general_purpose};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::convert::TryInto;
use std::time::Duration;

use crate::cli::BondCommands;
use crate::commands::state_proof::make_state_proof;
use crate::commands::token::check_transaction_result;
use crate::config::Config;
use crate::error::CliError;
use crate::keys::LoadedKey;
use crate::output;
use crate::utils::validate_address_or_hex;
use std::sync::Arc;

use thru_base::rpc_types::ProofType;
use thru_base::tn_public_address::create_program_defined_account_address;
use thru_base::tn_tools::Pubkey;
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::{
    TransactionBuilder, bp_bond_account_address, bp_bond_ta_address, bp_sign_eoa_creation,
};
use thru_client::{Account as ChainAccount, Client, ClientBuilder, TransactionDetails};

const BOND_PROGRAM_FEE: u64 = 0;
const TX_TIMEOUT_SECS: u64 = 30;

/* tn_bp_bond_account field offsets (tn_block_producer_program.h): packed,
account_type (TN_BP_ACCOUNT_TYPE_BOND_V1) at byte 0, then the payload. */
const BOND_ACCOUNT_TYPE_OFFSET: usize = 0;
const BOND_SIGNER_OFFSET: usize = 1;
const BOND_AUTHORITY_OFFSET: usize = 33;
const BOND_TA_OFFSET: usize = 65;
const BOND_ACTIVE_OFFSET: usize = 97;
const BOND_STAGED_OFFSET: usize = 105;
const BOND_UNLOCK_OFFSET: usize = 113;
const BOND_LAST_CHANGE_OFFSET: usize = 121;
const BOND_ACCOUNT_SIZE: usize = 129;
/* TN_BP_ACCOUNT_TYPE_BOND_V1 */
const BOND_ACCOUNT_TYPE_V1: u8 = 1;

/// Decoded `tn_bp_bond_account` (version 1 layout).
#[derive(Debug, Clone, PartialEq, Eq)]
struct BondAccount {
    signer: [u8; 32],
    authority: [u8; 32],
    wthru_ta: [u8; 32],
    active_bond: u64,
    staged_amount: u64,
    unlock_slot: u64,
    last_change_slot: u64,
}

/// Decodes bond account data: exact size and the bond discriminator.
fn parse_bond_account(data: &[u8]) -> Result<BondAccount, String> {
    if data.len() != BOND_ACCOUNT_SIZE {
        return Err(format!(
            "bond account data is {} bytes (expected {})",
            data.len(),
            BOND_ACCOUNT_SIZE
        ));
    }
    let account_type = data[BOND_ACCOUNT_TYPE_OFFSET];
    if account_type != BOND_ACCOUNT_TYPE_V1 {
        return Err(format!(
            "account type {} is not a bond account (expected {})",
            account_type, BOND_ACCOUNT_TYPE_V1
        ));
    }
    Ok(BondAccount {
        signer: read_pubkey(data, BOND_SIGNER_OFFSET),
        authority: read_pubkey(data, BOND_AUTHORITY_OFFSET),
        wthru_ta: read_pubkey(data, BOND_TA_OFFSET),
        active_bond: read_u64(data, BOND_ACTIVE_OFFSET),
        staged_amount: read_u64(data, BOND_STAGED_OFFSET),
        unlock_slot: read_u64(data, BOND_UNLOCK_OFFSET),
        last_change_slot: read_u64(data, BOND_LAST_CHANGE_OFFSET),
    })
}

/// Main BP bond command router
pub async fn handle_bond_command(
    config: &Config,
    subcommand: BondCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        BondCommands::Create {
            signer,
            fee_payer,
            authority,
            mint,
            program,
            token_program,
        } => {
            bond_create(
                config,
                signer.as_deref(),
                fee_payer.as_deref(),
                authority.as_deref(),
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Deposit {
            signer,
            source_ta,
            amount,
            fee_payer,
            mint,
            program,
            token_program,
        } => {
            bond_deposit(
                config,
                &signer,
                &source_ta,
                amount,
                fee_payer.as_deref(),
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Update {
            signer,
            active,
            unlock_slot,
            fee_payer,
            attestor_table,
            program,
        } => {
            bond_update(
                config,
                &signer,
                active,
                unlock_slot.unwrap_or(0),
                fee_payer.as_deref(),
                attestor_table.as_deref(),
                program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Withdraw {
            signer,
            dest_ta,
            amount,
            from,
            fee_payer,
            attestor_table,
            mint,
            program,
            token_program,
        } => {
            bond_withdraw(
                config,
                &signer,
                &dest_ta,
                amount,
                &from,
                fee_payer.as_deref(),
                attestor_table.as_deref(),
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::SetAuthority {
            signer,
            new_authority,
            fee_payer,
            program,
        } => {
            bond_set_authority(
                config,
                &signer,
                &new_authority,
                fee_payer.as_deref(),
                program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Sweep {
            signer,
            dest_ta,
            fee_payer,
            mint,
            program,
            token_program,
        } => {
            bond_sweep(
                config,
                &signer,
                &dest_ta,
                fee_payer.as_deref(),
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Delete {
            signer,
            dest,
            fee_payer,
            program,
        } => {
            bond_delete(
                config,
                &signer,
                &dest,
                fee_payer.as_deref(),
                program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::Show {
            signer,
            mint,
            program,
            token_program,
        } => {
            bond_show(
                config,
                &signer,
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
        BondCommands::DeriveAddress { signer, program } => {
            bond_derive_address(config, &signer, program.as_deref(), json_format).await
        }
        BondCommands::DeriveTokenAccount {
            signer,
            mint,
            program,
            token_program,
        } => {
            bond_derive_token_account(
                config,
                &signer,
                mint.as_deref(),
                program.as_deref(),
                token_program.as_deref(),
                json_format,
            )
            .await
        }
    }
}

/* ---------------------------------------------------------------------- */
/* Command handlers                                                        */
/* ---------------------------------------------------------------------- */

#[allow(clippy::too_many_arguments)]
async fn bond_create(
    config: &Config,
    signer_name: Option<&str>,
    fee_payer_name: Option<&str>,
    authority_arg: Option<&str>,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    /* Resolve signer/fee-payer references so supplying only one retains the
    self-pay (Mode 1) default. Mode 2 uses an independent EOA challenge signer;
    both actual signing roles accept aliases or direct sources. */
    let (signer_key_name, fee_payer_key_name) = match (signer_name, fee_payer_name) {
        (Some(s), Some(f)) => (s, f),
        (Some(s), None) => (s, s),
        (None, Some(f)) => (f, f),
        (None, None) => ("default", "default"),
    };
    let signer_keypair = resolve_signer_keypair(config, signer_key_name)?;
    let fee_payer_keypair = if signer_key_name == fee_payer_key_name {
        Arc::clone(&signer_keypair)
    } else {
        config.keys.load_fee_payer(Some(fee_payer_key_name))?
    };

    let create_signer_eoa = signer_keypair.public_key != fee_payer_keypair.public_key;

    let bond_authority = match authority_arg {
        Some(a) => resolve_pubkey_arg(config, a)?,
        None => signer_keypair.public_key,
    };

    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;

    let signer_bytes = signer_keypair.public_key;
    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );

    let bond_pubkey = Pubkey::from_bytes(&bond_bytes);
    let bond_ta_pubkey = Pubkey::from_bytes(&bond_ta_bytes);
    let signer_pubkey = Pubkey::from_bytes(&signer_bytes);

    let client = create_rpc_client(config)?;

    ensure_account_absent(&client, &bond_pubkey, "bond").await?;
    ensure_account_absent(&client, &bond_ta_pubkey, "bond token account").await?;
    if create_signer_eoa {
        ensure_account_absent(&client, &signer_pubkey, "signer EOA").await?;
    }

    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let bond_proof = make_state_proof(&client, &bond_pubkey, ProofType::Creating, None).await?;
    let ta_proof = make_state_proof(&client, &bond_ta_pubkey, ProofType::Creating, None).await?;
    let (eoa_proof, signer_eoa_signature) = if create_signer_eoa {
        let proof = make_state_proof(&client, &signer_pubkey, ProofType::Creating, None).await?;
        let sig = bp_sign_eoa_creation(
            &signer_keypair.private_key,
            chain_id,
            &fee_payer_keypair.public_key,
            &signer_bytes,
        );
        (proof, sig)
    } else {
        (Vec::new(), [0u8; 64])
    };

    let transaction = TransactionBuilder::build_bp_create_account(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        token_program_bytes,
        bond_bytes,
        bond_ta_bytes,
        mint_bytes,
        signer_bytes,
        bond_authority,
        create_signer_eoa,
        signer_eoa_signature,
        bond_proof,
        ta_proof,
        eoa_proof,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build bond create: {}", e)))?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    let mode = if create_signer_eoa { "mode2" } else { "mode1" };
    if json_format {
        let response = json!({
            "bond_create": {
                "status": "success",
                "mode": mode,
                "signature": signature,
                "signer": signer_pubkey.to_string(),
                "bond_authority": Pubkey::from_bytes(&bond_authority).to_string(),
                "bond_address": bond_pubkey.to_string(),
                "bond_token_account": bond_ta_pubkey.to_string(),
                "mint": Pubkey::from_bytes(&mint_bytes).to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        println!(
            "Created bond ({}) for signer {} at {} (TA {})",
            mode, signer_pubkey, bond_pubkey, bond_ta_pubkey
        );
        println!("Transaction signature: {}", signature);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn bond_deposit(
    config: &Config,
    signer_arg: &str,
    source_ta: &str,
    amount: u64,
    fee_payer_name: Option<&str>,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if amount == 0 {
        return Err(CliError::Validation(
            "Deposit amount must be greater than zero".to_string(),
        ));
    }
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let source_ta_bytes = validate_address_or_hex(source_ta)?;

    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_deposit(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        token_program_bytes,
        bond_bytes,
        bond_ta_bytes,
        source_ta_bytes,
        amount,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build bond deposit: {}", e)))?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_deposit",
        &signature,
        json!({
            "amount": amount,
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
            "source_token_account": Pubkey::from_bytes(&source_ta_bytes).to_string(),
        }),
        &format!(
            "Staged {} into bond {}",
            amount,
            Pubkey::from_bytes(&bond_bytes)
        ),
        json_format,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn bond_update(
    config: &Config,
    signer_arg: &str,
    new_active: u64,
    new_unlock_slot: u64,
    fee_payer_name: Option<&str>,
    attestor_table_override: Option<&str>,
    program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let attestor_table_bytes = resolve_attestor_table_bytes(config, attestor_table_override)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_update_bond(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        bond_bytes,
        attestor_table_bytes,
        new_unlock_slot,
        new_active,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build bond update: {}", e)))?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_update",
        &signature,
        json!({
            "new_active": new_active,
            "new_unlock_slot": new_unlock_slot,
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
        }),
        &format!(
            "Updated bond {} active={}",
            Pubkey::from_bytes(&bond_bytes),
            new_active
        ),
        json_format,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn bond_withdraw(
    config: &Config,
    signer_arg: &str,
    dest_ta: &str,
    amount: u64,
    from: &str,
    fee_payer_name: Option<&str>,
    attestor_table_override: Option<&str>,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if amount == 0 {
        return Err(CliError::Validation(
            "Withdraw amount must be greater than zero".to_string(),
        ));
    }
    let from_active = match from {
        "staged" => false,
        "active" => true,
        other => {
            return Err(CliError::Validation(format!(
                "--from must be 'staged' or 'active', got '{}'",
                other
            )));
        }
    };

    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;
    let attestor_table_bytes = resolve_attestor_table_bytes(config, attestor_table_override)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let dest_ta_bytes = validate_address_or_hex(dest_ta)?;

    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_withdrawal(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        token_program_bytes,
        bond_bytes,
        bond_ta_bytes,
        dest_ta_bytes,
        attestor_table_bytes,
        from_active,
        amount,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build bond withdraw: {}", e))
    })?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_withdraw",
        &signature,
        json!({
            "amount": amount,
            "from": from,
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
            "dest_token_account": Pubkey::from_bytes(&dest_ta_bytes).to_string(),
        }),
        &format!(
            "Withdrew {} ({}) from bond {}",
            amount,
            from,
            Pubkey::from_bytes(&bond_bytes)
        ),
        json_format,
    );
    Ok(())
}

async fn bond_set_authority(
    config: &Config,
    signer_arg: &str,
    new_authority_arg: &str,
    fee_payer_name: Option<&str>,
    program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let new_authority_bytes = resolve_pubkey_arg(config, new_authority_arg)?;
    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_set_authority(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        bond_bytes,
        new_authority_bytes,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to build bond set-authority: {}", e))
    })?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_set_authority",
        &signature,
        json!({
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
            "new_authority": Pubkey::from_bytes(&new_authority_bytes).to_string(),
        }),
        &format!(
            "Set bond {} authority -> {}",
            Pubkey::from_bytes(&bond_bytes),
            Pubkey::from_bytes(&new_authority_bytes)
        ),
        json_format,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn bond_sweep(
    config: &Config,
    signer_arg: &str,
    dest_ta: &str,
    fee_payer_name: Option<&str>,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let dest_ta_bytes = validate_address_or_hex(dest_ta)?;

    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_sweep(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        token_program_bytes,
        bond_bytes,
        bond_ta_bytes,
        dest_ta_bytes,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build bond sweep: {}", e)))?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_sweep",
        &signature,
        json!({
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
            "dest_token_account": Pubkey::from_bytes(&dest_ta_bytes).to_string(),
        }),
        &format!(
            "Swept bond {} -> {}",
            Pubkey::from_bytes(&bond_bytes),
            Pubkey::from_bytes(&dest_ta_bytes)
        ),
        json_format,
    );
    Ok(())
}

async fn bond_delete(
    config: &Config,
    signer_arg: &str,
    dest_arg: &str,
    fee_payer_name: Option<&str>,
    program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer_name)?;
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let dest_bytes = resolve_pubkey_arg(config, dest_arg)?;
    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);

    let client = create_rpc_client(config)?;
    let (nonce, _balance) = fetch_nonce_and_balance(&client, &fee_payer_keypair).await?;
    let block_height = fetch_finalized_height(&client).await?;
    let chain_id = fetch_chain_id(&client).await?;

    let transaction = TransactionBuilder::build_bp_delete_account(
        fee_payer_keypair.public_key,
        bp_program_bytes,
        bond_bytes,
        dest_bytes,
        BOND_PROGRAM_FEE,
        nonce,
        block_height,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build bond delete: {}", e)))?;

    let signature = sign_and_submit(
        &client,
        transaction,
        chain_id,
        &fee_payer_keypair,
        json_format,
    )
    .await?;

    print_simple_result(
        "bond_delete",
        &signature,
        json!({
            "bond_address": Pubkey::from_bytes(&bond_bytes).to_string(),
            "dest": Pubkey::from_bytes(&dest_bytes).to_string(),
        }),
        &format!("Deleted bond {}", Pubkey::from_bytes(&bond_bytes)),
        json_format,
    );
    Ok(())
}

async fn bond_show(
    config: &Config,
    signer_arg: &str,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;

    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );
    let bond_pubkey = Pubkey::from_bytes(&bond_bytes);

    let client = create_rpc_client(config)?;
    let account = client
        .get_account_info(&bond_pubkey, None, None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get bond account: {}", e)))?
        .ok_or_else(|| CliError::Validation(format!("Bond account {} not found", bond_pubkey)))?;

    let data = decode_account_data(&account, "bond")?;
    let BondAccount {
        signer,
        authority,
        wthru_ta,
        active_bond,
        staged_amount,
        unlock_slot,
        last_change_slot,
    } = parse_bond_account(&data).map_err(|e| {
        CliError::Validation(format!(
            "Account {} is not a valid bond account: {}",
            bond_pubkey, e
        ))
    })?;

    if json_format {
        let response = json!({
            "bond_show": {
                "status": "success",
                "bond_address": bond_pubkey.to_string(),
                "signer": Pubkey::from_bytes(&signer).to_string(),
                "bond_authority": Pubkey::from_bytes(&authority).to_string(),
                "wthru_token_account": Pubkey::from_bytes(&wthru_ta).to_string(),
                "derived_token_account": Pubkey::from_bytes(&bond_ta_bytes).to_string(),
                "active_bond": active_bond,
                "staged_amount": staged_amount,
                "unlock_slot": unlock_slot,
                "last_change_slot": last_change_slot,
            }
        });
        output::print_output(response, true);
    } else {
        println!("Bond account: {}", bond_pubkey);
        println!("  signer:            {}", Pubkey::from_bytes(&signer));
        println!("  bond_authority:    {}", Pubkey::from_bytes(&authority));
        println!("  wthru_token_acct:  {}", Pubkey::from_bytes(&wthru_ta));
        println!("  active_bond:       {}", active_bond);
        println!("  staged_amount:     {}", staged_amount);
        println!("  unlock_slot:       {}", unlock_slot);
        println!("  last_change_slot:  {}", last_change_slot);
    }
    Ok(())
}

async fn bond_derive_address(
    config: &Config,
    signer_arg: &str,
    program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let bond_bytes = bp_bond_account_address(&bp_program_bytes, &signer_bytes);
    let bond_pubkey = Pubkey::from_bytes(&bond_bytes);

    if json_format {
        let response = json!({
            "bond_derive_address": {
                "status": "success",
                "signer": Pubkey::from_bytes(&signer_bytes).to_string(),
                "bond_address": bond_pubkey.to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        println!("{}", bond_pubkey);
    }
    Ok(())
}

async fn bond_derive_token_account(
    config: &Config,
    signer_arg: &str,
    mint_override: Option<&str>,
    program_override: Option<&str>,
    token_program_override: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let bp_program_bytes = resolve_bp_program_bytes(config, program_override)?;
    let token_program_bytes = resolve_token_program_bytes(config, token_program_override)?;
    let mint_bytes = resolve_mint_bytes(config, mint_override, &token_program_bytes)?;
    let signer_bytes = resolve_pubkey_arg(config, signer_arg)?;
    let bond_ta_bytes = bp_bond_ta_address(
        &token_program_bytes,
        &bp_program_bytes,
        &mint_bytes,
        &signer_bytes,
    );
    let bond_ta_pubkey = Pubkey::from_bytes(&bond_ta_bytes);

    if json_format {
        let response = json!({
            "bond_derive_token_account": {
                "status": "success",
                "signer": Pubkey::from_bytes(&signer_bytes).to_string(),
                "token_account_address": bond_ta_pubkey.to_string(),
            }
        });
        output::print_output(response, true);
    } else {
        println!("{}", bond_ta_pubkey);
    }
    Ok(())
}

/* ---------------------------------------------------------------------- */
/* Shared helpers                                                          */
/* ---------------------------------------------------------------------- */

/// Load the independent EOA signer from an alias or direct signing source.
fn resolve_signer_keypair(config: &Config, name: &str) -> Result<Arc<LoadedKey>, CliError> {
    config.keys.load_key(name)
}

/// Resolve public metadata, a public address, or an explicit source.
fn resolve_pubkey_arg(config: &Config, arg: &str) -> Result<[u8; 32], CliError> {
    config.keys.resolve_public_key(arg)
}

fn resolve_bp_program_bytes(
    config: &Config,
    override_addr: Option<&str>,
) -> Result<[u8; 32], CliError> {
    if let Some(addr) = override_addr {
        return validate_address_or_hex(addr);
    }
    config
        .get_bp_program_pubkey()?
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode BP program pubkey: {}", e)))
}

fn resolve_token_program_bytes(
    config: &Config,
    override_addr: Option<&str>,
) -> Result<[u8; 32], CliError> {
    if let Some(addr) = override_addr {
        return validate_address_or_hex(addr);
    }
    config
        .get_token_program_pubkey()?
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode token program pubkey: {}", e)))
}

fn resolve_attestor_table_bytes(
    config: &Config,
    override_addr: Option<&str>,
) -> Result<[u8; 32], CliError> {
    if let Some(addr) = override_addr {
        return validate_address_or_hex(addr);
    }
    config
        .get_consensus_attestor_table_pubkey()?
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode attestor table pubkey: {}", e)))
}

/// Resolve the bond token-account mint: an explicit override, or the canonical
/// WTHRU mint derived from the configured WTHRU program + token program (same
/// derivation `thru wthru` uses).
fn resolve_mint_bytes(
    config: &Config,
    override_addr: Option<&str>,
    token_program_bytes: &[u8; 32],
) -> Result<[u8; 32], CliError> {
    if let Some(addr) = override_addr {
        return validate_address_or_hex(addr);
    }
    let wthru_program_bytes = config
        .get_wthru_program_pubkey()?
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to decode WTHRU program pubkey: {}", e)))?;

    let mut mint_seed = [0u8; 32];
    mint_seed[..5].copy_from_slice(b"wthru");
    let mut hasher = Sha256::new();
    hasher.update(wthru_program_bytes);
    hasher.update(mint_seed);
    let hash = hasher.finalize();
    let mut inner_seed = [0u8; 32];
    inner_seed.copy_from_slice(&hash[..32]);
    Ok(create_program_defined_account_address(
        token_program_bytes,
        false,
        &inner_seed,
    ))
}

fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);
    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.rpc_auth_token())
        .build()
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to create RPC client: {}", e)))
}

async fn fetch_nonce_and_balance(
    client: &Client,
    keypair: &LoadedKey,
) -> Result<(u64, u64), CliError> {
    let account_info = client
        .get_account_info(&keypair.address_string, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get account info: {}", e))
        })?;
    match account_info {
        Some(account) => Ok((account.nonce, account.balance)),
        None => Err(CliError::AccountNotFound(format!(
            "Account {} not found",
            keypair.address_string
        ))),
    }
}

async fn fetch_finalized_height(client: &Client) -> Result<u64, CliError> {
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;
    Ok(block_height.finalized_height)
}

async fn fetch_chain_id(client: &Client) -> Result<u16, CliError> {
    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;
    Ok(chain_info.chain_id)
}

async fn sign_and_submit(
    client: &Client,
    transaction: Transaction,
    chain_id: u16,
    fee_payer_keypair: &LoadedKey,
    json_format: bool,
) -> Result<String, CliError> {
    let mut transaction = transaction.with_chain_id(chain_id);
    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to sign transaction: {}", e))
        })?;

    let details = submit_transaction(client, &transaction).await?;
    check_transaction_result(&details, json_format)?;
    Ok(details.signature.as_str().to_string())
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

/// Reject creation when `account` already holds committed on-chain state.
///
/// `is_new` mirrors `TN_ACCOUNT_FLAG_NEW`, which the runtime sets on an
/// account's CREATION state proof (the address has no committed state yet) and
/// clears on the EXISTING proof (`tn_runtime.c`). So an account with real
/// committed data always reads back `is_new == false`:
///   - `None` / `Some(_)` + `is_new`  => empty slot, safe to create over;
///   - `Some(_)` + `!is_new`          => a real account, reject as "already exists".
///
/// This is a best-effort pre-flight check: an unfinalized creation racing in a
/// concurrent block isn't visible here, but the on-chain create then fails, so
/// the "already exists" invariant is still enforced authoritatively on-chain.
async fn ensure_account_absent(
    client: &Client,
    account: &Pubkey,
    label: &str,
) -> Result<(), CliError> {
    if let Some(existing) = client
        .get_account_info(account, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get {} account info: {}", label, e))
        })?
    {
        if !existing.is_new {
            return Err(CliError::Validation(format!(
                "{} account {} already exists",
                label, account
            )));
        }
    }
    Ok(())
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

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let bytes: [u8; 8] = data[offset..offset + 8].try_into().unwrap();
    u64::from_le_bytes(bytes)
}

fn read_pubkey(data: &[u8], offset: usize) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[offset..offset + 32]);
    out
}

fn print_simple_result(
    key: &str,
    signature: &str,
    extra: serde_json::Value,
    text: &str,
    json_format: bool,
) {
    if json_format {
        let mut obj = serde_json::Map::new();
        obj.insert("status".to_string(), json!("success"));
        obj.insert("signature".to_string(), json!(signature));
        if let serde_json::Value::Object(map) = extra {
            for (k, v) in map {
                obj.insert(k, v);
            }
        }
        let response = json!({ key: serde_json::Value::Object(obj) });
        output::print_output(response, true);
    } else {
        println!("{}", text);
        println!("Transaction signature: {}", signature);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::KeyManager;

    #[test]
    fn independent_eoa_signer_and_fee_payer_accept_unregistered_files() {
        let (_guard, keys) = KeyManager::test_fixture(&[("signer", [1; 32]), ("payer", [2; 32])]);
        let signer_reference = keys.get_entry("signer").unwrap().reference();
        let payer_reference = keys.get_entry("payer").unwrap().reference();
        let config = Config::default();
        let signer = resolve_signer_keypair(&config, &signer_reference).unwrap();
        let payer = config.keys.load_fee_payer(Some(&payer_reference)).unwrap();
        assert_eq!(signer.public_key, keys.public_key("signer").unwrap());
        assert_eq!(payer.public_key, keys.public_key("payer").unwrap());
        assert_ne!(signer.public_key, payer.public_key);
    }

    #[test]
    fn public_alias_resolution_does_not_open_signing_source() {
        let (_guard, keys) = KeyManager::test_fixture(&[("signer", [1; 32])]);
        let expected = keys.public_key("signer").unwrap();
        let crate::keys::KeySource::File { path, .. } = &keys.get_entry("signer").unwrap().source
        else {
            panic!("fixture must use file storage");
        };
        std::fs::remove_file(path).unwrap();
        let config = Config {
            keys,
            ..Config::default()
        };
        assert_eq!(resolve_pubkey_arg(&config, "signer").unwrap(), expected);
        assert!(resolve_signer_keypair(&config, "signer").is_err());
    }

    fn bond_fixture() -> Vec<u8> {
        let mut data = vec![0u8; BOND_ACCOUNT_SIZE];
        data[0] = BOND_ACCOUNT_TYPE_V1;
        data[1..33].fill(0x11);
        data[33..65].fill(0x22);
        data[65..97].fill(0x33);
        data[97..105].copy_from_slice(&500u64.to_le_bytes());
        data[105..113].copy_from_slice(&7u64.to_le_bytes());
        data[113..121].copy_from_slice(&99u64.to_le_bytes());
        data[121..129].copy_from_slice(&42u64.to_le_bytes());
        data
    }

    #[test]
    fn bond_account_decodes_packed_v1_layout() {
        let bond = parse_bond_account(&bond_fixture()).unwrap();
        assert_eq!(bond.signer, [0x11; 32]);
        assert_eq!(bond.authority, [0x22; 32]);
        assert_eq!(bond.wthru_ta, [0x33; 32]);
        assert_eq!(bond.active_bond, 500);
        assert_eq!(bond.staged_amount, 7);
        assert_eq!(bond.unlock_slot, 99);
        assert_eq!(bond.last_change_slot, 42);
    }

    #[test]
    fn bond_account_rejects_wrong_type_and_size() {
        let mut data = bond_fixture();
        data[0] = 0;
        assert!(parse_bond_account(&data).is_err());
        data[0] = 2;
        assert!(parse_bond_account(&data).is_err());
        let mut data = bond_fixture();
        data.push(0);
        assert!(parse_bond_account(&data).is_err());
        assert!(parse_bond_account(&bond_fixture()[..128]).is_err());
    }
}
