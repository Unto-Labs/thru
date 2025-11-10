CURRENTDIR:=$(dir $(realpath $(lastword $(MAKEFILE_LIST))))

ifndef THRU_CPP_SDK_DIR
THRU_CPP_SDK_DIR:=$(CURRENTDIR)
endif

# Default target
all:

# Include configuration
include $(THRU_CPP_SDK_DIR)/config/base.mk
include $(THRU_CPP_SDK_DIR)/config/machine/thruvm.mk
include $(addprefix $(THRU_CPP_SDK_DIR)/config/extra/with-,$(addsuffix .mk,$(SDK_EXTRAS)))
include $(THRU_CPP_SDK_DIR)/config/thru_cpp.mk 
