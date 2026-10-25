---
bump: minor
title: Kit tools/release.mjs + .changes/ fragments
---
**Changes**
- tools/release.mjs: ships kit releases at ship time from .changes/ fragments (zero deps, pull -> bump from fragments -> VERSION + CHANGELOG section -> commit + annotated tag -> one atomic push of branch + tag; full undo on commit or push failure; --dry-run).
- .changes/: release note fragments added by feature commits; .changes/README.md documents the format and keeps the folder alive after a release.
- README.md & CHANGELOG.md: documented fragment release workflow.
- Backfilled annotated tags v1.1.1 through v1.6.3 matching VERSION history.

**Why**: Decision 2026-10-25-kit-version-at-ship-time.md. Kit versions assigned at ship time avoid number collisions between parallel sessions.

**Measure**: --dry-run on the kit; scratch bare-origin test: success pushes commit + tag together, a rejected push restores fragments/VERSION/CHANGELOG with no tag, a diverged pull aborts untouched.
