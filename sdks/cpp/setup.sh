#!/usr/bin/env bash
set -euo pipefail

echo "Setting up CPP SDK..."
echo "This script will install dependencies for the CPP SDK"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

# Use THRU_DIR if set, otherwise use ~/.thru/
THRU_DIR="${THRU_DIR:-$HOME}"

echo "Installing CPP SDK dependencies to: $THRU_DIR/.thru/sdk/toolchain"
echo ""

# Install CPP SDK dependencies
"$SCRIPT_DIR/deps.sh" --thru-dir "$THRU_DIR" fetch check install-c

# Installing CPP SDK
echo "Installing CPP SDK to: $THRU_DIR/.thru/sdk/cpp"
mkdir -p "$THRU_DIR/.thru/sdk/cpp"
cp -rL $SCRIPT_DIR/* "$THRU_DIR/.thru/sdk/cpp"

find $THRU_DIR/.thru/sdk/cpp -type f -exec touch {} \; -print

make BASEDIR="$THRU_DIR/.thru/sdk/cpp/" BUILDDIR="thru-sdk" all lib include 

echo ""
echo "CPP SDK setup complete!"
echo "RISC-V toolchain installed to: $THRU_DIR/.thru/sdk/toolchain/bin"
