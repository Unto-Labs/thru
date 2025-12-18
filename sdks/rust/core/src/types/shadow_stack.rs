use crate::{
    compute_addr,
    mem::{SEG_IDX_SHADOW_STACK, SEG_TYPE_READONLY_DATA},
};

pub const TSDK_SHADOW_STACK_FRAME_MAX: usize = 17; // 16 call depths (1..16) + 1 for frame -1

#[repr(C)]
pub struct ShadowStackFrame {
    program_acc_idx: u16,
    stack_pages: u16,
    heap_pages: u16,
}

impl ShadowStackFrame {
    pub fn program_acc_idx(&self) -> u16 {
        self.program_acc_idx
    }

    pub fn stack_pages(&self) -> u16 {
        self.stack_pages
    }

    pub fn heap_pages(&self) -> u16 {
        self.heap_pages
    }
}

#[repr(C)]
pub struct ShadowStack {
    call_depth: u16,
    current_total_stack_pages: u16,
    current_total_heap_pages: u16,
    max_call_depth: u16,
    // Frame array: stack_frames[0] is frame -1 (all zeros), stack_frames[1] is frame 0 (root), etc.
    stack_frames: [ShadowStackFrame; TSDK_SHADOW_STACK_FRAME_MAX],
}

impl ShadowStack {
    pub fn call_depth(&self) -> u16 {
        self.call_depth
    }

    pub fn current_total_stack_pages(&self) -> u16 {
        self.current_total_stack_pages
    }

    pub fn current_total_heap_pages(&self) -> u16 {
        self.current_total_heap_pages
    }

    pub fn max_call_depth(&self) -> u16 {
        self.max_call_depth
    }

    /// Get current program account index from current frame
    pub fn current_program_acc_idx(&self) -> u16 {
        self.get_current_frame().program_acc_idx()
    }

    /// Get frame at call depth N (stored at array index N)
    pub fn get_frame(&self, frame_idx: u16) -> Option<&ShadowStackFrame> {
        let array_idx = frame_idx as usize;
        if array_idx < TSDK_SHADOW_STACK_FRAME_MAX && frame_idx <= self.max_call_depth {
            Some(&self.stack_frames[array_idx])
        } else {
            None
        }
    }

    /// Get parent frame (frame -1 for root, or previous frame for invocations)
    pub fn get_parent_frame(&self) -> &ShadowStackFrame {
        let parent_array_idx = self.call_depth.saturating_sub(1) as usize; // call_depth N has parent at array index N-1
        &self.stack_frames[parent_array_idx]
    }

    /// Get current frame based on call_depth
    pub fn get_current_frame(&self) -> &ShadowStackFrame {
        let array_idx = self.call_depth as usize;
        &self.stack_frames[array_idx]
    }
}

pub fn get_shadow_stack() -> &'static ShadowStack {
    let addr = compute_addr!(SEG_TYPE_READONLY_DATA, SEG_IDX_SHADOW_STACK, 0);
    unsafe { &*(addr as *const ShadowStack) }
}
