import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..", "..", "abi", "abi_reflect_wasm", "pkg");
const targets = ["bundler", "node", "web"];

for (const target of targets) {
  const source = path.join(repoRoot, target);
  const destination = path.join(packageRoot, "wasm", target);
  try {
    await stat(source);
  } catch {
    throw new Error(
      `Missing WASM artifacts for target "${target}". Run "wasm-pack build --target ${target}" in abi/abi_reflect_wasm first.`,
    );
  }

  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  console.log(`[sync-wasm] Copied ${source} -> ${destination}`);
}
