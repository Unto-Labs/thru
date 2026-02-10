use core::ptr;

use crate::types::account::{AccountInfo, AccountInfoMut, AccountMeta, TSDK_ACCOUNT_VERSION_V1};
use crate::types::block_ctx::BlockCtx;
use crate::types::txn::{Txn, TXN_MAX_SZ};

/// Errors that can occur when accessing memory regions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryError {
    /// Account version is not supported
    UnsupportedAccountVersion { version: u8 },
}

pub const SEG_TYPE_MASK: usize = 0xFF_0000_000000_usize;
pub const SEG_IDX_MASK: usize = 0x00_FFFF_000000_usize;
pub const SEG_OFFSET_MASK: usize = 0x00_0000_FFFFFF_usize;

pub const SEG_TYPE_READONLY_DATA: usize = 0x00_usize;
pub const SEG_TYPE_ACCOUNT_METADATA: usize = 0x02_usize;
pub const SEG_TYPE_ACCOUNT_DATA: usize = 0x03_usize;
pub const SEG_TYPE_STACK: usize = 0x05_usize;
pub const SEG_TYPE_HEAP: usize = 0x07_usize;

pub const SEG_IDX_TXN_DATA: usize = 0x0001usize;
pub const SEG_IDX_SHADOW_STACK: usize = 0x0002usize;
pub const SEG_IDX_PROGRAM: usize = 0x0003usize;
pub const SEG_IDX_BLOCK_CTX: usize = 0x0004usize;
pub const BLOCK_CTX_VM_SPACING: usize = 0x1000usize;

// TODO: need to add some sort of singleton to have borrow checker properly work

/// Compute a VM segment address from type, index, and offset.
///
/// The address format is:
/// ```text
/// | seg_type (8 bits) | seg_idx (16 bits) | offset (24 bits) |
/// ```
#[inline]
pub const fn compute_segment_addr(seg_type: usize, seg_idx: usize, offset: usize) -> usize {
    (seg_type << 40) | (seg_idx << 24) | offset
}

/// Legacy macro for computing segment addresses.
/// Prefer `compute_segment_addr` function for new code.
#[macro_export]
macro_rules! compute_addr {
    ($seg_type:expr, $seg_idx:expr, $offset:expr) => {
        $crate::mem::compute_segment_addr($seg_type as usize, $seg_idx as usize, $offset as usize)
    };
}

/// Create a const pointer to a VM segment with proper provenance.
///
/// Uses `with_exposed_provenance` to create a pointer from a VM segment address.
/// The VM runtime implicitly grants provenance over the memory it provides.
#[inline]
pub fn vm_ptr<T>(seg_type: usize, seg_idx: usize, offset: usize) -> *const T {
    let addr = compute_segment_addr(seg_type, seg_idx, offset);
    ptr::with_exposed_provenance(addr)
}

/// Create a mutable pointer to a VM segment with proper provenance.
#[inline]
pub fn vm_ptr_mut<T>(seg_type: usize, seg_idx: usize, offset: usize) -> *mut T {
    let addr = compute_segment_addr(seg_type, seg_idx, offset);
    ptr::with_exposed_provenance_mut(addr)
}

/// Address of transaction data segment.
pub const TXN_DATA_ADDR: usize =
    compute_segment_addr(SEG_TYPE_READONLY_DATA, SEG_IDX_TXN_DATA, 0x000000);

/// Address of block context segment.
pub const BLOCK_CTX_ADDR: usize =
    compute_segment_addr(SEG_TYPE_READONLY_DATA, SEG_IDX_BLOCK_CTX, 0x000000);

/* TODO: get the raw parts of the transaction individually */

pub fn get_txn() -> &'static Txn {
    // Create pointer with proper provenance from VM segment address
    let txn_ptr: *const u8 = vm_ptr(SEG_TYPE_READONLY_DATA, SEG_IDX_TXN_DATA, 0);
    let txn_data: &[u8] = unsafe { core::slice::from_raw_parts(txn_ptr, TXN_MAX_SZ) };
    Txn::parse_txn(txn_data).expect("Failed to parse txn")
}

/// Access the current block context
///
/// Returns a reference to the block context structure containing
/// information about the current block being processed.
///
/// # Safety
/// This function accesses memory at a fixed address that is expected
/// to contain a valid BlockCtx structure. The validity is enforced
/// by the runtime environment.
pub fn get_block_ctx() -> &'static BlockCtx {
    let block_ctx_ptr: *const BlockCtx = vm_ptr(SEG_TYPE_READONLY_DATA, SEG_IDX_BLOCK_CTX, 0);
    unsafe { &*block_ctx_ptr }
}

pub fn get_past_block_ctx(blocks_ago: usize) -> Option<&'static BlockCtx> {
    let current_ctx = get_block_ctx();
    if blocks_ago == 0 {
        return Some(current_ctx);
    }
    if blocks_ago > current_ctx.slot as usize {
        return None;
    }
    let offset = blocks_ago.checked_mul(BLOCK_CTX_VM_SPACING)?;
    let past_ctx_ptr: *const BlockCtx = vm_ptr(SEG_TYPE_READONLY_DATA, SEG_IDX_BLOCK_CTX, offset);
    Some(unsafe { &*past_ctx_ptr })
}

pub unsafe fn get_account_meta_at_idx(
    account_idx: u16,
) -> Result<&'static AccountMeta, MemoryError> {
    // Create pointer with proper provenance for account metadata segment
    let account_meta_ptr: *const AccountMeta =
        vm_ptr(SEG_TYPE_ACCOUNT_METADATA, account_idx as usize, 0);

    let account_meta: &AccountMeta = unsafe { &*account_meta_ptr };

    if account_meta.version == TSDK_ACCOUNT_VERSION_V1 {
        Ok(account_meta)
    } else {
        Err(MemoryError::UnsupportedAccountVersion {
            version: account_meta.version,
        })
    }
}

pub unsafe fn get_account_data_at_idx(account_idx: u16) -> Result<&'static [u8], MemoryError> {
    let account_meta = unsafe { get_account_meta_at_idx(account_idx)? };

    // Create pointer with proper provenance for account data segment
    let account_data_ptr: *const u8 = vm_ptr(SEG_TYPE_ACCOUNT_DATA, account_idx as usize, 0);

    let account_data: &[u8] =
        unsafe { core::slice::from_raw_parts(account_data_ptr, account_meta.data_sz as usize) };
    Ok(account_data)
}

pub unsafe fn get_account_info_at_idx_mut(
    account_idx: u16,
) -> Result<AccountInfoMut<'static>, MemoryError> {
    let account_meta = unsafe { get_account_meta_at_idx(account_idx)? };

    // Create mutable pointer with proper provenance for account data segment
    let account_data_ptr: *mut u8 = vm_ptr_mut(SEG_TYPE_ACCOUNT_DATA, account_idx as usize, 0);

    let account_data: &mut [u8] =
        unsafe { core::slice::from_raw_parts_mut(account_data_ptr, account_meta.data_sz as usize) };
    Ok(AccountInfoMut {
        meta: account_meta,
        data: account_data,
    })
}

pub unsafe fn get_account_info_at_idx(
    account_idx: u16,
) -> Result<AccountInfo<'static>, MemoryError> {
    unsafe { get_account_info_at_idx_mut(account_idx).map(Into::into) }
}
