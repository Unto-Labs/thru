#!/usr/bin/env bash
# Remove per-run fullnode data directories from a fullnode runner's data disk.
#
#   clean-fullnode-data.sh --stale [KEEP_DIR]  remove every run directory (except KEEP_DIR)
#   clean-fullnode-data.sh --dir DIR          remove DIR
#
# Only direct children of /srv/fullnode/data are ever removed. The fullnode
# container writes as uid 1001, which may not be the runner user, so anything
# `rm` cannot delete is removed from a throwaway root container instead.
set -euo pipefail

ROOT=${FULLNODE_DATA_ROOT:-/srv/fullnode/data}
IMAGE=${FULLNODE_CLEAN_IMAGE:-docker-fullnode:latest}
FALLBACK_IMAGE=${FULLNODE_CLEAN_FALLBACK_IMAGE:-busybox:1.37}

# Bind-mount sources of running containers. A cancelled or crashed job may have
# left its fullnode running; its data must not be deleted from under it.
in_use() {
  local ids
  command -v docker >/dev/null 2>&1 || return 1
  ids=$(docker ps -q 2>/dev/null) || return 1
  [ -n "$ids" ] || return 1
  # shellcheck disable=SC2086
  docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' $ids 2>/dev/null |
    grep -Fxq -- "$1"
}

remove_one() {
  local dir=$1
  if [ "$(dirname -- "$dir")" != "$ROOT" ] || [ "$(basename -- "$dir")" = .. ] ||
     [ "$(basename -- "$dir")" = . ]; then
    echo "refusing to remove $dir (not a direct child of $ROOT)" >&2
    return 1
  fi
  [ -d "$dir" ] || return 0
  rm -rf -- "$dir" 2>/dev/null || true
  [ -d "$dir" ] || return 0
  # Prefer the image the fullnode ran from; on a VM whose image cache was
  # reset it is not there yet, so fall back to a small public image.
  image=$IMAGE
  docker image inspect "$image" >/dev/null 2>&1 || image=$FALLBACK_IMAGE
  docker run --rm -u 0 -v "$ROOT:/data" --entrypoint /bin/rm \
    "$image" -rf -- "/data/$(basename "$dir")"
}

case "${1:-}" in
  --dir)
    remove_one "${2:?directory}"
    ;;
  --stale)
    keep=${2:-}
    [ -d "$ROOT" ] || exit 0
    for dir in "$ROOT"/*; do
      [ -d "$dir" ] || continue
      [ -n "$keep" ] && [ "$dir" = "$keep" ] && continue
      if in_use "$dir"; then
        echo "keeping $dir: mounted by a running container" >&2
        continue
      fi
      remove_one "$dir"
    done
    ;;
  *)
    echo "usage: $0 --dir DIR | --stale KEEP_DIR" >&2
    exit 2
    ;;
esac
