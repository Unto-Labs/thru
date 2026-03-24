# Thru CLI Migration

## Architecture decisions

- **Standalone workspace**: `rpc/cli/` is its own Cargo workspace, NOT nested inside
  `rpc/Cargo.toml`. Cargo doesn't support nested workspaces, so this is a sibling
  workspace that references `thru-client` and `thru-base` via relative `path = "../../../..."`.

- **thru-core is a library crate**: All source from the original `rpc/thru-cli/src/` was
  copied into `rpc/cli/crates/thru-core/src/`. The old `main.rs` was rewritten as `lib.rs`
  exposing a single `pub async fn run()` entry point. All modules (`cli`, `commands`,
  `config`, `crypto`, `error`, `output`, `utils`, `version_check`) are `pub mod` so the
  wrappers can access them if needed.

- **build.rs lives in thru-core**: The vergen build script that generates `VERGEN_GIT_SHA`
  and `VERGEN_GIT_DIRTY` env vars lives in thru-core because `cli.rs` invokes the
  `thru_base::get_version!()` macro (which reads `CARGO_PKG_VERSION` and VERGEN vars)
  inside the library. Since it's a macro expanded at compile time in the crate that
  defines it, the build.rs in thru-core sets the correct env vars.

- **Thin wrappers are identical except for deprecation**: `thru/src/main.rs` is a clean
  15-line wrapper. `thru-cli/src/main.rs` adds a deprecation warning to stderr before
  delegating to `thru_core::run()`. The warning only prints on interactive terminals.

- **Program name hardcoded to "thru"**: `Cli` struct in `cli.rs` uses
  `#[command(name = "thru")]`. Both binaries show `thru` in help output.
  The version check notification and crates.io API query also reference `thru`.

- **Version alignment**: All three crates (`thru-core`, `thru-cli`, `thru`) stay on
  `0.1.0` in the repo and should be versioned together.

---

## Publish plan

`thru-core`, `thru`, and `thru-cli` are all published to crates.io. The wrapper crates
use a local path dependency on `thru-core` during development, but `thru-core` must be
published first so `thru` and `thru-cli` can resolve it from crates.io during package
verification and install.

### Pre-publish checks

- [ ] Verify `thru` name is available on crates.io
- [ ] Smoke test both binaries locally (`cargo run -p thru`, `cargo run -p thru-cli`)
- [ ] Run `cargo test --workspace` and confirm passing
- [ ] Ensure `thru-core`, `thru`, and `thru-cli` Cargo.toml files have correct `repository`, `homepage`, `readme` metadata

### Publish order

1. **`thru-core` (0.1.0)**
   ```
   cd crates/thru-core && cargo publish
   ```
   Shared library dependency for both wrapper crates.

2. **`thru` (0.1.0)**
   ```
   cd crates/thru && cargo publish
   ```
   New canonical package. `cargo install thru` now works.

3. **`thru-cli` (0.1.0)**
   ```
   cd crates/thru-cli && cargo publish
   ```
   Existing `cargo install thru-cli` users
   get the new wrapper with the deprecation warning.

### Post-publish validation

- [ ] `cargo install thru` — confirm binary works
- [ ] `cargo install thru-cli` — confirm binary works and shows deprecation warning
- [ ] `thru --version` and `thru-cli --version` show same version

---

## Deprecation plan for `thru-cli`

### Stage 1: Soft deprecation (current state)

- `thru-cli` prints a yellow warning to stderr on every interactive run:
  > Warning: `thru-cli` is being moved to `thru`, and will soon be deprecated.
  > Install it with: cargo install thru
- `thru-cli` remains fully functional — identical behavior to `thru`
- All new docs reference `thru` only
- Duration: keep for at least 2-3 release cycles so users see the warning

### Stage 2: Feature freeze

- Stop publishing new features to the `thru-cli` crate
- `thru-cli` stays pinned at whatever version it was when frozen
- `thru-core` and `thru` continue getting updates
- Update the deprecation warning to be more urgent:
  > Warning: `thru-cli` is deprecated and no longer updated. Switch to `thru`.

### Stage 3: Retire

- Publish a final `thru-cli` version that prints an error and exits:
  > Error: `thru-cli` has been retired. Install `thru` instead: cargo install thru
- Mark the crate as deprecated on crates.io
- Remove `crates/thru-cli/` from the workspace
