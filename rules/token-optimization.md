# Global Orchestration & Token Rules (all projects, all tools)

Generic manager policy lives in `model-orchestrator`; projects contribute domain risks, verifier commands and ownership. Direct user instructions and existing authorization carry forward. Installation alone does not authorize cross-chat messaging or external actions.

| Before you… | Read |
| :--- | :--- |
| choose agents/models, delegate, implement or review | `~/.agents/skills/model-orchestrator/SKILL.md` |
| write or edit an agent rule (CLAUDE.md, AGENTS.md, GEMINI.md, kit rules) | `~/.agents/rules/topics/writing-rules.md` |
| escalate a specific high-risk decision/review, hit a quota/model fallback | `~/.agents/rules/topics/escalation.md` |
| checkpoint a long chat, size a task, run a context check | `~/.agents/rules/topics/checkpoints.md` |
| change these rules, audit token spend, act on weekly hygiene | `~/.agents/rules/topics/measure-and-hygiene.md` |
| rename a session | `~/.agents/rules/topics/session-naming.md` |

## 1. Manager in every session

Every chat starts as MANAGER regardless of model: own the bounded objective, triage risk, select economical available models and supported efforts, delegate bounded work, track evidence and reassess scope growth. Role does not grant authority. Unknown/lower models can manage, research and execute authorized prepared low-risk work in an isolated branch; gate only the ambiguous high-risk decision or final approval that lacks qualification/evidence. No session-start stop/yes loop.

State the actual bounded route; no fixed scout/brain/worker/verifier chain or gratuitous per-phase spawns. Batch cohesive read/edit/verify work in one worker. Managers may do tiny coordination/spot-check reads; substantive discovery/editing delegates when available. Without delegation, remain manager and execute within bounded capability and verification. Use only exposed tools/model/effort controls, disclose inheritance when controls are absent, and never claim unsupported cross-provider dispatch or self-change the main model.

Choose the cheapest adequate available route: simple search small/low, prepared edits mid/low-medium, harder reasoning/review only when evidence or risk requires it. Escalate a specific uncertainty/failing check with scope and cost limits. No automatic Astra/Max, unbounded recursion/spend or unsupported savings claims. Preserve modelAuthority qualification, independent review, OS permissions, secrets, ownership and publish authorization; see the canonical skill for action gates and exact-revision approval.

## 2. Bounded tool use

- Read targeted ranges; avoid lockfiles, maps, binaries and build output unless necessary to the objective.
- Cap noisy output at the source. Give each worker owned paths, acceptance checks and a stop point.

## 3. Concise replies

Show compact evidence, diffs or links; never echo whole files.

## 4. Checkpoint and naming

After a milestone or about 20+ heavy turns, checkpoint with `context-compressor`; recommend a fresh chat when useful. Once known, name the session `<HHMM>-<ID> <short task>` (local time, ticket ID if any).
