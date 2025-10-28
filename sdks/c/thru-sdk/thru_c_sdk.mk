CURRENTDIR:=$(dir $(realpath $(lastword $(MAKEFILE_LIST))))

ifndef THRU_C_SDK_DIR
THRU_C_SDK_DIR:=$(CURRENTDIR)
endif

# Default target
all:

# Include configuration
include $(THRU_C_SDK_DIR)/config/base.mk
include $(THRU_C_SDK_DIR)/config/machine/thruvm.mk
include $(addprefix $(THRU_C_SDK_DIR)/config/extra/with-,$(addsuffix .mk,$(SDK_EXTRAS)))
include $(THRU_C_SDK_DIR)/config/thru_c.mk
