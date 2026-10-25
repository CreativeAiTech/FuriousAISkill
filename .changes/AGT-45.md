---
bump: minor
title: Hygiene audit counts on-demand rule-file reads
---
**Changes**
- `tools/contextHygiene.mjs` check [g]: for each `<project>/.agents/rules/*.md`, counts Claude Code sessions (last 30 days) whose tool calls read it (Read/Grep/Glob, or a Bash/PowerShell `cat|head|tail|sed|grep|rg|less|wc|Get-Content|type` on the path; writes and paths quoted in baton text don't count). New "On-demand rule reads" table in `context-hygiene.md`; a finding for files unread for 30 days once they are 7+ days old (git add date, else file birth time).

**Why**: AGENTS.md now points to trigger files instead of inlining them (Crownspire decision `2026-10-25-rules-map-index`); the risk is agents skipping the pointer. Before this change `occasional.md` was the only on-demand file and was read in 3 of 63 sessions.

**Measure**: `node tools/contextHygiene.mjs --project <repo>`; on Crownspire 2026-10-25 the table shows occasional.md 3, handoff/routing/testing 0 (new, 0d old), no [g] finding. Antigravity reads aren't counted yet (only Claude Code transcripts are scanned).
