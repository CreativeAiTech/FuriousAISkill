---
bump: minor
title: Tool-agnostic manager route; child-diff review is independent
---
**Changes**
- `skills/model-orchestrator/SKILL.md` 1.7.0: the route is the same in every tool, model and effort. The manager only coordinates and spot-checks; discovery, implementation and checks go to delegates, with no "files are small" or "cheaper than a delegate" exception. Where the tool cannot spawn delegates, the fallback is a persistent handoff or ticket, or bounded self-execution, never self-review.
- Review: a manager's review of its own child's diff counts as independent (different author). A higher-tier reviewer is needed only for a manager-authored critical diff or an unqualified rank; auditing another agent's closed work stays a separate gate.
- `rules/token-optimization.md` §1 tightened to match (synced into Claude/Codex/Gemini copies).

**Why**: user decision 2026-10-29 (Crownspire `.agents/decisions/2026-10-29-universal-manager-single-task-loop-and-brain-escalation.md`, Amendment): managers were solo-grinding "small" work and defaulting to a top-tier reviewer.

**Measure**: next `contextAudit.mjs --days 7` - fewer parent-session tool calls per task on discovery/edit work; count of top-tier review spawns for bounded diffs stays 0.
