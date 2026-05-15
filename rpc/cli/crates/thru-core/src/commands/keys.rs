//! Key management command implementations

use anyhow::Result;

use crate::cli::KeysCommands;
use crate::config::{Config, KeyManager};
use crate::error::CliError;
use crate::output;

const REMOVE_DEFAULT_ERROR: &str = concat!(
    "Cannot remove the 'default' key because the CLI requires it. ",
    "Use --force to remove it anyway, or replace it with ",
    "'thru keys add --overwrite default <key>'."
);

/// Handle keys subcommands
pub async fn handle_keys_command(
    config: &Config,
    subcommand: KeysCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        KeysCommands::List => list_keys(config, json_format).await,
        KeysCommands::Add {
            overwrite,
            name,
            key,
        } => add_key(config, &name, &key, overwrite, json_format).await,
        KeysCommands::Get { name } => get_key(config, &name, json_format).await,
        KeysCommands::Generate { overwrite, name } => {
            generate_key(config, &name, overwrite, json_format).await
        }
        KeysCommands::Remove { force, name } => {
            remove_key(config, &name, force, json_format).await
        }
    }
}

/// List all keys in the configuration
async fn list_keys(config: &Config, json_format: bool) -> Result<(), CliError> {
    let key_names = config.keys.list_keys();

    let response = output::create_keys_list_response(key_names);
    output::print_output(response, json_format);

    Ok(())
}

/// Add a new key to the configuration
async fn add_key(
    _config: &Config,
    name: &str,
    key: &str,
    overwrite: bool,
    json_format: bool,
) -> Result<(), CliError> {
    // Load current config
    let mut current_config = Config::load_for_key_management().await?;

    // Add the key
    current_config.keys.add_key(name, key, overwrite)?;

    // Save the updated config
    save_config(&current_config).await?;

    let response = output::create_keys_operation_response("add", name, "success", None);
    output::print_output(response, json_format);

    Ok(())
}

/// Get a key value from the configuration
async fn get_key(config: &Config, name: &str, json_format: bool) -> Result<(), CliError> {
    let key_value = config.keys.get_key(name)?;

    let response = output::create_keys_operation_response("get", name, "success", Some(key_value));
    output::print_output(response, json_format);

    Ok(())
}

/// Generate a new random key and add it to the configuration
async fn generate_key(
    _config: &Config,
    name: &str,
    overwrite: bool,
    json_format: bool,
) -> Result<(), CliError> {
    // Load current config
    let mut current_config = Config::load_for_key_management().await?;

    // Generate the key
    let generated_key = current_config.keys.generate_key(name, overwrite)?;

    // Save the updated config
    save_config(&current_config).await?;

    let response =
        output::create_keys_operation_response("generate", name, "success", Some(&generated_key));
    output::print_output(response, json_format);

    Ok(())
}

/// Remove a key from the configuration
async fn remove_key(
    _config: &Config,
    name: &str,
    force: bool,
    json_format: bool,
) -> Result<(), CliError> {
    // Load current config
    let mut current_config = Config::load_for_key_management().await?;

    // Remove the key
    let removed_default = remove_key_from_config(&mut current_config, name, force)?;

    // Save the updated config
    save_config(&current_config).await?;

    if removed_default && !json_format {
        output::print_warning(
            "Removed 'default' key. Commands that omit a key or fee payer will fail until you recreate it with 'thru keys generate default' or 'thru keys add --overwrite default <key>'.",
        );
    }

    let response = output::create_keys_operation_response("remove", name, "success", None);
    output::print_output(response, json_format);

    Ok(())
}

fn remove_key_from_config(config: &mut Config, name: &str, force: bool) -> Result<bool, CliError> {
    let removing_default = KeyManager::is_default_key_name(name);

    if removing_default && !force {
        return Err(CliError::Validation(REMOVE_DEFAULT_ERROR.to_string()));
    }

    config.keys.remove_key(name)?;
    Ok(removing_default)
}

/// Save configuration to file
async fn save_config(config: &Config) -> Result<(), CliError> {
    let config_path = Config::get_config_path()?;
    let config_content = serde_yaml::to_string(config).map_err(|e| CliError::Generic {
        message: format!("Failed to serialize config: {}", e),
    })?;

    tokio::fs::write(&config_path, config_content)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to write config file: {}", e),
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_keys() {
        let config = Config::default();
        let result = list_keys(&config, true).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_key() {
        let config = Config::default();
        let result = get_key(&config, "default", true).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_nonexistent_key() {
        let config = Config::default();
        let result = get_key(&config, "nonexistent", true).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_default_without_force_is_validation_error() {
        let mut config = Config::default();
        let result = remove_key_from_config(&mut config, "default", false);

        assert!(matches!(&result, Err(CliError::Validation(_))));
        assert!(config.keys.has_key("default"));

        let err = result.unwrap_err().to_string();
        assert!(err.contains(REMOVE_DEFAULT_ERROR));
    }

    #[test]
    fn test_remove_default_with_force_removes_key() {
        let mut config = Config::default();
        let removed_default = remove_key_from_config(&mut config, "default", true)
            .expect("forced default removal should succeed");

        assert!(removed_default);
        assert!(!config.keys.has_key("default"));
    }
}
