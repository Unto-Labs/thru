//! Read-only preparation for explicit, caller-funded account restoration.
use crate::{Account, AccountView, Client, ClientError, Result, VersionContext};
use thru_base::tn_account::{TN_ACCOUNT_FLAG_DELETED, TnAccountMeta};
use thru_base::{
    Pubkey,
    rpc_types::{MakeStateProofConfig, ProofType},
};

/// Runtime compression timeout; currently a protocol constant (256 + 128 slots).
pub const ACCOUNT_COMPRESSION_COOLDOWN: u64 = 384;

#[derive(Debug, Clone)]
pub enum AccountState {
    Active(Account),
    Compressed(Account),
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedAccountDecompression {
    pub account_meta: [u8; 64],
    pub account_data: Vec<u8>,
    pub state_proof: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountDecompressionPreparation {
    AlreadyActive,
    Cooldown { retry_slot: u64 },
    Ready(PreparedAccountDecompression),
}

impl Client {
    /// Distinguish live state, a compression archive and absence. RPC failures
    /// propagate. Historical account metadata alone does not identify compression.
    pub async fn get_account_state(&self, address: &Pubkey) -> Result<AccountState> {
        let current = self
            .get_account_info(
                address,
                Some(AccountView::Full),
                Some(VersionContext::Current),
            )
            .await?;
        if let Some(account) = current {
            return Ok(if account.is_deleted {
                AccountState::Missing
            } else {
                AccountState::Active(account)
            });
        }
        let archived = self
            .get_account_info(
                address,
                Some(AccountView::Full),
                Some(VersionContext::CurrentOrHistorical),
            )
            .await?;
        // A concurrent restoration can land between the two reads.
        if let Some(account) = self
            .get_account_info(
                address,
                Some(AccountView::Full),
                Some(VersionContext::Current),
            )
            .await?
        {
            return Ok(if account.is_deleted {
                AccountState::Missing
            } else {
                AccountState::Active(account)
            });
        }
        Ok(match archived {
            Some(account) if !account.is_deleted => AccountState::Compressed(account),
            _ => AccountState::Missing,
        })
    }

    /// Typed companion to `prepare_account_decompression`. This does not sign,
    /// submit or wait through cooldown. The legacy helper remains compatible.
    pub async fn prepare_account_decompression_checked(
        &self,
        address: &Pubkey,
    ) -> Result<AccountDecompressionPreparation> {
        match self.get_account_state(address).await? {
            AccountState::Active(_) => return Ok(AccountDecompressionPreparation::AlreadyActive),
            AccountState::Missing => return Err(ClientError::AccountNotFound(address.to_string())),
            AccountState::Compressed(_) => {}
        }
        let raw = self.get_raw_account(address).await?;
        let meta: [u8; 64] = raw.raw_meta.try_into().map_err(|_| {
            ClientError::Validation("Invalid archived runtime metadata length".into())
        })?;
        let parsed_meta = TnAccountMeta::from_wire(&meta).expect("fixed-size metadata");
        if parsed_meta.flags & TN_ACCOUNT_FLAG_DELETED != 0 {
            return Err(ClientError::AccountNotFound(address.to_string()));
        }
        let data = raw.raw_data.unwrap_or_default();
        if parsed_meta.data_sz as usize != data.len() {
            return Err(ClientError::Validation(
                "Archived account data length does not match metadata".into(),
            ));
        }
        let slot = raw.version_context.and_then(|v| v.slot).ok_or_else(|| {
            ClientError::Validation("Archive is missing its compression slot".into())
        })?;
        if let Some(account) = self
            .get_account_info(address, None, Some(VersionContext::Current))
            .await?
        {
            if !account.is_deleted {
                return Ok(AccountDecompressionPreparation::AlreadyActive);
            }
        }
        let retry_slot = slot
            .checked_add(ACCOUNT_COMPRESSION_COOLDOWN)
            .ok_or_else(|| ClientError::Validation("Invalid archive slot".into()))?;
        if self.get_block_height().await?.locally_executed_height < retry_slot {
            return Ok(AccountDecompressionPreparation::Cooldown { retry_slot });
        }
        let proof = self
            .make_state_proof(
                address,
                &MakeStateProofConfig {
                    proof_type: ProofType::Existing,
                    slot: None,
                },
            )
            .await;
        // If another caller restored it while we fetched the archive/proof, skip it.
        if let Some(account) = self
            .get_account_info(
                address,
                Some(AccountView::Full),
                Some(VersionContext::Current),
            )
            .await?
        {
            if !account.is_deleted {
                return Ok(AccountDecompressionPreparation::AlreadyActive);
            }
        }
        Ok(AccountDecompressionPreparation::Ready(
            PreparedAccountDecompression {
                account_meta: meta,
                account_data: data,
                state_proof: proof?,
            },
        ))
    }
}
