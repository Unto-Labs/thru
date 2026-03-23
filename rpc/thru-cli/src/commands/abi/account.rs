//! On-chain ABI account management command implementations

use std::fs;
use std::path::Path;
use std::time::Duration;

use base64::{Engine as _, engine::general_purpose};
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::TransactionBuilder;
use thru_client::{Client as RpcClient, VersionContext};

use crate::cli::{AbiAccountCommands, AbiAccountType};
use crate::commands::uploader::{UploadSession, UploaderManager};
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use serde_json::{Map, Value, json};
use std::convert::TryInto;

const ABI_SEED_MAX_LEN: usize = 32;
const ABI_META_BODY_LEN: usize = 96;
const ABI_META_KIND_OFFICIAL: u8 = 0x00;
const ABI_META_KIND_EXTERNAL: u8 = 0x01;
const ABI_ACCOUNT_SUFFIX: &[u8] = b"_abi_account";
const ABI_UPLOAD_CHUNK_SIZE: usize = 30 * 1024;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum ExternalSeedFormat {
    Hex32,
    StringHash,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum ExternalAbiKind {
    ThirdParty,
    Standalone,
}

impl ExternalAbiKind {
    fn label(self) -> &'static str {
        match self {
            Self::ThirdParty => "third-party",
            Self::Standalone => "standalone",
        }
    }
}

#[derive(Copy, Clone)]
enum AbiMutationAction {
    Create,
    Upgrade,
    Finalize,
    Close,
}

impl AbiMutationAction {
    fn response_key(self) -> &'static str {
        match self {
            Self::Create => "abi_create",
            Self::Upgrade => "abi_upgrade",
            Self::Finalize => "abi_finalize",
            Self::Close => "abi_close",
        }
    }

    fn present_participle(self) -> &'static str {
        match self {
            Self::Create => "Creating",
            Self::Upgrade => "Upgrading",
            Self::Finalize => "Finalizing",
            Self::Close => "Closing",
        }
    }

    fn past_tense(self) -> &'static str {
        match self {
            Self::Create => "created",
            Self::Upgrade => "upgraded",
            Self::Finalize => "finalized",
            Self::Close => "closed",
        }
    }

    fn upload_step_subject(self) -> &'static str {
        match self {
            Self::Create => "ABI data",
            Self::Upgrade => "ABI upgrade data",
            Self::Finalize | Self::Close => unreachable!("only create and upgrade upload ABI data"),
        }
    }

    fn upload_seed_suffix(self) -> &'static str {
        match self {
            Self::Create => "abi_temp",
            Self::Upgrade => "abi_upgrade",
            Self::Finalize | Self::Close => {
                unreachable!("only create and upgrade use temporary upload seeds")
            }
        }
    }

    fn manager_step_label(self) -> &'static str {
        match self {
            Self::Create => "Step 2: Creating ABI metadata + ABI accounts",
            Self::Upgrade => "Step 2: Upgrading ABI account via ABI manager program",
            Self::Finalize | Self::Close => {
                unreachable!("only create and upgrade have a temp-upload manager step")
            }
        }
    }

    fn title(self, kind_label: &str, abi_file: Option<&str>, abi_size: Option<usize>) -> String {
        match self {
            Self::Create | Self::Upgrade => format!(
                "{} {} ABI account from file: {} ({} bytes)",
                self.present_participle(),
                kind_label,
                abi_file.expect("upload actions require an ABI file"),
                abi_size.expect("upload actions require an ABI size")
            ),
            Self::Finalize => format!(
                "Finalizing {} ABI account (making it immutable)",
                kind_label
            ),
            Self::Close => format!("Closing {} ABI account", kind_label),
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum NormalizedAbiTargetKind {
    Official,
    External {
        kind: ExternalAbiKind,
        seed_format: ExternalSeedFormat,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
struct NormalizedAbiAccountArgs<'a> {
    target_kind: NormalizedAbiTargetKind,
    seed: &'a str,
    fee_payer: Option<&'a str>,
    actor_name: Option<&'a str>,
    target_program: Option<&'a str>,
    ephemeral: bool,
}

struct UploadPreflight {
    meta_exists: bool,
}

struct TempUploadSummary {
    seed: String,
    session: UploadSession,
    cleanup_error: Option<String>,
}

struct OfficialTarget {
    program_seed: String,
    authority_pubkey: [u8; 32],
    program_meta_account: Pubkey,
    program_account: Pubkey,
}

struct ExternalTarget {
    kind: ExternalAbiKind,
    seed_input: String,
    seed_format: ExternalSeedFormat,
    publisher_pubkey: [u8; 32],
    target_program: Option<Pubkey>,
    target_program_bytes: [u8; 32],
    external_seed: [u8; 32],
}

enum AbiTargetKind {
    Official(OfficialTarget),
    External(ExternalTarget),
}

struct ResolvedAbiTarget {
    abi_manager_program_pubkey: Pubkey,
    abi_meta_account: Pubkey,
    abi_account: Pubkey,
    kind: AbiTargetKind,
}

impl ResolvedAbiTarget {
    fn kind_label(&self) -> &'static str {
        match &self.kind {
            AbiTargetKind::Official(_) => "official",
            AbiTargetKind::External(target) => target.kind.label(),
        }
    }

    fn temp_seed_base(&self) -> &str {
        match &self.kind {
            AbiTargetKind::Official(target) => target.program_seed.as_str(),
            AbiTargetKind::External(target) => target.seed_input.as_str(),
        }
    }

    fn print_intro(
        &self,
        action: AbiMutationAction,
        abi_file: Option<&str>,
        abi_size: Option<usize>,
        json_format: bool,
    ) {
        if json_format {
            return;
        }

        output::print_info(&action.title(self.kind_label(), abi_file, abi_size));

        match &self.kind {
            AbiTargetKind::Official(target) => {
                output::print_info(&format!("Program seed: {}", target.program_seed));
            }
            AbiTargetKind::External(target) => {
                output::print_info(
                    "Publisher / authority selection changes third-party and standalone ABI addresses",
                );
                if matches!(target.seed_format, ExternalSeedFormat::StringHash) {
                    output::print_info("Using hashed seed derived from provided string");
                }
                if let Some(target_program) = &target.target_program {
                    output::print_info(&format!("Target program: {}", target_program));
                }
            }
        }
    }

    fn print_context(&self, json_format: bool) {
        if json_format {
            return;
        }

        match &self.kind {
            AbiTargetKind::Official(target) => {
                output::print_info(&format!("Associated Program: {}", target.program_account));
                output::print_info(&format!(
                    "Program meta account: {}",
                    target.program_meta_account
                ));
            }
            AbiTargetKind::External(target) => {
                output::print_info(&format!(
                    "Publisher / authority: {}",
                    pubkey_string(&target.publisher_pubkey)
                ));
            }
        }

        output::print_info(&format!("ABI meta account: {}", self.abi_meta_account));
        output::print_info(&format!("ABI account: {}", self.abi_account));
    }

    fn print_final_success(&self, action: AbiMutationAction, json_format: bool) {
        if json_format {
            return;
        }

        output::print_success(&format!(
            "🎉 ABI account {} successfully!",
            action.past_tense()
        ));

        match &self.kind {
            AbiTargetKind::Official(target) => {
                output::print_info(&format!(
                    "Program meta account: {}",
                    target.program_meta_account
                ));
            }
            AbiTargetKind::External(_) => {}
        }

        output::print_info(&format!("ABI meta account: {}", self.abi_meta_account));
        output::print_info(&format!("ABI account: {}", self.abi_account));
    }

    fn to_response(
        &self,
        action: AbiMutationAction,
        ephemeral: bool,
        abi_size: Option<usize>,
        temp_upload: Option<&TempUploadSummary>,
    ) -> Value {
        let mut body = Map::new();
        body.insert("status".to_string(), json!("success"));
        body.insert("kind".to_string(), json!(self.kind_label()));
        body.insert("ephemeral".to_string(), json!(ephemeral));
        body.insert(
            "abi_meta_account".to_string(),
            json!(self.abi_meta_account.to_string()),
        );
        body.insert(
            "abi_account".to_string(),
            json!(self.abi_account.to_string()),
        );

        match &self.kind {
            AbiTargetKind::Official(target) => {
                body.insert(
                    "program_meta_account".to_string(),
                    json!(target.program_meta_account.to_string()),
                );
                body.insert(
                    "program_account".to_string(),
                    json!(target.program_account.to_string()),
                );
                body.insert("program_seed".to_string(), json!(target.program_seed));
            }
            AbiTargetKind::External(target) => {
                body.insert(
                    "publisher".to_string(),
                    json!(pubkey_string(&target.publisher_pubkey)),
                );
                body.insert("seed".to_string(), json!(target.seed_input));
                if let Some(target_program) = &target.target_program {
                    body.insert(
                        "target_program".to_string(),
                        json!(target_program.to_string()),
                    );
                }
            }
        }

        if let Some(abi_size) = abi_size {
            body.insert("abi_size".to_string(), json!(abi_size));
        }

        if let Some(temp_upload) = temp_upload {
            body.insert(
                "temp_upload".to_string(),
                json!({
                    "seed": temp_upload.seed,
                    "meta_account": temp_upload.session.meta_account.to_string(),
                    "buffer_account": temp_upload.session.buffer_account.to_string(),
                    "cleanup_status": if temp_upload.cleanup_error.is_some() { "failed" } else { "success" },
                    "cleanup_error": temp_upload.cleanup_error
                }),
            );
        }

        json!({ action.response_key(): body })
    }

    fn build_create_meta_transaction(
        &self,
        fee_payer_pubkey: [u8; 32],
        ephemeral: bool,
        meta_proof: Option<&[u8]>,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, CliError> {
        match &self.kind {
            AbiTargetKind::Official(target) => {
                TransactionBuilder::build_abi_manager_create_meta_official(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&target.program_meta_account)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    target.authority_pubkey,
                    ephemeral,
                    meta_proof,
                    0,
                    nonce,
                    start_slot,
                )
            }
            AbiTargetKind::External(target) => {
                TransactionBuilder::build_abi_manager_create_meta_external(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    target.publisher_pubkey,
                    target.target_program_bytes,
                    target.external_seed,
                    ephemeral,
                    meta_proof,
                    0,
                    nonce,
                    start_slot,
                )
            }
        }
        .map_err(|e| CliError::ProgramUpload(e.to_string()))
    }

    fn build_create_abi_transaction(
        &self,
        fee_payer_pubkey: [u8; 32],
        buffer_account: &Pubkey,
        abi_size: usize,
        ephemeral: bool,
        abi_proof: Option<&[u8]>,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, CliError> {
        match &self.kind {
            AbiTargetKind::Official(target) => {
                TransactionBuilder::build_abi_manager_create_abi_official(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&target.program_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    pubkey_bytes(buffer_account)?,
                    target.authority_pubkey,
                    0,
                    abi_size as u32,
                    ephemeral,
                    abi_proof,
                    0,
                    nonce,
                    start_slot,
                )
            }
            AbiTargetKind::External(target) => {
                TransactionBuilder::build_abi_manager_create_abi_external(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    pubkey_bytes(buffer_account)?,
                    target.publisher_pubkey,
                    0,
                    abi_size as u32,
                    ephemeral,
                    abi_proof,
                    0,
                    nonce,
                    start_slot,
                )
            }
        }
        .map_err(|e| CliError::ProgramUpload(e.to_string()))
    }

    fn build_upgrade_transaction(
        &self,
        fee_payer_pubkey: [u8; 32],
        buffer_account: &Pubkey,
        abi_size: usize,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, CliError> {
        match &self.kind {
            AbiTargetKind::Official(target) => {
                TransactionBuilder::build_abi_manager_upgrade_abi_official(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&target.program_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    pubkey_bytes(buffer_account)?,
                    target.authority_pubkey,
                    0,
                    abi_size as u32,
                    0,
                    nonce,
                    start_slot,
                )
            }
            AbiTargetKind::External(target) => {
                TransactionBuilder::build_abi_manager_upgrade_abi_external(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    pubkey_bytes(buffer_account)?,
                    target.publisher_pubkey,
                    0,
                    abi_size as u32,
                    0,
                    nonce,
                    start_slot,
                )
            }
        }
        .map_err(|e| CliError::ProgramUpload(e.to_string()))
    }

    fn build_finalize_transaction(
        &self,
        fee_payer_pubkey: [u8; 32],
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, CliError> {
        match &self.kind {
            AbiTargetKind::Official(target) => {
                TransactionBuilder::build_abi_manager_finalize_abi_official(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&target.program_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    target.authority_pubkey,
                    0,
                    nonce,
                    start_slot,
                )
            }
            AbiTargetKind::External(target) => {
                TransactionBuilder::build_abi_manager_finalize_abi_external(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    target.publisher_pubkey,
                    0,
                    nonce,
                    start_slot,
                )
            }
        }
        .map_err(|e| CliError::ProgramUpload(e.to_string()))
    }

    fn build_close_transaction(
        &self,
        fee_payer_pubkey: [u8; 32],
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, CliError> {
        match &self.kind {
            AbiTargetKind::Official(target) => {
                TransactionBuilder::build_abi_manager_close_abi_official(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&target.program_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    target.authority_pubkey,
                    0,
                    nonce,
                    start_slot,
                )
            }
            AbiTargetKind::External(target) => {
                TransactionBuilder::build_abi_manager_close_abi_external(
                    fee_payer_pubkey,
                    pubkey_bytes(&self.abi_manager_program_pubkey)?,
                    pubkey_bytes(&self.abi_meta_account)?,
                    pubkey_bytes(&self.abi_account)?,
                    target.publisher_pubkey,
                    0,
                    nonce,
                    start_slot,
                )
            }
        }
        .map_err(|e| CliError::ProgramUpload(e.to_string()))
    }
}

pub async fn handle_abi_account_command(
    config: &Config,
    subcommand: AbiAccountCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        AbiAccountCommands::Create {
            ephemeral,
            account_type,
            target_program,
            fee_payer,
            authority,
            publisher,
            seed,
            abi_file,
        } => {
            let args = normalize_abi_account_args(
                account_type,
                &seed,
                target_program.as_deref(),
                authority.as_deref(),
                publisher.as_deref(),
                fee_payer.as_deref(),
                ephemeral,
            )?;
            run_abi_mutation(
                config,
                args,
                Some(&abi_file),
                AbiMutationAction::Create,
                json_format,
            )
            .await
        }
        AbiAccountCommands::Upgrade {
            ephemeral,
            account_type,
            target_program,
            fee_payer,
            authority,
            publisher,
            seed,
            abi_file,
        } => {
            let args = normalize_abi_account_args(
                account_type,
                &seed,
                target_program.as_deref(),
                authority.as_deref(),
                publisher.as_deref(),
                fee_payer.as_deref(),
                ephemeral,
            )?;
            run_abi_mutation(
                config,
                args,
                Some(&abi_file),
                AbiMutationAction::Upgrade,
                json_format,
            )
            .await
        }
        AbiAccountCommands::Finalize {
            ephemeral,
            account_type,
            target_program,
            fee_payer,
            authority,
            publisher,
            seed,
        } => {
            let args = normalize_abi_account_args(
                account_type,
                &seed,
                target_program.as_deref(),
                authority.as_deref(),
                publisher.as_deref(),
                fee_payer.as_deref(),
                ephemeral,
            )?;
            run_abi_mutation(config, args, None, AbiMutationAction::Finalize, json_format).await
        }
        AbiAccountCommands::Close {
            ephemeral,
            account_type,
            target_program,
            fee_payer,
            authority,
            publisher,
            seed,
        } => {
            let args = normalize_abi_account_args(
                account_type,
                &seed,
                target_program.as_deref(),
                authority.as_deref(),
                publisher.as_deref(),
                fee_payer.as_deref(),
                ephemeral,
            )?;
            run_abi_mutation(config, args, None, AbiMutationAction::Close, json_format).await
        }
        AbiAccountCommands::Get {
            abi_account,
            include_data,
            out,
        } => {
            get_abi_account_info(
                config,
                &abi_account,
                include_data,
                out.as_deref(),
                json_format,
            )
            .await
        }
    }
}

async fn fetch_current_account_info(
    rpc_client: &RpcClient,
    account: &Pubkey,
    description: &str,
) -> Result<Option<thru_client::Account>, CliError> {
    rpc_client
        .get_account_info(account, None, Some(VersionContext::Current))
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to fetch {} info: {}", description, e),
        })
}

async fn current_account_exists(
    rpc_client: &RpcClient,
    account: &Pubkey,
    description: &str,
) -> Result<bool, CliError> {
    Ok(fetch_current_account_info(rpc_client, account, description)
        .await?
        .is_some())
}

async fn upload_temp_abi(
    config: &Config,
    fee_payer: Option<&str>,
    temp_seed: &str,
    abi_data: &[u8],
    json_format: bool,
) -> Result<(UploaderManager, UploadSession), CliError> {
    let uploader_manager = UploaderManager::new_with_fee_payer(config, fee_payer).await?;
    let upload_session = uploader_manager
        .upload_program(temp_seed, abi_data, ABI_UPLOAD_CHUNK_SIZE, json_format)
        .await?;
    Ok((uploader_manager, upload_session))
}

async fn cleanup_temp_upload(
    uploader_manager: &UploaderManager,
    temp_seed: &str,
    json_format: bool,
) -> Option<String> {
    if !json_format {
        output::print_info("Step 3: Cleaning up temporary buffer account");
    }

    match uploader_manager
        .cleanup_program(temp_seed, json_format)
        .await
    {
        Ok(()) => {
            if !json_format {
                output::print_success("✓ Temporary buffer account cleaned up successfully");
            }
            None
        }
        Err(err) => {
            let message = format!("Failed to clean up temporary buffer account: {}", err);
            if !json_format {
                output::print_warning(&message);
                output::print_info("You may need to manually clean it up later using:");
                output::print_info(&format!("  thru-cli uploader cleanup {}", temp_seed));
            }
            Some(message)
        }
    }
}

struct AbiProgramManager {
    rpc_client: RpcClient,
    fee_payer_keypair: KeyPair,
    chain_id: u16,
    timeout_seconds: u64,
}

impl AbiProgramManager {
    /// Create new ABI program manager with optional fee payer override
    async fn new(config: &Config, fee_payer_name: Option<&str>) -> Result<Self, CliError> {
        let rpc_url = config.get_grpc_url()?;
        let rpc_client = RpcClient::builder()
            .http_endpoint(rpc_url)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .auth_token(config.auth_token.clone())
            .build()?;

        // Ensure the configured manager program key is valid even if unused directly
        let _ = config.get_manager_pubkey()?;

        let fee_payer_key_hex = if let Some(name) = fee_payer_name {
            config.keys.get_key(name)?
        } else {
            config.keys.get_default_key()?
        };
        let fee_payer_keypair = crypto::keypair_from_hex(fee_payer_key_hex)?;

        let chain_info = rpc_client.get_chain_info().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get chain info: {}", e))
        })?;

        Ok(Self {
            rpc_client,
            fee_payer_keypair,
            chain_id: chain_info.chain_id,
            timeout_seconds: config.timeout_seconds,
        })
    }

    fn fee_payer(&self) -> &KeyPair {
        &self.fee_payer_keypair
    }

    fn rpc_client(&self) -> &RpcClient {
        &self.rpc_client
    }

    fn chain_id(&self) -> u16 {
        self.chain_id
    }

    async fn get_current_nonce(&self) -> Result<u64, CliError> {
        match self
            .rpc_client
            .get_account_info(
                &self.fee_payer_keypair.address_string,
                None,
                Some(VersionContext::Current),
            )
            .await
        {
            Ok(Some(account)) => Ok(account.nonce),
            Ok(None) => Err(CliError::NonceManagement(
                "Fee payer account not found. Please ensure the account is funded.".to_string(),
            )),
            Err(e) => Err(CliError::NonceManagement(format!(
                "Failed to retrieve account nonce: {}",
                e
            ))),
        }
    }

    async fn get_current_slot(&self) -> Result<u64, CliError> {
        let block_height = self.rpc_client.get_block_height().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
        })?;
        Ok(block_height.finalized_height)
    }

    async fn submit_and_verify_transaction(
        &self,
        transaction: &Transaction,
        json_format: bool,
    ) -> Result<(), CliError> {
        let wire_bytes = transaction.to_wire();
        let timeout = Duration::from_secs(self.timeout_seconds);

        let transaction_details = self
            .rpc_client
            .execute_transaction(&wire_bytes, timeout)
            .await
            .map_err(|e| CliError::TransactionSubmission(e.to_string()))?;

        let has_failure =
            transaction_details.execution_result != 0 || transaction_details.vm_error != 0;
        let vm_error_label = format_vm_error(transaction_details.vm_error);
        let vm_error_suffix = if transaction_details.vm_error != 0 {
            format!(" ({})", vm_error_label)
        } else {
            String::new()
        };
        let user_error_label = if transaction_details.user_error_code != 0 {
            format!("0x{:04X}", transaction_details.user_error_code)
        } else {
            "None".to_string()
        };
        let user_error_suffix = if transaction_details.user_error_code != 0 {
            format!(" - Manager program error: {}", user_error_label)
        } else {
            String::new()
        };

        if !json_format {
            output::print_success(&format!(
                "Transaction completed: {}",
                transaction_details.signature.as_str()
            ));
        }

        if has_failure && !json_format {
            output::print_warning(&format!(
                "Transaction completed with execution result: {} (hex 0x{:X}) vm_error: {}{}{}",
                transaction_details.execution_result,
                transaction_details.execution_result,
                vm_error_label,
                vm_error_suffix,
                user_error_suffix
            ));
        }

        if has_failure {
            let vm_error_display = if transaction_details.vm_error != 0 {
                format!("{}{}", transaction_details.vm_error, vm_error_suffix)
            } else {
                "0".to_string()
            };
            let message = format!(
                "Transaction failed (execution_result={} (hex 0x{:X}), vm_error={}, manager_error={})",
                transaction_details.execution_result,
                transaction_details.execution_result,
                vm_error_display,
                user_error_label
            );

            return Err(CliError::TransactionFailed {
                message,
                execution_result: transaction_details.execution_result,
                vm_error: transaction_details.vm_error,
                vm_error_label,
                user_error_code: transaction_details.user_error_code,
                user_error_label,
                signature: transaction_details.signature.as_str().to_string(),
            });
        }

        Ok(())
    }
}

fn pubkey_bytes(pubkey: &Pubkey) -> Result<[u8; 32], CliError> {
    pubkey
        .to_bytes()
        .map_err(|e| CliError::Crypto(e.to_string()))
}

fn pubkey_string(pubkey_bytes: &[u8; 32]) -> String {
    Pubkey::from_bytes(pubkey_bytes).to_string()
}

fn resolve_target_program(target_program: Option<&str>) -> Result<Option<Pubkey>, CliError> {
    target_program
        .map(|target_program_str| {
            Pubkey::new(target_program_str.to_string()).map_err(|e| {
                CliError::Validation(format!("Invalid target program public key: {}", e))
            })
        })
        .transpose()
}

fn normalize_abi_account_args<'a>(
    account_type: AbiAccountType,
    seed: &'a str,
    target_program: Option<&'a str>,
    authority: Option<&'a str>,
    publisher: Option<&'a str>,
    fee_payer: Option<&'a str>,
    ephemeral: bool,
) -> Result<NormalizedAbiAccountArgs<'a>, CliError> {
    if authority.is_some() && publisher.is_some() {
        return Err(CliError::Validation(
            "--authority and --publisher cannot be used together".to_string(),
        ));
    }

    let (target_kind, actor_name) = match account_type {
        AbiAccountType::Program => {
            if target_program.is_some() {
                return Err(CliError::Validation(
                    "--target-program is only valid with --account-type third-party".to_string(),
                ));
            }
            if publisher.is_some() {
                return Err(CliError::Validation(
                    "--publisher is only valid with --account-type third-party or standalone"
                        .to_string(),
                ));
            }
            (NormalizedAbiTargetKind::Official, authority)
        }
        AbiAccountType::ThirdParty => {
            if target_program.is_none() {
                return Err(CliError::Validation(
                    "--target-program is required when --account-type third-party is used"
                        .to_string(),
                ));
            }
            (
                NormalizedAbiTargetKind::External {
                    kind: ExternalAbiKind::ThirdParty,
                    seed_format: ExternalSeedFormat::Hex32,
                },
                publisher.or(authority),
            )
        }
        AbiAccountType::Standalone => {
            if target_program.is_some() {
                return Err(CliError::Validation(
                    "--target-program is only valid with --account-type third-party".to_string(),
                ));
            }
            (
                NormalizedAbiTargetKind::External {
                    kind: ExternalAbiKind::Standalone,
                    seed_format: ExternalSeedFormat::StringHash,
                },
                publisher.or(authority),
            )
        }
    };

    Ok(NormalizedAbiAccountArgs {
        target_kind,
        seed,
        fee_payer,
        actor_name,
        target_program,
        ephemeral,
    })
}

fn resolve_account_target(
    config: &Config,
    args: NormalizedAbiAccountArgs<'_>,
) -> Result<ResolvedAbiTarget, CliError> {
    match args.target_kind {
        NormalizedAbiTargetKind::Official => {
            resolve_official_target(config, args.seed, args.actor_name, args.ephemeral)
        }
        NormalizedAbiTargetKind::External { kind, seed_format } => resolve_external_target(
            config,
            kind,
            args.seed,
            seed_format,
            args.target_program,
            args.actor_name,
            args.ephemeral,
        ),
    }
}

fn resolve_official_target(
    config: &Config,
    program_seed: &str,
    authority: Option<&str>,
    ephemeral: bool,
) -> Result<ResolvedAbiTarget, CliError> {
    let manager_program_pubkey = config.get_manager_pubkey()?;
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;
    let authority_pubkey = resolve_actor_pubkey(config, authority)?;
    let (program_meta_account, program_account) = crypto::derive_manager_accounts_from_seed(
        program_seed,
        &manager_program_pubkey,
        ephemeral,
    )?;

    let body = abi_meta_body_official(&pubkey_bytes(&program_account)?);
    let abi_meta_account = thru_base::crypto_utils::derive_program_address(
        &derive_abi_meta_seed_bytes(ABI_META_KIND_OFFICIAL, &body),
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    let abi_account = thru_base::crypto_utils::derive_program_address(
        &derive_abi_account_seed_bytes(ABI_META_KIND_OFFICIAL, &body),
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    Ok(ResolvedAbiTarget {
        abi_manager_program_pubkey,
        abi_meta_account,
        abi_account,
        kind: AbiTargetKind::Official(OfficialTarget {
            program_seed: program_seed.to_string(),
            authority_pubkey,
            program_meta_account,
            program_account,
        }),
    })
}

fn resolve_external_target(
    config: &Config,
    kind: ExternalAbiKind,
    seed_input: &str,
    seed_format: ExternalSeedFormat,
    target_program: Option<&str>,
    publisher: Option<&str>,
    ephemeral: bool,
) -> Result<ResolvedAbiTarget, CliError> {
    let abi_manager_program_pubkey = config.get_abi_manager_pubkey()?;
    let publisher_pubkey = resolve_actor_pubkey(config, publisher)?;
    let target_program = resolve_target_program(target_program)?;
    let target_program_bytes = match &target_program {
        Some(target_program) => pubkey_bytes(target_program)?,
        None => [0u8; 32],
    };
    let external_seed = parse_external_seed(seed_input, seed_format)?;
    let body = abi_meta_body_external(&publisher_pubkey, &target_program_bytes, &external_seed);

    let abi_meta_account = thru_base::crypto_utils::derive_program_address(
        &derive_abi_meta_seed_bytes(ABI_META_KIND_EXTERNAL, &body),
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    let abi_account = thru_base::crypto_utils::derive_program_address(
        &derive_abi_account_seed_bytes(ABI_META_KIND_EXTERNAL, &body),
        &abi_manager_program_pubkey,
        ephemeral,
    )
    .map_err(|e| CliError::Crypto(e.to_string()))?;

    Ok(ResolvedAbiTarget {
        abi_manager_program_pubkey,
        abi_meta_account,
        abi_account,
        kind: AbiTargetKind::External(ExternalTarget {
            kind,
            seed_input: seed_input.to_string(),
            seed_format,
            publisher_pubkey,
            target_program,
            target_program_bytes,
            external_seed,
        }),
    })
}

async fn preflight_upload_mutation(
    action: AbiMutationAction,
    abi_program_manager: &AbiProgramManager,
    target: &ResolvedAbiTarget,
) -> Result<UploadPreflight, CliError> {
    let meta_exists = current_account_exists(
        abi_program_manager.rpc_client(),
        &target.abi_meta_account,
        "ABI meta account",
    )
    .await?;

    let abi_exists = current_account_exists(
        abi_program_manager.rpc_client(),
        &target.abi_account,
        "ABI account",
    )
    .await?;

    match action {
        AbiMutationAction::Create => {
            if abi_exists {
                return Err(CliError::Generic {
                    message: format!(
                        "ABI account {} already exists; use abi account upgrade instead",
                        target.abi_account
                    ),
                });
            }
        }
        AbiMutationAction::Upgrade => {
            if !meta_exists {
                return Err(CliError::Generic {
                    message: format!(
                        "ABI meta account {} not found; use abi account create first",
                        target.abi_meta_account
                    ),
                });
            }
            if !abi_exists {
                return Err(CliError::Generic {
                    message: format!(
                        "ABI account {} not found; use abi account create first",
                        target.abi_account
                    ),
                });
            }
        }
        AbiMutationAction::Finalize | AbiMutationAction::Close => {
            unreachable!("only create and upgrade perform upload preflight")
        }
    }

    Ok(UploadPreflight { meta_exists })
}

async fn make_create_state_proof(
    rpc_client: &RpcClient,
    account: &Pubkey,
    description: &str,
) -> Result<Vec<u8>, CliError> {
    let proof_config = MakeStateProofConfig {
        proof_type: ProofType::Creating,
        slot: None,
    };

    rpc_client
        .make_state_proof(account, &proof_config)
        .await
        .map_err(|e| {
            CliError::ProgramUpload(format!(
                "Failed to create {} state proof: {}",
                description, e
            ))
        })
}

async fn sign_and_submit_transaction(
    abi_program_manager: &AbiProgramManager,
    transaction: Transaction,
    json_format: bool,
) -> Result<(), CliError> {
    let mut transaction = transaction.with_chain_id(abi_program_manager.chain_id());
    transaction
        .sign(&abi_program_manager.fee_payer().private_key)
        .map_err(|e| CliError::Crypto(e.to_string()))?;
    abi_program_manager
        .submit_and_verify_transaction(&transaction, json_format)
        .await
}

fn print_temp_upload_start(
    action: AbiMutationAction,
    temp_seed: &str,
    temp_seed_hashed: bool,
    json_format: bool,
) {
    if json_format {
        return;
    }

    output::print_info(&format!(
        "Step 1: Uploading {} to temporary buffer (seed: {})",
        action.upload_step_subject(),
        temp_seed
    ));
    if temp_seed_hashed {
        output::print_info("Seed + suffix exceeded 32 bytes; using hashed temporary seed");
    }
}

fn print_temp_upload_success(
    action: AbiMutationAction,
    upload_session: &UploadSession,
    json_format: bool,
) {
    if json_format {
        return;
    }

    output::print_success(&format!(
        "✓ {} uploaded to temporary buffer successfully",
        action.upload_step_subject()
    ));
    output::print_info(&format!(
        "Temporary meta account: {}",
        upload_session.meta_account
    ));
    output::print_info(&format!(
        "Temporary buffer account: {}",
        upload_session.buffer_account
    ));
}

async fn run_upload_mutation(
    config: &Config,
    target: ResolvedAbiTarget,
    fee_payer: Option<&str>,
    abi_file: &str,
    action: AbiMutationAction,
    ephemeral: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let abi_data = read_abi_file(abi_file)?;
    target.print_intro(action, Some(abi_file), Some(abi_data.len()), json_format);

    let abi_program_manager = AbiProgramManager::new(config, fee_payer).await?;
    target.print_context(json_format);

    let preflight = preflight_upload_mutation(action, &abi_program_manager, &target).await?;

    let (temp_seed, temp_seed_hashed) =
        seed_with_suffix(target.temp_seed_base(), action.upload_seed_suffix());
    print_temp_upload_start(action, &temp_seed, temp_seed_hashed, json_format);

    let (uploader_manager, upload_session) =
        upload_temp_abi(config, fee_payer, &temp_seed, &abi_data, json_format).await?;
    print_temp_upload_success(action, &upload_session, json_format);

    if !json_format {
        output::print_info(action.manager_step_label());
    }

    let action_result: Result<(), CliError> = async {
        if matches!(action, AbiMutationAction::Create) {
            if !preflight.meta_exists {
                if !json_format {
                    output::print_info("Creating ABI meta account...");
                }

                let meta_proof = if ephemeral {
                    None
                } else {
                    Some(
                        make_create_state_proof(
                            abi_program_manager.rpc_client(),
                            &target.abi_meta_account,
                            "ABI meta account",
                        )
                        .await?,
                    )
                };

                let nonce = abi_program_manager.get_current_nonce().await?;
                let start_slot = abi_program_manager.get_current_slot().await?;
                let transaction = target.build_create_meta_transaction(
                    abi_program_manager.fee_payer().public_key,
                    ephemeral,
                    meta_proof.as_deref(),
                    nonce,
                    start_slot,
                )?;
                sign_and_submit_transaction(&abi_program_manager, transaction, json_format).await?;
            } else if !json_format {
                output::print_warning("ABI meta account already exists; skipping creation.");
            }

            let abi_proof = if ephemeral {
                None
            } else {
                if !json_format {
                    output::print_info("Creating state proof for ABI account...");
                }
                Some(
                    make_create_state_proof(
                        abi_program_manager.rpc_client(),
                        &target.abi_account,
                        "ABI account",
                    )
                    .await?,
                )
            };

            let nonce = abi_program_manager.get_current_nonce().await?;
            let start_slot = abi_program_manager.get_current_slot().await?;
            let transaction = target.build_create_abi_transaction(
                abi_program_manager.fee_payer().public_key,
                &upload_session.buffer_account,
                abi_data.len(),
                ephemeral,
                abi_proof.as_deref(),
                nonce,
                start_slot,
            )?;
            sign_and_submit_transaction(&abi_program_manager, transaction, json_format).await?;
        } else {
            let nonce = abi_program_manager.get_current_nonce().await?;
            let start_slot = abi_program_manager.get_current_slot().await?;
            let transaction = target.build_upgrade_transaction(
                abi_program_manager.fee_payer().public_key,
                &upload_session.buffer_account,
                abi_data.len(),
                nonce,
                start_slot,
            )?;
            sign_and_submit_transaction(&abi_program_manager, transaction, json_format).await?;
        }

        if !json_format {
            output::print_success(&format!(
                "✓ ABI account {} successfully",
                action.past_tense()
            ));
        }

        Ok(())
    }
    .await;

    let cleanup_error = cleanup_temp_upload(&uploader_manager, &temp_seed, json_format).await;
    action_result?;

    let temp_upload = TempUploadSummary {
        seed: temp_seed,
        session: upload_session,
        cleanup_error,
    };

    if json_format {
        output::print_output(
            target.to_response(action, ephemeral, Some(abi_data.len()), Some(&temp_upload)),
            true,
        );
    } else {
        target.print_final_success(action, json_format);
    }

    Ok(())
}

async fn run_direct_mutation(
    config: &Config,
    target: ResolvedAbiTarget,
    fee_payer: Option<&str>,
    action: AbiMutationAction,
    ephemeral: bool,
    json_format: bool,
) -> Result<(), CliError> {
    target.print_intro(action, None, None, json_format);

    let abi_program_manager = AbiProgramManager::new(config, fee_payer).await?;
    target.print_context(json_format);

    let nonce = abi_program_manager.get_current_nonce().await?;
    let start_slot = abi_program_manager.get_current_slot().await?;
    let transaction = match action {
        AbiMutationAction::Finalize => target.build_finalize_transaction(
            abi_program_manager.fee_payer().public_key,
            nonce,
            start_slot,
        )?,
        AbiMutationAction::Close => target.build_close_transaction(
            abi_program_manager.fee_payer().public_key,
            nonce,
            start_slot,
        )?,
        AbiMutationAction::Create | AbiMutationAction::Upgrade => {
            unreachable!("only finalize and close run direct mutations")
        }
    };
    sign_and_submit_transaction(&abi_program_manager, transaction, json_format).await?;

    if json_format {
        output::print_output(target.to_response(action, ephemeral, None, None), true);
    } else {
        target.print_final_success(action, json_format);
    }

    Ok(())
}

fn seed_with_suffix(base_seed: &str, suffix: &str) -> (String, bool) {
    let combined = format!("{}_{}", base_seed, suffix);
    if combined.len() <= ABI_SEED_MAX_LEN {
        (combined, false)
    } else {
        let digest = crypto::calculate_sha256(combined.as_bytes());
        let hashed = hex::encode(&digest[..ABI_SEED_MAX_LEN / 2]);
        (hashed, true)
    }
}

fn read_abi_file(abi_file: &str) -> Result<Vec<u8>, CliError> {
    let abi_path = Path::new(abi_file);
    if !abi_path.exists() {
        return Err(CliError::Generic {
            message: format!("ABI file not found: {}", abi_file),
        });
    }

    let is_yaml = abi_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml"))
        .unwrap_or(false);
    if !is_yaml {
        return Err(CliError::Validation(format!(
            "ABI file must have .yaml or .yml extension: {}",
            abi_file
        )));
    }

    fs::read(abi_path).map_err(CliError::Io)
}

fn parse_seed_32_bytes(seed_hex: &str) -> Result<[u8; 32], CliError> {
    let seed_hex = seed_hex.strip_prefix("0x").unwrap_or(seed_hex);
    let seed_bytes = hex::decode(seed_hex).map_err(|e| {
        CliError::Validation(format!(
            "Invalid seed hex string (expected 32 bytes): {}",
            e
        ))
    })?;
    if seed_bytes.len() != 32 {
        return Err(CliError::Validation(format!(
            "Invalid seed length: expected 32 bytes, got {}",
            seed_bytes.len()
        )));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);
    Ok(seed)
}

fn derive_seed_from_string(seed_input: &str) -> [u8; 32] {
    crypto::calculate_sha256(seed_input.as_bytes())
}

fn parse_external_seed(seed_input: &str, format: ExternalSeedFormat) -> Result<[u8; 32], CliError> {
    match format {
        ExternalSeedFormat::Hex32 => parse_seed_32_bytes(seed_input),
        ExternalSeedFormat::StringHash => Ok(derive_seed_from_string(seed_input)),
    }
}

fn abi_meta_body_official(program_bytes: &[u8; 32]) -> [u8; ABI_META_BODY_LEN] {
    let mut body = [0u8; ABI_META_BODY_LEN];
    body[..32].copy_from_slice(program_bytes);
    body
}

fn abi_meta_body_external(
    publisher_bytes: &[u8; 32],
    target_program_bytes: &[u8; 32],
    seed: &[u8; 32],
) -> [u8; ABI_META_BODY_LEN] {
    let mut body = [0u8; ABI_META_BODY_LEN];
    body[..32].copy_from_slice(publisher_bytes);
    body[32..64].copy_from_slice(target_program_bytes);
    body[64..96].copy_from_slice(seed);
    body
}

fn derive_abi_meta_seed_bytes(kind: u8, body: &[u8; ABI_META_BODY_LEN]) -> [u8; 32] {
    let mut data = Vec::with_capacity(1 + ABI_META_BODY_LEN);
    data.push(kind);
    data.extend_from_slice(body);
    crypto::calculate_sha256(&data)
}

fn derive_abi_account_seed_bytes(kind: u8, body: &[u8; ABI_META_BODY_LEN]) -> [u8; 32] {
    let mut data = Vec::with_capacity(1 + ABI_META_BODY_LEN + ABI_ACCOUNT_SUFFIX.len());
    data.push(kind);
    data.extend_from_slice(body);
    data.extend_from_slice(ABI_ACCOUNT_SUFFIX);
    crypto::calculate_sha256(&data)
}

fn resolve_actor_pubkey(config: &Config, actor_name: Option<&str>) -> Result<[u8; 32], CliError> {
    let actor_pubkey = if let Some(actor_name) = actor_name {
        let actor_key = config.keys.get_key(actor_name)?;
        let actor_keypair = crypto::keypair_from_hex(actor_key)?;
        actor_keypair.public_key
    } else {
        let default_key = config.get_private_key_bytes()?;
        let default_keypair = crypto::keypair_from_hex(&hex::encode(default_key))?;
        default_keypair.public_key
    };

    Ok(actor_pubkey)
}

async fn run_abi_mutation(
    config: &Config,
    args: NormalizedAbiAccountArgs<'_>,
    abi_file: Option<&str>,
    action: AbiMutationAction,
    json_format: bool,
) -> Result<(), CliError> {
    let target = resolve_account_target(config, args)?;

    match action {
        AbiMutationAction::Create | AbiMutationAction::Upgrade => {
            run_upload_mutation(
                config,
                target,
                args.fee_payer,
                abi_file.expect("create and upgrade require an ABI file"),
                action,
                args.ephemeral,
                json_format,
            )
            .await
        }
        AbiMutationAction::Finalize | AbiMutationAction::Close => {
            run_direct_mutation(
                config,
                target,
                args.fee_payer,
                action,
                args.ephemeral,
                json_format,
            )
            .await
        }
    }
}

async fn get_abi_account_info(
    config: &Config,
    abi_account_str: &str,
    include_data: bool,
    out_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let abi_program_manager = AbiProgramManager::new(config, None).await?;

    let abi_account = Pubkey::new(abi_account_str.to_string())
        .map_err(|e| CliError::Validation(format!("Invalid ABI account public key: {}", e)))?;

    let rpc_client = abi_program_manager.rpc_client();
    let account_info_opt =
        fetch_current_account_info(rpc_client, &abi_account, "ABI account").await?;

    let account_info = match account_info_opt {
        Some(info) => info,
        None => {
            return Err(CliError::Generic {
                message: format!("ABI account {} not found on-chain", abi_account),
            });
        }
    };

    let data_b64 = account_info.data.clone().ok_or_else(|| CliError::Generic {
        message: format!("ABI account {} has no data", abi_account),
    })?;

    let data_bytes = general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| CliError::Generic {
            message: format!("Failed to decode ABI account data: {}", e),
        })?;

    const HEADER_LEN: usize = 32 + 8 + 1 + 4;
    if data_bytes.len() < HEADER_LEN {
        return Err(CliError::Generic {
            message: format!(
                "ABI account data too small ({} bytes, expected at least {})",
                data_bytes.len(),
                HEADER_LEN
            ),
        });
    }

    let mut meta_bytes = [0u8; 32];
    meta_bytes.copy_from_slice(&data_bytes[0..32]);
    let abi_meta_account = Pubkey::from_bytes(&meta_bytes);
    let revision = u64::from_le_bytes(data_bytes[32..40].try_into().expect("slice length checked"));
    let state_raw = data_bytes[40];
    let state_label = match state_raw {
        0 => "OPEN",
        1 => "FINALIZED",
        _ => "UNKNOWN",
    };
    let content_sz =
        u32::from_le_bytes(data_bytes[41..45].try_into().expect("slice length checked")) as usize;

    if HEADER_LEN + content_sz > data_bytes.len() {
        return Err(CliError::Generic {
            message: format!(
                "ABI account content size {} exceeds available data {}",
                content_sz,
                data_bytes.len() - HEADER_LEN
            ),
        });
    }

    let contents = &data_bytes[HEADER_LEN..HEADER_LEN + content_sz];
    let yaml_string = String::from_utf8_lossy(contents).to_string();

    if let Some(path) = out_path {
        fs::write(path, contents).map_err(CliError::Io)?;
        if !json_format {
            println!("Full ABI YAML written to {}", path);
        }
    }

    if json_format {
        let mut response = json!({
            "abi_account": {
                "public_key": abi_account.to_string(),
                "abi_meta_account": abi_meta_account.to_string(),
                "revision": revision,
                "state": state_label,
                "state_raw": state_raw,
                "stored_yaml_size": content_sz
            }
        });

        if include_data {
            if let Some(obj) = response["abi_account"].as_object_mut() {
                obj.insert("data".to_string(), json!(yaml_string));
            }
        }

        if let Some(path) = out_path {
            if let Some(obj) = response["abi_account"].as_object_mut() {
                obj.insert("output_path".to_string(), json!(path));
            }
        }

        output::print_output(response, true);
    } else {
        println!("\x1b[1;38;2;255;112;187mABI Account Information\x1b[0m");
        println!("  Public Key: {}", abi_account);
        println!("  ABI Meta Account: {}", abi_meta_account.to_string());
        println!("  Version: {}", revision);
        println!("  State: {}", state_label);
        println!("  Stored YAML Size: {}", content_sz);
        if include_data {
            println!(
                "\x1b[1;38;2;255;112;187mRetrieved ABI Data\x1b[0m\n{}",
                yaml_string
            );
        }
    }

    Ok(())
}
