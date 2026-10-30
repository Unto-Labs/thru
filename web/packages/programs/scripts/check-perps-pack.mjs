// Run after building @thru/sdk and @thru/programs. Packs @thru/programs the
// way `pnpm publish` would and checks the perps SDK as a consumer sees it:
// the published file list, the ./perps and ./perp exports, ESM and CJS
// loading (one module behind both subpaths), and the types under
// TypeScript's node16 resolution for both formats, compiling the examples
// against the packed tarball.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = resolve(pkgDir, '../sdk');
const tsc = join(pkgDir, 'node_modules/.bin/tsc');
assert.ok(existsSync(join(pkgDir, 'dist/perps/index.js')), 'build @thru/programs first (pnpm run build)');

const work = mkdtempSync(join(tmpdir(), 'perps-pack-'));
try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: pkgDir, stdio: 'pipe' });
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
  assert.ok(tarball, 'pnpm pack produced no tarball');
  const files = execFileSync('tar', ['-tzf', join(work, tarball)], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const required of [
    'package/dist/perps/index.js',
    'package/dist/perps/index.cjs',
    'package/dist/perps/index.d.ts',
    'package/dist/perps/index.d.cts',
    'package/dist/perps/testing.js',
    'package/dist/perps/testing.cjs',
    'package/src/perp/README.md',
    'package/src/perp/VERSIONS.md',
    'package/src/perp/examples/place-and-cancel.ts',
    'package/src/perp/examples/market-maker-bot.ts',
    'package/src/perp/examples/agent-tools.ts',
  ]) {
    assert.ok(files.includes(required), `the package is missing ${required}`);
  }
  assert.ok(!files.some((name) => name.startsWith('package/dist/perp/')), 'dist/perp/ is gone: ./perp aliases dist/perps/');

  /* A consumer project with the tarball installed and @thru/sdk beside it. */
  const project = join(work, 'project');
  const installed = join(project, 'node_modules/@thru/programs');
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', installed, '--strip-components=1']);
  symlinkSync(sdkDir, join(project, 'node_modules/@thru/sdk'), 'dir');
  symlinkSync(join(pkgDir, 'node_modules/@types'), join(project, 'node_modules/@types'), 'dir');
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'perps-consumer', private: true, type: 'module' }));

  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.exports['./perp'], manifest.exports['./perps'], './perp is an alias of ./perps');
  assert.deepEqual(Object.keys(manifest.exports['./perps']), ['import', 'require']);

  const run = (file, source) => {
    writeFileSync(join(project, file), source);
    return execFileSync(process.execPath, [file], { cwd: project, encoding: 'utf8' }).trim();
  };
  const smoke = (load) => `
    const perps = ${load('@thru/programs/perps')};
    const alias = ${load('@thru/programs/perp')};
    if (perps.createPerpsClient !== alias.createPerpsClient) throw new Error('./perp and ./perps load different modules');
    const ids = perps.perpAbiVersions().map((v) => v.id).join(',');
    if (ids !== 'perp-abi@0.2.0,perp-abi@0.3.0,perp-abi@0.4.0,perp-abi@0.5.0') throw new Error('versions: ' + ids);
    if (perps.describePerpsActions().length < 20) throw new Error('actions');
    if (typeof perps.parsePerpSeatArenaAccount !== 'function' || typeof perps.ordersTx !== 'function') throw new Error('exports');
    console.log('ok ' + perps.PERP_ABI_LATEST.id);`;
  assert.equal(run('esm.mjs', smoke((name) => `await import('${name}')`)), 'ok perp-abi@0.5.0');
  assert.equal(run('cjs.cjs', smoke((name) => `require('${name}')`)), 'ok perp-abi@0.5.0');

  /* Types for both formats, and the examples, against the installed package. */
  writeFileSync(join(project, 'types.mts'), `
    import { createPerpsClient, ordersTx, type PerpAbiVersion, type PerpsClient, type PerpTransaction } from '@thru/programs/perps';
    import { PERP_ABI_LATEST } from '@thru/programs/perp';
    const version: PerpAbiVersion = PERP_ABI_LATEST;
    const client: Promise<PerpsClient> = createPerpsClient({ deployment: 'betanet' });
    const tx: typeof ordersTx = ordersTx;
    export type { PerpTransaction };
    export { version, client, tx };
  `);
  writeFileSync(join(project, 'types.cts'), `
    import perps = require('@thru/programs/perps');
    const version: perps.PerpAbiVersion = perps.PERP_ABI_LATEST;
    const flags: boolean = version.features.crossMargin;
    export = flags;
  `);
  cpSync(join(installed, 'src/perp/examples'), join(project, 'examples'), { recursive: true });
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, noEmit: true, skipLibCheck: true, types: ['node'] },
    include: ['types.mts', 'types.cts', 'examples/*.ts'],
  }));
  execFileSync(tsc, ['-p', project], { cwd: project, stdio: 'inherit' });
  console.log(`PASS: @thru/programs/perps packs ${files.length} files; ./perps and ./perp load one module through ESM and CJS; types and examples compile`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
