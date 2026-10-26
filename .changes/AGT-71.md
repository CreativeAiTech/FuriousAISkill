---
bump: minor
title: Add a model-aware Codex seat to the shared orchestrator
---
**Changes**
- Codex can act as a peer architecture, debugging, implementation and review brain when its actual model ranks top; existing project ownership and art routes still apply.
- Rank the user-approved exact model ID `^gpt-6$` as top in the kit table and built-in fallback; other GPT names remain unranked unless separately registered.
- Distinguish native helpers under the parent ticket from persistent cross-tool handoffs. Prefer cheaper capable workers while allowing bounded same-tier work for latency/context isolation without assumed savings.
- Document native Codex source-skill discovery and the limits of portable hooks/measurements; remove fixed cold-start and quota-multiplier claims from orchestration guidance.

**Why**: Crownspire onboarding exposed a model gate for its user-approved Codex brain and Claude-only routing in the shared skill. The integration uses existing canonical sources rather than creating a second Codex rule tree.

**Measure**: exact `gpt-6` ranks top; `gpt-6-mini` stays small and unregistered suffixed variants stay unranked. Inspect a Codex native-helper task for retained parent ownership, an existing Claude ticket for unchanged ownership, and a pet-art request for the project-selected route. Use actual environment measurements for token/latency claims. Parent verification is recorded separately; this fragment does not assert that those checks have run.
