/** Keep shared codecs generated from the programs' canonical ABIs. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(sdk, '../../..');
const abi = process.env.THRU_ABI_BIN ?? join(repo, 'rpc/abi/target/debug/abi');
const sources = {
  compression: 'web/packages/programs/src/compression/compression.abi.yaml',
  multicall: 'rpc/abi/type-library/tn_multicall.abi.yaml',
  uploader: 'rpc/abi/type-library/tn_uploader_program.abi.yaml',
  'passkey-manager': 'rpc/abi/type-library/tn_passkey_manager.abi.yaml',
};
const check = process.argv.includes('--check');
const temporary = check ? mkdtempSync(join(tmpdir(), 'compression-codecs-')) : undefined;
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
try {
  for (const [name, source] of Object.entries(sources)) {
    const destination = join(sdk, 'thru-ts-client-sdk/domain/programs', name, 'abi');
    const output = temporary ? join(temporary, name) : destination;
    const result = spawnSync(abi, ['codegen', '--files', join(repo, source), '--language', 'typescript', '--output', output], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Code generation failed for ${name}`);
    if (check) for (const file of files(output)) {
      const existing = join(destination, file.slice(output.length + 1));
      if (!readFileSync(file).equals(readFileSync(existing))) throw new Error(`Generated codec differs: ${existing}`);
    }
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
