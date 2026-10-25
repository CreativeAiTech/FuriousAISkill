---
bump: minor
title: Write-time rule lint - lean-rules checks on every rule edit
---
**Changes**
- New `hooks/rule-lint.mjs` (PostToolUse on Edit|Write|MultiEdit, registered in `hooks/claude-hooks.json`): after an edit to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` or any `.agents/rules/**` file it gives the agent one `rule-lint` warning line: always-on file over 1.5k est. tokens with no "Before you" table, topic file without `Keywords:`, line duplicated in another always-on file, trigger-table path that doesn't exist. Never blocks, fails open, no git spawn.
- New `tools/lib/ruleLint.mjs`: the lean-rules checks, shared with `contextHygiene.mjs` check h (which now imports them instead of its own copy).

**Why**: decision `2026-10-25-lean-rules` - the weekly hygiene audit finds rule bloat up to 7 days late; the lint catches it in the edit that adds it.

**Measure**: duplicated line in a test CLAUDE.md → one warning; clean edit → no output; ~90 ms wall per call (bare `node -e 0` ~61 ms). `contextHygiene.mjs` Lean rules section unchanged for the same input.
