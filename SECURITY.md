# Security Policy

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately through GitHub Security Advisories:

https://github.com/Unto-Labs/thru/security/advisories/new

Include the affected component (VM, runtime, SDK, CLI, RPC, or web package),
the release tag or commit you tested against, and a reproduction if you have
one. We aim to acknowledge reports within a few business days.

## Scope

This repository is a public mirror of an internal tree, published per release.
Reports are triaged against the internal source, so a fix may land in a later
mirrored release rather than as a commit on this repository. That is expected;
see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Supported Versions

Security fixes are applied to current development and ship in the next
mirrored release. Older release tags are not patched in place on this mirror.
