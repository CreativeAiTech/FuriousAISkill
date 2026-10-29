import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  cleanCell,
  formatDisplayPath,
  parseFrontmatter,
  parseTriggerTables,
  extractLinkedDecisions,
  extractKeywords,
  extractInFileTrigger,
  generateRulesView,
  RULES_VIEW_VERSION,
} from "./rulesView.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-view-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("cleanCell escapes pipes and replaces newlines", () => {
  assert.equal(cleanCell(null), "-");
  assert.equal(cleanCell(""), "-");
  assert.equal(cleanCell("simple text"), "simple text");
  assert.equal(cleanCell("a | b | c"), "a \\| b \\| c");
  assert.equal(cleanCell("line 1\nline 2\r\nline 3"), "line 1 line 2 line 3");
  assert.equal(cleanCell("  padded  "), "padded");
});

test("formatDisplayPath handles project-relative, home-relative, and absolute paths", () => {
  withTempDir((baseDir) => {
    const projDir = path.join(baseDir, "my-project");
    const homeDir = path.join(baseDir, "my-home");
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    const projFile = path.join(projDir, "AGENTS.md");
    const projSubFile = path.join(projDir, ".agents", "rules", "testing.md");
    const homeFile = path.join(homeDir, ".claude", "CLAUDE.md");
    const otherFile = path.join(baseDir, "other", "file.txt");

    assert.equal(formatDisplayPath(projFile, projDir, homeDir), "AGENTS.md");
    assert.equal(formatDisplayPath(projSubFile, projDir, homeDir), ".agents/rules/testing.md");
    assert.equal(formatDisplayPath(homeFile, projDir, homeDir), "~/.claude/CLAUDE.md");
    assert.equal(formatDisplayPath(otherFile, projDir, homeDir), otherFile.replace(/\\/g, "/"));
  });
});

test("parseFrontmatter parses YAML frontmatter and body", () => {
  const textWithFm = `---
paths: ["src/**/*.ts"]
priority: high
---
# Rule Heading
Content goes here.`;

  const res = parseFrontmatter(textWithFm);
  assert.ok(res.frontmatter);
  assert.deepEqual(res.frontmatter.paths, ["src/**/*.ts"]);
  assert.equal(res.frontmatter.priority, "high");
  assert.ok(res.body.includes("# Rule Heading"));

  const textWithoutFm = `# Simple Rule\nNo frontmatter here.`;
  const res2 = parseFrontmatter(textWithoutFm);
  assert.equal(res2.frontmatter, null);
  assert.equal(res2.body, textWithoutFm);
});

test("parseTriggerTables extracts triggers and maps target paths", () => {
  withTempDir((projDir) => {
    const tableContent = `# Rules
| Before you… | Read |
| :--- | :--- |
| run any tests | \`.agents/rules/testing.md\` |
| deploy to prod | \`~/.agents/rules/topics/deploy.md\` |
| consult grok | .agents/rules/grok.md |
`;
    const agentsPath = path.join(projDir, "AGENTS.md");
    const homeDir = path.join(projDir, "fake-home");

    const map = parseTriggerTables(
      [{ filePath: agentsPath, content: tableContent }],
      projDir,
      homeDir
    );

    const testingResolved = path.resolve(projDir, ".agents", "rules", "testing.md");
    const deployResolved = path.resolve(homeDir, ".agents", "rules", "topics", "deploy.md");
    const grokResolved = path.resolve(projDir, ".agents", "rules", "grok.md");

    assert.ok(map.has(testingResolved));
    assert.ok(map.get(testingResolved).has("run any tests"));

    assert.ok(map.has(deployResolved));
    assert.ok(map.get(deployResolved).has("deploy to prod"));

    assert.ok(map.has(grokResolved));
    assert.ok(map.get(grokResolved).has("consult grok"));
  });
});

test("extractLinkedDecisions identifies decision filenames and DEC-XX codes", () => {
  const content = `
See .agents/decisions/2026-10-25-audit-gate.md for background.
Also refer to ../decisions/2026-10-27-codex-onboarding.md and 2026-10-29-universal-manager-routing.md.
Parked in DEC-01 and DEC-42.
Example: .agents/decisions/YYYY-MM-DD-slug.md (should not match placeholder).
`;
  const decisions = extractLinkedDecisions(content);
  assert.deepEqual(decisions, [
    "2026-10-25-audit-gate.md",
    "2026-10-27-codex-onboarding.md",
    "2026-10-29-universal-manager-routing.md",
    "DEC-01",
    "DEC-42",
  ]);
});

test("extractKeywords and extractInFileTrigger extract metadata lines", () => {
  const content = `# My Rule
Keywords: test, testing, vitest, assertion
Trigger: **before you execute unit tests or modify suites.**

Rule body.`;

  assert.equal(extractKeywords(content), "test, testing, vitest, assertion");
  assert.equal(extractInFileTrigger(content), "before you execute unit tests or modify suites.");

  const emptyContent = `# Empty\nJust text.`;
  assert.equal(extractKeywords(emptyContent), null);
  assert.equal(extractInFileTrigger(emptyContent), null);
});

test("generateRulesView generates full report with expected table columns and metrics", () => {
  withTempDir((baseDir) => {
    const projDir = path.join(baseDir, "test-repo");
    const homeDir = path.join(baseDir, "test-home");
    const projRulesDir = path.join(projDir, ".agents", "rules");
    const projDecisionsDir = path.join(projDir, ".agents", "decisions");
    const kitTopicsDir = path.join(homeDir, ".agents", "rules", "topics");

    fs.mkdirSync(projRulesDir, { recursive: true });
    fs.mkdirSync(projDecisionsDir, { recursive: true });
    fs.mkdirSync(kitTopicsDir, { recursive: true });

    // 1. Create project AGENTS.md
    fs.writeFileSync(
      path.join(projDir, "AGENTS.md"),
      `# Project Agent Rules
| Before you… | Read |
| :--- | :--- |
| write unit tests | \`.agents/rules/testing.md\` |

Always-on core rules content.
`,
      "utf8"
    );

    // 2. Create project topic rule
    fs.writeFileSync(
      path.join(projRulesDir, "testing.md"),
      `# Testing Guardrails
Keywords: test, vitest, tsc
Trigger: **before you run or write tests.**

See decision .agents/decisions/2026-10-25-lean-rules.md.
`,
      "utf8"
    );

    // 3. Create kit topic rule
    fs.writeFileSync(
      path.join(kitTopicsDir, "writing-rules.md"),
      `# Writing Rules
Keywords: rule, rules, trigger table

Generic rule content.
`,
      "utf8"
    );

    const res = generateRulesView({
      project: projDir,
      home: homeDir,
      writeDisk: true,
      check: true,
    });

    assert.ok(res.markdown.includes("# Agent Rules View"));
    assert.ok(res.markdown.includes("| Path | Load Mode | Tokens | Keywords | Trigger Row | Linked Decisions |"));
    assert.ok(res.markdown.includes("`AGENTS.md`"));
    assert.ok(res.markdown.includes("always-on"));
    assert.ok(res.markdown.includes("`.agents/rules/testing.md`"));
    assert.ok(res.markdown.includes("write unit tests"));
    assert.ok(res.markdown.includes("test, vitest, tsc"));
    assert.ok(res.markdown.includes("`2026-10-25-lean-rules.md`"));

    assert.equal(res.summary.totalFiles, 3);
    assert.equal(res.summary.alwaysOnCount, 1);
    assert.equal(res.summary.onDemandCount, 2);
    assert.ok(res.summary.totalTokens > 0);

    // Verify report file was written on disk
    const reportFile = path.join(projDir, ".agents", "reports", "rules-view.md");
    assert.ok(fs.existsSync(reportFile));
    const saved = fs.readFileSync(reportFile, "utf8");
    assert.equal(saved, res.markdown);

    // Verify .gitignore in reports dir
    const gitignoreFile = path.join(projDir, ".agents", "reports", ".gitignore");
    assert.ok(fs.existsSync(gitignoreFile));
    assert.ok(fs.readFileSync(gitignoreFile, "utf8").includes("*"));
  });
});

test("CLI execution outputs markdown and supports --json and --check flags", () => {
  withTempDir((baseDir) => {
    const projDir = path.join(baseDir, "cli-test");
    const projRulesDir = path.join(projDir, ".agents", "rules");
    fs.mkdirSync(projRulesDir, { recursive: true });

    fs.writeFileSync(
      path.join(projDir, "AGENTS.md"),
      `# Rules\n| Before you… | Read |\n| :--- | :--- |\n| run tests | \`.agents/rules/test.md\` |\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(projRulesDir, "test.md"),
      `# Test\nKeywords: foo, bar\n\nContent.`,
      "utf8"
    );

    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "rulesView.mjs");

    // 1. Test CLI with --stdout
    const stdout = execFileSync(
      process.execPath,
      [scriptPath, "--project", projDir, "--home", path.join(baseDir, "empty-home"), "--stdout"],
      { cwd: projDir, encoding: "utf8" }
    );
    assert.ok(stdout.includes("# Agent Rules View"));
    assert.ok(stdout.includes("| Path | Load Mode | Tokens | Keywords | Trigger Row | Linked Decisions |"));
    assert.ok(stdout.includes("`AGENTS.md`"));
    assert.ok(stdout.includes("`.agents/rules/test.md`"));

    // 2. Test CLI with --json
    const jsonOut = execFileSync(
      process.execPath,
      [scriptPath, "--project", projDir, "--home", path.join(baseDir, "empty-home"), "--json"],
      { cwd: projDir, encoding: "utf8" }
    );
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.summary.totalFiles, 2);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.isValid, true);
  });
});
