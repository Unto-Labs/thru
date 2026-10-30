import { defineConfig, globalIgnores } from "eslint/config";
import { generatedCodeIgnores, tsLibraryConfig } from "../../eslint.config.base.mjs";

export default defineConfig([
  ...tsLibraryConfig,
  globalIgnores(generatedCodeIgnores),
]);
