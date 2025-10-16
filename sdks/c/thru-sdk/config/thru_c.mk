MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --no-builtin-variables
.SUFFIXES:
.PHONY: all info bin lib unit-test help clean distclean asm ppp show-deps include
.PHONY: run-unit-test
.SECONDARY:
.SECONDEXPANSION:

OBJDIR:=$(BASEDIR)/$(BUILDDIR)

CPPFLAGS+=-DTN_BUILD_INFO=\"$(OBJDIR)/info\"
CPPFLAGS+=$(EXTRA_CPPFLAGS)

# Auxiliary rules that should not set up dependencies
AUX_RULES:=clean distclean help show-deps run-unit-test

all: info bin lib include

help:
	# Configuration
	# MACHINE         = $(MACHINE)
	# EXTRAS          = $(EXTRAS)
	# SHELL           = $(SHELL)
	# BASEDIR         = $(BASEDIR)
	# BUILDDIR        = $(BUILDDIR)
	# OBJDIR          = $(OBJDIR)
	# CPPFLAGS        = $(CPPFLAGS)
	# CC              = $(CC)
	# CFLAGS          = $(CFLAGS)
	# OBJCOPY         = $(OBJCOPY)
	# OBJDUMP         = $(OBJDUMP)
	# AR              = $(AR)
	# ARFLAGS         = $(ARFLAGS)
	# RANLIB          = $(RANLIB)
	# CP              = $(CP)
	# RM              = $(RM)
	# MKDIR           = $(MKDIR)
	# RMDIR           = $(RMDIR)
	# TOUCH           = $(TOUCH)
	# SED             = $(SED)
	# FIND            = $(FIND)
	# SCRUB           = $(SCRUB)
	# EXTRA_CPPFLAGS  = $(EXTRA_CPPFLAGS)
	# Explicit goals are: all bin lib unit-test help clean distclean asm ppp
	# "make all" is equivalent to "make bin lib"
	# "make info" makes build info $(OBJDIR)/info for the current platform (if not already made)
	# "make bin" makes all binaries for the current platform
	# "make lib" makes all libraries for the current platform
	# "make unit-test" makes all unit-tests for the current platform
	# "make run-unit-test" runs all unit-tests for the current platform
	# "make help" prints this message
	# "make clean" removes editor temp files and the current platform build
	# "make distclean" removes editor temp files and all platform builds
	# "make asm" makes all source files into assembly language files
	# "make ppp" run all source files through the preprocessor
	# "make show-deps" shows all the dependencies

info: $(OBJDIR)/info

clean:
	#######################################################################
	# Cleaning $(OBJDIR)
	#######################################################################
	$(RMDIR) $(OBJDIR) && \
$(SCRUB)

distclean:
	#######################################################################
	# Cleaning $(BASEDIR)
	#######################################################################
	$(RMDIR) $(BASEDIR) && \
$(SCRUB)

##############################
# Usage: $(call make-lib,name)

define _make-lib

lib: $(OBJDIR)/lib/lib$(1).a

endef

make-lib = $(eval $(call _make-lib,$(1)))

##############################
# Usage: $(call add-objs,objs,lib)

define _add-objs

DEPFILES+=$(foreach obj,$(1),$(OBJDIR)/obj/$(MKPATH)$(obj).d)

$(OBJDIR)/lib/lib$(2).a: $(foreach obj,$(1),$(OBJDIR)/obj/$(MKPATH)$(obj).o)

endef

add-objs = $(eval $(call _add-objs,$(1),$(2)))

##############################
# Usage: $(call add-asms,asms,lib)

define _add-asms

$(OBJDIR)/lib/lib$(2).a: $(foreach obj,$(1),$(OBJDIR)/obj/$(MKPATH)$(obj).o)

endef

add-asms = $(eval $(call _add-asms,$(1),$(2)))

##############################
# Usage: $(call add-hdrs,hdrs)

define _add-hdrs

include: $(foreach hdr,$(1),$(OBJDIR)/include/$(MKPATH)$(hdr))

$(foreach hdr,$(1),$(eval $(OBJDIR)/include/$(MKPATH)$(hdr): $(MKPATH)$(hdr) ; $$(MKDIR) $$(dir $$@) && $$(CP) $$< $$@ && $$(TOUCH) $$@))

endef

add-hdrs = $(eval $(call _add-hdrs,$(1)))

##############################
# Usage: $(call make-bin,name,objs,libs,flags)
# Creates a ThruNet program binary from object files

define _make-bin

DEPFILES+=$(foreach obj,$(2),$(OBJDIR)/obj/$(MKPATH)$(obj).d)

bin: $(OBJDIR)/bin/$(1).bin $(OBJDIR)/bin/$(1).s

# ELF file from object and SDK libraries
$(OBJDIR)/bin/$(1).elf: $(foreach obj,$(2),$(OBJDIR)/obj/$(MKPATH)$(obj).o) $(foreach lib,$(3),$(OBJDIR)/lib/lib$(lib).a)
	#######################################################################
	# Linking Thru program $$@ from $$^
	#######################################################################
	$(MKDIR) $$(dir $$@) && \
$(CC) $(CFLAGS) -o $$@ $(foreach obj,$(2),$(OBJDIR)/obj/$(MKPATH)$(obj).o) -L$(OBJDIR)/lib $(4) $(foreach lib,$(3), -l$(lib)) $(LDFLAGS)

# Binary file from ELF
$(OBJDIR)/bin/$(1).bin: $(OBJDIR)/bin/$(1).elf
	#######################################################################
	# Creating binary $$@ from $$<
	#######################################################################
	$(OBJCOPY) -O binary $$< $$@

# Assembly dump from ELF
$(OBJDIR)/bin/$(1).s: $(OBJDIR)/bin/$(1).elf
	#######################################################################
	# Creating assembly dump $$@ from $$<
	#######################################################################
	$(OBJDUMP) -x -D $$< > $$@

endef

make-bin = $(eval $(call _make-bin,$(1),$(2),$(3),$(4)))

##############################
# Usage: $(call make-unit-test,name,source_file)

define _make-unit-test

DEPFILES+=$(OBJDIR)/obj/test_$(1).d

unit-test: $(OBJDIR)/unit-test/test_$(1)

$(OBJDIR)/obj/test_$(1).o: $(2) $(OBJDIR)/info
	#######################################################################
	# Compiling unit test $$< to $$@
	#######################################################################
	$(MKDIR) $$(dir $$@) && \
$(CC) $(CPPFLAGS) $(CFLAGS) -c $$< -o $$@

$(OBJDIR)/unit-test/test_$(1): $(OBJDIR)/obj/test_$(1).o $(OBJDIR)/lib/libtn_sdk.a
	#######################################################################
	# Linking unit test $$@ from $$^
	#######################################################################
	$(MKDIR) $$(dir $$@) && \
$(CC) $(CFLAGS) $(LDFLAGS) -o $$@ $$< -L$(OBJDIR)/lib -ltn_sdk

endef

make-unit-test = $(eval $(call _make-unit-test,$(1),$(2)))

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

$(OBJDIR)/obj/%.d : %.c $(OBJDIR)/info
	#######################################################################
	# Generating dependencies for C source $< to $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CC) $(CPPFLAGS) $(CFLAGS) -M -MP $< -o $@.tmp && \
$(SED) 's,\($(notdir $*)\)\.o[ :]*,$(OBJDIR)/obj/$*.o $(OBJDIR)/obj/$*.S $(OBJDIR)/obj/$*.i $@ : ,g' < $@.tmp > $@ && \
$(RM) $@.tmp

$(OBJDIR)/obj/%.o : %.c $(OBJDIR)/info
	#######################################################################
	# Compiling C source $< to $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(OBJDIR)/obj/%.o : %.S $(OBJDIR)/info
	#######################################################################
	# Compiling asm source $< to $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(OBJDIR)/obj/%.S : %.c $(OBJDIR)/info
	#######################################################################
	# Compiling C source $< to assembly $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CC) $(patsubst -g,,$(CPPFLAGS) $(CFLAGS)) -S -fverbose-asm $< -o $@.tmp && \
$(SED) 's,^#,                                                                                               #,g' < $@.tmp > $@ && \
$(RM) $@.tmp

$(OBJDIR)/obj/%.i : %.c $(OBJDIR)/info
	#######################################################################
	# Preprocessing C source $< to $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CC) $(CPPFLAGS) $(CFLAGS) -E $< -o $@

$(OBJDIR)/lib/%.a :
	#######################################################################
	# Creating library $@ from $^
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(RM) $@ && \
$(AR) $(ARFLAGS) $@ $^ && \
$(RANLIB)  $@

$(OBJDIR)/include/% : %
	#######################################################################
	# Copying header $^ to $@
	#######################################################################
	$(MKDIR) $(dir $@) && \
$(CP) $^ $@ && \
$(TOUCH) $@

ifeq ($(filter $(MAKECMDGOALS),$(AUX_RULES)),)
# If we are not in an auxiliary rule (aka we need to actually build something/need dep tree)

# Include all the make fragments
define _include-mk
MKPATH:=$(dir $(1))
include $(1)
MKPATH:=
endef

# Include all Local.mk files
$(foreach mk,$(shell $(FIND) . -type f -name Local.mk),$(eval $(call _include-mk,$(mk))))

# Include all the dependencies.  Must be after the make fragments
# include so that DEPFILES is fully populated (similarly for the
# show-deps target).

show-deps:
	@for d in $(DEPFILES); do echo $$d; done

include $(DEPFILES)

# Define the asm target.  Must be after the make fragments include so that
# DEPFILES is fully populated

asm: $(DEPFILES:.d=.S)

# Define the ppp target.  Must be after the make fragments include so that
# DEPFILES is fully populated

ppp: $(DEPFILES:.d=.i)

endif
