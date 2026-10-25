---
bump: minor
title: Context profile - per-project nudges from measured baseline
---
**Changes**
- New `tools/contextProfile.mjs`: measures the project's starting context (median baseline), heavy-turn growth (p90 per prompt), window and auto-compacts from its Claude Code transcripts (main checkout + worktrees, last 14 days); writes `~/.claude/hooks/state/context-profile/<slug>.json` and `.agents/reports/context-profile.md` (what the baseline is made of, project size, CONTEXT.md over the skill ceiling, 90-day baseline history).
- `context-watch.cjs`: soft/hard growth from the profile (hard = min(60k, 80% window − baseline − heavy turn); soft = min(30k, hard − heavy turn)); forced hard once the total reaches 80% window − heavy turn, whatever the growth; one-time note when a session starts 15%+ and 10k+ above the usual baseline; refreshes the profile once a day at startup (detached, ~0.2 s). No profile → 30k/60k as before; env overrides unchanged.
- Rules §4 + `context-compressor`: size the task against the growth budget first; no-hook tools checkpoint after 3 heavy turns; the profile flags CONTEXT.md over the ~1,500-word ceiling.

**Why**: growth-only thresholds can't see a rising baseline: at a 130k start the hard nudge would sit past auto-compact. Measured on Crownspire 2026-10-25: baseline ~77k (75-79k), of which ~69k is system prompt, tool schemas and skill list; heavy turn p90 ~22k.

**Measure**: `node tools/contextProfile.mjs` summary line; `node tools/contextAudit.mjs` (late nudges, compacts) after a week.
