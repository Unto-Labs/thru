#!/usr/bin/env bash
set -euo pipefail

echo "Setting up C SDK..."
echo "This script will install dependencies for the C SDK"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

# Use THRU_DIR if set, otherwise use ~/.thru/
THRU_DIR="${THRU_DIR:-$HOME}"

echo "Installing C SDK dependencies to: $THRU_DIR/.thru/sdk/toolchain"
echo ""

# Install C SDK dependencies
#"$SCRIPT_DIR/deps.sh" --thru-dir "$THRU_DIR" fetch check install-c

# Installing C SDK
echo "Installing C SDK to: $THRU_DIR/.thru/sdk/c"
mkdir -p "$THRU_DIR/.thru/sdk/c"
cp -rL $SCRIPT_DIR/* "$THRU_DIR/.thru/sdk/c/"

find $THRU_DIR/.thru/sdk/c -type f -exec touch {} \; -print

make BASEDIR="$THRU_DIR/.thru/sdk/c/" BUILDDIR="thru-sdk" all lib include

echo ""
echo "C SDK setup complete!"
echo "RISC-V toolchain installed to: $THRU_DIR/.thru/sdk/toolchain/bin"
