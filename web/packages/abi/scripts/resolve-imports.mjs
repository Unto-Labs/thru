#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

import { createThruClient } from "@thru/thru-sdk/client";
import {
  createManifest,
  OnchainFetcher,
  resolveImports,
} from "../dist/index.js";

const DEFAULT_BASE_URL = "https://grpc-web.alphanet.thruput.org";
const PKG_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../../../");

function ensureWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto = webcrypto;
  }
  if (typeof globalThis.atob !== "function") {
    globalThis.atob = (value) =>
      Buffer.from(value, "base64").toString("binary");
  }
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    [
      "Usage:",
      "  node scripts/resolve-imports.mjs --file <abi.yaml> [options]",
      "  node scripts/resolve-imports.mjs --import-onchain <address> [options]",
      "",
      "Options:",
      "  --base-url <url>       gRPC-web endpoint (default: alphanet)",
      "  --network <name>       network name for synthetic import (default: alphanet)",
      "  --target <program|abi-meta|abi> on-chain import target (default: program)",
      "  --max-depth <n>        max resolution depth (default: 10)",
      "  --out <path>           write manifest JSON to file",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    network: "alphanet",
    target: "program",
    maxDepth: 10,
    file: null,
    importOnchain: null,
    out: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url":
        opts.baseUrl = requireValue(arg, argv[++i]);
        break;
      case "--network":
        opts.network = requireValue(arg, argv[++i]);
        break;
      case "--target":
        opts.target = requireValue(arg, argv[++i]);
        break;
      case "--max-depth":
        opts.maxDepth = Number.parseInt(requireValue(arg, argv[++i]), 10);
        break;
      case "--file":
        opts.file = requireValue(arg, argv[++i]);
        break;
      case "--import-onchain":
        opts.importOnchain = requireValue(arg, argv[++i]);
        break;
      case "--out":
        opts.out = requireValue(arg, argv[++i]);
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        usage(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  if (!opts.file && !opts.importOnchain) {
    usage("Expected --file or --import-onchain");
    process.exit(1);
  }

  if (opts.file && opts.importOnchain) {
    usage("Use only one of --file or --import-onchain");
    process.exit(1);
  }

  if (!Number.isFinite(opts.maxDepth) || opts.maxDepth <= 0) {
    usage("--max-depth must be a positive integer");
    process.exit(1);
  }

  if (opts.target !== "program" && opts.target !== "abi-meta" && opts.target !== "abi") {
    usage("--target must be 'program', 'abi-meta', or 'abi'");
    process.exit(1);
  }

  return opts;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("-")) {
    usage(`Expected value after ${flag}`);
    process.exit(1);
  }
  return value;
}

function buildSyntheticRootImport(address, network, target) {
  return {
    abi: {
      package: "local.import.test",
      "abi-version": 1,
      "package-version": "0.0.0",
      description: "Synthetic root for ABI import resolver test.",
      imports: [
        {
          type: "onchain",
          address,
          target,
          network,
          revision: "latest",
        },
      ],
    },
    types: [],
  };
}

function normalizeWorkspacePath(input) {
  let path = input;
  while (path.startsWith("../") || path.startsWith("./")) {
    path = path.startsWith("../") ? path.slice(3) : path.slice(2);
  }
  return path;
}

function resolveInputPath(input) {
  if (input.startsWith("/") || input.match(/^[A-Za-z]:\\/)) {
    return input;
  }
  if (existsSync(input)) {
    return input;
  }
  const workspaceRelative = normalizeWorkspacePath(input);
  const workspacePath = resolve(WORKSPACE_ROOT, workspaceRelative);
  if (existsSync(workspacePath)) {
    return workspacePath;
  }
  return input;
}

async function loadAbiYaml(opts) {
  if (opts.file) {
    const resolvedPath = resolveInputPath(opts.file);
    const data = await readFile(resolvedPath, "utf8");
    const parsed = yaml.parse(data);
    const imports = parsed?.abi?.imports ?? [];
    for (const entry of imports) {
      const type = entry?.type;
      if (type === "path" || type === "git" || type === "http") {
        throw new Error(
          "Browser import resolver only supports on-chain imports. " +
            "Use the Rust CLI 'abi bundle' for path/git/http, or pass --import-onchain."
        );
      }
    }
    return { abiYaml: data, sourceLabel: resolvedPath };
  }

  const root = buildSyntheticRootImport(
    opts.importOnchain,
    opts.network,
    opts.target
  );
  const abiYaml = yaml.stringify(root);
  return { abiYaml, sourceLabel: "synthetic import" };
}

async function main() {
  ensureWebCrypto();
  const opts = parseArgs(process.argv);
  const { abiYaml, sourceLabel } = await loadAbiYaml(opts);

  const thru = createThruClient({ baseUrl: opts.baseUrl });
  const fetcher = new OnchainFetcher({
    thruClient: {
      query: {
        getRawAccount: async (request) => {
          const raw = await thru.accounts.getRaw(request.address.value);
          return { rawData: raw.rawData };
        },
      },
    },
  });

  const result = await resolveImports(abiYaml, {
    onchainFetcher: fetcher,
    maxDepth: opts.maxDepth,
  });
  const manifest = createManifest(result);

  console.log(
    `Resolved ${result.allPackages.length} packages from ${sourceLabel}`
  );
  for (const pkg of result.allPackages) {
    console.log(`- ${pkg.id.packageName}@${pkg.id.version}`);
  }

  if (opts.out) {
    const outPath = resolve(opts.out);
    await writeFile(outPath, JSON.stringify(manifest, null, 2));
    console.log(`Wrote manifest to ${outPath}`);
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
