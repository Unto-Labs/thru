#!/usr/bin/env bash
#
# Regression test for on_device in thru_cli_ledger_e2e.sh: when the CLI fails
# before any device review appears, the background approver must really stop.
# A surviving approver keeps driving the shared Speculos and answers the next
# client's reviews (a stale --reject approver rejected a later review).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
cleanup_work() {
    [[ -s "${WORK}/approver.pid" ]] && kill "$(cat "${WORK}/approver.pid")" 2>/dev/null
    rm -rf "${WORK}"
}

cat > "${WORK}/stub_driver.py" <<'EOF'
import os
import sys
import time

with open(os.environ["STUB_PID_FILE"], "w") as f:
    f.write(str(os.getpid()))
time.sleep(30)
sys.exit(0)
EOF

export STUB_PID_FILE="${WORK}/approver.pid"
export RESULTS_DIR="${WORK}/results"

# shellcheck source=thru_cli_ledger_e2e.sh
source "${SCRIPT_DIR}/thru_cli_ledger_e2e.sh"
trap 'cleanup_work; rm -rf "${CLI_HOME}"' EXIT

DRIVER="${WORK}/stub_driver.py"
cli() { return 1; }

on_device approve stale-approver --json some command >/dev/null

for _ in $(seq 1 20); do
    [[ -s "${STUB_PID_FILE}" ]] && break
    sleep 0.1
done
[[ -s "${STUB_PID_FILE}" ]] || { echo "FAIL: the approver never started"; exit 1; }

pid="$(cat "${STUB_PID_FILE}")"
for _ in $(seq 1 20); do
    kill -0 "${pid}" 2>/dev/null || { echo "PASS: approver stopped with on_device"; exit 0; }
    sleep 0.1
done
echo "FAIL: approver ${pid} is still running after on_device returned"
exit 1
