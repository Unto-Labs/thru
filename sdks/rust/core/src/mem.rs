use crate::types::account::{AccountInfo, AccountInfoMut, AccountMeta, TSDK_ACCOUNT_VERSION_V1};
use crate::types::block_ctx::BlockCtx;
use crate::types::txn::{TXN_MAX_SZ, Txn};

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

#[macro_export]
macro_rules! compute_addr {
    // The `tt` (token tree) designator is used for
    // operators and tokens.
    ($seg_type:expr, $seg_idx:expr, $offset:expr) => {
        ($seg_type as usize) << 40 | ($seg_idx as usize) << 24 | ($offset as usize)
    };
}

pub const TXN_DATA_PTR: *const u8 =
    compute_addr!(SEG_TYPE_READONLY_DATA, SEG_IDX_TXN_DATA, 0x000000_usize) as *const u8;

pub const BLOCK_CTX_PTR: *const u8 =
    compute_addr!(SEG_TYPE_READONLY_DATA, SEG_IDX_BLOCK_CTX, 0x000000_usize) as *const u8;

/* TODO: get the raw parts of the transaction individually */

pub fn get_txn() -> &'static Txn {
    let txn_data: &[u8] = unsafe { core::slice::from_raw_parts(TXN_DATA_PTR, TXN_MAX_SZ) };
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
    unsafe { &*(BLOCK_CTX_PTR as *const BlockCtx) }
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
    let addr = compute_addr!(SEG_TYPE_READONLY_DATA, SEG_IDX_BLOCK_CTX, offset) as *const BlockCtx;
    Some(unsafe { &*addr })
}

pub unsafe fn get_account_meta_at_idx(account_idx: u16) -> Option<&'static AccountMeta> {
    let account_meta_ptr: *const AccountMeta =
        compute_addr!(SEG_TYPE_ACCOUNT_METADATA, account_idx, 0x000000_usize) as *const AccountMeta;

    let account_meta: &AccountMeta = unsafe { &*account_meta_ptr };
    
    if account_meta.version == TSDK_ACCOUNT_VERSION_V1  {
        Some(account_meta)
    } else {
        None
    }
}

pub unsafe fn get_account_data_at_idx(account_idx: u16) -> Option<&'static [u8]> {
    if let Some(account_meta) = unsafe { get_account_meta_at_idx(account_idx) } {
        let account_data_ptr: *const u8 =
            compute_addr!(SEG_TYPE_ACCOUNT_DATA, account_idx, 0x000000_usize) as *const u8;

        let account_data: &[u8] =
            unsafe { core::slice::from_raw_parts(account_data_ptr, account_meta.data_sz as usize) };
        Some(account_data)
    } else {
        None
    }
}

pub unsafe fn get_account_info_at_idx_mut(account_idx: u16) -> Option<AccountInfoMut<'static>> {
    if let Some(account_meta) = unsafe { get_account_meta_at_idx(account_idx) } {
        let account_data_ptr: *mut u8 =
            compute_addr!(SEG_TYPE_ACCOUNT_DATA, account_idx, 0x000000_usize) as *mut u8;

        let account_data: &mut [u8] = unsafe {
            core::slice::from_raw_parts_mut(account_data_ptr, account_meta.data_sz as usize)
        };
        Some(AccountInfoMut {
            meta: account_meta,
            data: account_data,
        })
    } else {
        None
    }
}

pub unsafe fn get_account_info_at_idx(account_idx: u16) -> Option<AccountInfo<'static>> {
    unsafe { get_account_info_at_idx_mut(account_idx).map(Into::into) }
}
