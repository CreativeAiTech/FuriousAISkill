---
bump: minor
title: Add verified source packet builder and verifier for focused worker handoffs
---

**Changes**
- Add `tools/contextPacket.mjs` (`build` and `verify`) and `tools/contextPacket.test.mjs` to package exact source line ranges with file/excerpt SHA-256 hashes, byte/excerpt limits and explicit omitted-context disclosures.
- Integrate `contextPacket.mjs` usage into `skills/model-orchestrator/references/research-triage.md` and `README.md`.

**Why**
Earlier compressed signature maps (`AGT-30`) degraded answer quality by stripping code bodies. Verified source packets preserve exact implementation slices and fail closed when underlying files change or excerpts are altered.

**Measure**
4 new unit tests in `tools/contextPacket.test.mjs` (59 total across the kit suite) verify valid builds, stale-source detection, tamper rejection, path traversal prevention, duplicate range rejection and byte bounds. On a two-file `assessTask` audit trial (`RSR-01`), excerpt payload shrank from 22,406 full-file bytes to 7,178 bytes (67.96% byte reduction) while preserving the full target implementation body and explicit omitted-line disclosure.
