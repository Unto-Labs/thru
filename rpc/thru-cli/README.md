# Thru CLI

A command-line interface for interacting with the Thru blockchain network. The Thru CLI provides access to RPC methods and program upload functionality, making it easy to query blockchain data and deploy programs.

## Getting Started

See the [Setting Up Thru Devkit](https://docs.thru.org/program-development/setting-up-thru-devkit) guide for installation and usage instructions.

## Quick tips and examples

- Keys
  - Generate: `thru-cli keys generate mykey`
  - Add (hex, overwrite): `thru-cli keys add --overwrite mykey <64-hex-privkey>`
- Accounts
  - Create: `thru-cli account create mykey`
  - Info: `thru-cli getaccountinfo mykey`
- Transfers
  - Native: `thru-cli transfer airdrop sink 123`
- Token (custom mint)
  - Initialize mint: `thru-cli token initialize-mint <creator-ta> --decimals 6 TICKER <32B-hex-seed> --fee-payer <key>`
  - Initialize token account: `thru-cli token initialize-account <mint> <owner-ta> <32B-hex-seed> --fee-payer <key>`
  - Mint to: `thru-cli token mint-to <mint> <account> <authority-ta> <amount> --fee-payer <key>`
  - Transfer: `thru-cli token transfer <from-account> <to-account> <amount> --fee-payer <key>`
- WTHRU
  - Derive mint/vault (new): `thru-cli wthru derive`
  - Initialize: `thru-cli wthru initialize --fee-payer <key>`
  - Deposit (wrap): `thru-cli wthru deposit <dest-token-account> <lamports> --fee-payer <key>`
- Name Service & Registrar
  - Derive registrar for root: `thru-cli nameservice derive-registrar-account <root>`
  - Initialize base root: `thru-cli nameservice init-root <root> --fee-payer <key>`
  - Initialize registrar: `thru-cli registrar initialize-registry <registrar> <treasurer_token_acc> <mint> <price> <root> --fee-payer <key>`

Notes

- For `account compress|decompress`, the fee payer is a positional argument: `thru-cli account compress <target-account> [fee_payer]`. (Named flag `--fee-payer` is not supported.)
- Many commands accept key names (from config) or `ta...` addresses; for seeds use 32-byte hex.

## License

This project is licensed under the Apache License 2.0.
