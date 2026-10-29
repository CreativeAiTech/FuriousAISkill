---
bump: minor
title: Single-task phase subagents and completion gate (bounded → integrate, critical → brain)
---
**Changes**
- `skills/model-orchestrator/SKILL.md` 1.6.0: a substantive phase (research, implement, test) may run in its own subagent, replacing the blanket "do not spawn one agent per phase"; small or same-context phases still batch in one worker.
- New "Completion gate" section: before an MR or merge the manager classifies the diff. Bounded → manager reviews the child-authored diff and integrates under existing authorization. Critical → automatic qualified brain review with an evidence dossier, or an unmerged branch plus persistent review handoff when no dispatcher works. Brain picks approve, split into a separate task, or decide-and-hand-back.

**Why**: user decision 2026-10-29 (Crownspire `.agents/decisions/2026-10-29-universal-manager-single-task-loop-and-brain-escalation.md`): managers kept full phase output in the parent context, and nothing said when a manager may integrate its own task versus escalate.

**Measure**: next `contextAudit.mjs --days 7` / `tokenReport.mjs` - parent-session prompt growth per task should drop on tasks that used phase subagents; count of critical-area merges without a brain review line in `audit-log.md` stays 0.
