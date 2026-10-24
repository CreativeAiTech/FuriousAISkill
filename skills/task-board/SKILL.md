---
name: task-board
description: >
  EXPERIMENTAL. Shared task board and handoff baton for several AI agents (Claude Code, Antigravity/Gemini, Cowork,
  parallel sessions or worktrees of the same tool) working on one git repo, with no server: tickets live in
  .agents/BACKLOG.md, the baton in .agents/STATE.md, and `node ~/.agents/tools/baton.mjs` claims, logs and closes
  them. Use at the START of a session in a project that has .agents/STATE.md (read the brief, claim one ticket),
  when switching tasks, and BEFORE ENDING any session or when context/quota runs low (write the baton). Triggers:
  "continue", "where were we", "what's left", "pick up", "take over", "hand off", "claim", "I'm switching tools".
metadata:
  version: 0.1.0
  status: experimental
---

# Task Board (`task-board`, experimental)

Agents don't share chat memory, so the repo is the memory. Two committed files:

| File | Purpose |
| :--- | :--- |
| `.agents/STATE.md` | **The baton**: Current Focus, Needs User Decision, the newest handoff lines |
| `.agents/BACKLOG.md` | **The queue**: one bounded ticket per line, tagged for an agent |
| `.agents/baton.config.json` | Settings: paths, lease days, push mode, ticket ID pattern, agent names |
| `.agents/auto-baton.json` | Gitignored. Written by the optional auto-baton hook for sessions that ended without a baton |

No project yet? `node ~/.agents/tools/baton.mjs init` writes all three (never overwrites). Below, `baton` means
`node ~/.agents/tools/baton.mjs` (or the project's own wrapper, if its rules name one).

**Advisory, not enforced.** A claim is a line in a committed file; `git push` is the only lock. It stops honest
agents from colliding, it doesn't stop an agent that skips the protocol. "Other agents" includes other sessions of
the same tool: two Claude Code sessions in parallel worktrees collide just as easily as Claude and Gemini.

## Ticket line

```
- [ ] **ABC-12** `@claude` `needs: ABC-07` `target: 0.2` `from: ABC-03` One bounded task: goal, files, done-when.
```

- Box: `[ ]` open · `[~]` claimed (`claimed: <agent> until <date>` added by `claim`) · `[!]` blocked (`blocked: <reason>`) · `[x]` done.
- `needs:` IDs that must be Done first · `target:` milestone (lower ships first) · `from:` the ticket it was found in · `urgent` only for a broken build, a crash, or data at risk.
- IDs match `ticketId` in the config (default `[A-Z]+-\d+`), are stable, and never get renumbered.

## 1. Session start

1. Read the brief: `baton --agent <you>` (a project's SessionStart hook may already inject it).
2. Pick, in this order:
   1. The user's request in this message, which always wins.
   2. Current Focus, if it is `in-progress`/`blocked`, the user said "continue", **and you own it**. The brief says "Not yours" otherwise.
   3. Any open `urgent` ticket, else your ready ticket (all `needs` Done) with the lowest `target`. The brief lists only yours.
   4. Nothing ready for you → tell the user which ticket waits on which agent (the brief lists it) and stop.
      Never take another agent's ticket or make its decision to get unblocked.
3. Skip anything under **In progress (claimed)**: someone holds it and may still be running. A **STALE** claim
   (lease expired) can be claimed normally; say so in your log line. `--force` only after the user says so.
4. Claim, then set the focus. Start work only after `claim` succeeds:
   ```bash
   baton claim ABC-12 --agent <you>
   baton focus --task "ABC-12 <title>" --owner <you> --status in-progress --files "<paths>" --verify "<command>"
   ```
   `claim` refuses a ticket another agent holds (locally or on the remote). `focus --status in-progress` refuses when
   the ticket's `needs` aren't Done or it is tagged for another agent.
   **Hidden dependency** found mid-task: add a self-contained ticket for the agent who must act, add its ID to your
   ticket's `needs:`, run `baton block <ID> --reason "waits on <NEW-ID>"`, and pick your next ready ticket.

## 2. During the session

- One ticket at a time. Something unrelated? Add a new ticket with `from: <ID>` and the best agent tag. Don't fix it now.
- Need another agent's strength? Queue a ticket for it instead of asking the user to copy context between tools.

## 3. Session end (always, even mid-task)

Write the baton **before** your final message, while you still have context:

1. Run the project's verify step.
2. Update the ticket:
   - Finished → `baton done <ID> --commit <sha>` (moves it under _Done_), then `baton focus --clear`.
   - Blocked → `baton block <ID> --reason "<what unblocks it>"`; keep the focus with `--status blocked`.
   - Unfinished, you'll be back → keep the claim; `focus --status in-progress --next "<the very next action>"`.
   - Unfinished, someone else should take it → `baton release <ID>`.
3. Log one line with exact paths, commands, results and error text. It also renews your leases:
   ```bash
   baton log --agent <you> --done "<what changed + verify result>" --next "<next step>"
   ```
4. Put decisions you wait on under `## Needs User Decision` in STATE.md. Commit your own files per the project's git rules.

| Good log line | Bad |
| :--- | :--- |
| `Fixed NaN in parser.ts:412 when depth=0; tests/parser pass (was 2 failing)` | `Worked on parser` |
| `BLOCKED: build fails on Node 18, repro: npm run build → ERR_REQUIRE_ESM` | `Build broken` |

## 4. Context running low

Write the baton first, then tell the user: "Baton saved in `.agents/STATE.md`. Open <other tool> and say **continue**."
For decisions plus reasoning, `context-compressor` can also write `CONTEXT.md`; STATE.md stays the pointer.

## Push modes (`push` in the config)

| Mode | `claim`/`release`/`block`/`done` do | Use when |
| :--- | :--- | :--- |
| `push-master` | commit BACKLOG.md, push `HEAD:<branch>`, rebase-retry once on a race | Agents work in separate worktrees or machines and the team pushes straight to one branch |
| `commit-only` (default) | commit BACKLOG.md only | You review before pushing; other checkouts see claims after your push |
| `none` | edit the file only | One checkout, or you commit bookkeeping yourself |

`push-master` never pushes other unpushed commits: if HEAD has any, it commits locally and warns.

## Known limits

- Git push is the only lock: two agents claiming within the same second both succeed locally; the second push is
  rejected, rebased and warned with `CONFLICT`. In `commit-only`/`none` there is no cross-checkout check until you push.
- Leases are date-granular (`until YYYY-MM-DD`, UTC): a lease expires at the end of that day, not to the hour.
- Advisory only: nothing stops an agent that never runs the brief.

## Rules

- Never put secrets, API keys or `.env` content in STATE.md, BACKLOG.md or log lines.
- Keep STATE.md short (the tool keeps the newest 15 log lines; git keeps the history).
- Don't rewrite another agent's log lines. Append only.
