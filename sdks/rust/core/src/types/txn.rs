use crate::types::pubkey::Pubkey;
use crate::types::state_proof::{ProofParseError, StateProof};
use crate::types::{account::AccountMeta, ed25519::Ed25519Sig};
use core::{mem::MaybeUninit, slice};

// Constants from tn_txn.h
pub const TN_TXN_V1: u8 = 0x01;
pub const TN_TXN_SIGNATURE_SZ: usize = 64;
pub const TN_TXN_PUBKEY_SZ: usize = 32;
pub const TN_TXN_ACCT_ADDR_SZ: usize = 32;
pub const TN_TXN_BLOCKHASH_SZ: usize = 32;

pub const FD_TXN_SIG_MAX: usize = 127;
// Note: Actual max might be lower due to MTU, but using C definition
pub const FD_TXN_ACTUAL_SIG_MAX: usize = 12;
pub const FD_TXN_ACCT_ADDR_MAX: usize = 128;
pub const FD_TXN_ADDR_TABLE_LOOKUP_MAX: usize = 127;
pub const FD_TXN_INSTR_MAX: usize = 64;
pub const TXN_MAX_SZ: usize = 32768_usize;
pub const FD_TXN_MTU: usize = 1232;
pub const FD_TXN_MIN_SERIALIZED_SZ: usize = 134;
pub const MAX_TX_ACCOUNT_LOCKS: usize = 128;

pub const TN_TXN_FLAG_HAS_FEE_PAYER_PROOF: u8 = 1 << 0; // 0U -> bit 0

pub const TN_TXN_VERSION_OFFSET: usize = 0;
pub const TN_TXN_FLAGS_OFFSET: usize = 1;

/// Transaction wire format:
///   [header (112 bytes)]
///   [input_pubkeys (variable)]
///   [instr_data (variable)]
///   [state_proof (optional)]
///   [account_meta (optional)]
///   [fee_payer_signature (64 bytes)]
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct TxnHdrUniversal {
    transaction_version: u8, /* bytes: [0,1) */
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct TxnHdrV1 {
    transaction_version: u8,      /* bytes: [0,1) */
    flags: u8,                    /* bytes: [1,2) */
    readwrite_accounts_cnt: u16,  /* bytes: [2,4) */
    readonly_accounts_cnt: u16,   /* bytes: [4,6) */
    instr_data_sz: u16,           /* bytes: [6,8) */
    req_compute_units: u32,       /* bytes: [8,12) */
    req_state_units: u16,         /* bytes: [12,14) */
    req_memory_units: u16,        /* bytes: [14,16) */
    fee: u64,                     /* bytes: [16,24) */
    nonce: u64,                   /* bytes: [24,32) */
    start_slot: u64,              /* bytes: [32,40) */
    expiry_after: u32,            /* bytes: [40,44) */
    chain_id: u16,                /* bytes: [44,46) */
    padding_0: u16,               /* bytes: [46,48) */
    pub fee_payer_pubkey: Pubkey, /* bytes: [48,80) */
    pub program_pubkey: Pubkey,   /* bytes: [80,112) */
}

pub const TXN_HDR_V1_SZ: usize = size_of::<TxnHdrV1>();

/// ```text
///              TxnHdr  (C-compatible union)
/// ╔═══════════════════════════════════════╗
/// ║ universal : TxnHdrUniversal           ║
/// ║ v1        : TxnHdrV1                  ║
/// ╚═══════════════════════════════════════╝
/// sizeof::<TxnHdr>() == max(sizeof::<TxnHdrUniversal>(),
///                           sizeof::<TxnHdrV1>())
/// ```
#[repr(C)]
#[derive(Clone, Copy)]
pub union TxnHdr {
    pub universal: TxnHdrUniversal,
    pub v1: TxnHdrV1,
}

impl TxnHdr {
    pub fn version(&self) -> u8 {
        // Safe because `transaction_version` is present in both variants
        unsafe { self.universal.transaction_version }
    }

    /// Interprets the header as V1 *after* the caller has verified
    /// that `self.version() == 1`.
    pub unsafe fn as_v1(&self) -> &TxnHdrV1 {
        unsafe { &self.v1 }
    }

    /// Safe access to V1 header fields.
    ///
    /// # Errors
    /// Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    pub fn as_v1_safe(&self) -> Result<&TxnHdrV1, TxnAccessError> {
        let version = self.version();
        if version == 1 {
            Ok(unsafe { &self.v1 })
        } else {
            Err(TxnAccessError::NotV1 {
                actual_version: version,
            })
        }
    }
}

/// ```text
///                      Txn  (parsed view)
/// ┌───────────────────────────────────────────────┐
/// │ 0x00  hdr         : TxnHdr                    │
/// ├───────────────────────────────────────────────┤
/// │ 0x??  input_pubkeys  : [Pubkey; N]            │ ← N depends on
/// │       • Fee-payer (idx 0)                     │   version-specific
/// │       • Program   (idx 1)                     │   account counts
/// │       • R/W accts …                           │
/// │       • R/O accts …                           │
/// └───────────────────────────────────────────────┘
/// Total bytes = sizeof::<TxnHdr>()
///             + N * sizeof::<Pubkey>()
/// ```
/// DST (Dynamically Sized Type) for transaction data
pub struct Txn {
    pub hdr: TxnHdr,
    pub input_pubkeys: [Pubkey],
}

pub type PathWord = u64;
pub const PATH_BITSET_WORDS: usize = 4;

#[derive(Debug)]
pub enum TxnParseError {
    Truncated,
    TooShort(usize),
    BadVersion(u8),
}

#[derive(Debug, Clone, Copy)]
pub enum TxnAccessError {
    /// Transaction is not version 1
    NotV1 { actual_version: u8 },

    /// Account index out of bounds
    InvalidAccountIndex { index: u16, max: u16 },
}

impl Txn {
    pub fn parse_txn<'a>(bytes: &'a [u8]) -> Result<&'a Txn, TxnParseError> {
        /* ---------- read & align the fixed header ------------------------ */
        if bytes.len() < size_of::<TxnHdr>() {
            return Err(TxnParseError::Truncated);
        }

        // Copy the header into an aligned buffer so we can treat it safely.
        let mut hdr_buf = MaybeUninit::<TxnHdr>::uninit();
        unsafe {
            hdr_buf
                .as_mut_ptr()
                .write(*(bytes.as_ptr() as *const TxnHdr));
        }

        let hdr = unsafe { hdr_buf.assume_init() };

        let expect = match hdr.version() {
            1 => unsafe {
                let v1: &TxnHdrV1 = hdr.as_v1();
                v1.readwrite_accounts_cnt as usize + v1.readonly_accounts_cnt as usize
            },
            0 => 0, // universal header => no accounts
            v => return Err(TxnParseError::BadVersion(v)),
        };

        let needed = size_of::<TxnHdr>() + expect * size_of::<Pubkey>();
        if bytes.len() < needed {
            return Err(TxnParseError::TooShort(expect));
        }

        // SAFETY: We've validated the size and alignment above
        // Create a fat pointer by combining the data pointer with the length
        // todo: use ptr::from_raw_parts once it's stable
        unsafe {
            let data_ptr = bytes.as_ptr();
            let fat_ptr: *const Txn = core::mem::transmute((data_ptr, expect));
            Ok(&*fat_ptr)
        }
    }
}

impl Txn {
    /// Returns the fee-payer signature.
    ///
    /// # Errors
    /// Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    pub unsafe fn fee_payer_signature(&self, txn_sz: usize) -> Result<&Ed25519Sig, TxnAccessError> {
        let _ = self.hdr.as_v1_safe()?; // Verify version
        let sig_ptr = (self as *const Txn as *const u8).add(txn_sz - TN_TXN_SIGNATURE_SZ);
        Ok(&*(sig_ptr as *const Ed25519Sig))
    }

    /// Returns all account public keys as a slice.
    ///
    /// # Errors
    /// Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    pub fn account_pubkeys(&self) -> Result<&[Pubkey], TxnAccessError> {
        let v1 = self.hdr.as_v1_safe()?;
        let accounts_ptr_start = &v1.fee_payer_pubkey as *const Pubkey;
        let num_accounts = self.accounts_cnt();
        unsafe {
            Ok(core::slice::from_raw_parts(
                accounts_ptr_start,
                num_accounts as usize,
            ))
        }
    }

    /// Returns the public key for the account at the specified index.
    ///
    /// # Errors
    /// - Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    /// - Returns `TxnAccessError::InvalidAccountIndex` if the index is out of bounds.
    pub fn account_pubkey(&self, account_index: u16) -> Result<&Pubkey, TxnAccessError> {
        let v1 = self.hdr.as_v1_safe()?;
        if account_index == 0 {
            Ok(&v1.fee_payer_pubkey)
        } else if account_index == 1 {
            Ok(&v1.program_pubkey)
        } else {
            self.input_pubkeys.get((account_index - 2) as usize).ok_or(
                TxnAccessError::InvalidAccountIndex {
                    index: account_index,
                    max: self.accounts_cnt(),
                },
            )
        }
    }

    /// Returns the program public key (account at index 1).
    ///
    /// # Errors
    /// Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    pub fn program_pubkey(&self) -> Result<&Pubkey, TxnAccessError> {
        self.account_pubkey(1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountAddrs<'a> {
    FeePayer(&'a Pubkey),
    Program(&'a Pubkey),
    ReadWrite(&'a Pubkey),
    ReadOnly(&'a Pubkey),
}

pub struct AccountAddrsIter<'a> {
    fee_payer: Option<&'a Pubkey>,
    program: Option<&'a Pubkey>,
    rw_iter: slice::Iter<'a, Pubkey>,
    ro_iter: slice::Iter<'a, Pubkey>,
}

impl<'a> Iterator for AccountAddrsIter<'a> {
    type Item = AccountAddrs<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(pk) = self.fee_payer.take() {
            return Some(AccountAddrs::FeePayer(pk));
        }
        if let Some(pk) = self.program.take() {
            return Some(AccountAddrs::Program(pk));
        }

        if let Some(pk) = self.rw_iter.next() {
            return Some(AccountAddrs::ReadWrite(pk));
        }
        self.ro_iter.next().map(AccountAddrs::ReadOnly)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let extra = self.fee_payer.is_some() as usize + self.program.is_some() as usize;
        let remaining = extra + self.rw_iter.len() + self.ro_iter.len();
        (remaining, Some(remaining))
    }
}

impl<'a> ExactSizeIterator for AccountAddrsIter<'a> {}

impl Txn {
    /// Iterator over **all** account addresses, with the fee-payer first,
    /// exactly as `tn_txn_get_acct_addrs()` exposes in C.
    ///
    /// Returns `Err` when the header is *not* V1.
    ///
    /// ```
    ///              |<------- one contiguous array of Pubkey ------->|
    ///              +-----------------------------------------------+
    ///              | hdr.v1.fee_payer_pubkey  |  input_pubkeys[..] |
    ///              +-----------------------------------------------+
    ///               ^
    ///  acct_addrs() ┘
    /// ```
    /// Iterator over all account addresses in a V1 transaction.
    ///
    /// ```text
    /// idx 0 --> Fee-payer pubkey      (hdr.v1.fee_payer_pubkey)
    /// idx 1 --> Program  pubkey       (hdr.v1.program_pubkey)
    /// idx 2..=rw_cnt+1 --> Read-write accounts
    /// …                --> Read-only  accounts
    /// ```
    ///
    /// # Example
    ///
    /// ```rust
    /// # use your_crate::{parse_txn, AccountAddrs};
    /// # let bytes: &[u8] = /* on-wire bytes */ unimplemented!();
    /// let txn = parse_txn(bytes)?;
    ///
    /// let addrs = txn.accounts_iter()?;
    /// for (i, addr) in addrs.enumerate() {
    ///     match addr {
    ///         AccountAddrs::FeePayer(pk)  => tsdk_println!("{i}: fee-payer  {pk}"),
    ///         AccountAddrs::Program(pk)   => tsdk_println!("{i}: program    {pk}"),
    ///         AccountAddrs::ReadWrite(pk) => tsdk_println!("{i}: rw acct    {pk}"),
    ///         AccountAddrs::ReadOnly(pk)  => tsdk_println!("{i}: ro acct    {pk}"),
    ///     }
    /// }
    /// ```
    pub fn accounts_iter(&self) -> Result<AccountAddrsIter<'_>, TxnAccessError> {
        let v1 = self.hdr.as_v1_safe()?;

        let rw_cnt = v1.readwrite_accounts_cnt as usize;
        let ro_cnt = v1.readonly_accounts_cnt as usize;

        debug_assert_eq!(self.input_pubkeys.len(), rw_cnt + ro_cnt);
        Ok(AccountAddrsIter {
            fee_payer: Some(&v1.fee_payer_pubkey),
            program: Some(&v1.program_pubkey),
            rw_iter: self.input_pubkeys[..rw_cnt].iter(),
            ro_iter: self.input_pubkeys[rw_cnt..].iter(),
        })
    }

    /*------------------------------------------------------------------*/
    /*  Safe accessor for instruction data                               */
    /*------------------------------------------------------------------*/
    /// Returns a slice of instruction data (`instr_data_sz` bytes).
    ///
    /// # Errors
    /// Returns `TxnAccessError::NotV1` if the transaction is not version 1.
    ///
    /// ```
    ///  +--------------------------------------------------------------+
    ///  |           V1 header (TxnHdrV1)                               |
    ///  +--------------------------------------------------------------+
    ///  | fee_payer_pubkey | input_pubkeys… |  instruction data …      |
    ///  +--------------------------------------------------------------+
    ///                  ^                       ^
    ///                  |                       |
    ///   acct_addrs() --┘                       |
    ///     instr_data() ------------------------┘
    /// ```
    pub fn instr_data(&self) -> Result<&[u8], TxnAccessError> {
        let v1 = self.hdr.as_v1_safe()?;

        let instr_data_offset =
            size_of::<TxnHdr>() + size_of::<Pubkey>() * (self.accounts_cnt() as usize - 2);
        Ok(unsafe {
            core::slice::from_raw_parts(
                (self as *const Txn as *const u8).offset(instr_data_offset as isize),
                v1.instr_data_sz as usize,
            )
        })
    }

    pub fn fee_payer_proof(&self) -> Result<StateProof<'_>, ProofParseError> {
        let proof_start = self
            .instr_data()
            .map_err(|_| ProofParseError::NotSupported)?
            .as_ptr_range()
            .end;
        if (unsafe { self.hdr.as_v1() }.flags & TN_TXN_FLAG_HAS_FEE_PAYER_PROOF) == 0 {
            return Err(ProofParseError::NotAvailable);
        }

        // SAFETY: Proof data already checked by runtime
        Ok(unsafe { StateProof::parse_proof_unchecked(proof_start) })
    }

    pub fn fee_payer_meta(&self) -> Result<&AccountMeta, ProofParseError> {
        let proof = self.fee_payer_proof()?;
        let meta = unsafe {
            let ptr = proof.as_ptr().add(proof.footprint());
            &*(ptr as *const AccountMeta)
        };
        Ok(meta)
    }

    pub fn fee(&self) -> u64 {
        unsafe { self.hdr.as_v1().fee }
    }

    pub fn start_slot(&self) -> u64 {
        unsafe { self.hdr.as_v1().start_slot }
    }

    pub fn expiry_slot(&self) -> u64 {
        unsafe {
            let hdr = self.hdr.as_v1();
            hdr.start_slot.saturating_add(hdr.expiry_after as u64)
        }
    }

    pub fn nonce(&self) -> u64 {
        unsafe { self.hdr.as_v1().nonce }
    }

    pub fn requested_compute_units(&self) -> u32 {
        unsafe { self.hdr.as_v1().req_compute_units }
    }

    pub fn requested_mem_units(&self) -> u16 {
        unsafe { self.hdr.as_v1().req_memory_units }
    }

    pub fn chain_id(&self) -> u16 {
        unsafe { self.hdr.as_v1().chain_id }
    }

    pub fn readonly_accounts_cnt(&self) -> u16 {
        unsafe { self.hdr.as_v1().readonly_accounts_cnt }
    }

    pub fn readwrite_accounts_cnt(&self) -> u16 {
        unsafe { self.hdr.as_v1().readwrite_accounts_cnt }
    }

    pub fn accounts_cnt(&self) -> u16 {
        2 + self.readonly_accounts_cnt() + self.readwrite_accounts_cnt()
    }

    /// Returns **`true`** when the account at `acc_idx` is writable,
    /// following the on-wire rules for **V1** transactions:
    ///
    /// ```text
    /// idx 0   --> fee-payer (always writable)
    /// idx 1   --> program   (never writable)
    /// idx 2.. --> read-write accounts   (rw_cnt items)
    ///             read-only  accounts   (ro_cnt items)
    /// ```
    ///
    /// For V0 / unknown versions the function always yields `false`.
    #[inline]
    pub fn is_account_idx_writable(&self, acc_idx: u16) -> bool {
        if self.hdr.version() != 1 {
            return false;
        }

        // SAFETY: variant verified V1
        let v1: &TxnHdrV1 = unsafe { self.hdr.as_v1() };

        let idx = acc_idx as usize;
        let rw_cnt = v1.readwrite_accounts_cnt as usize;

        idx == 0 || (idx >= 2 && idx < 2 + rw_cnt)
    }

    // TODO: Proof stuff
}
