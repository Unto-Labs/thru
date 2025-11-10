CURRENTDIR:=$(dir $(realpath $(lastword $(MAKEFILE_LIST))))

ifndef THRU_RUST_SDK_DIR
THRU_RUST_SDK_DIR:=$(CURRENTDIR)
endif

# Default target
all:

# Include configuration
include $(THRU_RUST_SDK_DIR)/config/base.mk
include $(THRU_RUST_SDK_DIR)/config/machine/thruvm.mk
include $(addprefix $(THRU_RUST_SDK_DIR)/config/extra/with-,$(addsuffix .mk,$(SDK_EXTRAS)))
include $(THRU_RUST_SDK_DIR)/config/thru_rust.mk 