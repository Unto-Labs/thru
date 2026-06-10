# Thru CLI

Install the Thru command-line interface with npm:

```bash
npm i -g thru     # puts `thru` on your PATH
thru --help
```

A global install (`-g`) is what puts the bare `thru` command on your PATH. A
local install works too, but exposes the command through the project instead:

```bash
npm i thru        # local dependency
npx thru --help   # or node_modules/.bin/thru
```

## Supported platforms

| platform | arch  | binary package      |
| -------- | ----- | ------------------- |
| Linux    | x64   | `thru-linux-x64`    |
| Linux    | arm64 | `thru-linux-arm64`  |
| macOS    | x64   | `thru-darwin-x64`   |
| macOS    | arm64 | `thru-darwin-arm64` |
| Windows  | x64   | `thru-win32-x64`    |

## How it works

The `thru` package contains a small Node.js launcher plus one
`optionalDependencies` entry per platform package above. npm installs only the
package whose `os`/`cpu` constraints match your machine, and the launcher runs
the native binary it carries. Because the binary ships inside a regular npm
package:

- no install scripts run — `npm install --ignore-scripts` works,
- installs work offline or from the npm cache, with npm's usual integrity
  checks covering the binary itself,
- nothing is downloaded from GitHub at install time.

The same binaries are also published as release assets at
<https://github.com/Unto-Labs/thru/releases> (e.g.
`thru-cli-Linux-x86_64-<tag>.tar.gz`, verified by `thru-cli-SHA256SUMS`) if
you prefer not to use npm.

## Troubleshooting

- `The thru CLI platform package ... is not installed`: the install skipped
  optional dependencies (`--omit=optional` / `--no-optional`). Reinstall
  without those flags, or download a release binary and set `THRU_CLI_BIN`.
- `THRU_CLI_BIN=/path/to/thru` overrides binary resolution entirely; useful
  for development builds (`cargo build` in `rpc/cli`).

## Development notes

`optionalDependencies` are intentionally absent from the committed
`package.json`; `scripts/make-platform-packages.mjs` generates the platform
packages from the built binaries and pins them during the CLI publish
workflow (`.github/workflows/cli-artifacts.yml`). Run `node --test` for the
test suite and `node scripts/check-package.mjs` for the packaging invariants.
