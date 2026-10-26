---
bump: minor
title: Stale session - open a new session instead of clearing an old one
---
**Changes**
- `hooks/context-watch.cjs`: once per session, flags a chat as stale when it started over 24h ago (`CC_WATCH_MAX_AGE_H`) or before the latest commit to the kit (rules/skills/hooks/agents) or the project's rules/skills (AGENTS.md, CLAUDE.md, GEMINI.md, `.agents/rules`, `.agents/skills`, `.claude`). The agent then opens a fresh session (desktop `start_session`, brief "continue") at the next task boundary, and the hard nudge says "new session" instead of auto-clear for stale chats.
- `rules/topics/checkpoints.md`: Stale session rule.

**Why**: user: an old session is better replaced than cleared, since a new one loads newer skills and better context. A clear keeps the old worktree, branch and loaded skills.

**Measure**: next 7 days of transcripts: stale flags, and how many ended in a `start_session` vs `clear_session` call.
