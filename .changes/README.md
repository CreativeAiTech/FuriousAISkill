# Release fragments

One file per behavior change: `.changes/<TICKET>.md`. Feature commits add a fragment and never edit `VERSION` or `CHANGELOG.md`.
`node tools/release.mjs` numbers the release at ship time, writes the CHANGELOG section and deletes the fragments (this README stays, so the folder survives).

```markdown
---
bump: minor        # patch | minor | major
title: Short release title
---
**Changes**
- ...

**Why**: evidence or decision note.

**Measure**: how the effect is checked.
```
