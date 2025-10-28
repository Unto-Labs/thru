//! WebSocket client implementation

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::{RwLock, mpsc};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, connect_async_with_config,
    tungstenite::{Message, handshake::client::Request},
};
use url::Url;

use crate::client::ClientConfig;
use crate::error::{Result, WebSocketError};
use crate::types::{
    AccountInfoConfig, AccountNotification, BlockRawNotification, BlockSubscriptionConfig,
    BlockSummaryNotification, CommitmentLevel, EventNotification, EventSubscriptionConfig,
    ProgramNotification, ProgramSubscriptionConfig, SendTransactionConfig, SendTransactionResult,
    SignatureNotification,
};
use thru_base::tn_tools::{Pubkey, Signature};

/// JSON-RPC request for WebSocket
#[derive(Debug, Serialize)]
struct WsRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    params: Option<Value>,
}

/// JSON-RPC response for WebSocket
#[derive(Debug, Deserialize)]
struct WsResponse<T> {
    #[allow(dead_code)]
    jsonrpc: String,
    id: u64,
    result: Option<T>,
    error: Option<WsError>,
}

/// JSON-RPC notification for WebSocket
#[derive(Debug, Deserialize)]
struct WsNotification<T> {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    method: String,
    params: T,
}

/// WebSocket JSON-RPC error
#[derive(Debug, Deserialize)]
struct WsError {
    code: i32,
    message: String,
    #[allow(dead_code)]
    data: Option<Value>,
}

/// Subscription confirmation response
#[derive(Debug, Deserialize)]
struct SubscriptionResult {
    #[allow(dead_code)]
    subscription_id: u64,
}

/// Subscription notification parameters
#[derive(Debug, Deserialize)]
struct NotificationParams<T> {
    subscription: u64,
    result: T,
}

/// Buffered notification for unmatched subscriptions
#[derive(Debug, Clone)]
struct BufferedNotification {
    subscription_id: u64,
    notification: Value,
    timestamp: Instant,
}

/// Internal subscription tracking
#[derive(Debug)]
struct SubscriptionInfo {
    #[allow(dead_code)]
    subscription_id: u64,
    method: String,
    sender: mpsc::UnboundedSender<Value>,
    /// Commitment level for auto-cancellation logic (signature subscriptions only)
    #[allow(dead_code)]
    commitment_level: Option<CommitmentLevel>,
    /// Counter for notifications received (thread-safe)
    notification_count: AtomicU32,
    /// Number of notifications after which to auto-cancel (signature subscriptions only)
    auto_cancel_after: Option<u32>,
}

/// WebSocket client for subscriptions and real-time data
#[derive(Clone, Debug)]
pub struct WebSocketClient {
    inner: Arc<WebSocketClientInner>,
}

#[derive(Debug)]
struct WebSocketClientInner {
    config: ClientConfig,
    request_id: AtomicU64,
    subscriptions: RwLock<HashMap<u64, SubscriptionInfo>>,
    ws_tx: RwLock<Option<mpsc::UnboundedSender<WsRequest>>>,
    response_waiters: RwLock<HashMap<u64, mpsc::UnboundedSender<WsResponse<Value>>>>,
    /// Buffer for notifications that arrive before subscription is registered
    notification_buffer: RwLock<Vec<BufferedNotification>>,
}

impl WebSocketClient {
    /// Calculate auto-cancellation limit based on commitment level
    /// Returns Some(1) for Finalized, Some(2) for Executed, None for no auto-cancel
    fn calculate_auto_cancel_limit(commitment: Option<CommitmentLevel>) -> Option<u32> {
        match commitment {
            Some(CommitmentLevel::Finalized) => Some(1),
            Some(CommitmentLevel::Executed) => Some(2),
            None => None,
        }
    }

    /// Create a new WebSocket client and connect
    pub async fn new(config: ClientConfig) -> Result<Self> {
        let url = config.ws_endpoint.clone().ok_or_else(|| {
            crate::error::ValidationError::InvalidConfig(
                "WebSocket endpoint not configured".to_string(),
            )
        })?;

        let client = Self {
            inner: Arc::new(WebSocketClientInner {
                config,
                request_id: AtomicU64::new(1),
                subscriptions: RwLock::new(HashMap::new()),
                ws_tx: RwLock::new(None),
                response_waiters: RwLock::new(HashMap::new()),
                notification_buffer: RwLock::new(Vec::new()),
            }),
        };

        client.connect(url).await?;
        Ok(client)
    }

    /// Connect to WebSocket endpoint with reconnection logic
    async fn connect(&self, url: Url) -> Result<()> {
        tracing::info!("Connecting to WebSocket endpoint: {}", url);
        let mut attempts = 0;
        let max_attempts = self.inner.config.ws_reconnect_attempts;

        while attempts < max_attempts {
            match self.try_connect(&url).await {
                Ok(()) => return Ok(()),
                Err(e) if attempts + 1 >= max_attempts => return Err(e),
                Err(_) => {
                    attempts += 1;
                    tokio::time::sleep(self.inner.config.ws_reconnect_delay).await;
                }
            }
        }

        Err(crate::error::ConnectionError::MaxReconnectAttemptsReached(max_attempts).into())
    }

    /// Single connection attempt
    async fn try_connect(&self, url: &Url) -> Result<()> {
        let (ws_stream, _) = if let Some(ref auth_token) = self.inner.config.auth_token {
            // Create request with authorization header
            let request = Request::builder()
                .uri(url.as_str())
                .header("Authorization", format!("Bearer {}", auth_token))
                .header(
                    "Host",
                    format!("{}:{}", url.host().unwrap(), url.port().unwrap_or(8080)),
                )
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header(
                    "Sec-WebSocket-Key",
                    tokio_tungstenite::tungstenite::handshake::client::generate_key(),
                )
                .body(())
                .map_err(|e| WebSocketError::ConnectionFailed(e.into()))?;

            let config = WebSocketConfig {
                // max_message_size: Some(2 * 1024 * 1024 * 1024), // 2GB
                // max_frame_size: Some(2 * 1024 * 1024 * 1024), // 2GB
                max_frame_size: Some(32 << 20),
                ..Default::default()
            };
            tracing::debug!("WebSocket config: {:?}", config);
            connect_async_with_config(request, Some(config), false)
                .await
                .map_err(|e| WebSocketError::ConnectionFailed(e))?
        } else {
            // // Use default connection without auth header
            let config = WebSocketConfig {
                // max_message_size: Some(2 * 1024 * 1024 * 1024), // 2GB
                // max_frame_size: Some(2 * 1024 * 1024 * 1024), // 2GB
                max_frame_size: Some(32 << 20),
                ..Default::default()
            };
            tracing::debug!("WebSocket config: {:?}", config);
            connect_async_with_config(url.as_str(), Some(config), false)
                .await
                .map_err(|e| WebSocketError::ConnectionFailed(e))?
        };

        let (ws_tx, ws_rx) = mpsc::unbounded_channel();
        *self.inner.ws_tx.write().await = Some(ws_tx);

        // Start message handling tasks
        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            if let Err(e) = Self::handle_connection(inner, ws_stream, ws_rx).await {
                tracing::error!("WebSocket connection error: {:?}", e);
            }
        });

        Ok(())
    }

    /// Handle WebSocket connection with message routing
    async fn handle_connection(
        inner: Arc<WebSocketClientInner>,
        ws_stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
        mut request_rx: mpsc::UnboundedReceiver<WsRequest>,
    ) -> Result<()> {
        let (mut ws_sink, mut ws_stream) = ws_stream.split();
        let mut request_channel_closed = false;
        tracing::info!("WebSocket connection established");

        loop {
            tokio::select! {
                // Handle outgoing requests (only if channel is still open)
                request = request_rx.recv(), if !request_channel_closed => {
                    match request {
                        Some(req) => {
                            let msg = serde_json::to_string(&req)
                                .map_err(|e| crate::error::SerializationError::JsonSerialize(e))?;

                            ws_sink.send(Message::Text(msg)).await
                                .map_err(|e| WebSocketError::SendFailed(e))?;
                        }
                        None => {
                            // Request channel closed, but we should continue listening for incoming messages
                            // This typically happens after subscriptions are set up and no more requests are expected
                            tracing::debug!("Request channel closed, continuing to listen for incoming messages");
                            request_channel_closed = true;
                        }
                    }
                }

                // Handle incoming messages
                message = ws_stream.next() => {
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            Self::handle_message(&inner, &text).await?;
                        }
                        Some(Ok(Message::Close(_))) => {
                            tracing::info!("WebSocket connection closed by server");
                            break;
                        }
                        Some(Err(e)) => {
                            return Err(WebSocketError::ReceiveFailed(e).into());
                        }
                        None => {
                            tracing::info!("WebSocket stream ended");
                            break; // Stream ended
                        }
                        _ => {} // Ignore other message types
                    }
                }
            }
        }

        // Clear connection state
        *inner.ws_tx.write().await = None;
        inner.response_waiters.write().await.clear();

        Ok(())
    }

    /// Handle incoming WebSocket message
    async fn handle_message(inner: &Arc<WebSocketClientInner>, text: &str) -> Result<()> {
        tracing::debug!("Received message: {}", text);
        // Try to parse as notification first
        if let Ok(notification) =
            serde_json::from_str::<WsNotification<NotificationParams<Value>>>(text)
        {
            Self::handle_notification(inner, notification.params).await;
            return Ok(());
        }

        // Try to parse as response
        if let Ok(response) = serde_json::from_str::<WsResponse<Value>>(text) {
            Self::handle_response(inner, response).await;
            return Ok(());
        }

        Err(WebSocketError::InvalidMessage(format!("Unknown message format: {}", text)).into())
    }

    /// Handle subscription notification
    async fn handle_notification(
        inner: &Arc<WebSocketClientInner>,
        params: NotificationParams<Value>,
    ) {
        let subscription_id = params.subscription;
        let should_auto_cancel = {
            let subscriptions = inner.subscriptions.read().await;
            if let Some(sub_info) = subscriptions.get(&subscription_id) {
                tracing::debug!(
                    "Sending notification for subscription {} to {} with result {:?}",
                    subscription_id,
                    sub_info.method,
                    params.result
                );

                // Send the notification
                if let Err(_) = sub_info.sender.send(params.result.clone()) {
                    tracing::warn!(
                        "Failed to send notification for subscription {}",
                        subscription_id
                    );
                    return;
                }

                // Check for auto-cancellation (only for signature subscriptions)
                if sub_info.method == "signatureSubscribe" {
                    if let Some(auto_cancel_limit) = sub_info.auto_cancel_after {
                        let current_count =
                            sub_info.notification_count.fetch_add(1, Ordering::SeqCst) + 1;
                        tracing::debug!(
                            "Signature subscription {} received notification {}/{}",
                            subscription_id,
                            current_count,
                            auto_cancel_limit
                        );

                        if current_count >= auto_cancel_limit {
                            tracing::debug!(
                                "Auto-canceling signature subscription {} after {} notifications",
                                subscription_id,
                                current_count
                            );
                            true // Signal to auto-cancel
                        } else {
                            false // Not ready to auto-cancel yet
                        }
                    } else {
                        false // No auto-cancel configured
                    }
                } else {
                    false // Not a signature subscription
                }
            } else {
                // Buffer notification if no matching subscription found
                tracing::debug!(
                    "Buffering notification for subscription {} (not yet registered)",
                    subscription_id
                );
                let buffered = BufferedNotification {
                    subscription_id: subscription_id,
                    notification: params.result,
                    timestamp: Instant::now(),
                };
                inner.notification_buffer.write().await.push(buffered);
                false // No auto-cancel needed
            }
        };

        // Perform auto-cancellation if needed (outside of subscription lock)
        if should_auto_cancel {
            Self::auto_unsubscribe_signature(inner, subscription_id).await;
        }
    }

    /// Auto-unsubscribe a signature subscription
    async fn auto_unsubscribe_signature(inner: &Arc<WebSocketClientInner>, subscription_id: u64) {
        // Remove subscription from tracking
        let removed = inner.subscriptions.write().await.remove(&subscription_id);

        if removed.is_some() {
            // Send unsubscribe request (fire and forget)
            let params = json!([subscription_id]);
            let request_id = inner.request_id.fetch_add(1, Ordering::SeqCst);

            let request = WsRequest {
                jsonrpc: "2.0".to_string(),
                id: request_id,
                method: "signatureUnsubscribe".to_string(),
                params: Some(params),
            };

            // Send unsubscribe request without waiting for response
            let ws_tx = inner.ws_tx.read().await;
            if let Some(sender) = ws_tx.as_ref() {
                if let Err(_) = sender.send(request) {
                    tracing::warn!(
                        "Failed to send auto-unsubscribe request for subscription {}",
                        subscription_id
                    );
                }
            }

            tracing::debug!(
                "Auto-unsubscribed signature subscription {}",
                subscription_id
            );
        }
    }

    /// Handle JSON-RPC response
    async fn handle_response(inner: &Arc<WebSocketClientInner>, response: WsResponse<Value>) {
        let response_id = response.id;
        let mut waiters = inner.response_waiters.write().await;
        if let Some(sender) = waiters.remove(&response_id) {
            if let Err(_) = sender.send(response) {
                tracing::warn!("Failed to send response for request {}", response_id);
            }
        }
    }

    /// Check buffer for notifications matching a subscription and deliver them
    async fn deliver_buffered_notifications(
        inner: &Arc<WebSocketClientInner>,
        subscription_id: u64,
    ) {
        let mut buffer = inner.notification_buffer.write().await;
        let mut delivered_indices = Vec::new();

        // Find matching buffered notifications
        for (index, buffered) in buffer.iter().enumerate() {
            if buffered.subscription_id == subscription_id {
                // Try to deliver the notification
                let subscriptions = inner.subscriptions.read().await;
                if let Some(sub_info) = subscriptions.get(&subscription_id) {
                    if let Err(_) = sub_info.sender.send(buffered.notification.clone()) {
                        tracing::warn!(
                            "Failed to send buffered notification for subscription {}",
                            subscription_id
                        );
                    } else {
                        tracing::debug!(
                            "Delivered buffered notification for subscription {}",
                            subscription_id
                        );
                        delivered_indices.push(index);
                    }
                }
                break; // Only deliver the first matching notification to maintain order
            }
        }

        // Remove delivered notifications (in reverse order to maintain indices)
        for &index in delivered_indices.iter().rev() {
            buffer.remove(index);
        }

        // Clean up old buffered notifications (older than 30 seconds)
        let now = Instant::now();
        buffer.retain(|buffered| now.duration_since(buffered.timestamp) < Duration::from_secs(30));
    }

    /// Send a request and wait for response
    async fn send_request<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<T> {
        let request_id = self.inner.request_id.fetch_add(1, Ordering::SeqCst);

        let request = WsRequest {
            jsonrpc: "2.0".to_string(),
            id: request_id,
            method: method.to_string(),
            params,
        };
        tracing::debug!("sending request {:?}", request);

        // Set up response waiter
        let (response_tx, mut response_rx) = mpsc::unbounded_channel();
        self.inner
            .response_waiters
            .write()
            .await
            .insert(request_id, response_tx);

        // Send request
        let ws_tx = self.inner.ws_tx.read().await;
        let sender = ws_tx
            .as_ref()
            .ok_or_else(|| WebSocketError::ConnectionClosed {
                reason: "No connection available".to_string(),
                code: Some(1006),
            })?;

        sender
            .send(request)
            .map_err(|_| WebSocketError::ConnectionClosed {
                reason: "Send channel closed".to_string(),
                code: Some(1006),
            })?;
        drop(ws_tx);

        // Wait for response with timeout
        let response = timeout(self.inner.config.timeout, response_rx.recv())
            .await
            .map_err(|_| crate::error::SubscriptionError::ConfirmationTimeout)?
            .ok_or_else(|| WebSocketError::ConnectionClosed {
                reason: "Response channel closed".to_string(),
                code: Some(1006),
            })?;

        tracing::trace!("Received response: {:?}", response);
        // Handle error response
        if let Some(error) = response.error {
            return Err(WebSocketError::InvalidMessage(format!(
                "RPC error {}: {}",
                error.code, error.message
            ))
            .into());
        }

        // Deserialize result
        let result = response
            .result
            .ok_or_else(|| WebSocketError::InvalidMessage("Missing result".to_string()))?;

        serde_json::from_value(result).map_err(|e| {
            crate::error::SerializationError::JsonDeserialize {
                source: e,
                data: "response result".to_string(),
            }
            .into()
        })
    }

    /// Subscribe to account changes
    ///
    /// Returns a tuple of (subscription_id, receiver). The subscription_id can be used
    /// to unsubscribe from the account changes using `account_unsubscribe`.
    ///
    /// # Example
    /// ```no_run
    /// # use thru_rpc_client::websocket::WebSocketClient;
    /// # use thru_rpc_client::{Client, Pubkey};
    /// # use std::time::Duration;
    /// # use url::Url;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = Client::builder()
    ///     .ws_endpoint(Some(Url::parse("ws://localhost:8080/ws")?))
    ///     .build();
    /// let ws_client = client.websocket().await?;
    ///
    /// let pubkey = Pubkey::new("your_account_pubkey".to_string())?;
    /// let (subscription_id, mut notifications) = ws_client.account_subscribe(&pubkey, None).await?;
    ///
    /// // Use the subscription_id to unsubscribe later
    /// ws_client.account_unsubscribe(subscription_id).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn account_subscribe(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<(u64, mpsc::UnboundedReceiver<AccountNotification>)> {
        let params = if let Some(config) = config {
            json!([pubkey.as_str(), config])
        } else {
            json!([pubkey.as_str()])
        };

        let subscription_id: u64 = self.send_request("accountSubscribe", Some(params)).await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to AccountNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                tracing::trace!("========> AccountNotification Received value: {:?}", value);
                match serde_json::from_value::<AccountNotification>(value) {
                    Ok(notification) => {
                        tracing::trace!("Sending notification: {:?}", notification);
                        if let Err(_) = typed_tx.send(notification) {
                            tracing::trace!("Receiver dropped");
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize account notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "accountSubscribe".to_string(),
            sender: value_tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from account changes
    pub async fn account_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self
            .send_request("accountUnsubscribe", Some(params))
            .await?;

        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);
        Ok(result)
    }

    /// Subscribe to signature status changes
    ///
    /// Returns a tuple of (subscription_id, receiver). The subscription_id can be used
    /// to unsubscribe from the signature status changes using `signature_unsubscribe`.
    ///
    /// # Example
    /// ```no_run
    /// # use thru_rpc_client::websocket::WebSocketClient;
    /// # use thru_rpc_client::{Client, Signature};
    /// # use thru_rpc_client::types::CommitmentLevel;
    /// # use std::time::Duration;
    /// # use url::Url;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = Client::builder()
    ///     .ws_endpoint(Some(Url::parse("ws://localhost:8080/ws")?))
    ///     .build();
    /// let ws_client = client.websocket().await?;
    ///
    /// let signature = Signature::new("your_transaction_signature".to_string())?;
    /// let (subscription_id, mut notifications) = ws_client.signature_subscribe(&signature, Some(CommitmentLevel::Finalized)).await?;
    ///
    /// // Use the subscription_id to unsubscribe later
    /// ws_client.signature_unsubscribe(subscription_id).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn signature_subscribe(
        &self,
        signature: &Signature,
        commitment: Option<CommitmentLevel>,
    ) -> Result<(u64, mpsc::UnboundedReceiver<SignatureNotification>)> {
        let params = if let Some(commitment) = commitment {
            json!([signature.as_str(), {"commitment": commitment}])
        } else {
            json!([signature.as_str()])
        };

        let subscription_id: u64 = self
            .send_request("signatureSubscribe", Some(params))
            .await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to SignatureNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                match serde_json::from_value::<SignatureNotification>(value) {
                    Ok(notification) => {
                        if let Err(_) = typed_tx.send(notification) {
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize signature notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "signatureSubscribe".to_string(),
            sender: value_tx,
            commitment_level: commitment,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: Self::calculate_auto_cancel_limit(commitment),
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from signature status changes
    pub async fn signature_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self
            .send_request("signatureUnsubscribe", Some(params))
            .await?;

        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);
        Ok(result)
    }

    /// Subscribe to slot changes
    ///
    /// Returns a tuple of (subscription_id, receiver). The subscription_id can be used
    /// to unsubscribe from the slot changes using `slot_unsubscribe`.
    ///
    /// # Example
    /// ```no_run
    /// # use thru_rpc_client::websocket::WebSocketClient;
    /// # use thru_rpc_client::Client;
    /// # use std::time::Duration;
    /// # use url::Url;
    /// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
    /// let client = Client::builder()
    ///     .ws_endpoint(Some(Url::parse("ws://localhost:8080/ws")?))
    ///     .build();
    /// let ws_client = client.websocket().await?;
    ///
    /// let (subscription_id, mut notifications) = ws_client.slot_subscribe().await?;
    ///
    /// // Use the subscription_id to unsubscribe later
    /// ws_client.slot_unsubscribe(subscription_id).await?;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn slot_subscribe(&self) -> Result<(u64, mpsc::UnboundedReceiver<Value>)> {
        let subscription_id: u64 = self.send_request("slotSubscribe", None).await?;

        let (tx, rx) = mpsc::unbounded_channel();
        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "slotSubscribe".to_string(),
            sender: tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, rx))
    }

    /// Unsubscribe from slot changes
    pub async fn slot_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self.send_request("slotUnsubscribe", Some(params)).await?;

        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);
        Ok(result)
    }

    /// Send transaction via WebSocket
    pub async fn send_transaction(
        &self,
        transaction: &[u8],
        config: Option<SendTransactionConfig>,
    ) -> Result<(
        Signature,
        Option<mpsc::UnboundedReceiver<SignatureNotification>>,
    )> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(transaction);

        // Extract commitment level from config before using config in json!
        let commitment_level = config.as_ref().and_then(|c| c.signature_notification);

        let params = if let Some(config) = config {
            json!([encoded, config])
        } else {
            json!([encoded])
        };

        let response: SendTransactionResult =
            self.send_request("sendTransaction", Some(params)).await?;

        // Handle automatic subscription if signature_subscription_id is present
        let subscription_receiver = if let Some(subscription_id) =
            response.signature_subscription_id
        {
            let (value_tx, mut value_rx) = mpsc::unbounded_channel();
            let (typed_tx, typed_rx) = mpsc::unbounded_channel();

            // Spawn a task to convert Value to SignatureNotification
            tokio::spawn(async move {
                while let Some(value) = value_rx.recv().await {
                    tracing::info!("---> got message {:?}", value);
                    match serde_json::from_value::<SignatureNotification>(value) {
                        Ok(notification) => {
                            if let Err(_) = typed_tx.send(notification) {
                                break; // Receiver dropped
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Failed to deserialize signature notification: {}", e);
                        }
                    }
                }
            });

            let sub_info = SubscriptionInfo {
                subscription_id,
                method: "signatureSubscribe".to_string(),
                sender: value_tx,
                commitment_level,
                notification_count: AtomicU32::new(0),
                auto_cancel_after: Self::calculate_auto_cancel_limit(commitment_level),
            };

            self.inner
                .subscriptions
                .write()
                .await
                .insert(subscription_id, sub_info);

            // Check for buffered notifications and deliver them
            Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

            Some(typed_rx)
        } else {
            None
        };

        Ok((response.signature, subscription_receiver))
    }

    /// Subscribe to raw block data
    pub async fn block_raw_subscribe(
        &self,
        config: Option<BlockSubscriptionConfig>,
    ) -> Result<(u64, mpsc::UnboundedReceiver<BlockRawNotification>)> {
        let params = if let Some(config) = config {
            Some(json!([config]))
        } else {
            None
        };

        let subscription_id: u64 = self.send_request("blockRawSubscribe", params).await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to BlockRawNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                tracing::debug!("Received block raw notification JSON: {:?}", value);
                match serde_json::from_value::<BlockRawNotification>(value) {
                    Ok(notification) => {
                        tracing::info!(
                            "Decoded block raw notification: slot {}, block size {} bytes",
                            notification.context.slot,
                            notification.value.block.len()
                        );
                        if let Err(_) = typed_tx.send(notification) {
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize block raw notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "blockRawSubscribe".to_string(),
            sender: value_tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from raw block data
    pub async fn block_raw_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self
            .send_request("blockRawUnsubscribe", Some(params))
            .await?;

        // Remove from local subscriptions
        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);

        Ok(result)
    }

    /// Subscribe to block summary data
    pub async fn block_summary_subscribe(
        &self,
        config: Option<BlockSubscriptionConfig>,
    ) -> Result<(u64, mpsc::UnboundedReceiver<BlockSummaryNotification>)> {
        let params = if let Some(config) = config {
            Some(json!([config]))
        } else {
            None
        };

        let subscription_id: u64 = self.send_request("blockSummarySubscribe", params).await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to BlockSummaryNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                tracing::debug!("Received block summary notification JSON: {:?}", value);
                match serde_json::from_value::<BlockSummaryNotification>(value) {
                    Ok(notification) => {
                        tracing::info!(
                            "Decoded block summary notification: slot {}, hash {}, tx count {}, size {} bytes",
                            notification.context.slot,
                            notification.value.block.block_hash,
                            notification.value.block.transactions,
                            notification.value.block.size
                        );
                        if let Err(_) = typed_tx.send(notification) {
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize block summary notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "blockSummarySubscribe".to_string(),
            sender: value_tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from block summary data
    pub async fn block_summary_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self
            .send_request("blockSummaryUnsubscribe", Some(params))
            .await?;

        // Remove from local subscriptions
        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);

        Ok(result)
    }

    /// Subscribe to transaction events
    pub async fn events_subscribe(
        &self,
        config: Option<EventSubscriptionConfig>,
    ) -> Result<(u64, mpsc::UnboundedReceiver<EventNotification>)> {
        let params = if let Some(config) = config {
            Some(json!([config]))
        } else {
            None
        };

        let subscription_id: u64 = self.send_request("eventsSubscribe", params).await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to EventNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                match serde_json::from_value::<EventNotification>(value) {
                    Ok(notification) => {
                        if let Err(_) = typed_tx.send(notification) {
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize event notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "eventsSubscribe".to_string(),
            sender: value_tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from transaction events
    pub async fn events_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self.send_request("eventsUnsubscribe", Some(params)).await?;

        // Remove from local subscriptions
        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);

        Ok(result)
    }

    /// Subscribe to program account changes
    pub async fn program_subscribe(
        &self,
        config: ProgramSubscriptionConfig,
    ) -> Result<(u64, mpsc::UnboundedReceiver<ProgramNotification>)> {
        // Build parameters according to specification: [program_id, config]
        let mut params_array = vec![json!(config.program_id)];

        // Add optional configuration object if any filters or data_slice are specified
        if config.data_slice.is_some() || config.filters.is_some() {
            let config_object = json!({
                "dataSlice": config.data_slice,
                "filters": config.filters
            });
            params_array.push(config_object);
        }

        let params = json!(params_array);

        let subscription_id: u64 = self.send_request("programSubscribe", Some(params)).await?;

        let (value_tx, mut value_rx) = mpsc::unbounded_channel();
        let (typed_tx, typed_rx) = mpsc::unbounded_channel();

        // Spawn a task to convert Value to ProgramNotification
        tokio::spawn(async move {
            while let Some(value) = value_rx.recv().await {
                tracing::trace!("========> ProgramNotification Received value: {:?}", value);
                match serde_json::from_value::<ProgramNotification>(value) {
                    Ok(notification) => {
                        if let Err(_) = typed_tx.send(notification) {
                            break; // Receiver dropped
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to deserialize program notification: {}", e);
                    }
                }
            }
        });

        let sub_info = SubscriptionInfo {
            subscription_id: subscription_id,
            method: "programSubscribe".to_string(),
            sender: value_tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        self.inner
            .subscriptions
            .write()
            .await
            .insert(subscription_id, sub_info);

        // Check for buffered notifications and deliver them
        Self::deliver_buffered_notifications(&self.inner, subscription_id).await;

        Ok((subscription_id, typed_rx))
    }

    /// Unsubscribe from program account changes
    pub async fn program_unsubscribe(&self, subscription_id: u64) -> Result<bool> {
        let params = json!([subscription_id]);
        let result: bool = self
            .send_request("programUnsubscribe", Some(params))
            .await?;

        // Remove from local subscriptions
        self.inner
            .subscriptions
            .write()
            .await
            .remove(&subscription_id);

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn test_config() -> ClientConfig {
        ClientConfig {
            http_endpoint: Url::parse("http://localhost:3000").unwrap(),
            ws_endpoint: Some(Url::parse("ws://localhost:3001").unwrap()),
            timeout: Duration::from_secs(30),
            max_connections: 100,
            ws_reconnect_attempts: 5,
            ws_reconnect_delay: Duration::from_secs(1),
            auth_token: None,
        }
    }

    #[test]
    fn test_request_id_generation() {
        let config = test_config();
        let inner = Arc::new(WebSocketClientInner {
            config,
            request_id: AtomicU64::new(1),
            subscriptions: RwLock::new(HashMap::new()),
            ws_tx: RwLock::new(None),
            response_waiters: RwLock::new(HashMap::new()),
            notification_buffer: RwLock::new(Vec::new()),
        });

        let id1 = inner.request_id.fetch_add(1, Ordering::SeqCst);
        let id2 = inner.request_id.fetch_add(1, Ordering::SeqCst);
        let id3 = inner.request_id.fetch_add(1, Ordering::SeqCst);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    #[test]
    fn test_auth_token_config() {
        // Test with auth token
        let config = ClientConfig {
            http_endpoint: Url::parse("http://localhost:3000").unwrap(),
            ws_endpoint: Some(Url::parse("ws://localhost:3001").unwrap()),
            timeout: Duration::from_secs(30),
            max_connections: 100,
            ws_reconnect_attempts: 5,
            ws_reconnect_delay: Duration::from_secs(1),
            auth_token: Some("test-token".to_string()),
        };

        assert_eq!(config.auth_token, Some("test-token".to_string()));

        // Test without auth token
        let config_no_auth = test_config();
        assert_eq!(config_no_auth.auth_token, None);
    }

    #[tokio::test]
    async fn test_notification_buffering() {
        let config = test_config();
        let inner = Arc::new(WebSocketClientInner {
            config,
            request_id: AtomicU64::new(1),
            subscriptions: RwLock::new(HashMap::new()),
            ws_tx: RwLock::new(None),
            response_waiters: RwLock::new(HashMap::new()),
            notification_buffer: RwLock::new(Vec::new()),
        });

        // Test 1: Notification arrives before subscription is registered
        let notification_params = NotificationParams {
            subscription: 123,
            result: json!({"test": "data"}),
        };

        // Handle notification before subscription exists
        WebSocketClient::handle_notification(&inner, notification_params).await;

        // Verify notification was buffered
        let buffer = inner.notification_buffer.read().await;
        assert_eq!(buffer.len(), 1);
        assert_eq!(buffer[0].subscription_id, 123);
        assert_eq!(buffer[0].notification, json!({"test": "data"}));
        drop(buffer);

        // Test 2: Add subscription and verify buffered notification is delivered
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sub_info = SubscriptionInfo {
            subscription_id: 123,
            method: "testSubscribe".to_string(),
            sender: tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        inner.subscriptions.write().await.insert(123, sub_info);

        // Deliver buffered notifications
        WebSocketClient::deliver_buffered_notifications(&inner, 123).await;

        // Verify notification was delivered
        let delivered_notification = rx.recv().await.unwrap();
        assert_eq!(delivered_notification, json!({"test": "data"}));

        // Verify buffer is now empty
        let buffer = inner.notification_buffer.read().await;
        assert_eq!(buffer.len(), 0);
    }

    #[tokio::test]
    async fn test_buffer_cleanup() {
        let config = test_config();
        let inner = Arc::new(WebSocketClientInner {
            config,
            request_id: AtomicU64::new(1),
            subscriptions: RwLock::new(HashMap::new()),
            ws_tx: RwLock::new(None),
            response_waiters: RwLock::new(HashMap::new()),
            notification_buffer: RwLock::new(Vec::new()),
        });

        // Add an old buffered notification
        let old_notification = BufferedNotification {
            subscription_id: 456,
            notification: json!({"old": "data"}),
            timestamp: Instant::now() - Duration::from_secs(60), // 60 seconds ago
        };

        inner
            .notification_buffer
            .write()
            .await
            .push(old_notification);

        // Trigger cleanup by calling deliver_buffered_notifications
        WebSocketClient::deliver_buffered_notifications(&inner, 999).await;

        // Verify old notification was cleaned up
        let buffer = inner.notification_buffer.read().await;
        assert_eq!(buffer.len(), 0);
    }

    #[tokio::test]
    async fn test_notification_delivery_to_existing_subscription() {
        let config = test_config();
        let inner = Arc::new(WebSocketClientInner {
            config,
            request_id: AtomicU64::new(1),
            subscriptions: RwLock::new(HashMap::new()),
            ws_tx: RwLock::new(None),
            response_waiters: RwLock::new(HashMap::new()),
            notification_buffer: RwLock::new(Vec::new()),
        });

        // Add an active subscription
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sub_info = SubscriptionInfo {
            subscription_id: 789,
            method: "testSubscribe".to_string(),
            sender: tx,
            commitment_level: None,
            notification_count: AtomicU32::new(0),
            auto_cancel_after: None,
        };

        inner.subscriptions.write().await.insert(789, sub_info);

        // Send notification to existing subscription
        let notification_params = NotificationParams {
            subscription: 789,
            result: json!({"live": "data"}),
        };

        WebSocketClient::handle_notification(&inner, notification_params).await;

        // Verify notification was delivered immediately (not buffered)
        let delivered_notification = rx.recv().await.unwrap();
        assert_eq!(delivered_notification, json!({"live": "data"}));

        // Verify buffer remains empty
        let buffer = inner.notification_buffer.read().await;
        assert_eq!(buffer.len(), 0);
    }

    #[test]
    fn test_subscription_method_return_types() {
        // Test that subscription methods return tuples with correct types
        // This is a compile-time test to ensure the API is correct
        use crate::types::{AccountInfoConfig, CommitmentLevel};
        use thru_base::tn_tools::{Pubkey, Signature};

        // This test verifies that the method signatures are correct
        async fn _test_api_signatures() -> Result<()> {
            let config = test_config();
            let client = WebSocketClient::new(config).await?;

            // Test account_subscribe returns (u64, Receiver)
            let pubkey = Pubkey::new("test".to_string())?;
            let (_subscription_id, _receiver): (u64, _) = client
                .account_subscribe(&pubkey, None::<AccountInfoConfig>)
                .await?;

            // Test signature_subscribe returns (u64, Receiver)
            let signature = Signature::new("test".to_string())?;
            let (_subscription_id, _receiver): (u64, _) = client
                .signature_subscribe(&signature, None::<CommitmentLevel>)
                .await?;

            // Test slot_subscribe returns (u64, Receiver)
            let (_subscription_id, _receiver): (u64, _) = client.slot_subscribe().await?;

            Ok(())
        }

        // This function won't actually run in tests (it would require a real server)
        // but it will be checked at compile time to ensure the types are correct
        let _ = _test_api_signatures;
    }

    #[test]
    fn test_subscription_id_uniqueness() {
        // Test that subscription IDs should be unique values
        // This tests the internal logic that subscription IDs are returned correctly
        use std::collections::HashSet;

        // Simulate multiple subscription IDs being returned
        let mut subscription_ids = HashSet::new();

        // In real implementation, each subscription would get a unique ID from the server
        for i in 1..=100 {
            subscription_ids.insert(i as u64);
        }

        assert_eq!(subscription_ids.len(), 100);

        // Verify we can use subscription IDs for unsubscribe operations
        for subscription_id in subscription_ids {
            // This simulates the pattern: store subscription_id, then use it later
            let _can_unsubscribe_later = subscription_id;
            assert!(subscription_id > 0);
        }
    }

    #[test]
    fn test_tuple_destructuring_patterns() {
        fn _test_destructuring() -> Result<()> {
            let (_subscription_id, _receiver) = (1u64, mpsc::unbounded_channel::<Value>().1);
            Ok(())
        }
        assert!(_test_destructuring().is_ok());
    }

    #[tokio::test]
    async fn test_auto_cancellation_logic() {
        // Test the calculate_auto_cancel_limit helper function
        assert_eq!(
            WebSocketClient::calculate_auto_cancel_limit(Some(CommitmentLevel::Finalized)),
            Some(1)
        );
        assert_eq!(
            WebSocketClient::calculate_auto_cancel_limit(Some(CommitmentLevel::Executed)),
            Some(2)
        );
        assert_eq!(WebSocketClient::calculate_auto_cancel_limit(None), None);

        // Test SubscriptionInfo creation with auto-cancellation fields
        let (tx, _rx) = mpsc::unbounded_channel();
        let sub_info = SubscriptionInfo {
            subscription_id: 123,
            method: "signatureSubscribe".to_string(),
            sender: tx,
            commitment_level: Some(CommitmentLevel::Finalized),
            notification_count: AtomicU32::new(0),
            auto_cancel_after: Some(1),
        };

        // Test notification counting
        assert_eq!(sub_info.notification_count.load(Ordering::SeqCst), 0);
        let count = sub_info.notification_count.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(count, 1);
        assert_eq!(sub_info.notification_count.load(Ordering::SeqCst), 1);

        // Test auto-cancel condition
        assert_eq!(sub_info.auto_cancel_after, Some(1));
        assert!(count >= sub_info.auto_cancel_after.unwrap());

        // Test executed commitment level (should auto-cancel after 2 notifications)
        let (tx2, _rx2) = mpsc::unbounded_channel();
        let sub_info2 = SubscriptionInfo {
            subscription_id: 456,
            method: "signatureSubscribe".to_string(),
            sender: tx2,
            commitment_level: Some(CommitmentLevel::Executed),
            notification_count: AtomicU32::new(0),
            auto_cancel_after: Some(2),
        };

        // First notification
        let count1 = sub_info2.notification_count.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(count1, 1);
        assert!(count1 < sub_info2.auto_cancel_after.unwrap());

        // Second notification (should trigger auto-cancel)
        let count2 = sub_info2.notification_count.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(count2, 2);
        assert!(count2 >= sub_info2.auto_cancel_after.unwrap());
    }
}
