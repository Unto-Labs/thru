# Thru

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-thru.org%2Fdocs-black.svg)](https://thru.org/docs/)
[![crates.io](https://img.shields.io/crates/v/thru-client.svg?label=thru-client)](https://crates.io/crates/thru-client)
[![npm](https://img.shields.io/npm/v/thru.svg?label=npm%20thru)](https://www.npmjs.com/package/thru)

Thru is an L1 blockchain for Rust programs, built on RISC-V.
Programs compile to standard RISC-V (RV64IMC plus bit-manipulation and crypto-hash
extensions) and run on the Thru VM. There is no custom bytecode and no compiler fork.
C is the documented path for writing programs today; a Rust program SDK ships in-tree.

> **Note**: This repository is a public mirror of an internal development repository,
> regenerated from every tagged release. The full source code for Thru will be made
> available incrementally as we prepare for public release, and development will
> eventually transition to this repository. See [CONTRIBUTING](./CONTRIBUTING.md) for how
> issues and pull requests work on a mirror.

## What's in this repository

| Path | What it is |
|---|---|
| `sdks/c/` | C SDK for writing Thru programs (documented path) |
| `sdks/cpp/` | C++ SDK |
| `sdks/rust/` | Rust program SDK |
| `rpc/cli/` | The `thru` command line interface |
| `rpc/thru-client/`, `rpc/thru-grpc-client/`, `rpc/thru-base/` | Rust client crates for talking to a Thru node |
| `rpc/abi/` | ABI definition and code-generation tooling |
| `proto/` | Protobuf definitions for the node's gRPC API |
| `web/packages/` | TypeScript packages published under the `@thru` npm scope |
| `.github/workflows/` | The release workflow that builds the SDK, toolchain, and CLI artifacts |

## Install

- **CLI**: `npm i -g thru` or `cargo install thru`. Linux `.deb`/`.rpm` packages and the C
  SDK and RISC-V toolchain tarballs are attached to every
  [release](https://github.com/Unto-Labs/thru/releases).
- **Rust**: `thru-client`, `thru-grpc-client`, and `thru-base` on
  [crates.io](https://crates.io/crates/thru-client).
- **TypeScript**: `@thru/sdk` and friends on [npm](https://www.npmjs.com/package/@thru/sdk).

## Packages

One sentence per package, identical on npm or crates.io, in the package README, and in the docs.

| Package | What it is | Docs |
|---|---|---|
| [`@thru/sdk`](https://www.npmjs.com/package/@thru/sdk) | Open-source TypeScript SDK for the Thru RISC-V Layer-1 blockchain: typed RPC client, transaction builder, keys and crypto, protobufs, and ABI reflection. | [sdk](https://thru.org/docs/sdks/web-packages/sdk/) |
| [`@thru/wallet`](https://www.npmjs.com/package/@thru/wallet) | Passkey-native embedded wallet SDK for Thru. | [wallet](https://thru.org/docs/sdks/web-packages/wallet/) |
| [`@thru/passkey`](https://www.npmjs.com/package/@thru/passkey) | WebAuthn passkey registration and signing for Thru apps across browser, popup, React Native, and server. | [passkey](https://thru.org/docs/sdks/web-packages/passkey/) |
| [`@thru/programs`](https://www.npmjs.com/package/@thru/programs) | Typed TypeScript clients for Thru's core on-chain programs: token, AMM, CLOB, oracle, multicall, passkey manager, and others. | [programs](https://thru.org/docs/sdks/web-packages/programs/) |
| [`@thru/indexer`](https://www.npmjs.com/package/@thru/indexer) | Open-source TypeScript framework for indexing Thru chain data into Postgres: event and account streams, checkpointed resume, and an auto-generated REST API. | [indexer](https://thru.org/docs/sdks/web-packages/indexer/) |
| [`@thru/replay`](https://www.npmjs.com/package/@thru/replay) | Gap-free historical plus live replay of Thru blocks, transactions, accounts, and events for ETL and analytics pipelines. | [replay](https://thru.org/docs/sdks/web-packages/replay/) |
| [`@thru/bridge`](https://www.npmjs.com/package/@thru/bridge) | TypeScript SDK for Polygon-to-Thru bridge deposits and withdrawals. | [web SDKs](https://thru.org/docs/sdks/web/) |
| [`thru`](https://www.npmjs.com/package/thru) (npm) / [`thru`](https://crates.io/crates/thru) (crates.io) | Command-line interface for the Thru blockchain: keys, accounts, transactions, program deployment, and ABI tooling. | [CLI reference](https://thru.org/docs/cli-reference/overview/) |
| [`thru-client`](https://crates.io/crates/thru-client) | High-level gRPC client library for the Thru blockchain | [Rust SDKs](https://thru.org/docs/sdks/rust/) |
| [`thru-grpc-client`](https://crates.io/crates/thru-grpc-client) | Generated tonic and prost bindings for the Thru blockchain's public gRPC API. | [thru-grpc-client](https://thru.org/docs/sdks/rust-packages/thru-grpc-client/) |
| [`thru-base`](https://crates.io/crates/thru-base) | Core Rust primitives for the Thru blockchain: key and address types, transaction builders, state proof helpers, and RPC config. | [thru-base](https://thru.org/docs/sdks/rust-packages/thru-base/) |

## Getting started

- [Setting up the Thru DevKit](https://thru.org/docs/program-development/setting-up-thru-devkit/)
- [Building a C program](https://thru.org/docs/program-development/building-a-c-program/)
- [Documentation](https://thru.org/docs/) (agent-readable index at
  [thru.org/llms.txt](https://thru.org/llms.txt))

## Explore the network

- [Explorer](https://scan.thru.org) for accounts, transactions, and programs.
- The Explorer also serves an MCP endpoint at `https://scan.thru.org/api/mcp`
  (`org.thru/thru-explorer` in the MCP registry) and an
  [OpenAPI spec](https://scan.thru.org/api/openapi.json).

## Community

- Follow [@thru_xyz](https://x.com/thru_xyz) on X.
- File issues and proposals here; see [CONTRIBUTING](./CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
