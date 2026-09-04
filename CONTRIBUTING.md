# Contributing to Thru

Thanks for your interest in Thru. This page explains what this repository is, how to
report problems, and how proposed changes make their way into a release.

## What this repository is

`Unto-Labs/thru` is a **public mirror** of Thru's internal development repository. It is
regenerated automatically from every tagged release of the internal repository:

- Each release produces one commit on `main` ("Mirror release vX.Y.Z") and a matching tag.
- Releases, tags, and release assets here match the internal ones.
- The mirror contains the public SDKs, client crates, CLI, protobuf definitions, and
  TypeScript packages. The node implementation is not yet published; it will be made
  available incrementally as we prepare for public release.

Because the tree is rebuilt from the manifest on every release, commits pushed directly to
this repository do not survive the next release.

## Filing issues

Open an issue on this repository for bugs, unclear documentation, or feature requests in
any of the mirrored components (SDKs, crates, CLI, TypeScript packages, protobufs). Please
include:

- the release tag or package version you are using (`thru --version`, the crate or npm
  package version),
- your platform (OS and architecture),
- what you expected, what happened, and the smallest reproduction you can manage.

Documentation issues are welcome here too; link the page on <https://thru.org/docs/>.

## Pull requests

Pull requests are welcome as proposals. Here is how they flow:

1. Open a pull request against `main` with a clear description of the problem and the
   change. Keep it focused on one thing.
2. A maintainer reviews it here. Accepted changes are ported into the internal repository
   by a maintainer, since that is where development happens.
3. The change appears in the next mirrored release, and the release notes credit you.

Your pull request will not show as "merged" on GitHub, because the mirror is regenerated
rather than merged into. That is expected; the credit lives in the release notes.

If you plan a larger change, open an issue first so we can agree on the approach before
you invest the time.

### Pull request titles

Use the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format
with a required scope, for example `fix(cli): handle empty config file` or
`docs(sdk-c): clarify account layout`.

### Code style

- **C**: follows the
  [Firedancer code style](https://github.com/firedancer-io/firedancer/blob/main/CONTRIBUTING.md).
  Public names are prefixed `tn_` / `TN_` (SDK: `tsdk_` / `TSDK_`).
- **Rust**: `cargo fmt` and `cargo clippy` clean.
- **TypeScript** (`web/`): `pnpm lint` clean.

## License

Thru is licensed under the [Apache License 2.0](./LICENSE). By contributing, you agree
that your contributions are licensed under the same terms. See [NOTICE](./NOTICE) for
third-party attributions.
