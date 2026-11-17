import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const programs = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(programs, '../../..');
const abi = process.env.THRU_ABI_BIN ?? join(repo, 'rpc/abi/target/debug/abi');
const check = process.argv.includes('--check');
const sources = {
  'core-manager': 'rpc/abi/type-library/core_manager.abi.yaml',
  multisig: 'rpc/abi/type-library/multisig.abi.yaml',
  'abi-manager': 'rpc/abi/type-library/tn_abi_manager_program.abi.yaml',
};
const temporary = check ? mkdtempSync(join(tmpdir(), 'governance-codecs-')) : undefined;
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
try {
  for (const [name, source] of Object.entries(sources)) {
    const destination = join(programs, 'src', name, 'abi');
    const output = temporary ? join(temporary, name) : destination;
    const result = spawnSync(abi, ['codegen', '--files', join(repo, source), '--language', 'typescript', '--output', output], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Governance code generation failed for ${name}`);
    if (check) for (const file of files(output)) {
      const existing = join(destination, file.slice(output.length + 1));
      if (!readFileSync(file).equals(readFileSync(existing))) throw new Error(`Stale governance binding: ${existing}`);
    }
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
