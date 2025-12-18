# Debug build configuration
# Add debug symbols and remove optimization

CPPFLAGS := $(patsubst -O%,-O0,$(CPPFLAGS))
CPPFLAGS += -g -DDEBUG=1

# Also remove optimization from CFLAGS (used in thruvm.mk)
CFLAGS := $(patsubst -O%,-O0,$(CFLAGS))
CFLAGS += -g

# Remove optimization-related flags that might interfere with debugging
CPPFLAGS := $(patsubst -flto,,$(CPPFLAGS))
CPPFLAGS := $(patsubst -fdata-sections,,$(CPPFLAGS))
CPPFLAGS := $(patsubst -ffunction-sections,,$(CPPFLAGS))

# Also remove from CFLAGS
CFLAGS := $(patsubst -flto,,$(CFLAGS))
CFLAGS := $(patsubst -fdata-sections,,$(CFLAGS))
CFLAGS := $(patsubst -ffunction-sections,,$(CFLAGS))

# Force frame pointers for proper GDB backtrace support
CFLAGS += -fno-omit-frame-pointer

# Remove linker optimization flags
LDFLAGS := $(patsubst -Wl$(comma)--gc-sections,,$(LDFLAGS))

# Add debug-specific defines
EXTRA_CPPFLAGS += -DTHRUNET_DEBUG=1 