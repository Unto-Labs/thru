//! Debug commands for transaction analysis

mod resolve;
mod variables;

use crate::cli::DebugCommands;
use crate::config::Config;
use crate::error::CliError;
use crate::output;
use colored::*;
use std::time::Duration;
use thru_base::tn_tools::Pubkey;
use thru_client::{Client, ClientBuilder};

/// Handle debug-related commands
pub async fn handle_debug_command(
    config: &Config,
    subcommand: DebugCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        DebugCommands::ReExecute {
            signature,
            include_state_before,
            include_state_after,
            include_account_data,
            output_trace,
            include_memory_dump,
        } => {
            debug_re_execute(
                config,
                &signature,
                include_state_before,
                include_state_after,
                include_account_data,
                include_memory_dump,
                output_trace.as_deref(),
                json_format,
            )
            .await
        }
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

/// Re-execute a transaction in a simulated environment
async fn debug_re_execute(
    config: &Config,
    signature_str: &str,
    include_state_before: bool,
    include_state_after: bool,
    include_account_data: bool,
    include_memory_dump: bool,
    output_trace: Option<&str>,
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
        .map_err(|e| CliError::Rpc(format!("debug re-execute failed: {}", e)))?;

    if let Some(path) = output_trace {
        if !response.trace.is_empty() {
            std::fs::write(path, &response.trace).map_err(|e| {
                CliError::Generic {
                    message: format!("Failed to write trace to {}: {}", path, e),
                }
            })?;
        }
    }

    if json_format {
        print_json_output(&response, signature_str, output_trace);
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
) {
    use serde_json::json;

    let exec = response.execution_details.as_ref();

    let mut result = json!({
        "debug_re_execute": {
            "signature": signature_str,
            "stdout": &response.stdout,
            "log": &response.log,
            "trace_bytes": response.trace.len(),
        }
    });

    if let Some(path) = output_trace {
        if !response.trace.is_empty() {
            let obj = result.get_mut("debug_re_execute").unwrap().as_object_mut().unwrap();
            obj.insert("trace_file".to_string(), json!(path));
        }
    }

    if let Some(details) = exec {
        let obj = result.get_mut("debug_re_execute").unwrap().as_object_mut().unwrap();
        obj.insert("execution_code".to_string(), json!(details.execution_code));
        obj.insert("user_error_code".to_string(), json!(details.user_error_code));
        obj.insert("compute_units_consumed".to_string(), json!(details.compute_units_consumed));
        obj.insert("state_units_consumed".to_string(), json!(details.state_units_consumed));
        obj.insert("pages_used".to_string(), json!(details.pages_used));
        obj.insert("program_counter".to_string(), json!(details.program_counter));
        obj.insert("instruction_counter".to_string(), json!(details.instruction_counter));
        obj.insert("fault_code".to_string(), json!(details.fault_code));
        obj.insert("fault_code_label".to_string(), json!(fault_label(details.fault_code)));
        if details.segv_vaddr != 0 || details.segv_size != 0 {
            obj.insert("segv_vaddr".to_string(), json!(format!("0x{:x}", details.segv_vaddr)));
            obj.insert("segv_size".to_string(), json!(details.segv_size));
            obj.insert("segv_write".to_string(), json!(details.segv_write));
        }
        obj.insert("call_depth".to_string(), json!(details.call_depth));
        obj.insert("max_call_depth".to_string(), json!(details.max_call_depth));
        if !details.registers.is_empty() {
            obj.insert("registers".to_string(), json!(details.registers));
        }
        if !details.call_frames.is_empty() {
            let frames: Vec<_> = details.call_frames.iter().map(|f| {
                let mut frame = json!({
                    "program_acc_idx": f.program_acc_idx,
                    "program_counter": f.program_counter,
                    "stack_pointer": f.stack_pointer,
                    "saved_registers": f.saved_registers,
                });
                if !f.stack_window.is_empty() {
                    let frame_obj = frame.as_object_mut().unwrap();
                    frame_obj.insert("stack_window".to_string(), json!(hex::encode(&f.stack_window)));
                    frame_obj.insert("stack_window_base".to_string(), json!(f.stack_window_base));
                }
                frame
            }).collect();
            obj.insert("call_frames".to_string(), json!(frames));
        }
    }

    if !response.state_before.is_empty() {
        let snapshots: Vec<_> = response.state_before.iter().map(format_snapshot_json).collect();
        let obj = result.get_mut("debug_re_execute").unwrap().as_object_mut().unwrap();
        obj.insert("state_before".to_string(), json!(snapshots));
    }

    if !response.state_after.is_empty() {
        let snapshots: Vec<_> = response.state_after.iter().map(format_snapshot_json).collect();
        let obj = result.get_mut("debug_re_execute").unwrap().as_object_mut().unwrap();
        obj.insert("state_after".to_string(), json!(snapshots));
    }

    if !response.memory_segments.is_empty() {
        let segments: Vec<_> = response.memory_segments.iter().map(|seg| {
            let pages: Vec<_> = seg.pages.iter().map(|p| {
                json!({
                    "page_index": p.page_index,
                    "data_hex": hex::encode(&p.data),
                })
            }).collect();
            json!({
                "segment_type": seg.segment_type,
                "segment_type_label": segment_type_label(seg.segment_type),
                "segment_size": seg.segment_size,
                "pages": pages,
            })
        }).collect();
        let obj = result.get_mut("debug_re_execute").unwrap().as_object_mut().unwrap();
        obj.insert("memory_segments".to_string(), json!(segments));
    }

    output::print_output(result, true);
}

fn format_snapshot_json(
    snapshot: &thru_client::proto::services::v1::AccountSnapshot,
) -> serde_json::Value {
    use serde_json::json;

    let address = snapshot
        .address
        .as_ref()
        .map(|pk| format_pubkey(&pk.value))
        .unwrap_or_default();

    let mut obj = json!({
        "address": address,
        "exists": snapshot.exists,
    });

    if let Some(meta) = &snapshot.meta {
        let meta_obj = obj.as_object_mut().unwrap();
        meta_obj.insert("balance".to_string(), json!(meta.balance));
        meta_obj.insert("nonce".to_string(), json!(meta.nonce));
        meta_obj.insert("data_size".to_string(), json!(meta.data_size));
        meta_obj.insert("seq".to_string(), json!(meta.seq));
        if let Some(owner) = &meta.owner {
            meta_obj.insert("owner".to_string(), json!(format_pubkey(&owner.value)));
        }
        if let Some(flags) = &meta.flags {
            meta_obj.insert("is_program".to_string(), json!(flags.is_program));
        }
    }

    if let Some(data) = &snapshot.data {
        let obj_map = obj.as_object_mut().unwrap();
        obj_map.insert("data_hex".to_string(), json!(hex::encode(data)));
    }

    obj
}

fn print_text_output(
    response: &thru_client::proto::services::v1::DebugReExecuteResponse,
    signature_str: &str,
    output_trace: Option<&str>,
) {
    println!("{}", "Debug Re-Execute".bold().green());
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
            println!("  {}: {}", "User Error Code".cyan(), details.user_error_code);
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
            println!("  {}: {} ({})", "Fault Code".cyan(), details.fault_code, fault_label(details.fault_code));
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

fn print_account_snapshot(
    snapshot: &thru_client::proto::services::v1::AccountSnapshot,
) {
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
