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
#   1. cargo-build-$(2) is PHONY and aliases the single cargo-build-examples
#      invocation below (cargo handles incremental builds)
#   2. The cargo ELF output depends on cargo-build-$(2)
#   3. Our .bin and .elf depend on the cargo ELF output

define _make-cargo-bin

# Per-example alias onto the single shared build below.  Deliberately no
# recipe: one `cargo build --examples` builds them all (see cargo-build-examples).
.PHONY: cargo-build-$(2)
cargo-build-$(2): cargo-build-examples

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
## SHARED CARGO BUILD

# Every example is built by ONE cargo invocation.
#
# Previously each program had its own `cargo build --example <name>` recipe.
# Under `make -j` those do not actually run in parallel: cargo takes an
# exclusive lock on the package cache and on the target directory, so N
# invocations serialize, each paying lock acquisition and its own dependency
# resolution. A stress-test CI build showed 31 "Blocking waiting for file lock"
# waits and a single 56s stall from this.
#
# One invocation takes the locks once and lets cargo parallelize the examples
# internally, which is what it is good at. Examples are enumerated by cargo
# itself from examples/, which is exactly the set programs/rust/Local.mk
# registers.
.PHONY: cargo-build-examples
cargo-build-examples: $(OBJDIR)/info
	#######################################################################
	# Running cargo build for all examples
	#######################################################################
	$(CARGO) build --examples $(CARGO_BUILD_FLAGS)

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