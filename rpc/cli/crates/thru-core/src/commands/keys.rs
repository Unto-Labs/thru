//! Signing-key registration and explicit migration. Output is public metadata only.

use crate::{
    cli::KeysCommands,
    config::{Config, MutationLock, lock_config, write_config_atomic},
    error::CliError,
    hd::{self, HdPath},
    keys::{
        KeyEntry, KeyManager, KeySource, KeyStorage, LoadedKey, StagedSecret, TrezorTarget,
        delete_source, generate_seed, load_source, open_key_file, read_seed,
        registration_reference, stage_secret,
    },
    output,
};
use serde_json::{Value, json};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::signing::{
    connect_ledger, connect_trezor, ledger_error, ledger_is_emulator, trezor_is_emulator,
    trezor_key_error,
};
use thru_base::tn_tools::Pubkey;
use thru_ledger::{DerivationPath, LedgerSigner};
use thru_trezor::{DerivationPath as TrezorPath, TrezorSigner};

const REMOVE_DEFAULT_ERROR: &str = "Removing 'default' requires --force; commands with an omitted signer will need a new default key";

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, CliError> + Send + 'static,
) -> Result<T, CliError> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| CliError::Generic {
            message: "Signing key storage task failed".into(),
        })?
}

pub async fn handle_keys_command(
    config: &Config,
    subcommand: KeysCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        KeysCommands::List => {
            let mut response =
                json!({"operation": "list", "status": "success", "entries": entries(config)?});
            let unmigrated = config.keys.unmigrated_aliases();
            if !unmigrated.is_empty() {
                // Names only: these seeds stay inline until `thru keys migrate`.
                response["unmigrated"] = json!(unmigrated);
            }
            output::print_output(json!({"keys": response}), json_format);
            Ok(())
        }
        KeysCommands::Get { name } => {
            let name = name.strip_prefix("alias:").unwrap_or(&name);
            let mut response = entry_output(&config.keys, name)?;
            response["operation"] = json!("get");
            response["status"] = json!("success");
            output::print_output(json!({"keys": response}), json_format);
            Ok(())
        }
        KeysCommands::Add {
            overwrite,
            name,
            file,
            stdin,
            mnemonic,
            account,
            path,
            store,
            legacy_seed: _,
        } => {
            let derivation = derivation_path(mnemonic, account, path)?;
            add_key(
                &name,
                file,
                stdin,
                derivation,
                store,
                overwrite,
                json_format,
            )
            .await
        }
        KeysCommands::Generate {
            overwrite,
            name,
            mnemonic,
            account,
            path,
            store,
        } => {
            let derivation = derivation_path(mnemonic, account, path)?;
            generate_key(&name, derivation, store, overwrite, json_format).await
        }
        KeysCommands::Remove {
            force,
            name,
            delete_secret,
        } => {
            let name = name.strip_prefix("alias:").unwrap_or(&name);
            remove_key(name, force, delete_secret, json_format).await
        }
        KeysCommands::Migrate { store } => migrate_keys(store, json_format).await,
        KeysCommands::Move { name, all, to } => move_keys(name, all, to, json_format).await,
        KeysCommands::AddLedger {
            overwrite,
            name,
            account,
            no_verify,
        } => add_ledger_key(&name, account, overwrite, no_verify, json_format).await,
        KeysCommands::AddTrezor {
            overwrite,
            name,
            account,
            no_verify,
            passphrase,
        } => {
            add_trezor_key(
                &name,
                account,
                passphrase,
                overwrite,
                no_verify,
                json_format,
            )
            .await
        }
        KeysCommands::Show { name, verify } => show_key(config, &name, verify, json_format).await,
    }
}

/// `thru keys add-ledger <name> [--account N]`: read the Ledger key at
/// `m/44'/8478'/N'/0'`, have the user confirm the address on the device
/// (unless `--no-verify`), then register its path and address.
async fn add_ledger_key(
    name: &str,
    account: u32,
    overwrite: bool,
    no_verify: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let path = DerivationPath::new(account)
        .map_err(|e| CliError::Validation(format!("Invalid Ledger account index: {e}")))?;
    KeyManager::validate_name(name)?;
    let config_path = Config::get_config_path()?;
    // Fail before prompting on the device.
    precheck_alias(&config_path, name, overwrite).await?;
    let signer = connect_ledger(path, None)?;
    let verified = !no_verify;
    if verified {
        signer.verify_address_on_device().map_err(ledger_error)?;
    }
    // An approval on the Speculos emulator is not an approval on a hardware
    // wallet, and is never reported as one (audit A-018).
    let emulator = ledger_is_emulator();
    let registered = register_entry(
        &config_path,
        name,
        ledger_entry(&signer),
        None,
        overwrite,
        "add-ledger",
    )
    .await?;

    let mut response = json!({
        "ledger_key": {
            "operation": "add-ledger",
            "name": name.to_lowercase(),
            "source": path.to_uri(),
            "path": path.to_string(),
            "public_key": signer.address(),
            "verified_on_device": verified && !emulator,
            "verified_on_emulator": verified && emulator,
            "transport": if emulator { "speculos" } else { "usb" },
            "status": "success",
        }
    });
    if let Some(secret) = registered.get("secret") {
        // The overwritten registration's prior source and what became of it.
        response["ledger_key"]["secret"] = secret.clone();
    }
    if json_format {
        output::print_output(response, true);
    } else {
        output::print_success(&format!(
            "Ledger key '{}' added: {} ({}){}",
            name.to_lowercase(),
            signer.address(),
            path,
            match (verified, emulator) {
                (true, false) => ", address confirmed on the device",
                (true, true) =>
                    ", address confirmed on the Speculos EMULATOR (not a hardware device)",
                (false, _) => "",
            }
        ));
    }
    Ok(())
}

/// The registration of a connected Ledger signer: its path and the address
/// the device reported.
fn ledger_entry(signer: &LedgerSigner) -> KeyEntry {
    KeyEntry {
        public_key: signer.address(),
        source: KeySource::Ledger {
            path: *signer.path(),
        },
    }
}

/// Register a connected Ledger signer's path and address under `name` in
/// `config` (in memory; `keys add-ledger` commits under the config lock).
pub fn record_ledger_key(
    config: &mut Config,
    name: &str,
    signer: &LedgerSigner,
    overwrite: bool,
) -> Result<(), CliError> {
    config
        .keys
        .insert_entry(name, ledger_entry(signer), overwrite)
}

/// `thru keys add-trezor <name> [--account N] [--passphrase]`: read the Trezor
/// key at `m/44'/8478'/N'/0'`, have the user confirm the address on the device
/// (unless `--no-verify`), then register its path and address. With
/// `--passphrase` the key is read from the wallet of a passphrase the person
/// types on the device, and the registration says so.
async fn add_trezor_key(
    name: &str,
    account: u32,
    passphrase: bool,
    overwrite: bool,
    no_verify: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let path = TrezorPath::new(account)
        .map_err(|e| CliError::Validation(format!("Invalid Trezor account index: {e}")))?;
    KeyManager::validate_name(name)?;
    let config_path = Config::get_config_path()?;
    // Fail before prompting on the device.
    precheck_alias(&config_path, name, overwrite).await?;
    let signer = connect_trezor(TrezorTarget::unregistered(path, passphrase))?;
    let verified = !no_verify;
    if verified {
        signer
            .verify_address_on_device()
            .map_err(|e| trezor_key_error(e, passphrase))?;
    }
    // An approval on the emulator is not an approval on a hardware wallet,
    // and is never reported as one.
    let emulator = trezor_is_emulator();
    let entry = trezor_entry(&signer, passphrase);
    let mut response = trezor_added_json(name, &entry, verified, emulator);
    let registered = register_entry(
        &config_path,
        name,
        entry.clone(),
        None,
        overwrite,
        "add-trezor",
    )
    .await?;
    if let Some(secret) = registered.get("secret") {
        // The overwritten registration's prior source and what became of it.
        response["trezor_key"]["secret"] = secret.clone();
    }
    if json_format {
        output::print_output(response, true);
    } else {
        output::print_success(&trezor_added_text(name, &entry, verified, emulator));
    }
    Ok(())
}

/// The JSON report of `keys add-trezor`: `source` is the reference of the new
/// registration, which for a key of a passphrase wallet is its alias.
fn trezor_added_json(name: &str, entry: &KeyEntry, verified: bool, emulator: bool) -> Value {
    let KeySource::Trezor { path, passphrase } = &entry.source else {
        unreachable!("keys add-trezor registers a Trezor source");
    };
    let mut response = json!({
        "trezor_key": {
            "operation": "add-trezor",
            "name": name.to_lowercase(),
            "source": registration_reference(name, &entry.source),
            "path": path.to_string(),
            "public_key": entry.public_key,
            "verified_on_device": verified && !emulator,
            "verified_on_emulator": verified && emulator,
            "status": "success",
        }
    });
    if *passphrase {
        response["trezor_key"]["passphrase"] = json!(true);
    }
    response
}

/// The text `keys add-trezor` prints on success.
fn trezor_added_text(name: &str, entry: &KeyEntry, verified: bool, emulator: bool) -> String {
    let KeySource::Trezor { path, passphrase } = &entry.source else {
        unreachable!("keys add-trezor registers a Trezor source");
    };
    let wallet = if *passphrase {
        format!(
            ", key of a passphrase wallet: select it as {} (a trezor:// URI is the standard wallet)",
            registration_reference(name, &entry.source)
        )
    } else {
        String::new()
    };
    format!(
        "Trezor key '{}' added: {} ({}){}{}",
        name.to_lowercase(),
        entry.public_key,
        path,
        wallet,
        match (verified, emulator) {
            (true, false) => ", address confirmed on the device",
            (true, true) => ", address confirmed on the Trezor EMULATOR (not a hardware device)",
            (false, _) => "",
        }
    )
}

/// The registration of a connected Trezor signer: its path, the address the
/// device reported, and whether it is a key of a passphrase wallet.
fn trezor_entry(signer: &TrezorSigner, passphrase: bool) -> KeyEntry {
    trezor_entry_at(*signer.path(), signer.address(), passphrase)
}

fn trezor_entry_at(path: TrezorPath, address: String, passphrase: bool) -> KeyEntry {
    KeyEntry {
        public_key: address,
        source: KeySource::Trezor { path, passphrase },
    }
}

/// Describe a key without revealing secrets: type, address and, for Ledger
/// keys, the path.  A `ledger://` URI that no registered key uses is read
/// from the device (silently).
pub fn describe_key(config: &Config, name: &str) -> Result<Value, CliError> {
    describe_key_with(config, name, &config.keys.public_key(name)?)
}

/// [`describe_key`] for a key whose public key the caller already read.
fn describe_key_with(
    config: &Config,
    name: &str,
    public_key: &[u8; 32],
) -> Result<Value, CliError> {
    let ledger = config.keys.ledger_source(name)?;
    let trezor = config.keys.trezor_source(name)?;
    let public_key = Pubkey::from_bytes(public_key).to_string();
    let name = name.strip_prefix("alias:").unwrap_or(name).to_lowercase();
    Ok(match ledger {
        None => match trezor {
            None => json!({
                "name": name,
                "type": "local",
                "public_key": public_key,
            }),
            Some(target) => {
                let mut info = json!({
                    "name": name,
                    "type": "trezor",
                    "source": registration_reference(&name, &target.source()),
                    "path": target.path().to_string(),
                    "public_key": public_key,
                    "cached": target.expected().is_some(),
                });
                if target.passphrase() {
                    info["passphrase"] = json!(true);
                }
                info
            }
        },
        Some((path, registered)) => json!({
            "name": name,
            "type": "ledger",
            "source": path.to_uri(),
            "path": path.to_string(),
            "public_key": public_key,
            "cached": registered.is_some(),
        }),
    })
}

/// `thru keys show <name> [--verify]`: print a key's address (never the
/// private key).  With `--verify`, a Ledger key's address and path are shown
/// on the device for the user to compare and confirm.
async fn show_key(
    config: &Config,
    name: &str,
    verify: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let public_key = config.keys.public_key(name)?;
    let mut info = describe_key_with(config, name, &public_key)?;
    if verify && let Some(target) = config.keys.trezor_source(name)? {
        if !json_format {
            println!(
                "Address: {}",
                info["public_key"].as_str().unwrap_or_default()
            );
        }
        // Expect the key read above, so a device or seed swapped in between
        // fails instead of being confirmed.
        let passphrase = target.passphrase();
        let signer = connect_trezor(TrezorTarget::registered(
            target.path(),
            passphrase,
            public_key,
        ))?;
        signer
            .verify_address_on_device()
            .map_err(|e| trezor_key_error(e, passphrase))?;
        let emulator = trezor_is_emulator();
        info["verified_on_device"] = json!(!emulator);
        info["verified_on_emulator"] = json!(emulator);
    } else if verify {
        let Some((path, _)) = config.keys.ledger_source(name)? else {
            return Err(CliError::Validation(format!(
                "--verify needs a Ledger or Trezor key; '{}' is a local key",
                name
            )));
        };
        if !json_format {
            println!(
                "Address: {}",
                info["public_key"].as_str().unwrap_or_default()
            );
        }
        // Expect the reported key: the registered one, or, for an unregistered
        // `ledger://` URI, the one read above over an earlier connection, so a
        // device or seed swapped in between fails instead of being confirmed.
        let signer = connect_ledger(path, Some(public_key))?;
        signer.verify_address_on_device().map_err(ledger_error)?;
        let emulator = ledger_is_emulator();
        info["verified_on_device"] = json!(!emulator);
        info["verified_on_emulator"] = json!(emulator);
    }
    if json_format {
        output::print_output(json!({ "key": info }), true);
    } else {
        print!("{}", show_text(&info));
        if verify && info["type"] == "trezor" {
            if trezor_is_emulator() {
                output::print_warning(
                    "Address confirmed on the Trezor EMULATOR, not on a hardware device",
                );
            } else {
                output::print_success("Address confirmed on the Trezor");
            }
        } else if verify && ledger_is_emulator() {
            output::print_warning(
                "Address confirmed on the Speculos EMULATOR, not on a hardware device",
            );
        } else if verify {
            output::print_success("Address confirmed on the Ledger");
        }
    }
    Ok(())
}

/// The lines `keys show` prints about a key.
fn show_text(info: &Value) -> String {
    let mut text = format!(
        "Key '{}' ({})\n  Address: {}\n",
        info["name"].as_str().unwrap_or_default(),
        info["type"].as_str().unwrap_or("?"),
        info["public_key"].as_str().unwrap_or_default()
    );
    if let Some(path) = info["path"].as_str() {
        text += &format!("  Path:    {path}\n");
        text += &format!(
            "  Source:  {}\n",
            info["source"].as_str().unwrap_or_default()
        );
    }
    if info["passphrase"] == true {
        text +=
            "  Passphrase wallet: yes (the passphrase is typed on the Trezor at every command)\n";
    }
    text
}

fn entry_output(manager: &KeyManager, name: &str) -> Result<Value, CliError> {
    let entry = manager.get_entry(name)?;
    // Turn registered relative paths into usable direct references for output.
    let source = manager.resolved_source(entry);
    let mut output = json!({"name": name.to_lowercase(), "public_key": entry.public_key,
        "reference": registration_reference(name, &source), "source": source});
    if let KeySource::Trezor {
        path,
        passphrase: true,
    } = &source
    {
        output["path"] = json!(path.to_string());
        output["passphrase"] = json!(true);
    }
    Ok(output)
}

fn entries(config: &Config) -> Result<Vec<Value>, CliError> {
    config
        .keys
        .list_keys()
        .iter()
        .map(|name| entry_output(&config.keys, name))
        .collect()
}

fn check_alias(config: &Config, name: &str, overwrite: bool) -> Result<(), CliError> {
    KeyManager::validate_name(name)?;
    if config.keys.has_key(name) && !overwrite {
        return Err(CliError::Validation(
            "Signing key alias already exists; use --overwrite to replace it".into(),
        ));
    }
    Ok(())
}

/// Unlocked early rejection, before any input is consumed or secret created.
/// `register` repeats the authoritative check under the lock.
async fn precheck_alias(path: &Path, name: &str, overwrite: bool) -> Result<(), CliError> {
    if overwrite {
        return Ok(());
    }
    check_alias(&Config::load_for_update(path).await?, name, overwrite)
}

async fn stage(
    store: KeyStorage,
    directory: PathBuf,
    key: LoadedKey,
) -> Result<StagedSecret, CliError> {
    blocking(move || stage_secret(store, &directory, &key)).await
}

/// A prior source to clean up after a commit: its entry, whether deletion was
/// explicitly requested, and an identity already verified for it.
type Cleanup = (KeyEntry, bool, Option<Arc<LoadedKey>>);

async fn commit_config(
    path: &Path,
    config: &Config,
    staged: Vec<StagedSecret>,
    lock: Option<MutationLock>,
    cleanup: Option<Cleanup>,
) -> Result<Option<Value>, CliError> {
    let mut results =
        commit_config_cleanups(path, config, staged, lock, cleanup.into_iter().collect()).await?;
    Ok(results.pop())
}

async fn commit_config_cleanups(
    path: &Path,
    config: &Config,
    mut staged: Vec<StagedSecret>,
    lock: Option<MutationLock>,
    cleanups: Vec<Cleanup>,
) -> Result<Vec<Value>, CliError> {
    config.validate()?;
    let raw = Config::generate_config_template(config);
    let path = path.to_owned();
    let config = config.clone();
    blocking(move || {
        let lock = lock;
        let durable = write_config_atomic(&path, &raw)?;
        for secret in &mut staged {
            secret.commit();
        }
        // Decide under the lock which prior sources are unused. Files are
        // deleted right away, still under the lock, so a concurrent
        // `keys add --file` of the same file cannot register it in between.
        // Keychain deletes may prompt, so they wait until the lock is released;
        // no command can register an existing Keychain item meanwhile (every
        // Keychain registration creates a new random ID).
        let mut results = Vec::with_capacity(cleanups.len());
        let mut deferred = Vec::new();
        for (entry, explicit, verified) in cleanups {
            let plan = if durable {
                plan_cleanup(&path, &config, &entry, explicit, verified.as_deref())
            } else {
                let mut report = prior_source_report(&entry, "retained");
                report["error"] = json!(
                    "Registration committed, but directory sync failed; prior secret retained"
                );
                CleanupPlan::Done(report)
            };
            match plan {
                CleanupPlan::Delete(source @ KeySource::MacosKeychain { .. }) => {
                    deferred.push((results.len(), source));
                    results.push(Value::Null);
                }
                plan => results.push(finish_cleanup(plan)),
            }
        }
        drop(lock);
        for (index, source) in deferred {
            results[index] = finish_cleanup(CleanupPlan::Delete(source));
        }
        Ok(results)
    })
    .await
}

async fn register(
    config_path: &Path,
    name: &str,
    entry: KeyEntry,
    staged: Option<StagedSecret>,
    overwrite: bool,
    operation: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let response = register_entry(config_path, name, entry, staged, overwrite, operation).await?;
    output::print_output(json!({"keys": response}), json_format);
    Ok(())
}

/// Commit `entry` under `name` and return the public `keys` response.
async fn register_entry(
    config_path: &Path,
    name: &str,
    mut entry: KeyEntry,
    staged: Option<StagedSecret>,
    overwrite: bool,
    operation: &str,
) -> Result<Value, CliError> {
    // Staged secrets are parameters, so the local lock is dropped before their
    // rollback on every error path (including a potentially prompted Keychain delete).
    let lock = lock_config(config_path).await?;
    let mut config = Config::load_for_update(config_path).await?;
    check_alias(&config, name, overwrite)?;
    if staged.is_none() {
        if let KeySource::File { .. } = &entry.source {
            // Another writer may have removed or swapped the file since the
            // initial read. Re-derive its identity under the lock.
            let source = entry.source.clone();
            let expected = entry.public_key.clone();
            blocking(move || {
                if load_source(&source)?.address_string.to_string() != expected {
                    return Err(CliError::Validation(
                        "Signing key file changed during registration; nothing was registered"
                            .into(),
                    ));
                }
                Ok(())
            })
            .await?;
        }
    }
    inherit_managed_source(&config, &mut entry)?;
    let prior = config.keys.get_entry(name).ok().map(|entry| KeyEntry {
        public_key: entry.public_key.clone(),
        source: config.keys.resolved_source(entry),
    });
    config.keys.insert_entry(name, entry, overwrite)?;
    let cleanup = commit_config(
        config_path,
        &config,
        staged.into_iter().collect(),
        Some(lock),
        prior.map(|entry| (entry, false, None)),
    )
    .await?;
    let mut response = entry_output(&config.keys, name)?;
    if let Some(cleanup) = cleanup {
        response["secret"] = cleanup;
    }
    response["operation"] = json!(operation);
    response["status"] = json!("success");
    Ok(response)
}

/// The path a recovery-phrase key is derived at: `--path`, else
/// `m/44'/8478'/<--account>'/0'`. `None` without `--mnemonic` (clap rejects
/// `--account`/`--path` without it).
fn derivation_path(
    mnemonic: bool,
    account: Option<u32>,
    path: Option<HdPath>,
) -> Result<Option<HdPath>, CliError> {
    if !mnemonic {
        return Ok(None);
    }
    match path {
        Some(path) => Ok(Some(path)),
        None => HdPath::for_account(account.unwrap_or(0)).map(Some),
    }
}

async fn add_key(
    name: &str,
    file: Option<PathBuf>,
    stdin: bool,
    derivation: Option<HdPath>,
    store: KeyStorage,
    overwrite: bool,
    json_format: bool,
) -> Result<(), CliError> {
    if file.is_some() == stdin {
        return Err(CliError::Validation(
            "Select exactly one signing key input: --file or --stdin".into(),
        ));
    }
    KeyManager::validate_name(name)?;
    let path = Config::get_config_path()?;
    precheck_alias(&path, name, overwrite).await?;
    let input = file
        .map(|file| std::env::current_dir().map(|cwd| cwd.join(file)))
        .transpose()?;
    let (key, source) = blocking(move || match (input, derivation) {
        // A recovery phrase is never a key source: only the derived key is
        // stored, as a new secret.
        (input, Some(derivation)) => {
            let phrase = match input {
                Some(path) => hd::read_phrase(open_key_file(&path)?)?,
                None => hd::read_phrase_from_stdin()?,
            };
            Ok((
                LoadedKey::from_seed(hd::derive_key(&phrase, derivation)?),
                None,
            ))
        }
        (Some(path), None) => {
            let source = KeySource::File {
                path,
                managed: false,
            };
            Ok((load_source(&source)?, Some(source)))
        }
        (None, None) => Ok((
            LoadedKey::from_seed(read_seed(std::io::stdin().lock())?),
            None,
        )),
    })
    .await?;
    if store == KeyStorage::File {
        if let Some(source) = source {
            let entry = KeyEntry {
                public_key: key.address_string.to_string(),
                source,
            };
            return register(&path, name, entry, None, overwrite, "add", json_format).await;
        }
    }
    let staged = stage(store, path.parent().unwrap().join("keys"), key).await?;
    let mut response = register_entry(
        &path,
        name,
        staged.entry.clone(),
        Some(staged),
        overwrite,
        "add",
    )
    .await?;
    if let Some(derivation) = derivation {
        response["derivation_path"] = json!(derivation.to_string());
    }
    output::print_output(json!({"keys": response}), json_format);
    Ok(())
}

async fn generate_key(
    name: &str,
    derivation: Option<HdPath>,
    store: KeyStorage,
    overwrite: bool,
    json_format: bool,
) -> Result<(), CliError> {
    KeyManager::validate_name(name)?;
    let path = Config::get_config_path()?;
    precheck_alias(&path, name, overwrite).await?;
    let (key, phrase) = match derivation {
        Some(derivation) => {
            let phrase = hd::generate_phrase()?;
            let key = LoadedKey::from_seed(hd::derive_key(&phrase, derivation)?);
            (key, Some(phrase))
        }
        None => (LoadedKey::from_seed(generate_seed()?), None),
    };
    let staged = stage(store, path.parent().unwrap().join("keys"), key).await?;
    let mut response = register_entry(
        &path,
        name,
        staged.entry.clone(),
        Some(staged),
        overwrite,
        "generate",
    )
    .await?;
    if let Some(derivation) = derivation {
        response["derivation_path"] = json!(derivation.to_string());
    }
    // The phrase is shown once, after the key is registered, and never stored:
    // this is the user's only chance to back it up.
    match phrase {
        Some(phrase) if json_format => print_generated_json(&response, &phrase)?,
        Some(phrase) => {
            output::print_output(json!({"keys": response}), false);
            println!("Recovery phrase (shown once, not stored):");
            println!("  {}", phrase.as_str());
            output::print_warning(
                "Write the recovery phrase down and keep it offline. Anyone who has it controls this key.",
            );
        }
        None => output::print_output(json!({"keys": response}), json_format),
    }
    Ok(())
}

/// Print `{"keys": {...response, "mnemonic": phrase}}` as `print_output`
/// would, serializing the phrase straight from its zeroizing buffer so that
/// no owned JSON value or intermediate string holds a copy.
fn print_generated_json(response: &Value, phrase: &str) -> Result<(), CliError> {
    #[derive(serde::Serialize)]
    struct Keys<'a> {
        #[serde(flatten)]
        response: &'a Value,
        mnemonic: &'a str,
    }
    #[derive(serde::Serialize)]
    struct Generated<'a> {
        keys: Keys<'a>,
    }
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer_pretty(
        &mut stdout,
        &Generated {
            keys: Keys {
                response,
                mnemonic: phrase,
            },
        },
    )
    .map_err(std::io::Error::from)?;
    writeln!(stdout)?;
    Ok(())
}

fn remove_key_from_config(
    config: &mut Config,
    name: &str,
    force: bool,
) -> Result<KeyEntry, CliError> {
    if KeyManager::is_default_key_name(name) && !force {
        return Err(CliError::Validation(REMOVE_DEFAULT_ERROR.into()));
    }
    config.keys.remove_key(name)
}

async fn remove_key(
    name: &str,
    force: bool,
    delete_secret: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let path = Config::get_config_path()?;
    // Verify identity and availability before unregistering anything, and
    // before taking the lock: reading a Keychain secret may prompt. The single
    // secret read is reused for the delete.
    let verified = if delete_secret {
        let mut snapshot = Config::load_for_update(&path).await?;
        let manager = snapshot.keys.clone();
        let entry = remove_key_from_config(&mut snapshot, name, force)?;
        if entry.source.is_ledger() {
            return Err(CliError::Validation(
                "A Ledger key's secret stays on the device; remove it without --delete-secret"
                    .into(),
            ));
        }
        if entry.source.is_trezor() {
            return Err(CliError::Validation(
                "A Trezor key's secret stays on the device; remove it without --delete-secret"
                    .into(),
            ));
        }
        let read = (entry.public_key.clone(), manager.resolved_source(&entry));
        // Fail before any secret read (and prompt) when deletion is refused.
        if source_referenced(&snapshot, &read.1)? {
            return Err(CliError::Validation(
                "Cannot delete a secret still referenced by another registered key".into(),
            ));
        }
        let reference = format!("alias:{name}");
        Some((blocking(move || manager.load_key(&reference)).await?, read))
    } else {
        None
    };
    let lock = lock_config(&path).await?;
    let original = Config::load_for_update(&path).await?;
    let mut config = original.clone();
    let entry = remove_key_from_config(&mut config, name, force)?;
    let source = original.keys.resolved_source(&entry);
    if let Some((_, read)) = &verified {
        if (entry.public_key.clone(), source.clone()) != *read {
            return Err(CliError::Validation(
                "Signing key alias changed while its secret was being verified; nothing was removed"
                    .into(),
            ));
        }
        if source_referenced(&config, &source)? {
            return Err(CliError::Validation(
                "Cannot delete a secret still referenced by another registered key".into(),
            ));
        }
    }
    let removed = KeyEntry { source, ..entry };
    let cleanup = commit_config(
        &path,
        &config,
        Vec::new(),
        Some(lock),
        Some((removed, delete_secret, verified.map(|(key, _)| key))),
    )
    .await?;
    output::print_output(
        json!({"keys": {"operation": "remove", "status": "success", "name": name.to_lowercase(), "secret": cleanup}}),
        json_format,
    );
    Ok(())
}

fn same_source(source: &KeySource, other: &KeySource) -> Result<bool, CliError> {
    Ok(match (source, other) {
        (KeySource::File { path, .. }, KeySource::File { path: other, .. }) => {
            path == other
                || match (std::fs::canonicalize(path), std::fs::canonicalize(other)) {
                    (Ok(path), Ok(other)) => path == other,
                    (Err(error), _) | (_, Err(error))
                        if error.kind() == std::io::ErrorKind::NotFound =>
                    {
                        false
                    }
                    (Err(error), _) | (_, Err(error)) => return Err(error.into()),
                }
        }
        _ => source == other,
    })
}

fn source_referenced(config: &Config, source: &KeySource) -> Result<bool, CliError> {
    for name in config.keys.list_keys() {
        let other = config.keys.resolved_source(config.keys.get_entry(&name)?);
        if same_source(source, &other)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// A file already known to be CLI-managed remains managed through every alias.
/// Never infer ownership from the path of an otherwise external registration.
fn inherit_managed_source(config: &Config, entry: &mut KeyEntry) -> Result<(), CliError> {
    if !matches!(&entry.source, KeySource::File { managed: false, .. }) {
        return Ok(());
    }
    for name in config.keys.list_keys() {
        let known = config.keys.resolved_source(config.keys.get_entry(&name)?);
        if matches!(&known, KeySource::File { managed: true, .. })
            && same_source(&entry.source, &known)?
        {
            if let KeySource::File { managed, .. } = &mut entry.source {
                *managed = true;
            }
            break;
        }
    }
    Ok(())
}

/// What to do with a prior source once its registration change has committed.
enum CleanupPlan {
    /// Delete it (after the config lock is released: deletion may prompt).
    Delete(KeySource),
    /// Nothing to delete; this is the reported outcome.
    Done(Value),
}

/// Decide, while still holding the config lock that committed the change,
/// whether a prior source may be deleted. Never reads a Keychain secret when
/// `verified` is given (every Keychain deletion passes one).
fn plan_cleanup(
    path: &Path,
    config: &Config,
    entry: &KeyEntry,
    explicit: bool,
    verified: Option<&LoadedKey>,
) -> CleanupPlan {
    let source = &entry.source;
    let result = (|| -> Result<bool, CliError> {
        if source_referenced(config, source)? {
            return Ok(false);
        }
        if !explicit {
            let KeySource::File {
                path: file,
                managed: true,
            } = source
            else {
                return Ok(false);
            };
            let directory = path.parent().unwrap_or(Path::new(".")).join("keys");
            // Metadata ownership alone is insufficient: managed files must also
            // reside immediately inside this CLI's managed directory.
            let Some(parent) = file.parent() else {
                return Ok(false);
            };
            if std::fs::canonicalize(parent)? != std::fs::canonicalize(&directory)? {
                return Ok(false);
            }
        }
        let identity = match verified {
            Some(key) => key.address_string.to_string(),
            None => load_source(source)?.address_string.to_string(),
        };
        if identity != entry.public_key {
            return Err(CliError::Validation(
                "Backing secret identity changed; retained it".into(),
            ));
        }
        Ok(true)
    })();
    match result {
        Ok(true) => CleanupPlan::Delete(source.clone()),
        Ok(false) => CleanupPlan::Done(prior_source_report(entry, "retained")),
        Err(error) => {
            let mut report = prior_source_report(entry, "retained");
            report["error"] = json!(error.to_string());
            CleanupPlan::Done(report)
        }
    }
}

/// What a report says about the prior source of a registration that was
/// replaced or removed. The registration's alias no longer names it, and the
/// only reference of a key of a passphrase wallet is its alias (the URI of its
/// path would select the standard wallet), so such a key is reported by its
/// public key, its path and the passphrase flag, with no reference.
fn prior_source_report(entry: &KeyEntry, status: &str) -> Value {
    match &entry.source {
        KeySource::Trezor {
            path,
            passphrase: true,
        } => json!({"public_key": entry.public_key, "path": path.to_string(),
            "passphrase": true, "status": status}),
        source => json!({"reference": source.reference(), "status": status}),
    }
}

/// Carry out a cleanup plan: files under the config lock, Keychain items after
/// it is released (see `commit_config_cleanups`).
/// A cleanup failure must never pretend the durable registration rolled back.
fn finish_cleanup(plan: CleanupPlan) -> Value {
    match plan {
        CleanupPlan::Done(value) => value,
        CleanupPlan::Delete(source) => match delete_source(&source) {
            Ok(()) => json!({"reference": source.reference(), "status": "deleted"}),
            Err(error) => json!({"reference": source.reference(), "status": "retained",
                "error": error.to_string()}),
        },
    }
}

/// Plan and carry out a cleanup in one step (callers that hold no lock).
#[cfg(test)]
fn cleanup_source(
    path: &Path,
    config: &Config,
    entry: &KeyEntry,
    explicit: bool,
    verified: Option<&LoadedKey>,
) -> Value {
    finish_cleanup(plan_cleanup(path, config, entry, explicit, verified))
}

/// Explicitly migrate legacy inline signing keys before normal Config::load.
/// Old config bytes remain untouched until every new secret is read-verified.
pub async fn migrate_keys(store: KeyStorage, json_format: bool) -> Result<(), CliError> {
    let path = Config::get_config_path()?;
    // Each step takes the config lock itself, only for its commit (flock does
    // not nest within one process).
    let (config, count) = match Config::read_document(&path).await {
        Ok(raw) => migrate_document(&path, &raw, store).await?,
        Err(CliError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return finish_migrate(Config::default(), 0, None, None, json_format);
        }
        Err(error) => return Err(error),
    };
    let converted = convert_legacy_key_files(&path).await?;
    // The config lock is released by now, so a Keychain prompt here never
    // blocks other config writers.
    let comments = backfill_keychain_comments(&config).await;
    finish_migrate(config, count, converted, comments, json_format)
}

fn finish_migrate(
    config: Config,
    count: usize,
    converted: Option<Value>,
    comments: Option<Value>,
    json_format: bool,
) -> Result<(), CliError> {
    let mut response = json!({"operation": "migrate", "status": "success", "migrated": count, "entries": entries(&config)?});
    if let Some(converted) = converted {
        response["converted_files"] = converted;
    }
    if let Some(comments) = comments {
        response["keychain_comments"] = comments;
    }
    output::print_output(json!({"keys": response}), json_format);
    Ok(())
}

/// Rewrite CLI-managed key files still in the legacy bare-hex format as
/// version-1 JSON. External files registered in place are never touched. Runs
/// under the config lock so no concurrent writer can remove or reuse a file
/// mid-rewrite; a failure leaves that file as it was and is reported.
async fn convert_legacy_key_files(path: &Path) -> Result<Option<Value>, CliError> {
    let lock = lock_config(path).await?;
    let config = Config::load_for_update(path).await?;
    let managed = path.parent().unwrap_or(Path::new(".")).join("keys");
    let managed = match std::fs::canonicalize(&managed) {
        Ok(managed) => managed,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    // One file may back several aliases; convert each once.
    let mut files = std::collections::BTreeMap::new();
    for name in config.keys.list_keys() {
        let entry = config.keys.get_entry(&name)?;
        if let KeySource::File {
            path: file,
            managed: true,
        } = config.keys.resolved_source(entry)
        {
            let inside = file
                .parent()
                .and_then(|parent| std::fs::canonicalize(parent).ok())
                .is_some_and(|parent| parent == managed);
            if inside {
                files
                    .entry(file)
                    .or_insert_with(|| entry.public_key.clone());
            }
        }
    }
    let results = blocking(move || {
        let _lock = lock;
        Ok(files
            .into_iter()
            .filter_map(|(file, public_key)| {
                let reference = format!("file:{}", file.display());
                match crate::keys::convert_key_file_to_json(&file, &public_key) {
                    Ok(true) => Some(json!({"reference": reference, "status": "converted"})),
                    Ok(false) => None,
                    Err(error) => Some(json!({"reference": reference, "status": "failed",
                        "error": error.to_string()})),
                }
            })
            .collect::<Vec<_>>())
    })
    .await?;
    Ok((!results.is_empty()).then(|| json!(results)))
}

fn storage_name(store: KeyStorage) -> &'static str {
    match store {
        KeyStorage::File => "file",
        KeyStorage::Keychain => "keychain",
    }
}

fn in_storage(source: &KeySource, store: KeyStorage) -> bool {
    matches!(
        (source, store),
        (KeySource::File { .. }, KeyStorage::File)
            | (KeySource::MacosKeychain { .. }, KeyStorage::Keychain)
    )
}

/// One backing secret and the aliases being moved off it.
struct MoveGroup {
    names: Vec<String>,
    previous: KeyEntry,
}

/// Move one alias, or every alias, to file or macOS Keychain storage.
///
/// Every secret is copied (and read-back verified) before the config lock is
/// taken, since Keychain reads and creates may prompt; any failure rolls back
/// all copies. Under the lock the aliases must still be registered exactly as
/// read, and all of them are repointed in one atomic config write. Old copies
/// the CLI created (managed files, Keychain items) are then deleted unless
/// another alias still uses them; external files registered in place are kept.
async fn move_keys(
    name: Option<String>,
    all: bool,
    to: KeyStorage,
    json_format: bool,
) -> Result<(), CliError> {
    let response = move_at(&Config::get_config_path()?, name, all, to).await?;
    output::print_output(json!({"keys": response}), json_format);
    Ok(())
}

async fn move_at(
    path: &Path,
    name: Option<String>,
    all: bool,
    to: KeyStorage,
) -> Result<Value, CliError> {
    let path = path.to_owned();
    let snapshot = Config::load_for_update(&path).await?;
    let names = match (all, name) {
        (true, _) => snapshot.keys.list_keys(),
        (false, Some(name)) => {
            let name = name.strip_prefix("alias:").unwrap_or(&name).to_lowercase();
            snapshot.keys.get_entry(&name)?;
            vec![name]
        }
        (false, None) => {
            return Err(CliError::Validation(
                "Select a key alias to move, or --all".into(),
            ));
        }
    };

    // Aliases sharing one secret move together, as one new copy.
    let mut groups: Vec<MoveGroup> = Vec::new();
    let mut unchanged = Vec::new();
    for name in names {
        let entry = snapshot.keys.get_entry(&name)?;
        let source = snapshot.keys.resolved_source(entry);
        if source.is_ledger() {
            // A Ledger key's secret stays on the device; only --all skips it.
            if !all {
                return Err(CliError::Validation(format!(
                    "Signing key alias {name:?} is a Ledger key; its secret stays on the device and cannot be moved"
                )));
            }
            unchanged.push(name);
            continue;
        }
        if source.is_trezor() {
            // A Trezor key's secret stays on the device; only --all skips it.
            if !all {
                return Err(CliError::Validation(format!(
                    "Signing key alias {name:?} is a Trezor key; its secret stays on the device and cannot be moved"
                )));
            }
            unchanged.push(name);
            continue;
        }
        if in_storage(&source, to) {
            unchanged.push(name);
            continue;
        }
        let mut shared = None;
        for (index, group) in groups.iter().enumerate() {
            if same_source(&group.previous.source, &source)? {
                shared = Some(index);
                break;
            }
        }
        match shared {
            Some(index) if groups[index].previous.public_key != entry.public_key => {
                return Err(CliError::Validation(format!(
                    "Aliases {:?} and {name:?} share a secret but record different public keys; fix the config before moving",
                    groups[index].names[0]
                )));
            }
            Some(index) => groups[index].names.push(name),
            None => groups.push(MoveGroup {
                names: vec![name],
                previous: KeyEntry {
                    public_key: entry.public_key.clone(),
                    source,
                },
            }),
        }
    }

    let directory = path.parent().unwrap_or(Path::new(".")).join("keys");
    let mut staged = Vec::with_capacity(groups.len());
    let mut verified = Vec::with_capacity(groups.len());
    for group in &groups {
        let source = group.previous.source.clone();
        let key = blocking(move || load_source(&source)).await?;
        if key.address_string.to_string() != group.previous.public_key {
            return Err(CliError::Validation(format!(
                "Signing key alias {:?} does not match its registered public key; nothing was moved",
                group.names[0]
            )));
        }
        let copy = LoadedKey::from_seed(key.private_key.clone());
        staged.push(stage(to, directory.clone(), copy).await?);
        verified.push(Arc::new(key));
    }

    let mut moved = Vec::new();
    let mut previous = Vec::new();
    if !groups.is_empty() {
        let lock = lock_config(&path).await?;
        let mut config = Config::load_for_update(&path).await?;
        for (group, secret) in groups.iter().zip(&staged) {
            for name in &group.names {
                let current =
                    config.keys.get_entry(name).ok().map(|entry| {
                        (entry.public_key.clone(), config.keys.resolved_source(entry))
                    });
                if current
                    != Some((
                        group.previous.public_key.clone(),
                        group.previous.source.clone(),
                    ))
                {
                    // Returning drops the lock before the staged copies roll back.
                    return Err(CliError::Validation(format!(
                        "Signing key alias {name:?} changed during the move; nothing was moved"
                    )));
                }
                config
                    .keys
                    .insert_migrated_entry(name, secret.entry.clone(), true)?;
                moved.push(json!({"name": name, "from": group.previous.reference(),
                    "reference": secret.entry.reference()}));
            }
        }
        let cleanups = groups
            .iter()
            .zip(verified)
            .map(|(group, key)| {
                // The CLI creates every Keychain item; files only when managed.
                let explicit = matches!(group.previous.source, KeySource::MacosKeychain { .. });
                (group.previous.clone(), explicit, Some(key))
            })
            .collect();
        previous = commit_config_cleanups(&path, &config, staged, Some(lock), cleanups).await?;
    }
    Ok(
        json!({"operation": "move", "status": "success", "to": storage_name(to),
        "moved": moved, "unchanged": unchanged, "previous": previous}),
    )
}

/// Give Keychain items created before address comments existed their public
/// address as the comment, so they can be identified in Keychain Access.
/// Best effort: a missing item or a refused change is reported, not fatal.
#[cfg(target_os = "macos")]
async fn backfill_keychain_comments(config: &Config) -> Option<Value> {
    // One item may back several aliases; visit each Keychain ID once.
    let mut items = std::collections::BTreeMap::new();
    for name in config.keys.list_keys() {
        if let Ok(entry) = config.keys.get_entry(&name) {
            if let KeySource::MacosKeychain { id } = &entry.source {
                items
                    .entry(id.clone())
                    .or_insert_with(|| entry.public_key.clone());
            }
        }
    }
    if items.is_empty() {
        return None;
    }
    let results = blocking(move || {
        Ok(items
            .into_iter()
            .map(|(id, address)| {
                let reference = format!("keychain:{id}");
                match crate::keys::keychain_backfill_comment(&id, &address) {
                    Ok(status) => json!({"reference": reference, "status": status.as_str()}),
                    Err(error) => json!({"reference": reference, "status": "failed",
                        "error": error.to_string()}),
                }
            })
            .collect::<Vec<_>>())
    })
    .await
    .ok()?;
    Some(json!(results))
}

#[cfg(not(target_os = "macos"))]
async fn backfill_keychain_comments(_: &Config) -> Option<Value> {
    None
}

/// Copy every legacy inline seed into `store` before taking the config lock
/// (Keychain creates and read-backs may prompt), then commit under the lock
/// only if the config file still holds exactly the document that was read.
/// Any failure or concurrent change rolls back every copy (`StagedSecret::drop`)
/// with the lock already released.
async fn migrate_document(
    path: &Path,
    raw: &str,
    store: KeyStorage,
) -> Result<(Config, usize), CliError> {
    let (mut config, inline) = Config::parse_document(raw)?;
    let directory = path.parent().unwrap_or(Path::new("."));
    config.keys.set_base_dir(directory.to_owned());
    let count = inline.len();
    if count == 0 {
        config.validate()?;
        return Ok((config, 0));
    }
    let mut staged = Vec::with_capacity(count);
    for (name, seed) in inline {
        // Hand each copy to `staged` before anything else can fail.
        let secret = stage(store, directory.join("keys"), LoadedKey::from_seed(seed)).await?;
        let entry = secret.entry.clone();
        staged.push(secret);
        config.keys.insert_migrated_entry(&name, entry, false)?;
    }
    // Declared after `staged`, so every early return releases it first.
    let lock = lock_config(path).await?;
    if Config::read_document(path).await?.as_str() != raw {
        return Err(CliError::Validation(
            "The CLI config changed during migration; nothing was migrated. Run 'thru keys migrate' again"
                .into(),
        ));
    }
    commit_config(path, &config, staged, Some(lock), None).await?;
    Ok((config, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;

    #[tokio::test]
    async fn staged_collision_keeps_winner_and_removes_only_losing_secret() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let managed = directory.path().join("keys");
        let winner = stage_secret(
            KeyStorage::File,
            &managed,
            &LoadedKey::from_seed(Zeroizing::new([75; 32])),
        )
        .unwrap();
        let loser = stage_secret(
            KeyStorage::File,
            &managed,
            &LoadedKey::from_seed(Zeroizing::new([76; 32])),
        )
        .unwrap();
        let winner_source = winner.entry.source.clone();
        let loser_source = loser.entry.source.clone();
        register(
            &path,
            "racing",
            winner.entry.clone(),
            Some(winner),
            false,
            "generate",
            true,
        )
        .await
        .unwrap();
        let raw = std::fs::read(&path).unwrap();
        assert!(
            register(
                &path,
                "racing",
                loser.entry.clone(),
                Some(loser),
                false,
                "generate",
                true,
            )
            .await
            .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), raw);
        assert!(load_source(&winner_source).is_ok());
        assert!(load_source(&loser_source).is_err());
        assert_eq!(std::fs::read_dir(managed).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn precheck_rejects_existing_alias_before_any_secret_is_created() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let mut config = Config::default();
        let secret = stage_secret(
            KeyStorage::File,
            &directory.path().join("keys"),
            &LoadedKey::from_seed(Zeroizing::new([60; 32])),
        )
        .unwrap();
        config
            .keys
            .insert_entry("default", secret.entry.clone(), false)
            .unwrap();
        write_config_atomic(&path, &Config::generate_config_template(&config)).unwrap();
        let mut secret = secret;
        secret.commit();
        assert!(precheck_alias(&path, "default", false).await.is_err());
        assert!(precheck_alias(&path, "DEFAULT", false).await.is_err());
        assert!(precheck_alias(&path, "default", true).await.is_ok());
        assert!(precheck_alias(&path, "fresh", false).await.is_ok());
    }

    #[tokio::test]
    async fn registration_fails_when_file_is_swapped_after_initial_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let mut staged = stage_secret(
            KeyStorage::File,
            &directory.path().join("keys"),
            &LoadedKey::from_seed(Zeroizing::new([61; 32])),
        )
        .unwrap();
        staged.commit();
        let entry = KeyEntry {
            public_key: LoadedKey::from_seed(Zeroizing::new([61; 32]))
                .address_string
                .to_string(),
            source: staged.entry.source.clone(),
        };
        let KeySource::File { path: file, .. } = &entry.source else {
            unreachable!()
        };
        std::fs::write(file, hex::encode([62; 32])).unwrap();
        let error = register(&path, "swapped", entry, None, false, "add", true)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("changed during registration"), "{error}");
        assert!(!path.exists());
    }

    #[test]
    fn cleanup_reuses_verified_identity_without_rereading_secret() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let mut staged = stage_secret(
            KeyStorage::File,
            &directory.path().join("keys"),
            &LoadedKey::from_seed(Zeroizing::new([63; 32])),
        )
        .unwrap();
        staged.commit();
        let verified = load_source(&staged.entry.source).unwrap();
        let KeySource::File { path: file, .. } = &staged.entry.source else {
            unreachable!()
        };
        // A reread would now see a different identity and retain the file.
        std::fs::write(file, hex::encode([64; 32])).unwrap();
        let config = Config::default();
        assert_eq!(
            cleanup_source(&path, &config, &staged.entry, true, Some(&verified))["status"],
            "deleted"
        );
    }

    #[tokio::test]
    async fn migration_rolls_back_copies_when_config_changed_before_commit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let read = format!("keys:\n  default: '{}'\n", hex::encode([66; 32]));
        // Another writer replaced the file after migration read it.
        let current = format!("keys:\n  other: '{}'\n", hex::encode([67; 32]));
        std::fs::write(&path, &current).unwrap();
        let error = migrate_document(&path, &read, KeyStorage::File)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("changed during migration"), "{error}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), current);
        // The copy made before locking is gone, and the lock is released.
        assert_eq!(
            std::fs::read_dir(directory.path().join("keys"))
                .unwrap()
                .count(),
            0
        );
        let other = std::fs::File::open(directory.path().join(".keys.lock")).unwrap();
        assert!(fs2::FileExt::try_lock_exclusive(&other).is_ok());
    }

    #[tokio::test]
    async fn registration_rechecks_file_removed_after_initial_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let mut source = stage_secret(
            KeyStorage::File,
            &directory.path().join("keys"),
            &LoadedKey::from_seed(Zeroizing::new([77; 32])),
        )
        .unwrap();
        source.commit();
        let key = load_source(&source.entry.source).unwrap();
        let entry = KeyEntry {
            public_key: key.address_string.to_string(),
            source: source.entry.source.clone(),
        };
        // A serialized removal wins between the import's read and writer lock.
        delete_source(&source.entry.source).unwrap();
        assert!(
            register(&path, "dangling", entry, None, false, "add", true)
                .await
                .is_err()
        );
        assert!(!path.exists());
    }

    #[test]
    fn external_alias_of_known_managed_source_inherits_ownership() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let key = LoadedKey::from_seed(Zeroizing::new([79; 32]));
        let mut staged =
            stage_secret(KeyStorage::File, &directory.path().join("keys"), &key).unwrap();
        staged.commit();
        let mut config = Config::default();
        config
            .keys
            .insert_entry("a", staged.entry.clone(), false)
            .unwrap();
        let mut registered = staged.entry.clone();
        if let KeySource::File { managed, .. } = &mut registered.source {
            *managed = false;
        }
        assert!(same_source(&registered.source, &staged.entry.source).unwrap());
        inherit_managed_source(&config, &mut registered).unwrap();
        assert!(matches!(
            &registered.source,
            KeySource::File { managed: true, .. }
        ));
        config
            .keys
            .insert_entry("b", registered.clone(), false)
            .unwrap();
        config.keys.remove_key("a").unwrap();
        assert_eq!(
            cleanup_source(&path, &config, &staged.entry, false, None)["status"],
            "retained"
        );
        config.keys.remove_key("b").unwrap();
        assert_eq!(
            cleanup_source(&path, &config, &registered, false, None)["status"],
            "deleted"
        );
    }

    #[tokio::test]
    async fn managed_overwrite_and_remove_cleanup_follow_commit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let managed = directory.path().join("keys");
        let mut config = Config::default();
        for seed in 80..84 {
            let prior = config.keys.get_entry("alice").ok().cloned();
            let key = LoadedKey::from_seed(Zeroizing::new([seed; 32]));
            let secret = stage_secret(KeyStorage::File, &managed, &key).unwrap();
            config
                .keys
                .insert_entry("alice", secret.entry.clone(), true)
                .unwrap();
            let cleanup = commit_config(
                &path,
                &config,
                vec![secret],
                None,
                prior.clone().map(|entry| (entry, false, None)),
            )
            .await
            .unwrap();
            if let Some(prior) = prior {
                assert_eq!(cleanup.unwrap()["status"], "deleted");
                assert!(load_source(&prior.source).is_err());
            }
            assert_eq!(std::fs::read_dir(&managed).unwrap().count(), 1);
        }
        let removed = remove_key_from_config(&mut config, "alice", false).unwrap();
        let cleanup = commit_config(
            &path,
            &config,
            Vec::new(),
            None,
            Some((removed, false, None)),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(cleanup["status"], "deleted");
        assert_eq!(std::fs::read_dir(&managed).unwrap().count(), 0);
    }

    #[test]
    fn cleanup_preserves_same_shared_external_and_outside_managed_sources() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let key = LoadedKey::from_seed(Zeroizing::new([84; 32]));
        let mut secret =
            stage_secret(KeyStorage::File, &directory.path().join("keys"), &key).unwrap();
        secret.commit();
        let entry = secret.entry.clone();
        let mut config = Config::default();
        config
            .keys
            .insert_entry("same", entry.clone(), false)
            .unwrap();
        assert_eq!(
            cleanup_source(&path, &config, &entry, false, None)["status"],
            "retained"
        );
        config
            .keys
            .insert_entry("shared", entry.clone(), false)
            .unwrap();
        config.keys.remove_key("same").unwrap();
        assert_eq!(
            cleanup_source(&path, &config, &entry, false, None)["status"],
            "retained"
        );
        config.keys.remove_key("shared").unwrap();
        let mut external = entry.clone();
        if let KeySource::File { managed, .. } = &mut external.source {
            *managed = false;
        }
        assert_eq!(
            cleanup_source(&path, &config, &external, false, None)["status"],
            "retained"
        );
        assert!(load_source(&entry.source).is_ok());
        let mut outside =
            stage_secret(KeyStorage::File, &directory.path().join("external"), &key).unwrap();
        outside.commit();
        assert_eq!(
            cleanup_source(&path, &config, &outside.entry, false, None)["status"],
            "retained"
        );
        assert!(load_source(&outside.entry.source).is_ok());
        assert_eq!(
            cleanup_source(&path, &config, &external, true, None)["status"],
            "deleted"
        );
    }

    #[tokio::test]
    async fn failed_cleanup_retains_secret_without_rolling_back_registration() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let managed = directory.path().join("keys");
        let mut original = stage_secret(
            KeyStorage::File,
            &managed,
            &LoadedKey::from_seed(Zeroizing::new([85; 32])),
        )
        .unwrap();
        original.commit();
        let old = original.entry.clone();
        let KeySource::File { path: old_path, .. } = &old.source else {
            unreachable!()
        };
        std::fs::write(old_path, hex::encode([86; 32])).unwrap();
        let replacement = stage_secret(
            KeyStorage::File,
            &managed,
            &LoadedKey::from_seed(Zeroizing::new([87; 32])),
        )
        .unwrap();
        let expected = replacement.entry.public_key.clone();
        let mut config = Config::default();
        config
            .keys
            .insert_entry("alice", replacement.entry.clone(), false)
            .unwrap();
        let cleanup = commit_config(
            &path,
            &config,
            vec![replacement],
            None,
            Some((old, false, None)),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(cleanup["status"], "retained");
        assert!(cleanup["error"].is_string());
        let raw = Config::read_document(&path).await.unwrap();
        let (saved, _) = Config::parse_document(&raw).unwrap();
        assert_eq!(saved.keys.get_entry("alice").unwrap().public_key, expected);
        assert_eq!(std::fs::read_dir(&managed).unwrap().count(), 2);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn migration_repairs_legacy_directory_and_preserves_colon_alias() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let raw = format!("keys:\n  'acc:1': '{}'\n", hex::encode([88; 32]));
        std::fs::write(&path, &raw).unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let (config, count) = migrate_document(&path, &raw, KeyStorage::File)
            .await
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            *config.keys.load_key("acc:1").unwrap().private_key,
            [88; 32]
        );
        assert_eq!(
            std::fs::metadata(directory.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert!(
            Config::read_document(&path)
                .await
                .unwrap()
                .starts_with("# Thru CLI Configuration File")
        );
    }

    #[test]
    fn get_and_list_only_use_public_metadata() {
        let (_directory, keys) = KeyManager::test_fixture(&[("default", [1; 32])]);
        let config = Config {
            keys,
            ..Config::default()
        };
        delete_source(&config.keys.get_entry("default").unwrap().source).unwrap();
        let entry = entry_output(&config.keys, "DEFAULT").unwrap();
        assert!(entry["public_key"].as_str().unwrap().starts_with("ta"));
        assert!(entry.get("value").is_none());
        assert_eq!(entries(&config).unwrap().len(), 1);
    }

    #[test]
    fn default_removal_requires_force_and_retains_secret_until_commit() {
        let (_directory, keys) = KeyManager::test_fixture(&[("default", [2; 32])]);
        let mut config = Config {
            keys,
            ..Config::default()
        };
        assert!(remove_key_from_config(&mut config, "DEFAULT", false).is_err());
        assert!(config.keys.has_key("default"));
        let entry = remove_key_from_config(&mut config, "default", true).unwrap();
        assert!(load_source(&entry.source).is_ok());
    }

    #[tokio::test]
    async fn failed_config_commit_preserves_old_registration_and_secret() {
        let (directory, keys) = KeyManager::test_fixture(&[("default", [3; 32])]);
        let original = Config {
            keys,
            ..Config::default()
        };
        let original_yaml = serde_yaml::to_string(&original).unwrap();
        let original_path = directory.path().join("original.yaml");
        std::fs::write(&original_path, &original_yaml).unwrap();
        let mut updated = original.clone();
        let key = LoadedKey::from_seed(Zeroizing::new([4; 32]));
        let staged = stage_secret(KeyStorage::File, directory.path(), &key).unwrap();
        let staged_source = staged.entry.source.clone();
        updated
            .keys
            .insert_entry("default", staged.entry.clone(), true)
            .unwrap();
        // Rename over an existing directory fails after the staged write.
        let target = directory.path().join("cannot-replace");
        std::fs::create_dir(&target).unwrap();
        assert!(
            commit_config(&target, &updated, vec![staged], None, None)
                .await
                .is_err()
        );
        assert!(load_source(&staged_source).is_err());
        assert!(original.keys.load_key("default").is_ok());
        assert_eq!(
            std::fs::read_to_string(original_path).unwrap(),
            original_yaml
        );
    }

    const TREZOR_ADDRESS: &str = "taHWXdTRD0-KOS2eF8TYzep8aOKj6tw1mXu7ZzjjnMDm6A";

    /// What `keys add-trezor` commits, without a device: the registration of
    /// path 0 under the config lock, then the config read back.
    #[tokio::test]
    async fn add_trezor_registers_path_and_address_and_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.yaml");
        let path = TrezorPath::new(0).unwrap();
        let response = register_entry(
            &config_path,
            "TZ",
            trezor_entry_at(path, TREZOR_ADDRESS.into(), false),
            None,
            false,
            "add-trezor",
        )
        .await
        .unwrap();
        assert_eq!(response["operation"], "add-trezor");
        assert_eq!(response["status"], "success");

        let raw = std::fs::read_to_string(&config_path).unwrap();
        assert!(raw.contains("type: trezor"), "{raw}");
        assert!(!raw.contains("trezor://"), "{raw}");
        let config = Config::load_for_update(&config_path).await.unwrap();
        let entry = config.keys.get_entry("tz").unwrap();
        assert_eq!(
            entry.source,
            KeySource::Trezor {
                path,
                passphrase: false
            }
        );
        assert_eq!(entry.reference(), "trezor://44'/8478'/0'/0'");
        assert_eq!(entry.public_key, TREZOR_ADDRESS);
        let info = describe_key(&config, "tz").unwrap();
        assert_eq!(info["type"], "trezor");
        assert_eq!(info["public_key"], TREZOR_ADDRESS);
        assert_eq!(info["source"], "trezor://44'/8478'/0'/0'");
        assert_eq!(info["path"], path.to_string());
        assert_eq!(info["cached"], true);
        // Removal unregisters it; the secret stays on the device.
        let mut config = config;
        let removed = remove_key_from_config(&mut config, "tz", false).unwrap();
        assert!(removed.source.is_trezor());
        assert!(delete_source(&removed.source).is_err());
    }

    #[tokio::test]
    async fn add_trezor_refuses_an_existing_name_until_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.yaml");
        let first = TrezorPath::new(0).unwrap();
        let second = TrezorPath::new(1).unwrap();
        let second_address = Pubkey::from_bytes(&[9; 32]).to_string();
        register_entry(
            &config_path,
            "tz",
            trezor_entry_at(first, TREZOR_ADDRESS.into(), false),
            None,
            false,
            "add-trezor",
        )
        .await
        .unwrap();
        // Refused before the device is asked anything (any case of the name).
        assert!(precheck_alias(&config_path, "TZ", false).await.is_err());
        assert!(precheck_alias(&config_path, "TZ", true).await.is_ok());
        let error = register_entry(
            &config_path,
            "TZ",
            trezor_entry_at(second, second_address.clone(), false),
            None,
            false,
            "add-trezor",
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("--overwrite"), "{error}");
        let config = Config::load_for_update(&config_path).await.unwrap();
        assert_eq!(
            config.keys.get_entry("tz").unwrap().source,
            KeySource::Trezor {
                path: first,
                passphrase: false
            }
        );

        register_entry(
            &config_path,
            "tz",
            trezor_entry_at(second, second_address.clone(), false),
            None,
            true,
            "add-trezor",
        )
        .await
        .unwrap();
        let config = Config::load_for_update(&config_path).await.unwrap();
        let entry = config.keys.get_entry("tz").unwrap();
        assert_eq!(
            entry.source,
            KeySource::Trezor {
                path: second,
                passphrase: false
            }
        );
        assert_eq!(entry.public_key, second_address);
    }

    #[test]
    fn test_ledger_key_record_describe_remove() {
        use std::sync::Arc;
        use thru_ledger::mock::SoftDevice;
        let dev = Arc::new(SoftDevice::abandon());
        let path = DerivationPath::new(0).unwrap();
        let signer = crate::signing::connect_ledger_with(dev.clone(), path, None).unwrap();
        signer.verify_address_on_device().unwrap();

        let (_directory, keys) = KeyManager::test_fixture(&[("default", [5; 32])]);
        let mut config = Config {
            keys,
            ..Config::default()
        };
        record_ledger_key(&mut config, "HW", &signer, false).unwrap();
        let entry = config.keys.get_entry("hw").unwrap();
        assert_eq!(entry.source, KeySource::Ledger { path });
        assert_eq!(entry.reference(), path.to_uri());
        assert_eq!(entry.public_key, signer.address());
        let info = describe_key(&config, "hw").unwrap();
        assert_eq!(info["type"], "ledger");
        assert_eq!(info["public_key"], signer.address());
        assert_eq!(info["path"], path.to_string());
        assert_eq!(info["source"], path.to_uri());
        assert_eq!(info["cached"], true);
        // The raw path finds the registered address without the device.
        let before = dev.apdu_log().len();
        assert_eq!(
            describe_key(&config, &path.to_uri()).unwrap()["public_key"],
            signer.address()
        );
        assert_eq!(dev.apdu_log().len(), before);
        // No overwrite without the flag.
        assert!(record_ledger_key(&mut config, "hw", &signer, false).is_err());
        // Local keys never expose the private key.
        let local = describe_key(&config, "default").unwrap();
        assert_eq!(local["type"], "local");
        assert!(local.get("value").is_none());
        // The registration survives a config round trip as a reference.
        let yaml = serde_yaml::to_string(&config).unwrap();
        assert!(yaml.contains("type: ledger"), "{yaml}");
        let (back, _) = Config::parse_document(&yaml).unwrap();
        assert_eq!(
            back.keys.get_entry("hw").unwrap().source,
            KeySource::Ledger { path }
        );

        // Removal unregisters it; there is no secret to read or delete.
        let removed = remove_key_from_config(&mut config, "hw", false).unwrap();
        assert!(removed.source.is_ledger());
        assert!(!config.keys.has_key("hw"));
        assert!(load_source(&removed.source).is_err());
        assert!(delete_source(&removed.source).is_err());
    }

    #[tokio::test]
    async fn migration_is_secret_free_and_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let first = hex::encode([11; 32]);
        let second = hex::encode([12; 32]);
        let raw = format!(
            "rpc_base_url: http://localhost:8472\nkeys:\n  DEFAULT: '{first}'\n  Other: '{second}'\n"
        );
        std::fs::write(&path, &raw).unwrap();
        let (config, count) = migrate_document(&path, &raw, KeyStorage::File)
            .await
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            *config.keys.load_key("default").unwrap().private_key,
            [11; 32]
        );
        assert_eq!(
            *config.keys.load_key("other").unwrap().private_key,
            [12; 32]
        );
        let saved = Config::read_document(&path).await.unwrap();
        assert!(!saved.contains(&first));
        assert!(!saved.contains(&second));
        let (again, count) = migrate_document(&path, &saved, KeyStorage::File)
            .await
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            again.keys.get_entry("default").unwrap().reference(),
            config.keys.get_entry("default").unwrap().reference()
        );
        assert_eq!(
            std::fs::read_dir(directory.path().join("keys"))
                .unwrap()
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn invalid_migration_keeps_original_config_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let raw = format!(
            "keys:\n  default: '{}'\n  invalid: bad\n",
            hex::encode([13; 32])
        );
        std::fs::write(&path, &raw).unwrap();
        assert!(
            migrate_document(&path, &raw, KeyStorage::File)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
        assert!(!directory.path().join("keys").exists());
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn unavailable_keychain_migration_preserves_legacy_file_without_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let raw = format!("keys:\n  default: '{}'\n", hex::encode([14; 32]));
        std::fs::write(&path, &raw).unwrap();
        assert!(
            migrate_document(&path, &raw, KeyStorage::Keychain)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
        assert!(!directory.path().join("keys").exists());
    }

    fn address(seed: [u8; 32]) -> String {
        LoadedKey::from_seed(Zeroizing::new(seed))
            .address_string
            .to_string()
    }

    /// A legacy bare-hex key file with owner-only permissions.
    #[cfg(unix)]
    fn legacy_key_file(directory: &Path, name: &str, seed: [u8; 32]) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(directory).unwrap();
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.join(name);
        std::fs::write(&path, hex::encode(seed)).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        path
    }

    fn file_entry(path: &Path, seed: [u8; 32], managed: bool) -> KeyEntry {
        KeyEntry {
            public_key: address(seed),
            source: KeySource::File {
                path: path.to_owned(),
                managed,
            },
        }
    }

    fn write_entries(path: &Path, entries: &[(&str, KeyEntry)]) {
        let mut config = Config::default();
        for (name, entry) in entries {
            config
                .keys
                .insert_entry(name, entry.clone(), false)
                .unwrap();
        }
        write_config_atomic(path, &Config::generate_config_template(&config)).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn migrate_converts_managed_legacy_key_files_but_not_external_ones() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let managed = legacy_key_file(&directory.path().join("keys"), "old.key", [81; 32]);
        let external = legacy_key_file(&directory.path().join("mine"), "my.hex", [82; 32]);
        write_entries(
            &path,
            &[
                ("managed", file_entry(&managed, [81; 32], true)),
                ("shared", file_entry(&managed, [81; 32], true)),
                ("external", file_entry(&external, [82; 32], false)),
            ],
        );
        let config_before = std::fs::read(&path).unwrap();

        let converted = convert_legacy_key_files(&path).await.unwrap().unwrap();
        assert_eq!(
            converted,
            json!([{"reference": format!("file:{}", managed.display()), "status": "converted"}])
        );
        let value: Value =
            serde_json::from_str(&std::fs::read_to_string(&managed).unwrap()).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["key_type"], "ed25519");
        assert_eq!(value["public_key"], address([81; 32]));
        let source = file_entry(&managed, [81; 32], true).source;
        assert_eq!(*load_source(&source).unwrap().private_key, [81; 32]);
        // External files and the config itself are untouched.
        assert_eq!(
            std::fs::read_to_string(&external).unwrap(),
            hex::encode([82; 32])
        );
        assert_eq!(std::fs::read(&path).unwrap(), config_before);
        // Nothing left to convert, and no temp file is left behind.
        assert!(convert_legacy_key_files(&path).await.unwrap().is_none());
        assert_eq!(
            std::fs::read_dir(directory.path().join("keys"))
                .unwrap()
                .count(),
            1
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn move_leaves_keys_already_in_storage_and_checks_identity_first() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let file = legacy_key_file(&directory.path().join("keys"), "a.key", [83; 32]);
        // "wrong" records a public key its file does not hold.
        write_entries(
            &path,
            &[
                ("alice", file_entry(&file, [83; 32], true)),
                ("wrong", file_entry(&file, [84; 32], true)),
            ],
        );
        let before = std::fs::read(&path).unwrap();
        let response = move_at(&path, None, true, KeyStorage::File).await.unwrap();
        assert_eq!(response["unchanged"], json!(["alice", "wrong"]));
        assert_eq!(response["moved"], json!([]));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(
            move_at(&path, Some("nobody".into()), false, KeyStorage::File)
                .await
                .is_err()
        );
        // The identity check fails before any copy is created.
        let error = move_at(&path, Some("wrong".into()), false, KeyStorage::Keychain)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("does not match"), "{error}");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(file.exists());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "requires an unlocked native macOS Keychain; creates and removes unique test entries"]
    async fn move_round_trips_between_files_and_keychain() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let managed = legacy_key_file(&directory.path().join("keys"), "shared.key", [86; 32]);
        let external = legacy_key_file(&directory.path().join("mine"), "mine.hex", [87; 32]);
        write_entries(
            &path,
            &[
                ("one", file_entry(&managed, [86; 32], true)),
                ("two", file_entry(&managed, [86; 32], true)),
                ("ext", file_entry(&external, [87; 32], false)),
            ],
        );
        let seeds = [("ext", [87; 32]), ("one", [86; 32]), ("two", [86; 32])];

        // One alias of a shared secret: the old copy stays for the other alias.
        let single = move_at(&path, Some("one".into()), false, KeyStorage::Keychain)
            .await
            .unwrap();
        assert_eq!(single["moved"][0]["name"], "one");
        assert_eq!(single["previous"][0]["status"], "retained");
        assert!(managed.exists());

        // The rest: the managed file is then unused and deleted; the external
        // file is the user's and is kept.
        let all = move_at(&path, None, true, KeyStorage::Keychain)
            .await
            .unwrap();
        assert_eq!(all["unchanged"], json!(["one"]));
        assert_eq!(all["moved"].as_array().unwrap().len(), 2);
        assert!(!managed.exists());
        assert!(external.exists());
        let config = Config::load_for_update(&path).await.unwrap();
        let mut items = Vec::new();
        for (name, seed) in seeds {
            let entry = config.keys.get_entry(name).unwrap();
            let KeySource::MacosKeychain { .. } = &entry.source else {
                panic!("{name} was not moved to the Keychain");
            };
            items.push(entry.source.clone());
            assert_eq!(*config.keys.load_key(name).unwrap().private_key, seed);
        }

        // And back: every key into a new JSON file, every Keychain item deleted.
        let back = move_at(&path, None, true, KeyStorage::File).await.unwrap();
        assert_eq!(back["moved"].as_array().unwrap().len(), 3);
        assert!(
            back["previous"]
                .as_array()
                .unwrap()
                .iter()
                .all(|previous| previous["status"] == "deleted"),
            "{back}"
        );
        for item in items {
            assert!(load_source(&item).is_err());
        }
        let config = Config::load_for_update(&path).await.unwrap();
        for (name, seed) in seeds {
            let entry = config.keys.get_entry(name).unwrap();
            let KeySource::File {
                path: file,
                managed: true,
            } = &entry.source
            else {
                panic!("{name} was not moved to a managed file");
            };
            let value: Value =
                serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
            assert_eq!(value["public_key"], address(seed));
            assert_eq!(*config.keys.load_key(name).unwrap().private_key, seed);
        }
    }

    fn address_of(byte: u8) -> String {
        Pubkey::from_bytes(&[byte; 32]).to_string()
    }

    const STANDARD_URI: &str = "trezor://44'/8478'/0'/0'";

    /// Registers a standard key `std` (key 1) and the passphrase keys `hid`
    /// (key 2) and `other` (key 3), all on path 0, through the registration
    /// the command uses.
    async fn register_trezor_keys(config_path: &Path) -> Vec<Value> {
        let path = TrezorPath::new(0).unwrap();
        let mut responses = Vec::new();
        for (name, byte, passphrase) in [("std", 1, false), ("hid", 2, true), ("other", 3, true)] {
            responses.push(
                register_entry(
                    config_path,
                    name,
                    trezor_entry_at(path, address_of(byte), passphrase),
                    None,
                    false,
                    "add-trezor",
                )
                .await
                .unwrap(),
            );
        }
        responses
    }

    /// X3: every place that prints something a person can pass back as a key
    /// gives a passphrase key as `alias:NAME`, in text and in JSON, and it
    /// resolves to that key and not to the standard wallet on the same path.
    #[tokio::test]
    async fn passphrase_key_references_resolve_back_in_every_output() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.yaml");
        let responses = register_trezor_keys(&config_path).await;
        let config = Config::load_for_update(&config_path).await.unwrap();
        let hidden = config.keys.get_entry("hid").unwrap().clone();
        let resolves = |reference: &str, byte: u8, passphrase: bool| {
            let target = config.keys.trezor_source(reference).unwrap().unwrap();
            assert_eq!(target.passphrase(), passphrase, "{reference}");
            assert_eq!(target.expected(), Some([byte; 32]), "{reference}");
        };

        // keys add-trezor: JSON and text.
        let added = trezor_added_json("HID", &hidden, true, false);
        assert_eq!(added["trezor_key"]["source"], "alias:hid");
        assert_eq!(added["trezor_key"]["passphrase"], true);
        assert_eq!(added["trezor_key"]["path"], "m/44'/8478'/0'/0'");
        assert_eq!(added["trezor_key"]["public_key"], address_of(2));
        resolves(added["trezor_key"]["source"].as_str().unwrap(), 2, true);
        let text = trezor_added_text("HID", &hidden, true, false);
        assert!(text.contains("select it as alias:hid"), "{text}");
        assert!(text.contains("the standard wallet"), "{text}");
        assert!(text.contains("m/44'/8478'/0'/0'"), "{text}");
        assert!(!text.contains("a trezor://44"), "{text}");
        // The registration's own response (what `register` prints).
        assert_eq!(responses[1]["reference"], "alias:hid");
        assert_eq!(responses[1]["passphrase"], true);

        // keys show: JSON and text.
        for name in ["hid", "alias:hid", "HID"] {
            let info = describe_key(&config, name).unwrap();
            assert_eq!(info["source"], "alias:hid", "{name}");
            assert_eq!(info["passphrase"], true);
            assert_eq!(info["path"], "m/44'/8478'/0'/0'");
            assert_eq!(info["public_key"], address_of(2));
            resolves(info["source"].as_str().unwrap(), 2, true);
            let text = show_text(&info);
            assert!(text.contains("Source:  alias:hid\n"), "{text}");
            assert!(text.contains("Passphrase wallet: yes"), "{text}");
            assert!(text.contains("Path:    m/44'/8478'/0'/0'"), "{text}");
        }

        // keys list and keys get: JSON and text.
        let listed = entries(&config).unwrap();
        let find = |name: &str| listed.iter().find(|entry| entry["name"] == name).unwrap();
        for (name, byte) in [("hid", 2), ("other", 3)] {
            let entry = find(name);
            assert_eq!(entry["reference"], format!("alias:{name}"));
            assert_eq!(entry["passphrase"], true);
            assert_eq!(entry["path"], "m/44'/8478'/0'/0'");
            assert_eq!(entry["source"]["passphrase"], true);
            resolves(entry["reference"].as_str().unwrap(), byte, true);
            let text = crate::output::format_key_entry(entry);
            assert!(
                text.contains(&format!("Key reference: alias:{name}\n")),
                "{text}"
            );
            assert!(text.contains("Passphrase wallet: yes"), "{text}");
            assert!(text.contains("Path: m/44'/8478'/0'/0'"), "{text}");
            assert!(!text.contains("trezor://"), "{text}");
        }
        let got = entry_output(&config.keys, "HID").unwrap();
        assert_eq!(&got, find("hid"));

        // The standard wallet on the same path is unchanged: the URI, and no
        // passphrase field anywhere.
        assert_eq!(
            find("std"),
            &json!({"name": "std", "public_key": address_of(1),
                "reference": STANDARD_URI,
                "source": {"type": "trezor", "path": "44'/8478'/0'/0'"}})
        );
        resolves(STANDARD_URI, 1, false);
        let info = describe_key(&config, "std").unwrap();
        assert_eq!(
            info,
            json!({"name": "std", "type": "trezor", "source": STANDARD_URI,
                "path": "m/44'/8478'/0'/0'", "public_key": address_of(1), "cached": true})
        );
        let text = show_text(&info);
        assert_eq!(
            text,
            format!(
                "Key 'std' (trezor)\n  Address: {}\n  Path:    m/44'/8478'/0'/0'\n  Source:  {STANDARD_URI}\n",
                address_of(1)
            )
        );
        let uri_info = describe_key(&config, STANDARD_URI).unwrap();
        assert_eq!(uri_info["public_key"], address_of(1));
        assert_eq!(uri_info["source"], STANDARD_URI);
        assert!(uri_info.get("passphrase").is_none());
        let standard = config.keys.get_entry("std").unwrap().clone();
        let added = trezor_added_json("std", &standard, false, false);
        assert_eq!(added["trezor_key"]["source"], STANDARD_URI);
        assert!(added["trezor_key"].get("passphrase").is_none());
        let text = trezor_added_text("std", &standard, true, false);
        assert_eq!(
            text,
            format!(
                "Trezor key 'std' added: {} (m/44'/8478'/0'/0'), address confirmed on the device",
                address_of(1)
            )
        );
        let text = crate::output::format_key_entry(find("std"));
        assert!(
            !text.contains("Passphrase") && !text.contains("Path:"),
            "{text}"
        );
    }

    /// X3: a passphrase key that no alias names any more (replaced by a new
    /// registration under the same alias, or removed) is reported by its public
    /// key, its path and the flag, with no reference, in JSON and in text; the
    /// alias then resolves to the new key. A standard key is reported as ever.
    #[tokio::test]
    async fn a_passphrase_key_without_an_alias_is_reported_without_a_reference() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.yaml");
        register_trezor_keys(&config_path).await;
        let path = TrezorPath::new(0).unwrap();

        // Replaced under the same alias by another passphrase key.
        let replaced = register_entry(
            &config_path,
            "hid",
            trezor_entry_at(path, address_of(4), true),
            None,
            true,
            "add-trezor",
        )
        .await
        .unwrap();
        let report = &replaced["secret"];
        assert_eq!(
            report,
            &json!({"public_key": address_of(2), "path": "m/44'/8478'/0'/0'",
                "passphrase": true, "status": "retained"})
        );
        assert!(report.get("reference").is_none());
        let text = crate::output::format_backing_secret(report);
        assert!(text.contains(&address_of(2)), "{text}");
        assert!(text.contains("m/44'/8478'/0'/0'"), "{text}");
        assert!(
            !text.contains("null") && !text.contains("trezor://"),
            "{text}"
        );
        assert!(!text.contains("alias:"), "{text}");
        let config = Config::load_for_update(&config_path).await.unwrap();
        let target = config.keys.trezor_source("hid").unwrap().unwrap();
        assert_eq!(
            (target.passphrase(), target.expected()),
            (true, Some([4; 32]))
        );
        assert_eq!(replaced["reference"], "alias:hid");

        // Removed.
        let mut config = config;
        let removed = remove_key_from_config(&mut config, "other", false).unwrap();
        let cleanup = commit_config(
            &config_path,
            &config,
            Vec::new(),
            None,
            Some((removed, false, None)),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            cleanup,
            json!({"public_key": address_of(3), "path": "m/44'/8478'/0'/0'",
                "passphrase": true, "status": "retained"})
        );
        let text = crate::output::format_backing_secret(&cleanup);
        assert!(text.contains(&address_of(3)), "{text}");
        assert!(
            !text.contains("null") && !text.contains("trezor://"),
            "{text}"
        );
        let config = Config::load_for_update(&config_path).await.unwrap();
        assert!(config.keys.trezor_source("other").unwrap().is_none());

        // A standard key: the report is the reference of its source, as ever.
        let replaced = register_entry(
            &config_path,
            "std",
            trezor_entry_at(path, address_of(5), false),
            None,
            true,
            "add-trezor",
        )
        .await
        .unwrap();
        assert_eq!(
            replaced["secret"],
            json!({"reference": STANDARD_URI, "status": "retained"})
        );
        assert_eq!(
            crate::output::format_backing_secret(&replaced["secret"]),
            format!("Retained backing secret: {STANDARD_URI}")
        );
    }
}
