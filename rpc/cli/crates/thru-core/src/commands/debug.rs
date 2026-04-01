//! Debug commands for transaction analysis

mod resolve;
mod variables;

use crate::cli::DebugCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use colored::*;
use std::time::Duration;
use thru_base::tn_tools::{Pubkey, Signature as ThruSignature};
use thru_client::{Client, ClientBuilder};

/// Handle debug-related commands
pub async fn handle_debug_command(
    config: &Config,
    subcommand: DebugCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        DebugCommands::Resolve {
            elf,
            response,
            signature,
            trace_tail,
            context,
        } => {
            resolve::handle_resolve(
                config,
                &elf,
                response.as_deref(),
                signature.as_deref(),
                trace_tail,
                context,
                json_format,
            )
            .await
        }
    }
}

pub async fn run_txn_debug(
    config: &Config,
    signature_str: &str,
    include_state_before: bool,
    include_state_after: bool,
    include_account_data: bool,
    include_memory_dump: bool,
    output_trace: Option<&str>,
    inline_trace: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let signature = parse_signature(signature_str)?;
    let sig_bytes = signature
        .to_bytes()
        .map_err(|e| CliError::Validation(format!("Invalid signature: {}", e)))?;

    let client = create_rpc_client(config)?;

    let response = client
        .debug_re_execute(
            &sig_bytes,
            include_state_before,
            include_state_after,
            include_account_data,
            include_memory_dump,
        )
        .await
        .map_err(|e| CliError::Rpc(format!("txn debug failed: {}", e)))?;

    if let Some(path) = output_trace {
        std::fs::write(path, &response.trace).map_err(|e| CliError::Generic {
            message: format!("Failed to write trace to {}: {}", path, e),
        })?;
    }

    if json_format {
        print_json_output(&response, signature_str, output_trace, inline_trace);
    } else {
        print_text_output(&response, signature_str, output_trace);
    }

    Ok(())
}

/// Parse a signature from ts... format or hex format
fn parse_signature(signature_str: &str) -> Result<thru_base::tn_tools::Signature, CliError> {
    if signature_str.starts_with("ts") && signature_str.len() == 90 {
        thru_base::tn_tools::Signature::new(signature_str.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid signature: {}", e)))
    } else if signature_str.len() == 128 {
        let sig_bytes = hex::decode(signature_str)
            .map_err(|e| CliError::Validation(format!("Invalid hex signature: {}", e)))?;
        if sig_bytes.len() != 64 {
            return Err(CliError::Validation(format!(
                "Hex signature must be exactly 64 bytes (128 hex characters), got {} bytes",
                sig_bytes.len()
            )));
        }
        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(&sig_bytes);
        Ok(thru_base::tn_tools::Signature::from_bytes(&sig_array))
    } else {
        Err(CliError::Validation(format!(
            "Invalid signature: {}. Must be a ts... signature (90 characters) or 128-character hex string",
            signature_str
        )))
    }
}

/// Create RPC client from config
fn create_rpc_client(config: &Config) -> Result<Client, CliError> {
    let rpc_url = config.get_grpc_url()?;

    ClientBuilder::new()
        .http_endpoint(rpc_url)
        .timeout(Duration::from_secs(config.timeout_seconds))
        .auth_token(config.auth_token.clone())
        .build()
        .map_err(|e| e.into())
}

/// Format a pubkey from proto bytes, returning ta... format or hex fallback
fn format_pubkey(pubkey_bytes: &[u8]) -> String {
    if pubkey_bytes.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(pubkey_bytes);
        Pubkey::from_bytes(&arr).as_str().to_string()
    } else {
        hex::encode(pubkey_bytes)
    }
}

fn format_signature(signature_bytes: &[u8]) -> String {
    if signature_bytes.len() == 64 {
        let mut arr = [0u8; 64];
        arr.copy_from_slice(signature_bytes);
        ThruSignature::from_bytes(&arr).as_str().to_string()
    } else {
        hex::encode(signature_bytes)
    }
}

fn fault_label(code: i32) -> &'static str {
    match code {
        0 => "None",
        1 => "Revert",
        2 => "ComputeUnitsExhausted",
        3 => "StateUnitsExhausted",
        _ => "Unknown",
    }
}

fn segment_type_label(segment_type: u32) -> &'static str {
    match segment_type {
        5 => "stack",
        7 => "heap",
        _ => "unknown",
    }
}

fn print_json_output(
    response: &thru_client::proto::services::v1::DebugReExecuteResponse,
    signature_str: &str,
    output_trace: Option<&str>,
    inline_trace: bool,
) {
    output::print_output(
        build_json_output(response, signature_str, output_trace, inline_trace),
        true,
    );
}

fn build_json_output(
    response: &thru_client::proto::services::v1::DebugReExecuteResponse,
    signature_str: &str,
    output_trace: Option<&str>,
    inline_trace: bool,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert("signature".to_string(), json!(signature_str));
    obj.insert("stdout".to_string(), json!(&response.stdout));
    obj.insert("log".to_string(), json!(&response.log));
    obj.insert("trace_bytes".to_string(), json!(response.trace.len()));

    if inline_trace && !response.trace.is_empty() {
        obj.insert("trace".to_string(), json!(&response.trace));
    }

    if let Some(path) = output_trace.filter(|_| !response.trace.is_empty()) {
        obj.insert("trace_file".to_string(), json!(path));
    }

    if let Some(transaction) = &response.transaction {
        if let Some(error_program_acc_idx) = transaction
            .execution_result
            .as_ref()
            .map(|execution_result| execution_result.error_program_acc_idx)
            .filter(|idx| *idx != 0)
        {
            obj.insert(
                "error_program_acc_idx".to_string(),
                json!(error_program_acc_idx),
            );
        }

        obj.insert(
            "transaction".to_string(),
            format_transaction_json(transaction),
        );
    }

    if let Some(details) = &response.execution_details {
        obj.insert("execution_code".to_string(), json!(details.execution_code));
        obj.insert(
            "user_error_code".to_string(),
            json!(details.user_error_code),
        );
        obj.insert(
            "compute_units_consumed".to_string(),
            json!(details.compute_units_consumed),
        );
        obj.insert(
            "state_units_consumed".to_string(),
            json!(details.state_units_consumed),
        );
        obj.insert("pages_used".to_string(), json!(details.pages_used));
        obj.insert(
            "program_counter".to_string(),
            json!(details.program_counter),
        );
        obj.insert(
            "instruction_counter".to_string(),
            json!(details.instruction_counter),
        );
        obj.insert("fault_code".to_string(), json!(details.fault_code));
        obj.insert(
            "fault_code_label".to_string(),
            json!(fault_label(details.fault_code)),
        );
        if details.segv_vaddr != 0 || details.segv_size != 0 {
            obj.insert(
                "segv_vaddr".to_string(),
                json!(format!("0x{:x}", details.segv_vaddr)),
            );
            obj.insert("segv_size".to_string(), json!(details.segv_size));
            obj.insert("segv_write".to_string(), json!(details.segv_write));
        }
        obj.insert("call_depth".to_string(), json!(details.call_depth));
        obj.insert("max_call_depth".to_string(), json!(details.max_call_depth));
        if !details.registers.is_empty() {
            obj.insert("registers".to_string(), json!(details.registers));
        }
        if !details.call_frames.is_empty() {
            obj.insert(
                "call_frames".to_string(),
                Value::Array(
                    details
                        .call_frames
                        .iter()
                        .map(format_call_frame_json)
                        .collect(),
                ),
            );
        }
        obj.insert(
            "execution_details".to_string(),
            format_execution_details_json(details),
        );
    }

    if !response.state_before.is_empty() {
        obj.insert(
            "state_before".to_string(),
            Value::Array(
                response
                    .state_before
                    .iter()
                    .map(format_snapshot_json)
                    .collect(),
            ),
        );
    }

    if !response.state_after.is_empty() {
        obj.insert(
            "state_after".to_string(),
            Value::Array(
                response
                    .state_after
                    .iter()
                    .map(format_snapshot_json)
                    .collect(),
            ),
        );
    }

    if !response.memory_segments.is_empty() {
        obj.insert(
            "memory_segments".to_string(),
            Value::Array(
                response
                    .memory_segments
                    .iter()
                    .map(format_memory_segment_json)
                    .collect(),
            ),
        );
    }

    json!({
        "txn_debug": Value::Object(obj),
    })
}

fn format_snapshot_json(
    snapshot: &thru_client::proto::services::v1::AccountSnapshot,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let address = snapshot
        .address
        .as_ref()
        .map(|pk| format_pubkey(&pk.value))
        .unwrap_or_default();

    let mut obj = Map::new();
    obj.insert("address".to_string(), json!(address));
    obj.insert("exists".to_string(), json!(snapshot.exists));

    if let Some(meta) = &snapshot.meta {
        obj.insert("meta".to_string(), format_account_meta_json(meta));

        obj.insert("version".to_string(), json!(meta.version));
        obj.insert("balance".to_string(), json!(meta.balance));
        obj.insert("nonce".to_string(), json!(meta.nonce));
        obj.insert("data_size".to_string(), json!(meta.data_size));
        obj.insert("seq".to_string(), json!(meta.seq));
        if let Some(owner) = &meta.owner {
            obj.insert("owner".to_string(), json!(format_pubkey(&owner.value)));
        }
        if let Some(last_updated_slot) = meta.last_updated_slot {
            obj.insert("last_updated_slot".to_string(), json!(last_updated_slot));
        }
        if let Some(flags) = &meta.flags {
            obj.insert("flags".to_string(), format_account_flags_json(flags));
            obj.insert("is_program".to_string(), json!(flags.is_program));
        }
    }

    if let Some(data) = &snapshot.data {
        obj.insert("data_hex".to_string(), json!(hex::encode(data)));
    }

    Value::Object(obj)
}

fn format_account_flags_json(
    flags: &thru_client::proto::core::v1::AccountFlags,
) -> serde_json::Value {
    serde_json::json!({
        "is_program": flags.is_program,
        "is_privileged": flags.is_privileged,
        "is_uncompressable": flags.is_uncompressable,
        "is_ephemeral": flags.is_ephemeral,
        "is_deleted": flags.is_deleted,
        "is_new": flags.is_new,
        "is_compressed": flags.is_compressed,
    })
}

fn format_account_meta_json(meta: &thru_client::proto::core::v1::AccountMeta) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert("version".to_string(), json!(meta.version));
    obj.insert("data_size".to_string(), json!(meta.data_size));
    obj.insert("seq".to_string(), json!(meta.seq));
    obj.insert("balance".to_string(), json!(meta.balance));
    obj.insert("nonce".to_string(), json!(meta.nonce));

    if let Some(flags) = &meta.flags {
        obj.insert("flags".to_string(), format_account_flags_json(flags));
    }

    if let Some(owner) = &meta.owner {
        obj.insert("owner".to_string(), json!(format_pubkey(&owner.value)));
    }

    if let Some(last_updated_slot) = meta.last_updated_slot {
        obj.insert("last_updated_slot".to_string(), json!(last_updated_slot));
    }

    Value::Object(obj)
}

fn format_call_frame_json(
    frame: &thru_client::proto::services::v1::CallFrame,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert("program_acc_idx".to_string(), json!(frame.program_acc_idx));
    obj.insert("program_counter".to_string(), json!(frame.program_counter));
    obj.insert("stack_pointer".to_string(), json!(frame.stack_pointer));
    obj.insert("saved_registers".to_string(), json!(frame.saved_registers));

    if !frame.stack_window.is_empty() {
        obj.insert(
            "stack_window".to_string(),
            json!(hex::encode(&frame.stack_window)),
        );
        obj.insert(
            "stack_window_base".to_string(),
            json!(frame.stack_window_base),
        );
    }

    Value::Object(obj)
}

fn format_execution_details_json(
    details: &thru_client::proto::services::v1::VmExecutionDetails,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert("execution_code".to_string(), json!(details.execution_code));
    obj.insert(
        "user_error_code".to_string(),
        json!(details.user_error_code),
    );
    obj.insert(
        "compute_units_consumed".to_string(),
        json!(details.compute_units_consumed),
    );
    obj.insert(
        "state_units_consumed".to_string(),
        json!(details.state_units_consumed),
    );
    obj.insert("pages_used".to_string(), json!(details.pages_used));
    obj.insert(
        "program_counter".to_string(),
        json!(details.program_counter),
    );
    obj.insert(
        "instruction_counter".to_string(),
        json!(details.instruction_counter),
    );
    obj.insert("fault_code".to_string(), json!(details.fault_code));
    obj.insert(
        "fault_code_label".to_string(),
        json!(fault_label(details.fault_code)),
    );
    obj.insert("call_depth".to_string(), json!(details.call_depth));
    obj.insert("max_call_depth".to_string(), json!(details.max_call_depth));

    if details.segv_vaddr != 0 || details.segv_size != 0 {
        obj.insert(
            "segv_vaddr".to_string(),
            json!(format!("0x{:x}", details.segv_vaddr)),
        );
        obj.insert("segv_size".to_string(), json!(details.segv_size));
        obj.insert("segv_write".to_string(), json!(details.segv_write));
    }

    if !details.registers.is_empty() {
        obj.insert("registers".to_string(), json!(details.registers));
    }

    if !details.call_frames.is_empty() {
        obj.insert(
            "call_frames".to_string(),
            Value::Array(
                details
                    .call_frames
                    .iter()
                    .map(format_call_frame_json)
                    .collect(),
            ),
        );
    }

    Value::Object(obj)
}

fn format_memory_segment_json(
    segment: &thru_client::proto::services::v1::MemorySegment,
) -> serde_json::Value {
    serde_json::json!({
        "segment_type": segment.segment_type,
        "segment_type_label": segment_type_label(segment.segment_type),
        "segment_size": segment.segment_size,
        "pages": segment.pages.iter().map(|page| {
            serde_json::json!({
                "page_index": page.page_index,
                "data_hex": hex::encode(&page.data),
            })
        }).collect::<Vec<_>>(),
    })
}

fn format_transaction_json(
    transaction: &thru_client::proto::core::v1::Transaction,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();

    if let Some(signature) = &transaction.signature {
        obj.insert(
            "signature".to_string(),
            json!(format_signature(&signature.value)),
        );
    }

    if let Some(header) = &transaction.header {
        obj.insert("header".to_string(), format_transaction_header_json(header));
    }

    if let Some(body) = &transaction.body {
        obj.insert("body_hex".to_string(), json!(hex::encode(body)));
    }

    if let Some(execution_result) = &transaction.execution_result {
        obj.insert(
            "execution_result".to_string(),
            format_transaction_execution_result_json(execution_result),
        );
    }

    if let Some(slot) = transaction.slot {
        obj.insert("slot".to_string(), json!(slot));
    }

    if let Some(block_offset) = transaction.block_offset {
        obj.insert("block_offset".to_string(), json!(block_offset));
    }

    Value::Object(obj)
}

fn format_transaction_header_json(
    header: &thru_client::proto::core::v1::TransactionHeader,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert("version".to_string(), json!(header.version));
    obj.insert("flags".to_string(), json!(header.flags));
    obj.insert(
        "readwrite_accounts_count".to_string(),
        json!(header.readwrite_accounts_count),
    );
    obj.insert(
        "readonly_accounts_count".to_string(),
        json!(header.readonly_accounts_count),
    );
    obj.insert(
        "instruction_data_size".to_string(),
        json!(header.instruction_data_size),
    );
    obj.insert(
        "requested_compute_units".to_string(),
        json!(header.requested_compute_units),
    );
    obj.insert(
        "requested_state_units".to_string(),
        json!(header.requested_state_units),
    );
    obj.insert(
        "requested_memory_units".to_string(),
        json!(header.requested_memory_units),
    );
    obj.insert("expiry_after".to_string(), json!(header.expiry_after));
    obj.insert("fee".to_string(), json!(header.fee));
    obj.insert("nonce".to_string(), json!(header.nonce));
    obj.insert("start_slot".to_string(), json!(header.start_slot));
    obj.insert("chain_id".to_string(), json!(header.chain_id));

    if let Some(signature) = &header.fee_payer_signature {
        obj.insert(
            "fee_payer_signature".to_string(),
            json!(format_signature(&signature.value)),
        );
    }

    if let Some(fee_payer_pubkey) = &header.fee_payer_pubkey {
        obj.insert(
            "fee_payer_pubkey".to_string(),
            json!(format_pubkey(&fee_payer_pubkey.value)),
        );
    }

    if let Some(program_pubkey) = &header.program_pubkey {
        obj.insert(
            "program_pubkey".to_string(),
            json!(format_pubkey(&program_pubkey.value)),
        );
    }

    Value::Object(obj)
}

fn format_transaction_execution_result_json(
    execution_result: &thru_client::proto::core::v1::TransactionExecutionResult,
) -> serde_json::Value {
    use serde_json::{Map, Value, json};

    let mut obj = Map::new();
    obj.insert(
        "consumed_compute_units".to_string(),
        json!(execution_result.consumed_compute_units),
    );
    obj.insert(
        "consumed_memory_units".to_string(),
        json!(execution_result.consumed_memory_units),
    );
    obj.insert(
        "consumed_state_units".to_string(),
        json!(execution_result.consumed_state_units),
    );
    obj.insert(
        "user_error_code".to_string(),
        json!(execution_result.user_error_code),
    );
    obj.insert("vm_error".to_string(), json!(execution_result.vm_error));
    obj.insert(
        "execution_result".to_string(),
        json!(execution_result.execution_result),
    );
    obj.insert("pages_used".to_string(), json!(execution_result.pages_used));
    obj.insert(
        "events_count".to_string(),
        json!(execution_result.events_count),
    );
    obj.insert(
        "events_size".to_string(),
        json!(execution_result.events_size),
    );

    if !execution_result.readwrite_accounts.is_empty() {
        obj.insert(
            "readwrite_accounts".to_string(),
            Value::Array(
                execution_result
                    .readwrite_accounts
                    .iter()
                    .map(|account| json!(format_pubkey(&account.value)))
                    .collect(),
            ),
        );
    }

    if !execution_result.readonly_accounts.is_empty() {
        obj.insert(
            "readonly_accounts".to_string(),
            Value::Array(
                execution_result
                    .readonly_accounts
                    .iter()
                    .map(|account| json!(format_pubkey(&account.value)))
                    .collect(),
            ),
        );
    }

    if !execution_result.events.is_empty() {
        obj.insert(
            "events".to_string(),
            Value::Array(
                execution_result
                    .events
                    .iter()
                    .map(|event| {
                        let mut event_obj = Map::new();
                        event_obj.insert("event_id".to_string(), json!(&event.event_id));
                        event_obj.insert("call_idx".to_string(), json!(event.call_idx));
                        event_obj.insert("program_idx".to_string(), json!(event.program_idx));
                        if let Some(program) = &event.program {
                            event_obj.insert(
                                "program".to_string(),
                                json!(format_pubkey(&program.value)),
                            );
                        }
                        event_obj.insert(
                            "payload_hex".to_string(),
                            json!(hex::encode(&event.payload)),
                        );
                        Value::Object(event_obj)
                    })
                    .collect(),
            ),
        );
    }

    if execution_result.error_program_acc_idx != 0 {
        obj.insert(
            "error_program_acc_idx".to_string(),
            json!(execution_result.error_program_acc_idx),
        );
    }

    Value::Object(obj)
}

fn print_text_output(
    response: &thru_client::proto::services::v1::DebugReExecuteResponse,
    signature_str: &str,
    output_trace: Option<&str>,
) {
    println!("{}", "Transaction Debug".bold().green());
    println!("  {}: {}", "Signature".cyan(), signature_str);

    if let Some(details) = &response.execution_details {
        println!("\n{}", "Execution Details".bold().green());

        let status = if details.fault_code != 0 {
            "Fault".red().to_string()
        } else if details.execution_code != 0 {
            "Reverted".yellow().to_string()
        } else {
            "Success".green().to_string()
        };
        println!("  {}: {}", "Status".cyan(), status);
        println!("  {}: {}", "Execution Code".cyan(), details.execution_code);
        if details.user_error_code != 0 {
            println!(
                "  {}: {}",
                "User Error Code".cyan(),
                details.user_error_code
            );
        }
        println!(
            "  {}: {}",
            "Compute Units".cyan(),
            details.compute_units_consumed
        );
        println!(
            "  {}: {}",
            "State Units".cyan(),
            details.state_units_consumed
        );
        println!("  {}: {}", "Pages Used".cyan(), details.pages_used);
        println!(
            "  {}: {}",
            "Instruction Counter".cyan(),
            details.instruction_counter
        );
        println!(
            "  {}: 0x{:x}",
            "Program Counter".cyan(),
            details.program_counter
        );

        if details.fault_code != 0 {
            println!("\n{}", "Fault Info".bold().red());
            println!(
                "  {}: {} ({})",
                "Fault Code".cyan(),
                details.fault_code,
                fault_label(details.fault_code)
            );
            if details.segv_vaddr != 0 || details.segv_size != 0 {
                println!(
                    "  {}: 0x{:x}",
                    "Segfault Address".cyan(),
                    details.segv_vaddr
                );
                println!("  {}: {}", "Segfault Size".cyan(), details.segv_size);
                println!(
                    "  {}: {}",
                    "Segfault Write".cyan(),
                    if details.segv_write { "yes" } else { "no" }
                );
            }
        }

        println!(
            "  {}: {} / {}",
            "Call Depth".cyan(),
            details.call_depth,
            details.max_call_depth
        );

        if !details.call_frames.is_empty() {
            println!("\n{}", "Call Stack".bold().green());
            for (i, f) in details.call_frames.iter().enumerate() {
                println!(
                    "  [{}] acc_idx={} pc=0x{:x} sp=0x{:x}",
                    i, f.program_acc_idx, f.program_counter, f.stack_pointer
                );
                if !f.saved_registers.is_empty() {
                    println!(
                        "       {}: {:?}",
                        "saved_registers".dimmed(),
                        f.saved_registers
                    );
                }
                if !f.stack_window.is_empty() {
                    println!(
                        "       {}: base=0x{:x} ({} bytes)",
                        "Stack Window".dimmed(),
                        f.stack_window_base,
                        f.stack_window.len()
                    );
                    let preview_len = std::cmp::min(f.stack_window.len(), 64);
                    let hex_str = hex::encode(&f.stack_window[..preview_len]);
                    if f.stack_window.len() > 64 {
                        println!(
                            "       {}... {} more bytes",
                            hex_str,
                            f.stack_window.len() - 64
                        );
                    } else {
                        println!("       {}", hex_str);
                    }
                }
            }
        }
    }

    println!("\n{}", "Captured Output".bold().green());
    if response.stdout.is_empty() {
        println!("  {}: {}", "stdout".cyan(), "(empty)".dimmed());
    } else {
        println!("  {}: {:?}", "stdout".cyan(), response.stdout);
    }
    if response.log.is_empty() {
        println!("  {}: {}", "log".cyan(), "(empty)".dimmed());
    } else {
        println!("  {}: {:?}", "log".cyan(), response.log);
    }
    if response.trace.is_empty() {
        println!("  {}: {}", "trace".cyan(), "(empty)".dimmed());
    } else if let Some(path) = output_trace {
        println!(
            "  {}: ({} bytes) saved to {}",
            "trace".cyan(),
            response.trace.len(),
            path
        );
    } else {
        println!(
            "  {}: ({} bytes, use {} to save)",
            "trace".cyan(),
            response.trace.len(),
            "--output-trace <file>".dimmed()
        );
    }

    if !response.state_before.is_empty() {
        println!("\n{}", "State Before".bold().green());
        for snapshot in &response.state_before {
            print_account_snapshot(snapshot);
        }
    }

    if !response.state_after.is_empty() {
        println!("\n{}", "State After".bold().green());
        for snapshot in &response.state_after {
            print_account_snapshot(snapshot);
        }
    }

    if !response.memory_segments.is_empty() {
        println!("\n{}", "Memory Segments".bold().green());
        for seg in &response.memory_segments {
            let total_page_bytes: usize = seg.pages.iter().map(|p| p.data.len()).sum();
            println!(
                "  {} (type={}): virtual_size={} allocated_pages={} ({} bytes)",
                segment_type_label(seg.segment_type),
                seg.segment_type,
                seg.segment_size,
                seg.pages.len(),
                total_page_bytes
            );
        }
    }
}

fn print_account_snapshot(snapshot: &thru_client::proto::services::v1::AccountSnapshot) {
    let address = snapshot
        .address
        .as_ref()
        .map(|pk| format_pubkey(&pk.value))
        .unwrap_or_else(|| "(unknown)".to_string());

    let exists_str = if snapshot.exists {
        "exists".green()
    } else {
        "does not exist".red()
    };
    println!("  {} [{}]", address.cyan(), exists_str);

    if let Some(meta) = &snapshot.meta {
        println!("    {}: {}", "Balance".dimmed(), meta.balance);
        println!("    {}: {}", "Nonce".dimmed(), meta.nonce);
        println!("    {}: {}", "Data Size".dimmed(), meta.data_size);
        if let Some(owner) = &meta.owner {
            println!("    {}: {}", "Owner".dimmed(), format_pubkey(&owner.value));
        }
        if let Some(flags) = &meta.flags {
            if flags.is_program {
                println!("    {}: {}", "Flags".dimmed(), "program");
            }
        }
    }

    if let Some(data) = &snapshot.data {
        if data.len() <= 64 {
            println!("    {}: {}", "Data".dimmed(), hex::encode(data));
        } else {
            println!(
                "    {}: {}... ({} bytes)",
                "Data".dimmed(),
                hex::encode(&data[..32]),
                data.len()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build_json_output;
    use serde_json::Value;
    use thru_client::proto::{
        common::v1::{Pubkey as ProtoPubkey, Signature as ProtoSignature},
        core::v1::{
            AccountFlags, AccountMeta, Transaction, TransactionExecutionResult, TransactionHeader,
        },
        services::v1::{
            AccountSnapshot, CallFrame, DebugReExecuteResponse, MemoryPage, MemorySegment,
            VmExecutionDetails,
        },
    };

    fn test_pubkey(fill: u8) -> ProtoPubkey {
        ProtoPubkey {
            value: vec![fill; 32],
        }
    }

    fn test_signature(fill: u8) -> ProtoSignature {
        ProtoSignature {
            value: vec![fill; 64],
        }
    }

    fn sample_response() -> DebugReExecuteResponse {
        DebugReExecuteResponse {
            transaction: Some(Transaction {
                signature: Some(test_signature(0x11)),
                header: Some(TransactionHeader {
                    fee_payer_signature: Some(test_signature(0x12)),
                    version: 1,
                    flags: 2,
                    readwrite_accounts_count: 3,
                    readonly_accounts_count: 4,
                    instruction_data_size: 5,
                    requested_compute_units: 6,
                    requested_state_units: 7,
                    requested_memory_units: 8,
                    expiry_after: 9,
                    fee: 10,
                    nonce: 11,
                    start_slot: 12,
                    fee_payer_pubkey: Some(test_pubkey(0x21)),
                    program_pubkey: Some(test_pubkey(0x22)),
                    chain_id: 13,
                }),
                body: Some(vec![0xde, 0xad, 0xbe, 0xef]),
                execution_result: Some(TransactionExecutionResult {
                    consumed_compute_units: 100,
                    consumed_memory_units: 101,
                    consumed_state_units: 102,
                    user_error_code: 103,
                    vm_error: -765,
                    execution_result: 104,
                    pages_used: 105,
                    events_count: 1,
                    events_size: 4,
                    readwrite_accounts: vec![test_pubkey(0x31)],
                    readonly_accounts: vec![test_pubkey(0x32)],
                    events: vec![],
                    error_program_acc_idx: 2,
                }),
                slot: Some(42),
                block_offset: Some(7),
            }),
            stdout: "hello".to_string(),
            log: "log line".to_string(),
            trace: "trace line".to_string(),
            execution_details: Some(VmExecutionDetails {
                execution_code: 1,
                user_error_code: 2,
                compute_units_consumed: 3,
                state_units_consumed: 4,
                pages_used: 5,
                program_counter: 6,
                instruction_counter: 7,
                fault_code: 1,
                segv_vaddr: 0xdead,
                segv_size: 1,
                segv_write: true,
                registers: vec![10, 11, 12],
                call_depth: 2,
                max_call_depth: 3,
                call_frames: vec![CallFrame {
                    program_acc_idx: 9,
                    program_counter: 10,
                    stack_pointer: 11,
                    saved_registers: vec![12, 13],
                    stack_window: vec![0xaa, 0xbb],
                    stack_window_base: 14,
                }],
            }),
            state_before: vec![AccountSnapshot {
                address: Some(test_pubkey(0x41)),
                meta: Some(AccountMeta {
                    version: 7,
                    flags: Some(AccountFlags {
                        is_program: false,
                        is_privileged: true,
                        is_uncompressable: false,
                        is_ephemeral: true,
                        is_deleted: false,
                        is_new: true,
                        is_compressed: false,
                    }),
                    data_size: 8,
                    seq: 9,
                    owner: Some(test_pubkey(0x42)),
                    balance: 10,
                    nonce: 11,
                    last_updated_slot: Some(12),
                }),
                data: Some(vec![0x01, 0x02, 0x03]),
                exists: true,
            }],
            state_after: vec![],
            memory_segments: vec![MemorySegment {
                segment_type: 5,
                segment_size: 4096,
                pages: vec![MemoryPage {
                    page_index: 0,
                    data: vec![0xff, 0x00],
                }],
            }],
        }
    }

    #[test]
    fn json_output_stays_compact_by_default_but_preserves_metadata() {
        let output = build_json_output(
            &sample_response(),
            "ts-test-signature",
            Some("/tmp/trace.log"),
            false,
        );

        let inner = output
            .get("txn_debug")
            .and_then(Value::as_object)
            .expect("wrapped debug response");

        assert_eq!(inner.get("trace_bytes").and_then(Value::as_u64), Some(10));
        assert!(
            inner.get("trace").is_none(),
            "trace should stay compact by default"
        );
        assert_eq!(
            inner.get("trace_file").and_then(Value::as_str),
            Some("/tmp/trace.log")
        );
        assert_eq!(
            inner.get("error_program_acc_idx").and_then(Value::as_u64),
            Some(2)
        );
        assert_eq!(
            inner.get("segv_vaddr").and_then(Value::as_str),
            Some("0xdead")
        );

        let snapshot = inner
            .get("state_before")
            .and_then(Value::as_array)
            .and_then(|snapshots| snapshots.first())
            .expect("state snapshot");
        assert_eq!(snapshot.get("balance").and_then(Value::as_u64), Some(10));
        assert_eq!(
            snapshot
                .get("meta")
                .and_then(|meta| meta.get("version"))
                .and_then(Value::as_u64),
            Some(7)
        );
        assert_eq!(
            snapshot
                .get("meta")
                .and_then(|meta| meta.get("last_updated_slot"))
                .and_then(Value::as_u64),
            Some(12)
        );
        assert_eq!(
            snapshot
                .get("meta")
                .and_then(|meta| meta.get("flags"))
                .and_then(|flags| flags.get("is_privileged"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            snapshot.get("data_hex").and_then(Value::as_str),
            Some("010203")
        );

        let transaction = inner.get("transaction").expect("transaction payload");
        assert_eq!(
            transaction
                .get("execution_result")
                .and_then(|result| result.get("error_program_acc_idx"))
                .and_then(Value::as_u64),
            Some(2)
        );
    }

    #[test]
    fn json_output_inlines_trace_when_requested() {
        let output = build_json_output(
            &sample_response(),
            "ts-test-signature",
            Some("/tmp/trace.log"),
            true,
        );

        let inner = output
            .get("txn_debug")
            .and_then(Value::as_object)
            .expect("wrapped debug response");

        assert_eq!(
            inner.get("trace").and_then(Value::as_str),
            Some("trace line")
        );
        assert_eq!(
            inner
                .get("execution_details")
                .and_then(|details| details.get("call_frames"))
                .and_then(Value::as_array)
                .and_then(|frames| frames.first())
                .and_then(|frame| frame.get("stack_window"))
                .and_then(Value::as_str),
            Some("aabb")
        );
    }
}
