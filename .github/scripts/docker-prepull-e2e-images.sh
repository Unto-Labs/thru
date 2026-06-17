#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [e2e|bridge] [suite]" >&2
  exit 2
fi

scope="${1:-e2e}"
suite="${2:-${E2E_SUITE:-}}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pull_if_missing="$script_dir/docker-pull-if-missing.sh"

if [[ ! -x "$pull_if_missing" ]]; then
  echo "missing executable helper: $pull_if_missing" >&2
  exit 1
fi

images=(
  "clickhouse/clickhouse-server@sha256:dcd74ae94f16bee4bb61a44ab0fc4ff973d5bb42180e52fc82c4fe68cfe70cf6"
)

case "$scope" in
  e2e)
    case "$suite" in
      go)
        images+=("ubuntu:24.04" "golang:1.26-bookworm")
        ;;
      cli)
        images+=("ubuntu:24.04")
        ;;
      ts)
        images+=("ubuntu:24.04" "golang:1.26-bookworm" "node:26-bookworm" "node:26-slim")
        ;;
      "")
        echo "e2e image scope requires a suite: go, cli, or ts" >&2
        exit 2
        ;;
      *)
        echo "unknown e2e suite: $suite" >&2
        exit 2
        ;;
    esac
    ;;
  bridge)
    images+=("ubuntu:24.04" "node:26-bookworm")
    ;;
  *)
    echo "unknown image scope: $scope" >&2
    exit 2
    ;;
esac

for image in "${images[@]}"; do
  "$pull_if_missing" "$image"
done
