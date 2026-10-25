#!/usr/bin/env node
// Token hygiene audit: finds what bloats the always-loaded starting context and writes a short findings report.
// Usage: node contextHygiene.mjs [--project <dir>] [--json] [--quiet]
// Writes <project>/.agents/reports/context-hygiene.md and ~/.claude/hooks/state/context-hygiene/<slug>.json
// ({date, sizes, baseline}) so the next run can diff week over week. Never prints transcript content.
// Also counts on-demand reads of <project>/.agents/rules/*.md from transcripts and flags files unread for 30 days.
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
    add({ check: "e", what: `${f} is large`, measured: `${n} est. tokens (limit ${ONDEMAND_MAX})${f.includes("BACKLOG") ? `, ${done} done [x] items` : ""}`, why: "read on demand (every 'continue'), so each read costs the whole file", fix: "archive done items (Crownspire: node tools/agentBrief.mjs archive). Kit baton.mjs does not read an archive yet, so elsewhere moving [x] lines breaks needs: checks", save: Math.round((n - ONDEMAND_MAX) * 0.5) });
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

// g. On-demand rule files (.agents/rules/*.md): sessions whose tool calls named the file in the last 30 days.
// Only Claude Code transcripts are visible; Antigravity reads don't count.
const rulesDir = path.join(project, ".agents", "rules");
const ruleFiles = safeDir(rulesDir).filter((f) => f.endsWith(".md")).sort();
const ruleReads = Object.fromEntries(ruleFiles.map((f) => [f, 0]));
const RULE_GRACE = 7; // days: a rule file younger than this isn't flagged yet
const ruleAge = Object.fromEntries(ruleFiles.map((f) => { // days since the file was added (git, else file birth time)
  const g = spawnSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", path.join(".agents", "rules", f)], { cwd: project, encoding: "utf8" });
  const t = Number(String(g.stdout || "").trim()) * 1000 || (() => { try { return fs.statSync(path.join(rulesDir, f)).birthtimeMs; } catch { return Date.now(); } })();
  return [f, Math.floor((Date.now() - t) / 864e5)];
}));
let ruleSessions = 0;
if (ruleFiles.length) {
  const cut30 = Date.now() - 30 * 864e5;
  // A read is a Read/Grep/Glob call, or a shell command that reads the file; writes and paths quoted in baton text don't count.
  // Kit rules (~/.agents/rules/) are told apart only by file name: a same-named kit file would count too.
  const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
  const SHELL_READ = /\b(?:cat|head|tail|sed|grep|rg|less|wc|Get-Content|type)\b[^|;&\n]*$/i;
  const RULE_RE = /\.agents[\\/]+rules[\\/]+([\w.-]+\.md)/g;
  const readsOf = (b) => {
    const s = JSON.stringify(b.input || {}), out = [];
    for (const m of s.matchAll(RULE_RE)) if (READ_TOOLS.has(b.name) || ((b.name === "Bash" || b.name === "PowerShell") && SHELL_READ.test(s.slice(0, m.index)))) out.push(m[1]);
    return out;
  };
  for (const d of safeDir(projRoot)) if (d.startsWith(slug)) for (const fn of safeDir(path.join(projRoot, d))) {
    if (!fn.endsWith(".jsonl")) continue;
    const fp = path.join(projRoot, d, fn);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    if (st.mtimeMs < cut30 || st.size > 64e6) continue;
    const txt = read(fp); if (!txt) continue;
    ruleSessions++;
    const seen = new Set();
    for (const line of txt.split("\n")) {
      if (!line.includes('"tool_use"') || !/rules[\\/]/.test(line)) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
      for (const b of c) if (b.type === "tool_use") for (const f of readsOf(b)) if (f in ruleReads) seen.add(f);
    }
    for (const f of seen) ruleReads[f]++;
  }
  const dead = ruleFiles.filter((f) => !ruleReads[f] && ruleAge[f] >= RULE_GRACE);
  if (ruleSessions && dead.length) add({ check: "g", what: `${dead.length} on-demand rule file(s) never read in 30 days`, measured: dead.map((f) => `.agents/rules/${f}`).join(", ") + ` (0 of ${ruleSessions} Claude Code sessions)`, why: "either agents skip the AGENTS.md trigger pointer or the rule is dead", fix: "check the trigger line wording in AGENTS.md; if the trigger never happens, fold the rule into another file or drop it", save: 0 });
}

// h. Lean rules (decision 2026-10-25-lean-rules): hot topic files, duplicate rules, big files without a map index.
const HOT = 0.7, DUP_MIN = 40, DUP_SHOWN = 10, MAP_MAX = 1500;
const leanRows = []; // report lines for the "Lean rules" section
const hot = ruleSessions ? ruleFiles.filter((f) => ruleAge[f] >= RULE_GRACE && ruleReads[f] / ruleSessions > HOT) : [];
for (const f of hot) leanRows.push(`| hot | .agents/rules/${f} | read in ${ruleReads[f]} of ${ruleSessions} sessions (${Math.round(ruleReads[f] / ruleSessions * 100)}%) | fold back into core |`);
if (hot.length) add({ check: "h", what: `${hot.length} on-demand rule file(s) read in over ${HOT * 100}% of sessions`, measured: hot.map((f) => `.agents/rules/${f} (${ruleReads[f]}/${ruleSessions})`).join(", "), why: "a file nearly every session reads is core in disguise and costs an extra tool call each time", fix: "fold it back into the always-on rules file", save: 0 });
const leanSet = [globalMd, projMd, path.join(project, "AGENTS.md"), path.join(project, "GEMINI.md")].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
const normLine = (l) => l.replace(/[*`]/g, "").replace(/^\s*(?:-\s*)?/, "").replace(/\s+/g, " ").trim().toLowerCase();
const seenLines = {}; // normalized line -> Set of file keys
for (const f of leanSet) for (const raw of (read(f) || "").split("\n")) {
  if (/^\s*#/.test(raw)) continue;
  const n = normLine(raw);
  if (n.length < DUP_MIN || /^[|:\s-]+$/.test(n)) continue;
  (seenLines[n] ||= new Set()).add(rel(f));
}
const dups = Object.entries(seenLines).filter(([, s]) => s.size >= 2);
for (const [n, s] of dups.slice(0, DUP_SHOWN)) leanRows.push(`| duplicate | ${[...s].join(", ")} | "${n.length > 70 ? n.slice(0, 67) + "..." : n}" | keep in one file |`);
if (dups.length > DUP_SHOWN) leanRows.push(`| duplicate | (more) | ${dups.length - DUP_SHOWN} further duplicate line(s) not shown | |`);
if (dups.length) add({ check: "h", what: `${dups.length} rule line(s) duplicated across always-on files`, measured: [...new Set(dups.flatMap(([, s]) => [...s]))].join(", "), why: "the same text is loaded twice every session", fix: "keep each rule in one file and point to it", save: tok(dups.reduce((s, [n]) => s + n.length, 0)) });
for (const f of leanSet) {
  const t = read(f) || "", n = tok(t.length);
  if (n > MAP_MAX && !/before you/i.test(t)) {
    leanRows.push(`| no map index | ${rel(f)} | ${n} est. tokens (limit ${MAP_MAX}), no "Before you" map | add a trigger table pointing at on-demand files |`);
    add({ check: "h", what: `${rel(f)} has no map index`, measured: `${n} est. tokens (over ${MAP_MAX}), no "Before you" text`, why: "a big always-on file without a trigger table can't be slimmed into on-demand files", fix: "add a 'Before you...' trigger table and move rarely needed rules out", save: 0 });
  }
}

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
if (ruleFiles.length) {
  L.push("", `## On-demand rule reads (last 30 days, ${ruleSessions} Claude Code sessions; Antigravity not visible)`, "", "| Rule file | Sessions that read it |", "| :--- | ---: |");
  for (const f of ruleFiles) L.push(`| .agents/rules/${f} | ${ruleReads[f]}${ruleReads[f] ? "" : ruleAge[f] < RULE_GRACE ? ` (new, ${ruleAge[f]}d old)` : " ⚠"} |`);
}
L.push("", "## Lean rules", "");
if (!leanRows.length) L.push("None. No hot topic files, duplicate rule lines or unmapped big files.");
else L.push("| Check | File(s) | Detail | Action |", "| :--- | :--- | :--- | :--- |", ...leanRows);
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
