# Escalation and fallback mechanics

Keywords: escalate, escalation, stuck, permission, rights, brain, preferred brain, high risk, effort, max, quota, fallback, draft, qualification, reviewer, decision

Canonical policy: `~/.agents/skills/model-orchestrator/SKILL.md`. Every session remains manager; model fallback never blocks all work.

- Escalation request: name the uncertainty, failing evidence or domain risk, exact scope, required evidence and call/time/spend limit. Use the cheapest adequate actually available model and supported effort; never automatically choose the top model or max effort, and never escalate recursively without bounds. When to hand a step to a brain, and which one first: `model-orchestrator` § Qualification and action gates.
- Resolve actual model/effort and any applicable qualification (`model-orchestrator` § Qualification and action gates) before relying on authority. Do not promote authority from role, coarse rank or draft authorization.
- Use only tools the environment exposes; disclose inherited model/effort or unavailable cross-provider dispatch. Do not silently change the main model or global settings. Ask before substantial shared spending only when existing authorization does not cover it.
- If the qualified route is unavailable, report the missing action (not a session-wide model-switch/yes demand) and leave the work a labeled proposal. Review and pause rules: `model-orchestrator` § Review and integration.
