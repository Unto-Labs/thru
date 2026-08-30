#!/usr/bin/env bash

set -euo pipefail

LOCK_TIMEOUT_SECONDS="${APT_LOCK_TIMEOUT_SECONDS:-20}"
LOCK_GRACE_SECONDS="${APT_LOCK_GRACE_SECONDS:-20}"
KILL_LOCK_HOLDERS="${APT_KILL_LOCK_HOLDERS:-1}"
COMMAND_TIMEOUT_SECONDS="${APT_COMMAND_TIMEOUT_SECONDS:-180}"
COMMAND_KILL_GRACE_SECONDS="${APT_COMMAND_KILL_GRACE_SECONDS:-10}"
MIRROR_FALLBACK="${APT_MIRROR_FALLBACK:-1}"
FALLBACK_MIRROR="${APT_FALLBACK_MIRROR:-http://archive.ubuntu.com/ubuntu}"
PORTS_FALLBACK_MIRROR="${APT_FALLBACK_PORTS_MIRROR:-http://ports.ubuntu.com/ubuntu-ports}"
SOURCES_LIST="${APT_SOURCES_LIST:-/etc/apt/sources.list}"
SOURCES_PARTS_DIR="${APT_SOURCES_PARTS_DIR:-/etc/apt/sources.list.d}"
UPDATE_ONLY=0

if [ "${1:-}" = "--update-only" ]; then
  UPDATE_ONLY=1
  shift
fi

if [ "$UPDATE_ONLY" -eq 0 ] && [ "$#" -eq 0 ]; then
  echo "usage: $0 [--update-only] <package> [<package> ...]" >&2
  exit 2
fi

case "$COMMAND_TIMEOUT_SECONDS" in
  ''|*[!0-9]*|0*)
    echo "APT command timeout must be a positive integer" >&2
    exit 2
    ;;
esac

case "$COMMAND_KILL_GRACE_SECONDS" in
  ''|*[!0-9]*|0*)
    echo "APT command kill grace must be a positive integer" >&2
    exit 2
    ;;
esac

lock_files=(
  /var/cache/apt/archives/lock
  /var/lib/apt/lists/lock
  /var/lib/dpkg/lock
  /var/lib/dpkg/lock-frontend
)

apt_command() {
  timeout --kill-after="${COMMAND_KILL_GRACE_SECONDS}s" "${COMMAND_TIMEOUT_SECONDS}s" "$@"
  rc=$?
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "apt command timed out after ${COMMAND_TIMEOUT_SECONDS}s: $*" >&2
  fi
  return "$rc"
}

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

  apt_command sudo dpkg --configure -a || true
  apt_command sudo env DEBIAN_FRONTEND=noninteractive apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" -f install -y || true
}

# Ubuntu splits its archive by architecture family, and the fallback has to
# follow: amd64 and i386 live on archive.ubuntu.com, while every port --
# arm64 included -- lives on ports.ubuntu.com/ubuntu-ports.  Rewriting an
# arm64 source to archive.ubuntu.com does not degrade to a slower mirror, it
# 404s, so each family carries its own pattern and its own fallback.
#
# Each pattern requires at least one label before `archive`/`ports`, which is
# what makes it match a vendor or region mirror without matching the fallback
# host itself:
#
#   us-east-1.ec2.archive.ubuntu.com   GARM x86, matches archive family
#   azure.archive.ubuntu.com           GitHub-hosted, matches archive family
#   us-east-1.ec2.ports.ubuntu.com     GARM arm64, matches ports family
#   archive.ubuntu.com                 the fallback, deliberately no match
#   security.ubuntu.com                deliberately no match
#
# Before this the pattern was `[a-z0-9-]+\.ec2\.archive\.ubuntu\.com`, which
# matched only GARM x86.  On the other two classes the fallback reported "no
# EC2 regional apt mirror configured" and spent every remaining attempt on the
# same sick mirror.
archive_mirror_pattern='https?://[a-z0-9.-]+\.archive\.ubuntu\.com(/ubuntu)?'
ports_mirror_pattern='https?://[a-z0-9.-]+\.ports\.ubuntu\.com(/ubuntu-ports)?'
mirror_fallback_applied=0

# Emits every apt source file that actually exists, covering both the legacy
# one-line format (/etc/apt/sources.list, *.list) and the deb822 format
# (*.sources) that Ubuntu 24.04 uses by default.  Unmatched globs are skipped
# rather than passed through literally.
apt_source_files() {
  local candidate
  for candidate in "$SOURCES_LIST" "$SOURCES_PARTS_DIR"/*.list "$SOURCES_PARTS_DIR"/*.sources; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
    fi
  done
}

# GitHub-hosted runners do not name a mirror in their sources at all.  They
# point apt at a local mirrorlist:
#
#   Types: deb
#   URIs: mirror+file:/etc/apt/apt-mirrors.txt
#
# and that file holds the real hosts (azure.archive.ubuntu.com and friends).
# Rewriting only sources.list.d there changes nothing, which is why the
# fallback never worked on hosted runners.  Emit each referenced mirrorlist so
# the rewrite reaches the hosts apt will actually contact.  Only absolute
# paths under /etc/apt are followed, so a source cannot redirect the rewrite
# at an arbitrary file.
apt_mirrorlist_files() {
  local source_file path name root
  root="$(dirname "$SOURCES_LIST")"
  while IFS= read -r source_file; do
    while IFS= read -r path; do
      # Only the basename is used, resolved beneath the apt config directory
      # we were told to manage. A source file therefore cannot point the
      # rewrite at an arbitrary path, and the lookup still works when the
      # caller relocates the apt tree (which is how this is tested).
      name="${path##*/}"
      case "$name" in
        ''|.|..|*/*) continue ;;
      esac
      [ -f "${root}/${name}" ] && printf '%s\n' "${root}/${name}"
    done < <(grep -Eoh 'file:/[^ 	"]+' "$source_file" 2>/dev/null | sed 's|^file:||')
  done < <(apt_source_files)
}

# Repoints the configured apt sources from the EC2 regional mirror at
# FALLBACK_MIRROR.  The EC2 mirror is region-local and much faster when it is
# healthy, so this only runs after an attempt has already failed.  It is a
# no-op when no EC2 mirror is configured and when it has already run.
use_fallback_apt_mirror() {
  [ "$mirror_fallback_applied" -eq 0 ] || return 0
  mirror_fallback_applied=1

  if [ "$MIRROR_FALLBACK" != "1" ]; then
    echo "apt mirror fallback is disabled (APT_MIRROR_FALLBACK=${MIRROR_FALLBACK})" >&2
    return 0
  fi

  case "$FALLBACK_MIRROR" in
    http://*|https://*) ;;
    *)
      echo "refusing to use APT_FALLBACK_MIRROR='${FALLBACK_MIRROR}': not an http(s) URL" >&2
      return 0
      ;;
  esac

  case "$FALLBACK_MIRROR" in
    *[\|\&\\]*)
      echo "refusing to use APT_FALLBACK_MIRROR='${FALLBACK_MIRROR}': unsafe in a sed replacement" >&2
      return 0
      ;;
  esac

  case "$PORTS_FALLBACK_MIRROR" in
    http://*|https://*) ;;
    *)
      echo "refusing to use APT_FALLBACK_PORTS_MIRROR='${PORTS_FALLBACK_MIRROR}': not an http(s) URL" >&2
      return 0
      ;;
  esac

  case "$PORTS_FALLBACK_MIRROR" in
    *[\|\&\\]*)
      echo "refusing to use APT_FALLBACK_PORTS_MIRROR='${PORTS_FALLBACK_MIRROR}': unsafe in a sed replacement" >&2
      return 0
      ;;
  esac

  # Rewrite each family with its own fallback, over the source files and over
  # any mirrorlist they reference.
  local target rewritten=0 family pattern replacement
  while IFS= read -r target; do
    for family in archive ports; do
      if [ "$family" = archive ]; then
        pattern="$archive_mirror_pattern"
        replacement="$FALLBACK_MIRROR"
      else
        pattern="$ports_mirror_pattern"
        replacement="$PORTS_FALLBACK_MIRROR"
      fi

      grep -Eq "$pattern" "$target" || continue

      echo "rewriting ${family} apt mirror in ${target} (backup: ${target}.bak)" >&2
      grep -En "$pattern" "$target" | sed 's/^/  before: /' >&2 || true

      if ! sudo sed -E -i.bak "s|${pattern}|${replacement}|g" "$target"; then
        echo "failed to rewrite ${target}; leaving it unchanged" >&2
        continue
      fi

      grep -Fn -- "$replacement" "$target" | sed 's/^/  after:  /' >&2 || true
      rewritten=$((rewritten + 1))
    done
  done < <({ apt_source_files; apt_mirrorlist_files; } | sort -u)

  if [ "$rewritten" -eq 0 ]; then
    echo "no rewritable Ubuntu mirror configured under ${SOURCES_LIST}, ${SOURCES_PARTS_DIR}, or a referenced mirrorlist; apt sources left unchanged" >&2
    return 0
  fi

  echo "apt mirror fallback applied to ${rewritten} file/family pair(s); archive -> ${FALLBACK_MIRROR}, ports -> ${PORTS_FALLBACK_MIRROR}" >&2
}

# Fast path: nothing to do.
#
# Every caller of this script asks for packages the runner image already
# ships, so the common case is `apt-get update` fetching ~19 MB of indexes to
# conclude "0 upgraded, 0 newly installed". That cost is not small: it is
# 3m20s per job on the self-hosted runners, in zig-x86-test and grpc-test
# alike, and when the EC2 regional mirror stalls it is the hang that has
# ejected PRs from the merge queue outright.
#
# Checking dpkg's own database first turns that into a few milliseconds. Set
# APT_ASSUME_PRESENT=0 to force the update+install path when a caller really
# does want the newest version rather than a working one.
ASSUME_PRESENT="${APT_ASSUME_PRESENT:-1}"

all_packages_installed() {
  local pkg status
  for pkg in "$@"; do
    # A package can be known to dpkg while removed or half-configured; only
    # "install ok installed" means it is actually usable.
    status="$(dpkg-query -W -f='${db:Status-Abbrev}' "$pkg" 2>/dev/null || true)"
    # Status-Abbrev is three characters: desired, current, error. Only a
    # trailing space means "no error" -- "iiR" is installed but flagged for
    # reinstallation, which is exactly the broken state the slow path exists
    # to repair, so a prefix match on "ii" would skip the repair and let a
    # later command fail instead.
    case "$status" in
      "ii ") ;;
      *) return 1 ;;
    esac
  done
  return 0
}

if [ "$UPDATE_ONLY" -eq 0 ] && [ "$ASSUME_PRESENT" = "1" ] &&
   command -v dpkg-query >/dev/null 2>&1 && all_packages_installed "$@"; then
  echo "all requested packages already installed, skipping apt: $*"
  exit 0
fi

for attempt in 1 2 3 4 5; do
  if [ "$attempt" -eq 1 ]; then
    wait_for_or_kill_lock_holders
  fi

  if apt_command sudo apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" update; then
    if [ "$UPDATE_ONLY" -eq 1 ] ||
       apt_command sudo env DEBIAN_FRONTEND=noninteractive apt-get -o "DPkg::Lock::Timeout=${LOCK_TIMEOUT_SECONDS}" install -y "$@"; then
      exit 0
    fi
  fi

  log_lock_holders

  if [ "$attempt" -eq 5 ]; then
    exit 1
  fi

  # The attempt failed.  If it was the region-local EC2 mirror stalling, more
  # retries against the same mirror cannot help, so switch mirrors before the
  # next one.
  use_fallback_apt_mirror

  sleep $((attempt * 10))
done
