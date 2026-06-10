#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi

image="$1"

if docker image inspect "$image" >/dev/null 2>&1; then
  echo "Using local image $image"
  exit 0
fi

max_attempts="${DOCKER_PULL_MAX_ATTEMPTS:-3}"
delay_secs="${DOCKER_PULL_RETRY_DELAY_SECS:-10}"
pull_err=""

for attempt in $(seq 1 "$max_attempts"); do
  echo "Pulling $image (attempt $attempt/$max_attempts)"
  if pull_err="$(docker pull "$image" 2>&1)"; then
    printf '%s\n' "$pull_err"
    exit 0
  fi

  if echo "$pull_err" | grep -qiE 'no such manifest|manifest unknown|not found'; then
    echo "Image $image not found in registry: $pull_err" >&2
    exit 1
  fi

  if [[ "$attempt" -lt "$max_attempts" ]]; then
    echo "Pull failed (attempt $attempt/$max_attempts): $pull_err" >&2
    sleep "$delay_secs"
    delay_secs=$(( delay_secs * 2 ))
  fi
done

echo "Failed to pull $image after $max_attempts attempts: $pull_err" >&2
exit 1
