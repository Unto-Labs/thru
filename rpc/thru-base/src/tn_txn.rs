//! Rust translation of tn_txn.h
//!
pub type FdPubkey = [u8; 32];
pub type FdHash = [u8; 32];
pub type FdSignature = [u8; 64];

/*
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct TnAccountMeta {
    pub magic: u16,
    pub version: u8,
    pub flags: u8,
    pub padding_0: [u8; 4],
    pub owner: [u8; 32],
    pub data_sz: u64,
    pub balance: u64,
    pub nonce: u64,
    pub state_counter: u64,
}



// Constants
pub const TN_TXN_V1: u8 = 0x01;
pub const TN_TXN_SIGNATURE_SZ: usize = 64;
pub const TN_TXN_PUBKEY_SZ: usize = 32;
pub const TN_TXN_ACCT_ADDR_SZ: usize = 32;
pub const TN_TXN_BLOCKHASH_SZ: usize = 32;
pub const FD_TXN_SIG_MAX: usize = 127;
pub const FD_TXN_ACTUAL_SIG_MAX: usize = 12;
pub const FD_TXN_ACCT_ADDR_MAX: usize = 128;
pub const FD_TXN_ADDR_TABLE_LOOKUP_MAX: usize = 127;
pub const FD_TXN_INSTR_MAX: usize = 64;
pub const FD_TXN_MAX_SZ: usize = 852;
pub const FD_TXN_MTU: usize = 1232;
pub const FD_TXN_MIN_SERIALIZED_SZ: usize = 134;
pub const MAX_TX_ACCOUNT_LOCKS: usize = 128;
pub const TN_TXN_FLAG_HAS_FEE_PAYER_PROOF: u8 = 0;
pub const TN_TXN_VERSION_OFFSET: usize = 64;
pub const TN_TXN_FLAGS_OFFSET: usize = 65;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnTxnHdrUniversal {
    pub fee_payer_signature: FdSignature,
    pub transaction_version: u8,
}

impl Default for TnTxnHdrUniversal {
    fn default() -> Self {
        Self {
            fee_payer_signature: [0u8; 64],
            transaction_version: 0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct TnTxnHdrV1 {
    pub fee_payer_signature: FdSignature,
    pub transaction_version: u8,
    pub flags: u8,
    pub readwrite_accounts_cnt: u16,
    pub readonly_accounts_cnt: u16,
    pub instr_data_sz: u16,
    pub req_compute_units: u32,
    pub req_state_units: u16,
    pub req_memory_units: u16,
    pub expiry_after: u32,
    pub fee: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub fee_payer_pubkey: FdPubkey,
    pub program_pubkey: FdPubkey,
}

impl Default for TnTxnHdrV1 {
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
            expiry_after: 0,
            fee: 0,
            nonce: 0,
            start_slot: 0,
            fee_payer_pubkey: [0u8; 32],
            program_pubkey: [0u8; 32],
        }
    }
}

pub const TN_TXN_HDR_V1_SZ: usize = core::mem::size_of::<TnTxnHdrV1>();

#[repr(C)]
#[derive(Clone, Copy)]
pub union TnTxnHdr {
    pub version: TnTxnHdrUniversal,
    pub v1: TnTxnHdrV1,
}

impl Default for TnTxnHdr {
    fn default() -> Self {
        TnTxnHdr { version: TnTxnHdrUniversal::default() }
    }
}

impl core::fmt::Debug for TnTxnHdr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        unsafe {
            f.debug_struct("TnTxnHdr")
                .field("version", &self.version)
                .field("v1", &self.v1)
                .finish()
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct TnTxnStateProofV1 {
    pub path_bitset: [u64; 4],
    pub account_meta: TnAccountMeta,
    // proof_keys: variable length, not representable directly in Rust struct
}

#[repr(C)]
#[derive(Debug)]
pub struct TnTxn {
    pub hdr: TnTxnHdr,
    // pub rest: [u8],
    // input_pubkeys: variable length, not representable directly in Rust struct
}

// Inline function equivalents
impl TnTxn {
    pub fn get_fee_payer_signature(&self) -> &FdSignature {
        unsafe { &self.hdr.v1.fee_payer_signature }
    }
    pub fn get_acct_addrs(&self) -> &FdPubkey {
        unsafe { &self.hdr.v1.fee_payer_pubkey }
    }
    pub fn get_instr_data<'a>(&'a self, base: *const u8) -> &'a [u8] {
        let offset = core::mem::size_of::<TnTxnHdrV1>()
            + ((unsafe { self.hdr.v1.readwrite_accounts_cnt } as usize + unsafe { self.hdr.v1.readonly_accounts_cnt } as usize) * core::mem::size_of::<FdPubkey>());
        unsafe {
            let ptr = base.add(offset);
            core::slice::from_raw_parts(ptr, self.hdr.v1.instr_data_sz as usize)
        }
    }
    pub fn get_instr_data_sz(&self) -> u16 {
        unsafe { self.hdr.v1.instr_data_sz }
    }
    pub fn get_fee(&self) -> u64 {
        unsafe { self.hdr.v1.fee }
    }
    pub fn get_start_slot(&self) -> u64 {
        unsafe { self.hdr.v1.start_slot }
    }
    pub fn get_expiry_slot(&self) -> u64 {
        unsafe { self.hdr.v1.start_slot.saturating_add(self.hdr.v1.expiry_after as u64) }
    }
    pub fn get_nonce(&self) -> u64 {
        unsafe { self.hdr.v1.nonce }
    }
    pub fn get_requested_compute_units(&self) -> u32 {
        unsafe { self.hdr.v1.req_compute_units }
    }
    pub fn get_requested_memory_units(&self) -> u16 {
        unsafe { self.hdr.v1.req_memory_units }
    }
    pub fn has_fee_payer_state_proof(&self) -> bool {
        unsafe { (self.hdr.v1.flags & (1 << TN_TXN_FLAG_HAS_FEE_PAYER_PROOF)) != 0 }
    }
    pub fn readwrite_account_cnt(&self) -> u16 {
        unsafe { self.hdr.v1.readwrite_accounts_cnt }
    }
    pub fn readonly_account_cnt(&self) -> u16 {
        unsafe { self.hdr.v1.readonly_accounts_cnt }
    }
    pub fn account_cnt(&self) -> u16 {
        unsafe { 2 + self.hdr.v1.readonly_accounts_cnt + self.hdr.v1.readwrite_accounts_cnt }
    }
    pub fn is_account_idx_writable(&self, acc_idx: u16) -> bool {
        unsafe { acc_idx == 0 || (acc_idx >= 2 && acc_idx < 2 + self.hdr.v1.readwrite_accounts_cnt) }
    }
    pub fn align() -> usize {
        core::mem::align_of::<TnTxn>()
    }
    pub fn footprint(accounts_cnt: usize, instr_data_sz: usize) -> usize {
        core::mem::size_of::<TnTxn>() + ((accounts_cnt - 2) * core::mem::size_of::<FdPubkey>()) + instr_data_sz
    }
    pub fn size(&self) -> usize {
        unsafe {
            core::mem::size_of::<TnTxn>()
                + ((self.hdr.v1.readwrite_accounts_cnt as usize + self.hdr.v1.readonly_accounts_cnt as usize) * core::mem::size_of::<FdPubkey>())
                + self.hdr.v1.instr_data_sz as usize
        }
    }
}

impl TnTxnStateProofV1 {
    pub fn fee_payer_state_proof_cnt(&self) -> u32 {
        self.path_bitset.iter().map(|x| x.count_ones()).sum()
    }
}
*/
