#!/usr/bin/env bash
# Sourced by the E2E harness and its offline fault-injection regression.
# Uses with_cli_env, log, THRU_CLI_BIN, RETRY_ATTEMPTS and RETRY_DELAY_SECS.

account_info_nonce() {
  local json="$1" expected_pubkey="$2"
  jq -ser --arg pubkey "$expected_pubkey" '
    select(length == 1) | .[0].account_info |
    select(.pubkey == $pubkey) | .nonce |
    select(type == "number") | select(. >= 0 and . == floor)
  ' <<<"$json" 2>/dev/null
}

reconcile_created_account() {
  local key="$1" expected_pubkey="$2"
  local attempt info nonce
  for (( attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++ )); do
    log "Checking account $key (attempt $attempt/$RETRY_ATTEMPTS)"
    if info=$(with_cli_env "$THRU_CLI_BIN" --json getaccountinfo "$key" 2>/dev/null) &&
       nonce=$(account_info_nonce "$info" "$expected_pubkey"); then
      GENERATED_ACCOUNT_PUBKEY="$expected_pubkey"
      ACCOUNT_CREATE_SIGNATURE=""
      log "Recovered account $expected_pubkey from state (nonce=$nonce)."
      return 0
    fi
    if (( attempt < RETRY_ATTEMPTS )); then
      sleep "$RETRY_DELAY_SECS"
    fi
  done
  log "No valid account state for $key after $RETRY_ATTEMPTS reads; creation outcome remains unknown."
  return 1
}

create_or_reuse_account() {
  local key="$1" expected_pubkey="$2"
  local info nonce attempt output status signature error
  GENERATED_ACCOUNT_PUBKEY=""
  ACCOUNT_CREATE_SIGNATURE=""
  if info=$(with_cli_env "$THRU_CLI_BIN" --json getaccountinfo "$key" 2>/dev/null); then
    if nonce=$(account_info_nonce "$info" "$expected_pubkey"); then
      GENERATED_ACCOUNT_PUBKEY="$expected_pubkey"
      log "Account $key already exists (nonce=$nonce); reusing existing account."
      return 0
    fi
    # A successful but invalid read is not evidence that creation is safe.
    reconcile_created_account "$key" "$expected_pubkey"
    return $?
  fi

  for (( attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++ )); do
    log "CLI: account create (attempt $attempt/$RETRY_ATTEMPTS) -> thru-cli --json account create $key"
    if output=$(with_cli_env "$THRU_CLI_BIN" --json account create "$key" 2>&1); then
      if signature=$(jq -ser --arg pubkey "$expected_pubkey" '
        select(length == 1) | .[0].account_create |
        select(.status == "success" and .public_key == $pubkey) |
        .signature | select(type == "string" and length > 0)
      ' <<<"$output" 2>/dev/null); then
        ACCOUNT_CREATE_SIGNATURE="$signature"
        GENERATED_ACCOUNT_PUBKEY="$expected_pubkey"
        return 0
      fi
      log "Account create returned invalid success JSON; reconciling state."
      reconcile_created_account "$key" "$expected_pubkey"
      return $?
    else
      status=$?
    fi
    log "Account creation failed (exit $status): $output"
    error="${output,,}"
    # Nonce-low can follow a landed bootstrap; other known execution failures
    # must not be hidden by a timeout/stream marker elsewhere in the output.
    if [[ "$error" == *"transaction failed with execution result:"* &&
          "$error" != *"tn_runtime_txn_err_nonce_too_low"* ]]; then
      return "$status"
    fi
    case "$error" in
      *"transaction confirmed via stream but not found in query"*|\
      *"transaction observed via stream but details unavailable"*|\
      *"timeout expired"*|*"timed out"*|*"operation was cancelled"*|\
      *"operation was canceled"*|*"track transaction timeout"*|\
      *"tn_runtime_txn_err_nonce_too_low"*|*"nonce too low"*|\
      *"bintrie: key already exists"*)
        reconcile_created_account "$key" "$expected_pubkey"
        return $?
        ;;
      *"service is currently unavailable"*|*"transaction rejected: code=7"*|*"send transaction: node busy"*)
        # Explicit pre-submission rejection: no transaction landed.
        if (( attempt < RETRY_ATTEMPTS )); then
          sleep "$RETRY_DELAY_SECS"
        fi
        ;;
      *) return "$status" ;;
    esac
  done
  return "$status"
}
