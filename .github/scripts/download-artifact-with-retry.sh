#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <artifact-name> <destination-dir>" >&2
  exit 2
fi

artifact_name="$1"
dest_dir="${2%/}"
max_attempts="${ARTIFACT_DOWNLOAD_MAX_ATTEMPTS:-4}"
delay_secs="${ARTIFACT_DOWNLOAD_RETRY_DELAY_SECS:-10}"
run_id="${GITHUB_RUN_ID:-}"
tmp_parent="${RUNNER_TEMP:-/tmp}"

if [[ -z "$run_id" ]]; then
  echo "GITHUB_RUN_ID is required" >&2
  exit 2
fi

work_dir="$(mktemp -d "$tmp_parent/artifact-download.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

for attempt in $(seq 1 "$max_attempts"); do
  attempt_dir="$work_dir/attempt-$attempt"
  rm -rf "$attempt_dir"
  mkdir -p "$attempt_dir"

  echo "Downloading artifact $artifact_name to $dest_dir (attempt $attempt/$max_attempts)"
  if download_err="$(gh run download "$run_id" -n "$artifact_name" -D "$attempt_dir" 2>&1)"; then
    printf '%s\n' "$download_err"
    if find "$attempt_dir" -mindepth 1 -print -quit | grep -q .; then
      rm -rf "$dest_dir"
      mkdir -p "$(dirname "$dest_dir")"
      mv "$attempt_dir" "$dest_dir"
      exit 0
    fi
    echo "Artifact download for $artifact_name completed but $dest_dir is empty" >&2
  else
    printf '%s\n' "$download_err" >&2
    if echo "$download_err" | grep -qiE 'no artifact.*found|could not find.*artifact|not found|404'; then
      echo "Artifact $artifact_name was not found in run $run_id" >&2
      rm -rf "$dest_dir"
      exit 1
    fi
  fi

  if [[ "$attempt" -lt "$max_attempts" ]]; then
    sleep "$delay_secs"
    delay_secs=$(( delay_secs * 2 ))
  fi
done

echo "Failed to download artifact $artifact_name after $max_attempts attempts" >&2
rm -rf "$dest_dir"
exit 1
