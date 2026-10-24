#!/usr/bin/env node
// tokenReport: "is the agent kit worth having?" from Claude Code transcripts.
// Compares the kit's fixed per-session token overhead with measured savings
// (subagent delegation) and flags waste (late checkpoints, huge tool results).
// Costs are API-list-price equivalents; on a subscription, quota roughly
// tracks cost-weighted tokens.
//
// Usage: node tokenReport.mjs [--project <dir>] [--days 30] [--out <dir>] [--summary]
// No dependencies. Never throws on odd transcript lines.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// API list $/MTok; edit when prices change
const PRICES = {
  opus: { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
};
const CHARS_PER_TOKEN = 3.8;
const SOFT = Number(process.env.CC_WATCH_SOFT) || 40000;

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const project = path.resolve(arg("project", process.cwd()));
const days = Number(arg("days", 30)) || 30;
const outDir = path.resolve(arg("out", path.join(project, ".agents", "reports")));
const wantSummary = argv.includes("--summary");

const home = os.homedir();
const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
const readPrice = (model) => P(model).in * 0.1 / 1e6;
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
  return ((u.input_tokens || 0) * p.in + write + (u.cache_read_input_tokens || 0) * p.in * 0.1 +
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
const cutoff = Date.now() - days * 86400000;
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
  return { id: m.id, model: m.model || "", usage: m.usage, ctx: ctxOf(m.usage) };
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
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (!c || c.type !== "tool_result") continue;
        results.push({ id: c.tool_use_id, chars: textLen(c.content), turnAfter: turns.length });
        const sp = spawns.find((x) => x.id === c.tool_use_id);
        if (sp) sp.result = e.toolUseResult || null;
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
let totalSpawns = 0;
for (const s of sessions) {
  for (const t of s.turns) addSpend("main", t.model, t.usage);
  for (const sp of s.spawns) {
    totalSpawns++;
    const type = sp.input.subagent_type || "general-purpose";
    let model = sp.sideTurns && sp.sideTurns.find((t) => t.model && t.model !== "<synthetic>")?.model;
    if (!model) model = sp.input.model || agentFrontmatterModel(type) || (type === "Explore" ? "haiku" : s.mainModel);
    // Main context when the spawn happened: done inline, every subagent round-trip would re-read it.
    const mainCtx = (s.turns[Math.min(Math.max(sp.turn, 1), s.turns.length) - 1] || {}).ctx || 0;
    let actual = 0, out = 0, G = 0, carried = 0;
    if (sp.sideTurns && sp.sideTurns.length) {
      for (const t of sp.sideTurns) { addSpend("subagent", t.model || model, t.usage); actual += costOf(t.model || model, t.usage); out += t.usage.output_tokens || 0; }
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
    spawnRows.push({ session: s.id, type, model: family(model), desc: String(sp.input.description || "").slice(0, 60), actual, inline, savings: inline - actual });
  }
}
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
const today = new Date().toISOString().slice(0, 10);
const L = [];
L.push(`# Token report`, "");
L.push(`- Project: \`${project}\``);
L.push(`- Window: last ${days} days, ${sessions.length} sessions with usage (${sessionFiles.length} transcript files)`);
L.push(`- Generated: ${today}`);
L.push(`- Prices: API list $/MTok (opus ${PRICES.opus.in}/${PRICES.opus.out}, sonnet ${PRICES.sonnet.in}/${PRICES.sonnet.out}, haiku ${PRICES.haiku.in}/${PRICES.haiku.out}); cache write 1.25x (5m) or 2x (1h), cache read 0.1x. These are API-equivalent costs, not what a subscription charges; quota roughly tracks cost-weighted tokens.`, "");

L.push(`## Spend by model`, "", `| Scope | Model | Requests | Input | Cache write | Cache read | Output | $ |`, `| :-- | :-- | --: | --: | --: | --: | --: | --: |`);
for (const r of [...spendRows.values()].sort((a, b) => a.scope.localeCompare(b.scope) || b.cost - a.cost))
  L.push(`| ${r.scope} | ${r.model} | ${fmt(r.req)} | ${fmt(r.inp)} | ${fmt(r.cw)} | ${fmt(r.cr)} | ${fmt(r.out)} | ${usd(r.cost)} |`);
L.push(`| **total** | | | | | | | **${usd(totalSpend)}** |`, "");

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
  L.push(`**No subagents spawned in ${sessions.length} sessions: delegation rules add overhead but saved nothing yet.**`, "");
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
}

L.push(`## Context hygiene`, "", `Late-checkpoint waste = cost of carrying context more than ${fmt(SOFT)} tokens past the session baseline, at cache-read price.`, "",
  `| Session | Turns | Baseline | Max ctx | Growth | Late-checkpoint waste |`, `| :-- | --: | --: | --: | --: | --: |`);
for (const h of hygiene) L.push(`| ${h.id} | ${h.turns} | ${fmt(h.base)} | ${fmt(h.max)} | ${fmt(h.growth)} | ${usd(h.waste)} |`);
L.push(`| **total** | | | | | **${usd(totalWaste)}** |`, "", `**Top 10 largest tool results (main sessions)**`, "",
  `| Session | Tool | Input | Chars | Est. $ carried |`, `| :-- | :-- | :-- | --: | --: |`);
for (const r of top10) L.push(`| ${r.session} | ${r.tool} | ${r.hint.replace(/\|/g, "\\|")} | ${fmt(r.chars)} | ${usd(r.cost)} |`);
L.push("");

const kitCost = globalCost + projectCost;
L.push(`## Verdict`, "",
  `- Kit overhead: **${usd(kitCost)}** (${pct(kitCost)} of ${usd(totalSpend)} spend); delegation savings: **${usd(delegationSavings)}** over ${spawnRows.length} spawns.` +
  ` Savings / overhead ratio: ${kitCost > 0 ? (delegationSavings / kitCost).toFixed(2) : "n/a"}.`, "");
const rec = [];
if (!totalSpawns) rec.push(`Delegation isn't happening: either enforce it or drop the orchestration rules (§1) to save ≈${fmt(tok(blockChars))} tokens/session.`);
else if (wasteful.length / spawnRows.length > 0.3) rec.push(`${wasteful.length} of ${spawnRows.length} spawns (${Math.round(100 * wasteful.length / spawnRows.length)}%) cost more than inline: raise the "trivial" threshold so small tasks stay inline.`);
if (totalWaste > kitCost && totalWaste > 0) rec.push(`Late-checkpoint waste (${usd(totalWaste)}) exceeds kit overhead (${usd(kitCost)}): checkpoint earlier (lower CC_WATCH_SOFT/HARD).`);
if (top10.length && top10[0].chars > 20000) rec.push(`Bounded reads are being skipped: largest tool result is ${fmt(top10[0].chars)} chars (${top10[0].tool}: ${top10[0].hint || "n/a"}).`);
if (totalSpend && kitCost / totalSpend > 0.05) rec.push(`Kit overhead is ${pct(kitCost)} of spend (> 5%): trim rules/descriptions.`);
if (!rec.length) rec.push("No rule triggered; the kit looks healthy for this window.");
for (const r of rec) L.push(`- ${r}`);
L.push("");

// ---------- write ----------
try {
  fs.mkdirSync(outDir, { recursive: true });
  const gi = path.join(outDir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n");
  const reportPath = path.join(outDir, "token-report.md");
  fs.writeFileSync(reportPath, L.join("\n"));
  const hp = path.join(outDir, "history.csv");
  const header = "date,days,sessions,spend_usd,kit_overhead_usd,delegation_savings_usd,checkpoint_waste_usd,spawns,wasteful_spawns\n";
  const row = [today, days, sessions.length, totalSpend.toFixed(2), kitCost.toFixed(2), delegationSavings.toFixed(2), totalWaste.toFixed(2), spawnRows.length, wasteful.length].join(",") + "\n";
  fs.appendFileSync(hp, (fs.existsSync(hp) ? "" : header) + row);
  if (wantSummary) {
    const rel = path.relative(project, reportPath);
    const shown = rel.startsWith("..") ? reportPath : rel.replace(/\\/g, "/");
    console.log(`Token report (${days}d, ${sessions.length} sessions): spend ${usd(totalSpend)} · kit overhead ${usd(kitCost)} (${pct(kitCost)}) · delegation saved ${usd(delegationSavings)} (${spawnRows.length} spawns) · late-checkpoint waste ${usd(totalWaste)} → ${shown}`);
  } else console.log(reportPath);
} catch (e) {
  console.error("tokenReport: " + e.message);
  process.exit(1);
}
