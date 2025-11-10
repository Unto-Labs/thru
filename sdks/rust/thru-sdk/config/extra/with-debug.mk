# Debug build configuration for Rust
# Enables debug symbols and removes optimization

# Override build flags for debug
CARGO_BUILD_FLAGS:=--target $(RUST_TARGET)

# Add debug-specific defines  
EXTRA_CPPFLAGS += -DTHRUNET_DEBUG=1 