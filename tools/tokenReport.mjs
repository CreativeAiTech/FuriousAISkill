#!/usr/bin/env node
// tokenReport: "is the agent kit worth having?" from Claude Code transcripts. (kit v1.9.0)
// Compares the kit's fixed per-session token overhead with measured savings
// (subagent delegation) and flags waste (late checkpoints, huge tool results).
// Costs are modeled API-list-price equivalents, not billing or quota.
//
// Also reads Antigravity (Gemini) conversations from ~/.gemini/antigravity
// (SQLite + protobuf, via node:sqlite) into a separate section.
//
// Usage: node tokenReport.mjs [--project <dir>] [--days 30] [--since <ISO date>] [--out <dir>] [--summary]
// --since defaults to <out>/since.txt when present (a fresh-start baseline); the window is the later of the two.
// No dependencies. Never throws on odd transcript lines.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readCodexUsage } from "./lib/codexUsage.mjs";
import { pbVarint, pbFields } from "./lib/agStore.mjs";

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const home = os.homedir();
const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- pricing tables (model-prices.json primary, legacy fallback) ----------
const pricesArg = arg("prices", null);
const defaultPricesPath = path.join(home, ".agents", "model-prices.json");
const pricesPath = pricesArg ? path.resolve(pricesArg) : (fs.existsSync(defaultPricesPath) ? defaultPricesPath : null);
let modelPricesRegistry = null;
if (pricesPath) {
  try { modelPricesRegistry = JSON.parse(fs.readFileSync(pricesPath, "utf8")); } catch {}
}

const LEGACY_PRICES = {
  opus: { in: 5, out: 25, cacheRead: 0.5 },
  sonnet: { in: 3, out: 15, cacheRead: 0.3 },
  haiku: { in: 1, out: 5, cacheRead: 0.1 },
};
const LEGACY_GEMINI_PRICES = [
  ["flash-lite", { in: 0.1, out: 0.4, cacheRead: 0.01 }],
  ["flash", { in: 0.5, out: 3, cacheRead: 0.05 }],
  ["pro", { in: 2, out: 12, cacheRead: 0.2 }],
  ["", { in: 0.5, out: 3, cacheRead: 0.05 }],
];

function findRates(reg, exactModel, defRates) {
  const e = reg?.entries?.find((x) => x.model === exactModel);
  if (e?.rates) {
    return {
      in: e.rates.input,
      out: e.rates.output,
      cacheRead: e.rates.cachedInput != null ? e.rates.cachedInput : e.rates.input * 0.1,
    };
  }
  return defRates;
}

const PRICES = modelPricesRegistry ? {
  opus: findRates(modelPricesRegistry, "claude-opus-5-5", { in: 4, out: 20, cacheRead: 0.2 }),
  sonnet: findRates(modelPricesRegistry, "claude-sonnet-5-5", { in: 2, out: 10, cacheRead: 0.1 }),
  haiku: findRates(modelPricesRegistry, "claude-haiku-5-5", { in: 0.1, out: 0.5, cacheRead: 0.01 }),
} : LEGACY_PRICES;

const argonRates = findRates(modelPricesRegistry, "gemini-4-argon", { in: 2, out: 10, cacheRead: 0.1 });
const flashRates = findRates(modelPricesRegistry, "gemini-3.8-flash", { in: 0.75, out: 3.75, cacheRead: 0.075 });
const flashLiteRates = findRates(modelPricesRegistry, "gemini-3.5-flash-lite", { in: 0.3, out: 2.5, cacheRead: 0.03 });

function resolveGemini(model) {
  const m = String(model || "").toLowerCase();
  if (modelPricesRegistry) {
    const exact = modelPricesRegistry.entries?.find((e) => e.model && e.model.toLowerCase() === m);
    if (exact?.rates) {
      return [exact.model, {
        in: exact.rates.input,
        out: exact.rates.output,
        cacheRead: exact.rates.cachedInput != null ? exact.rates.cachedInput : exact.rates.input * 0.1,
      }];
    }
    if (m.includes("argon") || m.includes("pro") || m.includes("ultra")) {
      return ["gemini-4-argon", argonRates];
    }
    if (m.includes("flash-lite") || m.includes("3.5-flash")) {
      return ["gemini-3.5-flash-lite", flashLiteRates];
    }
    if (m.includes("flash")) {
      return ["gemini-3.8-flash", flashRates];
    }
    return ["", flashRates];
  } else {
    if (m.includes("argon") || m.includes("pro") || m.includes("ultra")) {
      return ["pro", { in: 2, out: 12, cacheRead: 0.2 }];
    }
    if (m.includes("flash-lite")) {
      return ["flash-lite", { in: 0.1, out: 0.4, cacheRead: 0.01 }];
    }
    if (m.includes("flash")) {
      return ["flash", { in: 0.5, out: 3, cacheRead: 0.05 }];
    }
    const hit = LEGACY_GEMINI_PRICES.find(([k]) => m.includes(k));
    return hit || ["", { in: 0.5, out: 3, cacheRead: 0.05 }];
  }
}
const geminiKey = (model) => resolveGemini(model)[0];
const geminiPrice = (model) => resolveGemini(model)[1];
const GEMINI_PRICES = modelPricesRegistry ? [
  ["gemini-3.5-flash-lite", flashLiteRates],
  ["gemini-3.8-flash", flashRates],
  ["gemini-4-argon", argonRates],
] : LEGACY_GEMINI_PRICES;

const GEMINI_CACHE_READ = 0.1;
const CHARS_PER_TOKEN = 3.8;
const SOFT = Number(process.env.CC_WATCH_SOFT) || 40000;

const project = path.resolve(arg("project", process.cwd()));
const days = Number(arg("days", 30)) || 30;
const outDir = path.resolve(arg("out", path.join(project, ".agents", "reports")));
const wantSummary = argv.includes("--summary");
const baseArg = String(arg("baseline", "opus")).toLowerCase();
const baseFam = PRICES[baseArg] ? baseArg : "opus"; // Claude baseline family
const agBaseline = String(arg("ag-baseline", "pro")).toLowerCase(); // Gemini baseline (substring of model name)
let sinceRaw = arg("since", "");
if (!sinceRaw) { try { sinceRaw = fs.readFileSync(path.join(outDir, "since.txt"), "utf8").trim(); } catch {} }
const sinceMs = sinceRaw ? Date.parse(sinceRaw) || 0 : 0;

// ---------- helpers ----------
const tok = (chars) => chars / CHARS_PER_TOKEN;
const usd = (n) => ((n || 0) < -0.005 ? "-$" : "$") + Math.abs(n || 0).toFixed(2);
const fmt = (n) => Math.round(n || 0).toLocaleString("en-US");
const safeRead = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const safeDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };
const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

function family(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "opus";
}
const P = (model) => PRICES[family(model)];
const readPrice = (model) => P(model).cacheRead / 1e6;
const writePrice = (model) => P(model).in * 1.25 / 1e6;

function costOf(model, u) {
  if (!u) return 0;
  const p = P(model);
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens, w1 = cc.ephemeral_1h_input_tokens;
  const wTotal = u.cache_creation_input_tokens || 0;
  let write;
  if (w5 != null || w1 != null) {
    const a = w5 || 0, b = w1 || 0;
    write = p.in * (1.25 * (a + Math.max(0, wTotal - a - b)) + 2 * b);
  } else write = p.in * 1.25 * wTotal;
  return ((u.input_tokens || 0) * p.in + write + (u.cache_read_input_tokens || 0) * p.cacheRead +
    (u.output_tokens || 0) * p.out) / 1e6;
}
const ctxOf = (u) => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);

function textLen(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const c of content) n += typeof c === "string" ? c.length : (c && typeof c.text === "string" ? c.text.length : 0);
    return n;
  }
  return 0;
}

// All text of a tool result: string, array of content blocks, or {content}.
function resultText(c) {
  try {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : x && typeof x.text === "string" ? x.text : "")).join("\n");
    if (c && typeof c === "object") return resultText(c.content !== undefined ? c.content : c.text);
  } catch {}
  return "";
}
// Leading whitespace allowed: Claude Code indents every line of a subagent's hand-back in the tool_result.
export function lastGate(text) {
  let last = null;
  try {
    for (const m of String(text || "").matchAll(/^[ \t>*\x60-]*\*?\*?\x60?GATE\*?\*?\x60?:\*?\*?\s*\x60?\*?\*?(pass|fail|none)\x60?\*?\*?\b/gim)) {
      last = m[1].toLowerCase();
    }
  } catch {}
  return last;
}

// Background (async) subagents: the Agent tool_result is only a launch notice; the real reply arrives later
// in a <task-notification> user record. Returns [{toolUseId, result}] for every notification block in text.
export function notificationResults(text) {
  const out = [];
  try {
    for (const m of String(text || "").matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
      const id = /<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/.exec(m[1]);
      const res = /<result>([\s\S]*?)<\/result>/.exec(m[1]);
      if (id && res) out.push({ toolUseId: id[1], result: res[1] });
    }
  } catch {}
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  return m ? m[1] : "";
}
function fmValue(text, key) {
  const fm = frontmatter(text);
  const m = new RegExp("^" + key + ":[ \\t]*(.*)$", "m").exec(fm);
  if (!m) return "";
  let v = m[1];
  const rest = fm.slice(m.index + m[0].length).split(/\r?\n/).slice(1);
  for (const l of rest) { if (/^\s+\S/.test(l)) v += " " + l.trim(); else break; }
  return v;
}

// ---------- locate transcripts ----------
const projectsRoot = path.join(home, ".claude", "projects");
const slug = project.replace(/[^A-Za-z0-9]/g, "-");
const dirs = safeDir(projectsRoot).filter((d) => d === slug || d.startsWith(slug + "--claude-worktrees-"))
  .map((d) => path.join(projectsRoot, d));
const collectionUntil = Date.now();
const cutoff = Math.max(collectionUntil - days * 86400000, sinceMs);
const codex = await readCodexUsage({ project, codexHome: arg("codex-home", undefined), pricesPath, since: cutoff, until: collectionUntil });
const sessionFiles = [];
for (const d of dirs) {
  for (const f of safeDir(d)) {
    if (!f.endsWith(".jsonl")) continue;
    const fp = path.join(d, f);
    try { if (fs.statSync(fp).mtimeMs >= cutoff) sessionFiles.push({ file: fp, dir: d, id: f.slice(0, -6) }); } catch {}
  }
}

// ---------- subagent model resolution ----------
function agentFrontmatterModel(type) {
  const t = safeRead(path.join(home, ".claude", "agents", type + ".md"));
  const v = t ? fmValue(t, "model").trim() : "";
  return v || null;
}

// ---------- parse one session ----------
function turnFromLine(e) {
  const m = e.message;
  if (!m || !m.usage) return null;
  return { id: m.id, model: m.model || "", usage: m.usage, ctx: ctxOf(m.usage), ts: Date.parse(e.timestamp) || 0 };
}

function parseSession(s) {
  const text = safeRead(s.file) || "";
  const turns = [];            // main turns
  const seen = new Set();
  const toolUses = new Map();  // id -> {name,input,turn}
  const results = [];          // {id, chars, turnAfter}
  const spawns = [];           // {id, input, turn, sideTurns:[], result}
  const side = [];             // sidechain turns in main file (order)
  const sideSeen = new Set();
  let hookChars = 0;
  let curRun = null;

  for (const line of text.split("\n")) {
    if (!line) continue;
    const e = parse(line);
    if (!e || typeof e !== "object") continue;
    if (e.type === "attachment" && e.attachment && e.attachment.type === "hook_additional_context") {
      hookChars += textLen(e.attachment.content) || textLen(e.attachment.text) || 0;
      continue;
    }
    if (e.isSidechain) {
      if (e.type === "assistant") {
        const t = turnFromLine(e);
        if (t && !(t.id && sideSeen.has(t.id))) {
          if (t.id) sideSeen.add(t.id);
          if (!curRun) { curRun = []; side.push(curRun); }
          curRun.push(t);
        }
      }
      continue;
    }
    curRun = null;
    if (e.type === "assistant") {
      const t = turnFromLine(e);
      const content = e.message && e.message.content;
      const isNew = t && !(t.id && seen.has(t.id)) && t.model !== "<synthetic>";
      if (isNew) { if (t.id) seen.add(t.id); turns.push(t); }
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === "tool_use" && c.id && !toolUses.has(c.id)) {
            const rec = { name: c.name, input: c.input || {}, turn: turns.length };
            toolUses.set(c.id, rec);
            if (c.name === "Agent" || c.name === "Task") {
              spawns.push({ id: c.id, input: c.input || {}, turn: turns.length, result: null, sideTurns: null });
            }
          }
        }
      }
    } else if (e.type === "user") {
      const content = e.message && e.message.content;
      const msgText = resultText(content);
      if (msgText.includes("<task-notification>")) {
        for (const n of notificationResults(msgText)) {
          const sp = spawns.find((x) => x.id === n.toolUseId);
          if (sp) sp.text = (sp.text || "") + "\n" + n.result;
        }
      }
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (!c || c.type !== "tool_result") continue;
        results.push({ id: c.tool_use_id, chars: textLen(c.content), turnAfter: turns.length });
        const sp = spawns.find((x) => x.id === c.tool_use_id);
        if (sp) {
          sp.result = e.toolUseResult || null;
          sp.text = (sp.text || "") + resultText(c.content) + "\n" + resultText(e.toolUseResult && e.toolUseResult.content);
        }
      }
    }
  }

  // attach subagent data to spawns: (a) subagents/*.jsonl, (b) sidechain runs, (c) result usage
  const subDir = path.join(s.dir, s.id, "subagents");
  const subFiles = safeDir(subDir).filter((f) => f.endsWith(".jsonl"));
  const subParsed = subFiles.map((f) => {
    const t = safeRead(path.join(subDir, f)) || "";
    const ts = []; const sn = new Set();
    for (const l of t.split("\n")) {
      if (!l) continue;
      const e = parse(l);
      if (!e || e.type !== "assistant") continue;
      const tt = turnFromLine(e);
      if (!tt || tt.model === "<synthetic>" || (tt.id && sn.has(tt.id))) continue;
      if (tt.id) sn.add(tt.id);
      ts.push(tt);
    }
    let mt = 0; try { mt = fs.statSync(path.join(subDir, f)).mtimeMs; } catch {}
    return { name: f.slice(0, -6), turns: ts, mt };
  }).filter((x) => x.turns.length);
  subParsed.sort((a, b) => a.mt - b.mt);
  const used = new Set();
  let runIdx = 0;
  for (const sp of spawns) {
    const aid = sp.result && sp.result.agentId;
    let found = null;
    if (subParsed.length) {
      found = subParsed.find((x) => aid && x.name.includes(aid) && !used.has(x)) ||
        subParsed.find((x) => !used.has(x));
      if (found) { used.add(found); sp.sideTurns = found.turns; sp.form = "a"; }
    }
    if (!sp.sideTurns && runIdx < side.length) { sp.sideTurns = side[runIdx++]; sp.form = "b"; }
    if (!sp.sideTurns && sp.result && (sp.result.usage || sp.result.totalTokens)) sp.form = "c";
    if (!sp.sideTurns && sp.form !== "c") sp.form = "none";
  }

  // main model of the session
  const cnt = {};
  for (const t of turns) cnt[t.model] = (cnt[t.model] || 0) + 1;
  const mainModel = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || "opus";

  return { id: s.id.slice(0, 8), turns, toolUses, results, spawns, hookChars, mainModel, side };
}

const sessions = sessionFiles.map(parseSession).filter((s) => s.turns.length);
const ccAvailable = sessions.length > 0;

// ---------- spend by model ----------
const spendRows = new Map(); // key "main|model" -> {...}
function addSpend(scope, model, u) {
  const key = scope + "|" + model;
  let r = spendRows.get(key);
  if (!r) { r = { scope, model, req: 0, inp: 0, cw: 0, cr: 0, out: 0, cost: 0 }; spendRows.set(key, r); }
  r.req++; r.inp += u.input_tokens || 0; r.cw += u.cache_creation_input_tokens || 0;
  r.cr += u.cache_read_input_tokens || 0; r.out += u.output_tokens || 0; r.cost += costOf(model, u);
}

// ---------- delegation ----------
const spawnRows = [];
const ccEvents = []; // {ts, model, usage} for every counted main + subagent turn (peak windows)
let totalSpawns = 0, baseMain = 0; // baseMain: all main turns repriced at the baseline family
for (const s of sessions) {
  for (const t of s.turns) { if (t.ts) ccEvents.push(t); addSpend("main", t.model, t.usage); baseMain += costOf(baseFam, t.usage); }
  for (const sp of s.spawns) {
    totalSpawns++;
    const type = sp.input.subagent_type || "general-purpose";
    let model = sp.sideTurns && sp.sideTurns.find((t) => t.model && t.model !== "<synthetic>")?.model;
    if (!model) model = sp.input.model || agentFrontmatterModel(type) || (type === "Explore" ? "haiku" : s.mainModel);
    // Main context when the spawn happened: done inline, every subagent round-trip would re-read it.
    const mainCtx = (s.turns[Math.min(Math.max(sp.turn, 1), s.turns.length) - 1] || {}).ctx || 0;
    let actual = 0, out = 0, G = 0, carried = 0;
    if (sp.sideTurns && sp.sideTurns.length) {
      for (const t of sp.sideTurns) { if (t.ts) ccEvents.push({ ts: t.ts, model: t.model || model, usage: t.usage }); addSpend("subagent", t.model || model, t.usage); actual += costOf(t.model || model, t.usage); out += t.usage.output_tokens || 0; }
      const first = sp.sideTurns[0].ctx;
      G = Math.max(0, sp.sideTurns[sp.sideTurns.length - 1].ctx - first);
      for (const t of sp.sideTurns) carried += mainCtx + Math.max(0, t.ctx - first);
    } else if (sp.form === "c") {
      const r = sp.result;
      let u = r.usage;
      if (!u) u = { input_tokens: r.totalTokens || 0 };
      addSpend("subagent", model, u); actual = costOf(model, u); out = u.output_tokens || 0;
      G = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      carried = (r.totalToolUseCount || 1) * (mainCtx + G / 2);
    } else continue;
    const remaining = Math.max(0, s.turns.length - sp.turn);
    // Inline = the same round-trips in the main session (main context + work so far, re-read each time),
    // the work written once, then carried on every remaining main turn.
    const inline = carried * readPrice(s.mainModel) + (out + G) * writePrice(s.mainModel) + G * readPrice(s.mainModel) * remaining;
    const inlineBase = carried * readPrice(baseFam) + (out + G) * writePrice(baseFam) + G * readPrice(baseFam) * remaining;
    const inlineTok = carried + out + G + G * remaining; // token side of the inline formula
    spawnRows.push({ session: s.id, type, model: family(model), desc: String(sp.input.description || "").slice(0, 60), effort: String(sp.input.effort || "default"), actual, inline, inlineBase, inlineTok, savings: inline - actual });
  }
}
// ---------- routing outcomes (GATE lines in spawn results) ----------
const RULE_BASENAMES = new Set(["claude.md", "agents.md", "gemini.md", "skill.md", ".mcp.json"]);
const RULE_DIRS = [".claude/skills/", ".agents/skills/", ".agents/rules/"];
const NON_IMPL = new Set(["verifier", "Explore", "claude-code-guide", "statusline-setup"]);
const routing = {}; // tier -> {n, pass, fail, vchecked, falsePass}
const rt = (k) => (routing[k] = routing[k] || { n: 0, pass: 0, fail: 0, vchecked: 0, falsePass: 0 });
let implSpawns = 0, implGated = 0, ruleEditSessions = 0;
for (const s of sessions) {
  let last = null; // latest implementation spawn so far
  for (const sp of s.spawns) {
    try {
      const type = sp.input.subagent_type || "general-purpose";
      const gate = lastGate(sp.text);
      if (!NON_IMPL.has(type)) {
        implSpawns++;
        const fm = sp.input.model ? family(sp.input.model) : null;
        const am = agentFrontmatterModel(type);
        const tier = fm || (am && /opus|sonnet|haiku/i.test(am) ? family(am) : family(s.mainModel));
        last = { tier, gate };
        if (gate) { implGated++; const r = rt(tier); r.n++; if (gate === "pass") r.pass++; else if (gate === "fail") r.fail++; }
      } else if (type === "verifier" && last && (gate === "pass" || gate === "fail")) {
        const r = rt(last.tier); r.vchecked++;
        if (last.gate === "pass" && gate === "fail") r.falsePass++;
      }
    } catch {}
  }
  try {
    for (const tu of s.toolUses.values()) {
      if (!["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tu.name)) continue;
      const fp = String((tu.input && (tu.input.file_path || tu.input.notebook_path)) || "").replace(/\\/g, "/").toLowerCase();
      const base = fp.split("/").pop();
      if ((RULE_BASENAMES.has(base) || RULE_DIRS.some((d) => fp.includes("/" + d) || fp.startsWith(d))) && s.turns.length - tu.turn >= 3) { ruleEditSessions++; break; }
    }
  } catch {}
}
const routingTiers = Object.keys(routing).filter((k) => routing[k].n > 0);

const delegationSavings = spawnRows.reduce((a, r) => a + r.savings, 0);
const wasteful = spawnRows.filter((r) => r.savings < 0);

// ---------- hygiene ----------
const hygiene = [];
let totalWaste = 0;
const bigResults = [];
for (const s of sessions) {
  const ctxs = s.turns.map((t) => t.ctx).filter((c) => c > 0);
  if (!ctxs.length) continue;
  const base = Math.min(...ctxs), max = Math.max(...ctxs);
  let waste = 0;
  for (const t of s.turns) if (t.ctx > 0) waste += Math.max(0, t.ctx - base - SOFT) * readPrice(t.model);
  totalWaste += waste;
  hygiene.push({ id: s.id, turns: s.turns.length, base, max, growth: max - base, waste });
  for (const r of s.results) {
    const tu = s.toolUses.get(r.id);
    if (!tu || tu.name === "Agent" || tu.name === "Task") continue;
    const i = tu.input || {};
    const hint = String(i.file_path || i.command || i.pattern || i.path || i.url || i.query || i.description || "").replace(/\s+/g, " ").slice(0, 80);
    const remaining = Math.max(0, s.turns.length - r.turnAfter);
    bigResults.push({ session: s.id, tool: tu.name, hint, chars: r.chars, cost: tok(r.chars) * readPrice(s.mainModel) * remaining });
  }
}
bigResults.sort((a, b) => b.chars - a.chars);
const top10 = bigResults.slice(0, 10);

// ---------- kit overhead ----------
function descriptions(files) {
  let chars = 0, n = 0;
  for (const f of files) {
    const t = safeRead(f);
    if (!t) continue;
    const d = fmValue(t, "description");
    if (d) { chars += d.length; n++; }
  }
  return { chars, n };
}
const globalMd = safeRead(path.join(home, ".claude", "CLAUDE.md")) || "";
const bm = /<!-- BEGIN agent-kit rules[\s\S]*?<!-- END agent-kit rules -->/.exec(globalMd);
const blockChars = bm ? bm[0].length : 0;
const skillFiles = safeDir(path.join(agentsDir, "skills")).map((d) => path.join(agentsDir, "skills", d, "SKILL.md"));
const agentFiles = safeDir(path.join(agentsDir, "agents")).filter((f) => f.endsWith(".md")).map((f) => path.join(agentsDir, "agents", f));
const gSk = descriptions(skillFiles), gAg = descriptions(agentFiles);

const projClaude = safeRead(path.join(project, "CLAUDE.md")) || "";
const projAgents = /@AGENTS\.md/.test(projClaude) ? (safeRead(path.join(project, "AGENTS.md")) || "") : "";
const pSkillFiles = safeDir(path.join(project, ".agents", "skills")).map((d) => path.join(project, ".agents", "skills", d, "SKILL.md"));
const pWfFiles = safeDir(path.join(project, ".agents", "workflows")).filter((f) => f.endsWith(".md")).map((f) => path.join(project, ".agents", "workflows", f));
const pSk = descriptions(pSkillFiles), pWf = descriptions(pWfFiles);

const hookCharsTotal = sessions.reduce((a, s) => a + s.hookChars, 0);
const avgHook = sessions.length ? hookCharsTotal / sessions.length : 0;

const globalItems = [
  ["Managed rules block in ~/.claude/CLAUDE.md", blockChars],
  [`Skill descriptions (${gSk.n})`, gSk.chars],
  [`Agent descriptions (${gAg.n})`, gAg.chars],
];
const projectItems = [
  ["Project CLAUDE.md", projClaude.length],
  ["Project AGENTS.md (via @AGENTS.md)", projAgents.length],
  [`Project skill descriptions (${pSk.n})`, pSk.chars],
  [`Project workflow descriptions (${pWf.n})`, pWf.chars],
];
const globalChars = globalItems.reduce((a, x) => a + x[1], 0);
const projectChars = projectItems.reduce((a, x) => a + x[1], 0);

function overheadCost(chars) { // chars present in every session
  let c = 0;
  for (const s of sessions) c += tok(chars) * (writePrice(s.mainModel) + readPrice(s.mainModel) * s.turns.length);
  return c;
}
let hookCost = 0;
for (const s of sessions) hookCost += tok(s.hookChars) * (writePrice(s.mainModel) + readPrice(s.mainModel) * s.turns.length);
const globalCost = overheadCost(globalChars) + hookCost;
const projectCost = overheadCost(projectChars);
const totalSpend = [...spendRows.values()].reduce((a, r) => a + r.cost, 0);
const pct = (x) => (totalSpend ? (100 * x / totalSpend).toFixed(1) : "0.0") + "%";

// ---------- markdown ----------
// ---------- Antigravity (Gemini) ----------
// One SQLite DB per conversation in ~/.gemini/antigravity/conversations/<uuid>.db.
// Blobs are protobuf; field numbers verified against real DBs (2026-10-24):
//   trajectory_metadata_blob['main']:
//     1.1 = workspace file URI, 2.1 = created (unix s)
//     5.1 = parent conversation UUID (present only on subagents)
//     8 = subagent metadata: 8.1 = type name, 8.2 = role, 8.3 = prompt
//     17 = 1 if subagent
//   gen_metadata.data (one row per model call): 1.19 = model name, 1.4 = usage stats:
//     2 input (uncached), 3 output (= 9 thinking + 10 response), 5 cache read, 4 cache write
// Readability alone does not establish scoped usage; failures retain skipped counts.
const ag = {
  status: "none",
  mainSessions: [],
  subagents: [],
  skipped: 0,
  rows: new Map(),
  cost: 0,
  kitItems: [],
  kitChars: 0,
  kitCost: 0,
  spawns: [],
  delegationSavings: 0,
};
const normPath = (p) => path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const agDir = path.join(home, ".gemini", "antigravity", "conversations");
const agFiles = safeDir(agDir).filter((f) => f.endsWith(".db"));

// Antigravity kit items measurement
try {
  const agAgentsText = safeRead(path.join(project, "AGENTS.md")) || "";
  const agOptRule = safeRead(path.join(home, ".gemini", "config", "rules", "token-optimization.md")) || "";
  ag.kitItems = [
    ["Project AGENTS.md (user rules)", agAgentsText.length],
    [`Project skill descriptions (${pSk.n})`, pSk.chars],
    [`Kit global skill descriptions (${gSk.n})`, gSk.chars],
  ];
  if (agOptRule) ag.kitItems.push(["Kit global rules (token-optimization)", agOptRule.length]);
  ag.kitChars = ag.kitItems.reduce((a, x) => a + x[1], 0);
} catch {}

if (agFiles.length) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const want = normPath(project);
    let readable = 0;
    const mainSessionsMap = new Map();
    const rawSubagents = [];

    for (const f of agFiles) {
      const fp = path.join(agDir, f);
      let db;
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) continue;
        db = new DatabaseSync(fp, { readOnly: true });
        const meta = pbFields(Buffer.from(db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get().data));
        const uri = pbFields(meta[1][0])[1][0].toString();
        readable++;
        const ws = normPath(fileURLToPath(uri));
        if (ws !== want && !ws.startsWith(want + "/")) continue; // other project

        const id = f.slice(0, -3);
        const isSub = Boolean(meta[5] || meta[17]);
        const parentId = meta[5]?.[0]?.toString() || "";
        const subType = meta[8] ? pbFields(meta[8][0])[1]?.[0]?.toString() : (meta[4] ? pbFields(meta[4][0])[1]?.[0]?.toString() : "subagent");
        const subRole = meta[8] ? pbFields(meta[8][0])[2]?.[0]?.toString() : "";
        const subPrompt = meta[8] ? pbFields(meta[8][0])[3]?.[0]?.toString() : "";

        const turns = [];
        let reqs = 0;
        for (const r of db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all()) {
          const g = pbFields(pbFields(Buffer.from(r.data))[1][0]);
          if (!g[4]) continue;
          const u = pbFields(g[4][0]), n = (k) => u[k]?.[0] ?? 0;
          if (!u[2] && !u[3]) continue; // aborted call, no usage
          const model = g[19]?.[0]?.toString() || "unknown";
          const p = geminiPrice(model);
          const cost = (n(2) * p.in + n(4) * p.in + n(5) * p.cacheRead + n(3) * p.out) / 1e6;
          const scope = isSub ? "subagent" : "main";
          const key = scope + "|" + model;
          const row = ag.rows.get(key) || { scope, model, req: 0, inp: 0, cw: 0, cr: 0, out: 0, think: 0, cost: 0 };
          row.req++; row.inp += n(2); row.cw += n(4); row.cr += n(5); row.out += n(3); row.think += n(9); row.cost += cost;
          ag.rows.set(key, row);
          ag.cost += cost;
          reqs++;
          turns.push({ model, inp: n(2), cw: n(4), cr: n(5), out: n(3), think: n(9), cost, ctx: n(2) + n(4) + n(5) });
        }

        if (reqs) {
          if (isSub) {
            rawSubagents.push({ id, parentId, type: subType || "subagent", role: subRole, prompt: subPrompt, turns });
          } else {
            const cnt = {};
            for (const t of turns) cnt[t.model] = (cnt[t.model] || 0) + 1;
            const mainModel = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || "gemini-3.8-flash";
            const session = { id, mainModel, turns, reqs };
            mainSessionsMap.set(id, session);
            ag.mainSessions.push(session);
          }
        }
      } catch { ag.skipped++; } finally { try { db?.close(); } catch {} }
    }

    // Antigravity kit overhead across main sessions
    for (const s of ag.mainSessions) {
      const p = geminiPrice(s.mainModel);
      ag.kitCost += tok(ag.kitChars) * (p.in / 1e6 + (p.cacheRead / 1e6) * Math.max(0, s.turns.length - 1));
    }

    // Antigravity delegation savings across subagents
    for (const sub of rawSubagents) {
      ag.subagents.push(sub);
      const parent = mainSessionsMap.get(sub.parentId);
      const mainModel = parent?.mainModel || "gemini-3.8-flash";
      const pMain = geminiPrice(mainModel);
      const mainCtx = parent ? (parent.turns[Math.floor(parent.turns.length / 2)]?.ctx || 35000) : 35000;

      let actual = 0, totalOut = 0;
      for (const t of sub.turns) { actual += t.cost; totalOut += t.out; }
      const firstCtx = sub.turns[0].ctx;
      const G = Math.max(0, sub.turns[sub.turns.length - 1].ctx - firstCtx);
      let carried = 0;
      for (const t of sub.turns) carried += mainCtx + Math.max(0, t.ctx - firstCtx);

      const mainReadPrice = pMain.cacheRead / 1e6;
      // Spawn position is unknown: assume mid-session (as for mainCtx), so half the parent's turns remain.
      const remaining = parent ? Math.floor(parent.turns.length / 2) : 5;
      const inline = carried * mainReadPrice + (totalOut + G) * (pMain.in / 1e6) + G * mainReadPrice * remaining;
      const pBase = geminiPrice(agBaseline), baseRead = pBase.cacheRead / 1e6;
      const inlineBase = carried * baseRead + (totalOut + G) * (pBase.in / 1e6) + G * baseRead * remaining;
      ag.spawns.push({
        carried, totalOut, G, remaining, inlineBase,
        session: sub.id.slice(0, 8),
        type: sub.type,
        model: sub.turns[0]?.model || "flash-lite",
        desc: sub.prompt.slice(0, 60),
        actual,
        inline,
        savings: inline - actual,
      });
    }
    ag.delegationSavings = ag.spawns.reduce((a, r) => a + r.savings, 0);

    ag.status = ag.mainSessions.length || ag.subagents.length ? "ok" :
      readable || !ag.skipped ? "no_matching_usage" : "unreadable";
  } catch { ag.status = "unreadable"; }
}

// ---------- savings summary: same tokens repriced on one default model ----------
// Claude: baseline = main turns at baseFam + every spawn priced inline. Spawns skipped by the "else continue" branch have no spend
// in totalSpend and no spawnRows entry, so they add nothing to either side: gross = (baseMain - mainActual) + sum(inlineBase - actual) exactly.
const kitCost = globalCost + projectCost;
const mainActual = [...spendRows.values()].filter((r) => r.scope === "main").reduce((a, r) => a + r.cost, 0);
const cc = { actual: totalSpend, base: baseMain + spawnRows.reduce((a, r) => a + r.inlineBase, 0), kit: kitCost,
  model: baseMain - mainActual, deleg: spawnRows.reduce((a, r) => a + (r.inlineBase - r.actual), 0) };
cc.gross = cc.base - cc.actual; cc.net = cc.gross - cc.kit;
const agS = { actual: ag.cost, base: 0, kit: ag.kitCost, model: 0, deleg: 0, gross: 0, net: 0 };
const agC = { actual: ag.cost, base: 0, kit: ag.kitCost, gross: 0, net: 0 };
if (ag.status === "ok") {
  const pB = geminiPrice(agBaseline), pC = PRICES[baseFam];
  let mainBase = 0, mainAct = 0, mainClaude = 0;
  for (const s of ag.mainSessions) for (const t of s.turns) {
    mainBase += (t.inp * pB.in + t.cw * pB.in + t.cr * pB.cacheRead + t.out * pB.out) / 1e6;
    mainClaude += (t.inp * pC.in + t.cw * pC.in + t.cr * pC.cacheRead + t.out * pC.out) / 1e6;
    mainAct += t.cost;
  }
  const cRead = pC.cacheRead / 1e6;
  const subClaude = ag.spawns.reduce((a, r) => a + r.carried * cRead + (r.totalOut + r.G) * (pC.in / 1e6) + r.G * cRead * r.remaining, 0);
  agS.base = mainBase + ag.spawns.reduce((a, r) => a + r.inlineBase, 0);
  agS.model = mainBase - mainAct; agS.deleg = ag.spawns.reduce((a, r) => a + (r.inlineBase - r.actual), 0);
  agS.gross = agS.base - agS.actual; agS.net = agS.gross - agS.kit;
  agC.base = mainClaude + subClaude; agC.gross = agC.base - agC.actual; agC.net = agC.gross - agC.kit;
}
const npct = (r) => (r.base > 0 ? (100 * r.net / r.base).toFixed(1) + "%" : "n/a");
const sRow = (name, r) => `| ${name} | ${usd(r.actual)} | ${usd(r.base)} | ${usd(r.gross)} | ${usd(r.kit)} | ${usd(r.net)} | ${npct(r)} |`;
const agOk = ag.status === "ok";
const SV = [`## Modeled price comparison`, "",
  "Counterfactual estimates using the configured historical API list prices; these do not measure billing, quota duration, or realized savings. Same tokens repriced, with subagent work modeled inline. Effort changes cannot be replayed.", "",
  `| Tool | Modeled actual | Baseline | Difference (gross) | Kit overhead | Difference (net) | Net % |`, `| :-- | --: | --: | --: | --: | --: | --: |`];
if (ccAvailable) SV.push(sRow(`Claude Code vs ${baseFam}`, cc));
else SV.push("Claude Code usage unavailable for this window; modeled cost and delegation conclusions unavailable.");
if (agOk) SV.push(sRow(`Antigravity vs ${agBaseline}`, agS), sRow(`Antigravity vs Claude ${baseFam} (rough tokenizer comparison)`, agC));
SV.push("");
// Legacy CSV stretch columns retain their positions and store modeled price ratios only.
const stretch = (r) => (r.actual > 0 ? (r.base - r.kit) / r.actual : 0);

// ---------- peak windows (Claude Code only: Antigravity turns carry no timestamps) ----------
function peakWindow(ms) {
  const ev = ccEvents.filter((e) => e.usage).sort((a, b) => a.ts - b.ts);
  const act = ev.map((e) => costOf(e.model, e.usage)), bas = ev.map((e) => costOf(baseFam, e.usage));
  let best = null, lo = 0, a = 0, b = 0;
  for (let hi = 0; hi < ev.length; hi++) {
    a += act[hi]; b += bas[hi];
    while (ev[hi].ts - ev[lo].ts >= ms) { a -= act[lo]; b -= bas[lo]; lo++; }
    if (!best || a > best.actual) best = { actual: a, base: b, n: hi - lo + 1, start: ev[lo].ts };
  }
  return best;
}
const pk5 = peakWindow(5 * 3600e3), pk7 = peakWindow(7 * 86400e3);
const utc = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const PK = [`## Peak windows`, ""];
if (!pk5) PK.push(`No timestamped Claude Code turns in this window.`, "");
else {
  PK.push(`| Window | Start (UTC) | Requests | Actual | All on ${baseFam} | Modeled price ratio |`, `| :-- | :-- | --: | --: | --: | --: |`);
  for (const [n, p] of [["Busiest 5 hours", pk5], ["Busiest 7 days", pk7]]) PK.push(`| ${n} | ${utc(p.start)} | ${fmt(p.n)} | ${usd(p.actual)} | ${usd(p.base)} | ${p.actual > 0 ? (p.base / p.actual).toFixed(2) : "n/a"}x |`);
  PK.push("", `Claude Code only (main + subagent turns); Antigravity: no per-call timestamps. Prices are modeled estimates; ratios do not predict subscription quota.`, "");
}

const today = new Date().toISOString().slice(0, 10);
const L = [];
L.push(`# Token report`, "");
L.push(`- Project: \`${project}\``);
L.push(`- Claude Code window: ${sinceMs > Date.now() - days * 86400000 ? `since ${sinceRaw}` : `last ${days} days`}, ${sessions.length} sessions with usage (${sessionFiles.length} transcript files)`);
L.push(`- Generated: ${today}`);
L.push(`- Prices: API list $/MTok (opus ${PRICES.opus.in}/${PRICES.opus.out}, sonnet ${PRICES.sonnet.in}/${PRICES.sonnet.out}, haiku ${PRICES.haiku.in}/${PRICES.haiku.out}); cache write 1.25x (5m) or 2x (1h), cache read 0.1x. These are modeled estimates from configured historical API prices, not subscription billing or quota.`, "");

L.push(`## Codex usage observations`, "", `Coverage: **${codex.coverage}**. ${codex.scope}`, "",
  `Sessions: main ${codex.roles.main}, worker ${codex.roles.worker}, guardian ${codex.roles.guardian}, unknown ${codex.roles.unknown}.`, "",
  codex.counterSemantics,
  codex.modeledCostUsd !== null && codex.modeledCostUsd > 0
    ? `Cost: modeled cost **${usd(codex.modeledCostUsd)}** (${codex.pricedSessions} priced sessions${codex.unpricedSessions ? `, ${codex.unpricedSessions} unpriced` : ""}; quota savings unknown).`
    : `Cost and quota savings: unknown${codex.unpricedSessions ? ` (${codex.unpricedSessions} unpriced sessions)` : ""}.`,
  "",
  "| Session | Role | Input | Cached input | Cache write | Output | Reasoning output | Reported total | Coverage |",
  "| :-- | :-- | --: | --: | --: | --: | --: | --: | :-- |");
const observedValue = n => n === null ? "unknown" : fmt(n);
for (const c of codex.sessions) L.push(`| ${c.id} | ${c.role} | ${["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"].map(k => observedValue(c.observed[k])).join(" | ")} | ${c.coverage}${c.reasons.length ? ": " + c.reasons.join(", ") : ""} |`);
L.push("", `Diagnostics: ${JSON.stringify(codex.diagnostics)}`, "", `Details: codex-usage.json.`, "");
L.push(...SV);
L.push(...PK);
if (ccAvailable) {
L.push(`## Spend by model`, "", `| Scope | Model | Requests | Input | Cache write | Cache read | Output | $ |`, `| :-- | :-- | --: | --: | --: | --: | --: | --: |`);
for (const r of [...spendRows.values()].sort((a, b) => a.scope.localeCompare(b.scope) || b.cost - a.cost))
  L.push(`| ${r.scope} | ${r.model} | ${fmt(r.req)} | ${fmt(r.inp)} | ${fmt(r.cw)} | ${fmt(r.cr)} | ${fmt(r.out)} | ${usd(r.cost)} |`);
L.push(`| **total** | | | | | | | **${usd(totalSpend)}** |`, "");

}

L.push(`## Antigravity (Gemini)`, "");
if (ag.status === "none") L.push(`No Antigravity conversations found in \`~/.gemini/antigravity/conversations\`.`, "");
else if (ag.status === "unreadable") L.push(`**Antigravity: usage not readable (format unknown).** The kit's protobuf field map no longer matches; re-verify it in tokenReport.mjs.`, "");
else if (ag.status === "no_matching_usage") L.push(`**Antigravity: no matching usage observed for this project/window.** Cost, overhead and delegation conclusions are unavailable.${ag.skipped ? ` ${ag.skipped} unreadable DBs skipped; coverage is incomplete.` : ""}`, "");
else {
  const agPct = (x) => (ag.cost ? (100 * x / ag.cost).toFixed(1) : "0.0") + "%";
  const thinkPct = (th, o) => (o > 0 ? (100 * th / o).toFixed(0) + "%" : "n/a");
  L.push(`${ag.mainSessions.length} main sessions, ${ag.subagents.length} subagents with usage in this project (window by file mtime)${ag.skipped ? `; ${ag.skipped} unreadable DBs skipped` : ""}. Antigravity reports input excluding cache reads; thinking is part of output. Prices: estimated Gemini API list $/MTok (${GEMINI_PRICES.filter(([k]) => k).map(([k, p]) => `${k} ${p.in}/${p.out}`).join(", ")}, unknown models as flash), cache read ${GEMINI_CACHE_READ}x. Not what the Antigravity plan charges.`, "");

  L.push(`### Spend by model`, "",
    `| Scope | Model | Requests | Input | Cache write | Cache read | Output | of which thinking | Thinking % | $ |`,
    `| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: |`);
  for (const r of [...ag.rows.values()].sort((a, b) => a.scope.localeCompare(b.scope) || b.cost - a.cost))
    L.push(`| ${r.scope} | ${r.model} | ${fmt(r.req)} | ${fmt(r.inp)} | ${fmt(r.cw)} | ${fmt(r.cr)} | ${fmt(r.out)} | ${fmt(r.think)} | ${thinkPct(r.think, r.out)} | ${usd(r.cost)} |`);
  L.push(`| **total** | | | | | | | | ${thinkPct([...ag.rows.values()].reduce((a, r) => a + r.think, 0), [...ag.rows.values()].reduce((a, r) => a + r.out, 0))} | **${usd(ag.cost)}** |`, "");

  L.push(`### Kit overhead`, "",
    `Fixed text the kit adds to every main session (~${fmt(tok(ag.kitChars))} tokens). Cost per session = tokens x (input write once + cache read x main turns), at the session's main model.`, "",
    `| Item | Scope | Chars | ≈Tokens |`, `| :-- | :-- | --: | --: |`);
  for (const [n, c] of ag.kitItems) L.push(`| ${n} | Antigravity | ${fmt(c)} | ${fmt(tok(c))} |`);
  L.push("", `Total Antigravity kit overhead: **${usd(ag.kitCost)}** (${agPct(ag.kitCost)} of ${usd(ag.cost)} spend).`, "");

  L.push(`### Delegation`, "");
  if (!ag.spawns.length) {
    L.push(`No subagents spawned in ${ag.mainSessions.length} main sessions.`, "");
  } else {
    const agBy = {};
    for (const r of ag.spawns) {
      const k = r.type + " / " + r.model;
      agBy[k] = agBy[k] || { n: 0, a: 0, i: 0 };
      agBy[k].n++; agBy[k].a += r.actual; agBy[k].i += r.inline;
    }
    L.push(`| Subagent / model | Spawns | Actual $ | Inline est. $ | Savings $ |`, `| :-- | --: | --: | --: | --: |`);
    for (const [k, v] of Object.entries(agBy)) L.push(`| ${k} | ${v.n} | ${usd(v.a)} | ${usd(v.i)} | ${usd(v.i - v.a)} |`);
    L.push(`| **total** | **${ag.spawns.length}** | | | **${usd(ag.delegationSavings)}** |`, "");
    L.push(`Inline estimate = what the same work would cost in the main session at its model price. Spawns save only when the worker runs on a cheaper tier than the main session (e.g. \`research\` on flash-lite); same-tier workers pay a cold start plus their own growing context.${ag.spawns.length < 30 ? ` Small sample (${ag.spawns.length} runs, estimated list prices): treat as a direction, not a verdict.` : ""}`, "");
  }
}

if (ccAvailable) {
L.push(`## Kit overhead`, "", `Fixed text the kit adds to every session. Cost per session = tokens x (cache write once + cache read x main turns), at the session's main model.`, "",
  `| Item | Scope | Chars | ≈Tokens |`, `| :-- | :-- | --: | --: |`);
for (const [n, c] of globalItems) L.push(`| ${n} | kit-global | ${fmt(c)} | ${fmt(tok(c))} |`);
L.push(`| Hook context (avg per session) | kit-global | ${fmt(avgHook)} | ${fmt(tok(avgHook))} |`);
for (const [n, c] of projectItems) L.push(`| ${n} | project | ${fmt(c)} | ${fmt(tok(c))} |`);
L.push("", `| Total over window | $ | % of spend |`, `| :-- | --: | --: |`,
  `| Kit-global | ${usd(globalCost)} | ${pct(globalCost)} |`,
  `| Project | ${usd(projectCost)} | ${pct(projectCost)} |`, "");

L.push(`## Delegation`, "");
if (!totalSpawns) {
  L.push(`No Claude Code spawns observed in ${sessions.length} Claude sessions. This does not describe Codex activity or establish delegation savings.`, "");
} else {
  const by = {};
  for (const r of spawnRows) { const k = r.type + " / " + r.model; by[k] = by[k] || { n: 0, a: 0, i: 0 }; by[k].n++; by[k].a += r.actual; by[k].i += r.inline; }
  L.push(`| Subagent / model | Spawns | Actual $ | Inline est. $ | Savings $ |`, `| :-- | --: | --: | --: | --: |`);
  for (const [k, v] of Object.entries(by)) L.push(`| ${k} | ${v.n} | ${usd(v.a)} | ${usd(v.i)} | ${usd(v.i - v.a)} |`);
  L.push(`| **total** | **${spawnRows.length}** | | | **${usd(delegationSavings)}** |`, "");
  L.push(`Inline estimate = what the same work would cost in the main session at its model price: each subagent round-trip re-reads the main context plus work so far; the work (output + context growth G) is written once, then G is re-read on every remaining main turn. Spawns cost more than inline when the task is small and the main context is small.`, "");
  if (wasteful.length) {
    L.push(`Wasteful spawns (savings < 0):`, "", `| Session | Subagent | Description | Savings $ |`, `| :-- | :-- | :-- | --: |`);
    for (const r of wasteful) L.push(`| ${r.session} | ${r.type} / ${r.model} | ${r.desc} | ${usd(r.savings)} |`);
    L.push("");
  }
  const esc = spawnRows.filter((r) => r.model === "opus");
  if (esc.length) {
    const by2 = (e) => esc.filter((r) => r.effort === e), sum = (a) => a.reduce((x, r) => x + r.actual, 0);
    const mx = by2("max"), hi = by2("high"), oth = esc.filter((r) => r.effort !== "max" && r.effort !== "high");
    L.push(`### Escalations (opus subagents)`, "", `| Session | Effort | Description | Cost |`, `| :-- | :-- | :-- | --: |`);
    for (const r of esc) L.push(`| ${r.session} | ${r.effort} | ${r.desc.replace(/\|/g, "\\|")} | ${usd(r.actual)} |`);
    L.push("", `${esc.length} escalation${esc.length === 1 ? "" : "s"}: ${mx.length} at max (${usd(sum(mx))}), ${hi.length} at high (${usd(sum(hi))}), ${oth.length} other`, "");
  }
}

L.push(`## Routing outcomes`, "");
if (!implGated) L.push(`n=0, collecting`, "");
else {
  L.push(`| Tier | Gated spawns | Pass | Fail | Pass rate | Verifier-checked | False passes |`, `| :-- | --: | --: | --: | --: | --: | --: |`);
  for (const k of routingTiers) {
    const r = routing[k];
    const rate = r.n >= 10 ? (100 * r.pass / r.n).toFixed(0) + "%" : `n=${r.n}, collecting (need 10)`;
    L.push(`| ${k} | ${r.n} | ${r.pass} | ${r.fail} | ${rate} | ${r.vchecked} | ${r.falsePass} |`);
  }
  L.push("");
}
L.push(`Coverage: ${implGated} of ${implSpawns} implementation spawns carried a GATE line.`, "", `Mid-session rule edits: ${ruleEditSessions} sessions`, "");

L.push(`## Context hygiene`, "", `Late-checkpoint waste = cost of carrying context more than ${fmt(SOFT)} tokens past the session baseline, at cache-read price.`, "",
  `| Session | Turns | Baseline | Max ctx | Growth | Late-checkpoint waste |`, `| :-- | --: | --: | --: | --: | --: |`);
for (const h of hygiene) L.push(`| ${h.id} | ${h.turns} | ${fmt(h.base)} | ${fmt(h.max)} | ${fmt(h.growth)} | ${usd(h.waste)} |`);
L.push(`| **total** | | | | | **${usd(totalWaste)}** |`, "", `**Top 10 largest tool results (main sessions)**`, "",
  `| Session | Tool | Input | Chars | Est. $ carried |`, `| :-- | :-- | :-- | --: | --: |`);
for (const r of top10) L.push(`| ${r.session} | ${r.tool} | ${r.hint.replace(/\|/g, "\\|")} | ${fmt(r.chars)} | ${usd(r.cost)} |`);
L.push("");

}

let agSamePct = null;
if (ag.status === "ok") {
  const rows0 = [...ag.rows.values()];
  const mainTop0 = rows0.filter((r) => r.scope === "main").sort((a, b) => b.cost - a.cost)[0];
  const subs0 = rows0.filter((r) => r.scope === "subagent"), subCost0 = subs0.reduce((a, r) => a + r.cost, 0);
  if (mainTop0 && subCost0 > 0) agSamePct = Math.round(100 * subs0.filter((r) => geminiPrice(r.model).in === geminiPrice(mainTop0.model).in).reduce((a, r) => a + r.cost, 0) / subCost0);
}
const hp = path.join(outDir, "history.csv");
const TREND_COLS = ["stretch_cc", "stretch_ag", "ag_same_tier_pct", "peak5h_usd"];
const trendNow = { stretch_cc: ccAvailable && cc.actual > 0 ? stretch(cc).toFixed(2) : "", stretch_ag: agOk && ag.cost > 0 ? stretch(agS).toFixed(2) : "", ag_same_tier_pct: agSamePct == null ? "" : String(agSamePct), peak5h_usd: pk5 ? pk5.actual.toFixed(2) : "" };
let trendLine = null;
{
  const oldCsv = safeRead(hp);
  const lines = oldCsv ? oldCsv.split("\n").filter(Boolean) : [];
  if (lines.length > 1) {
    const cols = lines[0].split(","), rows = lines.slice(1).map((l) => l.split(","));
    const prior = rows.filter((r) => r[0] < today);
    const prev = prior.length ? prior[prior.length - 1] : rows[rows.length - 1];
    const get = (c) => { const i = cols.indexOf(c); return i >= 0 ? (prev[i] || "") : ""; };
    const parts = [];
    if (get("stretch_cc") && trendNow.stretch_cc) parts.push(`Claude modeled price ratio ${get("stretch_cc")}x → ${trendNow.stretch_cc}x`);
    if (get("stretch_ag") && trendNow.stretch_ag) parts.push(`Antigravity modeled price ratio ${get("stretch_ag")}x → ${trendNow.stretch_ag}x`);
    if (get("ag_same_tier_pct") && trendNow.ag_same_tier_pct) parts.push(`Antigravity same-tier subagents ${get("ag_same_tier_pct")}% → ${trendNow.ag_same_tier_pct}%`);
    if (get("peak5h_usd") && trendNow.peak5h_usd) parts.push(`peak 5h $${get("peak5h_usd")} → $${trendNow.peak5h_usd}`);
    trendLine = parts.length ? `Trend vs ${prev[0]}: ${parts.join("; ")}.` : "Trend: first run with trend columns, compare next time.";
  }
}
L.push(`## Verdict`, "");
if (trendLine) L.push(`- ${trendLine}`);
if (ccAvailable) L.push(
  `- Claude Code modeled kit overhead: **${usd(kitCost)}** (${pct(kitCost)} of ${usd(totalSpend)} modeled spend); modeled delegation difference: **${usd(delegationSavings)}** over ${spawnRows.length} spawns.` +
  ` Savings / overhead ratio: ${kitCost > 0 ? (delegationSavings / kitCost).toFixed(2) : "n/a"}.`);
if (ccAvailable) L.push(`- Modeled net difference vs ${baseFam}: **${usd(cc.net)}** (${npct(cc)} of baseline).`);
if (ag.status === "ok") {
  const agPct = (x) => (ag.cost ? (100 * x / ag.cost).toFixed(1) : "0.0") + "%";
  L.push(`- Antigravity kit overhead: **${usd(ag.kitCost)}** (${agPct(ag.kitCost)} of ${usd(ag.cost)} spend); delegation savings: **${usd(ag.delegationSavings)}** over ${ag.spawns.length} subagent runs.`);
}
L.push("");
const rec = [];
if (spawnRows.length && wasteful.length / spawnRows.length > 0.3) rec.push(`${wasteful.length} of ${spawnRows.length} observed Claude spawns (${Math.round(100 * wasteful.length / spawnRows.length)}%) cost more than modeled inline: consider keeping small tasks inline.`);
if (totalWaste > kitCost && totalWaste > 0) rec.push(`Late-checkpoint waste (${usd(totalWaste)}) exceeds kit overhead (${usd(kitCost)}): checkpoint earlier (lower CC_WATCH_SOFT/HARD).`);
if (top10.length && top10[0].chars > 20000) rec.push(`Bounded reads are being skipped: largest tool result is ${fmt(top10[0].chars)} chars (${top10[0].tool}: ${top10[0].hint || "n/a"}).`);
if (totalSpend && kitCost / totalSpend > 0.05) rec.push(`Kit overhead is ${pct(kitCost)} of spend (> 5%): trim rules/descriptions.`);
if (ag.status === "ok") {
  const rows = [...ag.rows.values()];
  const mainTop = rows.filter((r) => r.scope === "main").sort((a, b) => b.cost - a.cost)[0];
  const subs = rows.filter((r) => r.scope === "subagent"), subCost = subs.reduce((a, r) => a + r.cost, 0);
  if (mainTop && subCost > 0) {
    const same = subs.filter((r) => geminiPrice(r.model).in === geminiPrice(mainTop.model).in).sort((a, b) => b.cost - a.cost);
    const sameCost = same.reduce((a, r) => a + r.cost, 0);
    if (sameCost / subCost > 0.5) rec.push(`Antigravity: ${Math.round(100 * sameCost / subCost)}% of subagent spend runs at the main model's price (e.g. ${same[0].model}): route research/collect to flash-lite.`);
  }
  const unpriced = [...new Set(rows.filter((r) => geminiKey(r.model) === "").map((r) => r.model))];
  if (unpriced.length) rec.push(`Unpriced Gemini model(s) priced as flash: ${unpriced.join(", ")}. Add them to GEMINI_PRICES.`);
  for (const r of rows) if (r.scope === "main" && r.out > 1e5 && r.think / r.out > 0.6) rec.push(`Antigravity ${r.model}: thinking is ${Math.round(100 * r.think / r.out)}% of output: lower effort/thinking budget for routine tasks.`);
}
{
  const mainOn = [...spendRows.values()].filter((r) => r.scope === "main" && family(r.model) === baseFam).reduce((a, r) => a + r.cost, 0);
  if (mainActual > 0 && stretch(cc) < 1.10 && mainOn / mainActual > 0.9) rec.push(`Claude Code: ${Math.round(100 * mainOn / mainActual)}% of main-session spend is on ${baseFam}, modeled price ratio ${stretch(cc).toFixed(2)}x: delegate collect/verify to haiku and spec'd edits to sonnet.`);
}
if (!rec.length) rec.push("No supported recommendation from the available telemetry; observed counters alone do not establish kit effectiveness.");
for (const r of rec) L.push(`- ${r}`);
L.push("");

// ---------- write ----------
try {
  fs.mkdirSync(outDir, { recursive: true });
  const gi = path.join(outDir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n");
  const reportPath = path.join(outDir, "token-report.md");
  fs.writeFileSync(reportPath, L.join("\n"));
  fs.writeFileSync(path.join(outDir, "codex-usage.json"), JSON.stringify(codex, null, 2) + "\n");
  let kitVersion = "";
  try { kitVersion = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "VERSION"), "utf8").trim(); } catch {}
  const header = "date,days,sessions,spend_usd,kit_overhead_usd,delegation_savings_usd,checkpoint_waste_usd,spawns,wasteful_spawns,antigravity_usd,baseline_usd,saved_net_usd," + TREND_COLS.join(",") + ",kit_version\n";
  const agUsd = ag.status === "ok" ? ag.cost.toFixed(2) : "";
  const ccNumber = n => ccAvailable ? n.toFixed(2) : "";
  const row = [today, days, ccAvailable ? sessions.length : "", ccNumber(totalSpend), ccNumber(kitCost), ccNumber(delegationSavings), ccNumber(totalWaste), ccAvailable ? spawnRows.length : "", ccAvailable ? wasteful.length : "", agUsd, ccNumber(cc.base), ccNumber(cc.net), ...TREND_COLS.map((c) => trendNow[c]), kitVersion].join(",") + "\n";
  const old = safeRead(hp);
  if (old && !old.startsWith(header)) fs.writeFileSync(hp, header + old.slice(old.indexOf("\n") + 1)); // upgrade header; old rows leave the new column blank
  fs.appendFileSync(hp, (old ? "" : header) + row);
  if (wantSummary) {
    const rel = path.relative(project, reportPath);
    const shown = rel.startsWith("..") ? reportPath : rel.replace(/\\/g, "/");
    const agSummary = ag.status === "ok" ? `modeled spend ${usd(ag.cost)} (${ag.mainSessions.length} main, ${ag.subagents.length} sub; modeled overhead ${usd(ag.kitCost)}, modeled delegation difference ${usd(ag.delegationSavings)})` :
      ag.status === "no_matching_usage" ? `no matching usage; costs and delegation unknown${ag.skipped ? ` (${ag.skipped} unreadable DBs skipped; incomplete coverage)` : ""}` :
      ag.status === "none" ? "no source; costs and delegation unknown" : "not readable; costs and delegation unknown";
    const claudeSummary = ccAvailable ? `Claude ${sessions.length} sessions, modeled spend ${usd(totalSpend)}, modeled delegation difference ${usd(delegationSavings)}` : "Claude usage unavailable; costs and delegation unknown";
    const codexCostSummary = (codex.modeledCostUsd !== null && codex.modeledCostUsd > 0) ? `modeled cost ${usd(codex.modeledCostUsd)}` : "cost unknown";
    console.log(`Token report${kitVersion ? " kit v" + kitVersion : ""}: ${claudeSummary} · Codex ${codex.coverage}, ${codex.sessions.length} sessions (main ${codex.roles.main}, worker ${codex.roles.worker}, guardian ${codex.roles.guardian}, unknown ${codex.roles.unknown}); per-session reported counters in report, overlap unknown, ${codexCostSummary} · Antigravity ${agSummary} → ${shown}`);
  } else console.log(reportPath);
} catch (e) {
  console.error("tokenReport: " + e.message);
  process.exit(1);
}
