---
bump: minor
title: Model fallback gate - rank table, learn on first sight
---
**Changes**
- New `tools/modelTier.mjs`: ranks model ids (top / mid / small / unranked) from `<project>/.agents/model-ranks.json`, else the kit's `model-ranks.json`, else a built-in copy; keeps `.agents/QUOTA.md` (last model per tool). CLI `rank <model>` and `learn <model> --rank top|mid|small`: writes the user's answer for a new model into the table in use, commits it and pushes (project: per `push` mode; kit: its remote).
- New PreToolUse hook `hooks/model-check.mjs` (Bash/PowerShell/Edit/Write/NotebookEdit/Agent): once per session reads the real main-session model from the transcript; non-top → denies that one call with the stop-and-ask question (plus "top, mid or small?" for an unranked model). Subagents skipped, fails open.
- `baton.mjs --model <id>`: warning as the brief's first line, only tickets with `.agents/tasks/<ID>/spec.md` listed, "model not reported" notice without `--model` (not in `--hook` mode), quota line when a tool last ran a fallback.
- Opt-in per project: `"modelGate": true` in `.agents/baton.config.json`; off by default (the hook writes its marker and exits).

**Why**: Crownspire decision `.agents/decisions/2026-10-25-model-fallback-gate.md` (AGT-36 + rank-table amendment), ported as AGT-37. A weak model can skim rules, so the stop has to come from tooling. Learn on first sight instead of polling provider model lists: those give names, not strength, and need keys.

**Measure**: `node tools/modelTier.mjs rank <id>` per known id; scratch repo with `modelGate: true`: `baton.mjs --agent gemini --model gemini-3-flash` puts the warning first and lists only spec'd tickets; the hook denies the first call for a sonnet transcript and passes the second, subagent calls, gate-off projects and opus.
