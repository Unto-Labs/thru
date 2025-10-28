//! Transaction library: normal Rust struct, signing, serialization, accessors
//!

pub type TnPubkey = [u8; 32];
pub type TnHash = [u8; 32];
pub type TnSignature = [u8; 64];

use crate::{StateProofType, tn_state_proof::StateProof};
use bytemuck::{Pod, Zeroable, bytes_of, from_bytes};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

pub const TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT: u8 = 0; // Bit position (matching C #define TN_TXN_FLAG_HAS_FEE_PAYER_PROOF (0U))
pub const TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT_BIT: u8 = 1; // Bit position (matching C #define TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT (1U))

// State proof type constants (matching C implementation)
pub const TN_STATE_PROOF_TYPE_EXISTING: u64 = 0x0;
pub const TN_STATE_PROOF_TYPE_UPDATING: u64 = 0x1;
pub const TN_STATE_PROOF_TYPE_CREATION: u64 = 0x2;

// State proof header size constants
pub const TN_STATE_PROOF_HDR_SIZE: usize = 40; // 8 bytes type_slot + 32 bytes path_bitset
pub const TN_ACCOUNT_META_FOOTPRINT: usize = 64; // Size of tn_account_meta_t (matching C sizeof)

// TEMPORARY: Minimal local RpcError for test pass (remove when shared error type is available)
#[derive(Debug, PartialEq)]
pub enum RpcError {
    InvalidTransactionSize { size: usize, max_size: usize },
    TrailingBytes { expected: usize, found: usize },
    TooManyAccounts { count: usize, max_count: usize },
    InvalidTransactionSignature,
    InvalidParams(&'static str),
    InvalidFormat,
    InvalidVersion,
    InvalidFlags,
    InvalidFeePayerStateProofType,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RpcError::InvalidTransactionSize { size, max_size } => {
                write!(
                    f,
                    "Transaction size {} exceeds maximum allowed size {}",
                    size, max_size
                )
            }
            RpcError::TrailingBytes { expected, found } => {
                write!(
                    f,
                    "Transaction has trailing bytes: expected {} bytes, found {} bytes",
                    expected, found
                )
            }
            RpcError::TooManyAccounts { count, max_count } => {
                write!(
                    f,
                    "Too many accounts: {} exceeds maximum {}",
                    count, max_count
                )
            }
            RpcError::InvalidTransactionSignature => {
                write!(f, "Invalid transaction signature")
            }
            RpcError::InvalidParams(msg) => {
                write!(f, "Invalid parameters: {}", msg)
            }
            RpcError::InvalidFormat => {
                write!(f, "Invalid transaction format")
            }
            RpcError::InvalidVersion => {
                write!(f, "Invalid transaction version")
            }
            RpcError::InvalidFlags => {
                write!(f, "Invalid transaction flags")
            }
            RpcError::InvalidFeePayerStateProofType => {
                write!(f, "Invalid fee payer state proof type")
            }
        }
    }
}

impl RpcError {
    pub fn invalid_transaction_size(size: usize, max_size: usize) -> Self {
        Self::InvalidTransactionSize { size, max_size }
    }
    pub fn trailing_bytes(expected: usize, found: usize) -> Self {
        Self::TrailingBytes { expected, found }
    }
    pub fn too_many_accounts(count: usize, max_count: usize) -> Self {
        Self::TooManyAccounts { count, max_count }
    }
    pub fn invalid_transaction_signature() -> Self {
        Self::InvalidTransactionSignature
    }
    pub fn invalid_params(msg: &'static str) -> Self {
        Self::InvalidParams(msg)
    }
    pub fn invalid_format() -> Self {
        Self::InvalidFormat
    }
    pub fn invalid_version() -> Self {
        Self::InvalidVersion
    }
    pub fn invalid_flags() -> Self {
        Self::InvalidFlags
    }
    pub fn invalid_fee_payer_state_proof_type() -> Self {
        Self::InvalidFeePayerStateProofType
    }
}

/// On-wire transaction header (matches TnTxnHdrV1 layout)
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct WireTxnHdrV1 {
    pub fee_payer_signature: [u8; 64],
    pub transaction_version: u8,
    pub flags: u8,
    pub readwrite_accounts_cnt: u16,
    pub readonly_accounts_cnt: u16,
    pub instr_data_sz: u16,
    pub req_compute_units: u32,
    pub req_state_units: u16,
    pub req_memory_units: u16,
    pub fee: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub expiry_after: u32,
    pub padding_0: [u8; 4],
    pub fee_payer_pubkey: [u8; 32],
    pub program_pubkey: [u8; 32],
}

impl Default for WireTxnHdrV1 {
    fn default() -> Self {
        Self {
            fee_payer_signature: [0u8; 64],
            transaction_version: 0,
            flags: 0,
            readwrite_accounts_cnt: 0,
            readonly_accounts_cnt: 0,
            instr_data_sz: 0,
            req_compute_units: 0,
            req_state_units: 0,
            req_memory_units: 0,
            fee: 0,
            nonce: 0,
            start_slot: 0,
            expiry_after: 0,
            padding_0: [0u8; 4],
            fee_payer_pubkey: [0u8; 32],
            program_pubkey: [0u8; 32],
        }
    }
}

// Manual Pod implementation to avoid derive issues
unsafe impl Pod for WireTxnHdrV1 {}
unsafe impl Zeroable for WireTxnHdrV1 {}

/// Normal Rust struct for transaction construction
#[derive(Clone, Debug, Default)]
pub struct Transaction {
    // Core transaction fields
    pub fee_payer: TnPubkey, // [u8; 32] - who pays the fee
    pub program: TnPubkey,   // [u8; 32] - target program

    // Account lists (optional)
    pub rw_accs: Option<Vec<TnPubkey>>, // read-write accounts
    pub r_accs: Option<Vec<TnPubkey>>,  // read-only accounts

    // Instruction data (optional)
    pub instructions: Option<Vec<u8>>, // instruction bytes

    // Transaction parameters
    pub fee: u64,               // transaction fee
    pub req_compute_units: u32, // requested compute units
    pub req_state_units: u16,   // requested state units
    pub req_memory_units: u16,  // requested memory units
    pub expiry_after: u32,      // expiry time offset
    pub start_slot: u64,        // starting slot
    pub nonce: u64,             // transaction nonce
    pub flags: u8,              // transaction flags

    // Signature (optional until signed)
    pub signature: Option<TnSignature>, // [u8; 64] - Ed25519 signature

    // Fee payer state proof (optional)
    pub fee_payer_state_proof: Option<StateProof>, // State proof for fee payer account

    pub fee_payer_account_meta_raw: Option<Vec<u8>>,
}

impl Transaction {
    /// Create a new unsigned transaction
    pub fn new(fee_payer: TnPubkey, program: TnPubkey, fee: u64, nonce: u64) -> Self {
        Self {
            fee_payer,
            program,
            rw_accs: None,
            r_accs: None,
            instructions: None,
            fee,
            req_compute_units: 0,
            req_state_units: 0,
            req_memory_units: 0,
            expiry_after: 0,
            start_slot: 0,
            nonce,
            flags: 0,
            signature: None,
            fee_payer_state_proof: None,
            fee_payer_account_meta_raw: None,
        }
    }

    pub fn has_fee_payer_state_proof(&self) -> bool {
        (self.flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT)) != 0
    }
    pub fn may_compress_account(&self) -> bool {
        (self.flags & (1 << TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT_BIT)) != 0
    }

    pub fn get_signature(&self) -> Option<crate::Signature> {
        if let Some(sig) = &self.signature {
            return Some(crate::Signature::from_bytes(&sig));
        }
        None
    }

    pub fn with_may_compress_account(mut self) -> Self {
        self.flags |= 1 << TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT_BIT;
        self
    }

    /// Builder method: set fee payer state proof
    pub fn with_fee_payer_state_proof(mut self, state_proof: &StateProof) -> Self {
        self.fee_payer_state_proof = Some(state_proof.clone());
        // Set the flag bit to indicate presence of state proof
        self.flags |= 1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT;
        self
    }

    /// Builder method: set fee payer account meta as raw bytes
    pub fn with_fee_payer_account_meta_raw(mut self, account_meta_raw: Vec<u8>) -> Self {
        self.fee_payer_account_meta_raw = Some(account_meta_raw);
        self
    }

    /// Builder method: remove fee payer state proof
    pub fn without_fee_payer_state_proof(mut self) -> Self {
        self.fee_payer_state_proof = None;
        // Clear the flag bit to indicate absence of state proof
        self.flags &= !(1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT);
        self
    }

    /// Builder method: add read-write accounts
    pub fn with_rw_accounts(mut self, accounts: Vec<TnPubkey>) -> Self {
        self.rw_accs = Some(accounts);
        self
    }

    /// Builder method: add read-only accounts
    pub fn with_r_accounts(mut self, accounts: Vec<TnPubkey>) -> Self {
        self.r_accs = Some(accounts);
        self
    }

    /// Builder method: add a single read-write account
    pub fn add_rw_account(mut self, account: TnPubkey) -> Self {
        match self.rw_accs {
            Some(ref mut accounts) => accounts.push(account),
            None => self.rw_accs = Some(vec![account]),
        }
        self
    }

    /// Builder method: add a single read-only account
    pub fn add_r_account(mut self, account: TnPubkey) -> Self {
        match self.r_accs {
            Some(ref mut accounts) => accounts.push(account),
            None => self.r_accs = Some(vec![account]),
        }
        self
    }

    /// Builder method: add instruction data
    pub fn with_instructions(mut self, instructions: Vec<u8>) -> Self {
        self.instructions = Some(instructions);
        self
    }

    /// Builder method: set compute units
    pub fn with_compute_units(mut self, units: u32) -> Self {
        self.req_compute_units = units;
        self
    }

    /// Builder method: set state units
    pub fn with_state_units(mut self, units: u16) -> Self {
        self.req_state_units = units;
        self
    }

    /// Builder method: set memory units
    pub fn with_memory_units(mut self, units: u16) -> Self {
        self.req_memory_units = units;
        self
    }

    /// Builder method: set expiry
    pub fn with_expiry_after(mut self, expiry: u32) -> Self {
        self.expiry_after = expiry;
        self
    }

    /// Builder method: set nonce
    pub fn with_nonce(mut self, nonce: u64) -> Self {
        self.nonce = nonce;
        self
    }

    /// Builder method: set start slot
    pub fn with_start_slot(mut self, slot: u64) -> Self {
        self.start_slot = slot;
        self
    }

    /// Sign the transaction with a 32-byte Ed25519 private key
    pub fn sign(&mut self, private_key: &[u8; 32]) -> Result<(), Box<dyn std::error::Error>> {
        let signing_key = SigningKey::from_bytes(private_key);
        // Sign the wire format bytes (excluding signature field)
        let wire_bytes = self.to_wire_for_signing();
        let sig = signing_key.sign(&wire_bytes);
        self.signature = Some(sig.to_bytes());
        Ok(())
    }

    /// Verify the transaction signature
    pub fn verify(&self) -> bool {
        if let Some(sig_bytes) = &self.signature {
            if let Ok(verifying_key) = VerifyingKey::from_bytes(&self.fee_payer) {
                let sig = Signature::from_bytes(sig_bytes);
                // Verify against the wire format bytes (excluding signature field)
                let wire_bytes = self.to_wire_for_signing();
                return verifying_key.verify(&wire_bytes, &sig).is_ok();
            }
        }
        false
    }

    /// Create wire format for signing (excluding signature field)
    fn to_wire_for_signing(&self) -> Vec<u8> {
        // Zero out all bytes first to ensure deterministic padding
        let mut wire: WireTxnHdrV1 = unsafe { core::mem::zeroed() };
        // Don't set fee_payer_signature - it will be excluded from signing
        wire.transaction_version = 1;
        wire.flags = self.flags;
        wire.readwrite_accounts_cnt = self.rw_accs.as_ref().map_or(0, |v| v.len() as u16);
        wire.readonly_accounts_cnt = self.r_accs.as_ref().map_or(0, |v| v.len() as u16);
        wire.instr_data_sz = self.instructions.as_ref().map_or(0, |v| v.len() as u16);
        wire.req_compute_units = self.req_compute_units;
        wire.req_state_units = self.req_state_units;
        wire.req_memory_units = self.req_memory_units;
        wire.expiry_after = self.expiry_after;
        wire.fee = self.fee;
        wire.nonce = self.nonce;
        wire.start_slot = self.start_slot;
        wire.fee_payer_pubkey = self.fee_payer;
        wire.program_pubkey = self.program;

        let wire_bytes = bytes_of(&wire);
        // Skip the first 64 bytes (fee_payer_signature) and include the rest
        let mut result = wire_bytes[64..].to_vec();

        // Append variable-length data
        if let Some(ref rw_accs) = self.rw_accs {
            for acc in rw_accs {
                result.extend_from_slice(acc);
            }
        }

        if let Some(ref r_accs) = self.r_accs {
            for acc in r_accs {
                result.extend_from_slice(acc);
            }
        }

        if let Some(ref instructions) = self.instructions {
            result.extend_from_slice(instructions);
        }

        // Append state proof if present
        if let Some(ref state_proof) = self.fee_payer_state_proof {
            result.extend_from_slice(&state_proof.to_wire());
        }

        // Use raw account meta if available, otherwise use structured account meta
        if let Some(ref fee_payer_account_meta_raw) = self.fee_payer_account_meta_raw {
            result.extend_from_slice(fee_payer_account_meta_raw);
        }

        result
    }

    /// Serialize to on-wire format (WireTxnHdrV1)
    pub fn to_wire(&self) -> Vec<u8> {
        let mut wire = WireTxnHdrV1::default();
        if let Some(sig) = &self.signature {
            wire.fee_payer_signature = *sig;
        }
        wire.transaction_version = 1;
        wire.flags = self.flags;
        wire.readwrite_accounts_cnt = self.rw_accs.as_ref().map_or(0, |v| v.len() as u16);
        wire.readonly_accounts_cnt = self.r_accs.as_ref().map_or(0, |v| v.len() as u16);
        wire.instr_data_sz = self.instructions.as_ref().map_or(0, |v| v.len() as u16);
        wire.req_compute_units = self.req_compute_units;
        wire.req_state_units = self.req_state_units;
        wire.req_memory_units = self.req_memory_units;
        wire.expiry_after = self.expiry_after;
        wire.fee = self.fee;
        wire.nonce = self.nonce;
        wire.start_slot = self.start_slot;
        wire.fee_payer_pubkey = self.fee_payer;
        wire.program_pubkey = self.program;

        let mut result = bytes_of(&wire).to_vec();

        // Append variable-length data
        if let Some(ref rw_accs) = self.rw_accs {
            for acc in rw_accs {
                result.extend_from_slice(acc);
            }
        }

        if let Some(ref r_accs) = self.r_accs {
            for acc in r_accs {
                result.extend_from_slice(acc);
            }
        }

        if let Some(ref instructions) = self.instructions {
            result.extend_from_slice(instructions);
        }

        // Append state proof if present (after instruction data)
        if let Some(ref state_proof) = self.fee_payer_state_proof {
            result.extend_from_slice(&state_proof.to_wire());
        }

        // Use raw account meta if available, otherwise use structured account meta
        if let Some(ref fee_payer_account_meta_raw) = self.fee_payer_account_meta_raw {
            result.extend_from_slice(fee_payer_account_meta_raw);
        }

        result
    }

    /// Deserialize from on-wire format (WireTxnHdrV1)
    pub fn from_wire(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < core::mem::size_of::<WireTxnHdrV1>() {
            return None;
        }

        let wire: &WireTxnHdrV1 = from_bytes(&bytes[0..core::mem::size_of::<WireTxnHdrV1>()]);
        let mut offset = core::mem::size_of::<WireTxnHdrV1>();

        // Parse read-write accounts
        let rw_accs = if wire.readwrite_accounts_cnt > 0 {
            let mut accounts = Vec::new();
            for _ in 0..wire.readwrite_accounts_cnt {
                if offset + 32 > bytes.len() {
                    return None;
                }
                let mut acc = [0u8; 32];
                acc.copy_from_slice(&bytes[offset..offset + 32]);
                accounts.push(acc);
                offset += 32;
            }
            Some(accounts)
        } else {
            None
        };

        // Parse read-only accounts
        let r_accs = if wire.readonly_accounts_cnt > 0 {
            let mut accounts = Vec::new();
            for _ in 0..wire.readonly_accounts_cnt {
                if offset + 32 > bytes.len() {
                    return None;
                }
                let mut acc = [0u8; 32];
                acc.copy_from_slice(&bytes[offset..offset + 32]);
                accounts.push(acc);
                offset += 32;
            }
            Some(accounts)
        } else {
            None
        };

        // Parse instructions
        let instructions = if wire.instr_data_sz > 0 {
            if offset + wire.instr_data_sz as usize > bytes.len() {
                return None;
            }
            let instr = bytes[offset..offset + wire.instr_data_sz as usize].to_vec();
            offset += wire.instr_data_sz as usize;
            Some(instr)
        } else {
            None
        };

        let mut fee_payer_account_meta_raw: Option<Vec<u8>> = None;
        // Parse state proof if present
        let fee_payer_state_proof = if has_fee_payer_state_proof(wire.flags) {
            if offset >= bytes.len() {
                return None;
            }
            let state_proof_bytes = &bytes[offset..];
            if let Some(state_proof) = StateProof::from_wire(state_proof_bytes) {
                offset += state_proof.footprint();
                if state_proof.header.proof_type == StateProofType::Existing {
                    if offset + TN_ACCOUNT_META_FOOTPRINT > bytes.len() {
                        return None;
                    }
                    let account_meta_bytes = &bytes[offset..offset + TN_ACCOUNT_META_FOOTPRINT];
                    fee_payer_account_meta_raw = Some(account_meta_bytes.to_vec());
                    offset += TN_ACCOUNT_META_FOOTPRINT;
                }
                Some(state_proof)
            } else {
                return None;
            }
        } else {
            None
        };

        // Verify we've consumed all bytes
        if offset != bytes.len() {
            log::warn!(
                "Transaction::from_wire: offset != bytes.len() ({} != {})",
                offset,
                bytes.len()
            );
            return None;
        }

        Some(Transaction {
            fee_payer: wire.fee_payer_pubkey,
            program: wire.program_pubkey,
            rw_accs,
            r_accs,
            instructions,
            flags: wire.flags,
            fee: wire.fee,
            req_compute_units: wire.req_compute_units,
            req_state_units: wire.req_state_units,
            req_memory_units: wire.req_memory_units,
            expiry_after: wire.expiry_after,
            start_slot: wire.start_slot,
            nonce: wire.nonce,
            signature: Some(wire.fee_payer_signature),
            fee_payer_state_proof,
            fee_payer_account_meta_raw,
        })
    }

    /// Accessor: read a field from serialized bytes by name
    pub fn get_field_from_wire(bytes: &[u8], field: &str) -> Option<Vec<u8>> {
        if bytes.len() < core::mem::size_of::<WireTxnHdrV1>() {
            return None;
        }
        let wire: &WireTxnHdrV1 = from_bytes(&bytes[0..core::mem::size_of::<WireTxnHdrV1>()]);
        match field {
            "fee_payer_signature" => Some(wire.fee_payer_signature.to_vec()),
            "transaction_version" => Some(vec![wire.transaction_version]),
            "flags" => Some(vec![wire.flags]),
            "readwrite_accounts_cnt" => Some(wire.readwrite_accounts_cnt.to_le_bytes().to_vec()),
            "readonly_accounts_cnt" => Some(wire.readonly_accounts_cnt.to_le_bytes().to_vec()),
            "instr_data_sz" => Some(wire.instr_data_sz.to_le_bytes().to_vec()),
            "req_compute_units" => Some(wire.req_compute_units.to_le_bytes().to_vec()),
            "req_state_units" => Some(wire.req_state_units.to_le_bytes().to_vec()),
            "req_memory_units" => Some(wire.req_memory_units.to_le_bytes().to_vec()),
            "expiry_after" => Some(wire.expiry_after.to_le_bytes().to_vec()),
            "fee" => Some(wire.fee.to_le_bytes().to_vec()),
            "nonce" => Some(wire.nonce.to_le_bytes().to_vec()),
            "start_slot" => Some(wire.start_slot.to_le_bytes().to_vec()),
            "fee_payer_pubkey" => Some(wire.fee_payer_pubkey.to_vec()),
            "program_pubkey" => Some(wire.program_pubkey.to_vec()),
            _ => None,
        }
    }
}

/// Helper function to check if transaction has fee payer state proof
fn has_fee_payer_state_proof(flags: u8) -> bool {
    (flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT)) != 0
}

/// Helper function to extract state proof type from header
fn extract_state_proof_type(type_slot: u64) -> u64 {
    (type_slot >> 62) & 0x3 // Extract top 2 bits
}

/// Helper function to calculate state proof footprint from header
fn calculate_state_proof_footprint(state_proof_data: &[u8]) -> Result<usize, RpcError> {
    if state_proof_data.len() < TN_STATE_PROOF_HDR_SIZE {
        return Err(RpcError::invalid_format());
    }

    // Extract type_slot (first 8 bytes)
    let type_slot = u64::from_le_bytes([
        state_proof_data[0],
        state_proof_data[1],
        state_proof_data[2],
        state_proof_data[3],
        state_proof_data[4],
        state_proof_data[5],
        state_proof_data[6],
        state_proof_data[7],
    ]);

    // Extract path_bitset (next 32 bytes) and count set bits
    let mut sibling_hash_cnt = 0u32;
    for i in 0..4 {
        let start = 8 + i * 8;
        let word = u64::from_le_bytes([
            state_proof_data[start],
            state_proof_data[start + 1],
            state_proof_data[start + 2],
            state_proof_data[start + 3],
            state_proof_data[start + 4],
            state_proof_data[start + 5],
            state_proof_data[start + 6],
            state_proof_data[start + 7],
        ]);
        sibling_hash_cnt += word.count_ones();
    }

    let proof_type = extract_state_proof_type(type_slot);
    let body_sz = (proof_type + sibling_hash_cnt as u64) * 32; // Each hash is 32 bytes

    Ok(TN_STATE_PROOF_HDR_SIZE + body_sz as usize)
}

pub fn tn_txn_size(bytes: &[u8]) -> Result<usize, RpcError> {
    // Basic size checks
    if bytes.len() < core::mem::size_of::<WireTxnHdrV1>() {
        return Err(RpcError::invalid_format());
    }

    // Parse the header
    // Use read_unaligned to safely read from potentially unaligned memory
    let hdr: WireTxnHdrV1 =
        unsafe { std::ptr::read_unaligned(bytes.as_ptr() as *const WireTxnHdrV1) };
    let hdr = &hdr;
    let mut offset = core::mem::size_of::<WireTxnHdrV1>();

    // Calculate accounts size
    let accs_sz = (hdr.readwrite_accounts_cnt as usize + hdr.readonly_accounts_cnt as usize) * 32;
    if offset + accs_sz > bytes.len() {
        return Err(RpcError::invalid_format());
    }
    offset += accs_sz;

    // Calculate instruction data size
    let instr_sz = hdr.instr_data_sz as usize;
    if offset + instr_sz > bytes.len() {
        return Err(RpcError::invalid_format());
    }
    offset += instr_sz;

    // Handle fee payer state proof if present
    if has_fee_payer_state_proof(hdr.flags) {
        // Check state proof header size
        if offset + TN_STATE_PROOF_HDR_SIZE > bytes.len() {
            return Err(RpcError::invalid_format());
        }

        // Calculate state proof footprint
        let state_proof_data = &bytes[offset..];
        let state_proof_sz = calculate_state_proof_footprint(state_proof_data)?;

        if offset + state_proof_sz > bytes.len() {
            return Err(RpcError::invalid_format());
        }
        offset += state_proof_sz;

        // Extract proof type for additional validation
        let type_slot = u64::from_le_bytes([
            state_proof_data[0],
            state_proof_data[1],
            state_proof_data[2],
            state_proof_data[3],
            state_proof_data[4],
            state_proof_data[5],
            state_proof_data[6],
            state_proof_data[7],
        ]);
        let proof_type = extract_state_proof_type(type_slot);

        // If proof type is EXISTING, account for account meta
        if proof_type == TN_STATE_PROOF_TYPE_EXISTING {
            if offset + TN_ACCOUNT_META_FOOTPRINT > bytes.len() {
                return Err(RpcError::invalid_format());
            }
            offset += TN_ACCOUNT_META_FOOTPRINT;
        }
    }

    // Verify we don't exceed the provided bytes
    if offset > bytes.len() {
        return Err(RpcError::invalid_format());
    }

    Ok(offset)
}

/// Validate a wire-format transaction for protocol correctness (matching C tn_txn_parse_core).
pub fn validate_wire_transaction(bytes: &[u8]) -> Result<(), RpcError> {
    const TN_TXN_MTU: usize = 32_768;
    const TN_TXN_VERSION_OFFSET: usize = 64;
    const TN_TXN_FLAGS_OFFSET: usize = 65;

    use bytemuck::from_bytes;

    // 1. Check payload size
    if bytes.len() > TN_TXN_MTU {
        return Err(RpcError::invalid_transaction_size(bytes.len(), TN_TXN_MTU));
    }

    // 2. Check transaction version
    if bytes.len() <= TN_TXN_VERSION_OFFSET {
        return Err(RpcError::invalid_format());
    }
    let transaction_version = bytes[TN_TXN_VERSION_OFFSET];
    if transaction_version != 0x01 {
        return Err(RpcError::invalid_version());
    }

    // 3. Check flags
    if bytes.len() <= TN_TXN_FLAGS_OFFSET {
        return Err(RpcError::invalid_format());
    }
    let flags = bytes[TN_TXN_FLAGS_OFFSET];
    // Clear the fee payer proof bit and check that all other bits are 0
    let flags_without_proof_bit = flags & !(1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT);
    let flags_cleared = flags_without_proof_bit & !(1 << TN_TXN_FLAG_MAY_COMPRESS_ACCOUNT_BIT);
    if flags_cleared != 0 {
        return Err(RpcError::invalid_flags());
    }

    // 4. Check header size and parse header
    if bytes.len() < core::mem::size_of::<WireTxnHdrV1>() {
        return Err(RpcError::invalid_format());
    }
    let hdr: &WireTxnHdrV1 = from_bytes(&bytes[0..core::mem::size_of::<WireTxnHdrV1>()]);
    let mut offset = core::mem::size_of::<WireTxnHdrV1>();

    // 5. Parse accounts
    let accs_sz = (hdr.readwrite_accounts_cnt as usize + hdr.readonly_accounts_cnt as usize) * 32;
    if offset + accs_sz > bytes.len() {
        return Err(RpcError::invalid_format());
    }
    offset += accs_sz;

    // 6. Parse instruction data
    let instr_sz = hdr.instr_data_sz as usize;
    if offset + instr_sz > bytes.len() {
        return Err(RpcError::invalid_format());
    }
    offset += instr_sz;

    // 7. Handle fee payer state proof if present
    if has_fee_payer_state_proof(flags) {
        // Check state proof header size
        if offset + TN_STATE_PROOF_HDR_SIZE > bytes.len() {
            return Err(RpcError::invalid_format());
        }

        // Calculate state proof footprint
        let state_proof_data = &bytes[offset..];
        let state_proof_sz = calculate_state_proof_footprint(state_proof_data)?;

        if offset + state_proof_sz > bytes.len() {
            return Err(RpcError::invalid_format());
        }

        // Extract proof type and validate
        let type_slot = u64::from_le_bytes([
            state_proof_data[0],
            state_proof_data[1],
            state_proof_data[2],
            state_proof_data[3],
            state_proof_data[4],
            state_proof_data[5],
            state_proof_data[6],
            state_proof_data[7],
        ]);
        let proof_type = extract_state_proof_type(type_slot);

        // Check that proof type is not UPDATING
        if proof_type == TN_STATE_PROOF_TYPE_UPDATING {
            return Err(RpcError::invalid_fee_payer_state_proof_type());
        }

        offset += state_proof_sz;

        // If proof type is EXISTING, expect account meta
        if proof_type == TN_STATE_PROOF_TYPE_EXISTING {
            if offset + TN_ACCOUNT_META_FOOTPRINT > bytes.len() {
                return Err(RpcError::invalid_format());
            }
            offset += TN_ACCOUNT_META_FOOTPRINT;
        }
    }

    // 8. Check for exact size match (no trailing bytes)
    if offset != bytes.len() {
        // return Err(RpcError::invalid_format());
        return Err(RpcError::trailing_bytes(offset, bytes.len()));
    }
    // 5. Signature check (fee payer signature)
    if hdr.fee_payer_signature.len() != 64 {
        return Err(RpcError::invalid_transaction_signature());
    }
    let sig = Signature::from_bytes(&hdr.fee_payer_signature);
    let wire_for_signing = bytes[64..].to_vec(); // Exclude signature field
    let verifying_key = match VerifyingKey::from_bytes(&hdr.fee_payer_pubkey) {
        Ok(key) => key,
        Err(_) => return Err(RpcError::invalid_transaction_signature()),
    };
    if verifying_key.verify(&wire_for_signing, &sig).is_err() {
        return Err(RpcError::invalid_transaction_signature());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn make_valid_txn_bytes_with_flags(flags: u8) -> Vec<u8> {
        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();
        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42);
        tx.rw_accs = Some(vec![[3u8; 32], [4u8; 32]]);
        tx.r_accs = Some(vec![[5u8; 32]]);
        tx.instructions = Some(vec![1, 2, 3, 4]);
        tx.flags = flags;
        tx.sign(&signing_key.to_bytes()).unwrap();
        tx.to_wire()
    }

    fn make_valid_txn_bytes() -> Vec<u8> {
        make_valid_txn_bytes_with_flags(0)
    }

    #[test]
    fn test_tn_txn_size_basic_transaction() {
        let bytes = make_valid_txn_bytes();
        let calculated_size = tn_txn_size(&bytes).unwrap();

        // The calculated size should match the actual bytes length
        assert_eq!(calculated_size, bytes.len());
    }

    #[test]
    fn test_tn_txn_size_with_state_proof() {
        use crate::tn_state_proof::StateProof;

        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        // Create a CREATION state proof
        let path_bitset = [0u8; 32]; // No set bits = no sibling hashes
        let existing_leaf_pubkey = [7u8; 32];
        let existing_leaf_hash = [8u8; 32];
        let state_proof = StateProof::creation(
            100,
            path_bitset,
            existing_leaf_pubkey,
            existing_leaf_hash,
            vec![],
        );

        // Create transaction with state proof
        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42)
            .with_rw_accounts(vec![[3u8; 32]])
            .with_instructions(vec![1, 2, 3])
            .with_fee_payer_state_proof(&state_proof);

        tx.sign(&signing_key.to_bytes()).unwrap();
        let bytes = tx.to_wire();

        let calculated_size = tn_txn_size(&bytes).unwrap();

        // The calculated size should match the actual bytes length
        assert_eq!(calculated_size, bytes.len());
    }

    #[test]
    fn test_tn_txn_size_minimal_transaction() {
        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        // Create minimal transaction (no accounts, no instructions)
        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42);
        tx.sign(&signing_key.to_bytes()).unwrap();
        let bytes = tx.to_wire();

        let calculated_size = tn_txn_size(&bytes).unwrap();

        // The calculated size should match the actual bytes length
        assert_eq!(calculated_size, bytes.len());

        // Should be exactly the header size for minimal transaction
        assert_eq!(calculated_size, core::mem::size_of::<WireTxnHdrV1>());
    }

    #[test]
    fn test_tn_txn_size_invalid_format() {
        // Test with bytes too short for header
        let short_bytes = vec![0u8; 50];
        let result = tn_txn_size(&short_bytes);
        assert!(matches!(result, Err(RpcError::InvalidFormat)));

        // Test with header but missing account data
        let mut bytes = make_valid_txn_bytes();
        bytes.truncate(core::mem::size_of::<WireTxnHdrV1>() + 10); // Truncate to cause missing data
        let result = tn_txn_size(&bytes);
        assert!(matches!(result, Err(RpcError::InvalidFormat)));
    }

    #[test]
    fn test_tn_txn_size_consistency_with_validation() {
        let bytes = make_valid_txn_bytes();

        // Both functions should succeed for valid transactions
        assert!(validate_wire_transaction(&bytes).is_ok());
        assert!(tn_txn_size(&bytes).is_ok());

        // Size should match actual length
        let calculated_size = tn_txn_size(&bytes).unwrap();
        assert_eq!(calculated_size, bytes.len());
    }

    #[test]
    fn test_valid_transaction() {
        let bytes = make_valid_txn_bytes();
        assert!(validate_wire_transaction(&bytes).is_ok());
    }

    #[test]
    fn test_oversize_transaction() {
        let mut bytes = make_valid_txn_bytes();
        bytes.resize(32_769, 0);
        let err = validate_wire_transaction(&bytes).unwrap_err();
        assert!(matches!(
            err,
            RpcError::InvalidTransactionSize {
                size: 32_769,
                max_size: 32_768
            }
        ));
    }

    #[test]
    fn test_trailing_bytes() {
        let mut bytes = make_valid_txn_bytes();
        bytes.push(0);
        let err = validate_wire_transaction(&bytes).unwrap_err();
        assert!(matches!(
            err,
            RpcError::TrailingBytes {
                expected: 276,
                found: 277
            }
        ));
    }

    #[test]
    fn test_invalid_transaction_version() {
        let mut bytes = make_valid_txn_bytes();
        // Corrupt the transaction version (at offset 64)
        bytes[64] = 0x02; // Invalid version
        let err = validate_wire_transaction(&bytes).unwrap_err();
        assert!(matches!(err, RpcError::InvalidVersion));
    }

    #[test]
    fn test_invalid_flags() {
        // Set invalid flag bits (keeping fee payer proof bit, but adding others)
        let bytes = make_valid_txn_bytes_with_flags(0x07);
        let err = validate_wire_transaction(&bytes).unwrap_err();
        assert!(matches!(err, RpcError::InvalidFlags));
    }

    #[test]
    fn test_transaction_too_short() {
        let bytes = vec![0u8; 50]; // Too short for header
        let err = validate_wire_transaction(&bytes).unwrap_err();
        assert!(matches!(err, RpcError::InvalidFormat));
    }

    #[test]
    fn test_transaction_with_state_proof() {
        use crate::tn_state_proof::{StateProof, StateProofType};

        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        // Create a CREATION state proof (doesn't require account meta)
        let path_bitset = [0u8; 32]; // No set bits = no sibling hashes
        let existing_leaf_pubkey = [7u8; 32];
        let existing_leaf_hash = [8u8; 32];
        let state_proof = StateProof::creation(
            100,
            path_bitset,
            existing_leaf_pubkey,
            existing_leaf_hash,
            vec![],
        );

        // Create transaction with state proof
        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42)
            .with_fee_payer_state_proof(&state_proof);

        // Verify flag is set
        assert!(tx.has_fee_payer_state_proof());
        assert_eq!(tx.flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT), 1);

        tx.sign(&signing_key.to_bytes()).unwrap();
        let bytes = tx.to_wire();

        // Verify state proof is included in wire format
        assert!(bytes.len() > 168); // Header + state proof should be larger
        assert!(validate_wire_transaction(&bytes).is_ok());

        // Test deserialization
        let decoded_tx = Transaction::from_wire(&bytes).unwrap();
        assert!(decoded_tx.has_fee_payer_state_proof());
        assert!(decoded_tx.fee_payer_state_proof.is_some());

        let decoded_proof = decoded_tx.fee_payer_state_proof.unwrap();
        assert_eq!(decoded_proof.proof_type(), StateProofType::Creation);
        assert_eq!(decoded_proof.slot(), 100);
    }

    #[test]
    fn test_transaction_with_state_proof_serialization_round_trip() {
        use crate::tn_state_proof::StateProof;

        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        // Create a creation state proof with some sibling hashes
        let mut path_bitset = [0u8; 32];
        path_bitset[0] = 0b11; // Set first 2 bits for 2 sibling hashes
        let existing_leaf_pubkey = [7u8; 32];
        let existing_leaf_hash = [8u8; 32];
        let sibling_hashes = vec![[9u8; 32], [10u8; 32]];

        let state_proof = StateProof::creation(
            200,
            path_bitset,
            existing_leaf_pubkey,
            existing_leaf_hash,
            sibling_hashes.clone(),
        );

        // Create transaction with complex state proof
        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42)
            .with_rw_accounts(vec![[3u8; 32], [4u8; 32]])
            .with_r_accounts(vec![[5u8; 32]])
            .with_instructions(vec![1, 2, 3, 4])
            .with_fee_payer_state_proof(&state_proof);

        tx.sign(&signing_key.to_bytes()).unwrap();
        let bytes = tx.to_wire();

        // Test validation
        assert!(validate_wire_transaction(&bytes).is_ok());

        // Test round-trip serialization
        let decoded_tx = Transaction::from_wire(&bytes).unwrap();
        assert_eq!(decoded_tx.fee_payer, tx.fee_payer);
        assert_eq!(decoded_tx.program, tx.program);
        assert_eq!(decoded_tx.rw_accs, tx.rw_accs);
        assert_eq!(decoded_tx.r_accs, tx.r_accs);
        assert_eq!(decoded_tx.instructions, tx.instructions);
        assert_eq!(decoded_tx.flags, tx.flags);
        assert!(decoded_tx.has_fee_payer_state_proof());

        let decoded_proof = decoded_tx.fee_payer_state_proof.unwrap();
        assert_eq!(decoded_proof.slot(), 200);
        assert_eq!(decoded_proof.path_bitset(), &path_bitset);
    }

    #[test]
    fn test_transaction_without_state_proof() {
        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        let mut tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42);

        // Verify flag is not set
        assert!(!tx.has_fee_payer_state_proof());
        assert_eq!(tx.flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT), 0);
        assert!(tx.fee_payer_state_proof.is_none());

        tx.sign(&signing_key.to_bytes()).unwrap();
        let bytes = tx.to_wire();

        assert!(validate_wire_transaction(&bytes).is_ok());

        // Test deserialization
        let decoded_tx = Transaction::from_wire(&bytes).unwrap();
        assert!(!decoded_tx.has_fee_payer_state_proof());
        assert!(decoded_tx.fee_payer_state_proof.is_none());
    }

    #[test]
    fn test_transaction_remove_state_proof() {
        use crate::tn_state_proof::StateProof;

        let signing_key = SigningKey::from(&[1u8; 32]);
        let verifying_key = signing_key.verifying_key();

        // Create a CREATION state proof
        let path_bitset = [0u8; 32];
        let existing_leaf_pubkey = [7u8; 32];
        let existing_leaf_hash = [8u8; 32];
        let state_proof = StateProof::creation(
            100,
            path_bitset,
            existing_leaf_pubkey,
            existing_leaf_hash,
            vec![],
        );

        // Create transaction with state proof, then remove it
        let tx = Transaction::new(verifying_key.to_bytes(), [2u8; 32], 100, 42)
            .with_fee_payer_state_proof(&state_proof)
            .without_fee_payer_state_proof();

        // Verify flag is cleared and state proof is removed
        assert!(!tx.has_fee_payer_state_proof());
        assert_eq!(tx.flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF_BIT), 0);
        assert!(tx.fee_payer_state_proof.is_none());
    }
}
