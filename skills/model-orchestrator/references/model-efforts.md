# Supported effort versus benchmark evidence

Keywords: effort, thinking, low, medium, high, xhigh, max, ultra, Argon, model controls

Checked **2026-10-28** against provider API documentation. Machine-readable controls and primary URLs: `<kit>/model-efforts.json`. These are supported controls, not quality, price or availability guarantees. API, agent UI and bridge controls can differ. A setting without a score is **unmeasured**, not unsupported or zero intelligence.

| Exact registry key | Documented API efforts | API default | Efforts in saved AA v4.3.2 snapshot | Supported but unmeasured in saved snapshot |
|---|---|---|---|---|
| `gpt-6-astra` | low, medium, high, xhigh, max | unverified | medium, high, xhigh, max | low |
| `gpt-6.1-sol` | low, medium, high, xhigh, max | medium | medium, high, xhigh, max | low |
| `gpt-6-sol` | none, low, medium, high, xhigh, max | medium | high, max | none, low, medium, xhigh |
| `gpt-6.1-terra` | none, low, medium, high, xhigh, max | medium | high, max | none, low, medium, xhigh |
| `gpt-6-luna` | none, low, medium, high, xhigh, max | medium | high, max | none, low, medium, xhigh |
| `claude-opus-5-5` | low, medium, high, xhigh, max | medium | medium, high, xhigh, max | low |
| `claude-fable-5-1` | low, medium, high, xhigh, max | high | medium, high, xhigh, max | low |
| `claude-sonnet-5-5` | low, medium, high, xhigh, max | high | high, max | low, medium, xhigh |
| `claude-haiku-5-5` | low, medium, high, xhigh, max | medium | high, max | low, medium, xhigh |
| `gemini-4-argon` | low, medium, high | medium | high | low, medium |
| `gemini-3.8-flash` | low, medium, high | medium | high | low, medium |
| `gemini-3.6-flash` | minimal, low, medium, high | medium | unmeasured | minimal, low, medium, high |
| `gemini-3.5-flash-lite` | minimal, low, medium, high | minimal | unmeasured | minimal, low, medium, high |
| `gpt-5.6-sol` | none, low, medium, high, xhigh, max | low | unmeasured | none, low, medium, high, xhigh, max |
| `gpt-5.6-terra` | none, low, medium, high, xhigh, max | medium | unmeasured | none, low, medium, high, xhigh, max |
| `gpt-5.6-luna` | none, low, medium, high, xhigh, max | medium | unmeasured | none, low, medium, high, xhigh, max |
| `grok-4-7` | low, medium, high, xhigh | high | high, xhigh | low, medium |
| `grok-4.20-0309-non-reasoning` | none | none | unmeasured | none |
| `grok-4.20-0309-reasoning` | unverified exact controls | unverified | unmeasured | unverified |
| `grok-build-0.1` | unverified exact controls | unverified | unmeasured | unverified |
| `deepseek-v4.1-flash-1017` | unverified exact controls | unverified | max | unverified |
| `qwen3.8-max-0902` | low, medium, xhigh | xhigh | unreported | low, medium, xhigh |
| `muse-wonder-full` | unverified exact controls | unverified | max | unverified |
| `kimi-k3-1-pro` | unverified exact controls | unverified | unreported | unverified |

Gemini Argon and Flash both support low/medium/high. Argon defaults to medium. Only their high settings were included in the historical benchmark snapshot; this does not justify always paying for high. Minimal is not a native setting for these two models, and max is not a Gemini thinking level. [Google model controls](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking.md).

The four listed Claude models support all five effort levels, but identically named efforts do not imply identical token use between releases. [Anthropic effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort). OpenAI settings and defaults are linked per model in the JSON catalogue. Codex-native ultra is a tool label whose API mapping/evaluation must be verified separately.

DeepSeek current aliases expose none/low/high/max; compatibility inputs collapse medium/xhigh to high and ultra to max. The exact historical snapshot key in the benchmark registry is not a verified current endpoint. [DeepSeek controls](https://api-docs.deepseek.com/guides/thinking_mode/). Qwen exposes low/medium/xhigh plus a thinking budget, with explicit aliases described in the JSON; its AA effort remains unreported. [Qwen API controls](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions). Grok 4.7 exposes low/medium/high/xhigh. [Grok model](https://docs.x.ai/developers/models/grok-4.7).

Check a project's exact selected models and bridge routes too. Family patterns such as opus/sonnet/pro, generic aliases and auto routes do not identify a release. Resolve them before dispatch, then record actual effort, fallback, harness/tools and billing surface. Do not invent missing per-effort scores or copy high into low/medium. Live AA pages now show v5.0; refresh the comparable cohort and leader together rather than adding v5 scores to v4.3.2.
