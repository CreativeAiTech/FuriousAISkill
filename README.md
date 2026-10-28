# FuriousAISkill

**Run Claude Code, Gemini (Antigravity), Codex and other AI agents on one repo, cheaply and without them stepping on each other.**
No server, no database: just markdown rules, a few small Node scripts, and git.

If you use more than one AI coding agent (or several sessions of the same one), you have probably seen this:
two agents grab the same task, one overwrites the other's work, the next session forgets what the last one decided,
and the expensive model burns quota on file searches a cheap one could do. This kit is one person's answer to that,
used daily on a real game project.

**What's inside**
- **Orchestration rules** (`rules/token-optimization.md`, `model-orchestrator` skill): the top model plans and reviews,
  cheaper subagents (`worker`, `verifier`) search, edit and run checks. Hard decisions stay on the top tier.
- **Task board** (`task-board` skill, `tools/baton.mjs`, experimental, opt-in): tickets with claims and leases, a handoff
  "baton" each session writes before it stops, and a brief the next agent reads first. `git push` is the lock.
- **Context checkpoints** (`context-compressor` skill): turn a long chat into a short `CONTEXT.md` and continue fresh.
- **Token report** (`tools/tokenReport.mjs`): observed usage, telemetry coverage, and modeled price comparisons.

`sync.mjs` maintains the supported Claude Code (`~/.claude`) and Antigravity (`~/.gemini`) copies. Codex discovers canonical skills directly in `~/.agents/skills` and project `.agents/skills`; no additional Codex copy is needed.
Status: personal kit, shared as-is. MIT licensed, issues welcome.

## Install

```
git clone https://github.com/CreativeAiTech/FuriousAISkill.git ~/.agents
node ~/.agents/sync.mjs
```

Tip: a project can run this from its install script (clone if missing, fast-forward when clean, then sync) so every machine stays current.

`sync.mjs` generates these Claude Code and Antigravity integrations:

| Source | Claude Code | Antigravity |
| :--- | :--- | :--- |
| `skills/<name>/` | `~/.claude/skills/<name>/` | `~/.gemini/config/skills/<name>/` |
| `rules/*.md` (always on) | managed block in `~/.claude/CLAUDE.md` | `~/.gemini/config/rules/<file>` |
| `agents/*.md` (subagents, pinned models) | `~/.claude/agents/<file>` | none (uses its built-in subagents) |
| `hooks/claude-hooks.json` (hook manifest) | `hooks` in `~/.claude/settings.json` (managed entries only) | none |

Generated copies are marked. Sync removes stale generated copies and never touches hand-written files.
Projects layer their own specifics on top (e.g. Etherium's `AGENTS.md` and `.agents/skills/`), and project rules win.

**Codex:** use the source skills from `~/.agents/skills` and the project skills from `.agents/skills` ([official skills documentation](https://learn.chatgpt.com/guides/best-practices)). Invoke the relevant skill, or let project `AGENTS.md` entry guidance reference canonical kit rules. This integration does not install a global Codex AGENTS.md, configuration or hooks. Claude-specific hooks, agent definitions, transcript metrics and automatic startup reports do not become Codex features; run applicable commands explicitly and report their actual results.

## Benchmark-based model authority

The reusable policy and sourced comparison are in [model authority](skills/model-orchestrator/references/model-authority.md). Each model/effort pair is scored independently against the same benchmark version. The legacy benchmark route requires at least 90% of the leader and high effort or above. An explicit reviewed qualification can instead grant judgment for an exact project/task/configuration/risk; it does not promote the model globally or bypass main-session gates. The 0–100 relative index is not IQ. Configurations without applicable current evidence only propose or execute approved specifications. Supported effort options, exact sourced Standard API prices and cost per accepted task are described in [model economics](skills/model-orchestrator/references/model-economics.md). Use `node tools/modelValue.mjs <scenario.json>` for offline workflow price comparisons; no model dispatch or quota prediction occurs.

```sh
node tools/modelAuthority.mjs gpt-6-astra --effort max
node tools/modelAuthority.mjs gpt-6-astra --effort high
node --test tools/modelAuthority.test.mjs tools/modelTier.test.mjs
```

The checker exits 0 for an eligible pair, 2 for a non-eligible pair and 1 for usage/read errors. The model gate remains an advisory workflow: the Claude hook blocks once and does not establish effort; it is not a security boundary or a push hook. Actual model/effort/configuration must be verified before a brain decision. No rank authorizes publishing.

Project `.agents/model-ranks.json` overrides must include current `authority` evidence as well as coarse ranks; legacy rank-only overrides no longer grant brain authority. Copy the kit table to start, preserve the global leader denominator, and record sources for new exact entries. Registry keys are not guaranteed endpoint IDs; resolve aliases explicitly.

## Updating

Edit in `~/.agents`, run `node ~/.agents/sync.mjs`, then commit and push. Other machines pick it up on the next `yarn install`.
For behavior changes, add a fragment `.changes/<TICKET>.md` (`bump: minor|patch|major`, `title: ...`, `**Changes**`, `**Why**`, `**Measure**`); feature commits never touch `VERSION` or `CHANGELOG.md`. Run `node tools/release.mjs` to ship.

| Item | Owns |
| :--- | :--- |
| `rules/token-optimization.md` | Lean context, generic lifecycle, bounded tool use, checkpoint trigger |
| `skills/model-orchestrator` | Who does a task: agent (Gemini / Claude Code / Codex / Grok), actual model tier, native subtasks versus persistent handoffs, minimum tier (default top-tier areas are a floor projects can't silently lower), delegation, task specs, decision notes, cross-tool handoff, Grok banners, token audits. Templates in `assets/` (task spec, decision note, project min-tier table) |
| `skills/context-compressor` | `CONTEXT.md` (its only writer and template) |
| `tools/contextProfile.mjs` | Context profile: the project's measured starting context, heavy-turn size and window headroom; sets context-watch's nudges, re-runs daily at session start, report at `.agents/reports/context-profile.md` |
| `tools/contextHygiene.mjs` | Token hygiene audit: flags what bloats the always-loaded context (big/growing rule files, duplicate skills and hooks, long CONTEXT.md header, oversized backlog), runs on the first session and then weekly from context-watch, report at `.agents/reports/context-hygiene.md` |
| `hooks/rule-lint.mjs` + `tools/lib/ruleLint.mjs` | Write-time rule lint (Claude Code): after an edit to CLAUDE.md, AGENTS.md, GEMINI.md or `.agents/rules/**`, one warning line for a big file with no "Before you" table, a topic file without `Keywords:`, a line duplicated in another always-on file, or a missing trigger-table path; never blocks |
| `tools/modelTier.mjs` + `tools/modelAuthority.mjs` + `hooks/model-check.mjs` | Model fallback gate (opt-in: `"modelGate": true` in `.agents/baton.config.json`): a non-top main model is stopped once and must ask the user (`baton.mjs --model <id> --effort <effort>` for tools without hooks); ranks in `model-ranks.json`, an unranked model asks "top, mid or small?" and `modelTier.mjs learn` records the coarse rank. The default benchmark route requires current exact model/effort evidence at >=90% of the benchmark leader; an explicit reviewed task qualification covers only its precise project/task/configuration/risk. Main-session gates remain separate; learning top alone cannot grant authority |
| `tools/contextPacket.mjs` | Verified source packets for focused workers (`build` / `verify`): slices exact source line ranges with file/excerpt SHA-256 provenance, byte bounds, and omitted-context disclosures; rejects stale files, altered excerpts, path escapes and oversized packets |
| `tools/tokenReport.mjs` | Token report: observed usage, modeled overhead/delegation comparisons and context hygiene (see below) |
| `tools/release.mjs` | Kit releases: numbers at ship time from `.changes/<TICKET>.md` fragments, updates `VERSION` + `CHANGELOG.md`, commits, tags, and pushes |

Claude Code-only extra: the context-watch hook measures real token growth and triggers `context-compressor`. It lives in `hooks/context-watch.cjs` and is registered by sync (its per-session state stays in `~/.claude/hooks/state/`).

## Token report

`node ~/.agents/tools/tokenReport.mjs [--project <dir>] [--days 30] [--since <ISO date>] [--codex-home <dir>] [--out <dir>] [--summary]` reads Claude Code, Antigravity and Codex usage. Claude/Antigravity price comparisons are counterfactual estimates using configured historical API prices; they do not measure billing, realized savings or subscription quota duration. Missing Claude telemetry or no matching Antigravity usage for the project/window produces unavailable conclusions and blank numeric CSV cells. Readable Antigravity storage alone does not establish usage; skipped unreadable databases retain incomplete-coverage diagnostics.

Codex reads JSONL below `<codex-home>/sessions` (default `CODEX_HOME` or `~/.codex`) without modifying source files. It matches normalized exact `session_meta.cwd`; child directories and worktrees are not implicitly included. Event timestamps define the window; the last earlier cumulative snapshot is the baseline. A first snapshot is counted only when an in-window origin is established; missing history, counter decreases, ambiguous ordering and invalid records are flagged. Model/effort transitions are preserved without allocating uncertain increments to a model. Main, worker, guardian and unknown roles are counted separately. Per-session reported counters have unknown parent/worker overlap, so no unique task-wide total, Codex cost or quota savings is reported. `observed` describes available counters, not complete task coverage. Message/tool contents are excluded from Codex output.

Output goes to `<project>/.agents/reports/` (`token-report.md`, separate `codex-usage.json`, `history.csv`, self-ignoring `.gitignore`). Legacy CSV columns retain their positions; `stretch_cc`/`stretch_ag` now denote modeled price ratios only. The context-watch hook refreshes the report at session start once a day and shows the coverage-aware summary.

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

## How this was built

Designed and directed by AlexTheHero (CreativeAiTech), built together with AI agents: mainly Claude Code (Claude Opus),
plus Gemini in Antigravity and Grok. Tested in daily use on their game project.

## License

MIT, see [LICENSE](LICENSE). Free to use, change and share.

If this saved you time, you can [buy me a coffee ☕](https://paypal.me/thealexseven).
