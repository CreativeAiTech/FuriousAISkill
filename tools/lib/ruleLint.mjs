// Lean-rules checks (decision 2026-10-25-lean-rules), shared by contextHygiene.mjs (weekly audit, check h)
// and hooks/rule-lint.mjs (write-time lint on Edit/Write of rule files). Pure fs, no git or child processes: the hook must stay <200 ms.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MAP_MAX = 1500, DUP_MIN = 40;
export const tok = (chars) => Math.round(chars / 4); // est.
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

/** Normalized form of a rule line for duplicate matching. */
export const normLine = (l) => l.replace(/[*`]/g, "").replace(/^\s*(?:-\s*)?/, "").replace(/\s+/g, " ").trim().toLowerCase();
/** Normalized lines of a file worth comparing (no headings, tables rules or short lines). */
export function dupCandidates(text) {
  const out = [];
  for (const raw of (text || "").split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const n = normLine(raw);
    if (n.length < DUP_MIN || /^[|:\s-]+$/.test(n)) continue;
    out.push(n);
  }
  return out;
}
/** Always-on file over MAP_MAX est. tokens with no "Before you" trigger table. */
export const needsMap = (text) => tok((text || "").length) > MAP_MAX && !/before you/i.test(text || "");
/** Always-on rule files for a project: global CLAUDE.md + the project's CLAUDE.md, AGENTS.md, GEMINI.md. */
export function alwaysOnFiles(project, home = os.homedir()) {
  return [path.join(home, ".claude", "CLAUDE.md"), ...["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((n) => path.join(project, n))]
    .map((f) => path.resolve(f)).filter((f, i, a) => a.indexOf(f) === i && isFile(f));
}
/** Topic (on-demand) rule file: kit rules/topics/*.md or a project's .agents/rules/*.md. */
export const isTopicFile = (f) => /[\\/](?:rules[\\/]topics|\.agents[\\/]rules)[\\/][^\\/]+\.md$/i.test(f) && !/token-optimization\.md$/i.test(f);
/** Paths named in "Before you" trigger-table rows that don't exist. Resolves ~/, then file dir, then project root. */
export function missingTablePaths(text, file, project, home = os.homedir()) {
  const missing = [];
  for (const row of (text || "").split("\n")) {
    if (!/^\s*\|/.test(row) || /before you/i.test(row)) continue;
    for (const m of row.matchAll(/`([^`\s]+\.(?:md|mjs|cjs|js|json))`/g)) {
      const p = m[1];
      const tries = p.startsWith("~") ? [path.join(home, p.slice(1))] : [path.resolve(path.dirname(file), p), path.resolve(project, p)];
      if (!tries.some(isFile)) missing.push(p);
    }
  }
  return missing;
}
/** Lint one rule file after an edit. Returns short problem strings (empty = clean). */
export function lintRuleFile(file, project, home = os.homedir()) {
  const text = read(file); if (text === null) return [];
  const self = path.resolve(file), problems = [];
  const alwaysOn = alwaysOnFiles(project, home);
  if (alwaysOn.includes(self) && needsMap(text)) problems.push(`${tok(text.length)} est. tokens (>${MAP_MAX}) and no "Before you" trigger table`);
  if (isTopicFile(self) && !/^Keywords:/m.test(text)) problems.push("topic file has no `Keywords:` line");
  const mine = new Set(dupCandidates(text));
  // sync.mjs copies the kit's top-level rules/*.md into ~/.claude/CLAUDE.md: that pair is source and copy, not a duplicate
  const kitCore = path.dirname(self) === path.resolve(home, ".agents", "rules");
  for (const other of alwaysOn) {
    if (other === self || (kitCore && other === path.resolve(home, ".claude", "CLAUDE.md"))) continue;
    const hits = dupCandidates(read(other)).filter((n) => mine.has(n));
    if (hits.length) problems.push(`${hits.length} line(s) duplicated in ${other.replace(home, "~").replace(/\\/g, "/")}, e.g. "${hits[0].length > 60 ? hits[0].slice(0, 57) + "..." : hits[0]}"`);
  }
  const missing = missingTablePaths(text, self, project, home);
  if (missing.length) problems.push(`trigger table path(s) not found: ${missing.slice(0, 3).join(", ")}`);
  return problems;
}
