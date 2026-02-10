//! Thru CLI - Command-line interface for the Thru blockchain
//!
//! This CLI provides access to Thru RPC methods and program upload functionality.

use anyhow::Result;

use clap::Parser;
use serde_json::{Value, json};
use std::process;

mod cli;
mod commands;
mod config;
mod crypto;
mod error;
mod output;
mod utils;
mod version_check;

use cli::{Cli, Commands};
use config::Config;
use error::CliError;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(fmt::layer()) // Add a formatter layer for console output
        .with(EnvFilter::from_default_env()) // Add the environment filter layer
        .init();
    // Parse command line arguments
    let cli = Cli::parse();
    
    // Check for newer version if not in quiet/json mode and running interactively
    if !cli.quiet && !cli.json && version_check::is_interactive() {
        version_check::check_and_notify().await;
    }

    // Load configuration
    let mut config = Config::load().await?;

    // Execute the command
    let result: Result<(), CliError> = match cli.command {
        Commands::GetVersion => commands::rpc::get_version(&config, cli.json).await,
        Commands::GetHealth => commands::rpc::get_health(&config, cli.json).await,
        Commands::GetHeight => commands::rpc::get_height(&config, cli.json).await,
        Commands::GetAccountInfo { account, data_start, data_len } => {
            commands::rpc::get_account_info(&config, account.as_deref(), data_start, data_len, cli.json).await
        }
        Commands::GetBalance { account } => {
            commands::rpc::get_balance(&config, account.as_deref(), cli.json).await
        }
        Commands::GetSlotMetrics { slot, end_slot } => {
            commands::rpc::get_slot_metrics(&config, slot, end_slot, cli.json).await
        }
        Commands::Transfer { src, dst, value } => {
            commands::transfer::handle_transfer_command(&config, &src, &dst, value, cli.json).await
        }
        Commands::Token { subcommand } => {
            commands::token::handle_token_command(&config, subcommand, cli.json).await
        }
        Commands::Faucet { subcommand } => {
            commands::faucet::handle_faucet_command(&config, subcommand, cli.json).await
        }
        Commands::Registrar { subcommand } => {
            commands::name_service::handle_registrar_command(&config, subcommand, cli.json).await
        }
        Commands::NameService { subcommand } => {
            commands::name_service::handle_name_service_command(&config, subcommand, cli.json).await
        }
        Commands::Wthru { subcommand } => {
            commands::wthru::handle_wthru_command(&config, subcommand, cli.json).await
        }
        Commands::Uploader { subcommand } => {
            commands::uploader::handle_uploader_command(&config, subcommand, cli.json).await
        }
        Commands::Abi { subcommand } => {
            commands::abi::handle_abi_command(&config, subcommand, cli.json).await
        }
        Commands::Keys { subcommand } => {
            commands::keys::handle_keys_command(&config, subcommand, cli.json).await
        }
        Commands::Account { subcommand } => {
            commands::account::handle_account_command(&config, subcommand, cli.json).await
        }
        Commands::Program { subcommand } => {
            commands::program::handle_program_command(&config, subcommand, cli.json).await
        }
        Commands::Txn { subcommand } => {
            commands::txn::handle_txn_command(&config, subcommand, cli.json).await
        }
        Commands::Util { subcommand } => {
            let output_format = if cli.json {
                output::OutputFormat::Json
            } else {
                output::OutputFormat::Text
            };
            commands::util::execute_util_command(subcommand, output_format).map_err(CliError::from)
        }
        Commands::Dev { subcommand } => {
            commands::dev::handle_dev_command(&mut config, subcommand, cli.json).await
        }
    };

    if let Err(err) = result {
        match (&err, cli.json) {
            (CliError::Reported, _) => {
                // Command already emitted user-facing output; just exit with failure.
            }
            (_, true) => {
                let payload = format_error_json(&err);
                output::print_output(payload, true);
            }
            (_, false) => {
                eprintln!("Error: {}", err);
            }
        }
        process::exit(1);
    }

    Ok(())
}

fn format_error_json(err: &CliError) -> Value {
    match err {
        CliError::TransactionFailed {
            message,
            execution_result,
            vm_error,
            vm_error_label,
            user_error_code,
            user_error_label,
            signature,
        } => {
            let mut error_obj = json!({
                "type": "transaction_failed",
                "message": message,
                "execution_result": execution_result,
                "execution_result_hex": format!("0x{:X}", execution_result),
                "vm_error": vm_error,
                "vm_error_label": vm_error_label,
                "user_error_code": user_error_code,
                "user_error_code_hex": format!("0x{:X}", user_error_code),
                "user_error_label": user_error_label,
            });

            if !signature.is_empty() {
                if let Some(obj) = error_obj.as_object_mut() {
                    obj.insert("signature".to_string(), json!(signature));
                }
            }

            json!({ "error": error_obj })
        }
        CliError::TransactionSubmission(message) => json!({
            "error": {
                "type": "transaction_submission",
                "message": message,
            }
        }),
        CliError::TransactionVerification(message) => json!({
            "error": {
                "type": "transaction_verification",
                "message": message,
            }
        }),
        CliError::ProgramUpload(message) => json!({
            "error": {
                "type": "program_upload",
                "message": message,
            }
        }),
        CliError::ProgramCleanup(message) => json!({
            "error": {
                "type": "program_cleanup",
                "message": message,
            }
        }),
        CliError::Crypto(message) => json!({
            "error": {
                "type": "crypto",
                "message": message,
            }
        }),
        CliError::Validation(message) => json!({
            "error": {
                "type": "validation",
                "message": message,
            }
        }),
        CliError::NonceManagement(message) => json!({
            "error": {
                "type": "nonce_management",
                "message": message,
            }
        }),
        CliError::ResumeValidation(message) => json!({
            "error": {
                "type": "resume_validation",
                "message": message,
            }
        }),
        CliError::ResumeValidationAccount { message, account, seed } => json!({
            "error": {
                "type": "resume_validation",
                "message": message,
                "account": account,
                "seed": seed,
            }
        }),
        CliError::AccountNotFound(message) => json!({
            "error": {
                "type": "account_not_found",
                "message": message,
            }
        }),
        CliError::HashMismatch(message) => json!({
            "error": {
                "type": "hash_mismatch",
                "message": message,
            }
        }),
        CliError::MetaAccountClosed(message) => json!({
            "error": {
                "type": "meta_account_closed",
                "message": message,
            }
        }),
        CliError::Generic { message } => json!({
            "error": {
                "type": "generic",
                "message": message,
            }
        }),
        CliError::Reported => json!({
            "error": {
                "type": "reported",
                "message": "Error already reported",
            }
        }),
        CliError::Config(config_error) => json!({
            "error": {
                "type": "config",
                "message": config_error.to_string(),
            }
        }),
        CliError::Rpc(message) => json!({
            "error": {
                "type": "rpc",
                "message": message,
            }
        }),
        CliError::Transport(message) => json!({
            "error": {
                "type": "transport",
                "message": message,
            }
        }),
        CliError::Io(io_error) => json!({
            "error": {
                "type": "io",
                "message": io_error.to_string(),
                "kind": format!("{:?}", io_error.kind()),
            }
        }),
    }
}
