#![no_std]

pub use heapless;
pub mod account_safe;
pub mod mem;
pub mod syscall;
pub mod types;

pub use account_safe::{next_pow2, AccountManager};
pub use account_safe::AccountRef::*;
pub use mem::get_txn;
pub use types::pubkey::Pubkey;
pub use types::shadow_stack::get_shadow_stack;


/// Error code used by the panic handler
pub const PANIC_ERROR_CODE: u64 = 555;

mod panic;
pub mod program_utils {
    use crate::syscall;
    use crate::types::state_proof::StateProof;
    use crate::mem::{get_account_meta_at_idx, get_txn};
    use crate::types::pubkey::Pubkey;
    use crate::types::shadow_stack::get_shadow_stack;

    pub fn revert(error_code: u64) -> ! {
        syscall::sys_exit(error_code, 1)
    }

    pub fn succeed(return_code: u64) -> ! {
        syscall::sys_exit(return_code, 0)
    }

    #[inline(always)]
    pub fn grow_stack(delta: u64) -> *mut u8 {
        let sp: u64;
        unsafe {
            core::arch::asm!("mv {}, sp", out(reg) sp);
        }
        let (_, addr) = unsafe { syscall::sys_increment_anonymous_segment_sz(sp as *mut (), delta) };
        addr
    }

    /// Check if an account is authorized by its index.
    ///
    /// An account is considered authorized if:
    /// - It is the fee payer (index 0)
    /// - It is the current program
    /// - It is in the chain of program invocations (shadow stack)
    pub fn is_account_authorized_by_idx(account_idx: u16) -> bool {
        // If account is the fee payer, it has authorized
        if account_idx == 0 {
            return true;
        }

        let shadow_stack = get_shadow_stack();

        // If account is the current program, this program has authorized
        if shadow_stack.current_program_acc_idx() == account_idx {
            return true;
        }

        // If there are no called program invocations by this point, the account is
        // not authorized. This is an optimization to avoid the loop below.
        if shadow_stack.call_depth() == 0 {
            return false;
        }

        // If account is in the chain of program invocations, that program has authorized
        for i in (0..shadow_stack.call_depth()).rev() {
            if let Some(frame) = shadow_stack.get_frame(i) {
                if frame.program_acc_idx() == account_idx {
                    return true;
                }
            }
        }

        false
    }

    /// Check if an account is authorized by its public key.
    ///
    /// An account is considered authorized if:
    /// - It is the fee payer (index 0)
    /// - It is the current program
    /// - It is in the chain of program invocations (shadow stack)
    pub fn is_account_authorized_by_pubkey(pubkey: &Pubkey) -> bool {
        let txn = get_txn();

        // Get all account pubkeys from transaction
        let account_pubkeys = match txn.account_pubkeys() {
            Some(pubkeys) => pubkeys,
            None => return false,
        };

        // If account is the fee payer, it has authorized
        if account_pubkeys.get(0) == Some(pubkey) {
            return true;
        }

        let shadow_stack = get_shadow_stack();

        // If account is the current program, this program has authorized
        let current_program_idx = shadow_stack.current_program_acc_idx();
        if account_pubkeys.get(current_program_idx as usize) == Some(pubkey) {
            return true;
        }

        // If there are no called program invocations by this point, the account is
        // not authorized. This is an optimization to avoid the loop below.
        if shadow_stack.call_depth() == 0 {
            return false;
        }

        // If account is in the chain of program invocations, that program has authorized
        for i in (0..shadow_stack.call_depth()).rev() {
            if let Some(frame) = shadow_stack.get_frame(i) {
                let program_idx = frame.program_acc_idx();
                if account_pubkeys.get(program_idx as usize) == Some(pubkey) {
                    return true;
                }
            }
        }

        false
    }

    /// Checks whether the account at the given index is owned by the current program.
    pub fn is_account_idx_owned_by_current_program(account_idx: u16) -> bool {
        let txn = get_txn();

        let account_meta = unsafe {
            if account_idx >= txn.accounts_cnt() {
                return false;
            }
            get_account_meta_at_idx(account_idx)
        };
        let account_meta = match account_meta {
            Some(meta) => meta,
            None => return false,
        };

        let account_pubkeys = match txn.account_pubkeys() {
            Some(pubkeys) => pubkeys,
            None => return false,
        };
        let shadow_stack = get_shadow_stack();
        let current_program_idx = shadow_stack.current_program_acc_idx() as usize;
        
        account_pubkeys.get(current_program_idx) == Some(&account_meta.owner)
    }

    /// Checks if the current program is already in the shadow stack (i.e.,
    /// has been invoked recursively). Returns true if the program is reentrant,
    /// false otherwise.
    pub fn is_program_reentrant() -> bool {
        let shadow_stack = get_shadow_stack();
        let current_program_idx = shadow_stack.current_program_acc_idx();

        // If there are no previous invocations, the program is not reentrant
        if shadow_stack.call_depth() == 0 {
            return false;
        }

        // Check if the current program appears in any previous stack frame
        for i in 0..shadow_stack.call_depth() {
            if let Some(frame) = shadow_stack.get_frame(i) {
                if frame.program_acc_idx() == current_program_idx {
                    return true;
                }
            }
        }

        false
    }

    pub fn account_create(account_idx: u64, seed: &[u8; syscall::SEED_SIZE], proof: StateProof<'_>) -> syscall::SyscallCode {
        unsafe {
            syscall::sys_account_create(
                account_idx,
                seed,
                proof.as_ptr(),
                proof.footprint() as u64
            )
        }
    }
}

#[macro_export]
macro_rules! tvm_println {
    // Named argument for buffer size
    (bufsize = $size:expr, $($arg:tt)*) => {{
        use core::fmt::Write;
        let mut buf: $crate::heapless::String<{ $size }> = $crate::heapless::String::new();
        writeln!(&mut buf, $($arg)*).expect("tvm_println! failed to write");
        unsafe { $crate::syscall::sys_log(buf.as_ptr(), buf.len() as u64) };
    }};

    // Default buffer size
    ($($arg:tt)*) => {{
        use core::fmt::Write;
        let mut buf: $crate::heapless::String<1024> = $crate::heapless::String::new();
        writeln!(&mut buf, $($arg)*).expect("tvm_println! failed to write");
        unsafe { $crate::syscall::sys_log(buf.as_ptr(), buf.len() as u64) };
    }};
}

#[macro_export]
macro_rules! assert_eq_or_revert {
    // With a custom error code
    ($expr:expr, $expected:expr, error = $error_code:expr) => {{
        if &($expr) != &($expected) {
            $crate::program_utils::revert($error_code as u64);
        }
    }};
    // With the default error code
    ($expr:expr, $expected:expr) => {{
        if &($expr) != &($expected) {
            $crate::program_utils::revert(4444u64);
        }
    }};
}

#[macro_export]
macro_rules! assert_or_revert {
    // With named error
    ($cond:expr, error = $error_code:expr) => {{
        if !$cond {
            $crate::program_utils::revert($error_code as u64);
        }
    }};
    // Without named error (default error)
    ($cond:expr) => {{
        if !$cond {
            $crate::program_utils::revert(4444 as u64);
        }
    }};
}

#[macro_export]
macro_rules! revert {
    // With named error
    (error = $error_code:expr) => {{
        $crate::program_utils::revert($error_code as u64);
    }};
}
