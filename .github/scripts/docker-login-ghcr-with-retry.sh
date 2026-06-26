#!/usr/bin/env bash
set -euo pipefail

registry="${DOCKER_LOGIN_REGISTRY:-ghcr.io}"
username="${DOCKER_LOGIN_USERNAME:-}"
password="${DOCKER_LOGIN_PASSWORD:-}"
max_attempts="${DOCKER_LOGIN_MAX_ATTEMPTS:-5}"
retry_delay_secs="${DOCKER_LOGIN_RETRY_DELAY_SECS:-5}"
read -r -a docker_cmd <<< "${DOCKER:-docker}"

if [ -z "$username" ]; then
  echo "DOCKER_LOGIN_USERNAME is required" >&2
  exit 1
fi

if [ -z "$password" ]; then
  echo "DOCKER_LOGIN_PASSWORD is required" >&2
  exit 1
fi

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  echo "Logging into $registry, attempt $attempt/$max_attempts"
  if printf '%s\n' "$password" | "${docker_cmd[@]}" login "$registry" --username "$username" --password-stdin; then
    exit 0
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    break
  fi

  sleep "$retry_delay_secs"
  attempt=$((attempt + 1))
done

echo "failed to log into $registry after $max_attempts attempts" >&2
exit 1
