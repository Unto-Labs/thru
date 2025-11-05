//! Developer tools module for toolchain and project management

mod github;
mod init;
mod sdk;
mod templates;
mod toolchain;

use crate::cli::{DevCommands, InitCommands, SdkCommands, ToolchainCommands};
use crate::config::Config;
use crate::error::CliError;

/// Handle dev commands
pub async fn handle_dev_command(
    config: &mut Config,
    subcommand: DevCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        DevCommands::Toolchain { subcommand } => {
            handle_toolchain_command(config, subcommand, json_format).await
        }
        DevCommands::Sdk { subcommand } => {
            handle_sdk_command(config, subcommand, json_format).await
        }
        DevCommands::Init { subcommand } => {
            handle_init_command(config, subcommand, json_format).await
        }
    }
}

/// Handle toolchain subcommands
async fn handle_toolchain_command(
    config: &mut Config,
    subcommand: ToolchainCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        ToolchainCommands::Install { version, path, repo } => {
            /* Update config with repo if specified */
            if let Some(ref r) = repo {
                config.github_repo = Some(r.clone());
                config.save().await?;
            }
            toolchain::install_toolchain(config, version.as_deref(), path.as_deref(), json_format)
                .await
        }
        ToolchainCommands::Update { path, repo } => {
            /* Update config with repo if specified */
            if let Some(ref r) = repo {
                config.github_repo = Some(r.clone());
                config.save().await?;
            }
            toolchain::update_toolchain(config, path.as_deref(), json_format).await
        }
        ToolchainCommands::Uninstall { path, force } => {
            toolchain::uninstall_toolchain(config, path.as_deref(), force, json_format).await
        }
        ToolchainCommands::Path { path } => {
            toolchain::get_path(config, path.as_deref(), json_format).await
        }
    }
}

/// Handle SDK subcommands
async fn handle_sdk_command(
    config: &mut Config,
    subcommand: SdkCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        SdkCommands::Install {
            language,
            version,
            path,
            repo,
        } => {
            /* Update config with repo if specified */
            if let Some(ref r) = repo {
                config.github_repo = Some(r.clone());
                config.save().await?;
            }
            sdk::install_sdk(
                config,
                &language,
                version.as_deref(),
                path.as_deref(),
                json_format,
            )
            .await
        }
        SdkCommands::Update { language, path, repo } => {
            /* Update config with repo if specified */
            if let Some(ref r) = repo {
                config.github_repo = Some(r.clone());
                config.save().await?;
            }
            sdk::update_sdk(config, &language, path.as_deref(), json_format).await
        }
        SdkCommands::Uninstall {
            language,
            path,
            force,
        } => sdk::uninstall_sdk(config, &language, path.as_deref(), force, json_format).await,
        SdkCommands::Path { language, path } => {
            sdk::get_sdk_path_command(config, &language, path.as_deref(), json_format).await
        }
    }
}

/// Handle init subcommands
async fn handle_init_command(
    _config: &mut Config,
    subcommand: InitCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        InitCommands::C {
            project_name,
            path,
        } => init::init_c_project(&project_name, path.as_deref(), json_format).await,
        InitCommands::Cpp {
            project_name,
            path,
        } => init::init_cpp_project(&project_name, path.as_deref(), json_format).await,
        InitCommands::Rust {
            project_name,
            path,
        } => init::init_rust_project(&project_name, path.as_deref(), json_format).await,
    }
}
