# Agent Instructions

- Work only on the main branch.
- Do not create or switch to new branches unless the user explicitly asks for a new branch.
- Use subagents at your discretion whenever they are useful.
- Use conventional commit prefixes for commit messages so releases can be summarized cleanly: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, or `build:`.
- Do not write tests for everything by default. Write only genuinely useful tests; the goal is verification, not testing for its own sake or covering everything. Before adding a test, first ask whether that location truly needs one.
- Implement fallback mechanics only with explicit user permission. Avoid fallbacks when possible because they make debugging harder. If a fallback would be a clear future advantage rather than a likely maintenance problem, stop and ask the user before adding it.
- When the user says they found a bug, first investigate and identify the exact problem, then implement a fix only after the user approves it. It is acceptable to ask the user to do something manually or inspect something when you cannot do it yourself.
- Record newly discovered project knowledge where future agents can find it. Use README files, focused docs, or concise code comments when appropriate, so future agents do not run into the same problems again.
- Use Docker Compose to run the application. Do not start the project locally outside Docker Compose. Local commands are fine for tests, checks, scripts, and other tasks that are not application startup.
