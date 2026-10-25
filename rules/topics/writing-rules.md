# Writing agent rules (CLAUDE.md, AGENTS.md, GEMINI.md, kit rules)

Keywords: rule, rules, CLAUDE.md, AGENTS.md, GEMINI.md, write rule, edit rule, map index, trigger table, compress

Decision: Crownspire `.agents/decisions/2026-10-25-lean-rules.md`

## One home per rule
- Each rule lives in exactly one file. Every other file points to it; never copy it.
- Generic rules live in the kit (`~/.agents/rules/`). Project files only refine them.
- Reasons, dates, measurements and "user said" provenance go to a decision note. Leave a link, not the story.
- A generated human view (a script that renders all rules to a git-ignored report) is fine. A hand-kept second copy is not.

## Shape of an always-on file
- Short core, then a table of "Before you... -> Read <path>" rows.
- Each row names the action, the words a user would say for it, and the exact path.
  Example: "Before you push, commit or merge (git, push, release) -> Read `.agents/rules/git.md`".
- A vague row ("see the docs") gets skipped. A concrete trigger gets followed.

## What stays in core
- Git policy, the verify command, the model gate, the top-tier area list, the baton (session handoff), the table itself.
- Anything that must never be missed, even once.
- Any rule needed in more than 70% of sessions. If usage data shows a topic is read that often, move it back to core.

## Topic files
- Start with a `Keywords:` line so one Grep finds the file.
- At most 200 lines per file. Split when longer.
- A topic tied to code paths may carry `paths:` YAML frontmatter. Claude Code then auto-loads it from `.claude/rules/`
  when a matching file is read or edited. Keep the source file canonical and copy it by sync.
- Review a topic nobody reads for 30 days: fix its trigger, or drop it.

## Size and wording
- Always-on files target 1.5k tokens or less (characters / 4). Count before and after an edit.
- Plain, terse English. Drop filler. Keep real words.
- No private abbreviations. No encodings (gzip, base64): they tokenize worse and cannot be read reliably.
- Cut any line whose removal would not cause a mistake.
- Do not use a rule file to enforce what a hook can enforce. Rules are advisory; hooks are deterministic.

## Before saving
- Search for the same rule elsewhere. If it exists, point to it instead of repeating it.
- Check that every table row has a real path and that the file exists.
- Run the sync command so generated copies match.
