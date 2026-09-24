import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { expectedCommitMessage } from './pr-commit-message.mjs';
import { authorizeCommand, assertUnchanged, finalizePullRequest } from './pr-squash.mjs';

function fixture(t, { count = 2, branch = 'feature' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pr-squash-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, 'work');
  mkdirSync(work);
  mkdirSync(join(root, 'owner'));
  const remote = join(root, 'owner', 'repo.git');
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Original Author', GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Original Author', GIT_COMMITTER_EMAIL: 'author@example.com',
  };
  function git(...args) {
    return execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();
  }
  git('init', '-b', 'main');
  writeFileSync(join(work, 'base'), 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  const parent = git('rev-parse', 'HEAD');
  const pr = {
    number: 7, state: 'open', title: 'ci(bot): finalize history',
    body: '## Summary\n\nPreserve a hard break  \n\n\nMore details.\r\n',
    user: { login: 'author' },
  };
  git('switch', '-c', branch);
  for (let i = 0; i < count; i++) {
    writeFileSync(join(work, 'feature'), `change ${i}\n`);
    git('add', '.');
    git('commit', '--cleanup=verbatim', '-m', `change ${i}`);
  }
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  git('switch', 'main');
  writeFileSync(join(work, 'upstream'), 'unrelated upstream change\n');
  git('add', '.');
  git('commit', '-m', 'advance base');
  pr.head = { sha: head, ref: branch, repo: { full_name: 'owner/repo' } };
  pr.base = { sha: git('rev-parse', 'HEAD'), ref: 'main' };
  git('init', '--bare', remote);
  git('push', remote, 'main', branch);
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    serverUrl: pathToFileURL(root).href,
    payload: { issue: { number: 7 }, repository: { default_branch: 'main' } },
  };
  let reads = 0;
  const state = { children: [], protected: false, onRead: () => {} };
  const github = {
    rest: {
      users: { getByUsername: async () => ({ data: { id: 123 } }) },
      pulls: {
        get: async () => {
          const snapshot = structuredClone(pr);
          state.onRead(++reads, snapshot);
          return { data: snapshot };
        },
        list: async () => {},
      },
      repos: { getBranch: async () => ({ data: { protected: state.protected } }) },
    },
    paginate: async () => state.children,
  };
  const run = () => finalizePullRequest({ github, context, token: 'test-token', appSlug: 'untobot' });
  const remoteHead = () => git('--git-dir', remote, 'rev-parse', `refs/heads/${branch}`);
  const importHead = () => {
    git('fetch', remote, `+refs/heads/${branch}:refs/remotes/proof/feature`);
    return git('rev-parse', 'refs/remotes/proof/feature');
  };
  return { git, pr, context, state, run, remoteHead, importHead, remote, parent, head, tree };
}

test('squashes the PR without reverting newer base changes or damaging Markdown', async t => {
  const f = fixture(t);
  assert.match(await f.run(), /Squashed 2 commits/);
  const head = f.importHead();
  assert.equal(f.git('rev-list', '--count', `${f.pr.base.sha}..${head}`), '1');
  assert.equal(f.git('rev-parse', `${head}^{tree}`), f.tree);
  assert.equal(f.git('rev-parse', `${head}^`), f.parent);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  assert.equal(f.git('show', '-s', '--format=%an <%ae>', head), 'Original Author <author@example.com>');
  const merged = f.git('merge-tree', '--write-tree', f.pr.base.sha, head);
  assert.equal(f.git('show', `${merged}:upstream`), 'unrelated upstream change');
});

test('squashes Mergify configuration branches regardless of PR author', async t => {
  for (const login of ['author', 'mergify[bot]']) {
    await t.test(login, async t => {
      const f = fixture(t, { branch: 'mergify/CantelopePeel/config' });
      f.pr.user.login = login;
      await f.run();
      const head = f.importHead();
      assert.equal(f.git('rev-list', '--count', `${f.pr.base.sha}..${head}`), '1');
      assert.equal(f.git('rev-parse', `${head}^{tree}`), f.tree);
      assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
    });
  }
});

test('amends one commit without rebasing, then treats another command as a no-op', async t => {
  const f = fixture(t, { count: 1 });
  assert.match(await f.run(), /Amended the commit message/);
  const head = f.importHead();
  assert.notEqual(head, f.head);
  assert.equal(f.git('rev-parse', `${head}^{tree}`), f.tree);
  assert.equal(f.git('rev-parse', `${head}^`), f.parent);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  f.pr.head.sha = head;
  assert.match(await f.run(), /Already finalized/);
  assert.equal(f.remoteHead(), head);
});

test('never overwrites a contributor push made after the final API snapshot', async t => {
  const f = fixture(t);
  f.state.onRead = reads => {
    if (reads === 3) {
      f.git('push', '--force', f.remote, `${f.parent}:refs/heads/feature`);
    }
  };
  await assert.rejects(f.run(), /stale info/);
  assert.equal(f.remoteHead(), f.parent);
});

test('refuses stale PR metadata and does not publish an obsolete commit message', async t => {
  const f = fixture(t);
  f.state.onRead = (reads, snapshot) => {
    if (reads === 2) snapshot.body = 'New description';
  };
  await assert.rejects(f.run(), /PR changed/);
  assert.equal(f.remoteHead(), f.head);
});

test('refuses rewrites that would invalidate dependent PR ancestry', async t => {
  const f = fixture(t);
  f.state.children = [{ number: 8 }];
  await assert.rejects(f.run(), /base of #8/);
  assert.equal(f.remoteHead(), f.head);
});

test('never rewrites a Mergify merge-queue branch', async t => {
  const f = fixture(t, { branch: 'mergify/merge-queue/main-thru/pr-7' });
  await assert.rejects(f.run(), /merge-queue branch/);
  assert.equal(f.remoteHead(), f.head);
});

test('does not rewrite a protected branch, default branch, fork, or closed PR', async t => {
  const f = fixture(t);
  f.state.protected = true;
  await assert.rejects(f.run(), /protected branch/);
  f.state.protected = false;
  f.pr.head.ref = 'main';
  await assert.rejects(f.run(), /default branch/);
  f.pr.head.ref = 'feature';
  f.pr.head.repo.full_name = 'fork/repo';
  await assert.rejects(f.run(), /same-repository/);
  f.pr.head.repo.full_name = 'owner/repo';
  f.pr.state = 'closed';
  await assert.rejects(f.run(), /open/);
  assert.equal(f.remoteHead(), f.head);
});

test('detects head movement, retargeting, and title edits before a push', () => {
  const before = {
    state: 'open', title: 'title', body: 'body',
    head: { sha: 'head', ref: 'feature', repo: { full_name: 'owner/repo' } },
    base: { sha: 'base', ref: 'main' },
  };
  for (const change of [
    { head: { ...before.head, sha: 'moved' } },
    { base: { ...before.base, ref: 'other' } },
    { base: { ...before.base, sha: 'moved' } },
    { title: 'edited title' },
  ]) {
    assert.throws(() => assertUnchanged(before, { ...before, ...change }), /PR changed/);
  }
});

test('authorizes only exact, current commands from writers, not readers or bots', async () => {
  const comment = { id: 1, body: '@untobot squash', user: { id: 2, login: 'writer', type: 'User' } };
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { issue: { pull_request: {} }, comment } };
  let permission = 'read';
  let current = structuredClone(comment);
  const github = { rest: {
    issues: { getComment: async () => ({ data: current }) },
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) },
  } };
  await assert.rejects(authorizeCommand({ github, context }), /write access/);
  permission = 'write';
  assert.equal(await authorizeCommand({ github, context }), true);
  current.body = 'withdrawn';
  await assert.rejects(authorizeCommand({ github, context }), /comment changed/);
  current = structuredClone(comment);
  comment.body = 'please run @untobot squash later';
  assert.equal(await authorizeCommand({ github, context }), false);
  comment.body = '@untobot squash';
  comment.user.type = 'Bot';
  assert.equal(await authorizeCommand({ github, context }), false);
});
