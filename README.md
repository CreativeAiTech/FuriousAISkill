# ~/.agents: global AI skills & rules (single source of truth)

## Install on a new machine

```
git clone <your-private-repo-url> ~/.agents
node ~/.agents/sync.mjs
```

Etherium's `yarn install` also runs this automatically when `~/.agents` exists.

Edit files here only, then run `node ~/.agents/sync.mjs`. It copies them into every tool:

| Source | Claude Code | Antigravity |
| :--- | :--- | :--- |
| `skills/<name>/` | `~/.claude/skills/<name>/` | `~/.gemini/config/skills/<name>/` |
| `rules/*.md` (always on) | managed block in `~/.claude/CLAUDE.md` | `~/.gemini/config/rules/<file>` |
| `agents/*.md` (subagents, pinned models) | `~/.claude/agents/<file>` | — (uses its built-in subagents) |
| `hooks/claude-hooks.json` (hook manifest) | `hooks` in `~/.claude/settings.json` (managed entries only) | — |

Generated copies are marked. Sync removes stale generated copies and never touches hand-written files.
Projects layer their own specifics on top (e.g. Etherium's `AGENTS.md` and `.agents/skills/`), and project rules win.

| Item | Owns |
| :--- | :--- |
| `rules/token-optimization.md` | Lean context, generic lifecycle, bounded tool use, checkpoint trigger |
| `skills/model-orchestrator` | Who does a task: agent (Gemini / Claude Code / Grok), model tier, delegation, task specs, cross-tool handoff, Grok banners, token audits |
| `skills/context-compressor` | `CONTEXT.md` (its only writer and template) |

Claude Code-only extra: the context-watch hook measures real token growth and triggers `context-compressor`. It now lives in `hooks/context-watch.js` and is registered by sync (its per-session state stays in `~/.claude/hooks/state/`).
`_retired/` holds the pre-consolidation copies (including the old `context-optimizer` skill, now merged into model-orchestrator and the rule). It is gitignored local backup.

Copies on claude.ai (Settings → Capabilities → Skills) can't be synced from here. Re-upload `skills/<name>` after you edit it.
