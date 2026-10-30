---
bump: patch
title: Count GATE lines from background subagent task-notifications in the token report
---

**Changes**
- `tokenReport.mjs` now reads the `<result>` of each `<task-notification>` user record (string or text-part content) and appends it to the matching spawn by `tool-use-id`, via the exported `notificationResults()`. The notification `<usage>` is not added to spend.

**Why**
Routing outcomes read only the Agent tool_result, which is a launch notice for async spawns, so GATE coverage was always 0.

**Measure**
New tests in `tools/tokenReport.test.mjs` (unit plus end-to-end fixture); rerun `node tools/tokenReport.mjs --summary` on a session with a background worker and the GATE is counted under Routing outcomes.
