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

const verifyScript = workflow.split('      - name: Verify published thru CLI\n')[1]
  .split('        run: |\n')[1].replace(/^          /gm, '');

function runInstallVerification(t, failedInstalls) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'thru-npm-install-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = path.join(cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash
set -eu
test "$1" = exec
cache=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --cache ]; then cache="$2"; shift; fi
  shift
done
test -n "$cache"
count=0
if [ -f "$STATE/count" ]; then read -r count < "$STATE/count"; fi
count=$((count + 1))
echo "$count" > "$STATE/count"
# An npx install that dropped an optional dependency must not be reused.
if [ -d "$cache/incomplete" ]; then exit 1; fi
if [ "$count" -le "$FAILED_INSTALLS" ]; then
  mkdir -p "$cache/incomplete" "$cache/_logs"
  echo "E404: platform tarball unavailable" > "$cache/_logs/install-debug-0.log"
  exit 1
fi
`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return {
    ...spawnSync('bash', ['-c', verifyScript], {
      cwd, encoding: 'utf8',
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`,
        STATE: cwd, FAILED_INSTALLS: String(failedInstalls), RELEASE_VERSION: '0.5.4',
      },
    }),
    cwd,
  };
}

test('retries a failed installation without reusing its incomplete npx cache', t => {
  const result = runInstallVerification(t, 2);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(result.cwd, 'count'), 'utf8'), '3\n');
  assert.match(result.stdout, /E404: platform tarball unavailable/);
});

test('persistent installation failures fail verification and preserve npm diagnostics', t => {
  const result = runInstallVerification(t, 10);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(path.join(result.cwd, 'count'), 'utf8'), '10\n');
  assert.match(result.stdout, /E404: platform tarball unavailable/);
  assert.match(result.stderr, /Fresh install of thru@0.5.4 failed after 10 attempts/);
});
