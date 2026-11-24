#!/usr/bin/env bash
#
# thru_cli_trezor_e2e.sh - Trezor end-to-end scenarios through the thru CLI:
# `trezor://` keys on the Safe 7 emulator (THRU_TREZOR_EMULATOR) and a local
# chain. The device-side counterpart of thru_cli_ledger_e2e.sh.
#
# Start the emulator first, with trezor/sim/up.sh (it writes sim.env), and run
#
#   TREZOR_SIM_ENV=<sim dir>/sim.env \
#   THRU_CLI_BIN=<thru built with --features trezor-emulator> \
#   RPC_BASE_URL=http://127.0.0.1:8472 \
#     rpc/cli/tests/thru_cli_trezor_e2e.sh
#
# Every signed request is planned before it is sent (host_screens.py plan:
# approve, refuse at a named step, or hold the approval back), and the screens
# the device showed are compared with the `trezor_preview` the CLI printed
# (host_screens.py compare): the same steps, titles, fields, notes and menus.
#
# Environment:
#   TREZOR_SIM_ENV        the sim.env that trezor/sim/up.sh wrote. It gives
#                         THRU_TREZOR_EMULATOR, THRU_TREZOR_APP, TREZOR_PATH,
#                         TREZOR_SIM_PLANS, TREZOR_SIM_CAPTURES, TREZOR_SIM_LOGS,
#                         TREZOR_SIM_HOME, TREZOR_SIM_PYTHON and
#                         TREZOR_SIM_SCREENS; each may
#                         also be set directly.
#   THRU_CLI_BIN          thru binary built with the test-only `trezor-emulator`
#                         feature (a release CLI refuses THRU_TREZOR_EMULATOR).
#                         Default: rpc/cli/target/trezor-emulator/release/thru,
#                         built on first use with
#                         cargo build --release -p thru --features trezor-emulator
#   RPC_BASE_URL          chain RPC (default http://127.0.0.1:8472)
#   TREZOR_SIM_CHAIN      none = device-only scenarios (1a, 4, 9a); anything
#                         else = all (default external)
#   SCENARIOS             comma list (default 1a,1b,2,3,4,6,7,8,9a,9b)
#   RESULTS_DIR           where transcripts, previews and captures are written
#                         (default a temp dir)
#   E2E_ADDRESSES_FILE    generated bootstrap addresses (default
#                         programs/bootstrap/generated/e2e-addresses.sh)
#   TOKEN_PROGRAM         token program (default: the bootstrap one)
#   TREZOR_ACCOUNT        account index of the Trezor key used on chain
#                         (default 0). The emulator's wallet is the public
#                         "abandon x11 about" mnemonic: on a public chain use a
#                         fresh, high index.
#   FUNDER_KEY_HEX        private key (hex) of a funded key that pays fees and
#                         funds the Trezor account (default: genesis key 0)
#   DEST_KEY_HEX          private key (hex) of an existing transfer destination
#                         (default: genesis key 1)
#   TREZOR_FUND           native amount moved to the Trezor EOA when it is short
#                         (default 1000000)
#   SLOT_WAIT_SECONDS     how long scenario 8 waits for the chain's slot to pass
#                         the end of the validity window (default 300)
#
# Scenarios (the numbers follow the Ledger script where the scenario does):
#   1a  register the key on the device; the address equals the shared vector
#       (no chain)
#   1b  `account create-eoa` with the Trezor key as the account, a local key as
#       the fee payer; the account exists on chain
#   2   native transfer; balances and nonce on chain
#   3   token transfer with a hint (TransferChecked, owners shown) and without
#       one (the token accounts shown); token balances and nonce on chain
#   4   `message sign`: the signature equals the shared vector and verifies
#       under the public key (no chain)
#   6   `account create`: a fresh Trezor account creates itself; it exists on
#       chain
#   7   a wallet-program transfer through `txn sign` (and `txn execute`) in the
#       layout the app signs
#   8   the approval is given only after the chain's slot passed the end of the
#       validity window: the node rejects it, the CLI says so, the nonce is
#       unchanged
#   9a  a message refused on the device (no chain)
#   9b  a transfer refused on the device: the error says so, nothing is
#       submitted, the nonce and the balances are unchanged
#
# Status per scenario: PASS, FAIL, SKIP(no chain). Exit status 1 on any FAIL.

set -uo pipefail
export PYTHONDONTWRITEBYTECODE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CORPUS="${REPO_ROOT}/contrib/test/vectors/signing"

if [[ -n "${TREZOR_SIM_ENV:-}" ]]; then
    [[ -f "${TREZOR_SIM_ENV}" ]] || { echo "TREZOR_SIM_ENV ${TREZOR_SIM_ENV} does not exist" >&2; exit 1; }
    # shellcheck source=/dev/null
    source "${TREZOR_SIM_ENV}"
fi
# shellcheck source=/dev/null
source "${E2E_ADDRESSES_FILE:-${REPO_ROOT}/programs/bootstrap/generated/e2e-addresses.sh}"

EMULATOR_CLI_TARGET="${REPO_ROOT}/rpc/cli/target/trezor-emulator"
THRU_CLI_BIN="${THRU_CLI_BIN:-${EMULATOR_CLI_TARGET}/release/thru}"
RPC_BASE_URL="${RPC_BASE_URL:-http://127.0.0.1:8472}"
TREZOR_SIM_CHAIN="${TREZOR_SIM_CHAIN:-external}"
TOKEN_PROGRAM="${TOKEN_PROGRAM:-${BOOTSTRAP_TOKEN_PROGRAM_ADDRESS}}"
EOA_PROGRAM="${BOOTSTRAP_EOA_PROGRAM_ADDRESS}"
WALLET_PROGRAM="${BOOTSTRAP_WALLET_PROGRAM_ADDRESS}"
SCENARIOS="${SCENARIOS:-1a,1b,2,3,4,6,7,8,9a,9b}"
TREZOR_ACCOUNT="${TREZOR_ACCOUNT:-0}"
FUNDER_KEY_HEX="${FUNDER_KEY_HEX:-0000000000000000000000000000000000000000000000000000000000000000}"
DEST_KEY_HEX="${DEST_KEY_HEX:-0100000000000000000000000000000000000000000000000000000000000000}"
TREZOR_FUND="${TREZOR_FUND:-1000000}"
SLOT_WAIT_SECONDS="${SLOT_WAIT_SECONDS:-300}"
RESULTS_DIR="${RESULTS_DIR:-$(mktemp -d)}"
mkdir -p "${RESULTS_DIR}"

PLANS="${TREZOR_SIM_PLANS:-}"
CAPTURES="${TREZOR_SIM_CAPTURES:-}"
export THRU_TREZOR_EMULATOR="${THRU_TREZOR_EMULATOR:-}"
export THRU_TREZOR_APP="${THRU_TREZOR_APP:-}"
export TREZOR_PATH="${TREZOR_PATH:-}"

CLI_HOME="${TREZOR_SIM_HOME:-}"
if [[ -z "${CLI_HOME}" ]]; then
    CLI_HOME="$(mktemp -d)"
    trap 'rm -rf "${CLI_HOME}"' EXIT
fi
CONFIG_DIR="${CLI_HOME}/.thru/cli"

declare -A RESULT=()
TZ0_ADDR=""    # account 0: the shared vectors' key
MAIN_ADDR=""   # TREZOR_ACCOUNT: every chain scenario
DEV_OUT=""     # stdout of the last run_signed
DEV_ALL=""     # stdout and stderr of the last run_signed
DEV_RC=0
DEV_SCREEN=0   # 1 when the last run_signed showed a review

log() { printf '[cli-trezor %s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
cli() { HOME="${CLI_HOME}" "${THRU_CLI_BIN}" "$@"; }
cli_json() { cli --json "$@"; }
screens() { "${TREZOR_SIM_PYTHON}" "${TREZOR_SIM_SCREENS}" "$@"; }
jqv() { jq -er "$1" <<< "$2"; }

pass() { RESULT[$1]="PASS"; log "scenario $1: PASS"; }
fail() { RESULT[$1]="FAIL"; log "scenario $1: FAIL: $2"; }

need_chain() {
    if [[ "${TREZOR_SIM_CHAIN}" == "none" ]]; then
        log "scenario $1: needs a chain (TREZOR_SIM_CHAIN=none): SKIP"
        RESULT[$1]="SKIP(no chain)"
        return 1
    fi
    return 0
}

# Field <$2> of the shared HD vector for account <$1> (the corpus wallet, no
# passphrase), or nothing when the corpus has no such account.
hd_field() {
    jq -er --arg p "m/44'/8478'/$1'/0'" --arg f "$2" \
        '[.derivations[] | select(.mnemonic|startswith("abandon")) | select(.passphrase=="") | select(.path==$p)][0][$f]' \
        "${CORPUS}/hd_vectors.json"
}

seed_config() {
    mkdir -p "${CONFIG_DIR}"
    # Funded keys: the genesis accounts on a local chain (private key =
    # little-endian index), or FUNDER_KEY_HEX / DEST_KEY_HEX on another. acc_0
    # and acc_2 are the funder; acc_1 is the transfer destination. The CLI
    # refuses signing keys stored inline in the config, so they go into its
    # file store.
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
        printf '%s' "${key}" | cli_json keys add "${name}" --stdin --store file --overwrite >/dev/null || \
            { log "could not add key ${name}"; return 1; }
    done
}

# ---------------------------------------------------------------------------
# Running a command while the screen helper answers the device
# ---------------------------------------------------------------------------

# run_signed NAME [plan options] -- CLI ARGS...
# Plans what the screen helper does with the next review (approve unless a
# plan option says otherwise: --refuse-at TITLE, --hold-seconds S,
# --hold-file FILE), runs the CLI, and leaves NAME.out and NAME.stderr in the
# results. Sets DEV_OUT, DEV_ALL, DEV_RC and DEV_SCREEN; returns the CLI's
# status.
run_signed() {
    local name="$1"; shift
    local plan_args=()
    while (( $# )) && [[ "$1" != -- ]]; do plan_args+=("$1"); shift; done
    shift
    # A capture of this name from an earlier run must not answer for this one.
    rm -f "${PLANS}/plan.json" "${CAPTURES}/${name}.json"
    screens plan --plans "${PLANS}" --name "${name}" ${plan_args[@]+"${plan_args[@]}"} || return 99
    DEV_OUT="$(cli "$@" 2> "${RESULTS_DIR}/${name}.stderr")"; DEV_RC=$?
    printf '%s\n' "${DEV_OUT}" > "${RESULTS_DIR}/${name}.out"
    DEV_ALL="${DEV_OUT}$(cat "${RESULTS_DIR}/${name}.stderr")"
    # A plan the request did not use means no review came up for it; it must
    # not wait for the next request.
    if [[ -e "${PLANS}/plan.json" ]]; then
        rm -f "${PLANS}/plan.json"
        DEV_SCREEN=0
    else
        DEV_SCREEN=1
        # Do not let the next command inherit a review the helper is still
        # finishing after the host has returned or timed out.
        screens wait --captures "${CAPTURES}" "${name}" --timeout 60 >/dev/null || \
            { log "the screen helper did not finish ${name}"; return 99; }
    fi
    return "${DEV_RC}"
}

# The trezor_preview of section <$1> of the last command's JSON output.
preview_of() { jq -ce ".$1.trezor_preview" <<< "${DEV_OUT}"; }

# Value of the field labelled <$2> in the steps of a preview <$1>, or nothing.
preview_field() {
    jq -r --arg l "$2" '[.steps[].items[] | select(.type == "field" and .label == $l) | .value][0] // empty' <<< "$1"
}

# preview_has PREVIEW LABEL=VALUE...: every field is in the preview as given.
preview_has() {
    local preview="$1" pair label want; shift
    for pair in "$@"; do
        label="${pair%%=*}"; want="${pair#*=}"
        [[ "$(preview_field "${preview}" "${label}")" == "${want}" ]] || \
            { log "preview field ${label}: '$(preview_field "${preview}" "${label}")', want '${want}'"; return 1; }
    done
}

# review_matches NAME PREVIEW: the screens the device showed for request NAME
# equal the CLI's preview, and the request ended signed.
review_matches() {
    local name="$1" preview="$2" result
    [[ -n "${preview}" && "${preview}" != null ]] || { log "${name}: the CLI gave no preview"; return 1; }
    printf '%s\n' "${preview}" > "${RESULTS_DIR}/${name}.preview.json"
    screens wait --captures "${CAPTURES}" "${name}" --timeout 60 >/dev/null || \
        { log "${name}: the screens were never captured"; return 1; }
    cp "${CAPTURES}/${name}.json" "${RESULTS_DIR}/${name}.capture.json"
    if result="$(screens compare "${RESULTS_DIR}/${name}.preview.json" "${CAPTURES}/${name}.json" 2>&1)"; then
        log "${name}: the device's review equals the CLI's preview (${result})"
    else
        log "${name}: the device showed another review than the CLI's preview: ${result}"
        return 1
    fi
    [[ "$(screens info "${CAPTURES}/${name}.json" outcome)" == signed ]] || \
        { log "${name}: the request did not end signed"; return 1; }
}

# ---------------------------------------------------------------------------
# What the chain says
# ---------------------------------------------------------------------------

balance_of() { cli_json getbalance "$1" | jq -er '.balance.balance'; }
nonce_of() { cli_json getaccountinfo "$1" | jq -er '.account_info.nonce // 0'; }
address_of() { cli_json getbalance "$1" | jq -er '.balance.pubkey // .balance.account // .balance.address'; }
chain_slot() { cli_json getheight | jq -er '.getheight.locally_executed'; }
token_amount() { cli_json token balance "$1" --token-program "${TOKEN_PROGRAM}" 2>/dev/null | jq -r '.token_balance.amount'; }

wait_balance() {
    local addr="$1" want="$2" _
    for _ in $(seq 1 30); do
        [[ "$(balance_of "${addr}" 2>/dev/null)" == "${want}" ]] && return 0
        sleep 1
    done
    log "balance of ${addr} != ${want} (is $(balance_of "${addr}" 2>/dev/null))"
    return 1
}

wait_token() {
    for _ in $(seq 1 30); do
        [[ "$(token_amount "$1")" == "$2" ]] && return 0
        sleep 1
    done
    log "token balance of $1 is $(token_amount "$1"), want $2"
    return 1
}

wait_account() {
    for _ in $(seq 1 30); do
        cli_json getaccountinfo "$1" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

# Token account for <mint> <owner> <seed hex>, created by acc_2.
token_account() {
    local out
    out="$(cli_json token initialize-account "$1" "$2" "$3" --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}")" || \
        { log "initialize-account: ${out}"; return 1; }
    jqv '.token_initialize_account.token_account' "${out}"
}

# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------

# register_key NAME ACCOUNT [add-trezor options]: the key at account ACCOUNT of
# the device's wallet under the name NAME (an existing name is replaced).
register_key() {
    local name="$1" account="$2"; shift 2
    cli_json keys add-trezor "${name}" --account "${account}" --overwrite "$@" 2> "${RESULTS_DIR}/key-${name}.stderr"
}

# tz0 (account 0) and tz_main (TREZOR_ACCOUNT) are registered, with their
# addresses in TZ0_ADDR and MAIN_ADDR. Scenario 1a registers them with the
# address confirmed on the device; a scenario run alone registers them quietly.
ensure_keys() {
    [[ -n "${TZ0_ADDR}" && -n "${MAIN_ADDR}" ]] && return 0
    local out
    if ! out="$(cli_json keys show tz0 2>/dev/null)"; then
        register_key tz0 0 --no-verify >/dev/null || return 1
        out="$(cli_json keys show tz0)" || return 1
    fi
    TZ0_ADDR="$(jqv '.key.public_key' "${out}")" || return 1
    if ! out="$(cli_json keys show tz_main 2>/dev/null)"; then
        register_key tz_main "${TREZOR_ACCOUNT}" --no-verify >/dev/null || return 1
        out="$(cli_json keys show tz_main)" || return 1
    fi
    MAIN_ADDR="$(jqv '.key.public_key' "${out}")" || return 1
}

# The Trezor account exists on chain: created by create-eoa when it does not.
ensure_main_account() {
    cli_json getaccountinfo "${MAIN_ADDR}" >/dev/null 2>&1 && return 0
    run_signed setup-create-eoa -- --json account create-eoa tz_main --fee-payer acc_0 || \
        { log "create-eoa: ${DEV_ALL}"; return 1; }
    wait_account "${MAIN_ADDR}"
}

# The Trezor account holds at least half of TREZOR_FUND, so that a scenario
# does not depend on the one before it.
ensure_main_funded() {
    local have want
    have="$(balance_of "${MAIN_ADDR}")" || return 1
    want=$(( TREZOR_FUND / 2 ))
    (( have >= want )) && return 0
    cli_json transfer acc_0 "${MAIN_ADDR}" "${TREZOR_FUND}" >/dev/null || { log "funding transfer failed"; return 1; }
    wait_balance "${MAIN_ADDR}" "$(( have + TREZOR_FUND ))"
}

# The Trezor key, its account on chain and its balance are in place for
# scenario <$1>; otherwise that scenario fails.
prepare_main() {
    if ensure_keys && ensure_main_account && ensure_main_funded; then
        return 0
    fi
    fail "$1" "no funded Trezor account"
    return 1
}

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

# The number of address screens the screen helper has seen.
receive_screens() { grep -c "^screen: 'Receive'" "${TREZOR_SIM_LOGS}/screens.log" 2>/dev/null || true; }

# 1a. Register the key with its address confirmed on the device.
scenario_1a() {
    local expected out before receive_before
    expected="$(hd_field 0 address)" || { fail 1a "no shared vector for account 0"; return; }
    receive_before="$(receive_screens)"
    out="$(register_key tz0 0)" || { fail 1a "add-trezor: ${out} $(tail -n 3 "${RESULTS_DIR}/key-tz0.stderr")"; return; }
    TZ0_ADDR="$(jqv '.trezor_key.public_key' "${out}")" || { fail 1a "no address in ${out}"; return; }
    [[ "${TZ0_ADDR}" == "${expected}" ]] || { fail 1a "address ${TZ0_ADDR} != shared vector ${expected}"; return; }
    [[ "$(jq -r '.trezor_key.source' <<< "${out}")" == "trezor://44'/8478'/0'/0'" ]] || { fail 1a "wrong source in ${out}"; return; }
    # The emulator is not hardware: the CLI must never report a verification
    # on a hardware device.
    [[ "$(jq -r '.trezor_key.verified_on_emulator' <<< "${out}")" == true ]] || { fail 1a "not verified on the emulator"; return; }
    [[ "$(jq -r '.trezor_key.verified_on_device' <<< "${out}")" == false ]] || { fail 1a "emulator reported as a hardware device"; return; }
    grep -q "using the Trezor EMULATOR, NOT A HARDWARE DEVICE" "${RESULTS_DIR}/key-tz0.stderr" || { fail 1a "no emulator warning on stderr"; return; }
    # The address was shown on the device (a 'Receive' screen).
    (( $(receive_screens) > receive_before )) || { fail 1a "the device never showed the address"; return; }
    out="$(cli_json keys show tz0 --verify)" || { fail 1a "keys show --verify: ${out}"; return; }
    [[ "$(jq -r '.key.public_key' <<< "${out}")" == "${expected}" ]] || { fail 1a "keys show --verify: another address"; return; }
    # A name that is taken is refused, and the configuration stays as it was.
    before="$(cat "${CONFIG_DIR}/config.yaml")"
    if out="$(cli_json keys add-trezor tz0 --account 0 2>&1)"; then
        fail 1a "a second add-trezor of tz0 succeeded: ${out}"; return
    fi
    grep -q -- "--overwrite" <<< "${out}" || { fail 1a "the refusal does not name --overwrite: ${out}"; return; }
    [[ "$(cat "${CONFIG_DIR}/config.yaml")" == "${before}" ]] || { fail 1a "the refused add-trezor changed the configuration"; return; }
    # The key the chain scenarios use.
    out="$(register_key tz_main "${TREZOR_ACCOUNT}")" || { fail 1a "add-trezor tz_main: ${out}"; return; }
    MAIN_ADDR="$(jqv '.trezor_key.public_key' "${out}")" || { fail 1a "no main address in ${out}"; return; }
    if expected="$(hd_field "${TREZOR_ACCOUNT}" address)"; then
        [[ "${MAIN_ADDR}" == "${expected}" ]] || { fail 1a "account ${TREZOR_ACCOUNT}: ${MAIN_ADDR} != shared vector ${expected}"; return; }
    else
        log "the shared vectors have no account ${TREZOR_ACCOUNT}: its address is not compared"
    fi
    log "chain scenarios use Trezor account ${TREZOR_ACCOUNT}: ${MAIN_ADDR}"
    pass 1a
}

# 1b. create-eoa: the Trezor key is the account, acc_0 pays the fee.
scenario_1b() {
    need_chain 1b || return
    ensure_keys || { fail 1b "no Trezor keys"; return; }
    if cli_json getaccountinfo "${MAIN_ADDR}" >/dev/null 2>&1; then
        log "the Trezor EOA already exists (re-run); create-eoa skipped"
        pass 1b; return
    fi
    run_signed s1b-create-eoa -- --json account create-eoa tz_main --fee-payer acc_0 || { fail 1b "${DEV_ALL}"; return; }
    wait_account "${MAIN_ADDR}" || { fail 1b "EOA ${MAIN_ADDR} not found after create-eoa"; return; }
    review_matches s1b-create-eoa "$(preview_of account_create_eoa)" || { fail 1b "review"; return; }
    pass 1b
}

# 2. Native transfer from the Trezor EOA; balances and nonce on chain.
scenario_2() {
    need_chain 2 || return
    prepare_main 2 || return
    local b0 b1 n0 acc1 preview
    acc1="$(address_of acc_1)" || { fail 2 "no acc_1 address"; return; }
    b0="$(balance_of "${MAIN_ADDR}")"; b1="$(balance_of acc_1)"; n0="$(nonce_of "${MAIN_ADDR}")"
    run_signed s2-transfer -- --json transfer tz_main acc_1 5 || { fail 2 "transfer: ${DEV_ALL}"; return; }
    wait_balance acc_1 "$(( b1 + 5 ))" || { fail 2 "acc_1 balance"; return; }
    local b0_after n_after
    b0_after="$(balance_of "${MAIN_ADDR}")"; n_after="$(nonce_of "${MAIN_ADDR}")"
    (( b0_after < b0 - 4 )) || { fail 2 "Trezor balance ${b0} -> ${b0_after}"; return; }
    (( n_after == n0 + 1 )) || { fail 2 "nonce ${n0} -> ${n_after}"; return; }
    preview="$(preview_of transfer)" || { fail 2 "no trezor_preview in ${DEV_OUT}"; return; }
    preview_has "${preview}" "From=${MAIN_ADDR}" "Recipient=${acc1}" || { fail 2 "the preview names other parties"; return; }
    review_matches s2-transfer "${preview}" || { fail 2 "review"; return; }
    pass 2
}

# 3. Token transfers through `thru token transfer`.
#    3a. TransferChecked between the default token accounts of the Trezor key
#        and acc_1: the CLI sends the token hint; the review names the two
#        owners, the amount, the ticker and the mint ("Token account owners").
#    3b. TransferChecked to an acc_1 token account with its own seed: no hint;
#        the review names the fee payer, the two token accounts and the mint
#        ("Token accounts").
scenario_3() {
    need_chain 3 || return
    prepare_main 3 || return
    local zero mint_seed out mint acc1 acc2 src dst other
    zero="$(printf '%064d' 0)"; mint_seed="$(openssl rand -hex 32)"
    acc1="$(address_of acc_1)" || { fail 3 "no acc_1 address"; return; }
    acc2="$(address_of acc_2)" || { fail 3 "no acc_2 address"; return; }
    out="$(cli_json token initialize-mint "${acc2}" --decimals 9 TRZ "${mint_seed}" --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}")" || { fail 3 "mint: ${out}"; return; }
    mint="$(jqv '.token_initialize_mint.mint_account' "${out}")"
    src="$(token_account "${mint}" "${MAIN_ADDR}" "${zero}")" || { fail 3 "Trezor token account"; return; }
    dst="$(token_account "${mint}" "${acc1}" "${zero}")" || { fail 3 "acc_1 default token account"; return; }
    other="$(token_account "${mint}" "${acc1}" "$(openssl rand -hex 32)")" || { fail 3 "acc_1 seeded token account"; return; }
    log "mint ${mint}; Trezor token account ${src}; acc_1 default ${dst}, seeded ${other}"
    cli_json token mint-to "${mint}" "${src}" "${acc2}" 1000 --fee-payer acc_2 --token-program "${TOKEN_PROGRAM}" >/dev/null || { fail 3 "mint-to"; return; }
    wait_token "${src}" 1000 || { fail 3 "minted balance not visible"; return; }

    # 3a. The mint has 9 decimals: 200 base units are 0.0000002.
    local name=s3-token-hinted n0 preview
    n0="$(nonce_of "${MAIN_ADDR}")"
    run_signed "${name}" -- --json token transfer "${src}" "${dst}" 200 --fee-payer tz_main --token-program "${TOKEN_PROGRAM}" || \
        { fail 3 "hinted transfer: ${DEV_ALL}"; return; }
    [[ "$(jq -r '.token_transfer.instruction' <<< "${DEV_OUT}")" == transfer_checked ]] || { fail 3 "hinted: the CLI did not send TransferChecked"; return; }
    preview="$(preview_of token_transfer)" || { fail 3 "hinted: no trezor_preview in ${DEV_OUT}"; return; }
    preview_has "${preview}" "From=${MAIN_ADDR}" "Recipient=${acc1}" "Token mint=${mint}" \
        "Address type=Token account owners" "Amount=0.0000002" "Ticker=TRZ" || { fail 3 "hinted: the preview is not the hinted review"; return; }
    wait_token "${dst}" 200 || { fail 3 "hinted: destination balance"; return; }
    [[ "$(token_amount "${src}")" == 800 ]] || { fail 3 "hinted: source balance $(token_amount "${src}"), want 800"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 3 "hinted: the Trezor nonce did not advance once"; return; }
    review_matches "${name}" "${preview}" || { fail 3 "hinted: review"; return; }
    log "3a: hinted TransferChecked reviewed with the owners, the amount and the mint"

    # 3b. No hint: the destination is not a default token account.
    name=s3-token-unhinted
    n0="$(nonce_of "${MAIN_ADDR}")"
    run_signed "${name}" -- --json token transfer "${src}" "${other}" 50 --fee-payer tz_main --token-program "${TOKEN_PROGRAM}" || \
        { fail 3 "unhinted transfer: ${DEV_ALL}"; return; }
    [[ "$(jq -r '.token_transfer.instruction' <<< "${DEV_OUT}")" == transfer_checked ]] || { fail 3 "unhinted: the CLI did not send TransferChecked"; return; }
    preview="$(preview_of token_transfer)" || { fail 3 "unhinted: no trezor_preview in ${DEV_OUT}"; return; }
    preview_has "${preview}" "Fee payer=${MAIN_ADDR}" "From=${src}" "Recipient=${other}" "Token mint=${mint}" \
        "Address type=Token accounts" "Amount=0.00000005" "Ticker=TRZ" || { fail 3 "unhinted: the preview is not the unhinted review"; return; }
    wait_token "${other}" 50 || { fail 3 "unhinted: destination balance"; return; }
    [[ "$(token_amount "${src}")" == 750 ]] || { fail 3 "unhinted: source balance $(token_amount "${src}"), want 750"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 3 "unhinted: the Trezor nonce did not advance once"; return; }
    review_matches "${name}" "${preview}" || { fail 3 "unhinted: review"; return; }
    log "3b: unhinted TransferChecked reviewed with the fee payer, the token accounts and the mint"
    pass 3
}

# Verifies that <signature hex> signs <message hex> in the message domain under
# <public key hex> (Ed25519 over "tn_msg_sign_v1__" followed by the message).
verify_message_signature() {
    "${TREZOR_SIM_PYTHON}" - "$1" "$2" "$3" <<'PY'
import sys
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

public_key, message, signature = (bytes.fromhex(arg) for arg in sys.argv[1:4])
try:
    Ed25519PublicKey.from_public_bytes(public_key).verify(signature, b"tn_msg_sign_v1__" + message)
except InvalidSignature:
    sys.exit(1)
PY
}

# 4. Sign text messages: the signature equals the shared vector's and verifies
#    under the public key; a changed message does not verify.
scenario_4() {
    ensure_keys || { fail 4 "no Trezor keys"; return; }
    local pubkey vector name hex want out signature
    pubkey="$(hd_field 0 pubkey_hex)" || { fail 4 "no shared vector for account 0"; return; }
    for name in short_ascii ascii_with_newline; do
        vector="$(screens message "${name}")" || { fail 4 "no message vector ${name}"; return; }
        hex="$(cut -f2 <<< "${vector}")"; want="$(cut -f3 <<< "${vector}")"
        run_signed "s4-${name}" -- --json message sign --key tz0 --hex "${hex}" || { fail 4 "${name}: ${DEV_ALL}"; return; }
        out="${DEV_OUT}"
        signature="$(jqv '.message_sign.signature_hex' "${out}")" || { fail 4 "${name}: no signature in ${out}"; return; }
        [[ "${signature}" == "${want}" ]] || { fail 4 "${name}: signature ${signature} != shared vector ${want}"; return; }
        verify_message_signature "${pubkey}" "${hex}" "${signature}" || { fail 4 "${name}: the signature does not verify under the public key"; return; }
        # The check can fail: the same signature over another message.
        if verify_message_signature "${pubkey}" "${hex}00" "${signature}" 2>/dev/null; then
            fail 4 "${name}: the signature verified over a different message"; return
        fi
        [[ "$(jq -r '.message_sign.message_sha256' <<< "${out}")" == "$("${TREZOR_SIM_PYTHON}" -c 'import hashlib, sys; print(hashlib.sha256(bytes.fromhex(sys.argv[1])).hexdigest())' "${hex}")" ]] || \
            { fail 4 "${name}: the reported message hash is not sha256(message)"; return; }
        review_matches "s4-${name}" "$(preview_of message_sign)" || { fail 4 "${name}: review"; return; }
    done
    pass 4
}

# 6. A fresh Trezor account creates itself (`account create`, a CREATING proof
#    in the transaction); the node accepts the proof.
scenario_6() {
    need_chain 6 || return
    ensure_keys || { fail 6 "no Trezor keys"; return; }
    local account out addr
    # A fresh account every run, away from the low indexes others may use.
    account=$(( TREZOR_ACCOUNT + 1 + RANDOM % 100000 ))
    out="$(register_key tz_fp "${account}" --no-verify)" || { fail 6 "add-trezor: ${out}"; return; }
    addr="$(jqv '.trezor_key.public_key' "${out}")" || { fail 6 "no address in ${out}"; return; }
    if cli_json getaccountinfo "${addr}" >/dev/null 2>&1; then
        fail 6 "account ${addr} exists before it was created"; return
    fi
    run_signed s6-account-create -- --json account create tz_fp || { fail 6 "account create: ${DEV_ALL}"; return; }
    wait_account "${addr}" || { fail 6 "account ${addr} not created"; return; }
    review_matches s6-account-create "$(preview_of account_create)" || { fail 6 "review"; return; }
    pass 6
}

# The 95-byte instruction of the wallet program's Transfer, in the layout the
# app signs (the fixture's): Validate with one child call, Transfer of AMOUNT
# from account index WALLET to account index RECIPIENT, authority record 0.
wallet_transfer_instruction() { # wallet index, recipient index, amount
    python3 -c '
import struct, sys
wallet, recipient, amount = (int(a) for a in sys.argv[1:4])
data = bytearray(95)
data[0] = 1
data[1:3] = struct.pack("<H", wallet)
data[72:74] = struct.pack("<H", 1)
data[74:82] = struct.pack("<Q", 13)
data[82] = 2
data[83:85] = struct.pack("<H", wallet)
data[85:87] = struct.pack("<H", recipient)
data[87:95] = struct.pack("<Q", amount)
print(data.hex())
' "$@"
}

# 7. A wallet-program transfer, the Trezor key paying the fee. The wallet
#    account is an existing account that no wallet program owns (acc_2): the
#    wallet program rejects the transfer, so no funds move, but the node must
#    accept the Trezor's signature and charge the fee.
scenario_7() {
    need_chain 7 || return
    prepare_main 7 || return
    local wallet recipient order widx ridx instr preview n0 b0 w0 r0
    wallet="$(address_of acc_2)" || { fail 7 "no acc_2 address"; return; }
    recipient="$(address_of acc_1)" || { fail 7 "no acc_1 address"; return; }
    order="$(cli_json txn sort "${wallet}" "${recipient}")" || { fail 7 "txn sort: ${order}"; return; }
    widx=$(( 2 + $(jq -er --arg a "${wallet}" '.[$a]' <<< "${order}") ))
    ridx=$(( 2 + $(jq -er --arg a "${recipient}" '.[$a]' <<< "${order}") ))
    instr="$(wallet_transfer_instruction "${widx}" "${ridx}" 3)" || { fail 7 "instruction"; return; }
    local common=("${WALLET_PROGRAM}" "${instr}" --fee-payer tz_main
        --readwrite-accounts "${wallet}" --readwrite-accounts "${recipient}"
        --compute-units 10000 --memory-units 10000 --state-units 0)

    # The signed transaction, and what the device showed for it. Its bytes
    # are not sent anywhere: the CLI has no command that submits a signed
    # transaction. What the node takes is checked below with `txn execute`,
    # which signs the same transfer again.
    run_signed s7-wallet-sign -- --json txn sign "${common[@]}" || { fail 7 "txn sign: ${DEV_ALL}"; return; }
    [[ -n "$(jq -r '.transaction_sign.base64_transaction // empty' <<< "${DEV_OUT}")" ]] || { fail 7 "txn sign gave no transaction"; return; }
    preview="$(preview_of transaction_sign)" || { fail 7 "no trezor_preview in ${DEV_OUT}"; return; }
    [[ "$(jq -r '.kind' <<< "${preview}")" == wallet_transfer ]] || { fail 7 "the review is not a wallet transfer: ${preview}"; return; }
    preview_has "${preview}" "Fee payer=${MAIN_ADDR}" "From=${wallet}" "Recipient=${recipient}" "Authority index=0" || \
        { fail 7 "the preview names other parties"; return; }
    review_matches s7-wallet-sign "${preview}" || { fail 7 "review"; return; }

    # The same transfer sent: the node takes the Trezor's signature.
    n0="$(nonce_of "${MAIN_ADDR}")"; b0="$(balance_of "${MAIN_ADDR}")"
    w0="$(balance_of "${wallet}")"; r0="$(balance_of "${recipient}")"
    run_signed s7-wallet-execute -- --json txn execute "${common[@]}"
    log "txn execute exited ${DEV_RC}; a rejection by the wallet program is expected here"
    [[ "${DEV_SCREEN}" == 1 ]] || { fail 7 "no review came up for txn execute"; return; }
    screens wait --captures "${CAPTURES}" s7-wallet-execute --timeout 60 >/dev/null || { fail 7 "the screens of txn execute were never captured"; return; }
    [[ "$(screens info "${CAPTURES}/s7-wallet-execute.json" outcome)" == signed ]] || { fail 7 "the device did not sign txn execute"; return; }
    [[ "$(nonce_of "${MAIN_ADDR}")" == "$(( n0 + 1 ))" ]] || { fail 7 "the nonce did not advance once: the node did not take the transaction (${DEV_ALL})"; return; }
    (( $(balance_of "${MAIN_ADDR}") < b0 )) || { fail 7 "the fee was not charged"; return; }
    [[ "$(balance_of "${wallet}")" == "${w0}" && "$(balance_of "${recipient}")" == "${r0}" ]] || \
        { fail 7 "the wallet account or the recipient changed"; return; }
    if jq -e '.transaction_execute.trezor_preview' <<< "${DEV_OUT}" >/dev/null 2>&1; then
        review_matches s7-wallet-execute "$(preview_of transaction_execute)" || { fail 7 "execute: review"; return; }
    else
        log "txn execute failed in the wallet program, so it printed no JSON preview; its review was compared for txn sign"
    fi
    pass 7
}

# 8. Expiry: the device signs only after the chain's slot passed the last slot
#    of the validity window. The window comes from the CLI's own preview
#    ("Valid slots: FIRST to LAST"); the slot comes from the chain. The node
#    rejects the transaction, the CLI reports it, the nonce is unchanged.
scenario_8() {
    need_chain 8 || return
    prepare_main 8 || return
    local name=s8-expiry release="${RESULTS_DIR}/s8-release" n0 instr cpid last="" first slot=0 rc dest fillers=0 advance_error=""
    rm -f "${release}"
    dest="$(address_of acc_1)" || { fail 8 "no acc_1 address"; return; }
    # A native transfer of 1 (EOA program, instruction 1: amount, from index 0,
    # to index 2), valid for one slot only.
    instr="$(python3 -c 'import struct; print(struct.pack("<IQHH", 1, 1, 0, 2).hex())')"
    n0="$(nonce_of "${MAIN_ADDR}")"
    rm -f "${PLANS}/plan.json" "${CAPTURES}/${name}.json"
    screens plan --plans "${PLANS}" --name "${name}" --hold-file "${release}" || { fail 8 "plan"; return; }
    cli --json txn execute "${EOA_PROGRAM}" "${instr}" --fee-payer tz_main --readwrite-accounts "${dest}" \
        --compute-units 10000 --memory-units 10000 --state-units 0 --expiry-after 1 \
        > "${RESULTS_DIR}/${name}.out" 2> "${RESULTS_DIR}/${name}.stderr" &
    cpid=$!
    # The CLI prints the review before it asks the device.
    for _ in $(seq 1 240); do
        last="$(sed -n 's/^ *Valid slots: *\([0-9]*\) to \([0-9]*\) *$/\1 \2/p' "${RESULTS_DIR}/${name}.stderr" | head -n 1)"
        [[ -n "${last}" ]] && break
        kill -0 "${cpid}" 2>/dev/null || break
        sleep 0.5
    done
    if [[ -z "${last}" ]]; then
        touch "${release}"; wait "${cpid}" 2>/dev/null
        rm -f "${PLANS}/plan.json"
        fail 8 "the CLI printed no validity window: $(cat "${RESULTS_DIR}/${name}.out" "${RESULTS_DIR}/${name}.stderr")"; return
    fi
    first="${last% *}"; last="${last#* }"
    log "the transaction is valid for slots ${first} to ${last}; holding the approval until the chain's slot is past ${last}"
    local deadline=$(( $(date +%s) + SLOT_WAIT_SECONDS ))
    while :; do
        slot="$(chain_slot 2>/dev/null || echo 0)"
        (( slot > last + 2 )) && break
        if (( $(date +%s) >= deadline )); then
            advance_error="the chain's slot is ${slot} after ${SLOT_WAIT_SECONDS} s, not past ${last}"
            break
        fi
        # The local chain produces no empty blocks. Advance it with a local
        # fee payer, leaving the held Trezor transaction's nonce untouched.
        fillers=$(( fillers + 1 ))
        if ! cli_json transfer acc_0 acc_1 1 \
            > "${RESULTS_DIR}/s8-advance-${fillers}.out" 2> "${RESULTS_DIR}/s8-advance-${fillers}.stderr"; then
            advance_error="slot-advancing transfer ${fillers} failed"
            break
        fi
    done
    [[ -n "${advance_error}" ]] || log "the chain's slot is ${slot}, past ${last}: approving"
    echo "{\"first_valid_slot\": ${first}, \"last_valid_slot\": ${last}, \"slot_at_approval\": ${slot}, \"slot_advancing_transfers\": ${fillers}}" > "${RESULTS_DIR}/s8-slots.json"
    touch "${release}"
    wait "${cpid}"; rc=$?
    screens wait --captures "${CAPTURES}" "${name}" --timeout 60 >/dev/null || \
        { fail 8 "the screen helper did not finish ${name}"; return; }
    if [[ -n "${advance_error}" ]]; then
        fail 8 "${advance_error}"; return
    fi
    DEV_ALL="$(cat "${RESULTS_DIR}/${name}.out" "${RESULTS_DIR}/${name}.stderr")"
    if (( rc == 0 )); then
        fail 8 "the expired transaction succeeded: ${DEV_ALL}"
    # Only the runtime's own error counts (TN_RUNTIME_TXN_ERR_EXPIRED,
    # 0xFFFFFE06, -506). "expired" alone does not: a request to the node that
    # ran out of time says "Timeout expired".
    elif ! grep -Eqi 'TXN_ERR_EXPIRED|FFFFFE06|(^|[^0-9])-506([^0-9]|$)|4294966790|18446744073709551110' <<< "${DEV_ALL}"; then
        fail 8 "unexpected error (want the runtime's expiry rejection): ${DEV_ALL}"
    elif [[ "$(nonce_of "${MAIN_ADDR}")" != "${n0}" ]]; then
        fail 8 "the nonce changed although the transaction expired"
    else
        # The rejection must be of a transaction the device signed: a CLI
        # that gave up before or without the signature is another failure.
        screens wait --captures "${CAPTURES}" "${name}" --timeout 60 >/dev/null 2>&1 || \
            { fail 8 "the screens of ${name} were never captured"; return; }
        [[ "$(screens info "${CAPTURES}/${name}.json" outcome 2>/dev/null)" == signed ]] || \
            { fail 8 "the device did not sign the transaction that was rejected as expired"; return; }
        pass 8
    fi
}

# 9a. A message refused on the device: the CLI says so and prints no signature.
scenario_9a() {
    ensure_keys || { fail 9a "no Trezor keys"; return; }
    local capture="${CAPTURES}/s9a-message-refused.json"
    if run_signed s9a-message-refused --refuse-at "Sign message" -- --json message sign --key tz0 hello; then
        fail 9a "message sign succeeded although it was refused: ${DEV_OUT}"; return
    fi
    [[ "${DEV_SCREEN}" == 1 ]] || { fail 9a "no review came up: ${DEV_ALL}"; return; }
    grep -qi "user_rejected" <<< "${DEV_ALL}" || { fail 9a "the error does not say user_rejected: ${DEV_ALL}"; return; }
    ! grep -q "signature_hex" <<< "${DEV_ALL}" || { fail 9a "a signature was printed"; return; }
    screens wait --captures "${CAPTURES}" s9a-message-refused --timeout 60 >/dev/null || { fail 9a "the screens were never captured"; return; }
    cp "${capture}" "${RESULTS_DIR}/s9a-message-refused.capture.json"
    [[ "$(screens info "${capture}" outcome)" == refused && "$(screens info "${capture}" refused_at)" == "Sign message" ]] || \
        { fail 9a "the device's capture is not a refusal at 'Sign message'"; return; }
    pass 9a
}

# 9b. A transfer refused on the device: nothing is submitted.
scenario_9b() {
    need_chain 9b || return
    prepare_main 9b || return
    local n0 b0 b1 capture="${CAPTURES}/s9b-transfer-refused.json"
    n0="$(nonce_of "${MAIN_ADDR}")"; b0="$(balance_of "${MAIN_ADDR}")"; b1="$(balance_of acc_1)"
    if run_signed s9b-transfer-refused --refuse-at "Send" -- --json transfer tz_main acc_1 1; then
        fail 9b "the transfer succeeded although it was refused: ${DEV_OUT}"; return
    fi
    [[ "${DEV_SCREEN}" == 1 ]] || { fail 9b "no review came up: ${DEV_ALL}"; return; }
    grep -qi "user_rejected" <<< "${DEV_ALL}" || { fail 9b "the error does not say user_rejected: ${DEV_ALL}"; return; }
    screens wait --captures "${CAPTURES}" s9b-transfer-refused --timeout 60 >/dev/null || { fail 9b "the screens were never captured"; return; }
    cp "${capture}" "${RESULTS_DIR}/s9b-transfer-refused.capture.json"
    [[ "$(screens info "${capture}" outcome)" == refused && "$(screens info "${capture}" refused_at)" == "Send" ]] || \
        { fail 9b "the device's capture is not a refusal at 'Send'"; return; }
    sleep 3
    [[ "$(nonce_of "${MAIN_ADDR}")" == "${n0}" ]] || { fail 9b "the nonce changed: something was submitted"; return; }
    [[ "$(balance_of "${MAIN_ADDR}")" == "${b0}" && "$(balance_of acc_1)" == "${b1}" ]] || { fail 9b "a balance changed"; return; }
    pass 9b
}

# ---------------------------------------------------------------------------

# Build the emulator-enabled CLI when the default binary path is used.
ensure_cli() {
    if [[ ! -x "${THRU_CLI_BIN}" && "${THRU_CLI_BIN}" == "${EMULATOR_CLI_TARGET}/release/thru" ]]; then
        log "building the thru CLI with the trezor-emulator test feature into ${EMULATOR_CLI_TARGET}"
        cargo build --release --manifest-path "${REPO_ROOT}/rpc/cli/Cargo.toml" -p thru \
            --features trezor-emulator --target-dir "${EMULATOR_CLI_TARGET}" >&2 || return 1
    fi
    [[ -x "${THRU_CLI_BIN}" ]] || { log "thru CLI not found at ${THRU_CLI_BIN}"; return 1; }
}

# The emulator is up and the CLI can use it. A release CLI refuses
# THRU_TREZOR_EMULATOR; say so instead of failing every scenario.
check_emulator() {
    local out
    out="$(cli --json keys show "trezor://44'/8478'/0'/0'" 2> "${RESULTS_DIR}/check-emulator.stderr")"
    if grep -q emulator_unsupported <<< "${out}$(cat "${RESULTS_DIR}/check-emulator.stderr")"; then
        log "${THRU_CLI_BIN} was built without the trezor-emulator feature; rebuild with"
        log "  cargo build --release -p thru --features trezor-emulator (rpc/cli)"
        return 1
    fi
    if ! jq -e '.key.public_key' <<< "${out}" >/dev/null 2>&1; then
        log "the emulator did not answer the CLI: ${out} $(cat "${RESULTS_DIR}/check-emulator.stderr")"
        return 1
    fi
}

main() {
    command -v jq >/dev/null || { log "jq required"; exit 1; }
    command -v openssl >/dev/null || { log "openssl required"; exit 1; }
    local var
    for var in THRU_TREZOR_EMULATOR THRU_TREZOR_APP TREZOR_PATH TREZOR_SIM_PLANS TREZOR_SIM_CAPTURES TREZOR_SIM_LOGS TREZOR_SIM_PYTHON TREZOR_SIM_SCREENS; do
        [[ -n "${!var:-}" ]] || { log "${var} is not set: start the emulator with trezor/sim/up.sh and pass its sim.env as TREZOR_SIM_ENV"; exit 1; }
    done
    ensure_cli || exit 1
    seed_config || exit 1
    check_emulator || exit 1
    log "emulator=${THRU_TREZOR_EMULATOR} chain=${TREZOR_SIM_CHAIN} scenarios=${SCENARIOS} results=${RESULTS_DIR}"
    local s list
    IFS=',' read -ra list <<< "${SCENARIOS}"
    for s in "${list[@]}"; do
        declare -F "scenario_${s}" >/dev/null || { log "unknown scenario ${s}"; exit 1; }
        log "=== scenario ${s}"
        "scenario_${s}"
    done

    log "=== summary"
    local rc=0
    for s in "${list[@]}"; do
        log "  scenario ${s}: ${RESULT[${s}]:-NOT RUN}"
        [[ "${RESULT[${s}]:-}" == PASS || "${RESULT[${s}]:-}" == SKIP* ]] || rc=1
    done
    exit ${rc}
}

# Sourcing only loads the helpers.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
