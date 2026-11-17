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
        ToolchainCommands::Install {
            version,
            path,
            repo,
        } => {
            update_repository(config, repo.as_deref()).await?;
            toolchain::install_toolchain(config, version.as_deref(), path.as_deref(), json_format)
                .await
        }
        ToolchainCommands::Update { path, repo } => {
            update_repository(config, repo.as_deref()).await?;
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
            update_repository(config, repo.as_deref()).await?;
            sdk::install_sdk(
                config,
                &language,
                version.as_deref(),
                path.as_deref(),
                json_format,
            )
            .await
        }
        SdkCommands::Update {
            language,
            path,
            repo,
        } => {
            update_repository(config, repo.as_deref()).await?;
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
        InitCommands::C { project_name, path } => {
            init::init_c_project(&project_name, path.as_deref(), json_format).await
        }
        InitCommands::Cpp { project_name, path } => {
            init::init_cpp_project(&project_name, path.as_deref(), json_format).await
        }
        InitCommands::Rust { project_name, path } => {
            init::init_rust_project(&project_name, path.as_deref(), json_format).await
        }
    }
}

async fn update_repository(config: &mut Config, repo: Option<&str>) -> Result<(), CliError> {
    if let Some(repo) = repo {
        let saved = Config::update(|latest| {
            latest.github_repo = Some(repo.to_owned());
            Ok(())
        })
        .await?;
        config.github_repo = saved.github_repo;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn repository_update_preserves_runtime_overrides_and_loaded_signer() {
        if std::env::var_os("THRU_DEV_UPDATE_CHILD").is_none() {
            let home = tempfile::tempdir().unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "commands::dev::tests::repository_update_preserves_runtime_overrides_and_loaded_signer",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env("HOME", home.path())
                .env("THRU_DEV_UPDATE_CHILD", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "stdout: {}\nstderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        }

        let (_directory, keys) = crate::keys::KeyManager::test_fixture(&[("default", [85; 32])]);
        let source = match &keys.get_entry("default").unwrap().source {
            crate::keys::KeySource::File { path, .. } => path.clone(),
            _ => unreachable!(),
        };
        let mut config = Config {
            keys,
            rpc_base_url: "http://runtime.example:8472".into(),
            insecure: true,
            ..Config::default()
        };
        config.keys.begin_command();
        let signer = config.keys.load_key("default").unwrap();
        std::fs::remove_file(source).unwrap();

        update_repository(&mut config, Some("example/repo"))
            .await
            .unwrap();

        assert_eq!(config.rpc_base_url, "http://runtime.example:8472");
        assert!(config.insecure);
        assert_eq!(config.github_repo.as_deref(), Some("example/repo"));
        assert!(std::sync::Arc::ptr_eq(
            &signer,
            &config.keys.load_key("default").unwrap()
        ));
        assert_eq!(
            Config::load().await.unwrap().github_repo.as_deref(),
            Some("example/repo")
        );
    }
}
