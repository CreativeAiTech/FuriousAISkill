---
bump: minor
title: Add autonomous MR review readiness & dossier scaffolding tools
---

**Changes**
- Add `tools/mrReview.mjs` and `tools/mrReview.test.mjs`:
  - 1-command MR review readiness report with branch history, compacted diff, verification evidence capture, and baton update to `needs-review`.
  - Independent audit gate enforcing exact reviewed commit SHA match, reviewer-author independence, re-verification at exact revision, clean merge into base, and audit log recording.
- Add `tools/dossierScaffold.mjs` and `tools/dossierScaffold.test.mjs`:
  - Scaffolds task dossier directories (`.agents/tasks/<ID>/`) with `spec.md`, `log.md`, and `accept.mjs`.
  - Guarantees scaffolded files are strictly templates: includes unreviewed banner in `spec.md` and fails `accept.mjs` check C0 unless explicit independent reviewer sign-off is recorded.

**Why**
Supports universal manager and worker-branch review protocols (`2026-10-29-universal-manager-routing.md`, `2026-10-29-worker-branch-mr-protocol.md`). Mid-rank workers can prepare verifiable, compacted review requests, while reviewing brains can audit and merge at the exact revision with minimal token spend and strict independence guarantees.

**Measure**
12 new unit tests across `tools/mrReview.test.mjs` (6 tests) and `tools/dossierScaffold.test.mjs` (6 tests). Full kit test suite passes with 68/68 tests (`node --test tools/*.test.mjs`). Negative controls confirm unapproved accept scripts and author self-approvals fail closed.
