#!/usr/bin/env bash

set -euo pipefail

LOCK_TIMEOUT_SECONDS="${APT_LOCK_TIMEOUT_SECONDS:-20}"
LOCK_GRACE_SECONDS="${APT_LOCK_GRACE_SECONDS:-20}"
KILL_LOCK_HOLDERS="${APT_KILL_LOCK_HOLDERS:-1}"
UPDATE_ONLY=0

if [ "${1:-}" = "--update-only" ]; then
  UPDATE_ONLY=1
  shift
fi

if [ "$UPDATE_ONLY" -eq 0 ] && [ "$#" -eq 0 ]; then
  echo "usage: $0 [--update-only] <package> [<package> ...]" >&2
  exit 2
fi

lock_files=(
  /var/cache/apt/archives/lock
  /var/lib/apt/lists/lock
  /var/lib/dpkg/lock
  /var/lib/dpkg/lock-frontend
)

log_lock_holders() {
  echo "apt lock diagnostics:" >&2
  for lock in "${lock_files[@]}"; do
    [ -e "$lock" ] || continue
    echo "lock: $lock" >&2
    if command -v fuser >/dev/null 2>&1; then
      sudo fuser -v "$lock" >&2 || true
    fi
  done

  if ! command -v fuser >/dev/null 2>&1; then
    pids="$(lock_holder_pids)"
    if [ -n "$pids" ]; then
      ps -fp $pids >&2 || true
    else
      echo "fuser is unavailable and no lock holders were found via /proc" >&2
    fi
  fi
}

lock_holder_pids_from_proc() {
  sudo bash -c '
    for pid_dir in /proc/[0-9]*; do
      pid="${pid_dir#/proc/}"
      [ -d "$pid_dir/fd" ] || continue
      for fd in "$pid_dir"/fd/*; do
        target="$(readlink "$fd" 2>/dev/null)" || continue
        case "$target" in
          /var/cache/apt/archives/lock|/var/lib/apt/lists/lock|/var/lib/dpkg/lock|/var/lib/dpkg/lock-frontend)
            printf "%s\n" "$pid"
            break
            ;;
        esac
      done
    done
  ' 2>/dev/null || true
}

lock_holder_pids() {
  if command -v fuser >/dev/null 2>&1; then
    for lock in "${lock_files[@]}"; do
      [ -e "$lock" ] || continue
      sudo fuser "$lock" 2>/dev/null || true
    done
  else
    lock_holder_pids_from_proc
  fi | tr ' ' '\n' | awk 'NF && !seen[$1]++'
}

is_apt_family_process() {
  pid="$1"
  args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  case "$args" in
    *apt-get*|*"/usr/lib/apt/apt.systemd.daily"*|*apt.systemd.daily*|*unattended-upgrade*|*"/usr/bin/apt "*|*" apt "*|*"/usr/bin/dpkg "*|*" dpkg "*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

stop_background_apt() {
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
  fi
}

wait_for_or_kill_lock_holders() {
  stop_background_apt

  deadline=$((SECONDS + LOCK_GRACE_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -z "$(lock_holder_pids)" ]; then
      return 0
    fi
    sleep 2
  done

  pids="$(lock_holder_pids)"
  [ -n "$pids" ] || return 0

  log_lock_holders
  ps -fp $pids >&2 || true

  if [ "$KILL_LOCK_HOLDERS" != "1" ]; then
    return 0
  fi

  kill_pids=""
  for pid in $pids; do
    [ "$pid" != "$$" ] || continue
    if is_apt_family_process "$pid"; then
      kill_pids="$kill_pids $pid"
    else
      echo "not killing non-apt lock holder pid $pid" >&2
    fi
  done

  [ -n "$kill_pids" ] || return 0

  echo "terminating apt lock holders:$kill_pids" >&2
  sudo kill -TERM $kill_pids 2>/dev/null || true
  sleep 5

  still_alive=""
  for pid in $kill_pids; do
    if sudo kill -0 "$pid" 2>/dev/null; then
      still_alive="$still_alive $pid"
    fi
  done

  if [ -n "$still_alive" ]; then
    echo "force-killing apt lock holders:$still_alive" >&2
    sudo kill -KILL $still_alive 2>/dev/null || true
  fi

  sudo dpkg --configure -a || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" -f install -y || true
}

for attempt in 1 2 3 4 5; do
  if [ "$attempt" -eq 1 ]; then
    wait_for_or_kill_lock_holders
  fi

  if sudo apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" update; then
    if [ "$UPDATE_ONLY" -eq 1 ] ||
       sudo DEBIAN_FRONTEND=noninteractive apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" install -y "$@"; then
      exit 0
    fi
  fi

  log_lock_holders

  if [ "$attempt" -eq 5 ]; then
    exit 1
  fi

  sleep $((attempt * 10))
done
