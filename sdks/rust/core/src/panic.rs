use core::panic::PanicInfo;

use crate::{syscall::sys_exit, tvm_println, PANIC_ERROR_CODE};

#[panic_handler]
fn handle_panic(_info: &PanicInfo) -> ! {
    tvm_println!("{_info}");
    sys_exit(PANIC_ERROR_CODE, 1)
}
