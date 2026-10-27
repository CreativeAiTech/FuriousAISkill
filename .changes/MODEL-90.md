---
bump: minor
title: Rank exact model and effort pairs against a sourced 90-percent brain gate
---

**Changes**
- Add the dated AA v4.3.2 comparison, exact model/effort authority checker and focused tests.
- Replace broad flagship-name promotions; route below-threshold settings to proposals or approved implementation.
- Integrate effort-aware classification into the model tier and baton CLI, and document the existing hook's advisory limits.
- Separate model capability from publishing authorization and remove user-specific blanket delegation claims.

**Why**
Family labels and effort-independent ranks could promote weaker configurations. The reusable policy now requires at least 90% of the comparable leader, high-or-above measured effort and current evidence.

**Measure**
Run `node --test tools/modelAuthority.test.mjs tools/modelTier.test.mjs`. The scored snapshot has 34 exact configurations; unmeasured pairs receive no brain authority. This audit uses published evidence, not new model trials.
