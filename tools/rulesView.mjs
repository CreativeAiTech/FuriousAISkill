#!/usr/bin/env node
/**
 * rulesView: Human-readable rules view generator (AGT-57, decision 2026-10-25-lean-rules item 6).
 *
 * Scans always-on and on-demand agent rule files across the project and global kit,
 * parses load modes, token counts, keywords, trigger table mappings, and linked decisions,
 * and generates the git-ignored report:
 *   <project>/.agents/reports/rules-view.md
 *
 * Usage:
 *   node ~/.agents/tools/rulesView.mjs [--project <dir>] [options]
 *
 * Options:
 *   --project <dir>    Target project directory (default: git root or cwd)
 *   --output <file>    Output report path (default: <project>/.agents/reports/rules-view.md)
 *   --home <dir>       User home directory override (default: os.homedir())
 *   --stdout           Output generated markdown report to stdout
 *   --json             Output parsed rules metadata as JSON to stdout
 *   --check            Validate rule integrity (trigger coverage, keywords, links) and exit non-zero on failure
 *   --quiet            Suppress informative console messages
 *   --help             Show this help message
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { MAP_MAX, tok, isTopicFile, missingTablePaths } from "./lib/ruleLint.mjs";

export const RULES_VIEW_VERSION = "1.0.0";

/**
 * Escapes characters for a GitHub Flavored Markdown table cell.
 */
export function cleanCell(val) {
  if (val === null || val === undefined || val === "") return "-";
  return String(val)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim() || "-";
}

/**
 * Resolves main git root if inside a worktree or git repo.
 */
export function findMainRepoRoot(startDir = process.cwd()) {
  try {
    const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: startDir,
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    const common = r.status === 0 ? String(r.stdout).trim() : "";
    if (common && path.basename(common) === ".git") {
      return path.dirname(common);
    }
  } catch {}

  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".agents")) || fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(startDir);
}

/**
 * Formats a path relative to project or home for clean display.
 */
export function formatDisplayPath(filePath, projectRoot, homeDir = os.homedir()) {
  const normFile = path.resolve(filePath);
  const normProj = path.resolve(projectRoot);
  const normHome = path.resolve(homeDir);

  const relProj = path.relative(normProj, normFile);
  if (!relProj.startsWith("..") && !path.isAbsolute(relProj)) {
    return relProj.replace(/\\/g, "/");
  }

  const relHome = path.relative(normHome, normFile);
  if (!relHome.startsWith("..") && !path.isAbsolute(relHome)) {
    return ("~/" + relHome).replace(/\\/g, "/");
  }

  return normFile.replace(/\\/g, "/");
}

/**
 * Parses markdown frontmatter if present.
 * Returns { frontmatter: object | null, body: string }.
 */
export function parseFrontmatter(content) {
  if (!content || !content.startsWith("---")) {
    return { frontmatter: null, body: content || "" };
  }
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: null, body: content };
  }
  const rawFm = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 4).replace(/^\r?\n/, "");
  const fm = {};
  for (const line of rawFm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      if ((val.startsWith("[") && val.endsWith("]")) || (val.startsWith('"') && val.endsWith('"'))) {
        try {
          val = JSON.parse(val);
        } catch {}
      }
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body };
}

/**
 * Parses all trigger tables in rule files.
 * Tables match a header containing "Before you" and map condition -> target path.
 * Returns Map<resolvedTargetPath, Set<triggerDescription>>.
 */
export function parseTriggerTables(filesWithContent, projectRoot, homeDir = os.homedir()) {
  const triggerMap = new Map(); // resolvedPath -> Set<string>

  const recordTrigger = (targetPath, sourceFile, triggerText) => {
    if (!targetPath || !triggerText) return;
    const cleanTarget = targetPath.replace(/[`'"]/g, "").trim();
    const candidatePaths = cleanTarget.startsWith("~")
      ? [path.join(homeDir, cleanTarget.slice(1))]
      : [path.resolve(path.dirname(sourceFile), cleanTarget), path.resolve(projectRoot, cleanTarget)];

    for (const cand of candidatePaths) {
      const resolved = path.resolve(cand);
      if (!triggerMap.has(resolved)) {
        triggerMap.set(resolved, new Set());
      }
      triggerMap.get(resolved).add(triggerText.trim());
    }
  };

  for (const { filePath, content } of filesWithContent) {
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    let inTriggerTable = false;
    let colBeforeIdx = -1;
    let colReadIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("|")) {
        inTriggerTable = false;
        continue;
      }

      // Check for table header
      if (/before you/i.test(line)) {
        const headers = line.split("|").slice(1, -1).map((h) => h.trim().toLowerCase());
        colBeforeIdx = headers.findIndex((h) => h.includes("before you"));
        colReadIdx = headers.findIndex((h) => h.includes("read") || h.includes("path") || h.includes("rule"));
        if (colBeforeIdx !== -1 && colReadIdx !== -1) {
          inTriggerTable = true;
          continue;
        }
      }

      // Skip delimiter row
      if (inTriggerTable && /^\|[\s|:-]+\|$/.test(line)) {
        continue;
      }

      if (inTriggerTable) {
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length > Math.max(colBeforeIdx, colReadIdx)) {
          const triggerText = cells[colBeforeIdx];
          const rawTarget = cells[colReadIdx];

          // Extract backticked path or bare path
          const pathMatches = [...rawTarget.matchAll(/`([^`\s]+\.(?:md|mjs|cjs|js|json))`|\[.*?\]\(([^)\s]+)\)|([^\s|`]+\.(?:md|mjs|cjs|js|json))/g)];
          for (const pm of pathMatches) {
            const targetPath = pm[1] || pm[2] || pm[3];
            if (targetPath) {
              recordTrigger(targetPath, filePath, triggerText);
            }
          }
        }
      }
    }
  }

  return triggerMap;
}

/**
 * Extracts decision references from markdown content.
 * Matches:
 *  - YYYY-MM-DD-*.md (with or without directory prefix)
 *  - DEC-NN
 */
export function extractLinkedDecisions(content) {
  if (!content) return [];
  const decisions = new Set();

  // Pattern 1: date-slug decision filenames (e.g. 2026-10-25-audit-gate.md)
  const dateSlugMatches = content.matchAll(/(?:(?:\.agents|\.\.)[/\\]decisions[/\\])?(202\d-\d{2}-\d{2}-[\w.-]+\.md)/gi);
  for (const m of dateSlugMatches) {
    decisions.add(m[1]);
  }

  // Pattern 2: DEC-XX identifiers
  const decMatches = content.matchAll(/\b(DEC-\d+)\b/g);
  for (const m of decMatches) {
    decisions.add(m[1]);
  }

  return [...decisions].sort();
}

/**
 * Extracts Keywords: line if present.
 */
export function extractKeywords(content) {
  if (!content) return null;
  const m = content.match(/^[ \t]*Keywords:[ \t]*(.+)$/im);
  return m ? m[1].trim() : null;
}

/**
 * Extracts in-file Trigger: line if present.
 */
export function extractInFileTrigger(content) {
  if (!content) return null;
  const m = content.match(/^[ \t]*Trigger:[ \t]*(.+)$/im);
  if (!m) return null;
  return m[1].replace(/\*\*/g, "").trim();
}

/**
 * Scans and discovers all rule files across the project and kit.
 */
export function scanRuleFiles(projectRoot, homeDir = os.homedir()) {
  const normProj = path.resolve(projectRoot);
  const normHome = path.resolve(homeDir);

  const scannedFiles = new Set();
  const fileRecords = [];

  const addFile = (fullPath, defaultLoadMode, scope) => {
    const resolved = path.resolve(fullPath);
    if (scannedFiles.has(resolved)) return;
    if (!fs.existsSync(resolved)) return;
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return;
      scannedFiles.add(resolved);
      fileRecords.push({
        filePath: resolved,
        defaultLoadMode,
        scope, // "project" | "kit"
      });
    } catch {}
  };

  // 1. Always-on global / kit files
  addFile(path.join(normHome, ".claude", "CLAUDE.md"), "always-on", "kit");
  addFile(path.join(normHome, ".codex", "AGENTS.md"), "always-on", "kit");
  addFile(path.join(normHome, ".agents", "rules", "token-optimization.md"), "always-on", "kit");

  // 2. Always-on project files
  addFile(path.join(normProj, "AGENTS.md"), "always-on", "project");
  addFile(path.join(normProj, "CLAUDE.md"), "always-on", "project");
  addFile(path.join(normProj, "GEMINI.md"), "always-on", "project");

  // 3. Scan for imports in always-on files
  for (const rec of [...fileRecords]) {
    try {
      const text = fs.readFileSync(rec.filePath, "utf8");
      for (const m of text.matchAll(/^[ \t]*@([^\s`]+)/gm)) {
        const importTarget = m[1].startsWith("~")
          ? path.join(normHome, m[1].slice(1))
          : path.resolve(path.dirname(rec.filePath), m[1]);
        addFile(importTarget, "always-on (imported)", rec.scope);
      }
    } catch {}
  }

  // 4. Project topic rule files (.agents/rules/*.md)
  const projRulesDir = path.join(normProj, ".agents", "rules");
  if (fs.existsSync(projRulesDir)) {
    try {
      for (const f of fs.readdirSync(projRulesDir)) {
        if (f.endsWith(".md")) {
          addFile(path.join(projRulesDir, f), "on-demand", "project");
        }
      }
    } catch {}
  }

  // 5. Kit topic rule files (~/.agents/rules/topics/*.md)
  const kitTopicsDir = path.join(normHome, ".agents", "rules", "topics");
  if (fs.existsSync(kitTopicsDir)) {
    try {
      for (const f of fs.readdirSync(kitTopicsDir)) {
        if (f.endsWith(".md")) {
          addFile(path.join(kitTopicsDir, f), "on-demand", "kit");
        }
      }
    } catch {}
  }

  // 6. Claude Code auto-load rules (.claude/rules/*.md)
  const claudeRulesDir = path.join(normProj, ".claude", "rules");
  if (fs.existsSync(claudeRulesDir)) {
    try {
      for (const f of fs.readdirSync(claudeRulesDir)) {
        if (f.endsWith(".md")) {
          addFile(path.join(claudeRulesDir, f), "on-demand", "project");
        }
      }
    } catch {}
  }

  return fileRecords;
}

/**
 * Inspects a single rule file and produces its full metadata entry.
 */
export function inspectRuleFile(record, triggerMap, projectRoot, homeDir = os.homedir()) {
  const normProj = path.resolve(projectRoot);
  const normHome = path.resolve(homeDir);
  const resolved = path.resolve(record.filePath);

  let rawContent = "";
  try {
    rawContent = fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(rawContent);
  const tokenCount = tok(rawContent.length);
  const keywords = extractKeywords(rawContent);
  const inFileTrigger = extractInFileTrigger(rawContent);
  const linkedDecisions = extractLinkedDecisions(rawContent);

  // Determine load mode
  let loadMode = record.defaultLoadMode;
  if (frontmatter && frontmatter.paths) {
    const pathsVal = Array.isArray(frontmatter.paths) ? frontmatter.paths.join(", ") : String(frontmatter.paths);
    loadMode = `path-scoped (${pathsVal})`;
  } else if (record.filePath.includes(path.join(".claude", "rules")) && (!frontmatter || !frontmatter.paths)) {
    // Claude rules without paths load every session
    loadMode = "always-on";
  }

  // Determine trigger row
  let triggerRow = "-";
  const mappedTriggers = triggerMap.get(resolved);
  if (mappedTriggers && mappedTriggers.size > 0) {
    triggerRow = [...mappedTriggers].join("; ");
  } else if (inFileTrigger) {
    triggerRow = inFileTrigger;
  } else if (loadMode.startsWith("always-on")) {
    triggerRow = "Always loaded";
  }

  const displayPath = formatDisplayPath(resolved, normProj, normHome);

  return {
    filePath: resolved,
    displayPath,
    scope: record.scope,
    loadMode,
    tokens: tokenCount,
    keywords: keywords || "-",
    triggerRow,
    linkedDecisions,
    rawContent,
  };
}

/**
 * Builds the complete rules view report and data structure.
 */
export function generateRulesView({
  project = process.cwd(),
  home = os.homedir(),
  output = null,
  writeDisk = true,
  check = false,
} = {}) {
  const projectRoot = findMainRepoRoot(project);
  const homeDir = path.resolve(home);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Scan files
  const fileRecords = scanRuleFiles(projectRoot, homeDir);

  // 2. Read all contents to parse trigger tables
  const filesWithContent = [];
  for (const rec of fileRecords) {
    try {
      const content = fs.readFileSync(rec.filePath, "utf8");
      filesWithContent.push({ filePath: rec.filePath, content });
    } catch {}
  }
  const triggerMap = parseTriggerTables(filesWithContent, projectRoot, homeDir);

  // 3. Inspect each file
  const entries = [];
  for (const rec of fileRecords) {
    const entry = inspectRuleFile(rec, triggerMap, projectRoot, homeDir);
    if (entry) entries.push(entry);
  }

  // 4. Sort entries:
  //    Order: Project always-on -> Project on-demand -> Kit always-on -> Kit on-demand
  //    Within category: sorted alphabetically by displayPath
  const sortKey = (e) => {
    let scopeOrder = e.scope === "project" ? "0" : "1";
    let modeOrder = e.loadMode.startsWith("always-on") ? "0" : "1";
    return `${scopeOrder}-${modeOrder}-${e.displayPath.toLowerCase()}`;
  };
  entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // 5. Compute summary metrics
  const alwaysOnEntries = entries.filter((e) => e.loadMode.startsWith("always-on"));
  const onDemandEntries = entries.filter((e) => !e.loadMode.startsWith("always-on"));

  const totalTokens = entries.reduce((s, e) => s + e.tokens, 0);
  const alwaysOnTokens = alwaysOnEntries.reduce((s, e) => s + e.tokens, 0);
  const onDemandTokens = onDemandEntries.reduce((s, e) => s + e.tokens, 0);

  const triggeredOnDemand = onDemandEntries.filter((e) => e.triggerRow !== "-");
  const coveragePercent = onDemandEntries.length > 0
    ? Math.round((triggeredOnDemand.length / onDemandEntries.length) * 100)
    : 100;

  const allLinkedDecisions = new Set(entries.flatMap((e) => e.linkedDecisions));

  // 6. Validation / check findings
  const issues = [];
  const warnings = [];

  for (const e of entries) {
    // Missing keywords in topic files
    if (!e.loadMode.startsWith("always-on") && (e.keywords === "-" || !e.keywords)) {
      issues.push(`[missing-keywords] ${e.displayPath}: topic rule has no \`Keywords:\` line`);
    }
    // Missing trigger row in on-demand files
    if (!e.loadMode.startsWith("always-on") && e.triggerRow === "-") {
      warnings.push(`[untriggered-rule] ${e.displayPath}: on-demand rule is not mapped in any trigger table and has no Trigger line`);
    }
    // Large always-on files without trigger table
    if (e.loadMode.startsWith("always-on") && e.tokens > MAP_MAX && !/before you/i.test(e.rawContent)) {
      issues.push(`[missing-trigger-table] ${e.displayPath}: ${e.tokens} est. tokens (>${MAP_MAX}) and no "Before you" trigger table`);
    }
  }

  // Check for broken links in trigger tables
  for (const { filePath, content } of filesWithContent) {
    const missing = missingTablePaths(content, filePath, projectRoot, homeDir);
    for (const m of missing) {
      issues.push(`[broken-trigger-target] ${formatDisplayPath(filePath, projectRoot, homeDir)}: trigger table path \`${m}\` does not exist on disk`);
    }
  }

  // 7. Render Markdown Table
  const tableRows = entries.map((e) => {
    const decStr = e.linkedDecisions.length > 0 ? e.linkedDecisions.map((d) => `\`${d}\``).join(", ") : "-";
    return `| \`${cleanCell(e.displayPath)}\` | ${cleanCell(e.loadMode)} | ${e.tokens} | ${cleanCell(e.keywords)} | ${cleanCell(e.triggerRow)} | ${cleanCell(decStr)} |`;
  });

  const mdLines = [
    `# Agent Rules View (${today})`,
    "",
    `Project: \`${projectRoot.replace(/\\/g, "/")}\` · Generated by \`rulesView.mjs\` (AGT-57, decision \`2026-10-25-lean-rules.md\`)`,
    `Total: **${entries.length}** rule files (**${totalTokens}** est. tokens) · Always-on: **${alwaysOnEntries.length}** (${alwaysOnTokens} tokens) · On-demand: **${onDemandEntries.length}** (${onDemandTokens} tokens)`,
    "",
    "## Rules Table",
    "",
    "| Path | Load Mode | Tokens | Keywords | Trigger Row | Linked Decisions |",
    "| :--- | :--- | ---: | :--- | :--- | :--- |",
    ...tableRows,
    "",
    "## Summary & Telemetry",
    `- **Always-on rules**: ${alwaysOnEntries.length} files, ~${alwaysOnTokens} est. tokens loaded into every session start.`,
    `- **On-demand rules**: ${onDemandEntries.length} files, ~${onDemandTokens} est. tokens available on trigger.`,
    `- **Total rules corpus**: ${entries.length} files, ~${totalTokens} est. tokens.`,
    `- **Trigger coverage**: ${triggeredOnDemand.length} / ${onDemandEntries.length} on-demand rules have mapped triggers (${coveragePercent}%).`,
    `- **Decision linkage**: ${allLinkedDecisions.size} linked decision references across rules.`,
    "",
  ];

  if (issues.length > 0 || warnings.length > 0) {
    mdLines.push("## Diagnostics", "");
    for (const iss of issues) mdLines.push(`- ❌ **Issue**: ${iss}`);
    for (const warn of warnings) mdLines.push(`- ⚠️ **Warning**: ${warn}`);
    mdLines.push("");
  }

  const markdown = mdLines.join("\n");

  // Determine output path
  const targetOutput = output
    ? path.resolve(output)
    : path.join(projectRoot, ".agents", "reports", "rules-view.md");

  if (writeDisk) {
    try {
      const outDir = path.dirname(targetOutput);
      fs.mkdirSync(outDir, { recursive: true });
      // Ensure .gitignore exists in reports dir
      const gitignorePath = path.join(outDir, ".gitignore");
      if (!fs.existsSync(gitignorePath)) {
        try { fs.writeFileSync(gitignorePath, "*\n", "utf8"); } catch {}
      }
      fs.writeFileSync(targetOutput, markdown, "utf8");
    } catch (err) {
      if (!output) {
        console.warn(`Warning: failed to write rules report to ${targetOutput}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  return {
    markdown,
    reportPath: targetOutput,
    entries,
    summary: {
      date: today,
      projectRoot,
      totalFiles: entries.length,
      totalTokens,
      alwaysOnCount: alwaysOnEntries.length,
      alwaysOnTokens,
      onDemandCount: onDemandEntries.length,
      onDemandTokens,
      triggerCoveragePercent: coveragePercent,
      linkedDecisionsCount: allLinkedDecisions.size,
    },
    issues,
    warnings,
    isValid: issues.length === 0,
  };
}

/**
 * CLI Entrypoint
 */
export function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const idx = argv.indexOf("--" + name);
    return idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--") ? argv[idx + 1] : fallback;
  };
  const flag = (name) => argv.includes("--" + name);

  if (flag("help") || flag("h")) {
    console.log(`rulesView v${RULES_VIEW_VERSION} (AGT-57, decision 2026-10-25-lean-rules.md)
Usage: node rulesView.mjs [--project <dir>] [options]

Options:
  --project <dir>    Target project root (default: nearest repo root or cwd)
  --output <file>    Output report path (default: <project>/.agents/reports/rules-view.md)
  --home <dir>       User home directory override (default: os.homedir())
  --stdout           Print generated markdown report to stdout
  --json             Print metadata as JSON to stdout
  --check            Audit mode: exit code 1 if issues found
  --quiet            Do not print summary messages to stdout`);
    process.exit(0);
  }

  const project = arg("project", process.cwd());
  const home = arg("home", os.homedir());
  const output = arg("output", null);
  const isJson = flag("json");
  const isStdout = flag("stdout");
  const isQuiet = flag("quiet");
  const isCheck = flag("check");

  try {
    const res = generateRulesView({
      project,
      home,
      output,
      writeDisk: !isStdout || !!output,
      check: isCheck,
    });

    if (isJson) {
      console.log(JSON.stringify(res, null, 2));
    } else if (isStdout) {
      console.log(res.markdown);
    } else if (!isQuiet) {
      console.log(`\n📋 Rules View generated successfully:`);
      console.log(`   Report: ${res.reportPath}`);
      console.log(`   Rules: ${res.summary.totalFiles} files (${res.summary.totalTokens} est. tokens)`);
      console.log(`   Always-on: ${res.summary.alwaysOnCount} files (${res.summary.alwaysOnTokens} tokens)`);
      console.log(`   On-demand: ${res.summary.onDemandCount} files (${res.summary.onDemandTokens} tokens)`);
      console.log(`   Trigger coverage: ${res.summary.triggerCoveragePercent}%`);
      console.log(`   Linked decisions: ${res.summary.linkedDecisionsCount}`);
      if (res.issues.length > 0) {
        console.log(`\n⚠️  Diagnostics (${res.issues.length} issues, ${res.warnings.length} warnings):`);
        for (const iss of res.issues) console.log(`   - ❌ ${iss}`);
        for (const warn of res.warnings) console.log(`   - ⚠️  ${warn}`);
      }
    }

    if (isCheck && !res.isValid) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Error generating rules view: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
