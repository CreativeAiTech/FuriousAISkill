#!/usr/bin/env node
// Token hygiene audit: finds what bloats the always-loaded starting context and writes a short findings report.
// Usage: node contextHygiene.mjs [--project <dir>] [--json] [--quiet]
// Writes <project>/.agents/reports/context-hygiene.md and ~/.claude/hooks/state/context-hygiene/<slug>.json
// ({date, sizes, baseline}) so the next run can diff week over week. Never prints transcript content.
// Run on the first session in a project and then weekly by context-watch's SessionStart hook.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flag = (n) => argv.includes("--" + n);

function mainRoot(dir) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", timeout: 3000, windowsHide: true });
  const common = r.status === 0 ? String(r.stdout).trim() : "";
  return common && path.basename(common) === ".git" ? path.dirname(common) : dir;
}
const project = mainRoot(path.resolve(arg("project", process.cwd())));
const slug = project.replace(/[^A-Za-z0-9]/g, "-");
const home = os.homedir();
const STATE_DIR = path.join(home, ".claude", "hooks", "state", "context-hygiene");
const statePath = path.join(STATE_DIR, slug + ".json");
const today = new Date().toISOString().slice(0, 10);

const FILE_MAX = 3000, GROWTH = 0.2, ONDEMAND_MAX = 8000, HEADER_MAX = 300, TREND = 0.05, OUTLIER = 0.10;
const tok = (chars) => Math.round(chars / 4); // est.
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const safeDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
const rel = (f) => { const r = path.relative(project, f); return r && !r.startsWith("..") && !path.isAbsolute(r) ? r.replace(/\\/g, "/") : f.replace(home, "~").replace(/\\/g, "/"); };

const prev = readJson(statePath);
const findings = []; // {check, what, measured, why, fix, save, info}
const add = (f) => findings.push({ save: 0, info: false, ...f });
const sizes = {};

// a. Always-loaded rule files
const files = new Set();
const addFile = (f) => { if (f && fs.existsSync(f) && fs.statSync(f).isFile()) files.add(path.resolve(f)); };
const globalMd = path.join(home, ".claude", "CLAUDE.md");
const projMd = path.join(project, "CLAUDE.md");
addFile(globalMd); addFile(projMd);
addFile(path.join(project, "GEMINI.md")); addFile(path.join(project, "AGENTS.md"));
addFile(path.join(home, ".claude", "projects", slug, "memory", "MEMORY.md"));
function imports(f, depth = 0) {
  if (depth > 3) return;
  const t = read(f); if (!t) return;
  for (const m of t.matchAll(/^[ \t]*@([^\s`]+)/gm)) {
    const p = m[1].startsWith("~") ? path.join(home, m[1].slice(1)) : path.resolve(path.dirname(f), m[1]);
    if (fs.existsSync(p) && fs.statSync(p).isFile() && !files.has(path.resolve(p))) { files.add(path.resolve(p)); imports(p, depth + 1); }
  }
}
for (const f of [globalMd, projMd]) if (fs.existsSync(f)) imports(f);
for (const f of files) {
  const t = read(f); if (t === null) continue;
  const n = tok(t.length), key = rel(f);
  sizes[key] = n;
  if (n > FILE_MAX) add({ check: "a", what: `${key} is large`, measured: `${n} est. tokens (limit ${FILE_MAX})`, why: "loaded into every session's starting context", fix: "move settled detail into on-demand files (decision notes, skills) and keep a pointer", save: n - FILE_MAX });
  const old = prev && prev.sizes && prev.sizes[key];
  if (old && n > old * (1 + GROWTH)) add({ check: "a", what: `${key} grew ${Math.round((n / old - 1) * 100)}% since ${prev.date}`, measured: `${old} -> ${n} est. tokens`, why: "loaded into every session's starting context", fix: "trim what was added or move it to an on-demand file", save: n - old });
}

// b. Duplicate skills
const skillRoots = [path.join(home, ".claude", "skills"), path.join(project, ".claude", "skills")]; // ~/.agents/skills is the kit source that sync copies into ~/.claude/skills, not loaded itself
const byName = {};
for (const r of skillRoots) for (const n of safeDir(r)) (byName[n] ||= []).push(r);
for (const [n, rs] of Object.entries(byName)) if (rs.length > 1) {
  const sk = read(path.join(rs[0], n, "SKILL.md"));
  const d = sk ? (sk.match(/^description:\s*(.*)$/m) || [, ""])[1] : "";
  add({ check: "b", what: `skill "${n}" exists in ${rs.length} local dirs`, measured: rs.map(rel).join(", "), why: "each copy lists its description in every session (skill index is always loaded)", fix: "keep one copy (global ~/.claude/skills or the project's .claude/skills), delete the other", save: Math.max(tok(d.length), 40) * (rs.length - 1) });
}

// c. Duplicate hooks
const SCRIPT_RE = /[\w.-]+\.(?:mjs|cjs|js|sh|ps1|py)/gi;
const normHook = (cmd) => { const m = String(cmd).match(SCRIPT_RE); return m ? m[m.length - 1].toLowerCase().replace(/[-_]/g, "").replace(/\.[a-z0-9]+$/, "") : null; };
const hookMap = {}; // event -> script -> sources
for (const f of [path.join(home, ".claude", "settings.json"), path.join(project, ".claude", "settings.json"), path.join(project, ".claude", "settings.local.json")]) {
  const s = readJson(f); if (!s || !s.hooks) continue;
  for (const [ev, groups] of Object.entries(s.hooks)) for (const g of groups || []) for (const h of g.hooks || []) {
    const b = normHook(h.command); if (!b) continue;
    const e = ((hookMap[ev] ||= {})[b] ||= { key: b, names: new Set(), srcs: new Set() });
    e.names.add((String(h.command).match(SCRIPT_RE) || []).pop()); e.srcs.add(rel(f));
  }
}
const gate = readJson(path.join(project, ".agents", "baton.config.json"));
const modelGate = !!(gate && gate.modelGate);
for (const [ev, m] of Object.entries(hookMap)) for (const e of Object.values(m)) if (e.srcs.size > 1) {
  const names = [...e.names].join(" / "), srcs = [...e.srcs].join(", ");
  if (e.key === "modelcheck" && !modelGate)
    add({ check: "c", info: true, what: `info: duplicate registration of ${names} on ${ev}, kit copy inactive here (no modelGate)`, measured: srcs, why: "runtime only, 0 tokens: the kit hook exits at once without modelGate", fix: "optional: drop one registration to save a process spawn", save: 0 });
  else
    add({ check: "c", what: `hook ${names} on ${ev} registered in ${e.srcs.size} settings files`, measured: srcs, why: "runs twice per event: extra process time and duplicate injected output", fix: "keep it in one settings file (global kit hook or project copy)", save: 100 });
}

// d. SessionStart injection (CONTEXT.md header)
const ctx = read(path.join(project, "CONTEXT.md"));
if (ctx) {
  const header = ctx.split("\n").slice(0, 2).join(" ").trim();
  if (header.length > HEADER_MAX) add({ check: "d", what: "CONTEXT.md header is long", measured: `${header.length} chars (limit ${HEADER_MAX}), ~${tok(header.length)} est. tokens`, why: "context-watch injects the first 2 lines every session (the hook caps it at 200 chars)", fix: "shorten lines 1-2 to a one-line title; details go in the body", save: tok(Math.max(0, header.length - 200)) });
}

// e. On-demand files
for (const f of [".agents/BACKLOG.md", ".agents/STATE.md", "CONTEXT.md"]) {
  const t = read(path.join(project, f)); if (t === null) continue;
  const n = tok(t.length); sizes[f] = n;
  if (n > ONDEMAND_MAX) {
    const done = (t.match(/^\s*[-*]\s*\[x\]/gim) || []).length;
    add({ check: "e", what: `${f} is large`, measured: `${n} est. tokens (limit ${ONDEMAND_MAX})${f.includes("BACKLOG") ? `, ${done} done [x] items` : ""}`, why: "read on demand (every 'continue'), so each read costs the whole file", fix: "archive done items to .agents/archive/ and keep only open work", save: Math.round((n - ONDEMAND_MAX) * 0.5) });
  }
}

// f. Baseline trend from transcripts
const projRoot = path.join(home, ".claude", "projects");
const cutoff = Date.now() - 14 * 864e5, mid = Date.now() - 7 * 864e5;
const sess = []; // {t, n, id}
for (const d of safeDir(projRoot)) if (d.startsWith(slug)) for (const fn of safeDir(path.join(projRoot, d))) {
  if (!fn.endsWith(".jsonl")) continue;
  const fp = path.join(projRoot, d, fn);
  let st; try { st = fs.statSync(fp); } catch { continue; }
  if (st.mtimeMs < cutoff) continue;
  let fd; try { fd = fs.openSync(fp, "r"); } catch { continue; }
  let found = false, buf = "", pos = 0; const chunk = Buffer.alloc(262144);
  try {
    while (!found && pos < st.size && pos < 8e6) {
      const r = fs.readSync(fd, chunk, 0, chunk.length, pos); if (!r) break; pos += r;
      buf += chunk.toString("utf8", 0, r);
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.includes('"assistant"')) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== "assistant" || e.isSidechain || !e.message || !e.message.usage) continue;
        const u = e.message.usage;
        const n = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (n > 0) { sess.push({ t: e.timestamp ? Date.parse(e.timestamp) : st.birthtimeMs, n, id: fn.slice(0, 8) }); found = true; break; }
      }
    }
  } catch {} finally { fs.closeSync(fd); }
}
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const recent = sess.filter((s) => s.t >= mid).map((s) => s.n), older = sess.filter((s) => s.t < mid).map((s) => s.n);
const baseline = { recent: med(recent), older: med(older), sessions: sess.length };
if (recent.length && older.length && baseline.recent > baseline.older * (1 + TREND))
  add({ check: "f", what: "first-turn context is growing", measured: `median ${kfmt(baseline.older)} -> ${kfmt(baseline.recent)} tokens (last 7d vs 7d before, +${Math.round((baseline.recent / baseline.older - 1) * 100)}%)`, why: "this is what every session pays before the first prompt", fix: "see the other findings; growth comes from rule files, skills, hooks or plugins", save: 0 });
const outl = baseline.recent ? sess.filter((s) => s.t >= mid && s.n > baseline.recent * (1 + OUTLIER)).sort((a, b) => b.n - a.n).slice(0, 5) : [];
if (outl.length) add({ check: "f", what: `${outl.length} recent session(s) started above median+10%`, measured: outl.map((s) => `${new Date(s.t).toISOString().slice(0, 10)} ${s.id} ${kfmt(s.n)}`).join("; "), why: "extra always-loaded context in those sessions (plugins, connectors or injected hooks active then)", fix: "compare their setup with a normal session; check app Settings for extra connectors/plugins", save: 0 });

// Report
findings.forEach((f) => { f.save = Math.max(0, Math.round(f.save)); });
const real = findings.filter((f) => !f.info);
const top = real.filter((f) => f.save > 0).sort((a, b) => b.save - a.save).slice(0, 3);
const total = real.filter((f) => f.check !== "e").reduce((s, f) => s + f.save, 0);
const perRead = real.filter((f) => f.check === "e").reduce((s, f) => s + f.save, 0);
const L = [`# Context hygiene (${today})`, "",
  `Project: ${project.replace(/\\/g, "/")} · token figures are est. (chars/4) · previous run: ${prev ? prev.date : "none (first run)"}`, "",
  `Starting-context baseline: ${baseline.sessions ? `median ${kfmt(baseline.recent)} tokens (last 7d, ${recent.length} sessions)${baseline.older ? `, ${kfmt(baseline.older)} the 7 days before` : ""}` : "no transcripts in the last 14 days"}.`, "",
  "## Findings", ""];
if (!findings.length) L.push("None. Nothing bloats the starting context right now.", "");
for (const f of findings) L.push(`- **[${f.check}] ${f.what}**: ${f.measured}. Cost: ${f.why}. Fix: ${f.fix}.`);
L.push("", "## Top 3 savings (est. tokens per session or per read)", "");
if (!top.length) L.push("None."); else top.forEach((f, i) => L.push(`${i + 1}. ~${kfmt(f.save)} est. tokens: ${f.what}`));
L.push("", "## Check in the app (can't be seen locally)", "",
  "claude.ai account skills and plugins such as `anthropic-skills:*`, `engineering:*`, `design:*`, and connectors/MCP servers add to the starting context. Review them in the app: Settings -> Capabilities / Skills / Connectors, and switch off what this project doesn't use. Turning anything off needs your yes.", "");
const outText = L.join("\n");
try {
  const dir = path.join(project, ".agents", "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "context-hygiene.md"), outText);
} catch {}
try {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ date: today, sizes, baseline: baseline.recent }, null, 1));
} catch {}

const nReal = real.length;
const line = `Token hygiene: ${nReal} findings (~${kfmt(total)} est. tokens/session always loaded, ~${kfmt(perRead)} per on-demand read), see .agents/reports/context-hygiene.md`;
if (flag("json")) console.log(JSON.stringify({ date: today, findings, top, baseline }, null, 1));
else if (flag("quiet")) console.log(line);
else { console.log(outText); console.log(line); }
