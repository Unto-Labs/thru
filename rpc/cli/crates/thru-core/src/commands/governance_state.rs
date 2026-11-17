//! Live checks for the fields explicitly committed by a reviewed governance plan.
use super::*;
use thru_base::tn_account::TN_ACCOUNT_FLAG_COMPRESSED;

fn field_matches(
    expected: &Value,
    field: &str,
    actual: &Value,
    label: &str,
) -> Result<(), CliError> {
    if let Some(value) = expected.get(field) {
        if value != actual {
            return Err(invalid(format!(
                "{label} {field} differs from reviewed state"
            )));
        }
    }
    Ok(())
}

fn account_data(
    account: &thru_client::Account,
    owner: Option<&Value>,
    flags: Option<&Value>,
    label: &str,
) -> Result<Vec<u8>, CliError> {
    if account.flags & TN_ACCOUNT_FLAG_COMPRESSED != 0 {
        return Err(invalid(format!("{label} account data is compressed")));
    }
    if let Some(owner) = owner {
        let expected = owner
            .as_str()
            .ok_or_else(|| invalid("invalid reviewed owner"))?;
        if account
            .owner
            .to_bytes()
            .map_err(|e| invalid(e.to_string()))?
            != key(expected)?
        {
            return Err(invalid(format!(
                "{label} owner differs from reviewed state"
            )));
        }
    }
    if let Some(flags) = flags {
        // Program state keeps exact reviewed flags; only candidate Multisigs mask NEW.
        if flags.as_u64() != Some(u64::from(account.flags)) {
            return Err(invalid(format!("{label} flags differ from reviewed state")));
        }
    }
    let bytes = match account.data.as_deref() {
        Some(data) => base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| invalid(e.to_string()))?,
        None if account.data_size == 0 => Vec::new(),
        None => return Err(invalid(format!("{label} account data unavailable"))),
    };
    if bytes.len() as u64 != account.data_size {
        return Err(invalid(format!("{label} account data truncated")));
    }
    Ok(bytes)
}

fn check_creation(
    account: Option<&thru_client::Account>,
    owner: Option<&Value>,
    flags: Option<&Value>,
    label: &str,
) -> Result<(), CliError> {
    let reviewed_corpse = flags
        .and_then(Value::as_u64)
        .is_some_and(|flags| flags & 16 != 0);
    match account {
        None if !reviewed_corpse => Ok(()),
        Some(account) if reviewed_corpse && owner.is_some() => {
            if !account_data(account, owner, flags, label)?.is_empty() {
                return Err(invalid(format!(
                    "{label} reviewed creation corpse is not empty"
                )));
            }
            Ok(())
        }
        _ => Err(invalid(format!(
            "{label} creation target differs from reviewed absence/corpse"
        ))),
    }
}

fn artifact(bytes: &[u8], expected: &Value, label: &str) -> Result<(), CliError> {
    field_matches(expected, "size", &json!(bytes.len()), label)?;
    if expected.get("sha256").is_some() {
        field_matches(expected, "sha256", &json!(digest(bytes)), label)?;
    }
    Ok(())
}

fn metadata(bytes: &[u8], expected: &Value) -> Result<(), CliError> {
    if expected["state"] == "destroyed" {
        if !bytes.is_empty() {
            return Err(invalid("reviewed destroyed metadata is not truncated"));
        }
        // Truncation removes version and authorities; their retained values are historical.
        return Ok(());
    }
    if ["version", "state", "authority", "candidate"]
        .iter()
        .any(|field| expected.get(field).is_some())
    {
        let decoded = decode_account(InspectKind::Metadata, bytes)?;
        for field in ["version", "authority", "candidate"] {
            field_matches(expected, field, &decoded[field], "program metadata")?;
        }
        let state = match decoded["state"].as_u64() {
            Some(0) => "open",
            Some(1) => "paused",
            Some(2) => "finalized",
            _ => return Err(invalid("invalid managed metadata lifecycle")),
        };
        field_matches(expected, "state", &json!(state), "program metadata")?;
    }
    Ok(())
}

fn abi_metadata(bytes: &[u8], subject: &str) -> Result<(), CliError> {
    // Packed official metadata: account_type:u8 (TN_ABI_MANAGER_ACCOUNT_TYPE_META_V1
    // = 1), kind:u8 (0 = official), flags:u16, subject:[u8;32].
    if bytes.len() != 100 || bytes[..4] != [1, 0, 0, 0] || bytes[4..36] != key(subject)? {
        return Err(invalid(
            "official ABI metadata layout/link differs from reviewed state",
        ));
    }
    Ok(())
}

fn abi_content(bytes: &[u8], expected: &Value) -> Result<(), CliError> {
    if expected["state"] == "closed" {
        if !bytes.is_empty() {
            return Err(invalid("reviewed closed ABI content is not truncated"));
        }
        // A closed account no longer carries its historical revision or artifact.
        return Ok(());
    }
    // Packed abi_account header: account_type:u8 (TN_ABI_MANAGER_ACCOUNT_TYPE_CONTENT_V1
    // = 2), meta:[u8;32], revision:u64, state:u8, content_sz:u32, then the content.
    if bytes.len() < 46 || bytes[0] != 2 || bytes[41] > 1 {
        return Err(invalid("invalid ABI content layout"));
    }
    let size = u32::from_le_bytes(bytes[42..46].try_into().expect("checked ABI header")) as usize;
    if size != bytes.len() - 46 {
        return Err(invalid("ABI content length differs from header"));
    }
    field_matches(
        expected,
        "metadata_address",
        &json!(hex::encode(&bytes[1..33])),
        "ABI content link",
    )?;
    field_matches(
        expected,
        "revision",
        &json!(u64_at(bytes, 33).to_string()),
        "ABI content",
    )?;
    field_matches(
        expected,
        "state",
        &json!(if bytes[41] == 0 { "open" } else { "finalized" }),
        "ABI content",
    )?;
    artifact(&bytes[46..], &expected["artifact"], "ABI artifact")
}

async fn fetch(
    client: &thru_client::Client,
    address: &str,
) -> Result<Option<thru_client::Account>, CliError> {
    client
        .get_account_info(
            &Pubkey::from_bytes(&key(address)?),
            None,
            Some(thru_client::VersionContext::Current),
        )
        .await
        .map_err(|e| invalid(e.to_string()))
}
// Only an explicitly reviewed terminal corpse can disappear at block seal.
fn terminal_data(
    account: Option<&thru_client::Account>,
    owner: Option<&Value>,
    flags: Option<&Value>,
    terminal: bool,
    label: &str,
) -> Result<Vec<u8>, CliError> {
    if let Some(account) = account {
        return account_data(account, owner, flags, label);
    }
    let removable = flags.and_then(Value::as_u64).is_some_and(|flags| {
        flags <= 255 && flags & 16 != 0 && flags & (8 | 32) != 0 && flags & (1 | 64 | 128) == 0
    });
    if terminal && removable && owner.and_then(Value::as_str).is_some() {
        return Ok(Vec::new());
    }
    Err(invalid(format!("reviewed account {label} missing")))
}

async fn live_data(
    client: &thru_client::Client,
    address: &str,
    owner: Option<&Value>,
    flags: Option<&Value>,
    creating: bool,
    terminal: bool,
) -> Result<Option<Vec<u8>>, CliError> {
    let account = fetch(client, address).await?;
    if creating {
        check_creation(account.as_ref(), owner, flags, address)?;
        return Ok(None);
    }
    terminal_data(account.as_ref(), owner, flags, terminal, address).map(Some)
}

fn role_str<'a>(roles: &'a Value, field: &str) -> Result<&'a str, CliError> {
    roles[field]
        .as_str()
        .ok_or_else(|| invalid(format!("missing reviewed Core role {field}")))
}

fn role_kind(kind: u64) -> Result<&'static str, CliError> {
    match kind {
        1 => Ok("eoa"),
        2 => Ok("multisig"),
        _ => Err(invalid("invalid live Core admin kind")),
    }
}

// Rotations approve no program changes; the live Core config must match the reviewed roles.
fn core_roles(account: Option<&thru_client::Account>, roles: &Value) -> Result<(), CliError> {
    let account = account.ok_or_else(|| invalid("Core config account missing"))?;
    let bytes = account_data(account, None, None, "Core config")?;
    let live = decode_account(InspectKind::Config, &bytes)?;
    let zero = "00".repeat(32);
    let (pending_kind, pending_admin) = if live["pending_present"] == true {
        (
            role_kind(live["pending_admin_kind"].as_u64().unwrap_or(0))?,
            live["pending_admin"].as_str().unwrap_or_default(),
        )
    } else {
        ("none", zero.as_str())
    };
    for (field, label, actual) in [
        ("admin", "admin", live["admin"].as_str().unwrap_or_default()),
        (
            "kind",
            "admin kind",
            role_kind(live["admin_kind"].as_u64().unwrap_or(0))?,
        ),
        ("pending_admin", "pending admin", pending_admin),
        ("pending_kind", "pending admin kind", pending_kind),
    ] {
        if role_str(roles, field)? != actual {
            return Err(invalid(format!(
                "live Core {label} differs from reviewed roles"
            )));
        }
    }
    Ok(())
}

pub(super) async fn verify(
    client: &thru_client::Client,
    plan: &Plan,
    before: bool,
) -> Result<(), CliError> {
    if matches!(
        &plan.input.operation,
        Operation::ProposeAdmin { .. } | Operation::AcceptAdmin
    ) {
        // Rotation moves Core A's and Core B's configs together (UNTO-3561).
        let side = &plan.input.reviewed_state["roles"][if before { "before" } else { "after" }];
        for (role, config) in [
            ("core", thru_base::bootstrap_addresses::CORE_CONFIG_BYTES),
            (
                "core_peer",
                thru_base::bootstrap_addresses::CORE_PEER_CONFIG_BYTES,
            ),
        ] {
            let account = fetch(client, &hex::encode(config)).await?;
            core_roles(account.as_ref(), &side[role])?;
        }
    }
    let changes = plan.input.reviewed_state["changes"]
        .as_array()
        .ok_or_else(|| invalid("missing reviewed changes"))?;
    for change in changes {
        let expected = &change[if before { "before" } else { "after" }];
        let address = expected["address"]
            .as_str()
            .ok_or_else(|| invalid("missing reviewed program address"))?;
        let creating_program = before && matches!(&plan.input.operation, Operation::Create { .. });
        let image = live_data(
            client,
            address,
            expected.get("owner"),
            expected.get("flags"),
            creating_program,
            expected["metadata"]["state"] == "destroyed",
        )
        .await?;
        if let Some(image) = &image {
            artifact(image, &expected["executable"], "executable")?;
            if expected["metadata"]["state"] == "destroyed" && !image.is_empty() {
                return Err(invalid("reviewed destroyed executable is not truncated"));
            }
        }
        if let Some(meta) = expected.get("metadata").filter(|value| !value.is_null()) {
            let address = meta["address"]
                .as_str()
                .ok_or_else(|| invalid("missing reviewed metadata address"))?;
            if let Some(bytes) = live_data(
                client,
                address,
                meta.get("owner"),
                meta.get("flags"),
                creating_program,
                meta["state"] == "destroyed",
            )
            .await?
            {
                metadata(&bytes, meta)?;
            }
        }
        let (create_meta, create_content, bound_meta, bound_content) = match &plan.input.operation {
            Operation::Abi {
                action,
                abi_metadata,
                abi_content,
                ..
            } => (
                matches!(
                    action,
                    AbiAction::CreateMetaPermanent | AbiAction::CreateMetaEphemeral
                ),
                matches!(
                    action,
                    AbiAction::CreateContentPermanent | AbiAction::CreateContentEphemeral
                ),
                Some(abi_metadata.as_str()),
                abi_content.as_deref(),
            ),
            _ => (false, false, None, None),
        };
        let abi = &expected["abi"];
        let meta_address = abi["metadata_address"]
            .as_str()
            .or(if before && create_meta {
                bound_meta
            } else {
                None
            });
        if let Some(meta_address) = meta_address {
            if let Some(bytes) = live_data(
                client,
                meta_address,
                abi.get("owner"),
                abi.get("metadata_flags"),
                before && create_meta,
                false,
            )
            .await?
            {
                abi_metadata(&bytes, address)?;
            }
        }
        // Metadata creation is a staged operation; it does not create ABI content.
        if !create_meta {
            let content_address = abi["content_address"]
                .as_str()
                .or(if before && create_content {
                    bound_content
                } else {
                    None
                });
            if let Some(content_address) = content_address {
                if let Some(bytes) = live_data(
                    client,
                    content_address,
                    abi.get("owner"),
                    abi.get("content_flags"),
                    before && create_content,
                    abi["state"] == "closed",
                )
                .await?
                {
                    abi_content(&bytes, abi)?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "governance_state_tests.rs"]
mod tests;
