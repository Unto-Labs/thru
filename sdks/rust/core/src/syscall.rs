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

    #[inline(always)]
    pub fn sys_set_account_data_writable(account_idx: u64) -> SyscallCode {
        let mut a0 = account_idx;
        // SAFETY: If the account index is invalid, this will fail gracefully.
        unsafe {
            asm!(
                "ecall",
                inout("a0") a0,
                in("a7") SET_ACCOUNT_DATA_WRITABLE,
                options(nostack, preserves_flags),
            );
        }
        SyscallCode::from_i64(a0 as i64)
    }

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

    #[inline(always)]
    pub unsafe fn sys_account_delete(account_idx: u64) -> SyscallCode {
        let mut a0 = account_idx;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a7") ACCOUNT_DELETE,
            options(nostack, preserves_flags),
        );
        SyscallCode::from_i64(a0 as i64)
    }

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

    #[inline(always)]
    pub unsafe fn sys_invoke(
        instr_data: *const u8,
        instr_data_sz: u64,
        program_account_idx: u16,
    ) -> (SyscallCode, SyscallCode) {
        let mut a0 = instr_data as u64;
        let mut a1 = instr_data_sz as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            inout("a1") a1,
            in("a2") program_account_idx as u64,
            in("a7") INVOKE,
            options(nostack, preserves_flags),
        );
        (
            SyscallCode::from_i64(a0 as i64),
            SyscallCode::from_i64(a1 as i64),
        )
    }

    #[inline(always)]
    pub fn sys_exit(exit_code: u64, revert: u64) -> ! {
        // SAFETY: Any values are valid for exit_code and revert.
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

    #[inline(always)]
    pub unsafe fn sys_account_set_flags(account_idx: u16, flags: u8) -> u64 {
        let mut a0 = account_idx as u64;
        asm!(
            "ecall",
            inout("a0") a0,
            in("a1") flags as u64,
            in("a7") ACCOUNT_SET_FLAGS,
            options(nostack, preserves_flags),
        );
        a0
    }

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
