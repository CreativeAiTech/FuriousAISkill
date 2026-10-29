import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  scaffoldDossier,
  buildSpecTemplate,
  buildAcceptTemplate,
  buildLogTemplate,
  UNREVIEWED_BANNER,
  ACCEPT_TEMPLATE_DISCLAIMER,
} from "./dossierScaffold.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dossier-scaffold-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("buildSpecTemplate includes unreviewed banner and expected sections", () => {
  const spec = buildSpecTemplate({ id: "AGT-99", title: "Test Spec", type: "tooling", target: "0.05" });
  assert.ok(spec.includes(UNREVIEWED_BANNER));
  assert.ok(spec.includes("Status**: unreviewed-template"));
  assert.ok(spec.includes("Goal"));
  assert.ok(spec.includes("Acceptance Criteria (Draft Placeholders — Unapproved)"));
  assert.ok(spec.includes("Stop Rule"));
});

test("buildAcceptTemplate includes disclaimer and fails C0 when unapproved", () => {
  withTempDir((dir) => {
    const acceptCode = buildAcceptTemplate({ id: "AGT-99" });
    assert.ok(acceptCode.includes("WARNING: UNREVIEWED TEMPLATE ONLY"));
    assert.ok(acceptCode.includes("isTemplateOnly: true"));

    const acceptPath = path.join(dir, "accept.mjs");
    fs.writeFileSync(acceptPath, acceptCode, "utf8");

    // Execute accept.mjs unapproved: must exit with code 1 due to template status
    let threw = false;
    try {
      execFileSync(process.execPath, [acceptPath], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      threw = true;
      assert.equal(err.status, 1);
      assert.ok(err.stdout.includes("FAIL C0: Qualified reviewer sign-off check"));
      assert.ok(err.stdout.includes("UNREVIEWED TEMPLATE status"));
    }
    assert.ok(threw, "Unapproved accept.mjs must fail execution");
  });
});

test("accept.mjs passes C0 when reviewer approval is filled and isTemplateOnly is false", () => {
  withTempDir((dir) => {
    let acceptCode = buildAcceptTemplate({ id: "AGT-99" });
    // Simulate qualified reviewer sign-off and custom criterion
    acceptCode = acceptCode
      .replace("isTemplateOnly: true,", "isTemplateOnly: false,")
      .replace("approvedBy: null,", 'approvedBy: "claude",')
      .replace("approvedAt: null,", 'approvedAt: "2026-10-29T12:00:00Z",')
      .replace('return "Verified";', 'return "Tested and verified";');

    const acceptPath = path.join(dir, "accept.mjs");
    fs.writeFileSync(acceptPath, acceptCode, "utf8");

    const out = execFileSync(process.execPath, [acceptPath], { cwd: dir, encoding: "utf8" });
    assert.ok(out.includes("PASS C0: Qualified reviewer sign-off check: Approved by claude"));
    assert.ok(out.includes("PASS C1: Acceptance criteria check (placeholder): Tested and verified"));
  });
});

test("scaffoldDossier creates spec.md, log.md, and accept.mjs on disk", () => {
  withTempDir((dir) => {
    const res = scaffoldDossier("AGT-88", {
      root: dir,
      title: "Autonomous MR Review",
      type: "tooling",
      target: "0.05",
    });

    assert.equal(res.ticketId, "AGT-88");
    assert.equal(res.isTemplateOnly, true);
    assert.equal(res.files.length, 3);

    const specPath = path.join(dir, ".agents", "tasks", "AGT-88", "spec.md");
    const logPath = path.join(dir, ".agents", "tasks", "AGT-88", "log.md");
    const acceptPath = path.join(dir, ".agents", "tasks", "AGT-88", "accept.mjs");

    assert.ok(fs.existsSync(specPath));
    assert.ok(fs.existsSync(logPath));
    assert.ok(fs.existsSync(acceptPath));

    const specContent = fs.readFileSync(specPath, "utf8");
    assert.ok(specContent.includes("AGT-88: Autonomous MR Review"));
    assert.ok(specContent.includes(UNREVIEWED_BANNER));

    // Refuses to overwrite without --force
    assert.throws(
      () => scaffoldDossier("AGT-88", { root: dir }),
      /already exists with files/
    );

    // Overwrites with force
    const forced = scaffoldDossier("AGT-88", { root: dir, force: true, title: "Forced Update" });
    assert.ok(forced.files.length === 3);
  });
});

test("scaffoldDossier dry-run produces files metadata without writing to disk", () => {
  withTempDir((dir) => {
    const res = scaffoldDossier("ETH-42", {
      root: dir,
      dryRun: true,
      title: "Dry run test",
    });

    assert.equal(res.dryRun, true);
    assert.equal(res.files.length, 3);
    const targetDir = path.join(dir, ".agents", "tasks", "ETH-42");
    assert.ok(!fs.existsSync(targetDir));
  });
});

test("scaffoldDossier rejects invalid ticket IDs", () => {
  assert.throws(() => scaffoldDossier("invalid_id"), /Invalid ticket ID format/);
  assert.throws(() => scaffoldDossier(""), /Invalid ticket ID format/);
  assert.throws(() => scaffoldDossier("../traversal"), /Invalid ticket ID format/);
});
