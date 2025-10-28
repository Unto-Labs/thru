  .file  "entrypoint.S"
  .attribute unaligned_access, 0
  .attribute stack_align, 16
  .text
  .section  .text._start,"ax",@progbits
  .align  1
  .globl  _start
  .type  _start, @function
_start:
# TODO: handle the error if there is not enough memory
# Setup stack
  move t0, a0
  li t2, -4096
  and sp, sp, t2
  move a0, sp
  add a0, a0, t2
  li a7, 0
  ecall
  bnez a0, .L_revert
# Call entrypoint
  move a0, t0
  call start
# Revert
.L_revert:
  li a7, 11
  li a1, 1
  ecall
  .size  _start, .-_start
