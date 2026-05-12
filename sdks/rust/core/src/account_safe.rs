use core::{
    cell::{Ref, RefCell, RefMut},
    hash::Hasher as CoreHasher,
};

use hash32::{BuildHasherDefault, Hasher as Hasher32};
use heapless::IndexMap;

/// Round up to the next power of 2.
/// Useful for determining optimal NUM_ACCOUNTS capacity for AccountManager.
///
/// # Example
/// ```rust
/// use thru_core::{AccountManager, next_pow2};
/// const NUM_ACCOUNTS: usize = next_pow2(10); // 16
/// let mgr: AccountManager<NUM_ACCOUNTS> = /* ... */;
/// ```
pub const fn next_pow2(n: usize) -> usize {
    if n == 0 {
        return 1;
    }
    let mut p = 1;
    while p < n {
        p = p.saturating_mul(2);
    }
    p
}

use crate::{
    get_shadow_stack,
    mem::{get_account_info_at_idx, get_account_info_at_idx_mut, get_txn, MemoryError},
    types::{
        account::{AccountInfo, AccountInfoMut},
        pubkey::Pubkey,
        txn::Txn,
    },
};

const INVOKE_AUTH_ERR_BAD_MAGIC: u64 = 0xBAD0A170;
const INVOKE_AUTH_ERR_UNOWNED_AUTH_ACCOUNT: u64 = 0xBAD0A171;
const INVOKE_AUTH_ERR_INVALID_ACCOUNT_INDEX: u64 = 0xBAD0A173;

/// Errors that can occur when accessing accounts through AccountManager.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountError {
    /// Account index is out of bounds
    IndexOutOfBounds { index: u16, max: u16 },

    /// Account is already borrowed (for mutable access)
    AlreadyBorrowedMutably { index: u16 },

    /// Account is already borrowed (prevents mutable borrow)
    AlreadyBorrowed { index: u16 },

    /// Too many distinct accounts accessed (map is full)
    TooManyAccountsAccessed { max_capacity: usize },

    /// Transaction version not supported
    UnsupportedTxnVersion { version: u8 },

    /// Failed to access account info from memory
    InfoAccessFailed { index: u16, err: MemoryError },
}

/// Identity hasher that uses the account index directly as the hash.
/// This is optimal for small sequential account indices.
#[derive(Default)]
struct IdentityHasher(u32);

impl CoreHasher for IdentityHasher {
    fn finish(&self) -> u64 {
        self.0 as u64
    }

    fn write(&mut self, bytes: &[u8]) {
        /* For u16 keys, we expect exactly 2 bytes in little-endian */
        if bytes.len() == 2 {
            self.0 = u16::from_le_bytes([bytes[0], bytes[1]]) as u32;
        }
    }
}

impl Hasher32 for IdentityHasher {
    fn finish32(&self) -> u32 {
        self.0
    }
}

/// Represents the different types of accounts in a transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountType {
    /// The fee-paying account (index 0)
    FeePayer,
    /// The program account (index 1)
    Program,
    /// A read-write account (indices 2..2+rw_cnt)
    ReadWrite,
    /// A read-only account (remaining indices)
    ReadOnly,
}

impl AccountType {
    /// Check if this account type can be borrowed mutably.
    pub fn is_mutable(&self) -> bool {
        matches!(self, AccountType::FeePayer | AccountType::ReadWrite)
    }

    /// Get the string representation of the account type.
    pub fn as_str(&self) -> &'static str {
        match self {
            AccountType::FeePayer => "FeePayer",
            AccountType::Program => "Program",
            AccountType::ReadWrite => "ReadWrite",
            AccountType::ReadOnly => "ReadOnly",
        }
    }
}

/// A safe borrow of an account with proper lifetime and mutability tracking.
///
/// The mutability of the inner `AccountInfo` matches the transaction rules:
/// only the fee-payer (idx 0) and the *read-write* range are exposed mutably.
///
/// Account data is accessed exclusively through accessor methods (`data()`,
/// `data_mut()`, `owner()`, `balance()`, etc.) to prevent `'static`
/// references from escaping the borrow guard. The inner fields are private
/// to ensure references are invalidated when the `AccountRef` is dropped.
pub struct AccountRef<'a> {
    inner: AccountRefInner<'a>,
}

enum AccountRefInner<'a> {
    Mutable {
        account: AccountInfoMut<'static>,
        account_type: AccountType,
        _guard: RefMut<'a, ()>,
    },
    Immutable {
        account: AccountInfo<'static>,
        account_type: AccountType,
        _guard: Ref<'a, ()>,
    },
}

impl<'a> AccountRef<'a> {
    pub(crate) fn new_mutable(
        account: AccountInfoMut<'static>,
        account_type: AccountType,
        guard: RefMut<'a, ()>,
    ) -> Self {
        Self {
            inner: AccountRefInner::Mutable {
                account,
                account_type,
                _guard: guard,
            },
        }
    }

    pub(crate) fn new_immutable(
        account: AccountInfo<'static>,
        account_type: AccountType,
        guard: Ref<'a, ()>,
    ) -> Self {
        Self {
            inner: AccountRefInner::Immutable {
                account,
                account_type,
                _guard: guard,
            },
        }
    }

    /// Get read-only access to the account data.
    pub fn data(&self) -> &[u8] {
        match &self.inner {
            AccountRefInner::Mutable { account, .. } => account.data,
            AccountRefInner::Immutable { account, .. } => account.data,
        }
    }

    /// Get mutable access to account data (only for FeePayer and ReadWrite accounts).
    pub fn data_mut(&mut self) -> Option<&mut [u8]> {
        match &mut self.inner {
            AccountRefInner::Mutable { account, .. } => Some(account.data),
            AccountRefInner::Immutable { .. } => None,
        }
    }

    /// Get the account owner pubkey.
    pub fn owner(&self) -> &Pubkey {
        match &self.inner {
            AccountRefInner::Mutable { account, .. } => &account.meta.owner,
            AccountRefInner::Immutable { account, .. } => &account.meta.owner,
        }
    }

    /// Get the account owner as raw bytes.
    pub fn owner_bytes(&self) -> &[u8; 32] {
        let pubkey = self.owner();
        /* SAFETY: Pubkey is #[repr(C)] and contains a single [u8; 32] field */
        unsafe { &*(pubkey as *const Pubkey as *const [u8; 32]) }
    }

    /// Checks if the account is owned by the currently executing program.
    pub fn is_owned_by_current_program(&self) -> bool {
        let txn = get_txn();
        let account_pubkeys = match txn.account_pubkeys() {
            Ok(pubkeys) => pubkeys,
            Err(_) => return false,
        };
        let current_program_idx = get_shadow_stack().current_program_acc_idx() as usize;
        account_pubkeys.get(current_program_idx) == Some(self.owner())
    }

    /// Get the account balance.
    pub fn balance(&self) -> u64 {
        match &self.inner {
            AccountRefInner::Mutable { account, .. } => account.meta.balance,
            AccountRefInner::Immutable { account, .. } => account.meta.balance,
        }
    }

    /// Get the account data size.
    pub fn data_size(&self) -> u32 {
        match &self.inner {
            AccountRefInner::Mutable { account, .. } => account.meta.data_sz,
            AccountRefInner::Immutable { account, .. } => account.meta.data_sz,
        }
    }

    /// Get the account nonce.
    pub fn nonce(&self) -> u64 {
        match &self.inner {
            AccountRefInner::Mutable { account, .. } => account.meta.nonce,
            AccountRefInner::Immutable { account, .. } => account.meta.nonce,
        }
    }

    /// Check if this account can be modified.
    pub fn is_mutable(&self) -> bool {
        matches!(self.inner, AccountRefInner::Mutable { .. })
    }

    /// Get the account type.
    pub fn account_type(&self) -> AccountType {
        match &self.inner {
            AccountRefInner::Mutable { account_type, .. } => *account_type,
            AccountRefInner::Immutable { account_type, .. } => *account_type,
        }
    }
}

/// Manages safe access to transaction accounts with proper borrow checking.
///
/// Prevents aliasing by tracking borrows through RefCell and enforces
/// Solana's account access rules (fee-payer and read-write accounts are mutable,
/// others are read-only).
///
/// `NUM_ACCOUNTS` specifies the maximum number of distinct accounts that can be
/// borrowed simultaneously. The transaction may contain more accounts than this
/// limit. For optimal performance, use a power of 2 value.
pub struct AccountManager<const NUM_ACCOUNTS: usize> {
    /* Track borrow state for each account to prevent aliasing.
     * Uses IndexMap to allow sparse access patterns (only accessed accounts are stored).
     * RefCell provides interior mutability for lazy insertion on first access.
     * Uses identity hasher where the account index is used directly as the hash. */
    borrow_states:
        RefCell<IndexMap<u16, RefCell<()>, BuildHasherDefault<IdentityHasher>, NUM_ACCOUNTS>>,
    rw_cnt: u16, /* count of read-write accounts */
    ro_cnt: u16, /* count of read-only accounts */
    pub txn: &'static Txn,
}

impl<const NUM_ACCOUNTS: usize> AccountManager<NUM_ACCOUNTS> {
    /// Create account manager from transaction.
    ///
    /// `NUM_ACCOUNTS` specifies the maximum number of distinct accounts that can be
    /// borrowed simultaneously. The transaction may contain more accounts than this,
    /// but you can only have up to `NUM_ACCOUNTS` accounts borrowed at once.
    pub fn from_txn(txn: &'static Txn) -> Result<Self, AccountError> {
        if txn.hdr.version() != 1 {
            return Err(AccountError::UnsupportedTxnVersion {
                version: txn.hdr.version(),
            });
        }

        let rw_cnt = txn.readwrite_accounts_cnt();
        let ro_cnt = txn.readonly_accounts_cnt();

        let borrow_states = RefCell::new(IndexMap::<
            u16,
            RefCell<()>,
            BuildHasherDefault<IdentityHasher>,
            NUM_ACCOUNTS,
        >::new());
        Ok(Self {
            borrow_states,
            rw_cnt,
            ro_cnt,
            txn,
        })
    }

    /// Total number of accounts in this transaction.
    pub fn accounts_count(&self) -> u16 {
        2 + self.rw_cnt + self.ro_cnt
    }

    /// Get or insert a borrow cell for the given index.
    /// This uses interior mutability to lazily create RefCells on first access.
    ///
    /// Returns `None` if the map is full and cannot insert a new entry.
    fn get_or_insert_borrow_cell(&self, index: u16) -> Option<&RefCell<()>> {
        /* First ensure the entry exists in the map */
        {
            let mut map = self.borrow_states.borrow_mut();
            if !map.contains_key(&index) {
                /* Try to insert; if map is full, this will fail */
                map.insert(index, RefCell::new(())).ok()?;
            }
        } /* Drop the mutable borrow */

        /* SAFETY: The IndexMap is stored inline in the RefCell and never moves.
         * We never remove entries from the map, only add them. The RefCell<()> values
         * have stable addresses as long as the IndexMap exists. We use unsafe here to
         * extend the lifetime of the returned reference from the Ref guard's lifetime
         * to the lifetime of &self, which is safe because the underlying data is stable. */
        unsafe {
            let map_ref = self.borrow_states.borrow();
            let cell_ptr = map_ref.get(&index)? as *const RefCell<()>;
            Some(&*cell_ptr)
        }
    }

    /// Get account reference with proper access control and borrow checking.
    ///
    /// Returns `Err(AccountError)` if:
    /// - Index is out of bounds
    /// - Account is already borrowed incompatibly
    /// - Account data is not available
    /// - Map is full (more than NUM_ACCOUNTS distinct accounts accessed)
    pub fn get(&self, index: u16) -> Result<AccountRef<'_>, AccountError> {
        let max = self.accounts_count();
        if index >= max {
            return Err(AccountError::IndexOutOfBounds { index, max });
        }

        let (is_mutable, account_type) = match index {
            0 => (true, AccountType::FeePayer),
            1 => (false, AccountType::Program),
            i if i >= 2 && i < (2 + self.rw_cnt) => (true, AccountType::ReadWrite),
            _ => (false, AccountType::ReadOnly),
        };

        let borrow_cell =
            self.get_or_insert_borrow_cell(index)
                .ok_or(AccountError::TooManyAccountsAccessed {
                    max_capacity: NUM_ACCOUNTS,
                })?;

        if is_mutable {
            let borrow_guard = borrow_cell
                .try_borrow_mut()
                .map_err(|_| AccountError::AlreadyBorrowed { index })?;

            let account_info = unsafe {
                get_account_info_at_idx_mut(index)
                    .map_err(|err| AccountError::InfoAccessFailed { index, err })?
            };

            Ok(AccountRef::new_mutable(
                account_info,
                account_type,
                borrow_guard,
            ))
        } else {
            let borrow_guard = borrow_cell
                .try_borrow()
                .map_err(|_| AccountError::AlreadyBorrowedMutably { index })?;

            let account_info = unsafe {
                get_account_info_at_idx(index)
                    .map_err(|err| AccountError::InfoAccessFailed { index, err })?
            };

            Ok(AccountRef::new_immutable(
                account_info,
                account_type,
                borrow_guard,
            ))
        }
    }

    /// Try to get an account as read-only, regardless of its actual permissions.
    /// This is useful when you know you only need to read from an account.
    ///
    /// Returns `Err(AccountError)` if the account is currently borrowed mutably,
    /// if the map is full, or if the account index is invalid.
    pub fn get_readonly(&self, index: u16) -> Result<AccountRef<'_>, AccountError> {
        let max = self.accounts_count();
        if index >= max {
            return Err(AccountError::IndexOutOfBounds { index, max });
        }

        let borrow_cell =
            self.get_or_insert_borrow_cell(index)
                .ok_or(AccountError::TooManyAccountsAccessed {
                    max_capacity: NUM_ACCOUNTS,
                })?;

        let borrow_guard = borrow_cell
            .try_borrow()
            .map_err(|_| AccountError::AlreadyBorrowedMutably { index })?;

        let account_info = unsafe {
            get_account_info_at_idx(index)
                .map_err(|err| AccountError::InfoAccessFailed { index, err })?
        };

        Ok(AccountRef::new_immutable(
            account_info,
            AccountType::ReadOnly,
            borrow_guard,
        ))
    }

    /// Iterator over **all** accounts, in on-wire order (fee-payer first).
    ///
    /// Note: This iterator will skip accounts that are currently borrowed or cannot
    /// be accessed (e.g., if the map is full).
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let mgr = AccountManager::<8>::from_txn(&txn)
    ///     .expect("not V1 or size mismatch");
    ///
    /// for (i, acc) in mgr.accounts_iter() {
    ///     println!("{i}: {:?}, balance: {}", acc.account_type(), acc.balance());
    /// }
    /// ```
    #[inline]
    pub fn accounts_iter(&self) -> AccountIter<'_, NUM_ACCOUNTS> {
        AccountIter {
            mgr: self,
            next_idx: 0,
        }
    }

    /// Check if an account is currently borrowed.
    pub fn is_borrowed(&self, index: u16) -> bool {
        if index >= self.accounts_count() {
            return false;
        }

        self.borrow_states
            .borrow()
            .get(&index)
            .map(|cell| cell.try_borrow_mut().is_err())
            .unwrap_or(false)
    }

    /// Get the account role/type for a given index.
    pub fn account_role(&self, index: u16) -> Result<AccountType, AccountError> {
        let max = self.accounts_count();
        if index >= max {
            return Err(AccountError::IndexOutOfBounds { index, max });
        }

        Ok(match index {
            0 => AccountType::FeePayer,
            1 => AccountType::Program,
            i if i >= 2 && i < (2 + self.rw_cnt) => AccountType::ReadWrite,
            _ => AccountType::ReadOnly,
        })
    }

    /// Check if an account can be borrowed mutably (based on its role).
    pub fn is_mutable(&self, index: u16) -> bool {
        self.account_role(index)
            .map(|role| role.is_mutable())
            .unwrap_or(false)
    }

    /// Panic if the account at `idx` is currently borrowed.
    fn assert_not_borrowed(&self, idx: u16, operation: &str) {
        if self.is_borrowed(idx) {
            panic!("Cannot {} account {} while it is borrowed", operation, idx);
        }
    }

    /// Check if any accounts are currently borrowed.
    ///
    /// Returns `true` if any account in the transaction has an active borrow.
    pub fn has_active_borrows(&self) -> bool {
        let map = self.borrow_states.borrow();
        for (_, cell) in map.iter() {
            /* Check if the cell is currently borrowed */
            if cell.try_borrow_mut().is_err() {
                return true;
            }
        }
        false
    }

    /// Invoke a program with the given instruction data.
    ///
    /// This function checks that there are no active account borrows before invoking
    /// the program to ensure memory safety across the program invocation boundary.
    ///
    /// # Parameters
    /// - `program_account_idx`: Index of the program account to invoke
    /// - `instr_data`: Instruction data to pass to the program
    ///
    /// # Returns
    /// A tuple of (SyscallCode, SyscallCode) representing the invoke result and exit code.
    ///
    /// # Safety
    /// This function performs syscalls which are inherently unsafe. Additionally, it
    /// verifies that no accounts are currently borrowed to prevent aliasing issues.
    ///
    /// # Panics
    /// Panics if there are active account borrows when attempting to invoke.
    pub fn invoke(
        &self,
        program_account_idx: u16,
        instr_data: &[u8],
        auth: Option<&crate::types::shadow_stack::InvokeAuth>,
    ) -> (crate::syscall::SyscallCode, crate::syscall::SyscallCode) {
        /* Ensure no accounts are currently borrowed */
        if self.has_active_borrows() {
            panic!("Cannot invoke program while accounts are borrowed");
        }

        if let Some(auth) = auth {
            if auth.magic != crate::types::shadow_stack::INVOKE_AUTH_MAGIC {
                crate::program_utils::revert(INVOKE_AUTH_ERR_BAD_MAGIC);
            }

            let account_cnt = get_txn().accounts_cnt();
            let auth_idxs = unsafe { auth.auth_idxs() };
            for &idx in auth_idxs {
                if idx >= account_cnt {
                    crate::program_utils::revert(INVOKE_AUTH_ERR_INVALID_ACCOUNT_INDEX);
                }
                if !crate::program_utils::is_account_idx_owned_by_current_program(idx) {
                    crate::program_utils::revert(INVOKE_AUTH_ERR_UNOWNED_AUTH_ACCOUNT);
                }
            }

            let deauth_idxs = unsafe { auth.deauth_idxs() };
            for &idx in deauth_idxs {
                if idx >= account_cnt {
                    crate::program_utils::revert(INVOKE_AUTH_ERR_INVALID_ACCOUNT_INDEX);
                }
            }
        }

        let auth_ptr = match auth {
            Some(a) => a as *const crate::types::shadow_stack::InvokeAuth as *const u8,
            None => core::ptr::null(),
        };

        /* Perform the syscall */
        unsafe {
            crate::syscall::sys_invoke(
                instr_data.as_ptr(),
                instr_data.len() as u64,
                program_account_idx,
                auth_ptr,
            )
        }
    }

    /// Resize an account's data.
    ///
    /// This function checks that the account is not currently borrowed before
    /// resizing it.
    ///
    /// # Parameters
    /// - `account_idx`: Index of the account to resize
    /// - `new_size`: New size in bytes
    ///
    /// # Returns
    /// The syscall result code.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_resize(&self, account_idx: u16, new_size: u64) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "resize");
        unsafe { crate::syscall::sys_account_resize(account_idx as u64, new_size) }
    }

    /// Mark an account's data segment as writable.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn set_account_data_writable(&self, account_idx: u16) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "set writable");
        unsafe { crate::syscall::sys_set_account_data_writable(account_idx as u64) }
    }

    /// Transfer balance between two accounts.
    ///
    /// # Panics
    /// Panics if either account is currently borrowed.
    pub fn account_transfer(
        &self,
        from_idx: u16,
        to_idx: u16,
        amount: u64,
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(from_idx, "transfer from");
        self.assert_not_borrowed(to_idx, "transfer to");
        unsafe { crate::syscall::sys_account_transfer(from_idx as u64, to_idx as u64, amount) }
    }

    /// Create a new persistent account, make it writable, resize it, and return
    /// a mutable reference. Combines account_create + set_account_data_writable +
    /// account_resize + get into a single call.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn create_and_init(
        &self,
        account_idx: u16,
        seed: &[u8; crate::syscall::SEED_SIZE],
        proof: &crate::types::state_proof::StateProof<'_>,
        data_size: u64,
    ) -> Result<AccountRef<'_>, crate::syscall::SyscallCode> {
        let e = self.account_create(account_idx, seed, proof);
        if e != crate::syscall::SyscallCode::Success { return Err(e); }

        let e = self.set_account_data_writable(account_idx);
        if e != crate::syscall::SyscallCode::Success { return Err(e); }

        let e = self.account_resize(account_idx, data_size);
        if e != crate::syscall::SyscallCode::Success { return Err(e); }

        self.get(account_idx).map_err(|_| crate::syscall::SyscallCode::InvalidAccountIndex)
    }

    /// Create a new persistent account.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_create(
        &self,
        account_idx: u16,
        seed: &[u8; crate::syscall::SEED_SIZE],
        proof: &crate::types::state_proof::StateProof<'_>,
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "create");
        unsafe {
            crate::syscall::sys_account_create(
                account_idx as u64,
                seed,
                proof.as_ptr(),
                proof.footprint() as u64,
            )
        }
    }

    /// Create a new ephemeral account.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_create_ephemeral(
        &self,
        account_idx: u16,
        seed: &[u8; crate::syscall::SEED_SIZE],
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "create ephemeral");
        unsafe { crate::syscall::sys_account_create_ephemeral(account_idx as u64, seed) }
    }

    /// Delete an account.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_delete(&self, account_idx: u16) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "delete");
        unsafe { crate::syscall::sys_account_delete(account_idx as u64) }
    }

    /// Compress an account into the state tree.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_compress(
        &self,
        account_idx: u16,
        proof: &crate::types::state_proof::StateProof<'_>,
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "compress");
        unsafe {
            crate::syscall::sys_account_compress(
                account_idx as u64,
                proof.as_ptr(),
                proof.footprint() as u64,
            )
        }
    }

    /// Decompress an account from the state tree.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_decompress(
        &self,
        account_idx: u16,
        meta: *const u8,
        data: *const u8,
        proof: &crate::types::state_proof::StateProof<'_>,
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "decompress");
        unsafe {
            crate::syscall::sys_account_decompress(
                account_idx as u64,
                meta,
                data,
                proof.as_ptr(),
                proof.footprint() as u64,
            )
        }
    }

    /// Set flags on an account.
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_set_flags(&self, account_idx: u16, flags: u8) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "set flags on");
        unsafe { crate::syscall::sys_account_set_flags(account_idx, flags) }
    }

    /// Create a new externally-owned account (EOA).
    ///
    /// # Panics
    /// Panics if the account is currently borrowed.
    pub fn account_create_eoa(
        &self,
        account_idx: u16,
        signature: &crate::types::signature::Signature,
        proof: &crate::types::state_proof::StateProof<'_>,
    ) -> crate::syscall::SyscallCode {
        self.assert_not_borrowed(account_idx, "create EOA");
        unsafe {
            crate::syscall::sys_account_create_eoa(
                account_idx as u64,
                signature,
                proof.as_ptr(),
                proof.footprint() as u64,
            )
        }
    }
}

/// Iterator over accounts in transaction order.
/// See [`AccountManager::accounts_iter`].
pub struct AccountIter<'a, const N: usize> {
    mgr: &'a AccountManager<N>,
    next_idx: u16,
}

impl<'a, const N: usize> Iterator for AccountIter<'a, N> {
    type Item = (u16, AccountRef<'a>);

    /// Skips accounts that cannot be borrowed (already borrowed or map is full)
    fn next(&mut self) -> Option<Self::Item> {
        while self.next_idx < self.mgr.accounts_count() {
            let idx = self.next_idx;
            self.next_idx += 1;

            if let Ok(acc) = self.mgr.get(idx) {
                return Some((idx, acc));
            }
        }
        None
    }
}

impl<'a, const N: usize> IntoIterator for &'a AccountManager<N> {
    type Item = (u16, AccountRef<'a>);
    type IntoIter = AccountIter<'a, N>;

    fn into_iter(self) -> Self::IntoIter {
        self.accounts_iter()
    }
}
