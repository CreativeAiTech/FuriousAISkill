---
bump: patch
title: Docs - results, roadmap and docs/RESULTS.md
---

**Changes**
- Docs only, no behavior change.
- README: add "Results so far" and "Roadmap" sections; credit line now names CreativeAiTech first.
- Add `docs/RESULTS.md`: modeled token savings from the 2026-10-30 token report (kit 1.9.0), with caveats, what works, what is not yet measured, and how to reproduce.

**Why**: visitors should see what the kit does, how well it works with honest limits, and what is planned.

**Measure**: every number in `docs/RESULTS.md` matches `tools/tokenReport.mjs` output for the stated window.
