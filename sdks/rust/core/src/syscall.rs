// RISC-V syscall wrappers for the Thru VM runtime.
// This module intentionally mirrors the helpers that exist in
// `thru-net/src/thru/programs/sdk/tn_sdk_syscall.c` so that smart-contracts
// written in Rust can interact with the VM in the exact same way contracts
// written in C currently do.

#![cfg_attr(not(target_arch = "riscv64"), allow(dead_code))]

use crate::types::signature::Signature;
#[cfg(target_arch = "riscv64")]
use core::arch::asm;

// ---------------------------------------------------------------------------
// Public constants – keep identical numeric values to the original C headers
// ---------------------------------------------------------------------------

pub const SEED_SIZE: usize = 32;
pub const SET_ANONYMOUS_SEGMENT_SZ: u64 = 0x00;
pub const INCREMENT_ANONYMOUS_SEGMENT_SZ: u64 = 0x01;
pub const SET_ACCOUNT_DATA_WRITABLE: u64 = 0x02;
pub const ACCOUNT_TRANSFER: u64 = 0x03;
pub const ACCOUNT_CREATE: u64 = 0x04;
pub const ACCOUNT_CREATE_EPHEMERAL: u64 = 0x05;
pub const ACCOUNT_DELETE: u64 = 0x06;
pub const ACCOUNT_RESIZE: u64 = 0x07;
pub const ACCOUNT_COMPRESS: u64 = 0x08;
pub const ACCOUNT_DECOMPRESS: u64 = 0x09;
pub const INVOKE: u64 = 0x0A;
pub const EXIT: u64 = 0x0B;
pub const LOG: u64 = 0x0C;
pub const EMIT_EVENT: u64 = 0x0D;
pub const ACCOUNT_SET_FLAGS: u64 = 0x0E;
pub const ACCOUNT_CREATE_EOA: u64 = 0x0F;

// ---------------------------------------------------------------------------
// Memory-layout helpers (architecture-agnostic) – available on all targets
// ---------------------------------------------------------------------------

pub const SEG_TYPE_READONLY_DATA: u64 = 0x00;
pub const SEG_TYPE_ACCOUNT_METADATA: u64 = 0x02;
pub const SEG_TYPE_ACCOUNT_DATA: u64 = 0x03;
pub const SEG_TYPE_STACK: u64 = 0x05;
pub const SEG_TYPE_HEAP: u64 = 0x07;

pub const SEG_IDX_NULL: u64 = 0x0000;
pub const SEG_IDX_TXN_DATA: u64 = 0x0001;
pub const SEG_IDX_SHADOW_STACK: u64 = 0x0002;
pub const SEG_IDX_PROGRAM: u64 = 0x0003;

// ---------------------------------------------------------------------------
// Syscall helpers – unsafe because they perform raw `ecall` instructions.
// All helpers strictly follow the calling-convention of the C SDK.
// ---------------------------------------------------------------------------

// ========== RISC-V IMPLEMENTATION ============================================================
#[cfg(target_arch = "riscv64")]
mod imp {
    use super::*;

    // all constants already available in parent; macro riscv_asm already defined

    /// Mark an account's data segment as writable.
    ///
    /// # Safety
    ///
    /// This syscall mutates the account's writable state in the VM. Any
    /// existing `&AccountMeta` or `&[u8]` references to the affected
    /// account must be dropped **before** this call. Holding an immutable
    /// reference while the VM modifies the underlying memory is undefined
    /// behavior under Rust's aliasing rules. Prefer using
    /// [`AccountManager::set_account_data_writable`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_set_account_data_writable(account_idx: u64) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a7") SET_ACCOUNT_DATA_WRITABLE,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Transfer balance between two accounts.
    ///
    /// # Safety
    ///
    /// This syscall mutates the balance fields of both the source and
    /// destination accounts in the VM. Any existing `&AccountMeta`
    /// references to either account must be dropped **before** this call.
    /// Holding an immutable reference while the VM modifies the underlying
    /// memory is undefined behavior under Rust's aliasing rules. Prefer
    /// using [`AccountManager::account_transfer`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_transfer(from_idx: u64, to_idx: u64, amount: u64) -> SyscallCode {
        let mut a0 = from_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") to_idx,
            in("a2") amount,
            in("a7") ACCOUNT_TRANSFER,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Set the size of an anonymous memory segment.
    ///
    /// # Safety
    ///
    /// This syscall modifies the VM's segment table. Pointers or
    /// references derived from the affected segment may be invalidated.
    /// Callers must ensure no references to the segment exist before
    /// calling this function.
    #[inline(always)]
    pub unsafe fn sys_set_anonymous_segment_sz(addr: *mut u8) -> SyscallCode {
        let mut a0 = addr as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a7") SET_ANONYMOUS_SEGMENT_SZ,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Grow an anonymous memory segment by `delta` bytes.
    ///
    /// # Safety
    ///
    /// This syscall modifies the VM's segment table. Existing pointers
    /// or references to the segment may be invalidated after the resize.
    /// Callers must ensure no references to the segment exist before
    /// calling this function.
    #[inline(always)]
    pub unsafe fn sys_increment_anonymous_segment_sz(
        ptr: *mut (),
        delta: u64,
    ) -> (SyscallCode, *mut u8) {
        let mut a0 = ptr as u64;
        let mut a1 = delta;
        asm!(
            "ecall",
            inout("a0") a0,
            inout("a1") a1,
            in("a7") INCREMENT_ANONYMOUS_SEGMENT_SZ,
            options(nostack, preserves_flags),
        );
        (SyscallCode::from_i64(a0 as i64), a1 as *mut u8)
    }

    /// Create a new persistent account.
    ///
    /// # Safety
    ///
    /// This syscall creates an account and populates its metadata and
    /// data segments in the VM. Any existing references to the account
    /// at `account_idx` (even if it previously did not exist) must be
    /// dropped **before** this call, as the VM will write to those
    /// memory regions. Holding references while the VM modifies the
    /// underlying memory is undefined behavior under Rust's aliasing
    /// rules. Prefer using
    /// [`AccountManager::account_create`](crate::AccountManager) which
    /// enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_create(
        account_idx: u64,
        seed: &[u8; SEED_SIZE],
        proof: *const u8,
        proof_sz: u64,
    ) -> SyscallCode {
        let mut a0 = account_idx;
        // Convert 32-byte seed to 4 u64 values safely
        let seed1 = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let seed2 = u64::from_le_bytes(seed[8..16].try_into().unwrap());
        let seed3 = u64::from_le_bytes(seed[16..24].try_into().unwrap());
        let seed4 = u64::from_le_bytes(seed[24..32].try_into().unwrap());
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") seed1,
            in("a2") seed2,
            in("a3") seed3,
            in("a4") seed4,
            in("a5") proof as u64,
            in("a6") proof_sz,
            in("a7") ACCOUNT_CREATE,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Create a new ephemeral account.
    ///
    /// # Safety
    ///
    /// This syscall creates an account and populates its metadata and
    /// data segments in the VM. Any existing references to the account
    /// at `account_idx` must be dropped **before** this call, as the VM
    /// will write to those memory regions. Holding references while the
    /// VM modifies the underlying memory is undefined behavior under
    /// Rust's aliasing rules. Prefer using
    /// [`AccountManager::account_create_ephemeral`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_create_ephemeral(
        account_idx: u64,
        seed: &[u8; SEED_SIZE],
    ) -> SyscallCode {
        let mut a0 = account_idx;
        // Convert 32-byte seed to 4 u64 values safely
        let seed1 = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let seed2 = u64::from_le_bytes(seed[8..16].try_into().unwrap());
        let seed3 = u64::from_le_bytes(seed[16..24].try_into().unwrap());
        let seed4 = u64::from_le_bytes(seed[24..32].try_into().unwrap());
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") seed1,
            in("a2") seed2,
            in("a3") seed3,
            in("a4") seed4,
            in("a7") ACCOUNT_CREATE_EPHEMERAL,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Delete an account.
    ///
    /// `signature` is an OPTIONAL Ed25519 signature over the canonical
    /// domain-separated delete message `"tn_eoa_delete_v1" || chain_id ||
    /// fee_payer_pubkey || account_pubkey`. When `Some`, the runtime verifies
    /// it against the account's own pubkey before deleting; when `None` no
    /// signature is required (ordinary program-owned accounts). The EOA
    /// program passes a signature so a permissionless caller cannot delete an
    /// EOA without the keyholder's consent. This is additive to the owner
    /// check, never a bypass.
    ///
    /// # Safety
    ///
    /// This syscall deletes the account and invalidates its metadata
    /// and data segments in the VM. Any existing `&AccountMeta` or
    /// `&[u8]` references to the affected account must be dropped
    /// **before** this call. Accessing memory through a reference to a
    /// deleted account is undefined behavior. Prefer using
    /// [`AccountManager::account_delete`](crate::AccountManager) which
    /// enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_delete(
        account_idx: u64,
        signature: Option<&Signature>,
    ) -> SyscallCode {
        let mut a0 = account_idx;
        let a1 = match signature {
            Some(sig) => sig.0.as_ptr() as u64,
            None => 0u64,
        };
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") a1,
            in("a7") ACCOUNT_DELETE,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Resize an account's data region.
    ///
    /// # Safety
    ///
    /// This syscall changes the size of the account's data segment and
    /// updates its metadata. Any existing `&AccountMeta` or `&[u8]`
    /// references to the affected account must be dropped **before**
    /// this call. After a resize, previously held data slices may point
    /// beyond the new bounds or reference freed memory. Prefer using
    /// [`AccountManager::account_resize`](crate::AccountManager) which
    /// enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_resize(account_idx: u64, new_size: u64) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") new_size,
            in("a7") ACCOUNT_RESIZE,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Compress an account into the state tree.
    ///
    /// # Safety
    ///
    /// This syscall modifies the account's metadata (sets compressed
    /// flag) and invalidates its data segment. Any existing
    /// `&AccountMeta` or `&[u8]` references to the affected account
    /// must be dropped **before** this call. Prefer using
    /// [`AccountManager::account_compress`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_compress(
        account_idx: u64,
        proof: *const u8,
        proof_sz: u64,
    ) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") proof as u64,
            in("a2") proof_sz,
            in("a7") ACCOUNT_COMPRESS,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Decompress an account from the state tree.
    ///
    /// # Safety
    ///
    /// This syscall restores the account's metadata and data segments
    /// from compressed state. Any existing references to the account at
    /// `account_idx` must be dropped **before** this call, as the VM
    /// will write to those memory regions. Holding references while the
    /// VM modifies the underlying memory is undefined behavior under
    /// Rust's aliasing rules. Prefer using
    /// [`AccountManager::account_decompress`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_decompress(
        account_idx: u64,
        meta: *const u8,
        data: *const u8,
        proof: *const u8,
        proof_sz: u64,
    ) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") meta as u64,
            in("a2") data as u64,
            in("a3") proof as u64,
            in("a4") proof_sz,
            in("a7") ACCOUNT_DECOMPRESS,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Invoke another program (cross-program invocation).
    ///
    /// # Safety
    ///
    /// This syscall transfers execution to another program which may
    /// mutate any writable account in the transaction. **All** existing
    /// `&AccountMeta` or `&[u8]` references to any account must be
    /// dropped **before** this call. The invoked program may modify
    /// balances, data, and metadata of any account it has access to.
    /// Prefer using [`AccountManager::invoke`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_invoke(
        instr_data: *const u8,
        instr_data_sz: u64,
        program_account_idx: u16,
        auth: *const u8,
    ) -> (SyscallCode, SyscallCode) {
        let mut a0 = instr_data as u64;
        let mut a1 = instr_data_sz as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            inout("a1") a1,
            in("a2") program_account_idx as u64,
            in("a3") auth as u64,
            in("a7") INVOKE,
            options(nostack, preserves_flags),
        );
        (
            SyscallCode::from_i64(a0 as i64),
            SyscallCode::from_i64(a1 as i64),
        )
    }

    /// Exit the program with the given code and revert flag.
    ///
    /// This syscall terminates execution and does not return. It does
    /// not modify any account state so there are no aliasing concerns.
    #[inline(always)]
    pub fn sys_exit(exit_code: u64, revert: u64) -> ! {
        unsafe {
            asm!(
                "ecall",
                in("a0") exit_code,
                in("a1") revert,
                in("a7") EXIT,
                options(noreturn),
            );
        }
    }

    /// Log a message. This syscall does not modify account state.
    #[inline(always)]
    pub unsafe fn sys_log(data: *const u8, data_sz: u64) -> u64 {
        let mut a0 = data as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") data_sz,
            in("a7") LOG,
            options(nostack, preserves_flags),
        );
        a0
    }

    /// Emit an event. This syscall does not modify account state.
    #[inline(always)]
    pub unsafe fn sys_emit_event(data: *const u8, data_sz: u64) -> u64 {
        let mut a0 = data as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") data_sz,
            in("a7") EMIT_EVENT,
            options(nostack, preserves_flags),
        );
        a0
    }

    /// Set flags on an account.
    ///
    /// # Safety
    ///
    /// This syscall modifies the account's metadata flags in the VM.
    /// Any existing `&AccountMeta` references to the affected account
    /// must be dropped **before** this call. Holding an immutable
    /// reference while the VM modifies the underlying memory is
    /// undefined behavior under Rust's aliasing rules. Prefer using
    /// [`AccountManager::account_set_flags`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_set_flags(account_idx: u16, flags: u8) -> SyscallCode {
        let mut a0 = account_idx as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") flags as u64,
            in("a7") ACCOUNT_SET_FLAGS,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

    /// Create a new externally-owned account (EOA).
    ///
    /// # Safety
    ///
    /// This syscall creates an account and populates its metadata and
    /// data segments in the VM. Any existing references to the account
    /// at `account_idx` must be dropped **before** this call, as the VM
    /// will write to those memory regions. Holding references while the
    /// VM modifies the underlying memory is undefined behavior under
    /// Rust's aliasing rules. Prefer using
    /// [`AccountManager::account_create_eoa`](crate::AccountManager)
    /// which enforces borrow checks at runtime.
    #[inline(always)]
    pub unsafe fn sys_account_create_eoa(
        account_idx: u64,
        signature: &Signature,
        proof: *const u8,
        proof_sz: u64,
    ) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") signature.0.as_ptr() as u64,
            in("a2") proof as u64,
            in("a3") proof_sz,
            in("a7") ACCOUNT_CREATE_EOA,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }
}

/// Syscall error codes that correspond to the C VM error definitions
#[repr(i64)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyscallCode {
    // Success codes
    Success = 0,
    SuccessExit = 1,

    // Error codes - direct negative values from C
    BadSegmentTableSize = -7,
    InvalidAccountIndex = -8,
    AccountDoesNotExist = -9,
    AccountNotWritable = -10,
    BalanceOverflow = -11,
    AccountTooBig = -12,
    InvalidObjRefKind = -13,
    ObjNotWritable = -14,
    AccountAlreadyExists = -15,
    BadAccountAddress = -16,
    AccountIsNotProgram = -17,
    AccountHasData = -18,
    SegmentAlreadyMapped = -19,
    BadParams = -20,
    InvalidSegmentId = -21,
    InvalidAddress = -22,
    InvalidStateProof = -23,
    CallDepthTooDeep = -24,
    Revert = -25,
    InsufficientPages = -26,
    InvalidAccount = -27,
    InvalidSegmentSize = -28,
    UnfreeablePage = -29,
    LogDataTooLarge = -30,
    EventTooLarge = -31,
    InvalidProofLen = -32,
    InvalidProofSlot = -33,
    AccountInCompressionTimeout = -34,
    InvalidAccountDataSize = -35,
    InvalidSeedLength = -36,
    TxnHasCompressedAccount = -37,
    InsufficientBalance = -38,
    InvalidOffset = -39,
    ComputeUnitsExceeded = -40,
    InvalidFlags = -41,
    EphemeralAccountCannotCreatePersistent = -42,

    // Fallback
    UnknownCode = i64::MIN,
}

impl SyscallCode {
    pub fn from_i64(code: i64) -> Self {
        match code {
            0 => Self::Success,
            1 => Self::SuccessExit,
            -7 => Self::BadSegmentTableSize,
            -8 => Self::InvalidAccountIndex,
            -9 => Self::AccountDoesNotExist,
            -10 => Self::AccountNotWritable,
            -11 => Self::BalanceOverflow,
            -12 => Self::AccountTooBig,
            -13 => Self::InvalidObjRefKind,
            -14 => Self::ObjNotWritable,
            -15 => Self::AccountAlreadyExists,
            -16 => Self::BadAccountAddress,
            -17 => Self::AccountIsNotProgram,
            -18 => Self::AccountHasData,
            -19 => Self::SegmentAlreadyMapped,
            -20 => Self::BadParams,
            -21 => Self::InvalidSegmentId,
            -22 => Self::InvalidAddress,
            -23 => Self::InvalidStateProof,
            -24 => Self::CallDepthTooDeep,
            -25 => Self::Revert,
            -26 => Self::InsufficientPages,
            -27 => Self::InvalidAccount,
            -28 => Self::InvalidSegmentSize,
            -29 => Self::UnfreeablePage,
            -30 => Self::LogDataTooLarge,
            -31 => Self::EventTooLarge,
            -32 => Self::InvalidProofLen,
            -33 => Self::InvalidProofSlot,
            -34 => Self::AccountInCompressionTimeout,
            -35 => Self::InvalidAccountDataSize,
            -36 => Self::InvalidSeedLength,
            -37 => Self::TxnHasCompressedAccount,
            -38 => Self::InsufficientBalance,
            -39 => Self::InvalidOffset,
            -40 => Self::ComputeUnitsExceeded,
            -41 => Self::InvalidFlags,
            -42 => Self::EphemeralAccountCannotCreatePersistent,
            _ => Self::UnknownCode,
        }
    }
}

impl From<SyscallCode> for i64 {
    fn from(code: SyscallCode) -> Self {
        code as i64
    }
}

impl From<i64> for SyscallCode {
    fn from(code: i64) -> Self {
        SyscallCode::from_i64(code)
    }
}

// Re-export RISC-V impl when appropriate.
#[cfg(target_arch = "riscv64")]
pub use imp::*;
