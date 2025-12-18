#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { SUPPORTED_IR_VERSION } from "../src/ir/schema";

interface CliOptions {
  abiFiles: string[];
  includeDirs: string[];
  outPath: string;
}

const PKG_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../../../");
const ABI_ROOT = resolve(WORKSPACE_ROOT, "abi");
const ABI_GEN_MANIFEST = resolve(ABI_ROOT, "abi_gen/Cargo.toml");

function parseArgs(argv: string[]): CliOptions {
  const abiFiles: string[] = [];
  const includeDirs: string[] = [];
  let outPath = "src/ir/generated/layout.ir.json";

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--abi-file":
        abiFiles.push(requireValue("--abi-file", argv[++i]));
        break;
      case "--include":
        includeDirs.push(requireValue("--include", argv[++i]));
        break;
      case "--out":
        outPath = requireValue("--out", argv[++i]);
        break;
      default:
        throw new Error(`Unknown argument '${arg}'`);
    }
  }

  if (abiFiles.length === 0) {
    abiFiles.push("token_program.abi.yaml");
  }

  return { abiFiles, includeDirs, outPath };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Expected value after ${flag}`);
  }
  return value;
}

function normalizeAbiPath(path: string): string {
  if (path.startsWith("abi/")) return path.slice(4);
  return path;
}

function resolveAbiPath(path: string): string {
  return resolve(ABI_ROOT, normalizeAbiPath(path));
}

function extractJsonPayload(output: string): string {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Failed to locate Layout IR JSON in abi_gen output");
  }
  return output.slice(start, end + 1);
}

function run(): void {
  const opts = parseArgs(process.argv);
  const abiArgs = opts.abiFiles.flatMap((file) => [
    "-f",
    resolveAbiPath(file),
  ]);
  const includeArgs = opts.includeDirs.flatMap((dir) => [
    "-i",
    resolveAbiPath(dir),
  ]);

  const cargoArgs = [
    "run",
    "--manifest-path",
    ABI_GEN_MANIFEST,
    "--",
    "analyze",
    ...abiArgs,
    ...includeArgs,
    "--print-ir",
    "--ir-format",
    "json",
  ];

  const result = spawnSync("cargo", cargoArgs, {
    cwd: ABI_ROOT,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stdout + result.stderr);
  }

  const payload = extractJsonPayload(result.stdout);
  const layout = JSON.parse(payload);

  if (layout.version !== SUPPORTED_IR_VERSION) {
    throw new Error(
      `Layout IR version ${layout.version} does not match supported version ${SUPPORTED_IR_VERSION}.
Update 'SUPPORTED_IR_VERSION' in src/ir/schema.ts before refreshing layouts.`,
    );
  }

  const outPath = resolve(PKG_ROOT, opts.outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(layout, null, 2));

  console.log(
    `Wrote Layout IR (${layout.types.length} types) to ${outPath}`,
  );
}

run();
