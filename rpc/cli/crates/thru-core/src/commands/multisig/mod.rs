//! `thru multisig`: create and operate M-of-N multisigs
//! (`programs/c/examples/tn_multisig_program.c`).
//!
//! Members act one transaction at a time: a proposal creates a request
//! account, each member approves it in their own transaction, and any key
//! executes it once it has enough approvals. `--fee-payer` picks the acting
//! member for every command.

mod decode;
pub mod via;

use crate::cli::{
    MultisigCommands, MultisigCommonArgs, MultisigProposeArgs, MultisigProposeCommands,
    MultisigRequestCommands,
};
use crate::commands::state_proof::make_state_proof;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use crate::utils::{format_vm_error, validate_address_or_hex};
use base64::{Engine, engine::general_purpose};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, IsTerminal, Write};
use std::time::Duration;
use thru_base::multisig::{
    self as ms, InvokePayload, MultisigAccount, MultisigLayout, RequestAccount, RequestPayload,
    TxParams,
};
use thru_base::rpc_types::ProofType;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::{TnPubkey, Transaction};
use thru_client::{Client, ClientBuilder, TransactionDetails};

const TX_FEE: u64 = 0;
const TX_TIMEOUT_SECS: u64 = 30;

pub async fn handle_multisig_command(
    config: &Config,
    subcommand: MultisigCommands,
    json: bool,
) -> Result<(), CliError> {
    match subcommand {
        MultisigCommands::Create {
            members,
            threshold,
            seed,
            dry_run,
            common,
        } => {
            let ctx = Ctx::new(config, &common, json)?;
            create(&ctx, &members, threshold, seed.as_deref(), dry_run, &common).await
        }
        MultisigCommands::Show { multisig, common } => {
            let ctx = Ctx::new(config, &common, json)?;
            show(&ctx, &multisig).await
        }
        MultisigCommands::Requests {
            multisig,
            include_stale,
            common,
        } => {
            let ctx = Ctx::new(config, &common, json)?;
            list_requests(&ctx, &multisig, include_stale).await
        }
        MultisigCommands::Request { subcommand } => match subcommand {
            MultisigRequestCommands::Show { request, common } => {
                let ctx = Ctx::new(config, &common, json)?;
                show_request(&ctx, &request).await
            }
        },
        MultisigCommands::Propose { subcommand } => propose_command(config, subcommand, json).await,
        MultisigCommands::Approve {
            request,
            yes,
            expect_code_hash,
            expect_abi_hash,
            common,
        } => {
            let ctx = Ctx::new(config, &common, json)?;
            let pins = HashPins {
                code: expect_code_hash.as_deref(),
                abi: expect_abi_hash.as_deref(),
            };
            approve(&ctx, &request, yes, pins, &common).await
        }
        MultisigCommands::Execute {
            request,
            compute_units,
            state_units,
            consensus_program,
            expect_code_hash,
            expect_abi_hash,
            yes,
            common,
        } => {
            let mut ctx = Ctx::new(config, &common, json)?;
            ctx.consensus_program = consensus_program
                .as_deref()
                .map(validate_address_or_hex)
                .transpose()?;
            execute(
                &ctx,
                &request,
                compute_units,
                state_units,
                HashPins {
                    code: expect_code_hash.as_deref(),
                    abi: expect_abi_hash.as_deref(),
                },
                yes,
                &common,
            )
            .await
        }
        MultisigCommands::Cancel { request, common } => {
            let ctx = Ctx::new(config, &common, json)?;
            cancel(&ctx, &request, &common).await
        }
    }
}

/* ---------------- context ---------------- */

pub(crate) struct Ctx<'a> {
    pub config: &'a Config,
    pub client: Client,
    pub program: TnPubkey,
    pub json: bool,
    /// A consensus validator program the executor names with `multisig
    /// execute --consensus-program`, besides the configured and bootstrap
    /// ones. Only the executor sets it: a request can't claim its own target
    /// is the CV program.
    pub consensus_program: Option<TnPubkey>,
    names: HashMap<TnPubkey, String>,
}

impl<'a> Ctx<'a> {
    pub fn new(
        config: &'a Config,
        common: &MultisigCommonArgs,
        json: bool,
    ) -> Result<Self, CliError> {
        Self::with_program(config, common.program.as_deref(), json)
    }

    pub fn with_program(
        config: &'a Config,
        program: Option<&str>,
        json: bool,
    ) -> Result<Self, CliError> {
        let program = match program {
            Some(p) => validate_address_or_hex(p)?,
            None => pk_bytes(&config.get_multisig_program_pubkey()?)?,
        };
        let client = ClientBuilder::new()
            .insecure(config.insecure)
            .http_endpoint(config.get_grpc_url()?)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .auth_token(config.rpc_auth_token())
            .announce_pending_signature(config.announce_pending_signature)
            .build()
            .map_err(|e| {
                CliError::TransactionSubmission(format!("Failed to create RPC client: {}", e))
            })?;
        let mut names = HashMap::new();
        let mut key_names = config.keys.list_keys();
        key_names.sort();
        for name in key_names {
            // Public metadata only: naming known keys never reads a secret
            // (so it never prompts for a Keychain item).
            if let Ok(public_key) = config.keys.public_key(&format!("alias:{name}")) {
                names.entry(public_key).or_insert(name);
            }
        }
        Ok(Ctx {
            config,
            client,
            program,
            json,
            consensus_program: None,
            names,
        })
    }

    /// Key name if the key is in the local keystore.
    pub fn name(&self, k: &TnPubkey) -> Option<&str> {
        self.names.get(k).map(|s| s.as_str())
    }

    /// "name (ta...)" or "ta...".
    pub fn label(&self, k: &TnPubkey) -> String {
        match self.name(k) {
            Some(n) => format!("{} ({})", n, addr(k)),
            None => addr(k),
        }
    }

    /// Key name, or the address.
    pub fn short(&self, k: &TnPubkey) -> String {
        self.name(k).map(str::to_string).unwrap_or_else(|| addr(k))
    }

    /// The signer `name` selects (an alias, `alias:<name>`, a key file or a
    /// `keychain:` reference), or `default`.
    pub fn keypair(&self, name: Option<&str>) -> Result<KeyPair, CliError> {
        let key = self.config.keys.load_fee_payer(name)?;
        Ok(KeyPair {
            name: name.unwrap_or("default").to_string(),
            private_key: *key.private_key,
            public_key: key.public_key,
            address_string: key.address_string.clone(),
        })
    }

    /// A key name from the keystore or a ta.../hex address.
    pub fn resolve(&self, s: &str) -> Result<TnPubkey, CliError> {
        if self.config.keys.has_key(s) {
            // The registered public key; the secret is not read.
            return self.config.keys.public_key(&format!("alias:{s}"));
        }
        validate_address_or_hex(s)
            .map_err(|_| CliError::Validation(format!("'{}' is not a key name or address", s)))
    }

    pub async fn account(
        &self,
        k: &TnPubkey,
    ) -> Result<Option<(thru_client::Account, Vec<u8>)>, CliError> {
        let pk = Pubkey::from_bytes(k);
        let info = with_retry(|| self.client.get_account_info(&pk, None, None))
            .await
            .map_err(|e| {
                CliError::TransactionSubmission(format!("Failed to fetch {}: {}", addr(k), e))
            })?;
        match info {
            Some(acct) if !acct.is_deleted => {
                let data =
                    match &acct.data {
                        Some(b64) => general_purpose::STANDARD.decode(b64).map_err(|e| {
                            CliError::Generic {
                                message: format!("Bad account data: {}", e),
                            }
                        })?,
                        None => Vec::new(),
                    };
                Ok(Some((acct, data)))
            }
            _ => Ok(None),
        }
    }

    pub async fn exists(&self, k: &TnPubkey) -> Result<bool, CliError> {
        Ok(match self.account(k).await? {
            Some((acct, _)) => !acct.is_new,
            None => false,
        })
    }

    pub async fn load_multisig(&self, k: &TnPubkey) -> Result<MultisigAccount, CliError> {
        let (acct, data) = self
            .account(k)
            .await?
            .ok_or_else(|| CliError::AccountNotFound(format!("multisig {}", addr(k))))?;
        self.check_owner(&acct, k, "multisig")?;
        MultisigAccount::decode(&data)
            .map_err(|e| CliError::Validation(format!("{} is not a multisig: {}", addr(k), e)))
    }

    pub async fn load_request(&self, k: &TnPubkey) -> Result<RequestAccount, CliError> {
        let (acct, data) = self.account(k).await?.ok_or_else(|| {
            CliError::AccountNotFound(format!(
                "request {} (it may have been executed or cancelled)",
                addr(k)
            ))
        })?;
        self.check_owner(&acct, k, "request")?;
        RequestAccount::decode(&data).map_err(|e| {
            CliError::Validation(format!("{} is not a multisig request: {}", addr(k), e))
        })
    }

    fn check_owner(
        &self,
        acct: &thru_client::Account,
        k: &TnPubkey,
        what: &str,
    ) -> Result<(), CliError> {
        let owner = pk_bytes(&acct.owner)?;
        if owner != self.program {
            return Err(CliError::Validation(format!(
                "{} {} is owned by {}, not the multisig program {} (pass --program?)",
                what,
                addr(k),
                addr(&owner),
                addr(&self.program)
            )));
        }
        Ok(())
    }

    pub async fn tx_params(&self, payer: &KeyPair) -> Result<TxParams, CliError> {
        let acct = with_retry(|| {
            self.client
                .get_account_info(&payer.address_string, None, None)
        })
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to fetch fee payer: {}", e)))?
        .ok_or_else(|| CliError::AccountNotFound(format!("fee payer {}", payer.address_string)))?;
        let height = with_retry(|| self.client.get_block_height())
            .await
            .map_err(|e| {
                CliError::TransactionSubmission(format!("Failed to get block height: {}", e))
            })?;
        let chain = with_retry(|| self.client.get_chain_info())
            .await
            .map_err(|e| {
                CliError::TransactionSubmission(format!("Failed to get chain info: {}", e))
            })?;
        Ok(TxParams {
            fee: TX_FEE,
            nonce: acct.nonce,
            start_slot: height.locally_executed_height,
            chain_id: chain.chain_id,
        })
    }

    /// Signs, submits and checks a transaction; names multisig errors.
    pub async fn submit(
        &self,
        mut tx: Transaction,
        payer: &KeyPair,
    ) -> Result<TransactionDetails, CliError> {
        tx.sign(&payer.private_key)
            .map_err(|e| CliError::TransactionSubmission(format!("Failed to sign: {}", e)))?;
        let wire = tx.to_wire();
        let mut delay_ms = 1_000u64;
        let details = loop {
            match self
                .client
                .execute_transaction(&wire, Duration::from_secs(TX_TIMEOUT_SECS))
                .await
            {
                Ok(d) => break d,
                // A rate-limited submission was refused before acceptance, so resending is safe.
                Err(e) if e.to_string().contains("rate limit") && delay_ms <= 16_000 => {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    delay_ms *= 2;
                }
                Err(e) => {
                    return Err(CliError::TransactionSubmission(format!(
                        "Failed to execute transaction: {}",
                        e
                    )));
                }
            }
        };
        if details.execution_result != 0 || details.vm_error != 0 {
            let user = details.user_error_code;
            let reason = match ms::error_info(user) {
                Some((name, msg)) if user != 0 => {
                    format!("multisig error 0x{:X} {}: {}", user, name, msg)
                }
                _ if user != 0 => format!("program error 0x{:X}", user),
                _ => format!("VM error {}", format_vm_error(details.vm_error)),
            };
            return Err(CliError::TransactionSubmission(format!(
                "Transaction {} failed: {}",
                details.signature.as_str(),
                reason
            )));
        }
        Ok(details)
    }

    pub fn emit(&self, value: Value, text: &[String]) {
        if self.json {
            output::print_output(value, true);
        } else {
            for line in text {
                println!("{}", line);
            }
        }
    }
}

/// Retries reads that public RPC endpoints refuse transiently (rate limits,
/// "service unavailable"), with exponential backoff.
async fn with_retry<T, E: std::fmt::Display, F, Fut>(mut f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut delay_ms = 500u64;
    loop {
        match f().await {
            Err(e) if is_transient(&e.to_string()) && delay_ms <= 8_000 => {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                delay_ms *= 2;
            }
            other => return other,
        }
    }
}

fn is_transient(msg: &str) -> bool {
    [
        "rate limit",
        "currently unavailable",
        "upstream connect error",
        "h2 protocol error",
        "connection reset",
    ]
    .iter()
    .any(|needle| msg.contains(needle))
}

pub(crate) fn addr(k: &TnPubkey) -> String {
    Pubkey::from_bytes(k).to_string()
}

pub(crate) fn pk_bytes(p: &Pubkey) -> Result<TnPubkey, CliError> {
    p.to_bytes().map_err(|e| CliError::Crypto(e.to_string()))
}

fn sig(d: &TransactionDetails) -> String {
    d.signature.as_str().to_string()
}

/* ---------------- create / show / list ---------------- */

async fn create(
    ctx: &Ctx<'_>,
    members: &[String],
    threshold: u16,
    seed: Option<&str>,
    dry_run: bool,
    common: &MultisigCommonArgs,
) -> Result<(), CliError> {
    let payer = ctx.keypair(common.fee_payer.as_deref())?;
    let keys = resolve_members(ctx, members)?;
    check_threshold(threshold, keys.len())?;
    if !keys.contains(&payer.public_key) {
        return Err(CliError::Validation(format!(
            "the creator ({}) must be one of the members; pass a member as --fee-payer",
            ctx.short(&payer.public_key)
        )));
    }
    let seed_bytes = match seed {
        Some(s) => ms::seed_from_str(s),
        None => {
            let mut s = [0u8; 32];
            rand::RngExt::fill(&mut rand::rng(), &mut s);
            s
        }
    };
    let multisig = ms::derive_account(&ctx.program, &seed_bytes);
    let mut sorted = keys.clone();
    sorted.sort();
    let member_json: Vec<Value> = sorted.iter().map(|k| member_json(ctx, k)).collect();

    if dry_run {
        ctx.emit(
            json!({"multisig_create": {"status": "dry_run", "multisig": addr(&multisig), "seed": hex::encode(seed_bytes), "members": member_json, "threshold": threshold}}),
            &[format!("Multisig address: {}", addr(&multisig)), format!("Seed: {}", hex::encode(seed_bytes))],
        );
        return Ok(());
    }
    if ctx.exists(&multisig).await? {
        return Err(CliError::Validation(format!(
            "multisig {} already exists",
            addr(&multisig)
        )));
    }

    let pk = Pubkey::from_bytes(&multisig);
    let proof =
        with_retry(|| make_state_proof(&ctx.client, &pk, ProofType::Creating, None)).await?;
    let p = ctx.tx_params(&payer).await?;
    let (tx, _) = ms::build_create_multisig_tx(
        payer.public_key,
        ctx.program,
        &seed_bytes,
        &keys,
        threshold,
        &proof,
        &p,
    )
    .map_err(build_err)?;
    let d = ctx.submit(tx, &payer).await?;

    let mut text = vec![
        format!(
            "Created {}-of-{} multisig {}",
            threshold,
            keys.len(),
            addr(&multisig)
        ),
        format!("Seed: {}", hex::encode(seed_bytes)),
        "Members:".to_string(),
    ];
    text.extend(sorted.iter().map(|k| format!("  {}", ctx.label(k))));
    text.push(format!("Signature: {}", sig(&d)));
    ctx.emit(
        json!({"multisig_create": {"status": "success", "multisig": addr(&multisig), "seed": hex::encode(seed_bytes), "members": member_json, "threshold": threshold, "signature": sig(&d)}}),
        &text,
    );
    Ok(())
}

fn member_json(ctx: &Ctx<'_>, k: &TnPubkey) -> Value {
    json!({"address": addr(k), "name": ctx.name(k)})
}

fn resolve_members(ctx: &Ctx<'_>, members: &[String]) -> Result<Vec<TnPubkey>, CliError> {
    let mut keys = Vec::new();
    for m in members.iter().map(|m| m.trim()).filter(|m| !m.is_empty()) {
        let k = ctx.resolve(m)?;
        if keys.contains(&k) {
            return Err(CliError::Validation(format!("duplicate member '{}'", m)));
        }
        keys.push(k);
    }
    if keys.len() < ms::MIN_MEMBERS || keys.len() > ms::MAX_MEMBERS {
        return Err(CliError::Validation(format!(
            "a multisig needs {}-{} members (got {})",
            ms::MIN_MEMBERS,
            ms::MAX_MEMBERS,
            keys.len()
        )));
    }
    Ok(keys)
}

fn check_threshold(threshold: u16, n: usize) -> Result<(), CliError> {
    if threshold < 1 || threshold as usize > n {
        return Err(CliError::Validation(format!(
            "threshold must be between 1 and {} (got {})",
            n, threshold
        )));
    }
    Ok(())
}

async fn show(ctx: &Ctx<'_>, multisig: &str) -> Result<(), CliError> {
    let msk = ctx.resolve(multisig)?;
    let m = ctx.load_multisig(&msk).await?;
    let n = m.members.len() as u16;
    let mut text = vec![
        format!("Multisig {}", addr(&msk)),
        format!(
            "Threshold {}-of-{} (member and threshold changes need {})",
            m.threshold,
            n,
            ms::required_approvals(ms::KIND_UPDATE_THRESHOLD, n, m.threshold)
        ),
        format!(
            "Epoch {}, {} live request(s), next request id {}",
            m.config_epoch, m.live_request_cnt, m.next_request_id
        ),
        "Members:".to_string(),
    ];
    text.extend(m.members.iter().map(|k| format!("  {}", ctx.label(k))));
    ctx.emit(
        json!({"multisig": {
            "address": addr(&msk),
            "threshold": m.threshold,
            "member_count": n,
            "config_change_approvals": ms::required_approvals(ms::KIND_UPDATE_THRESHOLD, n, m.threshold),
            "members": m.members.iter().map(|k| member_json(ctx, k)).collect::<Vec<_>>(),
            "config_epoch": m.config_epoch,
            "live_request_count": m.live_request_cnt,
            "next_request_id": m.next_request_id,
        }}),
        &text,
    );
    Ok(())
}

async fn list_requests(ctx: &Ctx<'_>, multisig: &str, include_stale: bool) -> Result<(), CliError> {
    let msk = ctx.resolve(multisig)?;
    let m = ctx.load_multisig(&msk).await?;
    let owned = list_program_accounts(ctx).await?;
    let mut rows: Vec<(TnPubkey, RequestAccount)> = owned
        .into_iter()
        .filter_map(|(k, data)| RequestAccount::decode(&data).ok().map(|r| (k, r)))
        .filter(|(_, r)| r.multisig == msk)
        .filter(|(_, r)| include_stale || !r.is_stale(&m))
        .collect();
    rows.sort_by_key(|(_, r)| r.request_id);

    let mut text = vec![format!(
        "{} request(s) for multisig {}",
        rows.len(),
        addr(&msk)
    )];
    let mut items = Vec::new();
    for (k, r) in &rows {
        let status = status_of(r, Some(&m));
        text.push(format!(
            "  #{:<4} {:<15} {:<6} {}/{} approvals  proposer {}  {}",
            r.request_id,
            ms::kind_name(r.kind),
            status,
            r.approval_count(),
            r.required_approvals,
            ctx.short(&r.proposer),
            addr(k)
        ));
        items.push(json!({
            "request": addr(k), "request_id": r.request_id, "kind": ms::kind_name(r.kind),
            "status": status, "approvals": r.approval_count(), "required": r.required_approvals,
            "proposer": addr(&r.proposer),
        }));
    }
    ctx.emit(
        json!({"multisig_requests": {"multisig": addr(&msk), "requests": items}}),
        &text,
    );
    Ok(())
}

/// All accounts owned by the multisig program, with their data.
async fn list_program_accounts(ctx: &Ctx<'_>) -> Result<Vec<(TnPubkey, Vec<u8>)>, CliError> {
    let items = ctx
        .client
        .list_accounts_by_owner(&Pubkey::from_bytes(&ctx.program), None)
        .await
        .map_err(|e| CliError::TransactionSubmission(format!("Failed to list accounts: {}", e)))?;
    let mut out = Vec::new();
    for item in items {
        out.push((pk_bytes(&item.address)?, item.data));
    }
    Ok(out)
}

fn status_of(r: &RequestAccount, m: Option<&MultisigAccount>) -> &'static str {
    match m {
        None => "ORPHAN",
        Some(m) if r.is_stale(m) => "STALE",
        Some(_) if r.approval_count() >= r.required_approvals as u32 => "READY",
        Some(_) => "OPEN",
    }
}

/* ---------------- describe ---------------- */

/// Hashes a member pins when approving or executing an upgrade.
#[derive(Clone, Copy, Default)]
struct HashPins<'a> {
    code: Option<&'a str>,
    abi: Option<&'a str>,
}

struct Described {
    text: Vec<String>,
    json: Value,
    hints: decode::ExecHints,
    code_hash: Option<String>,
    accounts: decode::AccountCheck,
}

impl Described {
    /// Checks every hash the action needs pinned.
    fn check_pins(&self, pins: HashPins<'_>) -> Result<(), CliError> {
        self.check_code_hash(pins.code)?;
        self.check_abi_hash(pins.abi)
    }

    /// Fails unless the ABI a program + ABI upgrade publishes matches
    /// `expected`. The ABI buffer's owner can replace it until execution,
    /// just like the code buffer.
    fn check_abi_hash(&self, expected: Option<&str>) -> Result<(), CliError> {
        let decoded = &self.json["action"]["decoded"];
        let is_combined = decoded["type"] == "multicall.program_abi_upgrade";
        let actual = decoded["abi_sha256"].as_str();
        let Some(expected) = expected else {
            if is_combined {
                return Err(CliError::Validation(format!(
                    "this request also publishes the program's ABI, which the request does not bind: the buffer's owner can replace it until execution. Verify the ABI, then pass --expect-abi-hash {}",
                    actual.unwrap_or("<sha256>")
                )));
            }
            return Ok(());
        };
        let expected = expected.trim().trim_start_matches("0x").to_lowercase();
        match actual {
            Some(h) if is_combined && h == expected => Ok(()),
            Some(h) if is_combined => Err(CliError::Validation(format!(
                "ABI hash is {}, not the expected {}",
                h, expected
            ))),
            _ => Err(CliError::Validation(
                "--expect-abi-hash given, but this request is not a program + ABI upgrade with a readable ABI buffer".into(),
            )),
        }
    }

    /// Fails unless the upgrade code matches `expected` (when given).
    fn check_code_hash(&self, expected: Option<&str>) -> Result<(), CliError> {
        let decoded_type = &self.json["action"]["decoded"]["type"];
        let is_upgrade = decoded_type == "manager.upgrade"
            || decoded_type == "multicall.program_abi_upgrade";
        let Some(expected) = expected else {
            if is_upgrade {
                return Err(CliError::Validation(format!(
                    "this request upgrades a program to the code with sha256 {0}; the request binds that hash. Verify the code you expect hashes to it, then pass --expect-code-hash {0}",
                    self.code_hash.as_deref().unwrap_or("<sha256>")
                )));
            }
            return Ok(());
        };
        let expected = expected.trim().trim_start_matches("0x").to_lowercase();
        match &self.code_hash {
            Some(h) if *h == expected => Ok(()),
            Some(h) => Err(CliError::Validation(format!(
                "upgrade code hash is {}, not the expected {}",
                h, expected
            ))),
            None => Err(CliError::Validation(
                "--expect-code-hash given, but this request is not a program upgrade".into(),
            )),
        }
    }
}

async fn describe(
    ctx: &Ctx<'_>,
    req_key: &TnPubkey,
    r: &RequestAccount,
) -> Result<Described, CliError> {
    let m = ctx.load_multisig(&r.multisig).await.ok();
    let status = status_of(r, m.as_ref());
    let approvers: Vec<TnPubkey> = m.as_ref().map(|m| r.approvers(m)).unwrap_or_default();
    let approver_names: Vec<String> = approvers.iter().map(|k| ctx.short(k)).collect();
    let status_line = match status {
        "READY" => format!("READY: {}/{} approvals ({})", r.approval_count(), r.required_approvals, approver_names.join(", ")),
        "OPEN" => format!(
            "OPEN: {}/{} approvals{}",
            r.approval_count(),
            r.required_approvals,
            if approver_names.is_empty() { String::new() } else { format!(" ({})", approver_names.join(", ")) }
        ),
        "STALE" => "STALE: the multisig changed after this was proposed; it can't execute. Any member can cancel it.".to_string(),
        _ => "ORPHAN: the multisig no longer exists".to_string(),
    };
    let ms_line = match &m {
        Some(m) => format!(
            "{}   ({}-of-{}: {})",
            addr(&r.multisig),
            m.threshold,
            m.members.len(),
            m.members
                .iter()
                .map(|k| ctx.short(k))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        None => addr(&r.multisig),
    };

    let action = decode::describe_payload(ctx, r, m.as_ref()).await;
    let mut text = vec![
        format!("Request   {}  (#{})", addr(req_key), r.request_id),
        format!("Multisig  {}", ms_line),
        format!("Type      {}", ms::kind_name(r.kind)),
        format!("Status    {}", status_line),
        format!("Proposer  {}", ctx.short(&r.proposer)),
        String::new(),
    ];
    text.extend(action.text.iter().cloned());
    let json = json!({
        "request": addr(req_key),
        "request_id": r.request_id,
        "multisig": addr(&r.multisig),
        "kind": ms::kind_name(r.kind),
        "status": status,
        "approvals": r.approval_count(),
        "required": r.required_approvals,
        "approvers": approvers.iter().map(|k| member_json(ctx, k)).collect::<Vec<_>>(),
        "proposer": member_json(ctx, &r.proposer),
        "config_epoch": r.config_epoch_snapshot,
        "action": action.json,
    });
    Ok(Described {
        text,
        json,
        hints: action.hints,
        code_hash: action.code_hash,
        accounts: action.accounts,
    })
}

async fn show_request(ctx: &Ctx<'_>, request: &str) -> Result<(), CliError> {
    let rk = ctx.resolve(request)?;
    let r = ctx.load_request(&rk).await?;
    let d = describe(ctx, &rk, &r).await?;
    ctx.emit(json!({"multisig_request": d.json}), &d.text);
    Ok(())
}

/* ---------------- approve / execute / cancel ---------------- */

async fn approve(
    ctx: &Ctx<'_>,
    request: &str,
    yes: bool,
    pins: HashPins<'_>,
    common: &MultisigCommonArgs,
) -> Result<(), CliError> {
    let payer = ctx.keypair(common.fee_payer.as_deref())?;
    let rk = ctx.resolve(request)?;
    let r = ctx.load_request(&rk).await?;
    let m = ctx.load_multisig(&r.multisig).await?;
    let me = m.member_index(&payer.public_key).ok_or_else(|| {
        CliError::Validation(format!(
            "{} is not a member of multisig {}",
            ctx.short(&payer.public_key),
            addr(&r.multisig)
        ))
    })?;
    if r.is_stale(&m) {
        return Err(CliError::Validation(
            "this request is stale and can't execute; cancel it instead".into(),
        ));
    }
    if r.has_approved(me) {
        return Err(CliError::Validation(format!(
            "{} already approved this request",
            ctx.short(&payer.public_key)
        )));
    }
    let d = describe(ctx, &rk, &r).await?;
    d.check_pins(pins)?;
    check_accounts(&d)?;
    let after = r.approval_count() + 1;
    let ready = after >= r.required_approvals as u32;
    if !yes {
        if ctx.json || !std::io::stdin().is_terminal() {
            return Err(CliError::Validation(
                "pass --yes to approve non-interactively".into(),
            ));
        }
        for line in &d.text {
            println!("{}", line);
        }
        println!();
        let prompt = format!(
            "Approve as {}? This is approval {} of {}{}. [y/N] ",
            ctx.short(&payer.public_key),
            after,
            r.required_approvals,
            if ready {
                ": the request becomes executable"
            } else {
                ""
            }
        );
        if !confirm(&prompt)? {
            return Err(CliError::Validation("not approved".into()));
        }
    }
    recheck(ctx, &rk, &r).await?;
    let p = ctx.tx_params(&payer).await?;
    let tx = ms::build_approve_tx(
        payer.public_key,
        ctx.program,
        r.multisig,
        rk,
        r.request_id,
        &r.data_hash(),
        &p,
    )
    .map_err(build_err)?;
    let signature = match ctx.submit(tx, &payer).await {
        Ok(d) => sig(&d),
        Err(e) if approval_recorded(ctx, &rk, me).await => {
            format!("unreported ({}); the approval is recorded on chain", e)
        }
        Err(e) => return Err(e),
    };
    let mut text = vec![format!(
        "Approved as {}: {}/{} approvals{}",
        ctx.short(&payer.public_key),
        after,
        r.required_approvals,
        if ready { ". Ready to execute:" } else { "" }
    )];
    if ready {
        text.push(format!("  thru multisig execute {}", addr(&rk)));
    }
    text.push(format!("Signature: {}", signature));
    ctx.emit(
        json!({"multisig_approve": {"status": "success", "request": addr(&rk), "approver": member_json(ctx, &payer.public_key), "approvals": after, "required": r.required_approvals, "ready": ready, "signature": signature}}),
        &text,
    );
    Ok(())
}

fn confirm(prompt: &str) -> Result<bool, CliError> {
    print!("{}", prompt);
    std::io::stdout().flush().ok();
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| CliError::Generic {
            message: e.to_string(),
        })?;
    Ok(matches!(line.trim().to_lowercase().as_str(), "y" | "yes"))
}

/// Refuses a request whose child call uses accounts the request doesn't record.
fn check_accounts(d: &Described) -> Result<(), CliError> {
    match &d.accounts {
        decode::AccountCheck::Unlisted(idx) => Err(CliError::Validation(format!(
            "this request's call uses account index(es) {:?} that the request doesn't record (index 0 is the executing key's wallet); refusing",
            idx
        ))),
        decode::AccountCheck::ForeignAuthority(why) => Err(CliError::Validation(format!(
            "{}; the executing key is always authorized, so this could act with its authority; refusing",
            why
        ))),
        _ => Ok(()),
    }
}

/// Reads a request just created by this command, retrying briefly while it
/// becomes visible to reads.
async fn load_created_request(ctx: &Ctx<'_>, rk: &TnPubkey) -> Result<RequestAccount, CliError> {
    let mut last = None;
    for _ in 0..5 {
        match ctx.load_request(rk).await {
            Ok(r) => return Ok(r),
            Err(e) => last = Some(e),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(last.unwrap_or_else(|| CliError::Validation("request not found".into())))
}

/// After a submit error, whether `member_idx`'s approval is recorded on chain
/// anyway: a transaction can land while the RPC fails to report its result.
async fn approval_recorded(ctx: &Ctx<'_>, rk: &TnPubkey, member_idx: usize) -> bool {
    tokio::time::sleep(Duration::from_secs(2)).await;
    matches!(ctx.load_request(rk).await, Ok(r) if r.has_approved(member_idx))
}

/// Re-reads the request just before signing and refuses if it was replaced
/// (cancelled and recreated at the same address) since it was shown.
async fn recheck(ctx: &Ctx<'_>, rk: &TnPubkey, shown: &RequestAccount) -> Result<(), CliError> {
    let now = ctx.load_request(rk).await?;
    if now.request_id != shown.request_id
        || now.payload != shown.payload
        || now.multisig != shown.multisig
        || now.proposer != shown.proposer
        || now.config_epoch_snapshot != shown.config_epoch_snapshot
    {
        return Err(CliError::Validation(
            "the request changed since it was shown (it was cancelled and recreated); review it again".into(),
        ));
    }
    Ok(())
}

/// The execute transaction's (compute, state) units: an explicit
/// `--compute-units` / `--state-units`, else the decoder's hint for the
/// action, else the default.
fn execute_units(
    compute_units: Option<u32>,
    state_units: Option<u16>,
    hints: decode::ExecHints,
) -> (u32, u16) {
    (
        compute_units
            .or(hints.compute_units)
            .unwrap_or(ms::EXECUTE_COMPUTE_UNITS),
        state_units.or(hints.state_units).unwrap_or(0),
    )
}

async fn execute(
    ctx: &Ctx<'_>,
    request: &str,
    compute_units: Option<u32>,
    state_units: Option<u16>,
    pins: HashPins<'_>,
    yes: bool,
    common: &MultisigCommonArgs,
) -> Result<(), CliError> {
    let payer = ctx.keypair(common.fee_payer.as_deref())?;
    let rk = ctx.resolve(request)?;
    let r = ctx.load_request(&rk).await?;
    let m = ctx.load_multisig(&r.multisig).await?;
    if r.is_stale(&m) {
        return Err(CliError::Validation(
            "this request is stale and can't execute; cancel it instead".into(),
        ));
    }
    if r.approval_count() < r.required_approvals as u32 {
        return Err(CliError::Validation(format!(
            "not enough approvals yet: {}/{}",
            r.approval_count(),
            r.required_approvals
        )));
    }
    if r.kind == ms::KIND_DELETE_MULTISIG && m.live_request_cnt > 1 {
        return Err(CliError::Validation(format!(
            "{} other request(s) are still live; execute or cancel them first",
            m.live_request_cnt - 1
        )));
    }
    let d = describe(ctx, &rk, &r).await?;
    d.check_pins(pins)?;
    check_accounts(&d)?;
    if !yes {
        if ctx.json || !std::io::stdin().is_terminal() {
            return Err(CliError::Validation(
                "pass --yes to execute non-interactively".into(),
            ));
        }
        for line in &d.text {
            println!("{}", line);
        }
        println!();
        let prompt = format!(
            "Execute as {}? Your key signs and pays for this transaction. [y/N] ",
            ctx.short(&payer.public_key)
        );
        if !confirm(&prompt)? {
            return Err(CliError::Validation("not executed".into()));
        }
    }
    recheck(ctx, &rk, &r).await?;
    let layout = MultisigLayout::from_request(payer.public_key, ctx.program, r.multisig, rk, &r)
        .map_err(|e| CliError::Validation(e.to_string()))?;
    let (cu, su) = execute_units(compute_units, state_units, d.hints);
    let p = ctx.tx_params(&payer).await?;
    let tx = ms::build_execute_tx(&layout, r.multisig, rk, cu, su, &p).map_err(build_err)?;
    let det = ctx.submit(tx, &payer).await?;
    let gone = !ctx.exists(&rk).await.unwrap_or(false);
    let mut text = vec![format!(
        "Executed request #{} ({})",
        r.request_id,
        ms::kind_name(r.kind)
    )];
    text.extend(d.text.iter().skip(6).cloned());
    text.push(format!("Signature: {}", sig(&det)));
    ctx.emit(
        json!({"multisig_execute": {"status": "success", "request": addr(&rk), "request_deleted": gone, "action": d.json["action"], "signature": sig(&det)}}),
        &text,
    );
    Ok(())
}

async fn cancel(ctx: &Ctx<'_>, request: &str, common: &MultisigCommonArgs) -> Result<(), CliError> {
    let payer = ctx.keypair(common.fee_payer.as_deref())?;
    let rk = ctx.resolve(request)?;
    let r = ctx.load_request(&rk).await?;
    let m = ctx.load_multisig(&r.multisig).await?;
    if m.member_index(&payer.public_key).is_none() {
        return Err(CliError::Validation(format!(
            "{} is not a member",
            ctx.short(&payer.public_key)
        )));
    }
    if !r.is_stale(&m) {
        if r.proposer != payer.public_key {
            return Err(CliError::Validation(format!(
                "only the proposer ({}) can cancel an open request",
                ctx.short(&r.proposer)
            )));
        }
        if r.approval_count() > 0 {
            return Err(CliError::Validation(
                "a request can't be cancelled once it has approvals (the program forbids it); it stays until executed or made stale".into(),
            ));
        }
    }
    let p = ctx.tx_params(&payer).await?;
    let tx = ms::build_delete_tx(payer.public_key, ctx.program, r.multisig, rk, &p)
        .map_err(build_err)?;
    let det = ctx.submit(tx, &payer).await?;
    ctx.emit(
        json!({"multisig_cancel": {"status": "success", "request": addr(&rk), "signature": sig(&det)}}),
        &[format!("Cancelled request #{} {}", r.request_id, addr(&rk)), format!("Signature: {}", sig(&det))],
    );
    Ok(())
}

/* ---------------- propose ---------------- */

/// What a proposal does. `build` gets the transaction layout so child
/// instructions can be encoded with the right account indices.
pub(crate) struct ProposeSpec {
    pub summary: String,
    pub child_rw: Vec<TnPubkey>,
    pub child_ro: Vec<TnPubkey>,
    pub build: Box<dyn Fn(&MultisigLayout, &TnPubkey) -> Result<RequestPayload, CliError> + Send>,
    /// Request seed pinned by `--show-layout`; otherwise derived from the next request id.
    pub request_seed: Option<[u8; 32]>,
    /// Arguments `thru multisig execute` should get for this request (such
    /// as `--consensus-program`), shown with the execute command and, with
    /// --json, as `execute_args`.
    pub execute_args: Vec<String>,
}

impl ProposeSpec {
    /// An invoke of `target`; `encode` builds the child instruction against the layout.
    pub fn invoke(
        summary: String,
        target: TnPubkey,
        child_rw: Vec<TnPubkey>,
        child_ro: Vec<TnPubkey>,
        encode: impl Fn(&MultisigLayout, &TnPubkey) -> Result<Vec<u8>, CliError> + Send + 'static,
    ) -> Self {
        let mut ro = child_ro.clone();
        ro.push(target);
        let accounts: Vec<TnPubkey> = child_rw.iter().chain(child_ro.iter()).copied().collect();
        ProposeSpec {
            summary,
            child_rw,
            child_ro: ro,
            build: Box::new(move |layout, multisig| {
                let data = encode(layout, multisig)?;
                invoke_payload(layout, *multisig, target, &accounts, data)
            }),
            request_seed: None,
            execute_args: Vec::new(),
        }
    }

    fn config(summary: String, payload: RequestPayload) -> Self {
        ProposeSpec {
            summary,
            child_rw: vec![],
            child_ro: vec![],
            build: Box::new(move |_, _| Ok(payload.clone())),
            request_seed: None,
            execute_args: Vec::new(),
        }
    }
}

pub(crate) fn invoke_payload(
    layout: &MultisigLayout,
    multisig: TnPubkey,
    target: TnPubkey,
    accounts: &[TnPubkey],
    data: Vec<u8>,
) -> Result<RequestPayload, CliError> {
    let mut refs: Vec<(u16, TnPubkey)> = Vec::new();
    for k in accounts.iter().chain(std::iter::once(&multisig)) {
        let idx = layout
            .idx(k)
            .map_err(|e| CliError::Validation(e.to_string()))?;
        if idx == 0 {
            return Err(CliError::Validation(format!(
                "the proposing key {} is one of the accounts this call uses; propose with another member as --fee-payer",
                addr(k)
            )));
        }
        refs.push((idx, *k));
    }
    refs.sort();
    refs.dedup();
    Ok(RequestPayload::Invoke(InvokePayload {
        target_program_idx: layout
            .idx(&target)
            .map_err(|e| CliError::Validation(e.to_string()))?,
        target_program: target,
        refs,
        instr_data: data,
    }))
}

async fn propose_command(
    config: &Config,
    cmd: MultisigProposeCommands,
    json: bool,
) -> Result<(), CliError> {
    match cmd {
        MultisigProposeCommands::Invoke {
            multisig,
            target,
            data,
            rw,
            ro,
            show_layout,
            request_seed,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let target = ctx.resolve(&target)?;
            let rw = rw
                .iter()
                .map(|s| ctx.resolve(s))
                .collect::<Result<Vec<_>, _>>()?;
            let ro = ro
                .iter()
                .map(|s| ctx.resolve(s))
                .collect::<Result<Vec<_>, _>>()?;
            if show_layout {
                return print_invoke_layout(&ctx, &multisig, target, &rw, &ro, &pa).await;
            }
            let data_hex = data.unwrap_or_default();
            let bytes = hex::decode(data_hex.trim_start_matches("0x"))
                .map_err(|e| CliError::Validation(format!("--data is not hex: {}", e)))?;
            let seed: [u8; 32] =
                hex::decode(request_seed.unwrap_or_default().trim_start_matches("0x"))
                    .ok()
                    .and_then(|b| b.try_into().ok())
                    .ok_or_else(|| {
                        CliError::Validation("--request-seed must be 32 bytes of hex".into())
                    })?;
            let mut spec = ProposeSpec::invoke(
                format!("call {} with {} bytes", ctx.short(&target), bytes.len()),
                target,
                rw,
                ro,
                move |_, _| Ok(bytes.clone()),
            );
            spec.request_seed = Some(seed);
            propose(&ctx, &multisig, &pa, spec).await
        }
        MultisigProposeCommands::SetThreshold {
            multisig,
            threshold,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            check_threshold(threshold, m.members.len())?;
            let spec = ProposeSpec::config(
                format!("threshold {} -> {}", m.threshold, threshold),
                RequestPayload::UpdateThreshold {
                    new_threshold: threshold,
                },
            );
            propose(&ctx, &multisig, &pa, spec).await
        }
        MultisigProposeCommands::SetMembers {
            multisig,
            members,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            let keys = resolve_members(&ctx, &members)?;
            propose_membership(&ctx, &multisig, &m, keys, &pa).await
        }
        MultisigProposeCommands::AddMembers {
            multisig,
            members,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            let mut keys = m.members.clone();
            for s in &members {
                let k = ctx.resolve(s.trim())?;
                if keys.contains(&k) {
                    return Err(CliError::Validation(format!(
                        "{} is already a member",
                        ctx.short(&k)
                    )));
                }
                keys.push(k);
            }
            propose_membership(&ctx, &multisig, &m, keys, &pa).await
        }
        MultisigProposeCommands::RemoveMembers {
            multisig,
            members,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            let mut keys = m.members.clone();
            for s in &members {
                let k = ctx.resolve(s.trim())?;
                let pos = keys.iter().position(|x| *x == k).ok_or_else(|| {
                    CliError::Validation(format!("{} is not a member", ctx.short(&k)))
                })?;
                keys.remove(pos);
            }
            propose_membership(&ctx, &multisig, &m, keys, &pa).await
        }
        MultisigProposeCommands::ReplaceMembers {
            multisig,
            old,
            new,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            if old.len() != new.len() {
                return Err(CliError::Validation(format!(
                    "--old has {} member(s) but --new has {}; give one replacement per member",
                    old.len(),
                    new.len()
                )));
            }
            let mut keys = m.members.clone();
            for (o, n) in old.iter().zip(new.iter()) {
                let (o, n) = (ctx.resolve(o.trim())?, ctx.resolve(n.trim())?);
                let pos = keys.iter().position(|x| *x == o).ok_or_else(|| {
                    CliError::Validation(format!("{} is not a member", ctx.short(&o)))
                })?;
                if keys.contains(&n) {
                    return Err(CliError::Validation(format!(
                        "{} is already a member",
                        ctx.short(&n)
                    )));
                }
                keys[pos] = n;
            }
            propose_membership(&ctx, &multisig, &m, keys, &pa).await
        }
        MultisigProposeCommands::DeleteMultisig {
            multisig,
            propose: pa,
        } => {
            let ctx = Ctx::new(config, &pa.common, json)?;
            let m = ctx.load_multisig(&ctx.resolve(&multisig)?).await?;
            if m.live_request_cnt > 0 && !ctx.json {
                output::print_warning(&format!(
                    "{} other request(s) are live; this can only execute after they are executed or cancelled",
                    m.live_request_cnt
                ));
            }
            propose(
                &ctx,
                &multisig,
                &pa,
                ProposeSpec::config("delete the multisig".into(), RequestPayload::DeleteMultisig),
            )
            .await
        }
    }
}

/// Proposes `keys` as the new member list (all membership commands end here).
async fn propose_membership(
    ctx: &Ctx<'_>,
    multisig: &str,
    m: &MultisigAccount,
    mut keys: Vec<TnPubkey>,
    pa: &MultisigProposeArgs,
) -> Result<(), CliError> {
    if keys.len() < ms::MIN_MEMBERS || keys.len() > ms::MAX_MEMBERS {
        return Err(CliError::Validation(format!(
            "a multisig needs {}-{} members; this change leaves {}",
            ms::MIN_MEMBERS,
            ms::MAX_MEMBERS,
            keys.len()
        )));
    }
    keys.sort();
    if keys.windows(2).any(|w| w[0] == w[1]) {
        return Err(CliError::Validation(
            "the new member list has a duplicate".into(),
        ));
    }
    let removed: Vec<String> = m
        .members
        .iter()
        .filter(|k| !keys.contains(k))
        .map(|k| ctx.short(k))
        .collect();
    let added: Vec<String> = keys
        .iter()
        .filter(|k| !m.members.contains(k))
        .map(|k| ctx.short(k))
        .collect();
    if removed.is_empty() && added.is_empty() {
        return Err(CliError::Validation("the member list is unchanged".into()));
    }
    if (m.threshold as usize) > keys.len() && !ctx.json {
        output::print_warning(&format!(
            "the new list has {} members; the threshold will drop from {} to {}",
            keys.len(),
            m.threshold,
            keys.len()
        ));
    }
    let none = |v: &[String]| {
        if v.is_empty() {
            "none".to_string()
        } else {
            v.join(", ")
        }
    };
    let spec = ProposeSpec::config(
        format!(
            "members {} -> {} (removed: {}; added: {})",
            m.members.len(),
            keys.len(),
            none(&removed),
            none(&added)
        ),
        RequestPayload::UpdateMembership { members: keys },
    );
    propose(ctx, multisig, pa, spec).await
}

/// Number of request seeds tried before giving up.
const SEED_ATTEMPTS: u32 = 4096;

/// Picks the request address for a proposal: a free account whose layout
/// execution will rebuild exactly (same indices and the same writable and
/// read-only accounts). With a pinned seed, only that one is checked.
async fn choose_request(
    ctx: &Ctx<'_>,
    payer: &TnPubkey,
    msk: &TnPubkey,
    m: &MultisigAccount,
    spec: &ProposeSpec,
) -> Result<([u8; 32], TnPubkey, MultisigLayout, RequestPayload), CliError> {
    let try_seed =
        |seed: [u8; 32]| -> Result<Option<(TnPubkey, MultisigLayout, RequestPayload)>, CliError> {
            let rk = ms::derive_account(&ctx.program, &seed);
            let layout = MultisigLayout::for_request(
                *payer,
                ctx.program,
                *msk,
                rk,
                &spec.child_rw,
                &spec.child_ro,
            );
            let payload = (spec.build)(&layout, msk)?;
            Ok(layout
                .reproduces(*msk, rk, &payload)
                .then_some((rk, layout, payload)))
        };
    if let Some(seed) = spec.request_seed {
        let (rk, layout, payload) = try_seed(seed)?.ok_or_else(|| {
            CliError::Validation(
                "this request seed gives an ambiguous account layout; run --show-layout again"
                    .into(),
            )
        })?;
        if ctx.exists(&rk).await? {
            return Err(CliError::Validation(format!(
                "request seed already used ({}); run --show-layout again and re-encode --data",
                addr(&rk)
            )));
        }
        return Ok((seed, rk, layout, payload));
    }
    for attempt in 0..SEED_ATTEMPTS {
        let seed = ms::request_seed(msk, m.next_request_id, attempt);
        if let Some((rk, layout, payload)) = try_seed(seed)? {
            if !ctx.exists(&rk).await? {
                return Ok((seed, rk, layout, payload));
            }
        }
    }
    Err(CliError::Validation(
        "could not find a request address with an unambiguous account layout; retry".into(),
    ))
}

async fn print_invoke_layout(
    ctx: &Ctx<'_>,
    multisig: &str,
    target: TnPubkey,
    rw: &[TnPubkey],
    ro: &[TnPubkey],
    pa: &MultisigProposeArgs,
) -> Result<(), CliError> {
    let payer = ctx.keypair(pa.common.fee_payer.as_deref())?;
    let msk = ctx.resolve(multisig)?;
    let m = ctx.load_multisig(&msk).await?;
    m.member_index(&payer.public_key).ok_or_else(|| {
        CliError::Validation(format!(
            "{} is not a member; only members can propose",
            ctx.short(&payer.public_key)
        ))
    })?;
    // A random seed (one derived from the next request id would be taken by any
    // proposal made before this one) whose layout execution rebuilds exactly.
    let mut child_ro = ro.to_vec();
    child_ro.push(target);
    let accounts: Vec<TnPubkey> = rw.iter().chain(ro.iter()).copied().collect();
    let mut chosen = None;
    for _ in 0..SEED_ATTEMPTS {
        let mut seed = [0u8; 32];
        rand::RngExt::fill(&mut rand::rng(), &mut seed);
        let rk = ms::derive_account(&ctx.program, &seed);
        let layout =
            MultisigLayout::for_request(payer.public_key, ctx.program, msk, rk, rw, &child_ro);
        let probe = invoke_payload(&layout, msk, target, &accounts, Vec::new())?;
        if layout.reproduces(msk, rk, &probe) && !ctx.exists(&rk).await? {
            chosen = Some((seed, rk, layout));
            break;
        }
    }
    let (seed, rk, layout) = chosen.ok_or_else(|| {
        CliError::Validation(
            "could not find a request address with an unambiguous account layout".into(),
        )
    })?;
    let mut rows: Vec<(u16, TnPubkey, &str)> = Vec::new();
    rows.push((0, payer.public_key, "fee payer (proposer)"));
    rows.push((1, ctx.program, "multisig program"));
    for k in layout.rw.iter().chain(layout.ro.iter()) {
        let role = if *k == msk {
            "multisig (the authority to use)"
        } else if *k == rk {
            "request"
        } else if *k == target {
            "target program"
        } else if layout.is_writable(k) {
            "writable"
        } else {
            "read-only"
        };
        rows.push((layout.idx(k).unwrap_or(0), *k, role));
    }
    let mut text: Vec<String> =
        std::iter::once("Encode --data with these account indices:".to_string())
            .chain(
                rows.iter()
                    .map(|(i, k, role)| format!("  #{:<3} {:<34} {}", i, role, ctx.label(k))),
            )
            .collect();
    text.push(format!(
        "Propose with --request-seed {} (keeps these indices fixed) and the same --fee-payer, --rw and --ro",
        hex::encode(seed)
    ));
    ctx.emit(
        json!({
            "multisig_layout": rows.iter().map(|(i, k, role)| json!({"index": i, "address": addr(k), "role": role})).collect::<Vec<_>>(),
            "request_seed": hex::encode(seed),
            "request": addr(&rk),
        }),
        &text,
    );
    Ok(())
}

/// Creates the request and, unless `no_approve`, approves it as the proposer.
pub(crate) async fn propose(
    ctx: &Ctx<'_>,
    multisig: &str,
    pa: &MultisigProposeArgs,
    spec: ProposeSpec,
) -> Result<(), CliError> {
    let payer = ctx.keypair(pa.common.fee_payer.as_deref())?;
    let msk = ctx.resolve(multisig)?;
    let m = ctx.load_multisig(&msk).await?;
    if m.member_index(&payer.public_key).is_none() {
        return Err(CliError::Validation(format!(
            "{} is not a member of multisig {}; only members can propose",
            ctx.short(&payer.public_key),
            addr(&msk)
        )));
    }
    let (seed, rk, layout, payload) =
        choose_request(ctx, &payer.public_key, &msk, &m, &spec).await?;
    if let RequestPayload::Invoke(inv) = &payload {
        if let decode::AccountCheck::Unlisted(idx) = decode::check_invoke_accounts(ctx, inv) {
            return Err(CliError::Validation(format!(
                "the call uses account index(es) {:?} that aren't among its accounts (index 0 is the executing key's wallet); pass them with --rw/--ro",
                idx
            )));
        }
        if let Some(why) = decode::check_stored_authority(ctx, inv, &msk).await {
            return Err(CliError::Validation(format!(
                "{}; only the multisig's own accounts and programs can be acted on",
                why
            )));
        }
    }
    let required = ms::required_approvals(payload.kind(), m.members.len() as u16, m.threshold);

    let pk = Pubkey::from_bytes(&rk);
    let proof =
        with_retry(|| make_state_proof(&ctx.client, &pk, ProofType::Creating, None)).await?;
    let mut p = ctx.tx_params(&payer).await?;
    let tx = ms::build_create_request_tx(&layout, msk, rk, &seed, &payload, &proof, &p)
        .map_err(build_err)?;
    let created = ctx.submit(tx, &payer).await?;

    // Read back what was created. Another proposal may have landed first and
    // taken the id this one expected; the approval must name the stored id and
    // the stored data, and the request must be the one just proposed.
    let stored = load_created_request(ctx, &rk).await.map_err(|e| {
        CliError::TransactionSubmission(format!(
            "request {} was created but couldn't be read back ({}); approve it with: thru multisig approve {}",
            addr(&rk),
            e,
            addr(&rk)
        ))
    })?;
    if stored.proposer != payer.public_key || stored.multisig != msk || stored.payload != payload {
        return Err(CliError::Validation(format!(
            "request {} on chain doesn't match what was proposed; review it with: thru multisig request show {}",
            addr(&rk),
            addr(&rk)
        )));
    }
    let request_id = stored.request_id;

    let mut text = vec![
        format!("Proposed request #{}: {}", request_id, spec.summary),
        format!("Request: {}", addr(&rk)),
        format!("Signature: {}", sig(&created)),
    ];
    let mut approvals = 0u32;
    let mut approve_sig = None;
    if !pa.no_approve {
        p.nonce += 1;
        let approved = match ms::build_approve_tx(
            payer.public_key,
            ctx.program,
            msk,
            rk,
            request_id,
            &stored.data_hash(),
            &p,
        ) {
            Ok(tx) => ctx.submit(tx, &payer).await,
            Err(e) => Err(build_err(e)),
        };
        let me = m.member_index(&payer.public_key).unwrap_or(usize::MAX);
        let approved = match approved {
            Err(e) if approval_recorded(ctx, &rk, me).await => Ok(format!(
                "unreported ({}); the approval is recorded on chain",
                e
            )),
            other => other.map(|d| sig(&d)),
        };
        let d = match approved {
            Ok(d) => d,
            Err(e) => {
                // The request exists on chain; report it so a retry approves it
                // instead of proposing again.
                text.push(format!("Approval failed: {}", e));
                text.push(format!(
                    "Approve it with: thru multisig approve {} --fee-payer {}",
                    addr(&rk),
                    ctx.short(&payer.public_key)
                ));
                ctx.emit(
                    json!({"multisig_propose": {
                        "status": "created_not_approved",
                        "multisig": addr(&msk),
                        "request": addr(&rk),
                        "request_id": request_id,
                        "kind": ms::kind_name(payload.kind()),
                        "signature": sig(&created),
                        "approve_error": e.to_string(),
                    }}),
                    &text,
                );
                return Err(CliError::TransactionSubmission(format!(
                    "request {} was created but the proposer's approval failed: {}",
                    addr(&rk),
                    e
                )));
            }
        };
        approvals = 1;
        text.push(format!(
            "Approved as {}: 1/{} approvals (signature {})",
            ctx.short(&payer.public_key),
            required,
            d
        ));
        approve_sig = Some(d);
    } else {
        text.push(format!("Not approved yet: 0/{} approvals", required));
    }
    let execute_cmd = std::iter::once(format!("thru multisig execute {}", addr(&rk)))
        .chain(spec.execute_args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    if approvals >= required as u32 {
        text.push(format!("Ready to execute: {}", execute_cmd));
    } else {
        text.push(format!(
            "Needs {} more approval(s): thru multisig approve {} --fee-payer <member>",
            required as u32 - approvals,
            addr(&rk)
        ));
        if !spec.execute_args.is_empty() {
            text.push(format!("Then execute with: {}", execute_cmd));
        }
    }
    let mut out = json!({
        "status": "success",
        "multisig": addr(&msk),
        "request": addr(&rk),
        "request_id": request_id,
        "kind": ms::kind_name(payload.kind()),
        "summary": spec.summary,
        "approvals": approvals,
        "required": required,
        "signature": sig(&created),
        "approve_signature": approve_sig,
    });
    if !spec.execute_args.is_empty() {
        out["execute_args"] = json!(spec.execute_args);
    }
    ctx.emit(json!({ "multisig_propose": out }), &text);
    Ok(())
}

fn build_err(e: anyhow::Error) -> CliError {
    CliError::TransactionSubmission(format!("Failed to build transaction: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn described(kind: &str, code_hash: Option<&str>) -> Described {
        Described {
            text: vec![],
            json: json!({"action": {"decoded": {"type": kind}}}),
            hints: decode::ExecHints::default(),
            code_hash: code_hash.map(str::to_string),
            accounts: decode::AccountCheck::NoCall,
        }
    }

    #[test]
    fn unlisted_accounts_are_refused() {
        let mut d = described("token.transfer", None);
        d.accounts = decode::AccountCheck::Unlisted(vec![0]);
        assert!(check_accounts(&d).is_err());
        d.accounts = decode::AccountCheck::Verified;
        assert!(check_accounts(&d).is_ok());
        d.accounts = decode::AccountCheck::Unknown;
        assert!(check_accounts(&d).is_ok());
    }

    #[test]
    fn foreign_authority_is_refused() {
        let mut d = described("token.transfer", None);
        d.accounts = decode::AccountCheck::ForeignAuthority("owned by bob".into());
        assert!(check_accounts(&d).is_err());
    }

    #[test]
    fn upgrades_require_a_pinned_code_hash() {
        for kind in ["manager.upgrade", "multicall.program_abi_upgrade"] {
            let up = described(kind, Some("ab12"));
            assert!(up.check_code_hash(None).is_err(), "{kind}");
            assert!(up.check_code_hash(Some("ffff")).is_err(), "{kind}");
            assert!(up.check_code_hash(Some("0xAB12")).is_ok(), "{kind}");
        }
        let mint = described("token.mint_to", None);
        assert!(mint.check_code_hash(None).is_ok());
        assert!(mint.check_code_hash(Some("ab12")).is_err());
    }

    #[test]
    fn program_abi_upgrades_require_a_pinned_abi_hash() {
        let mut up = described("multicall.program_abi_upgrade", Some("ab12"));
        up.json["action"]["decoded"]["abi_sha256"] = json!("cd34");
        let pins = |code, abi| HashPins { code, abi };
        assert!(up.check_pins(pins(Some("ab12"), None)).is_err());
        assert!(up.check_pins(pins(None, Some("cd34"))).is_err());
        assert!(up.check_pins(pins(Some("ab12"), Some("ffff"))).is_err());
        assert!(up.check_pins(pins(Some("ab12"), Some("0xCD34"))).is_ok());
        let plain = described("manager.upgrade", Some("ab12"));
        assert!(plain.check_pins(pins(Some("ab12"), None)).is_ok());
        assert!(plain.check_pins(pins(Some("ab12"), Some("cd34"))).is_err());
    }

    /* An explicit --compute-units / --state-units beats the decoder's hint
       (such as a validator manager instruction's budget), which beats the
       default. */
    #[test]
    fn explicit_execute_units_override_the_hints() {
        let hinted = decode::ExecHints {
            compute_units: Some(1_000_000_000),
            state_units: Some(3),
        };
        assert_eq!(execute_units(None, None, hinted), (1_000_000_000, 3));
        assert_eq!(execute_units(Some(7), Some(1), hinted), (7, 1));
        assert_eq!(
            execute_units(None, None, decode::ExecHints::default()),
            (ms::EXECUTE_COMPUTE_UNITS, 0)
        );
    }
}
