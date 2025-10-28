# Thru C SDK

This is the C SDK for developing Thru programs.

## Quick Start

1. **Install the SDK:**
   ```bash
   ./setup.sh
   ```

2. **Add toolchain to PATH:**
   ```bash
   export PATH="$HOME/.thru/sdk/toolchain/bin:$PATH"
   ```

3. **Verify installation:**
   ```bash
   riscv64-unknown-elf-gcc --version
   ```

## Building Your First Program

Follow the [Developing a C Program](https://docs.thru.org/program-development/building-a-c-program) guide in the Thru docs to get started developing your first program.

## Custom Installation

To install to a custom location:

```bash
export THRU_DIR=/path/to/your/project
./setup.sh
export PATH="$THRU_DIR/.thru/sdk/toolchain/bin:$PATH"
```

## What Gets Installed

- **RISC-V Toolchain**: `$HOME/.thru/sdk/toolchain/`
- **C SDK**: `$HOME/.thru/sdk/c/`
- **System packages**: Various build dependencies

## Manual Setup

If you prefer to run the dependency installation manually:

```bash
# Install toolchain dependencies
./deps.sh --thru-dir $HOME fetch check install-c

# Build and install C SDK
echo "Installing C SDK to: $HOME/.thru/sdk/c"
mkdir -p "$HOME/.thru/sdk/c"
make BASEDIR="$HOME/.thru/sdk/c" all lib include
```

## Environment Variables

- `THRU_DIR` - Base directory for installation (default: `$HOME`)
- `TN_AUTO_INSTALL_PACKAGES` - Set to "1" to auto-install system packages

## Troubleshooting

**Toolchain not found:**
```bash
export PATH="$HOME/.thru/sdk/toolchain/bin:$PATH"
```

**Build failures:**
- Ensure all system dependencies are installed: `./deps.sh check`
- Check that RISC-V toolchain is in PATH: `which riscv64-unknown-elf-gcc` 
