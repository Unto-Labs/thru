import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../..");
const sourceDir = path.join(packageRoot, "wasm", "abi");
const distDir = path.join(packageRoot, "dist", "abi", "wasm");
const targets = ["bundler", "node", "web"];
const skipMissingArtifacts = /^(1|true|yes)$/i.test(process.env.THRU_SDK_SKIP_ABI_WASM_COPY ?? "");
const requiredFiles = targets.flatMap((target) => [
  path.join(sourceDir, target, "abi_reflect_wasm.js"),
  path.join(sourceDir, target, "abi_reflect_wasm_bg.wasm"),
]);

if (skipMissingArtifacts) {
  console.log("[copy-wasm] Skipping ABI WASM artifact copy");
  process.exit(0);
}

for (const file of requiredFiles) {
  try {
    const stats = await stat(file);
    if (!stats.isFile()) throw new Error("not a file");
  } catch {
    const relative = path.relative(packageRoot, file);
    throw new Error(
      `Missing ABI WASM artifact ${relative}. Run "pnpm --filter @thru/sdk build:wasm" before building @thru/sdk.`,
    );
  }
}

await rm(distDir, { recursive: true, force: true });
await cp(sourceDir, distDir, { recursive: true });
await Promise.all([
  rm(path.join(distDir, ".gitignore"), { force: true }),
  ...targets.map((target) => rm(path.join(distDir, target, ".gitignore"), { force: true })),
]);
console.log(`[copy-wasm] Copied ${sourceDir} -> ${distDir}`);
