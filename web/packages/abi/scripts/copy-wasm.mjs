import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(packageRoot, "wasm");
const distDir = path.join(packageRoot, "dist", "wasm");

// Check if source directory exists (WASM may not be built in all environments)
try {
  await stat(sourceDir);
} catch {
  console.log(`[copy-wasm] Skipping: ${sourceDir} does not exist`);
  process.exit(0);
}

await rm(distDir, { recursive: true, force: true });
await cp(sourceDir, distDir, { recursive: true });
console.log(`[copy-wasm] Copied ${sourceDir} -> ${distDir}`);
