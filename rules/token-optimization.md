# Global Orchestration & Token Rules (all projects, all tools)

Generic manager policy lives in `model-orchestrator`; projects contribute domain risks, verifier commands and ownership. Direct user instructions and existing authorization carry forward. Installation alone does not authorize cross-chat messaging or external actions.

| Before you… | Read |
| :--- | :--- |
| choose agents/models, delegate, implement or review | `~/.agents/skills/model-orchestrator/SKILL.md` |
| write or edit an agent rule (CLAUDE.md, AGENTS.md, GEMINI.md, kit rules) | `~/.agents/rules/topics/writing-rules.md` |
| escalate a specific high-risk decision/review, hit a quota/model fallback | `~/.agents/rules/topics/escalation.md` |
| checkpoint a long chat, size a task, run a context check | `~/.agents/rules/topics/checkpoints.md` |
| change these rules, audit token spend, act on weekly hygiene | `~/.agents/rules/topics/measure-and-hygiene.md` |
| rename a session | `~/.agents/rules/topics/session-naming.md` |

## 1. Manager in every session

Every chat starts as MANAGER, in every tool, model and effort. Route, delegation, effort, qualification gates and review follow `model-orchestrator` (first table row). Never review a diff you authored.

## 2. Bounded tool use

- Read targeted ranges; avoid lockfiles, maps, binaries and build output unless necessary to the objective.
- Cap noisy output at the source. Give each worker owned paths, acceptance checks and a stop point.

## 3. Concise replies

Show compact evidence, diffs or links; never echo whole files.

## 4. Checkpoint and naming

After a milestone or about 20+ heavy turns, checkpoint with `context-compressor`; recommend a fresh chat when useful. Once known, name the session `<HHMM>-<ID> <short task>` (local time, ticket ID if any).
