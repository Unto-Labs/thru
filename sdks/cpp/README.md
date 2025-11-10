# Thru C++ SDK

This is the C++ SDK for developing Thru programs.

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
   riscv64-unknown-elf-g++ --version
   ```

## Building Your First Program

Let's create a simple C++ program that accesses block context information:

1. **Create the program directory:**
   ```bash
   mkdir -p my-thru-project/examples
   cd my-thru-project
   ```

2. **Create the main program file** (`examples/my_block_program.cpp`):
   ```cpp
   /**
    * @file my_block_program.cpp
    * @brief My first Thru Network C++ program - emits a simple event
    */
   
   #include <thru-sdk/cpp/tn_sdk.hpp>
   
   using namespace thru;
   
   extern "C" [[noreturn]] void start(const void* instruction_data TSDK_PARAM_UNUSED,
                                       ulong instruction_data_sz TSDK_PARAM_UNUSED) {
     // Emit a simple event
     const char message[64] = "Hello from my first C++ Thru program!";
     tsys_emit_event(reinterpret_cast<const uchar*>(message), 64UL);
   
     runtime::return_success();
   }
   ```

3. **Create the GNUmakefile:** (`GNUmakefile`):
   ```makefile
   # Simple makefile for my Thru C++ project
   
   BASEDIR:=$(CURDIR)/build
   # Set THRU_CPP_SDK_DIR to the location Thru SDK install. The default directory
   # is already set.
   THRU_CPP_SDK_DIR:=$(HOME)/.thru/sdk/cpp/
   include $(THRU_CPP_SDK_DIR)/thru_cpp_program.mk
   ```

4. **Create the Local.mk file** (`examples/Local.mk`):
   ```makefile
   # My Thru C++ SDK Examples
   
   $(call make-bin,my_block_program_cpp,my_block_program,,-ltn_sdk)
   ```

5. **Build the program:**
   ```bash
   make
   ```

6. **Find your built program:**
   ```bash
   ls build/bin/my_block_program_cpp
   ```

## Custom Installation

To install to a custom location:

```bash
export THRU_DIR=/path/to/your/project
./setup.sh
export PATH="$THRU_DIR/.thru/sdk/toolchain/bin:$PATH"
```

## What Gets Installed

- **RISC-V Toolchain**: `$HOME/.thru/sdk/toolchain/` (includes g++)
- **C++ SDK**: `$HOME/.thru/sdk/cpp/`
- **System packages**: Various build dependencies

## Manual Setup

If you prefer to run the dependency installation manually:

```bash
# Install toolchain dependencies (same as C SDK)
./deps.sh --thru-dir $HOME fetch check install-c

# Build and install C++ SDK
echo "Installing C++ SDK to: $HOME/.thru/sdk/cpp"
mkdir -p "$HOME/.thru/sdk/cpp"
make BASEDIR="$HOME/.thru/sdk/cpp" all lib include
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
- Check that RISC-V toolchain is in PATH: `which riscv64-unknown-elf-g++`
- C++ programs require the same RISC-V toolchain as C programs 
