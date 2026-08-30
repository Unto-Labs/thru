import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "bootstrap-addresses/index": "src/bootstrap-addresses/index.ts",
    "token/index": "src/token/index.ts",
    "passkey-manager/index": "src/passkey-manager/index.ts",
    "multicall/index": "src/multicall/index.ts",
    "amm/index": "src/amm/index.ts",
    "clob/index": "src/clob/index.ts",
    "oracle/index": "src/oracle/index.ts",
    "manager/index": "src/manager/index.ts",
    "abi-manager/index": "src/abi-manager/index.ts",
    "uploader/index": "src/uploader/index.ts",
    "deploy/index": "src/deploy/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
