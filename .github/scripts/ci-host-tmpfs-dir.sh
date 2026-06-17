#!/usr/bin/env bash
set -euo pipefail

kind="${1:?usage: ci-host-tmpfs-dir.sh <kind> [min-bytes]}"
min_bytes="${2:-2147483648}"
base="${THRU_CI_HOST_TMPFS_ROOT:-/dev/shm/thru-ci}"

if [ ! -d /dev/shm ] || [ ! -w /dev/shm ]; then
  echo "::notice::Skipping host tmpfs for $kind; /dev/shm is unavailable or not writable" >&2
  exit 2
fi

avail_bytes="$(df -PB1 /dev/shm | awk 'NR==2 {print $4}')"
if [ "${avail_bytes:-0}" -lt "$min_bytes" ]; then
  echo "::notice::Skipping host tmpfs for $kind; /dev/shm has ${avail_bytes:-0} bytes available, need $min_bytes" >&2
  exit 2
fi

mkdir -p "$base"
dir="$(mktemp -d "${base%/}/${kind}.XXXXXX")"
chmod 0777 "$dir"

echo "::notice::Using host tmpfs for $kind: $dir ($(df -h /dev/shm | awk 'NR==2 {print $4 " available"}'))" >&2
printf '%s\n' "$dir"
