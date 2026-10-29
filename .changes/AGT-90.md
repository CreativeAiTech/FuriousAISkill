---
bump: patch
title: Dedupe manager rules to pointers; tier words; link and citation fixes
---
**Changes**
- `rules/token-optimization.md` §1 shrunk to 3 lines of core; route, delegation, effort and review point to `model-orchestrator`. `rules/topics/escalation.md` keeps only mechanics (request format, fallback), no restated policy.
- `skills/model-orchestrator/SKILL.md` 1.7.1: "top model or max effort" instead of model names; escalation link is now the absolute kit path (the relative link broke in synced copies). `assets/min-tier.template.md` cites `§ Qualification and action gates` (Step 4 no longer exists) and uses top/mid/small tier words.
- `skills/task-board/SKILL.md`: "Project wrapper" note (a project's own CLI and overlay skill owns project-only commands); triggers narrowed to repos without a wrapper skill.
- `rules/topics/writing-rules.md`: the decision path is labeled as a Crownspire repo path.
- README lists `contextAudit.mjs`.

**Why**: AGT-90, one canonical home per rule; the same policy text sat in the managed block, escalation.md and the skill.

**Measure**: `token-optimization.md` 3170 -> 1794 chars (~793 -> ~449 tokens); `node --test tools/*.test.mjs` 76/76 pass.
