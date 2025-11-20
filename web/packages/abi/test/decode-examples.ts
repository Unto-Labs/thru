import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeData } from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const complianceRoot = path.join(repoRoot, "abi/abi_gen/tests/compliance_tests");

interface Fixture {
  label: string;
  typeName: string;
  abiFile: string;
  subdir: string;
  binFile: string;
}

function loadFixture(subdir: string, abiName: string, binName: string) {
  const abiPath = path.join(complianceRoot, "abi_definitions", abiName);
  const binPath = path.join(complianceRoot, "binary_data", subdir, binName);

  const abiContent = fs.readFileSync(abiPath, "utf-8");
  const binContent = fs.readFileSync(binPath);

  return { abiPath, binPath, abiContent, binContent };
}

function decodeFixture(fixture: Fixture) {
  const { abiPath, binPath, abiContent, binContent } = loadFixture(
    fixture.subdir,
    fixture.abiFile,
    fixture.binFile,
  );

  console.log(`\n${fixture.label}:`);
  console.log(`Reading ABI from ${abiPath}`);
  console.log(`Reading binary from ${binPath}`);
  console.log(`Binary size: ${binContent.length} bytes`);

  const decoded = decodeData(abiContent, fixture.typeName, new Uint8Array(binContent));
  console.dir(decoded, { depth: null, colors: true });
}

const fixtures: Fixture[] = [
  {
    label: "Decoded Rectangle Result",
    typeName: "Rectangle",
    abiFile: "structs.abi.yaml",
    subdir: "structs",
    binFile: "rectangle.bin",
  },
  {
    label: "Decoded SimpleEnum Result",
    typeName: "SimpleEnum",
    abiFile: "enums.abi.yaml",
    subdir: "enums",
    binFile: "value.bin",
  },
  {
    label: "Decoded FixedArrays Result",
    typeName: "FixedArrays",
    abiFile: "arrays.abi.yaml",
    subdir: "arrays",
    binFile: "simple.bin",
  },
  {
    label: "Decoded AllPrimitives (common values)",
    typeName: "AllPrimitives",
    abiFile: "primitives.abi.yaml",
    subdir: "primitives",
    binFile: "common_values.bin",
  },
  {
    label: "Decoded AllPrimitives (u64 bigint)",
    typeName: "AllPrimitives",
    abiFile: "primitives.abi.yaml",
    subdir: "primitives",
    binFile: "u64_bigint.bin",
  },
  {
    label: "Decoded SimpleUnion (int variant)",
    typeName: "SimpleUnion",
    abiFile: "unions.abi.yaml",
    subdir: "unions",
    binFile: "int_value.bin",
  },
  {
    label: "Decoded SimpleUnion (float variant)",
    typeName: "SimpleUnion",
    abiFile: "unions.abi.yaml",
    subdir: "unions",
    binFile: "float_value.bin",
  },
  {
    label: "Decoded SimpleUnion (bytes variant)",
    typeName: "SimpleUnion",
    abiFile: "unions.abi.yaml",
    subdir: "unions",
    binFile: "bytes.bin",
  },
];

try {
  fixtures.forEach(decodeFixture);
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}

