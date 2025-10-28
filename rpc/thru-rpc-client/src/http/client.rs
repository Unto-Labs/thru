//! HTTP client implementation

use base64::{Engine as _, engine::general_purpose};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::{sleep, timeout};

use crate::Account;
use crate::client::ClientConfig;
use crate::error::{HttpError, Result, SerializationError, ThruError, ValidationError};
use crate::types::account::{
    AccountInfoResponse, GetProgramAccountsResponse, MultipleAccountsResponse,
};
use crate::types::{AccountInfoConfig, BlockHeight, TransactionDetails, Version};
use thru_base::rpc_types::GetProgramAccountsConfig;
use thru_base::tn_tools::{Pubkey, Signature};

/// JSON-RPC request structure
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    params: Option<Value>,
}

/// JSON-RPC response structure
#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: u64,
    result: Option<T>,
    error: Option<JsonRpcError>,
}

/// JSON-RPC error structure
#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    data: Option<Value>,
}

/// HTTP client for RPC requests
#[derive(Clone, Debug)]
pub struct HttpClient {
    client: Client,
    config: ClientConfig,
    request_id: Arc<AtomicU64>,
}

impl HttpClient {
    /// Create a new HTTP client
    pub fn new(config: ClientConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(config.timeout)
            .zstd(true)
            .pool_max_idle_per_host(config.max_connections)
            .build()
            .map_err(|e| HttpError::RequestBuilder(e))?;

        Ok(Self {
            client,
            config,
            request_id: Arc::new(AtomicU64::new(1)),
        })
    }

    /// Get the next request ID
    fn next_request_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }

    /// Send a JSON-RPC request
    async fn send_request<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<T> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_request_id(),
            method: method.to_string(),
            params,
        };
        tracing::trace!("request: {:?}", request);

        let mut request_builder = self
            .client
            .post(self.config.http_endpoint.as_str())
            .json(&request);

        // Add authorization header if auth_token is configured
        if let Some(ref token) = self.config.auth_token {
            request_builder = request_builder.bearer_auth(token);
        }

        let response = request_builder
            .send()
            .await
            .map_err(|e| HttpError::RequestBuilder(e))?;

        let status = response.status();
        if !status.is_success() {
            let _body = response.text().await.ok();
            return Err(HttpError::RequestFailed {
                status: status.as_u16(),
                message: format!("HTTP {} error", status),
                source: None,
            }
            .into());
        }

        let body = response
            .text()
            .await
            .map_err(|e| HttpError::ResponseParsing {
                source: e,
                body: None,
            })?;

        tracing::trace!("response: {:?}", body);

        let rpc_response: JsonRpcResponse<T> =
            serde_json::from_str(&body).map_err(|e| SerializationError::JsonDeserialize {
                source: e,
                data: body.clone(),
            })?;

        if let Some(error) = rpc_response.error {
            return Err(HttpError::from_rpc_error(error.code, error.message, error.data).into());
        }

        rpc_response.result.ok_or_else(|| {
            ThruError::Http(HttpError::RpcError {
                code: -32603,
                message: "Internal error: missing result".to_string(),
                data: None,
            })
        })
    }

    /// Send a single transaction via HTTP
    pub async fn send_transaction(&self, transaction: &[u8]) -> Result<Signature> {
        let signatures = self.send_transactions(&[transaction]).await?;
        Ok(signatures.into_iter().next().unwrap())
    }

    /// Send multiple transactions via HTTP
    pub async fn send_transactions(&self, transactions: &[&[u8]]) -> Result<Vec<Signature>> {
        if transactions.is_empty() {
            return Err(ThruError::Validation(ValidationError::InvalidTransaction(
                "At least one transaction is required".to_string(),
            )));
        }

        let encoded_transactions: Vec<String> = transactions
            .iter()
            .map(|tx| general_purpose::STANDARD.encode(tx))
            .collect();

        let params = json!(encoded_transactions);
        let response: Vec<String> = self.send_request("sendTransaction", Some(params)).await?;

        response
            .into_iter()
            .map(|sig_str| {
                Signature::new(sig_str).map_err(|e| {
                    ThruError::Validation(ValidationError::InvalidSignature(e.to_string()))
                })
            })
            .collect::<Result<Vec<_>>>()
    }

    /// Execute a transaction and wait for completion
    ///
    /// This method sends a transaction and then polls for its completion using get_transaction_detailed.
    /// It will retry until the transaction is found or the timeout is reached.
    pub async fn execute_transaction(
        &self,
        transaction: &[u8],
        timeout_duration: Duration,
    ) -> Result<TransactionDetails> {
        // Send the transaction first
        let signature = self.send_transaction(transaction).await?;

        // Poll for transaction completion with timeout
        let poll_result = timeout(timeout_duration, async {
            const POLL_INTERVAL: Duration = Duration::from_millis(500);

            loop {
                match self.get_transaction_detailed(&signature).await {
                    Ok(Some(details)) => return Ok(details),
                    Ok(None) => {
                        // Transaction not found yet, continue polling
                        sleep(POLL_INTERVAL).await;
                        continue;
                    }
                    Err(ThruError::Http(HttpError::RpcError { code, .. })) if code == -32602 => {
                        // Transaction not found (RPC error -32602), continue polling
                        sleep(POLL_INTERVAL).await;
                        continue;
                    }
                    Err(e) => return Err(e), // Other errors should be propagated
                }
            }
        })
        .await;

        match poll_result {
            Ok(result) => result,
            Err(_) => Err(ThruError::Http(HttpError::RequestFailed {
                status: 408,
                message: format!(
                    "Transaction {} did not complete within {} seconds",
                    signature.as_str(),
                    timeout_duration.as_secs()
                ),
                source: None,
            })),
        }
    }

    /// Get account balance
    pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        let params = json!([pubkey.as_str()]);

        #[derive(Deserialize)]
        struct BalanceResponse {
            #[allow(dead_code)]
            context: Context,
            value: u64,
        }

        #[derive(Deserialize)]
        struct Context {
            #[allow(dead_code)]
            slot: u64,
        }

        let response: BalanceResponse = self.send_request("getBalance", Some(params)).await?;
        Ok(response.value)
    }

    /// Get account information
    pub async fn get_account_info(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<Option<Account>> {
        return Ok(self
            .get_account_info_with_conext(pubkey, config)
            .await?
            .value);
    }

    /// Get account information with context
    pub async fn get_account_info_with_conext(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<AccountInfoResponse> {
        let params = if let Some(config) = config {
            json!([pubkey.as_str(), config])
        } else {
            json!([pubkey.as_str()])
        };

        let response: AccountInfoResponse =
            self.send_request("getAccountInfo", Some(params)).await?;
        Ok(response)
    }

    /// Get multiple accounts information (simplified API)
    pub async fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
        config: Option<AccountInfoConfig>,
    ) -> Result<Vec<Option<Account>>> {
        return Ok(self
            .get_multiple_accounts_with_context(pubkeys, config)
            .await?
            .value);
    }

    /// Get multiple accounts information with context
    pub async fn get_multiple_accounts_with_context(
        &self,
        pubkeys: &[Pubkey],
        config: Option<AccountInfoConfig>,
    ) -> Result<MultipleAccountsResponse> {
        // Convert pubkeys to string array
        let pubkey_strings: Vec<String> =
            pubkeys.iter().map(|pk| pk.as_str().to_string()).collect();

        let params = if let Some(config) = config {
            json!([pubkey_strings, config])
        } else {
            json!([pubkey_strings])
        };

        let response: MultipleAccountsResponse = self
            .send_request("getMultipleAccounts", Some(params))
            .await?;
        Ok(response)
    }

    /// Get program accounts
    pub async fn get_program_accounts(
        &self,
        program_id: &Pubkey,
        config: Option<GetProgramAccountsConfig>,
    ) -> Result<GetProgramAccountsResponse> {
        let params = if let Some(config) = config {
            json!([program_id.as_str(), config])
        } else {
            json!([program_id.as_str()])
        };

        self.send_request("getProgramAccounts", Some(params)).await
    }

    /// Get raw transaction data
    pub async fn get_transaction_raw(&self, signature: &Signature) -> Result<Option<Vec<u8>>> {
        let params = json!([signature.as_str()]);

        let response: Option<String> = self.send_request("getTransactionRaw", Some(params)).await?;

        match response {
            Some(encoded) => {
                let decoded = general_purpose::STANDARD
                    .decode(&encoded)
                    .map_err(|e| SerializationError::Base64Decode(e.to_string()))?;
                Ok(Some(decoded))
            }
            None => Ok(None),
        }
    }

    /// Get detailed transaction information
    pub async fn get_transaction_detailed(
        &self,
        signature: &Signature,
    ) -> Result<Option<TransactionDetails>> {
        let params = json!([signature.as_str()]);

        let response: Option<TransactionDetails> = self
            .send_request("getTransactionDetailed", Some(params))
            .await?;
        Ok(response)
    }

    /// Get current block height
    pub async fn get_block_height(&self) -> Result<BlockHeight> {
        let response: BlockHeight = self.send_request("getBlockHeight", None).await?;
        Ok(response)
    }

    /// Get raw block data
    pub async fn get_block_raw(&self, slot: u64) -> Result<Option<Vec<u8>>> {
        let params = json!([slot]);

        let response: Option<String> = self.send_request("getBlockRaw", Some(params)).await?;
        tracing::info!("-----> response: {:?}", response);

        match response {
            Some(encoded) => {
                let decoded = general_purpose::STANDARD
                    .decode(&encoded)
                    .map_err(|e| SerializationError::Base64Decode(e.to_string()))?;
                Ok(Some(decoded))
            }
            None => Ok(None),
        }
    }

    /// Get version information
    pub async fn get_version(&self) -> Result<Version> {
        let response: Version = self.send_request("getVersion", None).await?;
        Ok(response)
    }

    /// Get health status
    pub async fn get_health(&self) -> Result<String> {
        let response: String = self.send_request("getHealth", None).await?;
        Ok(response)
    }

    /// Create a state proof for a given account
    pub async fn make_state_proof(
        &self,
        account_pubkey: &Pubkey,
        config: &thru_base::rpc_types::MakeStateProofConfig,
    ) -> Result<Vec<u8>> {
        let params = json!([account_pubkey.as_str(), config]);
        let response: String = self.send_request("makeStateProof", Some(params)).await?;

        // Decode the base64 response
        use base64::Engine as _;
        base64::prelude::BASE64_STANDARD
            .decode(response)
            .map_err(|e| ThruError::Serialization(SerializationError::Base64Decode(e.to_string())))
    }

    /// Prepare account decompression data and proof
    pub async fn prepare_account_decompression(
        &self,
        account_pubkey: &Pubkey,
    ) -> Result<crate::types::PrepareAccountDecompressionResponse> {
        let params = json!([account_pubkey.as_str()]);
        let response: crate::types::PrepareAccountDecompressionResponse = self
            .send_request("prepareAccountDecompression", Some(params))
            .await?;
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use url::Url;

    fn test_config() -> ClientConfig {
        ClientConfig {
            http_endpoint: Url::parse("http://localhost:3000").unwrap(),
            ws_endpoint: None,
            timeout: Duration::from_secs(30),
            max_connections: 100,
            ws_reconnect_attempts: 5,
            ws_reconnect_delay: Duration::from_secs(1),
            auth_token: None,
        }
    }

    #[test]
    fn test_http_client_creation() {
        let config = test_config();
        let client = HttpClient::new(config);
        assert!(client.is_ok());
    }

    #[test]
    fn test_request_id_generation() {
        let config = test_config();
        let client = HttpClient::new(config).unwrap();

        let id1 = client.next_request_id();
        let id2 = client.next_request_id();
        let id3 = client.next_request_id();

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }
}
