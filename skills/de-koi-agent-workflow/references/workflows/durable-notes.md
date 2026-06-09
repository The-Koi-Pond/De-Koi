# Durable Notes Workflow Card

Use this when a session produces durable repo memory.

## Classify Exactly One

- No durable note
- Bug ownership/status update
- Architecture decision
- Reusable debugging lesson
- Cross-issue or cross-PR task note

Default to no durable note for one-off bugs, routine issue filing, tiny PRs, and anything already fully represented in GitHub or the final response.

## Capture When

- A bug changes owner or status in GitHub.
- A team decision was made or confirmed.
- A reusable debugging lesson was learned.
- An architecture behavior was clarified.
- Work spans more than one issue, PR, or session.

## Where To Put It

- Use GitHub issues or PRs for unowned bug reports, active bug ownership, active work status, and cross-issue task notes.
- Use repo docs or skill references only when the decision changes durable architecture or agent guidance.
- Do not create repo-local update folders or owner files for work status.

## Bug Ownership Details

When a bug does not have an owner, draft or file a GitHub issue instead of creating a repo-local note.

When someone starts fixing a bug, update the relevant GitHub issue or PR with the owner, status, next step, blockers, and resolution.

Use the user's GitHub identity to choose the owner. If the user asks "who am I?" or asks how to track their bugs, check local identity first with `git config user.name`, then `git config user.email`, and use `gh auth status` when GitHub CLI is logged in.

Do not store secrets, private user data, bulky raw logs, or machine-local paths in durable repo files.
