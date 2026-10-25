---
bump: patch
title: Session title C- prefix only for real resumes
---
**Changes**
- Rule §6: `C-` marks a session that picks up unfinished work from an earlier one, including the same task moved to a fresh chat after a context checkpoint. "Continue" that starts a fresh ticket (next backlog pick, another agent's `needs-review`, idle focus) gets a plain title.

**Why**: user 2026-10-25: every "continue" got `C-`, so the prefix no longer told resumed work apart from new tasks.

**Measure**: new session titles carry `C-` only when the brief showed your own `in-progress`/`blocked` focus.
