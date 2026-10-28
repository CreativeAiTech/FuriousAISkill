# Model value by task

Keywords: cost, tokens, value, routing, effort, price, creativity, UI, UX, quality, budget

Use for price comparisons, effort sweeps and choosing the least costly capable route. General benchmark rank, supported effort, task qualification and economic value are separate evidence. A one-point aggregate advantage alone does not justify five times the total cost.

## The decision

For the same task set and acceptance rubric, meet the quality floor, capability requirements, risk checks and latency/budget constraints first. Prefer the candidate with the lowest **cost per accepted outcome** among those that meet them. The reciprocal is **accepted outcomes per dollar**. Give a more expensive model a particular reason: fewer costly failures, stronger work on this task, a needed capability or better end-to-end time. There is no universal golden ratio across unrelated work.

`costPerAcceptedOutcome = totalWorkflowCost / acceptedOutcomes`

Total workflow cost includes every attempt, failed run, correction, context setup, worker, model review, cache write/storage and billed tool fee. Show human review time and elapsed time separately unless a stated conversion values them in money. Zero accepted outcomes gives undefined cost/accepted and zero outcomes/dollar; unknown/zero cost never means infinite value. Sample success rates are observations, not future-success probabilities.

For uncached-input U, cache-read K and all billed output O, base token cost is `(U*inputRate + K*cacheRate + O*outputRate)/1e6`. Reasoning is already part of billed output where the provider reports it that way. Do not add it twice. Separate cache-write tokens from input totals already charged at another rate. Effort changes actual consumption and may change tool/retry behavior; do not invent a medium/high/max price multiplier.

## Different task categories

| Category | Acceptance criteria before comparing dollars | Initial candidates to evaluate, not measured winners |
|---|---|---|
| Mechanical extraction/checks | Exact recall, formatting and no unintended edits | Luna (`gpt-6-luna` low/medium), Haiku (`claude-haiku-5-5` low/medium), Flash-Lite (`gemini-3.5-flash-lite` minimal/low) |
| Coding from a specification | Required behavior, failure-path tests, maintainability, regressions | Sol (`gpt-6.1-sol` medium/high), Sonnet (`claude-sonnet-5-5` medium/high), Flash (`gemini-3.8-flash` medium/high), Grok Build (`grok-build-0.1`); escalate only for a demonstrated gap |
| Debugging/architecture/review | Correct cause/design, verified risks, project-specific review | Opus (`claude-opus-5-5` high/xhigh/max), Sonnet (`claude-sonnet-5-5` max), Argon (`gemini-4-argon` medium/high), Sol (`gpt-6.1-sol` high/xhigh/max), Astra (`gpt-6-astra` max), Fable (`claude-fable-5-1` xhigh/max); qualification and risk determine who may decide |
| UI/UX | User task completion, hierarchy, responsive states, keyboard/accessibility, visual consistency and independent/user visual review | Terra (`gpt-6.1-terra`), Sol (`gpt-6.1-sol`), Sonnet (`claude-sonnet-5-5`), Argon (`gemini-4-argon`), Flash (`gemini-3.8-flash`) at available efforts; evaluate rendered results |
| Creative/content | Brief, originality, useful ideas, brand/audience fit and user/independent preference | Grok (`grok-4.20-0309-non-reasoning`, `grok-4-7`), Claude (`claude-sonnet-5-5`, `claude-opus-5-5`), Gemini (`gemini-3.8-flash`, `gemini-4-argon`), OpenAI (`gpt-6.1-sol`); no universal creativity winner is established |
| Research | Source fidelity, coverage, contradictions and reproducible conclusions | Flash-Lite (`gemini-3.5-flash-lite`), Luna (`gpt-6-luna`), Haiku (`claude-haiku-5-5`) for collection; qualified mid/top models for synthesis |

Qualify precise subclasses, such as responsive marketing-page layout, rather than all UI work. Define the rubric/version, mandatory checks, practical-equivalence margin and any weights before scoring. Compare quality per dollar only within that same rubric and matched work; a code score cannot be divided into a design score. Do not convert general index points into percentage brainpower or task success probability.

## Current base prices and consumption

The authority table now displays Standard API input/output base rates beside effort and score. `<kit>/model-prices.json` contains exact IDs, cached-input rates, source URLs, checked dates, prompt limits and introductory expiries. Unknown prices remain unknown. [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) is 10/50 USD per million input/output tokens; [Sol 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-sol) is 2/10. At identical 100K uncached input plus 10K billed output, that is **$1.50 versus $0.30**. If Sol instead uses 30K output, it costs $0.50: consumption reduces the difference to 3x. These are arithmetic examples, not measured task costs.

Live AA **v5.0** provides a separate external example: [Astra high](https://artificialanalysis.ai/models/gpt-6-astra-high) reports score 55 and $3.24 per index task; [Sol max](https://artificialanalysis.ai/models/gpt-6-1-sol) reports score 55 and $1.27 per index task. The ratio is about 2.55x after AA's measured workload consumption. This supports evaluating cheaper equivalent candidates; it does not prove equivalence on a local UI/code task. Do not insert these v5 scores into the saved v4.3.2 authority cohort.

Primary prices: OpenAI per-model pages in the JSON; [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing); [Google](https://ai.google.dev/gemini-api/docs/pricing); [Grok](https://docs.x.ai/developers/models/grok-4.7). Recheck expired or changed prices, long context, cache writes/storage, tools, region, speed and endpoint. API list prices do not determine included subscription quota. [Codex credit pricing](https://learn.chatgpt.com/docs/pricing) uses a separate rate card.

### Cross-provider base rates and billing surfaces (2026-10-28)

All accessible providers and active runtime routes must be compared on their actual billing surface as well as modeled Standard API token rates:

| Provider / Model | Standard API ($/1M: In / Cache / Out) | 100K In (80% cached) + 10K Out | 100K In (80% cached) + 30K Out | Active Billing Surface on This Machine |
| :--- | :--- | ---: | ---: | :--- |
| **Google** `gemini-3.5-flash-lite` | $0.30 / $0.03 / $2.50 | $0.033 | $0.083 | Antigravity plan quota (`research` subagent) |
| **OpenAI** `gpt-6-luna` | $0.10 / $0.01 / $0.50 | $0.008 | $0.018 | ChatGPT Plus Codex subscription credits (~2.5/0.25/12.5 cr/1M) |
| **Anthropic** `claude-haiku-5-5` | $0.10 / $0.01 / $0.50 | $0.008 | $0.018 | Claude Pro subscription quota (`verifier` / `Explore` subagent) |
| **Google** `gemini-3.8-flash` | $0.75 / $0.075 / $3.75 (until 2026-12-31) | $0.059 | $0.134 | Antigravity plan quota (`gemini-3.8-flash-n` / `-tiered`) |
| **Google** `gemini-3.6-flash` | $0.75 / $0.075 / $3.75 (until 2026-12-31) | $0.059 | $0.134 | Gemini API / AI Studio |
| **xAI** `grok-build-0.1` | $1.00 / $0.20 / $2.00 | $0.056 | $0.096 | Direct xAI API (`$20/mo` ledger in `~/.agents/state/grok-budget.json`) |
| **xAI** `grok-4.20-0309-*` | $1.25 / $0.20 / $2.50 | $0.066 | $0.116 | Direct xAI API (`$20/mo` ledger; `FAST` and `REASONING` routes) |
| **OpenAI** `gpt-6.1-terra` | $1.00 / $0.05 / $5.00 | $0.074 | $0.174 | ChatGPT Plus Codex subscription credits |
| **xAI** `grok-4-7` (`grok-4.7`) | $2.00 / $0.50 / $6.00 | $0.140 | $0.260 | Direct xAI API (`$20/mo` ledger; `FLAGSHIP` route) |
| **OpenAI** `gpt-6.1-sol` / `gpt-6-sol` | $2.00 / $0.10 ($0.20) / $10.00 | $0.148 | $0.348 | ChatGPT Plus Codex subscription credits (1x baseline; Fast = 2x) |
| **Anthropic** `claude-sonnet-5-5` | $2.00 / $0.10 / $10.00 | $0.148 | $0.348 | Claude Pro subscription quota (`worker` subagent & fallback main) |
| **Google** `gemini-4-argon` | $2.00 / $0.10 / $10.00 (until 2026-11-30) | $0.148 | $0.348 | Antigravity plan quota (`Gemini 4 Argon` / `gemini-4-argon-trial`) |
| **Anthropic** `claude-opus-5-5` | $4.00 / $0.20 / $20.00 | $0.296 | $0.696 | Claude Pro subscription quota (primary brain when quota available) |
| **OpenAI** `gpt-6-astra` | $10.00 / $1.00 / $50.00 | $0.780 | $1.780 | ChatGPT Plus Codex subscription credits (~2.5x–5x burn vs Sol) |
| **Anthropic** `claude-fable-5-1` | $10.00 / $0.25 / $50.00 | $0.720 | $1.720 | Selectable in `.claude.json` (`claude-fable-5-1[1m]`); extra usage org-disabled |

## Offline comparison tool

Run `node <kit>/tools/modelValue.mjs <scenario.json>`. The local JSON names a taskClass, shared rubric and taskSet, requiredPassRate, and candidates. Each candidate has id, evidence (measured or scenario), completeWorkflow, attempts, accepted, and calls. A call supplies exact model/effort, service=direct-api-standard-text, inputTokens (including cache hits, excluding separately billed cache writes), cachedInputTokens, outputTokens (including reasoning), maxPromptTokens (largest prompt for any aggregated request), cacheWriteCostUsd and otherCostUsd. The last two must be explicit known totals, including storage/tools where applicable; unknown is not zero. Include every parent/worker/reviewer/retry call exactly once. The checker validates the declared ledger, not its completeness or truth.

The tool reconstructs current Standard API price equivalents. It does not measure actual billing, subscription credits or quota, and does not retrofit ambiguous token-report logs. Missing/incomplete, expired, unknown-model, wrong-service or unsupported long-context data cannot produce a value ranking. Hypothetical scenario inputs are labeled illustrations and cannot produce a measured winner. The bestObservedValue output is a sample cost comparison only; qualification, capabilities, risk, quality uncertainty and latency still require review.

A benchmark score divided by a priced workload can be a screening aid only. Index points are not a cardinal utility scale. Production selection uses accepted outcomes and actual workflow consumption rather than fabricated token-per-effort factors.

## Task-qualified judgment

The user-approved alternative to a universal benchmark cutoff is an exact, manually reviewed task qualification. `modelAuthority.mjs` with `--qualification file --task class --project id --configuration id --risk class` checks it without the global 90 cutoff. Supply `<model> --effort <effort>` too. No-context assess/CLI and project main-session gates stay independent; this route does not promote a session or change regex ranks. Invalid supplied task evidence cannot silently fall back.

A record supplies id, status=active, model, effort, project, task, configuration, risk (low/medium/high/critical), checkedAt/expiresAt, scope/exclusions, and configurationDetails with endpoint/fallback/harness/tools/settings strings. quality contains rubric, criteria, predeclared=true, artifact references, trials, accepted, minTrials and minPassRate. review contains by, approvedAt, decision reference and independent=true or user=true. verification points to meaningful checks. Counts and thresholds must describe representative real evaluation; a tiny sample does not grant broad competence. The checker validates declared metadata, not artifact contents, runtime identity, honest classification or approval authenticity.

High/critical risk additionally requires measured high-or-above effort, independent approval and currentResultReview evidence for the actual result. Project restrictions and meaningful current-result checks remain. A layout qualification cannot authorize auth, money, data-loss or deployment decisions. Model/effort/release, endpoint/fallback, material tools/harness, rubric or scope changes require requalification. Revoked/expired or mismatched records do not qualify. No ratio, qualification or benchmark grants publishing or spending permission.
