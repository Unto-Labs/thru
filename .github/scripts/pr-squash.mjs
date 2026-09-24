import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectedCommitMessage, validatePullRequestCommit } from './pr-commit-message.mjs';

export async function authorizeCommand({ github, context }) {
  if (!context.payload.issue?.pull_request) return false;
  const { comment } = context.payload;
  if (comment.user.type === 'Bot' || comment.body.trim() !== '@untobot squash') return false;
  const { data: current } = await github.rest.issues.getComment({
    ...context.repo, comment_id: comment.id,
  });
  if (current.body.trim() !== '@untobot squash' || current.user.id !== comment.user.id) {
    throw new Error('The command comment changed. Post a new @untobot squash comment.');
  }
  const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
    ...context.repo, username: comment.user.login,
  });
  if (!data.user?.permissions?.push && !['write', 'maintain', 'admin'].includes(data.permission)) {
    throw new Error('Only collaborators with repository write access can run @untobot squash.');
  }
  return true;
}

async function getPullRequest(github, context) {
  const { data } = await github.rest.pulls.get({
    ...context.repo, pull_number: context.payload.issue.number,
  });
  return data;
}

export function assertUnchanged(before, after) {
  if (
    after.state !== 'open' ||
    after.head.sha !== before.head.sha || after.head.ref !== before.head.ref ||
    after.head.repo?.full_name !== before.head.repo?.full_name ||
    after.base.sha !== before.base.sha || after.base.ref !== before.base.ref ||
    after.title !== before.title || (after.body || '') !== (before.body || '')
  ) {
    throw new Error('The PR changed during finalization. Nothing was pushed; post the command again.');
  }
}

// Git plumbing never checks out or executes files, hooks, or filters from the PR.
// Keep the head tree on its existing branch point, not on a newer base tree:
// changing the parent to the latest base could silently undo upstream changes.
export function prepareCommit(git, pr) {
  const commits = git(['rev-list', '--reverse', '--topo-order', `${pr.base.sha}..${pr.head.sha}`])
    .trim().split('\n').filter(Boolean);
  if (!commits.length) throw new Error('This PR has no commits to finalize.');
  const message = git(['show', '-s', '--format=%B', pr.head.sha]);
  if (commits.length === 1 && validatePullRequestCommit({
    ...pr, commits: [{ commit: { message } }],
  }).valid) {
    return { sha: pr.head.sha, action: 'unchanged', count: 1 };
  }
  let parent;
  if (commits.length === 1) {
    const parents = git(['show', '-s', '--format=%P', pr.head.sha]).trim().split(' ');
    if (parents.length !== 1 || !parents[0]) {
      throw new Error('Cannot amend a root or merge commit automatically. Finalize this history manually.');
    }
    [parent] = parents;
  } else {
    const bases = git(['merge-base', '--all', pr.base.sha, pr.head.sha]).trim().split('\n');
    if (bases.length !== 1 || !bases[0]) {
      throw new Error('The PR has no unique branch point. Finalize this history manually.');
    }
    [parent] = bases;
  }
  const tree = git(['rev-parse', `${pr.head.sha}^{tree}`]).trim();
  // Preserve the sole/oldest commit's author; the App is the committer.
  const [name, email, date] = git(['show', '-s', '--format=%an%n%ae%n%aI', commits[0]]).trimEnd().split('\n');
  const sha = git(['commit-tree', tree, '-p', parent], {
    input: expectedCommitMessage(pr),
    env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date },
  }).trim();
  return { sha, action: commits.length === 1 ? 'amended' : 'squashed', count: commits.length };
}

export async function finalizePullRequest({ github, context, token, appSlug }) {
  const pr = await getPullRequest(github, context);
  const fullName = `${context.repo.owner}/${context.repo.repo}`;
  if (pr.state !== 'open' || pr.head.repo?.full_name !== fullName) {
    throw new Error('Only open, same-repository PRs can be finalized.');
  }
  if (
    pr.head.ref.startsWith('mergify/merge-queue/') ||
    pr.head.ref === context.payload.repository.default_branch || pr.head.ref === pr.base.ref
  ) {
    throw new Error('The bot cannot rewrite the default branch or a merge-queue branch.');
  }
  const { data: branch } = await github.rest.repos.getBranch({
    ...context.repo, branch: pr.head.ref,
  });
  if (branch.protected) throw new Error('The bot cannot rewrite a protected branch.');

  const { data: bot } = await github.rest.users.getByUsername({ username: `${appSlug}[bot]` });
  const directory = mkdtempSync(join(tmpdir(), 'untobot-squash-'));
  const authorization = Buffer.from(`x-access-token:${token}`).toString('base64');
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${context.serverUrl}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
    GIT_TERMINAL_PROMPT: '0',
    GIT_COMMITTER_NAME: `${appSlug}[bot]`,
    GIT_COMMITTER_EMAIL: `${bot.id}+${appSlug}[bot]@users.noreply.github.com`,
  };
  function git(args, options = {}) {
    try {
      return execFileSync('git', [
        '--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args,
      ], {
        cwd: directory, encoding: 'utf8', timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        ...options, env: { ...environment, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      // Avoid logging a child-process error object, which contains its environment.
      throw new Error(`git ${args[0]} failed: ${String(error.stderr || error.message)
        .replaceAll(token, '[redacted]').replaceAll(authorization, '[redacted]')}`);
    }
  }
  try {
    git(['init', '--bare', '--template=']);
    git(['remote', 'add', 'origin', `${context.serverUrl}/${fullName}.git`]);
    git(['fetch', '--no-tags', 'origin',
      `+refs/heads/${pr.base.ref}:refs/bot/base`,
      `+refs/heads/${pr.head.ref}:refs/bot/head`,
    ]);
    if (git(['rev-parse', 'refs/bot/head']).trim() !== pr.head.sha ||
        git(['rev-parse', 'refs/bot/base']).trim() !== pr.base.sha) {
      throw new Error('The PR moved before it was fetched. Post the command again.');
    }
    const result = prepareCommit(git, pr);
    assertUnchanged(pr, await getPullRequest(github, context));
    if (result.action === 'unchanged') return 'Already finalized: the single commit has the correct message. No push needed.';

    const children = await github.paginate(github.rest.pulls.list, {
      ...context.repo, state: 'open', base: pr.head.ref, per_page: 100,
    });
    if (children.length) {
      throw new Error(`This branch is the base of ${children.map(child => `#${child.number}`).join(', ')}. ` +
        'Squashing or amending it requires restacking those PRs; finalize the stack manually. No branches were changed.');
    }
    assertUnchanged(pr, await getPullRequest(github, context));
    git(['push', `--force-with-lease=refs/heads/${pr.head.ref}:${pr.head.sha}`,
      'origin', `${result.sha}:refs/heads/${pr.head.ref}`]);
    return result.action === 'amended'
      ? `Amended the commit message: ${result.sha}. Files and parent are unchanged. CI will rerun.`
      : `Squashed ${result.count} commits into ${result.sha}. Files are unchanged. CI will rerun.`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function reportResult({ github, context, success, message }) {
  await github.rest.reactions.createForIssueComment({
    ...context.repo, comment_id: context.payload.comment.id,
    content: success ? '+1' : '-1',
  });
  await github.rest.issues.createComment({
    ...context.repo, issue_number: context.payload.issue.number,
    body: `${success ? '### PR finalized' : '### PR finalization failed'}\n\n${message}\n\n` +
      `[Workflow run](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`,
  });
}
