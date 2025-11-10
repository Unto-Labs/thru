BUILDDIR?=thruvm

# ThruNet VM specific configuration
# This configuration is for building ThruNet C++ SDK programs for the ThruNet VM

include $(THRU_CPP_SDK_DIR)/config/extra/with-gcc.mk

# Standard flags
CXXFLAGS+=-std=c++20 \
	-march=rv64imc_zba_zbb_zbc_zbs_zknh -mabi=lp64 -mcmodel=medlow -mstrict-align \
	-specs=picolibcpp.specs --picolibc-prefix=$(RISCV_TOOLCHAIN_ROOT) -O3 -fno-stack-protector -ffreestanding \
	-ffunction-sections -fdata-sections -nostartfiles -static-pie -fPIE \
	-Werror -Wall -Wextra -Wpedantic -Wstrict-aliasing=2 -Wconversion \
	-fno-exceptions -fno-rtti

LDFLAGS+=-e _start -T $(THRU_CPP_SDK_DIR)/config/link.ld -Wl,-gc-sections

# Additional flags specific to ThruNet VM
CPPFLAGS+=-DTHRU_VM=1