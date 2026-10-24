# Changelog

Kit version lives in `VERSION`; each skill also carries `metadata.version` in its frontmatter.
Every release that changes behavior records **why** (evidence) and **how it measured** afterwards, so the next change builds on data.

Measure with `node ~/.agents/tools/contextAudit.mjs --project <dir> --days 7` (per-version table, history in
`.agents/reports/context-audit-history.csv`) and `tokenReport.mjs` (trend CSV has a `kit_version` column).
Change one lever per release where possible, so a result can be pinned to its cause.

## 1.2.0 · 2026-10-24 · experimental task board (opt-in)

**Changes**
- tools/baton.mjs: file-based task board and handoff baton for several agents on one repo (brief, `--agent` view, `focus` with needs/tag guard, `log`, `claim`/`release`/`block`/`done` with renewable leases, `init`). Config in `<project>/.agents/baton.config.json` (paths, lease days, push mode, ticket ID pattern, agent names). Importable, with brief section hooks for project wrappers.
- skills/task-board (`metadata.status: experimental`) and hooks/auto-baton.cjs (records sessions that changed files without a baton).
- sync.mjs: experimental skills and hooks/experimental/<name>.json are synced only after `--enable <name>` (stored in gitignored local.json); `--disable`, `--list`.

**Why**: agents in parallel sessions and tools (Claude Code, Antigravity) took the same ticket and lost handoffs. Extracted from the Crownspire project, where it runs daily; no file-based, cross-tool, daemon-free alternative was found.

**Measure**: off by default, so no token effect unless enabled. When enabled: count collisions (two agents on one ticket) and `auto` baton entries per week in a project's STATE.md history.

## 1.1.1 · 2026-10-24 · task-named sessions

**Changes**
- rules/token-optimization.md §6: rename the session `C-<HHMM>-<ID> <task>` once the task is known.

**Why**: a bare "continue" left every session titled "Continue…", so the sidebar said nothing about the work.

**Measure**: none needed (naming only, no token effect).

## 1.1.0 · 2026-10-24 · context-watch thresholds and soft-nudge wording

**Changes**
- `context-watch` hook: SOFT 40k → 30k growth, HARD 80k → 60k, REPEAT 40k → 30k. Notes are tagged `[context-watch vX.Y.Z]` so audits attribute sessions to a version.
- Soft note can no longer be silently dropped: offer at this reply if it ends a task, else at the first later reply that does.
- `context-compressor` 1.1.0: drift trigger at any length (user re-explains / repeats a correction), claude.ai chat-mode guidance (turn proxy 20-25 soft, 40+ hard; auto-summarize is not a checkpoint), cited Evidence section.
- New `tools/contextAudit.mjs`; `tokenReport.mjs` records `kit_version`.

**Why (measured on 1.0.0, 10 Crownspire sessions with 5+ turns, 2026-10-24)**
- Nudges fired reliably: soft fired in 4/4 sessions that crossed it with turns left, always 1 turn after crossing; no repeats or false fires.
- Acted on in only 2/4 nudged sessions, 4-5 turns after the soft note. The "otherwise say nothing" wording made it easy to skip.
- Heavy turns (10-20 tool calls, 30-45k growth per turn) meant the 40k soft note arrived after the useful point; 2 sessions crossed HARD inside one turn and never got the hard note (detection lag).
- Waste past soft: $2.99 / 10 sessions (cache-read price); checkpointing at soft would have saved ~$2.1 net, ~$0.50 per session that crosses soft with 35+ calls left. On a Pro plan the real cost is usage-limit quota, not dollars.
- Fixed baseline ~75-77k per session (system prompt, tools, rules) before the first message.

**Evidence used:** Laban et al. 2025 (multi-turn drift −39%, consolidate-and-restart recovers most of it), Chroma "Context Rot" 2025 and NoLiMa 2025 (gradual degradation with length, no cliff), Claude Code costs docs and Anthropic context-engineering post (full resend each turn; `/clear` free, `/compact` costly). Links in `skills/context-compressor/SKILL.md`.

**Expected / check at next audit (≥3 days of use)**
- Acted-on rate up from 50%; median turns from soft note to checkpoint down from 4-5.
- Waste past soft per session down vs $0.30 (1.0.0).
- Lag misses (crossed HARD with no hard note) will remain: that is 1.2.0's lever.

**Next candidate (1.2.0):** mid-turn detection (PostToolUse or Stop check on context growth, tail-reading the transcript), only after 1.1.0 has been measured.

## 1.0.0 · 2026-10-23 · baseline

Initial kit: skills (`model-orchestrator`, `context-compressor`), rules, subagents, `context-watch` hook (SOFT 40k / HARD 80k growth), token report.
