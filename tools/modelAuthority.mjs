#!/usr/bin/env node
/** Exact model + effort authority evidence. Rank labels never grant authority. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BENCHMARK = "AA Intelligence Index v4.3.2";
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra", "default"]);
const HIGH_EFFORTS = new Set(["high", "xhigh", "max", "ultra"]);
const BAR_FLOOR_PERCENT = 85; // code floor: a lower bar needs a code change, not a data edit
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
 * The recorded score at the exact listed effort alone decides: it must reach the frozen absolute
 * bar (authority.bar.score). There is no expiry and no effort floor. `now` is an injectable UTC
 * date used only to reject future-dated evidence. No network or file access.
 */
export function assess(model, effort, table, { now = new Date().toISOString().slice(0, 10) } = {}) {
  const authority = object(table) && object(table.authority) ? table.authority : null;
  const result = {
    model: typeof model === "string" ? model : null,
    effort: typeof effort === "string" ? effort : null,
    eligible: false,
    relativeScore: null,
    rawScore: null,
    barScore: object(authority?.bar) && Number.isFinite(authority.bar.score) ? authority.bar.score : null,
    reason: "",
    benchmark: text(authority?.benchmark) ? authority.benchmark : null,
    checkedAt: text(authority?.checkedAt) ? authority.checkedAt : null,
  };
  const fail = (reason) => ({ ...result, reason });
  if (!text(model)) return fail("Unknown model: an exact model id is required.");
  if (!EFFORTS.has(id(effort))) return fail("Unknown effort: an explicit supported effort is required.");
  if (id(effort) === "default") return fail("Effort default never qualifies: an exact measured effort is required.");
  if (!authority) return fail("Missing or malformed authority configuration.");
  if (authority.benchmark !== BENCHMARK) return fail(`Missing or unsupported benchmark; expected ${BENCHMARK}.`);
  if (!Number.isFinite(authority.leaderScore) || authority.leaderScore <= 0) return fail("Leader score must be a positive finite number.");
  if (!source(authority.leaderSource)) return fail("Missing or invalid leader source URL.");
  const bar = authority.bar;
  if (!object(bar)) return fail("Missing or malformed bar configuration.");
  if (!Number.isFinite(bar.percent) || bar.percent < BAR_FLOOR_PERCENT || bar.percent > 100) {
    return fail(`bar.percent must be a finite number from ${BAR_FLOOR_PERCENT} through 100.`);
  }
  if (!Number.isFinite(bar.ofLeaderScore) || bar.ofLeaderScore <= 0) return fail("bar.ofLeaderScore must be a positive finite number.");
  if (!Number.isFinite(bar.score) || Math.abs(bar.score - (bar.percent * bar.ofLeaderScore) / 100) >= 0.05) {
    return fail("bar.score must equal bar.percent of bar.ofLeaderScore.");
  }
  if (bar.score > authority.leaderScore) return fail("bar.score must not exceed the leader score.");
  const checked = utcDate(authority.checkedAt);
  const today = utcDate(now);
  if (checked === null || today === null) return fail("Missing or invalid UTC date; use YYYY-MM-DD.");
  if (checked > today) return fail("Authority evidence is future-dated.");
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
  result.eligible = entry.score >= bar.score;
  result.reason = result.eligible
    ? "Verified exact model and effort meets the brain bar."
    : "Verified exact model and effort is below the brain bar.";
  return result;
}

const listed = (list, model, effort) => Array.isArray(list)
  && list.some((item) => object(item) && id(item.model) === id(model) && id(item.effort) === id(effort));

function modelInfo(table, model) {
  const models = object(table) && object(table.models) ? table.models : {};
  const key = Object.keys(models).find((k) => id(k) === id(model));
  const info = key !== undefined && object(models[key]) ? models[key] : null;
  return {
    codeName: info && text(info.codeName) ? info.codeName : null,
    tools: info && Array.isArray(info.tools) ? info.tools.filter(text) : [],
  };
}

function outputRates(prices) {
  const rates = new Map();
  const entries = object(prices) && Array.isArray(prices.entries) ? prices.entries : [];
  for (const entry of entries) {
    const out = object(entry) && object(entry.rates) ? entry.rates.output : undefined;
    if (text(entry?.model) && Number.isFinite(out) && out >= 0) rates.set(id(entry.model), out);
  }
  return rates;
}

/** Code names of known models whose output rate is at or below this model's; [] on any price problem. */
function delegateTo(table, model, prices) {
  try {
    const rates = outputRates(prices);
    const own = rates.get(id(model));
    if (own === undefined) return [];
    const names = new Set();
    for (const [name, rate] of rates) {
      const code = modelInfo(table, name).codeName;
      if (code && rate <= own) names.add(code);
    }
    return [...names].sort();
  } catch {
    return [];
  }
}

function tierLabels(table, tools, kind) {
  const brains = object(table) && object(table.brains) ? table.brains : {};
  const labels = new Set();
  for (const tool of tools) {
    const list = object(brains[tool]) && Array.isArray(brains[tool][kind]) ? brains[tool][kind] : [];
    for (const item of list) {
      if (!object(item) || !text(item.model) || !text(item.effort)) continue;
      labels.add(`${modelInfo(table, item.model).codeName ?? item.model}@${item.effort}`);
    }
  }
  return [...labels];
}

/**
 * Brain verdict plus derived code name, tier and permissions. The verdict comes only from `assess`;
 * the preferred/overkill listing and the price file never grant or remove brain status.
 */
export function brainCheck(model, effort, table, prices, options) {
  const verdict = assess(model, effort, table, options);
  const { codeName, tools } = modelInfo(table, model);
  const brain = verdict.eligible === true;
  let tier = null;
  if (brain) {
    const brains = object(table) && object(table.brains) ? table.brains : {};
    const inKind = (kind) => tools.some((tool) => object(brains[tool]) && listed(brains[tool][kind], model, effort));
    tier = inKind("preferred") ? "preferred" : inKind("overkill") ? "overkill" : "eligible";
  }
  const delegates = delegateTo(table, model, prices);
  const permissions = brain
    ? { decide: true, review: "any", merge: "with-user-authorization", pushMain: true,
        forcePushMain: "force-with-lease-and-owner-ok", delegateTo: delegates, escalateTo: tierLabels(table, tools, "overkill") }
    : { decide: false, review: "bounded", merge: false, pushMain: "bookkeeping-fast-forward-only",
        forcePushMain: false, delegateTo: delegates, escalateTo: tierLabels(table, tools, "preferred") };
  return {
    model: verdict.model, effort: verdict.effort, brain, codeName, tools,
    score: verdict.rawScore, barScore: verdict.barScore, relativeScore: verdict.relativeScore,
    tier, permissions, reason: verdict.reason,
  };
}

/** Validate declared, manually reviewed task evidence. Does not attest runtime or tests. */
export function assessTask(model, effort, record, context = {}) {
  const result = { model, effort, eligible: false, basis: 'reviewed-task-qualification', task: context.task ?? null,
    project: context.project ?? null, risk: context.risk ?? null, reason: '' };
  const fail = reason => ({ ...result, reason });
  const exact = s => text(s) && !/[\s*?]/.test(s);
  const now = utcDate(context.now ?? new Date().toISOString().slice(0,10));
  if (!exact(model) || !EFFORTS.has(id(effort)) || id(effort)==='default') return fail('Exact model and explicit effective effort required.');
  if (!object(record) || record.status !== 'active' || !exact(record.id)) return fail('Active qualification record required.');
  for (const key of ['project','task','configuration','risk']) {
    if (!exact(context[key]) || record[key] !== context[key]) return fail(`Exact ${key} scope mismatch or missing context.`);
  }
  if (record.model !== model || record.effort !== effort) return fail('Exact model/effort mismatch.');
  if (!['low','medium','high','critical'].includes(record.risk)) return fail('Unknown risk class.');
  const checked=utcDate(record.checkedAt), expires=utcDate(record.expiresAt);
  if (now===null || checked===null || expires===null || checked>now || expires<now || expires<checked) return fail('Expired, future-dated or invalid qualification dates.');
  if (!text(record.scope) || !Array.isArray(record.exclusions) || !record.exclusions.every(text)) return fail('Scope and exclusions required.');
  const config=record.configurationDetails;
  if (!object(config) || !['endpoint','fallback','harness','tools','settings'].every(k=>text(config[k]))) return fail('Endpoint/fallback/harness/tools/settings evidence required.');
  const q=record.quality;
  if (!object(q) || !text(q.rubric) || !text(q.criteria) || q.predeclared!==true || !Array.isArray(q.artifacts) || q.artifacts.length===0 || !q.artifacts.every(text)) return fail('Predeclared rubric, criteria and evaluation artifacts required.');
  if (!Number.isInteger(q.trials) || !Number.isInteger(q.accepted) || !Number.isInteger(q.minTrials) || q.minTrials<1 || q.trials<q.minTrials || q.accepted<0 || q.accepted>q.trials || !Number.isFinite(q.minPassRate) || q.minPassRate<=0 || q.minPassRate>1 || q.accepted/q.trials<q.minPassRate) return fail('Insufficient sample or unmet quality acceptance floor.');
  const review=record.review, approved=utcDate(review?.approvedAt);
  if (!object(review) || !text(review.by) || !text(review.decision) || !(review.independent===true || review.user===true) || approved===null || approved<checked || approved>now || approved>expires) return fail('Dated user or independent review approval required.');
  if (!text(record.verification)) return fail('Meaningful verification evidence required.');
  if (['high','critical'].includes(record.risk) && (!HIGH_EFFORTS.has(id(effort)) || review.independent!==true || !text(record.currentResultReview))) return fail('High risk requires high+ effort, independent review and current-result review evidence.');
  return { ...result, eligible: true, qualificationId: record.id, scope: record.scope, exclusions: record.exclusions,
    reason: 'Declared reviewed evidence qualifies only this project/task/configuration/risk; runtime identity, task fit and artifact truth still require review. No global rank or publish authority.' };
}

const TASK_KEYS = ["qualification", "task", "project", "configuration", "risk"];
const USAGE = "Usage: modelAuthority.mjs check <model> --effort <effort> [--table path] [--prices path] OR modelAuthority.mjs <model> --effort <effort> [--table path] OR --qualification file --task class --project id --configuration id --risk low|medium|high|critical";
const kitFile = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const round2 = (value) => (value === null ? null : Number(value.toFixed(2)));

function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!allowed.includes(flag) || flag in flags || !value || value.startsWith("--")) throw new Error(USAGE);
    flags[flag] = value;
  }
  return flags;
}

function checkCli(argv) {
  const [model, ...args] = argv;
  if (!model || model.startsWith("--")) throw new Error(USAGE);
  const flags = parseFlags(args, ["--effort", "--table", "--prices"]);
  if (!flags["--effort"]) throw new Error(USAGE);
  const table = JSON.parse(fs.readFileSync(flags["--table"] ?? kitFile("model-ranks.json"), "utf8"));
  let prices;
  try {
    prices = JSON.parse(fs.readFileSync(flags["--prices"] ?? kitFile("model-prices.json"), "utf8"));
  } catch {
    prices = undefined; // price trouble yields delegateTo [] and never changes the verdict
  }
  const result = brainCheck(model, flags["--effort"], table, prices);
  process.stdout.write(`${JSON.stringify({ ...result, relativeScore: round2(result.relativeScore) }, null, 2)}\n`);
  return result.brain ? 0 : 2;
}

function cli(argv) {
  try {
    if (argv[0] === "check") return checkCli(argv.slice(1));
    const [model, ...args] = argv;
    if (!model || model.startsWith("--")) throw new Error(USAGE);
    const flags = parseFlags(args, ["--effort", "--table", ...TASK_KEYS.map((k) => `--${k}`)]);
    const effort = flags["--effort"];
    if (!effort) throw new Error(USAGE);
    const scoped = {};
    for (const key of TASK_KEYS) if (`--${key}` in flags) scoped[key] = flags[`--${key}`];
    const taskMode = Object.keys(scoped).length > 0;
    if (taskMode && (!TASK_KEYS.every((k) => text(scoped[k])) || "--table" in flags)) throw new Error(USAGE);
    const result = taskMode
      ? assessTask(model, effort, JSON.parse(fs.readFileSync(scoped.qualification, "utf8")), scoped)
      : assess(model, effort, JSON.parse(fs.readFileSync(flags["--table"] ?? kitFile("model-ranks.json"), "utf8")));
    const display = taskMode ? result : { ...result, relativeScore: round2(result.relativeScore) };
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
