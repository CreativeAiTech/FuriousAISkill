---
bump: minor
title: Auto-clear after checkpoint - the agent clears its own chat instead of asking for a new session
---
**Changes**
- `rules/topics/checkpoints.md`: new Auto-clear rule. At a due checkpoint: save (baton, CONTEXT.md only for what git lacks), then call desktop `clear_session` with `session_id: "self"` as the last call, no asking; user types `continue` in the same tab. No self-clear tool (Antigravity, CLI): one line asking for a new chat.
- `hooks/context-watch.cjs` hard nudge and `context-compressor` hand-off point to it.

**Why**: user opened new sessions by hand after every checkpoint; the Claude desktop app exposes a self-clear tool that runs once the turn ends.

**Measure**: count of checkpoint replies ending in a `clear_session` call vs "open a fresh chat" lines, next 7 days of transcripts.
