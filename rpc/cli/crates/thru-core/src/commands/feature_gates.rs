//! Feature gate / chain param command implementations.
//!
//! The CLI joins two sources of truth: registry TOML for names/types/metadata and
//! the live global account for current/armed values. Read commands display both;
//! write commands use the registry to validate user input before encoding the
//! feature-gate program ABI.

use crate::cli::{FeatureGateAdminRole, FeatureGateListKind, FeatureGatesCommands};
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::feature_gate_account::{
    DecodedFeatureGateAccount, DecodedFeatureGateEntry, FEATURE_GATE_ARMED_SLOT_SENTINEL,
    FEATURE_GATE_VALUE_SIZE, decode_feature_gate_account, feature_gate_global_account_pubkey,
    feature_gate_program_pubkey,
};
use crate::feature_gate_registry::{
    FeatureGateRegistry, FeatureGateRegistryCategory, FeatureGateRegistryEntry,
    FeatureGateRegistryKind, FeatureGateRegistryStatus, FeatureGateRegistryType,
    load_feature_gate_registry,
};
use crate::output;
use crate::utils::{format_vm_error, validate_address_or_hex};
use base64::Engine;
use serde_json::{Value, json};
use std::path::Path;
use std::time::Duration;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_client::{
    Account as ChainAccount, Client, ClientBuilder, TransactionDetails, VersionContext,
};

// Instruction and role values mirror programs/c/examples/tn_feature_gate_program.h.
const FEATURE_GATE_INSTR_CREATE_GATE: u32 = 0;
const FEATURE_GATE_INSTR_ARM: u32 = 1;
const FEATURE_GATE_INSTR_DISARM: u32 = 2;
const FEATURE_GATE_INSTR_UPDATE_TIMING_KNOBS: u32 = 3;
const FEATURE_GATE_INSTR_PROPOSE_ADMIN: u32 = 4;
const FEATURE_GATE_INSTR_ACCEPT_ADMIN: u32 = 5;

const FEATURE_GATE_ROLE_CREATION: u8 = 0;
const FEATURE_GATE_ROLE_MANAGEMENT: u8 = 1;
const FEATURE_GATE_ROLE_CONFIG: u8 = 2;

// Keep resource settings local to this command until the transaction builder has
// a shared feature-gate helper.
const FEATURE_GATE_TX_FEE: u64 = 1;
const FEATURE_GATE_TX_EXPIRY_AFTER: u32 = 100;
const FEATURE_GATE_TX_COMPUTE_UNITS: u32 = 100_000;
const FEATURE_GATE_TX_STATE_UNITS: u16 = 10_000;
const FEATURE_GATE_TX_MEMORY_UNITS: u16 = 10_000;

// Fee payer and program are transaction header accounts. The global account is
// the only extra writable account the CLI needs today, while the fee payer signs
// as the admin authority at account index 0.
const FEATURE_GATE_GLOBAL_ACCOUNT_IDX: u16 = 2;
const FEATURE_GATE_AUTHORITY_ACCOUNT_IDX: u16 = 0;

/// Handle feature gate / chain param subcommands.
pub async fn handle_feature_gates_command(
    config: &Config,
    registry_path: Option<&Path>,
    subcommand: FeatureGatesCommands,
    json_format: bool,
) -> Result<(), CliError> {
    let client = create_rpc_client(config)?;

    match subcommand {
        FeatureGatesCommands::List { kind } => {
            let (registry, live_account) =
                load_registry_and_live_account(&client, registry_path).await?;
            validate_registry_account_alignment(&registry, &live_account)?;
            list_registry_entries(&registry, &live_account, kind, json_format)
        }
        FeatureGatesCommands::Show { target } => {
            let (registry, live_account) =
                load_registry_and_live_account(&client, registry_path).await?;
            validate_registry_account_alignment(&registry, &live_account)?;
            show_registry_entry(&registry, &live_account, &target, json_format)
        }
        // create-entry is allowed when the registry is exactly one entry ahead
        // of the on-chain table, so it uses a custom append-only check instead
        // of the read-path equality check.
        FeatureGatesCommands::CreateEntry {
            target,
            value,
            next_change_lead_slots,
            fee_payer,
        } => {
            let (registry, live_account) =
                load_registry_and_live_account(&client, registry_path).await?;
            create_entry(
                config,
                &client,
                &registry,
                &live_account,
                &target,
                &value,
                next_change_lead_slots,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FeatureGatesCommands::Arm {
            target,
            value,
            slot,
            fee_payer,
        } => {
            let (registry, live_account) =
                load_registry_and_live_account(&client, registry_path).await?;
            validate_registry_account_alignment(&registry, &live_account)?;
            arm_entry(
                config,
                &client,
                &registry,
                &live_account,
                &target,
                &value,
                slot,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FeatureGatesCommands::Disarm { target, fee_payer } => {
            let (registry, live_account) =
                load_registry_and_live_account(&client, registry_path).await?;
            validate_registry_account_alignment(&registry, &live_account)?;
            disarm_entry(
                config,
                &client,
                &registry,
                &live_account,
                &target,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FeatureGatesCommands::UpdateTimingKnobs {
            min_arming_lead_slots,
            min_gap_between_armings_slots,
            min_dwell_slots,
            no_disarm_window_slots,
            fee_payer,
        } => {
            update_timing_knobs(
                config,
                &client,
                min_arming_lead_slots,
                min_gap_between_armings_slots,
                min_dwell_slots,
                no_disarm_window_slots,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FeatureGatesCommands::ProposeAdmin {
            role,
            new_admin,
            fee_payer,
        } => {
            propose_admin(
                config,
                &client,
                role,
                &new_admin,
                fee_payer.as_deref(),
                json_format,
            )
            .await
        }
        FeatureGatesCommands::AcceptAdmin { role, fee_payer } => {
            accept_admin(config, &client, role, fee_payer.as_deref(), json_format).await
        }
    }
}

fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .announce_pending_signature(config.announce_pending_signature)
        .build()
        .map_err(CliError::from)
}

async fn load_registry_and_live_account(
    client: &Client,
    registry_path: Option<&Path>,
) -> Result<(FeatureGateRegistry, DecodedFeatureGateAccount), CliError> {
    let registry = load_feature_gate_registry(registry_path)?;
    let account = fetch_global_feature_gate_account(client).await?;
    let live_account = decode_live_feature_gate_account(&account)?;
    Ok((registry, live_account))
}

async fn fetch_global_feature_gate_account(client: &Client) -> Result<ChainAccount, CliError> {
    let global_pubkey = feature_gate_global_account_pubkey();
    let account = client
        .get_account_info(&global_pubkey, None, Some(VersionContext::Current))
        .await?
        .ok_or_else(|| {
            CliError::AccountNotFound(format!("global feature-gate account {}", global_pubkey))
        })?;

    // Owner validation prevents decoding an arbitrary account as feature-gate state.
    ensure_global_account_owner(&account, &feature_gate_program_pubkey())?;
    if account.data.is_none() {
        return Err(CliError::Validation(format!(
            "global feature-gate account {} has no account data",
            global_pubkey
        )));
    }

    Ok(account)
}

fn ensure_global_account_owner(
    account: &ChainAccount,
    expected_owner: &Pubkey,
) -> Result<(), CliError> {
    let actual_owner = account.owner.to_bytes().map_err(|err| {
        CliError::Crypto(format!(
            "failed to decode global feature-gate account owner: {}",
            err
        ))
    })?;
    let expected_owner = expected_owner.to_bytes().map_err(|err| {
        CliError::Crypto(format!(
            "failed to decode feature-gate program owner: {}",
            err
        ))
    })?;

    if actual_owner != expected_owner {
        return Err(CliError::Validation(format!(
            "global feature-gate account owner {} does not match expected feature-gate program {}",
            account.owner,
            Pubkey::from_bytes(&expected_owner)
        )));
    }

    Ok(())
}

fn decode_live_feature_gate_account(
    account: &ChainAccount,
) -> Result<DecodedFeatureGateAccount, CliError> {
    let encoded = account.data.as_ref().ok_or_else(|| {
        CliError::Validation("global feature-gate account data is not available".to_string())
    })?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| {
            CliError::Validation(format!(
                "failed to decode global feature-gate account data: {}",
                err
            ))
        })?;

    decode_feature_gate_account(&data)
}

// Read/update operations expect every registry entry to already exist on chain.
// create-entry handles the one permitted mismatch separately.
fn validate_registry_account_alignment(
    registry: &FeatureGateRegistry,
    account: &DecodedFeatureGateAccount,
) -> Result<(), CliError> {
    if registry.entries().len() != account.entries.len() {
        return Err(CliError::Validation(format!(
            "feature gate registry/account entry count mismatch: registry has {}, account has {}",
            registry.entries().len(),
            account.entries.len()
        )));
    }
    Ok(())
}

async fn create_entry(
    config: &Config,
    client: &Client,
    registry: &FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    target: &str,
    value: &str,
    next_change_lead_slots: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let entry = find_registry_entry(registry, target)?;
    // The program appends exactly one entry; the CLI enforces that the selected
    // registry row is the next append-only index.
    let expected_index = live_account.entries.len() as u32;
    if entry.index != expected_index {
        return Err(CliError::Validation(format!(
            "create-entry can only append registry index {}; target '{}' is index {}",
            expected_index, entry.name, entry.index
        )));
    }
    if entry.kind == FeatureGateRegistryKind::FeatureGate
        && entry.status != Some(FeatureGateRegistryStatus::Reserved)
    {
        return Err(CliError::Validation(format!(
            "feature gate '{}' must have registry status 'reserved' before create-entry",
            entry.name
        )));
    }
    if next_change_lead_slots == FEATURE_GATE_ARMED_SLOT_SENTINEL {
        return Err(CliError::Validation(
            "next-change lead slots cannot use the armed-slot sentinel".to_string(),
        ));
    }

    let initial_value = encode_registry_value(entry, value)?;
    let instruction = encode_create_gate_instruction(&initial_value, next_change_lead_slots);
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "create-entry",
        json!({
            "target": entry.name,
            "index": entry.index,
            "initial_value": value,
            "next_change_lead_slots": next_change_lead_slots,
        }),
        details,
        json_format,
    )
}

async fn arm_entry(
    config: &Config,
    client: &Client,
    registry: &FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    target: &str,
    value: &str,
    slot: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let entry = find_registry_entry(registry, target)?;
    if slot == FEATURE_GATE_ARMED_SLOT_SENTINEL {
        return Err(CliError::Validation(
            "activation slot cannot use the armed-slot sentinel".to_string(),
        ));
    }
    let live_entry = live_entry(live_account, entry)?;
    let armed_value = encode_registry_value(entry, value)?;
    if armed_value == live_entry.current_value {
        return Err(CliError::Validation(format!(
            "armed value for '{}' matches current value",
            entry.name
        )));
    }
    // This is a live snapshot preflight; the on-chain program remains the final
    // authority if another transaction changes the armed value before submit.
    if live_entry.transition_slot.is_some() && armed_value == live_entry.armed_value {
        return Err(CliError::Validation(format!(
            "feature gate '{}' is already armed to this value",
            entry.name
        )));
    }

    let instruction = encode_arm_instruction(entry.index, slot, &armed_value);
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "arm",
        json!({
            "target": entry.name,
            "index": entry.index,
            "armed_value": value,
            "activation_slot": slot,
        }),
        details,
        json_format,
    )
}

async fn disarm_entry(
    config: &Config,
    client: &Client,
    registry: &FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    target: &str,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let entry = validate_disarm_target(registry, live_account, target)?;
    let instruction = encode_disarm_instruction(entry.index);
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "disarm",
        json!({
            "target": entry.name,
            "index": entry.index,
        }),
        details,
        json_format,
    )
}

async fn update_timing_knobs(
    config: &Config,
    client: &Client,
    min_arming_lead_slots: u64,
    min_gap_between_armings_slots: u64,
    min_dwell_slots: u64,
    no_disarm_window_slots: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let instruction = encode_update_timing_knobs_instruction(
        min_arming_lead_slots,
        min_gap_between_armings_slots,
        min_dwell_slots,
        no_disarm_window_slots,
    );
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "update-timing-knobs",
        json!({
            "min_arming_lead_slots": min_arming_lead_slots,
            "min_gap_between_armings_slots": min_gap_between_armings_slots,
            "min_dwell_slots": min_dwell_slots,
            "no_disarm_window_slots": no_disarm_window_slots,
        }),
        details,
        json_format,
    )
}

async fn propose_admin(
    config: &Config,
    client: &Client,
    role: FeatureGateAdminRole,
    new_admin: &str,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let new_admin_pubkey = validate_address_or_hex(new_admin)?;
    let instruction = encode_propose_admin_instruction(role_discriminant(role), &new_admin_pubkey);
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "propose-admin",
        json!({
            "role": role_label(role),
            "new_admin": Pubkey::from_bytes(&new_admin_pubkey).to_string(),
        }),
        details,
        json_format,
    )
}

async fn accept_admin(
    config: &Config,
    client: &Client,
    role: FeatureGateAdminRole,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let instruction = encode_accept_admin_instruction(role_discriminant(role));
    let details = submit_feature_gate_instruction(config, client, instruction, fee_payer).await?;
    print_write_result(
        "accept-admin",
        json!({
            "role": role_label(role),
        }),
        details,
        json_format,
    )
}

async fn submit_feature_gate_instruction(
    config: &Config,
    client: &Client,
    instruction: Vec<u8>,
    fee_payer: Option<&str>,
) -> Result<TransactionDetails, CliError> {
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let fee_payer_account = client
        .get_account_info(
            &fee_payer_keypair.address_string,
            None,
            Some(VersionContext::Current),
        )
        .await?
        .ok_or_else(|| {
            CliError::AccountNotFound(format!(
                "fee payer account {}",
                fee_payer_keypair.address_string
            ))
        })?;
    let block_height = client.get_block_height().await.map_err(|err| {
        CliError::TransactionSubmission(format!("Failed to get current slot: {}", err))
    })?;
    let chain_info = client.get_chain_info().await.map_err(|err| {
        CliError::TransactionSubmission(format!("Failed to get chain info: {}", err))
    })?;

    let mut transaction = build_feature_gate_transaction(
        fee_payer_keypair.public_key,
        fee_payer_account.nonce,
        block_height.finalized_height,
        chain_info.chain_id,
        instruction,
    )?;

    transaction
        .sign(&fee_payer_keypair.private_key)
        .map_err(|err| {
            CliError::TransactionSubmission(format!(
                "Failed to sign feature-gate transaction: {}",
                err
            ))
        })?;

    let timeout = Duration::from_secs(config.timeout_seconds);
    let details = client
        .execute_transaction(&transaction.to_wire(), timeout)
        .await
        .map_err(|err| {
            CliError::TransactionSubmission(format!(
                "Failed to submit feature-gate transaction: {}",
                err
            ))
        })?;
    check_transaction_result(&details)?;
    Ok(details)
}

// Account indices are encoded in the instruction data so the program does not
// depend on sorted transaction account insertion order. The CLI's single-signer
// flow uses the fee payer as the admin authority at account index 0.
fn build_feature_gate_transaction(
    fee_payer_pubkey: [u8; 32],
    nonce: u64,
    start_slot: u64,
    chain_id: u16,
    instruction: Vec<u8>,
) -> Result<Transaction, CliError> {
    let program_pubkey = feature_gate_program_pubkey().to_bytes().map_err(|err| {
        CliError::Crypto(format!(
            "failed to decode feature-gate program pubkey: {}",
            err
        ))
    })?;
    let global_pubkey = feature_gate_global_account_pubkey()
        .to_bytes()
        .map_err(|err| {
            CliError::Crypto(format!(
                "failed to decode global feature-gate account pubkey: {}",
                err
            ))
        })?;

    Ok(
        Transaction::new(fee_payer_pubkey, program_pubkey, FEATURE_GATE_TX_FEE, nonce)
            .with_start_slot(start_slot)
            .with_chain_id(chain_id)
            .with_expiry_after(FEATURE_GATE_TX_EXPIRY_AFTER)
            .with_compute_units(FEATURE_GATE_TX_COMPUTE_UNITS)
            .with_state_units(FEATURE_GATE_TX_STATE_UNITS)
            .with_memory_units(FEATURE_GATE_TX_MEMORY_UNITS)
            .add_rw_account(global_pubkey)
            .with_instructions(instruction),
    )
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
    crypto::keypair_from_hex(key_hex)
}

fn check_transaction_result(details: &TransactionDetails) -> Result<(), CliError> {
    if details.execution_result != 0 || details.vm_error != 0 {
        let vm_error_label = format_vm_error(details.vm_error);
        let vm_error_display = if details.vm_error != 0 {
            format!("{} ({})", details.vm_error, vm_error_label)
        } else {
            "0".to_string()
        };
        let user_error_label = if details.user_error_code != 0 {
            format!("0x{:X}", details.user_error_code)
        } else {
            "0x0".to_string()
        };
        let message = format!(
            "Feature-gate transaction failed (execution_result={} (hex 0x{:X}), vm_error={}, user_error={})",
            details.execution_result as i64,
            details.execution_result as u64,
            vm_error_display,
            user_error_label
        );

        return Err(CliError::TransactionFailed {
            message,
            execution_result: details.execution_result as u64,
            vm_error: details.vm_error,
            vm_error_label,
            user_error_code: details.user_error_code,
            user_error_label,
            signature: details.signature.as_str().to_string(),
        });
    }
    Ok(())
}

fn print_write_result(
    operation: &str,
    request: Value,
    details: TransactionDetails,
    json_format: bool,
) -> Result<(), CliError> {
    let signature = details.signature.as_str().to_string();
    if json_format {
        output::print_output(
            json!({
                "feature_gate": {
                    "operation": operation,
                    "status": "submitted",
                    "signature": signature,
                    "request": request,
                }
            }),
            true,
        );
    } else {
        println!(
            "Feature-gate {} submitted. Transaction signature: {}",
            operation, signature
        );
    }
    Ok(())
}

// Convert human input into the fixed-width 64-byte value stored in each account
// entry. The registry type controls how the low bytes are interpreted.
fn encode_registry_value(
    entry: &FeatureGateRegistryEntry,
    value: &str,
) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    match entry.kind {
        FeatureGateRegistryKind::FeatureGate => encode_feature_gate_value(value),
        FeatureGateRegistryKind::ChainParam => match &entry.value_type {
            Some(value_type) => encode_unsigned_registry_value(value_type, value, &entry.name),
            None => Err(CliError::Validation(format!(
                "chain param '{}' is missing a registry type",
                entry.name
            ))),
        },
    }
}

fn encode_feature_gate_value(value: &str) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    let mut encoded = [0u8; FEATURE_GATE_VALUE_SIZE];
    encoded[0] = match value {
        "inactive" | "off" | "false" | "0" => 0,
        "active" | "on" | "true" | "1" => 1,
        _ => {
            return Err(CliError::Validation(
                "feature-gate value must be active/inactive".to_string(),
            ));
        }
    };
    Ok(encoded)
}

fn encode_unsigned_registry_value(
    value_type: &FeatureGateRegistryType,
    value: &str,
    name: &str,
) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    let width = value_type.width_bytes();
    if width <= 16 {
        return encode_decimal_registry_value(width, value, name);
    }
    encode_hex_registry_value(width, value, name)
}

fn encode_decimal_registry_value(
    width: usize,
    value: &str,
    name: &str,
) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    let parsed = value.parse::<u128>().map_err(|err| {
        CliError::Validation(format!(
            "chain-param '{}' value must be an unsigned decimal integer: {}",
            name, err
        ))
    })?;
    if width < 16 {
        let max = (1u128 << (width * 8)) - 1;
        if parsed > max {
            return Err(CliError::Validation(format!(
                "chain-param '{}' value exceeds u{}",
                name,
                width * 8
            )));
        }
    }

    let mut encoded = [0u8; FEATURE_GATE_VALUE_SIZE];
    for (i, byte) in encoded.iter_mut().take(width).enumerate() {
        *byte = ((parsed >> (i * 8)) & 0xff) as u8;
    }
    Ok(encoded)
}

fn encode_hex_registry_value(
    width: usize,
    value: &str,
    name: &str,
) -> Result<[u8; FEATURE_GATE_VALUE_SIZE], CliError> {
    let hex_value = value.strip_prefix("0x").ok_or_else(|| {
        CliError::Validation(format!(
            "chain-param '{}' value must be 0x-prefixed hex for u{}",
            name,
            width * 8
        ))
    })?;
    if hex_value.is_empty() {
        return Err(CliError::Validation(format!(
            "chain-param '{}' hex value must not be empty",
            name
        )));
    }
    if hex_value.len() > width * 2 {
        return Err(CliError::Validation(format!(
            "chain-param '{}' value exceeds u{}",
            name,
            width * 8
        )));
    }

    let padded;
    let hex_value = if hex_value.len() % 2 == 0 {
        hex_value
    } else {
        padded = format!("0{}", hex_value);
        padded.as_str()
    };
    let decoded = hex::decode(hex_value).map_err(|err| {
        CliError::Validation(format!(
            "chain-param '{}' value is invalid hex: {}",
            name, err
        ))
    })?;

    let mut encoded = [0u8; FEATURE_GATE_VALUE_SIZE];
    for (i, byte) in decoded.iter().rev().enumerate() {
        encoded[i] = *byte;
    }
    Ok(encoded)
}

// The following encoders intentionally build byte vectors by hand so the CLI ABI
// stays visibly aligned with the packed C structs and static offset asserts.
fn append_instruction_account_indices(instruction: &mut Vec<u8>) {
    instruction.extend_from_slice(&FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes());
    instruction.extend_from_slice(&FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes());
}

fn encode_create_gate_instruction(
    initial_value: &[u8; FEATURE_GATE_VALUE_SIZE],
    next_change_lead_slots: u64,
) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(80);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_CREATE_GATE.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.extend_from_slice(initial_value);
    instruction.extend_from_slice(&next_change_lead_slots.to_le_bytes());
    instruction
}

fn encode_arm_instruction(
    index: u32,
    target_slot: u64,
    armed_value: &[u8; FEATURE_GATE_VALUE_SIZE],
) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(84);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_ARM.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.extend_from_slice(&target_slot.to_le_bytes());
    instruction.extend_from_slice(&index.to_le_bytes());
    instruction.extend_from_slice(armed_value);
    instruction
}

fn encode_disarm_instruction(index: u32) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(12);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_DISARM.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.extend_from_slice(&index.to_le_bytes());
    instruction
}

fn encode_update_timing_knobs_instruction(
    min_arming_lead_slots: u64,
    min_gap_between_armings_slots: u64,
    min_dwell_slots: u64,
    no_disarm_window_slots: u64,
) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(40);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_UPDATE_TIMING_KNOBS.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.extend_from_slice(&min_arming_lead_slots.to_le_bytes());
    instruction.extend_from_slice(&min_gap_between_armings_slots.to_le_bytes());
    instruction.extend_from_slice(&min_dwell_slots.to_le_bytes());
    instruction.extend_from_slice(&no_disarm_window_slots.to_le_bytes());
    instruction
}

fn encode_propose_admin_instruction(role: u8, new_admin_pubkey: &[u8; 32]) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(44);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_PROPOSE_ADMIN.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.push(role);
    instruction.extend_from_slice(&[0u8; 3]);
    instruction.extend_from_slice(new_admin_pubkey);
    instruction
}

fn encode_accept_admin_instruction(role: u8) -> Vec<u8> {
    let mut instruction = Vec::with_capacity(12);
    instruction.extend_from_slice(&FEATURE_GATE_INSTR_ACCEPT_ADMIN.to_le_bytes());
    append_instruction_account_indices(&mut instruction);
    instruction.push(role);
    instruction.extend_from_slice(&[0u8; 3]);
    instruction
}

fn role_discriminant(role: FeatureGateAdminRole) -> u8 {
    match role {
        FeatureGateAdminRole::Creation => FEATURE_GATE_ROLE_CREATION,
        FeatureGateAdminRole::Management => FEATURE_GATE_ROLE_MANAGEMENT,
        FeatureGateAdminRole::Config => FEATURE_GATE_ROLE_CONFIG,
    }
}

fn role_label(role: FeatureGateAdminRole) -> &'static str {
    match role {
        FeatureGateAdminRole::Creation => "creation",
        FeatureGateAdminRole::Management => "management",
        FeatureGateAdminRole::Config => "config",
    }
}

fn list_registry_entries(
    registry: &FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    kind_filter: FeatureGateListKind,
    json_format: bool,
) -> Result<(), CliError> {
    let entries: Vec<&FeatureGateRegistryEntry> = registry
        .entries()
        .iter()
        .filter(|entry| kind_matches(entry, kind_filter))
        .collect();

    if json_format {
        output::print_output(
            json!({
                "feature_gates": {
                    "entries": entries
                        .iter()
                        .map(|entry| {
                            live_entry(live_account, entry).map(|live| entry_json(entry, live))
                        })
                        .collect::<Result<Vec<_>, CliError>>()?,
                    "account": account_json(live_account),
                }
            }),
            true,
        );
    } else {
        println!("Feature Gates / Chain Params");
        println!(
            "{:<6} {:<34} {:<14} {:<18} {:<18} {:<12} {}",
            "Index", "Name", "Kind", "Current", "Armed", "Activation", "Last Change"
        );
        for entry in entries {
            let live = live_entry(live_account, entry)?;
            println!(
                "{:<6} {:<34} {:<14} {:<18} {:<18} {:<12} {}",
                entry.index,
                entry.name,
                kind_label(&entry.kind),
                value_label(entry, &live.current_value),
                value_label(entry, &live.armed_value),
                slot_text(live.transition_slot, "not armed"),
                slot_text(live.last_change_slot, "never"),
            );
        }
    }

    Ok(())
}

fn show_registry_entry(
    registry: &FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    target: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let entry = find_registry_entry(registry, target)?;
    let live_entry = live_entry(live_account, entry)?;

    if json_format {
        output::print_output(
            json!({
                "feature_gate": entry_json(entry, live_entry),
                "account": account_json(live_account),
            }),
            true,
        );
    } else {
        println!("Feature Gate / Chain Param");
        println!("  Index:       {}", entry.index);
        println!("  Name:        {}", entry.name);
        println!("  Kind:        {}", kind_label(&entry.kind));
        println!("  Description: {}", entry.description);
        if let Some(status) = &entry.status {
            println!("  Status:      {}", status_label(status));
        }
        if let Some(category) = &entry.category {
            println!("  Category:    {}", category_label(category));
        }
        if let Some(value_type) = &entry.value_type {
            println!("  Type:        {}", type_label(value_type));
        }
        println!(
            "  Current:     {}",
            value_label(entry, &live_entry.current_value)
        );
        println!(
            "  Armed:       {}",
            value_label(entry, &live_entry.armed_value)
        );
        println!(
            "  Activation:  {}",
            slot_text(live_entry.transition_slot, "not armed")
        );
        println!(
            "  Last Change: {}",
            slot_text(live_entry.last_change_slot, "never")
        );
        println!("  Lead Slots:  {}", live_entry.next_change_lead_slots);
        println!("  Tracking:    {}", entry.tracking);
    }

    Ok(())
}

fn find_registry_entry<'a>(
    registry: &'a FeatureGateRegistry,
    target: &str,
) -> Result<&'a FeatureGateRegistryEntry, CliError> {
    if let Ok(index) = target.parse::<u32>() {
        return registry.get_by_index(index).ok_or_else(|| {
            CliError::Validation(format!("feature gate registry index {} not found", index))
        });
    }

    registry.get_by_name(target).ok_or_else(|| {
        CliError::Validation(format!(
            "feature gate registry entry '{}' not found",
            target
        ))
    })
}

fn kind_matches(entry: &FeatureGateRegistryEntry, kind_filter: FeatureGateListKind) -> bool {
    match kind_filter {
        FeatureGateListKind::All => true,
        FeatureGateListKind::FeatureGate => entry.kind == FeatureGateRegistryKind::FeatureGate,
        FeatureGateListKind::ChainParam => entry.kind == FeatureGateRegistryKind::ChainParam,
    }
}

// JSON output keeps registry metadata and live account fields together so
// automation does not have to merge them itself.
fn entry_json(entry: &FeatureGateRegistryEntry, live_entry: &DecodedFeatureGateEntry) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("index".to_string(), json!(entry.index));
    object.insert("name".to_string(), json!(entry.name));
    object.insert("kind".to_string(), json!(kind_label(&entry.kind)));
    object.insert("description".to_string(), json!(entry.description));
    object.insert("tracking".to_string(), json!(entry.tracking));
    object.insert(
        "current_value".to_string(),
        value_json(entry, &live_entry.current_value),
    );
    object.insert(
        "armed_value".to_string(),
        value_json(entry, &live_entry.armed_value),
    );
    object.insert(
        "transition_slot".to_string(),
        json!(live_entry.transition_slot),
    );
    object.insert(
        "last_change_slot".to_string(),
        json!(live_entry.last_change_slot),
    );
    object.insert(
        "next_change_lead_slots".to_string(),
        json!(live_entry.next_change_lead_slots),
    );

    if let Some(status) = &entry.status {
        object.insert("status".to_string(), json!(status_label(status)));
    }
    if let Some(category) = &entry.category {
        object.insert("category".to_string(), json!(category_label(category)));
    }
    if let Some(value_type) = &entry.value_type {
        object.insert("type".to_string(), json!(type_label(value_type)));
    }

    Value::Object(object)
}

fn account_json(account: &DecodedFeatureGateAccount) -> Value {
    json!({
        "entry_count": account.entry_count,
        "creation_admin": account.creation_admin.to_string(),
        "pending_creation_admin": account.pending_creation_admin.to_string(),
        "management_admin": account.management_admin.to_string(),
        "pending_management_admin": account.pending_management_admin.to_string(),
        "config_admin": account.config_admin.to_string(),
        "pending_config_admin": account.pending_config_admin.to_string(),
        "min_arming_lead_slots": account.min_arming_lead_slots,
        "min_gap_between_armings_slots": account.min_gap_between_armings_slots,
        "min_dwell_slots": account.min_dwell_slots,
        "no_disarm_window_slots": account.no_disarm_window_slots,
        "currently_armed_index": account.currently_armed_index,
        "most_recent_change_slot": account.most_recent_change_slot,
    })
}

fn live_entry<'a>(
    account: &'a DecodedFeatureGateAccount,
    registry_entry: &FeatureGateRegistryEntry,
) -> Result<&'a DecodedFeatureGateEntry, CliError> {
    account
        .entries
        .get(registry_entry.index as usize)
        .ok_or_else(|| {
            CliError::Validation(format!(
                "feature gate registry entry '{}' at index {} is missing from the live account",
                registry_entry.name, registry_entry.index
            ))
        })
}

fn validate_disarm_target<'a>(
    registry: &'a FeatureGateRegistry,
    live_account: &DecodedFeatureGateAccount,
    target: &str,
) -> Result<&'a FeatureGateRegistryEntry, CliError> {
    let entry = find_registry_entry(registry, target)?;
    let live_entry = live_entry(live_account, entry)?;
    // This is a live snapshot preflight; the on-chain program remains the final
    // authority if another transaction changes the armed state before submit.
    if live_account.currently_armed_index != Some(entry.index)
        || live_entry.transition_slot.is_none()
    {
        return Err(CliError::Validation(format!(
            "feature gate '{}' is not currently armed",
            entry.name
        )));
    }

    Ok(entry)
}

fn value_json(entry: &FeatureGateRegistryEntry, value: &[u8; FEATURE_GATE_VALUE_SIZE]) -> Value {
    match decoded_value_label(entry, value) {
        Ok(label) => json!(label),
        Err(err) => json!({
            "error": err,
            "hex": hex::encode(value),
        }),
    }
}

fn value_label(entry: &FeatureGateRegistryEntry, value: &[u8; FEATURE_GATE_VALUE_SIZE]) -> String {
    decoded_value_label(entry, value).unwrap_or_else(|err| format!("invalid ({})", err))
}

// Decode live value bytes using the registry encoding. Malformed bytes are shown
// as invalid instead of silently guessing.
fn decoded_value_label(
    entry: &FeatureGateRegistryEntry,
    value: &[u8; FEATURE_GATE_VALUE_SIZE],
) -> Result<String, String> {
    match entry.kind {
        FeatureGateRegistryKind::FeatureGate => decode_feature_gate_value(value),
        FeatureGateRegistryKind::ChainParam => match &entry.value_type {
            Some(value_type) => decode_unsigned_value(value_type, value),
            None => Err("missing chain-param type".to_string()),
        },
    }
}

fn decode_feature_gate_value(value: &[u8; FEATURE_GATE_VALUE_SIZE]) -> Result<String, String> {
    if value[1..].iter().any(|byte| *byte != 0) {
        return Err("nonzero bytes outside feature-gate state byte".to_string());
    }
    match value[0] {
        0 => Ok("inactive".to_string()),
        1 => Ok("active".to_string()),
        other => Err(format!("unsupported feature-gate state {}", other)),
    }
}

fn decode_unsigned_value(
    value_type: &FeatureGateRegistryType,
    value: &[u8; FEATURE_GATE_VALUE_SIZE],
) -> Result<String, String> {
    let width = value_type.width_bytes();
    if value[width..].iter().any(|byte| *byte != 0) {
        return Err(format!("nonzero bytes outside u{} value", width * 8));
    }

    if width <= 16 {
        let mut parsed = 0u128;
        for (i, byte) in value[..width].iter().enumerate() {
            parsed |= (*byte as u128) << (i * 8);
        }
        return Ok(parsed.to_string());
    }

    let mut big_endian: Vec<u8> = value[..width].iter().rev().copied().collect();
    while big_endian.len() > 1 && big_endian[0] == 0 {
        big_endian.remove(0);
    }
    let hex_value = hex::encode(big_endian);
    let hex_value = hex_value.trim_start_matches('0');
    Ok(format!(
        "0x{}",
        if hex_value.is_empty() { "0" } else { hex_value }
    ))
}

fn slot_text(slot: Option<u64>, sentinel_label: &str) -> String {
    slot.map(|slot| slot.to_string())
        .unwrap_or_else(|| sentinel_label.to_string())
}

fn kind_label(kind: &FeatureGateRegistryKind) -> &'static str {
    match kind {
        FeatureGateRegistryKind::FeatureGate => "feature-gate",
        FeatureGateRegistryKind::ChainParam => "chain-param",
    }
}

fn status_label(status: &FeatureGateRegistryStatus) -> &'static str {
    match status {
        FeatureGateRegistryStatus::Reserved => "reserved",
        FeatureGateRegistryStatus::PendingImplementation => "pending-implementation",
        FeatureGateRegistryStatus::Deployed => "deployed",
        FeatureGateRegistryStatus::Armed => "armed",
        FeatureGateRegistryStatus::Activated => "activated",
        FeatureGateRegistryStatus::Deactivated => "deactivated",
    }
}

fn category_label(category: &FeatureGateRegistryCategory) -> &'static str {
    match category {
        FeatureGateRegistryCategory::ConsensusCritical => "consensus-critical",
    }
}

fn type_label(value_type: &FeatureGateRegistryType) -> &'static str {
    match value_type {
        FeatureGateRegistryType::U8 => "u8",
        FeatureGateRegistryType::U16 => "u16",
        FeatureGateRegistryType::U32 => "u32",
        FeatureGateRegistryType::U64 => "u64",
        FeatureGateRegistryType::U128 => "u128",
        FeatureGateRegistryType::U256 => "u256",
        FeatureGateRegistryType::U512 => "u512",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_registry() -> FeatureGateRegistry {
        crate::feature_gate_registry::parse_feature_gate_registry(
            r#"
[[entry]]
index = 0
name = "parallel_exec"
kind = "feature-gate"
description = "Reserved binary feature gate used by CLI tests."
status = "reserved"
tracking = "UNTO-1818"

[[entry]]
index = 1
name = "max_compute_units_per_txn"
kind = "chain-param"
description = "Consensus-critical compute limit."
category = "consensus-critical"
type = "u64"
tracking = "UNTO-1818"
"#,
        )
        .expect("registry parses")
    }

    fn param_entry_with_type(value_type: FeatureGateRegistryType) -> FeatureGateRegistryEntry {
        let registry = test_registry();
        let mut entry = registry
            .get_by_name("max_compute_units_per_txn")
            .unwrap()
            .clone();
        entry.value_type = Some(value_type);
        entry
    }

    fn test_live_account() -> DecodedFeatureGateAccount {
        let mut feature_current = [0u8; FEATURE_GATE_VALUE_SIZE];
        feature_current[0] = 1;

        let mut feature_armed = [0u8; FEATURE_GATE_VALUE_SIZE];
        feature_armed[0] = 0;

        let mut param_current = [0u8; FEATURE_GATE_VALUE_SIZE];
        param_current[..8].copy_from_slice(&42u64.to_le_bytes());

        let mut param_armed = [0u8; FEATURE_GATE_VALUE_SIZE];
        param_armed[..8].copy_from_slice(&84u64.to_le_bytes());

        DecodedFeatureGateAccount {
            entry_count: 2,
            creation_admin: Pubkey::from_bytes(&[1u8; 32]),
            pending_creation_admin: Pubkey::from_bytes(&[0u8; 32]),
            management_admin: Pubkey::from_bytes(&[2u8; 32]),
            pending_management_admin: Pubkey::from_bytes(&[0u8; 32]),
            config_admin: Pubkey::from_bytes(&[3u8; 32]),
            pending_config_admin: Pubkey::from_bytes(&[0u8; 32]),
            min_arming_lead_slots: 10,
            min_gap_between_armings_slots: 20,
            min_dwell_slots: 30,
            no_disarm_window_slots: 40,
            currently_armed_index: Some(1),
            most_recent_change_slot: Some(100),
            entries: vec![
                DecodedFeatureGateEntry {
                    current_value: feature_current,
                    armed_value: feature_armed,
                    transition_slot: None,
                    last_change_slot: Some(7),
                    next_change_lead_slots: 0,
                },
                DecodedFeatureGateEntry {
                    current_value: param_current,
                    armed_value: param_armed,
                    transition_slot: Some(123),
                    last_change_slot: Some(9),
                    next_change_lead_slots: 5,
                },
            ],
        }
    }

    #[test]
    fn finds_registry_entry_by_index_or_name() {
        let registry = test_registry();

        assert_eq!(
            find_registry_entry(&registry, "0").unwrap().name,
            "parallel_exec"
        );
        assert_eq!(
            find_registry_entry(&registry, "parallel_exec")
                .unwrap()
                .index,
            0
        );
        assert!(find_registry_entry(&registry, "missing").is_err());
    }

    #[test]
    fn validates_registry_account_alignment() {
        let registry = test_registry();
        let live_account = test_live_account();
        assert!(validate_registry_account_alignment(&registry, &live_account).is_ok());

        let mut mismatched_account = live_account;
        mismatched_account.entries.pop();
        assert!(validate_registry_account_alignment(&registry, &mismatched_account).is_err());
    }

    #[test]
    fn labels_feature_gate_and_chain_param_values() {
        let registry = test_registry();
        let live_account = test_live_account();

        let feature_entry = registry.get_by_name("parallel_exec").unwrap();
        let feature_live_entry = live_entry(&live_account, feature_entry).unwrap();
        assert_eq!(
            value_label(feature_entry, &feature_live_entry.current_value),
            "active"
        );
        assert_eq!(
            value_label(feature_entry, &feature_live_entry.armed_value),
            "inactive"
        );

        let param_entry = registry.get_by_name("max_compute_units_per_txn").unwrap();
        let param_live_entry = live_entry(&live_account, param_entry).unwrap();
        assert_eq!(
            value_label(param_entry, &param_live_entry.current_value),
            "42"
        );
        assert_eq!(
            value_label(param_entry, &param_live_entry.armed_value),
            "84"
        );
    }

    #[test]
    fn rejects_invalid_encoded_values() {
        let registry = test_registry();
        let feature_entry = registry.get_by_name("parallel_exec").unwrap();
        let mut feature_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        feature_value[0] = 2;
        assert!(value_label(feature_entry, &feature_value).contains("unsupported"));

        let param_entry = registry.get_by_name("max_compute_units_per_txn").unwrap();
        let mut param_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        param_value[..8].copy_from_slice(&42u64.to_le_bytes());
        param_value[8] = 1;
        assert!(value_label(param_entry, &param_value).contains("nonzero bytes"));

        let u256_entry = param_entry_with_type(FeatureGateRegistryType::U256);
        let mut u256_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        u256_value[32] = 1;
        assert!(value_label(&u256_entry, &u256_value).contains("nonzero bytes"));
    }

    #[test]
    fn includes_live_state_in_entry_json() {
        let registry = test_registry();
        let live_account = test_live_account();
        let entry = registry.get_by_name("max_compute_units_per_txn").unwrap();
        let value = entry_json(entry, live_entry(&live_account, entry).unwrap());

        assert_eq!(value["index"], json!(1));
        assert_eq!(value["name"], json!("max_compute_units_per_txn"));
        assert_eq!(value["kind"], json!("chain-param"));
        assert_eq!(value["current_value"], json!("42"));
        assert_eq!(value["armed_value"], json!("84"));
        assert_eq!(value["transition_slot"], json!(123));
        assert_eq!(value["last_change_slot"], json!(9));
        assert_eq!(value["next_change_lead_slots"], json!(5));
    }

    #[test]
    fn validates_disarm_preflight_requires_armed_entry() {
        let registry = test_registry();
        let live_account = test_live_account();

        let armed = validate_disarm_target(&registry, &live_account, "max_compute_units_per_txn")
            .expect("armed entry can be disarmed");
        assert_eq!(armed.index, 1);

        let err = validate_disarm_target(&registry, &live_account, "parallel_exec")
            .expect_err("disarmed entry should fail preflight");
        assert!(format!("{err}").contains("not currently armed"));

        let mut inconsistent_account = test_live_account();
        inconsistent_account.currently_armed_index = None;
        let err = validate_disarm_target(
            &registry,
            &inconsistent_account,
            "max_compute_units_per_txn",
        )
        .expect_err("entry with transition slot but no armed index should fail preflight");
        assert!(format!("{err}").contains("not currently armed"));
    }

    #[test]
    fn encodes_feature_gate_instruction_abi() {
        let mut value = [0u8; FEATURE_GATE_VALUE_SIZE];
        value[0] = 1;

        let create = encode_create_gate_instruction(&value, 9);
        assert_eq!(create.len(), 80);
        assert_eq!(&create[0..4], &FEATURE_GATE_INSTR_CREATE_GATE.to_le_bytes());
        assert_eq!(
            &create[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &create[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(&create[8..72], &value);
        assert_eq!(&create[72..80], &9u64.to_le_bytes());

        let arm = encode_arm_instruction(7, 99, &value);
        assert_eq!(arm.len(), 84);
        assert_eq!(&arm[0..4], &FEATURE_GATE_INSTR_ARM.to_le_bytes());
        assert_eq!(&arm[4..6], &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes());
        assert_eq!(
            &arm[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(&arm[8..16], &99u64.to_le_bytes());
        assert_eq!(&arm[16..20], &7u32.to_le_bytes());
        assert_eq!(&arm[20..84], &value);

        let disarm = encode_disarm_instruction(7);
        assert_eq!(disarm.len(), 12);
        assert_eq!(&disarm[0..4], &FEATURE_GATE_INSTR_DISARM.to_le_bytes());
        assert_eq!(
            &disarm[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &disarm[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(&disarm[8..12], &7u32.to_le_bytes());
    }

    #[test]
    fn encodes_timing_and_admin_instruction_abi() {
        let timing = encode_update_timing_knobs_instruction(1, 2, 3, 4);
        assert_eq!(timing.len(), 40);
        assert_eq!(
            &timing[0..4],
            &FEATURE_GATE_INSTR_UPDATE_TIMING_KNOBS.to_le_bytes()
        );
        assert_eq!(
            &timing[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &timing[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(&timing[8..16], &1u64.to_le_bytes());
        assert_eq!(&timing[16..24], &2u64.to_le_bytes());
        assert_eq!(&timing[24..32], &3u64.to_le_bytes());
        assert_eq!(&timing[32..40], &4u64.to_le_bytes());

        let new_admin = [0x42u8; 32];
        let propose = encode_propose_admin_instruction(FEATURE_GATE_ROLE_MANAGEMENT, &new_admin);
        assert_eq!(propose.len(), 44);
        assert_eq!(
            &propose[0..4],
            &FEATURE_GATE_INSTR_PROPOSE_ADMIN.to_le_bytes()
        );
        assert_eq!(
            &propose[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &propose[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(propose[8], FEATURE_GATE_ROLE_MANAGEMENT);
        assert_eq!(&propose[9..12], &[0u8; 3]);
        assert_eq!(&propose[12..44], &new_admin);

        let accept = encode_accept_admin_instruction(FEATURE_GATE_ROLE_CONFIG);
        assert_eq!(accept.len(), 12);
        assert_eq!(
            &accept[0..4],
            &FEATURE_GATE_INSTR_ACCEPT_ADMIN.to_le_bytes()
        );
        assert_eq!(
            &accept[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &accept[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(accept[8], FEATURE_GATE_ROLE_CONFIG);
        assert_eq!(&accept[9..12], &[0u8; 3]);
    }

    #[test]
    fn encodes_registry_values_for_writes() {
        let registry = test_registry();
        let feature_entry = registry.get_by_name("parallel_exec").unwrap();
        let feature_value = encode_registry_value(feature_entry, "active").unwrap();
        assert_eq!(feature_value[0], 1);
        assert!(feature_value[1..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(feature_entry, "maybe").is_err());

        let param_entry = registry.get_by_name("max_compute_units_per_txn").unwrap();
        let param_value = encode_registry_value(param_entry, "1234").unwrap();
        assert_eq!(&param_value[..8], &1234u64.to_le_bytes());
        assert!(param_value[8..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(param_entry, "not-a-number").is_err());
    }

    #[test]
    fn encodes_documented_chain_param_widths() {
        let u8_entry = param_entry_with_type(FeatureGateRegistryType::U8);
        let u8_value = encode_registry_value(&u8_entry, "255").unwrap();
        assert_eq!(u8_value[0], 255);
        assert!(u8_value[1..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(&u8_entry, "256").is_err());

        let u16_entry = param_entry_with_type(FeatureGateRegistryType::U16);
        let u16_value = encode_registry_value(&u16_entry, "65535").unwrap();
        assert_eq!(&u16_value[..2], &65535u16.to_le_bytes());
        assert!(u16_value[2..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(&u16_entry, "65536").is_err());

        let u32_entry = param_entry_with_type(FeatureGateRegistryType::U32);
        let u32_value = encode_registry_value(&u32_entry, "4294967295").unwrap();
        assert_eq!(&u32_value[..4], &u32::MAX.to_le_bytes());
        assert!(u32_value[4..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(&u32_entry, "4294967296").is_err());

        let u128_entry = param_entry_with_type(FeatureGateRegistryType::U128);
        let u128_value = encode_registry_value(&u128_entry, &u128::MAX.to_string()).unwrap();
        assert_eq!(&u128_value[..16], &u128::MAX.to_le_bytes());
        assert!(u128_value[16..].iter().all(|byte| *byte == 0));

        let u256_entry = param_entry_with_type(FeatureGateRegistryType::U256);
        let u256_value = encode_registry_value(&u256_entry, "0x010203").unwrap();
        assert_eq!(&u256_value[..3], &[0x03, 0x02, 0x01]);
        assert!(u256_value[3..].iter().all(|byte| *byte == 0));
        assert!(encode_registry_value(&u256_entry, "123").is_err());

        let u512_entry = param_entry_with_type(FeatureGateRegistryType::U512);
        let u512_value = encode_registry_value(&u512_entry, "0xff").unwrap();
        assert_eq!(u512_value[0], 0xff);
        assert!(u512_value[1..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn decodes_documented_chain_param_widths() {
        let u128_entry = param_entry_with_type(FeatureGateRegistryType::U128);
        let mut u128_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        u128_value[..16].copy_from_slice(&123456789u128.to_le_bytes());
        assert_eq!(value_label(&u128_entry, &u128_value), "123456789");

        let u256_entry = param_entry_with_type(FeatureGateRegistryType::U256);
        let mut u256_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        u256_value[..3].copy_from_slice(&[0x03, 0x02, 0x01]);
        assert_eq!(value_label(&u256_entry, &u256_value), "0x10203");

        let u512_entry = param_entry_with_type(FeatureGateRegistryType::U512);
        let mut u512_value = [0u8; FEATURE_GATE_VALUE_SIZE];
        u512_value[63] = 0xaa;
        assert_eq!(
            value_label(&u512_entry, &u512_value),
            format!("0xaa{}", "00".repeat(63))
        );
    }

    #[test]
    fn builds_feature_gate_transaction_with_expected_account_layout() {
        let keypair = crypto::keypair_from_hex(
            "0101010101010101010101010101010101010101010101010101010101010101",
        )
        .expect("test keypair parses");
        let fee_payer = keypair.public_key;
        let instruction = encode_disarm_instruction(5);
        let mut tx = build_feature_gate_transaction(fee_payer, 11, 22, 33, instruction.clone())
            .expect("transaction builds");

        assert_eq!(tx.fee_payer, fee_payer);
        assert_eq!(
            tx.program,
            feature_gate_program_pubkey().to_bytes().unwrap()
        );
        assert_eq!(tx.fee, FEATURE_GATE_TX_FEE);
        assert_eq!(tx.nonce, 11);
        assert_eq!(tx.start_slot, 22);
        assert_eq!(tx.chain_id, 33);
        assert_eq!(tx.instructions.as_deref(), Some(instruction.as_slice()));

        let rw_accounts = tx.rw_accs.as_ref().expect("rw accounts are present");
        assert_eq!(rw_accounts.len(), 1);
        assert_eq!(
            rw_accounts[0],
            feature_gate_global_account_pubkey().to_bytes().unwrap()
        );
        assert_eq!(
            &instruction[4..6],
            &FEATURE_GATE_GLOBAL_ACCOUNT_IDX.to_le_bytes()
        );
        assert_eq!(
            &instruction[6..8],
            &FEATURE_GATE_AUTHORITY_ACCOUNT_IDX.to_le_bytes()
        );
        tx.sign(&keypair.private_key)
            .expect("feature-gate write transaction layout signs");
    }

    fn failed_transaction_details() -> TransactionDetails {
        TransactionDetails {
            compute_units_consumed: 0,
            memory_units_consumed: 0,
            state_units_consumed: 0,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 7,
            pages_used: 0,
            user_error_code: 0xCAFE,
            vm_error: -1,
            rw_accounts: Vec::new(),
            ro_accounts: Vec::new(),
            events: Vec::new(),
            fee_payer_signature: thru_base::tn_tools::Signature::from_bytes(&[0u8; 64]),
            version: 1,
            flags: 0,
            readwrite_accounts_count: 0,
            readonly_accounts_count: 0,
            instruction_data_size: 0,
            requested_compute_units: 0,
            requested_state_units: 0,
            requested_memory_units: 0,
            expiry_after: 0,
            fee: 0,
            nonce: 0,
            start_slot: 0,
            fee_payer_pubkey: Pubkey::from_bytes(&[0u8; 32]),
            program_pubkey: Pubkey::from_bytes(&[1u8; 32]),
            signature: thru_base::tn_tools::Signature::from_bytes(&[2u8; 64]),
            body: None,
            slot: 0,
            block_offset: None,
            proof_slot: 0,
        }
    }

    #[test]
    fn reports_feature_gate_execution_failure_as_structured_error() {
        let err = check_transaction_result(&failed_transaction_details())
            .expect_err("failed execution should return an error");

        match err {
            CliError::TransactionFailed {
                message,
                execution_result,
                vm_error,
                user_error_code,
                user_error_label,
                signature,
                ..
            } => {
                assert!(message.contains("Feature-gate transaction failed"));
                assert_eq!(execution_result, 7);
                assert_eq!(vm_error, -1);
                assert_eq!(user_error_code, 0xCAFE);
                assert_eq!(user_error_label, "0xCAFE");
                assert_eq!(
                    signature,
                    thru_base::tn_tools::Signature::from_bytes(&[2u8; 64])
                        .as_str()
                        .to_string()
                );
            }
            other => panic!("expected structured transaction failure, got {other:?}"),
        }
    }

    #[test]
    fn maps_admin_roles_to_abi_values() {
        assert_eq!(role_discriminant(FeatureGateAdminRole::Creation), 0);
        assert_eq!(role_discriminant(FeatureGateAdminRole::Management), 1);
        assert_eq!(role_discriminant(FeatureGateAdminRole::Config), 2);
    }

    #[test]
    fn formats_missing_slots_with_context_labels() {
        assert_eq!(slot_text(None, "not armed"), "not armed");
        assert_eq!(slot_text(None, "never"), "never");
        assert_eq!(slot_text(Some(55), "never"), "55");
    }
}
