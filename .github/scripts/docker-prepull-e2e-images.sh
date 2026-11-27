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
  "clickhouse/clickhouse-server:26.8.36.3-alpine@sha256:f5443f9ffa48f0154cdd50cab39fed732201762574a27f04f1f564bbba81832d"
)

case "$scope" in
  e2e)
    case "$suite" in
      go|streaming|grpclogs|vise-rebuild)
        images+=("ubuntu:24.04" "golang:1.26-bookworm")
        ;;
      cli)
        images+=("ubuntu:24.04")
        ;;
      ts)
        images+=("ubuntu:24.04" "golang:1.26-bookworm" "node:26.12.1-bookworm" "node:26.12.1-slim")
        ;;
      "")
        echo "e2e image scope requires a suite: go, cli, ts, streaming, grpclogs, or vise-rebuild" >&2
        exit 2
        ;;
      *)
        echo "unknown e2e suite: $suite" >&2
        exit 2
        ;;
    esac
    ;;
  bridge)
    images+=("ubuntu:24.04" "node:26.12.1-bookworm")
    ;;
  *)
    echo "unknown image scope: $scope" >&2
    exit 2
    ;;
esac

for image in "${images[@]}"; do
  "$pull_if_missing" "$image"
done
