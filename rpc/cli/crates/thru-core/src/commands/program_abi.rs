//! `thru program create|upgrade --abi`: deploy a managed program and its
//! official ABI in one Multicall transaction, so the on-chain ABI always
//! matches the program it describes.

use std::fs;
use std::path::Path;

use base64::{Engine as _, engine::general_purpose};
use thru_base::program_abi::{
    AbiStep, ProgramAbiAccounts, ProgramAbiDigests, ProgramAbiSizes, ProgramStep,
    build_program_abi_transaction,
};
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::Pubkey;
use thru_client::Client as RpcClient;

use crate::cli::ProgramAbiArgs;
use crate::commands::abi::{
    ABI_STATE_FINALIZED, abi_account_header, official_abi_accounts, read_abi_file,
    validate_publishable_abi,
};
use crate::commands::program::{ProgramManager, seed_with_suffix, validate_program_file_or_report};
use crate::commands::uploader::UploaderManager;
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;

/// Short guidance printed after an ABI is published with a program.
pub(crate) const ABI_APPEND_ONLY_TIP: &str = "Tip: keep ABI changes append-only (add new variants or fields; never change or reuse existing ones) so tools can still decode older data.";

/// How a program create/upgrade treats the program's official ABI.
pub(crate) enum AbiChoice {
    /// Publish this ABI with the program.
    Publish { path: String, data: Vec<u8> },
    /// `--dangerously-exclude-abi`: deploy the program alone.
    Exclude,
}

/// Resolve `--abi` / `--dangerously-exclude-abi`. Exactly one is required.
pub(crate) fn resolve_abi_choice(
    args: &ProgramAbiArgs,
    json_format: bool,
) -> Result<AbiChoice, CliError> {
    match (&args.abi, args.dangerously_exclude_abi) {
        (Some(path), false) => {
            let data = read_abi_file(path, json_format)?;
            validate_publishable_abi(path, &data)?;
            Ok(AbiChoice::Publish {
                path: path.clone(),
                data,
            })
        }
        (None, true) => Ok(AbiChoice::Exclude),
        (None, false) => Err(CliError::Validation(
            "an ABI is required so the on-chain ABI matches the program. \
             Pass --abi <ABI_FILE>, or --dangerously-exclude-abi to deploy the program alone"
                .into(),
        )),
        // clap rejects both flags together.
        (Some(_), true) => Err(CliError::Validation(
            "--abi and --dangerously-exclude-abi can't be used together".into(),
        )),
    }
}

/// Warning shown when a program is deployed without its ABI.
pub(crate) fn warn_abi_excluded(json_format: bool) {
    if !json_format {
        output::print_warning(
            "Deploying without an ABI (--dangerously-exclude-abi): the program's on-chain ABI, if any, may no longer match it.",
        );
    }
}

/// Decode a user error code that may come from either the Manager or the
/// ABI Manager (their code spaces overlap).
fn decode_program_abi_error(code: u64) -> String {
    let abi_reason = match code & 0xFF {
        0x01 => "invalid account index",
        0x02 => "account not found",
        0x03 => "account not writable",
        0x04 => "invalid size",
        0x05 => "invalid owner",
        0x06 => "invalid authority",
        0x07 => "invalid state",
        0x08 => "account already exists",
        _ => "unknown",
    };
    let abi_object = match code & 0xFF00 {
        0x0100 => " in instruction",
        0x0200 => " in program meta",
        0x0300 => " in ABI account",
        0x0400 => " in source buffer",
        0x0500 => " in ABI meta",
        0x0600 => " in ABI meta kind",
        _ => "",
    };
    format!(
        "{} (if from the ABI Manager: {}{})",
        ProgramManager::decode_manager_error(code),
        abi_reason,
        abi_object
    )
}

/// An account's data, or None when it doesn't exist.
async fn fetch_account(
    client: &RpcClient,
    address: &Pubkey,
) -> Result<Option<(u64, Vec<u8>)>, CliError> {
    let info = client
        .get_account_info(address, None, None)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to fetch account {}: {}", address, e),
        })?;
    match info {
        Some(account) if !account.is_deleted => {
            let data = match &account.data {
                Some(b64) => {
                    general_purpose::STANDARD
                        .decode(b64)
                        .map_err(|e| CliError::Generic {
                            message: format!("Bad account data for {}: {}", address, e),
                        })?
                }
                None => Vec::new(),
            };
            Ok(Some((account.data_size, data)))
        }
        _ => Ok(None),
    }
}

/// The official ABI's on-chain state for a program.
pub(crate) enum OfficialAbiState {
    /// Neither the ABI meta nor the ABI account exists.
    Missing,
    /// The ABI meta exists but the ABI account doesn't.
    MetaOnly,
    /// The ABI account exists.
    Present { revision: u64, content_size: u32 },
}

/// Read the official ABI's state, refusing a finalized ABI.
pub(crate) async fn official_abi_state(
    client: &RpcClient,
    abi_meta: &Pubkey,
    abi: &Pubkey,
) -> Result<OfficialAbiState, CliError> {
    if let Some((_, data)) = fetch_account(client, abi).await? {
        let (revision, state, content_size) = abi_account_header(&data).ok_or_else(|| {
            CliError::Validation(format!("ABI account {} has an unexpected layout", abi))
        })?;
        if state == ABI_STATE_FINALIZED {
            return Err(CliError::Validation(format!(
                "the ABI for this program ({}) is finalized and can't change. \
                 Use --dangerously-exclude-abi to upgrade the program alone",
                abi
            )));
        }
        return Ok(OfficialAbiState::Present {
            revision,
            content_size,
        });
    }
    if fetch_account(client, abi_meta).await?.is_some() {
        Ok(OfficialAbiState::MetaOnly)
    } else {
        Ok(OfficialAbiState::Missing)
    }
}

/// Program create or upgrade.
pub(crate) enum DeployMode<'a> {
    Create { authority: Option<&'a str> },
    Upgrade,
}

/// Inputs shared by `program create --abi` and `program upgrade --abi`.
pub(crate) struct ProgramAbiDeploy<'a> {
    pub mode: DeployMode<'a>,
    pub manager: Option<&'a str>,
    pub seed: &'a str,
    pub ephemeral: bool,
    pub fee_payer: Option<&'a str>,
    pub program_file: &'a str,
    pub skip_program_image_validation: bool,
    pub chunk_size: usize,
    pub skip_elf_check: bool,
    pub abi_path: &'a str,
    pub abi_data: Vec<u8>,
}

fn to_bytes(key: &Pubkey) -> Result<[u8; 32], CliError> {
    key.to_bytes().map_err(|e| CliError::Crypto(e.to_string()))
}

async fn creation_proof(
    client: &RpcClient,
    account: &Pubkey,
    what: &str,
) -> Result<Vec<u8>, CliError> {
    client
        .make_state_proof(
            account,
            &MakeStateProofConfig {
                proof_type: ProofType::Creating,
                slot: None,
            },
        )
        .await
        .map_err(|e| CliError::ProgramUpload(format!("Failed to create {what} state proof: {e}")))
}

/// Create or upgrade a managed program together with its official ABI.
pub(crate) async fn deploy_program_with_abi(
    config: &Config,
    req: ProgramAbiDeploy<'_>,
    json_format: bool,
) -> Result<(), CliError> {
    let creating = matches!(req.mode, DeployMode::Create { .. });
    let program_data = fs::read(Path::new(req.program_file)).map_err(|e| CliError::Generic {
        message: format!("Failed to read program file {}: {}", req.program_file, e),
    })?;
    validate_program_file_or_report(
        req.program_file,
        &program_data,
        req.skip_program_image_validation,
        json_format,
    )?;
    let program_size = u32::try_from(program_data.len())
        .map_err(|_| CliError::Validation("program file too large".into()))?;
    let abi_size = u32::try_from(req.abi_data.len())
        .map_err(|_| CliError::Validation("ABI file too large".into()))?;

    let manager_program = match req.manager {
        Some(m) => Pubkey::from_bytes(&config.keys.resolve_public_key(m)?),
        None => config.get_manager_pubkey()?,
    };
    let abi_manager_program = config.get_abi_manager_pubkey()?;
    let multicall_program = config.get_multicall_program_pubkey()?;

    if let DeployMode::Create { authority } = req.mode {
        // The fee payer is the authority; an explicit one must match it.
        crate::commands::program::resolve_create_authority_pubkey(
            config,
            authority,
            req.fee_payer,
        )?;
    }

    let mut manager_config = config.clone();
    manager_config.manager_program_public_key = manager_program.to_string();
    let pm = ProgramManager::new_with_fee_payer(&manager_config, req.fee_payer).await?;

    let (program_meta, program) =
        crypto::derive_manager_accounts_from_seed(req.seed, &manager_program, req.ephemeral)?;
    let (abi_meta, abi) =
        official_abi_accounts(&to_bytes(&program)?, &abi_manager_program, req.ephemeral)?;

    if !json_format {
        output::print_info(&format!(
            "{} {} program {} ({} bytes) with ABI {} ({} bytes)",
            if creating { "Creating" } else { "Upgrading" },
            if req.ephemeral {
                "ephemeral"
            } else {
                "permanent"
            },
            req.program_file,
            program_size,
            req.abi_path,
            abi_size
        ));
        output::print_info(&format!("Program account: {}", program));
        output::print_info(&format!("ABI account: {}", abi));
    }

    // Preflight before uploading anything.
    let program_state = fetch_account(&pm.rpc_client, &program).await?;
    let current_program_data = match (&req.mode, &program_state) {
        (DeployMode::Create { .. }, Some(_)) => {
            return Err(CliError::Validation(format!(
                "program {} already exists; use `thru program upgrade`",
                program
            )));
        }
        (DeployMode::Create { .. }, None) => None,
        (DeployMode::Upgrade, None) => {
            return Err(CliError::Validation(format!(
                "program {} doesn't exist; use `thru program create`",
                program
            )));
        }
        (DeployMode::Upgrade, Some((size, _))) => Some(*size),
    };
    let abi_state = official_abi_state(&pm.rpc_client, &abi_meta, &abi).await?;
    let previous_revision = match &abi_state {
        OfficialAbiState::Present { revision, .. } => Some(*revision),
        _ => None,
    };

    // Upload the program and the ABI to their own temporary buffers.
    let (program_buffer_seed, program_seed_hashed) = seed_with_suffix(
        req.seed,
        if creating {
            "temporary"
        } else {
            "upgrade_temporary"
        },
    );
    let (abi_buffer_seed, abi_seed_hashed) = seed_with_suffix(req.seed, "abi_temp");
    if !json_format && (program_seed_hashed || abi_seed_hashed) {
        output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seeds");
    }
    let uploader = UploaderManager::new_with_fee_payer(config, req.fee_payer).await?;
    if !json_format {
        output::print_info(&format!(
            "Step 1/3: Uploading program to buffer (seed: {})",
            program_buffer_seed
        ));
    }
    let program_upload = uploader
        .upload_program_with_options(
            &program_buffer_seed,
            &program_data,
            req.chunk_size,
            req.skip_elf_check,
            json_format,
        )
        .await?;
    if !json_format {
        output::print_info(&format!(
            "Step 2/3: Uploading ABI to buffer (seed: {})",
            abi_buffer_seed
        ));
    }
    let abi_upload = uploader
        .upload_program(&abi_buffer_seed, &req.abi_data, req.chunk_size, json_format)
        .await?;

    // Creation proofs are fetched last so they are as fresh as possible.
    let need_proofs = !req.ephemeral;
    let (program_meta_proof, program_proof) = if creating && need_proofs {
        (
            Some(creation_proof(&pm.rpc_client, &program_meta, "program meta").await?),
            Some(creation_proof(&pm.rpc_client, &program, "program").await?),
        )
    } else {
        (None, None)
    };
    let abi_meta_proof = match (&abi_state, need_proofs) {
        (OfficialAbiState::Missing, true) => {
            Some(creation_proof(&pm.rpc_client, &abi_meta, "ABI meta").await?)
        }
        _ => None,
    };
    let abi_proof = match (&abi_state, need_proofs) {
        (OfficialAbiState::Present { .. }, _) | (_, false) => None,
        _ => Some(creation_proof(&pm.rpc_client, &abi, "ABI").await?),
    };

    let program_step = if creating {
        ProgramStep::Create {
            seed: req.seed.as_bytes(),
            meta_proof: program_meta_proof.as_deref(),
            program_proof: program_proof.as_deref(),
        }
    } else {
        ProgramStep::Upgrade
    };
    let (abi_step, current_abi) = match &abi_state {
        OfficialAbiState::Missing => (
            AbiStep::CreateMetaAndAbi {
                meta_proof: abi_meta_proof.as_deref(),
                abi_proof: abi_proof.as_deref(),
            },
            None,
        ),
        OfficialAbiState::MetaOnly => (
            AbiStep::CreateAbi {
                abi_proof: abi_proof.as_deref(),
            },
            None,
        ),
        OfficialAbiState::Present { content_size, .. } => {
            (AbiStep::Upgrade, Some(u64::from(*content_size)))
        }
    };
    let accounts = ProgramAbiAccounts {
        manager_program: to_bytes(&manager_program)?,
        abi_manager_program: to_bytes(&abi_manager_program)?,
        program_meta: to_bytes(&program_meta)?,
        program: to_bytes(&program)?,
        abi_meta: to_bytes(&abi_meta)?,
        abi: to_bytes(&abi)?,
        program_buffer: to_bytes(&program_upload.buffer_account)?,
        abi_buffer: to_bytes(&abi_upload.buffer_account)?,
    };
    let sizes = ProgramAbiSizes {
        program: program_size,
        abi: abi_size,
        current_program_data,
        current_abi,
    };
    // Both managers install only bytes with these digests (UNTO-3561).
    let digests = ProgramAbiDigests {
        program: crate::crypto::calculate_sha256(&program_data),
        abi: crate::crypto::calculate_sha256(&req.abi_data),
    };

    if !json_format {
        output::print_info(&format!(
            "Step 3/3: {} program and {} ABI in one transaction",
            if creating { "Creating" } else { "Upgrading" },
            match abi_step {
                AbiStep::Upgrade => "upgrading",
                _ => "creating",
            }
        ));
    }
    let nonce = pm.get_current_nonce().await?;
    let start_slot = pm.get_current_slot().await?;
    let transaction = build_program_abi_transaction(
        pm.fee_payer_keypair.public_key,
        to_bytes(&multicall_program)?,
        &accounts,
        &program_step,
        &abi_step,
        &sizes,
        &digests,
        req.ephemeral,
        0,
        nonce,
        start_slot,
    )
    .map_err(|e| CliError::ProgramUpload(e.to_string()))?;
    let mut transaction = transaction.with_chain_id(pm.chain_id);
    transaction
        .sign(&pm.fee_payer_keypair.private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;
    let signature = pm
        .submit_and_verify_transaction(&transaction, json_format, decode_program_abi_error)
        .await?;

    // The deploy has landed; a failed read only loses the revision display.
    let revision = match fetch_account(&pm.rpc_client, &abi).await {
        Ok(Some((_, data))) => abi_account_header(&data).map(|(revision, _, _)| revision),
        _ => None,
    };

    // Clean up both buffers; failures only warn.
    for seed in [&program_buffer_seed, &abi_buffer_seed] {
        if let Err(e) = uploader.cleanup_program(seed, json_format).await {
            if !json_format {
                output::print_warning(&format!(
                    "Failed to clean up temporary buffer {}: {}. Clean it up later with: thru uploader cleanup {}",
                    seed, e, seed
                ));
            }
        }
    }

    let key = if creating {
        "program_create"
    } else {
        "program_upgrade"
    };
    if json_format {
        output::print_output(
            serde_json::json!({
                key: {
                    "status": "success",
                    "signature": signature,
                    "ephemeral": req.ephemeral,
                    "seed": req.seed,
                    "meta_account": program_meta.to_string(),
                    "program_account": program.to_string(),
                    "program_size": program_data.len(),
                    "abi": {
                        "status": if previous_revision.is_some() { "upgraded" } else { "created" },
                        "abi_meta_account": abi_meta.to_string(),
                        "abi_account": abi.to_string(),
                        "abi_size": req.abi_data.len(),
                        "previous_revision": previous_revision,
                        "revision": revision,
                    }
                }
            }),
            true,
        );
    } else {
        output::print_success(&format!(
            "✓ {} program + ABI in 1 transaction: {}",
            if creating { "Created" } else { "Upgraded" },
            signature
        ));
        output::print_info(&format!("Program account: {}", program));
        let revision_text = match (previous_revision, revision) {
            (Some(prev), Some(now)) => format!("revision {} → {}", prev, now),
            (None, Some(now)) => format!("created at revision {}", now),
            _ => "updated".to_string(),
        };
        output::print_info(&format!("ABI account: {} ({})", abi, revision_text));
        output::print_info(ABI_APPEND_ONLY_TIP);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn abi_file(contents: &str) -> tempfile::NamedTempFile {
        let mut file = tempfile::Builder::new()
            .suffix(".abi.yaml")
            .tempfile()
            .unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        file
    }

    fn args(abi: Option<&str>, exclude: bool) -> ProgramAbiArgs {
        ProgramAbiArgs {
            abi: abi.map(str::to_string),
            dangerously_exclude_abi: exclude,
        }
    }

    #[test]
    fn requires_an_abi_choice() {
        let err = resolve_abi_choice(&args(None, false), true).err().unwrap();
        let message = err.to_string();
        assert!(message.contains("--abi"), "{message}");
        assert!(message.contains("--dangerously-exclude-abi"), "{message}");
        assert!(matches!(
            resolve_abi_choice(&args(None, true), true),
            Ok(AbiChoice::Exclude)
        ));
    }

    #[test]
    fn accepts_a_self_contained_abi() {
        let file = abi_file("abi:\n  package: \"demo\"\n  abi-version: 1\ntypes: []\n");
        let path = file.path().to_str().unwrap();
        match resolve_abi_choice(&args(Some(path), false), true) {
            Ok(AbiChoice::Publish { path: p, data }) => {
                assert_eq!(p, path);
                assert!(!data.is_empty());
            }
            _ => panic!("expected publish"),
        }
    }

    #[test]
    fn rejects_path_imports_in_any_yaml_form() {
        for imports in [
            "  imports: [{type: path, path: dep.abi.yaml}]\n",
            "  imports:\n    - path: dep.abi.yaml\n      type: path\n",
            "  imports:\n    - type: \"path\"\n      path: dep.abi.yaml\n",
        ] {
            let file = abi_file(&format!("abi:\n  package: \"demo\"\n{imports}types: []\n"));
            let err = resolve_abi_choice(&args(Some(file.path().to_str().unwrap()), false), true)
                .err()
                .unwrap_or_else(|| panic!("accepted {imports:?}"));
            assert!(err.to_string().contains("prep-for-publish"), "{err}");
        }
        let onchain = abi_file(
            "abi:\n  package: \"demo\"\n  imports: [{type: onchain, address: ta1, target: abi, revision: 3}]\ntypes: []\n",
        );
        assert!(
            resolve_abi_choice(&args(Some(onchain.path().to_str().unwrap()), false), true).is_ok()
        );
    }

    #[test]
    fn rejects_unpublishable_abis() {
        let path_import = abi_file(
            "abi:\n  package: \"demo\"\n  imports:\n    - type: path\n      path: ../other.abi.yaml\ntypes: []\n",
        );
        let err = resolve_abi_choice(
            &args(Some(path_import.path().to_str().unwrap()), false),
            true,
        )
        .err()
        .unwrap();
        assert!(err.to_string().contains("prep-for-publish"), "{err}");

        let empty = abi_file("  \n");
        assert!(
            resolve_abi_choice(&args(Some(empty.path().to_str().unwrap()), false), true).is_err()
        );

        let invalid = abi_file("abi: [unclosed\n");
        assert!(
            resolve_abi_choice(&args(Some(invalid.path().to_str().unwrap()), false), true).is_err()
        );

        assert!(resolve_abi_choice(&args(Some("/nonexistent/x.abi.yaml"), false), true).is_err());
    }

    #[test]
    fn reads_abi_account_header() {
        let mut data = vec![0u8; 46];
        data[0] = 2; /* TN_ABI_MANAGER_ACCOUNT_TYPE_CONTENT_V1 */
        data[33..41].copy_from_slice(&7u64.to_le_bytes());
        data[41] = ABI_STATE_FINALIZED;
        data[42..46].copy_from_slice(&123u32.to_le_bytes());
        assert_eq!(
            abi_account_header(&data),
            Some((7, ABI_STATE_FINALIZED, 123))
        );
        assert_eq!(abi_account_header(&data[..45]), None);
        data[0] = 1; /* ABI meta account */
        assert_eq!(abi_account_header(&data), None);
    }
}
