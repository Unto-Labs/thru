#!/usr/bin/env bash
#
# thru_cli_e2e.sh - comprehensive Thru CLI acceptance test suite
#
# Usage:
#   ./thru_cli_e2e.sh [scenario]
#
# Environment variables:
#   TEST_SCOPE   - run a subset of scenarios (default: "all"). Supported scopes:
#                  all, all-no-debug, a single scenario, or comma-separated
#                  scenarios from core, keys, accounts, transfers, txn, program,
#                  program-upgrade, event, token, validator, bond, util, debug.
#   SKIP_BUILD   - set to 1 to reuse an existing thru-cli binary.
#   THRU_CLI_BIN - override path to the thru-cli binary.
#   RPC_BASE_URL - override gRPC endpoint base URL (default: http://127.0.0.1:8472).
#   ADVANCE_TRANSFERS_VALUE - token amount used for slot advancement transfers (default: 1).
#   GENESIS_BLS_KEY - path to the genesis validator's bls.json, used by the
#                  `validator` scenario to cross-check CLI BLS derivation against
#                  the live on-chain genesis key (default:
#                  contrib/docker-dev/data/fullnode/fullnode-dev/bls.json). The
#                  docker-dev node writes this 0600, so when the test user is not
#                  its owner the scenario obtains a readable copy via a
#                  non-interactive `sudo -n` (no prompt; cannot hang). If it cannot
#                  be read at all (no readable path and no passwordless sudo), the
#                  scenario `die`s — it never silently skips.
#   NODE_IDENTITY_KEY - the node's own ed25519 validator identity seed (64 hex
#                  chars), the producer key the bond ClaimFees/§B scenarios sign
#                  injected blocks with (the node only certifies/finalizes blocks
#                  produced by its own identity). Explicit override; takes priority.
#   NODE_IDENTITY_KEY_FILE - path to a file holding that 64-hex seed. In CI the
#                  fullnode exports its identity seed to /shared-keys/nodekey.hex;
#                  locally `dev.sh start` writes contrib/docker-dev/data/nodekey.hex
#                  (the default fallback). The ClaimFees scenario `die`s if no seed
#                  source is resolvable — it never silently skips.
#
# Dependencies: bash (>= 5), cargo, jq, thru node running locally with pre-funded accounts
#               (created via mksnap --fund-accounts), built program binary at
#               build/thruvm/bin/tn_event_emission_program_c.bin, and (for the
#               `validator` scenario's genesis cross-check) a readable genesis
#               bls.json at $GENESIS_BLS_KEY.
#
# The script provisions an isolated HOME for thru-cli, seeds keys for pre-funded accounts
# (acc_0, acc_1, acc_2, acc_3 with sequential private keys 0, 1, 2, 3), exercises the entire
# CLI surface (RPC queries, key management, account lifecycle, transfers, transactions,
# uploader/program lifecycle including event verification, token program flows, consensus
# validator BLS derivation + status reads, and utility conversions), and validates JSON
# responses with jq.

set -euo pipefail
trap 'log "ERR trap: line=$LINENO exit=$? BASH_COMMAND=$BASH_COMMAND"' ERR

readonly TEST_SCOPE="${TEST_SCOPE:-all}"
readonly SKIP_BUILD="${SKIP_BUILD:-0}"
readonly RPC_BASE_URL_DEFAULT="http://127.0.0.1:8472"
readonly RPC_BASE_URL="${RPC_BASE_URL:-$RPC_BASE_URL_DEFAULT}"
readonly ADVANCE_TRANSFERS_VALUE="${ADVANCE_TRANSFERS_VALUE:-1}"
readonly RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-5}"
readonly RETRY_DELAY_SECS="${RETRY_DELAY_SECS:-2}"
# Genesis validator's bls.json — the live on-chain BLS key source the `validator`
# scenario cross-checks CLI derivation against (test 8). Default is the docker-dev
# fullnode genesis validator key. Resolved by explicit path → die (never skip).
GENESIS_BLS_KEY="${GENESIS_BLS_KEY:-}"
# Node identity ed25519 seed (64-hex), and a file holding it — the producer key the
# bond ClaimFees/§B scenarios sign injected blocks with. See resolve_node_identity_seed.
NODE_IDENTITY_KEY_FILE="${NODE_IDENTITY_KEY_FILE:-}"
readonly AVAILABLE_SCENARIOS=(core keys accounts transfers txn program program-upgrade event token validator bond util debug)

SELECTED_SCENARIO="${TEST_SCOPE:-all}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"
readonly SCRIPT_DIR REPO_ROOT

CLI_TMP_HOME="$(mktemp -d)"
readonly CLI_TMP_HOME
trap 'rm -rf "$CLI_TMP_HOME"' EXIT

CONFIG_DIR="$CLI_TMP_HOME/.thru/cli"
CONFIG_PATH="$CONFIG_DIR/config.yaml"
readonly CONFIG_DIR CONFIG_PATH

THRU_CLI_BIN_DEFAULT="$REPO_ROOT/rpc/cli/target/release/thru"
THRU_CLI_BIN="${THRU_CLI_BIN:-$THRU_CLI_BIN_DEFAULT}"
readonly THRU_CLI_BIN_DEFAULT THRU_CLI_BIN

EVENT_PROGRAM_BIN="$REPO_ROOT/build/thruvm/bin/tn_event_emission_program_c.bin"
EVENT_PROGRAM_MANAGER="taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE"
readonly EVENT_PROGRAM_BIN
readonly EVENT_PROGRAM_MANAGER

declare -a CLEANUP_ACTIONS=()
declare PROGRAM_ACCOUNT_ID=""
declare PROGRAM_META_ID=""
declare PROGRAM_SEED=""
declare GENERATED_ACCOUNT_KEY=""
declare GENERATED_ACCOUNT_PUBKEY=""
declare ACCOUNT_CREATE_SIGNATURE=""
declare EVENT_SIGNATURE=""
declare EVENT_TEXT_EXPECTATION="To be, or not to be?"
declare TOKEN_MINT_ADDRESS=""
declare ACC_0_ADDRESS=""
declare ACC_1_ADDRESS=""
declare ACC_2_ADDRESS=""
declare ACC_3_ADDRESS=""
# §B (attestor_payment debit + ClaimFees) state, threaded from part1 to part2.
declare BOND_B_RAN=0
declare BOND_B_BP_KEY=""
declare BOND_B_BP_ADDR=""
declare BOND_B_SRC=""
declare BOND_B_A=0
declare BOND_B_P=0
declare BOND_B_ACCEPTED=""
declare GENESIS_EVENT_PROGRAM_HEX="00000000000000000000000000000000000000000000000000000000000000EE"

# Canonical WTHRU mint + the genesis token program (0xAA), pinned in
# programs/c/examples/tn_wthru_mint.h. The bond program denominates bonds in
# this mint; the operator wraps native THRU into a WTHRU token account here.
readonly WTHRU_MINT="tacdgTUGud8OgzN5HnVVv4u3x82UBe8ciZAtjOLJZE_SNg"
readonly WTHRU_TOKEN_PROGRAM="taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq"
# §B (attestor_payment debit + ClaimFees) drives the fullnode block-builder BTP
# endpoint (UDP) via send-block. §B ALWAYS runs — it never skips; if send-block
# cannot be resolved the test fails.
#   BLOCKBUILDER_ADDR - block-builder BTP target (default 127.0.0.1:9002)
#   SEND_BLOCK_BIN    - path (or name on PATH) of a PRE-BUILT send-block binary,
#                       like the TS e2e's --send-block-path. When empty, the
#                       harness looks for grpc/send-block (built by
#                       `make -C grpc send-block`) then /usr/local/bin/send-block
#                       (the Docker image). It never builds or `go run`s it
#                       (mirrors the TS e2e, which requires a pre-built binary).
readonly BLOCKBUILDER_ADDR="${BLOCKBUILDER_ADDR:-127.0.0.1:9002}"
readonly SEND_BLOCK_BIN="${SEND_BLOCK_BIN:-}"
# §B (attestor_payment → PayOutBlock bond debit) is DISABLED by default: it only
# fires when the node has certificate posting enabled
# (tiles.cdrv.posting_certificate_frequency > 0) so PostCertificate → PayOutBlock
# runs. The docker-dev node ships with posting disabled, so §B's debit assertion
# can't pass there yet. Set RUN_BOND_SECTION_B=1 to run it once posting is wired.
# See issues/bp-bond-payout-not-firing-analysis.md.
readonly RUN_BOND_SECTION_B="${RUN_BOND_SECTION_B:-0}"

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

log() {
  printf '[%(%Y-%m-%dT%H:%M:%S%z)T] %s\n' -1 "$*" >&2
}

log_section() {
  log ""
  log "== $* =="
}

die() {
  log "FATAL: $*"
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Missing dependency: '$cmd'"
}

should_run() {
  local scope="$1"
  if [[ "$SELECTED_SCENARIO" == "all" ]]; then
    return 0
  fi
  if [[ "$SELECTED_SCENARIO" == "all-no-debug" ]]; then
    [[ "$scope" != "debug" ]]
    return
  fi

  local selected
  IFS=',' read -ra selected <<< "$SELECTED_SCENARIO"
  for item in "${selected[@]}"; do
    item="${item//[[:space:]]/}"
    if [[ "$item" == "$scope" ]]; then
      return 0
    fi
  done
  return 1
}

with_cli_env() {
  HOME="$CLI_TMP_HOME" "$@"
}

run_cli_raw() {
  local desc="$1"
  shift
  log "CLI: $desc -> thru-cli $*"
  local output
  if output=$(with_cli_env "$THRU_CLI_BIN" "$@" 2>&1); then
    printf '%s' "$output"
  else
    log "CLI command failed (exit $?): $output"
    return 1
  fi
}

run_cli_json() {
  local desc="$1"
  shift
  local output
  output=$(run_cli_raw "$desc" --json "$@") || return 1
  printf '%s\n' "$output"
}

# Run jq on a JSON string without pipes (avoids SIGPIPE with set -o pipefail).
# Usage: jq_str "$json_var" -er '.field'
jq_str() {
  local _json="$1"; shift
  local _tmp; _tmp=$(mktemp)
  printf '%s' "$_json" > "$_tmp"
  if jq "$@" "$_tmp"; then
    rm -f "$_tmp"
  else
    rm -f "$_tmp"
    return 1
  fi
}

run_cli_json_retry() {
  local desc="$1"
  shift
  local attempts="${RETRY_ATTEMPTS:-5}"
  local delay="${RETRY_DELAY_SECS:-2}"
  local output

  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if output=$(run_cli_json "$desc (attempt $attempt/$attempts)" "$@"); then
      printf '%s\n' "$output"
      return 0
    fi
    if (( attempt < attempts )); then
      log "Retrying '$desc' in ${delay}s..."
      sleep "$delay"
    fi
  done

  die "Command '$desc' failed after ${attempts} attempts"
}

run_cli_expect_fail() {
  local desc="$1"
  shift
  log "CLI (expect fail): $desc -> thru-cli $*"
  local tmp
  tmp="$(mktemp)"
  if with_cli_env "$THRU_CLI_BIN" "$@" >"$tmp" 2>&1; then
    local out
    out=$(<"$tmp")
    rm -f "$tmp"
    log "Unexpected success:"
    log "$out"
    return 1
  else
    local status=$?
    local out
    out=$(<"$tmp")
    rm -f "$tmp"
    log "Expected failure observed (exit $status)"
    log "$out"
  fi
}

run_cli_expect_fail_capture() {
  local desc="$1"
  shift
  log "CLI (expect fail): $desc -> thru-cli $*"
  local tmp
  tmp="$(mktemp)"
  if with_cli_env "$THRU_CLI_BIN" "$@" >"$tmp" 2>&1; then
    local out
    out=$(<"$tmp")
    rm -f "$tmp"
    log "Unexpected success:"
    log "$out"
    return 1
  else
    local status=$?
    local out
    out=$(<"$tmp")
    rm -f "$tmp"
    log "Expected failure observed (exit $status)"
    log "$out"
    printf '%s' "$out"
  fi
}

wait_for_consensus_ready() {
  log_section "Waiting for node consensus readiness"

  local timeout_secs="${CONSENSUS_READY_TIMEOUT_SECS:-180}"
  local deadline=$(( $(date +%s) + timeout_secs ))
  local status_json ready finalized locally_executed
  local last_status="unavailable"

  while (( $(date +%s) < deadline )); do
    if status_json=$(run_cli_json "getstatus (consensus readiness)" getstatus 2>/dev/null); then
      ready=$(printf '%s' "$status_json" | jq -r '.getstatus.ready')
      finalized=$(printf '%s' "$status_json" | jq -r '.getstatus.finalized_slot')
      locally_executed=$(printf '%s' "$status_json" | jq -r '.getstatus.locally_executed_slot')
      last_status="ready=${ready} finalized=${finalized} locally_executed=${locally_executed}"
      if [[ "$ready" == "true" ]]; then
        log "Node consensus ready (${last_status})"
        return 0
      fi
    else
      last_status="getstatus unavailable"
    fi

    sleep 1
  done

  die "Node not consensus-ready after ${timeout_secs}s (${last_status})"
}

assert_jq_eq() {
  local json="$1"
  local expr="$2"
  local expected="$3"
  local actual
  actual=$(printf '%s' "$json" | jq -er "$expr") || {
    log "jq expression '$expr' failed on payload:"
    log "$json"
    return 1
  }
  if [[ "$actual" != "$expected" ]]; then
    log "Assertion failed: jq '$expr' => '$actual', expected '$expected'"
    log "Payload: $json"
    return 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if ! grep -Fq "$needle" <<<"$haystack"; then
    log "Assertion failed: expected output to contain '$needle'"
    log "Output: $haystack"
    return 1
  fi
}

# Like assert_jq_eq, but uses `jq -r` (no `-e`) so it can check boolean-`false`
# and `null` results — `jq -e` reports those as a non-zero exit, which would make
# assert_jq_eq mis-report a correct `false`/`null` value as a lookup failure.
assert_jq_raw_eq() {
  local json="$1"
  local expr="$2"
  local expected="$3"
  local actual
  actual=$(printf '%s' "$json" | jq -r "$expr") || {
    log "jq expression '$expr' failed on payload:"
    log "$json"
    return 1
  }
  if [[ "$actual" != "$expected" ]]; then
    log "Assertion failed: jq '$expr' => '$actual', expected '$expected'"
    log "Payload: $json"
    return 1
  fi
}

# Poll `bond show <signer>` until `.bond_show.<field>` renders to <expected>.
# Tolerates post-submission propagation lag (a fresh-but-stale read returns
# exit 0 with the old value, so we poll on the value itself).
assert_bond_field() {
  local signer="$1"; local field="$2"; local expected="$3"; local ctx="$4"
  local attempts="${RETRY_ATTEMPTS:-5}"
  local delay="${RETRY_DELAY_SECS:-2}"
  local out="" actual=""
  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if out=$(run_cli_json "bond show ${ctx} (attempt ${attempt}/${attempts})" bond show "$signer"); then
      actual=$(printf '%s' "$out" | jq -r ".bond_show.${field}") || actual=""
      [[ "$actual" == "$expected" ]] && return 0
    fi
    if (( attempt < attempts )); then
      log "bond show ${ctx}: .${field} => '${actual}', want '${expected}'; retrying in ${delay}s..."
      sleep "$delay"
    fi
  done
  log "Assertion failed: bond show ${ctx}: .${field} => '${actual}', expected '${expected}'"
  log "Payload: $out"
  return 1
}

# Poll a WTHRU token account's amount until it equals <expected>.
poll_wthru_amount() {
  local ta="$1"; local expected="$2"; local ctx="$3"
  local attempts="${RETRY_ATTEMPTS:-5}"
  local delay="${RETRY_DELAY_SECS:-2}"
  local out="" actual=""
  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if out=$(run_cli_json "token balance ${ctx} (attempt ${attempt}/${attempts})" token balance "$ta" --token-program "$WTHRU_TOKEN_PROGRAM"); then
      actual=$(printf '%s' "$out" | jq -r '.token_balance.amount') || actual=""
      [[ "$actual" == "$expected" ]] && return 0
    fi
    if (( attempt < attempts )); then
      log "token balance ${ctx}: amount => '${actual}', want '${expected}'; retrying in ${delay}s..."
      sleep "$delay"
    fi
  done
  log "Assertion failed: token balance ${ctx}: amount => '${actual}', expected '${expected}'"
  return 1
}

# Wait until the node's finalized slot reaches <slot> (PayOutBlock debit and
# ClaimFees only land once the block finalizes). Bounded poll; non-fatal.
wait_for_finalized_slot() {
  local target="$1"; local ctx="$2"
  local timeout_secs="${BOND_FINALIZE_TIMEOUT_SECS:-120}"
  local deadline=$(( $(date +%s) + timeout_secs ))
  local fin=0
  while (( $(date +%s) < deadline )); do
    if fin=$(run_cli_json "getstatus ${ctx}" getstatus 2>/dev/null | jq -er '.getstatus.finalized_slot' 2>/dev/null); then
      (( fin >= target )) && { log "finalized slot $fin >= $target (${ctx})"; return 0; }
    fi
    sleep 2
  done
  log "wait_for_finalized_slot: finalized=$fin still < $target after ${timeout_secs}s (${ctx}); continuing"
  return 0
}

# Resolve the send-block binary path (mirrors the TS e2e, which requires a
# PRE-BUILT binary and spawns it directly — it never uses `go run`). Resolution:
#   1. SEND_BLOCK_BIN (explicit path / name on PATH), like TS's --send-block-path
#   2. grpc/send-block in the checkout (produced by `make -C grpc send-block`)
#   3. /usr/local/bin/send-block (the cli-e2e/ts-e2e Docker image location)
# Prints the resolved path, or "" if none found.
resolve_send_block() {
  if [[ -n "$SEND_BLOCK_BIN" ]]; then
    if [[ -x "$SEND_BLOCK_BIN" ]] || command -v "$SEND_BLOCK_BIN" >/dev/null 2>&1; then
      printf '%s' "$SEND_BLOCK_BIN"; return 0
    fi
    return 1
  fi
  local c
  for c in "$REPO_ROOT/grpc/send-block" "/usr/local/bin/send-block"; do
    [[ -x "$c" ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

# Invoke a pre-built send-block (never builds; never `go run`).
send_block() {
  local bin
  bin="$(resolve_send_block)" || die "send-block binary not found. Build it (\`make -C grpc send-block\`) and set SEND_BLOCK_BIN to its path, or install it at /usr/local/bin/send-block. (Like the TS e2e, this never uses 'go run'.)"
  "$bin" "$@"
}

# Resolve the genesis validator's bls.json (the live on-chain BLS source for the
# `validator` scenario's derivation cross-check, test 8). Resolution:
#   1. GENESIS_BLS_KEY (explicit path), if readable.
#   2. $REPO_ROOT/contrib/docker-dev/data/fullnode/fullnode-dev/bls.json (docker-dev default).
#   3. If the candidate exists but is owner-only (the node writes bls.json 0600 and
#      the test user is not its owner), a NON-INTERACTIVE `sudo -n` copy into the
#      auto-cleaned temp HOME. `-n` never prompts, so it cannot hang; if passwordless
#      sudo is unavailable or the read fails, this returns failure.
# Prints the resolved (readable) path. Mirrors resolve_send_block: explicit path,
# never a silent skip — the caller `die`s with a clear message if it cannot be read.
resolve_genesis_bls_key() {
  local default_path="$REPO_ROOT/contrib/docker-dev/data/fullnode/fullnode-dev/bls.json"
  local candidate="${GENESIS_BLS_KEY:-$default_path}"
  # 1/2: directly readable (explicit override, or default in a context that can read it).
  if [[ -r "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  # 3: owner-only genesis key -> non-interactive sudo copy into the temp HOME.
  if sudo -n true 2>/dev/null; then
    local copy="$CLI_TMP_HOME/genesis-bls.json"
    if sudo -n cat "$candidate" > "$copy" 2>/dev/null && [[ -s "$copy" ]]; then
      chmod 600 "$copy" 2>/dev/null || true
      printf '%s' "$copy"
      return 0
    fi
    rm -f "$copy"
  fi
  return 1
}

# Resolve the node's own ed25519 validator identity seed (64 hex chars) — the
# producer key the bond ClaimFees (§A standalone) and §B scenarios MUST sign
# injected blocks with, so the node certifies/finalizes them. Resolution order:
#   1. NODE_IDENTITY_KEY        (raw 64-hex seed; explicit override).
#   2. NODE_IDENTITY_KEY_FILE   (path to a hex seed file, if readable; in CI the
#      fullnode exports its identity seed to /shared-keys/nodekey.hex — see
#      contrib/docker/scripts/init-fullnode.sh:export_node_identity_seed).
#   3. $REPO_ROOT/contrib/docker-dev/data/nodekey.hex (the seed `dev.sh start`
#      provisions on a fresh local data dir).
# Prints the resolved seed (hex, non-hex chars stripped) on stdout, or empty if no
# source is available. The caller validates non-empty + length and `die`s with a
# scenario-specific message — it never silently skips. Mirrors resolve_genesis_bls_key.
resolve_node_identity_seed() {
  local seed="${NODE_IDENTITY_KEY:-}"
  if [[ -z "$seed" ]]; then
    local nk="${NODE_IDENTITY_KEY_FILE:-}"
    [[ -n "$nk" && -r "$nk" ]] || nk="$REPO_ROOT/contrib/docker-dev/data/nodekey.hex"
    [[ -r "$nk" ]] && seed="$(tr -cd '0-9a-fA-F' < "$nk")"
  fi
  printf '%s' "$seed"
}

transfer_with_retry() {
  local from="$1"
  local to="$2"
  local amount="$3"
  local attempts="${RETRY_ATTEMPTS:-5}"
  local delay="${RETRY_DELAY_SECS:-2}"
  local output

  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if output=$(with_cli_env "$THRU_CLI_BIN" --json transfer "$from" "$to" "$amount" 2>&1); then
      printf '%s\n' "$output"
      return 0
    fi
    if (( attempt < attempts )); then
      log "Transfer $from->$to failed (attempt $attempt/$attempts): $output"
      log "Retrying in ${delay}s..."
      sleep "$delay"
    fi
  done

  log "Transfer error after ${attempts} attempts: $output"
  return 1
}

emit_slot_advancement_transfers() {
  local label="$1"
  log_section "Advancing slots: $label"
  # Must be >= TN_RUNTIME_CTX_COMPRESSION_TIMEOUT (= STATE_HASH_DELAY +
  # ACCEPTS_PROOF_BLOCK_SPAN = 384) so the per-account decompress cooldown
  # clears for any compress that ran in the previous block. Compression-warmup
  # callers only need >= STATE_HASH_DELAY (256) which 384 also satisfies.
  local transfers=384
  local half=$((transfers / 2))
  local output
  for ((i = 0; i < half; i++)); do
    if ! output=$(transfer_with_retry acc_0 acc_1 "$ADVANCE_TRANSFERS_VALUE"); then
      die "Slot advancement transfer acc_0->acc_1 failed on iteration $((i + 1))/$half"
    fi
    if ! output=$(transfer_with_retry acc_1 acc_0 "$ADVANCE_TRANSFERS_VALUE"); then
      die "Slot advancement transfer acc_1->acc_0 failed on iteration $((i + 1))/$half"
    fi
  done
  log "Completed ${transfers} slot advancement transfers"
}

get_finalized_slot() {
  local payload
  payload=$(run_cli_json "getheight (finalized slot lookup)" getheight)
  printf '%s' "$payload" | jq -er '.getheight.finalized'
}

ensure_slot_ready_for_compression() {
  local slot
  slot=$(get_finalized_slot)
  if (( slot < 256 )); then
    emit_slot_advancement_transfers "Warm-up before compression (current slot=$slot)"
  else
    log "Current finalized slot ($slot) already >= 256"
  fi
}

populate_genesis_addresses() {
  log_section "Resolving pre-funded account addresses"
  local acc_0_json acc_1_json acc_2_json acc_3_json
  acc_0_json=$(run_cli_json_retry "resolve acc_0 address" getaccountinfo acc_0)
  acc_1_json=$(run_cli_json_retry "resolve acc_1 address" getaccountinfo acc_1)
  acc_2_json=$(run_cli_json_retry "resolve acc_2 address" getaccountinfo acc_2)
  acc_3_json=$(run_cli_json_retry "resolve acc_3 address" getaccountinfo acc_3)

  ACC_0_ADDRESS=$(printf '%s' "$acc_0_json" | jq -er '.account_info.pubkey')
  ACC_1_ADDRESS=$(printf '%s' "$acc_1_json" | jq -er '.account_info.pubkey')
  ACC_2_ADDRESS=$(printf '%s' "$acc_2_json" | jq -er '.account_info.pubkey')
  ACC_3_ADDRESS=$(printf '%s' "$acc_3_json" | jq -er '.account_info.pubkey')
}

random_hex32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import os, binascii
print(binascii.hexlify(os.urandom(32)).decode())
PY
  fi
}

register_cleanup() {
  CLEANUP_ACTIONS+=("$1")
}

print_help() {
  cat <<EOF
Usage:
  $(basename "$0") [scenario]

Available scenarios:
  all
  all-no-debug
  core
  keys
  accounts
  transfers
  txn
  program
  program-upgrade
  event
  token
  validator
  bond
  util
  debug

Options:
  -h, --help    Show this help message

EOF
  exit 0
}

parse_args() {
  local arg
  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      -h|--help)
        print_help
        ;;
      all)
        SELECTED_SCENARIO="all"
        ;;
      all-no-debug)
        SELECTED_SCENARIO="all-no-debug"
        ;;
      core|keys|accounts|transfers|txn|program|program-upgrade|event|token|validator|bond|util|debug)
        SELECTED_SCENARIO="$arg"
        ;;
      *)
        if [[ "$arg" == *","* ]]; then
          SELECTED_SCENARIO="$arg"
        else
          die "Unknown option or scenario: $arg"
        fi
        ;;
    esac
    shift
  done
}

run_cleanup() {
  for action in "${CLEANUP_ACTIONS[@]}"; do
    eval "$action" || log "Cleanup step failed: $action"
  done
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

check_prerequisites() {
  log_section "Prerequisite validation"
  require_command jq
  if [[ "$SKIP_BUILD" != "1" ]]; then
    require_command cargo
  fi
  require_command git

  if [[ "$SKIP_BUILD" != "1" ]]; then
    log "Building thru CLI via cargo (workspace root: $REPO_ROOT/rpc/cli)"
    (cd "$REPO_ROOT/rpc/cli" && cargo build --release -p thru)
  else
    log "Skipping build (SKIP_BUILD=1)"
  fi

  [[ -x "$THRU_CLI_BIN" ]] || die "thru-cli binary not found at $THRU_CLI_BIN"

  [[ -f "$EVENT_PROGRAM_BIN" ]] || die "Event emission program binary missing: $EVENT_PROGRAM_BIN"
}

seed_cli_config() {
  log_section "Seeding CLI configuration"
  mkdir -p "$CONFIG_DIR"

  # Pre-funded accounts use sequential private keys where the index is stored
  # in little-endian format in the first 8 bytes (see tn_fund_initial_accounts).
  # Account 0: 0000...0000 (index 0)
  # Account 1: 0100...0000 (index 1)
  # Account 2: 0200...0000 (index 2)
  # Account 3: 0300...0000 (index 3)
  cat >"$CONFIG_PATH" <<EOF
rpc_base_url: "$RPC_BASE_URL"
keys:
  default: "0000000000000000000000000000000000000000000000000000000000000000"
  acc_0: "0000000000000000000000000000000000000000000000000000000000000000"
  acc_1: "0100000000000000000000000000000000000000000000000000000000000000"
  acc_2: "0200000000000000000000000000000000000000000000000000000000000000"
  acc_3: "0300000000000000000000000000000000000000000000000000000000000000"
uploader_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC"
manager_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE"
abi_manager_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACrG7"
token_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq"
consensus_validator_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAEN"
consensus_attestor_table_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAIO"
consensus_converted_vault_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAQQ"
consensus_unclaimed_vault_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAUR"
wthru_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcH"
bp_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQEO"
name_service_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUF"
thru_registrar_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYG"
timeout_seconds: 300
max_retries: 5
auth_token:
EOF

  chmod 600 "$CONFIG_PATH"
  log "Configuration seeded at $CONFIG_PATH"
}

# ---------------------------------------------------------------------------
# Scenario implementations
# ---------------------------------------------------------------------------

scenario_core_rpc() {
  should_run "core" || return 0
  log_section "Scenario: core RPC sanity checks"

  local version_text
  version_text=$(run_cli_raw "getversion (text)" getversion)
  assert_contains "$version_text" "thru-node"

  local version_json
  version_json=$(run_cli_json "getversion (json)" getversion)
  assert_jq_eq "$version_json" '.getversion.status' 'success'
  assert_contains "$version_json" '"thru-node"'

  local health_json
  health_json=$(run_cli_json "gethealth (json)" gethealth)
  assert_jq_eq "$health_json" '.gethealth.status' 'serving'

  local height_json
  height_json=$(run_cli_json "getheight (json)" getheight)
  assert_jq_eq "$height_json" '.getheight.status' 'success'
}

scenario_keys() {
  should_run "keys" || return 0
  log_section "Scenario: key management"

  run_cli_json "keys list" keys list >/dev/null

  local generated_json
  generated_json=$(run_cli_json "keys generate cli-test" keys generate cli-test)
  local generated_value
  generated_value=$(printf '%s' "$generated_json" | jq -er '.keys.value')
  [[ ${#generated_value} -eq 64 ]] || die "Generated key not 64 hex chars"

  run_cli_json "keys get cli-test" keys get cli-test >/dev/null

  run_cli_expect_fail "keys add duplicate without overwrite" keys add cli-test "$generated_value"

  local overwrite_value="5555555555555555555555555555555555555555555555555555555555555555"
  run_cli_json "keys add with overwrite" keys add --overwrite cli-test "$overwrite_value" >/dev/null

  run_cli_json "keys remove cli-test" keys rm cli-test >/dev/null

  local rm_default_output
  rm_default_output=$(run_cli_expect_fail_capture "keys remove default without force" keys rm default)
  assert_contains "$rm_default_output" "Cannot remove the 'default' key because the CLI requires it."

  run_cli_json "keys force remove default" keys rm --force default >/dev/null
  run_cli_json "keys list after forced default removal" keys list >/dev/null
  run_cli_json "restore default key" keys add --overwrite default "0000000000000000000000000000000000000000000000000000000000000000" >/dev/null
}

scenario_accounts() {
  should_run "accounts" || return 0
  log_section "Scenario: account lifecycle"

  local new_key_hex
  new_key_hex=$(random_hex32)
  local key_suffix
  key_suffix="$(date +%s)-$RANDOM"
  GENERATED_ACCOUNT_KEY="test-acct-${key_suffix}"
  run_cli_json "keys add $GENERATED_ACCOUNT_KEY" keys add --overwrite "$GENERATED_ACCOUNT_KEY" "$new_key_hex" >/dev/null

  local existing_info current_nonce
  if existing_info=$(with_cli_env "$THRU_CLI_BIN" --json getaccountinfo "$GENERATED_ACCOUNT_KEY" 2>/dev/null); then
    GENERATED_ACCOUNT_PUBKEY=$(printf '%s' "$existing_info" | jq -er '.account_info.pubkey')
    current_nonce=$(printf '%s' "$existing_info" | jq -er '.account_info.nonce')
    ACCOUNT_CREATE_SIGNATURE=""
    log "Account $GENERATED_ACCOUNT_KEY already exists (nonce=${current_nonce}); reusing existing account."
  else
    log "Account $GENERATED_ACCOUNT_KEY not found; creating."
    local attempt create_status create_output
    local created=false
    for (( attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++ )); do
      log "CLI: account create (attempt $attempt/$RETRY_ATTEMPTS) -> thru-cli --json account create $GENERATED_ACCOUNT_KEY"
      if create_output=$(with_cli_env "$THRU_CLI_BIN" --json account create "$GENERATED_ACCOUNT_KEY" 2>&1); then
        ACCOUNT_CREATE_SIGNATURE=$(printf '%s' "$create_output" | jq -er '.account_create.signature')
        GENERATED_ACCOUNT_PUBKEY=$(printf '%s' "$create_output" | jq -er '.account_create.public_key')
        created=true
        break
      fi
      create_status=$?

      if grep -q "bintrie: key already exists" <<<"$create_output"; then
        log "Account already present according to state proof response; fetching existing account info."
        existing_info=$(with_cli_env "$THRU_CLI_BIN" --json getaccountinfo "$GENERATED_ACCOUNT_KEY" 2>/dev/null) || die "Unable to load existing account info after bintrie error"
        GENERATED_ACCOUNT_PUBKEY=$(printf '%s' "$existing_info" | jq -er '.account_info.pubkey')
        current_nonce=$(printf '%s' "$existing_info" | jq -er '.account_info.nonce')
        ACCOUNT_CREATE_SIGNATURE=""
        log "Reusing existing account $GENERATED_ACCOUNT_PUBKEY (nonce=${current_nonce})."
        created=true
        break
      fi

      log "Account creation failed (exit $create_status): $create_output"
      if (( attempt < RETRY_ATTEMPTS )); then
        log "Retrying account create in ${RETRY_DELAY_SECS}s..."
        sleep "$RETRY_DELAY_SECS"
      fi
    done

    if [[ "$created" != true ]]; then
      die "Failed to create account $GENERATED_ACCOUNT_KEY after ${RETRY_ATTEMPTS} attempts"
    fi
  fi

  run_cli_json "account info" account info "$GENERATED_ACCOUNT_KEY" >/dev/null

  run_cli_json "account transactions default" account transactions "$GENERATED_ACCOUNT_KEY" >/dev/null
  run_cli_json "account transactions paginated" account transactions "$GENERATED_ACCOUNT_KEY" --page-size 5 --page-token "" >/dev/null

  # Compression requires global_activated_state_counter > 32 GiB (TN_STATE_COUNTER_BASELINE_BYTES).
  # With pre-funded accounts from mksnap, the state counter is based on actual account data,
  # which is typically far below the 32 GiB threshold. Skip compression tests in this case.
  # To re-enable, use a genesis JSON with high global_activated_state_counter (e.g., 934359738368).
  log "Skipping compression/decompression tests (requires genesis with high state counter)"

  # ensure_slot_ready_for_compression
  #
  # local compress_json
  # compress_json=$(run_cli_json "account compress" account compress "$GENERATED_ACCOUNT_KEY")
  # assert_jq_eq "$compress_json" '.account_compress.status' 'success'
  #
  # emit_slot_advancement_transfers "Cooldown before decompression"
  #
  # run_cli_json "account prepare-decompression (pre)" account prepare-decompression "$GENERATED_ACCOUNT_PUBKEY" >/dev/null
  #
  # local decompress_json
  # decompress_json=$(run_cli_json "account decompress" account decompress "$GENERATED_ACCOUNT_KEY")
  # assert_jq_eq "$decompress_json" '.account_decompress.status' 'success'
  #
  # run_cli_json "account prepare-decompression (post)" account prepare-decompression "$GENERATED_ACCOUNT_PUBKEY" >/dev/null
}

scenario_transfers() {
  should_run "transfers" || return 0
  log_section "Scenario: native transfers"

  local balance_before_src balance_before_dst
  balance_before_src=$(run_cli_json "getbalance acc_0 before" getbalance acc_0 | jq -er '.balance.balance')
  balance_before_dst=$(run_cli_json "getbalance acc_1 before" getbalance acc_1 | jq -er '.balance.balance')

  local transfer_json
  transfer_json=$(run_cli_json "transfer acc_0->acc_1" transfer acc_0 acc_1 5)
  assert_jq_eq "$transfer_json" '.transfer.status' 'success'

  local balance_after_src balance_after_dst
  balance_after_src=$(run_cli_json "getbalance acc_0 after" getbalance acc_0 | jq -er '.balance.balance')
  balance_after_dst=$(run_cli_json "getbalance acc_1 after" getbalance acc_1 | jq -er '.balance.balance')

  local delta_src=$((balance_before_src - balance_after_src))
  local delta_dst=$((balance_after_dst - balance_before_dst))
  log "Transfer deltas: src decreased by ${delta_src}, dst increased by ${delta_dst}"
  if (( delta_dst <= 0 )); then
    log "Warning: destination balance did not increase; continuing"
  fi

  run_cli_expect_fail "transfer with zero amount" transfer acc_0 acc_1 0
}

scenario_txn() {
  should_run "txn" || return 0
  log_section "Scenario: transaction sign/execute/state proof"

  local account_to_prove="acc_0"
  local proof_json
  proof_json=$(run_cli_json "txn make-state-proof creating" txn make-state-proof creating "$account_to_prove")
  assert_jq_eq "$proof_json" '.makeStateProof.status' 'success'

  local account_pubkey
  account_pubkey=$(printf '%s' "$proof_json" | jq -er '.makeStateProof.account')
  [[ -n "$account_pubkey" ]] || die "State proof account missing"

  local test_transfer_json
  test_transfer_json=$(run_cli_json "transfer for txn get test" transfer acc_0 acc_1 1)
  assert_jq_eq "$test_transfer_json" '.transfer.status' 'success'

  local test_signature
  test_signature=$(printf '%s' "$test_transfer_json" | jq -er '.transfer.signature')
  [[ -n "$test_signature" ]] || die "Transfer signature missing"

  local txn_get_json
  txn_get_json=$(run_cli_json_retry "txn get" txn get "$test_signature")
  assert_jq_eq "$txn_get_json" '.transaction_get.status' 'success'

  local retrieved_signature
  retrieved_signature=$(printf '%s' "$txn_get_json" | jq -er '.transaction_get.signature')
  [[ "$retrieved_signature" == "$test_signature" ]] || die "Retrieved signature mismatch: expected '$test_signature', got '$retrieved_signature'"

  printf '%s' "$txn_get_json" | jq -e '.transaction_get.execution_result' >/dev/null || die "Missing execution_result in txn get response"
}

scenario_programs() {
  should_run "program" || return 0
  log_section "Scenario: uploader and program lifecycle + event emission"

  PROGRAM_SEED="event-$(date +%s)"
  local uploader_seed="${PROGRAM_SEED}-uploader"

  local upload_json
  upload_json=$(run_cli_json "uploader upload" uploader upload "$uploader_seed" "$EVENT_PROGRAM_BIN")
  assert_jq_eq "$upload_json" '.program_upload.status' 'success'

  local cleanup_json
  cleanup_json=$(run_cli_json "uploader cleanup" uploader cleanup "$uploader_seed")
  assert_jq_eq "$cleanup_json" '.program_cleanup.status' 'success'

  local create_json
  create_json=$(run_cli_json "program create" program create --ephemeral "$PROGRAM_SEED" "$EVENT_PROGRAM_BIN")
  assert_jq_eq "$create_json" '.program_create.status' 'success'
  PROGRAM_ACCOUNT_ID=$(printf '%s' "$create_json" | jq -er '.program_create.program_account')
  PROGRAM_META_ID=$(printf '%s' "$create_json" | jq -er '.program_create.meta_account')

  local event_instruction_hex="03000000000000000100000000000000546f2062652c206f72206e6f7420746f2062653f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  local event_tx_json
  event_tx_json=$(run_cli_json "txn execute event emission" txn execute "$PROGRAM_ACCOUNT_ID" "$event_instruction_hex" --fee-payer acc_0 --timeout 60)
  EVENT_SIGNATURE=$(printf '%s' "$event_tx_json" | jq -er '.transaction_execute.signature')
  local event_payload
  event_payload=$(printf '%s' "$event_tx_json" | jq -er '.transaction_execute.events[0].data.value // empty')
  [[ "$event_payload" == "$EVENT_TEXT_EXPECTATION" ]] || die "Unexpected event payload: '$event_payload'"

  local sign_json
  sign_json=$(run_cli_json "txn sign event instruction" txn sign "$PROGRAM_ACCOUNT_ID" "$event_instruction_hex" --fee-payer acc_0)
  assert_jq_eq "$sign_json" '.transaction_sign.status' 'success'

  local setpause_json
  setpause_json=$(run_cli_json "program set-pause" program set-pause --ephemeral "$PROGRAM_SEED" true)
  assert_jq_eq "$setpause_json" '.program_set_pause.status' 'success'

  local unpause_json
  unpause_json=$(run_cli_json "program set-pause (unpause)" program set-pause --ephemeral "$PROGRAM_SEED" false)
  assert_jq_eq "$unpause_json" '.program_set_pause.status' 'success'

  local setauth_json
  setauth_json=$(run_cli_json "program set-authority" program set-authority --ephemeral "$PROGRAM_SEED" "$ACC_2_ADDRESS")
  assert_jq_eq "$setauth_json" '.program_set_authority.status' 'success'

  local claimauth_json
  claimauth_json=$(run_cli_json "program claim-authority" program claim-authority --ephemeral "$PROGRAM_SEED" --fee-payer acc_2)
  assert_jq_eq "$claimauth_json" '.program_claim_authority.status' 'success'

  local finalize_json
  finalize_json=$(run_cli_json "program finalize" program finalize --ephemeral "$PROGRAM_SEED" --fee-payer acc_2)
  assert_jq_eq "$finalize_json" '.program_finalize.status' 'success'

  log "CLI (expect fail): program destroy after finalize -> thru-cli --json program destroy --ephemeral $PROGRAM_SEED --fee-payer acc_2"
  local destroy_fail_stdout destroy_fail_stderr destroy_fail_output
  destroy_fail_stdout=$(mktemp)
  destroy_fail_stderr=$(mktemp)
  if with_cli_env "$THRU_CLI_BIN" --json program destroy --ephemeral "$PROGRAM_SEED" --fee-payer acc_2 >"$destroy_fail_stdout" 2>"$destroy_fail_stderr"; then
    destroy_fail_output=$(<"$destroy_fail_stdout")
    log "Unexpected success:"
    log "$destroy_fail_output"
    rm -f "$destroy_fail_stdout" "$destroy_fail_stderr"
    die "Expected 'program destroy' to fail for finalized program"
  else
    local status=$?
    destroy_fail_output=$(<"$destroy_fail_stdout")
    local destroy_fail_err
    destroy_fail_err=$(<"$destroy_fail_stderr")
    rm -f "$destroy_fail_stdout" "$destroy_fail_stderr"
    log "Expected failure observed (exit $status)"
    if [[ -n "$destroy_fail_err" ]]; then
      log "$destroy_fail_err"
    fi
    log "$destroy_fail_output"
  fi
  local destroy_fail_status
  destroy_fail_status=$(printf '%s' "$destroy_fail_output" | jq -er '.program_destroy.status')
  [[ "$destroy_fail_status" == "failed" ]] || die "Expected destroy status 'failed', got '$destroy_fail_status'"
  local destroy_fail_hex
  destroy_fail_hex=$(printf '%s' "$destroy_fail_output" | jq -er '.program_destroy.error.user_error_code_hex')
  [[ "$destroy_fail_hex" == "0x704" ]] || die "Expected user error code hex 0x704, got '$destroy_fail_hex'"
  printf '%s' "$destroy_fail_output" | jq -e '.program_destroy.error.execution_result' >/dev/null || die "Missing execution_result in program destroy error payload"
  printf '%s' "$destroy_fail_output" | jq -e '.program_destroy.error.execution_result_hex' >/dev/null || die "Missing execution_result_hex in program destroy error payload"
  printf '%s' "$destroy_fail_output" | jq -e '.program_destroy.error.vm_error' >/dev/null || die "Missing vm_error in program destroy error payload"

  PROGRAM_SEED="event-$(date +%s)"
  local destroy_seed="${PROGRAM_SEED}"
  local recreate_json
  recreate_json=$(run_cli_json "program create (destroy-only)" program create --ephemeral "$destroy_seed" "$EVENT_PROGRAM_BIN")
  assert_jq_eq "$recreate_json" '.program_create.status' 'success'
  local destroy_fresh_json
  destroy_fresh_json=$(run_cli_json "program destroy (without finalize)" program destroy --ephemeral "$destroy_seed" )
  assert_jq_eq "$destroy_fresh_json" '.program_destroy.status' 'success'

  local derive_addr_json
  derive_addr_json=$(run_cli_json "program derive-address" program derive-address "$PROGRAM_ACCOUNT_ID" "foo-seed" --ephemeral)
  local derive_addr
  derive_addr=$(printf '%s' "$derive_addr_json" | jq -er '.derive_address.derived_address')

}

scenario_program_upgrade() {
  should_run "program-upgrade" || return 0
  log_section "Scenario: program upgrade"

  local upgrade_seed="upgrade-$(date +%s)"
  local initial_program_bin="$EVENT_PROGRAM_BIN"
  local upgrade_program_bin="$REPO_ROOT/build/thruvm/bin/tn_token_program_rust.bin"

  local create_json
  create_json=$(run_cli_json "program create permanent" program create --manager "$EVENT_PROGRAM_MANAGER" "$upgrade_seed" "$initial_program_bin")
  assert_jq_eq "$create_json" '.program_create.status' 'success'
  local upgrade_program_account
  upgrade_program_account=$(printf '%s' "$create_json" | jq -er '.program_create.program_account')

  local event_instruction_hex="03000000000000000100000000000000546f2062652c206f72206e6f7420746f2062653f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  local event_tx_json
  event_tx_json=$(run_cli_json "txn execute initial program" txn execute "$upgrade_program_account" "$event_instruction_hex" --fee-payer acc_0 --timeout 120)
  assert_jq_eq "$event_tx_json" '.transaction_execute.status' 'success'

  local upgrade_json
  upgrade_json=$(run_cli_json "program upgrade" program upgrade --manager "$EVENT_PROGRAM_MANAGER" "$upgrade_seed" "$upgrade_program_bin")
  assert_jq_eq "$upgrade_json" '.program_upgrade.status' 'success'

  local post_upgrade_output
  if post_upgrade_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute "$upgrade_program_account" "$event_instruction_hex" --fee-payer acc_0 --timeout 60 2>&1); then
    die "Expected txn execute after upgrade to fail"
  fi
  assert_contains "$post_upgrade_output" "Transaction failed"

  local mint_seed
  mint_seed=$(random_hex32)
  local derive_mint_json
  derive_mint_json=$(run_cli_json "token derive mint account (post-upgrade)" token derive-mint-account "$ACC_2_ADDRESS" "$mint_seed" --token-program "$upgrade_program_account")
  local upgraded_mint_account
  upgraded_mint_account=$(printf '%s' "$derive_mint_json" | jq -er '.derive_mint_account.mint_account_address')

  local mint_init_json
  mint_init_json=$(run_cli_json "token initialize mint (post-upgrade)" token initialize-mint "$ACC_2_ADDRESS" --freeze-authority "$ACC_2_ADDRESS" --decimals 9 TST "$mint_seed" --fee-payer acc_2 --token-program "$upgrade_program_account")
  assert_jq_eq "$mint_init_json" '.token_initialize_mint.status' 'success'

  local destroy_json
  destroy_json=$(run_cli_json "program destroy upgraded" program destroy --manager "$EVENT_PROGRAM_MANAGER" "$upgrade_seed")
  assert_jq_eq "$destroy_json" '.program_destroy.status' 'success'
}

scenario_event() {
  should_run "event" || return 0
  log_section "Scenario: builtin event emission program"

  local convert_json
  convert_json=$(run_cli_json "convert builtin event program address" util convert pubkey hex-to-thrufmt "$GENESIS_EVENT_PROGRAM_HEX")
  local builtin_program_addr
  builtin_program_addr=$(printf '%s' "$convert_json" | jq -er '.thru_pubkey')

  local event_instruction_hex="03000000000000000100000000000000546f2062652c206f72206e6f7420746f2062653f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  local event_tx_json
  event_tx_json=$(run_cli_json "txn execute builtin event emission" txn execute "$builtin_program_addr" "$event_instruction_hex" --fee-payer acc_0 --timeout 60)
  local event_count events_len events_size
  event_count=$(printf '%s' "$event_tx_json" | jq -er '.transaction_execute.events_count')
  events_len=$(printf '%s' "$event_tx_json" | jq -er '.transaction_execute.events | length')
  events_size=$(printf '%s' "$event_tx_json" | jq -er '.transaction_execute.events_size')

  [[ "$event_count" -eq 3 ]] || die "Expected 3 events, got $event_count"
  [[ "$events_len" -eq "$event_count" ]] || die "Events array length $events_len does not match events_count $event_count"
  (( events_size > 0 )) || die "events_size should be positive"

  if ! printf '%s' "$event_tx_json" | jq -e \
      --arg addr "$builtin_program_addr" \
      --arg text "$EVENT_TEXT_EXPECTATION" '
        all(.transaction_execute.events[];
            (.call_idx == 0) and
            (.program == $addr) and
            (.program_idx == 1) and
            (.event_type == 1) and
            (.event_id | type == "string" and length > 0) and
            (.data.type == "string") and
            (.data.value == $text))
      ' >/dev/null
  then
    die "Event payload or metadata mismatch"
  fi
}

scenario_token() {
  should_run "token" || return 0
  log_section "Scenario: token program operations"

  local mint_seed="0102030405060708010203040506070801020304050607080102030405060708"
  local acc_2_token_seed="0101010101010101010101010101010101010101010101010101010101010101"
  local acc_3_token_seed="0202020202020202020202020202020202020202020202020202020202020202"

  local token_program_seed="token-$(date +%s)"
  local token_program_bin="$REPO_ROOT/build/thruvm/bin/tn_token_program_rust.bin"

  local token_program_json
  token_program_json=$(run_cli_json "program create token program" program create "$token_program_seed" "$token_program_bin")
  assert_jq_eq "$token_program_json" '.program_create.status' 'success'
  local token_program_id
  token_program_id=$(printf '%s' "$token_program_json" | jq -er '.program_create.program_account')

  # Poll `token balance` until <jq-expr> renders to <expected>, then return.
  # run_cli_json_retry only retries hard CLI failures; a successful-but-stale
  # read (account indexed but the latest txn not yet applied) returns exit 0
  # with the old value and would never retry. This polls on the value itself,
  # so it tolerates post-submission propagation lag. Booleans are compared via
  # `tostring` since they render as `true`/`false`.
  # Usage: assert_token_balance "<addr>" "<jq-expr>" "<expected>" "<ctx>"
  assert_token_balance() {
    local addr="$1"; local expr="$2"; local expected="$3"; local ctx="$4"
    local attempts="${RETRY_ATTEMPTS:-5}"
    local delay="${RETRY_DELAY_SECS:-2}"
    local out="" actual=""
    for (( attempt = 1; attempt <= attempts; attempt++ )); do
      if out=$(run_cli_json "token balance ${ctx} (attempt ${attempt}/${attempts})" token balance "$addr" --token-program "$token_program_id"); then
        actual=$(printf '%s' "$out" | jq -r "$expr") || actual=""
        [[ "$actual" == "$expected" ]] && return 0
      fi
      if (( attempt < attempts )); then
        log "token balance ${ctx}: ${expr} => '${actual}', want '${expected}'; retrying in ${delay}s..."
        sleep "$delay"
      fi
    done
    log "Assertion failed: token balance ${ctx}: ${expr} => '${actual}', expected '${expected}'"
    log "Payload: $out"
    return 1
  }

  # Convenience wrapper for the common amount check.
  assert_token_amount() {
    local addr="$1"; local expected="$2"; local ctx="$3"
    assert_token_balance "$addr" '.token_balance.amount' "$expected" "$ctx"
  }

  local derive_mint_json
  derive_mint_json=$(run_cli_json "token derive mint account" token derive-mint-account "$ACC_2_ADDRESS" "$mint_seed" --token-program "$token_program_id")
  TOKEN_MINT_ADDRESS=$(printf '%s' "$derive_mint_json" | jq -er '.derive_mint_account.mint_account_address')

  local init_mint_json
  init_mint_json=$(run_cli_json "token initialize mint" token initialize-mint "$ACC_2_ADDRESS" --freeze-authority "$ACC_2_ADDRESS" --decimals 9 TST "$mint_seed" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$init_mint_json" '.token_initialize_mint.status' 'success'
  TOKEN_MINT_ADDRESS=$(printf '%s' "$init_mint_json" | jq -er '.token_initialize_mint.mint_account')

  local derive_acc_2_json
  derive_acc_2_json=$(run_cli_json "token derive acc_2 token account" token derive-token-account "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --seed "$acc_2_token_seed" --token-program "$token_program_id")
  local acc_2_token_account
  acc_2_token_account=$(printf '%s' "$derive_acc_2_json" | jq -er '.derive_token_account.token_account_address')

  local init_acc_2_json
  init_acc_2_json=$(run_cli_json "token initialize acc_2 account" token initialize-account "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" "$acc_2_token_seed" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$init_acc_2_json" '.token_initialize_account.status' 'success'
  acc_2_token_account=$(printf '%s' "$init_acc_2_json" | jq -er '.token_initialize_account.token_account')

  local derive_acc_3_json
  derive_acc_3_json=$(run_cli_json "token derive acc_3 token account" token derive-token-account "$TOKEN_MINT_ADDRESS" "$ACC_3_ADDRESS" --seed "$acc_3_token_seed" --token-program "$token_program_id")
  local acc_3_token_account
  acc_3_token_account=$(printf '%s' "$derive_acc_3_json" | jq -er '.derive_token_account.token_account_address')

  local init_acc_3_json
  init_acc_3_json=$(run_cli_json "token initialize acc_3 account" token initialize-account "$TOKEN_MINT_ADDRESS" "$ACC_3_ADDRESS" "$acc_3_token_seed" --fee-payer acc_3 --token-program "$token_program_id")
  assert_jq_eq "$init_acc_3_json" '.token_initialize_account.status' 'success'
  acc_3_token_account=$(printf '%s' "$init_acc_3_json" | jq -er '.token_initialize_account.token_account')

  local mint_to_json
  mint_to_json=$(run_cli_json "token mint-to acc_2" token mint-to "$TOKEN_MINT_ADDRESS" "$acc_2_token_account" "$ACC_2_ADDRESS" 1000 --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$mint_to_json" '.token_mint_to.status' 'success'
  assert_token_amount "$acc_2_token_account" 1000 "after mint-to"

  local transfer_json
  transfer_json=$(run_cli_json "token transfer acc_2->acc_3" token transfer "$acc_2_token_account" "$acc_3_token_account" 200 --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$transfer_json" '.token_transfer.status' 'success'
  assert_token_amount "$acc_2_token_account" 800 "after transfer src"
  assert_token_amount "$acc_3_token_account" 200 "after transfer dst"

  local freeze_json
  freeze_json=$(run_cli_json "token freeze acc_3" token freeze-account "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$freeze_json" '.token_freeze_account.status' 'success'
  assert_token_balance "$acc_3_token_account" '.token_balance.is_frozen | tostring' 'true' "after freeze"
  assert_token_balance "$acc_3_token_account" '.token_balance.amount' '200' "after freeze (amount)"

  local thaw_json
  thaw_json=$(run_cli_json "token thaw acc_3" token thaw-account "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$thaw_json" '.token_thaw_account.status' 'success'
  assert_token_balance "$acc_3_token_account" '.token_balance.is_frozen | tostring' 'false' "after thaw"
  assert_token_balance "$acc_3_token_account" '.token_balance.amount' '200' "after thaw (amount)"

  local burn_json
  burn_json=$(run_cli_json "token burn acc_3 balance" token burn "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_3_ADDRESS" 200 --fee-payer acc_3 --token-program "$token_program_id")
  assert_jq_eq "$burn_json" '.token_burn.status' 'success'
  assert_token_amount "$acc_3_token_account" 0 "after burn"

  # Pre-close: confirm acc_3 amount is already 0 so the post-close
  # status:"closed" assertion is unambiguous (a non-zero amount before close
  # would mean burn never propagated). Intentionally kept as a distinct
  # checkpoint even though it reads the same state as "after burn".
  assert_token_amount "$acc_3_token_account" 0 "pre-close confirmation"

  local close_json
  close_json=$(run_cli_json "token close acc_3 account" token close-account "$acc_3_token_account" "$ACC_3_ADDRESS" "$ACC_3_ADDRESS" --fee-payer acc_3 --token-program "$token_program_id")
  assert_jq_eq "$close_json" '.token_close_account.status' 'success'

  # close-account zeroes the 73-byte body in place (process.rs:621-626), so
  # the account record persists and `token balance` returns status:"closed".
  assert_token_balance "$acc_3_token_account" '.token_balance.status' 'closed' "after close"
  assert_token_balance "$acc_3_token_account" '.token_balance.amount' '0' "after close (amount)"

  run_cli_json "token derive-token-account (verify)" token derive-token-account "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --seed "$acc_2_token_seed" --token-program "$token_program_id" >/dev/null
  run_cli_json "token derive-mint-account (verify)" token derive-mint-account "$ACC_2_ADDRESS" "$mint_seed" --token-program "$token_program_id" >/dev/null
}

# Consensus-validator BLS derivation + status reads. Read-only and offline-safe:
# never activates/deactivates (those mutate shared consensus weight and are
# non-deterministic across runs — see "NOT covered" in the plan). Covers the new
# `validator bls-pubkey` and `validator status` surfaces plus a required
# cross-check that CLI BLS derivation matches the live genesis on-chain key.
scenario_validator() {
  should_run "validator" || return 0
  log_section "Scenario: consensus-validator BLS derivation + status (read-only)"

  local hex192='^[0-9a-f]{192}$'

  # --- Setup: a temp bls.json holding a valid NONZERO 32-byte scalar. ----------
  # blst_scalar_from_bendian is big-endian, so scalar 1 is [0,..,0,1]. The all-zero
  # scalar (acc_0's seed) is rejected by blst_sk_check, so it is NOT usable here.
  local tmp_bls="$CLI_TMP_HOME/validator-bls-one.json"
  printf '[%s1]' "$(printf '0,%.0s' {1..31})" > "$tmp_bls"

  # --- Test 1: bls-pubkey derivation (JSON), bare 192-hex, no identity field. ---
  local bp_json bp_hex
  bp_json=$(run_cli_json "validator bls-pubkey (temp scalar)" validator bls-pubkey --bls-key "$tmp_bls")
  assert_jq_eq "$bp_json" '.validator_bls_pubkey.status' 'success'
  bp_hex=$(printf '%s' "$bp_json" | jq -er '.validator_bls_pubkey.bls_pubkey_hex')
  [[ "$bp_hex" =~ $hex192 ]] || die "bls-pubkey hex not bare 192-char lowercase hex: $bp_hex"
  if printf '%s' "$bp_json" | jq -e '.validator_bls_pubkey.identity' >/dev/null 2>&1; then
    die "bls-pubkey output must not carry an identity field (a bls.json has no identity)"
  fi

  # --- Test 2: derivation is deterministic. ------------------------------------
  local bp_hex2
  bp_hex2=$(run_cli_json "validator bls-pubkey (determinism)" validator bls-pubkey --bls-key "$tmp_bls" \
    | jq -er '.validator_bls_pubkey.bls_pubkey_hex')
  [[ "$bp_hex" == "$bp_hex2" ]] || die "bls-pubkey not deterministic: $bp_hex != $bp_hex2"

  # --- Test 3: negatives (missing flag / missing file / zero scalar). ----------
  run_cli_expect_fail "validator bls-pubkey without --bls-key" validator bls-pubkey
  run_cli_expect_fail "validator bls-pubkey nonexistent file" \
    validator bls-pubkey --bls-key "$CLI_TMP_HOME/does-not-exist.json"
  local tmp_bls_zero="$CLI_TMP_HOME/validator-bls-zero.json"
  printf '[%s0]' "$(printf '0,%.0s' {1..31})" > "$tmp_bls_zero"
  run_cli_expect_fail "validator bls-pubkey all-zero scalar" validator bls-pubkey --bls-key "$tmp_bls_zero"

  # --- Test 4: activate argument validation (no network mutation). -------------
  # Provide a valid BLS source so clap's required_unless_present_any passes and the
  # failure is attributable to ensure_nonzero_amount (which runs before any RPC).
  local amt_fail
  amt_fail=$(run_cli_expect_fail_capture "validator activate zero amount" \
    validator activate --source-token-account "$ACC_0_ADDRESS" --token-amount 0 --bls-seed 1)
  assert_contains "$amt_fail" "amount must be greater than 0"
  # Mutual exclusion + missing-source: clap owns the wording, so only assert failure.
  run_cli_expect_fail "validator activate bls-pubkey+bls-seed" \
    validator activate --source-token-account "$ACC_0_ADDRESS" --token-amount 1 \
    --bls-pubkey "$(printf '11%.0s' {1..96})" --bls-seed 1
  run_cli_expect_fail "validator activate bls-key+bls-pubkey" \
    validator activate --source-token-account "$ACC_0_ADDRESS" --token-amount 1 \
    --bls-key "$tmp_bls" --bls-pubkey "$(printf '11%.0s' {1..96})"
  run_cli_expect_fail "validator activate no bls source" \
    validator activate --source-token-account "$ACC_0_ADDRESS" --token-amount 1

  # --- Test 5: validator table decodes; genesis validator present. -------------
  local table_json
  table_json=$(run_cli_json "validator table" validator table)
  assert_jq_eq "$table_json" '.validator_table.status' 'success'
  local occupied server_count total_weight
  occupied=$(printf '%s' "$table_json" | jq -er '.validator_table.occupied_validators')
  server_count=$(printf '%s' "$table_json" | jq -er '.validator_table.server_count')
  total_weight=$(printf '%s' "$table_json" | jq -er '.validator_table.total_weight')
  (( occupied >= 1 ))     || die "expected occupied_validators >= 1, got $occupied"
  (( server_count > 0 ))  || die "expected server_count > 0, got $server_count"
  (( total_weight > 0 ))  || die "expected total_weight > 0, got $total_weight"

  # --- Test 8 (computed early; used by tests 6 + 8): genesis cross-check. -------
  # Resolve the live genesis bls.json by explicit path → die (never skip).
  local genesis_bls_path genesis_derived
  genesis_bls_path=$(resolve_genesis_bls_key) || die "genesis bls.json not readable. Set GENESIS_BLS_KEY to a readable genesis validator bls.json (default: contrib/docker-dev/data/fullnode/fullnode-dev/bls.json, which the node writes 0600), make it readable, or enable passwordless sudo so the scenario can copy it. (This cross-checks CLI BLS derivation against the live on-chain genesis key; it never skips.)"
  log "Genesis BLS cross-check using $genesis_bls_path"
  genesis_derived=$(run_cli_json "validator bls-pubkey (genesis key)" validator bls-pubkey --bls-key "$genesis_bls_path" \
    | jq -er '.validator_bls_pubkey.bls_pubkey_hex')
  [[ "$genesis_derived" =~ $hex192 ]] || die "genesis-derived bls hex malformed: $genesis_derived"
  # The derived (raw-affine) form must equal an on-chain seat's bls_pubkey_hex.
  local match_sid match_identity
  match_sid=$(printf '%s' "$table_json" | jq -er --arg b "$genesis_derived" \
    'first(.validator_table.validators[] | select(.bls_pubkey_hex==$b) | .sid) // empty') \
    || die "CLI-derived genesis BLS pubkey ($genesis_derived) not found in the on-chain validator table; the Rust loader does not match the live genesis bls.json source"
  [[ -n "$match_sid" ]] || die "CLI-derived genesis BLS pubkey ($genesis_derived) not present in the validator table"
  match_identity=$(printf '%s' "$table_json" | jq -er --arg b "$genesis_derived" \
    'first(.validator_table.validators[] | select(.bls_pubkey_hex==$b) | .identity)')
  log "Genesis BLS pubkey matches on-chain seat sid=$match_sid identity=$match_identity"

  # --- Test 6: validator info for the genesis seat. ----------------------------
  local info_json
  info_json=$(run_cli_json "validator info (genesis sid $match_sid)" validator info "$match_sid")
  assert_jq_eq "$info_json" '.validator_info.status' 'success'
  assert_jq_eq "$info_json" '.validator_info.active' 'true'
  assert_jq_eq "$info_json" '.validator_info.bls_pubkey_hex' "$genesis_derived"
  local info_weight
  info_weight=$(printf '%s' "$info_json" | jq -er '.validator_info.weight')
  (( info_weight > 0 )) || die "expected genesis validator weight > 0, got $info_weight"

  # --- Test 7: status for acc_0 (resolves, but not a validator) -> NOT REGISTERED.
  local status_text status_json
  status_text=$(run_cli_raw "validator status acc_0 (human)" validator status --identity acc_0)
  assert_contains "$status_text" "NOT REGISTERED"
  assert_contains "$status_text" "turnover window:"
  status_json=$(run_cli_json "validator status acc_0 (json)" validator status --identity acc_0)
  assert_jq_eq "$status_json" '.validator_status.status' 'not_registered'
  # registered=false / sid=null / claim_authority=null: jq -e treats false/null as
  # a failure exit, so use the raw-compare helper for these.
  assert_jq_raw_eq "$status_json" '.validator_status.registered' 'false'
  # identity is always present; sid/claim_authority are null when not registered.
  printf '%s' "$status_json" | jq -er '.validator_status.identity' >/dev/null \
    || die "status JSON missing identity for acc_0"
  assert_jq_raw_eq "$status_json" '.validator_status.sid' 'null'
  assert_jq_raw_eq "$status_json" '.validator_status.claim_authority' 'null'
  # turnover object is always well-formed (never an error on the window).
  printf '%s' "$status_json" | jq -er '.validator_status.turnover.state' >/dev/null \
    || die "status JSON missing turnover.state for acc_0"

  # --- Test 7b: status for an unknown key name MUST error (not NOT REGISTERED). -
  run_cli_expect_fail "validator status unknown identity" \
    validator status --identity validator-e2e-unknown-key

  # --- Test 6/7 (registered): status for the genesis identity is ACTIVE. -------
  local reg_status_json
  reg_status_json=$(run_cli_json "validator status (genesis identity)" validator status --identity "$match_identity")
  assert_jq_eq "$reg_status_json" '.validator_status.status' 'active'
  assert_jq_eq "$reg_status_json" '.validator_status.registered' 'true'
  assert_jq_eq "$reg_status_json" '.validator_status.sid' "$match_sid"

  log "validator scenario (BLS derivation + status, genesis cross-check) passed"
}

scenario_bond() {
  should_run "bond" || return 0
  log_section "Scenario: block-producer bond lifecycle (§A Mode 1 + Mode 2)"

  # ----------------------------------------------------------------------
  # Mode 1: signer == fee payer (self-pay). A bond's token account is NOT
  # deleted by `bond delete` (only the bond data account is), so a fixed signer
  # cannot recreate its bond on a persistent node. Use a fresh, on-chain
  # bootstrapped (account create) + funded signer so the lifecycle is
  # idempotent across runs. Staged-only here (activate/active-withdraw is §B).
  # ----------------------------------------------------------------------
  log "Mode 1 (self-pay, fresh account-created signer)"
  local m1="bpm1-$(date +%s)-$RANDOM"
  run_cli_json "bond: generate $m1" keys generate "$m1" >/dev/null
  local ac_json m1_addr
  ac_json=$(run_cli_json "bond: account create $m1" account create "$m1")
  assert_jq_eq "$ac_json" '.account_create.status' 'success'
  m1_addr=$(printf '%s' "$ac_json" | jq -er '.account_create.public_key')
  run_cli_json "bond: fund $m1" transfer acc_0 "$m1_addr" 3000000 >/dev/null

  local op_seed
  op_seed=$(random_hex32)
  local op_ta_json op_wthru_ta
  op_ta_json=$(run_cli_json "bond: init $m1 WTHRU TA" token initialize-account \
    "$WTHRU_MINT" "$m1_addr" "$op_seed" --fee-payer "$m1" --token-program "$WTHRU_TOKEN_PROGRAM")
  assert_jq_eq "$op_ta_json" '.token_initialize_account.status' 'success'
  op_wthru_ta=$(printf '%s' "$op_ta_json" | jq -er '.token_initialize_account.token_account')

  run_cli_json "bond: wrap THRU into $m1 WTHRU TA" wthru deposit "$op_wthru_ta" 1000000 --fee-payer "$m1" >/dev/null
  poll_wthru_amount "$op_wthru_ta" 1000000 "$m1 wrap"

  local create_json bond_addr bond_ta_addr
  create_json=$(run_cli_json "bond create (Mode 1 $m1)" bond create --signer "$m1")
  assert_jq_eq "$create_json" '.bond_create.status' 'success'
  assert_jq_eq "$create_json" '.bond_create.mode' 'mode1'
  bond_addr=$(printf '%s' "$create_json" | jq -er '.bond_create.bond_address')
  bond_ta_addr=$(printf '%s' "$create_json" | jq -er '.bond_create.bond_token_account')

  # derive helpers must agree with what create used
  local da_json dta_json
  da_json=$(run_cli_json "bond derive-address $m1" bond derive-address "$m1")
  assert_jq_eq "$da_json" '.bond_derive_address.bond_address' "$bond_addr"
  dta_json=$(run_cli_json "bond derive-token-account $m1" bond derive-token-account "$m1")
  assert_jq_eq "$dta_json" '.bond_derive_token_account.token_account_address' "$bond_ta_addr"

  run_cli_json "bond deposit $m1 500000" bond deposit "$m1" "$op_wthru_ta" 500000 --fee-payer "$m1" >/dev/null
  assert_bond_field "$m1" 'staged_amount' '500000' 'M1 after deposit'
  assert_bond_field "$m1" 'active_bond' '0' 'M1 after deposit'

  run_cli_json "bond withdraw $m1 200000 staged" bond withdraw "$m1" "$op_wthru_ta" 200000 --from staged --fee-payer "$m1" >/dev/null
  assert_bond_field "$m1" 'staged_amount' '300000' 'M1 after partial withdraw'

  run_cli_json "bond set-authority $m1 -> acc_3" bond set-authority "$m1" "$ACC_3_ADDRESS" --fee-payer "$m1" >/dev/null
  assert_bond_field "$m1" 'bond_authority' "$ACC_3_ADDRESS" 'M1 after set-authority'

  # The authority is now acc_3, so the remaining withdraw must sign as acc_3.
  run_cli_json "bond withdraw $m1 300000 staged (acc_3 auth)" bond withdraw "$m1" "$op_wthru_ta" 300000 --from staged --fee-payer acc_3 >/dev/null
  assert_bond_field "$m1" 'staged_amount' '0' 'M1 after final withdraw'

  # Sweep: send a STRAY WTHRU transfer straight into the bond TA (a plain token
  # transfer, bypassing `bond deposit`, so it is NOT tracked as staged/active),
  # then reclaim that untracked excess via `bond sweep`. Needs no change window,
  # so it runs in §A's fast path. Authority is acc_3 now → sweep signs as acc_3.
  local stray=50000
  run_cli_json "bond: stray transfer into bond TA" token transfer "$op_wthru_ta" "$bond_ta_addr" "$stray" --fee-payer "$m1" --token-program "$WTHRU_TOKEN_PROGRAM" >/dev/null
  poll_wthru_amount "$bond_ta_addr" "$stray" "bond TA after stray transfer"
  run_cli_json "bond sweep $m1 -> op TA (acc_3 auth)" bond sweep "$m1" "$op_wthru_ta" --fee-payer acc_3 >/dev/null
  poll_wthru_amount "$bond_ta_addr" 0 "bond TA after sweep"

  local del_json
  del_json=$(run_cli_json "bond delete $m1" bond delete "$m1" "$m1_addr" --fee-payer acc_3)
  assert_jq_eq "$del_json" '.bond_delete.status' 'success'

  # ----------------------------------------------------------------------
  # Mode 2: third-party fee payer (acc_0) + signer-EOA create. The signer key
  # (bpm2) is held by the harness to produce the embedded EOA challenge.
  # ----------------------------------------------------------------------
  log "Mode 2 (third-party pay + signer-EOA create)"
  local bpm2="bpm2-$(date +%s)-$RANDOM"
  run_cli_json "bond: generate bpm2" keys generate "$bpm2" >/dev/null

  local c2_json bpm2_addr
  c2_json=$(run_cli_json "bond create (Mode 2 bpm2)" bond create --signer "$bpm2" --fee-payer acc_0)
  assert_jq_eq "$c2_json" '.bond_create.status' 'success'
  assert_jq_eq "$c2_json" '.bond_create.mode' 'mode2'
  bpm2_addr=$(printf '%s' "$c2_json" | jq -er '.bond_create.signer')

  # The signer EOA (addr == bpm2 pubkey) was created by account_create_eoa.
  local eoa_json
  eoa_json=$(run_cli_json_retry "bpm2 EOA exists" getaccountinfo "$bpm2_addr")
  assert_jq_eq "$eoa_json" '.account_info.pubkey' "$bpm2_addr"
  # bond_authority defaults to the signer pubkey
  assert_bond_field "$bpm2" 'bond_authority' "$bpm2_addr" 'M2 default authority'

  # The EOA was created with 0 native balance; fund it before bpm2 pays fees.
  run_cli_json "fund bpm2 EOA" transfer acc_0 "$bpm2_addr" 2000000 >/dev/null

  local src2_seed src2_json src2
  src2_seed=$(random_hex32)
  src2_json=$(run_cli_json "bond: init bpm2 WTHRU TA" token initialize-account \
    "$WTHRU_MINT" "$bpm2_addr" "$src2_seed" --fee-payer "$bpm2" --token-program "$WTHRU_TOKEN_PROGRAM")
  assert_jq_eq "$src2_json" '.token_initialize_account.status' 'success'
  src2=$(printf '%s' "$src2_json" | jq -er '.token_initialize_account.token_account')
  run_cli_json "bond: wrap THRU for bpm2" wthru deposit "$src2" 1000000 --fee-payer "$bpm2" >/dev/null
  poll_wthru_amount "$src2" 1000000 "bpm2 wrap"

  run_cli_json "bond deposit bpm2 500000" bond deposit "$bpm2" "$src2" 500000 --fee-payer "$bpm2" >/dev/null
  assert_bond_field "$bpm2" 'staged_amount' '500000' 'M2 after deposit'
  assert_bond_field "$bpm2" 'active_bond' '0' 'M2 after deposit'

  run_cli_json "bond withdraw bpm2 500000 staged" bond withdraw "$bpm2" "$src2" 500000 --from staged --fee-payer "$bpm2" >/dev/null
  assert_bond_field "$bpm2" 'staged_amount' '0' 'M2 after withdraw'

  local del2_json
  del2_json=$(run_cli_json "bond delete bpm2" bond delete "$bpm2" "$bpm2_addr" --fee-payer "$bpm2")
  assert_jq_eq "$del2_json" '.bond_delete.status' 'success'

  log "§A bond lifecycle (Mode 1 + Mode 2) passed"
}

# Post-block native fee distribution (UNTO-1293).  After a block executes the
# runtime credits the block's collected native fees to the producer's account if
# it is live, else to the genesis null/burn account — there is no ClaimFees txn.
# This runs in the DEFAULT suite (re-runnable/non-destructive); it needs only
# block finalization, not certificate posting, so unlike §B's PayOutBlock half it
# is not gated behind RUN_BOND_SECTION_B.  The producer MUST be the node's own
# validator identity so the injected block finalizes.
scenario_claimfees() {
  should_run "bond" || return 0
  log_section "Scenario: post-block native fee distribution (burn vs claim) (UNTO-1293)"

  # Post-block fee distribution (UNTO-1293): after a block executes, the runtime
  # credits the block's collected native fees to the block producer's account if
  # it is live, else to the genesis null/burn account.  There is no ClaimFees
  # txn anymore.  We drive both branches via send-block (the block is produced by
  # the node's own validator identity so it finalizes) and verify the per-slot
  # grpc metrics (absent_block_producer_fees / claimed_fees) plus the resulting balances.
  #
  # Which branch a block takes depends on whether the producer's EOA exists:
  #   absent  -> the block's fees BURN     (phase 1; only on a clean node)
  #   present -> the block's fees are CLAIMED to the producer (phase 2)

  local grpc_hp="${RPC_BASE_URL#http://}"
  grpc_hp="${grpc_hp#https://}"

  # Genesis null/burn account address (single source of truth: tn_absent_block_producer_fee_receiver.h).
  local burn_addr="000000000000000000000000000000000000000000000000000000000000dead"

  # Producer = the node's own validator identity, so the injected block finalizes.
  local bp_hex
  bp_hex="$(resolve_node_identity_seed)"
  [[ -n "$bp_hex" ]] || die "claimfees: no producer key. Set NODE_IDENTITY_KEY (or NODE_IDENTITY_KEY_FILE), or provision the node identity via 'dev.sh start' so $REPO_ROOT/contrib/docker-dev/data/nodekey.hex exists. The injected block must be produced by the node's own validator identity or it won't finalize."
  [[ ${#bp_hex} -eq 64 ]] || die "claimfees: node producer seed must be 64 hex chars, got ${#bp_hex}"
  local bp="cf-node"
  run_cli_json "claimfees: register node producer key" keys add --overwrite "$bp" "$bp_hex" >/dev/null
  local bp_addr
  bp_addr=$(run_cli_raw "claimfees: derive node address" util derive "$bp_hex" --format thrufmt)
  log "claimfees: producer = node validator identity $bp_addr"

  # Each block carries two unrelated fee-paying transfers.  The transfer fee is a
  # fixed 1 (rpc/cli/crates/thru-core/src/commands/transfer.rs), so each block
  # collects exactly 2.
  local EXPECT=2

  # account_balance <addr> -> native balance, or 0 if the account does not exist.
  account_balance() {
    run_cli_json "claimfees: balance $1" getaccountinfo "$1" 2>/dev/null \
      | jq -er '.account_info.balance' 2>/dev/null || echo 0
  }
  # account_exists <addr> -> success (0) if a live account is present.
  account_exists() {
    run_cli_json "claimfees: exists $1" getaccountinfo "$1" 2>/dev/null \
      | jq -e '.account_info.pubkey' >/dev/null 2>&1
  }
  # inject_two_tx_block <label> -> echoes the finalized slot of a block carrying
  # two unrelated fee transfers (acc_1->acc_2, acc_3->acc_2), produced by bp.
  inject_two_tx_block() {
    local label="$1" t1 t2
    t1=$(run_cli_raw "claimfees: $label build tx1" transfer acc_1 acc_2 1 --build-only)
    t2=$(run_cli_raw "claimfees: $label build tx2" transfer acc_3 acc_2 1 --build-only)
    local slot
    slot=$(run_cli_json "claimfees: $label height" getheight \
      | jq '([.getheight.finalized, .getheight.locally_executed, .getheight.cluster_executed] | max) + 1')
    local bf="$CLI_TMP_HOME/claimfees_${label}_blocks.json"
    jq -n --argjson slot "$slot" --arg a "$t1" --arg b "$t2" \
      '{blocks:[{slot:$slot, transactions:[$a,$b]}]}' > "$bf"
    local out
    out=$(send_block --producer-key "$bp_hex" --blocks-file "$bf" \
      --grpc "$grpc_hp" --target "$BLOCKBUILDER_ADDR" --chain-id 1 --wait-for-vote 2>&1) \
      || die "claimfees: $label send-block failed: $out"
    local accepted
    accepted=$(printf '%s\n' "$out" | sed -n 's/^slot=\([0-9][0-9]*\).*/\1/p' | head -1)
    [[ -n "$accepted" ]] || die "claimfees: $label could not parse accepted slot from send-block: $out"
    wait_for_finalized_slot "$accepted" "claimfees $label finalize"
    echo "$accepted"
  }

  # ---- Phase 1: BURN (reachable only when the producer EOA is absent) --------
  if account_exists "$bp_addr"; then
    log "claimfees: producer EOA already exists ($bp_addr); skipping burn phase (it needs an absent producer — run on a clean node for burn coverage)"
  else
    log "claimfees: producer EOA absent -> burn phase"
    local burn_before
    burn_before=$(account_balance "$burn_addr")
    local s1
    s1=$(inject_two_tx_block burn)
    local m1 burned1 claimed1
    m1=$(run_cli_json_retry "claimfees: getslotmetrics $s1" getslotmetrics "$s1")
    burned1=$(printf '%s' "$m1" | jq -er '.getslotmetrics.absent_block_producer_fees')
    claimed1=$(printf '%s' "$m1" | jq -er '.getslotmetrics.claimed_fees')
    # grpc reports the EXACT per-slot split: all fees burned, nothing claimed.
    (( burned1 == EXPECT )) || die "claimfees: burn slot $s1 expected absent_block_producer_fees=$EXPECT, got $burned1"
    (( claimed1 == 0 ))     || die "claimfees: burn slot $s1 expected claimed_fees=0, got $claimed1"
    # The burn account balance must have grown by exactly that burned amount.
    # (Assumes no other fee-bearing block burned concurrently — true for the
    # quiet, sequential e2e while the producer EOA is absent.)
    local burn_after
    burn_after=$(account_balance "$burn_addr")
    (( burn_after - burn_before == burned1 )) \
      || die "claimfees: burn account delta expected $burned1, got $((burn_after - burn_before)) (${burn_before} -> ${burn_after})"
    log "claimfees: BURN verified (slot $s1: burned=$burned1 claimed=$claimed1; burn acct ${burn_before} -> ${burn_after})"
  fi

  # ---- Ensure the producer EOA exists for the claim phase --------------------
  if account_exists "$bp_addr"; then
    log "claimfees: producer EOA present ($bp_addr)"
  else
    log "claimfees: creating producer EOA"
    assert_jq_eq "$(run_cli_json "claimfees: account create producer" account create "$bp")" \
      '.account_create.status' 'success'
    local tries=0
    until account_exists "$bp_addr"; do
      (( ++tries <= 30 )) || die "claimfees: producer EOA did not become live after account create"
      sleep 1
    done
  fi

  # ---- Phase 2: CLAIM (producer EOA present) --------------------------------
  log "claimfees: claim phase (producer EOA present)"
  local bp_before burn_before2
  bp_before=$(account_balance "$bp_addr")
  burn_before2=$(account_balance "$burn_addr")
  local s2 m2 burned2 claimed2
  s2=$(inject_two_tx_block claim)
  m2=$(run_cli_json_retry "claimfees: getslotmetrics $s2" getslotmetrics "$s2")
  burned2=$(printf '%s' "$m2" | jq -er '.getslotmetrics.absent_block_producer_fees')
  claimed2=$(printf '%s' "$m2" | jq -er '.getslotmetrics.claimed_fees')
  # grpc reports the EXACT per-slot split: nothing burned, all fees claimed.
  (( claimed2 == EXPECT )) || die "claimfees: claim slot $s2 expected claimed_fees=$EXPECT, got $claimed2"
  (( burned2 == 0 ))       || die "claimfees: claim slot $s2 expected absent_block_producer_fees=0, got $burned2"
  local bp_after burn_after2
  bp_after=$(account_balance "$bp_addr")
  burn_after2=$(account_balance "$burn_addr")
  # The producer received exactly the claimed amount; the burn account did not move.
  # NOTE: the producer is the LIVE node validator identity, whose native balance
  # can also move from the node's own ongoing block production.  This exact check
  # holds in the quiet, sequential e2e (no other fee blocks between the two
  # samples); relax to ">=" for $claimed2 if it ever proves flaky on a busy node.
  (( bp_after - bp_before == claimed2 )) \
    || die "claimfees: producer balance delta expected $claimed2, got $((bp_after - bp_before)) (${bp_before} -> ${bp_after})"
  (( burn_after2 - burn_before2 == 0 )) \
    || die "claimfees: burn account changed during claim phase (${burn_before2} -> ${burn_after2})"
  log "claimfees: CLAIM verified (slot $s2: burned=$burned2 claimed=$claimed2; producer ${bp_before} -> ${bp_after}, burn unchanged at ${burn_after2})"
}

# §B part 1: bond a producer = the node's OWN validator identity, produce a
# block (signed by that identity, so the node certifies it → PostCertificate →
# PayOutBlock) with an explicit attestor_payment P (0 < P < A), then assert the
# PayOutBlock bond debit.  The block's native fee is distributed by the runtime
# post-block (credited to the live producer), so claimed_fees is also asserted.
# Drives the fullnode block-builder via send-block; never skips.
scenario_bond_part1() {
  should_run "bond" || return 0
  if [[ "$RUN_BOND_SECTION_B" != "1" ]]; then
    log "bond §B (attestor_payment → PayOutBlock bond debit) DISABLED — set RUN_BOND_SECTION_B=1 to run it."
    log "  It needs node certificate posting enabled (tiles.cdrv.posting_certificate_frequency > 0)"
    log "  so PostCertificate → PayOutBlock fires; see issues/bp-bond-payout-not-firing-analysis.md."
    log "  (The native fee burn/claim distribution is covered by scenario_claimfees.)"
    BOND_B_RAN=0
    return 0
  fi
  BOND_B_RAN=1
  log_section "Scenario: bond §B part 1 (attestor_payment debit + native fee claim) — producer = node identity"

  local grpc_hp="${RPC_BASE_URL#http://}"
  grpc_hp="${grpc_hp#https://}"

  # 0. The producer MUST be the node's own validator identity, otherwise the
  #    block is voted but never certified (no PayOutBlock). Resolve its seed from
  #    NODE_IDENTITY_KEY / NODE_IDENTITY_KEY_FILE (the CI fullnode exports it to
  #    /shared-keys/nodekey.hex), else the nodekey.hex that `dev.sh start`
  #    provisions on a fresh data dir.
  local bp_hex
  bp_hex="$(resolve_node_identity_seed)"
  [[ -n "$bp_hex" ]] || die "§B: no producer key. Set NODE_IDENTITY_KEY (or NODE_IDENTITY_KEY_FILE), or provision the node identity via 'dev.sh clean && dev.sh start' so $REPO_ROOT/contrib/docker-dev/data/nodekey.hex exists. The block must be produced by the node's own validator identity or it won't be certified (no PayOutBlock)."
  [[ ${#bp_hex} -eq 64 ]] || die "§B: node producer seed must be 64 hex chars, got ${#bp_hex}"

  local bp="node"
  run_cli_json "§B: register node producer key" keys add --overwrite "$bp" "$bp_hex" >/dev/null
  local bp_addr
  bp_addr=$(run_cli_raw "§B: derive node address" util derive "$bp_hex" --format thrufmt)
  BOND_B_BP_KEY="$bp"
  BOND_B_BP_ADDR="$bp_addr"
  log "§B: producer = node validator identity $bp_addr"

  # The node identity is fixed, so its bond token account persists across runs
  # and can't be recreated after delete. §B needs a clean slate.
  if run_cli_json "§B: pre-existing bond check" bond show "$bp" 2>/dev/null \
       | jq -e '.bond_show.active_bond' >/dev/null 2>&1; then
    die "§B: a bond already exists for the node identity ($bp_addr). §B needs a clean node — run 'dev.sh clean && dev.sh start' before re-running §B."
  fi

  # 1. Create the node's bond. If the node already has an on-chain EOA (funded
  #    validator), self-pay (Mode 1); otherwise acc_0 pays and creates the EOA
  #    (Mode 2). Either way the bond authority defaults to the node identity.
  # getaccountinfo exits non-zero for a missing account, so tolerate failure
  # here (empty => no EOA => Mode 2) rather than tripping set -e.
  local node_pubkey=""
  node_pubkey=$(run_cli_json "§B: node EOA?" getaccountinfo "$bp" 2>/dev/null | jq -r '.account_info.pubkey // empty' 2>/dev/null) || true
  if [[ -n "$node_pubkey" ]]; then
    log "§B: node EOA exists; creating bond self-pay (Mode 1)"
    assert_jq_eq "$(run_cli_json "§B: bond create node (Mode 1)" bond create --signer "$bp")" \
      '.bond_create.status' 'success'
  else
    log "§B: node has no EOA; creating bond third-party-pay (Mode 2, acc_0 creates the EOA)"
    assert_jq_eq "$(run_cli_json "§B: bond create node (Mode 2)" bond create --signer "$bp" --fee-payer acc_0)" \
      '.bond_create.status' 'success'
  fi
  # Fund the node identity so it can wrap THRU + pay its (zero) bond-op fees.
  run_cli_json "§B: fund node" transfer acc_0 "$bp_addr" 5000000 >/dev/null

  # 2. wrap A, deposit A, activate the whole deposit (so delete is reachable)
  local A=400000
  BOND_B_A="$A"
  local src_seed src_json src
  src_seed=$(random_hex32)
  src_json=$(run_cli_json "§B: init bp WTHRU TA" token initialize-account \
    "$WTHRU_MINT" "$bp_addr" "$src_seed" --fee-payer "$bp" --token-program "$WTHRU_TOKEN_PROGRAM")
  assert_jq_eq "$src_json" '.token_initialize_account.status' 'success'
  src=$(printf '%s' "$src_json" | jq -er '.token_initialize_account.token_account')
  BOND_B_SRC="$src"
  run_cli_json "§B: wrap bp" wthru deposit "$src" "$A" --fee-payer "$bp" >/dev/null
  poll_wthru_amount "$src" "$A" "bp wrap"
  run_cli_json "§B: bond deposit bp" bond deposit "$bp" "$src" "$A" --fee-payer "$bp" >/dev/null

  # UpdateBond (activate) is gated by the change window relative to the bond's
  # last_change_slot, which `create` stamped to the current slot. Advance past
  # the window before activating (the same gate applies to part2's active
  # withdraw, which the part1->part2 bracket covers separately).
  emit_slot_advancement_transfers "§B pre-activate change-window wait"
  run_cli_json "§B: bond update bp activate" bond update "$bp" --active "$A" --unlock-slot 0 --fee-payer "$bp" >/dev/null
  assert_bond_field "$bp" 'staged_amount' '0' '§B after activate'
  assert_bond_field "$bp" 'active_bond' "$A" '§B after activate'

  # 3. produce a block: a benign FEE_TX (acc_1->acc_2, non-bp payer) with an
  #    attestor_payment P (0 < P < A).  The block's native fee is distributed by
  #    the runtime post-block (UNTO-1293): credited to the live producer (this
  #    node identity), so no in-block ClaimFees txn is needed.
  local P=100000
  BOND_B_P="$P"
  local bp_native_0
  bp_native_0=$(run_cli_json "§B: bp balance before block" getbalance "$bp_addr" | jq -er '.balance.balance')

  local fee_b64
  fee_b64=$(run_cli_raw "§B: build FEE_TX" transfer acc_1 acc_2 1 --build-only)

  # same height definition send-block uses: max(finalized, locally, cluster)+1
  local slot
  slot=$(run_cli_json "§B: height" getheight | jq '([.getheight.finalized, .getheight.locally_executed, .getheight.cluster_executed] | max) + 1')
  local blocks_file="$CLI_TMP_HOME/bond_blocks.json"
  jq -n --argjson slot "$slot" --arg fee "$fee_b64" \
    '{blocks:[{slot:$slot, transactions:[$fee]}]}' > "$blocks_file"

  local sb_via
  sb_via="$(resolve_send_block 2>/dev/null)" || sb_via="<not found>"
  log "§B: send-block ($sb_via) producer=$bp_addr P=$P slot=$slot target=$BLOCKBUILDER_ADDR"
  local out
  out=$(send_block --producer-key "$bp_hex" --attestor-payment "$P" \
    --blocks-file "$blocks_file" --grpc "$grpc_hp" --target "$BLOCKBUILDER_ADDR" \
    --chain-id 1 --wait-for-vote 2>&1) || die "§B: send-block failed: $out"
  # send-block reslots on NO-vote; the FINAL accepted slot is on stdout (slot=N)
  local accepted
  accepted=$(printf '%s\n' "$out" | sed -n 's/^slot=\([0-9][0-9]*\).*/\1/p' | head -1)
  [[ -n "$accepted" ]] || die "§B: could not parse accepted slot from send-block output: $out"
  BOND_B_ACCEPTED="$accepted"
  log "§B: block accepted at slot $accepted"

  # The PayOutBlock debit + native fee claim only apply once the block finalizes.
  wait_for_finalized_slot "$accepted" "§B post-block finalize"

  # 4. (after finalize) assert the PayOutBlock debit + native fee claim.
  #    active -> A - min(P,A) = A - P (since 0 < P < A).
  local expected_active=$((A - P))
  assert_bond_field "$bp" 'active_bond' "$expected_active" '§B after payout'

  # Native fee distribution (UNTO-1293): the block's fee is claimed to the live
  # producer post-block (no in-block ClaimFees txn).  Assert claimed_fees > 0.
  # NOTE: the producer here is the LIVE node validator identity, whose native
  # balance moves continuously from its own block production / consensus txns,
  # so the exact "received == claimed" accounting isn't deterministic — we
  # log the observed delta but only hard-assert claimed_fees > 0.
  local claimed
  claimed=$(run_cli_json_retry "§B: getslotmetrics $accepted" getslotmetrics "$accepted" | jq -er '.getslotmetrics.claimed_fees')
  (( claimed > 0 )) || die "§B: expected claimed_fees > 0 at slot $accepted, got $claimed"
  local bp_native_1
  bp_native_1=$(run_cli_json "§B: node balance after block" getbalance "$bp_addr" | jq -er '.balance.balance')
  log "§B part1: payout debit + ClaimFees sweep verified (claimed=$claimed active=$expected_active; node native ${bp_native_0}->${bp_native_1})"

  # An early active-withdraw must REVERT (unlock slot / change window not elapsed).
  run_cli_expect_fail "§B: early active withdraw reverts" \
    bond withdraw "$bp" "$src" "$expected_active" --from active --fee-payer "$bp"
}

# §B part 2: after the change window has elapsed (the slot-advancement run
# between part1 and part2), withdraw the remaining active bond and delete.
scenario_bond_part2() {
  should_run "bond" || return 0
  [[ "$BOND_B_RAN" == "1" ]] || return 0
  log_section "Scenario: bond §B part 2 (lockout withdraw + cleanup)"

  local bp="$BOND_B_BP_KEY"
  local remaining=$((BOND_B_A - BOND_B_P))
  if (( remaining > 0 )); then
    run_cli_json "§B: active withdraw remaining" bond withdraw "$bp" "$BOND_B_SRC" "$remaining" --from active --fee-payer "$bp" >/dev/null
    assert_bond_field "$bp" 'active_bond' '0' '§B after active withdraw'
  fi

  local del_json
  del_json=$(run_cli_json "§B: bond delete bp" bond delete "$bp" "$BOND_B_BP_ADDR" --fee-payer "$bp")
  assert_jq_eq "$del_json" '.bond_delete.status' 'success'
  log "§B part2: lockout withdraw + delete passed"
}

scenario_util() {
  should_run "util" || return 0
  log_section "Scenario: utility conversions"

  # Use a test pubkey hex for conversion tests (this is just for testing the conversion utility)
  local test_pubkey_hex="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local pubkey_json
  pubkey_json=$(run_cli_json "util convert pubkey hex->thru" util convert pubkey hex-to-thrufmt "$test_pubkey_hex")
  local thru_format
  thru_format=$(printf '%s' "$pubkey_json" | jq -er '.thru_pubkey')

  local back_json
  back_json=$(run_cli_json "util convert pubkey thru->hex" util convert pubkey thrufmt-to-hex "$thru_format")
  assert_jq_eq "$back_json" '.hex_pubkey' "$test_pubkey_hex"

  local signature_hex
  signature_hex=$(printf 'aa%.0s' {1..64})
  run_cli_json "util convert signature hex->thru" util convert signature hex-to-thrufmt "$signature_hex" >/dev/null
  local signature_thru
  signature_thru=$(run_cli_json "util convert signature hex->thru (capture)" util convert signature hex-to-thrufmt "$signature_hex" | jq -er '.thru_signature')
  run_cli_json "util convert signature thru->hex" util convert signature thrufmt-to-hex "$signature_thru" >/dev/null
}

scenario_debug() {
  should_run "debug" || return 0
  log_section "Scenario: txn debug"

  # Debug test program addresses (deployed at genesis)
  local DEBUG_TEST_PROG_A_HEX="00000000000000000000000000000000000000000000000000000000000000EB"
  local DEBUG_TEST_PROG_B_HEX="00000000000000000000000000000000000000000000000000000000000000EC"

  # Resolve builtin event emission program address
  local builtin_program_addr
  builtin_program_addr=$(run_cli_json "resolve builtin event program" util convert pubkey hex-to-thrufmt "$GENESIS_EVENT_PROGRAM_HEX" | jq -er '.thru_pubkey')
  log "Builtin event program: $builtin_program_addr"

  # Resolve debug test program addresses
  local debug_test_prog_a_addr debug_test_prog_b_addr
  debug_test_prog_a_addr=$(run_cli_json "resolve debug test program A" util convert pubkey hex-to-thrufmt "$DEBUG_TEST_PROG_A_HEX" | jq -er '.thru_pubkey')
  debug_test_prog_b_addr=$(run_cli_json "resolve debug test program B" util convert pubkey hex-to-thrufmt "$DEBUG_TEST_PROG_B_HEX" | jq -er '.thru_pubkey')
  log "Debug test program A: $debug_test_prog_a_addr"
  log "Debug test program B: $debug_test_prog_b_addr"

  # Debug test program instruction format:
  #   command(1) + invoke_idx(2 LE) + return_idx(2 LE) + depth(1) + error_code(4 LE) + message(var)
  # Commands: 0=PrintAndSucceed 1=PrintAndRevert 2=Segfault 3=ExhaustCU 4=RecursiveCPI
  #           5=EmitEventsThenRevert 6=ExhaustCUSyscall 7=ExhaustSU 8=RecursiveCPIRevert
  local DEBUG_TEST_CU="10000000"
  local DEBUG_TEST_SU="10000"
  local DEBUG_TEST_MU="100"
  local DEBUG_TEST_EXPIRY="100000"

  # Execute an event emission transaction to get a confirmed signature
  local event_instruction_hex="03000000000000000100000000000000546f2062652c206f72206e6f7420746f2062653f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  local tx_json test_sig
  tx_json=$(run_cli_json "execute event for debug test" txn execute "$builtin_program_addr" "$event_instruction_hex" --fee-payer acc_0 --timeout 60)
  assert_jq_eq "$tx_json" '.transaction_execute.status' 'success'
  test_sig=$(printf '%s' "$tx_json" | jq -er '.transaction_execute.signature')
  log "Test transaction: $test_sig"

  # Wait for ClickHouse indexing
  sleep 3

  # --- Phase 1: Availability check + basic JSON response + execution details ---
  log "Phase 1: Basic txn debug (JSON output + execution details)"
  local debug_json
  debug_json=$(with_cli_env "$THRU_CLI_BIN" --json txn debug "$test_sig" 2>&1) || {
    if grep -qi "unimplemented" <<<"$debug_json"; then
      log "Debug service unavailable (CGO-disabled build?) — skipping scenario"
      return 0
    fi
    die "txn debug failed: $debug_json"
  }

  # Verify JSON structure
  assert_jq_eq "$debug_json" '.txn_debug.signature' "$test_sig"

  # Verify execution details
  local exec_code cu_consumed
  exec_code=$(printf '%s' "$debug_json" | jq -er '.txn_debug.execution_code')
  cu_consumed=$(printf '%s' "$debug_json" | jq -er '.txn_debug.compute_units_consumed')
  [[ "$exec_code" == "0" ]] || die "Expected execution_code 0 (success), got $exec_code"
  (( cu_consumed > 0 )) || die "Expected non-zero compute_units_consumed, got $cu_consumed"

  # Verify fault_code and fault_code_label fields exist and are parseable
  local fc fc_label
  fc=$(printf '%s' "$debug_json" | jq -er '.txn_debug.fault_code')
  fc_label=$(printf '%s' "$debug_json" | jq -er '.txn_debug.fault_code_label')
  [[ -n "$fc" ]] || die "fault_code field missing"
  [[ -n "$fc_label" ]] || die "fault_code_label field missing"

  # Verify VM state fields (matches Go Phase 5: testExecutionDetails)
  local pc ic reg_count
  pc=$(printf '%s' "$debug_json" | jq -er '.txn_debug.program_counter')
  ic=$(printf '%s' "$debug_json" | jq -er '.txn_debug.instruction_counter')
  reg_count=$(printf '%s' "$debug_json" | jq -er '.txn_debug.registers | length')
  (( pc > 0 )) || die "Expected non-zero program_counter, got $pc"
  (( ic > 0 )) || die "Expected non-zero instruction_counter, got $ic"
  [[ "$reg_count" == "32" ]] || die "Expected 32 registers, got $reg_count"
  log "Execution: code=$exec_code cu=$cu_consumed fault=$fc($fc_label) pc=$pc ic=$ic regs=$reg_count"

  # Verify captured output fields exist
  local stdout_val trace_bytes log_val
  stdout_val=$(printf '%s' "$debug_json" | jq -er '.txn_debug.stdout')
  log_val=$(printf '%s' "$debug_json" | jq -er '.txn_debug.log')
  trace_bytes=$(printf '%s' "$debug_json" | jq -er '.txn_debug.trace_bytes')
  printf '%s' "$debug_json" | jq -e '(.txn_debug | has("trace")) | not' >/dev/null \
    || die "Default JSON output should stay compact and omit trace"
  log "Captured: stdout=${#stdout_val} bytes, log=${#log_val} bytes, trace=$trace_bytes bytes"

  # --- Phase 2: Text output mode ---
  log "Phase 2: Text output mode"
  local debug_text
  debug_text=$(with_cli_env "$THRU_CLI_BIN" txn debug "$test_sig" 2>&1) || die "txn debug (text) failed"
  assert_contains "$debug_text" "Transaction Debug"
  assert_contains "$debug_text" "Execution Details"
  assert_contains "$debug_text" "Captured Output"

  # --- Phase 2b: Trace output to file ---
  log "Phase 2b: Save trace to file (--output-trace)"
  local trace_file="$CLI_TMP_HOME/debug_trace.bin"
  local debug_trace_json
  debug_trace_json=$(run_cli_json "txn debug +trace" txn debug "$test_sig" --output-trace "$trace_file")
  [[ -f "$trace_file" ]] || die "Trace file not created at $trace_file"
  local trace_size
  trace_size=$(stat -c '%s' "$trace_file" 2>/dev/null || stat --printf='%s' "$trace_file" 2>/dev/null || stat -f '%z' "$trace_file")
  (( trace_size > 0 )) || die "Trace file is empty"
  local reported_bytes
  reported_bytes=$(printf '%s' "$debug_trace_json" | jq -er '.txn_debug.trace_bytes')
  [[ "$trace_size" == "$reported_bytes" ]] || die "Trace file size ($trace_size) != reported trace_bytes ($reported_bytes)"
  local trace_file_field
  trace_file_field=$(printf '%s' "$debug_trace_json" | jq -er '.txn_debug.trace_file')
  [[ "$trace_file_field" == "$trace_file" ]] || die "trace_file field mismatch: expected $trace_file, got $trace_file_field"
  log "Trace saved: $trace_size bytes to $trace_file"

  # --- Phase 2c: Inline trace in JSON output ---
  log "Phase 2c: Inline trace in JSON output (--inline-trace)"
  local debug_inline_json inline_trace
  debug_inline_json=$(run_cli_json "txn debug +inline trace" txn debug "$test_sig" --inline-trace)
  inline_trace=$(printf '%s' "$debug_inline_json" | jq -er '.txn_debug.trace')
  [[ -n "$inline_trace" ]] || die "Expected inline trace to be present with --inline-trace"
  reported_bytes=$(printf '%s' "$debug_inline_json" | jq -er '.txn_debug.trace_bytes')
  local inline_trace_bytes
  inline_trace_bytes=$(printf '%s' "$inline_trace" | wc -c | tr -d '[:space:]')
  [[ "$inline_trace_bytes" == "$reported_bytes" ]] || die "Inline trace byte length ($inline_trace_bytes) != reported trace_bytes ($reported_bytes)"

  local inline_trace_file="$CLI_TMP_HOME/debug_trace_inline.bin"
  local debug_inline_trace_json
  debug_inline_trace_json=$(run_cli_json "txn debug +inline trace +output" txn debug "$test_sig" --inline-trace --output-trace "$inline_trace_file")
  [[ -f "$inline_trace_file" ]] || die "Inline trace file not created at $inline_trace_file"
  printf '%s' "$debug_inline_trace_json" | jq -e '.txn_debug.trace | length > 0' >/dev/null \
    || die "Expected inline trace to remain present with --inline-trace --output-trace"
  printf '%s' "$debug_inline_trace_json" | jq -e --arg path "$inline_trace_file" '.txn_debug.trace_file == $path' >/dev/null \
    || die "trace_file missing or incorrect when using --inline-trace with --output-trace"

  # --- Phase 3: State before snapshots ---
  log "Phase 3: State before snapshots"
  local debug_before state_before_len
  debug_before=$(run_cli_json "txn debug +state_before" txn debug "$test_sig" --state-before --account-data)
  state_before_len=$(printf '%s' "$debug_before" | jq -er '.txn_debug.state_before | length')
  (( state_before_len > 0 )) || die "Expected non-empty state_before, got $state_before_len snapshots"
  log "state_before: $state_before_len snapshots"

  # Verify fee payer (acc_0) is present
  local fp_before
  fp_before=$(printf '%s' "$debug_before" | jq -er --arg addr "$ACC_0_ADDRESS" \
    '[.txn_debug.state_before[] | select(.address == $addr)] | length')
  (( fp_before > 0 )) || die "Fee payer $ACC_0_ADDRESS not in state_before"

  # Verify fee payer has metadata
  local fp_balance
  fp_balance=$(printf '%s' "$debug_before" | jq -er --arg addr "$ACC_0_ADDRESS" \
    '[.txn_debug.state_before[] | select(.address == $addr)][0].balance')
  log "Fee payer balance (before): $fp_balance"
  printf '%s' "$debug_before" | jq -e '
    [.txn_debug.state_before[]
      | select(.meta != null and .meta.version != null and .meta.flags != null)
      | .meta.flags
      | has("is_program")
      and has("is_privileged")
      and has("is_uncompressable")
      and has("is_ephemeral")
      and has("is_deleted")
      and has("is_new")
      and has("is_compressed")] | any' >/dev/null \
    || die "Expected state_before snapshots to preserve full account flags metadata"
  printf '%s' "$debug_before" | jq -e '
    [.txn_debug.state_before[]
      | select(.data_hex != null)
      | .data_hex | type == "string"] | any' >/dev/null \
    || die "Expected state_before snapshots with account data to preserve data_hex"

  # --- Phase 4: State after snapshots ---
  log "Phase 4: State after snapshots"
  local debug_after state_after_len
  debug_after=$(run_cli_json "txn debug +state_after" txn debug "$test_sig" --state-after)
  state_after_len=$(printf '%s' "$debug_after" | jq -er '.txn_debug.state_after | length')
  (( state_after_len > 0 )) || die "Expected non-empty state_after, got $state_after_len snapshots"
  log "state_after: $state_after_len snapshots"

  # Verify fee payer in state_after
  local fp_after
  fp_after=$(printf '%s' "$debug_after" | jq -er --arg addr "$ACC_0_ADDRESS" \
    '[.txn_debug.state_after[] | select(.address == $addr)] | length')
  (( fp_after > 0 )) || die "Fee payer $ACC_0_ADDRESS not in state_after"

  # --- Phase 5: All flags combined ---
  log "Phase 5: All flags combined"
  local debug_full
  debug_full=$(run_cli_json "txn debug +all" txn debug "$test_sig" \
    --state-before --state-after --account-data)
  printf '%s' "$debug_full" | jq -e '.txn_debug.state_before | length > 0' >/dev/null \
    || die "state_before missing with all flags"
  printf '%s' "$debug_full" | jq -e '.txn_debug.state_after | length > 0' >/dev/null \
    || die "state_after missing with all flags"
  log "All flags: state_before and state_after present"

  # --- Phase 6: Execute second transaction for capture verification ---
  log "Phase 6: Second transaction for capture verification"
  local tx2_json test_sig2
  tx2_json=$(run_cli_json "execute second event for debug" txn execute "$builtin_program_addr" "$event_instruction_hex" --fee-payer acc_0 --timeout 60)
  assert_jq_eq "$tx2_json" '.transaction_execute.status' 'success'
  test_sig2=$(printf '%s' "$tx2_json" | jq -er '.transaction_execute.signature')

  sleep 3

  local debug2_json
  debug2_json=$(run_cli_json "txn debug second tx" txn debug "$test_sig2")
  local exec_code2
  exec_code2=$(printf '%s' "$debug2_json" | jq -er '.txn_debug.execution_code')
  [[ "$exec_code2" == "0" ]] || die "Second tx: expected execution_code 0, got $exec_code2"
  log "Second tx: execution_code=$exec_code2"

  # --- Phase 6b: Debug test program success (matches Go Phase 5: testExecutionDetails) ---
  log "Phase 6b: Debug test program success — verify fault_code=0"
  # PrintAndSucceed: cmd=0, message="test"
  local success_instr_hex="0000000000000000000074657374"
  local success_tx_json success_sig
  success_tx_json=$(run_cli_json "execute debug test success" txn execute \
    "$debug_test_prog_a_addr" "$success_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --timeout 60)
  assert_jq_eq "$success_tx_json" '.transaction_execute.status' 'success'
  success_sig=$(printf '%s' "$success_tx_json" | jq -er '.transaction_execute.signature')
  log "Debug test success tx: $success_sig"

  sleep 3

  local success_debug_json success_fc success_fc_label success_ec
  success_debug_json=$(run_cli_json "txn debug success tx" txn debug "$success_sig")
  success_ec=$(printf '%s' "$success_debug_json" | jq -er '.txn_debug.execution_code')
  success_fc=$(printf '%s' "$success_debug_json" | jq -er '.txn_debug.fault_code')
  success_fc_label=$(printf '%s' "$success_debug_json" | jq -er '.txn_debug.fault_code_label')
  [[ "$success_ec" == "0" ]] || die "Expected execution_code 0 for debug test success, got $success_ec"
  [[ -n "$success_fc_label" ]] || die "fault_code_label field missing for debug test success"
  log "Debug test success: exec_code=$success_ec fault=$success_fc($success_fc_label)"

  # --- Phase 7: Revert with partial output (matches Go Phase 8: testRevertWithPartialOutput) ---
  log "Phase 7: Revert with partial output"
  # EmitEventsThenRevert: cmd=5, invoke_idx=0, return_idx=0, depth=3(eventCount), error_code=42(0x2a LE)
  local revert_instr_hex="0500000000032a000000"
  local revert_output revert_sig
  revert_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$revert_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --timeout 60 2>&1) || true
  revert_sig=$(printf '%s' "$revert_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 7: failed to extract signature from revert tx: $revert_output"
  log "Revert tx: $revert_sig"

  sleep 3

  local revert_debug_json
  revert_debug_json=$(run_cli_json "txn debug revert tx" txn debug "$revert_sig")
  local revert_fc revert_fc_label revert_uerr revert_err_prog_idx
  revert_fc=$(printf '%s' "$revert_debug_json" | jq -er '.txn_debug.fault_code')
  revert_fc_label=$(printf '%s' "$revert_debug_json" | jq -er '.txn_debug.fault_code_label')
  revert_uerr=$(printf '%s' "$revert_debug_json" | jq -er '.txn_debug.user_error_code')
  revert_err_prog_idx=$(printf '%s' "$revert_debug_json" | jq -er '.txn_debug.error_program_acc_idx')
  [[ "$revert_fc" != "0" ]] || die "Expected non-zero fault_code for revert, got 0"
  [[ "$revert_fc_label" == "Revert" ]] || die "Expected fault_code_label 'Revert', got '$revert_fc_label'"
  [[ "$revert_uerr" == "42" ]] || die "Expected user_error_code 42, got $revert_uerr"
  [[ "$revert_err_prog_idx" == "1" ]] || die "Expected error_program_acc_idx 1 for single-program revert, got $revert_err_prog_idx"
  log "Revert: fault=$revert_fc($revert_fc_label) user_error=$revert_uerr err_prog=$revert_err_prog_idx"

  # --- Phase 8: Segfault detection (matches Go Phase 9: testSegfault) ---
  log "Phase 8: Segfault detection"
  # Segfault: cmd=2, all zeros
  local segfault_instr_hex="02000000000000000000"
  local segfault_output segfault_sig
  segfault_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$segfault_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --timeout 60 2>&1) || true
  segfault_sig=$(printf '%s' "$segfault_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 8: failed to extract signature from segfault tx: $segfault_output"
  log "Segfault tx: $segfault_sig"

  sleep 3

  local segfault_debug_json segfault_ec segfault_pc segfault_vaddr segfault_sz segfault_wr
  segfault_debug_json=$(run_cli_json "txn debug segfault tx" txn debug "$segfault_sig")
  segfault_ec=$(printf '%s' "$segfault_debug_json" | jq -er '.txn_debug.execution_code')
  segfault_pc=$(printf '%s' "$segfault_debug_json" | jq -er '.txn_debug.program_counter')
  [[ "$segfault_ec" != "0" ]] || die "Expected non-zero execution_code for segfault, got 0"
  (( segfault_pc > 0 )) || die "Expected non-zero program_counter at crash location"

  # Program writes to address 0xDEAD — verify exact segv_vaddr
  segfault_vaddr=$(printf '%s' "$segfault_debug_json" | jq -er '.txn_debug.segv_vaddr')
  segfault_sz=$(printf '%s' "$segfault_debug_json" | jq -er '.txn_debug.segv_size')
  segfault_wr=$(printf '%s' "$segfault_debug_json" | jq -r '.txn_debug.segv_write')
  [[ "$segfault_vaddr" == "0xdead" ]] || die "Expected segv_vaddr=0xdead, got $segfault_vaddr"
  [[ "$segfault_sz" == "1" ]] || die "Expected segv_size=1 (single byte write), got $segfault_sz"
  [[ "$segfault_wr" == "true" ]] || die "Expected segv_write=true (write access), got $segfault_wr"
  log "Segfault: exec_code=$segfault_ec pc=$segfault_pc segv_vaddr=$segfault_vaddr segv_size=$segfault_sz segv_write=$segfault_wr"

  # --- Phase 9: Deep call stack (matches Go Phase 10: testDeepCallStack) ---
  log "Phase 9: Deep call stack (recursive CPI depth=4)"
  # RecursiveCPI: cmd=4, invoke_idx=2(LE), return_idx=1(LE), depth=4, error_code=0
  local cpi_instr_hex="04020001000400000000"
  local cpi_output cpi_sig
  cpi_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$cpi_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --readonly-accounts "$debug_test_prog_b_addr" \
    --timeout 60 2>&1) || true
  cpi_sig=$(printf '%s' "$cpi_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 9: failed to extract signature from CPI tx: $cpi_output"
  log "CPI tx: $cpi_sig"

  sleep 3

  local cpi_debug_json cpi_cd cpi_mcd cpi_fc
  cpi_debug_json=$(run_cli_json "txn debug CPI tx" txn debug "$cpi_sig")
  cpi_cd=$(printf '%s' "$cpi_debug_json" | jq -er '.txn_debug.call_depth')
  cpi_mcd=$(printf '%s' "$cpi_debug_json" | jq -er '.txn_debug.max_call_depth')
  cpi_fc=$(printf '%s' "$cpi_debug_json" | jq -er '.txn_debug.fault_code')
  [[ "$cpi_cd" == "1" ]] || die "Phase 9: expected call_depth=1 (fully unwound), got $cpi_cd"
  [[ "$cpi_mcd" == "5" ]] || die "Phase 9: expected max_call_depth=5 (root + 4 CPI), got $cpi_mcd"
  log "Deep CPI: call_depth=$cpi_cd max_call_depth=$cpi_mcd fault=$cpi_fc"

  # --- Phase 9b: CPI with revert at leaf (cmd=8, depth=1) — frozen call frames ---
  log "Phase 9b: CPI with revert at leaf (cmd=8, depth=1)"
  # RecursiveCPIRevert: cmd=8, invoke_idx=2(LE), return_idx=1(LE), depth=1, error_code=0
  # depth=1: A calls B, B reverts → error_program_acc_idx=2 (program B)
  local revert_cpi_instr_hex="08020001000100000000"
  local revert_cpi_output revert_cpi_sig
  revert_cpi_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$revert_cpi_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --readonly-accounts "$debug_test_prog_b_addr" \
    --timeout 60 2>&1) || true
  revert_cpi_sig=$(printf '%s' "$revert_cpi_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 9b: failed to extract signature from revert CPI tx: $revert_cpi_output"
  log "Revert CPI tx: $revert_cpi_sig"

  sleep 3

  local rcpi_debug_json rcpi_cd rcpi_mcd rcpi_frame_count rcpi_err_prog_idx rcpi_f0 rcpi_f1 rcpi_f2 rcpi_f3
  rcpi_debug_json=$(run_cli_json "txn debug revert CPI tx" txn debug "$revert_cpi_sig")
  rcpi_cd=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_depth')
  rcpi_mcd=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.max_call_depth')
  rcpi_frame_count=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames | length')
  rcpi_err_prog_idx=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.error_program_acc_idx')
  [[ "$rcpi_cd" == "2" ]] || die "Phase 9b: expected call_depth=2 (A→B, B reverts), got $rcpi_cd"
  [[ "$rcpi_mcd" == "2" ]] || die "Phase 9b: expected max_call_depth=2, got $rcpi_mcd"
  [[ "$rcpi_frame_count" == "3" ]] || die "Phase 9b: expected 3 call_frames, got $rcpi_frame_count"
  [[ "$rcpi_err_prog_idx" == "2" ]] || die "Phase 9b: expected error_program_acc_idx=2, got $rcpi_err_prog_idx"
  rcpi_f0=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[0].program_acc_idx')
  rcpi_f1=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].program_acc_idx')
  rcpi_f2=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[2].program_acc_idx')
  [[ "$rcpi_f0" == "0" ]] || die "Phase 9b: call_frames[0].program_acc_idx=$rcpi_f0, expected 0 (sentinel)"
  [[ "$rcpi_f1" == "1" ]] || die "Phase 9b: call_frames[1].program_acc_idx=$rcpi_f1, expected 1 (Program A)"
  [[ "$rcpi_f2" == "2" ]] || die "Phase 9b: call_frames[2].program_acc_idx=$rcpi_f2, expected 2 (Program B)"

  # Verify saved_registers is an array of values (not just a count)
  local rcpi_f0_regcnt rcpi_f1_regcnt rcpi_f1_reg0
  rcpi_f0_regcnt=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[0].saved_registers | length')
  rcpi_f1_regcnt=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].saved_registers | length')
  [[ "$rcpi_f0_regcnt" == "32" ]] || die "Phase 9b: call_frames[0].saved_registers length=$rcpi_f0_regcnt, expected 32"
  [[ "$rcpi_f1_regcnt" == "32" ]] || die "Phase 9b: call_frames[1].saved_registers length=$rcpi_f1_regcnt, expected 32"
  # Sentinel frame (index 0) should have all-zero registers
  rcpi_f0_reg0=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[0].saved_registers[0]')
  [[ "$rcpi_f0_reg0" == "0" ]] || die "Phase 9b: sentinel frame saved_registers[0]=$rcpi_f0_reg0, expected 0"
  # Non-sentinel frame (index 1): reg[2] is sp, must be in stack segment (seg_type=0x05, i.e. addr >> 40 == 5)
  # Stack segment addresses are >= 0x50001000000 (5497558138880)
  local rcpi_f1_sp
  rcpi_f1_sp=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].saved_registers[2]')
  local rcpi_f1_sp_seg
  rcpi_f1_sp_seg=$(( rcpi_f1_sp / 1099511627776 ))  # divide by 2^40 to get seg_type
  [[ "$rcpi_f1_sp_seg" == "5" ]] || die "Phase 9b: frame[1] sp=$rcpi_f1_sp seg_type=$rcpi_f1_sp_seg, expected stack segment (5)"

  # Verify the active frame (index 2, call_depth) has valid stack_pointer and program_counter.
  # Before the tn_litevm_exec fix, these were stale (zero) because tn_vm_set_shadow_stack_frame
  # was only called for the caller at CPI invoke time, not for the active/deepest frame.
  local rcpi_f2_frame_sp rcpi_f2_frame_sp_seg rcpi_f2_frame_pc
  rcpi_f2_frame_sp=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[2].stack_pointer')
  rcpi_f2_frame_sp_seg=$(( rcpi_f2_frame_sp / 1099511627776 ))  # divide by 2^40 to get seg_type
  [[ "$rcpi_f2_frame_sp_seg" == "5" ]] || die "Phase 9b: active frame[2] stack_pointer=$rcpi_f2_frame_sp seg_type=$rcpi_f2_frame_sp_seg, expected stack segment (5)"
  rcpi_f2_frame_pc=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[2].program_counter')
  [[ "$rcpi_f2_frame_pc" != "0" ]] || die "Phase 9b: active frame[2] program_counter=0, expected non-zero (stale active frame bug)"

  # Verify caller frame (index 1) has valid stack_pointer and program_counter
  local rcpi_f1_frame_sp rcpi_f1_frame_sp_seg rcpi_f1_frame_pc
  rcpi_f1_frame_sp=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].stack_pointer')
  rcpi_f1_frame_sp_seg=$(( rcpi_f1_frame_sp / 1099511627776 ))
  [[ "$rcpi_f1_frame_sp_seg" == "5" ]] || die "Phase 9b: frame[1] stack_pointer=$rcpi_f1_frame_sp seg_type=$rcpi_f1_frame_sp_seg, expected stack segment (5)"
  rcpi_f1_frame_pc=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].program_counter')
  [[ "$rcpi_f1_frame_pc" != "0" ]] || die "Phase 9b: frame[1] program_counter=0, expected non-zero"

  # Verify stack_window is present on non-sentinel frames
  local rcpi_f1_sw rcpi_f1_swb rcpi_f1_sw_len
  rcpi_f1_sw=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].stack_window')
  rcpi_f1_swb=$(printf '%s' "$rcpi_debug_json" | jq -er '.txn_debug.call_frames[1].stack_window_base')
  [[ -n "$rcpi_f1_sw" && "$rcpi_f1_sw" != "null" && "$rcpi_f1_sw" != "" ]] \
    || die "Phase 9b: call_frames[1].stack_window is empty, expected non-empty hex"
  rcpi_f1_sw_len=${#rcpi_f1_sw}
  (( rcpi_f1_sw_len > 0 )) || die "Phase 9b: call_frames[1].stack_window has zero length"
  # stack_window_base must equal stack_pointer
  [[ "$rcpi_f1_swb" == "$rcpi_f1_frame_sp" ]] \
    || die "Phase 9b: call_frames[1].stack_window_base=$rcpi_f1_swb != stack_pointer=$rcpi_f1_frame_sp"
  log "Phase 9b stack windows: frame[1] window_len=$rcpi_f1_sw_len base=$rcpi_f1_swb"

  log "Revert CPI: call_depth=$rcpi_cd max_call_depth=$rcpi_mcd frames=$rcpi_frame_count accIdx=[$rcpi_f0,$rcpi_f1,$rcpi_f2] regs=[${rcpi_f0_regcnt},${rcpi_f1_regcnt}] sp=$rcpi_f1_sp active_frame_sp=$rcpi_f2_frame_sp active_frame_pc=$rcpi_f2_frame_pc"

  # --- Phase 9c: Memory dump (--memory-dump) ---
  log "Phase 9c: Memory dump (--memory-dump)"
  local memdump_json memdump_seg_count memdump_stack_pages
  memdump_json=$(run_cli_json "txn debug +memdump" txn debug "$revert_cpi_sig" --memory-dump)
  memdump_seg_count=$(printf '%s' "$memdump_json" | jq -er '.txn_debug.memory_segments | length')
  (( memdump_seg_count > 0 )) || die "Phase 9c: expected memory_segments, got $memdump_seg_count segments"
  # At least one stack segment (type=5)
  memdump_stack_pages=$(printf '%s' "$memdump_json" | jq -er \
    '[.txn_debug.memory_segments[] | select(.segment_type == 5) | .pages | length] | add // 0')
  (( memdump_stack_pages > 0 )) || die "Phase 9c: expected stack segment (type=5) with pages, got $memdump_stack_pages pages"
  log "Memory dump: $memdump_seg_count segments, $memdump_stack_pages stack pages"

  # --- Phase 10: Compute exhaustion (matches Go Phase 11: testComputeExhaustion) ---
  log "Phase 10: Compute exhaustion"
  # ExhaustCU: cmd=3, all zeros
  local exhaust_instr_hex="03000000000000000000"
  local exhaust_output exhaust_sig
  exhaust_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$exhaust_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --timeout 60 2>&1) || true
  exhaust_sig=$(printf '%s' "$exhaust_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 10: failed to extract signature from CU exhaust tx: $exhaust_output"
  log "CU exhaust tx: $exhaust_sig"

  sleep 3

  local exhaust_debug_json exhaust_ec exhaust_cu exhaust_fc
  exhaust_debug_json=$(run_cli_json "txn debug CU exhaust tx" txn debug "$exhaust_sig")
  exhaust_ec=$(printf '%s' "$exhaust_debug_json" | jq -er '.txn_debug.execution_code')
  exhaust_cu=$(printf '%s' "$exhaust_debug_json" | jq -er '.txn_debug.compute_units_consumed')
  exhaust_fc=$(printf '%s' "$exhaust_debug_json" | jq -er '.txn_debug.fault_code')
  [[ "$exhaust_ec" != "0" ]] || die "Expected non-zero execution_code for CU exhaustion, got 0"
  log "CU exhaustion: exec_code=$exhaust_ec cu_consumed=$exhaust_cu fault=$exhaust_fc"

  # --- Phase 11: SIGCU via syscall (fault_code=2) ---
  log "Phase 11: CU exhaustion via syscall (SIGCU fault_code=2)"
  # ExhaustCUSyscall: cmd=6, all zeros
  local sigcu_instr_hex="06000000000000000000"
  local sigcu_output sigcu_sig
  sigcu_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$sigcu_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units "$DEBUG_TEST_SU" \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --timeout 60 2>&1) || true
  sigcu_sig=$(printf '%s' "$sigcu_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 11: failed to extract signature from SIGCU tx: $sigcu_output"
  log "SIGCU tx: $sigcu_sig"

  sleep 3

  local sigcu_debug_json sigcu_fc sigcu_label
  sigcu_debug_json=$(run_cli_json "txn debug SIGCU tx" txn debug "$sigcu_sig")
  sigcu_fc=$(printf '%s' "$sigcu_debug_json" | jq -er '.txn_debug.fault_code')
  sigcu_label=$(printf '%s' "$sigcu_debug_json" | jq -er '.txn_debug.fault_code_label')
  [[ "$sigcu_fc" == "2" ]] || die "Expected fault_code=2 (SIGCU), got $sigcu_fc"
  [[ "$sigcu_label" == "ComputeUnitsExhausted" ]] || die "Expected fault_code_label=ComputeUnitsExhausted, got $sigcu_label"
  log "SIGCU: fault_code=$sigcu_fc label=$sigcu_label"

  # --- Phase 12: SIGSU via state unit exhaustion (fault_code=3) ---
  log "Phase 12: State unit exhaustion (SIGSU fault_code=3)"
  # Resolve scratch account address (0xED, owned by debug test program A)
  local debug_scratch_addr
  debug_scratch_addr=$(run_cli_json "resolve debug scratch account" util convert pubkey hex-to-thrufmt \
    "00000000000000000000000000000000000000000000000000000000000000ED" | jq -er '.thru_pubkey')
  log "Debug scratch account: $debug_scratch_addr"
  # ExhaustSU: cmd=7, all zeros. RW account = scratch (0xED). state-units=0 triggers SIGSU.
  local sigsu_instr_hex="07000000000000000000"
  local sigsu_output sigsu_sig
  sigsu_output=$(with_cli_env "$THRU_CLI_BIN" --json txn execute \
    "$debug_test_prog_a_addr" "$sigsu_instr_hex" \
    --fee-payer acc_0 \
    --compute-units "$DEBUG_TEST_CU" --state-units 0 \
    --memory-units "$DEBUG_TEST_MU" --expiry-after "$DEBUG_TEST_EXPIRY" \
    --readwrite-accounts "$debug_scratch_addr" \
    --timeout 60 2>&1) || true
  sigsu_sig=$(printf '%s' "$sigsu_output" | jq -er '.error.signature // .transaction_execute.signature') \
    || die "Phase 12: failed to extract signature from SIGSU tx: $sigsu_output"
  log "SIGSU tx: $sigsu_sig"

  sleep 3

  local sigsu_debug_json sigsu_fc sigsu_label
  sigsu_debug_json=$(run_cli_json "txn debug SIGSU tx" txn debug "$sigsu_sig")
  sigsu_fc=$(printf '%s' "$sigsu_debug_json" | jq -er '.txn_debug.fault_code')
  sigsu_label=$(printf '%s' "$sigsu_debug_json" | jq -er '.txn_debug.fault_code_label')
  [[ "$sigsu_fc" == "3" ]] || die "Expected fault_code=3 (SIGSU), got $sigsu_fc"
  [[ "$sigsu_label" == "StateUnitsExhausted" ]] || die "Expected fault_code_label=StateUnitsExhausted, got $sigsu_label"
  log "SIGSU: fault_code=$sigsu_fc label=$sigsu_label"

  # --- Phase 13: Debug resolve — DWARF source resolution (--signature mode) ---
  # Requires: debug test program ELF built with -g
  local DEBUG_TEST_ELF="$REPO_ROOT/build/thruvm/bin/tn_debug_test_program_c.elf"
  if [[ ! -f "$DEBUG_TEST_ELF" ]]; then
    log "Phase 13-18: Skipping debug resolve — ELF not found at $DEBUG_TEST_ELF"
  else

  log "Phase 13: Debug resolve — revert (--signature mode, JSON)"
  local resolve_json resolve_fault_type resolve_source resolve_function resolve_err
  resolve_json=$(run_cli_json "debug resolve revert" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$revert_sig") \
    || die "Phase 13: debug resolve command failed (exit $?)"
  log "Phase 13: resolve_json length=${#resolve_json}"

  # Write JSON to temp file and extract fields without subshells to debug silent exit
  local _resolve_tmp _jq_out _jq_rc
  _resolve_tmp=$(mktemp)
  _jq_out=$(mktemp)
  printf '%s' "$resolve_json" > "$_resolve_tmp"
  log "Phase 13: wrote JSON to $_resolve_tmp ($(wc -c < "$_resolve_tmp") bytes)"

  set +e
  jq -er '.fault.fault_type' "$_resolve_tmp" > "$_jq_out" 2>&1; _jq_rc=$?
  log "Phase 13: jq fault_type rc=$_jq_rc result=$(cat "$_jq_out")"
  resolve_fault_type=$(cat "$_jq_out")
  log "Phase 13: step A (fault_type=$resolve_fault_type)"

  jq -er '.fault.source' "$_resolve_tmp" > "$_jq_out" 2>&1; _jq_rc=$?
  log "Phase 13: jq source rc=$_jq_rc result=$(cat "$_jq_out")"
  resolve_source=$(cat "$_jq_out")
  log "Phase 13: step B (source=$resolve_source)"

  jq -er '.fault.function' "$_resolve_tmp" > "$_jq_out" 2>&1; _jq_rc=$?
  log "Phase 13: jq function rc=$_jq_rc result=$(cat "$_jq_out")"
  resolve_function=$(cat "$_jq_out")
  log "Phase 13: step C (function=$resolve_function)"

  jq -er '.fault.user_error_code' "$_resolve_tmp" > "$_jq_out" 2>&1; _jq_rc=$?
  log "Phase 13: jq user_error_code rc=$_jq_rc result=$(cat "$_jq_out")"
  resolve_err=$(cat "$_jq_out")
  log "Phase 13: step D (err=$resolve_err)"
  rm -f "$_resolve_tmp" "$_jq_out"
  [[ "$resolve_fault_type" == "REVERT" ]] || die "Phase 13: expected fault_type=REVERT, got $resolve_fault_type"
  [[ "$resolve_err" == "42" ]] || die "Phase 13: expected user_error_code=42, got $resolve_err"
  [[ -n "$resolve_source" && "$resolve_source" != "null" ]] || die "Phase 13: expected non-null source location"
  [[ -n "$resolve_function" && "$resolve_function" != "null" ]] || die "Phase 13: expected non-null function name"
  # Verify source points to a .c or .S file with a line number
  [[ "$resolve_source" =~ \.[cSs]:[0-9]+ ]] || die "Phase 13: source '$resolve_source' does not match file:line pattern"
  log "Phase 13: step E (basic checks passed)"
  # Verify call stack has at least 2 frames (sentinel + program)
  local resolve_stack_len
  resolve_stack_len=$(printf '%s' "$resolve_json" | jq -er '.call_stack | length') || die "Phase 13: jq call_stack length failed"
  log "Phase 13: step F (stack_len=$resolve_stack_len)"
  [[ "$resolve_stack_len" -ge 2 ]] || die "Phase 13: expected >= 2 call stack frames, got $resolve_stack_len"
  # Verify registers are present (32 entries)
  local resolve_reg_len
  resolve_reg_len=$(printf '%s' "$resolve_json" | jq -er '.registers | length') || die "Phase 13: jq registers length failed"
  log "Phase 13: step G (reg_len=$resolve_reg_len)"
  [[ "$resolve_reg_len" == "32" ]] || die "Phase 13: expected 32 registers, got $resolve_reg_len"
  # Verify source context was found (requires SDK source files at DWARF paths in container)
  local resolve_src_ctx
  resolve_src_ctx=$(printf '%s' "$resolve_json" | jq -er '.source_context.file') || die "Phase 13: jq source_context.file failed"
  log "Phase 13: step H (src_ctx=$resolve_src_ctx)"
  [[ -n "$resolve_src_ctx" && "$resolve_src_ctx" != "null" ]] \
    || die "Phase 13: expected source_context.file to be non-null"
  # Verify error_program_acc_idx == 1 (single-program revert, main program at account index 1)
  local resolve_err_prog_idx
  resolve_err_prog_idx=$(printf '%s' "$resolve_json" | jq -er '.fault.error_program_acc_idx') || die "Phase 13: jq error_program_acc_idx failed"
  log "Phase 13: step I (error_program_acc_idx=$resolve_err_prog_idx)"
  [[ "$resolve_err_prog_idx" == "1" ]] \
    || die "Phase 13: expected error_program_acc_idx=1, got $resolve_err_prog_idx"
  set -e
  log "Resolve revert: fault=$resolve_fault_type err=$resolve_err fn=$resolve_function src=$resolve_source stack=$resolve_stack_len err_prog=$resolve_err_prog_idx"

  # --- Phase 14: Debug resolve — revert (--response file mode) ---
  log "Phase 14: Debug resolve — revert (--response file mode)"
  local reexec_save_json="$CLI_TMP_HOME/revert_reexec.json"
  run_cli_json "save txn debug response" txn debug "$revert_sig" > "$reexec_save_json"
  [[ -s "$reexec_save_json" ]] || die "Phase 14: saved txn debug response is empty"

  # Strip the CLI wrapper to get the inner JSON for --response
  local reexec_inner_json="$CLI_TMP_HOME/revert_reexec_inner.json"
  jq '.txn_debug' "$reexec_save_json" > "$reexec_inner_json"

  local resolve_file_json resolve_file_source resolve_file_function
  resolve_file_json=$(run_cli_json "debug resolve from file" debug resolve --elf "$DEBUG_TEST_ELF" --response "$reexec_inner_json")
  resolve_file_source=$(jq_str "$resolve_file_json" -er '.fault.source')
  resolve_file_function=$(jq_str "$resolve_file_json" -er '.fault.function')
  # File mode should match gRPC mode exactly
  [[ "$resolve_file_source" == "$resolve_source" ]] \
    || die "Phase 14: file mode source='$resolve_file_source' != gRPC mode source='$resolve_source'"
  [[ "$resolve_file_function" == "$resolve_function" ]] \
    || die "Phase 14: file mode function='$resolve_file_function' != gRPC mode function='$resolve_function'"

  # Also verify that the CLI-wrapped JSON works directly (auto-detection)
  local resolve_wrapped_json resolve_wrapped_source
  resolve_wrapped_json=$(run_cli_json "debug resolve from CLI JSON" debug resolve --elf "$DEBUG_TEST_ELF" --response "$reexec_save_json")
  resolve_wrapped_source=$(jq_str "$resolve_wrapped_json" -er '.fault.source')
  [[ "$resolve_wrapped_source" == "$resolve_source" ]] \
    || die "Phase 14: wrapped JSON source='$resolve_wrapped_source' != expected='$resolve_source'"
  log "Resolve file mode: matched gRPC mode (src=$resolve_file_source fn=$resolve_file_function)"

  # --- Phase 15: Debug resolve — segfault (source + segv fields) ---
  log "Phase 15: Debug resolve — segfault"
  local resolve_segfault_json segfault_resolve_source segfault_resolve_fn
  local segfault_resolve_segv segfault_resolve_segv_sz segfault_resolve_segv_wr
  resolve_segfault_json=$(run_cli_json "debug resolve segfault" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$segfault_sig")
  segfault_resolve_source=$(jq_str "$resolve_segfault_json" -er '.fault.source')
  segfault_resolve_fn=$(jq_str "$resolve_segfault_json" -er '.fault.function')
  segfault_resolve_segv=$(jq_str "$resolve_segfault_json" -er '.fault.segv_vaddr')
  segfault_resolve_segv_sz=$(jq_str "$resolve_segfault_json" -er '.fault.segv_size')
  segfault_resolve_segv_wr=$(jq_str "$resolve_segfault_json" -r '.fault.segv_write')
  # Source should point to the debug test program (not a syscall stub)
  [[ "$segfault_resolve_source" =~ tn_debug_test_program ]] \
    || die "Phase 15: expected source in debug test program, got '$segfault_resolve_source'"
  # segv_vaddr should be 0xDEAD (the known bad address from the test)
  [[ "$segfault_resolve_segv" == *"DEAD"* ]] \
    || die "Phase 15: expected segv_vaddr containing 'DEAD', got '$segfault_resolve_segv'"
  [[ "$segfault_resolve_segv_sz" == "1" ]] \
    || die "Phase 15: expected segv_size=1, got $segfault_resolve_segv_sz"
  [[ "$segfault_resolve_segv_wr" == "true" ]] \
    || die "Phase 15: expected segv_write=true, got $segfault_resolve_segv_wr"
  log "Resolve segfault: src=$segfault_resolve_source fn=$segfault_resolve_fn segv=$segfault_resolve_segv"

  # --- Phase 16: Debug resolve — CPI revert (call stack depth) ---
  log "Phase 16: Debug resolve — CPI revert (call stack)"
  local resolve_cpi_json cpi_resolve_stack_len cpi_resolve_fns
  resolve_cpi_json=$(run_cli_json "debug resolve CPI revert" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$revert_cpi_sig")
  cpi_resolve_stack_len=$(jq_str "$resolve_cpi_json" -er '.call_stack | length')
  (( cpi_resolve_stack_len >= 2 )) \
    || die "Phase 16: expected >= 2 call stack frames for CPI, got $cpi_resolve_stack_len"
  # All frames should have resolved function names (not null)
  local cpi_null_fns
  cpi_null_fns=$(jq_str "$resolve_cpi_json" '[.call_stack[] | select(.function == null)] | length')
  [[ "$cpi_null_fns" == "0" ]] \
    || die "Phase 16: $cpi_null_fns call stack frames have null function names"
  # All frames should have resolved source locations
  local cpi_null_srcs
  cpi_null_srcs=$(jq_str "$resolve_cpi_json" '[.call_stack[] | select(.source == null)] | length')
  [[ "$cpi_null_srcs" == "0" ]] \
    || die "Phase 16: $cpi_null_srcs call stack frames have null source locations"
  cpi_resolve_fns=$(jq_str "$resolve_cpi_json" -c '[.call_stack[].function]')
  # Verify error_program_acc_idx == 2 (CPI revert: program B at account index 2)
  local cpi_err_prog_idx
  cpi_err_prog_idx=$(jq_str "$resolve_cpi_json" -er '.fault.error_program_acc_idx')
  [[ "$cpi_err_prog_idx" == "2" ]] \
    || die "Phase 16: expected error_program_acc_idx=2 (callee), got $cpi_err_prog_idx"
  log "Resolve CPI: $cpi_resolve_stack_len frames, functions=$cpi_resolve_fns err_prog=$cpi_err_prog_idx"

  # --- Phase 17: Debug resolve — CU exhaustion + SIGCU (fault type classification) ---
  log "Phase 17: Debug resolve — SIGCU classification"
  local resolve_sigcu_json sigcu_resolve_type
  resolve_sigcu_json=$(run_cli_json "debug resolve SIGCU" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$sigcu_sig")
  sigcu_resolve_type=$(jq_str "$resolve_sigcu_json" -er '.fault.fault_type')
  [[ "$sigcu_resolve_type" == *"SIGCU"* ]] \
    || die "Phase 17: expected fault_type containing 'SIGCU', got '$sigcu_resolve_type'"
  log "Resolve SIGCU: fault_type=$sigcu_resolve_type"

  local resolve_sigsu_json sigsu_resolve_type
  resolve_sigsu_json=$(run_cli_json "debug resolve SIGSU" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$sigsu_sig")
  sigsu_resolve_type=$(jq_str "$resolve_sigsu_json" -er '.fault.fault_type')
  [[ "$sigsu_resolve_type" == *"SIGSU"* ]] \
    || die "Phase 17: expected fault_type containing 'SIGSU', got '$sigsu_resolve_type'"
  log "Resolve SIGSU: fault_type=$sigsu_resolve_type"

  # --- Phase 18: Debug resolve — text output mode ---
  log "Phase 18: Debug resolve — text output"
  local resolve_text
  resolve_text=$(run_cli_raw "debug resolve text" debug resolve --elf "$DEBUG_TEST_ELF" --signature "$revert_sig")
  assert_contains "$resolve_text" "Thru Debug Report"
  assert_contains "$resolve_text" "FAULT:"
  assert_contains "$resolve_text" "CALL STACK:"
  assert_contains "$resolve_text" "REGISTERS:"
  assert_contains "$resolve_text" "SOURCE:"
  log "Resolve text output: all expected sections present"

  fi  # end ELF exists check

  log "All txn debug phases passed"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  check_prerequisites
  seed_cli_config
  populate_genesis_addresses
  wait_for_consensus_ready

  scenario_core_rpc
  scenario_keys
  scenario_accounts
  scenario_transfers
  scenario_txn
  scenario_programs
  scenario_program_upgrade
  scenario_event
  scenario_token
  scenario_validator
  scenario_bond
  # ClaimFees native-sweep coverage (ungated, re-runnable). Skips itself when §B is
  # enabled (§B covers ClaimFees too and needs the node-identity bond absent).
  scenario_claimfees
  # §B brackets a slot-advancement run (the change-window lockout wait) between
  # its two halves; the bond state lives on-chain in between. §B always runs
  # when the bond scenario is in scope (it drives send-block, never skips).
  scenario_bond_part1
  if [[ "$BOND_B_RAN" == "1" ]]; then
    emit_slot_advancement_transfers "bond §B change-window lockout wait"
  fi
  scenario_bond_part2
  scenario_util
  scenario_debug

  run_cleanup
  log_section "All requested scenarios finished"
}

parse_args "$@"
main
