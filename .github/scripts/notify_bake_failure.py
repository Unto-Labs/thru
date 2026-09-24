#!/usr/bin/env python3
"""Post a failed AMI bake to Slack, with how long the bake has been failing.

Runs from bake-runner-ami.yml's notify-failure job. The nightly bake is a
scheduled workflow: when it fails nothing pages anyone, and infra's cicd-promote
keeps promoting the newest AMI that already exists, so a broken bake is
invisible. It failed six nights running (2026-09-19 to 09-24, UNTO-2998) before
anyone looked.

The streak is what makes the message actionable: "failed" is easy to dismiss
as one bad night, "failed 6 nights in a row, last success 2026-09-18" is not.
Enriching the message is best effort -- a GitHub API error there must never
cost us the ping itself.

Environment:
  GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_EVENT_NAME,
  GITHUB_STEP_SUMMARY   set by Actions
  BAKE_WORKFLOW_FILE    workflow file whose history gives the streak
  SLACK_BOT_TOKEN       required; without it the step fails so the missing
                        token shows up on the run instead of being skipped
  SLACK_CHANNEL         channel id
  GH_TOKEN              read by `gh api`
"""

import json
import os
import subprocess
import sys
import urllib.request

FAILED = ("failure", "timed_out")


def gh_api(path):
    out = subprocess.run(
        ["gh", "api", path], check=True, capture_output=True, text=True
    ).stdout
    return json.loads(out)


def streak(runs):
    """Count failures before the current run, and find the last success.

    `runs` are completed runs of the bake workflow, newest first, excluding the
    run being reported. Cancelled and skipped runs neither extend nor break the
    streak: they say nothing about whether the bake itself works.
    """
    failures = 0
    for run in runs:
        conclusion = run.get("conclusion")
        if conclusion == "success":
            return failures, run
        if conclusion in FAILED:
            failures += 1
    return failures, None


def failed_step(jobs):
    """Return (job, step) names of the first failed step, or (None, None)."""
    for job in jobs:
        if job.get("conclusion") != "failure":
            continue
        for step in job.get("steps") or []:
            if step.get("conclusion") == "failure":
                return job.get("name"), step.get("name")
        return job.get("name"), None
    return None, None


def build_message(server, repo, run_id, event, prior_failures, last_success, job, step):
    run_url = f"{server}/{repo}/actions/runs/{run_id}"
    trigger = "nightly schedule" if event == "schedule" else "manual dispatch"
    lines = [f"Run: <{run_url}|Bake GARM runner AMI> ({trigger})"]
    if job:
        lines.append(f"Failed: `{job}`" + (f" at `{step}`" if step else ""))

    if last_success is None:
        lines.append(
            f"No successful bake in the recent history; this is failure "
            f"{prior_failures + 1} or more."
        )
        total = None
    else:
        total = prior_failures + 1
        when = (last_success.get("created_at") or "")[:10] or "unknown date"
        url = last_success.get("html_url") or run_url
        lines.append(
            f"Failed {total} run{'s' if total != 1 else ''} in a row; "
            f"last success <{url}|{when}>."
        )
    lines.append(
        "Runners keep booting from the newest existing AMI until the bake is fixed."
    )

    if total is None or total > 1:
        title = "GARM runner AMI bake is failing repeatedly"
    else:
        title = "GARM runner AMI bake failed"
    return title, "\n".join(lines)


def post_slack(token, channel, title, body):
    payload = json.dumps(
        {
            "channel": channel,
            "text": f"{title}\n{body}",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": title}},
                {"type": "section", "text": {"type": "mrkdwn", "text": body}},
            ],
        }
    ).encode()
    request = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get("ok"):
        raise RuntimeError(f"Slack chat.postMessage failed: {result.get('error')}")


def main():
    env = os.environ
    repo = env["GITHUB_REPOSITORY"]
    run_id = env["GITHUB_RUN_ID"]
    server = env.get("GITHUB_SERVER_URL", "https://github.com")
    event = env.get("GITHUB_EVENT_NAME", "")
    workflow = env.get("BAKE_WORKFLOW_FILE", "bake-runner-ami.yml")

    prior, last_success, job, step = 0, None, None, None
    try:
        history = gh_api(
            f"repos/{repo}/actions/workflows/{workflow}/runs"
            "?status=completed&per_page=50"
        )["workflow_runs"]
        prior, last_success = streak(r for r in history if str(r["id"]) != run_id)
        jobs = gh_api(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100")["jobs"]
        job, step = failed_step(jobs)
    except Exception as err:  # enrichment only; still send the ping
        print(f"::warning::could not read bake history: {err}")

    title, body = build_message(
        server, repo, run_id, event, prior, last_success, job, step
    )

    summary = env.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### {title}\n\n{body}\n")

    token = env.get("SLACK_BOT_TOKEN", "")
    if not token:
        print("::error::SLACK_BOT_TOKEN is not set; the bake failure was NOT reported")
        return 1
    try:
        post_slack(token, env.get("SLACK_CHANNEL", "C08EJ3SQPHS"), title, body)
    except Exception as err:
        print(f"::error::could not post the bake failure to Slack: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
