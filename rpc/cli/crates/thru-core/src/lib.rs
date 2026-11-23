//! Thru CLI core library — shared implementation for `thru` and `thru-cli` binaries.
//!
//! This crate provides all CLI logic (argument parsing, command dispatch,
//! configuration, crypto helpers, output formatting, etc.).  The two binary
//! crates (`thru-cli` and `thru`) are thin wrappers that call [`run`].

use clap::Parser;
use serde_json::{Value, json};
use std::io::IsTerminal;
use std::process;

mod api_key_hints;
pub mod cli;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod error;
pub mod feature_gate_account;
pub mod feature_gate_registry;
pub mod hd;
pub mod keys;
pub mod output;
pub mod signing;
pub mod utils;
pub mod version_check;

use cli::{AuthCommands, Cli, Commands, FaucetCommands, FaucetWithdrawCommands};
use config::Config;
use error::CliError;

/// Main entry point shared by every binary wrapper.
///
/// Call this from your `#[tokio::main] async fn main()` after initialising
/// the tracing subscriber.
pub async fn run() -> anyhow::Result<()> {
    // Parse command line arguments
    let cli = Cli::parse();

    // Migration reads the raw document itself: it needs the inline seeds that
    // the normal loader drops (keeping only their alias names).
    if let Commands::Keys {
        subcommand: cli::KeysCommands::Migrate { store },
    } = &cli.command
    {
        let result = commands::keys::migrate_keys(*store, cli.json).await;
        return finish_command(result, cli.json);
    }

    // Check for newer version if not in quiet/json mode and running interactively
    if !cli.quiet && !cli.json && version_check::is_interactive() {
        version_check::check_and_notify().await;
    }

    // Load configuration. A default key is resolved lazily by commands that
    // omit an explicit named signer.
    let auth_only = matches!(&cli.command, Commands::Auth { .. });
    // `thru auth status` reports whether RPC calls to the selected endpoint
    // carry an API key, so it reads the RPC configuration, best effort.
    let auth_status = matches!(
        &cli.command,
        Commands::Auth {
            subcommand: AuthCommands::Status
        }
    );
    let developers_only = auth_only
        || matches!(
            &cli.command,
            Commands::Faucet {
                subcommand: FaucetCommands::Withdraw {
                    subcommand: FaucetWithdrawCommands::Uusd { .. }
                        | FaucetWithdrawCommands::Thru { .. }
                }
            }
        );
    // Config errors go through `finish_command` so `--json` gets a JSON error.
    let mut config = if auth_status {
        load_config_for_auth_status(&cli).await
    } else if auth_only {
        Config::default()
    } else {
        match Config::load().await {
            Ok(config) => config,
            Err(error) => return finish_command(Err(error), cli.json),
        }
    };
    config.keys.begin_command();

    // Legacy inline keys only fail the commands that sign with them.
    let unmigrated = config.keys.unmigrated_aliases();
    if !unmigrated.is_empty() && !cli.quiet && !cli.json {
        let path = Config::get_config_path()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "the CLI config".to_string());
        let (keys, are, them) = match unmigrated.as_slice() {
            [one] => (format!("signing key '{one}'"), "is", "it"),
            many => (format!("signing keys {}", many.join(", ")), "are", "them"),
        };
        eprintln!(
            "warning: {keys} {are} still stored inline in {path}; commands that sign with \
             {them} fail until you run 'thru keys migrate'"
        );
    }

    // Announce the pending transaction signature before sending, except in
    // machine-readable (`--json`) or `--quiet` modes. This works in scripts,
    // pipes, and logs (non-TTY) since the banner only goes to stderr, never
    // to the `--json` payload on stdout.
    config.announce_pending_signature = !cli.json && !cli.quiet;

    // Apply global network overrides. Developers auth does not load or select
    // a wallet/RPC identity (`auth status` selected its endpoint above). An
    // unknown `--network` goes through `finish_command` so `--json` gets JSON.
    if !auth_only {
        if let Err(error) = select_network(&mut config, cli.url.as_deref(), cli.network.as_deref())
        {
            return finish_command(Err(error), cli.json);
        }
    }

    // Skip TLS verification when requested (e.g. self-signed / direct-IP nodes)
    config.insecure = cli.insecure;
    if cli.insecure && !cli.quiet && !developers_only {
        eprintln!(
            "warning: TLS certificate verification disabled (--insecure); \
             the connection is not authenticated and is exposed to man-in-the-middle attacks."
        );
    }

    // A network without a configured auth token falls back to the Thru
    // developer API key from the environment, then to the key `thru auth login`
    // provisioned, but only for official Thru RPC endpoints over verified HTTPS
    // (see `Config::rpc_auth_token`). Both are held in non-serialized fields so
    // no `config.save()` can persist them; the provisioned key is read from its
    // file only when an official endpoint would receive it.
    if !auth_only || auth_status {
        config.env_api_key = env_api_key();
        config.provisioned_api_key =
            commands::developers::provisioned_rpc_key(!cli.quiet && !cli.json);
    }
    if !auth_only {
        if !cli.quiet && !cli.json && !developers_only {
            if config.env_api_key_withheld() {
                eprintln!(
                    "warning: THRU_API_KEY/THRU_DEVELOPERS_API_KEY was not sent to {} because it is \
                     not an official Thru RPC endpoint over verified HTTPS; to authenticate, configure \
                     a token for this network with `thru network add|set <name> --auth-token <token>`.",
                    config.rpc_base_url
                );
            }
            // The key from `thru auth login` is withheld from non-official
            // endpoints silently: local and custom nodes are routine, and the
            // user never asked for that key to go anywhere in particular.
        }

        // Tell a keyless user of an official endpoint, once, that a key lifts
        // the per-IP limit, before the limit surprises them, and offer to sign
        // in. The command then runs with the key the login provisioned, which
        // `config` reads lazily on first use.
        if api_key_hints::show_no_api_key_note_once(
            &config,
            !cli.quiet && !cli.json && std::io::stderr().is_terminal(),
        ) && api_key_hints::offer_sign_in(cli.json, cli.quiet)
        {
            match commands::developers::sign_in_interactively().await {
                Ok(()) => eprintln!("Continuing with your command."),
                Err(err) => {
                    eprintln!(
                        "warning: sign-in did not complete ({err}); continuing without an API key."
                    )
                }
            }
        }
    }

    // Execute the command
    let result: Result<(), CliError> = match cli.command {
        Commands::Governance { subcommand } => {
            commands::governance::handle_governance_command(&config, subcommand, cli.json).await
        }
        Commands::GetVersion => commands::rpc::get_version(&config, cli.json).await,
        Commands::GetHealth => commands::rpc::get_health(&config, cli.json).await,
        Commands::GetStatus => commands::rpc::get_status(&config, cli.json).await,
        Commands::GetHeight => commands::rpc::get_height(&config, cli.json).await,
        Commands::GetAccountInfo {
            account,
            data_start,
            data_len,
        } => {
            commands::rpc::get_account_info(
                &config,
                account.as_deref(),
                data_start,
                data_len,
                cli.json,
            )
            .await
        }
        Commands::GetBalance { account } => {
            commands::rpc::get_balance(&config, account.as_deref(), cli.json).await
        }
        Commands::GetSlotMetrics { slot, end_slot } => {
            commands::rpc::get_slot_metrics(&config, slot, end_slot, cli.json).await
        }
        Commands::Transfer {
            src,
            dst,
            value,
            build_only,
            fee,
        } => {
            commands::transfer::handle_transfer_command(
                &config, &src, &dst, value, fee, build_only, cli.json,
            )
            .await
        }
        Commands::Token { subcommand } => {
            commands::token::handle_token_command(&config, subcommand, cli.json).await
        }
        Commands::Auth { subcommand } => {
            commands::developers::handle_auth(subcommand, cli.json, &config).await
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
        Commands::Multisig { subcommand } => {
            commands::multisig::handle_multisig_command(&config, subcommand, cli.json).await
        }
        Commands::Bond { subcommand } => {
            commands::bond::handle_bond_command(&config, subcommand, cli.json).await
        }
        Commands::Validator { subcommand } => {
            commands::consensus_validator::handle_validator_command(&config, subcommand, cli.json)
                .await
        }
        Commands::FeatureGates {
            registry,
            subcommand,
        } => {
            commands::feature_gates::handle_feature_gates_command(
                &config,
                registry.as_deref(),
                subcommand,
                cli.json,
            )
            .await
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
        Commands::Message { subcommand } => {
            commands::message::handle_message_command(&config, subcommand, cli.json).await
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
        Commands::Network { subcommand } => {
            commands::network::handle_network_command(&config, subcommand, cli.json).await
        }
        Commands::Debug { subcommand } => {
            commands::debug::handle_debug_command(&config, subcommand, cli.json).await
        }
    };

    if let Err(err) = result {
        // A keyless caller who hits a rate limit is told how to get a key.
        let hint = api_key_hints::rate_limit_hint(&err, || config.rpc_auth_token().is_some());
        match (&err, cli.json) {
            (CliError::Reported, _) => {
                // Command already emitted user-facing output; just exit with failure.
            }
            (_, true) => {
                let mut payload = format_error_json(&err);
                if let (Some(hint), Some(error)) = (hint, payload["error"].as_object_mut()) {
                    error.insert("hint".to_string(), json!(hint));
                }
                output::print_output(payload, true);
            }
            (_, false) => {
                eprintln!("Error: {}", err);
                if let Some(hint) = hint {
                    eprintln!("hint: {hint}");
                    // The failed command is not retried: it may not be safe
                    // to repeat, so the exit code stays 1.
                    if api_key_hints::offer_sign_in(cli.json, cli.quiet) {
                        match commands::developers::sign_in_interactively().await {
                            Ok(()) => {
                                eprintln!("Signed in. Run the command again to use your API key.")
                            }
                            Err(err) => eprintln!("Error: {err}"),
                        }
                    }
                }
            }
        }
        process::exit(1);
    }

    Ok(())
}

/// Report an error raised before a command has a config (so no rate-limit hint
/// applies) the same way `run` reports command errors: JSON on stdout with
/// `--json`, text on stderr otherwise.
fn finish_command(result: Result<(), CliError>, json: bool) -> anyhow::Result<()> {
    if let Err(err) = result {
        match (&err, json) {
            (CliError::Reported, _) => {
                // Command already emitted user-facing output; just exit with failure.
            }
            (_, true) => output::print_output(format_error_json(&err), true),
            (_, false) => eprintln!("Error: {}", err),
        }
        process::exit(1);
    }

    Ok(())
}

/// Points `config` at the RPC endpoint the global flags select: `--url`, else
/// the `--network` profile (an unknown name is an error), else the default
/// profile.
fn select_network(
    config: &mut Config,
    url: Option<&str>,
    network: Option<&str>,
) -> Result<(), CliError> {
    if let Some(url) = url {
        config.rpc_base_url = url.to_string();
    } else if let Some(network_name) = network {
        let name = network_name.to_lowercase();
        let net = config.networks.get(&name).cloned().ok_or_else(|| {
            let available = config.list_network_names();
            CliError::Validation(format!(
                "Network '{}' not found. Available networks: {}",
                name,
                if available.is_empty() {
                    "(none)".to_string()
                } else {
                    available.join(", ")
                }
            ))
        })?;
        config.rpc_base_url = net.url;
        config.auth_token = net.auth_token;
    } else if let Some(default_name) = config.default_network.clone() {
        let default_name = default_name.to_lowercase();
        if let Some(net) = config.networks.get(&default_name).cloned() {
            config.rpc_base_url = net.url;
            config.auth_token = net.auth_token;
        }
    }
    Ok(())
}

/// The RPC configuration `thru auth status` reports on. Never fails and never
/// creates a config file: a missing config is the default one, and an
/// unreadable config or unknown `--network` falls back to the default
/// endpoint with a warning.
async fn load_config_for_auth_status(cli: &Cli) -> Config {
    let exists = Config::get_config_path().is_ok_and(|path| path.exists());
    let mut config = if exists {
        match Config::load().await {
            Ok(config) => config,
            Err(err) => {
                if !cli.quiet {
                    eprintln!(
                        "warning: could not load the CLI config ({err}); reporting the default RPC endpoint."
                    );
                }
                Config::default()
            }
        }
    } else {
        Config::default()
    };
    if let Err(err) = select_network(&mut config, cli.url.as_deref(), cli.network.as_deref()) {
        if !cli.quiet {
            eprintln!("warning: {err}; reporting the default RPC endpoint.");
        }
        config = Config::default();
    }
    config
}

/// Format a [`CliError`] as a JSON [`Value`] for structured output.
/// Thru developer API key from the environment, used as the RPC auth token
/// when the selected network has none configured and the endpoint is an
/// official Thru RPC endpoint. `THRU_API_KEY` wins over
/// `THRU_DEVELOPERS_API_KEY`; blank values count as unset.
fn env_api_key() -> Option<String> {
    ["THRU_API_KEY", "THRU_DEVELOPERS_API_KEY"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

pub fn format_error_json(err: &CliError) -> Value {
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
        CliError::Developers {
            code,
            message,
            status,
            retry_after,
            signature,
        } => json!({
            "error": {
                "type": "developers", "code": code, "message": message,
                "status": status, "retry_after_seconds": retry_after, "signature": signature,
            }
        }),
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
        CliError::TransactionDetailsUnavailable {
            signature,
            outcome,
            message,
        } => json!({
            "error": {
                "type": "transaction_details_unavailable",
                "message": format!("Transaction observed via stream but details unavailable: {message}"),
                "signature": signature,
                "consensus_status": outcome.consensus_status,
                "execution_result": outcome.execution_result.as_ref().map(|exec| exec.execution_result),
                "vm_error": outcome.execution_result.as_ref().map(|exec| exec.vm_error),
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
        CliError::ResumeValidationAccount {
            message,
            account,
            seed,
        } => json!({
            "error": {
                "type": "resume_validation",
                "message": message,
                "account": account,
                "seed": seed,
            }
        }),
        CliError::RateLimited { message, unkeyed } => json!({
            "error": {
                "type": "rate_limited",
                "message": message,
                "unkeyed": unkeyed,
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
        CliError::Ledger {
            code,
            message,
            status_word,
            reason,
        } => json!({
            "error": {
                "type": "ledger",
                "code": code,
                "message": message,
                "status_word": status_word.map(|sw| format!("0x{sw:04X}")),
                "reason": reason,
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

#[cfg(test)]
mod transaction_outcome_tests {
    use super::*;
    use thru_client::proto::{
        core::v1::TransactionExecutionResult, services::v1::SendAndTrackTxnResponse,
    };

    fn query_failure(execution_result: Option<TransactionExecutionResult>) -> CliError {
        thru_client::ClientError::TransactionDetailsUnavailable {
            signature: "submitted-signature".into(),
            outcome: Box::new(SendAndTrackTxnResponse {
                consensus_status: 4,
                execution_result,
                ..Default::default()
            }),
            source: Box::new(thru_client::ClientError::Rpc("query unavailable".into())),
        }
        .into()
    }

    #[test]
    fn observed_failure_is_reported_as_failed_not_reconcilable() {
        let error = query_failure(Some(TransactionExecutionResult {
            vm_error: -511,
            user_error_code: 17,
            ..Default::default()
        }));
        let json = format_error_json(&error);
        assert_eq!(json["error"]["type"], "transaction_failed");
        assert_eq!(json["error"]["signature"], "submitted-signature");
        assert_eq!(json["error"]["vm_error"], -511);
        assert_eq!(json["error"]["user_error_code"], 17);
        assert!(
            error
                .to_string()
                .contains("TN_RUNTIME_TXN_ERR_NONCE_TOO_LOW")
        );
    }

    #[test]
    fn observed_success_is_not_reported_as_failed_submission() {
        let error = query_failure(Some(TransactionExecutionResult::default()));
        let json = format_error_json(&error);
        assert_eq!(json["error"]["type"], "transaction_details_unavailable");
        assert_eq!(json["error"]["signature"], "submitted-signature");
        assert_eq!(json["error"]["execution_result"], 0);
        assert_eq!(json["error"]["vm_error"], 0);
    }

    #[test]
    fn absent_execution_is_not_reported_as_success() {
        let json = format_error_json(&query_failure(None));
        assert_eq!(json["error"]["type"], "transaction_details_unavailable");
        assert_eq!(json["error"]["signature"], "submitted-signature");
        assert!(json["error"]["execution_result"].is_null());
        assert!(json["error"]["vm_error"].is_null());
    }
}
