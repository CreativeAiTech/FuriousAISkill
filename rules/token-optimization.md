# Global Orchestration & Token Rules (all projects, all tools)

Project rules (AGENTS.md, CLAUDE.md, GEMINI.md) refine these and win on conflict, except that the default top-tier areas (`model-orchestrator` Step 4) are a floor: projects may add areas, and lowering one needs a written reason in the project's rules. The user has asked for this delegation in every project, so it counts as an explicit request to use subagents.

## 1. Orchestrator-first (decide before acting)
The main session is the **brain**: it classifies, plans, writes specs and reviews; cheaper subagents do the legwork. Before the first tool call on a request, state the route in one line, e.g. `Route: scout(haiku) → plan → worker(sonnet) → verifier(haiku)`.

| Work | Who |
| :--- | :--- |
| **Trivial**: answer from loaded context, ≤2 quick tool calls, a one-line edit | Brain inline (a spawn costs more) |
| **Collect**: search, read 3+ files, logs, git history, web, inventories | Small read-only subagent; returns paths, lines, facts, not dumps |
| **Mechanical or well-specified edits**, any number of files | Worker with a tight spec (goal, files, constraints, done-when) |
| **Verify**: typecheck, tests, lint, build | Small verifier; pass/fail in ≤3 lines |
| **Judgment**: architecture, unknown-cause bugs, ambiguity, security, final review | Brain specs, worker implements, brain reviews the **diff** only |

- Run independent subagents in parallel, each with only the files it needs.
- A worker fails twice → redo one tier up, or the brain takes it. Same error twice → stop and report.
- **Hard work needs the top tier** (Opus / Pro class, high effort): architecture or design decisions, anything costly to reverse, a bug unexplained after one real attempt, the same error twice, conflicting constraints, security, data-loss or money risk, plus any area the project adds. Check the model you're *actually* on before each such decision: tools silently fall back to a smaller model when quota runs out.
- **Decide high, execute low, never guess.** Below the required tier, escalate: Claude Code → subagent with `model: "opus"`, `effort: "high"`, `"max"` only for silent-failure math, costly-to-undo changes, security, a failed high attempt, or tangled constraints (`model-orchestrator` Step 4) (ask first unless it's a contained question; it spends shared quota); Antigravity → the Pro-class model, or `@claude`. The top model writes the decision down (decision note or spec); lower tiers link or quote it and carry it out, never re-decide. A new decision point mid-execution → escalate again.
- **Can't escalate** (top tier unavailable, out of quota, call failed)? Never decide below tier. Hard to reverse → stop, tell the user to wait for the reset or switch models, queue it for a top-tier agent. Reversible → offer a labeled **DRAFT** (your model, "below required tier", confidence, unknowns), commit nothing irreversible, queue a top-tier review. Same when the user says "do it anyway". Details: `model-orchestrator` Step 4.
- The user never names a model: pick the smallest that does the job well.
- **Delegate only to a cheaper tier.** A worker on the main session's price tier can't save money: it adds a cold start and grows its own context (measured 2026-10: Flash `self` workers under a Flash main cost +25% vs inline, Flash-Lite `research` saved 80%). Same tier → inline, unless a big messy task needs context isolation. Every spawn gets a tight spec, line-range reads, and a stop point (report back after ~30 tool calls).

| Tool | Small (collect, verify) | Mid (implement) | Brain |
| :--- | :--- | :--- | :--- |
| Claude Code | `Explore` / `verifier` (haiku) | `worker` (sonnet) | main session (opus) |
| Antigravity | `research` / `flash_lite` (never Flash) | inline when main is Flash; `flash` worker only under a Pro main | main session |

Agent choice across tools, task specs, handoff: `model-orchestrator`.

## 2. Bounded tool use
- Read targeted line ranges, not whole files. Never read lockfiles, `*.map`, binaries, or build output (`dist/`, `build/`, `out/`, `node_modules/`).
- Cap noisy output at the source (`| head -n 30`, `| Select-Object -First 30`, `--quiet` / `-q`).

## 3. Concise replies
Show diffs, short snippets, or links to changed lines; never echo whole files.

## 4. Checkpoint long chats
About 20+ turns with heavy tool output, or right after a milestone: checkpoint with `context-compressor` and start fresh (prefer it over `/compact` for long work).

## 5. Measure, don't guess
`node ~/.agents/tools/tokenReport.mjs --summary` (Claude Code; refreshes daily at session start) writes `.agents/reports/token-report.md`: kit overhead vs delegation savings, wasteful spawns, oversized tool results, late checkpoints. Check it before changing these rules.

## 6. Name the session after the task
Once you know the task (a "continue" resume, or a request that turns into one task), rename the session
`<HHMM>-<ID> <short task>` (local 24h time, ticket ID if any), e.g. `1930-PET-07 fox mask redo`.
Prefix `C-` only when this session picks up **unfinished work** from an earlier one (Current Focus `in-progress`/`blocked`
owned by you, a task a previous session started but didn't finish, or the same task moved to a fresh chat because the
old one got too long / was checkpointed), e.g. `C-1930-PET-07 fox mask redo`. "Continue" that
starts a fresh ticket (next pick from the backlog, a `needs-review` handed over by another agent, focus `idle`) is a new task: no `C-`. Claude Code desktop: `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"`.
Tools without a rename tool skip it.
