---
bump: minor
title: Kit tools/release.mjs + .changes/ fragments
---
**Changes**
- tools/release.mjs: ships kit releases at ship time from .changes/ fragments (zero deps, pull -> bump from fragments -> VERSION + CHANGELOG section -> commit + annotated tag -> push; clean undo on push rejection; --dry-run).
- .changes/: directory for release note fragments added by feature commits.
- README.md & CHANGELOG.md: documented fragment release workflow.
- Backfilled annotated tags v1.1.1 through v1.6.3 matching VERSION history.

**Why**: Decision 2026-10-25-kit-version-at-ship-time.md. Kit versions assigned at ship time avoid number collisions between parallel sessions.

**Measure**: Verified with --dry-run, then executed first release run for AGT-32.
