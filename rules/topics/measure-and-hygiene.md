# Measure token spend and weekly hygiene

Keywords: tokens, token report, tokenReport, measure, hygiene, contextHygiene, bloat, savings, wasteful spawns, delegation cost, same tier

## Why (measured history)
- 2026-10: Flash `self` workers under a Flash main cost +25% vs inline; Flash-Lite `research` saved 80%. A worker on the main session's price tier adds a cold start and grows its own context, so it cannot save money. That is why core says: delegate only to a cheaper tier.

## Measure, don't guess
`node ~/.agents/tools/tokenReport.mjs --summary` (Claude Code; refreshes daily at session start) writes `.agents/reports/token-report.md`: kit overhead vs delegation savings, wasteful spawns, oversized tool results, late checkpoints. Check it before changing the token rules.

## Weekly hygiene check
- `tools/contextHygiene.mjs` audits what bloats the always-loaded starting context: big or fast-growing rule files, duplicate skills and hooks, a long CONTEXT.md header, oversized BACKLOG/STATE, and the first-turn baseline trend.
- context-watch runs it at the first startup session in a project, then every 7 days, and shows one summary line. Report: `<project>/.agents/reports/context-hygiene.md` (est. tokens, Top 3 savings).
- Fixes that turn something off (plugins, connectors, skills, hooks) need the user's yes; never apply them silently.
