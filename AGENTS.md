# Agent Instructions

- Work only on the main branch.
- Do not create or switch to new branches unless the user explicitly asks for a new branch.
- Use subagents at your discretion whenever they are useful.
- Do not write tests for everything by default. Write only genuinely useful tests; the goal is verification, not testing for its own sake or covering everything. Before adding a test, first ask whether that location truly needs one.
- Record newly discovered project knowledge where future agents can find it. Use README files, focused docs, or concise code comments when appropriate, so future agents do not run into the same problems again.
- Use Docker Compose to run the application. Do not start the project locally outside Docker Compose. Local commands are fine for tests, checks, scripts, and other tasks that are not application startup.
