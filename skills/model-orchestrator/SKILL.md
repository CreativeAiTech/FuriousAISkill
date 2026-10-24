---
name: "model-orchestrator"
description: Decides who does a task and how cheaply. First WHICH agent (Antigravity Gemini for routine work and all images, Claude Code for architecture, hard bugs, cross-file refactors and review, xAI Grok via MCP for wit, banter and brainstorming), then WHICH model tier inside it, then how to delegate (investigate → plan → implement → verify → review, tight task specs, diff review) and how to hand work across tools. Use whenever the user asks "who should do this", "which agent", "which model", "ask Grok", mentions saving tokens, token limits, quota, auditing token spend, Haiku vs Sonnet vs Opus, delegating to subagents, tagging backlog items, or switching tools mid-project, even if they don't say "orchestrator".
metadata:
  version: 1.0.0
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
| **xAI Grok (MCP)** `@grok` | Paid per token, but cents per call at game-content scale; monthly USD budget | Dialogue, barks, flavor text, names, lore, divergent brainstorming, math and code second opinions | Code edits (no repo access), anything with secrets, **deciding** top-tier work (Step 4) |
| **User** `@user` | — | Secrets and key rotation, taste calls, approvals, account actions | Work an agent can do |

**Spend the cheapest resource that does the job well.** Scarcity order, scarcest first: the Claude window → Gemini quota → Grok dollars (cents per call). So Claude only does what nobody else does as well (judgment), Gemini carries the volume, and Grok takes every creative and second-opinion job it's good at. When a Grok upgrade (flagship or reasoning model) does a job clearly better, use it: it still costs cents, far less than the Claude window it saves.

**Task → agent** (first match wins; the user never has to pick):

| Task | Agent · model |
| :--- | :--- |
| Images, art, pet pipeline stages | `@gemini` (or `@user` if its image quota is out) |
| Top-tier decision (Step 4), hard or unexplained bug, risky-diff review, splitting a feature into specs | `@claude` · Opus |
| Code in a top-tier area | Gemini or a Claude worker implements from a written decision; `@claude` reviews |
| Routine code, single-file features, JSON content, docs, tests, git, pipeline runs | `@gemini` · Flash (Pro for subtle edits) |
| Bulk mechanical edits from a spec | `@gemini`, or a Sonnet `worker` if you're already in a Claude session |
| Barks, taunts, NPC and rogue dialogue, item flavor text, names | `@grok` · `auto` (non-reasoning) |
| Brainstorm 10+ creatures, skills, mechanics | `@grok` · `auto`; curate; Claude decides if it touches a top-tier system |
| Lore, quest chains, long narrative arcs, world-building | `@grok` · flagship (`grok-4.7` class) |
| Balance-formula or game-math sanity check | `@grok` · reasoning, as a cheap pre-check before Claude decides |
| Outside critique of a risky code diff | `@grok` · `grok_review_code`, as a second opinion; Claude decides |
| Secrets, taste calls, approvals, account actions | `@user` |

**`@grok` items are run by whichever agent is active** (Grok has no repo access and never picks up work): call the Grok MCP (or the project's CLI fallback), curate the output, write it into the repo yourself, log it. If no Grok tool is connected, do it natively. Never spend Grok on routine code or questions you can answer directly.

## Step 2: The lifecycle (non-trivial work only)

1. **Investigate** (worker or read-only subagent): searching and reading stay inside the worker. It returns only root cause, file paths and line numbers.
2. **Plan** (brain): the minimal edit plan. If there are real trade-offs, ask the user first.
3. **Implement** (worker for mechanical or well-specified edits, brain for subtle ones): drafts stay out of the main thread.
4. **Verify & self-heal** (worker): run the typecheck and only the relevant tests. Fix failures in place, at most 2 attempts on the same error, then stop and report the blocker. Return 2-3 lines ("tsc clean, 12/12 tests pass").
5. **Review & checkpoint** (brain + user): present the diff and the verify result. After an approved milestone, checkpoint with `context-compressor` if the chat is long.

Only trivial work (answer already in context, ≤2 quick tool calls, a one-line edit) skips this and runs inline. Everything else is delegated by default (global rule "Orchestrator-first").

## Step 3: Delegate inside the tool?

Delegation is the default (global rule "Orchestrator-first"). The only exception is trivial work, where a cold subagent spawn (~15-20k tokens of setup) costs more than the task.

**Only delegate down a price tier** (Haiku/Sonnet under Opus, Flash-Lite under Flash, Flash under Pro). A same-tier worker costs more than inline; use one only to isolate a big messy task. Cap it: tight spec, line-range reads, report back after ~30 tool calls.

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

### Minimum tier: hard work goes straight to the top (skip the ladder)

The top tier (Opus / Pro class, at high effort) is the **minimum** for any of these:
- an architecture or design decision, or one that's costly to reverse (data model, save format, engine/combat core, public API)
- a bug whose cause is still unknown after one real attempt, or the same error twice
- you're stuck: going in circles, conflicting constraints, or no confident approach
- security, data-loss, or money risk
- a decision in any of the **default top-tier areas** below, or in an area the project's rules add

**Default top-tier areas (a floor in every project).** Deciding anything here needs the top tier: auth, sessions and permissions; payments, money, wallets, payouts; database schema, migrations, and persisted or saved data formats; public API, SDK, or protocol contracts; secrets and cryptography; concurrency and shared or distributed state; deploy, infrastructure, and CI that ships code; deleting or retaining user data; changes spanning 4+ files. Projects add their own areas in a "Minimum tier" table in AGENTS.md (template: `assets/min-tier.template.md`). They can't silently lower a default: lowering one needs a written reason in that table. Executing an already written top-tier decision can go to any tier.

**Know what you're running on.** Your system prompt names your model; trust that, not your assumption. Re-check before each top-tier decision, not only at session start: Claude Code can switch from Opus to Sonnet when Opus usage runs out, and a failed Opus subagent call must never turn into "I'll just do it myself." Opus at low or medium effort isn't top tier for hard work either, and a session can't raise its own effort (Claude Code refuses it). So when a trigger fires below high effort: a contained question → spawn an Opus subagent with `effort: "high"` automatically (no confirmation, except the large-quota rule above) and have it write the decision note; a big decision that depends on this conversation's context → ask the user in one line to raise the effort to high, then continue.

**High vs max.** The top tier is the model; effort only sets how long it thinks. **High is the default** for every top-tier decision. Use `effort: "max"` only when at least one holds:
1. **Silent-failure math**: an error typecheck and normal tests won't catch (transforms, kinematics, numeric stability, probability, crypto).
2. **Costly to undo once shipped**: money or payouts, deleting user data, migrations of saved data or schemas already in users' hands, a released public contract.
3. **Security analysis**: auth bypass, injection, secrets exposure.
4. **Retry**: high already gave a wrong or unclear answer, or the same error came back twice.
5. **Tangled constraints**: concurrency or shared state, or 3+ constraints that pull against each other.
Caught before code, reversible, or a data-vs-spec ruling → high. Projects can list their own max areas under the "Minimum tier" table.

**Main-session model per session.** The brain doesn't have to be the top model all day: a whole session of Mid-tier work (feature work in one module, UI, pipeline tooling, tests) runs well on a Mid main session, with top-tier calls escalated to a top-model subagent at high. After claiming the task, if the main session is top tier and the task is Mid or Small, say once in one line: `Mid-tier task: switching this session to <mid model> stretches quota ≈1.7x; decisions still escalate to <top model>.` Never switch it yourself and don't repeat it. A Mid main session that hits a minimum-tier trigger escalates, never decides (the table below).

**Decide high, execute low, never guess.** A decision is made by the top tier and *written down*; everything below only relays and executes it.

| You are… | Do this |
| :--- | :--- |
| At or above the minimum tier | Decide, write it down, hand execution down to Mid/Small workers |
| Below it, and the top tier is reachable | Escalate: Claude Code → subagent with `model: "opus"`, `effort: "high"` (`"max"` only per **High vs max** above) for a contained question (ask the user first if it's large, like a whole architecture, since it spends shared quota); Antigravity → Pro-class model in the picker, or route to `@claude`. Show a one-line banner: `▲ Escalated to <model>: <why>` |
| Below it, top tier unreachable (out of quota, fallback, call failed), decision **hard to reverse** | **Stop.** Tell the user plainly: "This needs top-tier judgment and it isn't available. Wait for the quota reset or switch models." Queue a self-contained `@claude` (or top-tier) backlog item so nobody has to relay it. Produce no answer to the decision |
| Below it, top tier unreachable, decision **reversible** | Offer **draft mode** (below). Only proceed if the user agrees |
| The user says "do it anyway" | Draft mode, and log the override in the draft header |

**Write the decision down** (the top tier does this, not its caller): a decision note in the project's decisions folder if it has one (e.g. `.agents/decisions/YYYY-MM-DD-<slug>.md`), else in the backlog item or `CONTEXT.md`. Use `assets/decision-note.template.md`: **Decided by** (model), **Status**, **Context**, **Decision**, **Why**, **Rejected options**, **Spec / Done when**, **Open questions**.

**Relaying is not deciding.** A lower tier that receives a top-tier result links to it or quotes its conclusion verbatim. It doesn't paraphrase it, "improve" it, or fill gaps with its own judgment. If execution hits a fork the decision didn't cover, stop and escalate again.

**Draft mode** (below-tier work the user accepts): start the output with
> **DRAFT, below required tier.** Made by `<model>`; needs `<tier>` because `<trigger>`. Confidence: `<low|medium>`. Unknowns: `<list>`. Review queued: `<item id>`.

Commit nothing irreversible (no save-format, schema, payment or security changes land), and queue a top-tier review item that names the draft.

Once the hard part is decided and written as a spec, hand implementation back down to Mid/Small workers. Escalation buys judgment, not volume.

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
| Quota or Claude window runs out mid-task | Write the handoff first, then the user says "continue" in the next tool. Spend free or flat-rate quotas before pay-per-token credits. If what's left is top-tier work, the next tool follows Step 4's minimum tier: it doesn't finish the decision on a smaller model |

## Step 8: Grok pre-flight & banners

1. **Available?** A Grok MCP tool must be connected with a key configured. If not, do the task natively without fuss.
2. **Budget**: call the bridge's budget tool (e.g. `grok_get_budget`) once per batch of calls. Under 10% of the monthly budget left → only explicit user requests; nothing left → do it natively.
3. **Before dispatching**, show:
   > 🔄 **[AI Subagent Dispatch: xAI Grok <model>]**
   > • **Task**: `<task description>`
   > • **Budget Remaining**: `$X / $Y`
4. **Afterwards**, show:
   > ✅ **[AI Subagent Complete: xAI Grok <model>]**
   > • **Consumed**: `N tokens ($cost)`
   > • **Updated Budget Remaining**: `$X / $Y`

Banners apply **only to Grok** (the paid external call). The agent runs all commands; the user never does.

## How to run this in each environment

- **Claude Code**: the main session is the brain. `Explore` agent for wide read-only searches, the global `worker` agent (sonnet) for edits from a spec, and the `verifier` agent (haiku) for checks. Pass `model: "haiku"` to Explore. Only trivial work stays inline.
- **Antigravity**: `research` on `flash_lite` for investigate and verify (never on Flash). Implement inline when the main session is Flash; spawn a `flash` worker only under a Pro main, or to isolate a big messy task. Or switch the model dropdown per task.
- **Claude app or any plain chat**: no automatic delegation. Output task specs as copy-paste blocks; the user runs them in a cheaper model and pastes results back for review.

## Output when the user asks for a plan or a token audit

Plan: (1) a one-line verdict on whether delegation is worth it, (2) the task list with an agent and tier for each, (3) the specs, (4) the order to run them, (5) what the brain checks on review. Audit of the current chat: name the biggest token sinks (large pastes, full-file reads, long tool output, a long history) with one fix each, and recommend a `context-compressor` checkpoint if the history itself is the cost. Keep it short.
