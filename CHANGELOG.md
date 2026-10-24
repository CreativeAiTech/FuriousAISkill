# Changelog

Kit version lives in `VERSION`; each skill also carries `metadata.version` in its frontmatter.
Every release that changes behavior records **why** (evidence) and **how it measured** afterwards, so the next change builds on data.

Measure with `node ~/.agents/tools/contextAudit.mjs --project <dir> --days 7` (per-version table, history in
`.agents/reports/context-audit-history.csv`) and `tokenReport.mjs` (trend CSV has a `kit_version` column).
Change one lever per release where possible, so a result can be pinned to its cause.

## 1.5.0 · 2026-10-25 · routing outcome instrument (GATE lines)

**Changes**
- agents/worker.md, agents/verifier.md: the reply ends with one machine-readable line, `GATE: pass|fail|none <command>` (worker) or `GATE: pass|fail <commands>` (verifier).
- tools/tokenReport.mjs: new `## Routing outcomes` section after `## Delegation`: per-tier gated spawns, pass/fail, pass rate (shown at n >= 10), verifier-checked and false passes, GATE coverage, mid-session rule edits. `--summary` gains `routing <tier> <pass>/<n>`.

**Why**: AGT-24: escalation must follow the gate; we had no per-tier pass data.

**Measure**: after >=10 gated spawns: per-tier pass rate, false passes, coverage, mid-session rule edits (baseline for 1.7.0).

## 1.4.0 · 2026-10-24 · task board: parallel branches merge without conflicts

**Changes**
- tools/batonMerge.mjs: git merge driver for STATE.md / BACKLOG.md. Log: union of new entries, rotation kept, trimmed to
  the cap. Focus: one block, ours on a both-sides edit. Tickets: per ID, the more advanced box wins, each ticket once (under
  Done when `[x]`). Anything else falls back to git's normal merge (markers, exit 1).
- tools/baton.mjs: registers `merge.baton.driver` when unset (every command); `init` adds `<file> merge=baton` lines to
  `.gitattributes`.

**Why**: 3 parallel sessions merged into master one at a time conflicted in both files on every merge (log insert/rotate
and the `done` move hit the same spots). Decision note: Crownspire `.agents/decisions/2026-10-24-baton-merge-driver.md`.

**Measure**: Crownspire `node tools/batonMergeProof.mjs` (control conflicts, driver run clean). In use: manual baton merge
fixes per week (target 0).

## 1.3.0 · 2026-10-24 · experimental Grok MCP bridge at user scope (opt-in)

**Changes**
- mcp/grok-bridge/ (server.mjs, models.mjs, usage.mjs): zero-dependency stdio MCP server (plain `fetch` to api.x.ai) with `grok_completion`, `grok_review_code`, `grok_get_budget`, same schemas and model routing as Crownspire's bridge. Key lookup: env, then project `.env.local`/`.env`, then `~/.agents/.env`; one machine-wide ledger at `~/.agents/state/grok-budget.json`.
- sync.mjs: `mcp/experimental/<name>.json` manifests are features too; `syncMcp()` merges enabled ones into `~/.claude.json` `mcpServers` (managed entries only, re-read before write, atomic, only when changed) and removes them on `--disable`.
- .gitignore: `.env*`, `state/`.

**Why**: the bridge lived only in Crownspire's `.mcp.json`, so other projects could not call Grok. Decision note: Crownspire `.agents/decisions/2026-10-24-grok-bridge-user-scope.md`.

**Measure**: off by default. When enabled, `grok_get_budget` shows spend across all projects in one ledger.

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

**Measured (2026-10-24, `contextAudit.mjs --days 7`, 13 Crownspire sessions)**
- 1.0.0 re-measured on 11 sessions: 5 nudged, acted 40%, median 4.5 turns to checkpoint, $0.33/session, 2 lag misses (matches the baseline above).
- 1.1.x so far: only 2 sessions (1.1.1, 1.3.0), both nudged and both acted on, 2 turns to checkpoint, 0 lag misses. Waste $2.25 (153 calls in 6 turns, ~25 calls/turn) and $0.09. n=2: directionally good, not statistically meaningful. Since 1.1.0 is only a few hours old on a single day, most sessions in the window still ran 1.0.0.
- Residual risk: heavy turns still dominate cost. The 1.1.1 session paid $2.25 despite a fast response because soft (turn 3) to hard (turn 5) growth happened inside very long turns.
- **1.2.0 verdict (recommendation only):** not yet. Lag misses are 0/2 on 1.1.x, and the nudge reaches the user within 2 turns. Mid-turn detection only pays for sessions with 25+ calls per turn; re-audit after about 10 sessions on 1.1.x (a few more days). Build 1.2.0 only if lag misses or waste above $1/session recur there.

**Next candidate (1.2.0):** mid-turn detection (PostToolUse or Stop check on context growth, tail-reading the transcript), only after 1.1.0 has been measured.

## 1.0.0 · 2026-10-23 · baseline

Initial kit: skills (`model-orchestrator`, `context-compressor`), rules, subagents, `context-watch` hook (SOFT 40k / HARD 80k growth), token report.
