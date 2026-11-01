#!/usr/bin/env node
// On-demand lint for rule files (decision 2026-10-25-lean-rules, AGT-59). Not a hook: per-edit hooks were removed by
// WKF-176 (rules/topics/overhead.md). Usage: node hooks/rule-lint.mjs <file>...
// Runs the lean-rules checks from tools/lib/ruleLint.mjs on CLAUDE.md, AGENTS.md, GEMINI.md and rules/** or .agents/rules/**
// files (matched on the resolved absolute path). Prints one warning line per file with problems, and
// `rule-lint: skipped <file> (not a rule file)` for any other file, so empty output means a clean pass. Exit 0, no git spawn.
import fs from "node:fs";
import path from "node:path";
import { lintRuleFile } from "../tools/lib/ruleLint.mjs";

const RULE_FILE = /(?:^|[\\/])(?:CLAUDE|AGENTS|GEMINI)\.md$|[\\/]rules[\\/].+\.md$/i;

/** Nearest ancestor holding .git (dir in a checkout, file in a worktree); else the file's own dir. */
function projectRoot(file) {
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return path.dirname(file);
  }
}

for (const file of process.argv.slice(2)) {
  try {
    const abs = path.resolve(file);
    if (!RULE_FILE.test(abs)) {
      console.log(`rule-lint: skipped ${file} (not a rule file)`);
      continue;
    }
    const problems = lintRuleFile(abs, projectRoot(abs));
    if (problems.length) console.log(`rule-lint ${path.basename(abs)}: ${problems.join("; ")} (see ~/.agents/rules/topics/writing-rules.md)`);
  } catch {
    // fail open
  }
}
