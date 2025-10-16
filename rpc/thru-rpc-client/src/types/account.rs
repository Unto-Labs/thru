//! Account-related types

use serde::{Deserialize, Serialize};
use thru_base::tn_tools::Pubkey;

use crate::types::common::ResponseContext;
use thru_base::rpc_types::DataSlice;

/// Account information
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    /// The balance of the account
    pub balance: u64,
    /// The data of the account
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>, // Base64 encoded
    /// The owner of the account
    pub owner: Pubkey,
    /// Whether the account is a program
    pub program: bool,
    /// The data size of the account
    #[serde(rename = "dataSize")]
    pub data_size: u64,
    /// The nonce of the account
    pub nonce: u64,
    /// The state counter of the account
    #[serde(rename = "stateCounter")]
    pub state_counter: u64,
    /// Whether the account is new
    #[serde(rename = "isNew")]
    pub is_new: bool,
}

/// Configuration for account info requests
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountInfoConfig {
    /// Whether to skip data
    #[serde(rename = "skipData", skip_serializing_if = "Option::is_none")]
    pub skip_data: Option<bool>,
    /// The data slice
    #[serde(rename = "dataSlice", skip_serializing_if = "Option::is_none")]
    pub data_slice: Option<DataSlice>,
}

/// Configuration for account subscription
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountSubscribeConfig {
    /// Whether to skip data
    #[serde(rename = "skipData", skip_serializing_if = "Option::is_none")]
    pub skip_data: Option<bool>,
    /// The data slice
    #[serde(rename = "dataSlice", skip_serializing_if = "Option::is_none")]
    pub data_slice: Option<DataSlice>,
}

/// Account notification from WebSocket subscription
#[derive(Debug, Clone, Deserialize)]
pub struct AccountNotification {
    /// The context of the notification
    pub context: ResponseContext,
    /// The account information
    pub value: Account,
}

/// Response wrapper for account info
#[derive(Debug, Clone, Deserialize)]
pub struct AccountInfoResponse {
    /// The context of the response
    pub context: ResponseContext,
    /// The account information
    pub value: Option<Account>,
}

/// Response wrapper for multiple accounts info
#[derive(Debug, Clone, Deserialize)]
pub struct MultipleAccountsResponse {
    /// The context of the response
    pub context: ResponseContext,
    /// Array of account information (null for non-existent accounts)
    pub value: Vec<Option<Account>>,
}

/// Response type for getProgramAccounts
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct ProgramAccount {
    /// The account public key
    pub pubkey: Pubkey,
    /// The account information
    pub account: Account,
}

/// Response wrapper for getProgramAccounts
pub type GetProgramAccountsResponse = Vec<ProgramAccount>;

/// Response for prepareAccountDecompression
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepareAccountDecompressionResponse {
    /// Base64 encoded account data
    pub account_data: String,
    /// Base64 encoded state proof
    pub state_proof: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_account_serialization() {
        let account_json = r#"{
            "pubkey": "ta0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzcz",
            "balance": 1000000,
            "data": "SGVsbG8gV29ybGQ=",
            "owner": "ta0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzcz",
            "program": false,
            "dataSize": 11,
            "nonce": 1,
            "stateCounter": 5,
            "isNew": true
        }"#;

        let account: Account = serde_json::from_str(account_json).unwrap();
        assert_eq!(account.balance, 1000000);
        assert_eq!(account.data_size, 11);
        assert_eq!(account.state_counter, 5);
        assert_eq!(account.is_new, true);
    }

    #[test]
    fn test_account_config_serialization() {
        let config = AccountInfoConfig {
            skip_data: Some(true),
            data_slice: Some(DataSlice {
                offset: 10,
                length: 20,
            }),
        };

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"skipData\":true"));
        assert!(json.contains("\"dataSlice\""));
        assert!(json.contains("\"offset\":10"));
        assert!(json.contains("\"length\":20"));
    }
}
