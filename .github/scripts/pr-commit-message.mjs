function normalizeMessage(value) {
  return (value ?? '').replace(/\r\n/g, '\n').trimEnd();
}

export function hasEffectiveApproval(reviews) {
  const latestByReviewer = new Map();
  for (const review of reviews) {
    const state = review.state?.toUpperCase();
    if (state === 'COMMENTED' || state === 'PENDING') continue;
    latestByReviewer.set(review.user.login, state);
  }

  const states = [...latestByReviewer.values()];
  return (
    states.includes('APPROVED') &&
    !states.includes('CHANGES_REQUESTED')
  );
}

export function expectedCommitMessage({ title, number, body }) {
  const subject = `${title} (#${number})`;
  const description = normalizeMessage(body);
  return description ? `${subject}\n\n${description}` : subject;
}

export function validatePullRequestCommit({ title, number, body, commits }) {
  const expected = expectedCommitMessage({ title, number, body });
  const reasons = [];

  if (commits.length !== 1) {
    reasons.push(`expected exactly one commit, found ${commits.length}`);
  } else if (normalizeMessage(commits[0].commit.message) !== expected) {
    reasons.push('the commit message does not match the PR title and description');
  }

  return {
    valid: reasons.length === 0,
    expected,
    expectedSubject: `${title} (#${number})`,
    reasons,
  };
}
