BASEDIR?=build
BUILDDIR?=thruvm

SHELL:=bash

# Helper commands
CP:=cp -pv
RM:=rm -fv
MKDIR:=mkdir -pv
RMDIR:=rm -rfv
TOUCH:=touch
SED:=sed
FIND:=find
SCRUB:=$(FIND) . -type f -name "*~" -o -name "\#*" | xargs $(RM)
DATE:=date
CAT:=cat

# Rust/Cargo specific commands
CARGO:=cargo
CARGO_OBJCOPY:=cargo objcopy 