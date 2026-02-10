#!/usr/bin/env bash
#
# thru_cli_e2e.sh - comprehensive Thru CLI acceptance test suite
#
# Usage:
#   ./thru_cli_e2e.sh [scenario]
#
# Environment variables:
#   TEST_SCOPE   - run a subset of scenarios (default: "all"). Supported scopes:
#                  core, keys, accounts, transfers, txn, program, token, util.
#   SKIP_BUILD   - set to 1 to reuse an existing thru-cli binary.
#   THRU_CLI_BIN - override path to the thru-cli binary.
#   RPC_BASE_URL - override gRPC endpoint base URL (default: http://127.0.0.1:8472).
#   ADVANCE_TRANSFERS_VALUE - token amount used for slot advancement transfers (default: 1).
#
# Dependencies: bash (>= 5), cargo, jq, thru node running locally with pre-funded accounts
#               (created via mksnap --fund-accounts), built program binary at
#               build/thruvm/bin/tn_event_emission_program_c.bin.
#
# The script provisions an isolated HOME for thru-cli, seeds keys for pre-funded accounts
# (acc_0, acc_1, acc_2, acc_3 with sequential private keys 0, 1, 2, 3), exercises the entire
# CLI surface (RPC queries, key management, account lifecycle, transfers, transactions,
# uploader/program lifecycle including event verification, token program flows, and utility
# conversions), and validates JSON responses with jq.

set -euo pipefail

readonly TEST_SCOPE="${TEST_SCOPE:-all}"
readonly SKIP_BUILD="${SKIP_BUILD:-0}"
readonly RPC_BASE_URL_DEFAULT="http://127.0.0.1:8472"
readonly RPC_BASE_URL="${RPC_BASE_URL:-$RPC_BASE_URL_DEFAULT}"
readonly ADVANCE_TRANSFERS_VALUE="${ADVANCE_TRANSFERS_VALUE:-1}"
readonly RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-5}"
readonly RETRY_DELAY_SECS="${RETRY_DELAY_SECS:-2}"
readonly AVAILABLE_SCENARIOS=(core keys accounts transfers txn program event token util)

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

THRU_CLI_BIN_DEFAULT="$REPO_ROOT/rpc/target/debug/thru-cli"
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
declare GENESIS_EVENT_PROGRAM_HEX="00000000000000000000000000000000000000000000000000000000000000EE"

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
  [[ "$SELECTED_SCENARIO" == "all" || "$SELECTED_SCENARIO" == "$scope" ]]
}

with_cli_env() {
  HOME="$CLI_TMP_HOME" "$@"
}

run_cli_raw() {
  local desc="$1"
  shift
  log "CLI: $desc -> thru-cli $*"
  local output status
  output=$(with_cli_env "$THRU_CLI_BIN" "$@" 2>&1)
  status=$?
  if (( status != 0 )); then
    log "CLI command failed (exit $status)"
    log "$output"
    return $status
  fi
  printf '%s' "$output"
}

run_cli_json() {
  local desc="$1"
  shift
  local output
  output=$(run_cli_raw "$desc" --json "$@") || return 1
  printf '%s\n' "$output"
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
  local transfers=256
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
  core
  keys
  accounts
  transfers
  txn
  program
  program-upgrade
  event
  token
  util

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
      core|keys|accounts|transfers|txn|program|program-upgrade|event|token|util)
        SELECTED_SCENARIO="$arg"
        ;;
      *)
        die "Unknown option or scenario: $arg"
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
    log "Building thru-cli via cargo (workspace root: $REPO_ROOT/rpc)"
    (cd "$REPO_ROOT/rpc" && cargo build -p thru-cli)
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
wthru_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcH"
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
      create_output=$(with_cli_env "$THRU_CLI_BIN" --json account create "$GENERATED_ACCOUNT_KEY" 2>&1)
      create_status=$?
      if (( create_status == 0 )); then
        ACCOUNT_CREATE_SIGNATURE=$(printf '%s' "$create_output" | jq -er '.account_create.signature')
        GENERATED_ACCOUNT_PUBKEY=$(printf '%s' "$create_output" | jq -er '.account_create.public_key')
        created=true
        break
      fi

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
  event_tx_json=$(run_cli_json "txn execute initial program" txn execute "$upgrade_program_account" "$event_instruction_hex" --fee-payer acc_0 --timeout 60)
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

  local transfer_json
  transfer_json=$(run_cli_json "token transfer acc_2->acc_3" token transfer "$acc_2_token_account" "$acc_3_token_account" 200 --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$transfer_json" '.token_transfer.status' 'success'

  local freeze_json
  freeze_json=$(run_cli_json "token freeze acc_3" token freeze-account "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$freeze_json" '.token_freeze_account.status' 'success'

  local thaw_json
  thaw_json=$(run_cli_json "token thaw acc_3" token thaw-account "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --fee-payer acc_2 --token-program "$token_program_id")
  assert_jq_eq "$thaw_json" '.token_thaw_account.status' 'success'

  local burn_json
  burn_json=$(run_cli_json "token burn acc_3 balance" token burn "$acc_3_token_account" "$TOKEN_MINT_ADDRESS" "$ACC_3_ADDRESS" 200 --fee-payer acc_3 --token-program "$token_program_id")
  assert_jq_eq "$burn_json" '.token_burn.status' 'success'

  local close_json
  close_json=$(run_cli_json "token close acc_3 account" token close-account "$acc_3_token_account" "$ACC_3_ADDRESS" "$ACC_3_ADDRESS" --fee-payer acc_3 --token-program "$token_program_id")
  assert_jq_eq "$close_json" '.token_close_account.status' 'success'

  run_cli_json "token derive-token-account (verify)" token derive-token-account "$TOKEN_MINT_ADDRESS" "$ACC_2_ADDRESS" --seed "$acc_2_token_seed" --token-program "$token_program_id" >/dev/null
  run_cli_json "token derive-mint-account (verify)" token derive-mint-account "$ACC_2_ADDRESS" "$mint_seed" --token-program "$token_program_id" >/dev/null
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

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  check_prerequisites
  seed_cli_config
  populate_genesis_addresses

  scenario_core_rpc
  scenario_keys
  scenario_accounts
  scenario_transfers
  scenario_txn
  scenario_programs
  scenario_program_upgrade
  scenario_event
  scenario_token
  scenario_util

  run_cleanup
  log_section "All requested scenarios finished"
}

parse_args "$@"
main
