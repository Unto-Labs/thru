import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const entry: Record<string, string> = {
  "compression/index": "src/compression/index.ts",
  resources: "src/resources.ts",
  "bootstrap-addresses/index": "src/bootstrap-addresses/index.ts",
  "faucet/index": "src/faucet/index.ts",
  "token/index": "src/token/index.ts",
  "wallet/index": "src/wallet/index.ts",
  // Deprecated published path, built from the canonical sources.
  "passkey-manager/index": "src/wallet/index.ts",
  "multicall/index": "src/multicall/index.ts",
  "amm/index": "src/amm/index.ts",
  "clob/index": "src/clob/index.ts",
  "oracle/index": "src/oracle/index.ts",
  "manager/index": "src/manager/index.ts",
  "abi-manager/index": "src/abi-manager/index.ts",
  "uploader/index": "src/uploader/index.ts",
  "deploy/index": "src/deploy/index.ts",
  // The perps SDK; "@thru/programs/perp" is an alias of the same files
  // (package.json exports), so both subpaths share one module instance.
  "perps/index": "src/perp/perps.ts",
  // A simulated RPC for tests of code that sends perp transactions.
  "perps/testing": "src/perp/sdk/test-rpc.ts",
};

/* Declarations are bundled from one-line re-export shims in src/dts-entries/
   (one per entry, named after it with "/" as "__"). tsup's bundled
   rollup-plugin-dts builds a separate TypeScript program for every entry
   that lives in a different directory, each loading the whole @thru/sdk
   graph again; with the perps SDK and its generated ABI types that took the
   DTS worker past 2 GB of heap and out of memory on CI runners. Entries that
   share a directory share one program, which needs about a third of that. */
const dtsEntry = Object.fromEntries(
  Object.keys(entry).map((name) => {
    const shim = `src/dts-entries/${name.replace(/\//g, "__")}.ts`;
    const expected = `export * from '../${entry[name].replace(/^src\//, "").replace(/\.ts$/, "")}';\n`;
    let source = "";
    try {
      source = readFileSync(shim, "utf8");
    } catch {}
    if (source !== expected) {
      throw new Error(`${shim} must contain exactly: ${expected}`);
    }
    return [name, shim];
  }),
);

export default defineConfig({
  entry,
  format: ["cjs", "esm"],
  dts: { entry: dtsEntry },
  clean: true,
  sourcemap: true,
  treeshake: true,
});
