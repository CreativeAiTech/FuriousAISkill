# Escalation and fallback mechanics

Keywords: escalate, escalation, top tier, opus, max effort, quota, fallback, DRAFT, below tier, do it anyway, cannot escalate, @claude, decision note

Core rule lives in `~/.agents/rules/token-optimization.md` (decide high, execute low, never guess). Step detail: `model-orchestrator` Step 4.

## Escalate (below the required tier)
- Claude Code: spawn a subagent with `model: "opus"`, `effort: "high"`.
- `effort: "max"` only for: silent-failure math, costly-to-undo changes, security, a failed high attempt, or tangled constraints (`model-orchestrator` Step 4).
- Ask the user first unless it is a contained question; an Opus call spends shared quota.
- Antigravity: switch to the Pro-class model, or queue it for `@claude`.
- The top model writes the decision down (decision note or spec). Lower tiers link or quote it and carry it out, never re-decide.
- A new decision point mid-execution: escalate again.

## Can't escalate (top tier unavailable, out of quota, call failed)
- Never decide below tier.
- Hard to reverse: stop, tell the user to wait for the reset or switch models, queue it for a top-tier agent.
- Reversible: offer a labeled **DRAFT** stating your model, "below required tier", confidence, unknowns. Commit nothing irreversible. Queue a top-tier review.
- Same handling when the user says "do it anyway".
