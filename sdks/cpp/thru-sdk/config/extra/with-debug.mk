# Debug build configuration
# Add debug symbols and remove optimization

CPPFLAGS := $(patsubst -O%,-O0,$(CPPFLAGS))
CPPFLAGS += -g -DDEBUG=1

CXXFLAGS := $(patsubst -O%,-O0,$(CXXFLAGS))
CXXFLAGS += -g

# Remove optimization-related flags that might interfere with debugging
CPPFLAGS := $(patsubst -flto,,$(CPPFLAGS))
CPPFLAGS := $(patsubst -fdata-sections,,$(CPPFLAGS))
CPPFLAGS := $(patsubst -ffunction-sections,,$(CPPFLAGS))

CXXFLAGS := $(patsubst -flto,,$(CXXFLAGS))
CXXFLAGS := $(patsubst -fdata-sections,,$(CXXFLAGS))
CXXFLAGS := $(patsubst -ffunction-sections,,$(CXXFLAGS))

# Remove linker optimization flags  
comma := ,
LDFLAGS := $(patsubst -Wl$(comma)--gc-sections,,$(LDFLAGS))

# Add debug-specific defines
EXTRA_CPPFLAGS += -DTHRUNET_DEBUG=1 