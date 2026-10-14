//! Faucet program command implementation

use anyhow::Result;
use base64::{Engine, engine::general_purpose};
use std::time::{Duration, UNIX_EPOCH};

use crate::cli::{FaucetCommands, FaucetWithdrawCommands};
use crate::commands::state_proof::make_state_proof;
use crate::config::Config;
use crate::error::CliError;
use crate::utils::{format_vm_error, validate_address_or_hex};
#[cfg(test)]
use hex;
use futures_util::future::try_join_all;
use thru_base::bootstrap_addresses::{
    COMPRESSION_PROGRAM_BYTES, FAUCET_RATE_LIMIT_POLICY_BYTES, RATELIMIT_PROGRAM_BYTES,
};
use thru_base::ratelimit::{self, Bucket, Clock, KeyKind, Policy, Rule};
use thru_base::rpc_types::ProofType;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_tools::{
    TransactionBuilder, FAUCET_PROGRAM, EOA_PROGRAM, FAUCET_WITHDRAW_RATE_LIMITED_FAUCET_IDX_OFFSET,
    FAUCET_WITHDRAW_RATE_LIMITED_POLICY_IDX_OFFSET, FAUCET_WITHDRAW_RATE_LIMITED_RECIPIENT_IDX_OFFSET,
};
use thru_client::{AccountDecompressionPreparation, AccountState, Client, ClientBuilder, TransactionDetails};

/// Faucet program fee (0 for now)
const FAUCET_PROGRAM_FEE: u64 = 0;

/// Withdraw limit per transaction (matches TN_FAUCET_WITHDRAW_LIMIT)
const FAUCET_WITHDRAW_LIMIT: u64 = 10000;

/// Program-owned vault created and explicitly funded by bootstrap, not genesis.
const FAUCET_ACCOUNT_ADDRESS: &str = thru_base::bootstrap_addresses::FAUCET_VAULT_ADDRESS;

/// Helper function to resolve fee payer keypair from configuration
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

/// Create RPC client from configuration
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;
    let timeout = Duration::from_secs(config.timeout_seconds);

    let client = ClientBuilder::new()
        .insecure(config.insecure)
        .http_endpoint(rpc_url)
        .timeout(timeout)
        .auth_token(config.auth_token.clone())
        .announce_pending_signature(config.announce_pending_signature)
        .build()?;

    Ok(client)
}

/// Common transaction execution context
struct TransactionContext {
    pub fee_payer_keypair: KeyPair,
    pub faucet_program_bytes: [u8; 32],
    pub faucet_account_bytes: [u8; 32],
    pub client: Client,
    pub nonce: u64,
    pub start_slot: u64,
    pub chain_id: u16,
    pub timeout_seconds: u64,
}

/// Setup common transaction context (config, keypair, client, nonce, block height)
async fn setup_transaction_context(
    config: &Config,
    fee_payer: Option<&str>,
) -> Result<TransactionContext, CliError> {
    let faucet_program_bytes = FAUCET_PROGRAM;
    let faucet_account_bytes = validate_address_or_hex(FAUCET_ACCOUNT_ADDRESS)?;
    let fee_payer_keypair = resolve_fee_payer_keypair(config, fee_payer)?;
    let client = create_rpc_client(config)?;

    // Get current nonce and block height
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
        faucet_program_bytes,
        faucet_account_bytes,
        client,
        nonce,
        start_slot: block_height.finalized_height,
        chain_id: chain_info.chain_id,
        timeout_seconds: config.timeout_seconds,
    })
}

/// Helper function to check transaction execution results and return appropriate errors
fn check_transaction_result(
    transaction_details: &TransactionDetails,
    json_format: bool,
) -> Result<(), CliError> {
    if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
        let signed_execution_result = transaction_details.execution_result as i64;
        let signed_user_error = transaction_details.user_error_code as i64;

        let vm_error_label = format_vm_error(transaction_details.vm_error);
        let vm_error_msg = if transaction_details.vm_error != 0 {
            format!(" (VM error: {})", vm_error_label)
        } else {
            String::new()
        };

        let user_error_msg = if signed_user_error != 0 {
            match ratelimit::error_name(transaction_details.user_error_code) {
                Some(name) => format!(" (RateLimitError: {:#x} {})", signed_user_error, name),
                None => format!(" (FaucetError: {})", signed_user_error),
            }
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
    // Set chain ID and sign transaction
    transaction = transaction.with_chain_id(context.chain_id);
    transaction
        .sign(&context.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(format!("Failed to sign transaction: {}", e)))?;

    // Submit transaction
    let transaction_bytes = transaction.to_wire();
    let timeout = Duration::from_secs(context.timeout_seconds);

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

/// Handle faucet program commands
pub async fn handle_faucet_command(
    config: &Config,
    subcommand: FaucetCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        FaucetCommands::Deposit {
            account,
            amount,
            fee_payer,
        } => deposit(config, &account, amount, fee_payer.as_deref(), json_format).await,
        FaucetCommands::Withdraw { subcommand } => match subcommand {
            FaucetWithdrawCommands::Native {
                account,
                amount,
                fee_payer,
            } => withdraw(config, &account, amount, fee_payer.as_deref(), json_format).await,
            FaucetWithdrawCommands::Thrusd { account, amount } => {
                super::developers::fund(config, &account, &amount, json_format).await
            }
        },
    }
}

/// Deposit tokens into the faucet
async fn deposit(
    config: &Config,
    account: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Deposit amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "faucet_deposit": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    // Resolve depositor account either from explicit address or key name
    let direct_account_input =
        (account.starts_with("ta") && account.len() == 46) || account.len() == 64;
    let (depositor_account_bytes, depositor_address_display) = if direct_account_input {
        let bytes = validate_address_or_hex(account)?;
        let display = if account.starts_with("ta") && account.len() == 46 {
            account.to_string()
        } else {
            Pubkey::from_bytes(&bytes).to_string()
        };
        (bytes, display)
    } else {
        let depositor_private_key = config.keys.get_key(account).map_err(|_| {
            CliError::Validation(format!("Key '{}' not found in configuration", account))
        })?;
        let depositor_keypair = KeyPair::from_hex_private_key(account, depositor_private_key)
            .map_err(|e| CliError::Crypto(format!("Failed to create depositor keypair: {}", e)))?;
        (
            depositor_keypair.public_key,
            depositor_keypair.address_string.to_string(),
        )
    };

    if !json_format {
        println!("Deposit to faucet:");
        println!("  Depositor: {}", account);
        println!("  Amount: {}", amount);
    }

    // Setup transaction context
    let context = setup_transaction_context(config, fee_payer)
        .await
        .map_err(|e| {
            if json_format {
                let error_response = serde_json::json!({
                    "faucet_deposit": {
                        "status": "failed",
                        "error": e.to_string()
                    }
                });
                crate::output::print_output(error_response, true);
            }
            e
        })?;

    if context.fee_payer_keypair.public_key != depositor_account_bytes {
        let error_msg = format!(
            "Depositor '{}' resolves to {} but the active fee payer is {}. They must match.",
            account, depositor_address_display, context.fee_payer_keypair.address_string
        );
        if json_format {
            let error_response = serde_json::json!({
                "faucet_deposit": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    // Build transaction - include EOA program account for faucet program to invoke
    let transaction = TransactionBuilder::build_faucet_deposit(
        context.fee_payer_keypair.public_key,
        context.faucet_program_bytes,
        context.faucet_account_bytes,
        depositor_account_bytes,
        EOA_PROGRAM,
        amount,
        FAUCET_PROGRAM_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Execute transaction
    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "faucet_deposit": {
                "status": "success",
                "depositor": account,
                "amount": amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Deposit completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Deposited {} tokens to faucet from {}", amount, account);
    }

    Ok(())
}

/// Withdraw tokens from the faucet
async fn withdraw(
    config: &Config,
    account: &str,
    amount: u64,
    fee_payer: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate inputs
    if amount == 0 {
        let error_msg = "Withdraw amount must be greater than 0";
        if json_format {
            let error_response = serde_json::json!({
                "faucet_withdraw": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg.to_string()));
    }

    if amount > FAUCET_WITHDRAW_LIMIT {
        let error_msg = format!(
            "Withdraw amount {} exceeds limit of {}",
            amount, FAUCET_WITHDRAW_LIMIT
        );
        if json_format {
            let error_response = serde_json::json!({
                "faucet_withdraw": {
                    "status": "failed",
                    "error": error_msg
                }
            });
            crate::output::print_output(error_response, true);
        }
        return Err(CliError::Validation(error_msg));
    }

    // Resolve recipient account either from explicit address/hex or key name
    let recipient_account_bytes = if (account.starts_with("ta") && account.len() == 46)
        || account.len() == 64
    {
        validate_address_or_hex(account)?
    } else {
        let recipient_private_key = config.keys.get_key(account).map_err(|_| {
            CliError::Validation(format!("Key '{}' not found in configuration", account))
        })?;
        let recipient_keypair = KeyPair::from_hex_private_key(account, recipient_private_key)
            .map_err(|e| CliError::Crypto(format!("Failed to create recipient keypair: {}", e)))?;
        recipient_keypair.public_key
    };

    if !json_format {
        println!("Withdraw from faucet:");
        println!("  Recipient: {}", account);
        println!("  Amount: {}", amount);
        println!("  Withdraw limit: {}", FAUCET_WITHDRAW_LIMIT);
    }

    let report = |e: CliError| {
        if json_format {
            let error_response = serde_json::json!({
                "faucet_withdraw": {
                    "status": "failed",
                    "error": e.to_string()
                }
            });
            crate::output::print_output(error_response, true);
        }
        e
    };

    // Setup transaction context
    let mut context = setup_transaction_context(config, fee_payer).await.map_err(report)?;

    // Withdrawals go through the rate limiter under the faucet's policy.
    let plan = plan_rate_limited_withdraw(&mut context, recipient_account_bytes, amount, json_format)
        .await
        .map_err(report)?;
    if !json_format {
        for line in &plan.usage {
            println!("  {}", line);
        }
    }

    let transaction = TransactionBuilder::build_faucet_withdraw_rate_limited(
        context.fee_payer_keypair.public_key,
        RATELIMIT_PROGRAM_BYTES,
        context.faucet_program_bytes,
        context.faucet_account_bytes,
        recipient_account_bytes,
        FAUCET_RATE_LIMIT_POLICY_BYTES,
        plan.buckets,
        amount,
        FAUCET_PROGRAM_FEE,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build transaction: {}", e)))?;

    // Execute transaction
    let transaction_details = execute_transaction(transaction, &context, json_format).await?;

    if json_format {
        let response = serde_json::json!({
            "faucet_withdraw": {
                "status": "success",
                "recipient": account,
                "amount": amount,
                "signature": transaction_details.signature.as_str(),
                "slot": transaction_details.slot,
                "compute_units_consumed": transaction_details.compute_units_consumed
            }
        });
        crate::output::print_output(response, true);
    } else {
        println!("Withdraw completed successfully!");
        println!("Transaction signature: {}", transaction_details.signature);
        println!("Withdrew {} tokens from faucet to {}", amount, account);
    }

    Ok(())
}

/// Per-rule buckets for one rate limited withdrawal under the faucet's
/// VERIFIED policy (`FAUCET_RATE_LIMIT_POLICY_BYTES`).
struct RateLimitedWithdrawPlan {
    /// (bucket address, attested key, creation proof or empty) in rule order.
    buckets: Vec<([u8; 32], [u8; 32], Vec<u8>)>,
    /// Human readable per-rule usage after this withdrawal.
    usage: Vec<String>,
}

/// Label and bucket key of rule `rule_idx` for a withdrawal to `recipient`.
fn rule_bucket_key(
    rule_idx: usize,
    rule: &Rule,
    context: &TransactionContext,
    recipient: [u8; 32],
) -> Result<(&'static str, [u8; 32]), CliError> {
    Ok(match rule.key_kind {
        KeyKind::Global => ("all callers", [0u8; 32]),
        KeyKind::FeePayer => ("fee payer", context.fee_payer_keypair.public_key),
        KeyKind::InstrAccount => match rule.key_offset {
            FAUCET_WITHDRAW_RATE_LIMITED_RECIPIENT_IDX_OFFSET => ("recipient", recipient),
            FAUCET_WITHDRAW_RATE_LIMITED_FAUCET_IDX_OFFSET => ("vault", context.faucet_account_bytes),
            FAUCET_WITHDRAW_RATE_LIMITED_POLICY_IDX_OFFSET => ("policy", FAUCET_RATE_LIMIT_POLICY_BYTES),
            other => {
                return Err(CliError::Validation(format!(
                    "Faucet policy rule {} keys on unknown instruction offset {}",
                    rule_idx, other
                )))
            }
        },
        KeyKind::Attested => {
            return Err(CliError::Validation(
                "This faucet policy only accepts attested requests; use the web faucet".to_string(),
            ))
        }
    })
}

/// A rule limit for display; 0 means no limit.
fn limit_str(max: u64) -> String {
    if max == 0 { "unlimited".to_string() } else { max.to_string() }
}

/// Loads the faucet policy, derives each rule's bucket and rejects
/// withdrawals that the current window's counters would refuse anyway,
/// judged by the chain's latest block time. Compressed policy and bucket
/// accounts are then restored (one transaction each, advancing
/// `context.nonce`) and creation proofs are fetched for buckets that don't
/// exist yet.
async fn plan_rate_limited_withdraw(
    context: &mut TransactionContext,
    recipient: [u8; 32],
    amount: u64,
    json_format: bool,
) -> Result<RateLimitedWithdrawPlan, CliError> {
    let policy_pubkey = Pubkey::from_bytes(&FAUCET_RATE_LIMIT_POLICY_BYTES);
    /* The program counts windows by block time, so judge them by the
       chain's clock; a local clock that runs behind would otherwise refuse
       withdrawals the chain already allows. */
    let now_slot = context.start_slot;
    let (policy_state, now_secs) =
        tokio::join!(load_account(&context.client, &policy_pubkey), chain_time_secs(&context.client, now_slot));
    let policy_state = policy_state?;
    let policy_data = account_data(&policy_pubkey, &policy_state)?.ok_or_else(|| {
        CliError::Validation(format!(
            "Faucet rate limit policy {} not found; the faucet is not rate limited on this network yet",
            policy_pubkey
        ))
    })?;
    let policy = Policy::parse(&policy_data)
        .map_err(|e| CliError::Validation(format!("Invalid faucet rate limit policy: {}", e)))?;
    if !policy.is_verified() || policy.target != context.faucet_program_bytes {
        return Err(CliError::Validation(format!(
            "Account {} is not the faucet's verified rate limit policy",
            policy_pubkey
        )));
    }
    if policy.is_paused() {
        return Err(CliError::Validation("Faucet withdrawals are paused".to_string()));
    }

    let keys = policy
        .rules
        .iter()
        .enumerate()
        .map(|(i, rule)| rule_bucket_key(i, rule, context, recipient))
        .collect::<Result<Vec<_>, CliError>>()?;

    /* Load every rule's bucket concurrently. */
    let client = &context.client;
    let buckets = try_join_all(keys.iter().enumerate().map(|(i, (_, key))| async move {
        let bytes = ratelimit::bucket_address(&RATELIMIT_PROGRAM_BYTES, &FAUCET_RATE_LIMIT_POLICY_BYTES, i as u8, key);
        let state = load_account(client, &Pubkey::from_bytes(&bytes)).await?;
        Ok::<_, CliError>((bytes, state))
    }))
    .await?;

    let mut usage = Vec::with_capacity(policy.rules.len());
    for ((rule, (label, _)), (bytes, state)) in policy.rules.iter().zip(&keys).zip(&buckets) {
        let bucket_pubkey = Pubkey::from_bytes(bytes);
        let bucket = account_data(&bucket_pubkey, state)?
            .map(|data| Bucket::parse(&data))
            .transpose()
            .map_err(|e| CliError::Validation(format!("Invalid bucket {}: {}", bucket_pubkey, e)))?;
        let now = match rule.clock {
            Clock::Slot => Some(now_slot),
            Clock::UnixSeconds => now_secs,
        };
        usage.push(check_rule(label, rule, bucket.as_ref(), now, amount)?);
    }

    /* The program can only open live accounts: restore compressed ones
       first, then fetch creation proofs for missing buckets. */
    if let AccountState::Compressed(_) = policy_state {
        restore_account(context, &policy_pubkey, json_format).await?;
    }
    for (bytes, state) in &buckets {
        if let AccountState::Compressed(_) = state {
            restore_account(context, &Pubkey::from_bytes(bytes), json_format).await?;
        }
    }
    let client = &context.client;
    let call_buckets = try_join_all(buckets.into_iter().map(|(bytes, state)| async move {
        let proof = match state {
            AccountState::Missing => make_state_proof(client, &Pubkey::from_bytes(&bytes), ProofType::Creating, None).await?,
            AccountState::Active(_) | AccountState::Compressed(_) => Vec::new(),
        };
        Ok::<_, CliError>((bytes, [0u8; 32], proof))
    }))
    .await?;

    Ok(RateLimitedWithdrawPlan { buckets: call_buckets, usage })
}

/// Checks one rule's bucket against a withdrawal of `amount` at `now` (in
/// the rule's clock) and describes the usage after it. With `now` unknown
/// the counters can't be placed in a window, so the program decides.
fn check_rule(
    label: &str,
    rule: &Rule,
    bucket: Option<&Bucket>,
    now: Option<u64>,
    amount: u64,
) -> Result<String, CliError> {
    let unit = match rule.clock {
        Clock::Slot => "slots",
        Clock::UnixSeconds => "s",
    };
    let Some(now) = now else {
        return Ok(format!(
            "Limit ({}): {} withdrawals, {} amount per {}{} window",
            label,
            limit_str(rule.max_calls),
            limit_str(rule.max_amount),
            rule.window,
            unit
        ));
    };
    let (calls, spent) = bucket.map_or((0, 0), |b| b.usage_at(rule, now));
    let retry_in = ratelimit::resets_at(rule, now, bucket.map_or(0, |b| b.window_start)) - now;
    if rule.max_calls != 0 && calls >= rule.max_calls {
        return Err(CliError::Validation(format!(
            "Rate limit reached for {}: {}/{} withdrawals this window; retry in ~{}{}",
            label, calls, rule.max_calls, retry_in, unit
        )));
    }
    let new_spent = spent.saturating_add(amount);
    if rule.max_amount != 0 && new_spent > rule.max_amount {
        return Err(CliError::Validation(format!(
            "Rate limit reached for {}: {} of {} already withdrawn this window, {} more is too much; retry in ~{}{}",
            label, spent, rule.max_amount, amount, retry_in, unit
        )));
    }
    Ok(format!(
        "Limit ({}): {}/{} withdrawals, {}/{} amount per {}{} window",
        label,
        calls + 1,
        limit_str(rule.max_calls),
        new_spent,
        limit_str(rule.max_amount),
        rule.window,
        unit
    ))
}

/// Loads `pubkey` as live, compressed or missing. A plain account read
/// would return a compressed account's archived data as if it were live.
async fn load_account(client: &Client, pubkey: &Pubkey) -> Result<AccountState, CliError> {
    client
        .get_account_state(pubkey)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to get account {}: {}", pubkey, e)))
}

/// Live or archived data of `pubkey`; None if it doesn't exist. Archived
/// data still counts toward limits, but the account must be restored before
/// the program can open it.
fn account_data(pubkey: &Pubkey, state: &AccountState) -> Result<Option<Vec<u8>>, CliError> {
    match state {
        AccountState::Active(account) | AccountState::Compressed(account) => general_purpose::STANDARD
            .decode(account.data.as_deref().unwrap_or_default())
            .map(Some)
            .map_err(|e| CliError::Validation(format!("Failed to decode account {} data: {}", pubkey, e))),
        AccountState::Missing => Ok(None),
    }
}

/// Restores a compressed account through the compression program,
/// advancing `context.nonce` when a restore transaction is sent.
async fn restore_account(
    context: &mut TransactionContext,
    pubkey: &Pubkey,
    json_format: bool,
) -> Result<(), CliError> {
    let prepared = context
        .client
        .prepare_account_decompression_checked(pubkey)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to prepare restoring {}: {}", pubkey, e)))?;
    let image = match prepared {
        AccountDecompressionPreparation::AlreadyActive => return Ok(()),
        AccountDecompressionPreparation::Cooldown { retry_slot } => {
            return Err(CliError::Validation(format!(
                "Rate limit account {} was compressed recently and can be restored from slot {}; retry then",
                pubkey, retry_slot
            )))
        }
        AccountDecompressionPreparation::Ready(image) => image,
    };
    if !json_format {
        println!("  Restoring compressed rate limit account {}", pubkey);
    }
    let transaction = TransactionBuilder::build_compression_decompress(
        context.fee_payer_keypair.public_key,
        COMPRESSION_PROGRAM_BYTES,
        pubkey.to_bytes().map_err(|e| CliError::Validation(e.to_string()))?,
        &image.account_meta,
        &image.account_data,
        &image.state_proof,
        0,
        context.nonce,
        context.start_slot,
    )
    .map_err(|e| CliError::TransactionSubmission(format!("Failed to build restore of {}: {}", pubkey, e)))?;
    execute_transaction(transaction, context, json_format).await?;
    context.nonce += 1;
    Ok(())
}

/// Block time (unix seconds) of `slot`, or None if the node doesn't report
/// one.
async fn chain_time_secs(client: &Client, slot: u64) -> Option<u64> {
    let metrics = client.get_slot_metrics(slot).await.ok()?;
    metrics.block_timestamp?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use thru_base::ratelimit::window_start;

    fn account(data: &[u8]) -> thru_client::Account {
        thru_client::Account {
            balance: 0,
            data: Some(general_purpose::STANDARD.encode(data)),
            owner: Pubkey::from_bytes(&[0u8; 32]),
            program: false,
            data_size: data.len() as u64,
            nonce: 0,
            seq: 0,
            is_new: false,
            is_ephemeral: false,
            is_deleted: false,
            is_privileged: false,
            slot: None,
            block_timestamp: None,
            version_seq: None,
            block_offset: None,
        }
    }

    fn bucket(window_start: u64, calls: u64, amount: u64) -> Bucket {
        Bucket { policy: [0u8; 32], key: [0u8; 32], rule_idx: 0, window_start, calls, amount }
    }

    fn daily(max_calls: u64, max_amount: u64) -> Rule {
        Rule { key_kind: KeyKind::FeePayer, clock: Clock::UnixSeconds, key_offset: 0, window: 86_400, max_calls, max_amount }
    }

    /// A compressed account's archived data still counts toward limits;
    /// plan_rate_limited_withdraw restores it before the withdrawal.
    #[test]
    fn compressed_account_data_is_read_from_the_archive() {
        let pubkey = Pubkey::from_bytes(&[1u8; 32]);
        let archived = AccountState::Compressed(account(&[1, 2, 3]));
        assert_eq!(account_data(&pubkey, &archived).unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(account_data(&pubkey, &AccountState::Missing).unwrap(), None);
    }

    #[test]
    fn rule_check_uses_the_given_clock() {
        let rule = daily(20, 0);
        let day = window_start(1_700_000_000, 86_400);
        let exhausted = bucket(day, 20, 0);

        let err = check_rule("fee payer", &rule, Some(&exhausted), Some(day + 100), 1).unwrap_err();
        assert!(err.to_string().contains("retry in ~86300s"), "{}", err);
        /* Once the chain's clock passes the boundary the counters reset,
           whatever the local clock says. */
        let ok = check_rule("fee payer", &rule, Some(&exhausted), Some(day + 86_400), 1).unwrap();
        assert!(ok.contains("1/20 withdrawals"), "{}", ok);
        /* Without the chain's time the program decides. */
        assert!(check_rule("fee payer", &rule, Some(&exhausted), None, 1).is_ok());
    }

    #[test]
    fn rule_check_limits_amount() {
        let rule = daily(0, 50_000);
        let day = window_start(1_700_000_000, 86_400);
        let near = bucket(day, 7, 45_000);
        assert!(check_rule("recipient", &rule, Some(&near), Some(day), 5_000).is_ok());
        let err = check_rule("recipient", &rule, Some(&near), Some(day), 5_001).unwrap_err();
        assert!(err.to_string().contains("45000 of 50000"), "{}", err);
        assert!(check_rule("recipient", &rule, None, Some(day), 10_000).unwrap().contains("unlimited withdrawals"));
    }
}
