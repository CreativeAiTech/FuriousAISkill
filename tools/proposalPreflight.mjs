#!/usr/bin/env node
/**
 * proposalPreflight: executable worker-proposal preflight (RSR-03 / AGT-79).
 *
 * Verifies proposal provenance, baseline SHA-256 freshness, patch syntax,
 * patch applicability in isolation (via git apply --check), context packet validity,
 * and claimed verification evidence.
 *
 * CLI:
 *   node proposalPreflight.mjs check <proposal.json> [--root <dir>] [--out <report.json>]
 *   node proposalPreflight.mjs hash <file...> [--root <dir>]
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPacket } from "./contextPacket.mjs";

export const PREFLIGHT_VERSION = "1.0.0";

const FAILURE_MARKERS = [
  /error TS\d+/,
  /^\s*FAIL\b/m,
  /\bnot ok\b/,
  /exit(ed)? (with )?code [1-9]/i,
  /\b[1-9]\d* (failed|errors?)\b/,
];

const DISCLAIMER = "Preflight checks provenance and applicability only; it is not behavioral proof. Re-run verification yourself.";

const sha256Lf = (text) => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

function isPathUnsafe(p) {
  if (typeof p !== "string" || p.trim().length === 0) return true;
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return true;
  const parts = normalized.split("/");
  if (parts.includes("..")) return true;
  return false;
}

function parsePatch(patchText) {
  const lines = patchText.split(/\r?\n/);
  const touchedFiles = new Set();
  const modifiedFiles = new Set();
  const newFiles = new Set();

  let hasGitHeader = false;
  let hasMinus = false;
  let hasPlus = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      hasGitHeader = true;
    } else if (line.startsWith("--- ")) {
      hasMinus = true;
      let rawA = line.slice(4).trim().split("\t")[0].trim();
      if (rawA.startsWith('"') && rawA.endsWith('"')) rawA = rawA.slice(1, -1);

      let rawB = null;
      if (i + 1 < lines.length && lines[i + 1].startsWith("+++ ")) {
        hasPlus = true;
        rawB = lines[i + 1].slice(4).trim().split("\t")[0].trim();
        if (rawB.startsWith('"') && rawB.endsWith('"')) rawB = rawB.slice(1, -1);
      }

      const cleanPath = (p) => {
        if (!p || p === "/dev/null") return null;
        return p.replace(/^[ab]\//, "").replace(/\\/g, "/");
      };

      const fileA = cleanPath(rawA);
      const fileB = cleanPath(rawB);

      if (rawA === "/dev/null" && fileB) {
        touchedFiles.add(fileB);
        newFiles.add(fileB);
      } else if (rawB === "/dev/null" && fileA) {
        touchedFiles.add(fileA);
        modifiedFiles.add(fileA);
      } else {
        const file = fileB || fileA;
        if (file) {
          touchedFiles.add(file);
          modifiedFiles.add(file);
        }
      }
    } else if (line.startsWith("+++ ")) {
      hasPlus = true;
    }
  }

  const parseable = (hasGitHeader || (hasMinus && hasPlus)) && touchedFiles.size > 0;
  return {
    parseable,
    touchedFiles: Array.from(touchedFiles),
    modifiedFiles: Array.from(modifiedFiles),
    newFiles: Array.from(newFiles),
  };
}

function validateSchema(proposal) {
  if (!proposal || typeof proposal !== "object") {
    return "Proposal must be a non-null object";
  }
  if (proposal.schemaVersion !== PREFLIGHT_VERSION) {
    return `Invalid schemaVersion: expected ${PREFLIGHT_VERSION}, got ${proposal.schemaVersion}`;
  }
  if (typeof proposal.id !== "string" || !proposal.id.trim()) {
    return "Missing or empty proposal id";
  }
  if (typeof proposal.goal !== "string" || !proposal.goal.trim()) {
    return "Missing or empty proposal goal";
  }
  if (!proposal.author || typeof proposal.author !== "object") {
    return "Missing or invalid author";
  }
  if (!Array.isArray(proposal.baseline)) {
    return "baseline must be an array";
  }
  for (let i = 0; i < proposal.baseline.length; i++) {
    const b = proposal.baseline[i];
    if (!b || typeof b !== "object" || typeof b.path !== "string" || typeof b.sha256 !== "string") {
      return `baseline[${i}] must have path and sha256 strings`;
    }
  }
  if (!Array.isArray(proposal.changedFiles) || proposal.changedFiles.some((f) => typeof f !== "string")) {
    return "changedFiles must be an array of strings";
  }
  if (typeof proposal.patch !== "string" || !proposal.patch.trim()) {
    return "Missing or empty patch path";
  }
  if (proposal.sourcePacket !== undefined && proposal.sourcePacket !== null && typeof proposal.sourcePacket !== "string") {
    return "sourcePacket must be a string if provided";
  }
  if (!Array.isArray(proposal.verification)) {
    return "verification must be an array";
  }
  for (let i = 0; i < proposal.verification.length; i++) {
    const v = proposal.verification[i];
    if (!v || typeof v !== "object" || typeof v.command !== "string" || typeof v.claimedResult !== "string") {
      return `verification[${i}] must have command and claimedResult strings`;
    }
    if (v.evidence !== null && (typeof v.evidence !== "object" || typeof v.evidence.path !== "string" || typeof v.evidence.sha256 !== "string")) {
      return `verification[${i}].evidence must be null or have path and sha256 strings`;
    }
  }
  return null;
}


/**
 * Preflight a proposal object against root repo and baseDir.
 *
 * @param {object} proposal
 * @param {{ root?: string, baseDir?: string }} options
 * @returns {Promise<object>}
 */
export async function preflightProposal(proposal, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const reasons = [];

  const schemaErr = validateSchema(proposal);
  if (schemaErr) {
    reasons.push({ code: "schema-invalid", detail: schemaErr });
    return {
      toolVersion: PREFLIGHT_VERSION,
      proposalId: typeof proposal?.id === "string" ? proposal.id : "unknown",
      checkedAt: new Date().toISOString(),
      verdict: "reject",
      reasons,
      checks: { baseline: [], patch: { touchedFiles: [], applies: false, stderr: "" }, packet: null, verification: [] },
      rerunForReviewer: [],
      disclaimer: DISCLAIMER,
    };
  }

  // 1. Unsafe path check on baseline and changedFiles
  for (const b of proposal.baseline) {
    if (isPathUnsafe(b.path)) {
      reasons.push({ code: "unsafe-path", detail: `Unsafe baseline path: ${b.path}` });
    }
  }
  for (const c of proposal.changedFiles) {
    if (isPathUnsafe(c)) {
      reasons.push({ code: "unsafe-path", detail: `Unsafe changedFiles path: ${c}` });
    }
  }
  if (isPathUnsafe(proposal.patch)) {
    reasons.push({ code: "unsafe-path", detail: `Unsafe patch path: ${proposal.patch}` });
  }

  // 2. Baseline checks
  const baselineChecks = [];
  for (const b of proposal.baseline) {
    if (isPathUnsafe(b.path)) continue;
    const full = path.resolve(root, b.path);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      reasons.push({ code: "baseline-missing-file", detail: `Baseline file not found on disk: ${b.path}` });
      baselineChecks.push({ path: b.path, declaredSha256: b.sha256, status: "missing" });
    } else {
      const liveSha = sha256Lf(fs.readFileSync(full, "utf8"));
      if (liveSha !== b.sha256) {
        reasons.push({ code: "stale-baseline", detail: `Stale baseline for ${b.path}: live ${liveSha} != declared ${b.sha256}` });
        baselineChecks.push({ path: b.path, declaredSha256: b.sha256, liveSha256: liveSha, status: "stale" });
      } else {
        baselineChecks.push({ path: b.path, declaredSha256: b.sha256, liveSha256: liveSha, status: "ok" });
      }
    }
  }

  // 3. Patch checks
  let parsed = null;
  const patchFullPath = path.resolve(baseDir, proposal.patch);
  if (!fs.existsSync(patchFullPath) || !fs.statSync(patchFullPath).isFile()) {
    reasons.push({ code: "patch-missing", detail: `Patch file not found: ${proposal.patch}` });
  } else {
    const rawPatch = fs.readFileSync(patchFullPath, "utf8");
    parsed = parsePatch(rawPatch);
    if (!parsed.parseable) {
      reasons.push({ code: "patch-unparseable", detail: `Patch header unparseable or no touched files: ${proposal.patch}` });
    } else {
      for (const tf of parsed.touchedFiles) {
        if (isPathUnsafe(tf)) {
          reasons.push({ code: "unsafe-path", detail: `Unsafe path in patch: ${tf}` });
        }
      }
    }
  }

  // 4. Changed files mismatch check
  if (parsed && parsed.parseable) {
    const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
    const declaredSet = new Set(proposal.changedFiles.map(norm));
    const touchedSet = new Set(parsed.touchedFiles.map(norm));

    let mismatch = declaredSet.size !== touchedSet.size;
    if (!mismatch) {
      for (const f of declaredSet) {
        if (!touchedSet.has(f)) {
          mismatch = true;
          break;
        }
      }
    }
    if (mismatch) {
      reasons.push({
        code: "changed-files-mismatch",
        detail: `Touched files [${Array.from(touchedSet).join(", ")}] != declared changedFiles [${Array.from(declaredSet).join(", ")}]`,
      });
    }

    const baselinePaths = new Set(proposal.baseline.map((b) => norm(b.path)));
    for (const mf of parsed.modifiedFiles.map(norm)) {
      if (!baselinePaths.has(mf)) {
        reasons.push({ code: "changed-files-mismatch", detail: `Modified file ${mf} has no baseline entry` });
      }
    }
  }

  // 5. Patch application in isolation
  let patchCheckResult = {
    touchedFiles: parsed ? parsed.touchedFiles : [],
    applies: false,
    stderr: "",
  };

  const hasStructuralReject = reasons.some((r) =>
    ["schema-invalid", "unsafe-path", "baseline-missing-file", "patch-missing", "patch-unparseable"].includes(r.code)
  );

  if (!hasStructuralReject && parsed && parsed.parseable) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-preflight-"));
    try {
      for (const b of proposal.baseline) {
        const srcFile = path.resolve(root, b.path);
        const destFile = path.resolve(tmpDir, b.path);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        const content = fs.readFileSync(srcFile, "utf8").replace(/\r\n/g, "\n");
        fs.writeFileSync(destFile, content, "utf8");
      }
      const patchContent = fs.readFileSync(patchFullPath, "utf8").replace(/\r\n/g, "\n");
      const tmpPatchFile = path.resolve(tmpDir, "change.patch");
      fs.writeFileSync(tmpPatchFile, patchContent, "utf8");

      const res = spawnSync("git", ["apply", "--check", "--verbose", "change.patch"], { cwd: tmpDir, encoding: "utf8" });
      const stderr = res.stderr || "";
      const applies = res.status === 0;
      patchCheckResult = {
        touchedFiles: parsed.touchedFiles,
        applies,
        stderr: stderr.trim(),
      };
      if (!applies) {
        reasons.push({ code: "patch-does-not-apply", detail: stderr.trim() || "git apply --check failed" });
      }
    } catch (err) {
      reasons.push({ code: "patch-does-not-apply", detail: err.message });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 6. Packet checks
  let packetCheckResult = null;
  if (proposal.sourcePacket) {
    if (isPathUnsafe(proposal.sourcePacket)) {
      reasons.push({ code: "unsafe-path", detail: `Unsafe sourcePacket path: ${proposal.sourcePacket}` });
    } else {
      const packetFullPath = path.resolve(baseDir, proposal.sourcePacket);
      if (!fs.existsSync(packetFullPath) || !fs.statSync(packetFullPath).isFile()) {
        reasons.push({ code: "packet-invalid", detail: `Source packet file not found: ${proposal.sourcePacket}` });
        packetCheckResult = { ok: false, errors: [`File not found: ${proposal.sourcePacket}`] };
      } else {
        try {
          const packetJson = JSON.parse(fs.readFileSync(packetFullPath, "utf8"));
          const packetRes = verifyPacket(packetJson, { root });
          packetCheckResult = packetRes;
          if (!packetRes.ok) {
            reasons.push({ code: "packet-invalid", detail: (packetRes.errors || []).join("; ") });
          }
        } catch (err) {
          reasons.push({ code: "packet-invalid", detail: `Packet parse/verify error: ${err.message}` });
          packetCheckResult = { ok: false, errors: [err.message] };
        }
      }
    }
  }

  // 7. Verification checks
  const verificationChecks = [];
  const rerunForReviewer = [];
  for (const claim of proposal.verification) {
    if (claim.command) {
      rerunForReviewer.push(claim.command);
    }
    if (claim.evidence === null) {
      reasons.push({ code: "verification-unknown", detail: `Verification command has no evidence: ${claim.command}` });
      verificationChecks.push({
        command: claim.command,
        claimedResult: claim.claimedResult,
        evidencePath: null,
        status: "unknown",
      });
    } else if (claim.evidence && typeof claim.evidence === "object") {
      const evRel = claim.evidence.path;
      if (isPathUnsafe(evRel)) {
        reasons.push({ code: "unsafe-path", detail: `Unsafe evidence path: ${evRel}` });
        verificationChecks.push({
          command: claim.command,
          claimedResult: claim.claimedResult,
          evidencePath: evRel,
          status: "unsafe",
        });
      } else {
        const evFull = path.resolve(baseDir, evRel);
        if (!fs.existsSync(evFull) || !fs.statSync(evFull).isFile()) {
          reasons.push({ code: "evidence-missing-file", detail: `Evidence file missing: ${evRel}` });
          verificationChecks.push({
            command: claim.command,
            claimedResult: claim.claimedResult,
            evidencePath: evRel,
            status: "missing",
          });
        } else {
          const rawEv = fs.readFileSync(evFull, "utf8");
          const evLf = rawEv.replace(/\r\n/g, "\n");
          const actualSha = crypto.createHash("sha256").update(evLf, "utf8").digest("hex");
          if (actualSha !== claim.evidence.sha256) {
            reasons.push({
              code: "evidence-tampered",
              detail: `Evidence tampered for ${evRel}: declared ${claim.evidence.sha256}, actual ${actualSha}`,
            });
            verificationChecks.push({
              command: claim.command,
              claimedResult: claim.claimedResult,
              evidencePath: evRel,
              status: "tampered",
            });
          } else {
            if (claim.claimedResult === "pass") {
              const matched = FAILURE_MARKERS.find((re) => re.test(evLf));
              if (matched) {
                reasons.push({
                  code: "verification-contradicted",
                  detail: `Evidence contains failure marker matching ${matched}: ${evRel}`,
                });
                verificationChecks.push({
                  command: claim.command,
                  claimedResult: claim.claimedResult,
                  evidencePath: evRel,
                  status: "contradicted",
                });
              } else {
                verificationChecks.push({
                  command: claim.command,
                  claimedResult: claim.claimedResult,
                  evidencePath: evRel,
                  status: "ok",
                });
              }
            } else {
              verificationChecks.push({
                command: claim.command,
                claimedResult: claim.claimedResult,
                evidencePath: evRel,
                status: "ok",
              });
            }
          }
        }
      }
    }
  }

  // Verdict calculation
  const hasReject = reasons.some((r) => r.code !== "verification-unknown");
  let verdict;
  if (hasReject) {
    verdict = "reject";
  } else if (reasons.some((r) => r.code === "verification-unknown")) {
    verdict = "review-with-unknowns";
  } else {
    verdict = "ready-for-review";
  }

  return {
    toolVersion: PREFLIGHT_VERSION,
    proposalId: proposal.id,
    checkedAt: new Date().toISOString(),
    verdict,
    reasons,
    checks: {
      baseline: baselineChecks,
      patch: patchCheckResult,
      packet: packetCheckResult,
      verification: verificationChecks,
    },
    rerunForReviewer,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Preflight a proposal from a JSON file.
 *
 * @param {string} proposalPath
 * @param {{ root?: string }} options
 * @returns {Promise<object>}
 */
export async function preflightFile(proposalPath, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const resolvedPath = path.resolve(proposalPath);
  const baseDir = path.dirname(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      toolVersion: PREFLIGHT_VERSION,
      proposalId: "unknown",
      checkedAt: new Date().toISOString(),
      verdict: "reject",
      reasons: [{ code: "schema-invalid", detail: `Proposal file not found: ${proposalPath}` }],
      checks: { baseline: [], patch: { touchedFiles: [], applies: false, stderr: "" }, packet: null, verification: [] },
      rerunForReviewer: [],
      disclaimer: DISCLAIMER,
    };
  }

  let proposal;
  try {
    proposal = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    return {
      toolVersion: PREFLIGHT_VERSION,
      proposalId: "unknown",
      checkedAt: new Date().toISOString(),
      verdict: "reject",
      reasons: [{ code: "schema-invalid", detail: `Invalid JSON in proposal file: ${err.message}` }],
      checks: { baseline: [], patch: { touchedFiles: [], applies: false, stderr: "" }, packet: null, verification: [] },
      rerunForReviewer: [],
      disclaimer: DISCLAIMER,
    };
  }

  return preflightProposal(proposal, { root, baseDir });
}

/**
 * Compute LF-normalised SHA-256 for a list of root-relative file paths.
 *
 * @param {string[]} paths
 * @param {{ root?: string }} [options]
 * @returns {Array<{ path: string, sha256: string }>}
 */
export function hashFiles(paths, { root } = {}) {
  const rootDir = path.resolve(root ?? process.cwd());
  const results = [];
  for (const p of paths) {
    if (isPathUnsafe(p)) {
      throw new Error(`Unsafe path: ${p}`);
    }
    const full = path.resolve(rootDir, p);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`File not found: ${p}`);
    }
    results.push({
      path: p.replace(/\\/g, "/"),
      sha256: sha256Lf(fs.readFileSync(full, "utf8")),
    });
  }
  return results;
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else {
        flags[k] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));
  const cmd = positional[0];
  const target = positional[1];
  if (cmd === "check" && target) {
    try {
      const report = await preflightFile(target, { root: flags.root });
      const json = JSON.stringify(report, null, 2) + "\n";
      if (flags.out) {
        fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
        fs.writeFileSync(flags.out, json, "utf8");
      }
      process.stdout.write(json);
      if (report.verdict === "reject") {
        process.exit(1);
      } else {
        process.exit(0);
      }
    } catch (err) {
      process.stderr.write((err?.message || String(err)) + "\n");
      process.exit(2);
    }
  } else if (cmd === "hash" && positional.length > 1) {
    try {
      const files = positional.slice(1);
      const result = hashFiles(files, { root: flags.root });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write((err?.message || String(err)) + "\n");
      process.exit(2);
    }
  } else {
    process.stderr.write(
      "Usage:\n" +
      "  node proposalPreflight.mjs check <proposal.json> [--root <dir>] [--out <report.json>]\n" +
      "  node proposalPreflight.mjs hash <file...> [--root <dir>]\n"
    );
    process.exit(2);
  }
}
