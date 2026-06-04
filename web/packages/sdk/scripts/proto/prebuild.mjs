import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "../..");
const generatedSentinel = resolve(
  repoDir,
  "src/proto/gen/thru/core/v1/account_pb.ts",
);

if (process.env.THRU_PROTO_FORCE_GENERATE === "1") {
  console.log("THRU_PROTO_FORCE_GENERATE=1, regenerating protobuf sources");
} else if (existsSync(generatedSentinel)) {
  console.log("Checked-in protobuf sources found, skipping buf generate");
  process.exit(0);
}

const result = spawnSync("pnpm", ["run", "generate"], {
  cwd: repoDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
