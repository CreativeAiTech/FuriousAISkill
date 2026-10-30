# FuriousAISkill

**Run Claude Code, Gemini (Antigravity), Codex and other AI agents on one repo, cheaply and without them stepping on each other.**
No server, no database: just markdown rules, a few small Node scripts, and git.

If you use more than one AI coding agent (or several sessions of the same one), you have probably seen this:
two agents grab the same task, one overwrites the other's work, the next session forgets what the last one decided,
and the expensive model burns quota on file searches a cheap one could do. This kit is one person's answer to that,
used daily on a real game project.

**What's inside**
- **Orchestration rules** (`rules/token-optimization.md`, `model-orchestrator` skill): every session manages its bounded objective,
  chooses economical available models/efforts and delegates cohesive work. Qualification gates specific high-risk decisions and final approval.
- **Task board** (`task-board` skill, `tools/baton.mjs`, experimental, opt-in): tickets with claims and leases, a handoff
  "baton" each session writes before it stops, and a brief the next agent reads first. `git push` is the lock.
- **Token report** (`tools/tokenReport.mjs`): observed usage, telemetry coverage, and modeled price comparisons.

`sync.mjs` maintains Claude Code (`~/.claude`) and Antigravity (`~/.gemini`) copies plus a managed Codex policy block (`~/.codex/AGENTS.md`). Codex discovers canonical skills directly in `~/.agents/skills` and project `.agents/skills`; no additional skill copy is needed.
Status: personal kit, shared as-is. MIT licensed, issues welcome.

## Install

```
git clone https://github.com/CreativeAiTech/FuriousAISkill.git ~/.agents
node ~/.agents/sync.mjs
```

Tip: a project can run this from its install script (clone if missing, fast-forward when clean, then sync) so every machine stays current.

`sync.mjs` generates these integrations:

| Source | Claude Code | Antigravity |
| :--- | :--- | :--- |
| `skills/<name>/` | `~/.claude/skills/<name>/` | `~/.gemini/config/skills/<name>/` |
| `rules/*.md` (always on) | managed block in `~/.claude/CLAUDE.md` | `~/.gemini/config/rules/<file>` |
| `agents/*.md` (subagents, pinned models) | `~/.claude/agents/<file>` | none (uses its built-in subagents) |
| `hooks/claude-hooks.json` (hook manifest) | `hooks` in `~/.claude/settings.json` (managed entries only) | none |

Codex receives the canonical `rules/token-optimization.md` in a managed block in `~/.codex/AGENTS.md`; content outside the block is preserved. `node ~/.agents/sync.mjs --policy-only` updates skills/rules and that block, skipping agent definitions, hook registration, settings and MCP. To validate without writing to the real home, use `node ./sync.mjs --policy-only --target-home <absolute-fixture-dir>`. This target option redirects generated destinations only; experimental source opt-ins remain local to the kit and cannot be changed with policy-only mode.

Generated copies are marked. Sync removes stale generated copies and never touches hand-written files.
Projects layer their own specifics on top (e.g. Etherium's `AGENTS.md` and `.agents/skills/`), and project rules win.

**Codex:** use source skills from `~/.agents/skills` and project skills from `.agents/skills` ([official skills documentation](https://learn.chatgpt.com/guides/best-practices)). The global managed AGENTS.md block supplies manager startup guidance and points to the canonical skill. Sync does not install Codex configuration or hooks. Claude-specific hooks, agent definitions, transcript metrics and automatic startup reports do not become Codex features; run applicable commands explicitly and report actual results. Other hosts/providers need an explicit integration consuming the canonical policy; listed models are not dispatch promises.

## Benchmark-based model authority

The reusable policy and sourced comparison are in [model authority](skills/model-orchestrator/references/model-authority.md). Each model/effort pair is scored independently against the same benchmark version. The benchmark route requires the exact listed effort to score at least the frozen bar of 49.3 points (85% of the 58-point leader on AA v4.3.2); the score alone decides, with no effort floor and no expiry, and `default` or unreported efforts never qualify. An explicit reviewed qualification can instead grant judgment for an exact project/task/configuration/risk; it does not promote a model globally. Every session manages independently of this gate; unknown/lower configurations can research and execute authorized prepared low-risk scope, while ambiguous high-risk decisions/final approval need applicable evidence. The 0–100 relative index is not IQ. Supported efforts, sourced API prices and cost per accepted task are described in [model economics](skills/model-orchestrator/references/model-economics.md). `node tools/modelValue.mjs <scenario.json>` compares offline workflow prices; it does not dispatch models or predict quota.

```sh
node tools/modelAuthority.mjs check claude-opus-5-5 --effort medium
node tools/modelAuthority.mjs check gemini-3.8-flash --effort high
node tools/modelAuthority.mjs gpt-6-astra --effort max
node --test tools/modelAuthority.test.mjs tools/modelTier.test.mjs
```

The checker exits 0 for an eligible pair, 2 for a non-eligible pair and 1 for usage/read errors. `check` prints the brain verdict, code name, preferred/overkill tier and derived permissions (preferred and overkill brains per tool are in `model-ranks.json`; a listing never grants brain status). The model advisory never blocks startup and does not establish effort; it is not a security boundary or a push hook. Verify actual model/effort/configuration before a qualified ruling. No rank authorizes publishing.

Project `.agents/model-ranks.json` overrides must include current `authority` evidence as well as coarse ranks; legacy rank-only overrides no longer grant brain authority. Copy the kit table to start, preserve the global leader denominator, and record sources for new exact entries. Registry keys are not guaranteed endpoint IDs; resolve aliases explicitly.

## Updating

Edit in `~/.agents`, run `node ~/.agents/sync.mjs`, then commit and push. Other machines pick it up on the next `yarn install`.
For behavior changes, add a fragment `.changes/<TICKET>.md` (`bump: minor|patch|major`, `title: ...`, `**Changes**`, `**Why**`, `**Measure**`); feature commits never touch `VERSION` or `CHANGELOG.md`. Run `node tools/release.mjs` to ship.

| Item | Owns |
| :--- | :--- |
| `rules/token-optimization.md` | Lean context, generic lifecycle, bounded tool use, checkpoint trigger |
| `skills/model-orchestrator` | Universal manager role; economical provider-neutral model/effort routing, bounded delegation, action-specific qualification, independent exact-revision review, task specs and handoffs. Templates in `assets/` (task spec, decision note, project min-tier table) |
| `tools/agContext.mjs` | Antigravity context meter (Antigravity has no native compaction): measured prompt growth of the newest chat vs this project's budget; prints `checkpoint` when a fresh chat is due |
| `tools/contextHygiene.mjs` | Token hygiene audit: flags what bloats the always-loaded context (big/growing rule files, duplicate skills and hooks, long CONTEXT.md header, oversized backlog), runs on the first session and then weekly from session-watch, report at `.agents/reports/context-hygiene.md` |
| `hooks/rule-lint.mjs` + `tools/lib/ruleLint.mjs` | Write-time rule lint (Claude Code): after an edit to CLAUDE.md, AGENTS.md, GEMINI.md or `.agents/rules/**`, one warning line for a big file with no "Before you" table, a topic file without `Keywords:`, a line duplicated in another always-on file, or a missing trigger-table path; never blocks |
| `tools/modelTier.mjs` + `tools/modelAuthority.mjs` + `hooks/model-check.mjs` | Manager action-scope advisory (`"modelGate": true` opts into reported configuration evidence): no startup tool denial or rank-based ticket hiding. Legacy tier exports/QUOTA rows remain compatible. Exact authority evidence and scoped task qualification remain fail-closed; coarse rank and manager role grant no authority |
| `tools/contextPacket.mjs` | Verified source packets for focused workers (`build` / `verify`): slices exact source line ranges with file/excerpt SHA-256 provenance, byte bounds, and omitted-context disclosures; rejects stale files, altered excerpts, path escapes and oversized packets |
| `tools/proposalPreflight.mjs` | Executable worker-proposal preflight (RSR-03 / AGT-79): baseline SHA-256 freshness, patch syntax, isolated git apply --check, context packet checks |
| `tools/mrReview.mjs` | Autonomous MR review readiness report (verification evidence, compacted diff, baton update) and independent audit gate (exact revision check, author-reviewer separation, clean merge; AGT-88) |
| `tools/dossierScaffold.mjs` | Automated task dossier scaffolder (`spec.md`, `log.md`, `accept.mjs`) generating unapproved templates with explicit qualified reviewer sign-off gate (AGT-88) |
| `tools/tokenReport.mjs` | Token report: observed usage, modeled overhead/delegation comparisons and context hygiene (see below) |
| `tools/release.mjs` | Kit releases: numbers at ship time from `.changes/<TICKET>.md` fragments, updates `VERSION` + `CHANGELOG.md`, commits, tags, and pushes |

Claude Code-only extra: the session-watch hook refreshes the daily token report and weekly hygiene audit at startup and flags stale (24h+) sessions; context size is left to Claude Code's native auto-compact. It lives in `hooks/session-watch.cjs` and is registered by sync (its per-session state stays in `~/.claude/hooks/state/`).

## Token report

`node ~/.agents/tools/tokenReport.mjs [--project <dir>] [--days 30] [--since <ISO date>] [--codex-home <dir>] [--out <dir>] [--summary]` reads Claude Code, Antigravity and Codex usage. Claude/Antigravity price comparisons are counterfactual estimates using configured historical API prices; they do not measure billing, realized savings or subscription quota duration. Missing Claude telemetry or no matching Antigravity usage for the project/window produces unavailable conclusions and blank numeric CSV cells. Readable Antigravity storage alone does not establish usage; skipped unreadable databases retain incomplete-coverage diagnostics.

Codex reads JSONL below `<codex-home>/sessions` (default `CODEX_HOME` or `~/.codex`) without modifying source files. It matches normalized exact `session_meta.cwd`; child directories and worktrees are not implicitly included. Event timestamps define the window; the last earlier cumulative snapshot is the baseline. A first snapshot is counted only when an in-window origin is established; missing history, counter decreases, ambiguous ordering and invalid records are flagged. Model/effort transitions are preserved without allocating uncertain increments to a model. Main, worker, guardian and unknown roles are counted separately. Per-session reported counters have unknown parent/worker overlap, so no unique task-wide total, Codex cost or quota savings is reported. `observed` describes available counters, not complete task coverage. Message/tool contents are excluded from Codex output.

Output goes to `<project>/.agents/reports/` (`token-report.md`, separate `codex-usage.json`, `history.csv`, self-ignoring `.gitignore`). Legacy CSV columns retain their positions; `stretch_cc`/`stretch_ag` now denote modeled price ratios only. The session-watch hook refreshes the report at session start once a day and shows the coverage-aware summary.

Copies on claude.ai (Settings, Capabilities, Skills) can't be synced from here. Re-upload `skills/<name>` after you edit it.

## Experimental: task board for several agents on one repo (`task-board`, opt-in)

When several agents share a repo (Claude Code, Antigravity/Gemini, Cowork, or several sessions and worktrees of the
same tool), they don't share memory and can grab the same task. `tools/baton.mjs` keeps a task board in two committed
markdown files, with no server, database or daemon: `.agents/BACKLOG.md` (tickets with `[ ]` open, `[~]` claimed,
`[!]` blocked, `[x]` done, plus `needs:`, `target:`, `from:`) and `.agents/STATE.md` (current focus and handoff log).
Claims are leases (`claimed: <agent> until <date>`) that every `log` renews.

It is **experimental**: nothing is installed until you opt in, and the file format may still change.

```
node ~/.agents/sync.mjs --enable task-board      # installs the task-board skill + the auto-baton hook (Claude Code)
cd <your project>
node ~/.agents/tools/baton.mjs init              # writes .agents/baton.config.json, STATE.md, BACKLOG.md (never overwrites)
node ~/.agents/tools/baton.mjs --agent claude    # brief: your ready tickets, who holds what, what blocks you
node ~/.agents/tools/baton.mjs claim APP-01 --agent claude
node ~/.agents/tools/baton.mjs log --agent claude --done "what changed + verify result" --next "next step"
node ~/.agents/tools/baton.mjs done APP-01 --commit <sha>
```

Also `focus`, `block <ID> --reason`, `release <ID>`. `.agents/baton.config.json` sets the project name, file paths,
`leaseDays`, `ticketId` pattern, agent names, and `push`: `push-master` (commit + push the backlog to `branch`),
`commit-only` (default) or `none`. Optional: a project SessionStart hook running `baton.mjs --hook --agent claude`
injects the brief into each session. The auto-baton hook records sessions that changed files but wrote no `log` line,
and the brief lists them. Projects can wrap it: `import { main } from ".../baton.mjs"` and pass extra brief sections.
Opt out with `node ~/.agents/sync.mjs --disable task-board`; `--list` shows what is on.

**Known limits**
- `git push` is the only lock. Two agents that check the remote in the same moment can both claim; the second push is
  rejected and the tool says the claim did NOT land. In `commit-only`/`none` mode other checkouts see a claim only after you push.
- Leases are date-granular (`until YYYY-MM-DD`, UTC), not hourly.
- Advisory only: it stops agents that follow the protocol from colliding, not ones that skip it.

## Experimental: Grok bridge for every project (`grok-bridge`, opt-in)

A zero-dependency MCP server (`mcp/grok-bridge/`) giving any project the tools `grok_completion`, `grok_review_code` and `grok_get_budget`.

- Enable: `node ~/.agents/sync.mjs --enable grok-bridge` (registers it in `~/.claude.json` `mcpServers`; `--disable` removes it). Restart Claude Code afterwards.
- API key lookup, first valid wins: env `XAI_API_KEY` / `VITE_XAI_API_KEY`, then the project's `.env.local` / `.env`, then `~/.agents/.env` (kit-ignored). The key is never logged or stored.
- Ledger: `~/.agents/state/grok-budget.json` (one per machine, kit-ignored). Monthly limit from `AI_USD_BUDGET_MONTHLY` (same lookup), default $20.

## Results so far

Measured on one game project, Oct 28 to 30, 2026 (kit 1.9.0). Dollars are modeled at API list prices, not billing or quota, and output quality is mostly self-reported so far.

| Tool | Modeled actual | Baseline | Net % |
| :-- | --: | --: | --: |
| Claude Code vs all-Opus | $100.00 | $131.14 | 22.7% |
| Antigravity vs all-Pro | $81.02 | $139.13 | 40.5% |

- Biggest win: delegating to cheaper models saved a modeled $30.38 over 40 spawns, about 21.8x the kit's own overhead (1.4% of spend).
- Biggest gap: late checkpoints wasted $4.96. Sonnet workers report 19 of 20 checks passing; independent verifier rechecks started Oct 30 (1 so far, 0 false passes). Details and limits: [docs/RESULTS.md](docs/RESULTS.md).

## Roadmap

**In progress**
- One-command MR review readiness report and a task dossier scaffolder (templates only; approval must match the reviewed revision).
- Closing one provider telemetry/pricing gap in the token report.
- Independent verifier rechecks of worker passes: shipped as a rule; collecting rechecks (1 so far, 0 false passes).

**Planned**
- Decide whether the experimental task-board skill and auto-baton hook become stable.
- First-run welcome note listing what you get.
- Extract the ticketing engine into its own package.
- Earlier checkpoints to cut late-context waste.

**Known issues**
- The baton merge-driver proof script fails (its scratch repo is missing a module).
- Codex token coverage is partial.

## How this was built

Designed and directed by CreativeAiTech (AlexTheHero), built together with AI agents: mainly Claude Code (Claude Opus),
plus Gemini in Antigravity and Grok. Tested in daily use on their game project.

## License

MIT, see [LICENSE](LICENSE). Free to use, change and share.

If this saved you time, you can [buy me a coffee ☕](https://paypal.me/thealexseven).
