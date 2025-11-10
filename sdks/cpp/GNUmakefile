# ThruNet C++ SDK Build System
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

include thru-sdk/thru_cpp_sdk.mk
