---
bump: patch
title: Register GPT worker tiers and explicit per-worker effort
---
**Changes**
- Exact native IDs: Astra top, Sol/Terra mid, Luna small; retain the user-approved gpt-6 top rank. Project and kit defaults agree; unfamiliar variants remain gated.
- Orchestrator names explicit model/effort routes and preserves parent responsibility for bounded lower-tier workers.
**Why**: user requested useful GPT mid/small delegation after Codex onboarding. Official model/subagent guidance and this host's exposed model list support the routes.
**Measure**: rank CLI for all registered IDs plus an unfamiliar suffix; native Luna read-only worker; syntax/typecheck and a model-aware review. No fixed cost-saving promise or main-model/config change.
