# Results

What the kit's routing is estimated to save on one real project, from the kit's own token report.

- **Measured on**: 2026-10-30, kit version 1.9.0
- **Window**: Oct 28 to Oct 30, 2026, one game project
- **Coverage**: 23 Claude Code sessions; 64 Antigravity main sessions plus 22 subagents; Codex partial (17 sessions)

## Read this first

The dollar figures are **modeled**, not billed. They reprice the same tokens at public API list prices, as if all the work had run on the top model. That is a counterfactual.

- It is not subscription billing, not quota, and not realized savings.
- Output quality is not measured yet. These numbers say what the work would cost, not whether it was as good.
- One project, three days. Treat it as a direction, not a verdict.

## Headline: modeled price comparison

| Tool | Modeled actual | Baseline | Net difference | Net % |
| :-- | --: | --: | --: | --: |
| Claude Code vs all-Opus | $100.00 | $131.14 | $29.74 | 22.7% |
| Antigravity vs all-Pro | $81.02 | $139.13 | $56.35 | 40.5% |

Net means after the kit's own overhead is subtracted. The report also has an "Antigravity vs Claude Opus" row (70.3%). It compares two different tokenizers, so use it as a rough indication only.

## Kit overhead and delegation

The kit adds fixed text (rules, skill descriptions) to every session. That costs:

- Claude Code: $1.40, 1.4% of spend
- Antigravity: $1.75, 2.2% of spend

Delegating work to cheaper models saved a modeled $30.38 over 40 Claude Code spawns. That is about 21.8x the kit overhead.

### Delegation breakdown (Claude Code)

| Subagent / model | Spawns | Actual | Inline estimate | Savings |
| :-- | --: | --: | --: | --: |
| worker / sonnet | 22 | $16.42 | $36.04 | $19.61 |
| Explore / sonnet | 7 | $2.77 | $7.42 | $4.66 |
| general-purpose / sonnet | 2 | $0.89 | $2.09 | $1.21 |
| claude-code-guide / haiku | 1 | $0.02 | $0.81 | $0.79 |
| general-purpose / opus | 7 | $13.09 | $16.50 | $3.41 |
| worker / opus | 1 | $2.27 | $2.96 | $0.70 |
| **total** | **40** | | | **$30.38** |

Inline estimate is what the same work would cost in the main session. Antigravity delegation saved $3.04 over 22 subagent runs.

## What works

- Cheap-model delegation. Sonnet and Haiku workers did the bulk of the saving.
- Low fixed overhead, about 1 to 2% of spend.
- One set of rules across Claude Code, Antigravity and Codex.

## Not yet working, or not measured

- **Late checkpoints**: carrying long context cost $4.96, more than the kit overhead. Checkpoints should come earlier.
- **Opus subagents under an Opus session** save little: $4.11 on $15.36 of spend over 8 spawns.
- **Antigravity subagents**: 94% of their spend runs at the main model's price. Research should go to flash-lite, which saved $1.20 where it was used.
- **Routing outcomes**: n=0. None of 32 implementation spawns carried a GATE line, so whether routing gave correct results is unmeasured.
- **Codex**: coverage is partial, and no cost or quota savings are reported.
- **Unbounded reads**: one 29.7k-character read was seen in a main session.

## Reproduce

```
node ~/.agents/tools/tokenReport.mjs --project <dir> --since <ISO date> --summary
```

The full report is written to `<project>/.agents/reports/token-report.md`.

## History

Add one row per release so changes can be compared.

| Date | Kit | Claude net | Antigravity net | Overhead (Claude / Antigravity) |
| :-- | :-- | --: | --: | :-- |
| 2026-10-30 | 1.9.0 | 22.7% | 40.5% | 1.4% / 2.2% |
