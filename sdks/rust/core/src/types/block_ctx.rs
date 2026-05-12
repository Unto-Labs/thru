use crate::types::hash::Hash;
use crate::types::pubkey::Pubkey;
use zerocopy_derive::{FromBytes, Immutable, IntoBytes, KnownLayout};

/// Block context structure containing current block information
///
/// Provides access to block-level metadata that programs can use to
/// make decisions based on block timing, state, and provenance.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, FromBytes, KnownLayout, Immutable, IntoBytes)]
pub struct BlockCtx {
    /// Current block slot number
    pub slot: u64,
    /// Block timestamp (Unix epoch in nanoseconds)
    pub block_time: u64,
    /// Block price
    pub block_price: u64,
    /// Merkle root of the state tree
    pub state_root: Hash,
    /// Hash of the current block
    pub cur_block_hash: Hash,
    /// Public key of the block producer
    pub block_producer: Pubkey,
    /// Validator-weight slot from the block header
    pub weight_slot: u64,
}

const _: () = {
    assert!(core::mem::size_of::<BlockCtx>() == 128);
    assert!(core::mem::offset_of!(BlockCtx, slot) == 0);
    assert!(core::mem::offset_of!(BlockCtx, block_time) == 8);
    assert!(core::mem::offset_of!(BlockCtx, block_price) == 16);
    assert!(core::mem::offset_of!(BlockCtx, state_root) == 24);
    assert!(core::mem::offset_of!(BlockCtx, cur_block_hash) == 56);
    assert!(core::mem::offset_of!(BlockCtx, block_producer) == 88);
    assert!(core::mem::offset_of!(BlockCtx, weight_slot) == 120);
};
