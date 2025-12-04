ifneq (,$(wildcard $(RISCV_TOOLCHAIN_ROOT)/lib/libblst.a))
FD_HAS_BLST:=1
CFLAGS+=-DFD_HAS_BLST=1
LDFLAGS+=$(RISCV_TOOLCHAIN_ROOT)/lib/libblst.a
CPPFLAGS+=-I$(RISCV_TOOLCHAIN_ROOT)/include
else
$(warning "blst not installed, skipping")
endif
