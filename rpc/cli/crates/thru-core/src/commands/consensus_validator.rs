//! Validator program command implementation

use crate::cli::{
    SelfServiceState, ValidatorCommands, ValidatorManagerCommands, ValidatorManagerTarget,
    ViaMultisigArgs,
};
use crate::config::Config;
use crate::error::CliError;
use crate::keys::LoadedKey;
use crate::utils::validate_address_or_hex;
use base64::Engine;
#[cfg(test)]
use blst::min_pk::Signature as BlsSignature;
use blst::min_pk::{PublicKey as BlsPublicKey, SecretKey as BlsSecretKey};
use std::sync::Arc;
use std::time::Duration;
use thru_base::tn_tools::Pubkey;
use thru_base::txn_lib::Transaction;
#[cfg(test)]
use thru_base::txn_tools::CONSENSUS_VALIDATOR_POP_DST as BLS_POP_DST;
use thru_base::txn_tools::bls_activation_key;
use thru_base::txn_tools::{ConsensusValidatorAccounts, TransactionBuilder};
use thru_base::txn_tools::{
    CvStakeParams, build_cv_init_validator_manager_instruction,
    build_cv_manager_activate_instruction, build_cv_manager_deactivate_instruction,
    build_cv_manager_set_weight_instruction, build_cv_set_params_instruction,
    build_cv_set_self_service_instruction, build_cv_set_validator_manager_instruction,
};
use thru_client::{Client, ClientBuilder, TransactionDetails};

const CONSENSUS_VALIDATOR_FEE: u64 = 0;
/* tn_consensus_validator_state_t: packed, account_type
(TN_CONSENSUS_VALIDATOR_ACCOUNT_TYPE_ATTESTOR_TABLE_V1) at byte 0, then the
281 bytes of header fields (wthru_mint @33, validator_manager @129,
stake_units_per_weight @225, min_stake @233, max_decay_bps @241,
idle_gap_decay_bps @249, max_idle_gap_decay_bps @257,
attestor_decay_fraction_bps @265, pending_idle_slots @273,
self_service_disabled @281), then header_reserved (@282 to the end of the
header). The header is exactly one 4096-byte page (TN_CV_HEADER_SZ).
header_reserved is reserved for future header fields, always zero and
ignored here; new fields take their bytes from the front of it, so the base
state machine stays at base_sm_off 4096. The account is variable size (the
base state machine, metadata and pending map follow at the offsets the
header records). */
const CONSENSUS_VALIDATOR_STATE_HEADER_SIZE: usize = 4096;
const CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET: usize = 281;
/* Only the tests read it: the reader ignores header_reserved. */
#[cfg(test)]
const CONSENSUS_VALIDATOR_HEADER_RESERVED_OFFSET: usize = 282;
const CONSENSUS_VALIDATOR_ACCOUNT_TYPE_ATTESTOR_TABLE_V1: u8 = 1;
const CONSENSUS_STATE_BASE_HEADER_SIZE: usize = 248;
// Identity, BLS key, and four u64 update indexes/timestamps.
const CONSENSUS_ATTESTOR_SEAT_SIZE: usize = 32 + 96 + 4 * 8;
const CONSENSUS_VALIDATOR_METADATA_SIZE: usize = 40;
const CONSENSUS_WEIGHT_UPDATE_SIZE: usize = 32;
const BLS_PUBKEY_SIZE: usize = 96;
const CONSENSUS_STATE_NO_SLOT: u64 = u64::MAX;

#[derive(Debug, Clone)]
struct ValidatorTable {
    attestor_table: [u8; 32],
    wthru_mint: [u8; 32],
    token_program: [u8; 32],
    converted_vault: [u8; 32],
    unclaimed_vault: [u8; 32],
    validator_manager: [u8; 32],
    self_service_disabled: bool,
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
    last_processed_slot: u64,
    pending_map_off: u64,
    pending_cap: u64,
    stake_units_per_weight: u64,
    min_stake: u64,
    max_decay_bps: u64,
    idle_gap_decay_bps: u64,
    max_idle_gap_decay_bps: u64,
    attestor_decay_fraction_bps: u64,
    pending_idle_slots: u64,
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

fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    ClientBuilder::new()
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.rpc_auth_token())
        .announce_pending_signature(config.announce_pending_signature)
        .build()
        .map_err(Into::into)
}

struct TransactionContext {
    fee_payer_keypair: Arc<LoadedKey>,
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
    let fee_payer_keypair = config.keys.load_fee_payer(fee_payer)?;
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
        start_slot: block_height.locally_executed_height,
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
    crate::signing::sign_transaction(&mut transaction, &context.fee_payer_keypair)
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
    config.keys.resolve_public_key(value)
}

/// The program, attestor table and token program a consensus transaction
/// names, plus `vaults` (converted, unclaimed) from [`resolve_vaults`].
/// Instructions that name no vault (SetClaimAuthority) pass `None`; their
/// vault fields stay zero and are never sent.
fn resolve_consensus_accounts(
    config: &Config,
    program: Option<&str>,
    attestor_table: Option<&str>,
    token_program: Option<&str>,
    vaults: Option<([u8; 32], [u8; 32])>,
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
    let (converted_vault, unclaimed_vault) = vaults.unwrap_or(([0u8; 32], [0u8; 32]));

    Ok(ConsensusValidatorAccounts {
        program: resolve_override_account(program, default_program)?,
        attestor_table: resolve_override_account(attestor_table, default_attestor_table)?,
        token_program: resolve_override_account(token_program, default_token_program)?,
        converted_vault,
        unclaimed_vault,
    })
}

/// The vaults (converted, unclaimed) a consensus transaction names, read from
/// the attestor table header: the program pins every vault index to the
/// header's vault (require_vault_account), so no other address can work.  A
/// configured `consensus_*_vault_public_key` or a `--converted-vault` /
/// `--unclaimed-vault` flag only asserts the header's value; one that
/// differs is an error, so a stale address is never sent.
fn resolve_vaults(
    config: &Config,
    table: &ValidatorTable,
    converted_vault: Option<&str>,
    unclaimed_vault: Option<&str>,
) -> Result<([u8; 32], [u8; 32]), CliError> {
    let assertions = [
        (
            "consensus_converted_vault_public_key in the CLI config",
            config.get_consensus_converted_vault_assertion()?,
            table.converted_vault,
        ),
        (
            "consensus_unclaimed_vault_public_key in the CLI config",
            config.get_consensus_unclaimed_vault_assertion()?,
            table.unclaimed_vault,
        ),
        (
            "--converted-vault",
            converted_vault.map(validate_address_or_hex).transpose()?,
            table.converted_vault,
        ),
        (
            "--unclaimed-vault",
            unclaimed_vault.map(validate_address_or_hex).transpose()?,
            table.unclaimed_vault,
        ),
    ];
    for (source, asserted, header) in assertions {
        if let Some(asserted) = asserted {
            if asserted != header {
                return Err(CliError::Validation(format!(
                    "{} is {}, but attestor table {} records {}; remove it to use the table's vault",
                    source,
                    to_address_string(&asserted),
                    to_address_string(&table.attestor_table),
                    to_address_string(&header),
                )));
            }
        }
    }
    Ok((table.converted_vault, table.unclaimed_vault))
}

fn parse_bls_pubkey_hex(value: &str) -> Result<[u8; 96], CliError> {
    let bytes = hex::decode(value.trim_start_matches("0x"))
        .map_err(|e| CliError::Validation(format!("Invalid BLS public key hex: {}", e)))?;
    if bytes.len() != 96 {
        return Err(CliError::Validation(format!(
            "BLS public key must decode to exactly 96 bytes, got {}", bytes.len()
        )));
    }
    let public = BlsPublicKey::deserialize(&bytes).map_err(|_| {
        CliError::Validation("BLS public key must be a valid uncompressed 96-byte BLS12-381 G1 point".to_string())
    })?;
    let affine: blst::blst_p1_affine = public.into();
    let mut raw = [0u8; 96];
    unsafe {
        std::ptr::copy_nonoverlapping(std::ptr::from_ref(&affine).cast::<u8>(), raw.as_mut_ptr(), raw.len());
    }
    Ok(raw)
}

fn parse_bls_pop_hex(value: &str) -> Result<[u8; 192], CliError> {
    let bytes = hex::decode(value.trim_start_matches("0x"))
        .map_err(|e| CliError::Validation(format!("Invalid BLS proof hex: {}", e)))?;
    if bytes.len() != 192 {
        return Err(CliError::Validation("BLS proof must decode to exactly 192 bytes".to_string()));
    }
    let proof = blst::min_pk::Signature::deserialize(&bytes)
        .map_err(|_| CliError::Validation("BLS proof must be a valid uncompressed G2 point".to_string()))?;
    let affine: blst::blst_p2_affine = proof.into();
    let mut raw = [0u8; 192];
    unsafe {
        std::ptr::copy_nonoverlapping(std::ptr::from_ref(&affine).cast::<u8>(), raw.as_mut_ptr(), raw.len());
    }
    Ok(raw)
}

/// Load a BLS private-key scalar from a `bls.json` file and return the first 32
/// bytes (the BLS scalar). Mirrors `tn_load_bls_private_key` (keys.c:247-329):
/// the file is a JSON byte array of 32 bytes (BLS-only) or 64 bytes (legacy
/// identity+BLS, first 32 used). Scalar validation (`blst_sk_check`, which
/// rejects zero / out-of-range) happens in the derivation helpers
/// (`derive_bls_pubkey_raw_from_key_file` / `bls_secret_key_from_file`).
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
/// NOTE: this is NOT `blst_p1_affine_serialize`'s canonical big-endian form; it is
/// the raw affine an ACTIVATE transaction carries (see `bls_activation_key`).
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

/// Load the node's BLS secret key from its `bls.json`.
///
/// `BlsSecretKey::from_bytes` performs `blst_scalar_from_bendian` + `blst_sk_check`
/// (rejecting zero / out-of-range).
fn bls_secret_key_from_file(path: &str) -> Result<BlsSecretKey, CliError> {
    let scalar = load_bls_key_file(path)?;
    BlsSecretKey::from_bytes(&scalar).map_err(|_| {
        CliError::Validation(format!(
            "BLS key file '{}' does not contain a valid BLS private key scalar (zero or out of range)",
            path
        ))
    })
}

fn bls_secret_key_from_seed(seed: u64) -> Result<BlsSecretKey, CliError> {
    let mut ikm = [0u8; 32];
    for (idx, byte) in ikm.iter_mut().enumerate() {
        *byte = ((seed >> (idx % 8)) ^ ((idx as u64) * 37)) as u8;
    }

    BlsSecretKey::key_gen(&ikm, &[]).map_err(|_| {
        CliError::Validation(format!(
            "Failed to derive a BLS keypair from deterministic seed {}",
            seed
        ))
    })
}

fn resolve_bls_activation_key(
    bls_seed: Option<u64>,
    bls_key: Option<&str>,
    identity: &[u8; 32],
) -> Result<([u8; 96], [u8; 192]), CliError> {
    let secret_key = match (bls_seed, bls_key) {
        (Some(seed), None) => bls_secret_key_from_seed(seed)?,
        (None, Some(path)) => bls_secret_key_from_file(path)?,
        (None, None) => {
            return Err(CliError::Validation(
                "One of --bls-seed or --bls-key is required".to_string(),
            ));
        }
        _ => {
            return Err(CliError::Validation(
                "Use only one of --bls-seed or --bls-key".to_string(),
            ));
        }
    };
    Ok(bls_activation_key(&secret_key, identity))
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

/// Mirrors the program's Activate/ConvertTokens amount rules: a whole,
/// nonzero multiple of the table's min_stake (the stake increment), which
/// is itself a whole multiple of stake_units_per_weight.  Returns the
/// attestor power the stake buys.
fn stake_to_power(
    action: &str,
    token_amount: u64,
    min_stake: u64,
    stake_units_per_weight: u64,
) -> Result<u64, CliError> {
    if min_stake == 0 || token_amount < min_stake {
        return Err(CliError::Validation(format!(
            "{} amount {} is below the table's minimum stake (stake increment) of {} WTHRU base units",
            action, token_amount, min_stake
        )));
    }
    if token_amount % min_stake != 0 {
        return Err(CliError::Validation(format!(
            "{} amount {} is not a whole multiple of the table's stake increment (min_stake) of {} WTHRU base units",
            action, token_amount, min_stake
        )));
    }
    if stake_units_per_weight == 0 {
        return Err(CliError::Validation(
            "Validator table stake_units_per_weight is zero".to_string(),
        ));
    }
    if token_amount % stake_units_per_weight != 0 {
        return Err(CliError::Validation(format!(
            "{} amount {} is not a multiple of the table's stake_units_per_weight ({})",
            action, token_amount, stake_units_per_weight
        )));
    }
    Ok(token_amount / stake_units_per_weight)
}

/// The validator manager for JSON output: its address, or null when none is set.
fn manager_json(manager: &[u8; 32]) -> serde_json::Value {
    if has_nonzero_bytes(manager) {
        serde_json::Value::String(to_address_string(manager))
    } else {
        serde_json::Value::Null
    }
}

fn manager_human(manager: &[u8; 32]) -> String {
    if has_nonzero_bytes(manager) { to_address_string(manager) } else { "none".to_string() }
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
    if data[0] != CONSENSUS_VALIDATOR_ACCOUNT_TYPE_ATTESTOR_TABLE_V1 {
        return Err(CliError::Validation(format!(
            "Account type {} is not an attestor table (expected {})",
            data[0], CONSENSUS_VALIDATOR_ACCOUNT_TYPE_ATTESTOR_TABLE_V1
        )));
    }

    let token_program = read_bytes::<32>(data, 1, "token_program")?;
    let wthru_mint = read_bytes::<32>(data, 33, "wthru_mint")?;
    let converted_vault = read_bytes::<32>(data, 65, "converted_vault")?;
    let unclaimed_vault = read_bytes::<32>(data, 97, "unclaimed_vault")?;
    let validator_manager = read_bytes::<32>(data, 129, "validator_manager")?;
    let self_service_disabled = data[CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET] != 0;
    let server_count = read_u64(data, 161, "server_count")?;
    let base_sm_off = read_u64(data, 169, "base_sm_off")? as usize;
    let metadata_off = read_u64(data, 177, "metadata_off")? as usize;
    let pending_decay = read_u64(data, 185, "pending_decay")?;
    let last_decay_calc_slot = read_u64(data, 193, "last_decay_calc_slot")?;
    let last_processed_slot = read_u64(data, 201, "last_processed_slot")?;
    let pending_map_off = read_u64(data, 209, "pending_map_off")?;
    let pending_cap = read_u64(data, 217, "pending_cap")?;
    let stake_units_per_weight = read_u64(data, 225, "stake_units_per_weight")?;
    let min_stake = read_u64(data, 233, "min_stake")?;
    let max_decay_bps = read_u64(data, 241, "max_decay_bps")?;
    let idle_gap_decay_bps = read_u64(data, 249, "idle_gap_decay_bps")?;
    let max_idle_gap_decay_bps = read_u64(data, 257, "max_idle_gap_decay_bps")?;
    let attestor_decay_fraction_bps = read_u64(data, 265, "attestor_decay_fraction_bps")?;
    let pending_idle_slots = read_u64(data, 273, "pending_idle_slots")?;

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
    let total_weights_capacity = usize::try_from(delta1.saturating_add(delta2).saturating_add(2)).map_err(|_| {
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
        wthru_mint,
        token_program,
        converted_vault,
        unclaimed_vault,
        validator_manager,
        self_service_disabled,
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
        last_processed_slot,
        pending_map_off,
        pending_cap,
        stake_units_per_weight,
        min_stake,
        max_decay_bps,
        idle_gap_decay_bps,
        max_idle_gap_decay_bps,
        attestor_decay_fraction_bps,
        pending_idle_slots,
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
    if table.blocks_per_faulty_turnover == 0 {
        return true;
    }
    // The program expires old ring entries before checking turnover. A stale
    // snapshot's aggregate cannot predict that check; let the node validate it.
    let oldest_valid_slot = table.current_slot.saturating_sub(table.blocks_per_faulty_turnover - 1);
    if table.turnover_ring_head_slot < oldest_valid_slot {
        return true;
    }
    match table.turnover_limit {
        None => true,
        Some(limit) => table.turnover_sum_added.saturating_add(added_weight) <= limit,
    }
}

fn check_activate_turnover_window(table: &ValidatorTable, added_weight: u64) -> Result<(), CliError> {
    if turnover_accepts_activation(table, added_weight) {
        return Ok(());
    }

    /* turnover_accepts_activation only returns false when turnover_limit is Some,
       so the limit is known here. Build the rejection message from the window
       state, preserving the existing wording exactly. */
    let turnover_limit = table
        .turnover_limit
        .expect("turnover_accepts_activation returns true when the limit is unknown");
    let projected_added = table.turnover_sum_added.saturating_add(added_weight);

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
        added_weight,
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

    parse_validator_table(&data, attestor_table, block_height.locally_executed_height, account.slot)
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
            bls_pop,
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
                bls_pop.as_deref(),
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
        ValidatorCommands::BlsPop { identity, bls_key } => {
            show_bls_pop(config, &identity, &bls_key, json_format)
        }
        ValidatorCommands::Status {
            identity,
            attestor_table,
        } => show_validator_status(config, identity.as_deref(), attestor_table.as_deref(), json_format).await,
        ValidatorCommands::Manager { command } => handle_manager_command(config, command, json_format).await,
    }
}

/* ---------------- validator manager ---------------- */

type ManagerEncode = Arc<dyn Fn(u64, Option<u16>) -> Vec<u8> + Send + Sync>;

/// One validator manager instruction, signed by the manager (the fee payer)
/// or proposed from a multisig manager.
struct ManagerOp {
    /// JSON output key and multisig summary, e.g. "manager_set_weight"
    action: &'static str,
    /// Human-readable description for the proposal and the output
    summary: String,
    /// The CV program's metadata account (InitValidatorManager only)
    program_meta: Option<[u8; 32]>,
    /// The instruction may verify a BLS proof of possession
    proof: bool,
    /// The table's validator manager, which must sign; None for Init
    manager: Option<[u8; 32]>,
    encode: ManagerEncode,
}

/// The table's validator manager, or an error when none is set.
fn require_manager(table: &ValidatorTable) -> Result<[u8; 32], CliError> {
    if !has_nonzero_bytes(&table.validator_manager) {
        return Err(CliError::Validation(
            "the attestor table has no validator manager; install one with `validator manager init`".to_string(),
        ));
    }
    Ok(table.validator_manager)
}

/// The seat of `identity`, when it is seated with weight.
fn seated<'a>(table: &'a ValidatorTable, identity: &[u8; 32]) -> Option<&'a ValidatorEntry> {
    table.validators.iter().find(|entry| entry.identity == *identity && entry.active)
}

fn require_seated<'a>(table: &'a ValidatorTable, identity: &[u8; 32]) -> Result<&'a ValidatorEntry, CliError> {
    seated(table, identity).ok_or_else(|| {
        CliError::Validation(format!("validator {} is not seated", to_address_string(identity)))
    })
}

/// Checks SetParams' rules (tn_cv_stake_params_check) before a
/// transaction is spent on them.
fn check_stake_params(params: &CvStakeParams) -> Result<(), CliError> {
    const BPS: u64 = 10_000;
    let fail = |reason: &str| -> Result<(), CliError> {
        Err(CliError::Validation(format!("invalid staking parameters: {}", reason)))
    };
    if params.stake_units_per_weight == 0 {
        return fail("--stake-units-per-weight must be nonzero");
    }
    if params.min_stake == 0 || params.min_stake % params.stake_units_per_weight != 0 {
        return fail("--min-stake must be a nonzero multiple of --stake-units-per-weight");
    }
    if params.max_decay_bps > BPS {
        return fail("--max-decay-bps must be at most 10000");
    }
    if params.max_idle_gap_decay_bps > params.max_decay_bps {
        return fail("--max-idle-gap-decay-bps must be at most --max-decay-bps");
    }
    if params.idle_gap_decay_bps > params.max_idle_gap_decay_bps {
        return fail("--idle-gap-decay-bps must be at most --max-idle-gap-decay-bps");
    }
    if params.attestor_decay_fraction_bps > BPS {
        return fail("--attestor-decay-fraction-bps must be at most 10000");
    }
    Ok(())
}

fn via_multisig(via: &ViaMultisigArgs) -> Option<&ViaMultisigArgs> {
    via.via_multisig.as_ref().map(|_| via)
}

async fn handle_manager_command(
    config: &Config,
    command: ValidatorManagerCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match command {
        ValidatorManagerCommands::Init {
            manager,
            program_meta,
            target,
            via,
        } => {
            let manager = resolve_pubkey_or_key_name(config, &manager)?;
            let program_meta = resolve_override_account(
                program_meta.as_deref(),
                thru_base::bootstrap_addresses::CONSENSUS_VALIDATOR_PROGRAM_META_BYTES,
            )?;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            if has_nonzero_bytes(&table.validator_manager) {
                return Err(CliError::Validation(format!(
                    "the validator manager is already {}; hand it over with `validator manager set`",
                    to_address_string(&table.validator_manager)
                )));
            }
            let op = ManagerOp {
                action: "init_validator_manager",
                summary: format!("init-validator-manager {}", to_address_string(&manager)),
                program_meta: Some(program_meta),
                proof: false,
                manager: None,
                encode: Arc::new(move |table_idx: u64, meta_idx: Option<u16>| {
                    build_cv_init_validator_manager_instruction(table_idx, meta_idx.unwrap_or_default(), manager)
                }),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::Set { manager, target, via } => {
            let new_manager = resolve_pubkey_or_key_name(config, &manager)?;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            let op = ManagerOp {
                action: "set_validator_manager",
                summary: format!("set-validator-manager {}", to_address_string(&new_manager)),
                program_meta: None,
                proof: false,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| {
                    build_cv_set_validator_manager_instruction(table_idx, new_manager)
                }),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::SelfService { state, target, via } => {
            let enabled = state == SelfServiceState::On;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            let op = ManagerOp {
                action: "set_self_service",
                summary: format!("set-self-service {}", if enabled { "on" } else { "off" }),
                program_meta: None,
                proof: false,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| build_cv_set_self_service_instruction(table_idx, enabled)),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::Activate {
            identity,
            weight,
            bls_pubkey,
            bls_pop,
            bls_seed,
            bls_key,
            claim_authority,
            target,
            via,
        } => {
            if weight == 0 {
                return Err(CliError::Validation("--weight must be greater than 0".to_string()));
            }
            let identity = resolve_pubkey_or_key_name(config, &identity)?;
            let claim_authority = match claim_authority.as_deref() {
                Some(value) => resolve_pubkey_or_key_name(config, value)?,
                None => identity,
            };
            let (bls_pubkey, bls_pop) = match (bls_pubkey.as_deref(), bls_pop.as_deref()) {
                (Some(key), Some(proof)) => (parse_bls_pubkey_hex(key)?, parse_bls_pop_hex(proof)?),
                _ => resolve_bls_activation_key(bls_seed, bls_key.as_deref(), &identity)?,
            };
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            if seated(&table, &identity).is_some() {
                return Err(CliError::Validation(format!(
                    "validator {} is already seated; use `validator manager set-weight`",
                    to_address_string(&identity)
                )));
            }
            /* A multisig's ManagerActivate is applied later, against the
               window at that time. */
            if via.via_multisig.is_none() {
                check_activate_turnover_window(&table, weight)?;
            }
            let op = ManagerOp {
                action: "manager_activate",
                summary: format!("manager-activate {} weight {}", to_address_string(&identity), weight),
                program_meta: None,
                proof: true,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| {
                    build_cv_manager_activate_instruction(table_idx, identity, bls_pubkey, bls_pop, claim_authority, weight)
                }),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::Deactivate { identity, target, via } => {
            let identity = resolve_pubkey_or_key_name(config, &identity)?;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            require_seated(&table, &identity)?;
            let op = ManagerOp {
                action: "manager_deactivate",
                summary: format!("manager-deactivate {}", to_address_string(&identity)),
                program_meta: None,
                proof: false,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| build_cv_manager_deactivate_instruction(table_idx, identity)),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::SetWeight {
            identity,
            weight,
            target,
            via,
        } => {
            let identity = resolve_pubkey_or_key_name(config, &identity)?;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            require_seated(&table, &identity)?;
            let op = ManagerOp {
                action: "manager_set_weight",
                summary: format!("manager-set-weight {} weight {}", to_address_string(&identity), weight),
                program_meta: None,
                proof: false,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| {
                    build_cv_manager_set_weight_instruction(table_idx, identity, weight)
                }),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
        ValidatorManagerCommands::SetParams {
            stake_units_per_weight,
            min_stake,
            max_decay_bps,
            idle_gap_decay_bps,
            max_idle_gap_decay_bps,
            attestor_decay_fraction_bps,
            target,
            via,
        } => {
            let params = CvStakeParams {
                stake_units_per_weight,
                min_stake,
                max_decay_bps,
                idle_gap_decay_bps,
                max_idle_gap_decay_bps,
                attestor_decay_fraction_bps,
            };
            check_stake_params(&params)?;
            let table = fetch_validator_table(config, target.attestor_table.as_deref()).await?;
            let op = ManagerOp {
                action: "set_params",
                summary: format!(
                    "set-params stake_units_per_weight={} min_stake={} max_decay_bps={} idle_gap_decay_bps={} max_idle_gap_decay_bps={} attestor_decay_fraction_bps={}",
                    stake_units_per_weight,
                    min_stake,
                    max_decay_bps,
                    idle_gap_decay_bps,
                    max_idle_gap_decay_bps,
                    attestor_decay_fraction_bps
                ),
                program_meta: None,
                proof: false,
                manager: Some(require_manager(&table)?),
                encode: Arc::new(move |table_idx: u64, _: Option<u16>| build_cv_set_params_instruction(table_idx, &params)),
            };
            run_manager_op(config, &target, via_multisig(&via), op, json_format).await
        }
    }
}

/// Sends `op` signed by the fee payer, or with `via` proposes it from the
/// multisig.
async fn run_manager_op(
    config: &Config,
    target: &ValidatorManagerTarget,
    via: Option<&ViaMultisigArgs>,
    op: ManagerOp,
    json_format: bool,
) -> Result<(), CliError> {
    // Manager instructions name no vault.
    let accounts = resolve_consensus_accounts(
        config,
        target.program.as_deref(),
        target.attestor_table.as_deref(),
        None,
        None,
    )?;
    if let Some(via) = via {
        let encode = op.encode.clone();
        return crate::commands::multisig::via::cv_manager_instruction(
            config,
            via,
            target.fee_payer.as_deref(),
            &op.summary,
            accounts.program,
            accounts.attestor_table,
            op.program_meta,
            op.manager,
            move |table_idx, meta_idx| encode(table_idx, meta_idx),
            json_format,
        )
        .await;
    }

    let context = setup_transaction_context(config, target.fee_payer.as_deref()).await?;
    if let Some(manager) = op.manager {
        if manager != context.fee_payer_keypair.public_key {
            return Err(CliError::Validation(format!(
                "the validator manager is {}, not the fee payer {}; sign with the manager's key, or use --via-multisig for a multisig manager",
                to_address_string(&manager),
                context.fee_payer_keypair.address_string
            )));
        }
    }
    let encode = op.encode.clone();
    let transaction = TransactionBuilder::build_cv_manager_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        op.program_meta,
        op.proof,
        move |table_idx, meta_idx| encode(table_idx, meta_idx),
        CONSENSUS_VALIDATOR_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    let transaction_details = execute_transaction(transaction, &context, json_format).await?;
    if json_format {
        let response = serde_json::json!({
            op.action: {
                "status": "success",
                "summary": op.summary,
                "signer": context.fee_payer_keypair.address_string.to_string(),
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Validator manager: {} succeeded", op.summary);
        println!("Transaction signature: {}", transaction_details.signature);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn activate(
    config: &Config,
    source_token_account: &str,
    token_amount: u64,
    bls_pubkey: Option<&str>,
    bls_pop: Option<&str>,
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

    let source_token_account = validate_address_or_hex(source_token_account)?;
    let validator_table = fetch_validator_table(config, attestor_table).await?;
    let vaults = resolve_vaults(config, &validator_table, converted_vault, None)?;
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        Some(vaults),
    )?;
    // The turnover window counts power, not WTHRU base units.
    let power = stake_to_power(
        "activation",
        token_amount,
        validator_table.min_stake,
        validator_table.stake_units_per_weight,
    )?;
    check_activate_turnover_window(&validator_table, power)?;
    let context = setup_transaction_context(config, fee_payer).await?;
    let (bls_pubkey, bls_pop) = match (bls_pubkey, bls_pop) {
        (Some(key), Some(proof)) => (parse_bls_pubkey_hex(key)?, parse_bls_pop_hex(proof)?),
        _ => resolve_bls_activation_key(bls_seed, bls_key, &context.fee_payer_keypair.public_key)?,
    };
    let claim_authority = match claim_authority {
        Some(value) => resolve_pubkey_or_key_name(config, value)?,
        None => context.fee_payer_keypair.public_key,
    };

    let transaction = TransactionBuilder::build_activate_with_accounts(
        context.fee_payer_keypair.public_key,
        accounts,
        source_token_account,
        bls_pubkey,
        bls_pop,
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
    let validator_table = fetch_validator_table(config, attestor_table).await?;
    let vaults = resolve_vaults(config, &validator_table, None, unclaimed_vault)?;
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        Some(vaults),
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

    let validator_table = fetch_validator_table(config, attestor_table).await?;
    let vaults = resolve_vaults(config, &validator_table, converted_vault, None)?;
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        Some(vaults),
    )?;
    stake_to_power(
        "conversion",
        token_amount,
        validator_table.min_stake,
        validator_table.stake_units_per_weight,
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
    let validator_table = fetch_validator_table(config, attestor_table).await?;
    let vaults = resolve_vaults(config, &validator_table, None, unclaimed_vault)?;
    let accounts = resolve_consensus_accounts(
        config,
        program,
        attestor_table,
        token_program,
        Some(vaults),
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
    let accounts = resolve_consensus_accounts(config, program, attestor_table, None, None)?;
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
                "wthru_mint": to_address_string(&table.wthru_mint),
                "token_program": to_address_string(&table.token_program),
                "converted_vault": to_address_string(&table.converted_vault),
                "unclaimed_vault": to_address_string(&table.unclaimed_vault),
                "validator_manager": manager_json(&table.validator_manager),
                "self_service_disabled": table.self_service_disabled,
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
                "last_processed_slot": table.last_processed_slot,
                "pending_map_off": table.pending_map_off,
                "pending_cap": table.pending_cap,
                "stake_units_per_weight": table.stake_units_per_weight,
                "min_stake": table.min_stake,
                "max_decay_bps": table.max_decay_bps,
                "idle_gap_decay_bps": table.idle_gap_decay_bps,
                "max_idle_gap_decay_bps": table.max_idle_gap_decay_bps,
                "attestor_decay_fraction_bps": table.attestor_decay_fraction_bps,
                "pending_idle_slots": table.pending_idle_slots,
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
            "Stake rate: {} WTHRU base units per power | Stake increment (min_stake): {} WTHRU base units | Max decay: {} bps",
            table.stake_units_per_weight, table.min_stake, table.max_decay_bps
        );
        println!(
            "Idle gap decay: {} bps per idle slot, at most {} bps per emission | Pending idle slots: {}",
            table.idle_gap_decay_bps, table.max_idle_gap_decay_bps, table.pending_idle_slots
        );
        println!(
            "Payment decay: {} bps of the attestor payment's power per emission",
            table.attestor_decay_fraction_bps
        );
        println!(
            "Validator manager: {} | Self-service: {}",
            manager_human(&table.validator_manager),
            if table.self_service_disabled { "disabled" } else { "enabled" }
        );
        println!(
            "WTHRU mint: {} | Converted vault: {} | Unclaimed vault: {}",
            to_address_string(&table.wthru_mint),
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

/// Encode the raw affine key and proof that `--bls-key` builds for Activate as
/// the 96- and 192-byte uncompressed hex that `--bls-pubkey` and `--bls-pop`
/// accept. `parse_bls_pubkey_hex` / `parse_bls_pop_hex` turn this hex back into
/// the same raw bytes.
fn export_bls_pop(identity: &[u8; 32], bls_key: &str) -> Result<(String, String), CliError> {
    let (raw_pubkey, raw_pop) = resolve_bls_activation_key(None, Some(bls_key), identity)?;
    // SAFETY: both arrays are exactly the size of the blst affine structs that
    // bls_activation_key copied them from; read_unaligned has no alignment
    // requirement.
    let (pubkey, pop) = unsafe {
        (
            std::ptr::read_unaligned(raw_pubkey.as_ptr().cast::<blst::blst_p1_affine>()),
            std::ptr::read_unaligned(raw_pop.as_ptr().cast::<blst::blst_p2_affine>()),
        )
    };
    Ok((
        hex::encode(BlsPublicKey::from(pubkey).serialize()),
        hex::encode(blst::min_pk::Signature::from(pop).serialize()),
    ))
}

/// `validator bls-pop --identity <id> --bls-key <bls.json>` — print what an
/// operator sends a manager for `validator manager activate`: the identity,
/// the BLS public key and the proof of possession bound to that identity.
/// Offline: no RPC and no fee payer. The secret scalar is never printed.
fn show_bls_pop(
    config: &Config,
    identity: &str,
    bls_key: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let identity = resolve_pubkey_or_key_name(config, identity)?;
    let (bls_pubkey, bls_pop) = export_bls_pop(&identity, bls_key)?;
    let identity = to_address_string(&identity);

    if json_format {
        let response = serde_json::json!({
            "validator_bls_pop": {
                "status": "success",
                "identity": identity,
                "bls_pubkey": bls_pubkey,
                "bls_pop": bls_pop,
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("identity: {identity}");
        println!("bls-pubkey: {bls_pubkey}");
        println!("bls-pop: {bls_pop}");
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
    let key_name = if config.keys.has_key(identity_input) {
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
    use crate::keys::KeyManager;
    use thru_base::txn_tools::{ATTESTOR_TABLE, CONSENSUS_VALIDATOR_PROGRAM, TOKEN_PROGRAM};

    fn write_u64(buf: &mut [u8], offset: usize, value: u64) {
        buf[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn build_test_validator_table_bytes() -> Vec<u8> {
        let server_count = 2usize;
        /* init places the base state machine right after the 4096-byte
        header page. */
        let base_sm_off = CONSENSUS_VALIDATOR_STATE_HEADER_SIZE;
        let stake_slots_off = CONSENSUS_STATE_BASE_HEADER_SIZE;
        let base_weights_off = stake_slots_off + server_count * CONSENSUS_ATTESTOR_SEAT_SIZE;
        let total_weights_capacity = 26usize;
        let total_weights_off = base_weights_off + server_count * 8;
        let weight_updates_off = total_weights_off + total_weights_capacity * 8;
        let metadata_off =
            base_sm_off + weight_updates_off + server_count * CONSENSUS_WEIGHT_UPDATE_SIZE;
        let pending_map_off = metadata_off + server_count * CONSENSUS_VALIDATOR_METADATA_SIZE;
        let pending_cap = 11;
        let pending_entry_stride = 48 + server_count.div_ceil(64) * 8;
        let total_size = pending_map_off + pending_cap * pending_entry_stride;
        let mut data = vec![0u8; total_size];

        data[0] = CONSENSUS_VALIDATOR_ACCOUNT_TYPE_ATTESTOR_TABLE_V1;
        data[1..33].copy_from_slice(&[0x10u8; 32]);
        data[33..65].copy_from_slice(&[0x20u8; 32]);
        data[65..97].copy_from_slice(&[0x30u8; 32]);
        data[97..129].copy_from_slice(&[0x40u8; 32]);
        data[129..161].copy_from_slice(&[0x50u8; 32]);
        write_u64(&mut data, 161, server_count as u64);
        write_u64(&mut data, 169, base_sm_off as u64);
        write_u64(&mut data, 177, metadata_off as u64);
        write_u64(&mut data, 185, 7);
        write_u64(&mut data, 193, 8);
        write_u64(&mut data, 201, 10);
        write_u64(&mut data, 209, pending_map_off as u64); // pending_map_off
        write_u64(&mut data, 217, pending_cap as u64); // pending_cap
        write_u64(&mut data, 225, 100_000); // stake_units_per_weight
        write_u64(&mut data, 233, 2_500_000_000); // min_stake
        write_u64(&mut data, 241, 25); // max_decay_bps
        write_u64(&mut data, 249, 10); // idle_gap_decay_bps
        write_u64(&mut data, 257, 20); // max_idle_gap_decay_bps
        write_u64(&mut data, 265, 1_000); // attestor_decay_fraction_bps
        write_u64(&mut data, 273, 3); // pending_idle_slots

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

    fn create_test_config() -> (tempfile::TempDir, Config) {
        let (guard, keys) = KeyManager::test_fixture(&[("default", [1; 32]), ("alice", [2; 32])]);
        let mut config = Config::default();
        config.rpc_base_url = "http://localhost:8080".to_string();
        config.keys = keys;
        (guard, config)
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
    fn accepts_external_bls_key_and_proof() {
        let sk = bls_secret_key_from_seed(17).unwrap();
        let expected = bls_activation_key(&sk, &[0x10; 32]);
        assert_eq!(parse_bls_pubkey_hex(&hex::encode(sk.sk_to_pk().serialize())).unwrap(), expected.0);
        let proof = unsafe { std::ptr::read_unaligned(expected.1.as_ptr().cast::<blst::blst_p2_affine>()) };
        let signature = blst::min_pk::Signature::from(proof);
        assert_eq!(parse_bls_pop_hex(&hex::encode(signature.serialize())).unwrap(), expected.1);
        assert!(parse_bls_pubkey_hex(&"22".repeat(95)).is_err());
        assert!(parse_bls_pubkey_hex(&"11".repeat(96)).is_err());
        assert!(parse_bls_pop_hex(&"11".repeat(192)).is_err());
    }

    #[test]
    fn derives_valid_bls_pubkey_from_seed() {
        let secret_key = bls_secret_key_from_seed(17).expect("seed-derived BLS key should parse");
        assert_eq!(bls_activation_key(&secret_key, &[0u8; 32]).0, BLS_SEED_17_AFFINE_BYTES);
    }

    #[test]
    fn resolves_bls_pubkey_from_seed() {
        let identity = [0x10u8; 32];
        let (pubkey, proof) =
            resolve_bls_activation_key(Some(5), None, &identity).expect("bls seed should resolve");
        assert_eq!(pubkey, BLS_SEED_5_AFFINE_BYTES);
        let key = bls_secret_key_from_seed(5).unwrap().sk_to_pk();
        let mut message = [0u8; 48 + 32];
        message[..48].copy_from_slice(&key.compress());
        message[48..].copy_from_slice(&identity);
        let signature = unsafe { std::ptr::read_unaligned(proof.as_ptr().cast::<BlsSignature>()) };
        assert_eq!(
            signature.verify(true, &message, BLS_POP_DST, &[], &key, true),
            blst::BLST_ERROR::BLST_SUCCESS
        );
    }

    #[test]
    fn resolves_pubkey_from_config_key_name() {
        let (_guard, config) = create_test_config();
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
        assert_eq!(table.last_processed_slot, 10);
        assert_eq!(table.pending_cap, 11);

        let validator = &table.validators[0];
        assert_eq!(validator.sid, 0);
        assert_eq!(validator.weight, 75);
        assert_eq!(validator.weight_source, "pending");
        assert!(validator.active);
        assert_eq!(validator.unclaimed_tokens, 5);
    }

    /// Mirrors the C FD_STATIC_ASSERTs on tn_consensus_validator_state_t: the
    /// on-chain state header is one 4096-byte page (account_type, the header
    /// fields, then header_reserved from @282), with last_processed_slot
    /// @201, pending_map_off @209, pending_cap @217, stake_units_per_weight
    /// @225, min_stake @233, max_decay_bps @241, idle_gap_decay_bps @249,
    /// max_idle_gap_decay_bps @257, attestor_decay_fraction_bps @265 and
    /// pending_idle_slots @273.  C asserts don't reach Rust, so this guards
    /// the positional parser against header drift.
    #[test]
    fn validator_state_header_is_one_4096_byte_page() {
        assert_eq!(CONSENSUS_VALIDATOR_STATE_HEADER_SIZE, 4096);
        let data = build_test_validator_table_bytes();
        let table = parse_validator_table(&data, [0xaau8; 32], 100, None)
            .expect("validator table should parse");
        // The pending map follows metadata and extends to the account end.
        let pending_entry_stride = 48 + table.server_count.div_ceil(64) * 8;
        assert_eq!(table.pending_map_off + table.pending_cap * pending_entry_stride, table.data_size as u64);
        assert_eq!(table.pending_cap, 11); // @217
        assert_eq!(table.last_processed_slot, 10); // @201
        assert_eq!(table.stake_units_per_weight, 100_000); // @225
        assert_eq!(table.min_stake, 2_500_000_000); // @233
        assert_eq!(table.max_decay_bps, 25); // @241
        assert_eq!(table.idle_gap_decay_bps, 10); // @249
        assert_eq!(table.max_idle_gap_decay_bps, 20); // @257
        assert_eq!(table.attestor_decay_fraction_bps, 1_000); // @265
        assert_eq!(table.pending_idle_slots, 3); // @273
        assert_eq!(table.validator_manager, [0x50u8; 32]); // @129
        assert!(!table.self_service_disabled); // @281
        assert_eq!(CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET, 281);
        assert_eq!(CONSENSUS_VALIDATOR_HEADER_RESERVED_OFFSET, CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET + 1);
        // The base state machine starts right after the header page.
        assert_eq!(read_u64(&data, 169, "base_sm_off").unwrap(), 4096); // @169
        assert_eq!(table.wthru_mint, [0x20u8; 32]); // @33
        // The base state machine is the 248-byte base header, then seats.
        assert_eq!(CONSENSUS_STATE_BASE_HEADER_SIZE, 248);
    }

    /// The manager fields: self-service off is read, and a zero manager is
    /// shown as none.
    #[test]
    fn reads_the_validator_manager_fields() {
        let mut data = build_test_validator_table_bytes();
        data[CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET] = 1;
        let table = parse_validator_table(&data, [0xaau8; 32], 100, None).expect("validator table should parse");
        assert!(table.self_service_disabled);
        assert_eq!(manager_json(&[0u8; 32]), serde_json::Value::Null);
        assert_eq!(manager_human(&[0u8; 32]), "none");
        assert_eq!(manager_json(&[0x50u8; 32]), serde_json::Value::String(to_address_string(&[0x50u8; 32])));
    }

    #[test]
    fn stake_params_follow_the_program_rules() {
        let ok = CvStakeParams {
            stake_units_per_weight: 100_000,
            min_stake: 1_000_000_000,
            max_decay_bps: 25,
            idle_gap_decay_bps: 25,
            max_idle_gap_decay_bps: 25,
            attestor_decay_fraction_bps: 10_000,
        };
        assert!(check_stake_params(&ok).is_ok());
        for bad in [
            CvStakeParams { stake_units_per_weight: 0, ..ok },
            CvStakeParams { min_stake: 0, ..ok },
            CvStakeParams { min_stake: 150_000, ..ok },
            CvStakeParams { max_decay_bps: 10_001, ..ok },
            CvStakeParams { max_idle_gap_decay_bps: 26, ..ok },
            CvStakeParams { idle_gap_decay_bps: 26, ..ok },
            CvStakeParams { attestor_decay_fraction_bps: 10_001, ..ok },
        ] {
            assert!(check_stake_params(&bad).is_err(), "{:?} must be refused", bad);
        }
    }

    #[test]
    fn rejects_a_wrong_account_type() {
        for account_type in [0u8, 2] {
            let mut data = build_test_validator_table_bytes();
            data[0] = account_type;
            assert!(parse_validator_table(&data, [0xaau8; 32], 100, None).is_err());
        }
    }

    /// header_reserved (@282 to the end of the 4096-byte header page) is
    /// reserved for future header fields and always zero: the parser ignores
    /// it, but the account must hold the whole header page.
    #[test]
    fn ignores_header_reserved_and_requires_the_header_page() {
        let mut data = build_test_validator_table_bytes();
        assert!(data[CONSENSUS_VALIDATOR_SELF_SERVICE_DISABLED_OFFSET..CONSENSUS_VALIDATOR_STATE_HEADER_SIZE]
            .iter()
            .all(|byte| *byte == 0));
        let expected = parse_validator_table(&data, [0xaau8; 32], 100, None)
            .expect("validator table should parse");
        data[CONSENSUS_VALIDATOR_HEADER_RESERVED_OFFSET] = 0xff;
        data[CONSENSUS_VALIDATOR_STATE_HEADER_SIZE - 1] = 0xff;
        let table = parse_validator_table(&data, [0xaau8; 32], 100, None)
            .expect("reserved header bytes are ignored");
        assert_eq!(table.pending_idle_slots, expected.pending_idle_slots);
        assert_eq!(table.pending_map_off, expected.pending_map_off);
        assert_eq!(table.validators.len(), expected.validators.len());
        assert_eq!(table.validators[0].weight, expected.validators[0].weight);
        let truncated = &data[..CONSENSUS_VALIDATOR_STATE_HEADER_SIZE - 1];
        assert!(parse_validator_table(truncated, [0xaau8; 32], 100, None).is_err());
    }

    #[test]
    fn stake_to_power_mirrors_program_rules() {
        const ONE_WTHRU: u64 = 1_000_000_000;
        // Default rate and increment: 1 and 2 WTHRU buy 10,000 and 20,000 power.
        assert_eq!(
            stake_to_power("activation", ONE_WTHRU, ONE_WTHRU, 100_000).unwrap(),
            10_000
        );
        assert_eq!(
            stake_to_power("conversion", 2 * ONE_WTHRU, ONE_WTHRU, 100_000).unwrap(),
            20_000
        );
        assert_eq!(
            stake_to_power("conversion", 2 * ONE_WTHRU, ONE_WTHRU, 1_000_000).unwrap(),
            2_000
        );
        // Below the increment: 0.5 WTHRU, and a zero increment.
        assert!(stake_to_power("activation", ONE_WTHRU / 2, ONE_WTHRU, 100_000).is_err());
        assert!(stake_to_power("activation", 1, ONE_WTHRU, 1).is_err());
        assert!(stake_to_power("activation", ONE_WTHRU, 0, 100_000).is_err());
        // Not a whole multiple of the increment: 1.1 WTHRU, or one power
        // unit over 1 WTHRU.
        assert!(stake_to_power("activation", ONE_WTHRU + ONE_WTHRU / 10, ONE_WTHRU, 100_000).is_err());
        assert!(stake_to_power("conversion", 1_000_300_000, ONE_WTHRU, 100_000).is_err());
        assert!(stake_to_power("conversion", 1_000_000_001, ONE_WTHRU, 100_000).is_err());
        // The increment is the table's, not a constant: with 5 WTHRU, 10 is
        // accepted, 7 is not a multiple and 4 is below it.
        let five = 5 * ONE_WTHRU;
        assert_eq!(stake_to_power("conversion", 10 * ONE_WTHRU, five, 100_000).unwrap(), 100_000);
        assert!(stake_to_power("activation", 7 * ONE_WTHRU, five, 100_000).is_err());
        assert!(stake_to_power("activation", 4 * ONE_WTHRU, five, 100_000).is_err());
        assert_eq!(stake_to_power("activation", 400_000, 200_000, 100_000).unwrap(), 4);
        assert!(stake_to_power("activation", 300_000, 200_000, 100_000).is_err());
        // A zero rate is refused rather than dividing by zero.
        assert!(stake_to_power("activation", ONE_WTHRU, ONE_WTHRU, 0).is_err());
    }

    #[test]
    fn validator_table_requires_the_attestor_table_account_type() {
        let mut data = build_test_validator_table_bytes();
        for account_type in [0u8, 2, 0xff] {
            data[0] = account_type;
            assert!(parse_validator_table(&data, [0xaau8; 32], 100, None).is_err());
        }
    }

    #[test]
    fn resolves_validator_entry_by_sid() {
        let (_guard, config) = create_test_config();
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
    fn resolves_consensus_accounts_with_defaults() {
        let (_guard, config) = create_test_config();
        let accounts = resolve_consensus_accounts(&config, None, None, None, None)
            .expect("default accounts should resolve");

        assert_eq!(accounts.program, CONSENSUS_VALIDATOR_PROGRAM);
        assert_eq!(accounts.attestor_table, ATTESTOR_TABLE);
        assert_eq!(accounts.token_program, TOKEN_PROGRAM);
        // No vault without the table header (SetClaimAuthority names none).
        assert_eq!(accounts.converted_vault, [0u8; 32]);
        assert_eq!(accounts.unclaimed_vault, [0u8; 32]);
    }

    #[test]
    fn resolves_consensus_accounts_with_overrides() {
        let (_guard, config) = create_test_config();
        let program = [0x11; 32];
        let token_program = [0x22; 32];
        let vaults = ([0x33; 32], [0x44; 32]);
        let accounts = resolve_consensus_accounts(
            &config,
            Some(&hex::encode(program)),
            None,
            Some(&hex::encode(token_program)),
            Some(vaults),
        )
        .expect("override accounts should resolve");

        assert_eq!(accounts.program, program);
        assert_eq!(accounts.attestor_table, ATTESTOR_TABLE);
        assert_eq!(accounts.token_program, token_program);
        assert_eq!(accounts.converted_vault, vaults.0);
        assert_eq!(accounts.unclaimed_vault, vaults.1);
    }

    #[test]
    fn reads_the_vaults_from_the_attestor_table_header() {
        let mut bytes = build_test_validator_table_bytes();
        bytes[65..97].copy_from_slice(&[0x44; 32]);
        bytes[97..129].copy_from_slice(&[0x55; 32]);
        let table = parse_validator_table(&bytes, [0xaa; 32], 100, None)
            .expect("validator table should parse");
        let (_guard, config) = create_test_config();

        let vaults = resolve_vaults(&config, &table, None, None).expect("header vaults");
        assert_eq!(vaults, ([0x44; 32], [0x55; 32]));

        // A flag only asserts the header's vault: equal passes, different fails.
        assert_eq!(
            resolve_vaults(&config, &table, Some(&hex::encode([0x44u8; 32])), None)
                .expect("matching --converted-vault"),
            vaults
        );
        let message = resolve_vaults(&config, &table, None, Some(&hex::encode([0x66u8; 32])))
            .expect_err("a differing --unclaimed-vault is never sent")
            .to_string();
        assert!(message.contains("--unclaimed-vault"));
        assert!(message.contains(&to_address_string(&[0x55; 32])));
    }

    #[test]
    fn configured_vaults_only_assert_the_header() {
        let (_guard, mut config) = create_test_config();
        let defaults = ConsensusValidatorAccounts::default();
        let mut table = table_with_turnover(0, None, 0, 0, 0);
        table.attestor_table = ATTESTOR_TABLE;
        table.converted_vault = defaults.converted_vault;
        table.unclaimed_vault = defaults.unclaimed_vault;
        let header = (table.converted_vault, table.unclaimed_vault);

        // Earlier CLIs wrote PDA(program, seed) into every config; that retired
        // default asserts nothing.
        let retired = |seed: &[u8]| {
            let mut padded = [0u8; 32];
            padded[..seed.len()].copy_from_slice(seed);
            to_address_string(
                &thru_base::tn_public_address::create_program_defined_account_address(
                    &CONSENSUS_VALIDATOR_PROGRAM,
                    false,
                    &padded,
                ),
            )
        };
        config.consensus_converted_vault_public_key = Some(retired(b"converted_vault"));
        config.consensus_unclaimed_vault_public_key = Some(retired(b"unclaimed_vault"));
        assert_eq!(resolve_vaults(&config, &table, None, None).expect("retired default"), header);

        // An explicit value equal to the header passes.
        config.consensus_converted_vault_public_key = Some(to_address_string(&header.0));
        assert_eq!(resolve_vaults(&config, &table, None, None).expect("matching config"), header);

        // A differing value fails and names the config key.
        config.consensus_unclaimed_vault_public_key = Some(to_address_string(&[0x77; 32]));
        let message = resolve_vaults(&config, &table, None, None)
            .expect_err("a differing configured vault is never sent")
            .to_string();
        assert!(message.contains("consensus_unclaimed_vault_public_key"));
    }

    // ----------------------------------------------------------------------
    // BLS key-file derivation
    //
    // Fixed vectors (checked in, generated offline / cross-checked against the
    // running genesis node via the e2e `validator` scenario, test 8):
    //   * scalar = 1 (big-endian [0,..,0,1]) — the BLS12-381 G1 generator.
    //     - raw affine == the in-memory blst_p1_affine (Montgomery) form printed
    //       by `keys_bls`/shown on-chain — the form `validator bls-pubkey` emits.
    // Seats and ACTIVATE args both carry the raw affine.
    // ----------------------------------------------------------------------

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
    fn derive_bls_raw_affine_for_scalar_one() {
        let file = write_bls_key_file(&scalar_one_bytes());
        let raw = derive_bls_pubkey_raw_from_key_file(file.path().to_str().unwrap())
            .expect("scalar 1 should derive");
        assert_eq!(hex::encode(raw), G1_GENERATOR_RAW_AFFINE);
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
    fn resolve_bls_activation_key_from_key_file_uses_raw_form() {
        // `--bls-key` feeds activation, which carries the raw affine seat form.
        let file = write_bls_key_file(&scalar_one_bytes());
        let (resolved, _) = resolve_bls_activation_key(None, Some(file.path().to_str().unwrap()), &[0u8; 32])
            .expect("bls-key should resolve");
        assert_eq!(hex::encode(resolved), G1_GENERATOR_RAW_AFFINE);
    }

    /// A nontrivial scalar below the group order, so a printed secret would be
    /// recognisable in the output.
    const BLS_POP_TEST_SCALAR: [u8; 32] = [0x2a; 32];

    #[test]
    fn bls_pop_export_round_trips_through_activate_parsers() {
        let file = write_bls_key_file(&BLS_POP_TEST_SCALAR);
        let path = file.path().to_str().unwrap();
        let identity = [0x10u8; 32];
        let (pubkey_hex, pop_hex) = export_bls_pop(&identity, path).expect("bls-pop should export");

        assert_eq!(pubkey_hex.len(), 192);
        assert_eq!(pop_hex.len(), 384);
        assert!(pubkey_hex.chars().chain(pop_hex.chars()).all(|c| matches!(c, '0'..='9' | 'a'..='f')));

        let expected = resolve_bls_activation_key(None, Some(path), &identity).unwrap();
        assert_eq!(parse_bls_pubkey_hex(&pubkey_hex).unwrap(), expected.0);
        assert_eq!(parse_bls_pop_hex(&pop_hex).unwrap(), expected.1);
    }

    #[test]
    fn bls_pop_export_verifies_with_program_message_and_dst() {
        let file = write_bls_key_file(&BLS_POP_TEST_SCALAR);
        let identity = [0x10u8; 32];
        let (pubkey_hex, pop_hex) =
            export_bls_pop(&identity, file.path().to_str().unwrap()).unwrap();

        let key = BlsPublicKey::deserialize(&hex::decode(&pubkey_hex).unwrap()).unwrap();
        let signature = BlsSignature::deserialize(&hex::decode(&pop_hex).unwrap()).unwrap();
        let message = |identity: &[u8; 32]| {
            let mut message = [0u8; 48 + 32];
            message[..48].copy_from_slice(&key.compress());
            message[48..].copy_from_slice(identity);
            message
        };
        assert_eq!(
            signature.verify(true, &message(&identity), BLS_POP_DST, &[], &key, true),
            blst::BLST_ERROR::BLST_SUCCESS
        );
        // The PoP is bound to the identity: it must not verify for another one.
        assert_ne!(
            signature.verify(true, &message(&[0x11u8; 32]), BLS_POP_DST, &[], &key, true),
            blst::BLST_ERROR::BLST_SUCCESS
        );
    }

    #[test]
    fn bls_pop_export_builds_same_manager_activate_as_bls_key() {
        let file = write_bls_key_file(&BLS_POP_TEST_SCALAR);
        let path = file.path().to_str().unwrap();
        let identity = [0x10u8; 32];
        let claim_authority = [0x20u8; 32];
        let (pubkey_hex, pop_hex) = export_bls_pop(&identity, path).unwrap();

        // `manager activate --bls-pubkey <hex> --bls-pop <hex>`
        let from_hex = build_cv_manager_activate_instruction(
            7,
            identity,
            parse_bls_pubkey_hex(&pubkey_hex).unwrap(),
            parse_bls_pop_hex(&pop_hex).unwrap(),
            claim_authority,
            300,
        );
        // `manager activate --bls-key <bls.json>`
        let (key, proof) = resolve_bls_activation_key(None, Some(path), &identity).unwrap();
        let from_key =
            build_cv_manager_activate_instruction(7, identity, key, proof, claim_authority, 300);
        assert_eq!(from_hex, from_key);
    }

    #[test]
    fn bls_pop_export_never_prints_the_secret_scalar() {
        let file = write_bls_key_file(&BLS_POP_TEST_SCALAR);
        let (pubkey_hex, pop_hex) =
            export_bls_pop(&[0x10u8; 32], file.path().to_str().unwrap()).unwrap();
        let secret_hex = hex::encode(BLS_POP_TEST_SCALAR);
        assert!(!pubkey_hex.contains(&secret_hex));
        assert!(!pop_hex.contains(&secret_hex));
    }

    #[test]
    fn bls_pop_export_rejects_invalid_key_file() {
        let file = write_bls_key_file(&[0u8; 32]);
        assert!(export_bls_pop(&[0x10u8; 32], file.path().to_str().unwrap()).is_err());
        assert!(export_bls_pop(&[0x10u8; 32], "/nonexistent/path/to/bls.json").is_err());
    }

    #[test]
    fn show_bls_pop_resolves_identity_offline() {
        // The fixture config points at an unreachable RPC; the command must not use it.
        let (_guard, mut config) = create_test_config();
        config.rpc_base_url = "http://127.0.0.1:9".to_string();
        let file = write_bls_key_file(&BLS_POP_TEST_SCALAR);
        let path = file.path().to_str().unwrap();
        show_bls_pop(&config, "alice", path, true).expect("key name should resolve");
        show_bls_pop(&config, &to_address_string(&[0x10u8; 32]), path, false)
            .expect("address should resolve");
        assert!(show_bls_pop(&config, "not-a-key", path, true).is_err());
    }

    #[test]
    fn resolve_bls_activation_key_rejects_multiple_sources() {
        let err = resolve_bls_activation_key(Some(1), Some("/tmp/bls.json"), &[0u8; 32])
            .expect_err("two BLS sources must be rejected");
        assert!(err.to_string().contains("only one"));
    }

    #[test]
    fn resolve_bls_activation_key_rejects_no_source() {
        let err =
            resolve_bls_activation_key(None, None, &[0u8; 32]).expect_err("no BLS source must be rejected");
        assert!(err.to_string().contains("is required"));
    }

    // ----------------------------------------------------------------------
    // find_validator_entry: Err (bad input) vs Ok(None) (absent) vs Ok(Some)
    // ----------------------------------------------------------------------

    #[test]
    fn find_validator_entry_returns_some_for_known_sid() {
        let (_guard, config) = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        let entry = find_validator_entry(&table, &config, "0").expect("lookup ok");
        assert_eq!(entry.map(|e| e.sid), Some(0));
    }

    #[test]
    fn find_validator_entry_returns_none_for_absent_sid() {
        let (_guard, config) = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        // sid 9999 resolves fine (numeric) but is absent -> Ok(None), NOT Err.
        let entry = find_validator_entry(&table, &config, "9999").expect("absent sid is Ok(None)");
        assert!(entry.is_none());
    }

    #[test]
    fn find_validator_entry_returns_none_for_resolvable_but_absent_identity() {
        let (_guard, config) = create_test_config();
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
        let (_guard, config) = create_test_config();
        let table =
            parse_validator_table(&build_test_validator_table_bytes(), [0xaau8; 32], 100, None)
                .unwrap();
        assert!(find_validator_entry(&table, &config, "definitely-not-a-key").is_err());
    }

    #[test]
    fn resolve_validator_entry_preserves_not_found_messages() {
        let (_guard, config) = create_test_config();
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
        let (_guard, config) = create_test_config();
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
        let (_guard, config) = create_test_config();
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
        let (_guard, config) = create_test_config();
        // `alice` resolves (configured key) but has no seat: NOT REGISTERED is
        // rendered against alice's real pubkey, so the identity must resolve.
        let pubkey = resolve_status_identity(None, &config, "alice")
            .expect("resolvable-but-absent key name still yields a pubkey to show");
        assert_ne!(pubkey, [0u8; 32]);
    }

    #[test]
    fn status_identity_errors_on_unresolvable_key_name() {
        let (_guard, config) = create_test_config();
        assert!(resolve_status_identity(None, &config, "definitely-not-a-key").is_err());
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
            wthru_mint: [0u8; 32],
            token_program: [0u8; 32],
            converted_vault: [0u8; 32],
            unclaimed_vault: [0u8; 32],
            validator_manager: [0u8; 32],
            self_service_disabled: false,
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
            last_processed_slot: 0,
            pending_map_off: 0,
            pending_cap: 0,
            stake_units_per_weight: 100_000,
            min_stake: 1_000_000_000,
            max_decay_bps: 25,
            idle_gap_decay_bps: 25,
            max_idle_gap_decay_bps: 25,
            attestor_decay_fraction_bps: 10_000,
            pending_idle_slots: 0,
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
    fn activation_preflight_defers_when_turnover_entries_expire() {
        let current = table_with_turnover(256, Some(199999), 1000000, 0, 255);
        assert!(!turnover_accepts_activation(&current, 100));
        let expired = table_with_turnover(256, Some(199999), 1000000, 0, 256);
        assert!(turnover_accepts_activation(&expired, 100));
        let disabled = table_with_turnover(0, Some(0), 1000000, 0, 0);
        assert!(turnover_accepts_activation(&disabled, 100));
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
