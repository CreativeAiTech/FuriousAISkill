# Global Orchestration & Token Rules (all projects, all tools)

Project rules (AGENTS.md, CLAUDE.md, GEMINI.md) refine these and win on conflict. The user has asked for this delegation in every project, so it counts as an explicit request to use subagents.

## 1. Orchestrator-first (always on, decide before acting)
The main session is the **brain**: it classifies, plans, writes specs, and reviews. Cheaper subagents do the legwork. Before the first tool call on any request, pick a route and state it in one line, e.g. `Route: scout(haiku) → plan → worker(sonnet) → verifier(haiku)`.

| Work | Who does it |
| :--- | :--- |
| **Trivial**: answer from context already loaded, ≤2 quick tool calls, a one-line edit | Brain inline. A spawn costs more than the task |
| **Collect**: search, read 3+ files, logs, git history, web, inventories | Small read-only subagent. It returns paths, line numbers, facts, not file dumps |
| **Mechanical or well-specified edits**, in any number of files | Worker subagent with a tight spec (goal, files, constraints, done-when) |
| **Verify**: typecheck, tests, lint, build | Small verifier subagent. It returns pass/fail in ≤3 lines |
| **Judgment**: architecture, unknown-cause bugs, ambiguity, security, final review | Brain thinks and specs; a worker implements; the brain reviews the **diff** only |

- Run independent subagents in parallel. Give each only the files it needs.
- A worker that fails twice → redo one tier up, or the brain takes it. Same error twice → stop and report.
- **Hard work has a minimum tier: the top one** (Opus / Pro class, high effort). That covers architecture or design decisions, anything costly to reverse, a bug still unexplained after one real attempt, the same error twice, conflicting constraints, and security, data-loss or money risk. Projects may list more top-tier areas. Check the model you are *actually* on before each such decision, not only at session start: tools fall back to a smaller model silently when quota runs out.
- **Decide high, execute low, never guess.** Below the required tier, escalate if you can: Claude Code → a subagent with `model: "opus"`, `effort: "max"` (ask first if it's more than a contained question, since it spends the shared quota); Antigravity → the Pro-class model in the picker, or `@claude`. The top model writes its decision down (decision note or spec); lower tiers quote or link it verbatim and carry it out, never re-decide it. A new decision point mid-execution → escalate again.
- **Can't escalate** (top tier unavailable, out of quota, call failed)? Never decide below tier. Hard to reverse → stop, tell the user to wait for the reset or switch models, and queue the item for a top-tier agent. Reversible → offer a labeled **DRAFT** (your model, "below required tier", confidence, unknowns), commit nothing irreversible, queue a top-tier review. Same when the user says "do it anyway". Details: `model-orchestrator` Step 4.
- The user never names a model. Pick the smallest that can do the job well.

| Tool | Small (collect, verify) | Mid (implement) | Brain |
| :--- | :--- | :--- | :--- |
| Claude Code | `Explore` or `verifier` agent (haiku) | `worker` agent (sonnet) | main session (opus) |
| Antigravity | `research` / `flash_lite` | `flash` (`pro` for subtle edits) | main session |

Details (agent choice across tools, task specs, handoff): the `model-orchestrator` skill.

## 2. Bounded tool use
- Read targeted line ranges, not whole files. Never read lockfiles, `*.map`, binaries, or build output (`dist/`, `build/`, `out/`, `node_modules/`).
- Cap noisy output at the source (`| head -n 30`, `| Select-Object -First 30`) and use `--quiet` / `-q` flags.

## 3. Concise replies
Show diffs, short snippets, or links to changed lines, never whole files echoed back.

## 4. Checkpoint long chats
When a chat gets long (about 20+ turns with heavy tool output, or a milestone has just landed), checkpoint with `context-compressor` and start fresh. Prefer that over `/compact` for long-running work.
