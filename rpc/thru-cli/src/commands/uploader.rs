//! Program upload and cleanup command implementations

use std::fs;
use std::path::Path;
use std::time::Duration;
use thru_base::tn_tools::{KeyPair, Pubkey};
use thru_base::txn_lib::Transaction;
use thru_base::txn_tools::TransactionBuilder;

use crate::cli::UploaderCommands;
use crate::config::Config;
use crate::crypto;
use crate::error::CliError;
use crate::output;
use crate::utils::format_vm_error;
use thru_client::{Client as RpcClient, VersionContext};

// Transaction verification constants
const TRANSACTION_VERIFICATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Handle program subcommands
pub async fn handle_uploader_command(
    config: &Config,
    subcommand: UploaderCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        UploaderCommands::Upload {
            uploader,
            chunk_size,
            seed,
            program_file,
        } => {
            upload_program(
                config,
                uploader.as_deref(),
                &seed,
                &program_file,
                chunk_size,
                json_format,
            )
            .await
        }
        UploaderCommands::Cleanup { uploader, seed } => {
            cleanup_program(config, uploader.as_deref(), &seed, json_format).await
        }
        UploaderCommands::Status { uploader, seed } => {
            get_uploader_status(config, uploader.as_deref(), &seed, json_format).await
        }
    }
}

/// Upload progress tracking
#[derive(Debug, Clone)]
pub struct UploadProgress {
    pub total_transactions: usize,
    pub completed_transactions: usize,
    pub current_phase: UploadPhase,
    pub bytes_uploaded: usize,
    #[allow(dead_code)]
    pub total_bytes: usize,
}

/// Upload phase tracking
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum UploadPhase {
    Creating,
    Verifying { phase: String },
    Writing { chunk: usize, total_chunks: usize },
    Finalizing,
    Complete,
    // Failed { error: String },
}

/// Upload session state
#[derive(Debug, Clone)]
pub struct UploadSession {
    pub meta_account: Pubkey,
    pub buffer_account: Pubkey,
    pub program_hash: [u8; 32],
    pub progress: UploadProgress,
    pub chunk_size: usize,
    #[allow(dead_code)]
    pub is_resume: bool,
    pub resume_position: usize,
    #[allow(dead_code)]
    pub existing_buffer_data: Option<Vec<u8>>,
}

/// Resume calculation results
#[derive(Debug, Clone)]
pub struct ResumeCalculation {
    pub resume_byte_position: usize,
    pub resume_chunk_index: usize,
    pub bytes_completed: usize,
    pub bytes_remaining: usize,
    pub completed_chunks: usize,
    pub remaining_chunks: usize,
    #[allow(dead_code)]
    pub needs_finalization_only: bool,
}

/// Resume action to take
#[derive(Debug, Clone)]
pub enum ResumeAction {
    StartFresh,
    ResumeFromPosition(ResumeCalculation),
    FinalizeOnly, // All data uploaded, just need finalization
}

/// Upload state from blockchain accounts
#[derive(Debug, Clone)]
pub struct UploadState {
    #[allow(dead_code)]
    pub meta_account_data: Vec<u8>,
    pub buffer_account_data: Vec<u8>,
    pub stored_hash: [u8; 32],
    #[allow(dead_code)]
    pub buffer_size: usize,
    pub is_finalized: bool,
}

/// Uploader transaction builder and manager
pub struct UploaderManager {
    #[allow(dead_code)]
    config: Config,
    rpc_client: RpcClient,
    uploader_program_pubkey: Pubkey,
    fee_payer_keypair: KeyPair,
    chain_id: u16,
}

impl UploaderManager {
    /// Create new uploader manager
    pub async fn new(config: &Config) -> Result<Self, CliError> {
        // Create RPC client
        let rpc_url = config.get_grpc_url()?;
        let rpc_client = RpcClient::builder()
            .http_endpoint(rpc_url)
            .timeout(Duration::from_secs(config.timeout_seconds))
            .auth_token(config.auth_token.clone())
            .build()?;

        // Get uploader program public key
        let uploader_program_pubkey = config.get_uploader_pubkey()?;

        // Create fee payer keypair from config
        let private_key_bytes = config.get_private_key_bytes()?;
        let fee_payer_keypair = crypto::keypair_from_hex(&hex::encode(private_key_bytes))?;

        let chain_info = rpc_client.get_chain_info().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get chain info: {}", e))
        })?;

        Ok(Self {
            config: config.clone(),
            rpc_client,
            uploader_program_pubkey,
            fee_payer_keypair,
            chain_id: chain_info.chain_id,
        })
    }

    /// Get current nonce for fee payer account
    ///
    /// Queries the blockchain to get the actual nonce value for the fee payer account.
    /// This is used to ensure transactions are submitted with the correct nonce value.
    ///
    /// # Returns
    /// - `Ok(u64)` - The current nonce value for the fee payer account
    /// - `Err(CliError::NonceManagement)` - If the account is not found or RPC call fails
    async fn get_current_nonce(&self) -> Result<u64, CliError> {
        // Query the actual account nonce from the blockchain
        match self
            .rpc_client
            .get_account_info(&self.fee_payer_keypair.address_string, None, Some(VersionContext::Current))
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

    /// Get current slot
    ///
    /// Queries the blockchain to get the current finalized slot number.
    /// This is used as the start_slot parameter for transactions.
    ///
    /// # Returns
    /// - `Ok(u64)` - The current finalized slot number
    /// - `Err(CliError::TransactionSubmission)` - If the RPC call fails
    async fn get_current_slot(&self) -> Result<u64, CliError> {
        // Get current finalized slot from the blockchain
        let block_height = self.rpc_client.get_block_height().await.map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to get current slot: {}", e))
        })?;
        Ok(block_height.finalized_height)
    }

    /// Check for existing upload state
    ///
    /// Queries the blockchain to check if there's an existing upload in progress
    /// for the given meta and buffer accounts.
    ///
    /// # Arguments
    /// * `seed` - The seed used for account derivation (for error messages)
    /// * `meta_account` - The meta account public key
    /// * `buffer_account` - The buffer account public key
    ///
    /// # Returns
    /// - `Ok(Some(UploadState))` - If existing upload state is found
    /// - `Ok(None)` - If no existing upload state is found
    /// - `Err(CliError)` - If there's an error querying the accounts
    async fn check_existing_upload_state(
        &self,
        seed: &str,
        meta_account: &Pubkey,
        buffer_account: &Pubkey,
    ) -> Result<Option<UploadState>, CliError> {
        // Check if meta account exists
        let meta_account_info = match self.rpc_client.get_account_info(meta_account, None, Some(VersionContext::Current)).await {
            Ok(Some(account)) => account,
            Ok(None) => return Ok(None), // No existing upload
            Err(e) => {
                return Err(CliError::ResumeValidation(format!(
                    "Failed to query meta account: {}",
                    e
                )));
            }
        };

        // Check if buffer account exists
        let buffer_account_info = match self.rpc_client.get_account_info(buffer_account, None, Some(VersionContext::Current)).await
        {
            Ok(Some(account)) => account,
            Ok(None) => return Ok(None), // No existing upload
            Err(e) => {
                return Err(CliError::ResumeValidation(format!(
                    "Failed to query buffer account: {}",
                    e
                )));
            }
        };

        // Decode account data from base64
        let meta_data = self.decode_account_data(&meta_account_info.data)?;
        let buffer_data = self.decode_account_data(&buffer_account_info.data)?;

        // Validate meta account has data
        const EXPECTED_META_SIZE: usize = 32 + 32 + 1; // authority + hash + state = 65 bytes
        if meta_data.len() < EXPECTED_META_SIZE {
            if meta_data.is_empty() {
                return Err(CliError::ResumeValidationAccount {
                    message: format!(
                        "Uploader meta account exists but has no data. This indicates a corrupted or orphan account. \
                        Try cleaning up with: thru-cli uploader cleanup {}",
                        seed
                    ),
                    account: meta_account.to_string(),
                    seed: seed.to_string(),
                });
            } else {
                return Err(CliError::ResumeValidationAccount {
                    message: format!(
                        "Uploader meta account has invalid data size: {} bytes (expected at least {} bytes). \
                        Try cleaning up with: thru-cli uploader cleanup {}",
                        meta_data.len(),
                        EXPECTED_META_SIZE,
                        seed
                    ),
                    account: meta_account.to_string(),
                    seed: seed.to_string(),
                });
            }
        }

        // Parse meta account data to extract stored hash and finalization status
        let (stored_hash, is_finalized) = self.parse_meta_account_data(&meta_data)?;

        let upload_state = UploadState {
            meta_account_data: meta_data,
            buffer_account_data: buffer_data.clone(),
            stored_hash,
            buffer_size: buffer_data.len(),
            is_finalized,
        };

        Ok(Some(upload_state))
    }

    /// Decode base64 account data
    ///
    /// # Arguments
    /// * `data` - The optional base64 encoded data string
    ///
    /// # Returns
    /// - `Ok(Vec<u8>)` - The decoded data bytes
    /// - `Err(CliError)` - If decoding fails
    fn decode_account_data(&self, data: &Option<String>) -> Result<Vec<u8>, CliError> {
        match data {
            Some(base64_data) => {
                use base64::{Engine as _, engine::general_purpose};
                general_purpose::STANDARD.decode(base64_data).map_err(|e| {
                    CliError::ResumeValidation(format!("Failed to decode account data: {}", e))
                })
            }
            None => Ok(Vec::new()),
        }
    }

    /// Parse meta account data to extract stored hash and finalization status
    ///
    /// # Arguments
    /// * `meta_data` - The meta account data bytes
    ///
    /// # Returns
    /// - `Ok((hash, is_finalized))` - The stored hash and finalization status
    /// - `Err(CliError)` - If the meta account data is invalid
    fn parse_meta_account_data(&self, meta_data: &[u8]) -> Result<([u8; 32], bool), CliError> {
        // Meta account structure (from tn_uploader_program.h):
        // struct tn_uploader_program_meta {
        //   tn_pubkey_t    authority;              // 32 bytes (0-31)
        //   tn_hash_t      expected_account_hash;  // 32 bytes (32-63)
        //   uchar          state;                  // 1 byte (64)
        // };

        const EXPECTED_SIZE: usize = 32 + 32 + 1; // authority + hash + state = 65 bytes
        if meta_data.len() < EXPECTED_SIZE {
            return Err(CliError::ResumeValidation(format!(
                "Meta account data too small: {} bytes, expected at least {} bytes",
                meta_data.len(),
                EXPECTED_SIZE
            )));
        }

        // Extract expected_account_hash (bytes 32-63)
        let mut stored_hash = [0u8; 32];
        stored_hash.copy_from_slice(&meta_data[32..64]);

        // Extract state (byte 64)
        // TN_UPLOADER_PROGRAM_STATE_OPEN = 0x01
        // TN_UPLOADER_PROGRAM_STATE_FINALIZED = 0x02
        let state = meta_data[64];
        let is_finalized = state == 0x02; // TN_UPLOADER_PROGRAM_STATE_FINALIZED

        Ok((stored_hash, is_finalized))
    }

    /// Validate resume conditions
    ///
    /// Checks if the existing upload state is valid for resuming.
    ///
    /// # Arguments
    /// * `upload_state` - The existing upload state
    /// * `file_hash` - The hash of the current program file
    ///
    /// # Returns
    /// - `Ok(true)` - If resume conditions are valid
    /// - `Ok(false)` - If resume conditions are invalid (should start fresh)
    /// - `Err(CliError)` - If validation fails
    async fn validate_resume_conditions(
        &self,
        upload_state: &UploadState,
        file_hash: &[u8; 32],
    ) -> Result<bool, CliError> {
        // Check if upload is already finalized
        // if upload_state.is_finalized {
        //     return Err(CliError::MetaAccountClosed(
        //         "Upload was already finalized".to_string()
        //     ));
        // }

        // Check if file hash matches stored hash
        if upload_state.stored_hash != *file_hash {
            return Err(CliError::HashMismatch(format!(
                "File has been modified since last upload. Expected: {}, Current: {}",
                hex::encode(upload_state.stored_hash),
                hex::encode(file_hash)
            )));
        }

        Ok(true)
    }

    /// Calculate resume position using direct byte-by-byte comparison
    ///
    /// # Arguments
    /// * `buffer_data` - The buffer account data
    /// * `program_data` - The program file data
    /// * `chunk_size` - The chunk size used for upload
    ///
    /// # Returns
    /// - `Ok(ResumeAction)` - The action to take for resume
    /// - `Err(CliError)` - If calculation fails
    async fn calculate_resume_position(
        &self,
        buffer_data: &[u8],
        program_data: &[u8],
        chunk_size: usize,
    ) -> Result<ResumeAction, CliError> {
        // Handle case where buffer is empty
        if buffer_data.is_empty() {
            return Ok(ResumeAction::StartFresh);
        }

        // Handle case where buffer is larger than program (shouldn't happen)
        if buffer_data.len() > program_data.len() {
            return Err(CliError::ResumeValidation(
                "Buffer data is larger than program file".to_string(),
            ));
        }

        // Find first non-matching byte
        let mut resume_byte_position = 0;
        let compare_length = std::cmp::min(buffer_data.len(), program_data.len());

        for i in 0..compare_length {
            if buffer_data[i] != program_data[i] {
                resume_byte_position = i;
                break;
            }
            resume_byte_position = i + 1;
        }

        // Check if all uploaded bytes match
        if resume_byte_position == buffer_data.len() {
            // All buffer data matches program file
            if buffer_data.len() == program_data.len() {
                // Complete file uploaded - check if finalization needed
                return Ok(ResumeAction::FinalizeOnly);
            } else {
                // Partial upload, all data is valid - resume from end
                resume_byte_position = buffer_data.len();
            }
        }

        // Calculate resume chunk information
        let resume_chunk_index = resume_byte_position / chunk_size;
        let bytes_completed = resume_byte_position;
        let bytes_remaining = program_data.len() - resume_byte_position;
        let total_chunks = (program_data.len() + chunk_size - 1) / chunk_size;
        let completed_chunks = resume_byte_position / chunk_size;
        let remaining_chunks = total_chunks - completed_chunks;

        let resume_calc = ResumeCalculation {
            resume_byte_position,
            resume_chunk_index,
            bytes_completed,
            bytes_remaining,
            completed_chunks,
            remaining_chunks,
            needs_finalization_only: false,
        };

        Ok(ResumeAction::ResumeFromPosition(resume_calc))
    }

    /// Execute transaction and wait for completion
    ///
    /// This method submits a transaction and waits for its completion using the new
    /// execute_transaction API, which handles polling internally.
    ///
    /// # Arguments
    /// * `transaction` - The transaction to execute
    /// * `json_format` - Whether to use JSON output format
    ///
    /// # Returns
    /// * `Ok(())` - If the transaction was successfully executed
    /// * `Err(CliError)` - If the transaction failed or timed out
    async fn execute_transaction(
        &self,
        transaction: &Transaction,
        json_format: bool,
    ) -> Result<(), CliError> {
        let wire_bytes = transaction.to_wire();
        let timeout = TRANSACTION_VERIFICATION_TIMEOUT;

        let transaction_details = self
            .rpc_client
            .execute_transaction(&wire_bytes, timeout)
            .await
            .map_err(|e| CliError::TransactionSubmission(e.to_string()))?;

        if !json_format {
            output::print_success(&format!(
                "Transaction completed: {}",
                transaction_details.signature.as_str()
            ));

            // Check execution result
            if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
                let vm_error_label = format_vm_error(transaction_details.vm_error);
                let vm_error_msg = if transaction_details.vm_error != 0 {
                    format!(" (VM error: {})", vm_error_label)
                } else {
                    String::new()
                };
                output::print_warning(&format!(
                    "Transaction completed with execution result: {} vm_error: {}{}",
                    transaction_details.execution_result as i64, vm_error_label, vm_error_msg
                ));
            }
        }

        // Check for execution errors
        if transaction_details.execution_result != 0 || transaction_details.vm_error != 0 {
            let vm_error_label = format_vm_error(transaction_details.vm_error);
            let vm_error_msg = if transaction_details.vm_error != 0 {
                format!(" (VM error: {})", vm_error_label)
            } else {
                String::new()
            };
            return Err(CliError::TransactionVerification(format!(
                "Transaction failed with execution result: {} (VM error: {}{}, User error: {})",
                transaction_details.execution_result as i64,
                vm_error_label,
                vm_error_msg,
                transaction_details.user_error_code
            )));
        }

        Ok(())
    }

    /// Execute CREATE phase
    async fn execute_create_phase(
        &self,
        session: &mut UploadSession,
        seed: &str,
        buffer_size: usize,
        nonce: u64,
        start_slot: u64,
        json_format: bool,
    ) -> Result<(), CliError> {
        session.progress.current_phase = UploadPhase::Creating;

        if !json_format {
            output::print_info("Creating meta and buffer accounts...");
        }

        let mut transaction = TransactionBuilder::build_uploader_create(
            self.fee_payer_keypair.public_key,
            self.uploader_program_pubkey
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            session
                .meta_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            session
                .buffer_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            buffer_size as u32,
            session.program_hash,
            seed.as_bytes(),
            0, // fee
            nonce,
            start_slot,
        )
        .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

        // Set chain ID and sign transaction
        let mut transaction = transaction.with_chain_id(self.chain_id);
        transaction
            .sign(&self.fee_payer_keypair.private_key)
            .map_err(|e| CliError::Crypto(e.to_string()))?;

        // Execute transaction and wait for completion
        session.progress.current_phase = UploadPhase::Verifying {
            phase: "CREATE".to_string(),
        };
        self.execute_transaction(&transaction, json_format).await?;

        session.progress.completed_transactions += 1;

        Ok(())
    }

    /// Execute WRITE phase
    async fn execute_write_phase(
        &self,
        session: &mut UploadSession,
        program_data: &[u8],
        mut nonce: u64,
        start_slot: u64,
        json_format: bool,
    ) -> Result<(), CliError> {
        let total_chunks = (program_data.len() + session.chunk_size - 1) / session.chunk_size;

        for (chunk_idx, chunk) in program_data.chunks(session.chunk_size).enumerate() {
            session.progress.current_phase = UploadPhase::Writing {
                chunk: chunk_idx + 1,
                total_chunks,
            };

            let offset = (chunk_idx * session.chunk_size) as u32;

            if !json_format {
                output::print_info(&format!(
                    "Writing chunk {}/{} ({} bytes) at offset {}",
                    chunk_idx + 1,
                    total_chunks,
                    chunk.len(),
                    offset
                ));
            }

            let mut transaction = TransactionBuilder::build_uploader_write(
                self.fee_payer_keypair.public_key,
                self.uploader_program_pubkey
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                session
                    .meta_account
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                session
                    .buffer_account
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                chunk,
                offset,
                0, // fee
                nonce,
                start_slot,
            )
            .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

            // Set chain ID and sign transaction
            let mut transaction = transaction.with_chain_id(self.chain_id);
            transaction
                .sign(&self.fee_payer_keypair.private_key)
                .map_err(|e| CliError::Crypto(e.to_string()))?;

            // Execute transaction and wait for completion
            session.progress.current_phase = UploadPhase::Verifying {
                phase: format!("WRITE chunk {}/{}", chunk_idx + 1, total_chunks),
            };
            self.execute_transaction(&transaction, json_format).await?;

            session.progress.completed_transactions += 1;
            session.progress.bytes_uploaded += chunk.len();
            nonce += 1;
        }

        Ok(())
    }

    /// Execute WRITE phase from a specific position (for resume)
    async fn execute_write_phase_from_position(
        &self,
        session: &mut UploadSession,
        program_data: &[u8],
        start_chunk_index: usize,
        mut nonce: u64,
        start_slot: u64,
        json_format: bool,
    ) -> Result<(), CliError> {
        let total_chunks = (program_data.len() + session.chunk_size - 1) / session.chunk_size;
        let chunk_start_byte = start_chunk_index * session.chunk_size;
        let remaining_data = &program_data[chunk_start_byte..];

        for (chunk_idx, chunk) in remaining_data.chunks(session.chunk_size).enumerate() {
            let actual_chunk_idx = start_chunk_index + chunk_idx;

            session.progress.current_phase = UploadPhase::Writing {
                chunk: actual_chunk_idx + 1,
                total_chunks,
            };

            let offset = (actual_chunk_idx * session.chunk_size) as u32;

            if !json_format {
                output::print_info(&format!(
                    "Writing chunk {}/{} ({} bytes) at offset {} [RESUME]",
                    actual_chunk_idx + 1,
                    total_chunks,
                    chunk.len(),
                    offset
                ));
            }

            let mut transaction = TransactionBuilder::build_uploader_write(
                self.fee_payer_keypair.public_key,
                self.uploader_program_pubkey
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                session
                    .meta_account
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                session
                    .buffer_account
                    .to_bytes()
                    .map_err(|e| CliError::Crypto(e.to_string()))?,
                chunk,
                offset,
                0, // fee
                nonce,
                start_slot,
            )
            .map_err(|e| CliError::ProgramUpload(e.to_string()))?;

            // Set chain ID and sign transaction
            let mut transaction = transaction.with_chain_id(self.chain_id);
            transaction
                .sign(&self.fee_payer_keypair.private_key)
                .map_err(|e| CliError::Crypto(e.to_string()))?;

            // Execute transaction and wait for completion
            session.progress.current_phase = UploadPhase::Verifying {
                phase: format!("WRITE chunk {}/{}", actual_chunk_idx + 1, total_chunks),
            };
            self.execute_transaction(&transaction, json_format).await?;

            session.progress.completed_transactions += 1;
            session.progress.bytes_uploaded += chunk.len();
            nonce += 1;
        }

        Ok(())
    }

    /// Execute FINALIZE phase
    async fn execute_finalize_phase(
        &self,
        session: &mut UploadSession,
        nonce: u64,
        start_slot: u64,
        buffer_size: usize,
        json_format: bool,
    ) -> Result<(), CliError> {
        session.progress.current_phase = UploadPhase::Finalizing;

        if !json_format {
            output::print_info("Finalizing upload...");
        }

        let mut transaction = TransactionBuilder::build_uploader_finalize(
            self.fee_payer_keypair.public_key,
            self.uploader_program_pubkey
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            session
                .meta_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            session
                .buffer_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            buffer_size as u32,
            session.program_hash,
            0, // fee
            nonce,
            start_slot,
        )
        .map_err(|e| CliError::ProgramUpload(e.to_string()))?;
        // transaction = transaction.with_compute_units(2147483648);

        // Set chain ID and sign transaction
        let mut transaction = transaction.with_chain_id(self.chain_id);
        transaction
            .sign(&self.fee_payer_keypair.private_key)
            .map_err(|e| CliError::Crypto(e.to_string()))?;

        // Execute transaction and wait for completion
        session.progress.current_phase = UploadPhase::Verifying {
            phase: "FINALIZE".to_string(),
        };
        self.execute_transaction(&transaction, json_format).await?;

        session.progress.completed_transactions += 1;

        Ok(())
    }

    /// Execute complete upload workflow
    pub async fn upload_program(
        &self,
        seed: &str,
        program_data: &[u8],
        chunk_size: usize,
        json_format: bool,
    ) -> Result<UploadSession, CliError> {
        // Calculate program hash
        let program_hash = crypto::calculate_sha256(program_data);

        // Derive account addresses
        let (meta_account, buffer_account) =
            crypto::derive_uploader_accounts_from_seed(seed, &self.uploader_program_pubkey)?;

        // Check for existing upload state
        if !json_format {
            output::print_info("🔍 Checking for existing upload state...");
        }

        let (resume_action, all_done) = match self
            .check_existing_upload_state(seed, &meta_account, &buffer_account)
            .await?
        {
            Some(upload_state) => {
                if !json_format {
                    output::print_success(&format!("   ✓ Meta account found ({})", meta_account));
                    output::print_success(&format!(
                        "   ✓ Buffer account found ({})",
                        buffer_account
                    ));
                    output::print_info("🔍 Validating resume conditions...");
                }

                match self
                    .validate_resume_conditions(&upload_state, &program_hash)
                    .await
                {
                    Ok(_) => {
                        if !json_format {
                            output::print_success("   ✓ File hash matches stored hash");
                            // output::print_success("   ✓ Meta account is still open");
                            output::print_success("   ✓ Buffer data integrity verified");
                            output::print_info("📊 Calculating resume position...");
                        }

                        let action = self
                            .calculate_resume_position(
                                &upload_state.buffer_account_data,
                                program_data,
                                chunk_size,
                            )
                            .await?;

                        let mut all_done = false;

                        match &action {
                            ResumeAction::ResumeFromPosition(calc) => {
                                if !json_format {
                                    let percentage = (calc.bytes_completed as f64
                                        / program_data.len() as f64)
                                        * 100.0;
                                    output::print_success(&format!(
                                        "   ✓ Found {}/{} chunks already uploaded ({:.1}%)",
                                        calc.completed_chunks,
                                        calc.completed_chunks + calc.remaining_chunks,
                                        percentage
                                    ));
                                    output::print_success(&format!(
                                        "   ✓ {} chunks remaining ({} bytes to upload)",
                                        calc.remaining_chunks, calc.bytes_remaining
                                    ));
                                }
                            }
                            ResumeAction::FinalizeOnly => {
                                if !json_format {
                                    if upload_state.is_finalized {
                                        output::print_success(
                                            "   ✓ All data uploaded and meta is finalized, all done",
                                        );
                                        all_done = true;
                                    } else {
                                        output::print_success(
                                            "   ✓ All data uploaded, only finalization needed",
                                        );
                                    }
                                }
                            }
                            ResumeAction::StartFresh => {
                                if !json_format {
                                    output::print_info("   ℹ No valid resume state found");
                                }
                            }
                        }

                        (action, all_done)
                    }
                    Err(e) => {
                        // For hash mismatch and meta account closed errors, fail completely
                        // instead of falling back to fresh upload
                        match &e {
                            CliError::HashMismatch(_) | CliError::MetaAccountClosed(_) => {
                                if !json_format {
                                    output::print_error(&format!("❌ Cannot resume upload: {}", e));
                                    output::print_error(
                                        "   Upload aborted. Please clean up existing accounts first or use a different seed.",
                                    );
                                }
                                return Err(e);
                            }
                            _ => {
                                // For other validation errors, fall back to fresh upload
                                if !json_format {
                                    output::print_error(&format!("❌ Cannot resume upload: {}", e));
                                    output::print_info("   Starting fresh upload...");
                                }
                                (ResumeAction::StartFresh, false)
                            }
                        }
                    }
                }
            }
            None => {
                if !json_format {
                    output::print_info("   ℹ No existing upload found");
                }
                (ResumeAction::StartFresh, false)
            }
        };

        let total_chunks = (program_data.len() + chunk_size - 1) / chunk_size;
        let total_transactions = match &resume_action {
            ResumeAction::StartFresh => 1 + total_chunks + 1, // CREATE + WRITE chunks + FINALIZE
            ResumeAction::ResumeFromPosition(calc) => {
                1 + calc.completed_chunks + calc.remaining_chunks + 1
            } // Already done + remaining + FINALIZE
            ResumeAction::FinalizeOnly => 1,                  // Only FINALIZE
        };

        let mut session = UploadSession {
            meta_account,
            buffer_account,
            program_hash,
            progress: UploadProgress {
                total_transactions,
                completed_transactions: 0,
                current_phase: UploadPhase::Creating,
                bytes_uploaded: 0,
                total_bytes: program_data.len(),
            },
            chunk_size,
            is_resume: matches!(resume_action, ResumeAction::ResumeFromPosition(_)),
            resume_position: 0,
            existing_buffer_data: None,
        };
        if all_done {
            session.progress.current_phase = UploadPhase::Complete;
            session.progress.total_transactions = 0;
            return Ok(session);
        }

        // Get current nonce and slot
        let mut nonce = self.get_current_nonce().await?;
        let start_slot = self.get_current_slot().await?;

        match resume_action {
            ResumeAction::StartFresh => {
                if !json_format {
                    output::print_info("🚀 Starting fresh upload");
                }

                // Phase 1: CREATE transaction
                self.execute_create_phase(
                    &mut session,
                    seed,
                    program_data.len(),
                    nonce,
                    start_slot,
                    json_format,
                )
                .await?;
                nonce += 1;

                // Phase 2: WRITE transactions
                self.execute_write_phase(
                    &mut session,
                    program_data,
                    nonce,
                    start_slot,
                    json_format,
                )
                .await?;

                // Phase 3: FINALIZE transaction
                let finalize_nonce = self.get_current_nonce().await?;
                self.execute_finalize_phase(
                    &mut session,
                    finalize_nonce,
                    start_slot,
                    program_data.len(),
                    json_format,
                )
                .await?;
            }
            ResumeAction::ResumeFromPosition(calc) => {
                if !json_format {
                    let percentage =
                        (calc.bytes_completed as f64 / program_data.len() as f64) * 100.0;
                    output::print_info(&format!(
                        "🚀 Resuming upload from chunk {}/{} ({:.1}% complete)",
                        calc.resume_chunk_index + 1,
                        total_chunks,
                        percentage
                    ));
                    output::print_info(&format!(
                        "   Skipping {} already uploaded chunks",
                        calc.completed_chunks
                    ));
                    output::print_info(&format!(
                        "   Uploading remaining {} chunks...",
                        calc.remaining_chunks
                    ));
                }

                // Update session progress for resume
                session.progress.completed_transactions = 1 + calc.completed_chunks; // CREATE + completed chunks
                session.progress.bytes_uploaded = calc.bytes_completed;
                session.resume_position = calc.resume_byte_position;

                // Execute WRITE phase from resume position
                self.execute_write_phase_from_position(
                    &mut session,
                    program_data,
                    calc.resume_chunk_index,
                    nonce,
                    start_slot,
                    json_format,
                )
                .await?;

                // Execute FINALIZE phase
                let finalize_nonce = self.get_current_nonce().await?;
                self.execute_finalize_phase(
                    &mut session,
                    finalize_nonce,
                    start_slot,
                    program_data.len(),
                    json_format,
                )
                .await?;
            }
            ResumeAction::FinalizeOnly => {
                if !json_format {
                    output::print_info("🚀 Finalizing upload (all data already uploaded)");
                }

                // Update session progress for finalization-only
                session.progress.completed_transactions = 1 + total_chunks; // CREATE + all WRITE chunks
                session.progress.bytes_uploaded = program_data.len();

                self.execute_finalize_phase(
                    &mut session,
                    nonce,
                    start_slot,
                    program_data.len(),
                    json_format,
                )
                .await?;
            }
        }

        session.progress.current_phase = UploadPhase::Complete;
        Ok(session)
    }

    /// Execute cleanup workflow
    pub async fn cleanup_program(&self, seed: &str, json_format: bool) -> Result<(), CliError> {
        // Derive account addresses
        // let meta_account = crypto::derive_account_from_seed(seed, &self.uploader_program_pubkey)?;
        // let buffer_account = crypto::derive_buffer_account(&meta_account, &self.uploader_program_pubkey)?;
        let (meta_account, buffer_account) =
            crypto::derive_uploader_accounts_from_seed(seed, &self.uploader_program_pubkey)?;

        let nonce = self.get_current_nonce().await?;
        let start_slot = self.get_current_slot().await?;

        if !json_format {
            output::print_info("Cleaning up program accounts...");
        }

        // Create DESTROY transaction
        let mut transaction = TransactionBuilder::build_uploader_destroy(
            self.fee_payer_keypair.public_key,
            self.uploader_program_pubkey
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            meta_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            buffer_account
                .to_bytes()
                .map_err(|e| CliError::Crypto(e.to_string()))?,
            0, // fee
            nonce,
            start_slot,
        )
        .map_err(|e| CliError::ProgramCleanup(e.to_string()))?;

        // Set chain ID and sign transaction
        let mut transaction = transaction.with_chain_id(self.chain_id);
        transaction
            .sign(&self.fee_payer_keypair.private_key)
            .map_err(|e| CliError::Crypto(e.to_string()))?;

        // Execute transaction and wait for completion
        if !json_format {
            output::print_info("Executing cleanup transaction...");
        }
        self.execute_transaction(&transaction, json_format).await?;

        Ok(())
    }
}

/// Upload a program to the blockchain
async fn upload_program(
    config: &Config,
    uploader_pubkey: Option<&str>,
    seed: &str,
    program_file: &str,
    chunk_size: usize,
    json_format: bool,
) -> Result<(), CliError> {
    // Validate program file exists
    let program_path = Path::new(program_file);
    if !program_path.exists() {
        let error_msg = format!("Program file not found: {}", program_file);
        if json_format {
            let error_response = serde_json::json!({
                "error": error_msg
            });
            output::print_output(error_response, true);
        } else {
            output::print_error(&error_msg);
        }
        return Err(CliError::Generic { message: error_msg });
    }

    // Read program data
    let program_data = fs::read(program_path).map_err(|e| CliError::Io(e))?;

    if !json_format {
        output::print_info(&format!(
            "Reading program file: {} ({} bytes)",
            program_file,
            program_data.len()
        ));
    }

    // Calculate program hash
    let program_hash = crypto::calculate_sha256(&program_data);

    if !json_format {
        output::print_info(&format!(
            "Program hash: {}",
            crypto::bytes_to_hex(&program_hash)
        ));
    }

    // Get uploader program public key
    let uploader_program_pubkey = if let Some(custom_uploader) = uploader_pubkey {
        Pubkey::new(custom_uploader.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid uploader public key: {}", e)))?
    } else {
        config.get_uploader_pubkey()?
    };
    let mut cfg = config.clone();
    cfg.uploader_program_public_key = uploader_program_pubkey.to_string();

    // Derive account addresses
    let (meta_account, buffer_account) =
        crypto::derive_uploader_accounts_from_seed(seed, &uploader_program_pubkey)?;

    if !json_format {
        output::print_info(&format!("Meta account: {}", meta_account));
        output::print_info(&format!("Buffer account: {}", buffer_account));
    }

    // Calculate transaction requirements
    let total_chunks = (program_data.len() + chunk_size - 1) / chunk_size;
    let total_transactions = 1 + total_chunks + 1; // create + write chunks + finalize

    if !json_format {
        output::print_info(&format!(
            "Upload will require {} transactions ({} chunks of {} bytes each)",
            total_transactions, total_chunks, chunk_size
        ));
    }

    // Create uploader manager and execute upload
    let uploader = UploaderManager::new(&cfg).await?;

    match uploader
        .upload_program(seed, &program_data, chunk_size, json_format)
        .await
    {
        Ok(session) => {
            let response = output::create_program_upload_response(
                "success",
                session.progress.total_transactions,
                session.progress.completed_transactions,
                program_data.len(),
                Some(&session.meta_account.to_string()),
                Some(&session.buffer_account.to_string()),
            );

            output::print_output(response, json_format);

            if !json_format {
                output::print_success("Program upload completed successfully");
            }

            Ok(())
        }
        Err(e) => {
            let error_msg = format!("Upload failed: {}", e);
            if json_format {
                let error_response = serde_json::json!({
                    "error": error_msg,
                    "program_upload": {
                        "status": "failed",
                        "total_transactions": total_transactions,
                        "completed_transactions": 0,
                        "program_size": program_data.len()
                    }
                });
                output::print_output(error_response, true);
            } else {
                output::print_error(&error_msg);
            }
            Err(e)
        }
    }
}

/// Clean up program accounts
async fn cleanup_program(
    config: &Config,
    uploader_pubkey: Option<&str>,
    seed: &str,
    json_format: bool,
) -> Result<(), CliError> {
    // Get uploader program public key
    let uploader_program_pubkey = if let Some(custom_uploader) = uploader_pubkey {
        Pubkey::new(custom_uploader.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid uploader public key: {}", e)))?
    } else {
        config.get_uploader_pubkey()?
    };
    let mut cfg = config.clone();
    cfg.uploader_program_public_key = uploader_program_pubkey.to_string();

    // Derive account addresses
    let (meta_account, buffer_account) =
        crypto::derive_uploader_accounts_from_seed(seed, &uploader_program_pubkey)?;

    if !json_format {
        output::print_info(&format!("Cleaning up accounts for seed: {}", seed));
        output::print_info(&format!("Meta account: {}", meta_account));
        output::print_info(&format!("Buffer account: {}", buffer_account));
    }

    // Create uploader manager and execute cleanup
    let uploader = UploaderManager::new(&cfg).await?;

    match uploader.cleanup_program(seed, json_format).await {
        Ok(()) => {
            let response = output::create_program_cleanup_response(
                "success",
                "Program accounts cleaned up successfully",
            );

            output::print_output(response, json_format);

            if !json_format {
                output::print_success("Program cleanup completed successfully");
            }

            Ok(())
        }
        Err(e) => {
            let error_msg = format!("Cleanup failed: {}", e);
            if json_format {
                let error_response = serde_json::json!({
                    "error": error_msg,
                    "program_cleanup": {
                        "status": "failed",
                        "message": error_msg
                    }
                });
                output::print_output(error_response, true);
            } else {
                output::print_error(&error_msg);
            }
            Err(e)
        }
    }
}

/// Account status information
#[derive(Debug)]
struct AccountStatus {
    exists: bool,
    is_program: bool,
    data_size: u64,
    owner: Option<String>,
}

fn account_to_status(result: Result<Option<thru_client::Account>, thru_client::ClientError>) -> AccountStatus {
    match result {
        Ok(Some(account)) => AccountStatus {
            exists: true,
            is_program: account.program,
            data_size: account.data_size,
            owner: Some(account.owner.to_string()),
        },
        Ok(None) => AccountStatus {
            exists: false,
            is_program: false,
            data_size: 0,
            owner: None,
        },
        Err(_) => AccountStatus {
            exists: false,
            is_program: false,
            data_size: 0,
            owner: None,
        },
    }
}

fn print_account_status(label: &str, address: &str, status: &AccountStatus) {
    if status.exists {
        let program_flag = if status.is_program { " [PROGRAM]" } else { "" };
        println!("{}: {}", label, address);
        println!("    Status: EXISTS{}, {} bytes", program_flag, status.data_size);
        if let Some(owner) = &status.owner {
            println!("    Owner: {}", owner);
        }
    } else {
        println!("{}: {}", label, address);
        println!("    Status: NOT FOUND");
    }
}

/// Get status of uploader accounts
async fn get_uploader_status(
    config: &Config,
    uploader_pubkey: Option<&str>,
    seed: &str,
    json_format: bool,
) -> Result<(), CliError> {
    // Get uploader program public key
    let uploader_program_pubkey = if let Some(custom_uploader) = uploader_pubkey {
        Pubkey::new(custom_uploader.to_string())
            .map_err(|e| CliError::Validation(format!("Invalid uploader public key: {}", e)))?
    } else {
        config.get_uploader_pubkey()?
    };

    // Derive account addresses
    let (meta_account, buffer_account) =
        crypto::derive_uploader_accounts_from_seed(seed, &uploader_program_pubkey)?;

    // Create RPC client
    let rpc_url = config.get_grpc_url()?;
    if !json_format {
        println!("RPC endpoint: {}", rpc_url);
    }
    let client = RpcClient::builder()
        .http_endpoint(rpc_url.clone())
        .timeout(Duration::from_secs(config.timeout_seconds))
        .auth_token(config.auth_token.clone())
        .build()?;

    // Verify connectivity with a simple call first
    if let Err(e) = client.get_block_height().await {
        let msg = format!("Failed to connect to RPC endpoint {}: {}", rpc_url, e);
        if json_format {
            let response = serde_json::json!({
                "error": {
                    "type": "connection_failed",
                    "message": msg,
                    "endpoint": rpc_url.to_string()
                }
            });
            output::print_output(response, true);
            return Err(CliError::Reported);
        } else {
            output::print_error(&msg);
            return Err(CliError::Reported);
        }
    }

    // Query all accounts in parallel
    let (meta_info, buffer_info) = tokio::join!(
        client.get_account_info(&meta_account, None, Some(VersionContext::Current)),
        client.get_account_info(&buffer_account, None, Some(VersionContext::Current)),
    );

    // Convert to status
    let meta_status = account_to_status(meta_info);
    let buffer_status = account_to_status(buffer_info);

    // Detect corrupted accounts (exist but have 0 bytes)
    let meta_corrupted = meta_status.exists && meta_status.data_size == 0;
    let buffer_corrupted = buffer_status.exists && buffer_status.data_size == 0;
    let any_corrupted = meta_corrupted || buffer_corrupted;

    // Determine upload state
    let upload_complete = meta_status.exists && buffer_status.exists && buffer_status.data_size > 0;

    if json_format {
        let status = if upload_complete {
            "uploaded"
        } else if any_corrupted {
            "corrupted"
        } else if !meta_status.exists && !buffer_status.exists {
            "not_uploaded"
        } else if meta_status.exists && !buffer_status.exists {
            "partial"
        } else {
            "unknown"
        };

        let response = serde_json::json!({
            "uploader_status": {
                "seed": seed,
                "uploader_program": uploader_program_pubkey.to_string(),
                "summary": {
                    "status": status,
                    "upload_exists": upload_complete,
                    "corrupted_accounts": {
                        "any": any_corrupted,
                        "meta": meta_corrupted,
                        "buffer": buffer_corrupted,
                    }
                },
                "accounts": {
                    "meta_account": {
                        "address": meta_account.to_string(),
                        "exists": meta_status.exists,
                        "is_program": meta_status.is_program,
                        "data_size": meta_status.data_size,
                        "owner": meta_status.owner,
                    },
                    "buffer_account": {
                        "address": buffer_account.to_string(),
                        "exists": buffer_status.exists,
                        "is_program": buffer_status.is_program,
                        "data_size": buffer_status.data_size,
                        "owner": buffer_status.owner,
                    }
                }
            }
        });
        output::print_output(response, true);
    } else {
        println!("Uploader Status for seed: {}", seed);
        println!("Uploader program: {}", uploader_program_pubkey);
        println!();

        println!("Accounts:");
        print_account_status("  Meta Account", &meta_account.to_string(), &meta_status);
        print_account_status("  Buffer Account", &buffer_account.to_string(), &buffer_status);
        println!();

        println!("Summary:");
        if upload_complete {
            println!("  Upload exists with {} bytes in buffer", buffer_status.data_size);
        } else if any_corrupted {
            println!("  CORRUPTED STATE DETECTED - accounts exist but have no data:");
            if meta_corrupted {
                println!("    - Meta account (0 bytes)");
            }
            if buffer_corrupted {
                println!("    - Buffer account (0 bytes)");
            }
            println!();
            println!("  To fix, clean up corrupted accounts:");
            println!("    thru-cli uploader cleanup {}", seed);
        } else if meta_status.exists && !buffer_status.exists {
            println!("  Meta account exists but buffer account missing (PARTIAL STATE)");
            println!("  Consider cleaning up: thru-cli uploader cleanup {}", seed);
        } else if !meta_status.exists && !buffer_status.exists {
            println!("  No upload found for this seed");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // use tempfile::NamedTempFile;
    // use std::io::Write;

    #[tokio::test]
    async fn test_upload_program_file_not_found() {
        let config = Config::default();
        let result =
            upload_program(&config, None, "test_seed", "nonexistent_file.bin", 30720, false).await;
        assert!(result.is_err());
    }
}
