#!/usr/bin/env bash

set -euo pipefail

# Change into script directory
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
cd "$SCRIPT_DIR"

# Default thru directory
THRU_DIR=""

# Set default thru directory (HOME if set, otherwise current directory)
if [[ -n "${HOME:-}" ]]; then
  DEFAULT_THRU_DIR="$HOME"
else
  DEFAULT_THRU_DIR="$(pwd)"
fi

# Load OS information
OS="$(uname -s)"
case "$OS" in
  Darwin)
    NJOBS=$(sysctl -n hw.physicalcpu)
    MAKE=( make -j $NJOBS )
    ID=macos
    ;;
  Linux)
    NJOBS=$(nproc)
    MAKE=( make -j $NJOBS -Otarget )
    # Load distro information
    if [[ -f /etc/os-release ]]; then
      source /etc/os-release
    fi
    ;;
  *)
    echo "[!] Unsupported OS $OS"
    exit 1
    ;;
esac

# Figure out how to escalate privileges
SUDO=""
if [[ ! "$(id -u)" -eq "0" ]]; then
  SUDO="sudo"
fi

# Install prefix - will be set after parsing arguments
PREFIX=""

# Function to run a command quietly, only showing output on failure
run_quiet () {
  local output_file=$(mktemp)
  local exit_code
  
  # Run the command and capture both stdout and stderr
  set +e
  "$@" > "$output_file" 2>&1
  exit_code=$?
  
  # If command failed, print the captured output
  if [[ $exit_code -ne 0 ]]; then
    echo "[!] Command failed: $*"
    cat "$output_file"
  fi
  
  # Clean up temporary file
  rm -f "$output_file"
  set -e
  if [[ $exit_code -ne 0 ]]; then
    exit 1
  fi
}

help () {
cat <<EOF

  Usage: $0 [options] [cmd] [args...]

  If cmd is omitted, default is 'install'.

  Options:

    --thru-dir <dir>
    - Specify the directory where .thru folder should be created
    - Default: home directory if available, otherwise current directory

  Commands are:

    help
    - Prints this message

    check
    - Runs system requirement checks for dep build/install
    - Exits with code 0 on success

    nuke
    - Get rid of dependency checkouts
    - Get rid of all third party dependency files
    - Same as 'rm -rf $PREFIX'

    fetch
    - Fetches dependencies from Git repos into $PREFIX/git

    install
    - Builds dependencies
    - Installs all project dependencies into prefix $PREFIX

    install-rust
    - Installs Rust SDK dependencies (rustup + RISC-V target)

    install-c
    - Installs C/C++ SDK dependencies only

    install-all
    - Installs both C/C++ and Rust SDK dependencies

EOF
  exit 0
}

nuke () {
  # Set PREFIX based on THRU_DIR for nuke command
  if [[ -z "$THRU_DIR" ]]; then
    THRU_DIR="$DEFAULT_THRU_DIR"
  fi
  PREFIX="$THRU_DIR/.thru/sdk/toolchain"
  
  rm -rf "$PREFIX"
  echo "[-] Nuked $PREFIX"
  exit 0
}

checkout_repo () {
  # Skip if dir already exists
  if [[ -d "$PREFIX/git/$1" ]]; then
    echo "[~] Skipping $1 fetch as \"$PREFIX/git/$1\" already exists"
  elif [[ -z "$3" ]]; then
    echo "[+] Cloning $1 from $2"
    git -c advice.detachedHead=false clone "$2" "$PREFIX/git/$1" && cd "$PREFIX/git/$1" && git reset --hard "$4"
    echo
  else
    echo "[+] Cloning $1 from $2"
    git -c advice.detachedHead=false clone "$2" "$PREFIX/git/$1" --branch "$3" --depth=1
    echo
  fi

  if [[ ! -z "$3" ]]; then
    # Skip if tag already correct
    if [[ "$(git -C "$PREFIX/git/$1" describe --tags --abbrev=0)" == "$3" ]]; then
      return
    fi

    echo "[~] Checking out $1 $3"
    (
      cd "$PREFIX/git/$1"
      git fetch origin "$3" --tags --depth=1
      git -c advice.detachedHead=false checkout "$3"
    )
    echo
  fi
}

check_fedora_pkgs () {
  local REQUIRED_RPMS=( curl perl autoconf gettext-devel automake flex bison cmake gmp-devel protobuf-compiler lcov systemd-devel pkgconf patch python3 libmpc-devel mpfr-devel gawk texinfo patchutils zlib-devel expat-devel libslirp-devel meson ninja-build zstd zlib bear )

  echo "[~] Checking for required RPM packages"

  local MISSING_RPMS=( )
  for rpm in "${REQUIRED_RPMS[@]}"; do
    if ! rpm -q "$rpm" >/dev/null; then
      MISSING_RPMS+=( "$rpm" )
    fi
  done

  if [[ "${#MISSING_RPMS[@]}" -eq 0 ]]; then
    echo "[~] OK: RPM packages required for build are installed"
    return 0
  fi

  if [[ -z "${SUDO}" ]]; then
    PACKAGE_INSTALL_CMD+=( dnf install -y --skip-broken ${MISSING_RPMS[*]} )
  else
    PACKAGE_INSTALL_CMD+=( "${SUDO}" dnf install -y --skip-broken ${MISSING_RPMS[*]} )
  fi
}

check_debian_pkgs () {
  local REQUIRED_DEBS=( curl perl autoconf gettext automake autopoint flex bison build-essential gcc-multilib protobuf-compiler llvm lcov libgmp-dev libudev-dev cmake libclang-dev pkgconf meson ninja-build texinfo libexpat1-dev libmpfr-dev gawk libmpc-dev python3 python3-pip python3-tomli bc zlib1g-dev git libglib2.0-dev libslirp-dev zstd zlib1g bear )

  echo "[~] Checking for required DEB packages"

  local MISSING_DEBS=( )
  for deb in "${REQUIRED_DEBS[@]}"; do
    if ! dpkg -s "$deb" >/dev/null 2>/dev/null; then
      MISSING_DEBS+=( "$deb" )
    fi
  done

  if [[ ${#MISSING_DEBS[@]} -eq 0 ]]; then
    echo "[~] OK: DEB packages required for build are installed"
    return 0
  fi

  if [[ -z "${SUDO}" ]]; then
    PACKAGE_INSTALL_CMD+=( apt-get install -y ${MISSING_DEBS[*]} )
  else
    PACKAGE_INSTALL_CMD+=( "${SUDO}" apt-get install -y ${MISSING_DEBS[*]} )
  fi
}

check_alpine_pkgs () {
  local REQUIRED_APKS=( curl perl autoconf gettext automake flex bison build-base linux-headers protobuf-dev patch libucontext-dev meson ninja zstd zlib-dev zlib )

  echo "[~] Checking for required APK packages"

  local MISSING_APKS=( )
  for deb in "${REQUIRED_APKS[@]}"; do
    if ! apk info -e "$deb" >/dev/null; then
      MISSING_APKS+=( "$deb" )
    fi
  done

  if [[ ${#MISSING_APKS[@]} -eq 0 ]]; then
    echo "[~] OK: APK packages required for build are installed"
    return 0
  fi

  if [[ -z "${SUDO}" ]]; then
    PACKAGE_INSTALL_CMD+=( apk add ${MISSING_APKS[*]} )
  else
    PACKAGE_INSTALL_CMD+=( "${SUDO}" apk add ${MISSING_APKS[*]} )
  fi
}

check_macos_pkgs () {
  local REQUIRED_FORMULAE=( curl perl autoconf gettext automake flex bison protobuf python@3.12 gawk gnu-sed make gmp mpfr libmpc isl zlib expat texinfo flock libslirp meson ninja zstd llvm@16 bear )

  echo "[~] Checking for required brew formulae"

  local MISSING_FORMULAE=( )
  for formula in "${REQUIRED_FORMULAE[@]}"; do
    if [[ ! -d "/usr/local/Cellar/$formula" ]] && [[ ! -d "/opt/homebrew/Cellar/$formula" ]]; then
      MISSING_FORMULAE+=( "$formula" )
    fi
  done

  if [[ ${#MISSING_FORMULAE[@]} -eq 0 ]]; then
    echo "[~] OK: brew formulae required for build are installed"
    return 0
  fi

  # Handle missing formulae
  if [[ ${#MISSING_FORMULAE[@]} -gt 0 ]]; then
    PACKAGE_INSTALL_CMD+=( brew install --overwrite ${MISSING_FORMULAE[*]} )
  fi
}

check () {
  PACKAGE_INSTALL_CMD=()
  
  DISTRO="${ID_LIKE:-${ID:-}}"
  for word in $DISTRO ; do
    case "$word" in
      fedora|debian|alpine|macos)
        check_${word}_pkgs
        ;;
      rhel|centos)
        check_fedora_pkgs
        ;;
      *)
        echo "Unsupported distro $DISTRO. Your mileage may vary."
        ;;
    esac
  done

  if [[ ${#PACKAGE_INSTALL_CMD[@]} -gt 0 ]]; then
    echo "[!] Found missing system packages"
    echo "[?] This is fixed by the following command:"
    echo "        ${PACKAGE_INSTALL_CMD[@]}"
    if [[ "${TN_AUTO_INSTALL_PACKAGES:-}" == "1" ]]; then
      choice=y
    else
      read -r -p "[?] Install missing system packages? (y/N) " choice
    fi
    case "$choice" in
      y|Y)
        echo "[+] Installing missing packages"
        "${PACKAGE_INSTALL_CMD[@]}"
        echo "[+] Finished installing missing packages"
        ;;
      *)
        echo "[-] Skipping package install"
        ;;
    esac
  fi
}

fetch () {
  mkdir -pv "$PREFIX/git"

  checkout_repo riscv-gnu-toolchain https://github.com/riscv/riscv-gnu-toolchain "2025.01.20"
  checkout_repo picolibc https://github.com/picolibc/picolibc "1.8.9"
}

install_riscv () {
  unset MACHINE
  cd "$PREFIX/git/riscv-gnu-toolchain"
  echo "[+] Configuring riscv-gnu-toolchain"
  
  run_quiet git submodule set-url binutils https://gnu.googlesource.com/binutils-gdb.git
  run_quiet git submodule set-url gdb https://gnu.googlesource.com/binutils-gdb.git
  run_quiet git submodule set-url gcc https://github.com/gcc-mirror/gcc.git

  # Apply zlib fix patch for RISC-V toolchain
  echo "[+] Applying zlib fix patch"
  run_quiet git submodule update --depth 1 --init --recursive binutils

  # Create and apply zlib fix patch
  cat > /tmp/zlib-fix.patch << 'ZLIB_PATCH_EOF'
Submodule binutils contains modified content
diff --git a/binutils/zlib/zutil.h b/binutils/zlib/zutil.h
index d9a20ae1..8d221f2a 100644
--- a/binutils/zlib/zutil.h
+++ b/binutils/zlib/zutil.h
@@ -137,18 +137,18 @@ extern z_const char * const z_errmsg[10]; /* indexed by 2-zlib_error */
 #  endif
 #endif

-#if defined(MACOS) || defined(TARGET_OS_MAC)
-#  define OS_CODE  7
-#  ifndef Z_SOLO
-#    if defined(__MWERKS__) && __dest_os != __be_os && __dest_os != __win32_os
-#      include <unix.h> /* for fdopen */
-#    else
-#      ifndef fdopen
-#        define fdopen(fd,mode) NULL /* No fdopen() */
-#      endif
-#    endif
-#  endif
-#endif
+// #if defined(MACOS) || defined(TARGET_OS_MAC)
+// #  define OS_CODE  7
+// #  ifndef Z_SOLO
+// #    if defined(__MWERKS__) && __dest_os != __be_os && __dest_os != __win32_os
+// #      include <unix.h> /* for fdopen */
+// #    else
+// #      ifndef fdopen
+// #        define fdopen(fd,mode) NULL /* No fdopen() */
+// #      endif
+// #    endif
+// #  endif
+// #endif

 #ifdef __acorn
 #  define OS_CODE 13
ZLIB_PATCH_EOF

  run_quiet patch -p1 -i /tmp/zlib-fix.patch
  rm -f /tmp/zlib-fix.patch

  run_quiet ./configure --prefix="$PREFIX" \
    --with-arch=rv64imc_zicsr_zba_zbb_zbc_zbs_zknh \
    --with-abi=lp64 \
    --with-languages=c,c++ \
    --with-cmodel=medany \
    --disable-gdb

  echo "[+] Configured riscv-gnu-toolchain"

  echo "[+] Building riscv-gnu-toolchain (bare metal, no C library)"
  export BINUTILS_TARGET_FLAGS_EXTRA="--without-zstd"
  export GCC_EXTRA_CONFIGURE_FLAGS="--without-zstd"
  run_quiet "${MAKE[@]}" -s
  echo "[+] Successfully built riscv-gnu-toolchain"

  echo "[+] Installing riscv-gnu-toolchain to $PREFIX"
  run_quiet "${MAKE[@]}" -s install
  cd ../..
  echo "[+] Successfully installed riscv-gnu-toolchain"
}

install_picolibc () {
  unset MACHINE
  cd "$PREFIX/git/picolibc"
  echo "[+] Configuring picolibc"
  export PATH=$PREFIX/bin:$PATH
  mkdir -p build
  cd build
  
  # Create cross-compile configuration file
  local CROSS_FILE="$PWD/cross-compile-thruvm.txt"
  cat > "$CROSS_FILE" << 'EOF'
# Picolibc cross-compile config

[binaries]
# Meson 0.53.2 doesn't use any cflags when doing basic compiler tests,
# so we have to add -nostdlib to the compiler configuration itself or
# early compiler tests will fail. This can be removed when picolibc
# requires at least version 0.54.2 of meson.
c = ['riscv64-unknown-elf-gcc', '-nostdlib']
cpp = ['riscv64-unknown-elf-g++', '-nostdlib']
ar = 'riscv64-unknown-elf-ar'
as = 'riscv64-unknown-elf-as'
strip = 'riscv64-unknown-elf-strip'
nm = 'riscv64-unknown-elf-nm'
# only needed to run tests
exe_wrapper = ['sh', '-c', 'test -z "$PICOLIBC_TEST" || run-riscv "$@"', 'run-riscv']

[host_machine]
system = 'unknown'
cpu_family = 'riscv64'
cpu = 'riscv'
endian = 'little'

[built-in options]
# this uses shorter but slower function entry code
c_args = ['-msave-restore', '-march=rv64imc_zicsr_zba_zbb_zbc_zbs_zknh', '-mabi=lp64', '-mcmodel=medlow']
cpp_args = ['-msave-restore', '-march=rv64imc_zicsr_zba_zbb_zbc_zbs_zknh', '-mabi=lp64', '-mcmodel=medlow']

[properties]
# default multilib is 64 bit
skip_sanity_check = true
default_flash_addr = '0x00000000'
default_flash_size = '0x01000000'
default_ram_addr   = '0x03000000'
default_ram_size   = '0x01000000'
EOF

  run_quiet meson setup -Dprefix=$PREFIX \
    -Dtests=false \
    -Dmultilib=false \
    -Dincludedir=picolibc/thruvm/include \
    -Dlibdir=picolibc/thruvm/lib \
    --cross-file "$CROSS_FILE" \
    --optimization 2 \
    ../
  echo "[+] Building picolibc"
  run_quiet ninja
  echo "[+] Successfully built picolibc"
  echo "[+] Installing picolibc to $PREFIX"
  run_quiet ninja install
  
  # Clean up temporary cross-compile file
  rm -f "$CROSS_FILE"
  
  cd ../../..
  echo "[+] Successfully installed picolibc"
}

install_c () {
  echo "[+] Installing C/C++ SDK dependencies"
  mkdir -p "$PREFIX/include" "$PREFIX/lib" "$PREFIX/bin"

  ( install_riscv     )
  ( install_picolibc  )

  # Merge lib64 with lib
  if [[ -d "$PREFIX/lib64" ]]; then
    find "$PREFIX/lib64/" -mindepth 1 -exec mv -t "$PREFIX/lib/" {} +
    rm -rf "$PREFIX/lib64"
  fi

  echo "[~] Done! C/C++ SDK dependencies installed."
  echo "[~] The RISC-V toolchain (riscv64-unknown-elf-gcc) is now available in $PREFIX/bin."
}

install_rustup () {
  if [[ ! -x "$(command -v cargo)" ]]; then
    echo "[!] cargo is not in PATH"
    source "$HOME/.cargo/env" || true
  fi
  
  if [[ ! -x "$(command -v cargo)" ]]; then
    if [[ "${TN_AUTO_INSTALL_PACKAGES:-}" == "1" ]]; then
      choice=y
    else
      read -r -p "[?] Install rustup? (y/N) " choice
    fi
    case "$choice" in
      y|Y)
        echo "[+] Installing rustup"
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        echo "[+] Rustup installation completed"
        ;;
      *)
        echo "[-] Skipping rustup install"
        return 1
        ;;
    esac
  else
    echo "[~] Rust toolchain already installed"
  fi
}

install_rust_target () {
  echo "[+] Installing RISC-V Rust target"
  source "$HOME/.cargo/env" || true
  run_quiet rustup target add riscv64imac-unknown-none-elf
  echo "[+] Successfully installed RISC-V Rust target"
}

install_rust_tools () {
  echo "[+] Installing Rust tools (cargo-binutils and llvm-tools)"
  source "$HOME/.cargo/env" || true
  run_quiet cargo install cargo-binutils
  run_quiet rustup component add llvm-tools
  echo "[+] Successfully installed Rust tools"
}

install_rust () {
  install_rustup
  install_rust_target
  install_rust_tools
  
  echo "[~] Done! Rust SDK dependencies installed."
}

install_all () {
  echo "[+] Installing both C/C++ and Rust SDK dependencies"
  install_c
  echo
  install_rust
  echo "[~] Done! All SDK dependencies installed."
}

set_prefix () {
  if [[ -z "$THRU_DIR" ]]; then
    THRU_DIR="$DEFAULT_THRU_DIR"
  fi
  PREFIX="$THRU_DIR/.thru/sdk/toolchain"
}

THRU_DIR="$DEFAULT_THRU_DIR"
set_prefix
ACTION=0
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help|help)
      help
      ;;
    --thru-dir)
      shift
      THRU_DIR=$(realpath "$1")
      set_prefix
      shift
      ;;
    nuke)
      shift
      nuke
      ACTION=1
      ;;
    fetch)
      shift
      fetch
      ACTION=1
      ;;
    check)
      shift
      check
      ACTION=1
      ;;
    install)
      shift
      install_all
      ACTION=1
      ;;

    install-c)
      shift
      install_c
      ACTION=1
      ;;
    install-rust)
      shift
      install_rust
      ACTION=1
      ;;
    install-all)
      shift
      install_all
      ACTION=1
      ;;
    *)
      echo "Unknown command: $1" >&2
      exit 1
      ;;
  esac
done

if [[ $ACTION == 0 ]]; then
  echo "[~] This will fetch, build, and install C/C++ SDK dependencies into $PREFIX"
  echo "[~] For Rust dependencies, use: $0 install-rust"
  echo "[~] For all dependencies, use: $0 install-all"
  echo "[~] For help, run: $0 help"
  echo
  echo "[~] Running $0 fetch check install-all"

  read -r -p "[?] Continue? (y/N) " choice
  case "$choice" in
    y|Y)
      echo
      fetch
      check
      install_all
      ;;
    *)
      echo "[!] Stopping." >&2
      exit 1
  esac
fi 
