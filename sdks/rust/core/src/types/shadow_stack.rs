use crate::{
    compute_addr,
    mem::{SEG_IDX_SHADOW_STACK, SEG_TYPE_READONLY_DATA},
};

pub const TSDK_SHADOW_STACK_FRAME_MAX: usize = 16;
#[repr(C)]
pub struct ShadowStackFrame {
    program_acc_idx: u16,
}

impl ShadowStackFrame {
    pub fn program_acc_idx(&self) -> u16 {
        self.program_acc_idx
    }
}

#[repr(C)]
pub struct ShadowStack {
    call_depth: u16,
    current_program_acc_idx: u16,
    stack_frames: [ShadowStackFrame; TSDK_SHADOW_STACK_FRAME_MAX],
}

impl ShadowStack {
    pub fn call_depth(&self) -> u16 {
        self.call_depth
    }

    pub fn current_program_acc_idx(&self) -> u16 {
        self.current_program_acc_idx
    }

    pub fn get_frame(&self, index: u16) -> Option<&ShadowStackFrame> {
        if index < self.call_depth && (index as usize) < TSDK_SHADOW_STACK_FRAME_MAX {
            Some(&self.stack_frames[index as usize])
        } else {
            None
        }
    }
}

pub fn get_shadow_stack() -> &'static ShadowStack {
    let addr = compute_addr!(SEG_TYPE_READONLY_DATA, SEG_IDX_SHADOW_STACK, 0);
    unsafe { &*(addr as *const ShadowStack) }
}
