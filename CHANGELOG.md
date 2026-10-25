# Changelog

Kit version lives in `VERSION`; each skill also carries `metadata.version` in its frontmatter.
Every release that changes behavior records **why** (evidence) and **how it measured** afterwards, so the next change builds on data.

Measure with `node ~/.agents/tools/contextAudit.mjs --project <dir> --days 7` (per-version table, history in
`.agents/reports/context-audit-history.csv`) and `tokenReport.mjs` (trend CSV has a `kit_version` column).
Change one lever per release where possible, so a result can be pinned to its cause.
Releases are numbered at ship time by `node tools/release.mjs` from `.changes/<TICKET>.md` fragments; feature commits never edit `VERSION` or `CHANGELOG.md` directly.

## Unreleased · Token hygiene audit

**Changes**
- New `tools/contextHygiene.mjs`: weekly audit of the always-loaded starting context (rule files over 3k est. tokens or grown >20%, duplicate skills and hooks, CONTEXT.md header length, oversized BACKLOG/STATE, first-turn baseline trend); writes `.agents/reports/context-hygiene.md` with a Top 3 savings list, state in `~/.claude/hooks/state/context-hygiene/`.
- `hooks/context-watch.cjs`: runs it on startup when never run or 7+ days old and appends its summary line; caps the injected CONTEXT.md header at 200 chars.
- `rules/token-optimization.md`: "Weekly hygiene check" section.

**Why**: a project's CONTEXT.md header was ~1,500 chars injected every session, and duplicate skills/hooks went unnoticed. Measure after: first-turn baseline median in the next report.

## 1.8.0 · 2026-10-25 · Model fallback gate - rank table, learn on first sight + Context profile - per-project nudges from measured baseline + Session title C- prefix only for real resumes

**Changes**
- New `tools/modelTier.mjs`: ranks model ids (top / mid / small / unranked) from `<project>/.agents/model-ranks.json`, else the kit's `model-ranks.json`, else a built-in copy; keeps `.agents/QUOTA.md` (last model per tool). CLI `rank <model>` and `learn <model> --rank top|mid|small`: writes the user's answer for a new model into the table in use, commits it and pushes (project: per `push` mode; kit: its remote).
- New PreToolUse hook `hooks/model-check.mjs` (Bash/PowerShell/Edit/Write/NotebookEdit/Agent): once per session reads the real main-session model from the transcript; non-top → denies that one call with the stop-and-ask question (plus "top, mid or small?" for an unranked model). Subagents skipped, fails open.
- `baton.mjs --model <id>`: warning as the brief's first line, only tickets with `.agents/tasks/<ID>/spec.md` listed, "model not reported" notice without `--model` (not in `--hook` mode), quota line when a tool last ran a fallback.
- Opt-in per project: `"modelGate": true` in `.agents/baton.config.json`; off by default (the hook writes its marker and exits).

**Why**: Crownspire decision `.agents/decisions/2026-10-25-model-fallback-gate.md` (AGT-36 + rank-table amendment), ported as AGT-37. A weak model can skim rules, so the stop has to come from tooling. Learn on first sight instead of polling provider model lists: those give names, not strength, and need keys.

**Measure**: `node tools/modelTier.mjs rank <id>` per known id; scratch repo with `modelGate: true`: `baton.mjs --agent gemini --model gemini-3-flash` puts the warning first and lists only spec'd tickets; the hook denies the first call for a sonnet transcript and passes the second, subagent calls, gate-off projects and opus.

**Changes**
- New `tools/contextProfile.mjs`: measures the project's starting context (median baseline), heavy-turn growth (p90 per prompt), window and auto-compacts from its Claude Code transcripts (main checkout + worktrees, last 14 days); writes `~/.claude/hooks/state/context-profile/<slug>.json` and `.agents/reports/context-profile.md` (what the baseline is made of, project size, CONTEXT.md over the skill ceiling, 90-day baseline history).
- `context-watch.cjs`: soft/hard growth from the profile (hard = min(60k, 80% window − baseline − heavy turn); soft = min(30k, hard − heavy turn)); forced hard once the total reaches 80% window − heavy turn, whatever the growth; one-time note when a session starts 15%+ and 10k+ above the usual baseline; refreshes the profile once a day at startup (detached, ~0.2 s). No profile → 30k/60k as before; env overrides unchanged.
- Rules §4 + `context-compressor`: size the task against the growth budget first; no-hook tools checkpoint after 3 heavy turns; the profile flags CONTEXT.md over the ~1,500-word ceiling.

**Why**: growth-only thresholds can't see a rising baseline: at a 130k start the hard nudge would sit past auto-compact. Measured on Crownspire 2026-10-25: baseline ~77k (75-79k), of which ~69k is system prompt, tool schemas and skill list; heavy turn p90 ~22k.

**Measure**: `node tools/contextProfile.mjs` summary line; `node tools/contextAudit.mjs` (late nudges, compacts) after a week.

**Changes**
- Rule §6: `C-` marks a session that picks up unfinished work from an earlier one, including the same task moved to a fresh chat after a context checkpoint. "Continue" that starts a fresh ticket (next backlog pick, another agent's `needs-review`, idle focus) gets a plain title.

**Why**: user 2026-10-25: every "continue" got `C-`, so the prefix no longer told resumed work apart from new tasks.

**Measure**: new session titles carry `C-` only when the brief showed your own `in-progress`/`blocked` focus.

## 1.7.0 · 2026-10-25 · Kit tools/release.mjs + .changes/ fragments

**Changes**
- tools/release.mjs: ships kit releases at ship time from .changes/ fragments (zero deps, pull -> bump from fragments -> VERSION + CHANGELOG section -> commit + annotated tag -> one atomic push of branch + tag; full undo on commit or push failure; --dry-run).
- .changes/: release note fragments added by feature commits; .changes/README.md documents the format and keeps the folder alive after a release.
- README.md & CHANGELOG.md: documented fragment release workflow.
- Backfilled annotated tags v1.1.1 through v1.6.3 matching VERSION history.

**Why**: Decision 2026-10-25-kit-version-at-ship-time.md. Kit versions assigned at ship time avoid number collisions between parallel sessions.

**Measure**: --dry-run on the kit; scratch bare-origin test: success pushes commit + tag together, a rejected push restores fragments/VERSION/CHANGELOG with no tag, a diverged pull aborts untouched.

## 1.6.3 · 2026-10-25 · decision notes get a Ripple sweep

**Changes**
- model-orchestrator 1.1.0 `assets/decision-note.template.md`: `dropped` Status value; executors read Status/Outcome before
  starting a ticket that cites the note; new `## Ripple` section (search notes, open tickets, checkpoint, skills; fix old
  Status lines, close or rescope dependent tickets, list touched paths, no "still fine for X" side doors).
- model-orchestrator SKILL.md: "Write the decision down" names Ripple and the executor check.

**Why**: Crownspire 2026-10-25. AGT-30 dropped Repomix but left a side door and stale "YES" Status lines; a queued ticket
(AGT-31) then added Repomix back to a skill. User: clean it up and make sure it can't happen again.

**Measure**: next audit, no ticket closed against a note whose Status is superseded/dropped; notes that drop something carry a
filled Ripple line.

## 1.6.2 · 2026-10-25 · checkpoint only when something is unsaved

**Changes**
- hooks/context-watch.cjs: soft/hard notes check git (`status --porcelain`, commits ahead of upstream or `origin/HEAD`/`origin/master`).
  Clean and pushed → no CONTEXT.md/baton rewrite, just one line "task finished and saved in git, open a fresh chat"
  (systemMessage: "Work is in git: open a fresh chat."). Dirty, unpushed or git unknown → checkpoint as before.
- skills/context-compressor 1.2.0: "Nothing left to save" bullet matching the hook.

**Why**: user request. Checkpoints after a finished, pushed task duplicated git history and spent a turn on it.

**Measure**: tested on fake transcripts (clean worktree → fresh-chat line; dirty repo → checkpoint). Next audit: hard-level turns
that write CONTEXT.md should fall when the tree is clean.

## 1.6.1 · 2026-10-25 · drop the Repomix lookup bullet (AGT-30 measured: no gain)

**Changes**
- rules/token-optimization.md §2: removed the "Unknown location → repomix" bullet. README bullet removed. The
  `repomix calls` counter in tokenReport stays (cheap, shows if anyone still runs it).

**Why**: 1.6.0 Measure below failed both keep conditions.

## 1.6.0 · 2026-10-25 · repo map: pinned Repomix for folder lookups

**Changes**
- rules/token-optimization.md §2: unknown location / "what's in this folder" bullet pointing to `npx --yes repomix@1.18.1 --compress --remove-comments --remove-empty-lines --ignore "**/__tests__/**,**/*.test.*" --include "<folder>/**" --stdout` on narrowest folder.
- tools/tokenReport.mjs: counts `repomix calls: N` in `## Delegation` (real `npx … repomix@` runs only, not commands that merely mention it).
- README.md: noted in What's inside.

**Why**: AGT-25 / decision `2026-10-24-repomix-replaces-repomap.md`: pack small folders into signatures (~1.4k tokens) without maintaining a custom export mapper or indexing server. Pinned version with usage limits (local only, no remote/mcp).

**Measure**: AGT-30 keep/drop trial (5 lookups, Haiku Explore with/without; keep if <=90% tokens and no worse answers).

Result (2026-10-25, Crownspire, Haiku Explore, 1 run per cell; tokens = input+cache read+cache write+output from the
subagent transcripts; "cost" weights cache read 0.1, cache write 1.25, output 5 vs input 1):

| Lookup | Tools w/o → with | Tokens w/o → with | Cost-wtd w/o → with | Sec w/o → with | Answer |
| :-- | :-: | --: | --: | :-: | :-- |
| 1 shield absorb | 7 → 4 | 853k → 450k | 264k → 102k | 16 → 17 | **worse**: compress hid the body, missed the absorb step in `calculateDamage` |
| 2 skeleton exports | 3 → 1 | 271k → 193k | 107k → 105k | 19 → 18 | **worse**: compress drops `export const`s and showed the barrel `index.ts` as empty |
| 3 inventory persist | 4 → 3 | 339k → 361k | 94k → 96k | 8 → 13 | same (needed Grep for `name:` anyway) |
| 4 pet registry | 4 → 5 | 293k → 485k | 90k → 103k | 8 → 16 | same |
| 5 Grok model resolve | 3 → 5 | 253k → 492k | 70k → 107k | 7 → 16 | same |
| **Total** | 21 → 18 | 2.01M → 1.98M (**98.6%**) | 624k → 513k (82%; 114% without lookup 1) | 58 → 80 | 2 worse, 3 same |

Verdict: **drop** (tokens > 90% and two answers worse). Grep already finds names in 3-4 calls here; the pack adds a
~1.5k-token call plus follow-up Greps, and `--compress` loses exactly what lookups need (bodies, consts, re-exports).
Repomix stays fine for pasting a folder to a model without repo access (Grok). dependency-cruiser: no (no lookup failed
for lack of import info).

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
