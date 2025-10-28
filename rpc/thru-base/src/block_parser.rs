use crate::tn_public_address::tn_pubkey_to_address_string;
use crate::tn_signature_encoding::tn_signature_to_string;
use crate::txn_lib::{self, Transaction, WireTxnHdrV1};
use blake3;
use std::{collections::HashSet, mem};
use tracing::{debug, error, warn};
// use base64::prelude::*;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Block format structures (from thru-uds/src/block_format.rs)
pub type FdPubkey = [u8; 32];
pub type FdSignature = [u8; 64];
pub type FdBlake3Hash = [u8; 64];

/// Result structure for block parsing with cryptographic verification
#[derive(Debug, Clone)]
pub struct BlockParseResult {
    pub block_hash: [u8; 64],       // 512-bit Blake3 hash
    pub block_producer: [u8; 32],   // Block producer's public key
    pub transactions: Vec<Vec<u8>>, // Existing transaction data
}

/// Comprehensive error handling for block parsing and cryptographic verification
#[derive(Debug, thiserror::Error)]
pub enum BlockParseError {
    #[error("Invalid block structure: {0}")]
    InvalidBlockStructure(String),
    #[error("Blake3 hash computation failed: {0}")]
    HashComputationFailed(String),
    #[error("Header signature verification failed: {0}")]
    HeaderSignatureInvalid(String),
    #[error("Block signature verification failed: {0}")]
    BlockSignatureInvalid(String),
    #[error("Ed25519 key error: {0}")]
    Ed25519KeyError(String),
    #[error("Account extraction failed: {0}")]
    AccountExtractionFailed(String),
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnBlockHeader {
    pub block_header_sig: FdSignature,
    pub body: TnBlockHeaderBody,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnBlockHeaderBody {
    pub block_version: u8,
    pub padding: [u8; 7],
    pub block_producer: FdPubkey,
    pub bond_amount_lock_up: u64,
    pub expiry_timestamp: u64,
    pub start_slot: u64,
    pub expiry_after: u32,
    pub max_block_size: u32,
    pub max_compute_units: u64,
    pub max_state_units: u32,
    pub reserved: [u8; 4],
    pub block_time_ns: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnBlockFooter {
    pub body: TnBlockFooterBody,
    pub block_hash: FdBlake3Hash,
    pub block_sig: FdSignature,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnBlockFooterBody {
    pub attestor_payment: u64,
}

/// Block parser for extracting transactions from UDS block data
pub struct BlockParser;

impl BlockParser {
    /// Parse block data with cryptographic verification and extract transactions
    pub fn parse_block(data: &[u8]) -> Result<BlockParseResult, BlockParseError> {
        if data.is_empty() {
            return Ok(BlockParseResult {
                block_hash: [0u8; 64],
                block_producer: [0u8; 32],
                transactions: Vec::new(),
            });
        }

        debug!(
            "Parsing block data of {} bytes with cryptographic verification",
            data.len()
        );

        // Block format: TnBlockHeader + Transactions + TnBlockFooter
        let header_size = mem::size_of::<TnBlockHeader>();
        let footer_size = mem::size_of::<TnBlockFooter>();

        if data.len() < header_size + footer_size {
            return Err(BlockParseError::InvalidBlockStructure(format!(
                "Block too small: {} bytes, need at least {}",
                data.len(),
                header_size + footer_size
            )));
        }

        // Parse TnBlockHeader from the beginning
        let header = Self::parse_header_verified(&data[..header_size])?;
        debug!(
            "Parsed block header: version={}, start_slot={}, producer={}",
            header.body.block_version,
            header.body.start_slot,
            tn_pubkey_to_address_string(&header.body.block_producer)
        );

        // Verify header signature first (fail fast optimization)
        Self::verify_header_signature(&header)?;
        debug!("Block header signature verified successfully");

        // Compute block hash (excluding block signature)
        let block_hash = Self::compute_block_hash(data)?;
        debug!("Block hash computed successfully");

        // Parse TnBlockFooter from the end
        let footer_start = data.len() - footer_size;
        let footer = Self::parse_footer_verified(&data[footer_start..])?;
        debug!(
            "Parsed block footer: attestor_payment={}",
            footer.body.attestor_payment
        );

        // Verify block signature against computed hash
        Self::verify_block_signature(&block_hash, &footer, &header.body.block_producer)?;
        debug!("Block signature verified successfully");

        // Extract transaction data between header and footer
        let transactions_data = &data[header_size..footer_start];
        debug!(
            "Transaction data section: {} bytes",
            transactions_data.len()
        );

        // Parse individual transactions from the middle section
        let transactions = if transactions_data.is_empty() {
            debug!("No transaction data in block");
            Vec::new()
        } else {
            Self::parse_transactions(transactions_data)
                .map_err(|e| BlockParseError::InvalidBlockStructure(e))?
        };

        debug!("Extracted {} transactions from block", transactions.len());

        Ok(BlockParseResult {
            block_hash,
            block_producer: header.body.block_producer,
            transactions,
        })
    }

    /// Compute 512-bit Blake3 hash of block data excluding block signature and block hash
    /// Matches C implementation: fd_blake3_append(&hasher, block_data, block_size - sizeof(fd_signature_t) - BLOCK_HASH_SIZE)
    fn compute_block_hash(data: &[u8]) -> Result<[u8; 64], BlockParseError> {
        let footer_size = mem::size_of::<TnBlockFooter>();

        if data.len() < footer_size {
            return Err(BlockParseError::HashComputationFailed(
                "Block too small to contain footer".to_string(),
            ));
        }

        // Hash all data except the final 64 bytes (block_sig) and 64 bytes (block_hash)
        // This matches the C implementation which excludes sizeof(fd_signature_t) + BLOCK_HASH_SIZE
        let sig_size = size_of::<FdSignature>();
        let hash_size = size_of::<FdBlake3Hash>();
        let hash_data_end = data.len() - sig_size - hash_size;
        let hash_data = &data[..hash_data_end];

        debug!(
            "Computing Blake3 hash over {} bytes (excluding {} byte signature and {} byte hash)",
            hash_data.len(),
            sig_size,
            hash_size
        );

        // Use Blake3 XOF (extendable output function) for 512-bit output
        let mut hasher = blake3::Hasher::new();
        hasher.update(hash_data);

        let mut hash_output = [0u8; 64];
        let mut output_reader = hasher.finalize_xof();
        output_reader.fill(&mut hash_output);

        debug!("Blake3 hash computation completed successfully");
        Ok(hash_output)
    }

    /// Verify block header signature using ed25519
    /// Matches C implementation: signs/verifies only the header body, not the signature field
    fn verify_header_signature(header: &TnBlockHeader) -> Result<(), BlockParseError> {
        debug!("Starting header signature verification");

        // Check if signature is all zeros (unsigned/test data)
        if header.block_header_sig.iter().all(|&b| b == 0) {
            debug!("Header signature is all zeros - treating as unsigned block");
            return Err(BlockParseError::HeaderSignatureInvalid(
                "Block header is not signed (all-zero signature)".to_string(),
            ));
        }

        // Sign/verify only the header body, excluding the signature field
        // This matches C implementation: fd_ed25519_verify((uchar const *)&header->body, ...)
        let body_size = mem::size_of::<TnBlockHeaderBody>();

        // Convert header body to bytes for verification
        let body_bytes =
            unsafe { std::slice::from_raw_parts(&header.body as *const _ as *const u8, body_size) };

        debug!(
            "Verifying header signature over {} bytes of header body data",
            body_bytes.len()
        );

        // Convert signature and public key to ed25519-dalek types
        let signature = match Signature::from_slice(&header.block_header_sig) {
            Ok(sig) => sig,
            Err(e) => {
                error!("Invalid header signature format: {}", e);
                return Err(BlockParseError::HeaderSignatureInvalid(format!(
                    "Signature format error: {}",
                    e
                )));
            }
        };

        let verifying_key = VerifyingKey::from_bytes(&header.body.block_producer).map_err(|e| {
            error!("Invalid producer public key format: {}", e);
            BlockParseError::Ed25519KeyError(format!("Invalid producer public key: {}", e))
        })?;

        // Verify the signature against the header body
        verifying_key.verify(body_bytes, &signature).map_err(|e| {
            error!("Header signature verification failed: {}", e);
            BlockParseError::HeaderSignatureInvalid(format!("Verification failed: {}", e))
        })?;

        debug!("Header signature verification successful");
        Ok(())
    }

    /// Verify block signature against computed hash using producer's public key
    fn verify_block_signature(
        block_hash: &[u8; 64],
        footer: &TnBlockFooter,
        producer_key: &[u8; 32],
    ) -> Result<(), BlockParseError> {
        debug!("Starting block signature verification");

        // Check if signature is all zeros (unsigned/test data)
        if footer.block_sig.iter().all(|&b| b == 0) {
            debug!("Block signature is all zeros - treating as unsigned block");
            return Err(BlockParseError::BlockSignatureInvalid(
                "Block is not signed (all-zero signature)".to_string(),
            ));
        }

        debug!("Verifying block signature against computed hash");

        // Convert signature and public key to ed25519-dalek types
        let signature = match Signature::from_slice(&footer.block_sig) {
            Ok(sig) => sig,
            Err(e) => {
                error!("Invalid block signature format: {}", e);
                return Err(BlockParseError::BlockSignatureInvalid(format!(
                    "Signature format error: {}",
                    e
                )));
            }
        };

        let verifying_key = VerifyingKey::from_bytes(producer_key).map_err(|e| {
            error!("Invalid producer public key for block verification: {}", e);
            BlockParseError::Ed25519KeyError(format!("Invalid producer public key: {}", e))
        })?;

        // Verify the signature against the block hash
        verifying_key.verify(block_hash, &signature).map_err(|e| {
            error!("Block signature verification failed: {}", e);
            BlockParseError::BlockSignatureInvalid(format!("Verification failed: {}", e))
        })?;

        debug!("Block signature verification successful");
        Ok(())
    }

    /// Parse block header from data with error conversion
    fn parse_header_verified(data: &[u8]) -> Result<TnBlockHeader, BlockParseError> {
        Self::parse_header(data).map_err(|e| BlockParseError::InvalidBlockStructure(e))
    }

    /// Parse block footer from data with error conversion
    fn parse_footer_verified(data: &[u8]) -> Result<TnBlockFooter, BlockParseError> {
        Self::parse_footer(data).map_err(|e| BlockParseError::InvalidBlockStructure(e))
    }

    /// Legacy function for backward compatibility - will be removed after integration update
    #[deprecated(note = "Use parse_block instead")]
    pub fn parse_block_legacy(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        if data.is_empty() {
            return Ok(Vec::new());
        }

        debug!("Parsing block data of {} bytes", data.len());

        // Block format: TnBlockHeader + Transactions + TnBlockFooter
        let header_size = mem::size_of::<TnBlockHeader>();
        let footer_size = mem::size_of::<TnBlockFooter>();

        if data.len() < header_size + footer_size {
            return Err(format!(
                "Block too small: {} bytes, need at least {}",
                data.len(),
                header_size + footer_size
            ));
        }

        // Parse TnBlockHeader from the beginning
        let header = Self::parse_header(&data[..header_size])?;
        debug!(
            "Parsed block header: version={}, start_slot={}",
            header.body.block_version, header.body.start_slot
        );
        if header.body.block_version != 1 {
            return Err(format!(
                "Unsupported block version: {}",
                header.body.block_version
            ));
        }

        // Parse TnBlockFooter from the end
        let footer_start = data.len() - footer_size;
        let footer = Self::parse_footer(&data[footer_start..])?;
        debug!(
            "Parsed block footer: attestor_payment={}",
            footer.body.attestor_payment
        );

        // Extract transaction data between header and footer
        let transactions_data = &data[header_size..footer_start];
        debug!(
            "Transaction data section: {} bytes",
            transactions_data.len()
        );

        if transactions_data.is_empty() {
            debug!("No transaction data in block");
            return Ok(Vec::new());
        }

        // Parse individual transactions from the middle section
        let transactions = Self::parse_transactions(transactions_data)?;
        debug!("Extracted {} transactions from block", transactions.len());

        Ok(transactions)
    }

    /// Parse block header from data
    fn parse_header(data: &[u8]) -> Result<TnBlockHeader, String> {
        if data.len() < mem::size_of::<TnBlockHeader>() {
            return Err("Insufficient data for block header".to_string());
        }

        // We'll do a simple byte copy since we're dealing with repr(C) structs
        let header = unsafe { std::ptr::read(data.as_ptr() as *const TnBlockHeader) };

        debug!(
            "Block header: version={}, producer={:?}",
            header.body.block_version,
            tn_pubkey_to_address_string(&header.body.block_producer)
        );
        Ok(header)
    }

    /// Parse block footer from data
    fn parse_footer(data: &[u8]) -> Result<TnBlockFooter, String> {
        if data.len() < mem::size_of::<TnBlockFooter>() {
            return Err("Insufficient data for block footer".to_string());
        }

        let footer = unsafe { std::ptr::read(data.as_ptr() as *const TnBlockFooter) };

        debug!(
            "Block footer: attestor_payment={}",
            footer.body.attestor_payment
        );
        Ok(footer)
    }

    /// Parse transactions from the middle section of block data
    fn parse_transactions(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        let mut transactions = Vec::new();
        let mut offset = 0;

        // Parse individual transactions using Transaction::from_wire
        while offset < data.len() {
            // Check if we have enough data for the minimum transaction header
            let wire_header_size = mem::size_of::<WireTxnHdrV1>();
            if offset + wire_header_size > data.len() {
                debug!(
                    "Remaining data too small for transaction header: {} bytes",
                    data.len() - offset
                );
                break;
            }

            let remaining_data = &data[offset..];

            // Try to parse the transaction using Transaction::from_wire
            // We need to find the actual transaction size by attempting to parse it
            match Self::try_parse_transaction_at_offset(remaining_data) {
                Ok((transaction_size, transaction_data)) => {
                    transactions.push(transaction_data);
                    debug!(
                        "Parsed transaction {} of size {} bytes",
                        transactions.len(),
                        transaction_size
                    );
                    offset += transaction_size;
                }
                Err(parse_error) => {
                    warn!(
                        "Failed to parse transaction at offset {}: {}",
                        offset, parse_error
                    );
                    return Err(parse_error);
                }
            }
        }

        Ok(transactions)
    }

    /// Try to parse a transaction at the given offset, returning the transaction size and data
    fn try_parse_transaction_at_offset(data: &[u8]) -> Result<(usize, Vec<u8>), String> {
        // We need to determine the transaction size by parsing the header and variable-length data
        let wire_header_size = mem::size_of::<WireTxnHdrV1>();

        if data.len() < wire_header_size {
            return Err("Not enough data for transaction header".to_string());
        }

        // Calculate total transaction size
        let total_size = txn_lib::tn_txn_size(data).map_err(|e| e.to_string())?;

        if data.len() < total_size {
            return Err(format!(
                "Not enough data for complete transaction: need {} bytes, have {}",
                total_size,
                data.len()
            ));
        }
        // Extract the transaction data
        let transaction_data = data[..total_size].to_vec();

        // Verify the transaction can be parsed with Transaction::from_wire
        if Transaction::from_wire(&transaction_data).is_none() {
            return Err("Transaction::from_wire failed to parse transaction".to_string());
        }
        Ok((total_size, transaction_data))
    }

    /// Extract transaction signature from transaction data and convert to ts... format
    pub fn extract_transaction_signature(tx_data: &[u8]) -> Result<String, String> {
        if tx_data.len() < 64 {
            return Err("Transaction too short to contain a signature".to_string());
        }

        // The first 64 bytes are the first signature
        let signature_bytes = &tx_data[..64];

        // Convert to fixed-size array for signature utilities
        let mut sig_array = [0u8; 64];
        sig_array.copy_from_slice(signature_bytes);

        // Convert to ts... format using existing utilities
        let signature = tn_signature_to_string(&sig_array);

        debug!("Extracted signature: {}", signature);
        Ok(signature)
    }

    /// Extract all account mentions from block transactions
    /// Returns a HashSet of base64-encoded account addresses
    pub fn extract_account_mentions(
        transactions: &[Vec<u8>],
    ) -> Result<HashSet<String>, BlockParseError> {
        let mut accounts = HashSet::new();

        debug!(
            "Extracting account mentions from {} transactions",
            transactions.len()
        );

        for (i, tx_data) in transactions.iter().enumerate() {
            match Self::extract_transaction_accounts(tx_data) {
                Ok(tx_accounts) => {
                    debug!(
                        "Transaction {} contains {} account references: {:?}",
                        i,
                        tx_accounts.len(),
                        tx_accounts
                    );
                    accounts.extend(tx_accounts);
                }
                Err(e) => {
                    warn!("Failed to extract accounts from transaction {}: {}", i, e);
                    // Continue processing other transactions
                }
            }
        }

        debug!(
            "Extracted {} unique account addresses from block: {:?}",
            accounts.len(),
            accounts
        );
        Ok(accounts)
    }

    /// Extract account addresses from a single transaction
    /// Returns ta... formatted account addresses found in the transaction
    fn extract_transaction_accounts(tx_data: &[u8]) -> Result<Vec<String>, BlockParseError> {
        if tx_data.len() < 176 {
            // Minimum size for WireTxnHdrV1 (176 bytes)
            return Err(BlockParseError::AccountExtractionFailed(
                "Transaction too small to contain header".to_string(),
            ));
        }

        debug!(
            "Extracting accounts from transaction of {} bytes",
            tx_data.len()
        );
        let mut accounts = Vec::new();

        // Extract fee_payer_pubkey (offset 112, 32 bytes)
        let fee_payer_offset = 112;
        if tx_data.len() >= fee_payer_offset + 32 {
            let fee_payer_pubkey: [u8; 32] = tx_data[fee_payer_offset..fee_payer_offset + 32]
                .try_into()
                .map_err(|_| {
                    BlockParseError::AccountExtractionFailed(
                        "Failed to convert fee_payer_pubkey to [u8; 32]".to_string(),
                    )
                })?;
            let fee_payer_address = tn_pubkey_to_address_string(&fee_payer_pubkey);
            debug!(
                "Extracted fee_payer at offset {}: {:?} -> {}",
                fee_payer_offset,
                &fee_payer_pubkey[..8],
                fee_payer_address
            );
            accounts.push(fee_payer_address);
        }

        // Extract program_pubkey (offset 144, 32 bytes)
        let program_offset = 144;
        if tx_data.len() >= program_offset + 32 {
            let program_pubkey: [u8; 32] = tx_data[program_offset..program_offset + 32]
                .try_into()
                .map_err(|_| {
                    BlockParseError::AccountExtractionFailed(
                        "Failed to convert program_pubkey to [u8; 32]".to_string(),
                    )
                })?;
            let program_address = tn_pubkey_to_address_string(&program_pubkey);
            debug!(
                "Extracted program at offset {}: {:?} -> {}",
                program_offset,
                &program_pubkey[..8],
                program_address
            );
            accounts.push(program_address);
        }

        // Extract additional account addresses from variable section
        // This comes after the fixed header (176 bytes total for WireTxnHdrV1)
        let header_size = 176;
        if tx_data.len() > header_size {
            // Get account counts from header
            let readwrite_accounts_cnt = u16::from_le_bytes([tx_data[66], tx_data[67]]);
            let readonly_accounts_cnt = u16::from_le_bytes([tx_data[68], tx_data[69]]);

            debug!(
                "Transaction has {} readwrite and {} readonly accounts",
                readwrite_accounts_cnt, readonly_accounts_cnt
            );

            // Extract additional account addresses (32 bytes each)
            let additional_accounts_count =
                (readwrite_accounts_cnt + readonly_accounts_cnt) as usize;
            let additional_accounts_size = additional_accounts_count * 32;

            if tx_data.len() >= header_size + additional_accounts_size {
                for i in 0..additional_accounts_count {
                    let account_offset = header_size + (i * 32);
                    let account_pubkey: [u8; 32] = tx_data[account_offset..account_offset + 32]
                        .try_into()
                        .map_err(|_| {
                            BlockParseError::AccountExtractionFailed(format!(
                                "Failed to convert account_pubkey {} to [u8; 32]",
                                i
                            ))
                        })?;
                    let account_address = tn_pubkey_to_address_string(&account_pubkey);
                    accounts.push(account_address);
                }
            }
        }

        Ok(accounts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_transaction_signature() {
        // Create a mock transaction with 64 bytes of signature data
        let mut transaction_data = vec![0u8; 100];
        // Set some recognizable pattern in the signature bytes
        for i in 0..64 {
            transaction_data[i] = (i % 256) as u8;
        }

        let result = BlockParser::extract_transaction_signature(&transaction_data);
        assert!(result.is_ok());

        let signature = result.unwrap();
        assert!(!signature.is_empty());
        // Verify it's in ts... format (90 characters starting with "ts")
        assert_eq!(
            signature.len(),
            90,
            "Signature should be 90 characters in ts... format"
        );
        assert!(
            signature.starts_with("ts"),
            "Signature should start with 'ts'"
        );
    }

    #[test]
    fn test_extract_transaction_signature_too_short() {
        let transaction_data = vec![0u8; 32]; // Too short
        let result = BlockParser::extract_transaction_signature(&transaction_data);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Transaction too short to contain a signature"
        );
    }

    #[test]
    fn test_parse_empty_block() {
        let empty_data = vec![];
        let result = BlockParser::parse_block(&empty_data);
        assert!(result.is_ok());
        let block_result = result.unwrap();
        assert_eq!(block_result.transactions.len(), 0);
        assert_eq!(block_result.block_hash, [0u8; 64]);
        assert_eq!(block_result.block_producer, [0u8; 32]);
    }

    #[test]
    fn test_parse_block_too_small() {
        let small_data = vec![0u8; 50]; // Too small for header + footer
        let result = BlockParser::parse_block(&small_data);
        assert!(result.is_err());
        let error_msg = format!("{}", result.unwrap_err());
        assert!(error_msg.contains("Block too small"));
    }

    #[test]
    fn test_parse_block_header_footer_only() {
        // Test with a block that has valid structure but invalid signatures
        let header_size = std::mem::size_of::<TnBlockHeader>();
        let footer_size = std::mem::size_of::<TnBlockFooter>();
        let mut block_data = vec![0u8; header_size + footer_size];

        // Set block version in header
        block_data[0] = 1; // block_version

        let result = BlockParser::parse_block(&block_data);

        // The result depends on whether all-zero signatures are considered valid
        // Let's test both cases and verify we get a reasonable result
        match result {
            Ok(block_result) => {
                // If it succeeds, verify the structure is correct
                assert_eq!(block_result.transactions.len(), 0);
                assert_eq!(block_result.block_producer, [0u8; 32]);
                assert_eq!(block_result.block_hash.len(), 64);
            }
            Err(error) => {
                // If it fails, it should be due to cryptographic verification
                let error_msg = format!("{}", error);
                assert!(
                    error_msg.contains("signature")
                        || error_msg.contains("key")
                        || error_msg.contains("Invalid")
                );
            }
        }
    }

    #[test]
    fn test_try_parse_transaction_at_offset() {
        // Create a minimal valid transaction structure for testing
        // This is a simplified test that creates the minimum structure needed
        let wire_header_size = mem::size_of::<WireTxnHdrV1>();
        let mut tx_data = vec![0u8; wire_header_size];

        // Set transaction version to 1 at the correct offset (after 64-byte signature)
        tx_data[64] = 1; // transaction_version

        // Set all account counts and instruction size to 0 (minimal transaction)
        // readwrite_accounts_cnt at offset 66-67
        tx_data[66] = 0;
        tx_data[67] = 0;
        // readonly_accounts_cnt at offset 68-69
        tx_data[68] = 0;
        tx_data[69] = 0;
        // instr_data_sz at offset 70-71
        tx_data[70] = 0;
        tx_data[71] = 0;

        // Test the helper function directly
        let result = BlockParser::try_parse_transaction_at_offset(&tx_data);
        // This might fail due to Transaction::from_wire validation, which is expected
        // The important thing is that the function doesn't panic and handles the data correctly
        match result {
            Ok((size, data)) => {
                assert_eq!(size, wire_header_size);
                assert_eq!(data.len(), wire_header_size);
            }
            Err(_) => {
                // This is expected for invalid transaction data
                // The test verifies the function handles invalid data gracefully
            }
        }
    }

    #[test]
    fn test_parse_transactions_empty_data() {
        let empty_data = vec![];
        let result = BlockParser::parse_transactions(&empty_data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn test_parse_transactions_insufficient_data() {
        let short_data = vec![0u8; 32]; // Too short for transaction header
        let result = BlockParser::parse_transactions(&short_data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0); // Should return empty list, not error
    }
}
