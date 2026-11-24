// The test's side of the debug-link helper (`trezor/scripts/web_host_screens.py`,
// which is the Rust host's `host_screens.py` under one entry point). The helper
// runs next to the emulator and answers its screens; it reads every review as a
// person does and writes what it read to a capture. The test tells it what to do
// with the next request (a plan), and afterwards compares the capture with the
// review the TypeScript preview gave. The comparison is the helper's
// (`thru_review.py`), the one the Rust script uses, so both hosts are held to the
// same rules; nothing is compared here.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ helper: string, plans: string, captures: string, previews: string, emulatorLog: string, screensLog: string, python?: string }} config
 */
export function createScreens(config) {
  const python = config.python ?? 'python';
  mkdirSync(config.previews, { recursive: true });

  const run = (args) => {
    const done = spawnSync(python, ['-B', config.helper, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (done.error) throw new Error(`could not run ${python} ${config.helper}: ${done.error.message}`);
    return { status: done.status, out: `${done.stdout ?? ''}`.trim(), err: `${done.stderr ?? ''}`.trim() };
  };
  const mustRun = (args) => {
    const result = run(args);
    if (result.status !== 0) throw new Error(`web_host_screens.py ${args.join(' ')}: ${result.err || result.out}`);
    return result.out;
  };

  const planFile = join(config.plans, 'plan.json');

  return {
    /**
     * What the helper does with the next request that shows a review or a
     * passphrase screen: approve (no option), refuse at the step with a title by
     * its button or through its menu, hold the final confirmation back, type
     * a passphrase, or refuse the address on its screen.
     * @param {string} name
     * @param {{ refuseAt?: string, refuseHow?: 'button' | 'menu', holdSeconds?: number, passphrase?: string, refuseAddress?: boolean }} [options]
     */
    plan(name, options = {}) {
      const args = ['plan', '--plans', config.plans, '--name', name];
      if (options.refuseAt !== undefined) args.push('--refuse-at', options.refuseAt);
      if (options.refuseHow !== undefined) args.push('--refuse-how', options.refuseHow);
      if (options.holdSeconds !== undefined) args.push('--hold-seconds', String(options.holdSeconds));
      if (options.passphrase !== undefined) args.push('--passphrase', options.passphrase);
      if (options.refuseAddress) args.push('--refuse-address');
      mustRun(args);
    },

    /**
     * Writes the plan file by hand, in the helper's own format (`host_screens.py`,
     * `Plan`): what a program without Python does, as the chain scenarios of
     * `e2e-tests` (`src/scenarios/trezor/harness.ts`) do.
     * @param {Record<string, unknown>} data
     */
    writePlanFile(data) {
      writeFileSync(`${planFile}.part`, JSON.stringify(data));
      renameSync(`${planFile}.part`, planFile);
    },

    /** Whether a plan is still waiting: no screen came up for its request. Removes it. */
    discardUnusedPlan() {
      if (!existsSync(planFile)) return false;
      unlinkSync(planFile);
      return true;
    },

    /** Waits for the capture of the request `name`; returns its path, or throws. */
    wait(name, timeoutSeconds = 90) {
      return mustRun(['wait', '--captures', config.captures, name, '--timeout', String(timeoutSeconds)]);
    },

    /** One field of a capture: outcome, refused_at, passphrase, address, kind, titles, names, notes. */
    info(name, key) {
      return mustRun(['info', join(config.captures, `${name}.json`), key]);
    },

    /** Where the preview of `name` is written. */
    previewPath(name) {
      return join(config.previews, `${name}.json`);
    },

    /** Writes the preview of `name` as the helper reads it: the review as JSON. */
    writePreview(name, review) {
      const path = join(config.previews, `${name}.json`);
      writeFileSync(path, `${JSON.stringify(review, null, 1)}\n`);
      return path;
    },

    /** The helper's comparison of the capture of `name` with a preview file. `ok` is false on a difference, and `text` says which. */
    compare(name, previewPath) {
      const result = run(['compare', previewPath, join(config.captures, `${name}.json`)]);
      return { ok: result.status === 0, text: result.out || result.err };
    },

    /** The size of the emulator's log now: the offset to count messages from. */
    logSize() {
      return Number(mustRun(['log-count', config.emulatorLog, '0', 'size']));
    },

    /** How many lines of the emulator's log after byte `from` match the regular expression `pattern`. */
    logCount(from, pattern) {
      return Number(mustRun(['log-count', config.emulatorLog, String(from), pattern]));
    },

    /** How many lines of the helper's own report start with `prefix` (`request ` for each request that showed a screen). */
    screensCount(prefix) {
      const text = existsSync(config.screensLog) ? readFileSync(config.screensLog, 'latin1') : '';
      return text.split('\n').filter((line) => line.startsWith(prefix)).length;
    },

    /** A copy of the image with one byte of its header changed (`variant`); returns the `.tapp` path. */
    variant(source, destination) {
      return mustRun(['variant', source, destination]);
    },
  };
}
