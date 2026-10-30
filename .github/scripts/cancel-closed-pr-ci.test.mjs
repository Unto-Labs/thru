import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_STATUSES, cancelClosedPrRuns, isOwnRun } from './cancel-closed-pr-ci.mjs';

const REPO = 'Unto-Labs/thru-net';
const DRAFT = 'mergify/merge-queue/d4659a7f17';
const SHA = '5646565f1f03d2d18244e27fdccdc22e8d5829a0';
const CLOSED_AT = '2026-10-28T19:22:00Z';
const BEFORE = '2026-10-28T19:17:00Z';
const AFTER = '2026-10-28T19:22:05Z';

const pr = (over = {}) => ({
  number: 5509,
  merged: false,
  closed_at: CLOSED_AT,
  head: { ref: DRAFT, sha: SHA, repo: { full_name: REPO, owner: { login: 'Unto-Labs' } } },
  ...over,
});

const run = (id, over = {}) => ({
  id,
  name: 'PR CI Driver',
  event: 'pull_request',
  status: 'in_progress',
  head_branch: DRAFT,
  head_sha: SHA,
  head_repository: { full_name: REPO },
  pull_requests: [],
  created_at: BEFORE,
  ...over,
});

// The listing stub ignores the query and returns every run in the given
// status, so the module's own filter is what decides.
async function closeWith(payloadPr, runs, { cancelError, state = 'closed', merged = false, openPrs = [] } = {}) {
  const cancelled = [];
  const listed = [];
  const failed = [];
  const github = {
    rest: { actions: {
      listWorkflowRunsForRepo: async params => {
        listed.push(params);
        return runs.filter(r => r.status === params.status);
      },
      cancelWorkflowRun: async ({ run_id }) => {
        if (cancelError && cancelError.run_id === run_id) throw cancelError.err;
        cancelled.push(run_id);
      },
    },
    pulls: {
      get: async () => ({ data: { state, merged } }),
      list: async params => {
        assert.equal(params.state, 'open');
        assert.equal(params.head, `${payloadPr.head.repo.owner.login}:${payloadPr.head.ref}`);
        return openPrs;
      },
    } },
    paginate: async (endpoint, params) => endpoint(params),
  };
  const context = { repo: { owner: 'Unto-Labs', repo: 'thru-net' }, payload: { pull_request: payloadPr } };
  const result = await cancelClosedPrRuns({
    github, context,
    core: { info() {}, setFailed: msg => failed.push(msg) },
  });
  return { result, cancelled, listed, failed };
}

test('an unmerged queue draft has its queued and running pull_request runs cancelled', async () => {
  const { cancelled, listed } = await closeWith(pr(), [
    run(1),
    run(2, { status: 'queued', name: 'Proofs' }),
    run(3, { status: 'completed' }),
  ]);
  assert.deepEqual(cancelled.sort(), [1, 2]);
  assert.deepEqual(listed.map(p => p.status), ACTIVE_STATUSES);
  for (const params of listed) {
    assert.equal(params.branch, DRAFT);
    assert.equal(params.event, 'pull_request');
  }
});

test('a merged PR (a successful batch) is left alone', async () => {
  const { cancelled, listed } = await closeWith(pr({ merged: true }), [run(1)]);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(listed, []);
});

test('runs that are not the closed PR\'s own pull_request runs are never cancelled', async () => {
  const { cancelled } = await closeWith(pr(), [
    run(10, { event: 'push', head_branch: 'main-thru' }),
    run(11, { event: 'push' }),
    run(12, { event: 'pull_request_target' }),
    run(13, { head_branch: 'mergify/merge-queue/other' }),
    run(14, { head_repository: { full_name: 'someone/thru-net' } }),
    run(15, { head_sha: 'f'.repeat(40) }),
    run(16, { head_sha: 'f'.repeat(40), pull_requests: [{ number: 5509 }] }),
  ]);
  assert.deepEqual(cancelled, [16]);
});

test('runs the close or a reopen started are never cancelled', async () => {
  // Web Deploy tears down PR previews on pull_request: closed: same branch,
  // commit and event, created after the close.
  const { cancelled } = await closeWith(pr(), [
    run(30),
    run(31, { name: 'Web Deploy', created_at: AFTER }),
    run(32, { created_at: CLOSED_AT }),
  ]);
  assert.deepEqual(cancelled, [30]);
});

test('a PR reopened before the job ran keeps its CI', async () => {
  const { cancelled, listed } = await closeWith(pr(), [run(1)], { state: 'open' });
  assert.deepEqual(cancelled, []);
  assert.deepEqual(listed, []);
  // Reopened and merged before the job ran: closed again, but merged.
  const merged = await closeWith(pr(), [run(2)], { merged: true });
  assert.deepEqual(merged.cancelled, []);
  assert.deepEqual(merged.listed, []);
});

test('another open PR from the same head branch keeps the shared runs', async () => {
  const { cancelled, listed } = await closeWith(pr(), [run(1)], { openPrs: [{ number: 6000 }] });
  assert.deepEqual(cancelled, []);
  assert.deepEqual(listed, []);
  const self = await closeWith(pr(), [run(2)], { openPrs: [{ number: 5509 }] });
  assert.deepEqual(self.cancelled, [2]);
});

test('a fork PR matches runs from its own head repository', async () => {
  const fork = pr({ head: { ref: 'patch-1', sha: SHA, repo: { full_name: 'someone/thru-net', owner: { login: 'someone' } } } });
  const { cancelled } = await closeWith(fork, [
    run(20, { head_branch: 'patch-1', head_repository: { full_name: 'someone/thru-net' } }),
    run(21, { head_branch: 'patch-1' }),
  ]);
  assert.deepEqual(cancelled, [20]);
});

test('a run that finished before its cancel (409) is not an error', async () => {
  const err = Object.assign(new Error('conflict'), { status: 409 });
  const { cancelled } = await closeWith(pr(), [run(1), run(2)], { cancelError: { run_id: 1, err } });
  assert.deepEqual(cancelled, [2]);
});

test('any other cancel failure fails the job', async () => {
  const err = Object.assign(new Error('forbidden'), { status: 403 });
  await assert.rejects(closeWith(pr(), [run(1)], { cancelError: { run_id: 1, err } }), /forbidden/);
});

test('a deleted head repository or a missing payload is handled', async () => {
  const gone = await closeWith(pr({ head: { ref: 'x', sha: SHA, repo: null } }), [run(1)]);
  assert.deepEqual(gone.cancelled, []);
  const missing = await closeWith(undefined, [run(1)]);
  assert.equal(missing.failed.length, 1);
});

test('isOwnRun requires the pull_request event, branch, head repository and commit', () => {
  assert.ok(isOwnRun(run(1), pr()));
  assert.ok(!isOwnRun(run(1, { event: 'push' }), pr()));
});
