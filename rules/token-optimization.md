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
