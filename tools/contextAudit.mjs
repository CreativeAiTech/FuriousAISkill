#!/usr/bin/env node
// Context-watch audit: how well do the nudges work, per kit version?
// Usage: node contextAudit.mjs [--project <dir>] [--days 7] [--json]
// Reads Claude Code transcripts (~/.claude/projects/<slug>*/*.jsonl); never prints transcript content.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const project = path.resolve(arg("project", process.cwd()));
const days = Number(arg("days", 7)) || 7;
const asJson = argv.includes("--json");

const slug = project.replace(/[:\\/.]/g, "-");
const root = path.join(os.homedir(), ".claude", "projects");
const cutoff = Date.now() - days * 864e5;
const PRICE = (m) => (/haiku/.test(m || "") ? 0.1 : /sonnet/.test(m || "") ? 0.3 : 0.5); // $/M cache-read
const HARD_GROWTH = 80000;

const files = [];
let dirs = [];
try { dirs = fs.readdirSync(root).filter((d) => d.startsWith(slug)); } catch {}
for (const d of dirs) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl")); } catch {}
  for (const f of names) {
    const p = path.join(root, d, f);
    const st = fs.statSync(p);
    if (st.mtimeMs >= cutoff) files.push({ p, id: f.slice(0, 8), mtime: st.mtime });
  }
}

const verCmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function scan(f) {
  const rl = readline.createInterface({ input: fs.createReadStream(f.p), crlfDelay: Infinity });
  let turns = 0;
  const calls = []; // {n, model}
  const nudges = []; // {turn, kind, ver, call}
  const ckpts = []; // {turn}
  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "user" && !e.isSidechain && !e.isMeta) {
      const c = e.message?.content;
      const real = typeof c === "string" ? c.trim() !== "" : Array.isArray(c) && c.some((x) => x.type === "text") && !c.some((x) => x.type === "tool_result");
      if (real && !e.toolUseResult) turns++;
    } else if (e.type === "attachment") {
      const s = JSON.stringify(e);
      if (s.includes("[context-watch")) {
        const m = s.match(/\[context-watch v(\d+\.\d+\.\d+)\]/);
        nudges.push({ turn: turns, kind: s.includes("is large") ? "hard" : s.includes("getting long") ? "soft" : "other", ver: m ? m[1] : "1.0.0", call: calls.length });
      }
    } else if (e.type === "assistant" && !e.isSidechain) {
      const u = e.message?.usage;
      if (u) {
        const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (n > 0) calls.push({ n, model: e.message.model });
      }
      for (const b of e.message?.content || []) {
        if (b.type !== "tool_use") continue;
        if (b.name === "Skill" && /context-compressor/.test(b.input?.skill || "")) ckpts.push({ turn: turns });
        else if ((b.name === "Write" || b.name === "Edit") && /CONTEXT\.md$/.test(b.input?.file_path || "")) ckpts.push({ turn: turns });
      }
    }
  }
  if (turns < 5 || !calls.length) return null;
  const base = Math.min(...calls.map((c) => c.n));
  const soft = nudges.find((n) => n.kind === "soft");
  const hard = nudges.find((n) => n.kind === "hard");
  const first = soft || hard;
  const version = (first || nudges[0])?.ver || "1.0.0";
  const SOFT_USED = verCmp(version, "1.1.0") >= 0 ? 30000 : 40000;
  const HARD_USED = verCmp(version, "1.1.0") >= 0 ? 60000 : HARD_GROWTH;
  let waste = 0, jump = 0, maxN = 0, crossHardCall = -1;
  calls.forEach((c, i) => {
    const g = c.n - base;
    waste += (Math.max(0, g - SOFT_USED) * PRICE(c.model)) / 1e6;
    if (i && c.n - calls[i - 1].n > jump) jump = c.n - calls[i - 1].n;
    if (c.n > maxN) maxN = c.n;
    if (crossHardCall < 0 && g >= HARD_USED) crossHardCall = i;
  });
  const ck = first ? ckpts.find((c) => c.turn >= first.turn) : null;
  return {
    id: f.id, date: f.mtime.toISOString().slice(5, 10), version, turns, calls: calls.length,
    baseK: Math.round(base / 1e3), maxK: Math.round(maxN / 1e3),
    softTurn: soft ? soft.turn : null, hardTurn: hard ? hard.turn : null,
    ckptAfter: ck ? ck.turn - first.turn : null, acted: !!ck,
    waste: +waste.toFixed(2), jumpK: Math.round(jump / 1e3),
    lagMiss: crossHardCall >= 0 && !hard,
  };
}

const rows = [];
for (const f of files) { const r = await scan(f); if (r) rows.push(r); }
rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const byVer = new Map();
for (const r of rows) { if (!byVer.has(r.version)) byVer.set(r.version, []); byVer.get(r.version).push(r); }
const summ = [...byVer.entries()].sort((a, b) => verCmp(a[0], b[0])).map(([version, rs]) => {
  const nudged = rs.filter((r) => r.softTurn !== null || r.hardTurn !== null);
  const acted = nudged.filter((r) => r.acted);
  const waste = rs.reduce((a, r) => a + r.waste, 0);
  return {
    version, sessions: rs.length, nudged: nudged.length,
    actedPct: nudged.length ? Math.round((100 * acted.length) / nudged.length) : 0,
    medianTurns: median(acted.map((r) => r.ckptAfter)),
    waste: +waste.toFixed(2), perSession: +(waste / rs.length).toFixed(2),
    lagMisses: rs.filter((r) => r.lagMiss).length,
  };
});

if (asJson) { console.log(JSON.stringify({ project, days, rows, summary: summ }, null, 2)); process.exit(0); }

const L = [];
L.push(`# Context-watch audit (${days}d, ${rows.length} sessions)`, "");
L.push("| id | date | ver | turns | calls | base k | max k | soft@ | hard@ | ckpt after | acted | waste $ | max jump k |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) L.push(`| ${r.id} | ${r.date} | ${r.version} | ${r.turns} | ${r.calls} | ${r.baseK} | ${r.maxK} | ${r.softTurn ?? "-"} | ${r.hardTurn ?? "-"} | ${r.ckptAfter ?? "-"} | ${r.acted ? "yes" : "no"} | ${r.waste.toFixed(2)} | ${r.jumpK} |`);
L.push("", "## Per version", "", "| ver | sessions | nudged | acted % | median turns to ckpt | waste $ | $/session | lag misses |", "|---|---|---|---|---|---|---|---|");
for (const s of summ) L.push(`| ${s.version} | ${s.sessions} | ${s.nudged} | ${s.actedPct} | ${s.medianTurns ?? "-"} | ${s.waste.toFixed(2)} | ${s.perSession.toFixed(2)} | ${s.lagMisses} |`);
L.push("", "Waste = carried tokens past the soft threshold, priced at cache-read rate. Lag miss = growth passed the version's hard threshold (80k before 1.1.0, 60k after) with no hard nudge.", "");
const out = L.join("\n");

try {
  const dir = path.join(project, ".agents", "reports");
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n");
  fs.writeFileSync(path.join(dir, "context-audit.md"), out);
  const hp = path.join(dir, "context-audit-history.csv");
  const header = "date,version,sessions,nudged,acted_pct,median_turns_to_ckpt,waste_usd,per_session_waste_usd,lag_misses\n";
  const today = new Date().toISOString().slice(0, 10);
  const rowsCsv = summ.map((s) => [today, s.version, s.sessions, s.nudged, s.actedPct, s.medianTurns ?? "", s.waste.toFixed(2), s.perSession.toFixed(2), s.lagMisses].join(",")).join("\n");
  if (rowsCsv) fs.appendFileSync(hp, (fs.existsSync(hp) ? "" : header) + rowsCsv + "\n");
} catch (e) { console.error("contextAudit: " + e.message); }

console.log(out.split("\n").slice(0, 60).join("\n"));
