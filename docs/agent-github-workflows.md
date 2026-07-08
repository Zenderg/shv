# Agent GitHub Workflows

This document is the source of truth for agent-owned GitHub issue fixing and pull request review workflows. Put local development commands in [docs/development.md](development.md), product behavior in [docs/product.md](product.md), architecture contracts in [docs/architecture.md](architecture.md), and release procedure in [docs/releases.md](releases.md).

These workflows are agent-facing. They define when an agent may create branches and pull requests, how issues should be validated before work begins, and how a separate review pass should decide whether a pull request is ready to merge.

## Roles

Use two separate agent roles for GitHub-driven changes:

- Issue Fix Agent: turns one valid GitHub issue into one focused pull request.
- PR Review Agent: reviews open pull requests and either merges accepted work or leaves actionable feedback.

The same conversation should not normally both produce a pull request and merge it. Keeping those responsibilities separate gives the project an independent review gate.

## Fixing GitHub Issues

When the user provides a GitHub issue URL or issue number and asks to fix it, the agent may create and switch to a dedicated branch without asking for separate branch permission. This is the only exception to the default "work only on main" branch rule.

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

1. Start from an up-to-date `main`.
2. Create a dedicated `codex/issue-<number>-<slug>` branch.
3. Investigate the exact cause before editing.
4. Implement the smallest focused fix that matches project conventions.
5. Add tests only when they materially improve verification for the change.
6. Run focused checks that are relevant to the files and behavior touched.
7. Commit with a conventional prefix such as `fix:`, `feat:`, `docs:`, `test:`, `refactor:`, `build:`, or `chore:`.
8. Push the branch.
9. Open a pull request against `main`.

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

The Issue Fix Agent must not merge its own PR.

## Reviewing Pull Requests

The PR Review Agent reviews open pull requests for the repository. It should treat each PR as untrusted until reviewed, even when another agent created it.

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
