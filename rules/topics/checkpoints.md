# Checkpoints and context size

Keywords: checkpoint, context, context profile, long chat, growth budget, agContext, contextProfile, CONTEXT.md, compact, heavy turn, context-compressor

Trigger sentence (core): about 20+ turns with heavy tool output, or right after a milestone, checkpoint with `context-compressor` and start fresh (prefer it over `/compact` for long work).

- **Size the task first.** The context profile (`node ~/.agents/tools/contextProfile.mjs`, refreshed daily; `.agents/reports/context-profile.md`) gives this project's starting context, heavy-turn size and growth budget (Claude Code's context-watch nudges from it). A task whose reading won't fit the budget: split it, or send the reading to subagents (their reads stay out of the main chat).
- **No hook (Antigravity)**: after each finished task run `node ~/.agents/tools/agContext.mjs` (measured prompt size from the chat store vs this project's growth budget) and checkpoint when it prints `checkpoint`. Store unreadable (it says so): checkpoint after 3 heavy turns (a turn that read 300+ lines or got a big tool output).
- Keep `CONTEXT.md` inside the `context-compressor` ceiling (~1,500 words, ~2.5k tokens; the profile flags it): move settled reasoning into decision notes and drop it from the checkpoint.
