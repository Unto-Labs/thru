BUILDDIR?=thruvm

# ThruNet VM specific configuration
# This configuration is for building ThruNet Rust SDK programs for the ThruNet VM

# Rust target for RISC-V
RUST_TARGET:=riscv64imac-unknown-none-elf

# Cargo build flags for ThruVM
CARGO_BUILD_FLAGS:=--release --target $(RUST_TARGET) 