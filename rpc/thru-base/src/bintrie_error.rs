use thiserror::Error;

/// Errors that can occur during binary trie operations
#[derive(Error, Debug)]
pub enum BinTrieError {
    #[error("Key already exists")]
    KeyExists,
    #[error("Key not found")]
    KeyNotFound,
    #[error("Invalid proof")]
    InvalidProof,
    #[error("Existing proof")]
    ExistingProof,
    #[error("Bad proof")]
    BadProof,
    #[error("Invalid hash length")]
    InvalidHashLength,
    #[error("Invalid pubkey length")]
    InvalidPubkeyLength,
    #[error("Proof verification failed")]
    ProofVerificationFailed,
}
