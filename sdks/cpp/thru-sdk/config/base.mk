BASEDIR?=build
BUILDDIR?=thruvm

SHELL:=bash

# Generic flags (toolchain-specific flags will be added by extras)
CXXFLAGS:=-std=c++20 -Werror -Wall -Wextra -Wpedantic -Wstrict-aliasing=2 -Wconversion
LDFLAGS:=
ARFLAGS:=rv

# Helper commands
CP:=cp -pv
RM:=rm -fv
PATCH:=patch
MKDIR:=mkdir -pv
RMDIR:=rm -rfv
TOUCH:=touch
SED:=sed
FIND:=find
SCRUB:=$(FIND) . -type f -name "*~" -o -name "\#*" | xargs $(RM)
DATE:=date
CAT:=cat

# Toolchain will be set by extra configuration files
# Default to standard names if not overridden
CXX?=g++
OBJCOPY?=objcopy
OBJDUMP?=objdump
AR?=ar
RANLIB?=ranlib

# Optional wrapper invoked in front of compile rules.  Empty by default; set to
# e.g. 'sccache' or 'ccache' to cache object compilation while leaving the
# selected cross-toolchain unchanged.
COMPILER_LAUNCHER?=

# Obtain compiler version so that decisions can be made on disabling/enabling
# certain flags
CXX_MAJOR_VERSION=$(shell $(CXX) -dumpversion | cut -f1 -d.)
