#!/usr/bin/env node
// Memory hygiene audit for a Claude Code file-based memory dir (one .md per memory + index MEMORY.md).
// Usage: node memoryHygiene.mjs --memory <dir> [--repo <path>] [--rules <file>[,<file>]] [--store <dir>[,<dir>]] [--fix] [--json] [--out <file.md>]
// Level 1 REPORT (default): findings with file:line + quoted evidence; a brain decides every proposal.
// --index-out <file>: also writes a regenerable topic-grouped index (never inside the memory dir).
// Level 2 SAFE-FIX (--fix): only appends missing MEMORY.md index lines, after backing up to <memory>/.hygiene-backup/<stamp>/ and logging.
// --store lists EXTRA dirs for the size report; the Claude Code project dirs sharing the repo slug are always included.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BRANCHES = ["master", "main", "develop", "trunk"];
const STOP = new Set("this that with from have there their about which when what will would should could been being were also into only then than them they these those your each such more most other some very just like over under after before while where does done make made uses used using must never always every still not and the for are but you its can".split(" "));
const ORDER = ["stale", "duplicate", "drift", "index", "review"];

export const slugOf = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, "-");
export const clip = (s, n = 160, at = 0) => {
  s = String(s).trim().replace(/\s+/g, " ");
  if (s.length <= n) return s;
  const a = Math.max(0, Math.min(at - 50, s.length - n)), e = Math.min(s.length, a + n);
  return (a > 0 ? "…" : "") + s.slice(a, e) + (e < s.length ? "…" : "");
};
export const words = (s) => new Set((String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !STOP.has(w)));
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i);
}
const overlapMin = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.min(a.size, b.size); };
const finding = (check, severity, file, line, evidence, proposal, extra = {}, at = 0) => ({ check, severity, file, line, evidence: clip(evidence, 160, at), proposal, ...extra });
const unq = (s) => { const t = String(s).trim(), m = t.match(/^(["'])(.*)\1$/); return m ? (m[1] === '"' ? m[2].replace(/\\"/g, '"') : m[2]) : t; };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- parsing
export function parseMemory(file, text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let type = null, modified = null, end = 0, name = null, description = "", nameLine = 1, descLine = 1;
  if (lines[0]?.trim() === "---") {
    end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end < 0) end = 0;
    for (let i = 1; i < end; i++) {
      let m = lines[i].match(/^name:\s*(.*)$/); if (m) { name = unq(m[1]); nameLine = i + 1; }
      m = lines[i].match(/^\s*type:\s*(\S+)/); if (m) type = unq(m[1]);
      m = lines[i].match(/^\s*modified:\s*(\d{4}-\d{2}-\d{2})/); if (m) modified = m[1];
      m = lines[i].match(/^description:\s*(.*)$/); if (m) { description = unq(m[1]); descLine = i + 1; }
    }
  }
  return { file, lines, type, modified, name, description, nameLine, descLine, bodyStart: end ? end + 1 : 0 };
}
export function loadMemories(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "MEMORY.md").sort()) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      const m = parseMemory(f, fs.readFileSync(p, "utf8"));
      out.push(m.modified ? m : { ...m, modified: st.mtime.toISOString().slice(0, 10) }); // no frontmatter date: file mtime
    } catch (e) { console.error(`warning: skipped ${f}: ${e.code || e.message}`); }
  }
  return out;
}

const fold = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
function realish(p) {
  let cur = path.resolve(p); const rest = [];
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) break; rest.unshift(path.basename(cur)); cur = up; }
  try { cur = fs.realpathSync(cur); } catch { /* keep */ }
  return path.join(cur, ...rest);
}
// true when p is dir itself or anywhere below it (realpath'd parents, case-folded on win32)
export function insideDir(dir, p) {
  const r = path.relative(fold(realish(dir)), fold(realish(p)));
  return r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r));
}
const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };
export const encodeLink = (f) => encodeURI(f).replace(/\(/g, "%28").replace(/\)/g, "%29");
const bodyText = (m) => m.lines.slice(m.bodyStart).join("\n");

// ---- 1. index
export function checkIndex(dir, mems, indexText) {
  const out = [], idx = (indexText ?? "").split(/\r?\n/), linked = new Set();
  idx.forEach((l, i) => {
    for (const m of l.matchAll(/\]\(\s*<?([^)>]*?\.md)(?:#[^)>]*)?>?(?:\s+"[^)]*")?\s*\)/gi)) {
      if (/^[a-z]+:\/\//i.test(m[1])) continue;
      const target = safeDecode(m[1].trim()); linked.add(fold(path.basename(target)));
      if (!fs.existsSync(path.join(dir, target))) out.push(finding("index", "index", "MEMORY.md", i + 1, l, `index links missing file ${target}; remove the line or restore the file (brain)`));
    }
  });
  for (const m of mems) {
    const loose = idx.some((l) => fold(l).includes(fold(m.file)) || fold(l).includes(fold(encodeLink(m.file))));
    if (!linked.has(fold(m.file)) && !loose) out.push(finding("index", "index", m.file, 1, `${m.file} (${m.description || "no description"})`, "append an index line to MEMORY.md (safe-fix --fix)", { fixable: true }));
    const stem = m.file.replace(/\.md$/, "");
    if (m.name && m.name !== stem) out.push(finding("index", "index", m.file, m.nameLine, `name: ${m.name}`, `frontmatter name differs from filename stem "${stem}"; align one (brain)`));
  }
  return out;
}

// ---- 2. stale branch
export function localBranches(repo) {
  const set = new Set();
  try {
    for (const [remote, args] of [[true, ["branch", "-r", "--format=%(refname:short)"]], [false, ["branch", "--format=%(refname:short)"]]]) {
      const o = execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      for (const l of o.split(/\r?\n/)) { const b = remote ? l.trim().replace(/^[^/]+\//, "") : l.trim(); if (b && b !== "HEAD") set.add(b); }
    }
  } catch { return null; }
  return set.size ? set : null; // no refs at all: unknown, skip the check
}
export function checkStaleBranch(mems, branches) {
  if (!branches) return [];
  const out = [];
  for (const b of BRANCHES) {
    if (branches.has(b)) continue;
    const pats = [`origin/${b}\\b`, `\\binto\\s+\`?${b}\\b`, `\\bpush(?:ed)?\\s+to\\s+\`?${b}\\b`, `\`${b}\`\\s+branch`, `\\buses\\s+\`${b}\``, `HEAD:${b}\\b`].map((p) => new RegExp(p, "i"));
    for (const m of mems) m.lines.forEach((l, i) => {
      if (/^\s*(?:[-*]\s*)?\*\*Why:\*\*/.test(l)) return;
      const hit = pats.map((r) => l.search(r)).find((x) => x >= 0);
      if (hit !== undefined) out.push(finding("stale-branch", "stale", m.file, i + 1, l, `branch "${b}" does not exist in the repo; update or drop (brain)`, {}, hit));
    });
  }
  return out;
}

// ---- 3. stale path
export function checkStalePath(mems, repo, memDir, home = os.homedir()) {
  const out = [];
  for (const m of mems) m.lines.forEach((l, i) => {
    for (const t of l.matchAll(/`([^`\n]+)`/g)) {
      const tok = t[1].trim().replace(/[#:]\d+(-\d+)?$/, "").replace(/[.,;)]+$/, "");
      if (/[<*{(\s]/.test(tok) || /:\/\//.test(tok) || tok.startsWith("-") || tok.includes("..")) continue;
      const pathy = (tok.includes("/") && /\.\w{1,5}$/.test(tok)) || /^(tools\/|\.agents\/|src\/|~\/)/.test(tok);
      if (!pathy) continue;
      const cands = tok.startsWith("~/") ? [path.join(home, tok.slice(2))] : path.isAbsolute(tok) || /^[A-Za-z]:[\\/]/.test(tok) ? [tok] : [path.resolve(repo, tok), path.resolve(memDir, tok)];
      if (!cands.some((c) => fs.existsSync(c))) out.push(finding("stale-path", "stale", m.file, i + 1, l, `path \`${tok}\` not found; fix or drop (brain)`, {}, t.index));
    }
  });
  return out;
}

// ---- 4. duplicate pairs
export function checkDuplicates(mems) {
  const out = [], ws = mems.map((m) => words(m.description + " " + bodyText(m))), ds = mems.map((m) => words(m.description + " " + m.file.replace(/\.md$/, "").replace(/-/g, " ")));
  for (let i = 0; i < mems.length; i++) for (let j = i + 1; j < mems.length; j++) {
    const a = mems[i], b = mems[j], s = jaccard(ws[i], ws[j]);
    const link = (x, y) => new RegExp(`\\[\\[${escRe(y.file.replace(/\.md$/, ""))}\\]\\]`).test(bodyText(x));
    const linked = (link(a, b) || link(b, a)) && overlapMin(ds[i], ds[j]) >= 0.5;
    if (s >= 0.35 || linked) out.push(finding("duplicate", "duplicate", a.file, a.descLine, `${a.file}: ${a.description} || ${b.file}: ${b.description}`, "merge into one (brain)", { other: b.file, score: Number(s.toFixed(2)) }));
  }
  return out;
}

// ---- 5. restates a rule
export function checkRestatesRule(mems, rules) {
  const out = [], rl = [];
  for (const r of rules) r.text.split(/\r?\n/).forEach((l, i) => { if (l.trim().split(/\s+/).length >= 8) rl.push({ r, i, l, w: words(l) }); });
  for (const m of mems) m.lines.forEach((l, i) => {
    if (i < m.bodyStart || l.trim().split(/\s+/).length < 8) return;
    const w = words(l);
    for (const x of rl) if (jaccard(w, x.w) >= 0.6) {
      out.push(finding("restates-rule", "duplicate", m.file, i + 1, `${l.trim()} || ${x.r.name}:${x.i + 1}: ${x.l.trim()}`, "drop or narrow the memory; the rule already loads (brain)", { ruleFile: x.r.name, ruleLine: x.i + 1 }));
      break;
    }
  });
  return out;
}

// ---- 6. conditional caveat
export function checkCaveats(mems, repo) {
  const out = [];
  for (const m of mems) m.lines.forEach((l, i) => {
    const um = l.match(/\buntil\b.*\b(updated|lands|merged|fixed|ships)\b/i);
    if (!um || /\b(?:isn't|is not|not) (?:done|finished|complete) until\b/i.test(l)) return; // generic definition-of-done, not a pending condition
    const hit = (l.match(/[\w./-]+\.(?:md|mjs|json|js|ts)\b/g) || []).find((p) => fs.existsSync(path.resolve(repo, p)));
    out.push(finding("conditional-caveat", "review", m.file, i + 1, l, `condition may be met; verify${hit ? ` ${hit}` : ""} and drop the caveat (brain)`, {}, um.index));
  });
  return out;
}

// ---- 7. filename drift
export function checkFilenameDrift(mems) {
  const out = [];
  for (const m of mems) {
    const toks = new Set(m.file.replace(/\.md$/, "").toLowerCase().split("-"));
    m.lines.forEach((l, i) => {
      for (const w of l.matchAll(/\bwas\s+([A-Za-z0-9]+)/gi)) {
        if (!toks.has(w[1].toLowerCase())) continue;
        const before = l.slice(0, w.index);
        const open = (before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length;
        if (open || l.slice(w.index + w[0].length).startsWith(")")) { out.push(finding("filename-drift", "drift", m.file, i + 1, l, "rename file to match content (brain; update MEMORY.md link)", {}, w.index)); break; }
      }
    });
  }
  return out;
}

// ---- 8. retired but routed
const COMMON = new Set(["this", "that", "it", "work", "which", "they", "these", "those", "one", "was", "has", "had", "not", "also", "then", "plan", "idea", "code"]);
export function checkRetiredRouted(mems, repo, rules) {
  const out = [], re = /\b(\w+)\s+(?:(?:is|was)\s+)?(cancelled|canceled|retired|dropped|deprecated)\b/i;
  for (const m of mems) m.lines.forEach((l, i) => {
    for (const h of l.matchAll(new RegExp(re.source, "gi"))) {
      const word = h[1].toLowerCase();
      if (word.length < 3 || COMMON.has(word) || (l.slice(0, h.index).match(/"/g) || []).length % 2) continue;
      const ev = [];
      if (fs.existsSync(path.join(repo, ".agents", "rules", word + ".md"))) ev.push(`.agents/rules/${word}.md exists`);
      for (const r of rules) {
        const rls = r.text.split(/\r?\n/);
        const ix = rls.findIndex((x) => /^\s*\|/.test(x) && new RegExp(`\\b${escRe(word)}\\b`, "i").test(x.split("|")[1] || ""));
        if (ix >= 0) ev.push(`${r.name}:${ix + 1}: ${rls[ix].trim()}`);
      }
      if (ev.length) { out.push(finding("retired-but-routed", "review", m.file, i + 1, `${l.trim()} || ${ev.join(" || ")}`, "memory and routing disagree; brain decides which is stale", {}, h.index)); break; }
    }
  });
  return out;
}

// ---- 9. sizes
export function dirBytes(d) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      try { n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size; } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return n;
}
export function collectSizes(repoSlug, extra = [], home = os.homedir()) {
  const root = path.join(home, ".claude", "projects"), items = [];
  try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && (e.name === repoSlug || e.name.startsWith(repoSlug + "--"))) items.push({ dir: path.join(root, e.name), bytes: dirBytes(path.join(root, e.name)) }); } catch { /* none */ }
  const claude = { total: items.reduce((a, x) => a + x.bytes, 0), dirs: items.length };
  return { severity: "size", claude, items, extra: extra.map((d) => ({ dir: d, bytes: dirBytes(d) })) };
}

// ---- orchestration
export function audit({ memory, repo, rules, store = [], home = os.homedir() }) {
  const mems = loadMemories(memory), idxFile = path.join(memory, "MEMORY.md");
  const indexText = fs.existsSync(idxFile) ? fs.readFileSync(idxFile, "utf8") : "";
  const ruleFiles = rules.filter((f) => fs.existsSync(f)).map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, "utf8") }));
  const findings = [
    ...checkIndex(memory, mems, indexText), ...checkStaleBranch(mems, localBranches(repo)), ...checkStalePath(mems, repo, memory, home),
    ...checkDuplicates(mems), ...checkRestatesRule(mems, ruleFiles), ...checkCaveats(mems, repo), ...checkFilenameDrift(mems), ...checkRetiredRouted(mems, repo, ruleFiles),
  ];
  const sizes = collectSizes(slugOf(repo), store, home);
  sizes.indexTokens = Math.round(indexText.length / 4);
  return { findings, sizes, mems };
}

const stamp = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, "0")}`; };
export function applyFixes(memory, mems, findings, now = new Date()) {
  const todo = findings.filter((f) => f.fixable);
  if (!todo.length) return [];
  const bdir = path.join(memory, ".hygiene-backup"), base = path.join(bdir, stamp(now));
  fs.mkdirSync(bdir, { recursive: true });
  let dest = base;
  for (let n = 1; ; n++) {
    try { fs.mkdirSync(dest); break; } catch (e) { if (e.code !== "EEXIST") throw e; dest = `${base}-${n}`; }
  }
  for (const f of fs.readdirSync(memory)) {
    try { if (f.endsWith(".md") && fs.statSync(path.join(memory, f)).isFile()) fs.copyFileSync(path.join(memory, f), path.join(dest, f)); } catch (e) { console.error(`warning: not backed up ${f}: ${e.code || e.message}`); }
  }
  const idx = path.join(memory, "MEMORY.md");
  let cur = fs.existsSync(idx) ? fs.readFileSync(idx, "utf8") : "";
  const eol = cur.includes("\r\n") ? "\r\n" : "\n";
  if (cur && !cur.endsWith("\n")) cur += eol;
  const fixes = [];
  for (const f of todo) {
    const m = mems.find((x) => x.file === f.file), d = m.description.slice(0, 80).trim();
    cur += `- [${m.name || m.file.replace(/\.md$/, "")}](${encodeLink(m.file)})${d ? ` — ${d}` : ""}${eol}`;
    fixes.push({ action: "append-index-line", file: m.file });
  }
  const tmp = path.join(memory, `.MEMORY.md.${process.pid}.tmp`);
  fs.writeFileSync(tmp, cur); fs.renameSync(tmp, idx);
  fs.appendFileSync(path.join(bdir, "hygiene.log"), fixes.map((x) => `${now.toISOString()} ${x.action} ${x.file}\n`).join(""));
  return fixes;
}

export function renderIndex(mems, indexTokens, date = new Date().toISOString().slice(0, 10)) {
  const types = ["user", "feedback", "project", "reference"], names = new Set(mems.map((m) => m.file.replace(/\.md$/, "")));
  const groups = [...types, "untyped"].map((t) => [t, mems.filter((m) => (types.includes(m.type) ? m.type : "untyped") === t)]).filter(([, g]) => g.length);
  const out = [`memory index ${date}: ${mems.length} memories (${groups.map(([t, g]) => `${g.length} ${t}`).join(", ") || "none"}) · ~${indexTokens} tokens (chars/4) for MEMORY.md`, ""];
  for (const [t, g] of groups) {
    out.push(`## ${t}`);
    for (const m of g) {
      const links = [...new Set([...bodyText(m).matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]))].map((x) => `[[${x}]]${names.has(x) ? "" : "?"}`);
      out.push(`- ${m.name || m.file.replace(/\.md$/, "")} (${m.file}, modified ${m.modified || "unknown"}) — ${clip(m.description, 100)}${links.length ? ` · links: ${links.join(", ")}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

const mb = (n) => (n / 1048576).toFixed(1) + " MB";
export function renderReport(findings, fixes, sizes) {
  const c = {}; for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
  const parts = ORDER.filter((k) => c[k]).map((k) => `${c[k]} ${k}`);
  const out = [`memory hygiene: ${findings.length} findings (${parts.join(", ") || "none"}) · ${fixes.length} safe fixes applied`, "", "Proposals are for a brain to decide; only the missing-index-line fix is automated (`--fix`).", ""];
  for (const f of findings) out.push(`- **${f.check}** [${f.severity}] ${f.file}:${f.line}${f.score != null ? ` (score ${f.score})` : ""}`, `  - evidence: ${f.evidence}`, `  - proposal: ${f.proposal}`);
  if (fixes.length) out.push("", "## Fixes applied", ...fixes.map((x) => `- ${x.action} ${x.file}`));
  out.push("", "## Sizes (informational)", `- Claude Code project dirs: ${sizes.claude.dirs} dirs, ${mb(sizes.claude.total)} (${sizes.claude.total} bytes)`);
  for (const x of sizes.extra) out.push(`- ${x.dir}: ${mb(x.bytes)} (${x.bytes} bytes)`);
  return out.join("\n") + "\n";
}

function parseArgs(argv) {
  const o = { fix: false, json: false }, val = ["memory", "repo", "rules", "store", "out", "index-out"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fix") o.fix = true; else if (a === "--json") o.json = true;
    else if (a.startsWith("--") && val.includes(a.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith("--")) o[a.slice(2)] = argv[++i];
    else return { error: `invalid argument: ${a}` };
  }
  return o;
}

const USAGE = "usage: memoryHygiene.mjs --memory <dir> [--repo <path>] [--rules <f>[,<f>]] [--store <dir>[,<dir>]] [--fix] [--json] [--out <file.md>] [--index-out <file>]";
export function main(argv) {
  try { return run(argv); } catch (e) { console.error(`memory hygiene: internal error: ${e && e.stack ? e.stack : e}`); return 1; }
}
function run(argv) {
  const o = parseArgs(argv);
  if (o.error) { console.error(o.error + "\n" + USAGE); return 2; }
  const repo = path.resolve(o.repo || process.cwd());
  const memory = path.resolve(o.memory || path.join(os.homedir(), ".claude", "projects", slugOf(repo), "memory"));
  if (!fs.existsSync(memory)) { console.log(`memory hygiene: no memory dir at ${memory}; nothing to audit`); return 0; }
  if (!fs.statSync(memory).isDirectory()) { console.error(`--memory is not a directory: ${memory}`); return 2; }
  // validate every output path before any write
  for (const k of ["out", "index-out"]) {
    if (!o[k]) continue;
    const p = path.resolve(o[k]);
    if (insideDir(memory, p)) { console.error(`--${k} must be outside the memory dir: ${p}`); return 2; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) { console.error(`--${k} is a directory: ${p}`); return 2; }
  }
  const rules = (o.rules ? o.rules.split(",") : ["CLAUDE.md", "AGENTS.md"].map((f) => path.join(repo, f))).map((f) => path.resolve(f));
  const store = o.store ? o.store.split(",").map((d) => path.resolve(d)) : [];
  const { findings, sizes, mems } = audit({ memory, repo, rules, store });
  const fixes = o.fix ? applyFixes(memory, mems, findings) : [];
  if (o["index-out"]) {
    const io = path.resolve(o["index-out"]);
    fs.mkdirSync(path.dirname(io), { recursive: true }); fs.writeFileSync(io, renderIndex(mems, sizes.indexTokens));
  }
  const clean = findings.map(({ fixable, ...f }) => f);
  const text = o.json ? JSON.stringify({ findings: clean, fixes, sizes }, null, 2) + "\n" : renderReport(clean, fixes, sizes);
  if (o.out) { const p = path.resolve(o.out); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main(process.argv.slice(2));
