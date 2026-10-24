# FuriousAISkill: global AI skills & rules (single source of truth)

This repo (`git@github.com:CreativeAiTech/FuriousAISkill.git`) is the agent kit. It is cloned to `~/.agents`.

## Install

```
git clone git@github.com:CreativeAiTech/FuriousAISkill.git ~/.agents
node ~/.agents/sync.mjs
```

Etherium's `yarn install` does this automatically (clone if missing, fast-forward when clean, then sync).

`sync.mjs` copies the kit into every tool:

| Source | Claude Code | Antigravity |
| :--- | :--- | :--- |
| `skills/<name>/` | `~/.claude/skills/<name>/` | `~/.gemini/config/skills/<name>/` |
| `rules/*.md` (always on) | managed block in `~/.claude/CLAUDE.md` | `~/.gemini/config/rules/<file>` |
| `agents/*.md` (subagents, pinned models) | `~/.claude/agents/<file>` | none (uses its built-in subagents) |
| `hooks/claude-hooks.json` (hook manifest) | `hooks` in `~/.claude/settings.json` (managed entries only) | none |

Generated copies are marked. Sync removes stale generated copies and never touches hand-written files.
Projects layer their own specifics on top (e.g. Etherium's `AGENTS.md` and `.agents/skills/`), and project rules win.

## Updating

Edit in `~/.agents`, run `node ~/.agents/sync.mjs`, then commit and push. Other machines pick it up on the next `yarn install`.

| Item | Owns |
| :--- | :--- |
| `rules/token-optimization.md` | Lean context, generic lifecycle, bounded tool use, checkpoint trigger |
| `skills/model-orchestrator` | Who does a task: agent (Gemini / Claude Code / Grok), model tier, minimum tier (default top-tier areas are a floor projects can't silently lower), delegation, task specs, decision notes, cross-tool handoff, Grok banners, token audits. Templates in `assets/` (task spec, decision note, project min-tier table) |
| `skills/context-compressor` | `CONTEXT.md` (its only writer and template) |
| `tools/tokenReport.mjs` | Token report: kit overhead vs measured delegation savings, context hygiene, verdict (see below) |

Claude Code-only extra: the context-watch hook measures real token growth and triggers `context-compressor`. It lives in `hooks/context-watch.cjs` and is registered by sync (its per-session state stays in `~/.claude/hooks/state/`).

## Token report

`node ~/.agents/tools/tokenReport.mjs [--project <dir>] [--days 30] [--out <dir>] [--summary]` reads Claude Code transcripts and answers whether the kit pays for itself: its fixed per-session overhead versus measured subagent savings, late-checkpoint waste, and the largest tool results, ending with a verdict. Costs are API-list-price equivalents (edit `PRICES` at the top when prices change). Output goes to `<project>/.agents/reports/` (`token-report.md`, `history.csv`, self-ignoring `.gitignore`). The context-watch hook refreshes it at session start once a day (first session of the day) and shows the one-line summary.

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

## How this was built

Designed and directed by AlexTheHero (CreativeAiTech), built together with AI agents: mainly Claude Code (Claude Opus),
plus Gemini in Antigravity and Grok. Tested in daily use on their game project.

## License

MIT, see [LICENSE](LICENSE). Free to use, change and share.

If this saved you time, you can [buy me a coffee ☕](https://paypal.me/thealexseven).
