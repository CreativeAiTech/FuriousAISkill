#!/usr/bin/env node
// On-demand lint for rule files (decision 2026-10-25-lean-rules, AGT-59). Not a hook: per-edit hooks were removed by
// WKF-176 (rules/topics/overhead.md). Usage: node hooks/rule-lint.mjs <file>...
// Runs the lean-rules checks from tools/lib/ruleLint.mjs on CLAUDE.md, AGENTS.md, GEMINI.md and .agents/rules/** files
// and prints one warning line per file with problems. Never blocks, exit 0, no git spawn.
import fs from "node:fs";
import path from "node:path";
import { lintRuleFile } from "../tools/lib/ruleLint.mjs";

const RULE_FILE = /(?:^|[\/])(?:CLAUDE|AGENTS|GEMINI)\.md$|[\/]\.agents[\/]rules[\/].+\.md$/i;

/** Nearest ancestor holding .git (dir in a checkout, file in a worktree); else the file's own dir. */
function projectRoot(file) {
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return path.dirname(file);
  }
}

for (const file of process.argv.slice(2)) {
  try {
    if (!RULE_FILE.test(file)) continue;
    const abs = path.resolve(file);
    const problems = lintRuleFile(abs, projectRoot(abs));
    if (problems.length) console.log(`rule-lint ${path.basename(abs)}: ${problems.join("; ")} (see ~/.agents/rules/topics/writing-rules.md)`);
  } catch {
    // fail open
  }
}
