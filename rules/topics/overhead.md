# No automatic per-request work

Keywords: hook, hooks, guard, PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SessionEnd, settings.json hooks, permissions.deny, block, per-call, per-request, overhead, latency

Why: Etherium decision `.agents/decisions/2026-11-01-hook-cost-lesson.md`. Hooks added one at a time cost 49 min of waiting, 5.8 h of machine time and 428 retry turns in one week, and roughly doubled in a day. The owner chose: "Stricter, no exceptions".

## Cost model
- Cost = time per run × how often it runs. Anything that runs on every tool call, turn or prompt runs thousands of times a day, in every session and subagent. 10 s here and 10 s there adds up.
- A block costs a full extra model turn that re-reads the cached conversation; one block can cost more than a day of latency.

## The rule
- **Automatic work runs at most once per session**: at its start or at its end. Everything else runs on demand, when an agent calls the tool that needs it.
- **Claude Code hooks**: only `SessionStart` and `SessionEnd`. No `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` or `SubagentStop` hooks (`Stop` fires every turn), and no `if`- or matcher-scoped exceptions. Other tools' equivalents follow the same rule.
- **Not only hooks**: the rule covers any automatic per-request work: status lines, watchers, per-turn scripts, MCP calls a rule asks for on every turn, checks a rule tells agents to run before every action.

## Where a per-call check goes instead
1. **`permissions.deny`** in `settings.json`, checked inside Claude Code with no process spawned. Deny the raw command (e.g. `Bash(gh pr merge *)`).
2. **Inside the tool that does the action**: the script agents call to merge, open a PR or push carries the check (brain-only merge, ticket ID in the title). Deny the raw command so the script is the only path.
3. **Once at `SessionStart`** for a notice (role, model, brief), or at `SessionEnd` for bookkeeping (baton, log).
4. **Nowhere**: if neither a deny rule nor the acting tool can hold it, drop it and keep the rule text. A written rule costs nothing per call.

## Before adding start/end work
- Measure it: median over 10+ runs, before and after, in the PR. The startup brief is felt by every session.
- Keep `SessionEnd` short and offline-safe; it runs while the session closes.

## Hygiene
- A daily lint flags any hook other than `SessionStart`/`SessionEnd` in project or global settings.
- Removing a hook that breaks this rule needs no extra yes; the owner already decided.
