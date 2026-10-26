---
name: "model-orchestrator"
description: Route work among available coding agents and model tiers, delegate bounded subtasks, review results, and preserve cross-tool handoffs. Use for agent/model choice, delegation, quota or token planning, and switching tools mid-project.
metadata:
  version: 1.1.0
---

# Model Orchestrator

Spend judgment where it matters and measure the cost of delegation. This skill owns **who does the work**; `context-compressor` owns conversational checkpoints in `CONTEXT.md`. The user should not carry context between tools by hand.

## Step 0: Respect the project's setup

Read project entrypoints (AGENTS.md / CLAUDE.md / GEMINI.md) and use their task board, ownership, model gate, art pipeline, and verification commands. A direct user request takes precedence. Existing authorization carries forward; do not invent a new approval gate.

Use the **actual running model**, not the product name, to establish its tier. A project rank table overrides the kit table; an unknown model is not automatically a brain. A top-ranked Codex model is a peer brain alongside top-ranked Claude and Gemini models. Preserve assigned tickets and active claims when choosing who works next.

## Step 1: Pick the agent

| Agent | Use it for | Limits |
| :--- | :--- | :--- |
| **Gemini / Antigravity** `@gemini` | Routine edits, content, pipeline runs; default image work where the project uses Gemini | Top-tier decisions require an actually top-ranked model |
| **Claude Code** `@claude` | Architecture, hard bugs, refactors, implementation and review | Tier follows the actual model; use its available tools |
| **Codex** `@codex` | Architecture, hard bugs, refactors, implementation and review | Peer brain only on a top-ranked model; tool access and effort controls vary by session |
| **xAI Grok** `@grok` | Wit, names, lore, divergent ideas, math/code second opinions | Paid external calls; advises, never decides top-tier work; no repo access |
| **User** `@user` | Secrets, account actions, taste and decisions reserved for the user | Do agent-executable work before asking for a concrete final approval |

Choose the active capable top-ranked brain for judgment, respecting project ownership and available quota. Do not route every decision to Claude merely because an older table names it. Use measured availability/cost where known; do not assume a fixed scarcity order across providers.

| Task | Route |
| :--- | :--- |
| Project pet art or pipeline stages | Keep the project's image route (normally `@gemini`); native Codex image generation is a capability, not permission to replace that route |
| Architecture, unknown-cause bug, risky-diff review, feature specifications | Available top-ranked brain at the required effort |
| Implementation in a top-tier area | Execute the written decision with a suitable worker; top-ranked brain reviews |
| Routine code, docs, content, checks | Cheapest capable available worker; inline when delegation overhead outweighs its benefit |
| Barks, taunts, names, divergent brainstorming | Grok `auto` if connected and within budget; active agent curates |
| Formula sanity check or outside code critique | Grok as a second opinion; top-ranked brain decides |
| Taste, secrets or account action | User, only for the part that needs them |

Whichever agent is active executes `@grok` items and records the result. If Grok is unavailable, finish natively where possible. Do not spend an external call on a question already answerable from the repo.

## Step 2: The lifecycle (non-trivial work)

1. **Investigate:** bound searches and reads; return facts, root cause, paths and line numbers.
2. **Plan:** the brain chooses the minimum change. Surface unresolved material trade-offs; do not reopen decisions already authorized.
3. **Implement:** give mechanical work a tight spec; keep ambiguous or subtle work with the brain.
4. **Verify:** use the project's checks, report their actual results, and repair failures. The same error twice means stop and report the blocker.
5. **Review and checkpoint:** the brain checks the diff and evidence, records the baton, and checkpoints long conversations when useful.

Trivial answers from loaded context, one-line edits, or a couple of quick calls can stay inline. Delegation is useful when its expected latency or context benefit justifies the additional work.

## Step 3: Delegate inside the tool?

Prefer a cheaper capable tier for collection, mechanical edits and verification. A bounded same-tier helper is also reasonable for independent work, faster completion or isolating a large context. State that purpose; do not describe it as token savings without measurements. Avoid a cold spawn for work simpler than its setup.

Native subagents work **under the parent's ticket**: give each a goal, owned files or read-only scope, constraints, done-when and a stop point (about 30 calls or sooner). They return results to the parent, which reviews and integrates. Do not create a persistent BACKLOG ticket or claim for every temporary helper. Keep shared-checkout edits disjoint.

Native agents inherit the model unless the tool actually supports an explicit override. Use only the model and effort controls exposed by the current environment. Do not invent a cheaper model, change the main session's model yourself, or assume a tool has another provider's agent types.

### Codex worker defaults

Use the currently exposed native model list and the rank table; a rank is a project role, not a provider guarantee. Register exact IDs before routing and leave unfamiliar variants gated. The registered GPT worker routes are:

| Work | Native model | Effort starting point |
| :--- | :--- | :--- |
| Inventory, extraction, simple checks | `gpt-6-luna` (small) | low for mechanical work; high for a harder scan |
| Implementation from a decided spec | `gpt-6.1-sol` (mid); `gpt-6-sol` when explicitly available | medium |
| Bounded visual/computer-use work | `gpt-6.1-terra` (mid), with the required tools exposed | medium |
| Top-tier ruling or demanding independent review | `gpt-6-astra` (top), or the existing top-ranked main brain | high |

Pass both model and supported effort explicitly so helpers do not inherit an expensive main setting by accident. If the spawn API requires fresh context for overrides, use that mode and supply a self-contained spec. Effort never changes model rank. A lower-tier native worker may execute the brain's decided spec and return its result; the parent retains judgment, verification and closure. Standalone fallback-session restrictions still apply. Do not switch the main model or rewrite global configuration to achieve this.

## Step 4: Pick the tier

| Tier | Typical work |
| :--- | :--- |
| Small | File search, summaries, content, checks, mechanical work from a spec |
| Mid | Features and refactors inside a module; implementation from a design |
| Top | Architecture, difficult debugging, high-risk judgment, final review |

Use the rank table and the actual model ID. A wrong result twice needs a better model, better specification, or missing information, rather than another identical retry.

**Minimum tier: hard work goes straight to a top-ranked brain at high effort.** This includes architecture/design, costly-to-reverse decisions, unknown-cause bugs after a real attempt, conflicting constraints, security, data-loss or money risk, and the project's additional top-tier areas.

The default floor covers auth/sessions/permissions; money, wallets and payouts; schemas, migrations and persisted formats; public API/SDK/protocol contracts; secrets/cryptography; concurrency and shared or distributed state; deploy, infrastructure and CI that ships code; deleting or retaining user data; changes across 4+ files. Projects may add areas; lowering the floor needs a written reason in their minimum-tier table (`assets/min-tier.template.md`).

### Effort ladder

Medium for execution; high for every top-tier ruling and for retrying a medium attempt that failed a test, typecheck or visual check; xhigh only to retry a failed high attempt; never max. If xhigh also fails, stop and report the missing information. Silent-failure math, costly-to-undo decisions and security need high plus a meaningful check (a targeted test, second review or preview); more thinking does not replace that evidence.

Check the actual model before each such decision: quota fallback can change it. Effort names and controls are provider-specific. Never claim to have changed your own model or effort. If required controls or a top model are unavailable, use a supported escalation or explain the constraint under the project's model gate.

| Situation | Action |
| :--- | :--- |
| At/above the required tier and effort | Decide and write the decision; delegate specified execution when useful |
| Below tier, top brain reachable | Use an available top-model subagent or queue a persistent handoff to the appropriate top-ranked agent |
| Top brain unavailable, decision hard to reverse | Stop that decision and queue the missing top-tier work |
| Top brain unavailable, reversible draft requested/authorized | Label the draft and queue top-tier review; commit nothing irreversible |

Draft header: **DRAFT, below required tier.** Model: `<id>`; required tier and trigger; confidence; unknowns; review ticket. User permission to proceed below tier is draft authorization, not a model promotion.

The deciding brain records the ruling in the project's decision folder, or its task spec when no folder exists. Use `assets/decision-note.template.md`: model, status, context, decision, why, rejected options, done-when, open questions, ripple. A dropped/superseded decision needs its dependent tickets, skills and checkpoint updated; executors check the note's status first. Lower tiers relay and execute the ruling; a new fork goes back to the brain.

Respect project main-session model gates. Recommend a smaller model only when appropriate; do not promise a fixed quota multiplier. Measure real usage in the environment where it occurs.

## Step 5: Write a tight task spec

Use `assets/task-spec.template.md`: goal, exact files, concrete instructions, constraints, checkable done-when, short output format. Give workers the minimum necessary context; split independent work so one failure does not block all of it.

## Step 6: Review the diff

Compare the diff and verification evidence against done-when. Check scope, failure paths and changed behavior. Accept or request a specific correction; re-read whole files only when needed. The active top-ranked brain can review another tool's work unless the project reserves that review for a named owner.

## Step 7: Hand work across tools

Persistent cross-tool work goes through the project's shared board: a self-contained `@gemini` / `@claude` / `@codex` / `@grok` / `@user` item with paths and verification. Preserve existing owners; do not retag their work merely because a different brain is active. If there is no shared board, provide a paste-ready task spec.

Native subagent collaboration from Step 3 is separate from a persistent handoff. Do not create user-visible chats or send messages into existing chats unless the user asks. At quota exhaustion, save the baton before stopping; the next agent still follows the minimum tier.

## Step 8: Grok pre-flight and banners

Use the bridge's `auto` model routing unless the user requests a specific model. Check connected tools and the monthly budget once per batch. Below 10% remaining, call only on an explicit user request; at zero, finish natively where possible. Follow project limits and keep secrets out of prompts.

Before a paid dispatch, show the model, task and remaining USD budget. Afterward, show actual token/cost consumption and updated budget. Do not claim savings or usage the bridge did not report. Record curated results in the repo; on failure, finish safely with available output and clean up only the relay snapshot this call left.

## Environment details

- **Claude Code:** use available Explore, worker and verifier definitions and model/effort controls; do not assume every installation has the same agents.
- **Antigravity:** use available research/worker controls; cheaper research models are preferred. Project-specific routing wins.
- **Codex:** discover canonical skills in `~/.agents/skills` and project `.agents/skills`. Read the project's entrypoint and referenced canonical rules; Claude/Gemini hooks and transcript measurements do not automatically run here. Use native collaboration tools for bounded helpers, retaining parent ownership and reviewing returned work.
- **Plain chat:** when no delegation tools exist, supply a task spec. Do not pretend a worker was run.

For a plan, show route, bounded tasks, their dependencies and what the brain verifies. For a token audit, identify measured sinks and one concrete fix each; distinguish tool-specific measurements from estimates.
