#!/usr/bin/env bash
# Offline fault injection for the same account-create loop used by thru_cli_e2e.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/account_create_helpers.sh"

TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
THRU_CLI_BIN=fake_cli
RETRY_ATTEMPTS=3
RETRY_DELAY_SECS=0
EXPECTED_PUBKEY="taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE"
VALID_INFO="{\"account_info\":{\"pubkey\":\"$EXPECTED_PUBKEY\",\"nonce\":1}}"

log() { printf '%s\n' "$*" >&2; }
with_cli_env() { "$@"; }

fake_cli() {
  local count
  [[ "$1" == --json ]] || return 99
  shift
  case "$1" in
    account)
      [[ "$2" == create && "$3" == test-key ]] || return 99
      count=$(<"$TEST_TMP/creates")
      count=$((count + 1))
      printf '%s' "$count" > "$TEST_TMP/creates"
      if [[ "$CREATE_ERROR" == transient && "$count" == 1 ]]; then
        printf 'Transaction rejected: code=7\n' >&2
        return 23
      fi
      if [[ "$CREATE_ERROR" == success || "$CREATE_ERROR" == transient ]]; then
        printf '{"account_create":{"public_key":"%s","signature":"landed","status":"success"}}\n' "$EXPECTED_PUBKEY"
        return 0
      fi
      printf '%s\n' "$CREATE_ERROR" >&2
      return 23
      ;;
    getaccountinfo)
      [[ "$2" == test-key ]] || return 99
      count=$(<"$TEST_TMP/queries")
      count=$((count + 1))
      printf '%s' "$count" > "$TEST_TMP/queries"
      # The initial read is absent, except for the pre-existing account case.
      if (( count == 1 && VISIBLE_AFTER != 0 )); then
        return 4
      fi
      if (( VISIBLE_AFTER < 0 || count - 1 < VISIBLE_AFTER )); then
        printf 'Timeout expired\n' >&2
        return 4
      fi
      printf '%s\n' "$QUERY_INFO"
      ;;
    *) return 99 ;;
  esac
}

run_case() {
  local name="$1" expected_status="$5" expected_creates="$6" expected_queries="$7"
  CREATE_ERROR="$2"
  VISIBLE_AFTER="$3"
  QUERY_INFO="$4"
  printf '0' > "$TEST_TMP/creates"
  printf '0' > "$TEST_TMP/queries"
  GENERATED_ACCOUNT_PUBKEY="stale"
  ACCOUNT_CREATE_SIGNATURE="stale"
  local status=0 creates queries
  create_or_reuse_account test-key "$EXPECTED_PUBKEY" >"$TEST_TMP/output" 2>&1 || status=$?
  creates=$(<"$TEST_TMP/creates")
  queries=$(<"$TEST_TMP/queries")
  if [[ "$status" != "$expected_status" || "$creates" != "$expected_creates" || "$queries" != "$expected_queries" ]]; then
    printf 'FAIL %s: exit=%s creates=%s queries=%s; expected %s/%s/%s\n%s\n' \
      "$name" "$status" "$creates" "$queries" "$expected_status" "$expected_creates" "$expected_queries" "$(<"$TEST_TMP/output")" >&2
    exit 1
  fi
  if (( status == 0 )); then
    [[ "$GENERATED_ACCOUNT_PUBKEY" == "$EXPECTED_PUBKEY" ]] || exit 1
    if [[ "$CREATE_ERROR" == success || "$CREATE_ERROR" == transient ]]; then
      [[ "$ACCOUNT_CREATE_SIGNATURE" == landed ]] || exit 1
    else
      [[ -z "$ACCOUNT_CREATE_SIGNATURE" ]] || exit 1
    fi
  else
    [[ -z "$GENERATED_ACCOUNT_PUBKEY" && -z "$ACCOUNT_CREATE_SIGNATURE" ]] || exit 1
  fi
  printf 'PASS %s\n' "$name"
}

legacy="Transaction confirmed via stream but not found in query"
observed="Transaction observed via stream but details unavailable"
run_case 'landed legacy query miss' "$legacy" 1 "$VALID_INFO" 0 1 2
run_case 'delayed visibility' "$observed" 3 "$VALID_INFO" 0 1 4
run_case 'absent after ambiguous create' "$observed" -1 "$VALID_INFO" 1 1 4
run_case 'invalid JSON' "$legacy" 1 'not JSON' 1 1 4
run_case 'missing nonce' "$legacy" 1 "{\"account_info\":{\"pubkey\":\"$EXPECTED_PUBKEY\"}}" 1 1 4
run_case 'wrong account' "$legacy" 1 '{"account_info":{"pubkey":"another-account","nonce":1}}' 1 1 4
run_case 'boolean nonce' "$legacy" 1 "{\"account_info\":{\"pubkey\":\"$EXPECTED_PUBKEY\",\"nonce\":true}}" 1 1 4
run_case 'negative nonce' "$legacy" 1 "{\"account_info\":{\"pubkey\":\"$EXPECTED_PUBKEY\",\"nonce\":-1}}" 1 1 4
run_case 'multiple JSON documents' "$legacy" 1 "$VALID_INFO $VALID_INFO" 1 1 4
run_case 'pre-existing account' unused 0 "$VALID_INFO" 0 0 1
run_case 'invalid pre-existing state' unused 0 '{}' 1 0 4
run_case 'confirmed create' success -1 "$VALID_INFO" 0 1 1
run_case 'safe pre-submission retry' transient -1 "$VALID_INFO" 0 2 1
run_case 'known execution failure plus timeout' \
  'Transaction failed with execution result: 7 (VM error: 0); Timeout expired' 1 "$VALID_INFO" 23 1 1
run_case 'unknown failure is not retried' 'Invalid configuration' 1 "$VALID_INFO" 23 1 1

for marker in \
  'Timeout expired' \
  'Transaction confirmation timed out' \
  'The operation was cancelled' \
  'The operation was canceled' \
  'track transaction timeout' \
  'Transaction failed with execution result: 0 (VM error: -511 (TN_RUNTIME_TXN_ERR_NONCE_TOO_LOW))' \
  'bintrie: key already exists'; do
  run_case "$marker" "$marker" 1 "$VALID_INFO" 0 1 2
done
