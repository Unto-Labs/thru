//! WebSocket client implementation

pub mod client;
pub mod handles;

pub use client::WebSocketClient;
pub use handles::{
    AccountSubscriptionHandle, SignatureSubscriptionHandle, SlotSubscriptionHandle,
    SubscriptionHandle, SubscriptionManager,
};
