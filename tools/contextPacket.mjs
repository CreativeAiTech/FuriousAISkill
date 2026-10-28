#!/usr/bin/env node
/**
 * contextPacket: build and verify exact, provenance-backed source packets for focused workers (RSR-01, F47/F52).
 *
 * Preserves exact source lines, file SHA-256, excerpt SHA-256, byte/line counts, and explicit omitted-context
 * disclosures so workers never guess from compressed signatures and reviewers can deterministically detect
 * stale files, altered excerpts, path escapes, or oversized packets before review.
 *
 * CLI:
 *   node tools/contextPacket.mjs build <spec.json> [--out <packet.json>]
 *   node tools/contextPacket.mjs verify <packet.json> [--root <dir>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = "1.0.0";
export const DEFAULT_MAX_BYTES = 32768;
export const DEFAULT_MAX_EXCERPTS = 12;

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const normalizeLf = (text) => text.replace(/\r\n/g, "\n");
const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const posInt = (v) => Number.isInteger(v) && v >= 1;
const req = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function resolveSafePath(rootDir, relPath) {
  req(nonEmptyStr(relPath), "Excerpt path must be a non-empty string");
  req(!path.isAbsolute(relPath), `Excerpt path must be relative to root: ${relPath}`);
  const rootResolved = path.resolve(rootDir);
  const full = path.resolve(rootResolved, relPath);
  const rel = path.relative(rootResolved, full);
  req(rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel), `Excerpt path escapes root: ${relPath}`);
  return { rootResolved, full, normalizedRel: rel.replace(/\\/g, "/") };
}

function splitLines(normalizedText) {
  if (normalizedText.length === 0) return [];
  const parts = normalizedText.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Build a verified source packet from a specification object:
 * {
 *   id: string,
 *   goal: string,
 *   root?: string,
 *   maxBytes?: number,
 *   maxExcerpts?: number,
 *   omittedContextNote?: string,
 *   excerpts: Array<{ path: string, startLine?: number, endLine?: number, reason?: string }>
 * }
 */
export function buildPacket(spec, options = {}) {
  req(spec && typeof spec === "object", "Packet spec must be an object");
  req(nonEmptyStr(spec.id), "Packet spec requires a non-empty id");
  req(nonEmptyStr(spec.goal), "Packet spec requires a non-empty goal");
  req(Array.isArray(spec.excerpts) && spec.excerpts.length > 0, "Packet spec requires a non-empty excerpts array");

  const rootDir = path.resolve(options.root ?? spec.root ?? process.cwd());
  const maxBytes = spec.maxBytes ?? options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxExcerpts = spec.maxExcerpts ?? options.maxExcerpts ?? DEFAULT_MAX_EXCERPTS;
  req(posInt(maxBytes), "maxBytes must be a positive integer");
  req(posInt(maxExcerpts), "maxExcerpts must be a positive integer");
  req(spec.excerpts.length <= maxExcerpts, `Excerpt count ${spec.excerpts.length} exceeds maxExcerpts ${maxExcerpts}`);

  const seenRanges = new Set();
  let totalExcerptBytes = 0;
  let totalSourceBytes = 0;
  const countedSourceFiles = new Map();

  const builtExcerpts = spec.excerpts.map((item, idx) => {
    req(item && typeof item === "object", `Excerpt #${idx + 1} must be an object`);
    const { full, normalizedRel } = resolveSafePath(rootDir, item.path);
    req(fs.existsSync(full) && fs.statSync(full).isFile(), `Source file not found: ${normalizedRel}`);

    const rawSource = normalizeLf(fs.readFileSync(full, "utf8"));
    const sourceBytes = Buffer.byteLength(rawSource, "utf8");
    const sourceSha256 = sha256(rawSource);
    const lines = splitLines(rawSource);
    req(lines.length > 0, `Source file is empty: ${normalizedRel}`);

    const startLine = item.startLine ?? 1;
    const endLine = item.endLine ?? lines.length;
    req(posInt(startLine) && posInt(endLine), `Invalid line numbers for ${normalizedRel}`);
    req(startLine <= endLine, `startLine (${startLine}) > endLine (${endLine}) for ${normalizedRel}`);
    req(endLine <= lines.length, `endLine (${endLine}) exceeds file line count (${lines.length}) for ${normalizedRel}`);

    const rangeKey = `${normalizedRel}:${startLine}-${endLine}`;
    req(!seenRanges.has(rangeKey), `Duplicate excerpt range: ${rangeKey}`);
    seenRanges.add(rangeKey);

    const content = lines.slice(startLine - 1, endLine).join("\n");
    const excerptBytes = Buffer.byteLength(content, "utf8");
    const excerptSha256 = sha256(content);

    totalExcerptBytes += excerptBytes;
    if (!countedSourceFiles.has(normalizedRel)) {
      countedSourceFiles.set(normalizedRel, sourceBytes);
      totalSourceBytes += sourceBytes;
    }

    return {
      path: normalizedRel,
      startLine,
      endLine,
      totalFileLines: lines.length,
      sourceSha256,
      sourceBytes,
      excerptSha256,
      excerptBytes,
      reason: nonEmptyStr(item.reason) ? item.reason.trim() : null,
      content,
    };
  });

  req(totalExcerptBytes <= maxBytes, `Total excerpt bytes (${totalExcerptBytes}) exceed maxBytes (${maxBytes})`);

  const omittedNote = nonEmptyStr(spec.omittedContextNote)
    ? spec.omittedContextNote.trim()
    : "Bounded source packet: lines outside [startLine..endLine] and unlisted files are omitted. Do not infer absent capabilities; request missing ranges if needed.";

  return {
    schemaVersion: SCHEMA_VERSION,
    id: spec.id.trim(),
    goal: spec.goal.trim(),
    createdAt: options.now ?? new Date().toISOString().slice(0, 10),
    limits: {
      maxBytes,
      maxExcerpts,
    },
    omittedContextNote: omittedNote,
    metrics: {
      excerptCount: builtExcerpts.length,
      uniqueFileCount: countedSourceFiles.size,
      totalExcerptBytes,
      totalSourceBytes,
      byteReductionRatio: totalSourceBytes > 0 ? Number(((totalSourceBytes - totalExcerptBytes) / totalSourceBytes).toFixed(4)) : 0,
    },
    excerpts: builtExcerpts,
  };
}

/**
 * Verify a source packet against the current filesystem state and structural invariants.
 * Returns { ok: boolean, errors: string[], checkedExcerpts: number, totalExcerptBytes: number }
 */
export function verifyPacket(packet, options = {}) {
  const errors = [];
  if (!packet || typeof packet !== "object") {
    return { ok: false, errors: ["Packet must be a non-null JSON object"], checkedExcerpts: 0, totalExcerptBytes: 0 };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${packet.schemaVersion} (expected ${SCHEMA_VERSION})`);
  }
  if (!nonEmptyStr(packet.id)) errors.push("Missing or empty packet id");
  if (!nonEmptyStr(packet.goal)) errors.push("Missing or empty packet goal");
  if (!nonEmptyStr(packet.omittedContextNote)) errors.push("Missing omittedContextNote disclosure");

  const maxBytes = packet.limits?.maxBytes;
  const maxExcerpts = packet.limits?.maxExcerpts;
  if (!posInt(maxBytes)) errors.push("Invalid limits.maxBytes");
  if (!posInt(maxExcerpts)) errors.push("Invalid limits.maxExcerpts");

  if (!Array.isArray(packet.excerpts) || packet.excerpts.length === 0) {
    errors.push("Packet excerpts must be a non-empty array");
    return { ok: false, errors, checkedExcerpts: 0, totalExcerptBytes: 0 };
  }
  if (posInt(maxExcerpts) && packet.excerpts.length > maxExcerpts) {
    errors.push(`Excerpt count (${packet.excerpts.length}) exceeds limits.maxExcerpts (${maxExcerpts})`);
  }

  const rootDir = path.resolve(options.root ?? process.cwd());
  const seenRanges = new Set();
  let computedTotalBytes = 0;

  for (let i = 0; i < packet.excerpts.length; i++) {
    const ex = packet.excerpts[i];
    const label = `excerpt[${i}]`;
    if (!ex || typeof ex !== "object") {
      errors.push(`${label}: must be an object`);
      continue;
    }

    let safe;
    try {
      safe = resolveSafePath(rootDir, ex.path);
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      continue;
    }

    if (!posInt(ex.startLine) || !posInt(ex.endLine) || ex.startLine > ex.endLine) {
      errors.push(`${label} (${safe.normalizedRel}): invalid line range ${ex.startLine}-${ex.endLine}`);
      continue;
    }

    const rangeKey = `${safe.normalizedRel}:${ex.startLine}-${ex.endLine}`;
    if (seenRanges.has(rangeKey)) {
      errors.push(`${label}: duplicate excerpt range ${rangeKey}`);
    }
    seenRanges.add(rangeKey);

    if (typeof ex.content !== "string" || ex.content.length === 0) {
      errors.push(`${label} (${safe.normalizedRel}): missing or empty content`);
      continue;
    }

    const normalizedContent = normalizeLf(ex.content);
    const actualExcerptSha = sha256(normalizedContent);
    const actualExcerptBytes = Buffer.byteLength(normalizedContent, "utf8");
    computedTotalBytes += actualExcerptBytes;

    if (ex.excerptSha256 !== actualExcerptSha) {
      errors.push(`${label} (${safe.normalizedRel}): content altered (excerptSha256 mismatch)`);
    }
    if (ex.excerptBytes !== actualExcerptBytes) {
      errors.push(`${label} (${safe.normalizedRel}): excerptBytes mismatch (${ex.excerptBytes} vs ${actualExcerptBytes})`);
    }

    if (!fs.existsSync(safe.full) || !fs.statSync(safe.full).isFile()) {
      errors.push(`${label} (${safe.normalizedRel}): source file missing on disk`);
      continue;
    }

    const rawSource = normalizeLf(fs.readFileSync(safe.full, "utf8"));
    const currentSourceSha = sha256(rawSource);
    const lines = splitLines(rawSource);

    if (ex.sourceSha256 !== currentSourceSha) {
      errors.push(`${label} (${safe.normalizedRel}): stale source file (sourceSha256 mismatch)`);
      continue;
    }
    if (ex.endLine > lines.length) {
      errors.push(`${label} (${safe.normalizedRel}): endLine ${ex.endLine} exceeds file lines ${lines.length}`);
      continue;
    }

    const expectedSlice = lines.slice(ex.startLine - 1, ex.endLine).join("\n");
    if (normalizedContent !== expectedSlice) {
      errors.push(`${label} (${safe.normalizedRel}): excerpt content does not match lines ${ex.startLine}-${ex.endLine} of source`);
    }
  }

  if (posInt(maxBytes) && computedTotalBytes > maxBytes) {
    errors.push(`Total excerpt bytes (${computedTotalBytes}) exceed limits.maxBytes (${maxBytes})`);
  }
  if (packet.metrics?.totalExcerptBytes !== computedTotalBytes) {
    errors.push(`metrics.totalExcerptBytes (${packet.metrics?.totalExcerptBytes}) does not match actual (${computedTotalBytes})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    checkedExcerpts: packet.excerpts.length,
    totalExcerptBytes: computedTotalBytes,
  };
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
  try {
    const { positional, flags } = parseCliArgs(process.argv.slice(2));
    const cmd = positional[0];
    const target = positional[1];
    req(cmd === "build" || cmd === "verify", "Usage: node tools/contextPacket.mjs <build|verify> <file.json> [--root <dir>] [--out <file.json>]");
    req(nonEmptyStr(target), "Missing input JSON path");

    const inputObj = JSON.parse(fs.readFileSync(target, "utf8"));
    if (cmd === "build") {
      const packet = buildPacket(inputObj, { root: flags.root });
      const json = JSON.stringify(packet, null, 2) + "\n";
      if (nonEmptyStr(flags.out)) {
        fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
        fs.writeFileSync(flags.out, json, "utf8");
      } else {
        process.stdout.write(json);
      }
    } else {
      const res = verifyPacket(inputObj, { root: flags.root });
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      if (!res.ok) process.exitCode = 2;
    }
  } catch (err) {
    process.stderr.write((err?.message || String(err)) + "\n");
    process.exitCode = 1;
  }
}
