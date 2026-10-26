# Escalation and fallback mechanics

Keywords: escalate, escalation, top tier, opus, effort, xhigh, max effort, quota, fallback, DRAFT, below tier, do it anyway, cannot escalate, @claude, decision note

Core rule lives in `~/.agents/rules/token-optimization.md` (decide high, execute low, never guess). Step detail: `model-orchestrator` Step 4.

## Escalate (below the required tier)
- Claude Code: spawn a subagent with `model: "opus"`, `effort: "high"`.
- `effort: "xhigh"` only to retry a failed high attempt; never `max` (`model-orchestrator` Step 4, Effort ladder).
- For a large Claude escalation, ask before spending substantial shared quota unless already authorized; contained questions use the available subagent controls.
- Antigravity: use an available Pro-class model, or queue the work for an explicitly assigned capable brain (`@claude` / `@codex`).
- Codex: for a contained question, use an actually top-ranked subagent with model/effort controls the current tool exposes. Otherwise queue an explicit `@codex` / `@claude` handoff and request a user model change if required. Never assume Claude controls work here or silently change the main model.
- The top model writes the decision down (decision note or spec). Lower tiers link or quote it and carry it out, never re-decide.
- A new decision point mid-execution: escalate again.

## Can't escalate (top tier unavailable, out of quota, call failed)
- Never decide below tier.
- Hard to reverse: stop, tell the user to wait for the reset or switch models, queue it for a top-tier agent.
- Reversible: offer a labeled **DRAFT** stating your model, "below required tier", confidence, unknowns. Commit nothing irreversible. Queue a top-tier review.
- Same handling when the user says "do it anyway".
