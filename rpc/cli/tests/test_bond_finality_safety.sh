#!/usr/bin/env bash
# Offline fault injection at the real bond/fee scenario consumers. No node or build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" != --case ]]; then
  WORK="$(mktemp -d)"
  export WORK
  trap 'rm -rf "$WORK"' EXIT
  cat > "$WORK/addresses.sh" <<'ADDRESSES'
E2E_EVENT_EMISSION_PROGRAM_HEX=00
BOOTSTRAP_WTHRU_MINT_ADDRESS=mint
BOOTSTRAP_TOKEN_PROGRAM_ADDRESS=token
ADDRESSES
  for case_name in history-lag history-timeout history-failed history-missing-slot \
      history-invalid-wire finality-lag finality-timeout finality-malformed \
      payout-lag payout-timeout height-failed height-missing \
      warmup-failed warmup-empty warmup-refresh-failed warmup-refresh-empty \
      compression-height-failed compression-height-empty \
      burn-first-failed burn-second-failed burn-empty claim-first-failed \
      claim-second-failed claim-empty claim-proposal-failed claim-actual-finality \
      claim-identity-failed bond-identity-failed bond-create-mode1-failed \
      bond-create-mode2-failed \
      bond-height-failed bond-height-empty bond-proposal-failed \
      bond-execution-failed bond-execution-empty bond-actual-finality \
      bond-withdraw-height-failed bond-withdraw-height-empty; do
    bash "$0" --case "$case_name"
    printf 'PASS: %s\n' "$case_name"
  done
  exit 0
fi

case_name="$2"
case "$case_name" in bond-*) RUN_BOND_SECTION_B=1 ;; *) RUN_BOND_SECTION_B=0 ;; esac
E2E_ADDRESSES_FILE="$WORK/addresses.sh"
# Source the same functions used by the executable acceptance suite.
source "$SCRIPT_DIR/thru_cli_e2e.sh"
set -euo pipefail
trap 'rm -rf "$CLI_TMP_HOME"' EXIT
shopt -u inherit_errexit
SELECTED_SCENARIO=bond
BOND_FINALIZE_TIMEOUT_SECS=120
printf '0\n' > "$WORK/clock"
printf '0\n' > "$WORK/reads"
rm -f "$WORK/transfers" "$WORK/early_withdraw"

# A file-backed clock survives nested substitutions and makes 120s deadlines fast.
date() { [[ "$*" == +%s ]] || die "Unexpected date arguments: $*"; cat "$WORK/clock"; }
sleep() { printf '%s\n' "$(( $(cat "$WORK/clock") + $1 ))" > "$WORK/clock"; }
expect_failure() {
  local diagnostic="$1" output; shift
  if output=$("$@" 2>&1); then
    die "$case_name: unexpectedly succeeded: $output"
  fi
  [[ "$output" == *"$diagnostic"* ]] || die "$case_name: wrong failure: $output"
}
assert_clock() {
  [[ "$(cat "$WORK/clock")" == "$1" ]] || die "$case_name: wrong elapsed time: $(cat "$WORK/clock")"
}
# A distinct header prefix detects accidentally reading the first 64 wire bytes.
wire=$(printf '%080d' 0; printf 'a%.0s' {1..64})
wire=$(printf '%s' "$wire" | base64 -w0)
expected_signature=$(printf '61%.0s' {1..64})

case "$case_name" in
  history-*)
    run_cli_json() {
      [[ "$2 $3 $4" == "txn get $expected_signature" ]] || die "Wrong transaction signature: $*"
      case "$case_name" in
        history-timeout) return 1 ;;
        history-lag) (( $(cat "$WORK/clock") >= 12 )) || return 1 ;;
        history-failed) printf '%s\n' '{"transaction_get":{"status":"failed","vm_error":9,"user_error_code":0,"slot":42}}'; return 0 ;;
        history-missing-slot) printf '%s\n' '{"transaction_get":{"status":"success","vm_error":0,"user_error_code":0}}'; return 0 ;;
      esac
      printf '%s\n' '{"transaction_get":{"status":"success","vm_error":0,"user_error_code":0,"slot":42}}'
    }
    case "$case_name" in
      history-lag)
        result=$(transaction_execution_slot "$wire" history)
        [[ "$result" == 42 ]] || die "Wrong execution slot: $result"
        assert_clock 12 ;;
      history-timeout)
        expect_failure 'transaction history unavailable after 120s' transaction_execution_slot "$wire" history
        assert_clock 120 ;;
      history-invalid-wire)
        expect_failure 'could not decode signed transaction' transaction_execution_slot "${wire}!" history ;;
      *) expect_failure 'transaction did not execute successfully' transaction_execution_slot "$wire" history; assert_clock 0 ;;
    esac ;;
  finality-*)
    run_cli_json() {
      [[ "$2" == getheight ]] || die "Unexpected finality command: $*"
      case "$case_name" in
        finality-malformed) printf '%s\n' '{"getheight":{}}' ;;
        finality-lag)
          if (( $(cat "$WORK/clock") >= 12 )); then
            printf '%s\n' '{"getheight":{"finalized":42}}'
          else
            printf '%s\n' '{"getheight":{"finalized":41}}'
          fi ;;
        *) printf '%s\n' '{"getheight":{"finalized":41}}' ;;
      esac
    }
    case "$case_name" in
      finality-lag) wait_for_finalized_slot 42 finality; assert_clock 12 ;;
      finality-timeout) expect_failure 'execution slot 42 not finalized after 120s' wait_for_finalized_slot 42 finality; assert_clock 120 ;;
      *) expect_failure 'missing finalized height' wait_for_finalized_slot 42 finality ;;
    esac ;;
  payout-*)
    run_cli_json() {
      if [[ "$case_name" == payout-lag ]] && (( $(cat "$WORK/clock") >= 12 )); then
        printf '%s\n' '{"bond_show":{"active_bond":300000}}'
      else
        printf '%s\n' '{"bond_show":{"active_bond":400000}}'
      fi
    }
    if [[ "$case_name" == payout-lag ]]; then
      assert_bond_field node active_bond 300000 payout 120
      assert_clock 12
    else
      expect_failure 'expected '\''300000'\''' assert_bond_field node active_bond 300000 payout 120
      assert_clock 120
    fi ;;
  height-*)
    run_cli_json() {
      if [[ "$case_name" == height-failed ]]; then
        printf '%s\n' '{"getheight":{"locally_executed":10}}'
        return 1
      fi
      printf '%s\n' '{"getheight":{}}'
    }
    if [[ "$case_name" == height-failed ]]; then
      expect_failure 'Executed height lookup failed' get_executed_slot
    else
      expect_failure 'Missing executed height' get_executed_slot
    fi ;;
  warmup-*|compression-height-*)
    get_executed_slot() {
      local reads
      reads=$(cat "$WORK/reads")
      printf '%s\n' "$((reads + 1))" > "$WORK/reads"
      if [[ "$case_name" == warmup-refresh-* ]] && (( reads == 0 )); then
        printf '10\n'; return 0
      fi
      [[ "$case_name" == *empty ]] && return 0
      return 1
    }
    transfer_with_retry() { printf 'transfer\n' >> "$WORK/transfers"; }
    if [[ "$case_name" == compression-* ]]; then
      expect_failure 'Compression warm-up:' ensure_slot_ready_for_compression
    else
      expect_failure 'Slot advancement:' emit_slot_advancement_transfers regression
    fi
    if [[ "$case_name" == warmup-refresh-* ]]; then
      [[ "$(wc -l < "$WORK/transfers")" == 2 ]] || die 'Warm-up did not fail at its first refresh'
    else
      [[ ! -e "$WORK/transfers" ]] || die 'Transfers ran after a missing initial height'
    fi ;;
  burn-*|claim-*|bond-*)
    # Only prepare the real consumer up to the fault. Never simulate a successful
    # bond lifecycle; the parent separately runs the live default and gated cases.
    resolve_node_identity_seed() {
      printf 'a%.0s' {1..64}
      [[ "$case_name" != *identity-failed ]] || die 'identity resolver failed after writing output'
    }
    random_hex32() { printf 'b%.0s' {1..64}; }
    run_cli_raw() { printf '%s' "$wire"; }
    resolve_send_block() { printf 'fault-injection-send-block'; }
    send_block() { printf 'slot=900\n'; }
    poll_wthru_amount() { :; }
    assert_bond_field() { :; }
    run_cli_expect_fail() { shift; printf '%s\n' "$*" >> "$WORK/early_withdraw"; }
    run_cli_json() {
      local desc="$1"; shift
      case "$1" in
        keys) printf '%s\n' '{"keys":{"public_key":"producer"}}' ;;
        getaccountinfo)
          if [[ "$case_name" == bond-create-mode1-failed ]]; then
            printf '%s\n' '{"account_info":{"pubkey":"producer","balance":0}}'
            return 0
          fi
          if [[ "$case_name" == burn-* || "$case_name" == bond-* ]]; then return 1; fi
          printf '%s\n' '{"account_info":{"pubkey":"producer","balance":0}}' ;;
        getheight)
          [[ "$case_name" != *proposal-failed ]] || { printf '%s\n' '{"getheight":{"finalized":10,"locally_executed":10,"cluster_executed":10}}'; return 1; }
          printf '%s\n' '{"getheight":{"finalized":10,"locally_executed":10,"cluster_executed":10}}' ;;
        bond)
          case "$2" in
            show) return 1 ;;
            create)
              printf '%s\n' '{"bond_create":{"status":"success"}}'
              [[ "$case_name" != bond-create-*-failed ]] || die 'bond create failed after writing output' ;;
            *) printf '{}\n' ;;
          esac ;;
        token) printf '%s\n' '{"token_initialize_account":{"status":"success","token_account":"source"}}' ;;
        getbalance) printf '%s\n' '{"balance":{"balance":0}}' ;;
        getslotmetrics) die 'Metrics reached after a failed lookup' ;;
        transfer|wthru) printf '{}\n' ;;
        *) die "Unexpected setup command: $desc: $*" ;;
      esac
    }
    get_executed_slot() {
      local reads
      reads=$(cat "$WORK/reads")
      printf '%s\n' "$((reads + 1))" > "$WORK/reads"
      if [[ "$case_name" == bond-height-* ]] || { [[ "$case_name" == bond-withdraw-* ]] && (( reads > 0 )); }; then
        [[ "$case_name" == *empty ]] && return 0
        return 1
      fi
      printf '10\n'
    }
    transaction_execution_slot() {
      case "$case_name" in
        *first-failed) [[ "$2" != *tx1 ]] || return 1 ;;
        *second-failed) [[ "$2" != *tx2 ]] || return 1 ;;
        *execution-failed) return 1 ;;
        burn-empty|claim-empty|bond-execution-empty) return 0 ;;
      esac
      printf '42\n'
    }
    wait_for_finalized_slot() {
      [[ "$1" == 42 ]] || die "Waited for proposal instead of execution slot: $1"
      die 'actual execution finality reached'
    }
    if [[ "$case_name" == bond-* ]]; then
      case "$case_name" in
        bond-identity-failed) diagnostic='producer identity lookup failed' ;;
        bond-create-mode1-failed) diagnostic='bond creation failed (Mode 1)' ;;
        bond-create-mode2-failed) diagnostic='bond creation failed (Mode 2)' ;;
        bond-height-*) diagnostic='activation executed height' ;;
        bond-proposal-failed) diagnostic='proposal height lookup failed' ;;
        bond-execution-failed) diagnostic='fee transfer execution lookup failed' ;;
        bond-execution-empty) diagnostic='missing fee transfer execution slot' ;;
        bond-withdraw-height-*) diagnostic='early-withdraw executed height' ;;
        *) diagnostic='actual execution finality reached' ;;
      esac
      expect_failure "$diagnostic" scenario_bond_part1
      # The lock check runs right after activation, before the time-bounded
      # block waits, and never after a failed height lookup.
      case "$case_name" in
        bond-proposal-failed|bond-execution-*|bond-actual-finality)
          grep -q -- '^bond withdraw .* --from active' "$WORK/early_withdraw" 2>/dev/null \
            || die 'Early active withdraw was not checked before the block' ;;
        *)
          [[ ! -e "$WORK/early_withdraw" ]] || die 'Early active withdraw ran before activation or after a failed lookup' ;;
      esac
    else
      case "$case_name" in
        claim-identity-failed) diagnostic='producer identity lookup failed' ;;
        *first-failed) diagnostic='tx1 execution lookup failed' ;;
        *second-failed) diagnostic='tx2 execution lookup failed' ;;
        *empty) diagnostic='tx1 missing execution slot' ;;
        *proposal-failed) diagnostic='proposal height lookup failed' ;;
        *) diagnostic='actual execution finality reached' ;;
      esac
      expect_failure "$diagnostic" scenario_claimfees
    fi ;;
  *) die "Unknown regression case: $case_name" ;;
esac
