# Global Orchestration & Token Rules (all projects, all tools)

Generic manager policy lives in `model-orchestrator`; projects contribute domain risks, verifier commands and ownership. Direct user instructions and existing authorization carry forward. Installation alone does not authorize cross-chat messaging or external actions.

| Before you… | Read |
| :--- | :--- |
| choose agents/models, delegate, implement or review, escalate (stuck, missing rights) | `~/.agents/skills/model-orchestrator/SKILL.md` |
| write or edit an agent rule (CLAUDE.md, AGENTS.md, GEMINI.md, kit rules) | `~/.agents/rules/topics/writing-rules.md` |
| hit a quota or model fallback (model unavailable) | `~/.agents/rules/topics/escalation.md` |
| checkpoint a long chat, size a task, run a context check | `~/.agents/rules/topics/checkpoints.md` |
| change these rules, audit token spend, act on weekly hygiene | `~/.agents/rules/topics/measure-and-hygiene.md` |
| rename a session | `~/.agents/rules/topics/session-naming.md` |
| add or change a hook (hook, guard, PreToolUse, block, settings.json hooks) | `~/.agents/rules/topics/hooks.md` |

## 1. Manager in every session

Every chat starts as MANAGER, in every tool, model and effort. Route, delegation, effort, qualification gates and review follow `model-orchestrator` (first table row). Never review a diff you authored.

## 2. Bounded tool use

- Read targeted ranges; avoid lockfiles, maps, binaries and build output unless necessary to the objective.
- Cap noisy output at the source. Give each worker owned paths, acceptance checks and a stop point.
- Searches, multi-file reads and diff comparisons go to a cheap read-only search subagent; check/test runs go to a cheap check runner (Claude Code: `explorer` / `verifier`; Codex: a native subagent). The manager makes at most ~2 discovery calls itself, only to spot-check a delegate's claim.
- Give these delegates the cheapest model and low effort (Claude Code: pass `model`/`effort` on the Agent call; this line is the explicit instruction it needs).

## 3. Concise replies

Show compact evidence, diffs or links; never echo whole files.

## 4. Checkpoint and naming

After a milestone or about 20+ heavy turns, write the baton and recommend a fresh chat (Antigravity: when `agContext.mjs` prints `checkpoint`). Once known, name the session `[<RANK>] <ID> <short task>` (rank and ticket ID if any).
