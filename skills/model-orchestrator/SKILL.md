---
name: "model-orchestrator"
description: Decides who does a task and how cheaply. First WHICH agent (Antigravity Gemini for routine work and all images, Claude Code for architecture, hard bugs, cross-file refactors and review, xAI Grok via MCP for wit, banter and brainstorming), then WHICH model tier inside it, then how to delegate (investigate → plan → implement → verify → review, tight task specs, diff review) and how to hand work across tools. Use whenever the user asks "who should do this", "which agent", "which model", "ask Grok", mentions saving tokens, token limits, quota, auditing token spend, Haiku vs Sonnet vs Opus, delegating to subagents, tagging backlog items, or switching tools mid-project, even if they don't say "orchestrator".
---

# Model Orchestrator

Spend expensive tokens only where judgment is needed. Pick the cheapest agent and the smallest model that can do the job **well**; the strong model thinks, specs, and reviews. This skill owns **who does the work**. `context-compressor` owns **what gets carried forward** (it is the only writer of `CONTEXT.md`). The user should never have to carry context between tools by hand.

## Step 0: Respect the project's own setup

Project rules win over this generic skill. Check AGENTS.md / CLAUDE.md for:
- **A handoff file** (`.agents/STATE.md` + `.agents/BACKLOG.md`, a `session-handoff` skill, or similar): use it for session state and cross-agent tasks. Otherwise read `CONTEXT.md` if it exists; to write it, follow `context-compressor`.
- **Risky areas, art commands, agent overrides**: apply them on top of Step 1.
- **Verify commands** (typecheck, targeted tests): use them in step 4 of the lifecycle.

## Step 1: Pick the agent

| Agent | Cost profile | Use it for | Don't use it for |
| :--- | :--- | :--- | :--- |
| **Gemini (Antigravity native)** `@gemini` | Included, high quota | Routine edits, single-file features, data/JSON content, docs, tests, git, pipeline runs, **all image generation** | Subtle cross-module refactors with no review |
| **Claude Code (Pro plan)** `@claude` | **5-hour usage windows**, so only high-leverage work | Architecture and design, hard bugs in core math or state logic, multi-file refactors, **reviewing Gemini's risky diffs**, splitting big features into bounded tasks | Bulk edits, asset tweaks, anything Gemini does in one pass, **images (Claude can't)** |
| **xAI Grok (MCP)** `@grok` | Paid per token, tracked budget | Witty/sarcastic dialogue, banter, divergent brainstorming, irreverent second opinions | Code edits (no repo access), anything with secrets |
| **User** `@user` | — | Secrets and key rotation, taste calls, approvals, account actions | Work an agent can do |

Quick rules, first match wins:
1. **Needs an image?** → `@gemini` (or `@user` if its image quota is exhausted).
2. **Wit, humor, or "10 wild ideas"?** → `@grok` if a Grok MCP tool is connected in this project, else do it natively.
3. **A wrong answer would silently corrupt math, transforms, or saved data, or it spans 4+ files?** → `@claude` (or Gemini implements and Claude reviews).
4. **Everything else** → `@gemini`.

Paid Grok tokens go only to an explicit user request ("ask Grok"), persona/wit writing, or divergent brainstorming. Never routine code or questions.

## Step 2: The lifecycle (non-trivial work only)

1. **Investigate** (worker or read-only subagent): searching and reading stay inside the worker. It returns only root cause, file paths and line numbers.
2. **Plan** (brain): the minimal edit plan. If there are real trade-offs, ask the user first.
3. **Implement** (worker for mechanical or well-specified edits, brain for subtle ones): drafts stay out of the main thread.
4. **Verify & self-heal** (worker): run the typecheck and only the relevant tests. Fix failures in place, at most 2 attempts on the same error, then stop and report the blocker. Return 2-3 lines ("tsc clean, 12/12 tests pass").
5. **Review & checkpoint** (brain + user): present the diff and the verify result. After an approved milestone, checkpoint with `context-compressor` if the chat is long.

Only trivial work (answer already in context, ≤2 quick tool calls, a one-line edit) skips this and runs inline. Everything else is delegated by default (global rule "Orchestrator-first").

## Step 3: Delegate inside the tool?

Delegation is the default (global rule "Orchestrator-first"). The only exception is trivial work, where a cold subagent spawn (~15-20k tokens of setup) costs more than the task.

Delegate to a worker when the task is repetitive or high volume, mechanical (renames, formatting, boilerplate, moving code), well specified (you can state what "done" looks like), low risk, or a search/summarize job.

Keep on the brain: architecture or design, debugging with an unknown cause, ambiguous requirements, security or data loss risk, and the final review.

## Step 4: Pick the tier

Use the smallest model that can do the job reliably.

| Tier | Typical use |
|---|---|
| Small (Haiku / Flash-Lite class) | bulk edits, boilerplate, tests from a spec, formatting, log summaries, file search |
| Mid (Sonnet / Flash class) | normal feature work, refactors inside one module, writing from a design |
| Large (Opus / Pro class) | planning, architecture, hard debugging, final review |

If a worker returns something wrong twice, move that task up one tier rather than retrying at the same tier.

**Grok models**: let the bridge auto-select (`model: "auto"`); pass one only if the user names it.

| Model | Use |
| :--- | :--- |
| `grok-4.20-0309-non-reasoning` | Default: dialogue, banter, fast brainstorming |
| `grok-4.20-0309-reasoning` | Formula and balance-math sanity checks, game-tree logic |
| `grok-build-0.1` | Outside-perspective code or type critique |
| `grok-4.7` | Large narrative arcs and system-design ideation |

## Step 5: Write a tight task spec

Small models do well with precise instructions and badly with vague ones. Use `assets/task-spec.template.md`: **Goal** (one sentence), **Files** (exact paths, nothing else in scope), **Instructions** (concrete steps, one example if the pattern isn't obvious), **Constraints** (what must not change), **Done when** (a checkable condition), **Output format** (short summary + diff).

Give each worker only the context it needs: point at files, don't paste the project. Split big jobs into independent specs so one failure doesn't block the rest.

## Step 6: Review the diff, not the codebase

Read the summary and the diff, check them against "Done when", and look for scope creep, skipped edge cases, and quietly changed behavior. Accept, request a specific fix, or redo at a higher tier. Re-read whole files only if the diff looks suspicious.

## Step 7: Hand work across tools

Agents don't share chat memory, so work crosses through the repo.
- **Project has a backlog/handoff file**: add a self-contained item tagged `@gemini` / `@claude` / `@grok` / `@user` with file paths and a "verify with" command. Don't ask the user to relay it.
- **It doesn't**: give the user one paste-ready block (goal, files, done-when) for the other tool.

| Situation | Do this |
| :--- | :--- |
| Gemini finishes a risky change | Mark it for review, add `@claude`: "Review <files> for <risk>" |
| Claude designs a feature | Split into bounded `@gemini` items with paths and acceptance commands |
| Anything needs art | `@gemini` item with the exact prompt or pipeline command |
| Grok returns content | The calling agent writes it into the repo, then logs it |
| Grok fails or runs out of budget | Finish natively with what came back; handle and delete any relay snapshot the bridge left |
| Quota or Claude window runs out mid-task | Write the handoff first, then the user says "continue" in the next tool. Spend free or flat-rate quotas before pay-per-token credits |

## Step 8: Grok pre-flight & banners

1. **Available?** A Grok MCP tool must be connected with a key configured. If not, do the task natively without fuss.
2. **Budget**: call the bridge's budget tool (e.g. `grok_get_budget`). At 200 tokens or fewer, do it natively.
3. **Before dispatching**, show:
   > 🔄 **[AI Subagent Dispatch: xAI Grok <model>]**
   > • **Task**: `<task description>`
   > • **Budget Remaining**: `X / Y tokens`
4. **Afterwards**, show:
   > ✅ **[AI Subagent Complete: xAI Grok <model>]**
   > • **Tokens Consumed**: `N tokens`
   > • **Updated Budget Remaining**: `X - N / Y tokens`

Banners apply **only to Grok** (the paid external call). The agent runs all commands; the user never does.

## How to run this in each environment

- **Claude Code**: the main session is the brain. `Explore` agent for wide read-only searches, the global `worker` agent (sonnet) for edits from a spec, and the `verifier` agent (haiku) for checks. Pass `model: "haiku"` to Explore. Only trivial work stays inline.
- **Antigravity**: its subagents (`research` / `flash_lite` for investigate and verify, `flash` or `pro` for implement), or switch the model dropdown per task.
- **Claude app or any plain chat**: no automatic delegation. Output task specs as copy-paste blocks; the user runs them in a cheaper model and pastes results back for review.

## Output when the user asks for a plan or a token audit

Plan: (1) a one-line verdict on whether delegation is worth it, (2) the task list with an agent and tier for each, (3) the specs, (4) the order to run them, (5) what the brain checks on review. Audit of the current chat: name the biggest token sinks (large pastes, full-file reads, long tool output, a long history) with one fix each, and recommend a `context-compressor` checkpoint if the history itself is the cost. Keep it short.
