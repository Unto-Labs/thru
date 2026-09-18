//! Validator program command implementation

use crate::cli::ValidatorCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::validate_address_or_hex;
use base64::Engine;
use blst::min_pk::{PublicKey as BlsPublicKey, SecretKey as BlsSecretKey};
use std::mem::size_of;
use std::time::Duration;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::{ConsensusValidatorAccounts, TransactionBuilder};
use thru_client::{Client, ClientBuilder, TransactionDetails};

const CONSENSUS_VALIDATOR_FEE: u64 = 0;
const CONSENSUS_VALIDATOR_STATE_HEADER_SIZE: usize = 216;
const CONSENSUS_STATE_BASE_HEADER_SIZE: usize = 248;
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
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .announce_pending_signature(config.announce_pending_signature)
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

    let pubkey = BlsPublicKey::deserialize(&pubkey).map_err(|_| {
        CliError::Validation(
            "BLS public key must be a valid uncompressed 96-byte BLS12-381 G1 point".to_string(),
        )
    })?;

    Ok(bls_pubkey_affine_bytes(&pubkey))
}

/// Load a BLS private-key scalar from a `bls.json` file and return the first 32
/// bytes (the BLS scalar). Mirrors `tn_load_bls_private_key` (keys.c:247-329):
/// the file is a JSON byte array of 32 bytes (BLS-only) or 64 bytes (legacy
/// identity+BLS, first 32 used). Scalar validation (`blst_sk_check`, which
/// rejects zero / out-of-range) happens in the derivation helpers
/// (`derive_bls_pubkey_raw_from_key_file` / `derive_bls_serialized_from_key_file`).
fn load_bls_key_file(path: &str) -> Result<[u8; 32], CliError> {
    let contents = std::fs::read_to_string(path).map_err(|e| {
        CliError::Validation(format!("Failed to read BLS key file '{}': {}", path, e))
    })?;

    let bytes: Vec<u8> = serde_json::from_str(&contents).map_err(|e| {
        CliError::Validation(format!(
            "BLS key file '{}' must be a JSON array of byte values: {}",
            path, e
        ))
    })?;

    if bytes.len() != 32 && bytes.len() != 64 {
        return Err(CliError::Validation(format!(
            "BLS key file '{}' must contain 32 or 64 bytes, got {}",
            path,
            bytes.len()
        )));
    }

    let mut scalar = [0u8; 32];
    scalar.copy_from_slice(&bytes[..32]);
    Ok(scalar)
}

/// Derive the node's BLS public key from its `bls.json` in the **raw
/// `blst_p1_affine` struct** representation (Montgomery limbs), byte-for-byte
/// identical to what `keys_bls` prints and what genesis stores into each attestor
/// seat. This is the form shown by `validator table`/`info` and the one a `bls.json`
/// owner sees on-chain, so it is what `validator bls-pubkey` prints.
///
/// Replicates `tn_crypto_derive_pubkey` (tn_crypto.c:253): `blst_scalar_from_bendian`,
/// then `blst_sk_check`, `blst_sk_to_pk_in_g1`, and `blst_p1_to_affine`, then reads the
/// raw 96-byte affine exactly as `keys_bls` hex-encodes it
/// (`fd_hex_encode((uchar*)&bls_pubkey, 96)`, keys.c:352) and as genesis memcpys it
/// into the seat (tn_genesis_attestor.c:367).
///
/// NOTE: this is NOT `blst_p1_affine_serialize`'s canonical big-endian form. The
/// canonical form is what an ACTIVATE transaction must carry (see
/// `derive_bls_serialized_from_key_file`); the program deserializes it back into
/// this raw affine for storage.
fn derive_bls_pubkey_raw_from_key_file(path: &str) -> Result<[u8; 96], CliError> {
    let scalar_bytes = load_bls_key_file(path)?;

    /* SAFETY: every blst call below writes into a fully-owned, default-initialized
       value, and the scalar pointer references a 32-byte local array. The final
       read copies exactly sizeof(blst_p1_affine) == 96 bytes out of the affine. */
    unsafe {
        let mut scalar = blst::blst_scalar::default();
        blst::blst_scalar_from_bendian(&mut scalar, scalar_bytes.as_ptr());

        if !blst::blst_sk_check(&scalar) {
            return Err(CliError::Validation(format!(
                "BLS key file '{}' does not contain a valid BLS private key scalar (zero or out of range)",
                path
            )));
        }

        let mut pubkey_proj = blst::blst_p1::default();
        blst::blst_sk_to_pk_in_g1(&mut pubkey_proj, &scalar);

        let mut pubkey_affine = blst::blst_p1_affine::default();
        blst::blst_p1_to_affine(&mut pubkey_affine, &pubkey_proj);

        let mut raw = [0u8; 96];
        let affine_bytes = std::slice::from_raw_parts(
            (&pubkey_affine as *const blst::blst_p1_affine) as *const u8,
            96,
        );
        raw.copy_from_slice(affine_bytes);
        Ok(raw)
    }
}

/// Derive the node's BLS public key from its `bls.json` in the **canonical
/// uncompressed serialized** representation (`blst_p1_affine_serialize`, 96-byte
/// big-endian x||y). This is the form an ACTIVATE transaction must carry: the
/// consensus-validator program runs `tn_crypto_deserialize_pubkey` on the activate
/// argument (program line 561) before storing the raw affine into the seat — so
/// `--bls-key` activation must send this serialized form, exactly like a pasted
/// `--bls-pubkey` or a `--bls-seed`-derived key.
///
/// `BlsSecretKey::from_bytes` performs `blst_scalar_from_bendian` + `blst_sk_check`
/// (rejecting zero / out-of-range), and `sk_to_pk().serialize()` == the program's
/// expected canonical form.
fn derive_bls_serialized_from_key_file(path: &str) -> Result<[u8; 96], CliError> {
    let scalar = load_bls_key_file(path)?;
    let secret_key = BlsSecretKey::from_bytes(&scalar).map_err(|_| {
        CliError::Validation(format!(
            "BLS key file '{}' does not contain a valid BLS private key scalar (zero or out of range)",
            path
        ))
    })?;
    Ok(secret_key.sk_to_pk().serialize())
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

    Ok(bls_pubkey_affine_bytes(&secret_key.sk_to_pk()))
}

fn bls_pubkey_affine_bytes(pubkey: &BlsPublicKey) -> [u8; 96] {
    assert_eq!(size_of::<BlsPublicKey>(), 96);

    let mut bytes = [0u8; 96];
    let src = pubkey as *const BlsPublicKey as *const u8;
    unsafe {
        std::ptr::copy_nonoverlapping(src, bytes.as_mut_ptr(), bytes.len());
    }
    bytes
}

fn resolve_bls_pubkey(
    bls_pubkey: Option<&str>,
    bls_seed: Option<u64>,
    bls_key: Option<&str>,
) -> Result<[u8; 96], CliError> {
    match (bls_pubkey, bls_seed, bls_key) {
        (Some(value), None, None) => parse_bls_pubkey_hex(value),
        (None, Some(seed), None) => derive_bls_pubkey_from_seed(seed),
        /* The program deserializes the activate argument, so it must be the
           canonical serialized form — NOT the raw affine that `bls-pubkey` prints. */
        (None, None, Some(path)) => derive_bls_serialized_from_key_file(path),
        (None, None, None) => Err(CliError::Validation(
            "One of --bls-pubkey, --bls-seed, or --bls-key is required".to_string(),
        )),
        _ => Err(CliError::Validation(
            "Use only one of --bls-pubkey, --bls-seed, or --bls-key".to_string(),
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
    let frontier = read_u64(base_header, 32, "frontier")?;
    let stake_slots_off = read_u64(base_header, 56, "stake_slots_off")? as usize;
    let base_weights_off = read_u64(base_header, 64, "base_weights_off")? as usize;
    let total_weights_off = read_u64(base_header, 72, "total_weights_off")? as usize;
    let weight_updates_off = read_u64(base_header, 88, "weight_updates_off")? as usize;
    let weight_updates_head = read_u64(base_header, 104, "weight_updates_head")?;
    let weight_updates_cnt = read_u64(base_header, 120, "weight_updates_cnt")?;
    let total_weights_head = read_u64(base_header, 152, "total_weights_head")?;
    let total_weights_tail = read_u64(base_header, 160, "total_weights_tail")?;
    let blocks_per_faulty_turnover = read_u64(base_header, 208, "blocks_per_faulty_turnover")?;
    let turnover_ring_head_slot = read_u64(base_header, 224, "turnover_ring_head_slot")?;
    let turnover_sum_added = read_u64(base_header, 232, "turnover_sum_added")?;
    let turnover_sum_removed = read_u64(base_header, 240, "turnover_sum_removed")?;

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

/// Descriptive snapshot of the on-chain turnover window (no hypothetical amount).
/// `disabled` (turnover OFF), `unavailable` (limit not derivable) and a populated
/// window state are kept distinct — see `turnover_window_state`.
#[derive(Debug, Clone)]
enum TurnoverVerdict {
    /// `blocks_per_faulty_turnover == 0` → turnover is OFF on-chain.
    Disabled,
    /// `turnover_limit == None` → the CLI could not derive a usable total weight
    /// (NOT the same as disabled; see `parse_validator_table`).
    Unavailable,
    /// Limit known → descriptive current-window state.
    State(TurnoverWindow),
}

#[derive(Debug, Clone)]
struct TurnoverWindow {
    window_slots: u64,
    sum_added: u64,
    sum_removed: u64,
    limit: u64,
    headroom: u64,
    head_slot: u64,
    window_end_slot: Option<u64>,
    remaining_slots: Option<u64>,
    fresh_chain: bool,
}

/// Current turnover-window state (descriptive; never errors). `Disabled` vs
/// `Unavailable` are distinct: `turnover_limit == None` means the limit was not
/// derivable (`parse_validator_table` leaves it `None` when `total_weights_tail
/// <= total_weights_head` or the head weight is 0), NOT that turnover is off.
/// Turnover is only OFF when `blocks_per_faulty_turnover == 0`.
fn turnover_window_state(table: &ValidatorTable) -> TurnoverVerdict {
    if table.blocks_per_faulty_turnover == 0 {
        return TurnoverVerdict::Disabled;
    }

    let Some(limit) = table.turnover_limit else {
        return TurnoverVerdict::Unavailable;
    };

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

    TurnoverVerdict::State(TurnoverWindow {
        window_slots: table.blocks_per_faulty_turnover,
        sum_added: table.turnover_sum_added,
        sum_removed: table.turnover_sum_removed,
        limit,
        headroom: limit.saturating_sub(table.turnover_sum_added),
        head_slot: table.turnover_ring_head_slot,
        window_end_slot,
        remaining_slots,
        fresh_chain: table.current_slot < table.blocks_per_faulty_turnover,
    })
}

/// Activation-specific predicate (no `Err`). Models ONLY `turnover_sum_added`:
/// activation never touches `turnover_sum_removed` (deactivation does), matching
/// the existing activate pre-check. NOT a full turnover check.
fn turnover_accepts_activation(table: &ValidatorTable, added_weight: u64) -> bool {
    match table.turnover_limit {
        None => true,
        Some(limit) => table.turnover_sum_added.saturating_add(added_weight) <= limit,
    }
}

fn check_activate_turnover_window(table: &ValidatorTable, token_amount: u64) -> Result<(), CliError> {
    if turnover_accepts_activation(table, token_amount) {
        return Ok(());
    }

    /* turnover_accepts_activation only returns false when turnover_limit is Some,
       so the limit is known here. Build the rejection message from the window
       state, preserving the existing wording exactly. */
    let turnover_limit = table
        .turnover_limit
        .expect("turnover_accepts_activation returns true when the limit is unknown");
    let projected_added = table.turnover_sum_added.saturating_add(token_amount);

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

/// Optional lookup that distinguishes "bad input" from "valid identity, absent
/// from the table". Returns `Err` only when `validator` cannot be resolved to a
/// sid/pubkey at all (unknown key name / malformed address). `Ok(None)` means the
/// input resolved cleanly but no matching seat exists (NOT REGISTERED).
fn find_validator_entry<'a>(
    table: &'a ValidatorTable,
    config: &Config,
    validator: &str,
) -> Result<Option<&'a ValidatorEntry>, CliError> {
    if let Ok(sid) = validator.parse::<u64>() {
        return Ok(table.validators.iter().find(|entry| entry.sid == sid));
    }

    let identity = resolve_pubkey_or_key_name(config, validator)?;
    Ok(table.validators.iter().find(|entry| entry.identity == identity))
}

fn resolve_validator_entry<'a>(
    table: &'a ValidatorTable,
    config: &Config,
    validator: &str,
) -> Result<&'a ValidatorEntry, CliError> {
    match find_validator_entry(table, config, validator)? {
        Some(entry) => Ok(entry),
        None => {
            if let Ok(sid) = validator.parse::<u64>() {
                Err(CliError::Validation(format!("Validator SID {} not found", sid)))
            } else {
                Err(CliError::Validation(format!(
                    "Validator '{}' not found in table",
                    validator
                )))
            }
        }
    }
}

/// Resolve the pubkey shown by `validator status`. When the seat exists, use its
/// identity so a numeric sid still renders its pubkey. When absent, the input
/// must be re-resolved as a key name / address — but a bare numeric sid has no
/// pubkey to display, so report it as not registered rather than letting
/// `resolve_pubkey_or_key_name` fail with a confusing key-resolution error.
fn resolve_status_identity(
    entry: Option<&ValidatorEntry>,
    config: &Config,
    identity_input: &str,
) -> Result<[u8; 32], CliError> {
    match entry {
        Some(e) => Ok(e.identity),
        None => {
            if let Ok(sid) = identity_input.parse::<u64>() {
                return Err(CliError::Validation(format!(
                    "Validator SID {} is not registered",
                    sid
                )));
            }
            resolve_pubkey_or_key_name(config, identity_input)
        }
    }
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
            bls_key,
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
                bls_key.as_deref(),
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
        ValidatorCommands::BlsPubkey { bls_key } => {
            show_bls_pubkey(&bls_key, json_format)
        }
        ValidatorCommands::Status {
            identity,
            attestor_table,
        } => show_validator_status(config, identity.as_deref(), attestor_table.as_deref(), json_format).await,
    }
}

#[allow(clippy::too_many_arguments)]
async fn activate(
    config: &Config,
    source_token_account: &str,
    token_amount: u64,
    bls_pubkey: Option<&str>,
    bls_seed: Option<u64>,
    bls_key: Option<&str>,
    claim_authority: Option<&str>,
    fee_payer: Option<&str>,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    converted_vault: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    ensure_nonzero_amount("activation", token_amount)?;

    let bls_pubkey = resolve_bls_pubkey(bls_pubkey, bls_seed, bls_key)?;

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

/// `validator bls-pubkey --bls-key <bls.json>` — derive and print the node's BLS
/// public key from its `bls.json`. A `bls.json` carries no identity, so there is
/// no identity line; the BLS pubkey is rendered as bare lowercase 192-char hex
/// under `bls_pubkey_hex` (consistent with `info`/`table`).
fn show_bls_pubkey(bls_key: &str, json_format: bool) -> Result<(), CliError> {
    let bls_pubkey = derive_bls_pubkey_raw_from_key_file(bls_key)?;
    let bls_pubkey_hex = hex::encode(bls_pubkey);

    if json_format {
        let response = serde_json::json!({
            "validator_bls_pubkey": {
                "status": "success",
                "bls_pubkey_hex": bls_pubkey_hex,
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("bls-pubkey: {}", bls_pubkey_hex);
    }

    Ok(())
}

/// Render the turnover portion of `validator status`.
/// Human form: one line. JSON form: the `turnover` object pinned in the plan.
fn turnover_status_human(verdict: &TurnoverVerdict) -> String {
    match verdict {
        TurnoverVerdict::Disabled => "disabled (turnover off on-chain)".to_string(),
        TurnoverVerdict::Unavailable => "unavailable (limit not derivable)".to_string(),
        TurnoverVerdict::State(window) => {
            let mut line = format!(
                "{}/{} used, headroom {}",
                window.sum_added, window.limit, window.headroom
            );
            match (window.window_end_slot, window.remaining_slots) {
                (Some(end), Some(remaining)) => {
                    line.push_str(&format!(" (clears ~slot {}, in ~{} slots)", end, remaining));
                }
                (Some(end), None) => {
                    line.push_str(&format!(" (clears ~slot {})", end));
                }
                _ => {}
            }
            if window.fresh_chain {
                line.push_str(
                    "; fresh chain: the genesis activation still counts against the turnover budget until the initial window ages out",
                );
            }
            line
        }
    }
}

fn turnover_status_json(verdict: &TurnoverVerdict) -> serde_json::Value {
    match verdict {
        TurnoverVerdict::Disabled => serde_json::json!({ "state": "disabled" }),
        TurnoverVerdict::Unavailable => serde_json::json!({ "state": "unavailable" }),
        TurnoverVerdict::State(window) => serde_json::json!({
            "state": "ok",
            "window_slots": window.window_slots,
            "sum_added": window.sum_added,
            "sum_removed": window.sum_removed,
            "limit": window.limit,
            "headroom": window.headroom,
            "head_slot": window.head_slot,
            "window_end_slot": window.window_end_slot,
            "remaining_slots": window.remaining_slots,
            "fresh_chain": window.fresh_chain,
        }),
    }
}

/// Stable status label: `"active"` (registered + weight) / `"inactive"`
/// (registered, no weight) / `"not_registered"` (no seat).
fn status_label(entry: Option<&ValidatorEntry>) -> &'static str {
    match entry {
        None => "not_registered",
        Some(e) if e.active => "active",
        Some(_) => "inactive",
    }
}

/// Build the pinned `validator_status` JSON object. `registered=false` ⇒
/// `sid`/`claim_authority` null and `weight`/`unclaimed_tokens` 0.
fn validator_status_json(
    entry: Option<&ValidatorEntry>,
    identity_address: &str,
    verdict: &TurnoverVerdict,
) -> serde_json::Value {
    serde_json::json!({
        "status": status_label(entry),
        "registered": entry.is_some(),
        "identity": identity_address,
        "sid": entry.map(|e| e.sid),
        "weight": entry.map(|e| e.weight).unwrap_or(0),
        "unclaimed_tokens": entry.map(|e| e.unclaimed_tokens).unwrap_or(0),
        "claim_authority": entry.map(|e| to_address_string(&e.claim_authority)),
        "turnover": turnover_status_json(verdict),
    })
}

/// `validator status [--identity ..] [--attestor-table ..]` — operator-framed
/// view of this validator's seat plus the turnover-window verdict. Defaults to
/// the configured `default` key.
///
/// A malformed/unresolvable identity is a CLI error. A key name or address that
/// resolves but holds no seat renders NOT REGISTERED against its own pubkey. A
/// bare numeric sid with no seat is the one exception: the view always prints an
/// identity pubkey, and an unseated sid is a table index that names no key, so it
/// is reported as a not-registered error rather than rendered (see
/// `resolve_status_identity`).
async fn show_validator_status(
    config: &Config,
    identity: Option<&str>,
    attestor_table: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let identity_input = identity.unwrap_or("default");
    let table = fetch_validator_table(config, attestor_table).await?;
    /* find_validator_entry errors only on unresolvable input (unknown key name /
       malformed address); Ok(None) is a resolved-but-absent identity. */
    let entry = find_validator_entry(&table, config, identity_input)?;
    /* The identity is always shown. Prefer the seat's identity when found (so a
       numeric sid still resolves to its pubkey); a bare sid with no seat is
       reported as not registered rather than as a key-resolution failure. */
    let identity_pubkey = resolve_status_identity(entry, config, identity_input)?;
    let identity_address = to_address_string(&identity_pubkey);
    let key_name = if config.keys.get_key(identity_input).is_ok() {
        Some(identity_input.to_string())
    } else {
        None
    };
    let verdict = turnover_window_state(&table);

    if json_format {
        let response = serde_json::json!({
            "validator_status": validator_status_json(entry, &identity_address, &verdict),
        });
        crate::output::print_output(response, true);
    } else {
        println!(
            "validator status (table {} @ slot {})",
            to_address_string(&table.attestor_table),
            table.current_slot
        );
        let identity_suffix = match &key_name {
            Some(name) => format!("   (key: {})", name),
            None => String::new(),
        };
        println!("  identity:          {}{}", identity_address, identity_suffix);
        match entry {
            None => {
                println!("  status:            NOT REGISTERED");
            }
            Some(e) => {
                println!(
                    "  status:            {} (sid {})",
                    if e.active { "ACTIVE" } else { "INACTIVE" },
                    e.sid
                );
                println!("  weight:            {}", e.weight);
                println!(
                    "  unclaimed rewards: {}  (vault {})",
                    e.unclaimed_tokens,
                    to_address_string(&table.unclaimed_vault)
                );
                let claim_authority_address = to_address_string(&e.claim_authority);
                let claim_suffix = if e.claim_authority == e.identity {
                    "   (= identity)"
                } else {
                    ""
                };
                println!("  claim authority:   {}{}", claim_authority_address, claim_suffix);
            }
        }
        println!("  turnover window:   {}", turnover_status_human(&verdict));
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
        write_u64(&mut data, base_sm_off + 24, 64);
        write_u64(&mut data, base_sm_off + 32, 42);
        write_u64(&mut data, base_sm_off + 56, stake_slots_off as u64);
        write_u64(&mut data, base_sm_off + 64, base_weights_off as u64);
        write_u64(&mut data, base_sm_off + 72, total_weights_off as u64);
        write_u64(&mut data, base_sm_off + 88, weight_updates_off as u64);
        write_u64(&mut data, base_sm_off + 104, 0);
        write_u64(&mut data, base_sm_off + 120, 1);
        write_u64(&mut data, base_sm_off + 152, 0);
        write_u64(&mut data, base_sm_off + 160, 1);
        write_u64(&mut data, base_sm_off + 168, 0);
        write_u64(&mut data, base_sm_off + 176, u64::MAX);
        write_u64(&mut data, base_sm_off + 184, u64::MAX);
        write_u64(&mut data, base_sm_off + 192, u64::MAX);
        data[base_sm_off + 200..base_sm_off + 204].copy_from_slice(&12i32.to_le_bytes());
        write_u64(&mut data, base_sm_off + 208, 128);
        write_u64(&mut data, base_sm_off + 216, 2048);
        write_u64(&mut data, base_sm_off + 224, 0);
        write_u64(&mut data, base_sm_off + 232, 10);
        write_u64(&mut data, base_sm_off + 240, 0);

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

    const BLS_SEED_17_AFFINE_BYTES: [u8; 96] = [
        0x3c, 0xf2, 0xe8, 0xc1, 0xb7, 0xd9, 0x10, 0xe2, 0xec, 0x87, 0xe7, 0xf5, 0x23, 0x93,
        0x25, 0x97, 0x38, 0x6d, 0xcf, 0xca, 0xba, 0x00, 0xae, 0xc0, 0x78, 0xa3, 0x71, 0xf2,
        0xf5, 0xae, 0xbc, 0xee, 0x14, 0xf6, 0xca, 0xff, 0xae, 0x86, 0x5a, 0x2c, 0x4e, 0x6e,
        0x3e, 0x0f, 0x52, 0x91, 0xe1, 0x19, 0x75, 0xa3, 0x33, 0x2d, 0x96, 0x57, 0x94, 0xea,
        0x10, 0x85, 0xb5, 0x7c, 0x4b, 0x8c, 0xd9, 0xef, 0x55, 0xda, 0x48, 0x9e, 0xc7, 0x71,
        0xfa, 0x68, 0xd9, 0xa8, 0x91, 0x95, 0x21, 0xc3, 0x62, 0xe0, 0xb6, 0xb2, 0x8f, 0x49,
        0x7b, 0xe4, 0xf6, 0x93, 0x79, 0xea, 0xfd, 0x60, 0xe7, 0x00, 0xf3, 0x18,
    ];

    const BLS_SEED_5_AFFINE_BYTES: [u8; 96] = [
        0xfb, 0xd2, 0xdb, 0x25, 0x26, 0x52, 0x6d, 0x9b, 0x14, 0xc0, 0xad, 0x08, 0xe7, 0x70,
        0x0a, 0x70, 0x13, 0xc0, 0x10, 0x85, 0xec, 0xbd, 0x3b, 0xed, 0x9f, 0x22, 0x0e, 0xdb,
        0x55, 0xe9, 0xce, 0xcb, 0x9f, 0x9c, 0xf1, 0x2e, 0x0c, 0x57, 0xf9, 0x20, 0xe7, 0xd6,
        0xb3, 0x17, 0xf5, 0xc5, 0x47, 0x09, 0xfb, 0x42, 0xa6, 0xc4, 0xfa, 0x4d, 0x81, 0x33,
        0xd0, 0x34, 0x05, 0x5d, 0x3d, 0xaa, 0x13, 0x8a, 0xef, 0xa9, 0xb6, 0x8a, 0x59, 0xc8,
        0x35, 0x1d, 0x9c, 0x1d, 0xfe, 0x9d, 0x83, 0x3a, 0xf9, 0x48, 0xcf, 0xcd, 0xbd, 0x2f,
        0x21, 0xbe, 0x71, 0x94, 0xde, 0xde, 0x8b, 0xaf, 0xb5, 0x28, 0x18, 0x18,
    ];

    #[test]
    fn derives_valid_bls_pubkey_from_seed() {
        let pubkey = derive_bls_pubkey_from_seed(17).expect("seed-derived BLS pubkey should parse");
        assert_eq!(pubkey, BLS_SEED_17_AFFINE_BYTES);
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
        let pubkey = resolve_bls_pubkey(None, Some(5), None).expect("bls seed should resolve");
        assert_eq!(pubkey, BLS_SEED_5_AFFINE_BYTES);
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

    // ----------------------------------------------------------------------
    // BLS key-file derivation
    //
    // Fixed vectors (checked in, generated offline / cross-checked against the
    // running genesis node via the e2e `validator` scenario, test 8):
    //   * scalar = 1 (big-endian [0,..,0,1]) — the BLS12-381 G1 generator.
    //     - canonical serialize == the well-known G1 generator (independent of
    //       this code; from the BLS12-381 spec) — proves the scalar->point math.
    //     - raw affine == the in-memory blst_p1_affine (Montgomery) form printed
    //       by `keys_bls`/shown on-chain — the form `validator bls-pubkey` emits.
    // The raw vs serialized split mirrors the on-chain reality: seats store the
    // raw affine, but an ACTIVATE arg carries the canonical form (the program
    // deserializes it).
    // ----------------------------------------------------------------------

    /// BLS12-381 G1 generator, uncompressed canonical (x||y). This is a spec
    /// constant, NOT produced by the code under test.
    const G1_GENERATOR_UNCOMPRESSED: &str = "17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1";

    /// Raw in-memory `blst_p1_affine` (Montgomery) form of the generator — the
    /// representation `keys_bls` hex-encodes and genesis stores in each seat.
    const G1_GENERATOR_RAW_AFFINE: &str = "160c53fd9087b35cf5ff769967fc1778c1a13b14c7954f1547e7d0f3cd6aaef040f4db21cc6eceed75fb0b9e417701127122e70cd593acba8efd18791a63228cce250757135f59dd945140502958ac51c05900ad3f8c1c0e6aa20850fc3ebc0b";

    fn write_bls_key_file(bytes: &[u8]) -> tempfile::NamedTempFile {
        use std::io::Write;
        let json = format!(
            "[{}]",
            bytes
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut file = tempfile::NamedTempFile::new().expect("temp bls.json");
        file.write_all(json.as_bytes()).expect("write bls.json");
        file.flush().expect("flush bls.json");
        file
    }

    fn scalar_one_bytes() -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[31] = 1;
        bytes
    }

    #[test]
    fn derive_bls_serialized_matches_g1_generator_for_scalar_one() {
        let file = write_bls_key_file(&scalar_one_bytes());
        let serialized = derive_bls_serialized_from_key_file(file.path().to_str().unwrap())
            .expect("scalar 1 should derive");
        assert_eq!(hex::encode(serialized), G1_GENERATOR_UNCOMPRESSED);
    }

    #[test]
    fn derive_bls_raw_affine_for_scalar_one() {
        let file = write_bls_key_file(&scalar_one_bytes());
        let raw = derive_bls_pubkey_raw_from_key_file(file.path().to_str().unwrap())
            .expect("scalar 1 should derive");
        assert_eq!(hex::encode(raw), G1_GENERATOR_RAW_AFFINE);
    }

    #[test]
    fn bls_raw_and_serialized_forms_differ() {
        // The two representations of the same key must not be confused: the seat
        // (raw) and the ACTIVATE wire arg (serialized) are different byte strings.
        let file = write_bls_key_file(&scalar_one_bytes());
        let path = file.path().to_str().unwrap();
        let raw = derive_bls_pubkey_raw_from_key_file(path).unwrap();
        let serialized = derive_bls_serialized_from_key_file(path).unwrap();
        assert_ne!(raw, serialized);
    }

    #[test]
    fn derive_bls_is_deterministic() {
        let file = write_bls_key_file(&scalar_one_bytes());
        let path = file.path().to_str().unwrap();
        let first = derive_bls_pubkey_raw_from_key_file(path).unwrap();
        let second = derive_bls_pubkey_raw_from_key_file(path).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn load_bls_key_file_accepts_64_byte_legacy_and_uses_first_32() {
        let mut legacy = vec![0u8; 64];
        legacy[31] = 1; // first 32 = scalar 1
        legacy[63] = 9; // trailing identity bytes are ignored
        let file = write_bls_key_file(&legacy);
        let raw = derive_bls_pubkey_raw_from_key_file(file.path().to_str().unwrap())
            .expect("legacy 64-byte file should derive from first 32 bytes");
        assert_eq!(hex::encode(raw), G1_GENERATOR_RAW_AFFINE);
    }

    #[test]
    fn load_bls_key_file_rejects_zero_scalar() {
        let file = write_bls_key_file(&[0u8; 32]);
        let err = derive_bls_pubkey_raw_from_key_file(file.path().to_str().unwrap())
            .expect_err("zero scalar must be rejected by blst_sk_check");
        assert!(err.to_string().contains("valid BLS private key scalar"));
    }

    #[test]
    fn load_bls_key_file_rejects_wrong_length() {
        let file = write_bls_key_file(&[1u8; 33]);
        let err = load_bls_key_file(file.path().to_str().unwrap())
            .expect_err("33-byte array must be rejected");
        assert!(err.to_string().contains("32 or 64 bytes"));
    }

    #[test]
    fn load_bls_key_file_rejects_missing_file() {
        let err = load_bls_key_file("/nonexistent/path/to/bls.json")
            .expect_err("missing file must be rejected");
        assert!(err.to_string().contains("Failed to read BLS key file"));
    }

    #[test]
    fn load_bls_key_file_rejects_non_array_json() {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"\"not an array\"").unwrap();
        file.flush().unwrap();
        let err = load_bls_key_file(file.path().to_str().unwrap())
            .expect_err("non-array JSON must be rejected");
        assert!(err.to_string().contains("JSON array of byte values"));
    }

    #[test]
    fn resolve_bls_pubkey_from_key_file_uses_serialized_form() {
        // `--bls-key` feeds activation, so it must produce the canonical form.
        let file = write_bls_key_file(&scalar_one_bytes());
        let resolved = resolve_bls_pubkey(None, None, Some(file.path().to_str().unwrap()))
            .expect("bls-key should resolve");
        assert_eq!(hex::encode(resolved), G1_GENERATOR_UNCOMPRESSED);
    }

    #[test]
    fn resolve_bls_pubkey_rejects_multiple_sources() {
        let err = resolve_bls_pubkey(Some("aa"), Some(1), None)
            .expect_err("two BLS sources must be rejected");
        assert!(err.to_string().contains("only one"));
    }

    #[test]
    fn resolve_bls_pubkey_rejects_no_source() {
        let err =
            resolve_bls_pubkey(None, None, None).expect_err("no BLS source must be rejected");
        assert!(err.to_string().contains("is required"));
    }

    // ----------------------------------------------------------------------
    // find_validator_entry: Err (bad input) vs Ok(None) (absent) vs Ok(Some)
    // ----------------------------------------------------------------------

    #[test]
    fn find_validator_entry_returns_some_for_known_sid() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        let entry = find_validator_entry(&table, &config, "0").expect("lookup ok");
        assert_eq!(entry.map(|e| e.sid), Some(0));
    }

    #[test]
    fn find_validator_entry_returns_none_for_absent_sid() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        // sid 9999 resolves fine (numeric) but is absent -> Ok(None), NOT Err.
        let entry = find_validator_entry(&table, &config, "9999").expect("absent sid is Ok(None)");
        assert!(entry.is_none());
    }

    #[test]
    fn find_validator_entry_returns_none_for_resolvable_but_absent_identity() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        // `alice` is a configured key (resolves) but is not in the table -> Ok(None).
        let entry =
            find_validator_entry(&table, &config, "alice").expect("resolvable-but-absent is Ok(None)");
        assert!(entry.is_none());
    }

    #[test]
    fn find_validator_entry_errors_on_unresolvable_input() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        let err = find_validator_entry(&table, &config, "definitely-not-a-key")
            .expect_err("unknown key name must Err, not Ok(None)");
        assert!(err.to_string().contains("neither a valid public key nor a configured key name"));
    }

    #[test]
    fn resolve_validator_entry_preserves_not_found_messages() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        let sid_err = resolve_validator_entry(&table, &config, "9999").unwrap_err();
        assert!(sid_err.to_string().contains("Validator SID 9999 not found"));
        let name_err = resolve_validator_entry(&table, &config, "alice").unwrap_err();
        assert!(name_err.to_string().contains("Validator 'alice' not found in table"));
    }

    // ----------------------------------------------------------------------
    // resolve_status_identity: which pubkey `validator status` displays, and
    // the not-registered messaging for the three None shapes (sid / key / addr).
    // ----------------------------------------------------------------------

    #[test]
    fn status_identity_uses_seat_identity_for_known_sid() {
        let config = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        let entry = find_validator_entry(&table, &config, "0").expect("lookup ok");
        let pubkey = resolve_status_identity(entry, &config, "0")
            .expect("registered sid resolves to its seat identity");
        assert_eq!(pubkey, table.validators[0].identity);
    }

    #[test]
    fn status_identity_reports_not_registered_for_absent_sid() {
        let config = create_test_config();
        // A bare numeric sid with no seat has no pubkey to display: it must report
        // "not registered" rather than the confusing key-resolution failure that
        // resolve_pubkey_or_key_name would otherwise produce for "9999".
        let err = resolve_status_identity(None, &config, "9999")
            .expect_err("absent sid must be a clean not-registered error");
        let msg = err.to_string();
        assert!(msg.contains("Validator SID 9999 is not registered"), "got: {msg}");
        assert!(
            !msg.contains("neither a valid public key"),
            "must not leak the key-resolution error: {msg}"
        );
    }

    #[test]
    fn status_identity_resolves_absent_but_known_key_name() {
        let config = create_test_config();
        // `alice` resolves (configured key) but has no seat: NOT REGISTERED is
        // rendered against alice's real pubkey, so the identity must resolve.
        let pubkey = resolve_status_identity(None, &config, "alice")
            .expect("resolvable-but-absent key name still yields a pubkey to show");
        assert_ne!(pubkey, [0u8; 32]);
    }

    #[test]
    fn status_identity_errors_on_unresolvable_key_name() {
        let config = create_test_config();
        let err = resolve_status_identity(None, &config, "definitely-not-a-key")
            .expect_err("unknown key name must error");
        assert!(err
            .to_string()
            .contains("neither a valid public key nor a configured key name"));
    }

    // ----------------------------------------------------------------------
    // turnover window: disabled / unavailable / state, and activation predicate
    // ----------------------------------------------------------------------

    fn table_with_turnover(
        blocks_per_faulty_turnover: u64,
        turnover_limit: Option<u64>,
        turnover_sum_added: u64,
        turnover_ring_head_slot: u64,
        current_slot: u64,
    ) -> ValidatorTable {
        ValidatorTable {
            attestor_table: [0u8; 32],
            attestor_mint: [0u8; 32],
            token_program: [0u8; 32],
            converted_vault: [0u8; 32],
            unclaimed_vault: [0u8; 32],
            admin: [0u8; 32],
            current_slot,
            account_slot: None,
            data_size: 0,
            server_count: 0,
            occupied_validators: 0,
            delta1: 0,
            delta2: 0,
            frontier: 0,
            pending_decay: 0,
            last_decay_calc_slot: 0,
            last_decay_emit_slot: 0,
            last_processed_slot: 0,
            weight_updates_cnt: 0,
            total_weights_head: 0,
            total_weights_tail: 0,
            blocks_per_faulty_turnover,
            turnover_ring_head_slot,
            turnover_sum_added,
            turnover_sum_removed: 0,
            turnover_limit,
            total_weight: 0,
            validators: Vec::new(),
        }
    }

    #[test]
    fn turnover_window_state_disabled_when_window_zero() {
        let table = table_with_turnover(0, Some(100), 10, 0, 50);
        assert!(matches!(turnover_window_state(&table), TurnoverVerdict::Disabled));
    }

    #[test]
    fn turnover_window_state_unavailable_when_limit_none() {
        // Window is on (non-zero) but the limit could not be derived.
        let table = table_with_turnover(100, None, 10, 0, 50);
        assert!(matches!(turnover_window_state(&table), TurnoverVerdict::Unavailable));
    }

    #[test]
    fn turnover_window_state_describes_active_window() {
        let table = table_with_turnover(100, Some(100), 72, 8880, 8880);
        match turnover_window_state(&table) {
            TurnoverVerdict::State(window) => {
                assert_eq!(window.window_slots, 100);
                assert_eq!(window.sum_added, 72);
                assert_eq!(window.limit, 100);
                assert_eq!(window.headroom, 28);
                assert_eq!(window.head_slot, 8880);
                assert_eq!(window.window_end_slot, Some(8980));
                assert_eq!(window.remaining_slots, Some(100));
                assert!(!window.fresh_chain);
            }
            other => panic!("expected State, got {:?}", other),
        }
    }

    #[test]
    fn turnover_window_state_flags_fresh_chain_and_no_slot_head() {
        // current_slot < window -> fresh chain; head == NO_SLOT -> no end slot.
        let table = table_with_turnover(256, Some(199999), 1000000, CONSENSUS_STATE_NO_SLOT, 6);
        match turnover_window_state(&table) {
            TurnoverVerdict::State(window) => {
                assert!(window.fresh_chain);
                assert_eq!(window.window_end_slot, None);
                assert_eq!(window.remaining_slots, None);
                assert_eq!(window.headroom, 0); // saturating_sub: 199999 - 1000000
            }
            other => panic!("expected State, got {:?}", other),
        }
    }

    #[test]
    fn turnover_accepts_activation_semantics() {
        let table = table_with_turnover(100, Some(100), 72, 0, 50);
        assert!(turnover_accepts_activation(&table, 28)); // 72 + 28 == 100
        assert!(!turnover_accepts_activation(&table, 29)); // 72 + 29 > 100
        // Unknown limit never blocks client-side.
        let unknown = table_with_turnover(100, None, 72, 0, 50);
        assert!(turnover_accepts_activation(&unknown, u64::MAX));
    }

    #[test]
    fn turnover_status_json_shapes() {
        let disabled = turnover_status_json(&TurnoverVerdict::Disabled);
        assert_eq!(disabled["state"], "disabled");
        let unavailable = turnover_status_json(&TurnoverVerdict::Unavailable);
        assert_eq!(unavailable["state"], "unavailable");

        let table = table_with_turnover(100, Some(100), 72, 8880, 8880);
        let state = turnover_status_json(&turnover_window_state(&table));
        assert_eq!(state["state"], "ok");
        assert_eq!(state["limit"], 100);
        assert_eq!(state["headroom"], 28);
        assert_eq!(state["window_end_slot"], 8980);
    }

    #[test]
    fn turnover_status_human_forms() {
        assert!(turnover_status_human(&TurnoverVerdict::Disabled).contains("disabled"));
        assert!(turnover_status_human(&TurnoverVerdict::Unavailable).contains("unavailable"));
        let table = table_with_turnover(100, Some(100), 72, 8880, 8880);
        let line = turnover_status_human(&turnover_window_state(&table));
        assert!(line.contains("72/100 used"));
        assert!(line.contains("headroom 28"));
        assert!(line.contains("clears ~slot 8980"));
    }

    // ----------------------------------------------------------------------
    // status classification + JSON shape: active / inactive / not_registered
    // ----------------------------------------------------------------------

    fn sample_entry(active: bool) -> ValidatorEntry {
        ValidatorEntry {
            sid: 7,
            identity: [0x61u8; 32],
            bls_pubkey_hex: "ab".repeat(96),
            claim_authority: [0x88u8; 32],
            unclaimed_tokens: 420,
            weight: if active { 1_000_000 } else { 0 },
            weight_source: if active { "base" } else { "inactive" },
            last_slot_updates: 0,
            last_id_updates: 0,
            latest_weight_update_idx: 0,
            active,
        }
    }

    #[test]
    fn status_label_classifies_all_states() {
        assert_eq!(status_label(None), "not_registered");
        assert_eq!(status_label(Some(&sample_entry(true))), "active");
        assert_eq!(status_label(Some(&sample_entry(false))), "inactive");
    }

    #[test]
    fn validator_status_json_active() {
        let entry = sample_entry(true);
        let verdict = TurnoverVerdict::Disabled;
        let json = validator_status_json(Some(&entry), "ta_identity", &verdict);
        assert_eq!(json["status"], "active");
        assert_eq!(json["registered"], true);
        assert_eq!(json["identity"], "ta_identity");
        assert_eq!(json["sid"], 7);
        assert_eq!(json["weight"], 1_000_000);
        assert_eq!(json["unclaimed_tokens"], 420);
        assert_eq!(json["claim_authority"], to_address_string(&[0x88u8; 32]));
        assert_eq!(json["turnover"]["state"], "disabled");
    }

    #[test]
    fn validator_status_json_inactive() {
        let entry = sample_entry(false);
        let json = validator_status_json(Some(&entry), "ta_identity", &TurnoverVerdict::Disabled);
        assert_eq!(json["status"], "inactive");
        assert_eq!(json["registered"], true);
        assert_eq!(json["weight"], 0);
    }

    #[test]
    fn validator_status_json_not_registered() {
        let json = validator_status_json(None, "ta_identity", &TurnoverVerdict::Disabled);
        assert_eq!(json["status"], "not_registered");
        assert_eq!(json["registered"], false);
        assert_eq!(json["identity"], "ta_identity");
        assert!(json["sid"].is_null());
        assert!(json["claim_authority"].is_null());
        assert_eq!(json["weight"], 0);
        assert_eq!(json["unclaimed_tokens"], 0);
    }
}
