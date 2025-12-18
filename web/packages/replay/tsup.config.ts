import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: "dist",
  target: "esnext",
  outExtension({ format }) {
    if (format === "esm") return { js: ".mjs" };
    return { js: ".cjs" };
  },
});
