#!/usr/bin/env node
/** Exact model + effort authority evidence. Rank labels never grant authority. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BENCHMARK = "AA Intelligence Index v4.3.2";
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra", "default"]);
const HIGH_EFFORTS = new Set(["high", "xhigh", "max", "ultra"]);
const DAY_MS = 86400000;
const text = (value) => typeof value === "string" && value.trim().length > 0;
const id = (value) => text(value) ? value.toLowerCase() : "";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function utcDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function source(value) {
  if (!text(value)) return false;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Assess verified authority at an exact effort; never infer scores across models or efforts.
 * `now` is an injectable UTC date for reproducible checks. No network or file access.
 */
export function assess(model, effort, table, { now = new Date().toISOString().slice(0, 10) } = {}) {
  const authority = object(table) && object(table.authority) ? table.authority : null;
  const result = {
    model: typeof model === "string" ? model : null,
    effort: typeof effort === "string" ? effort : null,
    eligible: false,
    relativeScore: null,
    rawScore: null,
    reason: "",
    benchmark: text(authority?.benchmark) ? authority.benchmark : null,
    checkedAt: text(authority?.checkedAt) ? authority.checkedAt : null,
  };
  const fail = (reason) => ({ ...result, reason });
  if (!text(model)) return fail("Unknown model: an exact model id is required.");
  if (!EFFORTS.has(id(effort))) return fail("Unknown effort: an explicit supported effort is required.");
  if (!HIGH_EFFORTS.has(id(effort))) return fail("Authority requires an exact high, xhigh, max, or ultra effort.");
  if (!authority) return fail("Missing or malformed authority configuration.");
  if (authority.benchmark !== BENCHMARK) return fail(`Missing or unsupported benchmark; expected ${BENCHMARK}.`);
  if (!Number.isFinite(authority.leaderScore) || authority.leaderScore <= 0) return fail("Leader score must be a positive finite number.");
  if (!source(authority.leaderSource)) return fail("Missing or invalid leader source URL.");
  if (!Number.isFinite(authority.maxAgeDays) || authority.maxAgeDays <= 0) return fail("maxAgeDays must be a positive finite number.");
  if (!Number.isFinite(authority.thresholdPercent) || authority.thresholdPercent < 90 || authority.thresholdPercent > 100) {
    return fail("thresholdPercent must be a finite number from 90 through 100.");
  }
  const checked = utcDate(authority.checkedAt);
  const today = utcDate(now);
  if (checked === null || today === null) return fail("Missing or invalid UTC date; use YYYY-MM-DD.");
  if (checked > today) return fail("Authority evidence is future-dated.");
  if ((today - checked) / DAY_MS > authority.maxAgeDays) return fail("Authority evidence is stale.");
  if (!Array.isArray(authority.entries)) return fail("Missing or malformed authority entries.");
  if (authority.entries.some((entry) => object(entry) && Number.isFinite(entry.score) && entry.score > authority.leaderScore)) {
    return fail("Leader score is lower than a recorded model score; refresh the comparable cohort together.");
  }
  const modelEntries = authority.entries.filter((entry) => object(entry) && id(entry.model) === id(model));
  if (modelEntries.length === 0) return fail("Unknown model: no exact authority entry exists.");
  const matches = modelEntries.filter((entry) => id(entry.effort) === id(effort));
  if (matches.length === 0) return fail("No verified authority entry for this exact model and effort; scores are never inherited.");
  if (matches.length !== 1) return fail("Duplicate authority entries for this exact model and effort.");
  const entry = matches[0];
  if (!source(entry.source)) return fail("Missing or invalid model score source URL.");
  if (!text(entry.configuration)) return fail("Missing or malformed benchmark configuration.");
  if (entry.score === null || entry.score === undefined) return fail("Unverified: the exact model and effort has no score.");
  if (!Number.isFinite(entry.score) || entry.score < 0 || entry.score > authority.leaderScore) {
    return fail("Model score must be finite, nonnegative, and no greater than the leader score.");
  }
  result.rawScore = entry.score;
  result.relativeScore = (entry.score / authority.leaderScore) * 100;
  result.eligible = result.relativeScore >= authority.thresholdPercent;
  result.reason = result.eligible
    ? "Verified exact model and effort meets the authority threshold."
    : "Verified exact model and effort is below the authority threshold.";
  return result;
}

function cli(argv) {
  const usage = "Usage: modelAuthority.mjs <model> --effort <effort> [--table path]";
  try {
    const [model, ...args] = argv;
    if (!model || model.startsWith("--")) throw new Error(usage);
    let effort;
    let tableFile = fileURLToPath(new URL("../model-ranks.json", import.meta.url));
    const seen = new Set();
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      if (!["--effort", "--table"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) throw new Error(usage);
      seen.add(flag);
      if (flag === "--effort") effort = value;
      else tableFile = value;
    }
    if (!effort) throw new Error(usage);
    const table = JSON.parse(fs.readFileSync(tableFile, "utf8"));
    const result = assess(model, effort, table);
    const display = { ...result, relativeScore: result.relativeScore === null ? null : Number(result.relativeScore.toFixed(2)) };
    process.stdout.write(`${JSON.stringify(display, null, 2)}\n`);
    return result.eligible ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = cli(process.argv.slice(2));
}
