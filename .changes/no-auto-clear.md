---
bump: minor
title: Checkpoint suggests a fresh session instead of clearing the chat
---
**Changes**
- `rules/topics/checkpoints.md`: "Suggest, never auto-clear". At a due checkpoint: save, then propose a fresh-session card (desktop `start_session`, own_initiative, brief "continue"); the user starts it when ready. Never `clear_session` on self. No such tool: one line suggesting a new chat.
- `hooks/context-watch.cjs` hard nudge and `context-compressor` hand-off follow it. Replaces the unreleased auto-clear change.

**Why**: user 2026-10-26: auto-clear wiped the chat they still wanted to check, and nothing resumed after it.

**Measure**: next 7 days of transcripts: zero `clear_session` self calls; checkpoint replies end in a start_session proposal or a new-chat line.
