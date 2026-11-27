//! Turns a stored request into readable lines. Invoke requests are decoded
//! by a built-in decoder for programs the CLI knows (token, program manager,
//! feature gates), then by the target program's on-chain ABI, then shown as
//! hex with a warning.

use super::{Ctx, addr, pk_bytes};
use crate::commands::abi::{abi_yaml_from_account_data, official_abi_account};
use crate::feature_gate_account::feature_gate_program_pubkey;
use abi_gen::abi::resolved::TypeResolver;
use abi_loader::AbiFile;
use abi_reflect::{FormatOptions, Reflector, format_reflection_with_options};
use serde_json::{Value, json};
use std::collections::HashMap;
use thru_base::bootstrap_addresses as programs;
use thru_base::multisig::{InvokePayload, MultisigAccount, RequestAccount, RequestPayload};
use thru_base::tn_tools::Pubkey;
use thru_base::txn_lib::TnPubkey;
use thru_base::txn_tools::{
    ABI_MANAGER_INSTRUCTION_UPGRADE_ABI_OFFICIAL, MANAGER_INSTRUCTION_CLAIM_AUTHORITY, MANAGER_INSTRUCTION_CREATE_EPHEMERAL,
    MANAGER_INSTRUCTION_CREATE_PERMANENT, MANAGER_INSTRUCTION_DESTROY,
    MANAGER_INSTRUCTION_FINALIZE, MANAGER_INSTRUCTION_SET_AUTHORITY, MANAGER_INSTRUCTION_SET_PAUSE,
    MANAGER_INSTRUCTION_UPGRADE, TOKEN_INSTRUCTION_BURN, TOKEN_INSTRUCTION_CLOSE_ACCOUNT,
    TOKEN_INSTRUCTION_FREEZE_ACCOUNT, TOKEN_INSTRUCTION_MINT_TO, TOKEN_INSTRUCTION_THAW_ACCOUNT,
    TOKEN_INSTRUCTION_TRANSFER, TOKEN_INSTRUCTION_TRANSFER_CHECKED, account_state_units,
    cv_manager_compute_units,
};

/// Execute-time resource hints for actions that need more than the default.
#[derive(Default, Clone, Copy)]
pub(crate) struct ExecHints {
    pub compute_units: Option<u32>,
    pub state_units: Option<u16>,
}

pub(crate) struct Action {
    pub text: Vec<String>,
    pub json: Value,
    pub hints: ExecHints,
    /// SHA-256 of the code a program upgrade would install, read from its buffer now.
    pub code_hash: Option<String>,
    /// Whether the child call's account indices could be checked against the request.
    pub accounts: AccountCheck,
}

/// What the CLI knows about the accounts an invoke's child instruction uses.
/// Child instructions name accounts by transaction index, and index 0 is the
/// executing key, so a call that uses an index the request doesn't record
/// could act with the executor's authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AccountCheck {
    /// Not an invoke: no child call.
    NoCall,
    /// Every index the child instruction uses is recorded in the request.
    Verified,
    /// The child instruction uses indices the request doesn't record.
    Unlisted(Vec<u16>),
    /// The CLI can't decode which indices the child instruction uses.
    Unknown,
    /// The target program authorizes by a stored key (a token account's owner,
    /// a program's authority) that isn't this multisig. The executing key is
    /// always authorized, so executing could use its authority instead.
    ForeignAuthority(String),
}

/// For calls whose program authorizes by a key stored on an account rather
/// than an encoded authority index (token transfer, program manager), checks
/// that the stored key is the multisig. Returns why not, if it isn't.
pub(crate) async fn check_stored_authority(
    ctx: &Ctx<'_>,
    p: &InvokePayload,
    multisig: &TnPubkey,
) -> Option<String> {
    let key_at =
        |idx: u16| -> Option<TnPubkey> { p.refs.iter().find(|(i, _)| *i == idx).map(|(_, k)| *k) };
    let d = &p.instr_data;
    let read =
        |k: TnPubkey| async move { ctx.account(&k).await.ok().flatten().map(|(_, data)| data) };
    if is_token(ctx, &p.target_program)
        && matches!(
            d.first(),
            Some(&TOKEN_INSTRUCTION_TRANSFER) | Some(&TOKEN_INSTRUCTION_TRANSFER_CHECKED)
        )
    {
        let src = key_at(u16_at(d, 1)?)?;
        let owner = read(src)
            .await
            .and_then(|data| crate::commands::token::token_account_owner(&data).ok());
        return match owner {
            Some(o) if o == *multisig => None,
            Some(o) => Some(format!(
                "the transfer's source account {} is owned by {}, not this multisig",
                addr(&src),
                ctx.short(&o)
            )),
            None => Some(format!(
                "couldn't read the owner of source account {}",
                addr(&src)
            )),
        };
    }
    if is_multicall(ctx, &p.target_program) {
        let u = parse_program_abi_upgrade(d)?;
        if key_at(u.authority) != Some(*multisig) {
            return Some("the ABI upgrade names an authority other than this multisig".into());
        }
        let meta = key_at(u.meta)?;
        let stored: Option<TnPubkey> = read(meta)
            .await
            .and_then(|data| managed_meta_key(&data, MANAGED_META_AUTHORITY_OFFSET));
        return match stored {
            Some(a) if a == *multisig => None,
            Some(a) => Some(format!(
                "the program's authority is {}, not this multisig",
                ctx.short(&a)
            )),
            None => Some(format!(
                "couldn't read the program's authority from {}",
                addr(&meta)
            )),
        };
    }
    if is_manager(ctx, &p.target_program) {
        // Create calls name an encoded authority and a meta account that doesn't
        // exist yet; only calls on an existing program authorize a stored key.
        if matches!(
            d.first(),
            Some(&MANAGER_INSTRUCTION_CREATE_PERMANENT)
                | Some(&MANAGER_INSTRUCTION_CREATE_EPHEMERAL)
        ) {
            return None;
        }
        let meta = key_at(u16_at(d, 1)?)?;
        let field = if d.first() == Some(&MANAGER_INSTRUCTION_CLAIM_AUTHORITY) {
            MANAGED_META_CANDIDATE_OFFSET
        } else {
            MANAGED_META_AUTHORITY_OFFSET
        };
        let stored: Option<TnPubkey> = read(meta)
            .await
            .and_then(|data| managed_meta_key(&data, field));
        let role = if field == MANAGED_META_CANDIDATE_OFFSET {
            "authority candidate"
        } else {
            "authority"
        };
        return match stored {
            Some(a) if a == *multisig => None,
            Some(a) => Some(format!(
                "the program's {} is {}, not this multisig",
                role,
                ctx.short(&a)
            )),
            None => Some(format!(
                "couldn't read the program's {} from {}",
                role,
                addr(&meta)
            )),
        };
    }
    None
}

/// Compares the account indices an invoke's child instruction uses with the
/// indices the request records.
pub(crate) fn check_invoke_accounts(ctx: &Ctx<'_>, p: &InvokePayload) -> AccountCheck {
    let recorded: Vec<u16> = p
        .refs
        .iter()
        .map(|(i, _)| *i)
        .chain(std::iter::once(p.target_program_idx))
        .collect();
    let key_at = |idx: u16| -> Option<TnPubkey> {
        if idx == p.target_program_idx {
            return Some(p.target_program);
        }
        p.refs.iter().find(|(i, _)| *i == idx).map(|(_, k)| *k)
    };
    match child_account_indices(ctx, &p.target_program, &p.instr_data, &key_at) {
        Some(used) => {
            let mut unlisted: Vec<u16> =
                used.into_iter().filter(|i| !recorded.contains(i)).collect();
            unlisted.sort();
            unlisted.dedup();
            if unlisted.is_empty() {
                AccountCheck::Verified
            } else {
                AccountCheck::Unlisted(unlisted)
            }
        }
        None => AccountCheck::Unknown,
    }
}

/// Account indices a child instruction uses, for programs the CLI can decode.
fn child_account_indices(
    ctx: &Ctx<'_>,
    target: &TnPubkey,
    d: &[u8],
    key_at: &dyn Fn(u16) -> Option<TnPubkey>,
) -> Option<Vec<u16>> {
    let at = |o: usize| u16_at(d, o);
    if is_token(ctx, target) {
        return match *d.first()? {
            TOKEN_INSTRUCTION_TRANSFER if d.len() == 13 => Some(vec![at(1)?, at(3)?]),
            TOKEN_INSTRUCTION_TRANSFER_CHECKED if d.len() == 25 => {
                Some(vec![at(1)?, at(3)?, at(5)?])
            }
            TOKEN_INSTRUCTION_MINT_TO | TOKEN_INSTRUCTION_BURN if d.len() == 15 => {
                Some(vec![at(1)?, at(3)?, at(5)?])
            }
            TOKEN_INSTRUCTION_FREEZE_ACCOUNT
            | TOKEN_INSTRUCTION_THAW_ACCOUNT
            | TOKEN_INSTRUCTION_CLOSE_ACCOUNT
                if d.len() == 7 =>
            {
                Some(vec![at(1)?, at(3)?, at(5)?])
            }
            _ => None,
        };
    }
    if is_manager(ctx, target) {
        return match *d.first()? {
            MANAGER_INSTRUCTION_UPGRADE if d.len() == 47 => Some(vec![at(1)?, at(3)?, at(5)?]),
            MANAGER_INSTRUCTION_SET_PAUSE
            | MANAGER_INSTRUCTION_SET_AUTHORITY
            | MANAGER_INSTRUCTION_CLAIM_AUTHORITY
            | MANAGER_INSTRUCTION_FINALIZE
            | MANAGER_INSTRUCTION_DESTROY
                if d.len() >= 5 =>
            {
                Some(vec![at(1)?, at(3)?])
            }
            _ => None,
        };
    }
    if pk_bytes(&feature_gate_program_pubkey()).ok() == Some(*target) && d.len() >= 8 {
        return Some(vec![at(4)?, at(6)?]);
    }
    if is_multicall(ctx, target) {
        return program_abi_upgrade_indices(
            d,
            key_at,
            &|k| is_manager(ctx, k),
            &|k| is_abi_manager(ctx, k),
        );
    }
    None
}

/// Account indices of a Multicall program + ABI upgrade, or None unless its
/// callees really are the Manager and the ABI Manager: another program could
/// read the same bytes differently (including index 0, the executing key).
fn program_abi_upgrade_indices(
    d: &[u8],
    key_at: &dyn Fn(u16) -> Option<TnPubkey>,
    is_manager: &dyn Fn(&TnPubkey) -> bool,
    is_abi_manager: &dyn Fn(&TnPubkey) -> bool,
) -> Option<Vec<u16>> {
    let u = parse_program_abi_upgrade(d)?;
    if !is_manager(&key_at(u.manager_idx)?) || !is_abi_manager(&key_at(u.abi_manager_idx)?) {
        return None;
    }
    Some(vec![
        u.manager_idx,
        u.abi_manager_idx,
        u.meta,
        u.program,
        u.buffer,
        u.abi_meta,
        u.abi,
        u.abi_buffer,
        u.authority,
    ])
}

/// A Multicall that upgrades a managed program and its official ABI, as
/// `thru program upgrade --abi --via-multisig` proposes it.
struct ProgramAbiUpgrade {
    manager_idx: u16,
    abi_manager_idx: u16,
    meta: u16,
    program: u16,
    buffer: u16,
    offset: u32,
    size: u32,
    abi_meta: u16,
    abi: u16,
    abi_buffer: u16,
    abi_offset: u32,
    abi_size: u32,
    authority: u16,
    /// SHA-256 digests each instruction commits to: the managers install only
    /// buffer bytes with these hashes.
    code_sha256: [u8; 32],
    abi_sha256: [u8; 32],
}

/// Parse Multicall data that is exactly [manager upgrade, ABI manager
/// official ABI upgrade] on the same program meta account.
fn parse_program_abi_upgrade(d: &[u8]) -> Option<ProgramAbiUpgrade> {
    if u16_at(d, 0)? != 2 {
        return None;
    }
    let mut off = 2usize;
    let mut calls = Vec::with_capacity(2);
    for _ in 0..2 {
        let idx = u16_at(d, off)?;
        let len = usize::try_from(u64_at(d, off + 2)?).ok()?;
        let data = d.get(off + 10..off.checked_add(10)?.checked_add(len)?)?;
        calls.push((idx, data));
        off += 10 + len;
    }
    if off != d.len() {
        return None;
    }
    let (manager_idx, m) = calls[0];
    let (abi_manager_idx, a) = calls[1];
    if m.len() != 47 || m[0] != MANAGER_INSTRUCTION_UPGRADE {
        return None;
    }
    if a.len() != 51 || a[0] != ABI_MANAGER_INSTRUCTION_UPGRADE_ABI_OFFICIAL {
        return None;
    }
    let meta = u16_at(m, 1)?;
    if u16_at(a, 3)? != meta {
        return None;
    }
    let u = ProgramAbiUpgrade {
        manager_idx,
        abi_manager_idx,
        meta,
        program: u16_at(m, 3)?,
        buffer: u16_at(m, 5)?,
        offset: u32_at(m, 7)?,
        size: u32_at(m, 11)?,
        abi_meta: u16_at(a, 1)?,
        abi: u16_at(a, 5)?,
        abi_buffer: u16_at(a, 7)?,
        abi_offset: u32_at(a, 9)?,
        abi_size: u32_at(a, 13)?,
        authority: u16_at(a, 49)?,
        code_sha256: m.get(15..47)?.try_into().ok()?,
        abi_sha256: a.get(17..49)?.try_into().ok()?,
    };
    // The hashes shown and pinned are read before execution. If a source
    // aliased an account the other call writes (e.g. the ABI read from the
    // program the Manager just replaced), they would not describe what lands.
    let mut accounts = [u.meta, u.program, u.buffer, u.abi_meta, u.abi, u.abi_buffer];
    accounts.sort_unstable();
    if accounts.windows(2).any(|w| w[0] == w[1]) {
        return None;
    }
    Some(u)
}

/// Decode a Multicall program + ABI upgrade whose callees are the Manager
/// and the ABI Manager.
fn decode_program_abi_upgrade(
    ctx: &Ctx<'_>,
    by_idx: &HashMap<u16, TnPubkey>,
    d: &[u8],
    acct: &dyn Fn(u16) -> String,
    acct_addr: &dyn Fn(u16) -> Value,
) -> Option<Decoded> {
    let u = parse_program_abi_upgrade(d)?;
    if !is_manager(ctx, by_idx.get(&u.manager_idx)?)
        || !is_abi_manager(ctx, by_idx.get(&u.abi_manager_idx)?)
    {
        return None;
    }
    let f = |k: &str, v: String| (k.to_string(), v);
    Some((
        "program + ABI upgrade (one Multicall)".into(),
        vec![
            f("program", acct(u.program)),
            f("meta", acct(u.meta)),
            f(
                "new code",
                format!("{} bytes from buffer {} (offset {})", u.size, acct(u.buffer), u.offset),
            ),
            f("ABI account", acct(u.abi)),
            f(
                "new ABI",
                format!(
                    "{} bytes from buffer {} (offset {})",
                    u.abi_size,
                    acct(u.abi_buffer),
                    u.abi_offset
                ),
            ),
            f("code sha256", hex::encode(u.code_sha256)),
            f("ABI sha256", hex::encode(u.abi_sha256)),
            f("authority", acct(u.authority)),
        ],
        json!({
            "type": "multicall.program_abi_upgrade",
            "program": acct_addr(u.program),
            "meta": acct_addr(u.meta),
            "buffer": acct_addr(u.buffer),
            "offset": u.offset,
            "size": u.size,
            "abi": acct_addr(u.abi),
            "abi_meta": acct_addr(u.abi_meta),
            "abi_buffer": acct_addr(u.abi_buffer),
            "abi_offset": u.abi_offset,
            "abi_size": u.abi_size,
            "code_sha256": hex::encode(u.code_sha256),
            "abi_sha256": hex::encode(u.abi_sha256),
        }),
        ExecHints {
            compute_units: Some(thru_base::program_abi::PROGRAM_ABI_COMPUTE_UNITS),
            state_units: None,
        },
    ))
}

pub(crate) async fn describe_payload(
    ctx: &Ctx<'_>,
    r: &RequestAccount,
    m: Option<&MultisigAccount>,
) -> Action {
    match &r.payload {
        RequestPayload::UpdateThreshold { new_threshold } => {
            let old = m
                .map(|m| m.threshold.to_string())
                .unwrap_or_else(|| "?".into());
            Action {
                text: vec![format!("Change     threshold {} -> {}", old, new_threshold)],
                json: json!({"type": "set-threshold", "from": m.map(|m| m.threshold), "to": new_threshold}),
                hints: ExecHints::default(),
                code_hash: None,
                accounts: AccountCheck::NoCall,
            }
        }
        RequestPayload::UpdateMembership { members } => {
            let names = |ks: &[TnPubkey]| {
                ks.iter()
                    .map(|k| ctx.short(k))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let mut text = Vec::new();
            let mut j = json!({"type": "set-members", "to": members.iter().map(|k| addr(k)).collect::<Vec<_>>()});
            match m {
                Some(m) => {
                    text.push(format!(
                        "Change     members  {}  ->  {}",
                        names(&m.members),
                        names(members)
                    ));
                    let removed: Vec<TnPubkey> = m
                        .members
                        .iter()
                        .filter(|k| !members.contains(k))
                        .copied()
                        .collect();
                    let added: Vec<TnPubkey> = members
                        .iter()
                        .filter(|k| !m.members.contains(k))
                        .copied()
                        .collect();
                    if !removed.is_empty() {
                        text.push(format!("           removed  {}", names(&removed)));
                    }
                    for k in &added {
                        text.push(format!("           added    {}", ctx.label(k)));
                    }
                    if members.len() < m.threshold as usize {
                        text.push(format!(
                            "           threshold drops {} -> {}",
                            m.threshold,
                            members.len()
                        ));
                    } else {
                        text.push(format!("           threshold stays {}", m.threshold));
                    }
                    if m.live_request_cnt > 1 {
                        text.push(format!(
                            "Warning    executing this makes {} other open request(s) stale",
                            m.live_request_cnt - 1
                        ));
                    }
                    j["from"] = json!(m.members.iter().map(|k| addr(k)).collect::<Vec<_>>());
                }
                None => text.push(format!("Change     members  ->  {}", names(members))),
            }
            Action {
                text,
                json: j,
                hints: ExecHints::default(),
                code_hash: None,
                accounts: AccountCheck::NoCall,
            }
        }
        RequestPayload::DeleteMultisig => {
            let mut text = vec!["Action     delete the multisig account".to_string()];
            if let Some(m) = m {
                if m.live_request_cnt > 1 {
                    text.push(format!(
                        "Warning    {} other request(s) are live; this can't execute until they're gone",
                        m.live_request_cnt - 1
                    ));
                }
            }
            Action {
                text,
                json: json!({"type": "delete-multisig"}),
                hints: ExecHints::default(),
                code_hash: None,
                accounts: AccountCheck::NoCall,
            }
        }
        RequestPayload::Invoke(p) => describe_invoke(ctx, p, r.multisig).await,
    }
}

async fn describe_invoke(ctx: &Ctx<'_>, p: &InvokePayload, multisig: TnPubkey) -> Action {
    let by_idx: HashMap<u16, TnPubkey> = p
        .refs
        .iter()
        .copied()
        .chain(std::iter::once((p.target_program_idx, p.target_program)))
        .collect();
    let label = |k: &TnPubkey| -> String {
        if *k == multisig {
            format!("{} (this multisig)", ctx.short(k))
        } else {
            ctx.short(k)
        }
    };
    let acct = |i: u16| -> String {
        by_idx
            .get(&i)
            .map(|k| label(k))
            .unwrap_or_else(|| format!("#{}?", i))
    };
    let acct_addr = |i: u16| -> Value {
        by_idx
            .get(&i)
            .map(|k| json!(addr(k)))
            .unwrap_or(Value::Null)
    };
    let accounts_line = format!(
        "Accounts   {}",
        p.refs
            .iter()
            .map(|(i, k)| format!("#{} {}", i, label(k)))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let accounts_json: Vec<Value> = p
        .refs
        .iter()
        .map(|(i, k)| json!({"index": i, "address": addr(k), "name": ctx.name(k)}))
        .collect();

    let mut accounts = check_invoke_accounts(ctx, p);
    if accounts == AccountCheck::Verified {
        if let Some(why) = check_stored_authority(ctx, p, &multisig).await {
            accounts = AccountCheck::ForeignAuthority(why);
        }
    }
    let decoded = if is_token(ctx, &p.target_program) {
        decode_token(&p.instr_data, &acct, &acct_addr)
    } else if is_manager(ctx, &p.target_program) {
        decode_manager(&p.instr_data, &acct, &acct_addr)
    } else if pk_bytes(&feature_gate_program_pubkey()).ok() == Some(p.target_program) {
        decode_feature_gate(ctx, &p.instr_data)
    } else if is_multicall(ctx, &p.target_program) {
        decode_program_abi_upgrade(ctx, &by_idx, &p.instr_data, &acct, &acct_addr)
    } else {
        None
    };
    let builtin = decoded.is_some();

    let (mut text, json_action, hints) = match decoded {
        Some((title, fields, j, hints)) => {
            let mut text = vec![format!("Action     {}   (program {})", title, ctx.short(&p.target_program))];
            text.extend(fields.iter().map(|(k, v)| format!("  {:<15}{}", k, v)));
            (text, j, hints)
        }
        None => match decode_with_abi(ctx, &p.target_program, &p.instr_data).await {
            Some(reflected) => {
                let mut text = vec![format!(
                    "Action     call {}   (decoded from its on-chain ABI)",
                    ctx.short(&p.target_program)
                )];
                let pretty = serde_json::to_string_pretty(&reflected).unwrap_or_default();
                text.extend(pretty.lines().map(|l| format!("  {}", l)));
                (text, json!({"type": "abi", "decoded": reflected}), ExecHints::default())
            }
            None => (
                vec![
                    format!("Action     call {}   (no decoder or published ABI)", ctx.label(&p.target_program)),
                    format!("  data     {}   ({} bytes)", hex::encode(&p.instr_data), p.instr_data.len()),
                    "Warning    can't decode this instruction. Verify it independently before approving.".to_string(),
                ],
                json!({"type": "raw"}),
                ExecHints::default(),
            ),
        },
    };
    let mut json_action = json_action;
    let mut hints = hints;
    let mut cv_note = None;
    if is_consensus_validator(ctx, &p.target_program) {
        hints = cv_manager_hints(hints, &p.instr_data);
    } else if !builtin {
        cv_note = consensus_program_note(ctx, &p.target_program, &p.instr_data);
    }
    if let Some((line, _)) = &cv_note {
        text.push(line.clone());
    }
    let mut code_hash = None;
    let action_type = json_action["type"].as_str().map(str::to_string);
    match action_type.as_deref() {
        Some("manager.upgrade") | Some("multicall.program_abi_upgrade") => {
            // The manager instruction commits to the code's SHA-256, so the
            // request binds the code; the buffer only has to still hold those bytes.
            let committed = json_action["code_sha256"].as_str().map(str::to_string);
            let buffer = json_action["buffer"]
                .as_str()
                .and_then(|s| Pubkey::new(s.to_string()).ok());
            let off = json_action["offset"].as_u64().unwrap_or(0) as usize;
            let size = json_action["size"].as_u64().unwrap_or(0) as usize;
            let mut found = None;
            if let Some(buf) = buffer.and_then(|b| b.to_bytes().ok()) {
                if let Ok(Some((acct, data))) = ctx.account(&buf).await {
                    if let Some(code) = data.get(off..off + size) {
                        found = Some((
                            hex::encode(crate::crypto::calculate_sha256(code)),
                            acct.slot,
                        ));
                    }
                }
            }
            match (&committed, found) {
                (Some(c), Some((h, slot))) if *c == h => text.push(format!(
                    "  {:<15}buffer matches (as of slot {})",
                    "buffer",
                    slot.map(|s| s.to_string()).unwrap_or_else(|| "?".into())
                )),
                (Some(_), Some((h, slot))) => text.push(format!(
                    "Warning    the buffer holds different code (sha256 {} as of slot {}); execution will fail",
                    h,
                    slot.map(|s| s.to_string()).unwrap_or_else(|| "?".into())
                )),
                (_, None) => text.push(
                    "Warning    the upgrade buffer is missing or too short; execution will fail"
                        .to_string(),
                ),
                (None, Some(_)) => {}
            }
            if action_type.as_deref() == Some("multicall.program_abi_upgrade") {
                describe_abi_part(ctx, &mut json_action, &mut text, &mut hints).await;
            }
            code_hash = committed;
        }
        Some("feature_gate.create_entry") => {
            let global = crate::feature_gate_account::feature_gate_global_account_pubkey();
            if let Ok(Some((_, data))) = ctx.account(&global.to_bytes().unwrap_or_default()).await {
                if let Ok(acct) = crate::feature_gate_account::decode_feature_gate_account(&data) {
                    hints.state_units = crate::commands::feature_gates::create_gate_state_units(
                        acct.entry_count as usize,
                    )
                    .ok();
                }
            }
        }
        _ => {}
    }
    match &accounts {
        AccountCheck::Unlisted(idx) => text.push(format!(
            "DANGER     the call uses account index(es) {:?} that the request doesn't record. Index 0 is the executing key's wallet. Don't approve or execute this.",
            idx
        )),
        AccountCheck::ForeignAuthority(why) => text.push(format!(
            "DANGER     {}. The executing key is always authorized, so executing could act with its authority. Don't approve or execute this.",
            why
        )),
        AccountCheck::Unknown => text.push(
            "Warning    the CLI can't check which accounts this call uses. Executing signs with your key, so the call could act with your wallet's authority; execute with a low-balance key."
                .to_string(),
        ),
        _ => {}
    }
    text.push(accounts_line);
    let mut j = json!({
        "type": "invoke",
        "program": addr(&p.target_program),
        "data": hex::encode(&p.instr_data),
        "accounts": accounts_json,
    });
    j["decoded"] = json_action;
    j["account_check"] = match &accounts {
        AccountCheck::Verified => json!("verified"),
        AccountCheck::Unlisted(idx) => json!({"unlisted_indices": idx}),
        AccountCheck::Unknown => json!("unknown"),
        AccountCheck::ForeignAuthority(why) => json!({"foreign_authority": why}),
        AccountCheck::NoCall => json!("none"),
    };
    if let Some((_, hint)) = cv_note {
        j["consensus_program_hint"] = hint;
    }
    Action {
        text,
        json: j,
        hints,
        code_hash,
        accounts,
    }
}

type Decoded = (String, Vec<(String, String)>, Value, ExecHints);

fn is_token(ctx: &Ctx<'_>, k: &TnPubkey) -> bool {
    let cfg = ctx
        .config
        .get_token_program_pubkey()
        .ok()
        .and_then(|p| p.to_bytes().ok());
    cfg.as_ref() == Some(k) || *k == programs::TOKEN_PROGRAM_BYTES
}

fn is_manager(ctx: &Ctx<'_>, k: &TnPubkey) -> bool {
    let cfg = Pubkey::new(ctx.config.manager_program_public_key.clone())
        .ok()
        .and_then(|p| p.to_bytes().ok());
    // The Core manager has a different instruction layout (it is governed
    // through `thru governance`), so it is not decoded here; calls to it fall
    // back to the on-chain ABI or hex with a warning.
    *k != programs::CORE_MANAGER_PROGRAM_BYTES
        && (cfg.as_ref() == Some(k)
            || *k == programs::MANAGER_PROGRAM_BYTES
            || *k == programs::PUBLIC_MANAGER_PROGRAM_BYTES)
}

fn is_multicall(ctx: &Ctx<'_>, k: &TnPubkey) -> bool {
    let cfg = ctx
        .config
        .get_multicall_program_pubkey()
        .ok()
        .and_then(|p| p.to_bytes().ok());
    cfg.as_ref() == Some(k) || *k == programs::MULTICALL_PROGRAM_BYTES
}

fn is_abi_manager(ctx: &Ctx<'_>, k: &TnPubkey) -> bool {
    let cfg = ctx
        .config
        .get_abi_manager_pubkey()
        .ok()
        .and_then(|p| p.to_bytes().ok());
    cfg.as_ref() == Some(k) || *k == programs::ABI_MANAGER_PROGRAM_BYTES
}

/// Whether `k` is a consensus validator program: the configured or bootstrap
/// address, or one the executor names (`multisig execute
/// --consensus-program`, for a request proposed with `validator manager
/// --program`). The request's own bytes never make a program count: the
/// budget a CV program gets would otherwise go to any program a proposer
/// chose.
pub(crate) fn is_consensus_validator(ctx: &Ctx<'_>, k: &TnPubkey) -> bool {
    let cfg = ctx
        .config
        .get_consensus_validator_program_pubkey()
        .ok()
        .and_then(|p| p.to_bytes().ok());
    cfg.as_ref() == Some(k)
        || *k == programs::CONSENSUS_VALIDATOR_PROGRAM_BYTES
        || ctx.consensus_program.as_ref() == Some(k)
}

/// Hints for a call to the consensus validator program. A validator
/// manager instruction gets the compute budget `thru validator manager`
/// requests when it sends the instruction directly: the execute default
/// is too small for ManagerActivate's proof-of-possession check and for
/// the slot finalization ManagerDeactivate and ManagerSetWeight run. The
/// proof itself is in the stored instruction. Other calls keep `hints`.
fn cv_manager_hints(hints: ExecHints, d: &[u8]) -> ExecHints {
    ExecHints {
        compute_units: cv_manager_compute_units(d).or(hints.compute_units),
        ..hints
    }
}

/// For a call to a program the CLI doesn't know whose data carries a
/// validator manager discriminant that needs more than the execute
/// default: a note (text line and JSON) suggesting `--consensus-program`,
/// for a request proposed with `validator manager --program`. It only
/// informs. Bytes in a request never set the budget: the executor's CLI
/// budgets a call only for a CV program it knows or the executor names
/// (`is_consensus_validator`).
fn consensus_program_note(ctx: &Ctx<'_>, target: &TnPubkey, d: &[u8]) -> Option<(String, Value)> {
    let units = cv_manager_compute_units(d)?;
    let line = format!(
        "Note       if {} is a consensus validator program, this is a validator manager call that needs {} compute units; execute with --consensus-program {} (the CLI budgets only CV programs it knows)",
        ctx.short(target),
        units,
        addr(target)
    );
    let hint = json!({
        "execute_args": ["--consensus-program", addr(target)],
        "compute_units": units,
    });
    Some((line, hint))
}

/// The ABI half of a program + ABI upgrade: hash the new ABI and size the
/// execute transaction's state units from the accounts' current sizes.
async fn describe_abi_part(
    ctx: &Ctx<'_>,
    action: &mut Value,
    text: &mut Vec<String>,
    hints: &mut ExecHints,
) {
    use crate::commands::abi::abi_account_header;
    use thru_base::program_abi::{AbiStep, ProgramAbiSizes, ProgramStep, program_abi_state_units};

    let key = |field: &str| -> Option<TnPubkey> {
        action[field]
            .as_str()
            .and_then(|s| Pubkey::new(s.to_string()).ok())
            .and_then(|p| p.to_bytes().ok())
    };
    let (abi_off, abi_size) = (
        action["abi_offset"].as_u64().unwrap_or(0) as usize,
        action["abi_size"].as_u64().unwrap_or(0) as usize,
    );
    let program_size = action["size"].as_u64().unwrap_or(0);
    let (abi_buffer, program_key, abi_key) = (key("abi_buffer"), key("program"), key("abi"));
    let mut abi_hash = None;
    if let Some(buf) = abi_buffer {
        if let Ok(Some((_, data))) = ctx.account(&buf).await {
            if let Some(abi) = data.get(abi_off..abi_off + abi_size) {
                abi_hash = Some(hex::encode(crate::crypto::calculate_sha256(abi)));
            }
        }
    }
    // The ABI Manager instruction commits to the ABI's SHA-256, so the request
    // binds the ABI; the buffer only has to still hold those bytes.
    let committed = action["abi_sha256"].as_str().map(str::to_string);
    match (&committed, &abi_hash) {
        (Some(c), Some(h)) if c == h => {
            text.push(format!("  {:<15}ABI buffer matches", "ABI buffer"));
        }
        (Some(_), Some(h)) => text.push(format!(
            "Warning    the ABI buffer holds a different ABI (sha256 {}); execution will fail",
            h
        )),
        (_, None) => text.push(
            "Warning    the ABI buffer is missing or too short; execution will fail".to_string(),
        ),
        (None, Some(_)) => {}
    }

    let current_program = match program_key {
        Some(k) => ctx.account(&k).await.ok().flatten().map(|(acct, _)| acct.data_size),
        None => None,
    };
    let current_abi = match abi_key {
        Some(k) => ctx
            .account(&k)
            .await
            .ok()
            .flatten()
            .and_then(|(_, data)| abi_account_header(&data))
            .map(|(_, _, size)| u64::from(size)),
        None => None,
    };
    let (Ok(program), Ok(abi)) = (
        u32::try_from(program_size),
        u32::try_from(abi_size),
    ) else {
        return;
    };
    hints.state_units = program_abi_state_units(
        &ProgramStep::Upgrade,
        &AbiStep::Upgrade,
        &ProgramAbiSizes {
            program,
            abi,
            current_program_data: current_program,
            current_abi,
        },
    )
    .ok();
}

/* Packed tn_manager_program_meta_t (tn_manager_program.h): account_type
 * (TN_MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1), authority, authority candidate,
 * version, state. Core Manager writes the same layout and value. */
const MANAGED_META_ACCOUNT_TYPE_V1: u8 = 1;
const MANAGED_META_SIZE: usize = 1 + 32 + 32 + 8 + 1;
const MANAGED_META_AUTHORITY_OFFSET: usize = 1;
const MANAGED_META_CANDIDATE_OFFSET: usize = 33;

/// The key at `offset` of a managed program metadata account, if `data` is
/// one (exact size and account type).
fn managed_meta_key(data: &[u8], offset: usize) -> Option<TnPubkey> {
    if data.len() != MANAGED_META_SIZE || data[0] != MANAGED_META_ACCOUNT_TYPE_V1 {
        return None;
    }
    data.get(offset..offset + 32)?.try_into().ok()
}

fn u16_at(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(o..o + 2)?.try_into().ok()?))
}
fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(o..o + 4)?.try_into().ok()?))
}
fn u64_at(d: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(d.get(o..o + 8)?.try_into().ok()?))
}

/// Unlike hardware-wallet reviews, CLI requests can name all u8 decimal counts.
pub(super) fn format_token_amount(amount: u64, decimals: u8) -> String {
    use std::fmt::Write;

    let decimals = usize::from(decimals);
    let mut text = String::with_capacity(decimals.max(20) + 2);
    write!(text, "{amount:0width$}", width = decimals + 1).unwrap();
    if decimals != 0 {
        text.insert(text.len() - decimals, '.');
        text.truncate(text.trim_end_matches('0').trim_end_matches('.').len());
    }
    text
}

fn decode_token(
    d: &[u8],
    acct: &dyn Fn(u16) -> String,
    acct_addr: &dyn Fn(u16) -> Value,
) -> Option<Decoded> {
    let tag = *d.first()?;
    let f = |k: &str, v: String| (k.to_string(), v);
    let none = ExecHints::default();
    match tag {
        TOKEN_INSTRUCTION_TRANSFER if d.len() == 13 => {
            let (from, to, amount) = (u16_at(d, 1)?, u16_at(d, 3)?, u64_at(d, 5)?);
            Some((
                "token transfer".into(),
                vec![
                    f("from", acct(from)),
                    f("to", acct(to)),
                    f("amount", format!("{} (raw units)", amount)),
                ],
                json!({"type": "token.transfer", "from": acct_addr(from), "to": acct_addr(to), "amount": amount}),
                none,
            ))
        }
        TOKEN_INSTRUCTION_TRANSFER_CHECKED if d.len() == 25 => {
            let (from, to, mint, amount) =
                (u16_at(d, 1)?, u16_at(d, 3)?, u16_at(d, 5)?, u64_at(d, 7)?);
            let decimals = d[15];
            let ticker_len = usize::from(d[16]);
            let ticker = d.get(17..17 + ticker_len)?;
            if d[17 + ticker_len..].iter().any(|b| *b != 0) {
                return None;
            }
            let ticker = ticker.escape_ascii().to_string();
            let ui_amount = format_token_amount(amount, decimals);
            Some((
                "token transfer-checked".into(),
                vec![
                    f("from", acct(from)),
                    f("to", acct(to)),
                    f("mint", acct(mint)),
                    f("amount", ui_amount.clone()),
                    f("ticker", ticker.clone()),
                    f("decimals", decimals.to_string()),
                ],
                json!({"type": "token.transfer_checked", "from": acct_addr(from), "to": acct_addr(to), "mint": acct_addr(mint), "amount": amount, "ui_amount": ui_amount, "decimals": decimals, "ticker": ticker}),
                none,
            ))
        }
        TOKEN_INSTRUCTION_MINT_TO if d.len() == 15 => {
            let (mint, to, auth, amount) =
                (u16_at(d, 1)?, u16_at(d, 3)?, u16_at(d, 5)?, u64_at(d, 7)?);
            Some((
                "token mint-to".into(),
                vec![
                    f("mint", acct(mint)),
                    f("to", acct(to)),
                    f("amount", format!("{} (raw units)", amount)),
                    f("authority", acct(auth)),
                ],
                json!({"type": "token.mint_to", "mint": acct_addr(mint), "to": acct_addr(to), "authority": acct_addr(auth), "amount": amount}),
                none,
            ))
        }
        TOKEN_INSTRUCTION_BURN if d.len() == 15 => {
            let (account, mint, auth, amount) =
                (u16_at(d, 1)?, u16_at(d, 3)?, u16_at(d, 5)?, u64_at(d, 7)?);
            Some((
                "token burn".into(),
                vec![
                    f("account", acct(account)),
                    f("mint", acct(mint)),
                    f("amount", format!("{} (raw units)", amount)),
                    f("authority", acct(auth)),
                ],
                json!({"type": "token.burn", "account": acct_addr(account), "mint": acct_addr(mint), "authority": acct_addr(auth), "amount": amount}),
                none,
            ))
        }
        TOKEN_INSTRUCTION_FREEZE_ACCOUNT | TOKEN_INSTRUCTION_THAW_ACCOUNT if d.len() == 7 => {
            let (account, mint, auth) = (u16_at(d, 1)?, u16_at(d, 3)?, u16_at(d, 5)?);
            let name = if tag == TOKEN_INSTRUCTION_FREEZE_ACCOUNT {
                "freeze"
            } else {
                "thaw"
            };
            Some((
                format!("token {}-account", name),
                vec![
                    f("account", acct(account)),
                    f("mint", acct(mint)),
                    f("authority", acct(auth)),
                ],
                json!({"type": format!("token.{}_account", name), "account": acct_addr(account), "mint": acct_addr(mint), "authority": acct_addr(auth)}),
                none,
            ))
        }
        TOKEN_INSTRUCTION_CLOSE_ACCOUNT if d.len() == 7 => {
            let (account, dest, auth) = (u16_at(d, 1)?, u16_at(d, 3)?, u16_at(d, 5)?);
            Some((
                "token close-account".into(),
                vec![
                    f("account", acct(account)),
                    f("to", acct(dest)),
                    f("authority", acct(auth)),
                ],
                json!({"type": "token.close_account", "account": acct_addr(account), "destination": acct_addr(dest), "authority": acct_addr(auth)}),
                none,
            ))
        }
        _ => None,
    }
}

fn decode_manager(
    d: &[u8],
    acct: &dyn Fn(u16) -> String,
    acct_addr: &dyn Fn(u16) -> Value,
) -> Option<Decoded> {
    let tag = *d.first()?;
    let (meta, program) = (u16_at(d, 1)?, u16_at(d, 3)?);
    let f = |k: &str, v: String| (k.to_string(), v);
    let base = vec![f("program", acct(program)), f("meta", acct(meta))];
    let none = ExecHints::default();
    match tag {
        MANAGER_INSTRUCTION_UPGRADE if d.len() == 47 => {
            let (srcbuf, off, size) = (u16_at(d, 5)?, u32_at(d, 7)?, u32_at(d, 11)?);
            // The manager installs only bytes whose SHA-256 is this digest.
            let digest = hex::encode(d.get(15..47)?);
            let mut fields = base;
            fields.push(f(
                "new code",
                format!(
                    "{} bytes from buffer {} (offset {})",
                    size,
                    acct(srcbuf),
                    off
                ),
            ));
            fields.push(f("code sha256", digest.clone()));
            let hints = ExecHints {
                compute_units: Some(500_000_000),
                state_units: account_state_units(size as u64)
                    .ok()
                    .map(|u| u.saturating_sub(1)),
            };
            Some((
                "program upgrade".into(),
                fields,
                json!({"type": "manager.upgrade", "program": acct_addr(program), "meta": acct_addr(meta), "buffer": acct_addr(srcbuf), "offset": off, "size": size, "code_sha256": digest}),
                hints,
            ))
        }
        MANAGER_INSTRUCTION_SET_PAUSE if d.len() == 6 => {
            let paused = d[5] != 0;
            let mut fields = base;
            fields.push(f("paused", paused.to_string()));
            Some((
                (if paused {
                    "program pause"
                } else {
                    "program unpause"
                })
                .into(),
                fields,
                json!({"type": "manager.set_pause", "program": acct_addr(program), "paused": paused}),
                none,
            ))
        }
        MANAGER_INSTRUCTION_SET_AUTHORITY if d.len() == 37 => {
            let mut cand = [0u8; 32];
            cand.copy_from_slice(&d[5..37]);
            let mut fields = base;
            fields.push(f(
                "new authority",
                format!("{} (must then claim it)", addr(&cand)),
            ));
            Some((
                "program set-authority".into(),
                fields,
                json!({"type": "manager.set_authority", "program": acct_addr(program), "authority_candidate": addr(&cand)}),
                none,
            ))
        }
        MANAGER_INSTRUCTION_CLAIM_AUTHORITY
        | MANAGER_INSTRUCTION_FINALIZE
        | MANAGER_INSTRUCTION_DESTROY
            if d.len() == 5 =>
        {
            let name = match tag {
                MANAGER_INSTRUCTION_CLAIM_AUTHORITY => "claim-authority",
                MANAGER_INSTRUCTION_FINALIZE => "finalize",
                _ => "destroy",
            };
            Some((
                format!("program {}", name),
                base,
                json!({"type": format!("manager.{}", name.replace('-', "_")), "program": acct_addr(program)}),
                none,
            ))
        }
        _ => None,
    }
}

fn decode_feature_gate(ctx: &Ctx<'_>, d: &[u8]) -> Option<Decoded> {
    if let Some(decoded) = decode_fg_bytes(d) {
        return Some(decoded);
    }
    let disc = u32_at(d, 0)?;
    let role_name = |r: u8| match r {
        0 => "creation",
        1 => "management",
        2 => "config",
        _ => "unknown",
    };
    let none = ExecHints::default();
    let f = |k: &str, v: String| (k.to_string(), v);
    match disc {
        4 if d.len() >= 44 => {
            let role = d[8];
            let mut admin = [0u8; 32];
            admin.copy_from_slice(&d[12..44]);
            Some((
                "feature-gates propose-admin".into(),
                vec![
                    f("role", role_name(role).into()),
                    f("new admin", ctx.label(&admin)),
                ],
                json!({"type": "feature_gate.propose_admin", "role": role_name(role), "new_admin": addr(&admin)}),
                none,
            ))
        }
        5 if d.len() >= 9 => {
            let role = d[8];
            Some((
                "feature-gates accept-admin".into(),
                vec![f("role", role_name(role).into())],
                json!({"type": "feature_gate.accept_admin", "role": role_name(role)}),
                none,
            ))
        }
        _ => None,
    }
}

/// Feature-gate instructions that need no RPC to decode (create-entry, arm,
/// disarm, update-timing-knobs).
fn decode_fg_bytes(d: &[u8]) -> Option<Decoded> {
    let disc = u32_at(d, 0)?;
    let none = ExecHints::default();
    let f = |k: &str, v: String| (k.to_string(), v);
    match disc {
        0 if d.len() >= 16 => {
            let value = &d[8..d.len() - 8];
            let lead = u64_at(d, d.len() - 8)?;
            Some((
                "feature-gates create-entry".into(),
                vec![
                    f("value", hex::encode(value)),
                    f("lead slots", lead.to_string()),
                ],
                json!({"type": "feature_gate.create_entry", "value": hex::encode(value), "next_change_lead_slots": lead}),
                none,
            ))
        }
        1 if d.len() >= 20 => {
            let (slot, index) = (u64_at(d, 8)?, u32_at(d, 16)?);
            Some((
                "feature-gates arm".into(),
                vec![
                    f("index", index.to_string()),
                    f("value", hex::encode(&d[20..])),
                    f("at slot", slot.to_string()),
                ],
                json!({"type": "feature_gate.arm", "index": index, "value": hex::encode(&d[20..]), "activation_slot": slot}),
                none,
            ))
        }
        2 if d.len() >= 12 => {
            let index = u32_at(d, 8)?;
            Some((
                "feature-gates disarm".into(),
                vec![f("index", index.to_string())],
                json!({"type": "feature_gate.disarm", "index": index}),
                none,
            ))
        }
        3 if d.len() >= 40 => {
            let k = [
                u64_at(d, 8)?,
                u64_at(d, 16)?,
                u64_at(d, 24)?,
                u64_at(d, 32)?,
            ];
            Some((
                "feature-gates update-timing-knobs".into(),
                vec![
                    f("arming lead", k[0].to_string()),
                    f("arming gap", k[1].to_string()),
                    f("min dwell", k[2].to_string()),
                    f("no-disarm win", k[3].to_string()),
                ],
                json!({"type": "feature_gate.update_timing_knobs", "min_arming_lead_slots": k[0], "min_gap_between_armings_slots": k[1], "min_dwell_slots": k[2], "no_disarm_window_slots": k[3]}),
                none,
            ))
        }
        _ => None,
    }
}

/// Decodes with the target program's official on-chain ABI, if it has one.
async fn decode_with_abi(ctx: &Ctx<'_>, program: &TnPubkey, data: &[u8]) -> Option<Value> {
    let abi_manager = ctx.config.get_abi_manager_pubkey().ok()?;
    let abi_account = official_abi_account(program, &abi_manager).ok()?;
    let (_, raw) = ctx.account(&abi_account.to_bytes().ok()?).await.ok()??;
    let yaml = abi_yaml_from_account_data(&raw)?;
    reflect_with_abi_yaml(&yaml, data)
}

/// Decodes an instruction with an ABI document. Uses serde_yaml, not
/// serde_yml: the YAML is published by an arbitrary program (serde_yml pulls
/// in libyml, RUSTSEC-2025-0067).
fn reflect_with_abi_yaml(yaml: &str, data: &[u8]) -> Option<Value> {
    let abi: AbiFile = serde_yaml::from_str(yaml).ok()?;
    let mut resolver = TypeResolver::new();
    for t in &abi.types {
        resolver.add_typedef(t.clone());
    }
    resolver.resolve_all().ok()?;
    let roots = abi_reflect::RootTypes {
        instruction_root: Some(abi.instruction_root()?.to_string()),
        account_root: None,
        errors: None,
        events: None,
    };
    let reflector =
        Reflector::with_root_types(resolver, abi_reflect::ReflectorConfig::default(), roots)
            .ok()?;
    let reflected = reflector.reflect_instruction(data).ok()?;
    serde_json::to_value(format_reflection_with_options(
        &reflected,
        &FormatOptions::default(),
    ))
    .ok()
}

#[cfg(test)]
mod tests {
    use thru_base::program_abi::{
        AbiStep, ProgramAbiAccounts, ProgramAbiDigests, ProgramStep, build_multicall_instruction,
        build_program_abi_calls,
    };

    fn program_abi_upgrade_data(authority: u16) -> Vec<u8> {
        let k = |b: u8| [b; 32];
        let accounts = ProgramAbiAccounts {
            manager_program: k(1),
            abi_manager_program: k(2),
            program_meta: k(3),
            program: k(4),
            abi_meta: k(5),
            abi: k(6),
            program_buffer: k(7),
            abi_buffer: k(8),
        };
        let calls = build_program_abi_calls(
            &|key| Ok(10 + u16::from(key[0])),
            &accounts,
            &ProgramStep::Upgrade,
            &AbiStep::Upgrade,
            4000,
            300,
            &ProgramAbiDigests { program: [0xA1; 32], abi: [0xB2; 32] },
            authority,
            false,
        )
        .unwrap();
        build_multicall_instruction(&calls).unwrap()
    }

    #[test]
    fn parses_the_program_abi_upgrade_multicall() {
        let u = parse_program_abi_upgrade(&program_abi_upgrade_data(9)).unwrap();
        assert_eq!((u.manager_idx, u.abi_manager_idx), (11, 12));
        assert_eq!((u.meta, u.program, u.buffer, u.offset, u.size), (13, 14, 17, 0, 4000));
        assert_eq!((u.abi_meta, u.abi, u.abi_buffer, u.abi_size), (15, 16, 18, 300));
        assert_eq!(u.authority, 9);
        assert_eq!((u.code_sha256, u.abi_sha256), ([0xA1; 32], [0xB2; 32]));
    }

    #[test]
    fn multicall_indices_need_known_callees() {
        let data = program_abi_upgrade_data(9);
        let (manager, abi_manager) = ([1u8; 32], [2u8; 32]);
        let is_manager = |k: &TnPubkey| *k == manager;
        let is_abi_manager = |k: &TnPubkey| *k == abi_manager;
        let keys = |m: TnPubkey| {
            move |i: u16| match i {
                11 => Some(m),
                12 => Some(abi_manager),
                _ => Some([i as u8; 32]),
            }
        };
        let known = program_abi_upgrade_indices(&data, &keys(manager), &is_manager, &is_abi_manager)
            .unwrap();
        assert_eq!(known, vec![11, 12, 13, 14, 17, 15, 16, 18, 9]);
        assert!(
            program_abi_upgrade_indices(&data, &keys([0x77; 32]), &is_manager, &is_abi_manager)
                .is_none(),
            "an unknown callee must leave the accounts unchecked"
        );
    }

    #[test]
    fn rejects_other_multicalls() {
        let mut data = program_abi_upgrade_data(9);
        data.push(0);
        assert!(parse_program_abi_upgrade(&data).is_none(), "trailing bytes");
        let one_call = build_multicall_instruction(&[(1, vec![MANAGER_INSTRUCTION_UPGRADE; 47])]).unwrap();
        assert!(parse_program_abi_upgrade(&one_call).is_none(), "single call");

        // ABI source aliasing the program account the Manager overwrites.
        let mut aliased = program_abi_upgrade_data(9);
        let u = parse_program_abi_upgrade(&aliased).unwrap();
        let abi_call = aliased.len() - 51;
        aliased[abi_call + 7..abi_call + 9].copy_from_slice(&u.program.to_le_bytes());
        assert!(parse_program_abi_upgrade(&aliased).is_none(), "aliased ABI source");
    }

    use super::*;
    use thru_base::txn_tools as tt;

    fn names(i: u16) -> String {
        format!("acct{}", i)
    }
    fn addrs(i: u16) -> Value {
        json!(i)
    }

    #[test]
    fn token_instructions_round_trip() {
        let d = tt::build_token_mint_to_instruction(3, 4, 2, 1_000_000).unwrap();
        let (title, fields, j, _) = decode_token(&d, &names, &addrs).unwrap();
        assert_eq!(title, "token mint-to");
        assert_eq!(fields[0].1, "acct3");
        assert_eq!(j["amount"], 1_000_000);
        assert_eq!(j["authority"], 2);

        let d = tt::build_token_transfer_instruction(5, 6, 42).unwrap();
        let (title, _, j, _) = decode_token(&d, &names, &addrs).unwrap();
        assert_eq!(title, "token transfer");
        assert_eq!(
            (j["from"].clone(), j["to"].clone(), j["amount"].clone()),
            (json!(5), json!(6), json!(42))
        );

        for (d, want) in [
            (
                tt::build_token_burn_instruction(2, 3, 4, 9).unwrap(),
                "token burn",
            ),
            (
                tt::build_token_freeze_account_instruction(2, 3, 4).unwrap(),
                "token freeze-account",
            ),
            (
                tt::build_token_thaw_account_instruction(2, 3, 4).unwrap(),
                "token thaw-account",
            ),
            (
                tt::build_token_close_account_instruction(2, 3, 4).unwrap(),
                "token close-account",
            ),
        ] {
            assert_eq!(decode_token(&d, &names, &addrs).unwrap().0, want);
        }
        assert!(decode_token(&[0xFF, 1, 2], &names, &addrs).is_none());
    }

    #[test]
    fn checked_token_transfer_decodes_signed_metadata() {
        for (amount, decimals, ticker, expected) in [
            (250_000, 6, b"MSIG".as_slice(), "0.25".to_string()),
            (10, 0, b"INT".as_slice(), "10".to_string()),
            (1_000_000, 6, b"WHOLE".as_slice(), "1".to_string()),
            (123_456_789, 6, b"FRACT".as_slice(), "123.456789".to_string()),
            (u64::MAX, 0, b"".as_slice(), u64::MAX.to_string()),
            (u64::MAX, 19, b"MAX".as_slice(), "1.8446744073709551615".to_string()),
            (10, 20, b"HIGH".as_slice(), "0.0000000000000000001".to_string()),
            (u64::MAX, 20, b"MAX".as_slice(), "0.18446744073709551615".to_string()),
            (1, 255, b"\x1b\n\xff".as_slice(), format!("0.{}1", "0".repeat(254))),
            (0, 255, b"ZERO".as_slice(), "0".to_string()),
        ] {
            let d = tt::build_token_transfer_checked_instruction(5, 6, 7, amount, decimals, ticker)
                .unwrap();
            let (_, fields, j, _) = decode_token(&d, &names, &addrs).unwrap();
            assert_eq!(j["type"], "token.transfer_checked");
            assert_eq!(j["from"], 5);
            assert_eq!(j["to"], 6);
            assert_eq!(j["mint"], 7);
            assert_eq!(j["amount"], amount);
            assert_eq!(j["ui_amount"], expected);
            assert_eq!(j["decimals"], decimals);
            assert_eq!(j["ticker"], ticker.escape_ascii().to_string());
            assert!(fields.contains(&("amount".into(), expected)));
            assert!(fields.contains(&("ticker".into(), ticker.escape_ascii().to_string())));
        }
    }

    #[test]
    fn checked_token_transfer_rejects_malformed_metadata() {
        let valid = tt::build_token_transfer_checked_instruction(5, 6, 7, 250_000, 6, b"MSIG")
            .unwrap();
        for len in 0..valid.len() {
            assert!(decode_token(&valid[..len], &names, &addrs).is_none());
        }
        let mut trailing = valid.clone();
        trailing.push(0);
        assert!(decode_token(&trailing, &names, &addrs).is_none());
        let mut long_ticker = valid.clone();
        long_ticker[16] = 9;
        assert!(decode_token(&long_ticker, &names, &addrs).is_none());
        let mut padding = valid;
        padding[24] = 1;
        assert!(decode_token(&padding, &names, &addrs).is_none());
    }

    #[tokio::test]
    async fn checked_token_transfer_checks_every_referenced_account() {
        let mut config = crate::config::Config::default();
        config.rpc_base_url = "http://127.0.0.1:1".into();
        let ctx = Ctx::with_program(&config, None, true).unwrap();
        let target = pk_bytes(&config.get_token_program_pubkey().unwrap()).unwrap();
        let data = tt::build_token_transfer_checked_instruction(5, 6, 7, 250_000, 6, b"MSIG")
            .unwrap();
        let mut payload = InvokePayload {
            target_program_idx: 8,
            target_program: target,
            refs: vec![(5, [5; 32]), (6, [6; 32]), (7, [7; 32])],
            instr_data: data,
        };
        assert_eq!(check_invoke_accounts(&ctx, &payload), AccountCheck::Verified);
        for missing in [5, 6, 7] {
            let refs = payload.refs.clone();
            payload.refs.retain(|(i, _)| *i != missing);
            assert_eq!(
                check_invoke_accounts(&ctx, &payload),
                AccountCheck::Unlisted(vec![missing])
            );
            payload.refs = refs;
        }
        payload.instr_data[1..3].copy_from_slice(&0u16.to_le_bytes());
        assert_eq!(
            check_invoke_accounts(&ctx, &payload),
            AccountCheck::Unlisted(vec![0])
        );
    }

    fn fg(disc: u32, rest: &[u8]) -> Vec<u8> {
        let mut d = disc.to_le_bytes().to_vec();
        d.extend_from_slice(&2u16.to_le_bytes());
        d.extend_from_slice(&3u16.to_le_bytes());
        d.extend_from_slice(rest);
        d
    }

    #[test]
    fn feature_gate_instructions_decode() {
        let mut arm = 777u64.to_le_bytes().to_vec();
        arm.extend_from_slice(&5u32.to_le_bytes());
        arm.extend_from_slice(&[1, 0, 0, 0]);
        let (_, _, j, _) = decode_fg_bytes(&fg(1, &arm)).unwrap();
        assert_eq!(
            (j["index"].clone(), j["activation_slot"].clone()),
            (json!(5), json!(777))
        );

        let (_, _, j, _) = decode_fg_bytes(&fg(2, &9u32.to_le_bytes())).unwrap();
        assert_eq!(j["type"], "feature_gate.disarm");
        assert_eq!(j["index"], 9);

        let knobs: Vec<u8> = [1u64, 2, 3, 4]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let (_, _, j, _) = decode_fg_bytes(&fg(3, &knobs)).unwrap();
        assert_eq!(j["no_disarm_window_slots"], 4);
    }

    #[test]
    fn on_chain_abi_fallback_decodes_an_instruction() {
        let yaml = include_str!("../../../abi/tn_token_program.abi.yaml");
        let data = tt::build_token_mint_to_instruction(3, 4, 2, 7).unwrap();
        let decoded = reflect_with_abi_yaml(yaml, &data).expect("token ABI decodes mint-to");
        assert!(decoded.to_string().contains("mint"), "{decoded}");
    }

    #[test]
    fn manager_instructions_round_trip() {
        let d = tt::build_manager_set_authority_instruction(2, 3, [7u8; 32]).unwrap();
        let (title, _, j, _) = decode_manager(&d, &names, &addrs).unwrap();
        assert_eq!(title, "program set-authority");
        assert_eq!(j["program"], 3);

        let d = tt::build_manager_set_pause_instruction(2, 3, true).unwrap();
        assert_eq!(
            decode_manager(&d, &names, &addrs).unwrap().0,
            "program pause"
        );

        let d = tt::build_manager_header_instruction(tt::MANAGER_INSTRUCTION_CLAIM_AUTHORITY, 2, 3)
            .unwrap();
        assert_eq!(
            decode_manager(&d, &names, &addrs).unwrap().0,
            "program claim-authority"
        );

        let d = tt::build_manager_upgrade_instruction(2, 3, 4, 0, 6664, [0xAB; 32]).unwrap();
        let (title, _, j, hints) = decode_manager(&d, &names, &addrs).unwrap();
        assert_eq!(title, "program upgrade");
        assert_eq!(j["size"], 6664);
        assert_eq!(j["code_sha256"], hex::encode([0xAB; 32]));
        assert!(hints.compute_units.is_some());
    }

    #[test]
    fn managed_meta_key_reads_after_the_account_type() {
        let mut meta = vec![0u8; super::MANAGED_META_SIZE];
        meta[0] = super::MANAGED_META_ACCOUNT_TYPE_V1;
        meta[1..33].fill(0x11);
        meta[33..65].fill(0x22);
        assert_eq!(
            super::managed_meta_key(&meta, super::MANAGED_META_AUTHORITY_OFFSET),
            Some([0x11; 32])
        );
        assert_eq!(
            super::managed_meta_key(&meta, super::MANAGED_META_CANDIDATE_OFFSET),
            Some([0x22; 32])
        );
        meta[0] = 0;
        assert_eq!(super::managed_meta_key(&meta, 1), None);
        meta[0] = super::MANAGED_META_ACCOUNT_TYPE_V1;
        assert_eq!(super::managed_meta_key(&meta[..73], 1), None);
    }

    /* A ManagerActivate proposed with --via-multisig executes with the
       budget the direct command requests: the request stores the whole
       instruction, proof of possession included, and the decoder supplies
       the budget. */
    #[test]
    fn stored_cv_manager_requests_carry_the_direct_budget() {
        let activate =
            tt::build_cv_manager_activate_instruction(2, [7; 32], [1; 96], [2; 192], [3; 32], 100);
        let stored = RequestPayload::Invoke(InvokePayload {
            target_program_idx: 3,
            target_program: programs::CONSENSUS_VALIDATOR_PROGRAM_BYTES,
            refs: vec![(2, [9; 32]), (4, [8; 32])],
            instr_data: activate.clone(),
        })
        .encode();
        let Ok(RequestPayload::Invoke(p)) =
            RequestPayload::decode(thru_base::multisig::KIND_INVOKE, &stored)
        else {
            panic!("the stored invoke request decodes");
        };
        assert_eq!(p.instr_data, activate, "the proof of possession is stored");
        let hints = cv_manager_hints(ExecHints::default(), &p.instr_data);
        assert_eq!(hints.compute_units, Some(1_000_000_000));
        assert!(hints.compute_units > Some(thru_base::multisig::EXECUTE_COMPUTE_UNITS));

        for (d, want) in [
            (tt::build_cv_manager_deactivate_instruction(2, [7; 32]), Some(500_000_000)),
            (tt::build_cv_manager_set_weight_instruction(2, [7; 32], 300), Some(500_000_000)),
            /* Header-only instructions keep the execute default. */
            (tt::build_cv_set_self_service_instruction(2, false), None),
            (tt::build_cv_set_validator_manager_instruction(2, [7; 32]), None),
        ] {
            assert_eq!(cv_manager_hints(ExecHints::default(), &d).compute_units, want);
        }

        /* Hints already set are kept where the call needs no CV budget. */
        let set = ExecHints {
            compute_units: Some(5),
            state_units: Some(1),
        };
        let kept = cv_manager_hints(set, &tt::build_cv_set_self_service_instruction(2, true));
        assert_eq!((kept.compute_units, kept.state_units), (Some(5), Some(1)));
    }

    /// The compute hint `describe_payload` gives an approved invoke request.
    async fn described_budget(ctx: &Ctx<'_>, target: TnPubkey, instr_data: Vec<u8>) -> Option<u32> {
        described(ctx, target, instr_data).await.hints.compute_units
    }

    /// What `describe_payload` shows for an approved invoke request.
    async fn described(ctx: &Ctx<'_>, target: TnPubkey, instr_data: Vec<u8>) -> Action {
        let r = RequestAccount {
            account_type: thru_base::multisig::ACCOUNT_TYPE_REQUEST_V1,
            kind: thru_base::multisig::KIND_INVOKE,
            status: thru_base::multisig::REQUEST_STATUS_OPEN,
            member_cnt_snapshot: 2,
            required_approvals: 1,
            request_id: 1,
            config_epoch_snapshot: 0,
            approval_bitmap: 1,
            multisig: [0x11; 32],
            proposer: [0x22; 32],
            payload: RequestPayload::Invoke(InvokePayload {
                target_program_idx: 3,
                target_program: target,
                refs: vec![(2, [0x33; 32])],
                instr_data,
            }),
            raw_payload: Vec::new(),
        };
        describe_payload(ctx, &r, None).await
    }

    /* A request proposed with `validator manager --program <custom>`
       targets a CV program the executor's config doesn't name.  Its manager
       instructions get the CV budget once the executor names that program
       (`multisig execute --consensus-program`).  The same bytes sent to any
       other program keep the execute default, so a proposer can't choose
       which program gets the budget. */
    #[tokio::test]
    async fn describe_payload_budgets_a_custom_cv_program_the_executor_names() {
        let custom: TnPubkey = [0x5c; 32];
        let other: TnPubkey = [0x5d; 32];
        let mut config = crate::config::Config::default();
        config.rpc_base_url = "http://127.0.0.1:1".to_string();
        /* Without an ABI manager the on-chain ABI lookup stops before any
           RPC and the call shows as hex; nothing else on this path reads an
           account, so the test needs no node. */
        config.abi_manager_program_public_key = String::new();
        let mut ctx = Ctx::with_program(&config, None, true).expect("context");
        let activate =
            tt::build_cv_manager_activate_instruction(2, [7; 32], [1; 96], [2; 192], [3; 32], 100);
        let deactivate = tt::build_cv_manager_deactivate_instruction(2, [7; 32]);
        let set_weight = tt::build_cv_manager_set_weight_instruction(2, [7; 32], 300);
        let self_service = tt::build_cv_set_self_service_instruction(2, true);

        /* The bootstrap CV program needs no flag. */
        let bootstrap = programs::CONSENSUS_VALIDATOR_PROGRAM_BYTES;
        assert_eq!(
            described_budget(&ctx, bootstrap, activate.clone()).await,
            Some(1_000_000_000)
        );
        /* A custom one isn't known until the executor names it. */
        assert_eq!(described_budget(&ctx, custom, activate.clone()).await, None);

        ctx.consensus_program = Some(custom);
        assert_eq!(described_budget(&ctx, custom, activate.clone()).await, Some(1_000_000_000));
        assert_eq!(described_budget(&ctx, custom, deactivate.clone()).await, Some(500_000_000));
        assert_eq!(described_budget(&ctx, custom, set_weight.clone()).await, Some(500_000_000));
        assert_eq!(described_budget(&ctx, custom, self_service).await, None);

        /* Another program with the same bytes gets no budget. */
        for d in [activate, deactivate, set_weight] {
            assert_eq!(described_budget(&ctx, other, d).await, None);
        }
    }

    /* Whoever shows, approves or executes a request whose target their CLI
       doesn't know sees a note suggesting --consensus-program when the call
       carries a validator manager discriminant that needs a budget.  The
       note only informs: the budget stays the default until the executor
       names the program, and then the note goes. */
    #[tokio::test]
    async fn describe_payload_suggests_naming_an_unknown_cv_program() {
        let custom: TnPubkey = [0x5c; 32];
        let mut config = crate::config::Config::default();
        config.rpc_base_url = "http://127.0.0.1:1".to_string();
        config.abi_manager_program_public_key = String::new();
        let mut ctx = Ctx::with_program(&config, None, true).expect("context");
        let activate =
            tt::build_cv_manager_activate_instruction(2, [7; 32], [1; 96], [2; 192], [3; 32], 100);
        let set_weight = tt::build_cv_manager_set_weight_instruction(2, [7; 32], 300);
        let flag = format!("--consensus-program {}", addr(&custom));
        let noted = |a: &Action| a.text.iter().any(|l| l.starts_with("Note") && l.contains(&flag));

        let a = described(&ctx, custom, activate.clone()).await;
        assert!(noted(&a));
        assert_eq!(a.hints.compute_units, None);
        assert_eq!(
            a.json["consensus_program_hint"],
            json!({"execute_args": ["--consensus-program", addr(&custom)], "compute_units": 1_000_000_000})
        );
        let a = described(&ctx, custom, set_weight).await;
        assert!(noted(&a));
        assert_eq!(a.json["consensus_program_hint"]["compute_units"], json!(500_000_000));

        /* A header-only instruction needs no budget, so no note. */
        let a = described(&ctx, custom, tt::build_cv_set_self_service_instruction(2, true)).await;
        assert!(!noted(&a));
        assert!(a.json.get("consensus_program_hint").is_none());

        /* A CV program the CLI knows gets the budget, not the note. */
        let bootstrap = programs::CONSENSUS_VALIDATOR_PROGRAM_BYTES;
        let a = described(&ctx, bootstrap, activate.clone()).await;
        assert_eq!(a.hints.compute_units, Some(1_000_000_000));
        assert!(a.json.get("consensus_program_hint").is_none());
        ctx.consensus_program = Some(custom);
        let a = described(&ctx, custom, activate).await;
        assert!(!noted(&a));
        assert_eq!(a.hints.compute_units, Some(1_000_000_000));
        assert!(a.json.get("consensus_program_hint").is_none());
    }
}
