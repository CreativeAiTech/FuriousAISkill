---
bump: minor
title: Verifier rechecks worker passes
---
**Changes**
- `skills/model-orchestrator/SKILL.md`, `agents/worker.md`: managers spawn `verifier` with the worker's exact `GATE: pass <command>` before integrating; workers must report the command they ran.
- `tools/tokenReport.mjs` (+ test): `gateLine` parses the GATE command; each verifier is attributed to the worker spawn whose command it reran, so Verifier-checked and False passes land on the right tier.

**Why**: Oct 28-30: Sonnet workers 18 pass / 0 fail, 0 verifier-checked, so the 95% was unconfirmed. Cost: a haiku verifier spawn is about $0.005 vs about $0.55-0.71 per Sonnet worker spawn (90-day and Oct 28-30 token reports), about 1%, so every pass is rechecked instead of a sample.

**Measure**: token report Routing outcomes: Verifier-checked per tier approaches Pass; False passes / Verifier-checked is the measured false-pass rate.
