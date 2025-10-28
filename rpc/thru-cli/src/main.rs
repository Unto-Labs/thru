//! Thru CLI - Command-line interface for the Thru blockchain
//!
//! This CLI provides access to Thru RPC methods and program upload functionality.

use anyhow::Result;
use clap::Parser;

mod cli;
mod commands;
mod config;
mod crypto;
mod error;
mod grpc_client;
mod output;
mod utils;

use cli::{Cli, Commands};
use config::Config;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(fmt::layer()) // Add a formatter layer for console output
        .with(EnvFilter::from_default_env()) // Add the environment filter layer
        .init();
    // Parse command line arguments
    let cli = Cli::parse();

    // Load configuration
    let config = Config::load().await?;

    // Execute the command
    match cli.command {
        Commands::GetVersion => {
            commands::rpc::get_version(&config, cli.json).await?;
        }
        Commands::GetHealth => {
            commands::rpc::get_health(&config, cli.json).await?;
        }
        Commands::GetHeight => {
            commands::rpc::get_height(&config, cli.json).await?;
        }
        Commands::GetAccountInfo { account } => {
            commands::rpc::get_account_info(&config, account.as_deref(), cli.json).await?;
        }
        Commands::GetBalance { account } => {
            commands::rpc::get_balance(&config, account.as_deref(), cli.json).await?;
        }
        Commands::Transfer { src, dst, value } => {
            commands::transfer::handle_transfer_command(&config, &src, &dst, value, cli.json)
                .await?;
        }
        Commands::Token { subcommand } => {
            commands::token::handle_token_command(&config, subcommand, cli.json).await?;
        }
        Commands::Uploader { subcommand } => {
            commands::uploader::handle_uploader_command(&config, subcommand, cli.json).await?;
        }
        Commands::Keys { subcommand } => {
            commands::keys::handle_keys_command(&config, subcommand, cli.json).await?;
        }
        Commands::Account { subcommand } => {
            commands::account::handle_account_command(&config, subcommand, cli.json).await?;
        }
        Commands::Program { subcommand } => {
            commands::program::handle_program_command(&config, subcommand, cli.json).await?;
        }
        Commands::Txn { subcommand } => {
            commands::txn::handle_txn_command(&config, subcommand, cli.json).await?;
        }
        Commands::Util { subcommand } => {
            let output_format = if cli.json {
                output::OutputFormat::Json
            } else {
                output::OutputFormat::Text
            };
            commands::util::execute_util_command(subcommand, output_format)?;
        }
    }

    Ok(())
}
