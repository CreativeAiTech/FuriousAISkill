import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  checkRevisionMatch,
  checkReviewerIndependence,
  runVerificationCommand,
  generateCompactedDiff,
  inspectBranchHistory,
  performAuditGate,
  generateReadinessReport,
  updateStateBaton,
} from "./mrReview.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mr-review-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function initGitRepo(dir, author = "Alice", email = "alice@example.com") {
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-b", "main"]);
  git(["config", "user.name", author]);
  git(["config", "user.email", email]);
  git(["config", "commit.gpgsign", "false"]);

  fs.writeFileSync(path.join(dir, "README.md"), "# Initial\n", "utf8");
  git(["add", "."]);
  git(["commit", "-m", "chore: initial commit"]);
  return git;
}

test("checkRevisionMatch verifies exact sha match and rejects mismatch or empty", () => {
  const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  const matchFull = checkRevisionMatch({ headSha: sha, approvedRevision: sha });
  assert.equal(matchFull.ok, true);

  const matchPrefix = checkRevisionMatch({ headSha: sha, approvedRevision: "a1b2c3d" });
  assert.equal(matchPrefix.ok, true);

  const mismatch = checkRevisionMatch({ headSha: sha, approvedRevision: "deadbeef" });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.reason.includes("Approval revision mismatch"));

  const empty = checkRevisionMatch({ headSha: sha, approvedRevision: "" });
  assert.equal(empty.ok, false);
});

test("checkReviewerIndependence prevents self-approval unless explicit override is given", () => {
  const authors = ["Gemini", "Alex <alex@example.com>"];

  // Same author as reviewer: fail
  const selfReview = checkReviewerIndependence({ authors, reviewer: "Gemini" });
  assert.equal(selfReview.ok, false);
  assert.ok(selfReview.reason.includes("Reviewer independence violation"));

  // Substring / case-insensitive author: fail
  const selfReviewAt = checkReviewerIndependence({ authors, reviewer: "@gemini" });
  assert.equal(selfReviewAt.ok, false);

  // Distinct reviewer: pass
  const diffReview = checkReviewerIndependence({ authors, reviewer: "Claude" });
  assert.equal(diffReview.ok, true);

  // Allow self-approval override: pass
  const forcedSelf = checkReviewerIndependence({ authors, reviewer: "Gemini", allowSelfApproval: true });
  assert.equal(forcedSelf.ok, true);
});

test("runVerificationCommand captures exit code and failure markers", () => {
  withTempDir((dir) => {
    const nodeBin = `"${process.execPath}"`;
    // 1. Success command
    const passRes = runVerificationCommand({ root: dir, command: `${nodeBin} -e "console.log(\\"all ok\\")"` });
    assert.equal(passRes.passed, true);
    assert.equal(passRes.exitCode, 0);

    // 2. Non-zero exit code
    const failRes = runVerificationCommand({ root: dir, command: `${nodeBin} -e "process.exit(2)"` });
    assert.equal(failRes.passed, false);
    assert.equal(failRes.exitCode, 2);

    // 3. Failure marker in stdout even with exit 0
    const markerRes = runVerificationCommand({ root: dir, command: `${nodeBin} -e "console.log(\\"FAIL: component broken\\")"` });
    assert.equal(markerRes.passed, false);
  });
});

test("generateCompactedDiff and branch inspection on real git repository", () => {
  withTempDir((dir) => {
    const git = initGitRepo(dir, "WorkerBot", "worker@example.com");

    // Branch off main
    git(["checkout", "-b", "feat/AGT-88"]);
    fs.writeFileSync(path.join(dir, "feature.js"), "export const x = 42;\nexport const y = 100;\n", "utf8");
    fs.appendFileSync(path.join(dir, "README.md"), "Feature added\n", "utf8");
    git(["add", "."]);
    git(["commit", "-m", "feat(AGT-88): implement feature"]);

    const history = inspectBranchHistory({ root: dir, branch: "feat/AGT-88", base: "main" });
    assert.equal(history.commitCount, 1);
    assert.ok(history.authors.includes("WorkerBot"));
    assert.ok(history.headSha.length === 40);

    const diff = generateCompactedDiff({ root: dir, base: "main", branch: "feat/AGT-88" });
    assert.equal(diff.filesChangedCount, 2);
    assert.ok(diff.insertions > 0);
    assert.ok(diff.compactedDiff.includes("export const x = 42"));

    const report = generateReadinessReport({
      ticketId: "AGT-88",
      branch: "feat/AGT-88",
      base: "main",
      history,
      diff,
      verification: { passed: true, summary: "PASSED", command: "test", exitCode: 0, durationMs: 12, stdout: "ok", stderr: "" },
      reviewer: "@claude",
    });

    assert.ok(report.includes("# MR Review Readiness Report: AGT-88 [READY FOR REVIEW]"));
    assert.ok(report.includes("WorkerBot"));
    assert.ok(report.includes(history.headSha));
  });
});

test("updateStateBaton updates status to needs-review and records reviewed revision", () => {
  withTempDir((dir) => {
    const stateDir = path.join(dir, ".agents");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "STATE.md"),
      `# State\n- **Status**: in-progress\n- **Next concrete step**: Do implementation\n`,
      "utf8"
    );

    const res = updateStateBaton({
      root: dir,
      ticketId: "AGT-88",
      reviewer: "@claude",
      headSha: "fedcba9876543210fedcba9876543210fedcba98",
      branch: "feat/AGT-88",
    });

    assert.equal(res.updated, true);
    const updated = fs.readFileSync(path.join(stateDir, "STATE.md"), "utf8");
    assert.ok(updated.includes("- **Status**: needs-review"));
    assert.ok(updated.includes("fedcba9876"));
    assert.ok(updated.includes("@claude"));
  });
});

test("performAuditGate enforces independent reviewer, exact revision match, and clean merge", () => {
  withTempDir((dir) => {
    const git = initGitRepo(dir, "GeminiWorker", "gemini@example.com");

    // Setup reports dir and audit log
    const reportsDir = path.join(dir, ".agents", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const auditLogPath = path.join(reportsDir, "audit-log.md");
    fs.writeFileSync(auditLogPath, "# Audit Log\n", "utf8");

    // Branch off main
    git(["checkout", "-b", "feat/AGT-88"]);
    fs.writeFileSync(path.join(dir, "tool.mjs"), "console.log('hello');\n", "utf8");
    git(["add", "."]);
    git(["commit", "-m", "feat: new tool"]);

    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    // 1. Self-approval attempt: must fail independence check
    const selfRes = performAuditGate({
      root: dir,
      ticketId: "AGT-88",
      reviewer: "GeminiWorker",
      approvedRevision: headSha,
      branch: "feat/AGT-88",
      base: "main",
    });
    assert.equal(selfRes.ok, false);
    assert.equal(selfRes.stage, "independence-check");
    assert.ok(selfRes.error.includes("Reviewer independence violation"));

    // 2. Revision mismatch attempt: must fail revision check
    const wrongRevRes = performAuditGate({
      root: dir,
      ticketId: "AGT-88",
      reviewer: "ClaudeBrain",
      approvedRevision: "0000000000000000000000000000000000000000",
      branch: "feat/AGT-88",
      base: "main",
    });
    assert.equal(wrongRevRes.ok, false);
    assert.equal(wrongRevRes.stage, "revision-check");
    assert.ok(wrongRevRes.error.includes("Approval revision mismatch"));

    // 3. Independent approval with exact revision & merge: must succeed
    const validRes = performAuditGate({
      root: dir,
      ticketId: "AGT-88",
      reviewer: "ClaudeBrain",
      approvedRevision: headSha,
      branch: "feat/AGT-88",
      base: "main",
      merge: true,
      logAudit: true,
    });

    assert.equal(validRes.ok, true);
    assert.equal(validRes.merged, true);
    assert.equal(validRes.auditLogUpdated, true);

    // Verify main branch now has the merged commit
    const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    assert.equal(currentBranch, "main");
    assert.ok(fs.existsSync(path.join(dir, "tool.mjs")));

    // Verify audit log has the entry
    const auditContent = fs.readFileSync(auditLogPath, "utf8");
    assert.ok(auditContent.includes("ClaudeBrain"));
    assert.ok(auditContent.includes("AGT-88"));
    assert.ok(auditContent.includes(headSha.slice(0, 10)));
    assert.ok(auditContent.includes("VERIFIED & APPROVED"));
  });
});
