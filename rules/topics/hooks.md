# Adding or changing a hook

Keywords: hook, hooks, guard, PreToolUse, PostToolUse, SessionStart, settings.json hooks, block, deny, updatedInput, matcher

Why: Etherium decision `.agents/decisions/2026-11-01-hook-cost-lesson.md` (measured cost of unscoped, dead and blocking hooks).

## Cost model
- A hook runs on every matching tool call, in every session and every subagent. Its cost is per-call time multiplied by call volume (thousands a day), so a few hundred ms is real waiting.
- A block costs a full extra model turn that re-reads the cached conversation. One avoidable block can cost more than a day of hook latency.

## Before you add or change a hook
- **Scope it** to what it acts on: the tool matcher, plus a path rule for file hooks. A path rule for Edit does not cover Write; add both.
- **No per-call setup spawns.** Resolve paths from the hook's stdin (`cwd`) or env, not `git`/`pwd` subprocesses. Prefer one dispatcher process per event over one process per guard.
- **Once-per-session work** checks a stamp file before starting node or doing work.
- **Rewrite before block.** When the fix is mechanical, return `updatedInput` or allow with a one-line note. Block only when the model must choose differently, and say the exact fix in one line so the retry succeeds first time.
- **Measure** before and after: median per-call latency over 20+ runs on a sample input, and expected blocks per day. Put both in the PR.
- **Prove it is alive:** ship a test that feeds the hook an input it must act on (block, rewrite or notice). A hook with no observable effect is dead.

## Removing
- A dead hook (does nothing) is unhooked at once; nothing is lost.
- Turning off a live hook needs the user's yes (`measure-and-hygiene.md`).
