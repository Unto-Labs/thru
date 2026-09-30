import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/cli-artifacts.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Wait for thru platform packages on npm\n')[1]
  .split('      - name: Publish thru to npm\n')[0];
const script = step.split('        run: |\n')[1].replace(/^          /gm, '');

function runGate(t, readyAfter) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'thru-npm-propagation-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // Model a release that skips the optional Windows build.
  for (const name of ['thru-darwin-arm64', 'thru-linux-x64']) {
    const dir = path.join(cwd, 'web/packages/cli/npm', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.3.18' }));
  }
  const bin = path.join(cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash
set -eu
echo "$*" >> queries
test "$1" = view
test "$3" = version
test "$4" = --prefer-online
if [ "$2" = thru-linux-x64@0.3.18 ]; then
  count=0
  if [ -f count ]; then read -r count < count; fi
  count=$((count + 1))
  echo "$count" > count
  test "$count" -gt "$READY_AFTER"
else
  test "$2" = thru-darwin-arm64@0.3.18
fi
`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\necho "$*" >> sleeps\n', { mode: 0o755 });
  const result = spawnSync('bash', ['-c', script], {
    cwd, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, READY_AFTER: String(readyAfter) },
  });
  return { ...result, cwd };
}

test('already-visible packages pass without waiting or requiring a skipped platform', t => {
  const result = runGate(t, 0);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(readFileSync(path.join(result.cwd, 'queries'), 'utf8').trim().split('\n').length, 2);
});

test('waits for a delayed platform even when another platform is already visible', t => {
  const result = runGate(t, 3);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Waiting for thru-linux-x64@0.3.18/);
  assert.equal(readFileSync(path.join(result.cwd, 'sleeps'), 'utf8'), '30\n'.repeat(3));
});

test('fails after the bounded wait and identifies the unavailable version', t => {
  const result = runGate(t, 20);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not visible on the registry: thru-linux-x64@0.3.18/);
  assert.equal(readFileSync(path.join(result.cwd, 'sleeps'), 'utf8'), '30\n'.repeat(19));
});
