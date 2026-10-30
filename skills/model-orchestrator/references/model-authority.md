# Model authority and benchmark snapshot

Keywords: model, rank, brain, architect, effort, benchmark, score, IQ, push, publish, proposal

Checked **2026-10-27**. Canonical machine-readable data: [model-ranks.json](../../../model-ranks.json). Evaluate with [modelAuthority.mjs](../../../tools/modelAuthority.mjs).

Those relative links describe the Git repository layout. In a generated Claude/Gemini skill copy, resolve them from the installed FuriousAISkill repository (normally `~/.agents`), not from the generated skill directory. In commands below, `<kit>` means that repository root.

**Freshness notice (2026-10-28):** live AA model pages now report Intelligence Index v5.0. The scores and roles below remain the historical v4.3.2 snapshot; they are not a refreshed v5.0 ranking. Refresh the full comparable cohort and leader together before a new benchmark-based ruling. Current prices have a separate checked date and do not refresh benchmark evidence.

## Decision rule

There are two explicit evidence routes: the benchmark gate below, or a reviewed qualification for an exact project/task/configuration/risk in [model-economics.md](model-economics.md). A task-qualified model may exercise judgment only inside that scope, even below the aggregate benchmark cutoff. Cost alone cannot qualify it. Every session has manager role independently of this authority; qualification gates the specific high-risk decision or final approval, never session startup.

For the **benchmark route**, a brain is a model whose exact listed effort scores **at least 49.3** on the benchmark below. That is **85% of the 58-point leader**, frozen as an absolute score (`authority.bar.score`). Rules:

- The score at the exact listed model and effort alone decides. There is no separate high-effort floor: Opus 5.5 medium (51) is a brain; Fable 5.1 medium (49) is not.
- A new leader on the same benchmark version does not move the bar. Only a benchmark version change does, and then the whole cohort and the bar are refreshed together.
- There is no expiry. `checkedAt` is provenance only; a future-dated `checkedAt` is still rejected.
- No score transfers between efforts, model releases, aliases, harnesses or fallback configurations. `default`, unreported and unknown efforts and missing scores never qualify.
- The code floor for `bar.percent` is 85. Lowering it needs a code change, not a data edit. The code also pins the absolute bar per benchmark version (`FROZEN_BAR`, 49.3 for v4.3.2): raising `bar.score` in data is allowed, lowering it or adding a new benchmark version needs a code change. `bar.score` must equal `percent * ofLeaderScore / 100` (within 0.05) and cannot exceed the leader.

The task route uses its reviewed quality/risk requirements. A valid task qualification need not have an aggregate benchmark score.

This is a relative benchmark index, **not human IQ or a measurement of percentage intelligence**. The AA scores are rounded and do not establish statistically significant differences at this boundary. The cutoff is strict on the recorded scores: 49 is out and 50 is in; new higher-precision evidence may change the result. Architecture performance still needs task-specific review and tests. These are a sourced benchmark audit, not paid model trials run by this library.

Use **Artificial Analysis Intelligence Index v4.3.2** throughout this snapshot. [The benchmark owner](https://artificialanalysis.ai/models/) documents ten component evaluations and the version. Never mix older launch scores, other index versions, Elo or vendor-specific harness scores into this denominator. The observed leader is [Claude Opus 5.5 Max with default fallback: 58](https://artificialanalysis.ai/models/claude-opus-5-5). The brain bar is **49.3** raw points.

## The check command and derived permissions

```sh
node <kit>/tools/modelAuthority.mjs check claude-opus-5-5 --effort medium [--table path] [--prices path]
```

It prints JSON (model, effort, brain, code name, tools, score, bar, tier, permissions, reason). Exit 0 means brain, 2 not a brain (including unknown models and efforts), 1 usage/read/parse error. The verdict comes only from the score rule above. A brain gets `decide`, review of anything, merge with user authorization and push to `main`, force-push only with lease and owner approval. A non-brain gets bounded review, no merge, and bookkeeping fast-forward pushes only. Permissions are derived in code, never read from JSON. `delegateTo` lists the code names of models whose output price (`model-prices.json`) is at or below this model's; a missing or broken price file gives an empty list and never changes the verdict. The declaration is an honour system: the checker cannot attest which model is actually running.

`model-ranks.json` holds a `models` map (exact id to code name and tools) and a `brains` map per tool. The `brains` map only labels eligible brains and never grants brain status.

| Tool | Preferred brain (cheapest that qualifies, use by default) | Overkill (escalate only for a hard call) |
| :--- | :--- | :--- |
| `claude-code` | `opus-5.5` medium | `opus-5.5` xhigh and max; `fable-5.1` high, xhigh and max |
| `codex` | `sol-6.1` high | `sol-6.1` max; `astra-6` medium, high, xhigh and max |
| `antigravity` | `argon-4` high | none |
| `grok-mcp` | none | none |

A non-brain escalates to the preferred brain of its tool; a brain escalates to an overkill entry only when the decision justifies the cost.

## Permissions

| Role | Work allowed within the user's authorized scope |
| :--- | :--- |
| Verified brain | Architecture decisions, task specifications, implementation and final review; meaningful verification still required |
| Applicable task qualification | Scoped judgment and review within its exact task/risk; no global promotion; high-risk verification remains |
| No applicable qualification and below benchmark gate | Manager, research and proposals; execute authorized prepared low-risk work in an isolated branch with verification; obtain qualified high-risk decisions/final approval |
| Unverified model/configuration | Manager and bounded research/prepared low-risk execution; no inferred authority or self-promotion |
| Publishing executor | Execute an explicitly authorized push/merge/deploy after eligible brain review of the current diff and passing checks; model score alone grants no publish rights |

Use current session model and effort evidence; do not infer them from the product name or an advertised selectable-model list. The checker evaluates recorded benchmark evidence; it cannot attest which model is actually running. If identity, effective effort, evaluated fallback behavior or endpoint mapping cannot be verified, qualified rulings remain proposals; bounded authorized prepared work can proceed. The task checker evaluates declared reviewed evidence; it cannot attest runtime identity or honest evaluations. Resolve aliases to verified registry keys explicitly; no substring promotion. Registry keys in the table are local identifiers, not a promise that every provider accepts that exact API string.

An existing authorized publish flow does not need repeated approval. A new destination, force-push, release or deployment requires its own applicable authorization. Workers may run the mechanical publish command only after an eligible brain has approved the exact revision; they cannot approve themselves.

A qualified separate child/sibling/shared manager may review edits it did not author, with the current diff, requirements and failure evidence. Approval binds the exact revision/diff; changed edits require renewed review. Preserve explicitly reserved external or named-owner audits. Manager role does not change evidence or permission requirements.

## Historical comparable configurations (v4.3.2)

**Brain** below means benchmark-eligible in the saved snapshot at the named configuration, subject to availability checks. Missing configurations are **unverified**, not zero. “Worker” means below this benchmark gate; an applicable task qualification is separate. Provider ordering is not a top-five claim.

| Provider / registry key | Effort | AA score | Relative /100 | Role | API input / output USD per 1M | Source |
| :--- | :--- | ---: | ---: | :--- | ---: | :--- |
| OpenAI / `gpt-6-astra` | medium | 50 | 86.21 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/gpt-6-astra-medium) |
| OpenAI / `gpt-6-astra` | high | 51 | 87.93 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/gpt-6-astra-high) |
| OpenAI / `gpt-6-astra` | xhigh | 52 | 89.66 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/gpt-6-astra-xhigh) |
| OpenAI / `gpt-6-astra` | max | 53 | 91.38 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/gpt-6-astra) |
| OpenAI / `gpt-6.1-sol` | medium | 48 | 82.76 | Worker | $2 / $10 | [AA](https://artificialanalysis.ai/models/gpt-6-1-sol-medium) |
| OpenAI / `gpt-6.1-sol` | high | 50 | 86.21 | Brain | $2 / $10 | [AA](https://artificialanalysis.ai/models/gpt-6-1-sol-high) |
| OpenAI / `gpt-6.1-sol` | xhigh | 51 | 87.93 | Brain | $2 / $10 | [AA](https://artificialanalysis.ai/models/gpt-6-1-sol-xhigh) |
| OpenAI / `gpt-6.1-sol` | max | 52 | 89.66 | Brain | $2 / $10 | [AA](https://artificialanalysis.ai/models/gpt-6-1-sol) |
| OpenAI / `gpt-6-sol` | high | 42 | 72.41 | Worker | $2 / $10 | [AA](https://artificialanalysis.ai/models/gpt-6-sol-high) |
| OpenAI / `gpt-6-sol` | max | 48 | 82.76 | Worker | $2 / $10 | [AA](https://artificialanalysis.ai/models/releases/gpt-6-sol) |
| OpenAI / `gpt-6.1-terra` | high | 44 | 75.86 | Worker | $1 / $5 | [AA](https://artificialanalysis.ai/models/gpt-6-1-terra-high) |
| OpenAI / `gpt-6.1-terra` | max | 48 | 82.76 | Worker | $1 / $5 | [AA](https://artificialanalysis.ai/models/gpt-6-1-terra) |
| OpenAI / `gpt-6-luna` | high | 33 | 56.90 | Worker | $0.1 / $0.5 | [AA](https://artificialanalysis.ai/models/gpt-6-luna-high) |
| OpenAI / `gpt-6-luna` | max | 38 | 65.52 | Worker | $0.1 / $0.5 | [AA](https://artificialanalysis.ai/models/gpt-6-luna) |
| Anthropic / `claude-opus-5-5` | medium | 51 | 87.93 | Brain | $4 / $20 | [AA](https://artificialanalysis.ai/models/claude-opus-5-5-medium) |
| Anthropic / `claude-opus-5-5` | high | 54 | 93.10 | Brain | $4 / $20 | [AA](https://artificialanalysis.ai/models/claude-opus-5-5-high) |
| Anthropic / `claude-opus-5-5` | xhigh | 56 | 96.55 | Brain | $4 / $20 | [AA](https://artificialanalysis.ai/models/claude-opus-5-5-xhigh) |
| Anthropic / `claude-opus-5-5` | max | 58 | 100.00 | Brain | $4 / $20 | [AA](https://artificialanalysis.ai/models/claude-opus-5-5) |
| Anthropic / `claude-fable-5-1` | medium | 49 | 84.48 | Worker | $10 / $50 | [AA](https://artificialanalysis.ai/models/comparisons/claude-fable-5-1-high-vs-claude-fable-5-1-medium) |
| Anthropic / `claude-fable-5-1` | high | 51 | 87.93 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/claude-fable-5-1-high) |
| Anthropic / `claude-fable-5-1` | xhigh | 53 | 91.38 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/comparisons/claude-fable-5-1-xhigh-vs-claude-fable-5-1) |
| Anthropic / `claude-fable-5-1` | max | 53 | 91.38 | Brain | $10 / $50 | [AA](https://artificialanalysis.ai/models/claude-fable-5-1) |
| Anthropic / `claude-sonnet-5-5` | high | 47 | 81.03 | Worker | $2 / $10 | [AA](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-high-vs-claude-sonnet-5-xhigh) |
| Anthropic / `claude-sonnet-5-5` | max | 56 | 96.55 | Brain | $2 / $10 | [AA](https://artificialanalysis.ai/models/claude-sonnet-5-5) |
| Anthropic / `claude-haiku-5-5` | high | 38 | 65.52 | Worker | $0.1 / $0.5 | [AA](https://artificialanalysis.ai/models/claude-haiku-5-5-high) |
| Anthropic / `claude-haiku-5-5` | max | 43 | 74.14 | Worker | $0.1 / $0.5 | [AA](https://artificialanalysis.ai/models/claude-haiku-5-5) |
| Google / `gemini-4-argon` | high | 53 | 91.38 | Brain | $2 / $10 | [AA](https://artificialanalysis.ai/models/gemini-4-argon) |
| Google / `gemini-3.8-flash` | high | 41 | 70.69 | Worker | $0.75 / $3.75 | [AA](https://artificialanalysis.ai/models/gemini-3-8-flash) |
| xAI / `grok-4-7` | high | 46 | 79.31 | Worker | $2 / $6 | [AA](https://artificialanalysis.ai/models/grok-4-7-high) |
| xAI / `grok-4-7` | xhigh | 46 | 79.31 | Worker | $2 / $6 | [AA](https://artificialanalysis.ai/models/grok-4-7) |
| DeepSeek / `deepseek-v4.1-flash-1017` | max | 45 | 77.59 | Worker | unknown | [AA](https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017) |
| Alibaba / `qwen3.8-max-0902` | unreported | 45 | 77.59 | Unverified effort | unknown | [AA](https://artificialanalysis.ai/models/creators/alibaba) |
| Meta / `muse-wonder-full` | max | 56 | 96.55 | Brain (access unverified) | unknown | [AA](https://artificialanalysis.ai/models/muse-wonder-full) |
| Moonshot / `kimi-k3-1-pro` | unreported | 55 | 94.83 | Unverified effort | unknown | [AA](https://artificialanalysis.ai/models/kimi-k3-1-pro) |

Price columns are **2026-10-28 Standard direct-API text base rates**, not per-task cost or subscription quota. All listed efforts of a model share its token rates; actual token consumption changes the bill. Haiku prices require prompts <=100K; Grok requires prompts <200K; OpenAI prices shown require prompts <=272K. Argon introductory rates expire 2026-11-30; Flash rates expire 2026-12-31. Other context/speed/region/cache/tool charges may apply. Additional active runtime models (`gemini-3.6-flash` at $0.75/$3.75, `gemini-3.5-flash-lite` at $0.30/$2.50, `grok-4.20-0309-*` at $1.25/$2.50, `grok-build-0.1` at $1.00/$2.00) are catalogued in `<kit>/model-prices.json` and `<kit>/model-efforts.json` even when not part of the historical v4.3.2 benchmark snapshot. Sources, cached rates, formulas and task categories: [model-economics.md](model-economics.md); machine-readable base rates: `<kit>/model-prices.json`. Unknown prices are not zero.

Anthropic Opus, Fable and Sonnet entries use **default fallback** in the benchmark configuration. A no-fallback deployment cannot silently inherit those scores. All other unavailable effort pairs, including Astra Ultra, remain unverified. **No effort is automatic**: only the individually measured qualifying effort passes.

## Top five configurations versus five providers

The five highest configurations in this snapshot are Opus 5.5 Max (100), Sonnet 5.5 Max (96.55), Opus 5.5 Xhigh (96.55), Meta Muse Wonder Full Max (96.55), and Kimi K3.1 Pro (94.83). Kimi lacks a reported effort in the retrieved evidence, so it cannot qualify.

For the requested OpenAI / Anthropic / Google / xAI comparison, use Astra Max (91.38), Opus Max (100), Argon High (91.38), and Grok 4.7 High or Xhigh (79.31). **Meta** is a useful fifth provider by measured score; Muse Wonder Full Max is 96.55, but AA reports no public API. Availability must be verified before dispatch. These five requested vendors are not the world's five highest-ranked vendors: Moonshot's measured result also outranks several of them. DeepSeek and Alibaba are included as additional comparisons; both listed configurations score 77.59, so neither qualifies here.

Under the 49.3 bar every recorded Astra setting (50 to 53) qualifies, and Sol qualifies at high, xhigh and max (50 to 52) but not at medium (48). That does not veto an applicable reviewed task qualification. No provider earns a guaranteed brain slot.

## Refresh and reuse

The evidence does not expire. Recheck when a new model, benchmark version or substantial regression appears. A new leader on the same benchmark version leaves the bar at 49.3; a new benchmark version needs a refreshed cohort, leader and bar together. Never lower the denominator by selecting only locally available models. Keep raw scores, exact efforts, configuration notes, URLs and checked date. A stricter project bar is allowed; the checker rejects one below 85%. The explicit reviewed-task route does not use this benchmark bar. Supported versus measured settings are catalogued in [model-efforts.md](model-efforts.md).

Project overrides replace the entire rank table. A legacy override with only regex ranks has no authority evidence and cannot grant brain status. Start from the kit table, verify the data, then add exact entries and documented stricter local restrictions. Learning a coarse “top” rank is insufficient. Unavailable models may remain comparison entries, but never pretend they were dispatched.

The Claude hook is a one-time advisory and cannot verify effort from its current transcript reader. It conservatively warns when effort is unknown; later calls still pass. The CLI and agent rules provide the decision gate, **not an OS sandbox, credential boundary, or Git protection**. Use repository branch protections for enforced publishing control.

The portable policy has no user-specific paths, account requirements or guaranteed model aliases. It remains covered by the library's MIT license. Installation alone grants no authority to contact other chats or spend on external services.
