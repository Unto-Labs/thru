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
                    "networks" => print_networks_info(value),
                    "account_create" => print_account_create_info(value),
                    "account_transactions" => print_account_transactions(value),
                    "auth" => match format_auth_pending(value) {
                        Some(text) => print!("{text}"),
                        None => println!("{}: {}", key.cyan(), format_value(value)),
                    },
                    "auth_keys" => print!("{}", format_auth_keys(value)),
                    "auth_key" => print!("{}", format_auth_key(value)),
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

        if let Some(seq) = account_data.get("seq") {
            println!("  {}: {}", "Seq".cyan(), format_value(seq));
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
        if let Some(is_ephemeral) = account_data.get("isEphemeral") {
            let is_ephemeral = is_ephemeral.as_bool().unwrap_or(false);
            println!(
                "  {}: {}",
                "Is Ephemeral".cyan(),
                if is_ephemeral {
                    "Yes".green()
                } else {
                    "No".red()
                }
            );
        }
        if let Some(is_deleted) = account_data.get("isDeleted") {
            let is_deleted = is_deleted.as_bool().unwrap_or(false);
            println!(
                "  {}: {}",
                "Is Deleted".cyan(),
                if is_deleted {
                    "Yes".yellow()
                } else {
                    "No".green()
                }
            );
        }
        if let Some(is_privileged) = account_data.get("isPrivileged") {
            let is_privileged = is_privileged.as_bool().unwrap_or(false);
            println!(
                "  {}: {}",
                "Is Privileged".cyan(),
                if is_privileged {
                    "Yes".green()
                } else {
                    "No".red()
                }
            );
        }

        if let Some(slot) = account_data.get("slot") {
            println!("  {}: {}", "Slot".cyan(), format_value(slot));
        }

        if let Some(timestamp) = account_data.get("blockTimestamp") {
            let formatted_timestamp = if let Some(ts_str) = timestamp.as_str() {
                // Parse the timestamp string (format: "seconds.nanoseconds")
                if let Some((secs_str, _nanos_str)) = ts_str.split_once('.') {
                    if let Ok(secs) = secs_str.parse::<i64>() {
                        if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
                            dt.format("%Y-%m-%d %H:%M:%S UTC").to_string()
                        } else {
                            format_value(timestamp)
                        }
                    } else {
                        format_value(timestamp)
                    }
                } else {
                    format_value(timestamp)
                }
            } else {
                format_value(timestamp)
            };
            println!("  {}: {}", "Block Timestamp".cyan(), formatted_timestamp);
        }

        // Display hex data if present
        if let Some(data_hex) = account_data.get("dataHex") {
            let hex_str = format_value(data_hex);
            if !hex_str.is_empty() {
                println!("  {}: {}", "Data (Hex)".cyan(), hex_str.bright_yellow());

                if let Some(start) = account_data.get("dataHexStart") {
                    println!("  {}: {}", "  Data Start".cyan(), format_value(start));
                }

                if let Some(len) = account_data.get("dataHexLen") {
                    println!("  {}: {} bytes", "  Data Length".cyan(), format_value(len));
                }
            }
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
/// Text for a pending `thru auth login --no-wait`; `None` for other `auth`
/// results, which print as JSON.
fn format_auth_pending(data: &Value) -> Option<String> {
    if data.get("status").and_then(Value::as_str) != Some("pending") {
        return None;
    }
    let text = |field: &str| data.get(field).map(format_value).unwrap_or_default();
    Some(format!(
        "Open this URL to approve the CLI login:\n  {}\nCode: {} (expires in {} seconds)\nThen run: {}\n",
        text("verification_uri_complete"),
        text("user_code"),
        text("expires_in"),
        text("next"),
    ))
}

/// Text for rate limits; `None` (no limit profile) prints as the default.
fn format_rate_limits(limits: Option<&Value>) -> String {
    match limits {
        Some(limits @ Value::Object(_)) => format!(
            "{} weighted requests/s, {} bytes/s",
            limits
                .get("weighted_rps")
                .map(format_value)
                .unwrap_or_default(),
            limits
                .get("bytes_per_sec")
                .map(format_value)
                .unwrap_or_default(),
        ),
        _ => "default".to_string(),
    }
}

/// Text table for `thru auth keys list`.
fn format_auth_keys(data: &Value) -> String {
    let field = |value: &Value, name: &str| -> String {
        match value.get(name) {
            None | Some(Value::Null) => "-".to_string(),
            Some(Value::Array(items)) if items.is_empty() => "-".to_string(),
            Some(Value::Array(items)) => {
                items.iter().map(format_value).collect::<Vec<_>>().join(",")
            }
            Some(value) => format_value(value),
        }
    };
    let organization = data.get("organization").cloned().unwrap_or(Value::Null);
    let mut out = format!(
        "Organization: {} ({})\nLimits: {}\n",
        field(&organization, "name"),
        field(&organization, "id"),
        format_rate_limits(data.get("organization_limits")),
    );
    let keys = data
        .get("keys")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if keys.is_empty() {
        out.push_str("No API keys. Create one with `thru auth keys create --name <NAME>`.\n");
        return out;
    }
    let header = ["ID", "NAME", "PREFIX", "MACHINE", "ORIGINS", "LAST USED"];
    let rows: Vec<[String; 6]> = keys
        .iter()
        .map(|key| {
            [
                field(key, "id"),
                field(key, "name"),
                field(key, "prefix"),
                field(key, "cli_machine"),
                field(key, "origin_allowlist"),
                field(key, "last_used_at"),
            ]
        })
        .collect();
    let mut widths = header.map(str::len);
    for row in &rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    let line = |cells: &[String]| -> String {
        let mut line = cells
            .iter()
            .zip(widths)
            .map(|(cell, width)| format!("{cell:<width$}"))
            .collect::<Vec<_>>()
            .join("  ");
        line.truncate(line.trim_end().len());
        line.push('\n');
        line
    };
    out.push('\n');
    out.push_str(&line(&header.map(str::to_string)));
    for row in &rows {
        out.push_str(&line(row));
    }
    out
}

/// Text for `thru auth keys create` (the new key, with its plaintext once)
/// and `thru auth keys revoke`.
fn format_auth_key(data: &Value) -> String {
    let text = |value: Option<&Value>| value.map(format_value).unwrap_or_default();
    if data.get("status").and_then(Value::as_str) == Some("revoked") {
        return format!("Revoked API key {}.\n", text(data.get("id")));
    }
    let key = data.get("key");
    let mut out = format!(
        "Created API key \"{}\" (id {}, prefix {})",
        text(key.and_then(|key| key.get("name"))),
        text(key.and_then(|key| key.get("id"))),
        text(key.and_then(|key| key.get("prefix"))),
    );
    if let Some(name) = data.pointer("/organization/name") {
        out.push_str(&format!(" in organization \"{}\"", format_value(name)));
    }
    out.push_str(&format!(".\n\n{}\n", text(data.get("plaintext"))));
    out
}

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

/// Print upload information
fn print_program_upload_info(data: &Value) {
    if let Value::Object(upload_data) = data {
        println!("{}", "Upload".bold().green());

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
                "Payload Size".cyan(),
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

/// Print uploader cleanup information
fn print_program_cleanup_info(data: &Value) {
    if let Value::Object(cleanup_data) = data {
        println!("{}", "Uploader Cleanup".bold().green());

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

/// Print the result of `keys move`: public metadata and references only.
fn print_keys_move(data: &Value) {
    let to = format_value(&data["to"]);
    let moved = data["moved"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    if moved.is_empty() {
        println!("No signing keys moved");
    } else {
        println!("Moved {} signing key(s) to {to}", moved.len());
        for item in moved {
            println!(
                "  {}: {} -> {}",
                format_value(&item["name"]).bold(),
                format_value(&item["from"]),
                format_value(&item["reference"])
            );
        }
    }
    let unchanged: Vec<String> = data["unchanged"]
        .as_array()
        .map(|names| names.iter().map(format_value).collect())
        .unwrap_or_default();
    if !unchanged.is_empty() {
        println!("Already in {to}: {}", unchanged.join(", "));
    }
    for item in data["previous"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let reference = format_value(&item["reference"]);
        if item["status"] == "deleted" {
            println!("Deleted old copy {reference}");
        } else if let Some(error) = item.get("error") {
            eprintln!("Kept old copy {reference}: {}", format_value(error));
        } else {
            println!(
                "Kept old copy {reference} (an external file, or still used by another alias)"
            );
        }
    }
}

/// Print only public signing-key metadata.
fn print_keys_info(data: &Value) {
    if data.get("operation").and_then(Value::as_str) == Some("move") {
        print_keys_move(data);
        return;
    }
    if let Some(entries) = data.get("entries").and_then(Value::as_array) {
        println!("{}", "Signing Keys".bold().green());
        if entries.is_empty() {
            println!("  (none)");
        }
        for entry in entries {
            print_key_entry(entry);
        }
        if let Some(unmigrated) = data.get("unmigrated").and_then(Value::as_array) {
            println!(
                "{}",
                "Not migrated (stored inline in config)".bold().yellow()
            );
            for name in unmigrated {
                println!("  {}", format_value(name).bold());
            }
            println!("  Run 'thru keys migrate' to use these keys.");
        }
    } else if data.get("name").is_some() {
        if data.get("operation").and_then(Value::as_str) == Some("remove") {
            println!("Unregistered key '{}'", format_value(&data["name"]));
        } else {
            print_key_entry(data);
        }
    }
    if let Some(count) = data.get("migrated") {
        println!("Migrated {} signing keys", format_value(count));
    }
    if let Some(items) = data.get("converted_files").and_then(Value::as_array) {
        let converted = items
            .iter()
            .filter(|item| item["status"] == "converted")
            .count();
        if converted > 0 {
            println!("Converted {converted} key file(s) to the JSON key file format");
        }
        for item in items.iter().filter(|item| item["status"] == "failed") {
            eprintln!(
                "Could not convert key file {}: {}",
                format_value(&item["reference"]),
                format_value(&item["error"])
            );
        }
    }
    if let Some(items) = data.get("keychain_comments").and_then(Value::as_array) {
        let added = items
            .iter()
            .filter(|item| item["status"] == "added")
            .count();
        if added > 0 {
            println!("Added the public address as a comment to {added} Keychain item(s)");
        }
        for item in items {
            let reference = format_value(&item["reference"]);
            match item["status"].as_str() {
                Some("missing") => eprintln!("Keychain item {reference} was not found"),
                Some("failed") => eprintln!(
                    "Could not add a comment to Keychain item {reference}: {}",
                    format_value(&item["error"])
                ),
                _ => {}
            }
        }
    }
    if let Some(secret) = data.get("secret") {
        let action = match secret.get("status").and_then(Value::as_str) {
            Some("deleted") => "Deleted backing secret",
            _ => "Retained backing secret",
        };
        println!("{action}: {}", format_value(&secret["reference"]));
        if let Some(error) = secret.get("error").and_then(Value::as_str) {
            eprintln!("Secret cleanup failed after saving the registration: {error}");
        }
    }
}

fn print_key_entry(entry: &Value) {
    println!("  {}", format_value(&entry["name"]).bold());
    if let Some(public_key) = entry.get("public_key") {
        println!("    Address: {}", format_value(public_key));
    }
    if let Some(reference) = entry.get("reference") {
        println!("    Key reference: {}", format_value(reference));
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

/// Print network profile information
fn print_networks_info(data: &Value) {
    if let Value::Object(net_data) = data {
        // Handle network list
        if let Some(list) = net_data.get("list") {
            if let Value::Array(entries) = list {
                if entries.is_empty() {
                    println!("{}", "No networks configured.".italic());
                    return;
                }

                let active_name = net_data
                    .get("active")
                    .or_else(|| net_data.get("default"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                println!("{}", "Networks".bold().green());
                for entry in entries {
                    if let Value::Object(e) = entry {
                        let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                        let url = e.get("url").and_then(|v| v.as_str()).unwrap_or("?");
                        let has_auth = e
                            .get("has_auth_token")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        let marker = if name == active_name {
                            " (active)".green().to_string()
                        } else {
                            String::new()
                        };

                        let auth_info = if has_auth { " [auth]" } else { "" };

                        println!("  {}{}: {}{}", name.cyan(), marker, url, auth_info);
                    }
                }
            }
        }

        // Handle network operations
        if let Some(operation) = net_data.get("operation") {
            let op_str = format_value(operation);
            if let Some(name) = net_data.get("name") {
                let name_str = format_value(name);
                match op_str.as_str() {
                    "add" => {
                        if let Some(url) = net_data.get("url") {
                            println!(
                                "{}: Network '{}' added ({})",
                                "Success".bold().green(),
                                name_str,
                                format_value(url)
                            );
                        }
                    }
                    "use" => println!(
                        "{}: Active network set to '{}'",
                        "Success".bold().green(),
                        name_str
                    ),
                    "set" => println!(
                        "{}: Network '{}' updated",
                        "Success".bold().green(),
                        name_str
                    ),
                    "remove" => println!(
                        "{}: Network '{}' removed",
                        "Success".bold().green(),
                        name_str
                    ),
                    _ => println!(
                        "{}: Operation '{}' on network '{}'",
                        "Info".bold().blue(),
                        op_str,
                        name_str
                    ),
                }
            }
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

/// Create a JSON response for version information. Every entry returned by the
/// gRPC `GetVersion` map is passed through; the caller sorts them by key so the
/// output is stable/deterministic.
pub fn create_version_response(entries: &[(&String, &String)]) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("status".to_string(), json!("success"));
    for (key, value) in entries {
        obj.insert((*key).to_string(), json!(value));
    }
    json!({ "getversion": Value::Object(obj) })
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

/// Create a JSON response for uploader upload.
///
/// The `program_upload` and `program_size` keys are kept for compatibility.
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

/// Create a JSON response for uploader cleanup.
///
/// The `program_cleanup` key is kept for compatibility.
pub fn create_program_cleanup_response(status: &str, message: &str) -> Value {
    json!({
        "program_cleanup": {
            "status": status,
            "message": message
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

/// Create a JSON response for network list
pub fn create_network_list_response(config: &crate::config::Config) -> Value {
    let entries: Vec<Value> = config
        .list_network_names()
        .iter()
        .filter_map(|name| {
            config.networks.get(name).map(|net| {
                json!({
                    "name": name,
                    "url": net.url,
                    "has_auth_token": net.auth_token.is_some(),
                    "is_active": config.default_network.as_deref() == Some(name.as_str()),
                })
            })
        })
        .collect();

    let mut response = json!({
        "networks": {
            "list": entries,
        }
    });

    if let Some(ref active) = config.default_network {
        response["networks"]["active"] = json!(active);
    }

    response
}

/// Create a JSON response for network operations (add, use, set, remove)
pub fn create_network_operation_response(
    operation: &str,
    name: &str,
    status: &str,
    url: Option<&str>,
) -> Value {
    let mut response = json!({
        "networks": {
            "operation": operation,
            "name": name,
            "status": status,
        }
    });

    if let Some(u) = url {
        response["networks"]["url"] = json!(u);
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, NetworkConfig};

    #[test]
    fn create_network_list_response_marks_active_network() {
        let mut config = Config::default();
        config.networks.insert(
            "1".to_string(),
            NetworkConfig {
                url: "https://rpc-1.example.com".to_string(),
                auth_token: None,
            },
        );
        config.networks.insert(
            "2".to_string(),
            NetworkConfig {
                url: "https://rpc-2.example.com".to_string(),
                auth_token: Some("secret".to_string()),
            },
        );
        config.default_network = Some("1".to_string());

        let response = create_network_list_response(&config);
        let networks = &response["networks"];

        assert_eq!(networks["active"], "1");
        assert_eq!(networks["list"][0]["name"], "1");
        assert_eq!(networks["list"][0]["is_active"], true);
        assert_eq!(networks["list"][1]["name"], "2");
        assert_eq!(networks["list"][1]["is_active"], false);
        assert_eq!(networks["list"][1]["has_auth_token"], true);
    }

    #[test]
    fn pending_login_prints_readable_text() {
        let pending = json!({"status":"pending","verification_uri_complete":"https://dev.thru.org/device?user_code=ABCD2345&ref=cli","user_code":"ABCD2345","expires_in":600,"next":"thru auth login --resume"});
        let text = format_auth_pending(&pending).unwrap();
        assert!(text.contains("https://dev.thru.org/device?user_code=ABCD2345&ref=cli"));
        assert!(text.contains("Code: ABCD2345 (expires in 600 seconds)"));
        assert!(text.contains("Then run: thru auth login --resume"));
        assert!(format_auth_pending(&json!({"status":"authenticated"})).is_none());
    }

    #[test]
    fn auth_keys_print_as_a_table_and_a_created_key_once() {
        let list = json!({
            "organization":{"id":"org-1","name":"Acme Labs"},
            "organization_limits":{"weighted_rps":50,"bytes_per_sec":1000000},
            "keys":[
                {"id":"key-1","name":"ci","prefix":"thru_live_abc","origin_allowlist":["app.example.com","*.example.org"],"cli_machine":null,"limits":null,"created_at":"2026-11-01T00:00:00.000Z","last_used_at":null},
                {"id":"key-2","name":"thru-cli: laptop","prefix":"thru_live_def","origin_allowlist":null,"cli_machine":"laptop","limits":null,"created_at":"2026-11-02T00:00:00.000Z","last_used_at":"2026-11-03T00:00:00.000Z"},
            ],
        });
        let table = format_auth_keys(&list);
        assert!(table.contains("Organization: Acme Labs (org-1)"));
        assert!(table.contains("Limits: 50 weighted requests/s, 1000000 bytes/s"));
        let lines: Vec<&str> = table.lines().collect();
        let header = lines
            .iter()
            .position(|line| line.starts_with("ID"))
            .unwrap();
        assert!(lines[header + 1].starts_with("key-1  "));
        assert!(lines[header + 1].contains("app.example.com,*.example.org"));
        assert!(lines[header + 2].contains("laptop"));
        /* Columns line up. */
        assert_eq!(lines[header].find("NAME"), lines[header + 1].find("ci "));
        let empty = format_auth_keys(
            &json!({"organization":{"id":"o","name":"n"},"organization_limits":null,"keys":[]}),
        );
        assert!(empty.contains("Limits: default") && empty.contains("No API keys"));

        let created = format_auth_key(
            &json!({"organization":{"id":"org-1","name":"Acme Labs"},"key":{"id":"key-3","name":"ci","prefix":"thru_live_ghi"},"plaintext":"thru_live_secret"}),
        );
        assert!(created.contains(
            "Created API key \"ci\" (id key-3, prefix thru_live_ghi) in organization \"Acme Labs\""
        ));
        assert_eq!(created.matches("thru_live_secret").count(), 1);
        assert_eq!(
            format_auth_key(&json!({"id":"key-3","status":"revoked"})),
            "Revoked API key key-3.\n"
        );
    }
}
