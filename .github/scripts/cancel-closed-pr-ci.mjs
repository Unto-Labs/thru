// Cancel the CI of a pull request that was closed without merging.
//
// Mergify closes a merge-queue draft without merging it whenever it
// invalidates the batch: a queued PR was pushed to, the batch underneath it
// failed, or the queue was re-batched. Nothing stops the draft's own CI, which
// then holds runners until it finishes, testing a batch that can never merge
// (UNTO-3365). A successful batch's draft is merged, so it is left alone, as
// is any run that is not the closed PR's own pull_request run.

// Run statuses that can still be cancelled.
export const ACTIVE_STATUSES = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];

// isOwnRun reports whether run is CI that pr's closing orphaned: a
// pull_request run on pr's head repository and branch, created before pr was
// closed, for pr's head commit or associated with pr's number. A push run on
// the base branch for the same commit never matches. Neither does a run the
// close itself started (Web Deploy's preview teardown runs on
// pull_request: closed) or one a reopen started.
export function isOwnRun(run, pr) {
  if (run.event !== 'pull_request') return false;
  if (run.head_branch !== pr.head.ref) return false;
  if (run.head_repository?.full_name !== pr.head.repo?.full_name) return false;
  if (!pr.closed_at || !(Date.parse(run.created_at) < Date.parse(pr.closed_at))) return false;
  if (run.head_sha === pr.head.sha) return true;
  return (run.pull_requests ?? []).some(p => p.number === pr.number);
}

export async function cancelClosedPrRuns({ github, context, core }) {
  const pr = context.payload.pull_request;
  if (!pr) {
    core.setFailed('cancel-closed-pr-ci must run on a pull_request_target closed event');
    return [];
  }
  if (pr.merged) {
    core.info(`#${pr.number} was merged; its CI is left to finish`);
    return [];
  }
  if (!pr.head.repo) {
    core.info(`#${pr.number}: head repository is gone; nothing to match runs against`);
    return [];
  }

  const { owner, repo } = context.repo;

  // The job may wait for a runner: a PR reopened meanwhile (and perhaps
  // merged since) keeps its CI.
  const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: pr.number });
  if (current.state !== 'closed' || current.merged) {
    core.info(`#${pr.number} was reopened${current.merged ? ' and merged' : ''}; its CI is left alone`);
    return [];
  }

  // Another open PR from the same head branch shares its runs (same branch
  // and commit); cancelling them would cost that PR its checks.
  const siblings = await github.paginate(github.rest.pulls.list, {
    owner, repo, state: 'open', head: `${pr.head.repo.owner.login}:${pr.head.ref}`, per_page: 100,
  });
  const other = siblings.find(p => p.number !== pr.number);
  if (other) {
    core.info(`#${other.number} is still open from ${pr.head.ref}; its runs are shared, so none are cancelled`);
    return [];
  }

  const runs = new Map();
  for (const status of ACTIVE_STATUSES) {
    const page = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      owner, repo, branch: pr.head.ref, event: 'pull_request', status, per_page: 100,
    });
    for (const run of page) if (isOwnRun(run, pr)) runs.set(run.id, run);
  }

  const cancelled = [];
  for (const run of runs.values()) {
    try {
      await github.rest.actions.cancelWorkflowRun({ owner, repo, run_id: run.id });
      cancelled.push(run.id);
      core.info(`cancelled ${run.name} run ${run.id} (${run.status}) of closed #${pr.number}`);
    } catch (err) {
      // 409: the run finished between listing and cancelling.
      if (err.status !== 409) throw err;
      core.info(`run ${run.id} already finished`);
    }
  }
  if (!cancelled.length) core.info(`#${pr.number} closed with no CI left to cancel`);
  return cancelled;
}
