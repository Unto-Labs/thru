# Thru Rust SDK

This is the Rust SDK for developing Thru programs.

## Quick Start

1. **Install the SDK:**
```bash
cd thru-rust-sdk
./setup.sh
cd ..
```

2. **Source Rust environment:**
```bash
source $HOME/.cargo/env
```

3. **Verify installation:**
```bash
rustc --version
rustup target list --installed | grep riscv64
```

## Building Your First Program

Let's create a simple Rust program that accesses block context information:

1. **Create a new Rust project:**
```bash
cargo init --name my-thru-project my-thru-project
cd my-thru-project
```

2. **Create the Cargo.toml:**
```toml
[package]
name = "my-thru-project"
version = "0.1.0"
edition = "2024"

[dependencies]
# ThruNet SDK crates - adjust paths to your SDK installation
thru-core = { path = "../thru-rust-sdk/core" }
thru-sdk-macros = { path = "../thru-rust-sdk/macros" }

# Additional dependencies
zerocopy = "0.8.25"
zerocopy-derive = "0.8.25"

[profile.release]
panic = "abort"
opt-level = "z"     # Optimize for size
lto = true          # Enable link-time optimization
codegen-units = 1   # Better optimization
strip = true        # Strip symbols for smaller binaries
```

3. **Copy configuration files:**
```bash
cp ../thru-rust-sdk/build.rs .
cp ../thru-rust-sdk/link.x.in .
mkdir -p .cargo
cp ../thru-rust-sdk/.cargo/config.toml .cargo/
```

4. **Create the main program file** (`src/main.rs`):
```rust
//! # My First Thru Network Program
//! 
//! This program demonstrates emitting a simple event.

#![no_std]
#![no_main]

use thru_core::syscall::sys_emit_event;
use thru_sdk_macros::*;

#[entry(stack_size = 4096)]
fn main(_instr_data: &[u8]) -> Result<u64, u64> {
    // Emit a simple message
    let message = b"Hello from my first Rust Thru program!\0";
    sys_emit_event(message.as_ptr(), message.len() as u64);

    Ok(0)
}
```

5. **Build the program:**
```bash
cargo build --release --bin my-thru-project
 cargo objcopy --release --bin my-thru-project -- -O binary my-thru-project.bin
```

6. **Find your built program:**
```bash
ls target/riscv64imac-unknown-none-elf/release/my_thru_project
```

## Custom Installation

To install to a custom location:

```bash
export THRU_DIR=/path/to/your/project
./setup.sh
source $HOME/.cargo/env
```

## What Gets Installed

- **Rust Toolchain**: `$HOME/.cargo/` (rustup, cargo, rustc)
- **RISC-V Target**: `riscv64imac-unknown-none-elf`
- **Rust Tools**: `cargo-binutils`, `llvm-tools`
- **Rust SDK**: `$HOME/.thru/sdk/rust/`

## Manual Setup

If you prefer to run the dependency installation manually:

```bash
# Install Rust and RISC-V target
./deps.sh --thru-dir $HOME install-rust

# Source Rust environment
source $HOME/.cargo/env
```

## Building Rust Programs

```bash
# Build for RISC-V target
cargo build --target riscv64imac-unknown-none-elf --release
```

## Environment Variables

- `THRU_DIR` - Base directory for installation (default: `$HOME`)
- `TN_AUTO_INSTALL_PACKAGES` - Set to "1" to auto-install system packages

## Troubleshooting

**Rust not found:**
```bash
source $HOME/.cargo/env
```

**RISC-V target missing:**
```bash
rustup target add riscv64imac-unknown-none-elf
```

**Build failures:**
- Ensure Rust environment is sourced: `source $HOME/.cargo/env`
- Check RISC-V target is installed: `rustup target list --installed | grep riscv64`
- Use the correct target: `--target riscv64imac-unknown-none-elf` 
