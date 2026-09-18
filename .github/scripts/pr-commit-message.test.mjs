import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedCommitMessage,
  hasEffectiveApproval,
  validatePullRequestCommit,
} from './pr-commit-message.mjs';

const pullRequest = {
  title: 'ci(mergify): fast-forward tested batches',
  number: 4012,
  body: '## Summary\n\nLand the tested batch directly.\n',
};

function commit(message) {
  return { commit: { message } };
}

function review(login, state) {
  return { user: { login }, state };
}

test('uses effective approvals when a stack branch has no review policy', () => {
  assert.equal(
    hasEffectiveApproval([
      review('reviewer', 'APPROVED'),
      review('reviewer', 'COMMENTED'),
    ]),
    true,
  );
  assert.equal(
    hasEffectiveApproval([
      review('reviewer', 'APPROVED'),
      review('reviewer', 'CHANGES_REQUESTED'),
    ]),
    false,
  );
  assert.equal(
    hasEffectiveApproval([
      review('reviewer', 'CHANGES_REQUESTED'),
      review('reviewer', 'APPROVED'),
    ]),
    true,
  );
  assert.equal(
    hasEffectiveApproval([
      review('reviewer', 'DISMISSED'),
      review('other-reviewer', 'CHANGES_REQUESTED'),
    ]),
    false,
  );
});

test('builds the main-thru squash-style message', () => {
  assert.equal(
    expectedCommitMessage(pullRequest),
    'ci(mergify): fast-forward tested batches (#4012)\n\n' +
      '## Summary\n\nLand the tested batch directly.',
  );
});

test('accepts one commit with the PR title and description', () => {
  const expected = expectedCommitMessage(pullRequest);
  const result = validatePullRequestCommit({
    ...pullRequest,
    commits: [commit(`${expected}\n`)],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test('normalizes CRLF in the commit message and PR description', () => {
  const result = validatePullRequestCommit({
    ...pullRequest,
    body: 'Summary\r\n\r\nDetails\r\n',
    commits: [
      commit(
        'ci(mergify): fast-forward tested batches (#4012)\r\n\r\n' +
          'Summary\r\n\r\nDetails\r\n',
      ),
    ],
  });

  assert.equal(result.valid, true);
});

test('preserves Markdown hard breaks and consecutive blank lines', () => {
  const body = 'First line  \n\n\nSecond line\n';
  assert.equal(
    expectedCommitMessage({ ...pullRequest, body }),
    'ci(mergify): fast-forward tested batches (#4012)\n\n' +
      'First line  \n\n\nSecond line',
  );
});

test('rejects multiple commits even when the last message matches', () => {
  const expected = expectedCommitMessage(pullRequest);
  const result = validatePullRequestCommit({
    ...pullRequest,
    commits: [commit('first'), commit(expected)],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ['expected exactly one commit, found 2']);
});

test('rejects a message without the PR description', () => {
  const result = validatePullRequestCommit({
    ...pullRequest,
    commits: [commit('ci(mergify): fast-forward tested batches (#4012)')],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, [
    'the commit message does not match the PR title and description',
  ]);
});

test('allows an empty PR description', () => {
  const result = validatePullRequestCommit({
    ...pullRequest,
    body: '',
    commits: [commit('ci(mergify): fast-forward tested batches (#4012)')],
  });

  assert.equal(result.valid, true);
});
