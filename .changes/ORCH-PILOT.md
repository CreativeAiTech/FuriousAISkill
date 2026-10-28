---
bump: minor
title: Add evidence-scoped research triage and authorized chat handoffs
---

**Changes**
- Add an optional research-to-experiment reference with source provenance, claim-level evidence, bounded experiments and explicit usage coverage.
- Keep simple findings brief; reserve full records for experiment and adoption decisions.
- Carry compact checkpoints into user-authorized chats when the issue changes.

**Why**
Research claims, proposed commands and smaller payloads need clear boundaries before they become implementation or savings claims. Existing routing and model-authority rules remain in force.

**Measure**
Five source-backed records passed semantic review; structural checks rejected seven deliberately invalid variants. A bounded representation pilot reduced aggregate UTF-8 payload size from 23,575 to 14,051 bytes, with one of five records growing. Task-wide tokens, costs and productivity gains remain unmeasured. Entry-point links, preserved instructions and example JSON were checked; the bundled Python validator lacked PyYAML, so targeted fallback validation was used.
