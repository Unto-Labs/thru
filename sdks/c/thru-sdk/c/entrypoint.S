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
  # Note: Do NOT mark ra as undefined - for cross-program invocations,
  # ra contains the return address back to the calling program.
  # GDB needs this to unwind through program boundaries.

# Save original SP before we smash it to a 4K boundary
# Assumes t1 will not be clobbered by the syscall
  mv    t1, sp              # t1 = original SP

# TODO: handle the error if there is not enough memory
# Setup stack FIRST
  move t0, a0
  li t2, -4096
  and sp, sp, t2
  move a0, sp
  add a0, a0, t2
  li a7, 0
  ecall
  bnez a0, .L_revert

# Now set up our frame on the aligned stack
# Layout after addi:
#   0(sp): saved original SP
#   8(sp): saved ra (cross-program return address / return from start)
  addi  sp, sp, -16
  sd    t1, 0(sp)            # save original SP
  sd    ra, 8(sp)            # save return address

  # CFA and register rules
  .cfi_def_cfa   sp, 16      # CFA = sp + 16 (SP at call site for _start)
  .cfi_offset    ra, -8      # previous ra is at CFA-8 -> 8(sp)
  .cfi_offset    2, -16      # previous sp (x2) is at CFA-16 -> 0(sp)

# Call entrypoint
  move a0, t0
  call start

# Restore ra and tear down frame
  ld    t1, 0(sp)           # reload original SP (optional, for your own use)
  ld    ra, 8(sp)
  addi  sp, sp, 16
  .cfi_restore ra
  .cfi_def_cfa  sp, 0       # CFA now just tracks current sp again

# Revert
.L_revert:
  li a7, 11
  li a1, 1
  ecall
  .cfi_endproc
  .size  _start, .-_start
