# ThruNet C SDK Build System
# Basic usage:
#
#  make -j
#
# will do a parallel make of all targets for the thruvm machine with the RISC-V toolchain.
#
# The environment variable MACHINE allows building for different
# machines. As such, the above is equivalent to running:
#
#  MACHINE=thruvm make -j
#
# The environment variable EXTRAS allows enabling optional build
# features. For example:
#
#  make -j EXTRAS="debug"
#
# would enable debug features.
#
# Build binaries, libraries, and other build artifacts will be in
# the build/thruvm directory.
#
#  make help
#
# will print out help for the make targets available.

## `find . -name Local.mk` already discovers thru-sdk/c/Local.mk from this
## directory; skip the SDK_DIR-anchored second include in thru_c.mk to avoid
## double-including the same file with a differently-formed MKPATH, which
## under -j makes parallel jobs race on the same on-disk .d.tmp/.o paths and
## silently produce an empty libtn_sdk.a (UNTO-1168 follow-up).
THRU_C_SKIP_SDK_LOCAL_MK:=1

include thru-sdk/thru_c_sdk.mk
