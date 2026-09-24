import assert from 'node:assert/strict';
import test from 'node:test';
import { watchRun } from './ci-fail-fast.mjs';

const context = {
  repo: { owner: 'Unto-Labs', repo: 'thru-net' },
  runId: 999,
  payload: { workflow_run: { id: 42, run_attempt: 2 } },
};
const running = name => ({ name, status: 'in_progress', conclusion: null });
const completed = (name, conclusion) => ({ name, status: 'completed', conclusion });

async function watch(snapshots, { runState = { run_attempt: 2, status: 'in_progress' }, ...options } = {}) {
  const cancellations = [];
  let polls = 0;
  const oldFailure = completed('unit-test from attempt 1', 'failure');
  const github = {
    rest: { actions: {
      listJobsForWorkflowRunAttempt: async ({ attempt_number }) => {
        if (attempt_number !== 2) return [oldFailure];
        assert.ok(polls < snapshots.length, 'watcher did not stop');
        return snapshots[polls++];
      },
      listJobsForWorkflowRun: async () => [oldFailure, ...snapshots[0]],
      getWorkflowRun: async () => ({ data: runState }),
      cancelWorkflowRun: async run => cancellations.push(run.run_id),
    } },
    paginate: async (endpoint, params) => endpoint(params),
  };
  await watchRun({
    github, context,
    core: { info() {}, error() {} },
    sleep: async () => {},
    ...options,
  });
  return { cancellations, polls };
}

test('a nested unit failure cancels the parent while other matrices and E2E are running', async () => {
  const result = await watch([[
    completed('call-merge-queue-driver / call-tn-tests / test (unit-test, gcc)', 'failure'),
    running('call-merge-queue-driver / call-tn-tests / asan-matrix (clang)'),
    running('call-merge-queue-driver / call-e2e-tests / e2e-test (ts)'),
  ]]);
  assert.deepEqual(result.cancellations, [42]);
});

test('a test timeout cancels even if the aggregate gate already finished', async () => {
  const result = await watch([[
    completed('call-e2e-tests / e2e-test (ts)', 'timed_out'),
    completed('check-status', 'failure'),
  ]]);
  assert.deepEqual(result.cancellations, [42]);
});

test('waits for the outer gate rather than an incomplete job listing or nested gate', async () => {
  const result = await watch([
    [completed('route', 'success')],
    [completed('call-pr-driver / check-status', 'success')],
    [completed('check-status', 'success')],
  ]);
  assert.equal(result.polls, 3);
  assert.deepEqual(result.cancellations, []);
});

test('a successful rerun is not cancelled by the previous attempt failure', async () => {
  const result = await watch([[
    completed('unit-test', 'success'),
    completed('check-status', 'success'),
  ]]);
  assert.deepEqual(result.cancellations, []);
});

test('a delayed watcher does not cancel a newer attempt using old failures', async () => {
  const result = await watch([[completed('unit-test', 'failure')]], {
    runState: { run_attempt: 3, status: 'in_progress' },
  });
  assert.deepEqual(result.cancellations, []);
});

test('manual cancellation stops the external watcher even without a gate job', async () => {
  const result = await watch([[]], {
    runState: { run_attempt: 2, status: 'completed', conclusion: 'cancelled' },
  });
  assert.deepEqual(result.cancellations, []);
});

test('a skipped draft gate terminates without cancellation', async () => {
  const result = await watch([[completed('check-status', 'skipped')]]);
  assert.deepEqual(result.cancellations, []);
});

test('advisory nested failures do not cancel, but a similarly named required job does', async () => {
  const ignoredJobs = ['call-bridge-artifacts'];
  const advisory = completed('call-bridge-artifacts / build', 'failure');
  const result = await watch([
    [advisory, running('check-status')],
    [advisory, completed('call-bridge-artifacts-required / build', 'failure')],
  ], { ignoredJobs });
  assert.equal(result.polls, 2);
  assert.deepEqual(result.cancellations, [42]);
});
