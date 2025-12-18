MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --no-builtin-variables
.SUFFIXES:
.PHONY: all info bin help clean distclean
.SECONDARY:
.SECONDEXPANSION:

OBJDIR:=$(BASEDIR)/$(BUILDDIR)

# Default target
all: info bin

help:
	# Configuration
	# MACHINE         = $(MACHINE)
	# EXTRAS          = $(EXTRAS)
	# SHELL           = $(SHELL)
	# BASEDIR         = $(BASEDIR)
	# BUILDDIR        = $(BUILDDIR)
	# OBJDIR          = $(OBJDIR)
	# CARGO           = $(CARGO)
	# CARGO_OBJCOPY   = $(CARGO_OBJCOPY)
	# RUST_TARGET     = $(RUST_TARGET)
	# CARGO_BUILD_FLAGS = $(CARGO_BUILD_FLAGS)
	# CARGO_PROFILE_DIR = $(CARGO_PROFILE_DIR)
	# Explicit goals are: all bin help clean distclean
	# "make all" is equivalent to "make bin"
	# "make info" makes build info $(OBJDIR)/info for the current platform (if not already made)
	# "make bin" makes all binaries for the current platform
	# "make help" prints this message
	# "make clean" removes editor temp files and the current platform build
	# "make distclean" removes editor temp files and all platform builds

info: $(OBJDIR)/info

clean:
	#######################################################################
	# Cleaning $(OBJDIR) and Cargo artifacts
	#######################################################################
	$(RMDIR) $(OBJDIR) && \
	$(CARGO) clean && \
	$(SCRUB)

distclean:
	#######################################################################
	# Cleaning $(BASEDIR) and Cargo artifacts
	#######################################################################
	$(RMDIR) $(BASEDIR) && \
	$(CARGO) clean && \
	$(SCRUB)

##############################
# Usage: $(call make-cargo-bin,name,example_name)
# Builds a Rust example and copies the binary to the bin directory
# Also generates .elf file with debug symbols for GDB debugging
#
# Dependency chain:
#   1. cargo-build-$(2) is PHONY - always runs cargo (cargo handles incremental builds)
#   2. The cargo ELF output depends on cargo-build-$(2)
#   3. Our .bin and .elf depend on the cargo ELF output

define _make-cargo-bin

# Phony target that always runs cargo build (cargo handles incremental compilation)
.PHONY: cargo-build-$(2)
cargo-build-$(2): $(OBJDIR)/info
	#######################################################################
	# Running cargo build for $(2)
	#######################################################################
	$(CARGO) build --example $(2) $(CARGO_BUILD_FLAGS)

# Cargo's ELF output - depends on phony cargo-build target
target/$(RUST_TARGET)/$(CARGO_PROFILE_DIR)/examples/$(2): cargo-build-$(2)

# Our output files depend on cargo's ELF output
$(OBJDIR)/bin/$(1).bin: target/$(RUST_TARGET)/$(CARGO_PROFILE_DIR)/examples/$(2)
	#######################################################################
	# Creating $(1).bin from cargo output
	#######################################################################
	$(MKDIR) $(OBJDIR)/bin && \
	$(CARGO_OBJCOPY) --example $(2) $(CARGO_BUILD_FLAGS) -- -O binary $(OBJDIR)/bin/$(1).bin

$(OBJDIR)/bin/$(1).elf: target/$(RUST_TARGET)/$(CARGO_PROFILE_DIR)/examples/$(2)
	#######################################################################
	# Copying $(1).elf from cargo output
	#######################################################################
	$(MKDIR) $(OBJDIR)/bin && \
	cp target/$(RUST_TARGET)/$(CARGO_PROFILE_DIR)/examples/$(2) $(OBJDIR)/bin/$(1).elf

bin: $(OBJDIR)/bin/$(1).bin $(OBJDIR)/bin/$(1).elf

$(1): $(OBJDIR)/bin/$(1).bin $(OBJDIR)/bin/$(1).elf

endef

make-cargo-bin = $(eval $(call _make-cargo-bin,$(1),$(2)))

##############################
## GENERIC RULES

$(OBJDIR)/info :
	#######################################################################
	# Saving build info to $(OBJDIR)/info
	#######################################################################
	$(MKDIR) $(dir $@) && \
	echo -e \
	"# date     `$(DATE) +'%Y-%m-%d %H:%M:%S %z'`\n"\
	"# source   `whoami`@`hostname`:`pwd`\n"\
	"# machine  $(MACHINE)\n"\
	"# extras   $(EXTRAS)" > $(OBJDIR)/info

# Include all the make fragments
define _include-mk
MKPATH:=$(dir $(1))
include $(1)
MKPATH:=
endef

# Include all Local.mk files
$(foreach mk,$(shell $(FIND) . -type f -name Local.mk),$(eval $(call _include-mk,$(mk)))) 