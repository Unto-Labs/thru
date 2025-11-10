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
    /// Global state counter across all blocks
    pub global_state_counter: u64,
    /// Hash of the parent block
    pub parent_blockhash: Hash,
    /// Public key of the block producer
    pub block_producer: Pubkey,
    /// Merkle root of the state tree
    pub state_root: Hash,
}
