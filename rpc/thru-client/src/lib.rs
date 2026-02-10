//! High-level gRPC client library for the Thru blockchain
//!
//! This crate provides a convenient wrapper around the low-level `thru-grpc-client`
//! generated code, offering a more ergonomic API for interacting with Thru nodes.
//!
//! # Example
//!
//! ```no_run
//! use thru_client::{Client, ClientBuilder};
//! use thru_base::tn_tools::Pubkey;
//! use std::time::Duration;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let client = ClientBuilder::new()
//!     .http_endpoint(url::Url::parse("http://127.0.0.1:8472")?)
//!     .timeout(Duration::from_secs(30))
//!     .build()?;
//!
//! let height = client.get_block_height().await?;
//! println!("Current height: {}", height.finalized_height);
//! # Ok(())
//! # }
//! ```

pub mod error;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose};
use prost_types::Duration as ProstDuration;
use tokio::time;
use tonic::{
    Request,
    metadata::MetadataValue,
    transport::{Channel, ClientTlsConfig, Endpoint},
};
use tonic_health::pb::{HealthCheckRequest, HealthCheckResponse, health_client::HealthClient};

use std::convert::TryFrom;

use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::{Pubkey, Signature};
use thru_grpc_client::thru::{
    common::v1 as commonv1,
    core::v1 as corev1,
    services::v1::{
        self as servicesv1, command_service_client::CommandServiceClient,
        query_service_client::QueryServiceClient, streaming_service_client::StreamingServiceClient,
    },
};

pub use error::ClientError;

/* Convenience type alias for Result */
pub type Result<T> = std::result::Result<T, ClientError>;

const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Builder used to construct a gRPC client with configuration.
#[derive(Debug, Clone)]
pub struct ClientBuilder {
    endpoint: Endpoint,
    timeout: Duration,
    auth_token: Option<String>,
}

impl ClientBuilder {
    /// Create a new builder with default settings.
    pub fn new() -> Self {
        let default_endpoint =
            Endpoint::from_static("http://127.0.0.1:8472")
                .timeout(Duration::from_secs(30));
        Self {
            endpoint: default_endpoint,
            timeout: Duration::from_secs(30),
            auth_token: None,
        }
    }

    /// Set the HTTP (gRPC) endpoint.
    pub fn http_endpoint(mut self, url: url::Url) -> Self {
        let mut endpoint = Endpoint::from_shared(url.to_string())
            .expect("invalid gRPC endpoint URL provided to ClientBuilder");
        endpoint = endpoint.timeout(self.timeout);
        
        // Enable TLS for HTTPS URLs
        if url.scheme() == "https" {
            let tls_config = ClientTlsConfig::new()
                .with_enabled_roots();
            endpoint = endpoint.tls_config(tls_config)
                .expect("failed to configure TLS for HTTPS endpoint");
        }
        
        self.endpoint = endpoint;
        self
    }

    /// Set the request timeout.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self.endpoint = self.endpoint.clone().timeout(timeout);
        self
    }

    /// Set the optional authorization token.
    pub fn auth_token(mut self, token: Option<String>) -> Self {
        self.auth_token = token;
        self
    }

    /// Build the client.
    pub fn build(self) -> Result<Client> {
        let channel = self.endpoint.connect_lazy();

        let auth_header =
            match self.auth_token {
                Some(token) => {
                    let header_value = format!("Bearer {}", token);
                    Some(MetadataValue::try_from(header_value).map_err(|e| {
                        ClientError::Validation(format!("invalid auth token: {}", e))
                    })?)
                }
                None => None,
            };

        Ok(Client {
            channel,
            timeout: self.timeout,
            auth_header,
        })
    }
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// High-level gRPC client for the Thru blockchain.
pub struct Client {
    channel: Channel,
    timeout: Duration,
    auth_header: Option<MetadataValue<tonic::metadata::Ascii>>,
}

impl Client {
    /// Start building a new client.
    pub fn builder() -> ClientBuilder {
        ClientBuilder::new()
    }

    /// Get full account information for a given public key.
    ///
    /// # Arguments
    /// * `pubkey` - The public key of the account
    /// * `view` - Account view type (defaults to Full if None)
    /// * `version_context` - Version context for the query (defaults to CurrentOrHistorical if None)
    pub async fn get_account_info(
        &self,
        pubkey: &Pubkey,
        view: Option<AccountView>,
        version_context: Option<VersionContext>,
    ) -> Result<Option<Account>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let pubkey_bytes = pubkey_bytes(pubkey)?;

        let view_value = view.unwrap_or(AccountView::Full);
        let version_ctx = version_context.unwrap_or(VersionContext::CurrentOrHistorical);

        let request = servicesv1::GetAccountRequest {
            address: Some(commonv1::Pubkey {
                value: pubkey_bytes.to_vec(),
            }),
            view: Some(view_value.to_proto() as i32),
            version_context: Some(version_ctx.to_proto()),
            data_slice: None,
            ..Default::default()
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        match client.get_account(grpc_request).await {
            Ok(response) => {
                let account = response.into_inner();
                Ok(Some(Account::from_proto(account)?))
            }
            Err(status) if status.code() == tonic::Code::NotFound => Ok(None),
            Err(status) => Err(ClientError::Rpc(status.to_string())),
        }
    }

    /// Get the balance for a given public key.
    pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        match self.get_account_info(pubkey, None, None).await? {
            Some(account) => Ok(account.balance),
            None => Err(ClientError::AccountNotFound(pubkey.to_string())),
        }
    }

    /// Get account information at a specific slot.
    ///
    /// This queries historical account state from the ClickHouse database.
    /// Returns the account state as it was at the beginning of the specified slot.
    pub async fn get_account_at_slot(
        &self,
        pubkey: &Pubkey,
        slot: u64,
    ) -> Result<Option<Account>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024)
            .max_encoding_message_size(128 * 1024 * 1024);
        let pubkey_bytes = pubkey_bytes(pubkey)?;

        let request = servicesv1::GetAccountRequest {
            address: Some(commonv1::Pubkey {
                value: pubkey_bytes.to_vec(),
            }),
            view: Some(corev1::AccountView::Full as i32),
            version_context: Some(slot_version_context(slot)),
            data_slice: None,
            ..Default::default()
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        match client.get_account(grpc_request).await {
            Ok(response) => {
                let account = response.into_inner();
                Ok(Some(Account::from_proto(account)?))
            }
            Err(status) if status.code() == tonic::Code::NotFound => Ok(None),
            Err(status) => Err(ClientError::Rpc(status.to_string())),
        }
    }

    /// Get version information from the node.
    pub async fn get_version(&self) -> Result<HashMap<String, String>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let mut request = Request::new(servicesv1::GetVersionRequest {});
        self.apply_metadata(&mut request);
        request.set_timeout(self.timeout);

        let response = client.get_version(request).await?;
        Ok(response.into_inner().versions)
    }

    /// Get chain information including chain ID.
    pub async fn get_chain_info(&self) -> Result<ChainInfo> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let mut request = Request::new(servicesv1::GetChainInfoRequest {});
        self.apply_metadata(&mut request);
        request.set_timeout(self.timeout);

        let response = client.get_chain_info(request).await?;
        let message = response.into_inner();
        Ok(ChainInfo {
            chain_id: message.chain_id as u16,
        })
    }

    /// Get health information from the node.
    pub async fn get_health(&self) -> Result<HealthCheckResponse> {
        let mut client = HealthClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let mut request = Request::new(HealthCheckRequest {
            service: String::new(),
        });
        self.apply_metadata(&mut request);
        request.set_timeout(self.timeout);

        let response = client.check(request).await?;
        Ok(response.into_inner())
    }

    /// Get the current block heights.
    pub async fn get_block_height(&self) -> Result<BlockHeight> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let mut grpc_request = Request::new(servicesv1::GetHeightRequest {});
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.get_height(grpc_request).await?;
        let message = response.into_inner();
        Ok(BlockHeight {
            finalized_height: message.finalized,
            executed_height: message.locally_executed,
            locally_executed_height: message.locally_executed,
            cluster_executed_height: message.cluster_executed,
        })
    }

    /// List transactions that involve the specified account.
    pub async fn list_transactions_for_account(
        &self,
        account: &Pubkey,
        page_size: Option<u32>,
        page_token: Option<String>,
    ) -> Result<AccountTransactionsPage> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let pubkey_bytes = pubkey_bytes(account)?;

        let has_token = page_token
            .as_ref()
            .map(|token| !token.is_empty())
            .unwrap_or(false);
        let page = if page_size.is_some() || has_token {
            Some(commonv1::PageRequest {
                page_size: Some(page_size.unwrap_or(0)),
                page_token: Some(page_token.unwrap_or_default()),
                order_by: Some(String::new()),
            })
        } else {
            None
        };

        let request = servicesv1::ListTransactionsForAccountRequest {
            account: Some(commonv1::Pubkey {
                value: pubkey_bytes.to_vec(),
            }),
            page,
            filter: None,
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.list_transactions_for_account(grpc_request).await?;
        let message = response.into_inner();

        let mut signatures = Vec::with_capacity(message.transactions.len());
        for txn in message.transactions {
            if let Some(sig) = txn.signature {
                let sig_bytes =
                    array_from_vec::<64>(sig.value, "signature").map_err(ClientError::Rpc)?;
                signatures.push(signature_from_bytes(&sig_bytes)?);
            }
        }

        let next_page_token = message.page.and_then(|page| {
            page.next_page_token.filter(|token| !token.is_empty())
        });

        Ok(AccountTransactionsPage {
            signatures,
            next_page_token,
        })
    }

    /// Get transaction details by signature.
    pub async fn get_transaction(
        &self,
        signature: &Signature,
        timeout: Duration,
        max_attempts: u32,
    ) -> Result<Option<TransactionDetails>> {
        let signature_bytes = signature
            .to_bytes()
            .map_err(|e| ClientError::Validation(format!("Invalid signature: {}", e)))?;

        let transaction_proto = self
            .fetch_transaction_details(&signature_bytes, timeout, max_attempts)
            .await?;

        if transaction_proto.is_none() {
            return Ok(None);
        }

        let transaction_proto = transaction_proto.unwrap();

        /* Extract header fields */
        let header = transaction_proto.header.as_ref()
            .ok_or_else(|| ClientError::Rpc("transaction missing header".into()))?;

        let fee_payer_sig_bytes = header.fee_payer_signature.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing fee_payer_signature".into()))?
            .value.clone();
        let fee_payer_signature = signature_from_bytes(
            &array_from_vec::<64>(fee_payer_sig_bytes, "fee_payer_signature")
                .map_err(ClientError::Validation)?
        )?;

        let fee_payer_pubkey_bytes = header.fee_payer_pubkey.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing fee_payer_pubkey".into()))?
            .value.clone();
        let fee_payer_pubkey = Pubkey::from_bytes(
            &array_from_vec::<32>(fee_payer_pubkey_bytes, "fee_payer_pubkey")
                .map_err(ClientError::Validation)?
        );

        let program_pubkey_bytes = header.program_pubkey.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing program_pubkey".into()))?
            .value.clone();
        let program_pubkey = Pubkey::from_bytes(
            &array_from_vec::<32>(program_pubkey_bytes, "program_pubkey")
                .map_err(ClientError::Validation)?
        );

        /* Extract execution result fields */
        let transaction_slot = transaction_proto.slot.unwrap_or(0);
        let execution_proto = transaction_proto.execution_result.clone();
        let execution = execution_proto.unwrap_or_default();

        let execution_result = execution.execution_result;
        let vm_error = execution.vm_error as i32;
        let user_error_code = execution.user_error_code;

        let rw_accounts = execution
            .readwrite_accounts
            .iter()
            .map(|pk| {
                let bytes =
                    array_from_vec::<32>(pk.value.clone(), "readwrite account").map_err(|e| {
                        ClientError::Validation(format!("invalid readwrite account pubkey: {}", e))
                    })?;
                Ok(Pubkey::from_bytes(&bytes))
            })
            .collect::<Result<Vec<_>>>()?;

        let ro_accounts = execution
            .readonly_accounts
            .iter()
            .map(|pk| {
                let bytes =
                    array_from_vec::<32>(pk.value.clone(), "readonly account").map_err(|e| {
                        ClientError::Validation(format!("invalid readonly account pubkey: {}", e))
                    })?;
                Ok(Pubkey::from_bytes(&bytes))
            })
            .collect::<Result<Vec<_>>>()?;

        let events = execution
            .events
            .into_iter()
            .map(|event| {
                let program = event
                    .program
                    .and_then(|pk| array_from_vec::<32>(pk.value, "event program").ok())
                    .map(|bytes| Pubkey::from_bytes(&bytes));
                Event {
                    call_idx: event.call_idx,
                    program_idx: event.program_idx,
                    data: event.payload,
                    event_id: if event.event_id.is_empty() {
                        None
                    } else {
                        Some(event.event_id)
                    },
                    program,
                }
            })
            .collect::<Vec<_>>();

        Ok(Some(TransactionDetails {
            /* Execution result fields */
            compute_units_consumed: execution.consumed_compute_units as u64,
            memory_units_consumed: execution.consumed_memory_units,
            state_units_consumed: execution.consumed_state_units as u64,
            events_cnt: if execution.events_count != 0 {
                execution.events_count
            } else {
                events.len() as u32
            },
            events_sz: execution.events_size,
            execution_result,
            pages_used: execution.pages_used,
            user_error_code,
            vm_error,
            rw_accounts,
            ro_accounts,
            events,

            /* Transaction header fields */
            fee_payer_signature,
            version: header.version,
            flags: header.flags,
            readwrite_accounts_count: header.readwrite_accounts_count,
            readonly_accounts_count: header.readonly_accounts_count,
            instruction_data_size: header.instruction_data_size,
            requested_compute_units: header.requested_compute_units,
            requested_state_units: header.requested_state_units,
            requested_memory_units: header.requested_memory_units,
            expiry_after: header.expiry_after,
            fee: header.fee,
            nonce: header.nonce,
            start_slot: header.start_slot,
            fee_payer_pubkey,
            program_pubkey,

            /* Transaction metadata */
            signature: signature.clone(),
            body: transaction_proto.body,
            slot: transaction_slot,
            block_offset: transaction_proto.block_offset,

            /* Legacy field */
            proof_slot: transaction_slot,
        }))
    }

    /// Poll for a transaction that was just sent until it is fetched.
    /// Polls twice per second (every 500ms) until the transaction is found or timeout is reached.
    pub async fn track_transaction_polling(
        &self,
        signature: &[u8; 64],
        timeout: Duration,
    ) -> Result<TransactionDetails> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let deadline = Instant::now() + timeout;

        loop {
            if Instant::now() >= deadline {
                return Err(ClientError::TransactionVerification(
                    "Transaction not found within timeout".to_string(),
                ));
            }

            let request = servicesv1::GetTransactionRequest {
                signature: Some(commonv1::Signature {
                    value: signature.to_vec(),
                }),
                view: Some(corev1::TransactionView::Full as i32),
                version_context: Some(current_version_context()),
                min_consensus: Some(commonv1::ConsensusStatus::Included as i32),
            };

            let mut grpc_request = Request::new(request);
            self.apply_metadata(&mut grpc_request);
            grpc_request.set_timeout(self.timeout);

            match client.get_transaction(grpc_request).await {
                Ok(response) => {
                    let transaction_proto = response.into_inner();
                    if transaction_proto.slot.unwrap_or(0) != 0 {
                        return self.transaction_proto_to_details(transaction_proto, signature).await;
                    }
                }
                Err(status) => {
                    /* Only retry on NOT_FOUND errors; fail immediately on other errors */
                    if status.code() != tonic::Code::NotFound {
                        return Err(ClientError::Rpc(status.to_string()));
                    }
                    /* For NOT_FOUND, continue looping and retry */
                }
            }

            time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Submit a transaction and wait for execution or timeout.
    pub async fn execute_transaction(
        &self,
        transaction: &[u8],
        timeout: Duration,
    ) -> Result<TransactionDetails> {
        let signature_bytes = self.send_transaction(transaction).await?;
        self.track_transaction_polling(&signature_bytes, timeout).await
    }

    /// Generate a state proof using the gRPC service.
    pub async fn make_state_proof(
        &self,
        account_pubkey: &Pubkey,
        config: &MakeStateProofConfig,
    ) -> Result<Vec<u8>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let pubkey_bytes = pubkey_bytes(account_pubkey)?;
        let proof_type = match config.proof_type {
            ProofType::Creating => corev1::StateProofType::Creating,
            ProofType::Updating => corev1::StateProofType::Updating,
            ProofType::Existing => corev1::StateProofType::Existing,
        } as i32;

        let request = servicesv1::GenerateStateProofRequest {
            request: Some(corev1::StateProofRequest {
                address: Some(commonv1::Pubkey {
                    value: pubkey_bytes.to_vec(),
                }),
                proof_type,
                target_slot: Some(config.slot.unwrap_or(0)),
            }),
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.generate_state_proof(grpc_request).await?;
        let proof_message = response.into_inner().proof.ok_or_else(|| {
            ClientError::TransactionSubmission("empty state proof response".into())
        })?;

        Ok(proof_message.proof)
    }

    /// Prepare account decompression by fetching raw account bytes and a state proof.
    pub async fn prepare_account_decompression(
        &self,
        account_pubkey: &Pubkey,
    ) -> Result<PrepareAccountDecompressionResponse> {
        let raw_account = self.get_raw_account(account_pubkey).await?;
        let mut account_data = raw_account.raw_meta.clone();
        if let Some(ref raw_data) = raw_account.raw_data {
            account_data.extend_from_slice(raw_data);
        }

        if account_data.is_empty() {
            return Err(ClientError::Validation(format!(
                "Account {} has no data to decompress",
                account_pubkey
            )));
        }

        let state_proof_bytes = self
            .make_state_proof(
                account_pubkey,
                &MakeStateProofConfig {
                    proof_type: ProofType::Existing,
                    slot: None,
                },
            )
            .await?;

        let account_data_b64 = general_purpose::STANDARD.encode(account_data);
        let state_proof_b64 = general_purpose::STANDARD.encode(&state_proof_bytes);

        Ok(PrepareAccountDecompressionResponse {
            account_data: account_data_b64,
            state_proof: state_proof_b64,
        })
    }

    /// Get up to 257 state roots ending at the specified slot.
    ///
    /// Returns state roots for transaction replay and state proof verification.
    /// If slot is not specified, returns state roots ending at the latest available slot.
    /// Returns state roots in ascending slot order, from (slot - 256) to slot (inclusive).
    pub async fn get_state_roots(&self, slot: Option<u64>) -> Result<Vec<StateRootEntry>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024)
            .max_encoding_message_size(128 * 1024 * 1024);

        let request = servicesv1::GetStateRootsRequest { slot };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.get_state_roots(grpc_request).await?;
        let state_roots = response
            .into_inner()
            .state_roots
            .into_iter()
            .map(|entry| StateRootEntry {
                slot: entry.slot,
                state_root: entry.state_root,
            })
            .collect();

        Ok(state_roots)
    }

    /// Get slot-level metrics for a specific slot.
    ///
    /// Returns metrics including global state counters and collected fees for the specified slot.
    pub async fn get_slot_metrics(&self, slot: u64) -> Result<SlotMetrics> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024)
            .max_encoding_message_size(128 * 1024 * 1024);

        let request = servicesv1::GetSlotMetricsRequest { slot };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.get_slot_metrics(grpc_request).await?;
        let metrics = response.into_inner();

        Ok(SlotMetrics::from_proto(metrics))
    }

    /// List slot-level metrics for a range of slots.
    ///
    /// Returns metrics for slots in the range [start_slot, end_slot].
    /// If end_slot is not specified, only the start_slot metrics are returned.
    pub async fn list_slot_metrics(
        &self,
        start_slot: u64,
        end_slot: Option<u64>,
        limit: Option<u32>,
    ) -> Result<Vec<SlotMetrics>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024)
            .max_encoding_message_size(128 * 1024 * 1024);

        let request = servicesv1::ListSlotMetricsRequest {
            start_slot,
            end_slot,
            limit,
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.list_slot_metrics(grpc_request).await?;
        let metrics = response
            .into_inner()
            .metrics
            .into_iter()
            .map(SlotMetrics::from_proto)
            .collect();

        Ok(metrics)
    }

    fn apply_metadata<T>(&self, request: &mut Request<T>) {
        if let Some(header) = &self.auth_header {
            request
                .metadata_mut()
                .insert("authorization", header.clone());
        }
    }

    async fn send_transaction(&self, transaction: &[u8]) -> Result<[u8; 64]> {
        let mut client = CommandServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let mut grpc_request = Request::new(servicesv1::SendTransactionRequest {
            raw_transaction: transaction.to_vec(),
        });
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.send_transaction(grpc_request).await?;
        let signature = response.into_inner().signature.ok_or_else(|| {
            ClientError::TransactionSubmission("missing signature in response".into())
        })?;
        let signature_bytes =
            array_from_vec(signature.value, "signature").map_err(ClientError::Validation)?;
        Ok(signature_bytes)
    }

    async fn track_transaction(
        &self,
        signature: &[u8; 64],
        timeout: Duration,
    ) -> Result<servicesv1::TrackTransactionResponse> {
        let mut client = StreamingServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let request = servicesv1::TrackTransactionRequest {
            signature: Some(commonv1::Signature {
                value: signature.to_vec(),
            }),
            timeout: Some(ProstDuration {
                seconds: timeout.as_secs() as i64,
                nanos: timeout.subsec_nanos() as i32,
            }),
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout + timeout);

        let mut stream = client.track_transaction(grpc_request).await?.into_inner();
        let deadline = Instant::now() + timeout;

        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let next = time::timeout(remaining, stream.message()).await;

            match next {
                Ok(Ok(Some(message))) => {
                    if let Some(execution) = &message.execution_result {
                        if execution.execution_result != 0 || execution.vm_error != 0 {
                            return Ok(message);
                        }
                    }

                    if is_confirmed(message.consensus_status) {
                        return Ok(message);
                    }
                }
                Ok(Ok(None)) => break,
                Ok(Err(status)) => return Err(ClientError::Rpc(status.to_string())),
                Err(_) => break,
            }
        }

        Err(ClientError::TransactionVerification(
            "Transaction confirmation timed out".to_string(),
        ))
    }

    async fn fetch_transaction_details(
        &self,
        signature: &[u8; 64],
        timeout: Duration,
        max_attempts: u32,
    ) -> Result<Option<corev1::Transaction>> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let deadline = Instant::now() + timeout;

        for _ in 0..max_attempts {
            if Instant::now() >= deadline {
                break;
            }

            let request = servicesv1::GetTransactionRequest {
                signature: Some(commonv1::Signature {
                    value: signature.to_vec(),
                }),
                view: Some(corev1::TransactionView::Full as i32),
                version_context: Some(current_version_context()),
                min_consensus: Some(commonv1::ConsensusStatus::Included as i32),
            };

            let mut grpc_request = Request::new(request);
            self.apply_metadata(&mut grpc_request);
            grpc_request.set_timeout(self.timeout);

            match client.get_transaction(grpc_request).await {
                Ok(response) => {
                    let transaction = response.into_inner();
                    if transaction.slot.unwrap_or(0) != 0 {
                        return Ok(Some(transaction));
                    }
                }

                Err(status) => {
                    /* Only retry on NOT_FOUND errors; fail immediately on other errors */
                    if status.code() != tonic::Code::NotFound {
                        return Err(ClientError::Rpc(status.to_string()));
                    }
                    /* For NOT_FOUND, continue looping and retry */
                }
            }

            time::sleep(POLL_INTERVAL).await;
        }

        Ok(None)
    }

    async fn transaction_proto_to_details(
        &self,
        transaction_proto: corev1::Transaction,
        signature_bytes: &[u8; 64],
    ) -> Result<TransactionDetails> {
        let signature = signature_from_bytes(signature_bytes)?;

        /* Extract header fields */
        let header = transaction_proto.header.as_ref()
            .ok_or_else(|| ClientError::Rpc("transaction missing header".into()))?;

        let fee_payer_sig_bytes = header.fee_payer_signature.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing fee_payer_signature".into()))?
            .value.clone();
        let fee_payer_signature = signature_from_bytes(
            &array_from_vec::<64>(fee_payer_sig_bytes, "fee_payer_signature")
                .map_err(ClientError::Validation)?
        )?;

        let fee_payer_pubkey_bytes = header.fee_payer_pubkey.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing fee_payer_pubkey".into()))?
            .value.clone();
        let fee_payer_pubkey = Pubkey::from_bytes(
            &array_from_vec::<32>(fee_payer_pubkey_bytes, "fee_payer_pubkey")
                .map_err(ClientError::Validation)?
        );

        let program_pubkey_bytes = header.program_pubkey.as_ref()
            .ok_or_else(|| ClientError::Rpc("header missing program_pubkey".into()))?
            .value.clone();
        let program_pubkey = Pubkey::from_bytes(
            &array_from_vec::<32>(program_pubkey_bytes, "program_pubkey")
                .map_err(ClientError::Validation)?
        );

        /* Extract execution result fields */
        let transaction_slot = transaction_proto.slot.unwrap_or(0);
        let execution_proto = transaction_proto.execution_result.clone();
        let execution = execution_proto.unwrap_or_default();

        let execution_result = execution.execution_result;
        let vm_error = execution.vm_error as i32;
        let user_error_code = execution.user_error_code;

        let rw_accounts = execution
            .readwrite_accounts
            .iter()
            .map(|pk| {
                let bytes =
                    array_from_vec::<32>(pk.value.clone(), "readwrite account").map_err(|e| {
                        ClientError::Validation(format!("invalid readwrite account pubkey: {}", e))
                    })?;
                Ok(Pubkey::from_bytes(&bytes))
            })
            .collect::<Result<Vec<_>>>()?;

        let ro_accounts = execution
            .readonly_accounts
            .iter()
            .map(|pk| {
                let bytes =
                    array_from_vec::<32>(pk.value.clone(), "readonly account").map_err(|e| {
                        ClientError::Validation(format!("invalid readonly account pubkey: {}", e))
                    })?;
                Ok(Pubkey::from_bytes(&bytes))
            })
            .collect::<Result<Vec<_>>>()?;

        let events = execution
            .events
            .into_iter()
            .map(|event| {
                let program = event
                    .program
                    .and_then(|pk| array_from_vec::<32>(pk.value, "event program").ok())
                    .map(|bytes| Pubkey::from_bytes(&bytes));
                Event {
                    call_idx: event.call_idx,
                    program_idx: event.program_idx,
                    data: event.payload,
                    event_id: if event.event_id.is_empty() {
                        None
                    } else {
                        Some(event.event_id)
                    },
                    program,
                }
            })
            .collect::<Vec<_>>();

        Ok(TransactionDetails {
            /* Execution result fields */
            compute_units_consumed: execution.consumed_compute_units as u64,
            memory_units_consumed: execution.consumed_memory_units,
            state_units_consumed: execution.consumed_state_units as u64,
            events_cnt: if execution.events_count != 0 {
                execution.events_count
            } else {
                events.len() as u32
            },
            events_sz: execution.events_size,
            execution_result,
            pages_used: execution.pages_used,
            user_error_code,
            vm_error,
            rw_accounts,
            ro_accounts,
            events,

            /* Transaction header fields */
            fee_payer_signature,
            version: header.version,
            flags: header.flags,
            readwrite_accounts_count: header.readwrite_accounts_count,
            readonly_accounts_count: header.readonly_accounts_count,
            instruction_data_size: header.instruction_data_size,
            requested_compute_units: header.requested_compute_units,
            requested_state_units: header.requested_state_units,
            requested_memory_units: header.requested_memory_units,
            expiry_after: header.expiry_after,
            fee: header.fee,
            nonce: header.nonce,
            start_slot: header.start_slot,
            fee_payer_pubkey,
            program_pubkey,

            /* Transaction metadata */
            signature,
            body: transaction_proto.body,
            slot: transaction_slot,
            block_offset: transaction_proto.block_offset,

            /* Legacy field */
            proof_slot: transaction_slot,
        })
    }

    async fn get_raw_account(&self, pubkey: &Pubkey) -> Result<corev1::RawAccount> {
        let mut client = QueryServiceClient::new(self.channel.clone())
            .max_decoding_message_size(128 * 1024 * 1024) /* 128 MB */
            .max_encoding_message_size(128 * 1024 * 1024); /* 128 MB */
        let pubkey_bytes = pubkey_bytes(pubkey)?;

        let request = servicesv1::GetRawAccountRequest {
            address: Some(commonv1::Pubkey {
                value: pubkey_bytes.to_vec(),
            }),
            view: Some(corev1::AccountView::Full as i32),
            version_context: Some(current_or_historical_version_context()),
            min_consensus: Some(commonv1::ConsensusStatus::Included as i32),
            ..Default::default()
        };

        let mut grpc_request = Request::new(request);
        self.apply_metadata(&mut grpc_request);
        grpc_request.set_timeout(self.timeout);

        let response = client.get_raw_account(grpc_request).await?;
        Ok(response.into_inner())
    }
}

/// Account view options for get_account_info
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AccountView {
    /// Full account data
    #[default]
    Full,
}

impl AccountView {
    fn to_proto(self) -> corev1::AccountView {
        match self {
            AccountView::Full => corev1::AccountView::Full,
        }
    }
}

/// Version context for queries
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VersionContext {
    /// Current version only
    Current,
    /// Current or historical version (default)
    #[default]
    CurrentOrHistorical,
}

impl VersionContext {
    fn to_proto(self) -> commonv1::VersionContext {
        match self {
            VersionContext::Current => commonv1::VersionContext {
                version: Some(commonv1::version_context::Version::Current(
                    commonv1::CurrentVersion {},
                )),
            },
            VersionContext::CurrentOrHistorical => commonv1::VersionContext {
                version: Some(commonv1::version_context::Version::CurrentOrHistorical(
                    commonv1::CurrentOrHistoricalVersion {},
                )),
            },
        }
    }
}

fn current_version_context() -> commonv1::VersionContext {
    commonv1::VersionContext {
        version: Some(commonv1::version_context::Version::Current(
            commonv1::CurrentVersion {},
        )),
    }
}

fn current_or_historical_version_context() -> commonv1::VersionContext {
    commonv1::VersionContext {
        version: Some(commonv1::version_context::Version::CurrentOrHistorical(
            commonv1::CurrentOrHistoricalVersion {},
        )),
    }
}

fn slot_version_context(slot: u64) -> commonv1::VersionContext {
    commonv1::VersionContext {
        version: Some(commonv1::version_context::Version::Slot(slot)),
    }
}

fn is_confirmed(consensus_status: i32) -> bool {
    match commonv1::ConsensusStatus::try_from(consensus_status) {
        Ok(commonv1::ConsensusStatus::LocallyExecuted)
        | Ok(commonv1::ConsensusStatus::ClusterExecuted)
        | Ok(commonv1::ConsensusStatus::Finalized) => true,
        _ => false,
    }
}

fn pubkey_bytes(pubkey: &Pubkey) -> Result<[u8; 32]> {
    pubkey
        .to_bytes()
        .map_err(|e| ClientError::Validation(format!("Invalid pubkey: {}", e)))
}

fn signature_from_bytes(bytes: &[u8; 64]) -> Result<Signature> {
    Ok(Signature::from_bytes(bytes))
}

fn array_from_vec<const N: usize>(
    value: Vec<u8>,
    label: &str,
) -> std::result::Result<[u8; N], String> {
    if value.len() != N {
        return Err(format!(
            "Expected {} bytes for {}, received {}",
            N,
            label,
            value.len()
        ));
    }
    let mut array = [0u8; N];
    array.copy_from_slice(&value);
    Ok(array)
}

/// Account information returned by the gRPC helper.
#[derive(Debug, Clone)]
pub struct Account {
    pub balance: u64,
    pub data: Option<String>,
    pub owner: Pubkey,
    pub program: bool,
    pub data_size: u64,
    pub nonce: u64,
    pub seq: u64,
    pub is_new: bool,
    pub is_ephemeral: bool,
    pub is_deleted: bool,
    pub is_privileged: bool,
    pub slot: Option<u64>,
    pub block_timestamp: Option<std::time::SystemTime>,
}

impl Account {
    fn from_proto(account: corev1::Account) -> Result<Self> {
        let meta = account
            .meta
            .ok_or_else(|| ClientError::Rpc("account missing metadata".into()))?;
        let owner_bytes = meta
            .owner
            .ok_or_else(|| ClientError::Rpc("account missing owner".into()))?
            .value;
        let owner_array = array_from_vec(owner_bytes, "owner")
            .map_err(|e| ClientError::Rpc(format!("invalid owner pubkey: {}", e)))?;
        let owner = Pubkey::from_bytes(&owner_array);

        let program = meta.flags.as_ref().map_or(false, |flags| flags.is_program);
        let is_new = meta.flags.as_ref().map_or(false, |flags| flags.is_new);
        let is_ephemeral = meta.flags.as_ref().map_or(false, |flags| flags.is_ephemeral);
        let is_deleted = meta.flags.as_ref().map_or(false, |flags| flags.is_deleted);
        let is_privileged = meta.flags.as_ref().map_or(false, |flags| flags.is_privileged);

        let data = account.data.and_then(|data| {
            data.data.and_then(|d| {
                if d.is_empty() {
                    None
                } else {
                    Some(general_purpose::STANDARD.encode(d))
                }
            })
        });

        let (slot, block_timestamp) = account
            .version_context
            .map(|vc| {
                let slot = vc.slot.filter(|&s| s != 0);
                let timestamp = vc.block_timestamp.and_then(|ts| ts.try_into().ok());
                (slot, timestamp)
            })
            .unwrap_or((None, None));

        Ok(Account {
            balance: meta.balance,
            data,
            owner,
            program,
            data_size: meta.data_size as u64,
            nonce: meta.nonce,
            seq: meta.seq,
            is_new,
            is_ephemeral,
            is_deleted,
            is_privileged,
            slot,
            block_timestamp,
        })
    }
}

/// Placeholder for account info configuration (retained for API compatibility).
#[derive(Debug, Clone, Default)]
pub struct AccountInfoConfig {}

/// Block height information mirroring the legacy JSON-RPC response.
#[derive(Debug, Clone)]
pub struct BlockHeight {
    pub finalized_height: u64,
    pub executed_height: u64,
    pub locally_executed_height: u64,
    pub cluster_executed_height: u64,
}

/// Chain information including chain ID.
#[derive(Debug, Clone)]
pub struct ChainInfo {
    /// Chain identifier, unique per network (similar to Ethereum chain ID).
    /// Used to prevent transaction replay across different chains.
    pub chain_id: u16,
}

/// State root entry for a specific slot.
#[derive(Debug, Clone)]
pub struct StateRootEntry {
    pub slot: u64,
    pub state_root: Vec<u8>,
}

/// Slot-level metrics including state counters and fees.
#[derive(Debug, Clone)]
pub struct SlotMetrics {
    pub slot: u64,
    pub global_activated_state_counter: u64,
    pub global_deactivated_state_counter: u64,
    pub collected_fees: u64,
    pub block_timestamp: Option<std::time::SystemTime>,
}

impl SlotMetrics {
    fn from_proto(proto: servicesv1::GetSlotMetricsResponse) -> Self {
        let block_timestamp = proto.block_timestamp.and_then(|ts| ts.try_into().ok());
        Self {
            slot: proto.slot,
            global_activated_state_counter: proto.global_activated_state_counter,
            global_deactivated_state_counter: proto.global_deactivated_state_counter,
            collected_fees: proto.collected_fees,
            block_timestamp,
        }
    }
}

/// Paginated transaction signatures for an account.
#[derive(Debug, Clone)]
pub struct AccountTransactionsPage {
    pub signatures: Vec<Signature>,
    pub next_page_token: Option<String>,
}

/// Transaction event placeholder (events are not yet exposed via gRPC).
#[derive(Debug, Clone)]
pub struct Event {
    pub call_idx: u32,
    pub program_idx: u32,
    pub data: Vec<u8>,
    pub event_id: Option<String>,
    pub program: Option<Pubkey>,
}

impl Default for Event {
    fn default() -> Self {
        Self {
            call_idx: 0,
            program_idx: 0,
            data: Vec::new(),
            event_id: None,
            program: None,
        }
    }
}

/// Transaction details populated from gRPC responses.
#[derive(Debug, Clone)]
pub struct TransactionDetails {
    /* Execution result fields */
    pub compute_units_consumed: u64,
    pub memory_units_consumed: u32,
    pub state_units_consumed: u64,
    pub events_cnt: u32,
    pub events_sz: u32,
    pub execution_result: u64,
    pub pages_used: u32,
    pub user_error_code: u64,
    pub vm_error: i32,
    pub rw_accounts: Vec<Pubkey>,
    pub ro_accounts: Vec<Pubkey>,
    pub events: Vec<Event>,

    /* Transaction header fields */
    pub fee_payer_signature: Signature,
    pub version: u32,
    pub flags: u32,
    pub readwrite_accounts_count: u32,
    pub readonly_accounts_count: u32,
    pub instruction_data_size: u32,
    pub requested_compute_units: u32,
    pub requested_state_units: u32,
    pub requested_memory_units: u32,
    pub expiry_after: u32,
    pub fee: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub fee_payer_pubkey: Pubkey,
    pub program_pubkey: Pubkey,

    /* Transaction metadata */
    pub signature: Signature,
    pub body: Option<Vec<u8>>,
    pub slot: u64,
    pub block_offset: Option<u32>,

    /* Legacy field */
    pub proof_slot: u64,
}

impl Default for TransactionDetails {
    fn default() -> Self {
        Self {
            compute_units_consumed: 0,
            memory_units_consumed: 0,
            state_units_consumed: 0,
            events_cnt: 0,
            events_sz: 0,
            execution_result: 0,
            pages_used: 0,
            user_error_code: 0,
            vm_error: 0,
            rw_accounts: Vec::new(),
            ro_accounts: Vec::new(),
            events: Vec::new(),
            fee_payer_signature: Signature::from_bytes(&[0u8; 64]),
            version: 0,
            flags: 0,
            readwrite_accounts_count: 0,
            readonly_accounts_count: 0,
            instruction_data_size: 0,
            requested_compute_units: 0,
            requested_state_units: 0,
            requested_memory_units: 0,
            expiry_after: 0,
            fee: 0,
            nonce: 0,
            start_slot: 0,
            fee_payer_pubkey: Pubkey::from_bytes(&[0u8; 32]),
            program_pubkey: Pubkey::from_bytes(&[0u8; 32]),
            signature: Signature::from_bytes(&[0u8; 64]),
            body: None,
            slot: 0,
            block_offset: None,
            proof_slot: 0,
        }
    }
}

/// Response containing base64-encoded account data and state proof.
#[derive(Debug, Clone)]
pub struct PrepareAccountDecompressionResponse {
    pub account_data: String,
    pub state_proof: String,
}

impl Default for PrepareAccountDecompressionResponse {
    fn default() -> Self {
        Self {
            account_data: String::new(),
            state_proof: String::new(),
        }
    }
}
