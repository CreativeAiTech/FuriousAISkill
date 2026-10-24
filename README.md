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

`node ~/.agents/tools/tokenReport.mjs [--project <dir>] [--days 30] [--out <dir>] [--summary]` reads Claude Code transcripts and answers whether the kit pays for itself: its fixed per-session overhead versus measured subagent savings, late-checkpoint waste, and the largest tool results, ending with a verdict. Costs are API-list-price equivalents (edit `PRICES` at the top when prices change). Output goes to `<project>/.agents/reports/` (`token-report.md`, `history.csv`, self-ignoring `.gitignore`). The context-watch hook refreshes it at session start when it is over 7 days old and shows the one-line summary.

Copies on claude.ai (Settings, Capabilities, Skills) can't be synced from here. Re-upload `skills/<name>` after you edit it.
