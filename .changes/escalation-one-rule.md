---
bump: patch
title: One home for the escalation rule; duplicates trimmed to pointers
---

**Changes**
- `skills/model-orchestrator/SKILL.md` § Qualification and action gates, **Escalate to a brain**, is the only statement of when, to whom and how far to escalate. It now also carries the request contents (failing evidence, exact scope, need, limit), the no-brain-reachable fallback and the no-self-qualification line. The second escalation paragraph is removed; § Delegate and execute points to the rule.
- `rules/topics/escalation.md` keeps only model/quota fallback mechanics. `model-authority.md` points to SKILL.md instead of restating who escalates to which tier, and the overkill column header says "only after a preferred brain failed". The trigger table routes escalation to model-orchestrator and quota fallback to `escalation.md`.

**Why**
Four files restated the rule and two disagreed (the authority reference let a brain jump to overkill for a hard call; the canonical rule requires a failed preferred brain first).

**Measure**
`grep -rniE "escalat" skills rules` shows one rule statement plus pointers; `node --test tools/*.test.mjs` passes.
