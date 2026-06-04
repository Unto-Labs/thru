import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../..");
const crateRoot = path.resolve(packageRoot, "..", "..", "..", "rpc", "abi", "abi_reflect_wasm");
const builds = [
  ["bundler", "bundler", "pkg/bundler"],
  ["node", "nodejs", "pkg/node"],
  ["web", "web", "pkg/web"],
];

for (const [label, target, outDir] of builds) {
  console.log(`[build-wasm] Building ${label} target`);
  const result = spawnSync(
    "wasm-pack",
    ["build", "--release", "--target", target, "--out-dir", outDir],
    { cwd: crateRoot, stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await import("./sync-wasm.mjs");
