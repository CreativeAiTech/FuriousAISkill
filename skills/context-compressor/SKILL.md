---
name: context-compressor
description: Cut token costs by checkpointing a long conversation into a compact CONTEXT.md handoff file, then continuing in a fresh chat, while keeping decisions, requirements, exact errors and reasoning intact. Use whenever the user says "compress", "checkpoint", "save context", "hand off", "start fresh", "this chat is getting long", "too many tokens", "running out of context or quota", "summarize so far", or asks how to keep costs down mid-project. Also use proactively when a conversation has grown long (roughly 30+ turns, many large pastes or tool outputs, or the user re-explains things or corrects the same misunderstanding twice) and starting fresh would be cheaper or more accurate. Works alongside model-orchestrator, which owns model choice; this skill owns what gets carried forward.
metadata:
  version: 1.2.0
---

# Context Compressor

Long chats are expensive because every message resends the whole history. This skill replaces that history with a small, structured checkpoint so the next chat starts with only what matters. The rule: **compress what is cheap to recover, never compress what is expensive to rediscover.**

## When to checkpoint (automatic)

Two independent reasons to checkpoint. Either one is enough:
- **Cost:** every message re-reads the whole history, so a long chat burns usage limits on every turn.
- **Drift (any length):** models that take a wrong turn in a conversation rarely recover in it, and a fresh chat started from a consolidated summary does markedly better (see Evidence below). Signals: the user re-explains something settled, corrects the same misunderstanding twice, or you catch yourself contradicting an earlier decision. On a drift signal, offer a checkpoint even in a short chat.

**In Claude Code with the context-watch hook installed**, you'll receive `[context-watch vX]` notes with real token counts. The hook sizes its nudges from the project's context profile (`tools/contextProfile.mjs`: measured starting context, heavy-turn size, window), and also fires the hard note when the total nears the window. Follow them:
- **Soft note:** answer normally. If this reply wraps up a task or milestone, or the topic is changing, end it with one line offering a checkpoint. If not, make that offer at the first later reply that does. Don't drop it.
- **Hard note:** answer normally, then at the end of the same reply write/update `CONTEXT.md` and give the resume instructions below. Don't ask permission first; the user opted in to automatic checkpoints.
- **Nothing left to save** (the hook says git is clean and pushed, or you checked): don't write `CONTEXT.md` or a baton that would only repeat git history. Save only a decision, finding or open question that isn't yet in a commit, decision note or backlog item. If there's none, end with one line: the task is finished and saved in git, the chat is at ~N tokens so continuing here costs more per turn, please open a fresh chat.

**Without the hook (claude.ai chat, other tools)**, you can't see token counts, so count turns and pastes instead. Count it as **soft** when any of these is true:
- ~20-25 back-and-forth turns, or a few large pastes, logs, files or tool outputs.
- Antigravity: `node ~/.agents/tools/agContext.mjs` prints `checkpoint` (measured growth past budget). Elsewhere, or when it can't read the store: 3 heavy turns (each read 300+ lines or got a big tool output), whatever the turn count.
- A task or milestone just finished (feature works, bug fixed, decision made) and the chat is already long.
- The topic is changing and the old history won't help.
- The user mentions cost, limits, quota or slowness.

Count it as **hard** when: ~40+ turns, many large pastes, or any drift signal in an already long chat. On hard, checkpoint at the end of your reply without being asked and output the paste-ready block. In claude.ai, earlier messages may be auto-summarized near the context limit; that prevents overflow but drops exact wording, so it is not a substitute for a checkpoint.

Never interrupt a delicate debugging step where the exact recent output still matters; finish that step first.

### Evidence (why these triggers)
- Multi-turn drift: across 15 LLMs, performance fell 39% on average when a task was spread over turns instead of given at once; it appears from 2 turns on. Giving the same content in one message recovered ~95%. The authors' advice: start a new chat and consolidate first. (Laban et al., "LLMs Get Lost In Multi-Turn Conversation", 2025, arxiv.org/abs/2505.06120)
- Length: quality degrades gradually with input length in all 18 models tested, Claude included, with no single cliff (Chroma, "Context Rot", 2025). On non-literal recall, 11 of 13 models fell below half their short-context score by 32K tokens (NoLiMa, 2025, arxiv.org/abs/2502.05167).
- Cost: the full conversation is sent on every request; `/clear` costs nothing, `/compact` is itself a large request (Claude Code costs docs). Anthropic recommends compaction and external notes for long work ("Effective context engineering for AI agents", 2025).
- Turn counts above are judgment calls built on these, not measured optima. The hook's token thresholds are measured: see the kit's CHANGELOG.md.

## The three buckets

Sort everything in the conversation into exactly one bucket before writing.

### KEEP VERBATIM (never paraphrase)
These lose their value if summarized. Copy them exactly.
- Requirements and constraints the user stated, in their words.
- Decisions made **and the reason for each**, plus rejected options with why they were rejected (stops the next chat from re-proposing them).
- Exact error messages, stack-trace heads, failing test names, version numbers, file paths, commands, config values, IDs, URLs.
- Interfaces that other work depends on: function signatures, API shapes, schemas, data formats.
- Open questions and known risks.
- User preferences about style, tone, tools or workflow.

### SUMMARIZE (one line each)
Useful context, but recoverable or only needed as a pointer.
- What was tried and failed: one line per attempt, with the reason it failed.
- Long explanations Claude gave: the conclusion only.
- Files and code: name + purpose + current state, not contents (they can be reopened).
- Research and search results: the finding and its source link.

### DROP
- Greetings, thanks, back-and-forth clarifications that ended in a decision (keep the decision).
- Full logs, full file dumps, full tool outputs (keep the one line that mattered).
- Superseded drafts and old versions of code.
- Claude's narration of what it was about to do.

When unsure whether something is KEEP or SUMMARIZE, keep it. A few extra lines cost far less than redoing work.

## Writing the checkpoint

Write `CONTEXT.md` using `template.md` in this skill's folder. Rules:

1. Target **under ~800 words** for most projects; hard ceiling ~1,500 (the context profile flags a bigger file). If it's longer, the SUMMARIZE bucket is too detailed: move settled reasoning into decision notes and keep a one-line pointer.
2. Put the **Next step** first after the goal: the new chat should be able to act immediately.
3. Use exact quotes (in code blocks) for everything in KEEP VERBATIM.
4. Date the checkpoint and number it (Checkpoint 1, 2, ...).
5. This skill is the only writer of `CONTEXT.md`, and `template.md` is the only template for it. If a `CONTEXT.md` already exists, **update it in place**: merge new decisions, move finished items to Done, remove anything now obsolete. Never append a second full copy.
   If the project has its own cross-tool handoff file (e.g. `.agents/STATE.md` with a `session-handoff` skill), update that first. `CONTEXT.md` is the deeper record of decisions and reasoning, and the project file stays the pointer.
6. In Claude Code or any tool with file access, save it to the project root. In the claude.ai chat, output it as a single markdown code block the user can copy, or into a doc/file if they prefer.

## Verifying before handing off

Before telling the user it's ready, check the draft against these questions. Fix any "no":

- Could a fresh chat with only this file do the next step without asking anything?
- Is every decision paired with its reason?
- Are all error messages, paths and versions character-exact?
- Are rejected approaches listed so they won't be retried?
- Is nothing here that a fresh chat could re-derive in a few seconds by opening a file?

## Handing off

End the reply with a short block in this shape:

> **This chat is getting long (~N turns / ~Xk tokens). Start fresh to save tokens. Checkpoint saved.**
> Then one of the two resume options below.

**Claude Code (file saved in the project):** if you have a self-clear tool (desktop `clear_session` with `session_id: "self"`), clear the chat yourself as the last call, without asking, and say "type `continue` here to resume" (rules: `~/.agents/rules/topics/checkpoints.md` § Auto-clear). Otherwise tell them to run `/clear` or open a new session in the same folder and type `continue`. If the context-watch hook is installed, the new chat is pointed at `CONTEXT.md` automatically; otherwise give this one-liner to paste:
```
Read CONTEXT.md in this folder and continue from its "Next step". Don't re-summarize it.
```

**claude.ai chat or moving to another tool:** output the whole checkpoint as ONE fenced code block that starts with this line, so a single copy/paste is enough:
```
Continue this project from the checkpoint below. Treat "verbatim" sections as exact. Start with "Next step"; don't re-summarize.
```

Add one line saying roughly how much smaller the new start is (e.g. "~40 turns → ~700 words").

`/compact` is the in-place alternative when they'd rather not switch: automatic but less precise than a written checkpoint. Don't recommend it over a checkpoint for long-running work.

## Resuming from a checkpoint

When a chat starts with a `CONTEXT.md`:

1. Read it fully; treat KEEP VERBATIM sections as authoritative.
2. Restate the next step in one sentence and start on it. Don't re-summarize the whole file back to the user.
3. If something in the file conflicts with what you see in the actual files, trust the files, say so in one line, and fix the checkpoint at the next save.

## Other cost habits to mention when relevant (one line, not a lecture)

- Paste only the relevant function or error, not whole files.
- Ask for short output ("diff + 3-line summary") on routine work.
- Use `/clear` between unrelated tasks in Claude Code.
- Keep standing instructions (CLAUDE.md, project instructions) short: they're re-read every turn.
- Don't lower thinking effort on hard problems to save money; that's where accuracy comes from. Lower it for mechanical edits.
- For model choice and delegating bulk work to cheaper models, use the model-orchestrator skill.
