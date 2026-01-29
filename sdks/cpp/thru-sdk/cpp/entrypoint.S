  .file  "entrypoint.S"
  .attribute unaligned_access, 0
  .attribute stack_align, 16
  .cfi_sections .debug_frame
  .text
  .section  .text._start,"ax",@progbits
  .align  1
  .globl  _start
  .type  _start, @function
_start:
  .cfi_startproc
  # Check transaction version (must be 1 for backwards compatibility)
  # TXN_DATA segment: 0x00_0001_000000, version at offset 0
  li t5, 0x0001000000
  lbu t5, 0(t5)              # Load transaction version byte
  addi t5, t5, -1            # version - 1
  bnez t5, .L_revert         # Revert if version != 1

  # Save instruction data pointer and size
  move t0, a0
  move t1, a1

  # Load shadow stack base: 0x00_0002_000000 (SEG_TYPE_READONLY_DATA, SEG_IDX_SHADOW_STACK)
  li t3, 0x0002000000
  
  # Read call_depth (ushort at offset 0)
  lhu t2, 0(t3)
  
  # Calculate parent frame offset: 8 + ((call_depth - 1) * 264)
  # Frame size = 6 bytes (3 x ushort) + 2 padding + 256 bytes (32 x ulong saved_regs) = 264 bytes
  addi t2, t2, -1
  li t4, 264
  mul t2, t2, t4
  addi t2, t2, 8
  add t3, t3, t2              # t3 = &parent_frame
  
  # Read parent frame's stack_pages (ushort at offset 2 in frame)
  lhu t2, 2(t3)
  
  # Convert pages to bytes: parent_stack_bytes = stack_pages * 4096
  slli t2, t2, 12
  
  # Calculate stack address: STACK_SEG_START - parent_stack_bytes
  # STACK_SEG_START = (0x05 << 40) | (0x0001 << 24) = 0x05_0001_000000
  li t3, 0x05
  slli t3, t3, 40
  li t4, 0x0001
  slli t4, t4, 24
  or t3, t3, t4               # t3 = STACK_SEG_START
  sub t3, t3, t2              # t3 = STACK_SEG_START - parent_stack_bytes
  
  # Add current invocation's stack size for syscall (4096 bytes = 1 page)
  li t4, 4096
  sub a0, t3, t4              # a0 = sp - 4096 (address for syscall)
  
  # Set stack pointer to STACK_SEG_START - parent_stack_bytes
  move sp, t3
  
  # Syscall 0: set_anonymous_segment_sz(vaddr)
  li a7, 0
  ecall
  
  # If syscall failed, revert
  bnez a0, .L_revert

  # Allocate callee frame (32 bytes) and save caller state after stack mapping succeeds
  addi sp, sp, -32
  .cfi_def_cfa_register sp
  .cfi_def_cfa_offset 32
  sd ra, 24(sp)               # Save caller RA for unwinding (cfa-8)
  sd s0, 16(sp)               # Save s0 (cfa-16)
  .cfi_offset ra, -8
  .cfi_offset s0, -16
  
  # Call program entry point with instruction data and size
  move a0, t0
  move a1, t1
  call start
  
.L_revert:
  # Syscall 11: exit(error_code, revert=1)
  li a7, 11
  li a1, 1
  ecall
  
  .cfi_endproc
	.size	_start, .-_start 
