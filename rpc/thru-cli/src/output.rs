//! Output formatting utilities for the Thru CLI

use colored::*;
use serde_json::{Value, json};
use std::collections::HashMap;

/// Output format options
#[derive(Debug, Clone)]
pub enum OutputFormat {
    /// JSON output format
    Json,
    /// Human-readable text format
    Text,
}

/// Format and print output based on the JSON flag
pub fn print_output(data: Value, json_format: bool) {
    if json_format {
        println!(
            "{}",
            serde_json::to_string_pretty(&data).unwrap_or_else(|_| "{}".to_string())
        );
    } else {
        print_human_readable(&data);
    }
}

/// Print data in human-readable format
fn print_human_readable(data: &Value) {
    match data {
        Value::Object(map) => {
            for (key, value) in map {
                match key.as_str() {
                    "version" => print_version_info(value),
                    "health" => print_health_info(value),
                    "account_info" => print_account_info(value),
                    "balance" => print_balance_info(value),
                    "transfer" => print_transfer_info(value),
                    "program_upload" => print_program_upload_info(value),
                    "program_cleanup" => print_program_cleanup_info(value),
                    "keys" => print_keys_info(value),
                    "account_create" => print_account_create_info(value),
                    "account_transactions" => print_account_transactions(value),
                    _ => println!("{}: {}", key.cyan(), format_value(value)),
                }
            }
        }
        _ => println!("{}", format_value(data)),
    }
}

/// Format large numbers in a compact way, with underscores as thousands separators
fn format_number(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    let chars = s.chars().rev().collect::<Vec<_>>();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push('_');
        }
        out.push(*c);
    }
    out.chars().rev().collect()
}

/// Format a JSON value for human-readable output
fn format_value(value: &Value) -> String {
    format_value_ext(value, false)
}

/// Format a JSON value for human-readable output
fn format_value_ext(value: &Value, thousand_separator: bool) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if thousand_separator {
                format_number(n.as_u64().unwrap_or(0))
            } else {
                n.to_string()
            }
        }
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => format!(
            "[{}]",
            arr.iter().map(format_value).collect::<Vec<_>>().join(", ")
        ),
        Value::Object(_) => {
            serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string())
        }
    }
}

/// Print version information
fn print_version_info(data: &Value) {
    if let Value::Object(version_data) = data {
        println!("{}", "Version Information".bold().green());

        if let Some(thru_node) = version_data.get("thru-node") {
            println!("  {}: {}", "Thru Node".cyan(), format_value(thru_node));
        }

        if let Some(thru_rpc) = version_data.get("thru-rpc") {
            println!("  {}: {}", "Thru RPC".cyan(), format_value(thru_rpc));
        }
    }
}

/// Print health information
fn print_health_info(data: &Value) {
    match data {
        Value::String(status) if status == "ok" => {
            println!("{}", "Node is healthy".bold().green());
        }
        Value::Object(error_data) => {
            println!("{}", "Node is unhealthy".bold().red());

            if let Some(message) = error_data.get("message") {
                println!("  {}: {}", "Reason".cyan(), format_value(message));
            }

            if let Some(data) = error_data.get("data") {
                if let Value::Object(data_obj) = data {
                    if let Some(slots_behind) = data_obj.get("numSlotsBehind") {
                        println!(
                            "  {}: {}",
                            "Slots Behind".cyan(),
                            format_value(slots_behind)
                        );
                    }
                }
            }
        }
        _ => println!("Health status: {}", format_value(data)),
    }
}

/// Print account information
fn print_account_info(data: &Value) {
    if let Value::Object(account_data) = data {
        println!("{}", "Account Information".bold().green());

        if let Some(pubkey) = account_data.get("pubkey") {
            println!("  {}: {}", "Public Key".cyan(), format_value(pubkey));
        }

        if let Some(balance) = account_data.get("balance") {
            println!(
                "  {}: {}",
                "Balance".cyan(),
                format_value_ext(balance, true)
            );
        }

        if let Some(owner) = account_data.get("owner") {
            println!("  {}: {}", "Owner".cyan(), format_value(owner));
        }

        if let Some(data_size) = account_data.get("dataSize") {
            println!("  {}: {}", "Data Size".cyan(), format_value(data_size));
        }

        if let Some(nonce) = account_data.get("nonce") {
            println!("  {}: {}", "Nonce".cyan(), format_value(nonce));
        }

        if let Some(state_counter) = account_data.get("stateCounter") {
            println!(
                "  {}: {}",
                "State Counter".cyan(),
                format_value(state_counter)
            );
        }

        if let Some(program) = account_data.get("program") {
            let is_program = program.as_bool().unwrap_or(false);
            println!(
                "  {}: {}",
                "Is Program".cyan(),
                if is_program {
                    "Yes".green()
                } else {
                    "No".red()
                }
            );
        }
        if let Some(is_new) = account_data.get("isNew") {
            let is_new = is_new.as_bool().unwrap_or(false);
            println!(
                "  {}: {}",
                "Is New".cyan(),
                if is_new { "Yes".green() } else { "No".red() }
            );
        }
    }
}

/// Print account creation information
fn print_account_create_info(data: &Value) {
    if let Value::Object(account_create_data) = data {
        println!("{}", "Account Creation".bold().green());

        if let Some(key_name) = account_create_data.get("key_name") {
            println!("  {}: {}", "Key Name".cyan(), format_value(key_name));
        }

        if let Some(public_key) = account_create_data.get("public_key") {
            println!("  {}: {}", "Public Key".cyan(), format_value(public_key));
        }

        if let Some(signature) = account_create_data.get("signature") {
            println!("  {}: {}", "Signature".cyan(), format_value(signature));
        }

        if let Some(status) = account_create_data.get("status") {
            let status_str = format_value(status);
            let colored_status = match status_str.as_str() {
                "success" => status_str.green(),
                "failed" => status_str.red(),
                _ => status_str.normal(),
            };
            println!("  {}: {}", "Status".cyan(), colored_status);
        }
    }
}

/// Print account transaction signatures
fn print_account_transactions(data: &Value) {
    if let Value::Object(tx_data) = data {
        println!("{}", "Account Transactions".bold().green());

        if let Some(account) = tx_data.get("account") {
            println!("  {}: {}", "Account".cyan(), format_value(account));
        }

        match tx_data.get("signatures").and_then(|value| value.as_array()) {
            Some(signatures) if signatures.is_empty() => {
                println!("  {}", "No transactions found.".italic());
            }
            Some(signatures) => {
                println!("  {}:", "Signatures".cyan());
                for (idx, sig) in signatures.iter().enumerate() {
                    println!("    {:>2}. {}", idx + 1, format_value(sig));
                }
            }
            None => {
                println!("  {}", "No transactions found.".italic());
            }
        }

        if let Some(Value::String(token)) = tx_data.get("nextPageToken") {
            if !token.is_empty() {
                println!("  {}: {}", "Next Page Token".cyan(), token);
            }
        }
    }
}

/// Print balance information
fn print_balance_info(data: &Value) {
    if let Value::Object(balance_data) = data {
        if let Some(pubkey) = balance_data.get("pubkey") {
            println!("{}: {}", "Account".cyan(), format_value(pubkey));
        }

        if let Some(balance) = balance_data.get("balance") {
            println!(
                "{}: {}",
                "Balance".bold().green(),
                format_value_ext(balance, true)
            );
        }
    } else {
        println!(
            "{}: {}",
            "Balance".bold().green(),
            format_value_ext(data, true)
        );
    }
}

/// Print program upload information
fn print_program_upload_info(data: &Value) {
    if let Value::Object(upload_data) = data {
        println!("{}", "Program Upload".bold().green());

        if let Some(status) = upload_data.get("status") {
            let status_str = format_value(status);
            let colored_status = match status_str.as_str() {
                "success" => status_str.green(),
                "failed" => status_str.red(),
                "in_progress" => status_str.yellow(),
                _ => status_str.normal(),
            };
            println!("  {}: {}", "Status".cyan(), colored_status);
        }

        if let Some(transactions) = upload_data.get("total_transactions") {
            println!(
                "  {}: {}",
                "Total Transactions".cyan(),
                format_value(transactions)
            );
        }

        if let Some(completed) = upload_data.get("completed_transactions") {
            println!("  {}: {}", "Completed".cyan(), format_value(completed));
        }

        if let Some(program_size) = upload_data.get("program_size") {
            println!(
                "  {}: {} bytes",
                "Program Size".cyan(),
                format_value(program_size)
            );
        }

        if let Some(meta_account) = upload_data.get("meta_account") {
            println!(
                "  {}: {}",
                "Meta Account".cyan(),
                format_value(meta_account)
            );
        }

        if let Some(buffer_account) = upload_data.get("buffer_account") {
            println!(
                "  {}: {}",
                "Buffer Account".cyan(),
                format_value(buffer_account)
            );
        }
    }
}

/// Print program cleanup information
fn print_program_cleanup_info(data: &Value) {
    if let Value::Object(cleanup_data) = data {
        println!("{}", "Program Cleanup".bold().green());

        if let Some(status) = cleanup_data.get("status") {
            let status_str = format_value(status);
            let colored_status = match status_str.as_str() {
                "success" => status_str.green(),
                "failed" => status_str.red(),
                _ => status_str.normal(),
            };
            println!("  {}: {}", "Status".cyan(), colored_status);
        }

        if let Some(message) = cleanup_data.get("message") {
            println!("  {}: {}", "Message".cyan(), format_value(message));
        }
    }
}

/// Print keys information
fn print_keys_info(data: &Value) {
    if let Value::Object(keys_data) = data {
        // Handle keys list
        if let Some(list) = keys_data.get("list") {
            if let Value::Array(key_names) = list {
                println!("{}", "Available Keys".bold().green());
                for key_name in key_names {
                    println!("  {}", format_value(key_name));
                }
            }
        }

        // Handle keys operations
        if let Some(operation) = keys_data.get("operation") {
            let op_str = format_value(operation);

            if let Some(name) = keys_data.get("name") {
                let name_str = format_value(name);

                match op_str.as_str() {
                    "add" => println!(
                        "{}: Key '{}' added to configuration",
                        "Success".bold().green(),
                        name_str
                    ),
                    "get" => {
                        if let Some(value) = keys_data.get("value") {
                            println!("Key '{}': {}", name_str.cyan(), format_value(value));
                        }
                    }
                    "generate" => {
                        if let Some(value) = keys_data.get("value") {
                            println!(
                                "Generated key '{}': {}",
                                name_str.cyan(),
                                format_value(value)
                            );
                            println!(
                                "{}: Key '{}' added to configuration",
                                "Success".bold().green(),
                                name_str
                            );
                        }
                    }
                    "remove" => println!(
                        "{}: Key '{}' removed from configuration",
                        "Success".bold().green(),
                        name_str
                    ),
                    _ => println!(
                        "{}: Operation '{}' on key '{}'",
                        "Info".bold().blue(),
                        op_str,
                        name_str
                    ),
                }
            }
        }
    }
}

/// Print transfer information
fn print_transfer_info(data: &Value) {
    if let Value::Object(transfer_data) = data {
        println!("{}", "Transfer Information".bold().green());

        if let Some(src) = transfer_data.get("src") {
            println!("  {}: {}", "Source".cyan(), format_value(src));
        }

        if let Some(dst) = transfer_data.get("dst") {
            println!("  {}: {}", "Destination".cyan(), format_value(dst));
        }

        if let Some(value) = transfer_data.get("value") {
            println!("  {}: {}", "Value".cyan(), format_value(value));
        }

        if let Some(signature) = transfer_data.get("signature") {
            println!("  {}: {}", "Signature".cyan(), format_value(signature));
        }

        if let Some(status) = transfer_data.get("status") {
            let status_str = format_value(status);
            let colored_status = match status_str.as_str() {
                "success" => status_str.green(),
                "failed" => status_str.red(),
                _ => status_str.normal(),
            };
            println!("  {}: {}", "Status".cyan(), colored_status);
        }
    }
}

/// Print error message
pub fn print_error(error: &str) {
    eprintln!("{}: {}", "Error".bold().red(), error);
}

/// Print warning message
pub fn print_warning(warning: &str) {
    eprintln!("{}: {}", "Warning".bold().yellow(), warning);
}

/// Print success message
pub fn print_success(message: &str) {
    println!("{}: {}", "Success".bold().green(), message);
}

/// Print info message
pub fn print_info(message: &str) {
    println!("{}: {}", "Info".bold().blue(), message);
}

/// Create a JSON response for version information
pub fn create_version_response(thru_node: &str, thru_rpc: &str) -> Value {
    json!({
        "getversion": {
            "status": "success",
            "thru-node": thru_node,
            "thru-rpc": thru_rpc
        }
    })
}

/// Create a JSON response for health information
pub fn create_health_response(status: &str) -> Value {
    json!({
        "gethealth": {
            "status": status
        }
    })
}

/// Create a JSON response for account information
pub fn create_account_info_response(account_data: HashMap<String, Value>) -> Value {
    json!({
        "account_info": account_data
    })
}

/// Create a JSON response for account transaction listings
pub fn create_account_transactions_response(
    account: &str,
    signatures: Vec<String>,
    next_page_token: Option<String>,
) -> Value {
    let mut response = json!({
        "account_transactions": {
            "account": account,
            "signatures": signatures,
        }
    });

    if let Some(token) = next_page_token {
        if let Some(obj) = response
            .get_mut("account_transactions")
            .and_then(|value| value.as_object_mut())
        {
            obj.insert("nextPageToken".to_string(), json!(token));
        }
    }

    response
}

/// Create a JSON response for balance information
pub fn create_balance_response(pubkey: &str, balance: u64) -> Value {
    json!({
        "balance": {
            "pubkey": pubkey,
            "balance": balance
        }
    })
}

/// Create a JSON response for program upload
pub fn create_program_upload_response(
    status: &str,
    total_transactions: usize,
    completed_transactions: usize,
    program_size: usize,
    meta_account: Option<&str>,
    buffer_account: Option<&str>,
) -> Value {
    let mut response = json!({
        "program_upload": {
            "status": status,
            "total_transactions": total_transactions,
            "completed_transactions": completed_transactions,
            "program_size": program_size
        }
    });

    if let Some(meta) = meta_account {
        response["program_upload"]["meta_account"] = json!(meta);
    }

    if let Some(buffer) = buffer_account {
        response["program_upload"]["buffer_account"] = json!(buffer);
    }

    response
}

/// Create a JSON response for program cleanup
pub fn create_program_cleanup_response(status: &str, message: &str) -> Value {
    json!({
        "program_cleanup": {
            "status": status,
            "message": message
        }
    })
}

/// Create a JSON response for keys list
pub fn create_keys_list_response(key_names: Vec<String>) -> Value {
    json!({
        "keys": {
            "list": key_names
        }
    })
}

/// Create a JSON response for transfer operations
pub fn create_transfer_response(
    src: &str,
    dst: &str,
    value: u64,
    signature: &str,
    status: &str,
) -> Value {
    json!({
        "transfer": {
            "src": src,
            "dst": dst,
            "value": value,
            "signature": signature,
            "status": status
        }
    })
}

/// Create a JSON response for keys operations
pub fn create_keys_operation_response(
    operation: &str,
    name: &str,
    status: &str,
    value: Option<&str>,
) -> Value {
    let mut response = json!({
        "keys": {
            "operation": operation,
            "name": name,
            "status": status
        }
    });

    if let Some(key_value) = value {
        response["keys"]["value"] = json!(key_value);
    }

    response
}

/// Create a JSON response for account creation operations
pub fn create_account_create_response(
    key_name: &str,
    public_key: &str,
    signature: &str,
    status: &str,
) -> Value {
    json!({
        "account_create": {
            "key_name": key_name,
            "public_key": public_key,
            "signature": signature,
            "status": status
        }
    })
}
