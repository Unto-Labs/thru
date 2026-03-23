//! DWARF-powered error report for DebugReExecute responses.
//!
//! Takes a program .elf (built with -g) and either a DebugReExecuteResponse JSON
//! file or a transaction signature (calls DebugReExecute via gRPC).
//! Resolves PCs to source locations and produces a rich error report.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use addr2line::gimli;
use colored::Colorize;
use object::{Object, ObjectSection};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use base64::Engine as _;

use crate::config::Config;
use crate::error::CliError;
use crate::output;

use super::variables;

// --- Trace parsing regexes ---

static TRACE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[(\d+)\]\[(\d+)\]\(([0-9a-fA-F]+)\)\s+([0-9a-fA-F]+):\s+([0-9a-fA-F]+)\s+(.*)")
        .unwrap()
});

static REG_DUMP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s{2,}\[\w+\(\d+\):.*$").unwrap());

const RISCV_REG_NAMES: [&str; 32] = [
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4",
    "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4",
    "t5", "t6",
];

// --- Public entry point ---

pub async fn handle_resolve(
    config: &Config,
    elf_path: &Path,
    response_path: Option<&Path>,
    signature: Option<&str>,
    trace_tail: usize,
    context_lines: u32,
    json_format: bool,
) -> Result<(), CliError> {
    let elf_data = std::fs::read(elf_path).map_err(|e| CliError::Generic {
        message: format!("failed to read ELF {}: {e}", elf_path.display()),
    })?;

    let resp = match (response_path, signature) {
        (Some(path), _) => {
            let text = std::fs::read_to_string(path).map_err(|e| CliError::Generic {
                message: format!("failed to read response {}: {e}", path.display()),
            })?;
            parse_response_json(&text)?
        }
        (_, Some(sig)) => fetch_via_grpc(config, sig).await?,
        _ => {
            return Err(CliError::Validation(
                "either --response or --signature must be provided".to_string(),
            ));
        }
    };

    let resolver = DwarfResolver::new(&elf_data)?;
    let report = build_report(&resolver, &resp, trace_tail, context_lines);

    if json_format {
        let json = serde_json::to_value(&report).map_err(|e| CliError::Generic {
            message: format!("failed to serialize report: {e}"),
        })?;
        output::print_output(json, true);
    } else {
        print_text(&report);
    }

    Ok(())
}

async fn fetch_via_grpc(config: &Config, signature_str: &str) -> Result<Response, CliError> {
    use std::time::Duration;
    use thru_client::ClientBuilder;

    let signature = super::parse_signature(signature_str)?;
    let sig_bytes = signature
        .to_bytes()
        .map_err(|e| CliError::Validation(format!("invalid signature: {e}")))?;

    let rpc_url = config.get_grpc_url()?;
    let client = ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(Duration::from_secs(config.timeout_seconds))
        .auth_token(config.auth_token.clone())
        .build()?;

    let proto_resp = client
        .debug_re_execute(&sig_bytes, false, false, false, false)
        .await
        .map_err(|e| CliError::Rpc(format!("debug re-execute failed: {e}")))?;

    Ok(Response::from_proto(&proto_resp))
}

// --- DWARF resolver ---

struct DwarfResolver<'data> {
    ctx: addr2line::Context<gimli::EndianSlice<'data, gimli::RunTimeEndian>>,
    dwarf: gimli::Dwarf<gimli::EndianSlice<'data, gimli::RunTimeEndian>>,
    debug_frame: gimli::DebugFrame<gimli::EndianSlice<'data, gimli::RunTimeEndian>>,
    /// Virtual address of the .text section — added to raw VM PCs for DWARF lookups.
    text_base: u64,
}

struct ResolvedFrame {
    function: Option<String>,
    file: Option<String>,
    line: Option<u32>,
}

impl<'data> DwarfResolver<'data> {
    fn new(elf_data: &'data [u8]) -> Result<Self, CliError> {
        let object = object::File::parse(elf_data).map_err(|e| CliError::Generic {
            message: format!("failed to parse ELF: {e}"),
        })?;

        let endian = if object.is_little_endian() {
            gimli::RunTimeEndian::Little
        } else {
            gimli::RunTimeEndian::Big
        };

        // Load .debug_frame separately (not included in Dwarf::load)
        let debug_frame_data = object
            .section_by_name(".debug_frame")
            .and_then(|s| s.data().ok())
            .unwrap_or(&[]);
        let mut debug_frame =
            gimli::DebugFrame::from(gimli::EndianSlice::new(debug_frame_data, endian));
        debug_frame.set_address_size(if object.is_64() { 8 } else { 4 });

        let load_section = |id: gimli::SectionId| -> Result<
            gimli::EndianSlice<'data, gimli::RunTimeEndian>,
            gimli::Error,
        > {
            let data = object
                .section_by_name(id.name())
                .and_then(|s| s.data().ok())
                .unwrap_or(&[]);
            Ok(gimli::EndianSlice::new(data, endian))
        };

        let dwarf = gimli::Dwarf::load(&load_section).map_err(|e| CliError::Generic {
            message: format!("failed to load DWARF sections: {e}"),
        })?;
        // Load a second copy for variable resolution (Context::from_dwarf takes ownership)
        let dwarf_for_vars = gimli::Dwarf::load(&load_section).map_err(|e| CliError::Generic {
            message: format!("failed to load DWARF sections: {e}"),
        })?;

        let ctx = addr2line::Context::from_dwarf(dwarf).map_err(|e| CliError::Generic {
            message: format!("failed to build DWARF context (was the ELF built with -g?): {e}"),
        })?;

        // Extract the .text section virtual address — VM PCs are offsets from the
        // start of the text segment, but DWARF uses the ELF virtual addresses.
        let text_base = object
            .section_by_name(".text")
            .map(|s| s.address())
            .unwrap_or(0);

        Ok(Self {
            ctx,
            dwarf: dwarf_for_vars,
            debug_frame,
            text_base,
        })
    }

    fn dwarf(&self) -> &gimli::Dwarf<gimli::EndianSlice<'data, gimli::RunTimeEndian>> {
        &self.dwarf
    }

    fn debug_frame(&self) -> &gimli::DebugFrame<gimli::EndianSlice<'data, gimli::RunTimeEndian>> {
        &self.debug_frame
    }

    /// Translate a raw VM PC (text-relative offset) to an ELF virtual address.
    fn vm_pc_to_elf(&self, pc: u64) -> u64 {
        pc.wrapping_add(self.text_base)
    }

    fn resolve_pc(&self, pc: u64) -> ResolvedFrame {
        self.resolve_frames(pc)
            .into_iter()
            .next()
            .unwrap_or(ResolvedFrame {
                function: None,
                file: None,
                line: None,
            })
    }

    fn resolve_frames(&self, pc: u64) -> Vec<ResolvedFrame> {
        let mut result = Vec::new();
        let elf_pc = self.vm_pc_to_elf(pc);
        let Ok(mut iter) = self.ctx.find_frames(elf_pc).skip_all_loads() else {
            return result;
        };
        while let Ok(Some(frame)) = iter.next() {
            let function = frame
                .function
                .as_ref()
                .and_then(|f| f.demangle().ok())
                .map(|s| s.to_string());
            let (file, line) = match &frame.location {
                Some(loc) => (loc.file.map(|s| s.to_string()), loc.line),
                None => (None, None),
            };
            result.push(ResolvedFrame {
                function,
                file,
                line,
            });
        }
        result
    }
}

// --- Response types (proto3 JSON) ---

fn de_u64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let v = Value::deserialize(d)?;
    match &v {
        Value::Number(n) => n
            .as_u64()
            .ok_or_else(|| serde::de::Error::custom("invalid u64")),
        Value::String(s) if s.is_empty() => Ok(0),
        Value::String(s) => s.parse().map_err(serde::de::Error::custom),
        Value::Null => Ok(0),
        _ => Err(serde::de::Error::custom(
            "expected number or string for u64",
        )),
    }
}

fn de_vec_u64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u64>, D::Error> {
    let items = Vec::<Value>::deserialize(d)?;
    items
        .into_iter()
        .map(|v| match &v {
            Value::Number(n) => n
                .as_u64()
                .ok_or_else(|| serde::de::Error::custom("invalid u64")),
            Value::String(s) => s.parse().map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom("expected number or string")),
        })
        .collect()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    #[serde(default)]
    stdout: String,
    #[serde(default)]
    log: String,
    #[serde(default)]
    trace: String,
    execution_details: Option<ExecDetails>,
}

/// Parse a response JSON file, accepting either:
/// - Proto3 JSON (camelCase, with nested `executionDetails`)
/// - CLI `--json debug re-execute` output (snake_case, flat, optionally wrapped in `debug_re_execute`)
fn parse_response_json(text: &str) -> Result<Response, CliError> {
    let raw: Value = serde_json::from_str(text).map_err(|e| CliError::Generic {
        message: format!("failed to parse response JSON: {e}"),
    })?;

    // Unwrap CLI wrapper if present
    let obj = if let Some(inner) = raw.get("debug_re_execute") {
        inner
    } else {
        &raw
    };

    // Detect format: CLI output has execution details at top level (e.g., `program_counter`)
    // Proto3 JSON has them nested under `executionDetails`.
    let is_cli_format = obj.get("program_counter").is_some() || obj.get("execution_code").is_some();

    if is_cli_format {
        // CLI format: build Response from flat snake_case fields
        let get_u64 = |key: &str| -> u64 {
            match obj.get(key) {
                Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
                Some(Value::String(s)) => {
                    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
                        u64::from_str_radix(hex, 16).unwrap_or(0)
                    } else {
                        s.parse().unwrap_or(0)
                    }
                }
                _ => 0,
            }
        };
        let get_str = |key: &str| -> String {
            obj.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let get_bool =
            |key: &str| -> bool { obj.get(key).and_then(|v| v.as_bool()).unwrap_or(false) };
        let fault_code = match get_u64("fault_code") {
            0 => FaultCode::None,
            1 => FaultCode::Revert,
            2 => FaultCode::Sigcu,
            3 => FaultCode::Sigsu,
            x => FaultCode::Unknown(x),
        };
        let registers: Vec<u64> = obj
            .get("registers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
                    .collect()
            })
            .unwrap_or_default();
        let call_frames: Vec<CallFrame> = obj
            .get("call_frames")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|cf| {
                        let cf = cf.as_object()?;
                        let get_cf_u64 = |k: &str| -> u64 {
                            match cf.get(k) {
                                Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
                                Some(Value::String(s)) => s.parse().unwrap_or(0),
                                _ => 0,
                            }
                        };
                        let saved_registers: Vec<u64> = cf
                            .get("saved_registers")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
                                    .collect()
                            })
                            .unwrap_or_default();
                        // CLI uses hex-encoded stack_window; convert to base64 for internal format
                        let stack_window = cf
                            .get("stack_window")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .and_then(|hex| hex::decode(hex).ok())
                            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(&bytes));
                        Some(CallFrame {
                            program_acc_idx: cf
                                .get("program_acc_idx")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32,
                            program_counter: get_cf_u64("program_counter"),
                            stack_pointer: get_cf_u64("stack_pointer"),
                            saved_registers,
                            stack_window,
                            stack_window_base: get_cf_u64("stack_window_base"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(Response {
            stdout: get_str("stdout"),
            log: get_str("log"),
            trace: get_str("trace"),
            execution_details: Some(ExecDetails {
                execution_code: get_u64("execution_code"),
                user_error_code: get_u64("user_error_code"),
                compute_units_consumed: get_u64("compute_units_consumed"),
                state_units_consumed: get_u64("state_units_consumed"),
                program_counter: get_u64("program_counter"),
                instruction_counter: get_u64("instruction_counter"),
                fault_code,
                segv_vaddr: get_u64("segv_vaddr"),
                segv_size: get_u64("segv_size"),
                segv_write: get_bool("segv_write"),
                registers,
                call_depth: get_u64("call_depth"),
                max_call_depth: get_u64("max_call_depth"),
                call_frames,
                error_program_acc_idx: obj
                    .get("error_program_acc_idx")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
            }),
        })
    } else {
        // Proto3 JSON: deserialize with camelCase serde
        serde_json::from_value(obj.clone()).map_err(|e| CliError::Generic {
            message: format!("failed to parse proto3 response JSON: {e}"),
        })
    }
}

type ProtoResponse = thru_client::proto::services::v1::DebugReExecuteResponse;

impl Response {
    fn from_proto(r: &ProtoResponse) -> Self {
        Self {
            stdout: r.stdout.clone(),
            log: r.log.clone(),
            trace: r.trace.clone(),
            execution_details: r.execution_details.as_ref().map(|d| {
                let fault_code = match d.fault_code {
                    0 => FaultCode::None,
                    1 => FaultCode::Revert,
                    2 => FaultCode::Sigcu,
                    3 => FaultCode::Sigsu,
                    x => FaultCode::Unknown(x as u64),
                };
                ExecDetails {
                    execution_code: d.execution_code,
                    user_error_code: d.user_error_code,
                    compute_units_consumed: d.compute_units_consumed,
                    state_units_consumed: d.state_units_consumed,
                    program_counter: d.program_counter,
                    instruction_counter: d.instruction_counter,
                    fault_code,
                    segv_vaddr: d.segv_vaddr,
                    segv_size: d.segv_size,
                    segv_write: d.segv_write,
                    registers: d.registers.clone(),
                    call_depth: d.call_depth,
                    max_call_depth: d.max_call_depth,
                    call_frames: d
                        .call_frames
                        .iter()
                        .map(|cf| {
                            let stack_window = if cf.stack_window.is_empty() {
                                None
                            } else {
                                Some(
                                    base64::engine::general_purpose::STANDARD
                                        .encode(&cf.stack_window),
                                )
                            };
                            CallFrame {
                                program_acc_idx: cf.program_acc_idx,
                                program_counter: cf.program_counter,
                                stack_pointer: cf.stack_pointer,
                                saved_registers: cf.saved_registers.clone(),
                                stack_window,
                                stack_window_base: cf.stack_window_base,
                            }
                        })
                        .collect(),
                    error_program_acc_idx: r
                        .transaction
                        .as_ref()
                        .and_then(|t| t.execution_result.as_ref())
                        .map(|er| er.error_program_acc_idx)
                        .filter(|&idx| idx != 0),
                }
            }),
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ExecDetails {
    #[serde(default, deserialize_with = "de_u64")]
    execution_code: u64,
    #[serde(default, deserialize_with = "de_u64")]
    user_error_code: u64,
    #[serde(default, deserialize_with = "de_u64")]
    compute_units_consumed: u64,
    #[serde(default, deserialize_with = "de_u64")]
    state_units_consumed: u64,
    #[serde(default, deserialize_with = "de_u64")]
    program_counter: u64,
    #[serde(default, deserialize_with = "de_u64")]
    instruction_counter: u64,
    #[serde(default)]
    fault_code: FaultCode,
    #[serde(default, deserialize_with = "de_u64")]
    segv_vaddr: u64,
    #[serde(default, deserialize_with = "de_u64")]
    segv_size: u64,
    #[serde(default)]
    segv_write: bool,
    #[serde(default, deserialize_with = "de_vec_u64")]
    registers: Vec<u64>,
    #[serde(default, deserialize_with = "de_u64")]
    call_depth: u64,
    #[serde(default, deserialize_with = "de_u64")]
    max_call_depth: u64,
    #[serde(default)]
    call_frames: Vec<CallFrame>,
    #[serde(default)]
    error_program_acc_idx: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct CallFrame {
    #[serde(default)]
    program_acc_idx: u32,
    #[serde(default, deserialize_with = "de_u64")]
    program_counter: u64,
    #[serde(default, deserialize_with = "de_u64")]
    stack_pointer: u64,
    #[serde(default, deserialize_with = "de_vec_u64")]
    saved_registers: Vec<u64>,
    #[serde(default)]
    stack_window: Option<String>,
    #[serde(default, deserialize_with = "de_u64")]
    stack_window_base: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum FaultCode {
    #[default]
    None,
    Revert,
    Sigcu,
    Sigsu,
    Unknown(u64),
}

impl<'de> serde::Deserialize<'de> for FaultCode {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        match &v {
            Value::String(s) => match s.as_str() {
                "VM_FAULT_NONE" | "0" => Ok(Self::None),
                "VM_FAULT_REVERT" | "1" => Ok(Self::Revert),
                "VM_FAULT_SIGCU" | "2" => Ok(Self::Sigcu),
                "VM_FAULT_SIGSU" | "3" => Ok(Self::Sigsu),
                other => Err(serde::de::Error::custom(format!(
                    "unknown fault code: {other}"
                ))),
            },
            Value::Number(n) => match n.as_u64() {
                Some(0) => Ok(Self::None),
                Some(1) => Ok(Self::Revert),
                Some(2) => Ok(Self::Sigcu),
                Some(3) => Ok(Self::Sigsu),
                Some(x) => Ok(Self::Unknown(x)),
                _ => Err(serde::de::Error::custom("invalid fault code")),
            },
            Value::Null => Ok(Self::None),
            _ => Err(serde::de::Error::custom("expected string or number")),
        }
    }
}

impl std::fmt::Display for FaultCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => write!(f, "NONE"),
            Self::Revert => write!(f, "REVERT"),
            Self::Sigcu => write!(f, "SIGCU (compute units exhausted)"),
            Self::Sigsu => write!(f, "SIGSU (state units exhausted)"),
            Self::Unknown(x) => write!(f, "UNKNOWN({x})"),
        }
    }
}

impl Serialize for FaultCode {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// --- Report types ---

#[derive(Serialize)]
struct Report {
    fault: FaultInfo,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    variables_at_fault: Vec<variables::VariableInfo>,
    call_stack: Vec<StackFrame>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    execution_flow: Vec<TraceGroup>,
    trace_tail: Vec<TraceEntry>,
    source_context: Option<SourceContext>,
    registers: Vec<RegisterInfo>,
    stdout: String,
    log: String,
}

#[derive(Serialize)]
struct FaultInfo {
    fault_type: FaultCode,
    user_error_code: u64,
    execution_code: u64,
    source: Option<String>,
    function: Option<String>,
    inline_chain: Vec<InlineFrame>,
    compute_units: u64,
    state_units: u64,
    instruction_counter: u64,
    program_counter: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    segv_vaddr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    segv_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    segv_write: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_program_acc_idx: Option<u32>,
}

#[derive(Serialize)]
struct InlineFrame {
    function: Option<String>,
    source: Option<String>,
}

#[derive(Serialize)]
struct StackFrame {
    depth: usize,
    program_acc_idx: u32,
    function: Option<String>,
    source: Option<String>,
    pc: String,
}

#[derive(Serialize)]
struct TraceEntry {
    pc: String,
    source: Option<String>,
    disasm: String,
    is_fault: bool,
}

#[derive(Serialize)]
struct TraceGroup {
    source: Option<String>,
    function: Option<String>,
    instruction_count: usize,
    first_pc: String,
    last_pc: String,
    contains_fault: bool,
}

#[derive(Serialize)]
struct SourceContext {
    file: String,
    fault_line: u32,
    lines: BTreeMap<u32, String>,
}

#[derive(Serialize)]
struct RegisterInfo {
    name: String,
    index: usize,
    value: String,
}

// --- Report builder ---

fn build_report(
    resolver: &DwarfResolver,
    resp: &Response,
    trace_count: usize,
    context_lines: u32,
) -> Report {
    let details = resp.execution_details.as_ref();
    let fault_code = details.map(|d| d.fault_code).unwrap_or_default();
    let pc = details.map(|d| d.program_counter).unwrap_or(0);

    let fault_frames = resolver.resolve_frames(pc);
    let fault_loc = fault_frames.first();

    let source = fault_loc.and_then(|f| Some(format!("{}:{}", f.file.as_deref()?, f.line?)));
    let function = fault_loc.and_then(|f| f.function.clone());

    let inline_chain: Vec<InlineFrame> = fault_frames
        .iter()
        .skip(1)
        .map(|f| InlineFrame {
            function: f.function.clone(),
            source: f
                .file
                .as_deref()
                .and_then(|file| f.line.map(|line| format!("{file}:{line}"))),
        })
        .collect();

    let is_segfault = details
        .map(|d| d.segv_vaddr != 0 || d.segv_size != 0)
        .unwrap_or(false);

    let fault = FaultInfo {
        fault_type: fault_code,
        user_error_code: details.map(|d| d.user_error_code).unwrap_or(0),
        execution_code: details.map(|d| d.execution_code).unwrap_or(0),
        source,
        function,
        inline_chain,
        compute_units: details.map(|d| d.compute_units_consumed).unwrap_or(0),
        state_units: details.map(|d| d.state_units_consumed).unwrap_or(0),
        instruction_counter: details.map(|d| d.instruction_counter).unwrap_or(0),
        program_counter: format!("0x{pc:05X}"),
        segv_vaddr: is_segfault
            .then(|| format!("0x{:016X}", details.map(|d| d.segv_vaddr).unwrap_or(0))),
        segv_size: is_segfault.then(|| details.map(|d| d.segv_size).unwrap_or(0)),
        segv_write: is_segfault.then(|| details.map(|d| d.segv_write).unwrap_or(false)),
        error_program_acc_idx: details.and_then(|d| d.error_program_acc_idx),
    };

    let call_stack = build_call_stack(resolver, details);
    let parsed_trace = parse_trace(&resp.trace);
    let execution_flow = build_execution_flow(resolver, &parsed_trace, pc);
    let trace_tail = build_trace_tail_from_parsed(resolver, &parsed_trace, trace_count, pc);
    let source_context = build_source_context(fault_loc, context_lines);
    let registers = build_registers(details);

    let variables_at_fault = if let Some(details) = details {
        let stack_windows = decode_stack_windows(&details.call_frames);
        let sw_refs: Vec<variables::StackWindow> = stack_windows
            .iter()
            .map(|(base, data)| (*base, data.as_slice()))
            .collect();
        variables::resolve(
            resolver.dwarf(),
            resolver.debug_frame(),
            resolver.vm_pc_to_elf(pc),
            &details.registers,
            &sw_refs,
        )
    } else {
        Vec::new()
    };

    Report {
        fault,
        variables_at_fault,
        call_stack,
        execution_flow,
        trace_tail,
        source_context,
        registers,
        stdout: resp.stdout.clone(),
        log: resp.log.clone(),
    }
}

fn build_call_stack(resolver: &DwarfResolver, details: Option<&ExecDetails>) -> Vec<StackFrame> {
    let Some(details) = details else {
        return Vec::new();
    };
    details
        .call_frames
        .iter()
        .enumerate()
        .map(|(i, cf)| {
            let resolved = resolver.resolve_pc(cf.program_counter);
            let source = resolved
                .file
                .as_deref()
                .and_then(|file| resolved.line.map(|line| format!("{file}:{line}")));
            StackFrame {
                depth: i,
                program_acc_idx: cf.program_acc_idx,
                function: resolved.function,
                source,
                pc: format!("0x{:05X}", cf.program_counter),
            }
        })
        .collect()
}

/// Parsed trace instruction: (pc, disasm_text)
struct ParsedInsn {
    pc: u64,
    disasm: String,
}

fn parse_trace(trace: &str) -> Vec<ParsedInsn> {
    trace
        .lines()
        .filter_map(|line| {
            let caps = TRACE_RE.captures(line)?;
            let pc = u64::from_str_radix(&caps[4], 16).ok()?;
            let raw_rest = caps[6].to_string();
            let disasm = REG_DUMP_RE.replace(&raw_rest, "").trim_end().to_string();
            Some(ParsedInsn { pc, disasm })
        })
        .collect()
}

fn build_execution_flow(
    resolver: &DwarfResolver,
    parsed: &[ParsedInsn],
    fault_pc: u64,
) -> Vec<TraceGroup> {
    if parsed.is_empty() {
        return Vec::new();
    }

    let mut groups: Vec<TraceGroup> = Vec::new();

    for insn in parsed {
        let resolved = resolver.resolve_pc(insn.pc);
        let source = resolved
            .file
            .as_deref()
            .and_then(|file| resolved.line.map(|line| format!("{file}:{line}")));
        let is_fault = insn.pc == fault_pc;

        // Extend current group if same source line, otherwise start a new group
        if let Some(last) = groups.last_mut() {
            if last.source == source {
                last.instruction_count += 1;
                last.last_pc = format!("0x{:05X}", insn.pc);
                last.contains_fault |= is_fault;
                continue;
            }
        }

        groups.push(TraceGroup {
            source,
            function: resolved.function,
            instruction_count: 1,
            first_pc: format!("0x{:05X}", insn.pc),
            last_pc: format!("0x{:05X}", insn.pc),
            contains_fault: is_fault,
        });
    }

    groups
}

fn build_trace_tail_from_parsed(
    resolver: &DwarfResolver,
    parsed: &[ParsedInsn],
    count: usize,
    fault_pc: u64,
) -> Vec<TraceEntry> {
    let start = parsed.len().saturating_sub(count);
    parsed[start..]
        .iter()
        .map(|insn| {
            let resolved = resolver.resolve_pc(insn.pc);
            let source = resolved
                .file
                .as_deref()
                .and_then(|file| resolved.line.map(|line| format!("{file}:{line}")));
            TraceEntry {
                pc: format!("0x{:05X}", insn.pc),
                source,
                disasm: insn.disasm.clone(),
                is_fault: insn.pc == fault_pc,
            }
        })
        .collect()
}

fn build_source_context(
    fault_loc: Option<&ResolvedFrame>,
    context_lines: u32,
) -> Option<SourceContext> {
    let loc = fault_loc?;
    let file_path = loc.file.as_deref()?;
    let fault_line = loc.line?;

    let content = std::fs::read_to_string(file_path).ok()?;
    let file_lines: Vec<&str> = content.lines().collect();

    let start = fault_line.saturating_sub(context_lines).max(1);
    let end = (fault_line + context_lines).min(file_lines.len() as u32);

    let mut lines = BTreeMap::new();
    for line_no in start..=end {
        if let Some(text) = file_lines.get((line_no - 1) as usize) {
            lines.insert(line_no, text.to_string());
        }
    }

    Some(SourceContext {
        file: file_path.to_string(),
        fault_line,
        lines,
    })
}

fn build_registers(details: Option<&ExecDetails>) -> Vec<RegisterInfo> {
    let Some(details) = details else {
        return Vec::new();
    };
    details
        .registers
        .iter()
        .enumerate()
        .map(|(i, &val)| RegisterInfo {
            name: RISCV_REG_NAMES.get(i).unwrap_or(&"??").to_string(),
            index: i,
            value: format!("0x{val:016X}"),
        })
        .collect()
}

fn decode_stack_windows(frames: &[CallFrame]) -> Vec<(u64, Vec<u8>)> {
    frames
        .iter()
        .filter_map(|f| {
            let encoded = f.stack_window.as_deref()?;
            if encoded.is_empty() {
                return None;
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()?;
            Some((f.stack_window_base, bytes))
        })
        .collect()
}

// --- Text output ---

fn print_text(report: &Report) {
    let sep = "=".repeat(60);
    println!("{}", sep.bold());
    println!("{}", "  Thru Debug Report".bold());
    println!("{}", sep.bold());
    println!();

    print_fault(&report.fault);
    print_variables(&report.variables_at_fault);
    print_call_stack(&report.call_stack);
    print_source_context(&report.source_context);
    print_execution_flow(&report.execution_flow);
    print_trace(&report.trace_tail);
    print_registers(&report.registers);
    print_output_section("STDOUT", &report.stdout);
    print_output_section("LOG", &report.log);
}

fn print_fault(fault: &FaultInfo) {
    let header = format!("FAULT: {}", fault.fault_type);
    match fault.fault_type {
        FaultCode::None => println!("{}", header.green().bold()),
        _ => println!("{}", header.red().bold()),
    }

    if fault.fault_type == FaultCode::Revert {
        println!("  user_error_code: {}", fault.user_error_code);
    }
    if fault.execution_code != 0 {
        println!("  execution_code:  {}", fault.execution_code);
    }

    if let Some(src) = &fault.source {
        let func = fault.function.as_deref().unwrap_or("??");
        println!("  at: {} in {}()", src.yellow(), func.cyan());
    } else {
        println!("  at: {}", "?? (no debug info)".dimmed());
    }

    for inl in &fault.inline_chain {
        let func = inl.function.as_deref().unwrap_or("??");
        let src = inl.source.as_deref().unwrap_or("??");
        println!("    inlined from: {} at {}", func.cyan(), src);
    }

    if let Some(idx) = fault.error_program_acc_idx {
        println!("  faulting program acc_idx: {idx}");
    }

    println!(
        "  CU: {} | SU: {} | Instructions: {}",
        fault.compute_units, fault.state_units, fault.instruction_counter
    );
    println!("  PC: {}", fault.program_counter);

    if let Some(vaddr) = &fault.segv_vaddr {
        let rw = if fault.segv_write.unwrap_or(false) {
            "write"
        } else {
            "read"
        };
        println!(
            "  SEGV: {} ({}, {} bytes)",
            vaddr,
            rw,
            fault.segv_size.unwrap_or(0)
        );
    }

    println!();
}

fn print_variables(vars: &[variables::VariableInfo]) {
    if vars.is_empty() {
        return;
    }
    println!("{}", "VARIABLES AT FAULT:".bold());
    for var in vars {
        let type_str = var.type_name.as_deref().unwrap_or("");
        let val = var.value.as_deref().unwrap_or("??");
        if type_str.is_empty() {
            println!(
                "  {:<20} = {}  ({})",
                var.name.cyan(),
                val,
                var.location.dimmed()
            );
        } else {
            println!(
                "  {} {:<16} = {}  ({})",
                type_str.dimmed(),
                var.name.cyan(),
                val,
                var.location.dimmed()
            );
        }
    }
    println!();
}

fn print_call_stack(stack: &[StackFrame]) {
    if stack.is_empty() {
        return;
    }
    println!("{}", "CALL STACK:".bold());
    for frame in stack.iter().rev() {
        let func = frame.function.as_deref().unwrap_or("??");
        let src = frame.source.as_deref().unwrap_or("??");
        println!(
            "  #{:<2} [prog {}]  {:<30}  {}  {}",
            frame.depth,
            frame.program_acc_idx,
            func.cyan(),
            src,
            frame.pc.dimmed()
        );
    }
    println!();
}

fn print_source_context(ctx: &Option<SourceContext>) {
    let Some(ctx) = ctx else { return };
    println!("{} ({})", "SOURCE:".bold(), ctx.file.dimmed());
    let max_line_no = ctx.lines.keys().next_back().copied().unwrap_or(0);
    let width = format!("{max_line_no}").len();

    for (&line_no, text) in &ctx.lines {
        if line_no == ctx.fault_line {
            let marker = format!(
                "\u{25b6} {:>width$} \u{2502} {}",
                line_no,
                text,
                width = width
            );
            println!("  {}", marker.red().bold());
        } else {
            println!("  {:>width$} \u{2502} {}", line_no, text, width = width + 2);
        }
    }
    println!();
}

fn print_execution_flow(groups: &[TraceGroup]) {
    if groups.is_empty() {
        return;
    }
    let total_insns: usize = groups.iter().map(|g| g.instruction_count).sum();
    println!(
        "{} ({} instructions, {} source groups):",
        "EXECUTION FLOW".bold(),
        total_insns,
        groups.len()
    );
    for g in groups {
        let src = g.source.as_deref().unwrap_or("??");
        let func = g
            .function
            .as_deref()
            .map(|f| format!("  {f}"))
            .unwrap_or_default();
        let insn_label = if g.instruction_count == 1 {
            "1 insn".to_string()
        } else {
            format!("{} insns", g.instruction_count)
        };
        let pc_range = if g.first_pc == g.last_pc {
            g.first_pc.clone()
        } else {
            format!("{}..{}", g.first_pc, g.last_pc)
        };
        if g.contains_fault {
            let line = format!(
                "\u{25b6} {:<28} ({:<8}) {}{}",
                src, insn_label, pc_range, func
            );
            println!("  {}", line.red().bold());
        } else {
            println!(
                "  {:<28} ({:<8}) {}{}",
                src,
                insn_label,
                pc_range.dimmed(),
                func.dimmed()
            );
        }
    }
    println!();
}

fn print_trace(trace: &[TraceEntry]) {
    if trace.is_empty() {
        return;
    }
    println!("{} (last {}):", "TRACE".bold(), trace.len());
    for entry in trace {
        let src = entry.source.as_deref().unwrap_or("??");
        if entry.is_fault {
            let line = format!("\u{25b6} {}  {:<24}  {}", entry.pc, src, entry.disasm);
            println!("  {}", line.red().bold());
        } else {
            println!("  {}  {:<24}  {}", entry.pc.dimmed(), src, entry.disasm);
        }
    }
    println!();
}

fn print_registers(regs: &[RegisterInfo]) {
    if regs.is_empty() {
        return;
    }
    println!("{}", "REGISTERS:".bold());
    for row in regs.chunks(4) {
        let parts: Vec<_> = row
            .iter()
            .map(|reg| format!("{:<4} = {}", reg.name, reg.value))
            .collect();
        println!("  {}", parts.join("   "));
    }
    println!();
}

fn print_output_section(label: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    println!("{}:", label.bold());
    for line in text.lines() {
        println!("  {}", line);
    }
    println!();
}
