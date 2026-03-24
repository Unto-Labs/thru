//! State proof utilities for CLI commands

use crate::error::CliError;
use thru_base::rpc_types::{MakeStateProofConfig, ProofType};
use thru_base::tn_tools::Pubkey;
use thru_client::Client;

/// Helper function to create a state proof for an account
pub async fn make_state_proof(
    client: &Client,
    account_pubkey: &Pubkey,
    proof_type: ProofType,
    slot: Option<u64>,
) -> Result<Vec<u8>, CliError> {
    let state_proof_config = MakeStateProofConfig {
        proof_type,
        slot,
    };

    let proof_data = client
        .make_state_proof(account_pubkey, &state_proof_config)
        .await
        .map_err(|e| {
            CliError::TransactionSubmission(format!("Failed to create state proof: {}", e))
        })?;

    Ok(proof_data)
}
