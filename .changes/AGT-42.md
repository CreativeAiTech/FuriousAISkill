---
bump: minor
title: Antigravity context meter - measured checkpoint instead of heavy-turn guess
---
**Changes**
- New `tools/agContext.mjs`: reads a temp copy of the project's newest Antigravity chat DB, prints `ctx: <now>k of 256k; growth +<n>k vs budget +<hard>k → ok|checkpoint`; daily per-project profile (median first-call prompt, p90 growth per user turn, same threshold formula as `contextProfile.mjs`) cached at `state/context-profile/antigravity-<slug>.json`. Unreadable store → one fallback line, exit 0.
- New `tools/lib/agStore.mjs`: shared protobuf decoder (`pbFields`) and chat-store helpers; `tokenReport.mjs` imports it instead of its own copy.
- `rules/token-optimization.md` §4 and `context-compressor`: Antigravity checkpoints on `agContext` → `checkpoint`; the 3-heavy-turn rule stays only as the unreadable-store fallback.

**Why**: Antigravity chats run to 180-225k prompt (measured, 2160/2160 calls parse), so a turn count never caught them; user turn = step_type 14, model call = 15, k-th gen_metadata row = k-th type-15 step (13/13 finished chats).

**Measure**: `node tools/agContext.mjs --project <repo> --json` `now` equals a hand-decode of the last gen_metadata row (2+4+5); `tokenReport.mjs --summary` output unchanged.
