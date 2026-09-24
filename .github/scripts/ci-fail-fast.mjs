import { setTimeout } from 'node:timers/promises';

// Runs in a separate trusted workflow. Inspect the triggering run's leaf
// jobs rather than waiting for a reusable call to finish.
export async function watchRun({ github, context, core, ignoredJobs = [], sleep = setTimeout }) {
  const target = context.payload.workflow_run;
  const run = { ...context.repo, run_id: target.id };
  const attempt = target.run_attempt;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('workflow_run.run_attempt must be a positive integer');
  }

  for (;;) {
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
      ...run,
      attempt_number: attempt,
      per_page: 100,
    });
    // External watchers must stop after manual cancellation or completion,
    // even if the gate never materialized. Never cancel a newer rerun based
    // on this event's old failed jobs; the cancel endpoint is run-wide.
    const { data: current } = await github.rest.actions.getWorkflowRun(run);
    if (current.run_attempt !== attempt || current.status === 'completed') {
      core.info('Target attempt ended or was superseded; stopping watcher.');
      return;
    }
    const failed = jobs.find(job =>
      ['failure', 'timed_out', 'action_required'].includes(job.conclusion) &&
      !ignoredJobs.some(name => job.name === name || job.name.startsWith(`${name} /`))
    );
    if (failed) {
      core.error(`Cancelling run after ${failed.name}: ${failed.html_url}`);
      await github.rest.actions.cancelWorkflowRun(run);
      return;
    }

    // A skipped gate also ends draft/path-filtered PR runs. Never use "all
    // visible jobs completed": GitHub can materialize dependent jobs later.
    if (jobs.some(job => job.name === 'check-status' && job.status === 'completed')) {
      core.info('CI gate finished; stopping fail-fast watcher.');
      return;
    }
    await sleep(15000);
  }
}
