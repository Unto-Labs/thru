//! Bound Core program manager plans. Public deployment remains in `program`/`abi`.
use crate::{config::Config, crypto, error::CliError, output, utils::validate_address_or_hex};
use base64::Engine;
use clap::{Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::PathBuf, time::Duration};
use thru_base::{
    rpc_types::ProofType,
    tn_account::{TN_ACCOUNT_FLAG_NEW, TN_ACCOUNT_FLAG_UNCOMPRESSABLE},
    tn_tools::Pubkey,
};

#[path = "governance_state.rs"]
mod reviewed_state;

fn invalid(message: impl Into<String>) -> CliError {
    CliError::Validation(message.into())
}
// Zero denotes absence. Permanent revival preserves flags; ephemeral revival resets them.
fn created_flags(previous: &Value, ephemeral: bool) -> Result<u64, CliError> {
    let old = previous
        .as_u64()
        .filter(|flags| *flags <= 255)
        .ok_or_else(|| invalid("invalid reviewed creation before flags"))?;
    if old != 0
        && (old & 16 == 0
            || old & (1 | 64) != 0
            || (old & 8 != 0) != ephemeral
            || ephemeral && old & 32 != 0)
    {
        return Err(invalid("invalid reviewed creation before flags"));
    }
    Ok(if ephemeral {
        8
    } else if old & 16 != 0 {
        old & !(16 | 128)
    } else {
        32
    })
}
fn key(s: &str) -> Result<[u8; 32], CliError> {
    validate_address_or_hex(s)
}
fn hex32(s: &str) -> Result<[u8; 32], CliError> {
    hex::decode(s)
        .map_err(|e| invalid(e.to_string()))?
        .try_into()
        .map_err(|_| invalid("expected 32 bytes of hex"))
}
fn digest(data: &[u8]) -> String {
    hex::encode(crypto::calculate_sha256(data))
}
fn read_json<T: for<'a> Deserialize<'a>>(path: &PathBuf) -> Result<T, CliError> {
    serde_json::from_slice(&fs::read(path).map_err(|e| invalid(e.to_string()))?)
        .map_err(|e| invalid(e.to_string()))
}
fn save_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), CliError> {
    fs::write(
        path,
        serde_json::to_vec_pretty(value).map_err(|e| invalid(e.to_string()))?,
    )
    .map_err(|e| invalid(e.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Accounts {
    pub read_write: Vec<String>,
    pub read_only: Vec<String>,
}
impl Accounts {
    fn validate(&self, wrapper: &str) -> Result<(), CliError> {
        let mut seen = BTreeSet::new();
        seen.insert(key(wrapper)?);
        for group in [&self.read_write, &self.read_only] {
            let mut previous = None;
            for address in group {
                let address = key(address)?;
                if previous.is_some_and(|p| p >= address) || !seen.insert(address) {
                    return Err(invalid(
                        "account lists must be sorted, unique, disjoint, and exclude the transaction program",
                    ));
                }
                previous = Some(address);
            }
        }
        if seen.len() > 1023 {
            return Err(invalid("too many fixed accounts"));
        }
        Ok(())
    }
    fn index(&self, address: &str, admin: Option<&str>) -> Result<u16, CliError> {
        let address = key(address)?;
        if let Some(admin) = admin {
            if key(admin)? == address {
                return Ok(0);
            }
        }
        self.read_write
            .iter()
            .chain(&self.read_only)
            .position(|s| key(s).ok() == Some(address))
            .map(|i| (i + 2) as u16)
            .ok_or_else(|| invalid("bound account absent from fixed execution layout"))
    }
    fn bound(&self, address: &str, admin: Option<&str>, out: &mut Vec<u8>) -> Result<(), CliError> {
        out.extend(self.index(address, admin)?.to_le_bytes());
        out.extend(key(address)?);
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    pub source: String,
    pub offset: u32,
    pub length: u32,
    pub artifact: PathBuf,
    pub sha256: String,
}
impl Image {
    fn validate(&self, executable: bool) -> Result<(), CliError> {
        self.offset
            .checked_add(self.length)
            .ok_or_else(|| invalid("source range overflows"))?;
        if self.length == 0 || self.length > 16 * 1024 * 1024 {
            return Err(invalid("source payload must fit a nonempty account"));
        }
        let bytes = fs::read(&self.artifact).map_err(|e| invalid(e.to_string()))?;
        if bytes.len() != self.length as usize || digest(&bytes) != self.sha256 {
            return Err(invalid("exact reviewed artifact size/SHA256 mismatch"));
        }
        if executable
            && (bytes.len() < 20
                || bytes[0] != 1
                || bytes[bytes.len() - 8..].iter().any(|b| *b != 0))
        {
            return Err(invalid(
                "invalid complete ThruVM image (header/text/trailer required)",
            ));
        }
        if !executable {
            let abi: abi_loader::AbiFile = serde_yml::from_slice(&bytes)
                .map_err(|e| invalid(format!("invalid prepared ABI YAML: {e}")))?;
            abi_gen::cmds::common::validate_closed_abi(&abi)
                .map_err(|e| invalid(format!("invalid prepared ABI: {e}")))?;
        }
        Ok(())
    }
    fn encode(&self, input: &PlanInput, out: &mut Vec<u8>) -> Result<(), CliError> {
        input.bound(&self.source, None, out)?;
        out.extend(self.offset.to_le_bytes());
        out.extend(self.length.to_le_bytes());
        out.extend(hex32(&self.sha256)?);
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofSlot {
    pub address: String,
    pub seed: String,
    pub metadata: String,
    pub program: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Operation {
    Create {
        metadata: String,
        program: String,
        seed: String,
        image: Image,
        application_authority: String,
        pin: bool,
        proof_slot: Option<ProofSlot>,
    },
    Upgrade {
        metadata: String,
        program: String,
        image: Image,
    },
    SetPause {
        metadata: String,
        program: String,
        paused: bool,
    },
    Destroy {
        metadata: String,
        program: String,
    },
    Finalize {
        metadata: String,
        program: String,
    },
    SetApplicationAuthority {
        metadata: String,
        program: String,
        authority: String,
    },
    SetPin {
        target: String,
        pin: bool,
    },
    ProposeAdmin {
        candidate: String,
        kind: u8,
    },
    AcceptAdmin,
    Abi {
        action: AbiAction,
        subject: String,
        program_metadata: Option<String>,
        abi_metadata: String,
        abi_content: Option<String>,
        image: Option<Image>,
        creation_proof: Option<String>,
    },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "kebab-case")]
pub enum AbiAction {
    CreateMetaPermanent,
    CreateMetaEphemeral,
    CreateContentPermanent,
    CreateContentEphemeral,
    Upgrade,
    Close,
    Finalize,
    CorrectRoot,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanInput {
    /// Top-level program: canonical Multicall, or the instruction owner for an
    /// EOA / canonical Multisig for a Multisig admin. Direct permanent creation
    /// confirms a separate proof refresh transaction before execution.
    pub wrapper: String,
    pub target_program: String,
    pub config: String,
    pub admin: String,
    pub eoa_admin: bool,
    pub accounts: Accounts,
    pub operation: Operation,
    /// ReviewedStatePlan consumed by bootstrap expected-state:update. Never populated from RPC.
    pub reviewed_state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub input: PlanInput,
    pub instruction: String,
    pub plan_sha256: String,
    pub reviewed_state_sha256: String,
}
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted: std::collections::BTreeMap<_, _> =
                map.iter().map(|(k, v)| (k.clone(), canonical(v))).collect();
            serde_json::to_value(sorted).expect("JSON values serialize")
        }
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        other => other.clone(),
    }
}
fn json_digest(value: &Value) -> String {
    digest(&serde_json::to_vec(&canonical(value)).expect("JSON values serialize"))
}
impl PlanInput {
    // CPI shares the transaction account table: slot zero is the fee payer,
    // slot one is the top-level program, and fixed accounts begin at two.
    fn index(&self, address: &str, admin: Option<&str>) -> Result<u16, CliError> {
        if key(address)? == key(&self.wrapper)? {
            return Ok(1);
        }
        self.accounts.index(address, admin)
    }
    fn bound(&self, address: &str, admin: Option<&str>, out: &mut Vec<u8>) -> Result<(), CliError> {
        out.extend(self.index(address, admin)?.to_le_bytes());
        out.extend(key(address)?);
        Ok(())
    }
    /// Core B and its config, bound after the rotation arguments: Core A
    /// invokes Core B with the mirrored instruction so both configs move in
    /// one transaction (UNTO-3561).
    fn peer_binding(&self, out: &mut Vec<u8>) -> Result<(), CliError> {
        use thru_base::bootstrap_addresses::{
            CORE_PEER_CONFIG_BYTES, CORE_PEER_MANAGER_PROGRAM_BYTES,
        };
        self.bound(&hex::encode(CORE_PEER_MANAGER_PROGRAM_BYTES), None, out)?;
        self.bound(&hex::encode(CORE_PEER_CONFIG_BYTES), None, out)
    }
    fn uses_multicall(&self) -> Result<bool, CliError> {
        Ok(key(&self.wrapper)? == thru_base::bootstrap_addresses::MULTICALL_PROGRAM_BYTES)
    }
    fn transaction_instruction(&self, mut calls: Vec<(u16, Vec<u8>)>) -> Result<Vec<u8>, CliError> {
        if self.uses_multicall()? {
            return multicall(&calls);
        }
        if calls.len() != 1 || calls[0].0 != 1 {
            return Err(invalid(
                "direct execution requires one call to the transaction program",
            ));
        }
        Ok(calls.remove(0).1)
    }
    pub fn encode(&self) -> Result<Vec<u8>, CliError> {
        self.accounts.validate(&self.wrapper)?;
        use thru_base::bootstrap_addresses::{
            ABI_MANAGER_PROGRAM_BYTES, CORE_CONFIG_BYTES, CORE_MANAGER_PROGRAM_BYTES,
            MULTICALL_PROGRAM_BYTES, MULTISIG_PROGRAM_BYTES,
        };
        let target = if matches!(&self.operation, Operation::Abi { .. }) {
            ABI_MANAGER_PROGRAM_BYTES
        } else {
            CORE_MANAGER_PROGRAM_BYTES
        };
        let direct = if self.eoa_admin {
            target
        } else {
            MULTISIG_PROGRAM_BYTES
        };
        if ![MULTICALL_PROGRAM_BYTES, direct].contains(&key(&self.wrapper)?)
            || key(&self.target_program)? != target
            || key(&self.config)? != CORE_CONFIG_BYTES
        {
            return Err(invalid(
                "governance requires canonical Core config, instruction owner, and Multicall or direct execution program",
            ));
        }
        self.index(&self.target_program, None)?;
        let writable = |address: &str| -> Result<(), CliError> {
            let target = key(address)?;
            if !self
                .accounts
                .read_write
                .iter()
                .any(|a| key(a).ok() == Some(target))
            {
                return Err(invalid("mutation target must occupy a fixed writable slot"));
            }
            Ok(())
        };
        match &self.operation {
            Operation::Create {
                metadata,
                program,
                proof_slot,
                ..
            } => {
                writable(metadata)?;
                writable(program)?;
                if let Some(slot) = proof_slot {
                    writable(&slot.address)?;
                }
            }
            Operation::Upgrade {
                metadata, program, ..
            }
            | Operation::SetPause {
                metadata, program, ..
            }
            | Operation::Destroy { metadata, program }
            | Operation::Finalize { metadata, program }
            | Operation::SetApplicationAuthority {
                metadata, program, ..
            } => {
                writable(metadata)?;
                writable(program)?;
            }
            Operation::SetPin { target, .. } => writable(target)?,
            // Paired rotation (UNTO-3561): Core A also rewrites Core B's config
            // through a nested call to Core B, so both configs are writable.
            Operation::ProposeAdmin { .. } | Operation::AcceptAdmin => {
                writable(&self.config)?;
                writable(&hex::encode(
                    thru_base::bootstrap_addresses::CORE_PEER_CONFIG_BYTES,
                ))?;
            }
            Operation::Abi {
                abi_metadata,
                abi_content,
                ..
            } => {
                writable(abi_metadata)?;
                if let Some(content) = abi_content {
                    writable(content)?;
                }
            }
        }
        let eoa = self.eoa_admin.then_some(self.admin.as_str());
        let mut out = Vec::new();
        let tag = match &self.operation {
            Operation::Create { proof_slot, .. } => {
                if proof_slot.is_some() {
                    0
                } else {
                    1
                }
            }
            Operation::Upgrade { .. } => 2,
            Operation::SetPause { .. } => 3,
            Operation::Destroy { .. } => 4,
            Operation::Finalize { .. } => 5,
            Operation::SetApplicationAuthority { .. } => 6,
            Operation::SetPin { .. } => 7,
            Operation::ProposeAdmin { .. } => 8,
            Operation::AcceptAdmin => 9,
            Operation::Abi { action, .. } => match action {
                AbiAction::CorrectRoot => 14,
                AbiAction::CreateMetaPermanent => 15,
                AbiAction::CreateMetaEphemeral => 16,
                AbiAction::CreateContentPermanent => 17,
                AbiAction::CreateContentEphemeral => 18,
                AbiAction::Upgrade => 19,
                AbiAction::Close => 20,
                AbiAction::Finalize => 21,
            },
        };
        out.push(tag);
        self.bound(&self.config, None, &mut out)?;
        self.bound(&self.admin, eoa, &mut out)?;
        match &self.operation {
            Operation::Create {
                metadata,
                program,
                seed,
                image,
                application_authority,
                pin,
                proof_slot,
            } => {
                self.pair(metadata, program, &mut out)?;
                let seed = hex32(seed)?;
                if &seed[..8] == b"coreprf1" {
                    return Err(invalid("managed seed uses reserved proof namespace"));
                }
                out.extend(seed);
                image.validate(true)?;
                image.encode(self, &mut out)?;
                out.extend(key(application_authority)?);
                out.push(u8::from(*pin));
                if let Some(slot) = proof_slot {
                    if key(&slot.metadata)? != key(metadata)?
                        || key(&slot.program)? != key(program)?
                    {
                        return Err(invalid("proof target mismatch"));
                    }
                    self.bound(&slot.address, None, &mut out)?;
                    let seed = hex32(&slot.seed)?;
                    if &seed[..8] != b"coreprf1" {
                        return Err(invalid("invalid proof slot seed"));
                    }
                    out.extend(seed);
                }
            }
            Operation::Upgrade {
                metadata,
                program,
                image,
            } => {
                self.pair(metadata, program, &mut out)?;
                image.validate(true)?;
                image.encode(self, &mut out)?;
            }
            Operation::SetPause {
                metadata,
                program,
                paused,
            } => {
                self.pair(metadata, program, &mut out)?;
                out.push(u8::from(*paused));
            }
            Operation::Destroy { metadata, program }
            | Operation::Finalize { metadata, program } => {
                self.pair(metadata, program, &mut out)?
            }
            Operation::SetApplicationAuthority {
                metadata,
                program,
                authority,
            } => {
                self.pair(metadata, program, &mut out)?;
                out.extend(key(authority)?);
            }
            Operation::SetPin { target, pin } => {
                self.bound(target, None, &mut out)?;
                out.push(u8::from(*pin));
            }
            Operation::ProposeAdmin { candidate, kind } => {
                if ![1, 2].contains(kind) {
                    return Err(invalid("admin kind must be EOA=1 or Multisig=2"));
                }
                self.bound(candidate, None, &mut out)?;
                out.push(*kind);
                self.peer_binding(&mut out)?;
            }
            Operation::AcceptAdmin => self.peer_binding(&mut out)?,
            Operation::Abi {
                action,
                subject,
                program_metadata,
                abi_metadata,
                abi_content,
                image,
                creation_proof,
            } => {
                let root = matches!(action, AbiAction::CorrectRoot);
                let create_meta = matches!(
                    action,
                    AbiAction::CreateMetaPermanent | AbiAction::CreateMetaEphemeral
                );
                let needs_image = matches!(
                    action,
                    AbiAction::CreateContentPermanent
                        | AbiAction::CreateContentEphemeral
                        | AbiAction::Upgrade
                        | AbiAction::CorrectRoot
                );
                if root != program_metadata.is_none()
                    || needs_image != image.is_some()
                    || create_meta == abi_content.is_some()
                {
                    return Err(invalid("invalid governed ABI operands"));
                }
                if root != (key(subject)? == CORE_MANAGER_PROGRAM_BYTES) {
                    return Err(invalid(
                        "fixed-root ABI permits only the separate correction operation",
                    ));
                }
                self.bound(subject, None, &mut out)?;
                self.optional_bound(program_metadata.as_deref(), &mut out)?;
                self.bound(abi_metadata, None, &mut out)?;
                self.optional_bound(abi_content.as_deref(), &mut out)?;
                if let Some(image) = image {
                    image.validate(false)?;
                    image.encode(self, &mut out)?;
                } else {
                    out.extend([0; 74]);
                }
                let permanent = matches!(
                    action,
                    AbiAction::CreateMetaPermanent | AbiAction::CreateContentPermanent
                );
                if permanent != creation_proof.is_some() {
                    return Err(invalid(
                        "permanent ABI create requires one creation proof; other operations forbid it",
                    ));
                }
                if let Some(proof) = creation_proof {
                    let proof = hex::decode(proof).map_err(|e| invalid(e.to_string()))?;
                    validate_creation_proof(&proof)?;
                    out.extend(proof);
                }
            }
        }
        if !self.eoa_admin && out.len() > 4096 {
            return Err(invalid("child exceeds Multisig request capacity"));
        }
        Ok(out)
    }
    fn pair(&self, meta: &str, program: &str, out: &mut Vec<u8>) -> Result<(), CliError> {
        self.bound(meta, None, out)?;
        self.bound(program, None, out)
    }
    fn optional_bound(&self, address: Option<&str>, out: &mut Vec<u8>) -> Result<(), CliError> {
        if let Some(a) = address {
            self.bound(a, None, out)
        } else {
            out.extend([0; 34]);
            Ok(())
        }
    }
}
impl Plan {
    fn execution_call(&self, request: Option<&str>) -> Result<(u16, Vec<u8>), CliError> {
        match (self.input.eoa_admin, request) {
            (true, None) => Ok((
                self.input.index(&self.input.target_program, None)?,
                hex::decode(&self.instruction).map_err(|e| invalid(e.to_string()))?,
            )),
            (false, Some(request)) => {
                let mut bytes = 3u32.to_le_bytes().to_vec();
                bytes.extend(self.input.index(&self.input.admin, None)?.to_le_bytes());
                bytes.extend(self.input.index(request, None)?.to_le_bytes());
                Ok((
                    self.input.index(
                        &hex::encode(thru_base::bootstrap_addresses::MULTISIG_PROGRAM_BYTES),
                        None,
                    )?,
                    bytes,
                ))
            }
            _ => Err(invalid(
                "execution request must match the approved admin kind",
            )),
        }
    }
    fn execution_mode(&self) -> Result<&'static str, CliError> {
        if self.input.uses_multicall()? {
            Ok("multicall-atomic")
        } else if matches!(
            &self.input.operation,
            Operation::Create {
                proof_slot: Some(_),
                ..
            }
        ) {
            Ok("standalone-proof-refresh-then-direct")
        } else {
            Ok("direct")
        }
    }
    pub fn new(input: PlanInput) -> Result<Self, CliError> {
        let instruction = hex::encode(input.encode()?);
        let reviewed_state_sha256 = json_digest(&input.reviewed_state);
        let plan_sha256 = json_digest(&json!({"input":input,"instruction":instruction}));
        let plan = Self {
            input,
            instruction,
            plan_sha256,
            reviewed_state_sha256,
        };
        if !plan.input.eoa_admin {
            plan.invoke()?;
        }
        // Reserve maximum proofs before approval. Direct creation refreshes in
        // its own three-account Core transaction; only wrapped execution carries
        // the two creation proofs alongside the approved child.
        let proof_bytes = if matches!(
            &plan.input.operation,
            Operation::Create {
                proof_slot: Some(_),
                ..
            }
        ) && plan.input.uses_multicall()?
        {
            2 * 8296 + 75
        } else {
            0
        };
        let account_bytes =
            32 * (plan.input.accounts.read_write.len() + plan.input.accounts.read_only.len() + 2);
        if 256 + account_bytes + plan.instruction.len() / 2 + proof_bytes + 8296 > 32768 {
            return Err(invalid("plan cannot fit MTU with maximum proof suffixes"));
        }
        Ok(plan)
    }
    pub fn validate(&self) -> Result<(), CliError> {
        let rebuilt = Self::new(self.input.clone())?;
        if self.instruction != rebuilt.instruction
            || self.plan_sha256 != rebuilt.plan_sha256
            || self.reviewed_state_sha256 != rebuilt.reviewed_state_sha256
        {
            return Err(invalid("reviewed plan or child bytes changed"));
        }
        self.validate_reviewed_state()
    }
    pub fn invoke(&self) -> Result<Vec<u8>, CliError> {
        let a = &self.input.accounts;
        let child = hex::decode(&self.instruction).map_err(|e| invalid(e.to_string()))?;
        let refs: Vec<_> = std::iter::once(&self.input.wrapper)
            .chain(&a.read_write)
            .chain(&a.read_only)
            .collect();
        let mut out = Vec::new();
        out.extend(
            self.input
                .index(&self.input.target_program, None)?
                .to_le_bytes(),
        );
        out.extend((refs.len() as u16).to_le_bytes());
        out.extend((child.len() as u64).to_le_bytes());
        out.extend(key(&self.input.target_program)?);
        for i in 0..refs.len() {
            out.extend(((i + 1) as u16).to_le_bytes());
        }
        for address in refs {
            out.extend(key(address)?);
        }
        out.extend(child);
        if out.len() > 4096 {
            return Err(invalid(
                "invoke references and child exceed 4096-byte request limit",
            ));
        }
        Ok(out)
    }
    /// Bind the reviewed off-chain update to this operation, not to RPC observations.
    pub fn validate_reviewed_state(&self) -> Result<(), CliError> {
        let reviewed = &self.input.reviewed_state;
        hex32(
            reviewed["genesis_inventory_sha256"]
                .as_str()
                .ok_or_else(|| invalid("missing genesis inventory provenance"))?,
        )?;
        let changes = reviewed["changes"]
            .as_array()
            .ok_or_else(|| invalid("missing reviewed changes"))?;
        match &self.input.operation {
            Operation::ProposeAdmin { .. } | Operation::AcceptAdmin => {
                if !changes.is_empty() {
                    return Err(invalid(
                        "admin rotation cannot approve program artifact changes",
                    ));
                }
                let before = &reviewed["roles"]["before"];
                let after = &reviewed["roles"]["after"];
                if !before.is_object() || !after.is_object() {
                    return Err(invalid("rotation requires reviewed roles before/after"));
                }
                // Core A and Core B rotate in one instruction (UNTO-3561):
                // their reviewed roles move in lockstep.
                if before["core_peer"] != before["core"] {
                    return Err(invalid("reviewed Core B roles differ from Core A roles"));
                }
                let mut expected = before.clone();
                match &self.input.operation {
                    Operation::ProposeAdmin { candidate, kind } => {
                        if before["core"]["admin"] != hex::encode(key(&self.input.admin)?) {
                            return Err(invalid("reviewed current admin differs"));
                        }
                        expected["core"]["pending_kind"] =
                            json!(if *kind == 1 { "eoa" } else { "multisig" });
                        expected["core"]["pending_admin"] = json!(hex::encode(key(candidate)?));
                        if *kind == 2 {
                            let descriptors = after["multisigs"].as_object().ok_or_else(|| {
                                invalid("reviewed Multisig candidate requires a descriptor")
                            })?;
                            let candidate_hex = hex::encode(key(candidate)?);
                            let matching: Vec<_> = descriptors
                                .iter()
                                .filter(|(_, d)| d["address"] == candidate_hex)
                                .collect();
                            if matching.len() != 1 {
                                return Err(invalid(
                                    "candidate requires exactly one reviewed Multisig descriptor",
                                ));
                            }
                            let (name, descriptor) = matching[0];
                            validate_multisig_descriptor(descriptor)?;
                            if before["multisigs"].get(name).is_none() {
                                if expected["multisigs"].is_null() {
                                    expected["multisigs"] = json!({});
                                }
                                expected["multisigs"][name] = descriptor.clone();
                            }
                        }
                    }
                    _ => {
                        if before["core"]["pending_admin"] != hex::encode(key(&self.input.admin)?) {
                            return Err(invalid("reviewed pending admin differs"));
                        }
                        expected["core"]["admin"] = before["core"]["pending_admin"].clone();
                        expected["core"]["kind"] = before["core"]["pending_kind"].clone();
                        expected["core"]["pending_admin"] = json!("00".repeat(32));
                        expected["core"]["pending_kind"] = json!("none");
                    }
                }
                expected["core_peer"] = expected["core"].clone();
                if &expected != after {
                    return Err(invalid("reviewed role changes exceed approved rotation"));
                }
            }
            operation => {
                if reviewed.get("roles").is_some() {
                    return Err(invalid("non-rotation cannot change governance roles"));
                }
                if changes.len() != 1 {
                    return Err(invalid(
                        "operation requires exactly one reviewed canonical record change",
                    ));
                }
                let before = &changes[0]["before"];
                let after = &changes[0]["after"];
                if before["identity"] != after["identity"]
                    || changes[0]["identity"] != after["identity"]
                    || before["address"] != after["address"]
                    || before["owner"] != after["owner"]
                {
                    return Err(invalid("reviewed identity/owner cannot change"));
                }
                let subject = match operation {
                    Operation::Create { program, .. }
                    | Operation::Upgrade { program, .. }
                    | Operation::SetPause { program, .. }
                    | Operation::Destroy { program, .. }
                    | Operation::Finalize { program, .. }
                    | Operation::SetApplicationAuthority { program, .. } => Some(program),
                    Operation::Abi { subject, .. } => Some(subject),
                    _ => None,
                };
                if let Some(subject) = subject {
                    if after["address"] != hex::encode(key(subject)?) {
                        return Err(invalid("reviewed record is not the bound subject"));
                    }
                }
                match operation {
                    Operation::Create { metadata, .. }
                    | Operation::Upgrade { metadata, .. }
                    | Operation::SetPause { metadata, .. }
                    | Operation::Destroy { metadata, .. }
                    | Operation::Finalize { metadata, .. }
                    | Operation::SetApplicationAuthority { metadata, .. } => {
                        if after["metadata"]["address"] != hex::encode(key(metadata)?) {
                            return Err(invalid("reviewed metadata differs from bound metadata"));
                        }
                    }
                    Operation::Abi {
                        abi_metadata,
                        abi_content,
                        ..
                    } => {
                        if after["abi"]["metadata_address"] != hex::encode(key(abi_metadata)?) {
                            return Err(invalid("reviewed ABI metadata differs"));
                        }
                        if let Some(content) = abi_content {
                            if after["abi"]["content_address"] != hex::encode(key(content)?) {
                                return Err(invalid("reviewed ABI content differs"));
                            }
                        }
                    }
                    _ => {}
                }
                let image = match operation {
                    Operation::Create { image, .. } | Operation::Upgrade { image, .. } => {
                        Some((image, &after["executable"]))
                    }
                    Operation::Abi {
                        image: Some(image), ..
                    } => Some((image, &after["abi"]["artifact"])),
                    _ => None,
                };
                if let Some((image, artifact)) = image {
                    if artifact["sha256"] != image.sha256
                        || artifact["size"] != image.length
                        || artifact["path"] != json!(image.artifact)
                    {
                        return Err(invalid(
                            "reviewed artifact is not the exact approved source payload",
                        ));
                    }
                }
                match operation {
                    Operation::Create {
                        application_authority,
                        pin,
                        proof_slot,
                        ..
                    } => {
                        if after["metadata"]["version"] != "0"
                            || after["metadata"]["state"] != "open"
                            || after["metadata"]["candidate"] != "00".repeat(32)
                            || after["metadata"]["authority"]
                                != hex::encode(key(application_authority)?)
                        {
                            return Err(invalid(
                                "reviewed create metadata differs from approved initialization",
                            ));
                        }
                        let program_flags = after["flags"]
                            .as_u64()
                            .ok_or_else(|| invalid("missing created program flags"))?;
                        let metadata_flags = after["metadata"]["flags"]
                            .as_u64()
                            .ok_or_else(|| invalid("missing created metadata flags"))?;
                        let pin_flags = if *pin { 4 } else { 0 };
                        if program_flags
                            != (created_flags(&before["flags"], proof_slot.is_none())?
                                | pin_flags
                                | 1)
                            || metadata_flags
                                != (created_flags(
                                    &before["metadata"]["flags"],
                                    proof_slot.is_none(),
                                )? | pin_flags)
                        {
                            return Err(invalid(
                                "reviewed create flags differ from approved executable/ephemeral/pin policy",
                            ));
                        }
                    }
                    Operation::Upgrade { .. } => {
                        let v = before["metadata"]["version"]
                            .as_str()
                            .and_then(|v| v.parse::<u64>().ok())
                            .and_then(|v| v.checked_add(1))
                            .ok_or_else(|| invalid("invalid previous program version"))?;
                        if after["metadata"]["version"] != v.to_string() {
                            return Err(invalid(
                                "upgrade must advance exactly one program version",
                            ));
                        }
                    }
                    Operation::SetPause { paused, .. } => {
                        if after["metadata"]["state"] != if *paused { "paused" } else { "open" } {
                            return Err(invalid("reviewed pause state differs"));
                        }
                        let old = before["flags"]
                            .as_u64()
                            .ok_or_else(|| invalid("missing previous program flags"))?;
                        let expected = if *paused { old & !1 } else { old | 1 };
                        if after["flags"] != expected {
                            return Err(invalid("SetPause changes only the PROGRAM flag"));
                        }
                    }
                    Operation::Destroy { .. } => {
                        if after["metadata"]["state"] != "destroyed" {
                            return Err(invalid("reviewed destroy state differs"));
                        }
                        if after["executable"]["size"] != 0
                            || after["executable"]["sha256"] != digest(&[])
                        {
                            return Err(invalid(
                                "reviewed destroy requires the canonical empty executable commitment",
                            ));
                        }
                        for (path, program) in [("/flags", true), ("/metadata/flags", false)] {
                            let old = before
                                .pointer(path)
                                .and_then(Value::as_u64)
                                .ok_or_else(|| invalid("missing previous destroy flags"))?;
                            if old > 255 || old & (16 | 64) != 0 || !program && old & 1 != 0 {
                                return Err(invalid(
                                    "reviewed deletion requires live uncompressed flags of the correct kind",
                                ));
                            }
                            let expected = (old & !128) | if old & (8 | 32) != 0 { 16 } else { 0 };
                            let expected = if program { expected & !1 } else { expected };
                            if after.pointer(path) != Some(&json!(expected)) {
                                return Err(invalid(
                                    "reviewed destroy flags differ from runtime deletion class",
                                ));
                            }
                        }
                    }
                    Operation::Finalize { .. } => {
                        if after["metadata"]["state"] != "finalized" {
                            return Err(invalid("reviewed finalize state differs"));
                        }
                    }
                    Operation::SetApplicationAuthority { authority, .. } => {
                        if after["metadata"]["authority"] != hex::encode(key(authority)?) {
                            return Err(invalid("reviewed application authority differs"));
                        }
                    }
                    Operation::SetPin { target, pin } => {
                        let field = if after["address"] == hex::encode(key(target)?) {
                            &after["flags"]
                        } else if after["metadata"]["address"] == hex::encode(key(target)?) {
                            &after["metadata"]["flags"]
                        } else {
                            return Err(invalid("reviewed pin target differs"));
                        };
                        let flags = field
                            .as_u64()
                            .ok_or_else(|| invalid("invalid reviewed flags"))?;
                        if (flags & 4 != 0) != *pin {
                            return Err(invalid("reviewed pin bit differs"));
                        }
                    }
                    Operation::Abi { action, .. } => match action {
                        AbiAction::Upgrade | AbiAction::CorrectRoot => {
                            let v = before["abi"]["revision"]
                                .as_str()
                                .and_then(|v| v.parse::<u64>().ok())
                                .and_then(|v| v.checked_add(1))
                                .ok_or_else(|| invalid("invalid previous ABI revision"))?;
                            if after["abi"]["revision"] != v.to_string() {
                                return Err(invalid(
                                    "ABI upgrade must advance exactly one revision",
                                ));
                            }
                        }
                        AbiAction::Close => {
                            if after["abi"]["state"] != "closed" {
                                return Err(invalid("reviewed ABI close state differs"));
                            }
                            let old = before["abi"]["content_flags"]
                                .as_u64()
                                .filter(|flags| *flags <= 255 && flags & (1 | 16 | 64) == 0)
                                .ok_or_else(|| invalid("invalid reviewed ABI close flags"))?;
                            let expected = (old & !128) | if old & (8 | 32) != 0 { 16 } else { 0 };
                            if after["abi"]["content_flags"] != expected {
                                return Err(invalid(
                                    "reviewed ABI close flags differ from runtime deletion class",
                                ));
                            }
                        }
                        AbiAction::Finalize => {
                            if after["abi"]["state"] != "finalized" {
                                return Err(invalid("reviewed ABI finalize state differs"));
                            }
                        }
                        AbiAction::CreateMetaPermanent | AbiAction::CreateMetaEphemeral => {
                            let ephemeral = matches!(action, AbiAction::CreateMetaEphemeral);
                            if after["abi"]["metadata_flags"]
                                != created_flags(&before["abi"]["metadata_flags"], ephemeral)?
                            {
                                return Err(invalid("reviewed created ABI metadata flags differ"));
                            }
                        }
                        AbiAction::CreateContentPermanent | AbiAction::CreateContentEphemeral => {
                            let ephemeral = matches!(action, AbiAction::CreateContentEphemeral);
                            if after["abi"]["content_flags"]
                                != created_flags(&before["abi"]["content_flags"], ephemeral)?
                            {
                                return Err(invalid("reviewed created ABI content flags differ"));
                            }
                        }
                    },
                    _ => {}
                }
                let allowed: &[&str] = match operation {
                    Operation::Create { .. } => &[
                        "/executable/path",
                        "/executable/size",
                        "/executable/sha256",
                        "/metadata/version",
                        "/metadata/state",
                        "/metadata/authority",
                        "/metadata/candidate",
                        "/metadata/flags",
                        "/flags",
                    ],
                    Operation::Upgrade { .. } => &[
                        "/executable/path",
                        "/executable/size",
                        "/executable/sha256",
                        "/metadata/version",
                    ],
                    Operation::SetPause { .. } => &["/metadata/state", "/flags"],
                    Operation::Destroy { .. } => &[
                        "/metadata/state",
                        "/metadata/flags",
                        "/flags",
                        "/executable/size",
                        "/executable/sha256",
                    ],
                    Operation::Finalize { .. } => &["/metadata/state"],
                    Operation::SetApplicationAuthority { .. } => &["/metadata/authority"],
                    Operation::SetPin { target, .. } => {
                        if after["address"] == hex::encode(key(target)?) {
                            &["/flags"]
                        } else {
                            &["/metadata/flags"]
                        }
                    }
                    Operation::Abi {
                        action: AbiAction::Upgrade | AbiAction::CorrectRoot,
                        ..
                    } => &[
                        "/abi/artifact/path",
                        "/abi/artifact/size",
                        "/abi/artifact/sha256",
                        "/abi/revision",
                    ],
                    Operation::Abi {
                        action: AbiAction::Close,
                        ..
                    } => &["/abi/state", "/abi/content_flags"],
                    Operation::Abi {
                        action: AbiAction::Finalize,
                        ..
                    } => &["/abi/state"],
                    Operation::Abi { .. } => &["/abi"],
                    _ => &[],
                };
                let mut differences = Vec::new();
                changed_fields(before, after, "", &mut differences);
                if differences.iter().any(|path| {
                    !allowed.iter().any(|allowed| {
                        path.as_str() == *allowed || path.starts_with(&format!("{allowed}/"))
                    })
                }) {
                    return Err(invalid(
                        "reviewed manifest changes exceed the approved operation",
                    ));
                }
                if let Operation::SetPin { .. } = operation {
                    let path = allowed[0];
                    let old = before
                        .pointer(path)
                        .and_then(Value::as_u64)
                        .ok_or_else(|| invalid("missing prior flags"))?;
                    let new = after
                        .pointer(path)
                        .and_then(Value::as_u64)
                        .ok_or_else(|| invalid("missing reviewed flags"))?;
                    if old & !4 != new & !4 {
                        return Err(invalid("SetPin cannot change unrelated flags"));
                    }
                }
            }
        }
        Ok(())
    }
}

fn changed_fields(before: &Value, after: &Value, path: &str, out: &mut Vec<String>) {
    if before == after {
        return;
    }
    if let (Some(left), Some(right)) = (before.as_object(), after.as_object()) {
        let keys: BTreeSet<_> = left.keys().chain(right.keys()).collect();
        for key in keys {
            changed_fields(
                left.get(key).unwrap_or(&Value::Null),
                right.get(key).unwrap_or(&Value::Null),
                &format!("{path}/{key}"),
                out,
            );
        }
    } else {
        out.push(path.to_string());
    }
}

#[derive(Subcommand)]
pub enum GovernanceCommands {
    /// Build an offline bound plan from typed JSON; includes reviewed expected-state changes.
    Plan {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        reviewed_state_output: PathBuf,
    },
    /// Decode config, metadata, initialized Multisig state or request from RPC.
    Inspect {
        account: String,
        #[arg(long, value_enum)]
        kind: InspectKind,
    },
    /// Create an invoke request containing exactly the reviewed child and fixed slots.
    Propose {
        #[arg(long)]
        plan: PathBuf,
        #[arg(long)]
        multisig: String,
        #[arg(long)]
        request: String,
        #[arg(long)]
        seed: String,
        #[arg(long)]
        multisig_program: String,
        #[arg(long, default_value = "default")]
        signer: String,
    },
    /// Approve only after comparing the on-chain request with the reviewed plan.
    Approve {
        #[arg(long)]
        plan: PathBuf,
        #[arg(long)]
        multisig: String,
        #[arg(long)]
        request: String,
        #[arg(long)]
        multisig_program: String,
        #[arg(long, default_value = "default")]
        signer: String,
    },
    /// Execute an EOA operation or approved Multisig request; refresh creation proofs atomically.
    Execute {
        #[arg(long)]
        plan: PathBuf,
        #[arg(long)]
        multisig: Option<String>,
        #[arg(long)]
        request: Option<String>,
        #[arg(long)]
        multisig_program: Option<String>,
        #[arg(long, default_value = "default")]
        signer: String,
        #[arg(long)]
        receipt: PathBuf,
    },
}
#[derive(Clone, Copy, ValueEnum)]
pub enum InspectKind {
    Config,
    Metadata,
    Multisig,
    Request,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes(b[i..i + 2].try_into().expect("validated layout"))
}
fn u64_at(b: &[u8], i: usize) -> u64 {
    u64::from_le_bytes(b[i..i + 8].try_into().expect("validated layout"))
}
/* Account discriminators (byte 0) of the accounts decoded here. Core config
 * is tn_core_config_t: account_type, admin_kind, pending_admin_kind,
 * pending_present, reserved[4], admin, pending_admin (72 bytes). Managed
 * metadata is tn_manager_program_meta_t: account_type, authority, candidate,
 * version, state (74 bytes). The Multisig account and request header keep
 * their layout with account_type in byte 0. */
const CORE_ACCOUNT_TYPE_CONFIG_V1: u8 = 2;
const MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1: u8 = 1;
const MULTISIG_ACCOUNT_TYPE_MULTISIG_V1: u8 = 1;
const MULTISIG_ACCOUNT_TYPE_REQUEST_V1: u8 = 2;
pub fn decode_account(kind: InspectKind, b: &[u8]) -> Result<Value, CliError> {
    match kind {
        InspectKind::Config => {
            if b.len() != 72
                || b[0] != CORE_ACCOUNT_TYPE_CONFIG_V1
                || ![1, 2].contains(&b[1])
                || b[4..8] != [0; 4]
                || b[3] > 1
                || b[8..40] == [0; 32]
                || (b[3] == 0 && (b[2] != 0 || b[40..] != [0; 32]))
                || (b[3] == 1 && (![1, 2].contains(&b[2]) || b[40..] == [0; 32]))
            {
                return Err(invalid("invalid Core config"));
            }
            Ok(
                json!({"admin_kind":b[1],"admin":hex::encode(&b[8..40]),"pending_admin_kind":b[2],"pending_admin":hex::encode(&b[40..72]),"pending_present":b[3]==1}),
            )
        }
        InspectKind::Metadata => {
            if b.len() != 74 || b[0] != MANAGER_ACCOUNT_TYPE_PROGRAM_META_V1 || b[73] > 2 {
                return Err(invalid("invalid managed metadata"));
            }
            Ok(
                json!({"authority":hex::encode(&b[1..33]),"candidate":hex::encode(&b[33..65]),"version":u64_at(b,65).to_string(),"state":b[73]}),
            )
        }
        InspectKind::Multisig => {
            if b.len() != 1048 || b[0] != MULTISIG_ACCOUNT_TYPE_MULTISIG_V1 || b[1] != 0 {
                return Err(invalid("invalid Multisig state layout"));
            }
            let n = u16_at(b, 2) as usize;
            let threshold = u16_at(b, 4);
            if n < 2
                || n > 32
                || threshold == 0
                || threshold as usize > n
                || u16_at(b, 6) as u64 > u64_at(b, 16)
                || u64_at(b, 8) > u64_at(b, 16)
                || b[24 + n * 32..].iter().any(|v| *v != 0)
            {
                return Err(invalid("invalid Multisig state invariants"));
            }
            let mut members = BTreeSet::new();
            let mut ordered = Vec::new();
            for m in b[24..24 + n * 32].chunks_exact(32) {
                if m == [0; 32] || !members.insert(m) {
                    return Err(invalid("invalid or duplicate Multisig member"));
                }
                ordered.push(hex::encode(m));
            }
            if b[24..24 + n * 32]
                .chunks_exact(32)
                .zip(b[56..24 + n * 32].chunks_exact(32))
                .any(|(left, right)| left >= right)
            {
                return Err(invalid("Multisig members must be strictly sorted"));
            }
            Ok(
                json!({"members":ordered,"threshold":threshold,"live_requests":u16_at(b,6),"epoch":u64_at(b,8).to_string(),"next_request_id":u64_at(b,16).to_string()}),
            )
        }
        InspectKind::Request => {
            if b.len() < 104
                || b[0] != MULTISIG_ACCOUNT_TYPE_REQUEST_V1
                || b[1] > 3
                || b[2] != 0
                || b[3] != 0
                || u64_at(b, 32) > 4096
                || b.len() != 104 + u64_at(b, 32) as usize
            {
                return Err(invalid("invalid Multisig request"));
            }
            let n = u16_at(b, 4);
            let required = u16_at(b, 6);
            let approvals = u64_at(b, 24);
            if n == 0 || n > 32 || required == 0 || required > n || approvals >> n != 0 {
                return Err(invalid("invalid request approval snapshot"));
            }
            Ok(
                json!({"kind":b[1],"member_count":n,"required_approvals":required,"request_id":u64_at(b,8).to_string(),"epoch":u64_at(b,16).to_string(),"approval_bitmap":approvals.to_string(),"multisig":hex::encode(&b[40..72]),"proposer":hex::encode(&b[72..104]),"data":hex::encode(&b[104..])}),
            )
        }
    }
}
async fn account_bytes_owned(
    client: &thru_client::Client,
    address: &str,
    owner: Option<[u8; 32]>,
) -> Result<Vec<u8>, CliError> {
    let address = Pubkey::from_bytes(&key(address)?);
    let account = client
        .get_account_info(&address, None, Some(thru_client::VersionContext::Current))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .ok_or_else(|| invalid("account not found"))?;
    if account.flags & (1 | 16 | 64) != 0 {
        return Err(invalid(
            "expected live uncompressed non-executable state account",
        ));
    }
    if let Some(owner) = owner {
        if account
            .owner
            .to_bytes()
            .map_err(|e| invalid(e.to_string()))?
            != owner
        {
            return Err(invalid("unexpected state account owner"));
        }
    }
    base64::engine::general_purpose::STANDARD
        .decode(
            account
                .data
                .ok_or_else(|| invalid("account data unavailable"))?,
        )
        .map_err(|e| invalid(e.to_string()))
}
fn multicall(calls: &[(u16, Vec<u8>)]) -> Result<Vec<u8>, CliError> {
    let mut out = Vec::new();
    out.extend((calls.len() as u16).to_le_bytes());
    for (index, bytes) in calls {
        out.extend(index.to_le_bytes());
        out.extend((bytes.len() as u64).to_le_bytes());
        out.extend(bytes);
    }
    if out.len() > 32768 {
        return Err(invalid("multicall exceeds transaction MTU"));
    }
    Ok(out)
}
fn validate_creation_proof(proof: &[u8]) -> Result<(), CliError> {
    if proof.len() < 104 || proof.len() > 8296 || u64_at(proof, 0) >> 62 != 2 {
        return Err(invalid("invalid creation proof type or footprint"));
    }
    let siblings: usize = proof[8..40].iter().map(|b| b.count_ones() as usize).sum();
    if proof.len() != 104 + siblings * 32 {
        return Err(invalid("creation proof length mismatch"));
    }
    Ok(())
}
pub fn write_proof_slot(
    accounts: &Accounts,
    slot: &ProofSlot,
    metadata: &[u8],
    program: &[u8],
) -> Result<Vec<u8>, CliError> {
    validate_creation_proof(metadata)?;
    validate_creation_proof(program)?;
    let seed = hex32(&slot.seed)?;
    if &seed[..8] != b"coreprf1" {
        return Err(invalid("invalid proof namespace"));
    }
    let mut out = vec![10];
    accounts.bound(&slot.address, None, &mut out)?;
    out.extend(seed);
    out.extend((metadata.len() as u32).to_le_bytes());
    out.extend((program.len() as u32).to_le_bytes());
    out.extend(metadata);
    out.extend(program);
    Ok(out)
}
fn standalone_proof_refresh(
    slot: &ProofSlot,
    metadata: &[u8],
    program: &[u8],
) -> Result<(Accounts, Vec<u8>), CliError> {
    let accounts = Accounts {
        read_write: vec![slot.address.clone()],
        read_only: vec![],
    };
    let bytes = write_proof_slot(&accounts, slot, metadata, program)?;
    Ok((accounts, bytes))
}
async fn proof(client: &thru_client::Client, address: &str) -> Result<Vec<u8>, CliError> {
    super::state_proof::make_state_proof(
        client,
        &Pubkey::from_bytes(&key(address)?),
        ProofType::Creating,
        None,
    )
    .await
}
async fn checked_request(
    client: &thru_client::Client,
    plan: &Plan,
    multisig: &str,
    request: &str,
    require_threshold: bool,
) -> Result<Vec<u8>, CliError> {
    if key(multisig)? != key(&plan.input.admin)? {
        return Err(invalid("request Multisig must be the bound admin"));
    }
    let owner = Some(thru_base::bootstrap_addresses::MULTISIG_PROGRAM_BYTES);
    let state = account_bytes_owned(client, multisig, owner).await?;
    decode_account(InspectKind::Multisig, &state)?;
    let bytes = account_bytes_owned(client, request, owner).await?;
    decode_account(InspectKind::Request, &bytes)?;
    if bytes[1] != 0
        || bytes[40..72] != key(multisig)?
        || bytes[104..] != plan.invoke()?
        || u64_at(&bytes, 16) != u64_at(&state, 8)
        || u16_at(&bytes, 4) != u16_at(&state, 2)
        || u16_at(&bytes, 6) != u16_at(&state, 4)
    {
        return Err(invalid(
            "request differs from reviewed operation or current membership epoch",
        ));
    }
    if require_threshold && u64_at(&bytes, 24).count_ones() < u16_at(&bytes, 6) as u32 {
        return Err(invalid("request has insufficient approvals"));
    }
    Ok(bytes)
}
async fn submit(
    config: &Config,
    plan: &Plan,
    signer: &str,
    calls: Vec<(u16, Vec<u8>)>,
) -> Result<String, CliError> {
    let signer_key = config.keys.public_key(signer)?;
    if plan.input.eoa_admin && key(&plan.input.admin)? != signer_key {
        return Err(invalid("EOA operation requires exact admin fee payer"));
    }
    let bytes = plan.input.transaction_instruction(calls)?;
    submit_transaction(
        config,
        &plan.input.wrapper,
        &plan.input.accounts,
        signer,
        &bytes,
    )
    .await
}

async fn submit_transaction(
    config: &Config,
    program: &str,
    accounts: &Accounts,
    signer: &str,
    bytes: &[u8],
) -> Result<String, CliError> {
    let signer_key = config.keys.public_key(signer)?;
    if signer_key == key(program)?
        || accounts
            .read_write
            .iter()
            .chain(&accounts.read_only)
            .any(|s| key(s).ok() == Some(signer_key))
    {
        return Err(invalid(
            "executor collides with fixed slots; approved indexes cannot be rewritten",
        ));
    }
    let transaction = super::txn::build_and_sign_transaction(
        config,
        program,
        bytes,
        Some(signer),
        100000,
        10_000_000,
        1000,
        1000,
        100,
        &accounts.read_write,
        &accounts.read_only,
    )
    .await?;
    let wire = transaction.to_wire();
    if wire.len() > 32768 {
        return Err(invalid(
            "signed transaction including proofs exceeds 32768-byte MTU",
        ));
    }
    let details = super::txn::create_rpc_client(config)?
        .execute_transaction(&wire, Duration::from_secs(config.timeout_seconds))
        .await
        .map_err(|e| invalid(e.to_string()))?;
    if details.execution_result != 0 || details.vm_error != 0 || details.user_error_code != 0 {
        return Err(invalid(format!(
            "governance transaction failed: execution={} vm={} user={}",
            details.execution_result, details.vm_error, details.user_error_code
        )));
    }
    Ok(details.signature.as_str().to_string())
}
pub async fn handle_governance_command(
    config: &Config,
    command: GovernanceCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match command {
        GovernanceCommands::Plan {
            input,
            output,
            reviewed_state_output,
        } => {
            let plan = Plan::new(read_json(&input)?)?;
            plan.validate()?;
            save_json(&output, &plan)?;
            save_json(&reviewed_state_output, &plan.input.reviewed_state)?;
            output::print_output(
                json!({"plan_sha256":plan.plan_sha256,"reviewed_state_sha256":plan.reviewed_state_sha256,"instruction":plan.instruction,"accounts":plan.input.accounts,"execution_mode":plan.execution_mode()?,"transaction_program":plan.input.wrapper}),
                json_format,
            );
        }
        GovernanceCommands::Inspect { account, kind } => {
            use thru_base::bootstrap_addresses::{
                CORE_CONFIG_BYTES, CORE_MANAGER_PROGRAM_BYTES, MULTISIG_PROGRAM_BYTES,
            };
            if matches!(kind, InspectKind::Config) && key(&account)? != CORE_CONFIG_BYTES {
                return Err(invalid("expected canonical Core config address"));
            }
            let owner = match kind {
                InspectKind::Config | InspectKind::Metadata => CORE_MANAGER_PROGRAM_BYTES,
                InspectKind::Multisig | InspectKind::Request => MULTISIG_PROGRAM_BYTES,
            };
            let client = super::txn::create_rpc_client(config)?;
            let bytes = account_bytes_owned(&client, &account, Some(owner)).await?;
            let mut decoded = decode_account(kind, &bytes)?;
            if matches!(kind, InspectKind::Config) {
                let admin = decoded["admin"]
                    .as_str()
                    .ok_or_else(|| invalid("missing admin"))?;
                let info = client
                    .get_account_info(&Pubkey::from_bytes(&key(admin)?), None, None)
                    .await
                    .map_err(|e| invalid(e.to_string()))?
                    .ok_or_else(|| invalid("admin missing"))?;
                decoded["protected_owner"] = json!(hex::encode(
                    info.owner.to_bytes().map_err(|e| invalid(e.to_string()))?
                ));
            }
            output::print_output(decoded, json_format);
        }
        GovernanceCommands::Propose {
            plan,
            multisig,
            request,
            seed,
            multisig_program,
            signer,
        } => {
            let plan: Plan = read_json(&plan)?;
            plan.validate()?;
            if plan.input.eoa_admin {
                return Err(invalid("EOA plans cannot be proposed through Multisig"));
            }
            if key(&multisig)? != key(&plan.input.admin)? {
                return Err(invalid("proposal must use the bound admin"));
            }
            canonical_multisig(&multisig_program)?;
            let client = super::txn::create_rpc_client(config)?;
            let state = account_bytes_owned(
                &client,
                &multisig,
                Some(thru_base::bootstrap_addresses::MULTISIG_PROGRAM_BYTES),
            )
            .await?;
            decode_account(InspectKind::Multisig, &state)?;
            let signer_key = config.keys.public_key(&signer)?;
            if u16_at(&state, 6) == u16::MAX
                || !state[24..24 + u16_at(&state, 2) as usize * 32]
                    .chunks_exact(32)
                    .any(|m| m == signer_key)
            {
                return Err(invalid("proposer is not a member or request limit reached"));
            }
            let payload = plan.invoke()?;
            let proof = proof(&client, &request).await?;
            validate_creation_proof(&proof)?;
            let a = &plan.input;
            let mut bytes = 1u32.to_le_bytes().to_vec();
            bytes.extend(a.index(&multisig, None)?.to_le_bytes());
            bytes.extend(a.index(&request, None)?.to_le_bytes());
            bytes.extend(0u16.to_le_bytes());
            bytes.extend([0, 0]);
            bytes.extend(hex32(&seed)?);
            bytes.extend((payload.len() as u64).to_le_bytes());
            bytes.extend((proof.len() as u64).to_le_bytes());
            bytes.extend(payload);
            bytes.extend(proof);
            let signature = submit(
                config,
                &plan,
                &signer,
                vec![(a.index(&multisig_program, None)?, bytes)],
            )
            .await?;
            output::print_output(
                json!({"transaction_id":signature,"request":request,"plan_sha256":plan.plan_sha256}),
                json_format,
            );
        }
        GovernanceCommands::Approve {
            plan,
            multisig,
            request,
            multisig_program,
            signer,
        } => {
            canonical_multisig(&multisig_program)?;
            let plan: Plan = read_json(&plan)?;
            plan.validate()?;
            let client = super::txn::create_rpc_client(config)?;
            let reviewed = checked_request(&client, &plan, &multisig, &request, false).await?;
            let a = &plan.input;
            let mut bytes = 2u32.to_le_bytes().to_vec();
            bytes.extend(a.index(&multisig, None)?.to_le_bytes());
            bytes.extend(a.index(&request, None)?.to_le_bytes());
            bytes.extend(0u16.to_le_bytes());
            // Bind the approval to the request generation and contents just checked.
            bytes.extend(u64_at(&reviewed, 8).to_le_bytes());
            bytes.extend(crypto::calculate_sha256(&reviewed[104..]));
            let signature = submit(
                config,
                &plan,
                &signer,
                vec![(a.index(&multisig_program, None)?, bytes)],
            )
            .await?;
            output::print_output(
                json!({"transaction_id":signature,"request":request}),
                json_format,
            );
        }
        GovernanceCommands::Execute {
            plan,
            multisig,
            request,
            multisig_program,
            signer,
            receipt,
        } => {
            let plan: Plan = read_json(&plan)?;
            plan.validate()?;
            let a = &plan.input;
            let client = super::txn::create_rpc_client(config)?;
            let mut calls = Vec::new();
            let mut standalone_refresh = None;
            if let Operation::Create {
                proof_slot: Some(slot),
                ..
            } = &plan.input.operation
            {
                let meta = proof(&client, &slot.metadata).await?;
                let program = proof(&client, &slot.program).await?;
                if plan.input.uses_multicall()? {
                    calls.push((
                        a.index(&plan.input.target_program, None)?,
                        write_proof_slot(&a.accounts, slot, &meta, &program)?,
                    ));
                } else {
                    // Multicall may itself be absent or paused. Refresh permissionlessly
                    // in a separate Core transaction, then consume its confirmed proofs.
                    // Unlike the wrapped path this does not promise an atomic refresh.
                    standalone_refresh = Some(standalone_proof_refresh(slot, &meta, &program)?);
                }
            }
            match (multisig, request, multisig_program) {
                (Some(multisig), Some(request), Some(program)) => {
                    canonical_multisig(&program)?;
                    if plan.input.eoa_admin {
                        return Err(invalid("EOA plan cannot execute through Multisig"));
                    }
                    checked_request(&client, &plan, &multisig, &request, true).await?;
                    calls.push(plan.execution_call(Some(&request))?);
                }
                (None, None, None) => {
                    if !plan.input.eoa_admin {
                        return Err(invalid(
                            "Multisig plan requires multisig, request and multisig-program",
                        ));
                    }
                    calls.push(plan.execution_call(None)?);
                }
                _ => {
                    return Err(invalid(
                        "supply all or none of multisig, request and multisig-program",
                    ));
                }
            }
            reviewed_state::verify(&client, &plan, true).await?;
            verify_reviewed_candidate(&client, &plan).await?;
            let proof_refresh_transaction_id = if let Some((accounts, bytes)) = standalone_refresh {
                Some(
                    submit_transaction(
                        config,
                        &hex::encode(thru_base::bootstrap_addresses::CORE_MANAGER_PROGRAM_BYTES),
                        &accounts,
                        &signer,
                        &bytes,
                    )
                    .await?,
                )
            } else {
                None
            };
            // A standalone proof refresh is not the reviewed program transition.
            // Recheck after it, immediately before the actual execution submission.
            if proof_refresh_transaction_id.is_some() {
                reviewed_state::verify(&client, &plan, true).await?;
                verify_reviewed_candidate(&client, &plan).await?;
            }
            let signature = submit(config, &plan, &signer, calls).await?;
            let post_state = async {
                reviewed_state::verify(&client, &plan, false).await?;
                verify_reviewed_candidate(&client, &plan).await
            }
            .await;
            post_state.map_err(|error| {
                invalid(format!(
                    "transaction {signature} executed, but reviewed after-state verification failed; no successful receipt written: {error}"
                ))
            })?;
            let result = json!({"plan_sha256":plan.reviewed_state_sha256,"success":true,"transaction_id":signature,"proof_refresh_transaction_id":proof_refresh_transaction_id});
            save_json(&receipt, &result).map_err(|error| {
                invalid(format!(
                    "transaction {signature} executed, but receipt could not be written: {error}"
                ))
            })?;
            output::print_output(result, json_format);
        }
    }
    Ok(())
}

fn canonical_multisig(address: &str) -> Result<(), CliError> {
    if key(address)? != thru_base::bootstrap_addresses::MULTISIG_PROGRAM_BYTES {
        return Err(invalid("expected canonical Multisig executable"));
    }
    Ok(())
}

fn validate_multisig_descriptor(descriptor: &Value) -> Result<(), CliError> {
    hex32(
        descriptor["address"]
            .as_str()
            .ok_or_else(|| invalid("missing candidate address"))?,
    )?;
    let members = descriptor["members"]
        .as_array()
        .ok_or_else(|| invalid("missing reviewed members"))?;
    let threshold = descriptor["threshold"]
        .as_u64()
        .ok_or_else(|| invalid("missing reviewed threshold"))?;
    let flags = descriptor["flags"]
        .as_u64()
        .ok_or_else(|| invalid("missing reviewed state flags"))?;
    if members.len() < 2
        || members.len() > 32
        || threshold == 0
        || threshold > members.len() as u64
        || (flags != 0 && flags != u64::from(TN_ACCOUNT_FLAG_UNCOMPRESSABLE))
    {
        return Err(invalid("invalid reviewed Multisig descriptor"));
    }
    let mut previous = None;
    for member in members {
        let member = hex32(
            member
                .as_str()
                .ok_or_else(|| invalid("invalid reviewed member"))?,
        )?;
        if member == [0; 32] || previous.is_some_and(|p| p >= member) {
            return Err(invalid("reviewed members must be nonzero and sorted"));
        }
        previous = Some(member);
    }
    Ok(())
}
async fn verify_reviewed_candidate(
    client: &thru_client::Client,
    plan: &Plan,
) -> Result<(), CliError> {
    let candidate = match &plan.input.operation {
        Operation::ProposeAdmin { candidate, kind: 2 } => candidate,
        Operation::AcceptAdmin if !plan.input.eoa_admin => &plan.input.admin,
        _ => return Ok(()),
    };
    let candidate_hex = hex::encode(key(candidate)?);
    let descriptors = plan.input.reviewed_state["roles"]["after"]["multisigs"]
        .as_object()
        .ok_or_else(|| invalid("missing reviewed Multisig descriptors"))?;
    let descriptor = descriptors
        .values()
        .find(|d| d["address"] == candidate_hex)
        .ok_or_else(|| invalid("missing reviewed candidate descriptor"))?;
    validate_multisig_descriptor(descriptor)?;
    let account = client
        .get_account_info(
            &Pubkey::from_bytes(&key(candidate)?),
            None,
            Some(thru_client::VersionContext::Current),
        )
        .await
        .map_err(|e| invalid(e.to_string()))?
        .ok_or_else(|| invalid("candidate state missing"))?;
    verify_candidate_account(descriptor, &account)
}

fn verify_candidate_account(
    descriptor: &Value,
    account: &thru_client::Account,
) -> Result<(), CliError> {
    if account
        .owner
        .to_bytes()
        .map_err(|e| invalid(e.to_string()))?
        != thru_base::bootstrap_addresses::MULTISIG_PROGRAM_BYTES
        // NEW is transient live state, never part of the reviewed durable flags.
        || descriptor["flags"] != (account.flags & !TN_ACCOUNT_FLAG_NEW)
    {
        return Err(invalid(
            "candidate owner/flags differ from reviewed descriptor",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            account
                .data
                .as_deref()
                .ok_or_else(|| invalid("candidate state data missing"))?,
        )
        .map_err(|e| invalid(e.to_string()))?;
    let state = decode_account(InspectKind::Multisig, &bytes)?;
    if state["members"] != descriptor["members"] || state["threshold"] != descriptor["threshold"] {
        return Err(invalid(
            "candidate membership/threshold differ from reviewed descriptor",
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "governance_tests.rs"]
mod tests;
