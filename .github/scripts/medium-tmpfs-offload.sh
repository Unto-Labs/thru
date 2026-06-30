#!/usr/bin/env bash
set -Eeuo pipefail

tmpfs_size="${MEDIUM_TMPFS_SIZE:-20G}"
tmpfs_key="${MEDIUM_TMPFS_KEY:-default}"
tmpfs_workspace="${MEDIUM_TMPFS_WORKSPACE:-0}"
tmpfs_home_cache="${MEDIUM_TMPFS_HOME_CACHE:-0}"
tmpfs_key="$(printf '%s' "${tmpfs_key}" | tr -c 'A-Za-z0-9_.-' '-')"
tmpfs_root="/dev/shm/thru-medium-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_JOB}-${tmpfs_key}"

echo "Preparing medium-runner tmpfs offload at ${tmpfs_root}"
sudo mount -o "remount,size=${tmpfs_size}" /dev/shm

mkdir -p "${tmpfs_root}"/{workspace,tmp,docker,sccache,home-cache}
chmod 0777 "${tmpfs_root}" "${tmpfs_root}/tmp" "${tmpfs_root}/docker" \
  "${tmpfs_root}/sccache" "${tmpfs_root}/home-cache"

echo "MEDIUM_TMPFS_ROOT=${tmpfs_root}" >> "${GITHUB_ENV}"

copy_workspace() {
  local src="$1"
  local dst="$2"

  cp -a "${src}/." "${dst}/"
  if [ ! -f "${dst}/.github/scripts/medium-tmpfs-cleanup.sh" ]; then
    echo "Workspace copy did not include medium tmpfs cleanup script" >&2
    exit 1
  fi
  if [ ! -f "${dst}/.github/actions/medium-tmpfs-cleanup/action.yml" ]; then
    echo "Workspace copy did not include medium tmpfs cleanup action" >&2
    find "${dst}/.github" -maxdepth 3 -type f | sort >&2 || true
    exit 1
  fi
  if [ ! -d "${dst}/contrib/docker" ]; then
    echo "Workspace copy did not include contrib/docker" >&2
    find "${dst}" -maxdepth 2 -type d | sort >&2 || true
    exit 1
  fi
}

bind_dir() {
  local src="$1"
  local dst="$2"

  sudo mkdir -p "${dst}"
  sudo mount --bind "${src}" "${dst}"
}

systemd_unit_exists() {
  local unit="$1"

  systemctl list-unit-files "${unit}" >/dev/null 2>&1 ||
    systemctl status "${unit}" >/dev/null 2>&1
}

docker_systemd_available() {
  systemd_unit_exists docker.service || systemd_unit_exists docker.socket
}

docker_daemon_running() {
  pgrep -x dockerd >/dev/null 2>&1
}

stop_docker_for_remount() {
  if docker_systemd_available; then
    if systemd_unit_exists docker.service; then
      sudo systemctl stop docker.service
    fi
    if systemd_unit_exists docker.socket; then
      sudo systemctl stop docker.socket
    fi
    if pgrep -x dockerd >/dev/null 2>&1; then
      echo "Docker daemon is still running after stopping docker units" >&2
      exit 1
    fi
  elif docker_daemon_running; then
    echo "Docker is running but docker.service is not available to stop it" >&2
    exit 1
  fi
}

start_docker_after_remount() {
  if docker_systemd_available; then
    if systemd_unit_exists docker.socket; then
      sudo systemctl start docker.socket
    fi
    if systemd_unit_exists docker.service; then
      sudo systemctl start docker.service
    fi
    sudo docker info >/dev/null
  fi
}

unmount_if_mounted() {
  local path="$1"
  local mode="${2:-}"

  if mountpoint -q "${path}"; then
    if [ -n "${mode}" ]; then
      sudo umount "${mode}" "${path}"
    else
      sudo umount "${path}"
    fi
  fi
}

cleanup_partial_offload() {
  local status=$?

  set +e
  echo "Medium tmpfs offload failed; cleaning partial mounts" >&2
  cd /
  unmount_if_mounted "${GITHUB_WORKSPACE}" -l
  unmount_if_mounted /var/lib/docker
  unmount_if_mounted /var/cache/sccache
  unmount_if_mounted /home/runner/.cache
  sudo rm -rf "${tmpfs_root}"
  start_docker_after_remount >/dev/null 2>&1
  exit "${status}"
}

trap cleanup_partial_offload ERR

if [ "${tmpfs_workspace}" != "0" ]; then
  copy_workspace "${GITHUB_WORKSPACE}" "${tmpfs_root}/workspace"

  # Avoid getcwd failures in this shell when bind-mounting over the checkout.
  cd /
  bind_dir "${tmpfs_root}/workspace" "${GITHUB_WORKSPACE}"
else
  echo "Skipping workspace bind mount for this job"
fi

stop_docker_for_remount
bind_dir "${tmpfs_root}/docker" /var/lib/docker
bind_dir "${tmpfs_root}/sccache" /var/cache/sccache
if [ "${tmpfs_home_cache}" != "0" ]; then
  bind_dir "${tmpfs_root}/home-cache" /home/runner/.cache
else
  echo "Leaving /home/runner/.cache on the runner disk for toolchain caches"
fi
start_docker_after_remount

echo "Medium tmpfs offload mount state:"
findmnt /dev/shm /var/lib/docker /var/cache/sccache || true
if [ "${tmpfs_home_cache}" != "0" ]; then
  findmnt /home/runner/.cache || true
fi
if [ "${tmpfs_workspace}" != "0" ]; then
  findmnt "${GITHUB_WORKSPACE}" || true
fi
df -h / /dev/shm /var/lib/docker /var/cache/sccache || true
if [ "${tmpfs_home_cache}" != "0" ]; then
  df -h /home/runner/.cache || true
fi
if [ "${tmpfs_workspace}" != "0" ]; then
  df -h "${GITHUB_WORKSPACE}" || true
fi

trap - ERR
