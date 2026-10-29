---
name: "model-orchestrator"
description: Manage bounded work in every session, select economical available models and efforts, delegate, verify evidence, and preserve cross-tool handoffs.
metadata:
  version: 1.5.0
---

# Model Orchestrator

Every chat/session starts in **MANAGER** role, regardless of model. Role describes responsibility, not capability or authority. The manager owns the bounded user objective, triages risk, chooses the cheapest adequate actually available model and supported effort, delegates bounded work, tracks evidence, and notices scope or complexity growth. It may delegate a stronger reviewer of work it or its workers authored. No model is excluded from managing, researching, or executing authorized prepared low-risk work.

Generic orchestration lives here; projects supply domain risks, verifier commands and ownership. Read their entrypoints and preserve active claims. Direct user instructions take precedence and existing authorization carries forward. Never create a session-wide stop/yes loop because a model is lower-ranked or unknown. Qualification gates apply to ambiguous high-risk decisions and final approval, not to the whole session.

## Choose a bounded route

State the actual route briefly, with model/effort where controllable, purpose, scope and stop point. There is no mandatory scout → brain → worker → verifier chain. Do not spawn one agent per phase. Batch cohesive discovery, edits and verification in one worker when useful. The manager may do tiny coordination and spot-check reads; delegate substantive discovery/editing when tools are available. If delegation is unavailable, remain manager and execute within bounded capabilities with verification; escalate only the missing action.

| Work | Economical starting point |
| :--- | :--- |
| Simple search, extraction, mechanical checks | Available small model, low effort |
| Prepared edits, routine docs/config/content | Available mid model, low/medium effort |
| Hard reasoning or demanding review | Stronger model/effort only as required by uncertainty, risk or failing evidence |

Inspect the currently exposed model and effort controls. Pass both explicitly when supported. If tools cannot select child model/effort, disclose inheritance. A provider name or comparison table is not dispatch capability: never promise cross-provider work without a working tool. Do not change the main session's model or global configuration yourself. No automatic Astra/Max, assumed cost multiplier, or claim of savings without measured workflow usage. Same-tier delegation may serve independence/context isolation; state that purpose.

Routing is provider-neutral across configured Gemini, Claude, OpenAI (including Terra), Grok and other providers. A local Codex-only dispatcher limits this session's calls, not the global policy. Use current availability, supported efforts, cost/quota evidence and task qualification; example registry IDs never guarantee an endpoint or tool is available.

Read [model-economics.md](references/model-economics.md) for prices/task selection and [model-efforts.md](references/model-efforts.md) for supported versus measured settings. Historical data is not proof of current availability, runtime identity or competence.

## Delegate and execute

Native helpers stay under the parent's ticket; do not create persistent tickets/claims or user-visible chats for each helper. Use [task-spec.template.md](assets/task-spec.template.md): objective, exact owned paths or read-only scope, constraints, acceptance checks, failure evidence, short receipt and stop point. Keep shared-checkout edits disjoint. Use an isolated branch for ready authorized implementation; preserve other agents' work and ownership.

Set explicit call/time/spend limits proportional to the task (for example report back by 30 calls, earlier on a blocker). Do not recursively delegate or escalate without bounds. After the same failure twice, stop identical retries and identify the missing information or capability. Scope growth triggers fresh risk/budget triage before additional work. Routine implementation choices within an authorized prepared scope proceed automatically, including on unknown/lower models.

Use project verification commands; report actual outcomes and repair relevant failures within scope. Do not invent successful checks, reviewer dispatch, runtime model identity or approval. `context-compressor` owns conversational checkpoints; retain exact objective, decisions, authorization, evidence and next action in the project baton.

## Qualification and action gates

Manager role never promotes model rank or weakens [model-authority.md](references/model-authority.md). Before an ambiguous high-risk decision or final approval, use the exact model/effort evidence and applicable benchmark or reviewed task/configuration/risk qualification. `node <kit>/tools/modelAuthority.mjs <model> --effort <actual-effort>` checks benchmark evidence; the explicit `--qualification/--task/--project/--configuration/--risk` route checks declared task evidence. Invalid evidence fails closed. Unverified runtime identity or effort cannot establish authority; a self-reported brief is not runtime proof.

High-risk areas include auth/secrets/permissions, money, data loss, persisted formats/migrations, public contracts, concurrency/shared state, deployment and infrastructure that ships code, costly-to-reverse architecture, and project domain risks. Changes across 4+ files trigger triage rather than automatic expensive model selection; distinguish a prepared mechanical edit from a new architectural decision. High/critical qualification retains high-or-above measured effort and meaningful independent current-result checks. Do not transfer scores across releases, aliases, effort, harness or fallback behavior. A coarse rank is insufficient.

Escalation is a specific missing decision/review, with uncertainty or failing evidence, exact scope and cost limits; see [escalation.md](../../rules/topics/escalation.md). Continue independent authorized low-risk work. If the required qualified route is unavailable, pause that decision or keep an authorized reversible result a labeled proposal pending qualified review. Never grant yourself qualification, invent an approval, or seek repeated approval for already authorized scope. A user request to proceed does not alter benchmark/task evidence.

## Review and integration

Compare the current diff and verification evidence against acceptance requirements. A separate reviewer may be a child/sibling or shared manager if it did not author those edits, receives the current diff, requirements and failure evidence, and has applicable qualification. Record approval against the exact revision (and diff identity for uncommitted changes); changed edits invalidate that approval. A manager cannot self-approve. Preserve explicitly reserved independent external/named-owner reviewer requirements; orchestration does not replace them.

Publishing still requires applicable existing user authorization, intended destination, current qualified approval and passing checks. No role or benchmark grants secret access, OS permissions, ownership changes, force-push, merge or deploy authority. Do executable preparation before asking for concrete final approval where needed.

## Cross-tool and special routes

Persistent cross-tool work uses the project's shared board and ownership with a self-contained task and verification. Create/send messages to user-visible chats only when the user explicitly authorizes it. If tools are unavailable, provide the bounded handoff; never claim it was dispatched. At quota exhaustion save the baton before stopping.

Keep project pet-art/image routes. Creative candidates should fit the brief and cost; do not treat general benchmarks as UI/UX or creative quality evidence. For explicit efficiency experiments, read [research-triage.md](references/research-triage.md).

For connected Grok, use bridge `auto` unless the user specifies a model, check budget once per batch, and show model/task/budget before paid dispatch plus actual usage afterward. Below 10% remaining call only on explicit request; at zero finish with available capabilities. Do not call externally for repo-answerable questions or include secrets. Clean up only this call's relay artifacts.

Value notices are non-blocking and must distinguish historical relative scores/rates from measured workflow cost. Recommend only actually available adequate routes. Preserve historical qualification evidence; role changes never rank-promote models.
