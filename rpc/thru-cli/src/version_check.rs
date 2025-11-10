//! Version checking functionality for the thru-cli
//!
//! This module provides functionality to check if a newer version of the CLI is available
//! on crates.io and notify the user.

use serde::Deserialize;
use std::time::Duration;

/// Response from crates.io API for a crate
#[derive(Debug, Deserialize)]
struct CrateResponse {
    #[serde(rename = "crate")]
    crate_info: CrateInfo,
}

/// Crate information from crates.io
#[derive(Debug, Deserialize)]
struct CrateInfo {
    newest_version: String,
}

/// Check if a newer version is available on crates.io and print a notification if so.
///
/// This function:
/// - Queries crates.io for the latest version
/// - Compares it with the current version
/// - Prints a notification if a newer version is available
/// - Silently fails if network is unavailable or API request fails
pub async fn check_and_notify() {
    // Get current version from Cargo.toml
    let current_version = env!("CARGO_PKG_VERSION");

    // Query crates.io with a short timeout
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .user_agent(format!("thru-cli/{}", current_version))
        .build();
    
    let client = match client {
        Ok(c) => c,
        Err(_) => return, // Silently fail if client creation fails
    };
    
    let response = client
        .get("https://crates.io/api/v1/crates/thru-cli")
        .send()
        .await;
    
    let response = match response {
        Ok(r) => r,
        Err(_) => return, // Silently fail if network is unavailable
    };
    
    let crate_info: CrateResponse = match response.json().await {
        Ok(info) => info,
        Err(_) => return, // Silently fail if parsing fails
    };
    
    let latest_version = crate_info.crate_info.newest_version;
    
    // Compare versions
    if is_newer_version(&latest_version, current_version) {
        print_update_notification(&latest_version);
    }
}

/// Check if the latest version is newer than the current version
fn is_newer_version(latest: &str, current: &str) -> bool {
    // Parse versions as tuples of (major, minor, patch)
    let parse_version = |v: &str| -> Option<(u32, u32, u32)> {
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        
        let major = parts[0].parse::<u32>().ok()?;
        let minor = parts[1].parse::<u32>().ok()?;
        let patch = parts[2].parse::<u32>().ok()?;
        
        Some((major, minor, patch))
    };
    
    let latest_parsed = match parse_version(latest) {
        Some(v) => v,
        None => return false,
    };
    
    let current_parsed = match parse_version(current) {
        Some(v) => v,
        None => return false,
    };
    
    latest_parsed > current_parsed
}

/// Print a notification about a new version being available
fn print_update_notification(new_version: &str) {
    use colored::Colorize;
    
    let current_version = env!("CARGO_PKG_VERSION");
    
    // Calculate padding for proper alignment (box width is 51 chars including borders)
    // Format: "│  Current version: X.X.X" + padding + "│"
    let current_line_content = format!("  Current version: {}", current_version);
    let current_padding = 49 - current_line_content.len(); // 49 = 51 - 2 (for the │ borders)
    
    let latest_line_content = format!("  Latest version: {}", new_version);
    let latest_padding = 49 - latest_line_content.len();
    
    eprintln!();
    eprintln!("{}", "╭─────────────────────────────────────────────────╮".bright_yellow());
    eprintln!("{}", "│  A new version of thru-cli is available!        │".bright_yellow());
    eprintln!("{}{} {}{}{}", 
        "│".bright_yellow(),
        "  Current version:".bright_yellow(), 
        current_version.white(),
        " ".repeat(current_padding),
        "│".bright_yellow()
    );
    eprintln!("{}{} {}{}{}", 
        "│".bright_yellow(),
        "  Latest version:".bright_yellow(), 
        new_version.green().bold(),
        " ".repeat(latest_padding),
        "│".bright_yellow()
    );
    eprintln!("{}", "│                                                 │".bright_yellow());
    eprintln!("{}", "│  Update with:                                   │".bright_yellow());
    eprintln!("{}{}{}", 
        "│".bright_yellow(),
        "    cargo install thru-cli                       ".bold(),
        "│".bright_yellow()
    );
    eprintln!("{}", "╰─────────────────────────────────────────────────╯".bright_yellow());
    eprintln!();
}

/// Check if running in an interactive terminal
pub fn is_interactive() -> bool {
    // Check if stdout is a tty
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
}
