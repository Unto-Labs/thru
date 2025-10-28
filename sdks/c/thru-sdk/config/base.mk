BASEDIR?=build
BUILDDIR?=thruvm

SHELL:=bash

# Generic flags (toolchain-specific flags will be added by extras)
CFLAGS:=-std=c17 -Werror -Wall -Wextra -Wpedantic -Wstrict-aliasing=2 -Wconversion
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
CC?=gcc
OBJCOPY?=objcopy
OBJDUMP?=objdump
AR?=ar
RANLIB?=ranlib

# Obtain compiler version so that decisions can be made on disabling/enabling
# certain flags
CC_MAJOR_VERSION=$(shell $(CC) -dumpversion | cut -f1 -d.) 