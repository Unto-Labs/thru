BUILDDIR?=thruvm

# ThruNet VM specific configuration
# This configuration is for building ThruNet C SDK programs for the ThruNet VM

include $(THRU_C_SDK_DIR)/config/extra/with-gcc.mk
include $(THRU_C_SDK_DIR)/config/extra/with-blst.mk

# Standard flags
# -g adds DWARF debug sections without changing code generation, enabling
# thru-cli debug resolve to map PCs to source locations and variables.
CFLAGS+=-std=c17 \
	-march=rv64imc_zba_zbb_zbc_zbs_zknh -mabi=lp64 -mcmodel=medlow -mstrict-align \
	-specs=picolibc.specs --picolibc-prefix=$(RISCV_TOOLCHAIN_ROOT) -O3 -g -fno-stack-protector -ffreestanding \
	-ffunction-sections -fdata-sections -nostartfiles -static-pie -fPIE \
	-Werror -Wall -Wextra -Wpedantic -Wstrict-aliasing=2 -Wconversion

LDFLAGS+=-e _start -T $(THRU_C_SDK_DIR)/config/link.ld -Wl,-gc-sections
# Additional flags specific to ThruNet VM
CPPFLAGS+=-DTHRU_VM=1
