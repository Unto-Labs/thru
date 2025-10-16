pub mod bintrie;
pub mod bintrie_error;
pub mod bintrie_proof;
pub mod bintrie_types;
pub mod block_parser;
pub mod crypto_utils;
pub mod rpc_types;
pub mod tn_account;
pub mod tn_block_packet;
pub mod tn_public_address;
pub mod tn_runtime_utils;
pub mod tn_signature_encoding;
pub mod tn_state_proof;
pub mod tn_tools;
pub mod txn_lib;
pub mod txn_tools;

#[cfg(test)]
mod txn_tools_test;

#[cfg(test)]
mod bintrie_tests;

pub const TN_VM_ERROR_REVERT: i32 = -765; /* TN_RUNTIME_TXN_VM_REVERT fffffd03 */
pub const TN_VM_ERROR_FEE_PAYER_ACCOUNT_DOES_NOT_EXIST: i32 = -508; /* TN_RUNTIME_TXN_ERR_FEE_PAYER_ACCOUNT_DOES_NOT_EXIST fffffe04 */

pub const TN_EXECUTION_RESULT: u64 = 0xfffffffffffffffc; /* TN_VM_ERR_SIGFAULT  */
pub const TN_USER_ERROR_CODE_SYSCALL_INSUFFICIENT_BALANCE: u64 = 0xffffffffffffffdc; /* TN_VM_ERR_SYSCALL_INSUFFICIENT_BALANCE */

// re-export types
pub use bintrie::{BinTrie, BinTriePair};
pub use tn_state_proof::{StateProof, StateProofBody, StateProofHeader, StateProofType};
pub use tn_tools::KeyPair;
pub use tn_tools::Pubkey;
pub use tn_tools::Signature;
pub use txn_lib::Transaction;
pub use txn_tools::TransactionBuilder;

// re-export crypto utilities
pub use crypto_utils::{derive_manager_program_accounts, derive_uploader_program_accounts};

// re-export public address utilities
pub use tn_public_address::{
    create_program_defined_account_address, create_program_defined_account_address_string,
    pack_seed, tn_pubkey_to_address_string, tn_public_address_decode, tn_public_address_encode,
};

// re-export runtime utilities
pub use bintrie_error::BinTrieError;
pub use bintrie_proof::{NonExistenceProof, Proof};
pub use bintrie_types::{Hash as BinTrieHash, Pubkey as BinTriePubkey};
pub use tn_runtime_utils::tn_vm_error_str;

/// Checks if the given byte slice is a valid C-style null-terminated string containing only printable ASCII characters.
pub fn is_c_printable_ascii_null_terminated(bytes: &[u8]) -> bool {
    // Must contain at least one null byte
    let Some(pos) = bytes.iter().position(|&b| b == 0) else {
        return false;
    };
    // All bytes before the first null must be printable ASCII (0x20..=0x7E)
    for &b in &bytes[..pos] {
        if !(b >= 0x20 && b <= 0x7E) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_c_printable_ascii_null_terminated() {
        // Valid cases
        assert!(is_c_printable_ascii_null_terminated(b"hello\0"));
        assert!(is_c_printable_ascii_null_terminated(b"!@#$%^&*()_+\0"));
        assert!(is_c_printable_ascii_null_terminated(b" \0")); // space is printable
        assert!(is_c_printable_ascii_null_terminated(b"~\0")); // tilde is printable
        assert!(is_c_printable_ascii_null_terminated(b"\0")); // empty string
        // Valid: data after null is ignored
        assert!(is_c_printable_ascii_null_terminated(
            b"hello\0not_printed\x01\x02"
        ));

        // Invalid: not null-terminated
        assert!(!is_c_printable_ascii_null_terminated(b"hello"));
        // Invalid: contains non-printable ASCII (tab)
        assert!(!is_c_printable_ascii_null_terminated(b"hel\tlo\0"));
        // Invalid: contains non-printable ASCII (DEL)
        assert!(!is_c_printable_ascii_null_terminated(b"hel\x7Flo\0"));
        // Invalid: empty slice
        assert!(!is_c_printable_ascii_null_terminated(b""));
        // Invalid: non-printable before null
        assert!(!is_c_printable_ascii_null_terminated(b"foo\x19\0"));
    }
}
