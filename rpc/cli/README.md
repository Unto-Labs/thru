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

- **Preferred install path**: End users should install the CLI with `npm i -g thru`.
  The npm package ships prebuilt binaries through per-platform packages
  (`thru-linux-x64`, `thru-darwin-arm64`, ...) selected via `optionalDependencies` —
  no postinstall script, no GitHub download at install time (see
  `web/packages/cli/README.md`). Linux machines without npm can install the
  `.deb`/`.rpm` packages attached to each GitHub release (built by
  `cli-artifacts.yml` from the same binaries). The Cargo packages continue to
  publish for compatibility and source-based installs.

## Signing keys

`~/.thru/cli/config.yaml` stores public addresses and key references, never signing
seeds. A new config has no signing keys. Generate or register a key explicitly:

```bash
# Dedicated 0600 file in the CLI's private keys directory.
thru keys generate default --store file

# macOS: generate directly into Keychain, without a plaintext key file.
thru keys generate alice --store keychain

# Register an existing seed file, or import it into Keychain.
thru keys add bob --file ./private/bob.key
thru keys add carol --file ./private/carol.key --store keychain

# Import from a pipe without putting the seed in argv.
secret-provider | thru keys add imported --stdin --store keychain
```

Key files the CLI writes use the version-1 JSON key file format:

```json
{
  "version": 1,
  "key_type": "ed25519",
  "public_key": "ta...",
  "seed": "<64 hexadecimal characters>"
}
```

The object must have exactly these four fields, and `public_key` must be the
address derived from `seed`. For compatibility, readers also accept the legacy
format: a bare 64-hexadecimal-character seed. Both allow surrounding ASCII
whitespace and are limited to 4096 bytes; errors never echo file contents.
`thru keys add --stdin` accepts either format. `keys migrate` rewrites
CLI-managed legacy files as JSON in place; files you registered with `--file`
are never rewritten. Key files are not encrypted: protection is file ownership
and permissions, so prefer `--store keychain` on macOS.

On Unix, the file and its immediate
directory must be owned by the effective user with no group/other permission bits.
Owner-read-only files (`0400`) and directories (`0500`) are accepted; new files and
directories use `0600` and `0700`. Symlinks, non-regular files, and files with more
than one hard link are rejected. `--file` with the default file store registers the
original file; it does not copy it. Generation and stdin imports create managed files.

Every signing role accepts the same key reference, including `--fee-payer`,
`--signer`, and transfer's source:

| Reference | Resolution |
| --- | --- |
| `/absolute/key`, `./key`, `../key`, `file:path` | Read a seed file; CLI-relative paths use the working directory. |
| `keychain:<id>` | Read the signing-key item from macOS Keychain. |
| `alias:<name>` | Select an alias explicitly, including a legacy name resembling a source or address. |
| Any other value | Case-insensitive config alias. |

Direct references need no config alias or default key. Paths without an explicit
path prefix are aliases, even if a matching file exists. Config-relative file
paths resolve against the config directory. An unavailable explicit source fails;
it never falls back to another key or to file storage. Keychain references fail
clearly on non-macOS platforms.

`keys get` and `keys list` return only names, public addresses, and source
references. Their JSON output has `keys.public_key` / `keys.reference`, or
`keys.entries` for lists; the former secret-bearing `keys.value` is removed.
Public-address lookups for registered aliases do not load the secret. When signing,
the loaded key must match the alias's public metadata.
Each signing source is loaded once per command and shared by its signing roles,
so a later file change cannot replace a key already used for authority checks.

Keychain-backed generation and signing never write plaintext signing keys to
disk. Signing-key storage is separate from Developers API credential storage;
`THRU_DEVELOPERS_CREDENTIAL_STORE` does not change the selected signing backend.

### Moving keys between files and Keychain

```bash
thru keys move alice --to keychain   # one alias
thru keys move --all --to file       # every registered key
```

`keys move` copies each secret into the target storage (a new JSON key file in
the CLI's keys directory, or a new Keychain item) and verifies the copy before
changing anything. All aliases are then repointed in one atomic config write; if
any copy fails, nothing changes and the new copies are removed. Aliases that
share one secret move together as one copy. Keys already in the target storage
are reported as unchanged. Afterwards the old copy is deleted when the CLI
created it (a managed key file or a Keychain item) and no other alias still uses
it; a file you registered in place with `--file` is kept. Moving from the
Keychain to a file writes the seed to disk unencrypted. No `keys` command prints
a seed.

### Migrating existing configs

Until you migrate, commands that do not sign keep working and print a notice
naming the inline keys (`keys list --json` reports them under `unmigrated`).
Signing with an inline key, or any command that changes the config, fails
without rewriting it. Run one of these explicit migrations:

```bash
thru keys migrate --store file
thru keys migrate --store keychain  # macOS
```

Migration preserves legacy aliases, including names outside the new naming rules,
validates every key, stores and checks all new sources, then atomically replaces
the config with public metadata and references. It does not create a plaintext
backup. Failures before replacement keep the original config and roll back newly
created sources; rerunning a completed migration is safe. If replacement succeeds
but directory synchronization fails, the CLI reports uncertain durability and
retains the new sources rather than leaving committed references dangling.
If a legacy seed contains only digits and was left unquoted, quote its original
digits in the YAML before migrating. Do not use a number converted or rounded by
a YAML parser. Migration of an absent or already reference-only config leaves
the config file unchanged.

Keychain items store the key's public address in their Comments field, so you
can tell them apart in Keychain Access (each item's account is a random ID).
`keys migrate` also adds that comment to Keychain items created before comments
were written. It reads only item attributes, never the secret, never replaces
an existing comment, and reports a missing item or a refused change without
failing; macOS may ask to allow the change.

`keys rm NAME` and `--overwrite` reclaim an old CLI-managed file after the
updated config is durably saved, unless another alias still uses that source.
External files and Keychain items are retained and their references reported.
`--delete-secret` explicitly deletes an unshared external file or Keychain item;
`--force` is required to remove `default`. Check the reported retained/deleted
reference (`keys.secret` in JSON). Deleting the last managed copy can permanently
lose access to its accounts.

Existing configs are read without rewriting comments or adding defaulted fields.
Every config mutation shares a lock and applies its change to a fresh snapshot.

## Core program manager

`thru program` and `thru abi` retain Public/external behavior. A Core address
cannot be substituted into the Public instruction encoder. Use the separate
`thru governance` command for canonical managed programs and their official ABIs.

The offline input format is the exported Rust `governance::PlanInput`: canonical
`wrapper`, `target_program`, `config`, the exact `admin`, `eoa_admin`, fixed
`accounts.read_write`/`accounts.read_only` lists, a typed `operation`, and the
reviewed bootstrap `ReviewedStatePlan` in `reviewed_state`. Addresses accept
Thru addresses or 64 hex digits; seeds are exactly 32 bytes of hex. Account lists
must already be sorted by public-key bytes and disjoint. Slot zero is reserved
for the executor and slot one for `wrapper`; a bound reference to that program
uses slot one rather than duplicating it in the fixed lists. The remaining
writable then readonly slots never change after approval.

Normally `wrapper` is canonical Multicall. To govern Multicall itself, including
resuming it while paused, use a direct layout: Core Manager for an EOA-admin
lifecycle operation, ABI Manager for an EOA-admin official-ABI operation, or
canonical Multisig for a Multisig admin. Include Multicall as an ordinary
writable subject when its lifecycle changes. No instruction invokes that subject.

```sh
thru governance plan --input operation.json --output approved-plan.json \
  --reviewed-state-output reviewed-state-plan.json
thru governance inspect "$CORE_CONFIG" --kind config
thru governance inspect "$MULTISIG_STATE" --kind multisig
thru governance propose --plan approved-plan.json --multisig "$MULTISIG_STATE" \
  --request "$REQUEST" --seed "$REQUEST_SEED_HEX" \
  --multisig-program "$MULTISIG_PROGRAM" --signer member
thru governance approve --plan approved-plan.json --multisig "$MULTISIG_STATE" \
  --request "$REQUEST" --multisig-program "$MULTISIG_PROGRAM" --signer member
thru governance approve --plan approved-plan.json --multisig "$MULTISIG_STATE" \
  --request "$REQUEST" --multisig-program "$MULTISIG_PROGRAM" --signer other-member
thru governance execute --plan approved-plan.json --multisig "$MULTISIG_STATE" \
  --request "$REQUEST" --multisig-program "$MULTISIG_PROGRAM" \
  --signer executor --receipt execution-receipt.json
```

Proposal creation does not cast a vote. Each approving member, including the
proposer, must submit an explicit approval. The example collects both votes for
a two-member, two-approval Multisig; use the configured threshold.

All referenced accounts, including Multisig state, request and executable, must
be included before proposal. Inspect requests with `--kind request` and Core
managed metadata with `--kind metadata`. Proposal/approval/execution compare
the stored invoke payload with the reviewed child, including fixed indexes,
expected addresses, source ranges, and hashes. Neither fetching RPC state nor
observing a higher version approves an expected-state update.

Image operations require `image.artifact`, `source`, `offset`, `length`, and
`sha256`. The local artifact is exactly the source range to install, not the
entire uploader account. Executable hashes include the image header and trailer;
ABI hashes include prepared YAML only, not the 45-byte ABI account header.
The exact local artifact is rechecked before signing.
Prepared ABI validation also resolves every declared type, validates all named
roots and builds the layout IR from those same bytes, without rewriting them.

Supported `operation` values are `create`, `upgrade`, `set-pause`, `destroy`,
`finalize`, `set-application-authority`, `set-pin`, `propose-admin`,
`accept-admin`, and `abi`. `create` without `proof_slot` is ephemeral;
permanent creates bind a `proof_slot` with address, `coreprf1`-prefixed seed,
metadata target and program target. With the Multicall layout, execution obtains
both fresh creation proofs and wraps `WriteProofSlot` followed by the unchanged
approved operation in one transaction. An independent executor may refresh and
execute without changing any approved bytes. Request capacity and transaction
size, including proof capacity, are checked before collecting approvals.

Direct permanent creation instead confirms a separate permissionless proof
refresh transaction before submitting the approved operation. Its receipt
records that refresh and identifies the non-atomic execution mode. Another
writer can invalidate those proofs between transactions and cause failure, but
cannot change the approved targets or bytes. Prefer the atomic Multicall layout
when Multicall is available.

For EOA authorization, set `eoa_admin: true`, omit the admin from fixed account
lists, and execute with that exact admin signer, without Multisig arguments.
Rotation is two reviewed operations: `propose-admin` binds the candidate and
kind (`1` EOA, `2` Multisig); `accept-admin` binds the pending candidate as admin.
A newly introduced Multisig may add exactly its own reviewed descriptor under
`roles.after.multisigs`: address, sorted members, threshold and durable account
flags (`0` or `UNCOMPRESSABLE`, `4`). Descriptors containing `NEW` are rejected.
Execution compares the canonical owner and descriptor with live state before
submission and again before issuing a receipt, ignoring only the live account's
transient `NEW` bit (`32`), which may clear between checks. It never replaces
reviewed values with RPC observations. Unrelated role descriptors cannot change
during rotation.
To upgrade the protected Multisig executable, rotate to a live EOA, accept as
that EOA, execute the image-bound upgrade, propose the intended Multisig, then
accept through its approved request. There is no protected-owner override.

The `abi` action is `create-meta-permanent`, `create-meta-ephemeral`,
`create-content-permanent`, `create-content-ephemeral`, `upgrade`, `close`,
`finalize`, or `correct-root`. Ordinary actions bind subject, program metadata,
ABI metadata and (except metadata creation) content. Payload actions also bind
an image. Permanent creates append one creation proof. `correct-root` accepts
only the fixed Core subject and no program metadata; it upgrades ABI content,
never Core code, and provides no root close/finalize path.

Execution compares explicitly reviewed program state with live accounts before
submission and again before issuing a successful receipt: executable commitments,
metadata versions and lifecycle, authorities, exact account flags, and official
ABI links, revisions and content. Stale before-state prevents submission; direct
creation rechecks it after the separate proof refresh. A mismatching or unreadable
after-state withholds the receipt and reports the executed transaction ID for
reconciliation. These RPC checks detect drift, not atomic concurrency protection.
Proposal, approval and proof refresh do not advance expected state.

Creation plans must predict runtime flags exactly for each account. Fresh
permanent accounts receive `NEW` (`32`); permanent revival preserves prior flags
except `DELETED` and `RECEIVE_NATIVE`. Ephemeral creation resets flags to
`EPHEMERAL` (`8`), without `NEW`. Core additionally sets executable `PROGRAM` and
applies the requested pin bit without clearing inherited permanent pins. Planning
rejects invalid before-state classes and impossible after-state flags for Core
executables/metadata and official-ABI metadata/content, before any submission.

Destroy reviews bind each account's deletion class independently: deletion
clears `RECEIVE_NATIVE`, adds `DELETED` for `NEW` or `EPHEMERAL`, and Core
additionally clears executable `PROGRAM`. Reviewed removable terminal accounts
may be exact empty corpses or absent from RPC; older permanent accounts must
remain present and empty. ABI close deletes only content and preserves its
metadata. Missing nonterminal accounts, RPC errors, owner/flag drift and
resurrection withhold the receipt. Program-state `NEW` remains an exact flag,
unlike the separate Multisig-role comparison.

Successful execution writes a receipt containing the canonical reviewed-state
plan digest and transaction ID. Bootstrap `expected-state:update` requires
`--operation-plan approved-plan.json` as well as `--plan reviewed-state-plan.json`,
`--receipt execution-receipt.json`, `--baseline` and `--output`. It validates the
actual encoded operation and reviewed local artifacts before publishing the
new baseline. Explicitly select that output for `verify`/`ensure`.
Failed transactions write no success receipt.

The embedded Token ABI is `crates/thru-core/abi/tn_token_program.abi.yaml`,
generated by the canonical ABI preparation pipeline and included in the Cargo
package. Generate it before packaging; do not restore the retired flat filename.


---

## Multisig

`thru multisig` operates the M-of-N multisig program
(`programs/c/examples/tn_multisig_program.c`, canonical address
`MULTISIG_PROGRAM_ADDRESS`; override with `multisig_program_public_key` in
config or `--program`). `thru governance` remains the flow for reviewed Core
governance plans; `thru multisig` is the general-purpose interface.

- `create`, `show`, `requests`, `request show`
- `propose invoke | set-threshold | add-members | remove-members | replace-members | set-members | delete-multisig`
- `approve`, `execute`, `cancel`
- `--via-multisig <multisig>` on `token mint-to/burn/transfer/freeze-account/thaw-account/close-account`,
  `program upgrade/set-authority/claim-authority/set-pause` and
  `feature-gates create-entry/arm/disarm/update-timing-knobs/propose-admin/accept-admin`
  turns the action into a proposal.
- `program create` and `program upgrade` require `--abi <file>` (the program
  and its official ABI change in one Multicall transaction) or
  `--dangerously-exclude-abi`. With `--via-multisig`, `--abi` proposes one
  Multicall that upgrades both; the official ABI must already exist, and
  `approve`/`execute` also require `--expect-abi-hash`.
- `program upgrade --via-multisig` uploads the code to a buffer owned by the
  proposer, which can still replace it before execution. `request show` prints
  the SHA-256 of the code the upgrade would install, and `approve`/`execute`
  require `--expect-code-hash` for upgrades. This protects members using the
  CLI; binding the code on chain needs a program change. The
  multisig program can't upgrade itself this way (it occupies the transaction's
  program slot); use `thru governance`.

End-to-end coverage: the `multisig` scenario in `rpc/cli/tests/thru_cli_e2e.sh`
(`TEST_SCOPE=multisig`).

`--fee-payer` (alias `--signer`) is the acting member. Proposing also approves
unless `--no-approve`. An invoke request stores the account indices of its
child instruction; the CLI uses one layout for proposal and execution
(`thru_base::multisig::MultisigLayout`) and rebuilds it from the stored request
at execute time. The request records indices but not access modes, so the CLI
only proposes with a request address whose writable/read-only split is the
only one consistent with those indices, and refuses to execute an ambiguous
request. Child instructions name accounts by transaction index and index 0 is the
executing key, so `propose`, `approve` and `execute` refuse a call that uses an
index the request doesn't record (for programs the CLI decodes) and warn when it
can't check. `execute` shows the action and asks before signing unless `--yes`.
`approve` and `execute` re-read the request just before signing and stop if it
was replaced. Binding an approval to the request's contents on chain needs a
program change. `request show` and `approve` decode token, manager and
feature-gate calls, then fall back to the target program's on-chain ABI, then
hex with a warning.

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
   New canonical Cargo package. `cargo install thru` remains available for source-based installs.

3. **`thru-cli` (0.1.0)**
   ```
   cd crates/thru-cli && cargo publish
   ```
   Existing `cargo install thru-cli` users
   get the new wrapper with the deprecation warning.

### Post-publish validation

- [ ] `npm i -g thru` — confirm the platform package binary works (also check `npx thru` from a local, non-global install)
- [ ] `cargo install thru` — confirm source-based install still works
- [ ] `cargo install thru-cli` — confirm binary works and shows deprecation warning
- [ ] `thru --version` and `thru-cli --version` show same version

---

## Deprecation plan for `thru-cli`

### Stage 1: Soft deprecation (current state)

- `thru-cli` prints a yellow warning to stderr on every interactive run:
  > Warning: `thru-cli` is being moved to `thru`, and will soon be deprecated.
  > Install it with: npm i -g thru
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
  > Error: `thru-cli` has been retired. Install `thru` instead: npm i -g thru
- Mark the crate as deprecated on crates.io
- Remove `crates/thru-cli/` from the workspace


## Developers login and test funds

Build with `cargo build --bin thru`, then:

```sh
target/debug/thru auth login
target/debug/thru --network betanet faucet withdraw uusd ta... 100
```

Use an existing UUSD token account. THRU uses `faucet withdraw thru <account> <raw-amount>` for an existing account, accepting 1–10000 raw units (`native` remains an alias). Both commands use Developers authentication; THRU withdrawals no longer accept `--fee-payer` or sign locally. `faucet deposit` is unchanged.

`auth status` checks your account; `auth logout` revokes this installation. Re-login replaces its saved authorization only after approval. The login and the provisioned API key are stored in owner-only files under `~/.thru/cli/auth` (directory `0700`, files `0600` on Unix); the CLI never uses the OS keychain.

`THRU_DEVELOPERS_URL` defaults to `https://dev.thru.org`; use `http://127.0.0.1:3018` for the local preview. Hosted staging requires Cloudflare Access transport that the CLI does not provide. For development, use local Developers with the authenticated staging faucet.

`THRU_DEVELOPERS_API_KEY` supplies a raw API key from your secret environment, overriding login for THRU and UUSD funding. Each account shares 5 requests per rolling minute across all callers. Funding is never retried automatically; check balance/history after uncertain results.

[Authentication configuration](https://thru.org/docs/cli-reference/global-flags-and-config#developers-authentication) · [Faucet reference](https://thru.org/docs/cli-reference/faucet-commands)
