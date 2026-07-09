# Agent GitHub Workflows

This document is the source of truth for agent-owned GitHub issue fixing and pull request review workflows. Put local development commands in [docs/development.md](development.md), product behavior in [docs/product.md](product.md), architecture contracts in [docs/architecture.md](architecture.md), and release procedure in [docs/releases.md](releases.md).

These workflows are agent-facing. They define when an agent may create branches and pull requests, how issues should be validated before work begins, and how a separate review pass should decide whether a pull request is ready to merge.

## Roles

Use two separate agent roles for GitHub-driven changes:

- Issue Fix Agent: turns one valid GitHub issue into one focused pull request.
- PR Review Agent: reviews open pull requests and either merges accepted work or leaves actionable feedback.

The same conversation should not normally both produce a pull request and merge it. Keeping those responsibilities separate gives the project an independent review gate.

## Selecting Work

When an automation or user asks the agent to choose an issue rather than naming one, handle exactly one issue per run. Use GitHub's current state as the source of truth; automation memory may help avoid repeated discovery, but it is only a cache and must not override current issue or pull request state.

Before selecting an issue:

1. Refresh the repository's open pull requests and inspect which issues they close or otherwise cover.
2. Refresh the open issues and exclude issues already covered by an open pull request.
3. Respect explicit priority labels or user direction. Without either, select the oldest uncovered open issue so repeated runs are deterministic.
4. Read the full issue and linked discussion before deciding that it is actionable.
5. After initial validation, claim the issue through an existing repository assignment or coordination label when permissions and conventions allow it.
6. Recheck the issue and open pull request coverage before publishing work so a concurrent agent cannot silently create a duplicate pull request.

An optional coordination label, assignment, or automation-memory entry can make active work easier to see, but its absence must not block the workflow. Do not invent a required label during an issue run, and never use one of these hints instead of checking GitHub itself.

Write automation memory only after the run reaches and verifies its terminal GitHub state. If a retry or user intervention continues the same run, update that result instead of leaving contradictory "PR not created" and "PR created" outcomes as separate final records.

## Fixing GitHub Issues

When the user provides a GitHub issue URL or issue number and asks to fix it, or explicitly authorizes the agent or automation to select and fix one issue, the agent may create and switch to a dedicated branch without asking for separate branch permission. A request to inspect, summarize, or prioritize issues does not grant that permission. This is the only exception to the default "work only on main" branch rule.

Use a branch name like:

```text
codex/issue-123-short-slug
```

Before creating the branch, inspect the issue and validate that it describes a real, current problem. Validation can include reading the linked discussion, checking product and architecture docs, searching the code, reproducing the behavior, running focused checks, or asking the user for missing reproduction details when the issue cannot be evaluated locally.

Do not blindly implement every issue. If the issue is invalid, already fixed, unreproducible, a duplicate, or outside project scope, do not create a fix PR. Instead:

- comment on the issue with the validation result and evidence;
- close the issue when the conclusion is clear;
- leave it open with a clear question only when more information is required.

For a valid issue:

1. Start from an up-to-date `origin/main` in a clean worktree.
2. Create a dedicated `codex/issue-<number>-<slug>` branch.
3. Investigate the exact cause before editing.
4. Implement the smallest focused fix that matches project conventions.
5. Add tests only when they materially improve verification for the change.
6. Run the narrowest useful checks first, then broader checks justified by the affected surfaces and risk.
7. Commit with a conventional prefix such as `fix:`, `feat:`, `docs:`, `test:`, `refactor:`, `build:`, or `chore:`.
8. Push the branch.
9. Open a pull request against `main`.

In a multi-worktree checkout, `main` may already be checked out elsewhere. Do not force a second `main` checkout with `--ignore-other-worktrees`, detach the other worktree, or disturb unrelated changes. If the current worktree is clean and based on the fetched `origin/main`, create the issue branch directly from that commit. Otherwise use a clean dedicated worktree. Never stash, reset, or reuse unrelated user changes to make room for an issue fix.

The pull request body must link the issue with a GitHub closing keyword when the PR should close the issue after merge:

```text
Fixes #123
```

Use `Closes #123` or `Resolves #123` when those read better. Do not rely on a plain `#123` reference if the issue should auto-close after merge.

The PR description should include:

- the issue link or number;
- a short diagnosis;
- the fix summary;
- checks run and their results;
- any residual risk or follow-up that the reviewer should know.

For a scheduled issue-fix run, a complete implementation with passing required checks must be opened as ready for review, even when generic publishing tooling defaults to a draft pull request. Use a draft only when the user explicitly requests one or when the work is intentionally incomplete; describe the blocker or remaining work in the draft.

After opening the pull request, verify that it is open against `main`, points at the intended branch and commit, has the intended ready/draft state, and is recognized as closing the issue when a closing keyword was used. A missing optional repository label is not a publication failure.

Prefer the GitHub connector for issue and pull request reads and supported write operations. If a required capability is unavailable or GitHub returns a permission error such as `403 Resource not accessible by integration`, use an authenticated `gh` command as the fallback. Do not retry a known unsupported connector operation repeatedly within the same run.

A `gh` authentication or network failure observed inside the sandbox is not sufficient evidence that the credentials are invalid. Retry `gh auth status` or the required `gh` operation once with sandbox escalation before declaring the fallback unavailable. If that escalated retry also fails, report the pushed branch and exact blocker without inventing another credential path.

The Issue Fix Agent must not merge its own PR.

## Reviewing Pull Requests

The PR Review Agent reviews ready-for-review pull requests for the repository. It should treat each PR as untrusted until reviewed, even when another agent created it. Skip drafts unless the user explicitly asks for an early review of incomplete work; drafts must not be merged.

For each PR:

1. Read the linked issue, PR description, commits, and changed files.
2. Confirm that the issue was validated and that the PR actually addresses it.
3. Review the diff for correctness, scope control, regressions, maintainability, and missing useful verification.
4. Run or inspect relevant checks when available.
5. Decide whether the PR is acceptable.

If the PR is acceptable:

- merge it into `main`;
- rely on GitHub to close linked issues through `Fixes #123`, `Closes #123`, or `Resolves #123`;
- manually close the issue only if the PR was merged and GitHub did not close it automatically.

If the PR is not acceptable:

- leave a comment on the PR with concrete, actionable feedback;
- do not merge it;
- move on to the next PR.

The review pass should finish after all current open PRs have been reviewed or a blocking repository-level problem prevents useful progress.
