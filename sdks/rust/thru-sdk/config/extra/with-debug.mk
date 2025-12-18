# Debug build configuration for Rust
# Enables debug symbols and removes optimization

# Override build flags for debug
CARGO_BUILD_FLAGS:=--target $(RUST_TARGET)

# Cargo outputs to debug/ directory without --release
CARGO_PROFILE_DIR:=debug

# Add debug-specific defines
EXTRA_CPPFLAGS += -DTHRUNET_DEBUG=1 