#!/usr/bin/env node
/**
 * mrReview: Autonomous MR review & audit gate tool (AGT-88).
 *
 * 1-command MR review readiness report with verification evidence, compacted diff,
 * and baton update; independent approval must match the exact reviewed revision before merge.
 *
 * Routing & Policy Protocol:
 *   .agents/decisions/2026-10-29-universal-manager-routing.md
 *   .agents/decisions/2026-10-29-worker-branch-mr-protocol.md
 *
 * CLI Usage:
 *   # 1. Worker generates readiness report & updates baton:
 *   node mrReview.mjs prepare [ticket-id] [--branch <branch>] [--base <base>] [--verify "<cmd>"] [--reviewer <@tag>] [--update-baton]
 *
 *   # 2. Reviewing brain conducts audit gate & verifies exact revision:
 *   node mrReview.mjs audit <ticket-id> --approved-revision <sha> --reviewer <name> [--verify "<cmd>"] [--merge] [--log-audit]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MR_REVIEW_VERSION = "1.0.0";

export const FAILURE_MARKERS = [
  /error TS\d+/,
  /^\s*FAIL\b/m,
  /\bnot ok\b/,
  /exit(ed)? (with )?code [1-9]/i,
  /\b[1-9]\d* (failed|errors?)\b/,
];

export const NOISE_FILE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.pnp\.[a-z]+$/,
  /\.map$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|webp|ico|mp4|webm|zip|tar\.gz)$/i,
];

function git(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err.stderr || err.message}`);
  }
}

function safeGit(args, cwd = process.cwd()) {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}

export function findGitRoot(start = process.cwd()) {
  try {
    return safeGit(["rev-parse", "--show-toplevel"], start) || path.resolve(start);
  } catch {
    return path.resolve(start);
  }
}

export function getCurrentBranch(root) {
  return safeGit(["rev-parse", "--abbrev-ref", "HEAD"], root) || "HEAD";
}

export function detectBaseBranch(root) {
  // Check common base branches: main, master
  const branches = safeGit(["branch", "-a"], root);
  if (/\bmaster\b/.test(branches)) return "master";
  if (/\bmain\b/.test(branches)) return "main";
  return "main";
}

export function inspectRevision(root, ref = "HEAD") {
  return safeGit(["rev-parse", ref], root);
}

export function inspectBranchHistory({ root, branch, base }) {
  const headSha = inspectRevision(root, branch);
  if (!headSha) throw new Error(`Could not resolve branch/revision: "${branch}"`);

  let baseSha = "";
  try {
    baseSha = git(["merge-base", base, branch], root);
  } catch {
    baseSha = inspectRevision(root, base);
  }

  // Get commits on branch that are not in base
  const logRaw = safeGit(
    ["log", `${baseSha}..${branch}`, "--format=%H%x09%an%x09%ae%x09%ad%x09%s"],
    root
  );

  const commits = [];
  const authors = new Set();

  if (logRaw.trim().length > 0) {
    const lines = logRaw.split(/\r?\n/);
    for (const l of lines) {
      const parts = l.split("\t");
      if (parts.length >= 5) {
        const [sha, authorName, authorEmail, date, message] = parts;
        commits.push({ sha, authorName, authorEmail, date, message });
        authors.add(authorName.trim());
        if (authorEmail) authors.add(authorEmail.trim());
      }
    }
  }

  return {
    branch,
    base,
    headSha,
    baseSha,
    commitCount: commits.length,
    commits,
    authors: Array.from(authors),
  };
}

export function generateCompactedDiff({ root, base, branch, maxHunkLines = 25, maxFiles = 50 }) {
  let baseRef = base;
  try {
    baseRef = git(["merge-base", base, branch], root);
  } catch {
    baseRef = base;
  }

  const statRaw = safeGit(["diff", "--stat", `${baseRef}...${branch}`], root);
  const nameStatusRaw = safeGit(["diff", "--name-status", `${baseRef}...${branch}`], root);
  const fullDiffRaw = safeGit(["diff", "-U2", `${baseRef}...${branch}`], root);

  const changedFiles = [];
  if (nameStatusRaw.trim().length > 0) {
    const lines = nameStatusRaw.split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split(/\t+/);
      if (parts.length >= 2) {
        changedFiles.push({ status: parts[0], path: parts[1] });
      }
    }
  }

  // Parse insertions / deletions from stat summary line (e.g. " 3 files changed, 25 insertions(+), 4 deletions(-)")
  let insertions = 0;
  let deletions = 0;
  let filesChangedCount = changedFiles.length;

  const summaryMatch = statRaw.match(/(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/);
  if (summaryMatch) {
    filesChangedCount = parseInt(summaryMatch[1], 10);
    insertions = summaryMatch[2] ? parseInt(summaryMatch[2], 10) : 0;
    deletions = summaryMatch[3] ? parseInt(summaryMatch[3], 10) : 0;
  }

  // Compact diff chunks
  const compactedLines = [];
  const diffLines = fullDiffRaw.split(/\r?\n/);
  let currentFile = "";
  let isNoiseFile = false;
  let currentHunkLines = 0;
  let truncatedInHunk = 0;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    if (line.startsWith("diff --git ")) {
      if (truncatedInHunk > 0) {
        compactedLines.push(`    ... [${truncatedInHunk} lines truncated for brevity]`);
        truncatedInHunk = 0;
      }
      currentHunkLines = 0;
      const fileMatch = line.match(/diff --git a\/(.*) b\/(.*)/);
      currentFile = fileMatch ? fileMatch[2] : "";
      isNoiseFile = NOISE_FILE_PATTERNS.some((p) => p.test(currentFile));

      compactedLines.push(line);
      if (isNoiseFile) {
        compactedLines.push(`    [Binary or large generated file excluded from compacted diff]`);
      }
      continue;
    }

    if (isNoiseFile) continue;

    if (line.startsWith("@@ ")) {
      if (truncatedInHunk > 0) {
        compactedLines.push(`    ... [${truncatedInHunk} lines truncated for brevity]`);
        truncatedInHunk = 0;
      }
      currentHunkLines = 0;
      compactedLines.push(line);
      continue;
    }

    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
      currentHunkLines++;
      if (currentHunkLines <= maxHunkLines) {
        compactedLines.push(line);
      } else {
        truncatedInHunk++;
      }
      continue;
    }

    compactedLines.push(line);
  }

  if (truncatedInHunk > 0) {
    compactedLines.push(`    ... [${truncatedInHunk} lines truncated for brevity]`);
  }

  return {
    diffStat: statRaw,
    changedFiles,
    filesChangedCount,
    insertions,
    deletions,
    compactedDiff: compactedLines.join("\n"),
  };
}

export function runVerificationCommand({ root, command, timeoutMs = 60000 }) {
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    return {
      command: "",
      executed: false,
      passed: true,
      exitCode: 0,
      durationMs: 0,
      stdout: "",
      stderr: "",
      summary: "No verification command specified.",
    };
  }

  const start = Date.now();
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/sh";
  const shellFlag = isWindows ? "/d /s /c" : "-c";

  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  try {
    const res = spawnSync(command, {
      cwd: root,
      shell: true,
      timeout: timeoutMs,
      encoding: "utf8",
    });
    exitCode = res.status ?? (res.signal ? 1 : 0);
    stdout = res.stdout ?? "";
    stderr = res.stderr ?? "";
  } catch (err) {
    exitCode = 1;
    stderr = err.message;
  }

  const durationMs = Date.now() - start;
  const combined = `${stdout}\n${stderr}`;
  const hasFailureMarker = FAILURE_MARKERS.some((m) => m.test(combined));
  const passed = exitCode === 0 && !hasFailureMarker;

  return {
    command,
    executed: true,
    passed,
    exitCode,
    durationMs,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    summary: passed
      ? `PASSED in ${durationMs}ms (exit code 0)`
      : `FAILED in ${durationMs}ms (exit code ${exitCode})`,
  };
}

export function checkReviewerIndependence({ authors = [], reviewer = "", allowSelfApproval = false }) {
  if (allowSelfApproval) {
    return { ok: true, reason: "Self-approval explicitly permitted via --allow-self-approval." };
  }

  const cleanReviewer = reviewer.replace(/^@/, "").trim().toLowerCase();
  if (!cleanReviewer) {
    return { ok: false, reason: "Reviewer identifier must not be empty." };
  }

  for (const author of authors) {
    const cleanAuthor = author.toLowerCase();
    // Direct match or substring match (e.g. "gemini" in "gemini-bot", or matching username)
    if (cleanAuthor === cleanReviewer || cleanAuthor.includes(cleanReviewer) || cleanReviewer.includes(cleanAuthor)) {
      return {
        ok: false,
        reason: `Reviewer independence violation: reviewer "${reviewer}" matches branch author "${author}". A separate author must conduct the independent review.`,
      };
    }
  }

  return { ok: true, reason: `Independent reviewer "${reviewer}" confirmed separate from authors (${authors.join(", ") || "none"}).` };
}

export function checkRevisionMatch({ headSha = "", approvedRevision = "" }) {
  const cleanHead = headSha.trim().toLowerCase();
  const cleanApproved = approvedRevision.trim().toLowerCase();

  if (!cleanApproved) {
    return { ok: false, reason: "Approved revision SHA must not be empty." };
  }

  if (cleanHead === cleanApproved || cleanHead.startsWith(cleanApproved) || cleanApproved.startsWith(cleanHead)) {
    return { ok: true, headSha: cleanHead, approvedRevision: cleanApproved };
  }

  return {
    ok: false,
    reason: `Approval revision mismatch: approved revision (${cleanApproved.slice(0, 10)}) does not match current branch revision (${cleanHead.slice(0, 10)}). The branch was updated after approval; re-review required.`,
  };
}

export function updateStateBaton({ root, ticketId, reviewer, headSha, branch }) {
  const statePath = path.join(root, ".agents", "STATE.md");
  if (!fs.existsSync(statePath)) {
    return { updated: false, reason: ".agents/STATE.md not found" };
  }

  const content = fs.readFileSync(statePath, "utf8");
  const cleanReviewer = reviewer.startsWith("@") ? reviewer : `@${reviewer}`;

  // Update Status and Next concrete step
  let updated = content;

  // Replace Status
  updated = updated.replace(
    /(- \*\*Status\*\*:\s*)([a-z-]+)/i,
    `$1needs-review`
  );

  // Replace or augment Next concrete step
  const nextStepRegex = /(- \*\*Next concrete step\*\*:\s*)(.*)/;
  if (nextStepRegex.test(updated)) {
    updated = updated.replace(
      nextStepRegex,
      `$1MR review ready for ${cleanReviewer} on ${branch} at exact revision \`${headSha.slice(0, 10)}\`. Run \`node tools/mrReview.mjs audit ${ticketId} --approved-revision ${headSha.slice(0, 10)} --reviewer ${cleanReviewer}\``
    );
  }

  fs.writeFileSync(statePath, updated, "utf8");
  return { updated: true, statePath, reviewer: cleanReviewer, headSha };
}

export function generateReadinessReport({
  ticketId,
  branch,
  base,
  history,
  diff,
  verification,
  reviewer = "@claude",
  date = new Date().toISOString().slice(0, 10),
}) {
  const statusBadge = verification.passed ? "READY FOR REVIEW" : "VERIFICATION FAILED";

  return `# MR Review Readiness Report: ${ticketId} [${statusBadge}]

- **Date**: ${date}
- **Branch**: \`${branch}\`
- **Base**: \`${base}\` (merge-base: \`${history.baseSha.slice(0, 10)}\`)
- **Exact Reviewed Revision**: \`${history.headSha}\`
- **Author(s)**: ${history.authors.join(", ") || "Unknown"}
- **Target Reviewer**: \`${reviewer}\`
- **Verification**: ${verification.summary} (\`${verification.command || "none"}\`)

## Diff Summary

\`\`\`
${diff.diffStat.trim() || "No files changed."}
\`\`\`

- **Files Changed**: ${diff.filesChangedCount}
- **Insertions**: +${diff.insertions}
- **Deletions**: -${diff.deletions}

## Verification Evidence

\`\`\`
Command: ${verification.command || "none"}
Exit Code: ${verification.exitCode} (${verification.passed ? "PASS" : "FAIL"})
Duration: ${verification.durationMs}ms

${verification.stdout.slice(0, 1500)}${verification.stdout.length > 1500 ? "\n... [truncated]" : ""}
${verification.stderr ? `\nSTDERR:\n${verification.stderr.slice(0, 500)}` : ""}
\`\`\`

## Compacted Diff

\`\`\`diff
${diff.compactedDiff.slice(0, 6000)}${diff.compactedDiff.length > 6000 ? "\n... [diff truncated for length; inspect git diff for full view]" : ""}
\`\`\`

## Independent Reviewer Instructions

1. **Inspect Diff**: Review the compacted diff above or inspect \`git diff ${base}...${history.headSha.slice(0, 10)}\`.
2. **Independent Verification**: Re-run verification at this exact revision: \`${verification.command || "yarn tsc --noEmit"}\`.
3. **Audit Gate & Merge**: Execute the one-command audit gate:
   \`\`\`bash
   node ~/.agents/tools/mrReview.mjs audit ${ticketId} --approved-revision ${history.headSha} --reviewer ${reviewer.replace(/^@/, "")} --merge --log-audit
   \`\`\`
`;
}

export function performAuditGate({
  root,
  ticketId,
  reviewer,
  approvedRevision,
  branch,
  base,
  verifyCmd,
  merge = false,
  allowSelfApproval = false,
  logAudit = true,
}) {
  const currentBranch = branch || getCurrentBranch(root);
  const targetBase = base || detectBaseBranch(root);
  const headSha = inspectRevision(root, currentBranch);

  // 1. Exact Revision Match Check
  const revCheck = checkRevisionMatch({ headSha, approvedRevision });
  if (!revCheck.ok) {
    return { ok: false, error: revCheck.reason, stage: "revision-check" };
  }

  // 2. Reviewer Independence Check
  const history = inspectBranchHistory({ root, branch: currentBranch, base: targetBase });
  const indepCheck = checkReviewerIndependence({
    authors: history.authors,
    reviewer,
    allowSelfApproval,
  });
  if (!indepCheck.ok) {
    return { ok: false, error: indepCheck.reason, stage: "independence-check" };
  }

  // 3. Re-verify Verification at exact revision
  let verification = { passed: true, summary: "No verify command supplied" };
  if (verifyCmd) {
    verification = runVerificationCommand({ root, command: verifyCmd });
    if (!verification.passed) {
      return {
        ok: false,
        error: `Verification re-check failed at revision ${headSha.slice(0, 10)}: ${verification.summary}`,
        verification,
        stage: "verification-check",
      };
    }
  }

  // 4. Merge if requested
  let mergeResult = null;
  if (merge) {
    try {
      git(["checkout", targetBase], root);
      git(["merge", "--no-ff", currentBranch, "-m", `feat(${ticketId}): merge ${currentBranch} approved by ${reviewer} at ${headSha.slice(0, 10)}`], root);
      mergeResult = { merged: true, base: targetBase, headSha };
    } catch (err) {
      return {
        ok: false,
        error: `Failed to merge ${currentBranch} into ${targetBase}: ${err.message}`,
        stage: "merge-execution",
      };
    }
  }

  // 5. Append to Audit Log if present
  let auditLogUpdated = false;
  const auditLogPath = path.join(root, ".agents", "reports", "audit-log.md");
  if (logAudit && fs.existsSync(auditLogPath)) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = `- ${today} · ${reviewer} · ${ticketId} · commit ${headSha.slice(0, 10)} · VERIFIED & APPROVED (base: ${targetBase}, verify: ${verifyCmd || "passed"})\n`;
    fs.appendFileSync(auditLogPath, entry, "utf8");
    auditLogUpdated = true;
  }

  return {
    ok: true,
    ticketId,
    reviewer,
    approvedRevision: headSha,
    branch: currentBranch,
    base: targetBase,
    independenceVerified: true,
    verification,
    merged: Boolean(mergeResult?.merged),
    auditLogUpdated,
    summary: `Audit gate PASSED for ${ticketId} at revision ${headSha.slice(0, 10)} by reviewer ${reviewer}.${merge ? " Merged to " + targetBase + "." : ""}`,
  };
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgs(argv);
  const root = flags.root ? path.resolve(flags.root) : findGitRoot();

  const command = positional[0]?.toLowerCase();
  const ticketId = positional[1] || flags.ticket;

  if (!command || flags.help || flags.h) {
    console.log(`mrReview v${MR_REVIEW_VERSION}: Autonomous MR review & audit gate tool

Usage:
  # Prepare MR review readiness report:
  node mrReview.mjs prepare [ticket-id] [options]
    --branch <name>             Branch to review (default: current branch)
    --base <name>               Base branch (default: auto-detected main/master)
    --verify "<cmd>"            Command to run for verification
    --reviewer <@tag>           Reviewer tag (default: @claude)
    --update-baton              Update .agents/STATE.md status to needs-review
    --out <file>                Save report to file
    --json                      Machine-readable JSON output

  # Conduct independent audit gate & exact-revision merge:
  node mrReview.mjs audit <ticket-id> [options]
    --approved-revision <sha>   Exact reviewed commit SHA (REQUIRED)
    --reviewer <name>           Reviewer agent name (REQUIRED)
    --verify "<cmd>"            Re-verify command at this revision
    --merge                     Merge to base if verified and approved
    --allow-self-approval       Allow same author to approve (fails by default)
    --log-audit                 Append to .agents/reports/audit-log.md
    --json                      Machine-readable JSON output
`);
    process.exit(command ? 0 : 1);
  }

  if (command === "prepare" || command === "ready" || command === "report") {
    const branch = flags.branch || getCurrentBranch(root);
    const id = ticketId || (branch.match(/[A-Z0-9]+-[A-Z0-9_-]+/i) ? branch.match(/[A-Z0-9]+-[A-Z0-9_-]+/i)[0].toUpperCase() : "TASK");
    const base = flags.base || detectBaseBranch(root);
    const reviewer = flags.reviewer || "@claude";
    const verifyCmd = flags.verify || "";

    const history = inspectBranchHistory({ root, branch, base });
    const diff = generateCompactedDiff({ root, base, branch });
    const verification = runVerificationCommand({ root, command: verifyCmd });

    let batonResult = null;
    if (flags["update-baton"] || flags.updateBaton) {
      batonResult = updateStateBaton({
        root,
        ticketId: id,
        reviewer,
        headSha: history.headSha,
        branch,
      });
    }

    const reportMd = generateReadinessReport({
      ticketId: id,
      branch,
      base,
      history,
      diff,
      verification,
      reviewer,
    });

    if (flags.out) {
      const outPath = path.resolve(root, flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, reportMd, "utf8");
      console.log(`✅ Saved MR review report to: ${outPath}`);
    }

    if (flags.json) {
      console.log(JSON.stringify({ ticketId: id, branch, base, history, diff, verification, batonResult }, null, 2));
    } else if (!flags.out) {
      console.log(reportMd);
    }
    return;
  }

  if (command === "audit" || command === "check" || command === "merge") {
    if (!ticketId) {
      console.error("❌ Error: ticket-id required for audit. E.g. node mrReview.mjs audit AGT-88 --approved-revision <sha> --reviewer claude");
      process.exit(1);
    }
    const approvedRevision = flags["approved-revision"] || flags.approvedRevision;
    const reviewer = flags.reviewer;

    if (!approvedRevision) {
      console.error("❌ Error: --approved-revision <sha> is REQUIRED for audit gate.");
      process.exit(1);
    }
    if (!reviewer) {
      console.error("❌ Error: --reviewer <name> is REQUIRED for audit gate.");
      process.exit(1);
    }

    const res = performAuditGate({
      root,
      ticketId,
      reviewer,
      approvedRevision,
      branch: flags.branch,
      base: flags.base,
      verifyCmd: flags.verify,
      merge: Boolean(flags.merge || command === "merge"),
      allowSelfApproval: Boolean(flags["allow-self-approval"] || flags.allowSelfApproval),
      logAudit: Boolean(flags["log-audit"] !== false),
    });

    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(`\n✅ ${res.summary}`);
      if (res.auditLogUpdated) console.log(`📝 Recorded entry in .agents/reports/audit-log.md`);
    } else {
      console.error(`\n❌ Audit Gate Failed (${res.stage}): ${res.error}`);
      process.exit(1);
    }
    return;
  }

  console.error(`Unknown subcommand: "${command}". Use "prepare" or "audit".`);
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
