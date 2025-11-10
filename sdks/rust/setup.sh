#!/usr/bin/env bash
set -euo pipefail

echo "Setting up Rust SDK..."
echo "This script will install dependencies for the Rust SDK"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

# Use THRU_DIR if set, otherwise use ~/.thru/
THRU_DIR="${THRU_DIR:-$HOME}"

echo "Installing Rust SDK dependencies to: $THRU_DIR/.thru/sdk/toolchain"
echo ""

# Install Rust SDK dependencies
"$SCRIPT_DIR/deps.sh" --thru-dir "$THRU_DIR" install-rust

# Installing Rust SDK
echo "Installing Rust SDK to: $THRU_DIR/.thru/sdk/rust"
mkdir -p "$THRU_DIR/.thru/sdk/rust"
# Copy Rust SDK files if they exist
if [ -d "thru-sdk" ]; then
    cp -r thru-sdk/* "$THRU_DIR/.thru/sdk/rust/"
fi

echo ""
echo "Rust SDK setup complete!"
echo "Rust toolchain installed. Source environment: source \$HOME/.cargo/env"
echo "RISC-V target 'riscv64imac-unknown-none-elf' is now available" 