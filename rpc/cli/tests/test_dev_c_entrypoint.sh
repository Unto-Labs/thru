#!/usr/bin/env bash
# Compile and execute the actual C template against the public SDK on the host.
# This tests scaffold behavior without a RISC-V toolchain, CLI config, or RPC.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
TEMPLATE="${THRU_C_TEMPLATE:-$REPO_ROOT/rpc/cli/crates/thru-core/templates/c/program.c}"

"${THRU_HOST_CC:-cc}" -std=c17 -Wall -Wextra -Werror -Wconversion \
  -I "$REPO_ROOT/sdks/c" \
  "-DTHRU_C_PROGRAM_TEMPLATE=\"$TEMPLATE\"" \
  "$SCRIPT_DIR/test_dev_c_entrypoint.c" -o "$TEST_TMP/test-entrypoint"

for size in 0 1 513 65535; do
  for accounts in 0 3 8; do
    "$TEST_TMP/test-entrypoint" "$size" "$accounts"
    printf 'PASS instruction bytes=%s accounts=%s\n' "$size" "$accounts"
  done
done
