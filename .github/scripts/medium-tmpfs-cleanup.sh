#!/usr/bin/env bash
set -euo pipefail

tmpfs_root="${MEDIUM_TMPFS_ROOT:-}"
docker_tmpfs="${MEDIUM_TMPFS_DOCKER:-1}"

if [ -z "${tmpfs_root}" ]; then
  echo "MEDIUM_TMPFS_ROOT is not set; nothing to clean up"
  exit 0
fi

case "${tmpfs_root}" in
  /dev/shm/thru-medium-*) ;;
  *)
    echo "Refusing to clean unexpected tmpfs root: ${tmpfs_root}" >&2
    exit 1
    ;;
esac

tmpfs_root="$(realpath -m -- "${tmpfs_root}")"
case "${tmpfs_root}" in
  /dev/shm/thru-medium-*) ;;
  *)
    echo "Refusing to clean path outside /dev/shm/thru-medium-*: ${tmpfs_root}" >&2
    exit 1
    ;;
esac

systemd_unit_exists() {
  local unit="$1"

  systemctl list-unit-files "${unit}" >/dev/null 2>&1 ||
    systemctl status "${unit}" >/dev/null 2>&1
}

docker_systemd_available() {
  systemd_unit_exists docker.service || systemd_unit_exists docker.socket
}

stop_docker_if_available() {
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
  elif pgrep -x dockerd >/dev/null 2>&1; then
    echo "Docker is running but docker.service is not available to stop it" >&2
    exit 1
  fi
}

start_docker_if_available() {
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

echo "Cleaning medium-runner tmpfs offload at ${tmpfs_root}"
cd /

if [ "${docker_tmpfs}" != "0" ]; then
  stop_docker_if_available
  trap start_docker_if_available EXIT
else
  echo "Docker tmpfs offload was disabled for this job; leaving Docker running"
fi

unmount_if_mounted /var/lib/docker
unmount_if_mounted /var/cache/sccache
unmount_if_mounted /home/runner/.cache
unmount_if_mounted "${GITHUB_WORKSPACE}" -l
sudo rm -rf "${tmpfs_root}"
