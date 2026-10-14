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
    graphql: async () => {
      const snapshot = structuredClone(pr);
      const baseSha = git('--git-dir', remote, 'rev-parse', `refs/heads/${pr.base.ref}`);
      state.onRead(++reads, snapshot);
      return { repository: { pullRequest: {
        number: snapshot.number, state: snapshot.state.toUpperCase(),
        title: snapshot.title, body: snapshot.body,
        headRefName: snapshot.head.ref, headRefOid: snapshot.head.sha,
        headRepository: { nameWithOwner: snapshot.head.repo.full_name },
        baseRefName: snapshot.base.ref, baseRefOid: snapshot.base.sha,
        baseRef: { target: { oid: baseSha } },
      } } };
    },
    rest: {
      users: { getByUsername: async () => ({ data: { id: 123 } }) },
      pulls: {
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

test('finalizes rebased PRs with persistently stale base metadata', async t => {
  for (const count of [1, 2]) {
    await t.test(`${count} commits`, async t => {
      const f = fixture(t, { count });
      const base = f.pr.base.sha;
      f.git('switch', 'feature');
      f.git('rebase', 'main');
      f.pr.head.sha = f.git('rev-parse', 'HEAD');
      const tree = f.git('rev-parse', 'HEAD^{tree}');
      f.git('push', '--force', f.remote, 'feature');
      f.pr.base.sha = f.parent;

      await f.run();
      const head = f.importHead();
      assert.equal(f.git('rev-parse', `${head}^`), base);
      assert.equal(f.git('rev-parse', `${head}^{tree}`), tree);
      assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
    });
  }
});

test('squashes when stale base metadata refreshes during finalization', async t => {
  const f = fixture(t);
  f.state.onRead = (reads, snapshot) => {
    if (reads === 1) snapshot.base.sha = f.parent;
  };

  await f.run();
  const head = f.importHead();
  assert.equal(f.git('rev-parse', `${head}^`), f.parent);
  assert.equal(f.git('rev-parse', `${head}^{tree}`), f.tree);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  const merged = f.git('merge-tree', '--write-tree', f.pr.base.sha, head);
  assert.equal(f.git('show', `${merged}:upstream`), 'unrelated upstream change');
});

test('preserves upstream changes when the base advances after fetch', async t => {
  const f = fixture(t);
  f.state.onRead = (reads, snapshot) => {
    if (reads === 2) {
      writeFileSync(join(f.git('rev-parse', '--show-toplevel'), 'upstream'), 'newer upstream change\n');
      f.git('add', '.');
      f.git('commit', '-m', 'advance base during finalization');
      f.git('push', f.remote, 'main');
      f.pr.base.sha = f.git('rev-parse', 'HEAD');
    }
    snapshot.base.sha = f.pr.base.sha;
  };

  await f.run();
  const head = f.importHead();
  assert.equal(f.git('rev-parse', `${head}^`), f.parent);
  assert.equal(f.git('rev-parse', `${head}^{tree}`), f.tree);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  const merged = f.git('merge-tree', '--write-tree', f.pr.base.sha, head);
  assert.equal(f.git('show', `${merged}:upstream`), 'newer upstream change');
});

test('refuses rewritten live base history despite an older PR base OID', async t => {
  for (const rewrite of ['rewind', 'diverge', 'unrelated']) {
    await t.test(rewrite, async t => {
      const f = fixture(t, { count: 1 });
      const retainedBase = f.pr.base.sha;
      writeFileSync(join(f.git('rev-parse', '--show-toplevel'), 'upstream'), 'removed upstream change\n');
      f.git('add', '.');
      f.git('commit', '-m', 'upstream later removed');
      f.git('push', f.remote, 'main');
      f.git('switch', 'feature');
      f.git('rebase', 'main');
      f.pr.head.sha = f.git('rev-parse', 'HEAD');
      f.git('push', '--force', f.remote, 'feature');
      f.pr.base.sha = f.parent;
      let rewrittenBase = retainedBase;
      if (rewrite !== 'rewind') {
        rewrittenBase = f.git(
          'commit-tree', `${retainedBase}^{tree}`,
          ...(rewrite === 'diverge' ? ['-p', retainedBase] : []),
          '-m', 'replace upstream history',
        );
      }
      f.state.onRead = reads => {
        if (reads === 1) {
          f.git('push', '--force', f.remote, `${rewrittenBase}:refs/heads/main`);
        }
      };

      await assert.rejects(f.run(), /base branch history (was rewritten|cannot be verified)/);
      assert.equal(f.remoteHead(), f.pr.head.sha);
      assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/heads/main'), rewrittenBase);
    });
  }
});

test('keeps the snapshotted boundary when upstream absorbs a PR commit before fetch', async t => {
  const f = fixture(t);
  const base = f.pr.base.sha;
  f.git('switch', 'feature');
  f.git('rebase', 'main');
  f.pr.head.sha = f.git('rev-parse', 'HEAD');
  const tree = f.git('rev-parse', 'HEAD^{tree}');
  const firstCommit = f.git('rev-parse', 'HEAD^');
  f.git('push', '--force', f.remote, 'feature');
  f.pr.base.sha = f.parent;
  f.state.onRead = reads => {
    if (reads === 1) f.git('push', f.remote, `${firstCommit}:refs/heads/main`);
  };

  await f.run();
  const head = f.importHead();
  assert.equal(f.git('rev-parse', `${head}^`), base);
  assert.equal(f.git('rev-parse', `${head}^{tree}`), tree);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/heads/main'), firstCommit);
});

test('does not absorb upstream history into the squash when the base rewinds after fetch', async t => {
  const f = fixture(t);
  const base = f.pr.base.sha;
  f.git('switch', 'feature');
  f.git('rebase', 'main');
  f.pr.head.sha = f.git('rev-parse', 'HEAD');
  const tree = f.git('rev-parse', 'HEAD^{tree}');
  f.git('push', '--force', f.remote, 'feature');
  f.pr.base.sha = f.parent;
  f.state.onRead = reads => {
    if (reads === 2) f.git('push', '--force', f.remote, `${f.parent}:refs/heads/main`);
  };

  await f.run();
  const head = f.importHead();
  assert.equal(f.git('rev-parse', `${head}^`), base);
  assert.equal(f.git('rev-parse', `${head}^{tree}`), tree);
  assert.equal(f.git('show', '-s', '--format=%B', head), expectedCommitMessage(f.pr));
  assert.equal(f.git('rev-list', '--count', `${base}..${head}`), '1');
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/heads/main'), f.parent);
});

test('refuses head movement between the API snapshot and fetch', async t => {
  const f = fixture(t);
  f.state.onRead = reads => {
    if (reads === 1) f.git('push', '--force', f.remote, `${f.parent}:refs/heads/feature`);
  };
  await assert.rejects(f.run(), /PR moved before it was fetched/);
  assert.equal(f.remoteHead(), f.parent);
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
