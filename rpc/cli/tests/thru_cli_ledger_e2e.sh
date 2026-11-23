#!/usr/bin/env bash
#
# thru_cli_ledger_e2e.sh - Ledger end-to-end scenarios (plan §6.5) through the
# thru CLI, with `ledger://` keys on Speculos (THRU_LEDGER_SPECULOS) and a
# local chain.
#
# Usually run by ledger/sim/run-scenarios.sh --suite cli after ledger/sim/up.sh.
#
# Environment:
#   THRU_CLI_BIN          thru binary built with the test-only `ledger-speculos`
#                         feature (release CLIs refuse THRU_LEDGER_SPECULOS).
#                         Default: rpc/cli/target/ledger-speculos/release/thru,
#                         built on first use with
#                         cargo build --release -p thru --features ledger-speculos
#   RPC_BASE_URL          chain RPC (default http://127.0.0.1:8472)
#   THRU_LEDGER_SPECULOS  Speculos APDU host:port (default 127.0.0.1:9999)
#   SPECULOS_API          Speculos REST API (default http://127.0.0.1:5000)
#   SPECULOS_MODEL        nanosp | nanox | stax | flex | apex_p (default nanosp)
#   LEDGER_SIM_CHAIN      none = device-only scenarios (1a); anything else = all
#   REQUIRE_SIGNING=1     a SIGN_* INS answering 0x6D00 fails instead of SKIP
#   E2E_ADDRESSES_FILE    generated bootstrap addresses (default
#                         programs/bootstrap/generated/e2e-addresses.sh)
#   TOKEN_PROGRAM         token program (default: the bootstrap one from that file)
#   TOKEN_INDEXER_URL     optional matching-chain token API; scenario 3 checks
#                         indexed balances when configured, otherwise chain only
#   NOOP_PROGRAM          deployed NOOP program for successful near-MTU execution
#                         (default: the bootstrap one from that file)
#   SCENARIOS             comma list of scenario numbers (default 1a,1b,2,3,4,6,7,8,9)
#   RESULTS_DIR           where transcripts are written (default a temp dir)
#   LEDGER_ACCOUNT        account index of the Ledger key used on chain (default 0).
#                         On a public chain (betanet) use a fresh, high index: the
#                         Speculos seed is the public "abandon x11 about" mnemonic.
#   FUNDER_KEY_HEX        private key (hex) of a funded key that pays fees and funds
#                         the Ledger account (default: genesis key 0, local chains)
#   DEST_KEY_HEX          private key (hex) of an existing transfer destination
#                         (default: genesis key 1)
#   LEDGER_FUND           native amount moved to the Ledger EOA in scenario 2
#                         (default 1000000; keep it small on a public chain)
#
# Scenario status: PASS, FAIL, SKIP(gated) when the device does not implement
# the INS yet, N/A when the scenario is not expressible through the CLI (it
# runs in the TS / wallet suites instead).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DRIVER="${REPO_ROOT}/ledger/sim/driver/speculos_driver.py"
CORPUS="${REPO_ROOT}/contrib/test/vectors/signing"
# shellcheck source=/dev/null
source "${E2E_ADDRESSES_FILE:-${REPO_ROOT}/programs/bootstrap/generated/e2e-addresses.sh}"

SPECULOS_CLI_TARGET="${REPO_ROOT}/rpc/cli/target/ledger-speculos"
THRU_CLI_BIN="${THRU_CLI_BIN:-${SPECULOS_CLI_TARGET}/release/thru}"
RPC_BASE_URL="${RPC_BASE_URL:-http://127.0.0.1:8472}"
export THRU_LEDGER_SPECULOS="${THRU_LEDGER_SPECULOS:-127.0.0.1:9999}"
export SPECULOS_APDU="${THRU_LEDGER_SPECULOS}"
export SPECULOS_API="${SPECULOS_API:-http://127.0.0.1:5000}"
export SPECULOS_MODEL="${SPECULOS_MODEL:-nanosp}"
LEDGER_SIM_CHAIN="${LEDGER_SIM_CHAIN:-external}"
REQUIRE_SIGNING="${REQUIRE_SIGNING:-0}"
TOKEN_PROGRAM="${TOKEN_PROGRAM:-${BOOTSTRAP_TOKEN_PROGRAM_ADDRESS}}"
TOKEN_INDEXER_URL="${TOKEN_INDEXER_URL:-}"
NOOP_PROGRAM="${NOOP_PROGRAM:-${BOOTSTRAP_NOOP_PROGRAM_ADDRESS}}"
EOA_PROGRAM="${EOA_PROGRAM:-}"
SCENARIOS="${SCENARIOS:-1a,1b,2,3,4,6,7,8,9}"
LEDGER_ACCOUNT="${LEDGER_ACCOUNT:-0}"
FUNDER_KEY_HEX="${FUNDER_KEY_HEX:-0000000000000000000000000000000000000000000000000000000000000000}"
DEST_KEY_HEX="${DEST_KEY_HEX:-0100000000000000000000000000000000000000000000000000000000000000}"
LEDGER_FUND="${LEDGER_FUND:-1000000}"
RESULTS_DIR="${RESULTS_DIR:-$(mktemp -d)}"
mkdir -p "${RESULTS_DIR}"

CLI_HOME="$(mktemp -d)"
trap 'rm -rf "${CLI_HOME}"' EXIT
CONFIG_DIR="${CLI_HOME}/.thru/cli"

declare -A RESULT=()
LEDGER_ADDR=""   # account 0 (the corpus key): device-only checks
MAIN_ADDR=""     # LEDGER_ACCOUNT: every chain scenario

log() { printf '[cli-ledger %(%H:%M:%S)T] %s\n' -1 "$*" >&2; }
cli() { HOME="${CLI_HOME}" "${THRU_CLI_BIN}" "$@"; }
cli_json() { cli --json "$@"; }
driver() { python3 "${DRIVER}" "$@"; }
jqv() { jq -er "$1" <<< "$2"; }

# The pubkey/address of m/44'/8478'/<a>'/0' under the corpus seed.
hd_address() {
    jq -er --arg p "m/44'/8478'/$1'/0'" \
        '[.derivations[] | select(.mnemonic|startswith("abandon")) | select(.passphrase=="") | select(.path==$p)][0].address' \
        "${CORPUS}/hd_vectors.json"
}

seed_config() {
    mkdir -p "${CONFIG_DIR}"
    # Funded keys: the genesis accounts on a local chain (private key =
    # little-endian index), or FUNDER_KEY_HEX / DEST_KEY_HEX on a public one.
    # acc_0 and acc_2 are the funder; acc_1 is the transfer destination.
    # The CLI refuses signing keys stored inline in the config, so they go
    # into its file store.
    cat > "${CONFIG_DIR}/config.yaml" <<EOF
rpc_base_url: "${RPC_BASE_URL}"
keys: {}
token_program_public_key: "${TOKEN_PROGRAM}"
timeout_seconds: 300
max_retries: 5
auth_token:
EOF
    chmod 600 "${CONFIG_DIR}/config.yaml"
    local name key
    for name in default acc_0 acc_1 acc_2; do
        key="${FUNDER_KEY_HEX}"; [[ "${name}" == acc_1 ]] && key="${DEST_KEY_HEX}"
        printf '%s' "${key}" | cli_json keys add "${name}" --stdin --store file >/dev/null || \
            { log "could not add key ${name}"; return 1; }
    done
}

# Run a CLI command while the driver approves (or rejects) the device review.
# Usage: on_device approve|reject <transcript-name> <cli args...>
# Prints the CLI output; returns the CLI exit status.
on_device() {
    local action="$1" name="$2"; shift 2
    local flag=()
    [[ "${action}" == "reject" ]] && flag=(--reject)
    # Not through the driver() function: $! must be the approver itself, or the
    # kill below only stops a wrapper subshell and the approver lives on.
    python3 "${DRIVER}" auto-approve --kind auto --once --idle-exit 120 "${flag[@]}" > "${RESULTS_DIR}/${name}.jsonl" 2>&1 &
    local apid=$!
    local out rc
    out="$(cli "$@" 2>"${RESULTS_DIR}/${name}.stderr")"; rc=$?
    (( rc == 0 )) || out="${out}$(cat "${RESULTS_DIR}/${name}.stderr")"
    # Let the approver finish writing its transcript; a review that never
    # appeared (an error before any UI) leaves it idle, so stop it then.
    local i
    for i in $(seq 1 60); do
        kill -0 "${apid}" 2>/dev/null || break
        [[ -s "${RESULTS_DIR}/${name}.jsonl" ]] && break
        (( rc != 0 && i > 5 )) && break
        sleep 0.25
    done
    kill "${apid}" 2>/dev/null; wait "${apid}" 2>/dev/null
    printf '%s' "${out}"
    return ${rc}
}

# Displayed 64-hex hash from a transcript file, or empty.
transcript_hash() {
    python3 -c '
import json, sys
sys.path.insert(0, sys.argv[2])
import speculos_driver as sd
for line in open(sys.argv[1]):
    try: d = json.loads(line)
    except ValueError: continue
    if "screens" in d:
        t = sd.Transcript(d["screens"]); h = t.displayed_hash()
        if h: print(h); break
' "$1" "$(dirname "${DRIVER}")"
}

# Value shown on the device under <label> (pages of the field joined,
# whitespace removed), from a transcript file; empty if the label was not shown.
transcript_value() {
    python3 -c '
import json, sys
sys.path.insert(0, sys.argv[3])
import speculos_driver as sd
for line in open(sys.argv[1]):
    try: d = json.loads(line)
    except ValueError: continue
    if "screens" in d:
        v = sd.Transcript(d["screens"]).value_after(sys.argv[2])
        if v is not None: print("".join(v.split())); break
' "$1" "$2" "$(dirname "${DRIVER}")"
}

# Whether the device showed <value> under <label> (whitespace-insensitive) in
# a transcript file. A touch page holds several fields, so this compares the
# field itself, not everything after the label.
transcript_shows() {
    python3 -c '
import json, sys
sys.path.insert(0, sys.argv[4])
import speculos_driver as sd
for line in open(sys.argv[1]):
    try: d = json.loads(line)
    except ValueError: continue
    if "screens" in d:
        sys.exit(0 if sd.Transcript(d["screens"]).shows(sys.argv[2], sys.argv[3]) else 1)
sys.exit(1)
' "$1" "$2" "$3" "$(dirname "${DRIVER}")"
}

# Signing gate: returns 0 if <ins> is implemented; otherwise marks the
# scenario SKIP (or FAIL with REQUIRE_SIGNING=1) and returns 1.
SIGNING_JSON=""
gate() {
    local scenario="$1"; shift
    for ins in "$@"; do
        if [[ "$(jq -r ".${ins}" <<< "${SIGNING_JSON}")" != "true" ]]; then
            if [[ "${REQUIRE_SIGNING}" == 1 ]]; then
                log "scenario ${scenario}: ${ins} not implemented (0x6D00) and REQUIRE_SIGNING=1"
                RESULT[${scenario}]="FAIL"
            else
                log "scenario ${scenario}: ${ins} not implemented on the device yet (0x6D00): SKIP (signing gated)"
                RESULT[${scenario}]="SKIP(gated)"
            fi
            return 1
        fi
    done
    return 0
}

need_chain() {
    if [[ "${LEDGER_SIM_CHAIN}" == "none" ]]; then
        log "scenario $1: needs a chain (LEDGER_SIM_CHAIN=none): SKIP"
        RESULT[$1]="SKIP(no chain)"
        return 1
    fi
    return 0
}

balance_of() { cli_json getbalance "$1" | jq -er '.balance.balance'; }
nonce_of() { cli_json getaccountinfo "$1" | jq -er '.account_info.nonce // 0'; }

wait_balance() {
    local addr="$1" want="$2" i
    for i in $(seq 1 30); do
        [[ "$(balance_of "${addr}" 2>/dev/null)" == "${want}" ]] && return 0
        sleep 1
    done
    log "balance of ${addr} != ${want} (is $(balance_of "${addr}" 2>/dev/null))"
    return 1
}

address_of() { cli_json getbalance "$1" | jq -er '.balance.pubkey // .balance.account // .balance.address'; }
token_amount() { cli_json token balance "$1" --token-program "${TOKEN_PROGRAM}" 2>/dev/null | jq -r '.token_balance.amount'; }

wait_token() {
    local i
    for i in $(seq 1 30); do
        [[ "$(token_amount "$1")" == "$2" ]] && return 0
        sleep 1
    done
    log "token balance of $1 is $(token_amount "$1"), want $2"
    return 1
}

# Token account for <mint> <owner> <seed hex>, created by acc_2.
token_account() {
    local out
    out="$(cli_json token initialize-account "$1" "$2" "$3" --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}")" || \
        { log "initialize-account: ${out}"; return 1; }
    jqv '.token_initialize_account.token_account' "${out}"
}

# Value of the <label> field in a JSON ledger_preview.
preview_field() { jq -r --arg l "$2" '[.fields[] | select(.label == $l) | .value][0] // empty' <<< "$1"; }

pass() { RESULT[$1]="PASS"; log "scenario $1: PASS"; }
fail() { RESULT[$1]="FAIL"; log "scenario $1: FAIL: $2"; }

# ---------------------------------------------------------------------------
# Scenarios (plan §6.5)
# ---------------------------------------------------------------------------

# 1a. Derive the Ledger address and verify it on the device (runs today).
scenario_1a() {
    local expected out
    expected="$(hd_address 0)"
    out="$(on_device approve s1a-add-ledger --json keys add-ledger ledger0 --account 0)" || { fail 1a "add-ledger: ${out}"; return; }
    LEDGER_ADDR="$(jqv '.ledger_key.public_key' "${out}")" || { fail 1a "no address in ${out}"; return; }
    [[ "${LEDGER_ADDR}" == "${expected}" ]] || { fail 1a "address ${LEDGER_ADDR} != corpus ${expected}"; return; }
    # Speculos is an emulator: the CLI must never call this a hardware
    # verification (audit A-018).
    [[ "$(jqv '.ledger_key.verified_on_emulator' "${out}")" == "true" ]] || { fail 1a "not verified on the emulator"; return; }
    [[ "$(jq -r '.ledger_key.verified_on_device' <<< "${out}")" == "false" ]] || { fail 1a "emulator reported as a hardware device"; return; }
    [[ "$(jq -r '.ledger_key.transport' <<< "${out}")" == "speculos" ]] || { fail 1a "transport not reported as speculos"; return; }
    grep -q "EMULATOR, NOT A HARDWARE DEVICE" "${RESULTS_DIR}/s1a-add-ledger.stderr" || { fail 1a "no emulator warning on stderr"; return; }
    grep -q "${LEDGER_ADDR:0:12}" "${RESULTS_DIR}/s1a-add-ledger.jsonl" || \
        grep -q "${LEDGER_ADDR:0:10}" "${RESULTS_DIR}/s1a-add-ledger.jsonl" || \
        { fail 1a "device did not display the address"; return; }
    # keys show --verify displays it again.
    out="$(on_device approve s1a-show-verify --json keys show ledger0 --verify)" || { fail 1a "keys show --verify: ${out}"; return; }
    # Rejecting the address on the device must not store the key.
    if out="$(on_device reject s1a-reject --json keys add-ledger ledger_rejected --account 1)"; then
        fail 1a "add-ledger succeeded although the user rejected: ${out}"; return
    fi
    if cli_json keys get ledger_rejected >/dev/null 2>&1; then
        fail 1a "rejected key was stored"; return
    fi
    # The key the chain scenarios use (LEDGER_ACCOUNT; 0 = the corpus key).
    if [[ "${LEDGER_ACCOUNT}" == 0 ]]; then
        MAIN_ADDR="${LEDGER_ADDR}"
        cli_json keys add-ledger ledger_main --account 0 --no-verify >/dev/null || { fail 1a "add ledger_main"; return; }
    else
        out="$(on_device approve s1a-add-main --json keys add-ledger ledger_main --account "${LEDGER_ACCOUNT}")" || { fail 1a "add-ledger main: ${out}"; return; }
        MAIN_ADDR="$(jqv '.ledger_key.public_key' "${out}")" || { fail 1a "no main address in ${out}"; return; }
        grep -q "${MAIN_ADDR:0:10}" "${RESULTS_DIR}/s1a-add-main.jsonl" || { fail 1a "device did not display ${MAIN_ADDR}"; return; }
    fi
    log "chain scenarios use Ledger account ${LEDGER_ACCOUNT}: ${MAIN_ADDR}"
    pass 1a
}

# 1b. Create the Ledger EOA: SIGN_EOA_AUTH on the device, fee paid by acc_0.
scenario_1b() {
    need_chain 1b || return
    gate 1b sign_eoa_auth || return
    [[ -n "${MAIN_ADDR}" ]] || { fail 1b "scenario 1a did not provide the Ledger key"; return; }
    if cli_json getaccountinfo "${MAIN_ADDR}" >/dev/null 2>&1; then
        log "Ledger EOA already exists (re-run); create-eoa skipped"
        pass 1b; return
    fi
    local out
    out="$(on_device approve s1b-create-eoa --json account create-eoa --ledger ledger_main --fee-payer acc_0)" || { fail 1b "${out}"; return; }
    local i
    for i in $(seq 1 30); do
        cli_json getaccountinfo "${MAIN_ADDR}" >/dev/null 2>&1 && { pass 1b; return; }
        sleep 1
    done
    fail 1b "EOA ${MAIN_ADDR} not found after create-eoa"
}

# 2. Native transfer from the Ledger EOA; balances and nonce on chain.
scenario_2() {
    need_chain 2 || return
    gate 2 sign_txn || return
    local b0 b1 n0 out pre
    # Fund the Ledger EOA from acc_0.
    pre="$(balance_of "${MAIN_ADDR}")"
    cli_json transfer acc_0 "${MAIN_ADDR}" "${LEDGER_FUND}" >/dev/null || { fail 2 "funding transfer failed"; return; }
    wait_balance "${MAIN_ADDR}" "$(( pre + LEDGER_FUND ))" || { fail 2 "funding not visible"; return; }
    b0="$(balance_of ledger_main)"; b1="$(balance_of acc_1)"; n0="$(nonce_of "${MAIN_ADDR}")"
    out="$(on_device approve s2-transfer --json transfer ledger_main acc_1 5)" || { fail 2 "transfer: ${out}"; return; }
    wait_balance acc_1 "$(( b1 + 5 ))" || { fail 2 "acc_1 balance"; return; }
    local b0_after n_after
    b0_after="$(balance_of ledger_main)"; n_after="$(nonce_of "${MAIN_ADDR}")"
    (( b0_after < b0 - 4 )) || { fail 2 "ledger balance ${b0} -> ${b0_after}"; return; }
    (( n_after == n0 + 1 )) || { fail 2 "nonce ${n0} -> ${n_after}"; return; }
    local shown; shown="$(transcript_hash "${RESULTS_DIR}/s2-transfer.jsonl")"
    [[ -n "${shown}" ]] || { fail 2 "no transaction hash on the device screen"; return; }
    log "device showed transaction hash ${shown}"
    # Preview parity (spec 11.3): the CLI printed the same hash before the
    # device prompt, and reports it in the JSON output.
    grep -q "Transaction hash: ${shown}" "${RESULTS_DIR}/s2-transfer.stderr" || \
        { fail 2 "CLI did not print the device's transaction hash ${shown}"; return; }
    [[ "$(jq -r '.transfer.ledger_preview.transaction_hash' <<< "${out}")" == "${shown}" ]] || \
        { fail 2 "JSON ledger_preview hash != device hash ${shown}"; return; }
    pass 2
}

# 3. Token transfers through `thru token transfer`, with blind signing off:
#    both token transfer instructions review in clear (spec §7.7). The CLI
#    sends TransferChecked unless --unchecked is passed; the device shows its
#    amount in whole units with the ticker (B.7) and the mint.
#    3a. TransferChecked between the default token accounts of the Ledger and
#        acc_1. The CLI sends the token hint (§7.2.1); device and CLI preview
#        show the two owners, the amount, the mint and "Token account owners".
#    3b. TransferChecked to an acc_1 token account with its own seed. No hint:
#        the CLI prints a note and the device shows the token accounts, the
#        amount and the mint.
#    3c. --unchecked: the plain Transfer to the same account. The device
#        shows the amount in base units and no mint.
scenario_3() {
    need_chain 3 || return
    gate 3 sign_txn || return
    driver blind-signing off >/dev/null || { fail 3 "could not turn blind signing off"; return; }
    scenario_3_transfers
    driver blind-signing on >/dev/null || fail 3 "could not turn blind signing back on"
}

scenario_3_transfers() {
    local zero mint_seed out mint acc1 acc2 src dst other
    zero="$(printf '%064d' 0)"; mint_seed="$(openssl rand -hex 32)"
    acc1="$(address_of acc_1)" || { fail 3 "no acc_1 address"; return; }
    acc2="$(address_of acc_2)" || { fail 3 "no acc_2 address"; return; }
    out="$(cli_json token initialize-mint "${acc2}" --decimals 9 LDG "${mint_seed}" --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}")" || { fail 3 "mint: ${out}"; return; }
    mint="$(jqv '.token_initialize_mint.mint_account' "${out}")"
    src="$(token_account "${mint}" "${MAIN_ADDR}" "${zero}")" || { fail 3 "Ledger token account"; return; }
    dst="$(token_account "${mint}" "${acc1}" "${zero}")" || { fail 3 "acc_1 default token account"; return; }
    other="$(token_account "${mint}" "${acc1}" "$(openssl rand -hex 32)")" || { fail 3 "acc_1 seeded token account"; return; }
    log "mint ${mint}; Ledger token account ${src}; acc_1 default ${dst}, seeded ${other}"
    cli_json token mint-to "${mint}" "${src}" "${acc2}" 1000 --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}" >/dev/null || { fail 3 "mint-to"; return; }
    wait_token "${src}" 1000 || { fail 3 "minted balance not visible"; return; }

    # 3a. Hinted TransferChecked. The mint has 9 decimals: 200 base units are
    #     0.0000002, and the ticker LDG has its own field.
    local name=s3-token-hinted n0 b0 preview shown fee
    n0="$(nonce_of "${MAIN_ADDR}")"; b0="$(balance_of "${MAIN_ADDR}")"
    out="$(on_device approve "${name}" --json token transfer "${src}" "${dst}" 200 --fee-payer ledger_main \
        --token-program "${TOKEN_PROGRAM}")" || { fail 3 "hinted transfer: ${out}"; return; }
    [[ "$(jq -r '.token_transfer.instruction' <<< "${out}")" == transfer_checked ]] || \
        { fail 3 "hinted: the CLI did not send TransferChecked"; return; }
    preview="$(jq -ce '.token_transfer.ledger_preview' <<< "${out}")" || { fail 3 "no ledger_preview in ${out}"; return; }
    shown="$(transcript_hash "${RESULTS_DIR}/${name}.jsonl")"
    [[ -n "${shown}" && "$(jq -r '.transaction_hash' <<< "${preview}")" == "${shown}" ]] || \
        { fail 3 "hinted: device hash ${shown:-<none>} does not match the CLI preview"; return; }
    grep -Eq "Transaction hash: +${shown}" "${RESULTS_DIR}/${name}.stderr" || \
        { fail 3 "hinted: CLI did not print the device's transaction hash"; return; }
    [[ "$(jq -r '.requires_blind_signing' <<< "${preview}")" == false ]] || { fail 3 "hinted: preview requires blind signing"; return; }
    local label want
    for label in "Source=${MAIN_ADDR}" "Recipient=${acc1}" "Amount=0.0000002" "Ticker=LDG" "Token mint=${mint}" \
        "Address type=Token account owners"; do
        want="${label#*=}"; label="${label%%=*}"
        [[ "$(preview_field "${preview}" "${label}")" == "${want}" ]] || { fail 3 "hinted: CLI preview ${label} != ${want}"; return; }
        transcript_shows "${RESULTS_DIR}/${name}.jsonl" "${label}" "${want}" || \
            { fail 3 "hinted: device ${label} != ${want}"; return; }
    done
    wait_token "${dst}" 200 || { fail 3 "hinted: destination balance"; return; }
    [[ "$(token_amount "${src}")" == 800 ]] || { fail 3 "hinted: source balance $(token_amount "${src}"), want 800"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 3 "hinted: Ledger nonce did not advance once"; return; }
    fee="$(jq -er '.fee_base_units' <<< "${preview}")" || { fail 3 "no fee in the preview"; return; }
    wait_balance "${MAIN_ADDR}" "$(( b0 - fee ))" || { fail 3 "hinted: Ledger did not pay the previewed fee ${fee}"; return; }
    log "3a: hinted TransferChecked reviewed with owners, amount and mint, hash ${shown}, fee ${fee}"

    # 3b. TransferChecked without a hint (text output: the note is not printed
    #     with --json).
    name=s3-token-unhinted
    n0="$(nonce_of "${MAIN_ADDR}")"
    out="$(on_device approve "${name}" token transfer "${src}" "${other}" 50 --fee-payer ledger_main \
        --token-program "${TOKEN_PROGRAM}")" || { fail 3 "unhinted transfer: ${out}"; return; }
    grep -q "the Ledger will show the token accounts, not their owners" "${RESULTS_DIR}/${name}.stderr" || \
        { fail 3 "unhinted: no CLI note about the token accounts"; return; }
    shown="$(transcript_hash "${RESULTS_DIR}/${name}.jsonl")"
    if [[ -z "${shown}" ]] || ! grep -Eq "Transaction hash: +${shown}" "${RESULTS_DIR}/${name}.stderr"; then
        fail 3 "unhinted: CLI did not print the device's transaction hash ${shown:-<none>}"; return
    fi
    for label in "Source=${src}" "Recipient=${other}" "Amount=0.00000005" "Ticker=LDG" "Token mint=${mint}" \
        "Address type=Token accounts"; do
        want="${label#*=}"; label="${label%%=*}"
        transcript_shows "${RESULTS_DIR}/${name}.jsonl" "${label}" "${want}" || \
            { fail 3 "unhinted: device ${label} != ${want}"; return; }
    done
    [[ -z "$(transcript_value "${RESULTS_DIR}/${name}.jsonl" "Token identity")" ]] || \
        { fail 3 "unhinted: device showed Token identity for a TransferChecked"; return; }
    wait_token "${other}" 50 || { fail 3 "unhinted: destination balance"; return; }
    [[ "$(token_amount "${src}")" == 750 ]] || { fail 3 "unhinted: source balance $(token_amount "${src}"), want 750"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 3 "unhinted: Ledger nonce did not advance once"; return; }
    log "3b: unhinted TransferChecked reviewed with the token accounts, amount and mint, hash ${shown}"

    # 3c. --unchecked: the plain Transfer, to the same seeded account.
    name=s3-token-unchecked
    n0="$(nonce_of "${MAIN_ADDR}")"
    out="$(on_device approve "${name}" --json token transfer "${src}" "${other}" 25 --unchecked \
        --fee-payer ledger_main --token-program "${TOKEN_PROGRAM}")" || { fail 3 "unchecked transfer: ${out}"; return; }
    [[ "$(jq -r '.token_transfer.instruction' <<< "${out}")" == transfer ]] || \
        { fail 3 "unchecked: the CLI did not send the plain Transfer"; return; }
    preview="$(jq -ce '.token_transfer.ledger_preview' <<< "${out}")" || { fail 3 "no ledger_preview in ${out}"; return; }
    shown="$(transcript_hash "${RESULTS_DIR}/${name}.jsonl")"
    [[ -n "${shown}" && "$(jq -r '.transaction_hash' <<< "${preview}")" == "${shown}" ]] || \
        { fail 3 "unchecked: device hash ${shown:-<none>} does not match the CLI preview"; return; }
    for label in "Source=${src}" "Recipient=${other}" "Amount (base units)=25" "Address type=Token accounts" \
        "Token identity=Not provided by transaction"; do
        want="${label#*=}"; label="${label%%=*}"
        [[ "$(preview_field "${preview}" "${label}")" == "${want}" ]] || { fail 3 "unchecked: CLI preview ${label} != ${want}"; return; }
        transcript_shows "${RESULTS_DIR}/${name}.jsonl" "${label}" "${want}" || \
            { fail 3 "unchecked: device ${label} != ${want}"; return; }
    done
    [[ -z "$(transcript_value "${RESULTS_DIR}/${name}.jsonl" "Token mint")" ]] || { fail 3 "unchecked: device showed a token mint"; return; }
    wait_token "${other}" 75 || { fail 3 "unchecked: destination balance"; return; }
    [[ "$(token_amount "${src}")" == 725 ]] || { fail 3 "unchecked: source balance $(token_amount "${src}"), want 725"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 3 "unchecked: Ledger nonce did not advance once"; return; }
    log "3c: plain Transfer reviewed with the token accounts in base units, hash ${shown}"

    if [[ -n "${TOKEN_INDEXER_URL}" ]]; then
        local i src_amt dst_amt
        for i in $(seq 1 30); do
            src_amt="$(curl -fsS --max-time 5 "${TOKEN_INDEXER_URL%/}/v1/token-accounts/${src}" | \
                jq -er --arg address "${src}" --arg mint "${mint}" '.data | select(.address == $address and .mint == $mint) | .amount')"
            dst_amt="$(curl -fsS --max-time 5 "${TOKEN_INDEXER_URL%/}/v1/token-accounts/${dst}" | \
                jq -er --arg address "${dst}" --arg mint "${mint}" '.data | select(.address == $address and .mint == $mint) | .amount')"
            [[ "${src_amt}" == 725 && "${dst_amt}" == 200 ]] && break
            sleep 1
        done
        [[ "${src_amt}" == 725 && "${dst_amt}" == 200 ]] || { fail 3 "indexed token balances ${src_amt}/${dst_amt}, want 725/200"; return; }
        log "token indexer verified source=725 destination=200"
    else
        log "token indexer not configured; this run qualifies chain balances only"
    fi
    pass 3
}

# 4. Sign a message (ASCII and binary); signatures match the corpus
#    (deterministic Ed25519) and are strictly verified by the CLI.
scenario_4() {
    gate 4 sign_message || return
    local out want
    want="$(jq -er '.[] | select(.name=="ledger_msg_hello") | .signature_hex' "${CORPUS}/message_vectors.json")"
    out="$(on_device approve s4-ascii --json message sign --key ledger0 hello)" || { fail 4 "ascii: ${out}"; return; }
    [[ "$(jqv '.message_sign.signature_hex' "${out}")" == "${want}" ]] || { fail 4 "ascii signature != corpus"; return; }
    local hexmsg
    hexmsg="$(jq -er '.[] | select(.name=="binary_with_nuls") | .message_hex' "${CORPUS}/message_vectors.json")"
    want="$(jq -er '.[] | select(.name=="binary_with_nuls") | .signature_hex' "${CORPUS}/message_vectors.json")"
    out="$(on_device approve s4-binary --json message sign --key ledger0 --hex "${hexmsg}")" || { fail 4 "binary: ${out}"; return; }
    [[ "$(jqv '.message_sign.signature_hex' "${out}")" == "${want}" ]] || { fail 4 "binary signature != corpus"; return; }
    local shown
    shown="$(transcript_hash "${RESULTS_DIR}/s4-binary.jsonl")"
    [[ "${shown}" == "$(jq -er '.[] | select(.name=="binary_with_nuls") | .message_sha256_hex' "${CORPUS}/message_vectors.json")" ]] || \
        { fail 4 "device message hash ${shown:-<none>} != sha256(message)"; return; }
    grep -q "Message hash: ${shown}" "${RESULTS_DIR}/s4-binary.stderr" || \
        { fail 4 "CLI did not print the device's message hash ${shown}"; return; }
    [[ "$(jq -r '.message_sign.ledger_preview.message_hash' <<< "${out}")" == "${shown}" ]] || \
        { fail 4 "JSON ledger_preview hash != device hash ${shown}"; return; }
    pass 4
}

# 6. A transaction carrying a fee-payer state proof: a fresh Ledger account
#    creates itself (`account create`, CREATING proof in the body); the
#    device streams the proof section and the node accepts it. (An EXISTING
#    proof + meta needs a compressed account; see the TS suite / plan.)
scenario_6() {
    need_chain 6 || return
    gate 6 sign_txn || return
    local account out addr i
    # A fresh account every run, away from the low indexes others may use.
    account=$(( LEDGER_ACCOUNT + 1 + RANDOM % 100000 ))
    out="$(cli_json keys add-ledger ledger_fp --account "${account}" --no-verify 2>/dev/null)" || { fail 6 "add-ledger: ${out}"; return; }
    addr="$(jqv '.ledger_key.public_key' "${out}")"
    out="$(on_device approve s6-fee-payer-proof --json account create ledger_fp)" || { fail 6 "account create: ${out}"; return; }
    for i in $(seq 1 30); do
        cli_json getaccountinfo "${addr}" >/dev/null 2>&1 && { pass 6; return; }
        sleep 1
    done
    fail 6 "account ${addr} not created"
}

# 7. Successful near-MTU NOOP transaction. CLI txn execute cannot attach a
#    creation proof; the combined creation case runs through TS/browser.
#    This timer includes the CLI call, review and node execution, not just APDUs.
scenario_7() {
    need_chain 7 || return
    gate 7 sign_txn || return
    local instr start end out n0 shown
    instr="$(python3 -c 'print("00"*32500)')"
    n0="$(nonce_of "${MAIN_ADDR}")"
    start=$(date +%s%N)
    out="$(on_device approve s7-mtu --json txn execute "${NOOP_PROGRAM}" "${instr}" --fee-payer ledger_main \
        --compute-units 1000000 --memory-units 10000 --state-units 1)" || { fail 7 "near-MTU execution failed: ${out}"; return; }
    end=$(date +%s%N)
    log "near-MTU: 32500 instruction bytes, $(( (end - start) / 1000000 )) ms CLI call -> successful execution"
    echo "{\"near_mtu_call_to_execution_ms\": $(( (end - start) / 1000000 ))}" > "${RESULTS_DIR}/s7-timing.json"
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 7 "near-MTU nonce did not advance once"; return; }
    shown="$(transcript_hash "${RESULTS_DIR}/s7-mtu.jsonl")"
    [[ -n "${shown}" && "$(jq -r '.transaction_execute.ledger_preview.transaction_hash' <<< "${out}")" == "${shown}" ]] || \
        { fail 7 "near-MTU device hash does not match CLI preview"; return; }
    pass 7
}

# 8. Expiry: approve only after the validity window passed; the node
#    rejects and the CLI reports it.
scenario_8() {
    need_chain 8 || return
    gate 8 sign_txn || return
    local out
    driver auto-approve --kind review --once > "${RESULTS_DIR}/s8-expiry.jsonl" 2>&1 &
    # Hold the review: stop the approver from acting by pausing it.
    local apid=$!
    kill -STOP "${apid}"
    ( sleep 20; kill -CONT "${apid}" ) &
    local n0; n0="$(nonce_of "${MAIN_ADDR}")"
    if out="$(cli --json txn execute "$(cli_json getbalance acc_1 | jq -er '.balance.pubkey // .balance.account // empty' || echo acc_1)" 00 \
            --fee-payer ledger_main --expiry-after 1 2>&1)"; then
        fail 8 "expired transaction succeeded: ${out}"
    elif ! grep -qi "expir" <<< "${out}"; then
        fail 8 "unexpected error (want an expiry rejection): ${out}"
    elif [[ "$(nonce_of "${MAIN_ADDR}")" != "${n0}" ]]; then
        fail 8 "nonce changed although the transaction expired"
    else
        pass 8
    fi
    # The approver exits after one review; if none appeared, stop it.
    kill -CONT "${apid}" 2>/dev/null
    kill "${apid}" 2>/dev/null
    wait "${apid}" 2>/dev/null
}

# 9. User reject at the device: UserRejected, nothing broadcast.
scenario_9() {
    need_chain 9 || return
    gate 9 sign_txn || return
    local n0 out
    n0="$(nonce_of "${MAIN_ADDR}")"
    if out="$(on_device reject s9-reject --json transfer ledger_main acc_1 1)"; then
        fail 9 "transfer succeeded although rejected: ${out}"; return
    fi
    grep -qi "reject" <<< "${out}" || { fail 9 "error does not say rejected: ${out}"; return; }
    sleep 3
    [[ "$(nonce_of "${MAIN_ADDR}")" == "${n0}" ]] || { fail 9 "nonce changed: something was broadcast"; return; }
    pass 9
}

# ---------------------------------------------------------------------------

# Build the Speculos-enabled CLI when using the default binary path.
ensure_cli() {
    if [[ ! -x "${THRU_CLI_BIN}" && "${THRU_CLI_BIN}" == "${SPECULOS_CLI_TARGET}/release/thru" ]]; then
        log "building the thru CLI with the ledger-speculos test feature into ${SPECULOS_CLI_TARGET}"
        cargo build --release --manifest-path "${REPO_ROOT}/rpc/cli/Cargo.toml" -p thru \
            --features ledger-speculos --target-dir "${SPECULOS_CLI_TARGET}" >&2 || return 1
    fi
    [[ -x "${THRU_CLI_BIN}" ]] || { log "thru CLI not found at ${THRU_CLI_BIN}"; return 1; }
}

# A release CLI refuses THRU_LEDGER_SPECULOS; say so instead of failing every
# scenario.
check_cli_speculos() {
    local out
    out="$(cli --json keys show ledger://44\'/8478\'/0\'/0\' 2>&1)"
    if grep -q speculos_unsupported <<< "${out}"; then
        log "${THRU_CLI_BIN} was built without the ledger-speculos feature; rebuild with"
        log "  cargo build --release -p thru --features ledger-speculos (rpc/cli)"
        return 1
    fi
}

main() {
    command -v jq >/dev/null || { log "jq required"; exit 1; }
    ensure_cli || exit 1
    driver wait-ready --timeout 60 >/dev/null || { log "Speculos not reachable"; exit 1; }
    seed_config || exit 1
    check_cli_speculos || exit 1
    SIGNING_JSON="$(driver probe-signing)"
    log "device=${SPECULOS_MODEL} signing=${SIGNING_JSON} chain=${LEDGER_SIM_CHAIN}"
    if [[ "$(jq -r .sign_txn <<< "${SIGNING_JSON}")" == true ]]; then
        driver blind-signing on >/dev/null
    fi
    local s
    IFS=',' read -ra list <<< "${SCENARIOS}"
    for s in "${list[@]}"; do
        log "=== scenario ${s}"
        "scenario_${s}"
    done
    # Scenario 5 (passkey wallet + Ledger authority) needs a virtual passkey:
    # TS / wallet suites.
    RESULT[5]="N/A(ts,wallet)"

    log "=== summary"
    local rc=0
    for s in 1a 1b 2 3 4 5 6 7 8 9; do
        [[ -n "${RESULT[${s}]:-}" ]] || continue
        log "  scenario ${s}: ${RESULT[${s}]}"
        [[ "${RESULT[${s}]}" == FAIL ]] && rc=1
    done
    exit ${rc}
}

# Sourcing (test_ledger_on_device_approver.sh) only loads the helpers.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
