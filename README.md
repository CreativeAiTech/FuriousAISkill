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
| `skills/model-orchestrator` | Who does a task: agent (Gemini / Claude Code / Grok), model tier, delegation, task specs, cross-tool handoff, Grok banners, token audits |
| `skills/context-compressor` | `CONTEXT.md` (its only writer and template) |

Claude Code-only extra: the context-watch hook measures real token growth and triggers `context-compressor`. It lives in `hooks/context-watch.cjs` and is registered by sync (its per-session state stays in `~/.claude/hooks/state/`).

Copies on claude.ai (Settings, Capabilities, Skills) can't be synced from here. Re-upload `skills/<name>` after you edit it.
