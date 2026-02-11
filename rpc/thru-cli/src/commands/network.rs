//! Network profile management command implementations

use crate::cli::NetworkCommands;
use crate::config::{Config, NetworkConfig};
use crate::error::CliError;
use crate::output;
use url::Url;

/// Handle network subcommands
pub async fn handle_network_command(
    _config: &Config,
    subcommand: NetworkCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        NetworkCommands::Add {
            name,
            url,
            auth_token,
        } => add_network(&name, &url, auth_token.as_deref(), json_format).await,
        NetworkCommands::SetDefault { name } => set_default(&name, json_format).await,
        NetworkCommands::Set {
            name,
            url,
            auth_token,
        } => set_network(&name, url.as_deref(), auth_token.as_deref(), json_format).await,
        NetworkCommands::List => list_networks(json_format).await,
        NetworkCommands::Remove { name } => remove_network(&name, json_format).await,
    }
}

/// Add a new named network profile
async fn add_network(
    name: &str,
    url: &str,
    auth_token: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let normalized = name.to_lowercase();

    // Validate URL
    Url::parse(url).map_err(|e| CliError::Validation(format!("Invalid URL: {}", e)))?;

    let mut config = Config::load().await?;

    if config.networks.contains_key(&normalized) {
        return Err(CliError::Validation(format!(
            "Network '{}' already exists. Use 'network set' to update it",
            normalized
        )));
    }

    config.networks.insert(
        normalized.clone(),
        NetworkConfig {
            url: url.to_string(),
            auth_token: auth_token.map(|s| s.to_string()),
        },
    );

    config.save().await?;

    let response =
        output::create_network_operation_response("add", &normalized, "success", Some(url));
    output::print_output(response, json_format);

    Ok(())
}

/// Set the default network profile
async fn set_default(name: &str, json_format: bool) -> Result<(), CliError> {
    let normalized = name.to_lowercase();
    let mut config = Config::load().await?;

    if !config.networks.contains_key(&normalized) {
        let available = config.list_network_names();
        return Err(CliError::Validation(format!(
            "Network '{}' not found. Available networks: {}",
            normalized,
            if available.is_empty() {
                "(none)".to_string()
            } else {
                available.join(", ")
            }
        )));
    }

    config.default_network = Some(normalized.clone());
    config.save().await?;

    let response =
        output::create_network_operation_response("set-default", &normalized, "success", None);
    output::print_output(response, json_format);

    Ok(())
}

/// Update fields on an existing network profile
async fn set_network(
    name: &str,
    url: Option<&str>,
    auth_token: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let normalized = name.to_lowercase();
    let mut config = Config::load().await?;

    if !config.networks.contains_key(&normalized) {
        let available = config.list_network_names();
        return Err(CliError::Validation(format!(
            "Network '{}' not found. Available networks: {}",
            normalized,
            if available.is_empty() {
                "(none)".to_string()
            } else {
                available.join(", ")
            }
        )));
    }

    if let Some(u) = url {
        Url::parse(u).map_err(|e| CliError::Validation(format!("Invalid URL: {}", e)))?;
    }

    let network = config.networks.get_mut(&normalized).unwrap();

    if let Some(u) = url {
        network.url = u.to_string();
    }

    if let Some(token) = auth_token {
        if token.is_empty() {
            network.auth_token = None;
        } else {
            network.auth_token = Some(token.to_string());
        }
    }

    let display_url = network.url.clone();
    config.save().await?;

    let response = output::create_network_operation_response(
        "set",
        &normalized,
        "success",
        Some(&display_url),
    );
    output::print_output(response, json_format);

    Ok(())
}

/// List all configured network profiles
async fn list_networks(json_format: bool) -> Result<(), CliError> {
    let config = Config::load().await?;
    let response = output::create_network_list_response(&config);
    output::print_output(response, json_format);
    Ok(())
}

/// Remove a network profile
async fn remove_network(name: &str, json_format: bool) -> Result<(), CliError> {
    let normalized = name.to_lowercase();
    let mut config = Config::load().await?;

    if !config.networks.contains_key(&normalized) {
        let available = config.list_network_names();
        return Err(CliError::Validation(format!(
            "Network '{}' not found. Available networks: {}",
            normalized,
            if available.is_empty() {
                "(none)".to_string()
            } else {
                available.join(", ")
            }
        )));
    }

    config.networks.remove(&normalized);

    // Clear default if it was the removed network
    if config.default_network.as_deref() == Some(&normalized) {
        config.default_network = None;
    }

    config.save().await?;

    let response =
        output::create_network_operation_response("remove", &normalized, "success", None);
    output::print_output(response, json_format);

    Ok(())
}
