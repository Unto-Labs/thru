import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../..");
const sourceDir = path.join(packageRoot, "wasm", "abi");
const distDir = path.join(packageRoot, "dist", "abi", "wasm");
/* Staged as a sibling of distDir so publishing is a same-filesystem rename, and
   keyed by pid so concurrent invocations never share a staging tree. */
const stageDir = `${distDir}.tmp-${process.pid}`;
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

const rmTreeOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

const relativeFiles = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
};

/* Publish file by file rather than by swapping the directory itself. POSIX cannot
   atomically replace a directory, so a directory-granular swap has to unlink the old
   tree before renaming the new one in, leaving distDir briefly absent -- long enough
   for a consumer resolving dist/abi/wasm (a watch-mode build, a parallel invocation)
   to get ENOENT. Renaming each file individually keeps distDir present throughout and
   is atomic per file, so a reader always sees either the previous or the new artifact
   and never a partial one. Stale files are pruned afterwards; concurrent writers stage
   identical content, so they converge on the same set. */
async function publishStagedTree() {
  const staged = await relativeFiles(stageDir);
  await mkdir(distDir, { recursive: true });
  for (const relative of staged) {
    const destination = path.join(distDir, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(path.join(stageDir, relative), destination);
  }

  const published = new Set(staged);
  for (const relative of await relativeFiles(distDir)) {
    if (!published.has(relative)) await rm(path.join(distDir, relative), { force: true });
  }
}

await rm(stageDir, rmTreeOpts);
try {
  await cp(sourceDir, stageDir, { recursive: true });
  await Promise.all([
    rm(path.join(stageDir, ".gitignore"), { force: true }),
    ...targets.map((target) => rm(path.join(stageDir, target, ".gitignore"), { force: true })),
  ]);
  await publishStagedTree();
} finally {
  /* Empty after a successful publish; cleans up the staging tree on failure. */
  await rm(stageDir, rmTreeOpts);
}
console.log(`[copy-wasm] Copied ${sourceDir} -> ${distDir}`);
