---
bump: minor
title: Equal agents; review findings go to owners; @user tickets stay refused
---
**Changes**
- Commit 95c30ee: agent tags are hints, any agent takes any unclaimed ticket (claim = don't collide). `baton brief` lists every non-human ready ticket; `focus` no longer refuses on a tag mismatch.
- `skills/model-orchestrator` 1.8.0: review dispatches findings to owners; `skills/task-board` docs updated to match.
- `tools/baton.mjs`: `claim <ID>` and `focus --status in-progress` on an `@user` (`humanTags`) ticket now refuse ("Refusing to claim/set focus: ... is @user"); `--force` stays the escape hatch. Tests in `tools/baton.tags.test.mjs`.

**Why**: user ruling 2026-10-29: equal agents, but `@user` is reserved for secrets, taste and user decisions; dropping the tag check had removed that protection.

**Measure**: next 7 days of `.agents/STATE.md` logs: no agent focus on an `@user` ticket without `--force`; ready tickets tagged for other agents get taken by whichever agent is free.
