//! Main client implementation

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use url::Url;

use crate::Account;
use crate::http::HttpClient;
use crate::types::account::{
    AccountInfoResponse, GetProgramAccountsResponse, MultipleAccountsResponse,
};
use crate::websocket::WebSocketClient;
use crate::{AccountInfoConfig, error::Result};
use thru_base::rpc_types::GetProgramAccountsConfig;
use thru_base::tn_tools::{Pubkey, Signature};

/// Configuration for the Thru RPC client
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// HTTP endpoint for RPC calls
    pub http_endpoint: Url,
    /// WebSocket endpoint for subscriptions (optional)
    pub ws_endpoint: Option<Url>,
    /// Request timeout
    pub timeout: Duration,
    /// Maximum number of concurrent connections
    pub max_connections: usize,
    /// WebSocket reconnection attempts
    pub ws_reconnect_attempts: usize,
    /// Delay between WebSocket reconnection attempts
    pub ws_reconnect_delay: Duration,
    /// Optional authorization token for HTTP requests
    pub auth_token: Option<String>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            http_endpoint: Url::parse("http://localhost:3000").unwrap(),
            ws_endpoint: Some(Url::parse("ws://localhost:3001").unwrap()),
            timeout: Duration::from_secs(30),
            max_connections: 100,
            ws_reconnect_attempts: 5,
            ws_reconnect_delay: Duration::from_secs(1),
            auth_token: None,
        }
    }
}

/// Builder for creating a configured Thru RPC client
#[derive(Debug)]
pub struct ClientBuilder {
    config: ClientConfig,
}

impl ClientBuilder {
    /// Create a new client builder
    pub fn new() -> Self {
        Self {
            config: ClientConfig::default(),
        }
    }

    /// Set the HTTP endpoint
    pub fn http_endpoint(mut self, url: Url) -> Self {
        self.config.http_endpoint = url;
        self
    }

    /// Set the WebSocket endpoint
    pub fn ws_endpoint(mut self, url: Option<Url>) -> Self {
        self.config.ws_endpoint = url;
        self
    }

    /// Set the request timeout
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = timeout;
        self
    }

    /// Set the maximum number of concurrent connections
    pub fn max_connections(mut self, max: usize) -> Self {
        self.config.max_connections = max;
        self
    }

    /// Set WebSocket reconnection attempts
    pub fn ws_reconnect_attempts(mut self, attempts: usize) -> Self {
        self.config.ws_reconnect_attempts = attempts;
        self
    }

    /// Set WebSocket reconnection delay
    pub fn ws_reconnect_delay(mut self, delay: Duration) -> Self {
        self.config.ws_reconnect_delay = delay;
        self
    }

    /// Set authorization token for HTTP requests
    pub fn auth_token(mut self, token: Option<String>) -> Self {
        self.config.auth_token = token;
        self
    }

    /// Build the client
    pub fn build(self) -> Client {
        Client::new(self.config)
    }
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Main Thru RPC client
#[derive(Clone, Debug)]
pub struct Client {
    config: ClientConfig,
    http_client: HttpClient,
    ws_client: Arc<RwLock<Option<WebSocketClient>>>,
}

impl Client {
    /// Create a new client with the given configuration
    pub fn new(config: ClientConfig) -> Self {
        tracing::info!("Creating new client with config: {:?}", config);
        let http_client = HttpClient::new(config.clone()).expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
            ws_client: Arc::new(RwLock::new(None)),
        }
    }

    /// Create a client builder
    pub fn builder() -> ClientBuilder {
        ClientBuilder::new()
    }

    /// Get the HTTP client
    pub fn http(&self) -> &HttpClient {
        &self.http_client
    }

    /// Get or create the WebSocket client (lazy initialization)
    pub async fn websocket(&self) -> Result<WebSocketClient> {
        // Check if we already have a WebSocket client and return it if available
        {
            let ws_client = self.ws_client.read().await;
            if let Some(client) = ws_client.as_ref() {
                return Ok(client.clone());
            }
        }

        // Store it for future use, but check again in case another task created one
        let mut ws_client_guard = self.ws_client.write().await;
        if let Some(existing_client) = ws_client_guard.as_ref() {
            // Another task created a client while we were creating ours
            return Ok(existing_client.clone());
        }
        // Create new WebSocket client
        let ws_client = WebSocketClient::new(self.config.clone()).await?;
        *ws_client_guard = Some(ws_client.clone());
        return Ok(ws_client);
    }

    /// Check if WebSocket client is available
    pub async fn has_websocket(&self) -> bool {
        self.ws_client.read().await.is_some()
    }

    /// Close WebSocket connection
    pub async fn close_websocket(&self) {
        let mut ws_client = self.ws_client.write().await;
        *ws_client = None;
    }

    /// Check if WebSocket client is connected
    pub async fn is_websocket_connected(&self) -> bool {
        self.has_websocket().await
    }

    /// Get the client configuration
    pub fn get_config(&self) -> &ClientConfig {
        &self.config
    }
}

// Re-export HTTP methods for convenience
impl Client {
    /// Send a single transaction
    pub async fn send_transaction(&self, transaction: &[u8]) -> Result<Signature> {
        self.http_client.send_transaction(transaction).await
    }

    /// Execute a transaction and wait for completion
    pub async fn execute_transaction(
        &self,
        transaction: &[u8],
        timeout_duration: std::time::Duration,
    ) -> Result<crate::types::TransactionDetails> {
        self.http_client
            .execute_transaction(transaction, timeout_duration)
            .await
    }

    /// Send multiple transactions
    pub async fn send_transactions(&self, transactions: &[&[u8]]) -> Result<Vec<Signature>> {
        self.http_client.send_transactions(transactions).await
    }

    /// Get account balance
    pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        self.http_client.get_balance(pubkey).await
    }

    /// Get account information
    pub async fn get_account_info(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<Option<Account>> {
        self.http_client.get_account_info(pubkey, config).await
    }

    /// Get account information
    pub async fn get_account_info_with_context(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<AccountInfoResponse> {
        self.http_client
            .get_account_info_with_conext(pubkey, config)
            .await
    }

    /// Get multiple accounts information (simplified API)
    pub async fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
        config: Option<AccountInfoConfig>,
    ) -> Result<Vec<Option<Account>>> {
        self.http_client
            .get_multiple_accounts(pubkeys, config)
            .await
    }

    /// Get multiple accounts information with context
    pub async fn get_multiple_accounts_with_context(
        &self,
        pubkeys: &[Pubkey],
        config: Option<AccountInfoConfig>,
    ) -> Result<MultipleAccountsResponse> {
        self.http_client
            .get_multiple_accounts_with_context(pubkeys, config)
            .await
    }

    /// Get program accounts
    pub async fn get_program_accounts(
        &self,
        program_id: &Pubkey,
        config: Option<GetProgramAccountsConfig>,
    ) -> Result<GetProgramAccountsResponse> {
        self.http_client
            .get_program_accounts(program_id, config)
            .await
    }

    /// Get raw transaction
    pub async fn get_transaction_raw(&self, signature: &Signature) -> Result<Option<Vec<u8>>> {
        self.http_client.get_transaction_raw(signature).await
    }

    /// Get detailed transaction
    pub async fn get_transaction_detailed(
        &self,
        signature: &Signature,
    ) -> Result<Option<crate::types::TransactionDetails>> {
        self.http_client.get_transaction_detailed(signature).await
    }

    /// Get current block height
    pub async fn get_block_height(&self) -> Result<crate::types::BlockHeight> {
        self.http_client.get_block_height().await
    }

    /// Get raw block data
    pub async fn get_block_raw(&self, slot: u64) -> Result<Option<Vec<u8>>> {
        self.http_client.get_block_raw(slot).await
    }

    /// Get version information
    pub async fn get_version(&self) -> Result<crate::types::Version> {
        self.http_client.get_version().await
    }

    /// Get health status
    pub async fn get_health(&self) -> Result<String> {
        self.http_client.get_health().await
    }

    /// Create a state proof for a given account
    pub async fn make_state_proof(
        &self,
        account_pubkey: &Pubkey,
        config: &thru_base::rpc_types::MakeStateProofConfig,
    ) -> Result<Vec<u8>> {
        self.http_client
            .make_state_proof(account_pubkey, config)
            .await
    }

    /// Prepare account decompression data and proof
    pub async fn prepare_account_decompression(
        &self,
        account_pubkey: &Pubkey,
    ) -> Result<crate::types::PrepareAccountDecompressionResponse> {
        self.http_client
            .prepare_account_decompression(account_pubkey)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_builder() {
        let client = Client::builder()
            .http_endpoint(Url::parse("http://example.com:8080").unwrap())
            .ws_endpoint(Some(Url::parse("ws://example.com:8081").unwrap()))
            .timeout(Duration::from_secs(60))
            .max_connections(200)
            .ws_reconnect_attempts(10)
            .ws_reconnect_delay(Duration::from_secs(2))
            .build();

        assert_eq!(
            client.config.http_endpoint.as_str(),
            "http://example.com:8080/"
        );
        assert_eq!(
            client.config.ws_endpoint.as_ref().unwrap().as_str(),
            "ws://example.com:8081/"
        );
        assert_eq!(client.config.timeout, Duration::from_secs(60));
        assert_eq!(client.config.max_connections, 200);
        assert_eq!(client.config.ws_reconnect_attempts, 10);
        assert_eq!(client.config.ws_reconnect_delay, Duration::from_secs(2));
    }

    #[test]
    fn test_default_config() {
        let config = ClientConfig::default();
        assert_eq!(config.http_endpoint.as_str(), "http://localhost:3000/");
        assert_eq!(
            config.ws_endpoint.as_ref().unwrap().as_str(),
            "ws://localhost:3001/"
        );
        assert_eq!(config.timeout, Duration::from_secs(30));
        assert_eq!(config.max_connections, 100);
        assert_eq!(config.ws_reconnect_attempts, 5);
        assert_eq!(config.ws_reconnect_delay, Duration::from_secs(1));
    }

    #[tokio::test]
    async fn test_websocket_lazy_initialization() {
        let client = Client::builder().build();

        // Initially no WebSocket client
        assert!(!client.has_websocket().await);

        // This would fail in tests since we don't have a real WebSocket server
        // but it demonstrates the lazy initialization pattern
        // let _ws_client = client.websocket().await;
    }
}
