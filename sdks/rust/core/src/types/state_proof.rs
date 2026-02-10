use core::hint::unreachable_unchecked;

use zerocopy::FromBytes;
use zerocopy_derive::{FromBytes, Immutable, KnownLayout};

use crate::Pubkey;

#[derive(Debug)]
pub enum ProofParseError {
    Truncated,
    TooManyKeys(usize),
    MisSized,
    InvalidProofType,
    NotSupported,
    NotAvailable,
}

/// A type of state proof.
pub enum ProofType {
    /// A proof that an account exists in the compressed accounts trie.
    /// Used to decompress an account.
    ///
    /// Includes the sibling hashes of the account's path in the trie.
    Existing = 0,
    /// A proof that an account exists with a given hash value.
    /// Used to compress an account which was already previously compressed.
    ///
    /// Includes the sibling hashes of the account's path in the trie, as well as
    /// the existing hash value of the account.
    Updating = 1,
    /// A proof that an account does not exist in the compressed accounts trie.
    /// Used to create a new account.
    ///
    /// This consists of an existing account's pubkey and hash value in the tree,
    /// as well as the sibling hashes of the account's path in the trie.
    Creation = 2,
}

pub const PROOF_KEYS_MAX: usize = 256;

#[derive(FromBytes, KnownLayout, Immutable)]
#[repr(C, packed)]
struct StateProofHeader {
    type_slot: u64,
    path_bitset: Pubkey,
}

impl StateProofHeader {
    unsafe fn type_unchecked(&self) -> ProofType {
        match self.type_slot >> 62 {
            0 => ProofType::Existing,
            1 => ProofType::Updating,
            2 => ProofType::Creation,
            _ => unreachable_unchecked(),
        }
    }

    fn slot(&self) -> u64 {
        self.type_slot & ((1u64 << 62) - 1)
    }

    fn is_valid(&self) -> bool {
        matches!(self.type_slot >> 62, 0..=2)
    }

    unsafe fn expected_trailing_bytes(&self) -> usize {
        let proof_type = self.type_unchecked();
        let expected_trailing_pubkeys = (proof_type as usize)
            + self
                .path_bitset
                .0
                .iter()
                .map(|value| value.count_ones() as usize)
                .sum::<usize>();

        // Will not overflow since `expected_trailing_pubkeys` is at most 2 + 256
        expected_trailing_pubkeys * core::mem::size_of::<Pubkey>()
    }
}
/// A reference to a state proof in memory.
///
/// Create using [`parse_proof`] or [`parse_proof_prefix`].
// SAFETY: The data must always point to a valid state proof.
#[repr(C, packed)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct StateProof<'a> {
    data: &'a [u8],
}

impl<'a> StateProof<'a> {
    /// Parses a state proof located at the prefix of the given `data`.
    /// Returns the parsed proof, along with the remaining data after the proof.
    pub fn parse_proof_prefix(data: &'a [u8]) -> Result<(Self, &'a [u8]), ProofParseError> {
        let (header, rest) =
            StateProofHeader::ref_from_prefix(data).map_err(|_| ProofParseError::Truncated)?;
        if !header.is_valid() {
            return Err(ProofParseError::InvalidProofType);
        }
        let expected_trailing_bytes = unsafe { header.expected_trailing_bytes() };
        if expected_trailing_bytes > rest.len() {
            return Err(ProofParseError::MisSized);
        }
        Ok((Self { data }, &rest[expected_trailing_bytes..]))
    }

    // Parses a state proof consisting of the entirety of the provided `data`.
    pub fn parse_proof(data: &'a [u8]) -> Result<Self, ProofParseError> {
        let (proof, suffix) = Self::parse_proof_prefix(data)?;
        if suffix.len() != 0 {
            return Err(ProofParseError::MisSized);
        }
        Ok(proof)
    }

    /// Creates a state proof from the given data pointer without checking if it is valid.
    /// The caller must ensure that the data is a valid state proof which lives for `'a`.
    pub unsafe fn parse_proof_unchecked(data: *const u8) -> Self {
        let header = &*(data as *const StateProofHeader);
        let trailing_bytes = unsafe { header.expected_trailing_bytes() };
        Self {
            data: core::slice::from_raw_parts(
                data,
                core::mem::size_of::<StateProofHeader>() + trailing_bytes,
            ),
        }
    }

    /// Returns the total size of the state proof in bytes.
    pub fn footprint(self) -> usize {
        self.data.len()
    }

    fn header(self) -> &'a StateProofHeader {
        unsafe {
            // SAFETY: Accessing this data is guaranteed to be valid by the invariant of this struct.
            StateProofHeader::ref_from_prefix(self.data).unwrap_unchecked()
        }
        .0
    }

    pub fn proof_type(self) -> ProofType {
        // SAFETY: We have already checked the type slot
        unsafe { self.header().type_unchecked() }
    }

    pub fn slot(self) -> u64 {
        self.header().slot()
    }

    /// Returns a pointer to the start of the state proof data.
    pub fn as_ptr(self) -> *const u8 {
        self.data.as_ptr()
    }
}
