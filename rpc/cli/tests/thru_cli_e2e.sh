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
trap 'log "ERR trap: line=$LINENO exit=$? BASH_COMMAND=$BASH_COMMAND"' ERR

readonly TEST_SCOPE="${TEST_SCOPE:-all}"
readonly SKIP_BUILD="${SKIP_BUILD:-0}"
readonly RPC_BASE_URL_DEFAULT="http://127.0.0.1:8472"
readonly RPC_BASE_URL="${RPC_BASE_URL:-$RPC_BASE_URL_DEFAULT}"
readonly ADVANCE_TRANSFERS_VALUE="${ADVANCE_TRANSFERS_VALUE:-1}"
readonly RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-5}"
readonly RETRY_DELAY_SECS="${RETRY_DELAY_SECS:-2}"
readonly AVAILABLE_SCENARIOS=(core keys accounts transfers txn program program-upgrade event token util debug)

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

THRU_CLI_BIN_DEFAULT="$REPO_ROOT/rpc/cli/target/debug/thru"
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
      core|keys|accounts|transfers|txn|program|program-upgrade|event|token|util|debug)
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
  scenario_debug

  run_cleanup
  log_section "All requested scenarios finished"
}

parse_args "$@"
main
