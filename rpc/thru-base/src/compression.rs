//! Unsigned builders for the current managed compression program (u32 tags).
//! The legacy system-test builders in `txn_tools` have a different wire format.
use crate::tn_account::{TN_ACCOUNT_DATA_SZ_MAX, TN_ACCOUNT_META_FOOTPRINT, TnAccountMeta};
use crate::{
    StateProof, StateProofType, Transaction, TransactionBuilder, txn_tools::account_state_units,
};

pub const COMPRESSION_TRANSACTION_MAX_BYTES: usize = 32_768;
pub use crate::bootstrap_addresses::COMPRESSION_PROGRAM_BYTES as COMPRESSION_PROGRAM;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecompressionBuildError {
    #[error("invalid archived account metadata or data length")]
    InvalidImage,
    #[error("decompression requires a complete existing-account proof")]
    InvalidProof,
    #[error(
        "inline decompression requires {actual} transaction bytes; maximum is {limit}; large-account upload staging is not supported"
    )]
    SizeLimit { actual: usize, limit: usize },
    #[error(
        "the target must differ from the payer and program; a compressed payer requires another active funded payer"
    )]
    InvalidTarget,
}

impl TransactionBuilder {
    /// Build an unsigned inline restore for the current compression program.
    /// Pass `COMPRESSION_PROGRAM` for the canonical deployment. Callers own
    /// chain-aware signing, nonce coordination, submission and confirmation.
    pub fn build_compression_decompress(
        fee_payer: [u8; 32],
        program: [u8; 32],
        target: [u8; 32],
        account_meta: &[u8],
        account_data: &[u8],
        proof: &[u8],
        fee: u64,
        nonce: u64,
        start_slot: u64,
    ) -> Result<Transaction, DecompressionBuildError> {
        if target == fee_payer || target == program || fee_payer == program {
            return Err(DecompressionBuildError::InvalidTarget);
        }
        if account_meta.len() != TN_ACCOUNT_META_FOOTPRINT
            || account_data.len() > TN_ACCOUNT_DATA_SZ_MAX
            || TnAccountMeta::from_wire(account_meta)
                .is_none_or(|meta| meta.data_sz as usize != account_data.len())
        {
            return Err(DecompressionBuildError::InvalidImage);
        }
        let parsed = StateProof::from_wire(proof).ok_or(DecompressionBuildError::InvalidProof)?;
        if proof.len() < 40
            || proof[7] >> 6 != 0
            || parsed.header.proof_type != StateProofType::Existing
            || parsed.to_wire() != proof
        {
            return Err(DecompressionBuildError::InvalidProof);
        }
        // Header (112), target (32), signature (64), tag/index/length/meta (78).
        let actual = 112 + 32 + 64 + 78 + account_data.len() + proof.len();
        if actual > COMPRESSION_TRANSACTION_MAX_BYTES {
            return Err(DecompressionBuildError::SizeLimit {
                actual,
                limit: COMPRESSION_TRANSACTION_MAX_BYTES,
            });
        }
        let mut instruction = Vec::with_capacity(78 + account_data.len() + proof.len());
        instruction.extend_from_slice(&2u32.to_le_bytes());
        instruction.extend_from_slice(&2u16.to_le_bytes());
        instruction.extend_from_slice(&(account_data.len() as u64).to_le_bytes());
        instruction.extend_from_slice(account_meta);
        instruction.extend_from_slice(account_data);
        instruction.extend_from_slice(proof);
        let tx = Transaction::new(fee_payer, program, fee, nonce)
            .with_start_slot(start_slot)
            .with_expiry_after(100)
            .with_compute_units(100_300 + account_data.len() as u32 * 2)
            .with_memory_units(10_000)
            .with_state_units(
                account_state_units(account_data.len() as u64)
                    .map_err(|_| DecompressionBuildError::InvalidImage)?,
            )
            .add_rw_account(target)
            .with_instructions(instruction);
        Ok(tx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn build(size: usize) -> Result<Transaction, DecompressionBuildError> {
        let mut meta = [0; 64];
        meta[4..8].copy_from_slice(&(size as u32).to_le_bytes());
        TransactionBuilder::build_compression_decompress(
            [1; 32],
            COMPRESSION_PROGRAM,
            [2; 32],
            &meta,
            &vec![7; size],
            &[0; 40],
            0,
            9,
            600,
        )
    }
    #[test]
    fn current_abi_and_unsigned_wire_boundary() {
        let tx = build(4033).unwrap();
        assert!(tx.signature.is_none());
        assert_eq!(tx.req_state_units, 2);
        assert_eq!(tx.nonce, 9);
        let ix = tx.instructions.as_ref().unwrap();
        assert_eq!(&ix[..4], &2u32.to_le_bytes());
        assert_eq!(&ix[4..6], &2u16.to_le_bytes());
        assert_eq!(&ix[6..14], &4033u64.to_le_bytes());
        assert_eq!(&ix[78..78 + 4033], vec![7; 4033].as_slice());
        let max_data = COMPRESSION_TRANSACTION_MAX_BYTES - (112 + 32 + 64 + 78 + 40);
        assert_eq!(
            build(max_data).unwrap().to_wire().len(),
            COMPRESSION_TRANSACTION_MAX_BYTES
        );
        assert_eq!(
            build(max_data + 1).unwrap_err(),
            DecompressionBuildError::SizeLimit {
                actual: 32769,
                limit: 32768
            }
        );
    }
    #[test]
    fn invalid_images_proofs_and_payer_target_are_rejected() {
        let mut proof = vec![0; 40];
        proof[8] = 1;
        assert_eq!(
            TransactionBuilder::build_compression_decompress(
                [1; 32],
                COMPRESSION_PROGRAM,
                [2; 32],
                &[0; 64],
                &[],
                &proof,
                0,
                0,
                0
            )
            .unwrap_err(),
            DecompressionBuildError::InvalidProof
        );
        assert!(matches!(
            TransactionBuilder::build_compression_decompress(
                [1; 32],
                COMPRESSION_PROGRAM,
                [2; 32],
                &[0; 64],
                &[1],
                &[0; 40],
                0,
                0,
                0
            ),
            Err(DecompressionBuildError::InvalidImage)
        ));
        assert!(matches!(
            TransactionBuilder::build_compression_decompress(
                [1; 32],
                COMPRESSION_PROGRAM,
                [1; 32],
                &[0; 64],
                &[],
                &[0; 40],
                0,
                0,
                0
            ),
            Err(DecompressionBuildError::InvalidTarget)
        ));
    }
}
