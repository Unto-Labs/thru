#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [e2e|bridge] [suite]" >&2
  exit 2
fi

scope="${1:-e2e}"
suite="${2:-${E2E_SUITE:-}}"
max_attempts="${DOCKER_BUILDX_WARM_MAX_ATTEMPTS:-4}"
delay_secs_default="${DOCKER_BUILDX_WARM_RETRY_DELAY_SECS:-10}"

# Keep these tags in sync with the FROM statements in the e2e Dockerfiles.
# Stale tags warm the wrong image and still exit 0.
images=(
  "ubuntu:24.04"
)

case "$scope" in
  e2e)
    case "$suite" in
      go)
        images+=("golang:1.26-bookworm")
        ;;
      cli)
        images+=(
          "rust:1.88-alpine"
          "rust:1.95-alpine"
        )
        ;;
      ts)
        images+=(
          "golang:1.26-bookworm"
          "node:26-bookworm"
          "node:26-slim"
        )
        ;;
      "")
        echo "e2e buildx cache warm requires a suite: go, cli, or ts" >&2
        exit 2
        ;;
      *)
        echo "unknown e2e suite: $suite" >&2
        exit 2
        ;;
    esac
    ;;
  bridge)
    images+=("node:26-bookworm")
    ;;
  *)
    echo "unknown image scope: $scope" >&2
    exit 2
    ;;
esac

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

for image in "${images[@]}"; do
  image_dir="$tmp_dir/$(echo "$image" | tr '/:@' '___')"
  mkdir -p "$image_dir"
  printf 'FROM %s\nRUN /bin/true\n' "$image" > "$image_dir/Dockerfile"

  delay_secs="$delay_secs_default"
  for attempt in $(seq 1 "$max_attempts"); do
    echo "Warming Buildx cache for $image (attempt $attempt/$max_attempts)"
    # setup-buildx-action runs immediately before this script and sets this
    # docker-container builder as the default.
    if docker buildx build --progress=plain -f "$image_dir/Dockerfile" "$image_dir"; then
      break
    fi

    if [[ "$attempt" -eq "$max_attempts" ]]; then
      echo "Failed to warm Buildx cache for $image after $max_attempts attempts" >&2
      exit 1
    fi

    sleep "$delay_secs"
    delay_secs=$(( delay_secs * 2 ))
  done
done
