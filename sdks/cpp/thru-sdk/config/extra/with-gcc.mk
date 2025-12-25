# RISC-V riscv64-unknown-elf toolchain detection and configuration
# This file detects the RISC-V toolchain and sets up the build environment

# Define toolchain prefix
RISCV_PREFIX := riscv64-unknown-elf-

# Function to find .thru/sdk/toolchain directory by walking up filesystem
define find-thru-toolchain
$(strip $(call _find-thru-toolchain-rec,$(CURDIR)))
endef

# Recursive helper function to search up the directory tree
define _find-thru-toolchain-rec
$(if $(wildcard $(1)/.thru/sdk/toolchain/bin/$(RISCV_PREFIX)g++),$(1)/.thru/sdk/toolchain,$(if $(filter $(1),/),$(error RISC-V toolchain not found - reached root directory),$(call _find-thru-toolchain-rec,$(dir $(1:/=)))))
endef

# Function to find sysroot in .thru/sdk/toolchain directory
define find-thru-sysroot
$(strip $(call _find-thru-sysroot-rec,$(CURDIR)))
endef

# Recursive helper function to search up the directory tree for sysroot
define _find-thru-sysroot-rec
$(if $(wildcard $(1)/.thru/sdk/toolchain/riscv64-unknown-elf/include),$(1)/.thru/sdk/toolchain/riscv64-unknown-elf,$(if $(filter $(1),/),$(error RISC-V sysroot not found - reached root directory),$(call _find-thru-sysroot-rec,$(dir $(1:/=)))))
endef

# Detect toolchain path (env var first, then search)
ifndef RISCV_TOOLCHAIN_ROOT
  RISCV_TOOLCHAIN_ROOT := $(call find-thru-toolchain)
endif
RISCV_TOOLCHAIN_PATH := $(RISCV_TOOLCHAIN_ROOT)/bin

# Auto-detect prefix (nix uses riscv64-none-elf-, manual uses riscv64-unknown-elf-)
ifneq ($(wildcard $(RISCV_TOOLCHAIN_PATH)/riscv64-none-elf-g++),)
  RISCV_PREFIX := riscv64-none-elf-
endif

# Detect sysroot path (check multiple locations for nix vs manual install)
ifndef RISCV_SYSROOT
  ifneq ($(wildcard $(RISCV_TOOLCHAIN_ROOT)/riscv64-unknown-elf/include),)
    RISCV_SYSROOT := $(RISCV_TOOLCHAIN_ROOT)/riscv64-unknown-elf
  else ifneq ($(wildcard $(RISCV_TOOLCHAIN_ROOT)/riscv64-none-elf/include),)
    RISCV_SYSROOT := $(RISCV_TOOLCHAIN_ROOT)/riscv64-none-elf
  else ifneq ($(wildcard $(RISCV_TOOLCHAIN_ROOT)/picolibc/thruvm/include),)
    RISCV_SYSROOT := $(RISCV_TOOLCHAIN_ROOT)/picolibc/thruvm
  else
    RISCV_SYSROOT := $(call find-thru-sysroot)
  endif
endif

# Check if toolchain was found
ifeq ($(RISCV_TOOLCHAIN_PATH),)
$(error RISC-V toolchain ($(RISCV_PREFIX)g++) not found in .thru/sdk/toolchain directory. Please run deps.sh to install the toolchain or set RISCV_TOOLCHAIN_PATH)
endif

# Check if sysroot was found
ifeq ($(RISCV_SYSROOT),)
$(error RISC-V sysroot not found in .thru/sdk/toolchain directory. Please run deps.sh to install the toolchain or set RISCV_SYSROOT)
endif

# Set up toolchain variables
CXX := $(RISCV_TOOLCHAIN_PATH)/$(RISCV_PREFIX)g++
OBJCOPY := $(RISCV_TOOLCHAIN_PATH)/$(RISCV_PREFIX)objcopy
OBJDUMP := $(RISCV_TOOLCHAIN_PATH)/$(RISCV_PREFIX)objdump
AR := $(RISCV_TOOLCHAIN_PATH)/$(RISCV_PREFIX)ar
RANLIB := $(RISCV_TOOLCHAIN_PATH)/$(RISCV_PREFIX)ranlib

# Add sysroot and RISC-V specific flags
CPPFLAGS += -isystem $(RISCV_SYSROOT)/include --sysroot=$(RISCV_SYSROOT)
CXXFLAGS += --sysroot=$(RISCV_SYSROOT)

# Verify toolchain is working by checking compiler version
RISCV_CXX_VERSION := $(shell $(CXX) --version 2>/dev/null | head -1)
ifeq ($(RISCV_CXX_VERSION),)
$(error RISC-V compiler $(CXX) is not working. Please check your toolchain installation.)
endif

# Report what we found
$(info Found RISC-V toolchain: $(RISCV_TOOLCHAIN_PATH))
$(info Found RISC-V sysroot: $(RISCV_SYSROOT))
$(info RISC-V compiler version: $(RISCV_CXX_VERSION)) 