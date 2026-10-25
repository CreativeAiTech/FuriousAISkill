#!/usr/bin/env node
// PostToolUse hook (Claude Code): write-time lint for rule files (decision 2026-10-25-lean-rules, AGT-59).
// On Edit/Write of CLAUDE.md, AGENTS.md, GEMINI.md or any .agents/rules/** file (project or ~/.agents), runs the
// lean-rules checks from tools/lib/ruleLint.mjs and gives the agent one warning line. Never blocks, fails open, no git spawn.
import fs from "node:fs";
import path from "node:path";
import { lintRuleFile } from "../tools/lib/ruleLint.mjs";

const RULE_FILE = /(?:^|[\\/])(?:CLAUDE|AGENTS|GEMINI)\.md$|[\\/]\.agents[\\/]rules[\\/].+\.md$/i;

/** Nearest ancestor holding .git (dir in a checkout, file in a worktree); else the file's own dir. */
function projectRoot(file) {
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return path.dirname(file);
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  const file = input.tool_input?.file_path;
  if (file && RULE_FILE.test(file)) {
    const abs = path.resolve(input.cwd || process.cwd(), file);
    const problems = lintRuleFile(abs, projectRoot(abs));
    if (problems.length) {
      const msg = `rule-lint ${path.basename(abs)}: ${problems.join("; ")} (see ~/.agents/rules/topics/writing-rules.md)`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }));
    }
  }
} catch {
  // fail open: a lint must never get in the way of an edit
}
