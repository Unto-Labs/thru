CURRENTDIR:=$(dir $(realpath $(lastword $(MAKEFILE_LIST))))

ifndef THRU_CPP_SDK_DIR
$(error THRU_CPP_SDK_DIR is not set. Please set it to the location of the Thru SDK install.)
endif

# Default target
all:

# Include configuration
include $(THRU_CPP_SDK_DIR)/config/base.mk

CPPFLAGS+=-I$(THRU_CPP_SDK_DIR)/include
LDFLAGS+=-L$(THRU_CPP_SDK_DIR)/lib

include $(THRU_CPP_SDK_DIR)/config/machine/thruvm.mk
include $(addprefix $(THRU_CPP_SDK_DIR)/config/extra/with-,$(addsuffix .mk,$(SDK_EXTRAS)))
include $(THRU_CPP_SDK_DIR)/config/thru_cpp.mk 
