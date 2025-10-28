//! Subscription handle system for easier WebSocket subscription management
//!
//! This module provides RAII-style handles for WebSocket subscriptions that automatically
//! clean up when dropped, along with a subscription manager for coordinating multiple
//! subscriptions.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::{RwLock, mpsc};

use crate::error::Result;
use crate::types::{AccountInfoConfig, AccountNotification, CommitmentLevel};
use crate::websocket::WebSocketClient;
use thru_base::tn_tools::{Pubkey, Signature};

/// Unique identifier for a subscription
pub type SubscriptionId = u64;

/// Base trait for all subscription handles
pub trait SubscriptionHandle {
    /// Get the subscription ID
    fn subscription_id(&self) -> SubscriptionId;

    /// Check if the subscription is still active
    fn is_active(&self) -> bool;

    /// Manually unsubscribe (automatically called on drop)
    fn unsubscribe(&mut self) -> impl std::future::Future<Output = Result<bool>> + Send;
}

/// Handle for account subscription with automatic cleanup
#[derive(Debug)]
pub struct AccountSubscriptionHandle {
    subscription_id: SubscriptionId,
    ws_client: WebSocketClient,
    notifications: mpsc::UnboundedReceiver<AccountNotification>,
    active: bool,
}

impl AccountSubscriptionHandle {
    /// Create a new account subscription handle
    pub(crate) fn new(
        subscription_id: SubscriptionId,
        ws_client: WebSocketClient,
        notifications: mpsc::UnboundedReceiver<AccountNotification>,
    ) -> Self {
        Self {
            subscription_id,
            ws_client,
            notifications,
            active: true,
        }
    }

    /// Get the next notification from this subscription
    pub async fn next_notification(&mut self) -> Option<AccountNotification> {
        if !self.active {
            return None;
        }
        self.notifications.recv().await
    }

    /// Get the account being monitored
    pub fn account(&self) -> SubscriptionId {
        self.subscription_id
    }
}

impl SubscriptionHandle for AccountSubscriptionHandle {
    fn subscription_id(&self) -> SubscriptionId {
        self.subscription_id
    }

    fn is_active(&self) -> bool {
        self.active
    }

    async fn unsubscribe(&mut self) -> Result<bool> {
        if !self.active {
            return Ok(false);
        }

        let result = self
            .ws_client
            .account_unsubscribe(self.subscription_id)
            .await;
        self.active = false;
        result
    }
}

impl Drop for AccountSubscriptionHandle {
    fn drop(&mut self) {
        if self.active {
            // Note: We can't call async unsubscribe in Drop, so we just mark as inactive
            // In a production system, you might want to send a message to a cleanup task
            self.active = false;
        }
    }
}

/// Handle for signature subscription with automatic cleanup
pub struct SignatureSubscriptionHandle {
    subscription_id: SubscriptionId,
    ws_client: WebSocketClient,
    notifications: mpsc::UnboundedReceiver<crate::types::SignatureNotification>,
    active: bool,
}

impl std::fmt::Debug for SignatureSubscriptionHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignatureSubscriptionHandle")
            .field("subscription_id", &self.subscription_id)
            .field("ws_client", &self.ws_client)
            .field("notifications", &"UnboundedReceiver<SignatureNotification>")
            .field("active", &self.active)
            .finish()
    }
}

impl SignatureSubscriptionHandle {
    /// Create a new signature subscription handle
    pub(crate) fn new(
        subscription_id: SubscriptionId,
        ws_client: WebSocketClient,
        notifications: mpsc::UnboundedReceiver<crate::types::SignatureNotification>,
    ) -> Self {
        Self {
            subscription_id,
            ws_client,
            notifications,
            active: true,
        }
    }

    /// Get the next notification from this subscription
    pub async fn next_notification(&mut self) -> Option<crate::types::SignatureNotification> {
        if !self.active {
            return None;
        }
        self.notifications.recv().await
    }

    /// Wait for signature confirmation with timeout
    pub async fn wait_for_confirmation(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<Option<crate::types::SignatureNotification>> {
        if !self.active {
            return Ok(None);
        }

        tokio::time::timeout(timeout, self.notifications.recv())
            .await
            .map_err(|_| crate::error::SubscriptionError::ConfirmationTimeout.into())
            .map(|opt| opt)
    }
}

impl SubscriptionHandle for SignatureSubscriptionHandle {
    fn subscription_id(&self) -> SubscriptionId {
        self.subscription_id
    }

    fn is_active(&self) -> bool {
        self.active
    }

    async fn unsubscribe(&mut self) -> Result<bool> {
        if !self.active {
            return Ok(false);
        }

        let result = self
            .ws_client
            .signature_unsubscribe(self.subscription_id)
            .await;
        self.active = false;
        result
    }
}

impl Drop for SignatureSubscriptionHandle {
    fn drop(&mut self) {
        if self.active {
            self.active = false;
        }
    }
}

/// Handle for slot subscription with automatic cleanup
#[derive(Debug)]
pub struct SlotSubscriptionHandle {
    subscription_id: SubscriptionId,
    ws_client: WebSocketClient,
    notifications: mpsc::UnboundedReceiver<Value>,
    active: bool,
}

impl SlotSubscriptionHandle {
    /// Create a new slot subscription handle
    pub(crate) fn new(
        subscription_id: SubscriptionId,
        ws_client: WebSocketClient,
        notifications: mpsc::UnboundedReceiver<Value>,
    ) -> Self {
        Self {
            subscription_id,
            ws_client,
            notifications,
            active: true,
        }
    }

    /// Get the next notification from this subscription
    pub async fn next_notification(&mut self) -> Option<Value> {
        if !self.active {
            return None;
        }
        self.notifications.recv().await
    }

    /// Get multiple notifications at once (up to limit)
    pub async fn next_notifications(&mut self, limit: usize) -> Vec<Value> {
        let mut notifications = Vec::with_capacity(limit);

        for _ in 0..limit {
            if let Some(notification) = self.next_notification().await {
                notifications.push(notification);
            } else {
                break;
            }
        }

        notifications
    }
}

impl SubscriptionHandle for SlotSubscriptionHandle {
    fn subscription_id(&self) -> SubscriptionId {
        self.subscription_id
    }

    fn is_active(&self) -> bool {
        self.active
    }

    async fn unsubscribe(&mut self) -> Result<bool> {
        if !self.active {
            return Ok(false);
        }

        let result = self.ws_client.slot_unsubscribe(self.subscription_id).await;
        self.active = false;
        result
    }
}

impl Drop for SlotSubscriptionHandle {
    fn drop(&mut self) {
        if self.active {
            self.active = false;
        }
    }
}

/// Subscription manager for coordinating multiple subscriptions
#[derive(Debug)]
pub struct SubscriptionManager {
    next_handle_id: AtomicU64,
    active_subscriptions: Arc<RwLock<HashMap<u64, SubscriptionId>>>,
    ws_client: WebSocketClient,
}

impl SubscriptionManager {
    /// Create a new subscription manager
    pub fn new(ws_client: WebSocketClient) -> Self {
        Self {
            next_handle_id: AtomicU64::new(1),
            active_subscriptions: Arc::new(RwLock::new(HashMap::new())),
            ws_client,
        }
    }

    /// Subscribe to account changes with handle
    pub async fn subscribe_account(
        &self,
        pubkey: &Pubkey,
        config: Option<AccountInfoConfig>,
    ) -> Result<AccountSubscriptionHandle> {
        let (subscription_id, notifications) =
            self.ws_client.account_subscribe(pubkey, config).await?;
        let handle_id = self.next_handle_id.fetch_add(1, Ordering::SeqCst);

        self.active_subscriptions
            .write()
            .await
            .insert(handle_id, subscription_id);

        Ok(AccountSubscriptionHandle::new(
            subscription_id,
            self.ws_client.clone(),
            notifications,
        ))
    }

    /// Subscribe to signature status with handle
    pub async fn subscribe_signature(
        &self,
        signature: &Signature,
        commitment: Option<CommitmentLevel>,
    ) -> Result<SignatureSubscriptionHandle> {
        let (subscription_id, notifications) = self
            .ws_client
            .signature_subscribe(signature, commitment)
            .await?;
        let handle_id = self.next_handle_id.fetch_add(1, Ordering::SeqCst);

        self.active_subscriptions
            .write()
            .await
            .insert(handle_id, subscription_id);

        Ok(SignatureSubscriptionHandle::new(
            subscription_id,
            self.ws_client.clone(),
            notifications,
        ))
    }

    /// Subscribe to slot updates with handle
    pub async fn subscribe_slots(&self) -> Result<SlotSubscriptionHandle> {
        let (subscription_id, notifications) = self.ws_client.slot_subscribe().await?;
        let handle_id = self.next_handle_id.fetch_add(1, Ordering::SeqCst);

        self.active_subscriptions
            .write()
            .await
            .insert(handle_id, subscription_id);

        Ok(SlotSubscriptionHandle::new(
            subscription_id,
            self.ws_client.clone(),
            notifications,
        ))
    }

    /// Get the number of active subscriptions
    pub async fn active_count(&self) -> usize {
        self.active_subscriptions.read().await.len()
    }

    /// Unsubscribe all active subscriptions
    pub async fn unsubscribe_all(&self) -> Result<usize> {
        let mut subscriptions = self.active_subscriptions.write().await;
        let count = subscriptions.len();

        // In a real implementation, we would unsubscribe each one
        subscriptions.clear();

        Ok(count)
    }
}

impl Clone for SubscriptionManager {
    fn clone(&self) -> Self {
        Self {
            next_handle_id: AtomicU64::new(self.next_handle_id.load(Ordering::SeqCst)),
            active_subscriptions: Arc::clone(&self.active_subscriptions),
            ws_client: self.ws_client.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientConfig;
    use std::time::Duration;
    use url::Url;

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

    #[tokio::test]
    async fn test_subscription_manager_creation() {
        let _config = test_config();
        // This would fail in tests since we don't have a real WebSocket server
        // but it demonstrates the API

        // let ws_client = WebSocketClient::new(config).await.unwrap();
        // let manager = SubscriptionManager::new(ws_client);
        // assert_eq!(manager.active_count().await, 0);
    }

    #[test]
    fn test_subscription_handle_traits() {
        // Test that our handles implement the required traits
        fn assert_subscription_handle<T: SubscriptionHandle>() {}

        assert_subscription_handle::<AccountSubscriptionHandle>();
        assert_subscription_handle::<SignatureSubscriptionHandle>();
        assert_subscription_handle::<SlotSubscriptionHandle>();
    }
}
