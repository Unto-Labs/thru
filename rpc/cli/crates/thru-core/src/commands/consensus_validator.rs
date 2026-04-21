//! Validator program command implementation

use crate::cli::ValidatorCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::validate_address_or_hex;
use base64::Engine;
use blst::min_pk::{PublicKey as BlsPublicKey, SecretKey as BlsSecretKey};
use std::time::Duration;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::{ConsensusValidatorAccounts, TransactionBuilder};
use thru_client::{Client, ClientBuilder, TransactionDetails};

const CONSENSUS_VALIDATOR_FEE: u64 = 0;
const CONSENSUS_VALIDATOR_STATE_HEADER_SIZE: usize = 216;
const CONSENSUS_STATE_BASE_HEADER_SIZE: usize = 240;
const CONSENSUS_ATTESTOR_SEAT_SIZE: usize = 152;
const CONSENSUS_VALIDATOR_METADATA_SIZE: usize = 40;
const CONSENSUS_WEIGHT_UPDATE_SIZE: usize = 32;
const BLS_PUBKEY_SIZE: usize = 96;
const CONSENSUS_STATE_NO_SLOT: u64 = u64::MAX;

#[derive(Debug, Clone)]
struct ValidatorTable {
    attestor_table: [u8; 32],
    attestor_mint: [u8; 32],
    token_program: [u8; 32],
    converted_vault: [u8; 32],
    unclaimed_vault: [u8; 32],
    admin: [u8; 32],
    current_slot: u64,
    account_slot: Option<u64>,
    data_size: usize,
    server_count: u64,
    occupied_validators: usize,
    delta1: u64,
    delta2: u64,
    frontier: u64,
    pending_decay: u64,
    last_decay_calc_slot: u64,
    last_decay_emit_slot: u64,
    last_processed_slot: u64,
    weight_updates_cnt: u64,
    total_weights_head: u64,
    total_weights_tail: u64,
    blocks_per_faulty_turnover: u64,
    turnover_ring_head_slot: u64,
    turnover_sum_added: u64,
    turnover_sum_removed: u64,
    turnover_limit: Option<u64>,
    total_weight: u64,
    validators: Vec<ValidatorEntry>,
}

#[derive(Debug, Clone)]
struct ValidatorEntry {
    sid: u64,
    identity: [u8; 32],
    bls_pubkey_hex: String,
    claim_authority: [u8; 32],
    unclaimed_tokens: u64,
    weight: u64,
    weight_source: &'static str,
    last_slot_updates: u64,
    last_id_updates: u64,
    latest_weight_update_idx: u64,
    active: bool,
}

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

fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .build()
        .map_err(Into::into)
}

struct TransactionContext {
    fee_payer_keypair: KeyPair,
    client: Client,
    nonce: u64,
    start_slot: u64,
    chain_id: u16,
    timeout_seconds: u64,
}

async fn setup_transaction_context(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<TransactionContext, CliError> {
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let client = create_rpc_client(config)?;

    let account_info = client
        .get_account_info(&fee_payer_keypair.address_string, None, None)
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

    let chain_info = client
        .get_chain_info()
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get chain info: {}", e)))?;

    Ok(TransactionContext {
        fee_payer_keypair,
        client,
        nonce,
        start_slot: block_height.finalized_height,
        chain_id: chain_info.chain_id,
        timeout_seconds: config.timeout_seconds,
    })
}

async fn execute_transaction(
    mut transaction: Transaction,
    context: &TransactionContext,
    json_format: bool,
) -> Result<TransactionDetails, CliError> {
    transaction = transaction.with_chain_id(context.chain_id);
    transaction
        .sign(&context.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(context.timeout_seconds);

    let transaction_details = context
        .client
        .execute_transaction(&transaction_bytes, timeout)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to execute transaction: {}", e))
        })?;

    check_validator_transaction_result(&transaction_details, json_format)?;

    Ok(transaction_details)
}

fn check_validator_transaction_result(
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
            format!(" (ValidatorError: {})", signed_user_error)
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

fn resolve_override_account(value: Option<&str>, default: [u8; 32]) -> Result<[u8; 32], CliError> {
    match value {
        Some(input) => validate_address_or_hex(input),
        None => Ok(default),
    }
}

fn resolve_pubkey_or_key_name(config: &Config, value: &str) -> Result<[u8; 32], CliError> {
    if (value.starts_with("ta") && value.len() == 46) || value.len() == 64 {
        return validate_address_or_hex(value);
    }

    let private_key = config.keys.get_key(value).map_err(|_| {
        CliError::Validation(format!(
            "'{}' is neither a valid public key nor a configured key name",
            value
        ))
    })?;

    let keypair = KeyPair::from_hex_private_key(value, private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to resolve key '{}': {}", value, e)))?;

    Ok(keypair.public_key)
}

fn resolve_consensus_accounts(
    config: &Config,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    converted_vault: Option<&str>,
    unclaimed_vault: Option<&str>,
) -> Result<ConsensusValidatorAccounts, CliError> {
    let default_program = config
        .get_consensus_validator_program_pubkey()?
        .to_bytes()
        .map_err(|e| {
            CliError::Crypto(format!(
                "Failed to convert consensus validator program pubkey: {}",
                e
            ))
        })?;
    let default_attestor_table = config
        .get_consensus_attestor_table_pubkey()?
        .to_bytes()
        .map_err(|e| {
            CliError::Crypto(format!(
                "Failed to convert consensus attestor table pubkey: {}",
                e
            ))
        })?;
    let default_token_program = config
        .get_token_program_pubkey()?
        .to_bytes()
        .map_err(|e| CliError::Crypto(format!("Failed to convert token program pubkey: {}", e)))?;
    let default_converted_vault = config
        .get_consensus_converted_vault_pubkey()?
        .to_bytes()
        .map_err(|e| {
            CliError::Crypto(format!(
                "Failed to convert consensus converted vault pubkey: {}",
                e
            ))
        })?;
    let default_unclaimed_vault = config
        .get_consensus_unclaimed_vault_pubkey()?
        .to_bytes()
        .map_err(|e| {
            CliError::Crypto(format!(
                "Failed to convert consensus unclaimed vault pubkey: {}",
                e
            ))
        })?;

    Ok(ConsensusValidatorAccounts {
        program: resolve_override_account(program, default_program)?,
        attestor_table: resolve_override_account(attestor_table, default_attestor_table)?,
        token_program: resolve_override_account(token_program, default_token_program)?,
        converted_vault: resolve_override_account(converted_vault, default_converted_vault)?,
        unclaimed_vault: resolve_override_account(unclaimed_vault, default_unclaimed_vault)?,
    })
}

fn parse_bls_pubkey_hex(value: &str) -> Result<[u8; 96], CliError> {
    let trimmed = value.trim_start_matches("0x");
    let bytes = hex::decode(trimmed)
        .map_err(|e| CliError::Validation(format!("Invalid BLS public key hex: {}", e)))?;

    if bytes.len() != 96 {
        return Err(CliError::Validation(format!(
            "BLS public key must decode to exactly 96 bytes, got {}",
            bytes.len()
        )));
    }

    let mut pubkey = [0u8; 96];
    pubkey.copy_from_slice(&bytes);

    BlsPublicKey::deserialize(&pubkey).map_err(|_| {
        CliError::Validation(
            "BLS public key must be a valid uncompressed 96-byte BLS12-381 G1 point".to_string(),
        )
    })?;

    Ok(pubkey)
}

fn derive_bls_pubkey_from_seed(seed: u64) -> Result<[u8; 96], CliError> {
    let mut ikm = [0u8; 32];
    for (idx, byte) in ikm.iter_mut().enumerate() {
        *byte = ((seed >> (idx % 8)) ^ ((idx as u64) * 37)) as u8;
    }

    let secret_key = BlsSecretKey::key_gen(&ikm, &[]).map_err(|_| {
        CliError::Validation(format!(
            "Failed to derive a BLS keypair from deterministic seed {}",
            seed
        ))
    })?;

    Ok(secret_key.sk_to_pk().serialize())
}

fn resolve_bls_pubkey(
    bls_pubkey: Option<&str>,
    bls_seed: Option<u64>,
) -> Result<[u8; 96], CliError> {
    match (bls_pubkey, bls_seed) {
        (Some(value), None) => parse_bls_pubkey_hex(value),
        (None, Some(seed)) => derive_bls_pubkey_from_seed(seed),
        (Some(_), Some(_)) => Err(CliError::Validation(
            "Use either --bls-pubkey or --bls-seed, not both".to_string(),
        )),
        (None, None) => Err(CliError::Validation(
            "Either --bls-pubkey or --bls-seed is required".to_string(),
        )),
    }
}

fn ensure_nonzero_amount(action: &str, token_amount: u64) -> Result<(), CliError> {
    if token_amount == 0 {
        return Err(CliError::Validation(format!(
            "{} amount must be greater than 0",
            action
        )));
    }

    Ok(())
}

fn to_address_string(bytes: &[u8; 32]) -> String {
    Pubkey::from_bytes(bytes).to_string()
}

fn read_bytes<const N: usize>(data: &[u8], offset: usize, label: &str) -> Result<[u8; N], CliError> {
    let end = offset.saturating_add(N);
    let slice = data.get(offset..end).ok_or_else(|| {
        CliError::Validation(format!(
            "Validator table data is truncated while reading {} at offset {}",
            label, offset
        ))
    })?;

    let mut value = [0u8; N];
    value.copy_from_slice(slice);
    Ok(value)
}

fn read_u64(data: &[u8], offset: usize, label: &str) -> Result<u64, CliError> {
    Ok(u64::from_le_bytes(read_bytes::<8>(data, offset, label)?))
}

fn has_nonzero_bytes(bytes: &[u8]) -> bool {
    bytes.iter().any(|byte| *byte != 0)
}

fn read_total_weight_at_slot(
    data: &[u8],
    total_weights_start: usize,
    total_weights_capacity: usize,
    slot: u64,
) -> Result<u64, CliError> {
    let slot_idx = usize::try_from(slot).map_err(|_| {
        CliError::Validation(format!("Validator table slot {} is too large", slot))
    })?;
    let offset = total_weights_start + (slot_idx % total_weights_capacity) * 8;
    read_u64(data, offset, "total_weight")
}

fn parse_validator_table(data: &[u8], attestor_table: [u8; 32], current_slot: u64, account_slot: Option<u64>) -> Result<ValidatorTable, CliError> {
    if data.len() < CONSENSUS_VALIDATOR_STATE_HEADER_SIZE {
        return Err(CliError::Validation(format!(
            "Attestor table account data is too small: expected at least {} bytes, got {}",
            CONSENSUS_VALIDATOR_STATE_HEADER_SIZE,
            data.len()
        )));
    }

    let token_program = read_bytes::<32>(data, 0, "token_program")?;
    let attestor_mint = read_bytes::<32>(data, 32, "attestor_mint")?;
    let converted_vault = read_bytes::<32>(data, 64, "converted_vault")?;
    let unclaimed_vault = read_bytes::<32>(data, 96, "unclaimed_vault")?;
    let admin = read_bytes::<32>(data, 128, "admin")?;
    let server_count = read_u64(data, 160, "server_count")?;
    let base_sm_off = read_u64(data, 168, "base_sm_off")? as usize;
    let metadata_off = read_u64(data, 176, "metadata_off")? as usize;
    let pending_decay = read_u64(data, 184, "pending_decay")?;
    let last_decay_calc_slot = read_u64(data, 192, "last_decay_calc_slot")?;
    let last_decay_emit_slot = read_u64(data, 200, "last_decay_emit_slot")?;
    let last_processed_slot = read_u64(data, 208, "last_processed_slot")?;

    let server_count_usize = usize::try_from(server_count).map_err(|_| {
        CliError::Validation(format!("Validator table server_count {} is too large", server_count))
    })?;

    let base_header = data
        .get(base_sm_off..base_sm_off.saturating_add(CONSENSUS_STATE_BASE_HEADER_SIZE))
        .ok_or_else(|| {
            CliError::Validation(format!(
                "Validator table base state header is truncated at offset {}",
                base_sm_off
            ))
        })?;

    let delta1 = read_u64(base_header, 0, "delta1")?;
    let delta2 = read_u64(base_header, 8, "delta2")?;
    let base_server_count = read_u64(base_header, 16, "base_server_count")?;
    let frontier = read_u64(base_header, 24, "frontier")?;
    let stake_slots_off = read_u64(base_header, 48, "stake_slots_off")? as usize;
    let base_weights_off = read_u64(base_header, 56, "base_weights_off")? as usize;
    let total_weights_off = read_u64(base_header, 64, "total_weights_off")? as usize;
    let weight_updates_off = read_u64(base_header, 80, "weight_updates_off")? as usize;
    let weight_updates_head = read_u64(base_header, 96, "weight_updates_head")?;
    let weight_updates_cnt = read_u64(base_header, 112, "weight_updates_cnt")?;
    let total_weights_head = read_u64(base_header, 144, "total_weights_head")?;
    let total_weights_tail = read_u64(base_header, 152, "total_weights_tail")?;
    let blocks_per_faulty_turnover = read_u64(base_header, 200, "blocks_per_faulty_turnover")?;
    let turnover_ring_head_slot = read_u64(base_header, 216, "turnover_ring_head_slot")?;
    let turnover_sum_added = read_u64(base_header, 224, "turnover_sum_added")?;
    let turnover_sum_removed = read_u64(base_header, 232, "turnover_sum_removed")?;

    if base_server_count != server_count {
        return Err(CliError::Validation(format!(
            "Validator table server_count mismatch: state={} base={}",
            server_count, base_server_count
        )));
    }

    let stake_slots_start = base_sm_off.saturating_add(stake_slots_off);
    let base_weights_start = base_sm_off.saturating_add(base_weights_off);
    let total_weights_start = base_sm_off.saturating_add(total_weights_off);
    let weight_updates_start = base_sm_off.saturating_add(weight_updates_off);
    let total_weights_capacity = usize::try_from(delta1.saturating_add(delta2).saturating_add(1)).map_err(|_| {
        CliError::Validation("Validator table total-weights capacity is too large".to_string())
    })?;

    let _ = data
        .get(
            stake_slots_start
                ..stake_slots_start.saturating_add(server_count_usize.saturating_mul(CONSENSUS_ATTESTOR_SEAT_SIZE)),
        )
        .ok_or_else(|| CliError::Validation("Validator table stake slots are truncated".to_string()))?;
    let _ = data
        .get(
            base_weights_start
                ..base_weights_start.saturating_add(server_count_usize.saturating_mul(8)),
        )
        .ok_or_else(|| CliError::Validation("Validator table base weights are truncated".to_string()))?;
    let _ = data
        .get(
            total_weights_start
                ..total_weights_start.saturating_add(total_weights_capacity.saturating_mul(8)),
        )
        .ok_or_else(|| CliError::Validation("Validator table total weights are truncated".to_string()))?;
    let _ = data
        .get(
            metadata_off
                ..metadata_off.saturating_add(server_count_usize.saturating_mul(CONSENSUS_VALIDATOR_METADATA_SIZE)),
        )
        .ok_or_else(|| CliError::Validation("Validator table metadata is truncated".to_string()))?;
    let _ = data
        .get(
            weight_updates_start
                ..weight_updates_start.saturating_add(server_count_usize.saturating_mul(CONSENSUS_WEIGHT_UPDATE_SIZE)),
        )
        .ok_or_else(|| CliError::Validation("Validator table weight updates are truncated".to_string()))?;

    let weight_updates_head_usize = usize::try_from(weight_updates_head).map_err(|_| {
        CliError::Validation(format!(
            "Validator table weight_updates_head {} is too large",
            weight_updates_head
        ))
    })?;
    let weight_updates_cnt_usize = usize::try_from(weight_updates_cnt).map_err(|_| {
        CliError::Validation(format!(
            "Validator table weight_updates_cnt {} is too large",
            weight_updates_cnt
        ))
    })?;

    let mut validators = Vec::new();
    let mut total_weight = 0u64;

    let turnover_lookup_slot = if turnover_ring_head_slot != CONSENSUS_STATE_NO_SLOT {
        turnover_ring_head_slot
    } else {
        0
    };
    let turnover_head_total_weight = if total_weights_tail > total_weights_head
        && turnover_lookup_slot >= total_weights_head
        && turnover_lookup_slot < total_weights_tail
    {
        Some(read_total_weight_at_slot(
            data,
            total_weights_start,
            total_weights_capacity,
            turnover_lookup_slot,
        )?)
    } else if total_weights_tail > total_weights_head {
        Some(read_total_weight_at_slot(
            data,
            total_weights_start,
            total_weights_capacity,
            total_weights_tail - 1,
        )?)
    } else {
        None
    };
    let turnover_limit = turnover_head_total_weight
        .filter(|weight| *weight > 0)
        .map(|weight| (weight - 1) / 5);

    for sid in 0..server_count_usize {
        let seat_off = stake_slots_start + sid * CONSENSUS_ATTESTOR_SEAT_SIZE;
        let identity = read_bytes::<32>(data, seat_off, "validator_identity")?;
        let bls_pubkey = read_bytes::<BLS_PUBKEY_SIZE>(data, seat_off + 32, "validator_bls_pubkey")?;

        if !has_nonzero_bytes(&bls_pubkey) {
            continue;
        }

        let last_slot_updates = read_u64(data, seat_off + 128, "last_slot_updates")?;
        let last_id_updates = read_u64(data, seat_off + 136, "last_id_updates")?;
        let latest_weight_update_idx = read_u64(data, seat_off + 144, "latest_weight_update_idx")?;

        let mut weight = read_u64(data, base_weights_start + sid * 8, "base_weight")?;
        let mut weight_source = "base";

        if server_count_usize > 0 && weight_updates_cnt_usize > 0 {
            for entry_idx in 0..weight_updates_cnt_usize.min(server_count_usize) {
                let ring_idx = (weight_updates_head_usize + entry_idx) % server_count_usize;
                let update_off = weight_updates_start + ring_idx * CONSENSUS_WEIGHT_UPDATE_SIZE;
                let update_sid = read_u64(data, update_off + 8, "weight_update_sid")?;
                if update_sid == sid as u64 {
                    weight = read_u64(data, update_off + 16, "weight_update_delta")?;
                    weight_source = "pending";
                }
            }
        }

        let metadata_entry_off = metadata_off + sid * CONSENSUS_VALIDATOR_METADATA_SIZE;
        let claim_authority = read_bytes::<32>(data, metadata_entry_off, "claim_authority")?;
        let unclaimed_tokens = read_u64(data, metadata_entry_off + 32, "unclaimed_tokens")?;

        total_weight = total_weight.saturating_add(weight);
        validators.push(ValidatorEntry {
            sid: sid as u64,
            identity,
            bls_pubkey_hex: hex::encode(bls_pubkey),
            claim_authority,
            unclaimed_tokens,
            weight,
            weight_source,
            last_slot_updates,
            last_id_updates,
            latest_weight_update_idx,
            active: weight > 0,
        });
    }

    Ok(ValidatorTable {
        attestor_table,
        attestor_mint,
        token_program,
        converted_vault,
        unclaimed_vault,
        admin,
        current_slot,
        account_slot,
        data_size: data.len(),
        server_count,
        occupied_validators: validators.len(),
        delta1,
        delta2,
        frontier,
        pending_decay,
        last_decay_calc_slot,
        last_decay_emit_slot,
        last_processed_slot,
        weight_updates_cnt,
        total_weights_head,
        total_weights_tail,
        blocks_per_faulty_turnover,
        turnover_ring_head_slot,
        turnover_sum_added,
        turnover_sum_removed,
        turnover_limit,
        total_weight,
        validators,
    })
}

fn check_activate_turnover_window(table: &ValidatorTable, token_amount: u64) -> Result<(), CliError> {
    let Some(turnover_limit) = table.turnover_limit else {
        return Ok(());
    };

    let projected_added = table.turnover_sum_added.saturating_add(token_amount);
    if projected_added <= turnover_limit {
        return Ok(());
    }

    let window_end_slot = if table.turnover_ring_head_slot == CONSENSUS_STATE_NO_SLOT {
        None
    } else {
        Some(
            table
                .turnover_ring_head_slot
                .saturating_add(table.blocks_per_faulty_turnover),
        )
    };
    let remaining_slots = window_end_slot.map(|slot| slot.saturating_sub(table.current_slot));

    let mut message = format!(
        "Validator activation would be rejected by the on-chain turnover window: current added weight in the {}-slot window is {}, activating {} more would project to {}, but the current limit is {}.",
        table.blocks_per_faulty_turnover,
        table.turnover_sum_added,
        token_amount,
        projected_added,
        turnover_limit,
    );

    if let Some(slot) = window_end_slot {
        message.push_str(&format!(
            " The current turnover window started at slot {} and should clear around slot {}",
            table.turnover_ring_head_slot, slot
        ));
        if let Some(remaining) = remaining_slots {
            message.push_str(&format!(" (about {} more slot(s) from current slot {})", remaining, table.current_slot));
        }
        message.push('.');
    }

    if table.current_slot < table.blocks_per_faulty_turnover {
        message.push_str(
            " This typically happens on a fresh chain because the genesis validator activation still counts against the turnover budget until that initial window ages out.",
        );
    }

    Err(CliError::Validation(message))
}

fn resolve_validator_entry<'a>(
    table: &'a ValidatorTable,
    config: &Config,
    validator: &str,
) -> Result<&'a ValidatorEntry, CliError> {
    if let Ok(sid) = validator.parse::<u64>() {
        return table
            .validators
            .iter()
            .find(|entry| entry.sid == sid)
            .ok_or_else(|| CliError::Validation(format!("Validator SID {} not found", sid)));
    }

    let identity = resolve_pubkey_or_key_name(config, validator)?;
    table
        .validators
        .iter()
        .find(|entry| entry.identity == identity)
        .ok_or_else(|| CliError::Validation(format!("Validator '{}' not found in table", validator)))
}

async fn fetch_validator_table(
    config: &Config,
    attestor_table_override: Option<&str>,
) -> Result<ValidatorTable, CliError> {
    let attestor_table = if let Some(value) = attestor_table_override {
        validate_address_or_hex(value)?
    } else {
        config
            .get_consensus_attestor_table_pubkey()?
            .to_bytes()
            .map_err(|e| CliError::Crypto(format!("Failed to convert attestor table pubkey: {}", e)))?
    };

    let client = create_rpc_client(config)?;
    let block_height = client.get_block_height().await.map_err(|e| {
        CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
    })?;
    let attestor_table_pubkey = Pubkey::from_bytes(&attestor_table);
    let attestor_table_address = to_address_string(&attestor_table);
    let account = client
        .get_account_info(&attestor_table_pubkey, None, None)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!(
                "Failed to get validator table account info: {}",
                e
            ))
        })?
        .ok_or_else(|| CliError::AccountNotFound(format!("Validator table account {} not found", attestor_table_address)))?;

    let encoded_data = account.data.ok_or_else(|| {
        CliError::Validation(format!(
            "Validator table account {} has no data",
            attestor_table_address
        ))
    })?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(encoded_data)
        .map_err(|e| CliError::Validation(format!("Failed to decode validator table data: {}", e)))?;

    parse_validator_table(&data, attestor_table, block_height.finalized_height, account.slot)
}

pub async fn handle_validator_command(
    config: &Config,
    subcommand: ValidatorCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        ValidatorCommands::Activate {
            source_token_account,
            token_amount,
            bls_pubkey,
            bls_seed,
            claim_authority,
            fee_payer,
            program,
            attestor_table,
            token_program,
            converted_vault,
        } => {
            activate(
                config,
                &source_token_account,
                token_amount,
                bls_pubkey.as_deref(),
                bls_seed,
                claim_authority.as_deref(),
                fee_payer.as_deref(),
                program.as_deref(),
                attestor_table.as_deref(),
                token_program.as_deref(),
                converted_vault.as_deref(),
                json_format,
            )
            .await
        }
        ValidatorCommands::Deactivate {
            dest_token_account,
            fee_payer,
            program,
            attestor_table,
            token_program,
            unclaimed_vault,
        } => {
            deactivate(
                config,
                &dest_token_account,
                fee_payer.as_deref(),
                program.as_deref(),
                attestor_table.as_deref(),
                token_program.as_deref(),
                unclaimed_vault.as_deref(),
                json_format,
            )
            .await
        }
        ValidatorCommands::ConvertTokens {
            source_token_account,
            token_amount,
            fee_payer,
            program,
            attestor_table,
            token_program,
            converted_vault,
        } => {
            convert_tokens(
                config,
                &source_token_account,
                token_amount,
                fee_payer.as_deref(),
                program.as_deref(),
                attestor_table.as_deref(),
                token_program.as_deref(),
                converted_vault.as_deref(),
                json_format,
            )
            .await
        }
        ValidatorCommands::Claim {
            subject_attestor,
            dest_token_account,
            fee_payer,
            program,
            attestor_table,
            token_program,
            unclaimed_vault,
        } => {
            claim(
                config,
                &subject_attestor,
                &dest_token_account,
                fee_payer.as_deref(),
                program.as_deref(),
                attestor_table.as_deref(),
                token_program.as_deref(),
                unclaimed_vault.as_deref(),
                json_format,
            )
            .await
        }
        ValidatorCommands::SetClaimAuthority {
            subject_attestor,
            new_claim_authority,
            fee_payer,
            program,
            attestor_table,
        } => {
            set_claim_authority(
                config,
                &subject_attestor,
                &new_claim_authority,
                fee_payer.as_deref(),
                program.as_deref(),
                attestor_table.as_deref(),
                json_format,
            )
            .await
        }
        ValidatorCommands::Table { attestor_table } => {
            show_validator_table(config, attestor_table.as_deref(), json_format).await
        }
        ValidatorCommands::Info {
            validator,
            attestor_table,
        } => show_validator_info(config, &validator, attestor_table.as_deref(), json_format).await,
    }
}

#[allow(clippy::too_many_arguments)]
async fn activate(
    config: &Config,
    source_token_account: &str,
    token_amount: u64,
    bls_pubkey: Option<&str>,
    bls_seed: Option<u64>,
    claim_authority: Option<&str>,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    converted_vault: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    ensure_nonzero_amount("activation", token_amount)?;

    let bls_pubkey = resolve_bls_pubkey(bls_pubkey, bls_seed)?;

    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        converted_vault,
        None,
    )?;
    let source_token_account = validate_address_or_hex(source_token_account)?;
    let validator_table = fetch_validator_table(config, attestor_table).await?;
    check_activate_turnover_window(&validator_table, token_amount)?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let claim_authority = match claim_authority {
        Some(value) => resolve_pubkey_or_key_name(config, value)?,
        None => context.fee_payer_keypair.public_key,
    };

    let transaction = TransactionBuilder::build_activate_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        source_token_account,
        bls_pubkey,
        claim_authority,
        token_amount,
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let fee_payer_address = context.fee_payer_keypair.address_string.to_string();
    let source_token_account_address = to_address_string(&source_token_account);
    let claim_authority_address = to_address_string(&claim_authority);

    if json_format {
        let response = serde_json::json!({
            "validator_activate": {
                "status": "success",
                "identity": fee_payer_address,
                "source_token_account": source_token_account_address,
                "claim_authority": claim_authority_address,
                "token_amount": token_amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Consensus validator activated successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Identity: {}", fee_payer_address);
        println!("Claim authority: {}", claim_authority_address);
    }

    Ok(())
}

async fn deactivate(
    config: &Config,
    dest_token_account: &str,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    unclaimed_vault: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        None,
        unclaimed_vault,
    )?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let dest_token_account = validate_address_or_hex(dest_token_account)?;

    let transaction = TransactionBuilder::build_deactivate_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        dest_token_account,
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let fee_payer_address = context.fee_payer_keypair.address_string.to_string();
    let dest_token_account_address = to_address_string(&dest_token_account);

    if json_format {
        let response = serde_json::json!({
            "validator_deactivate": {
                "status": "success",
                "identity": fee_payer_address,
                "dest_token_account": dest_token_account_address,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Consensus validator deactivated successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Identity: {}", fee_payer_address);
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn convert_tokens(
    config: &Config,
    source_token_account: &str,
    token_amount: u64,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    converted_vault: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    ensure_nonzero_amount("conversion", token_amount)?;

    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        converted_vault,
        None,
    )?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let source_token_account = validate_address_or_hex(source_token_account)?;

    let transaction = TransactionBuilder::build_convert_tokens_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        source_token_account,
        token_amount,
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let fee_payer_address = context.fee_payer_keypair.address_string.to_string();
    let source_token_account_address = to_address_string(&source_token_account);

    if json_format {
        let response = serde_json::json!({
            "validator_convert_tokens": {
                "status": "success",
                "identity": fee_payer_address,
                "source_token_account": source_token_account_address,
                "token_amount": token_amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Consensus validator stake increased successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Identity: {}", fee_payer_address);
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn claim(
    config: &Config,
    subject_attestor: &str,
    dest_token_account: &str,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    unclaimed_vault: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        None,
        unclaimed_vault,
    )?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let subject_attestor = resolve_pubkey_or_key_name(config, subject_attestor)?;
    let dest_token_account = validate_address_or_hex(dest_token_account)?;

    let transaction = TransactionBuilder::build_claim_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        subject_attestor,
        dest_token_account,
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let fee_payer_address = context.fee_payer_keypair.address_string.to_string();
    let dest_token_account_address = to_address_string(&dest_token_account);
    let subject_attestor_address = to_address_string(&subject_attestor);

    if json_format {
        let response = serde_json::json!({
            "validator_claim": {
                "status": "success",
                "claim_authority": fee_payer_address,
                "subject_attestor": subject_attestor_address,
                "dest_token_account": dest_token_account_address,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Consensus validator rewards claimed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Claim authority: {}", fee_payer_address);
        println!("Subject attestor: {}", subject_attestor_address);
    }

    Ok(())
}

async fn set_claim_authority(
    config: &Config,
    subject_attestor: &str,
    new_claim_authority: &str,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let accounts = resolve_consensus_accounts(config, program, attestor_table, None, None, None)?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let subject_attestor = resolve_pubkey_or_key_name(config, subject_attestor)?;
    let new_claim_authority = resolve_pubkey_or_key_name(config, new_claim_authority)?;

    let transaction = TransactionBuilder::build_set_claim_authority_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        subject_attestor,
        new_claim_authority,
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    let fee_payer_address = context.fee_payer_keypair.address_string.to_string();
    let subject_attestor_address = to_address_string(&subject_attestor);
    let new_claim_authority_address = to_address_string(&new_claim_authority);

    if json_format {
        let response = serde_json::json!({
            "validator_set_claim_authority": {
                "status": "success",
                "current_claim_authority": fee_payer_address,
                "subject_attestor": subject_attestor_address,
                "new_claim_authority": new_claim_authority_address,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Consensus validator claim authority updated successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Current claim authority: {}", fee_payer_address);
        println!("Subject attestor: {}", subject_attestor_address);
        println!("New claim authority: {}", new_claim_authority_address);
    }

    Ok(())
}

async fn show_validator_table(
    config: &Config,
    attestor_table: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let table = fetch_validator_table(config, attestor_table).await?;

    if json_format {
        let validators = table
            .validators
            .iter()
            .map(|validator| {
                serde_json::json!({
                    "sid": validator.sid,
                    "identity": to_address_string(&validator.identity),
                    "active": validator.active,
                    "weight": validator.weight,
                    "weight_source": validator.weight_source,
                    "claim_authority": to_address_string(&validator.claim_authority),
                    "unclaimed_tokens": validator.unclaimed_tokens,
                    "last_slot_updates": validator.last_slot_updates,
                    "last_id_updates": validator.last_id_updates,
                    "latest_weight_update_idx": validator.latest_weight_update_idx,
                    "bls_pubkey_hex": validator.bls_pubkey_hex,
                })
            })
            .collect::<Vec<_>>();

        let response = serde_json::json!({
            "validator_table": {
                "status": "success",
                "attestor_table": to_address_string(&table.attestor_table),
                "attestor_mint": to_address_string(&table.attestor_mint),
                "token_program": to_address_string(&table.token_program),
                "converted_vault": to_address_string(&table.converted_vault),
                "unclaimed_vault": to_address_string(&table.unclaimed_vault),
                "admin": to_address_string(&table.admin),
                "current_slot": table.current_slot,
                "account_slot": table.account_slot,
                "data_size": table.data_size,
                "server_count": table.server_count,
                "occupied_validators": table.occupied_validators,
                "delta1": table.delta1,
                "delta2": table.delta2,
                "frontier": table.frontier,
                "pending_decay": table.pending_decay,
                "last_decay_calc_slot": table.last_decay_calc_slot,
                "last_decay_emit_slot": table.last_decay_emit_slot,
                "last_processed_slot": table.last_processed_slot,
                "weight_updates_cnt": table.weight_updates_cnt,
                "total_weights_head": table.total_weights_head,
                "total_weights_tail": table.total_weights_tail,
                "blocks_per_faulty_turnover": table.blocks_per_faulty_turnover,
                "turnover_ring_head_slot": table.turnover_ring_head_slot,
                "turnover_sum_added": table.turnover_sum_added,
                "turnover_sum_removed": table.turnover_sum_removed,
                "turnover_limit": table.turnover_limit,
                "total_weight": table.total_weight,
                "validators": validators,
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Validator table: {}", to_address_string(&table.attestor_table));
        println!(
            "Current slot: {} | Frontier: {} | Validators: {}/{} | Total weight: {}",
            table.current_slot,
            table.frontier,
            table.occupied_validators,
            table.server_count,
            table.total_weight
        );
        if let Some(turnover_limit) = table.turnover_limit {
            println!(
                "Turnover window: {} slots | added={} removed={} limit={} | head_slot={}",
                table.blocks_per_faulty_turnover,
                table.turnover_sum_added,
                table.turnover_sum_removed,
                turnover_limit,
                table.turnover_ring_head_slot
            );
        }
        println!(
            "Mint: {} | Converted vault: {} | Unclaimed vault: {}",
            to_address_string(&table.attestor_mint),
            to_address_string(&table.converted_vault),
            to_address_string(&table.unclaimed_vault)
        );
        println!("SID  Identity                                        Weight      State    Claim authority");
        for validator in &table.validators {
            println!(
                "{:<4} {:<46} {:<10} {:<8} {}",
                validator.sid,
                to_address_string(&validator.identity),
                validator.weight,
                if validator.active { validator.weight_source } else { "inactive" },
                to_address_string(&validator.claim_authority)
            );
        }
    }

    Ok(())
}

async fn show_validator_info(
    config: &Config,
    validator: &str,
    attestor_table: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let table = fetch_validator_table(config, attestor_table).await?;
    let validator = resolve_validator_entry(&table, config, validator)?;

    if json_format {
        let response = serde_json::json!({
            "validator_info": {
                "status": "success",
                "attestor_table": to_address_string(&table.attestor_table),
                "current_slot": table.current_slot,
                "frontier": table.frontier,
                "blocks_per_faulty_turnover": table.blocks_per_faulty_turnover,
                "turnover_ring_head_slot": table.turnover_ring_head_slot,
                "turnover_sum_added": table.turnover_sum_added,
                "turnover_sum_removed": table.turnover_sum_removed,
                "turnover_limit": table.turnover_limit,
                "sid": validator.sid,
                "identity": to_address_string(&validator.identity),
                "active": validator.active,
                "weight": validator.weight,
                "weight_source": validator.weight_source,
                "claim_authority": to_address_string(&validator.claim_authority),
                "unclaimed_tokens": validator.unclaimed_tokens,
                "last_slot_updates": validator.last_slot_updates,
                "last_id_updates": validator.last_id_updates,
                "latest_weight_update_idx": validator.latest_weight_update_idx,
                "bls_pubkey_hex": validator.bls_pubkey_hex,
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Validator info: {}", to_address_string(&validator.identity));
        println!("SID: {}", validator.sid);
        println!("Attestor table: {}", to_address_string(&table.attestor_table));
        println!("Current slot: {}", table.current_slot);
        println!("Frontier: {}", table.frontier);
        if let Some(turnover_limit) = table.turnover_limit {
            println!(
                "Turnover window: {} slots | added={} removed={} limit={} | head_slot={}",
                table.blocks_per_faulty_turnover,
                table.turnover_sum_added,
                table.turnover_sum_removed,
                turnover_limit,
                table.turnover_ring_head_slot
            );
        }
        println!("Active: {}", if validator.active { "yes" } else { "no" });
        println!("Weight: {} ({})", validator.weight, validator.weight_source);
        println!("Claim authority: {}", to_address_string(&validator.claim_authority));
        println!("Unclaimed tokens: {}", validator.unclaimed_tokens);
        println!("Last slot updates: {}", validator.last_slot_updates);
        println!("Last id updates: {}", validator.last_id_updates);
        println!("Latest weight update idx: {}", validator.latest_weight_update_idx);
        println!("BLS pubkey hex: {}", validator.bls_pubkey_hex);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::KeyManager;
    use thru_base::txn_tools::{
        ATTESTOR_TABLE, CONSENSUS_VALIDATOR_PROGRAM, TOKEN_PROGRAM, UNCLAIMED_VAULT,
    };

    fn write_u64(buf: &mut [u8], offset: usize, value: u64) {
        buf[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn build_test_validator_table_bytes() -> Vec<u8> {
        let server_count = 2usize;
        let base_sm_off = CONSENSUS_VALIDATOR_STATE_HEADER_SIZE;
        let stake_slots_off = CONSENSUS_STATE_BASE_HEADER_SIZE;
        let base_weights_off = stake_slots_off + server_count * CONSENSUS_ATTESTOR_SEAT_SIZE;
        let total_weights_capacity = 25usize;
        let total_weights_off = base_weights_off + server_count * 8;
        let weight_updates_off = total_weights_off + total_weights_capacity * 8;
        let metadata_off =
            base_sm_off + weight_updates_off + server_count * CONSENSUS_WEIGHT_UPDATE_SIZE;
        let total_size = metadata_off + server_count * CONSENSUS_VALIDATOR_METADATA_SIZE;
        let mut data = vec![0u8; total_size];

        data[0..32].copy_from_slice(&[0x10u8; 32]);
        data[32..64].copy_from_slice(&[0x20u8; 32]);
        data[64..96].copy_from_slice(&[0x30u8; 32]);
        data[96..128].copy_from_slice(&[0x40u8; 32]);
        data[128..160].copy_from_slice(&[0x50u8; 32]);
        write_u64(&mut data, 160, server_count as u64);
        write_u64(&mut data, 168, base_sm_off as u64);
        write_u64(&mut data, 176, metadata_off as u64);
        write_u64(&mut data, 184, 7);
        write_u64(&mut data, 192, 8);
        write_u64(&mut data, 200, 9);
        write_u64(&mut data, 208, 10);

        write_u64(&mut data, base_sm_off, 16);
        write_u64(&mut data, base_sm_off + 8, 8);
        write_u64(&mut data, base_sm_off + 16, server_count as u64);
        write_u64(&mut data, base_sm_off + 24, 42);
        write_u64(&mut data, base_sm_off + 48, stake_slots_off as u64);
        write_u64(&mut data, base_sm_off + 56, base_weights_off as u64);
        write_u64(&mut data, base_sm_off + 64, total_weights_off as u64);
        write_u64(&mut data, base_sm_off + 80, weight_updates_off as u64);
        write_u64(&mut data, base_sm_off + 96, 0);
        write_u64(&mut data, base_sm_off + 112, 1);
        write_u64(&mut data, base_sm_off + 144, 0);
        write_u64(&mut data, base_sm_off + 152, 1);
        write_u64(&mut data, base_sm_off + 160, 0);
        write_u64(&mut data, base_sm_off + 168, u64::MAX);
        write_u64(&mut data, base_sm_off + 176, u64::MAX);
        write_u64(&mut data, base_sm_off + 184, u64::MAX);
        data[base_sm_off + 192..base_sm_off + 196].copy_from_slice(&12i32.to_le_bytes());
        write_u64(&mut data, base_sm_off + 200, 128);
        write_u64(&mut data, base_sm_off + 208, 2048);
        write_u64(&mut data, base_sm_off + 216, 0);
        write_u64(&mut data, base_sm_off + 224, 10);
        write_u64(&mut data, base_sm_off + 232, 0);

        let seat0_off = base_sm_off + stake_slots_off;
        data[seat0_off..seat0_off + 32].copy_from_slice(&[0x61u8; 32]);
        data[seat0_off + 32..seat0_off + 32 + BLS_PUBKEY_SIZE].copy_from_slice(&[0x77u8; 96]);
        write_u64(&mut data, seat0_off + 128, 111);
        write_u64(&mut data, seat0_off + 136, 222);
        write_u64(&mut data, seat0_off + 144, 3);

        let base_weights_start = base_sm_off + base_weights_off;
        write_u64(&mut data, base_weights_start, 50);

        let total_weights_start = base_sm_off + total_weights_off;
        write_u64(&mut data, total_weights_start, 50);

        let weight_updates_start = base_sm_off + weight_updates_off;
        write_u64(&mut data, weight_updates_start, 41);
        write_u64(&mut data, weight_updates_start + 8, 0);
        write_u64(&mut data, weight_updates_start + 16, 75);
        write_u64(&mut data, weight_updates_start + 24, 0);

        data[metadata_off..metadata_off + 32].copy_from_slice(&[0x88u8; 32]);
        write_u64(&mut data, metadata_off + 32, 5);

        data
    }

    fn create_test_config() -> Config {
        let mut keys = KeyManager::new();
        keys.add_key(
            "alice",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            false,
        )
        .unwrap();

        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:8080".to_string();
        config.keys = keys;
        config
    }

    #[test]
    fn derives_valid_bls_pubkey_from_seed() {
        let pubkey = derive_bls_pubkey_from_seed(17).expect("seed-derived BLS pubkey should parse");
        assert!(BlsPublicKey::deserialize(&pubkey).is_ok());
    }

    #[test]
    fn rejects_bls_pubkey_wrong_length() {
        let err =
            parse_bls_pubkey_hex(&"22".repeat(95)).expect_err("95-byte BLS pubkey should fail");
        assert!(err.to_string().contains("exactly 96 bytes"));
    }

    #[test]
    fn rejects_bls_pubkey_invalid_curve_point() {
        let err = parse_bls_pubkey_hex(&"11".repeat(96))
            .expect_err("random 96-byte BLS pubkey should fail validation");
        assert!(err.to_string().contains("valid uncompressed 96-byte BLS12-381 G1 point"));
    }

    #[test]
    fn resolves_bls_pubkey_from_seed() {
        let pubkey = resolve_bls_pubkey(None, Some(5)).expect("bls seed should resolve");
        assert!(BlsPublicKey::deserialize(&pubkey).is_ok());
    }

    #[test]
    fn resolves_pubkey_from_config_key_name() {
        let config = create_test_config();
        let resolved =
            resolve_pubkey_or_key_name(&config, "alice").expect("config key should resolve");
        assert_ne!(resolved, [0u8; 32]);
    }

    #[test]
    fn parses_validator_table_data() {
        let table = parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, Some(99))
            .expect("validator table should parse");

        assert_eq!(table.server_count, 2);
        assert_eq!(table.occupied_validators, 1);
        assert_eq!(table.frontier, 42);
        assert_eq!(table.total_weight, 75);
        assert_eq!(table.validators.len(), 1);
        assert_eq!(table.blocks_per_faulty_turnover, 128);
        assert_eq!(table.turnover_sum_added, 10);
        assert_eq!(table.turnover_limit, Some(9));

        let validator = &table.validators[0];
        assert_eq!(validator.sid, 0);
        assert_eq!(validator.weight, 75);
        assert_eq!(validator.weight_source, "pending");
        assert!(validator.active);
        assert_eq!(validator.unclaimed_tokens, 5);
    }

    #[test]
    fn resolves_validator_entry_by_sid() {
        let config = create_test_config();
        let table = parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
            .expect("validator table should parse");

        let validator =
            resolve_validator_entry(&table, &config, "0").expect("sid lookup should work");
        assert_eq!(validator.sid, 0);
    }

    #[test]
    fn rejects_activation_when_turnover_window_is_still_saturated() {
        let table = parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 6, None)
            .expect("validator table should parse");

        let err = check_activate_turnover_window(&table, 1)
            .expect_err("turnover-saturated activation should be rejected locally");
        let message = err.to_string();
        assert!(message.contains("turnover window"));
        assert!(message.contains("fresh chain"));
        assert!(message.contains("slot 128"));
    }

    #[test]
    fn resolves_consensus_accounts_with_overrides() {
        let config = create_test_config();
        let accounts = resolve_consensus_accounts(
            &config,
            Some("0000000000000000000000000000000000000000000000000000000000000c01"),
            None,
            Some("00000000000000000000000000000000000000000000000000000000000000aa"),
            None,
            Some("0000000000000000000000000000000000000000000000000000000000000c05"),
        )
        .expect("override accounts should resolve");

        assert_eq!(accounts.program, CONSENSUS_VALIDATOR_PROGRAM);
        assert_eq!(accounts.attestor_table, ATTESTOR_TABLE);
        assert_eq!(accounts.token_program, TOKEN_PROGRAM);
        assert_eq!(accounts.unclaimed_vault, UNCLAIMED_VAULT);
    }
}
