# Global Orchestration & Token Rules (all projects, all tools)

Project rules (AGENTS.md, CLAUDE.md, GEMINI.md) refine these and win on conflict, except that the default top-tier areas (`model-orchestrator` Step 4) are a floor: projects may add areas, and lowering one needs a written reason in the project's rules. The user has asked for this delegation in every project, so it counts as an explicit request to use subagents.

| Before you… | Read |
| :--- | :--- |
| write or edit an agent rule (CLAUDE.md, AGENTS.md, GEMINI.md, kit rules) | `~/.agents/rules/topics/writing-rules.md` |
| escalate a top-tier decision, hit a quota/model fallback, or the user says "do it anyway" | `~/.agents/rules/topics/escalation.md` |
| checkpoint a long chat, size a task, or run a context check (checkpoint, context, long chat, CONTEXT.md, agContext) | `~/.agents/rules/topics/checkpoints.md` |
| change these rules, audit token spend, or act on the weekly hygiene report (tokens, hygiene) | `~/.agents/rules/topics/measure-and-hygiene.md` |
| rename the session (session title, rename, "continue" resume, `C-` prefix) | `~/.agents/rules/topics/session-naming.md` |

## 1. Orchestrator-first
The main session is the **brain**: it classifies, plans, writes specs and reviews; cheaper subagents do the legwork. Before the first tool call on a request, state the route in one line, e.g. `Route: scout(haiku) → plan → worker(sonnet) → verifier(haiku)`.

| Work | Who |
| :--- | :--- |
| **Trivial**: answer from loaded context, ≤2 quick tool calls, one-line edit | Brain inline |
| **Collect**: search, read 3+ files, logs, git history, web | Small read-only subagent; returns paths, lines, facts |
| **Mechanical or well-specified edits**, any number of files | Worker with a tight spec (goal, files, constraints, done-when) |
| **Verify**: typecheck, tests, lint, build | Small verifier; pass/fail in ≤3 lines |
| **Judgment**: architecture, unknown-cause bugs, ambiguity, security, final review | Brain specs, worker implements, brain reviews the **diff** |

- Run independent subagents in parallel, each with only the files it needs.
- A worker fails twice → redo one tier up, or the brain takes it. Same error twice → stop and report.
- **Hard work needs the top tier** (a top-ranked brain, high effort): architecture or design, anything costly to reverse, a bug unexplained after one real attempt, the same error twice, conflicting constraints, security, data-loss or money risk, plus any area the project adds. Check the model you're *actually* on before each such decision: tools silently fall back to a smaller model when quota runs out.
- **Decide high, execute low, never guess.** Below the required tier, escalate (how: escalation.md). The top model writes the decision down; lower tiers carry it out, never re-decide. A new decision point mid-execution → escalate again.
- **Can't escalate? Never decide below tier.** Hard to reverse → stop and queue it. Reversible → labeled DRAFT only (escalation.md).
- If the user has not chosen a model, pick the smallest available model that does the job well. Respect explicit choices and project model gates; never claim to change the main model yourself.
- **Prefer a cheaper capable tier.** A bounded same-tier helper may reduce latency or isolate context; state that purpose, never assume token savings. Every spawn gets a tight spec, targeted reads and a stop point (report back after ~30 calls). Native helpers stay under the parent ticket; persistent cross-tool work uses the shared backlog. Use only exposed model/effort controls; otherwise helpers inherit the model.

| Tool | Small (collect, verify) | Mid (implement) | Brain |
| :--- | :--- | :--- | :--- |
| Claude Code | `Explore` / `verifier` (haiku) | `worker` (sonnet) | main session (opus) |
| Antigravity | `research` / `flash_lite` where available | inline when main is Flash; `flash` worker under a Pro main | main session, only on an actually top-ranked model |
| Codex | available native helper; inherits model unless an override is supported | bounded worker with disjoint files or read-only scope | main session, only on an actually top-ranked model |

Agent choice across tools, task specs, handoff: `model-orchestrator`.

## 2. Bounded tool use
- Read targeted line ranges, not whole files. Never read lockfiles, `*.map`, binaries, or build output (`dist/`, `build/`, `out/`, `node_modules/`).
- Cap noisy output at the source (`| head -n 30`, `| Select-Object -First 30`, `--quiet` / `-q`).

## 3. Concise replies
Show diffs, short snippets, or links to changed lines; never echo whole files.

## 4. Checkpoint and naming
About 20+ turns with heavy tool output, or right after a milestone: checkpoint with `context-compressor` and start fresh (prefer it over `/compact`).
Once you know the task, rename the session `<HHMM>-<ID> <short task>` (local 24h, ticket ID if any), e.g. `1930-PET-07 fox mask redo`.
