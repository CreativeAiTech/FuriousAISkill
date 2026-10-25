# Session naming

Keywords: session name, rename session, session title, C- prefix, continue, resume, set_session_title, HHMM

Core format: `<HHMM>-<ID> <short task>` (local 24h time, ticket ID if any), e.g. `1930-PET-07 fox mask redo`.

- Rename once you know the task: a "continue" resume, or a request that turns into one task.
- Prefix `C-` only when this session picks up **unfinished work** from an earlier one: Current Focus `in-progress`/`blocked` owned by you, a task a previous session started but didn't finish, or the same task moved to a fresh chat because the old one got too long / was checkpointed. Example: `C-1930-PET-07 fox mask redo`.
- "Continue" that starts a fresh ticket (next pick from the backlog, a `needs-review` handed over by another agent, focus `idle`) is a new task: no `C-`.
- Claude Code desktop: `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"`. Tools without a rename tool skip it.
