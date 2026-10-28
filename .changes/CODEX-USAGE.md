---
bump: minor
title: Observe scoped Codex counters and qualify token report conclusions
---

# Codex usage observations

**Changes**

Adds a dependency-free, read-only streamed Codex metadata adapter and separate JSON/report section. Cumulative snapshots are deduplicated by session identity and observation, scoped by exact normalized cwd and event time, and compared with a pre-window baseline. Unknown values remain null; questionable history excludes uncertain increments and reports partial coverage. Model/effort configurations and main/worker/guardian/unknown role counts remain separate. Old damaged sessions retain diagnostics without inflating current-window counts.

**Why**

Codex activity was absent from token reports, while missing Claude telemetry produced zero-dollar and no-delegation conclusions. The report now suppresses those conclusions and removes quota-duration conversion. Readable Antigravity storage with no matching project/window usage also reports unavailable cost, overhead and delegation conclusions, preserving skipped-source diagnostics. Legacy CSV positions remain stable, with absent Claude and unobserved Antigravity numeric values blank. Existing price calculations are labeled modeled historical-price counterfactuals. Parent/worker overlap, unique task totals, billing and quota savings remain unknown.

**Measure**

Synthetic adapter and CLI fixtures verify deltas, duplicate/conflicting origin evidence, metadata conflicts, ordering, missing fields, exact cwd/window scope, role counts and content exclusion. All CLI profiles are fixture-local. Mixed Claude/Codex fixtures retain known modeled Claude prices and CSV numeric values while exposing Codex workers. Synthetic Antigravity SQLite/protobuf fixtures cover empty, unrelated, pre-window and corrupt sources, known modeled prices and observed zero usage. Existing modelAuthority/modelTier tests continue to pass. The JSON includes event-time bounds for independent reconciliation of per-session counters; observed coverage does not establish complete task coverage or savings.
