# Session naming

Keywords: session name, rename session, session title, rank, continue, resume, set_session_title

Core format: `[<RANK>] <ID> <short task>`, e.g. `[A] PET-07 fox mask redo`.

- `<RANK>` is the ticket's effective rank, including any rank a project defines above S (e.g. `[SS]`); a rank stored as a lower rank plus a tag prints as the rank the tag marks.
- No rank: start with the ID (`PET-07 fox mask redo`). No ticket: the short task only.
- No time prefix and no resume marker: a resumed task keeps the same title.
- Rename once you know the task: a "continue" resume, or a request that turns into one task.
- Claude Code desktop: `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"`. Antigravity: `node tools/agentBrief.mjs title "<ID: short task | topic>"` (also triggered automatically by `claim` and `focus --task`). Tools without a rename mechanism skip it.
