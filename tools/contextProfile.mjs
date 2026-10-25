#!/usr/bin/env node
// Context profile: measures this project's own context numbers from its Claude Code transcripts, so context-watch
// can size its nudges per project instead of using fixed numbers.
// Usage: node contextProfile.mjs [--project <dir>] [--days 14] [--window 200000] [--json] [--summary] [--quiet]
// Writes ~/.claude/hooks/state/context-profile/<slug>.json (read by hooks/context-watch.cjs) and, when the project has
// .agents/, a human report at .agents/reports/context-profile.md. Never prints transcript content.
// Re-run daily by context-watch's SessionStart hook (detached, never blocks the session).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flag = (n) => argv.includes("--" + n);
const days = Number(arg("days", 14)) || 14;

// Worktrees share one profile: resolve the main checkout from git's common dir.
function mainRoot(dir) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", timeout: 3000, windowsHide: true });
  const common = r.status === 0 ? String(r.stdout).trim() : "";
  return common && path.basename(common) === ".git" ? path.dirname(common) : dir;
}
const project = mainRoot(path.resolve(arg("project", process.cwd())));
const slug = project.replace(/[^A-Za-z0-9]/g, "-");
const home = os.homedir();
const projectsRoot = path.join(home, ".claude", "projects");
const PROFILE_DIR = path.join(home, ".claude", "hooks", "state", "context-profile");
const profilePath = path.join(PROFILE_DIR, slug + ".json");

// Thresholds policy (kit CHANGELOG, "context profile").
const COST_HARD = 60000;   // cost ceiling: past +60k of growth every turn resends too much (kit v1.1.0)
const COST_SOFT = 30000;
const SAFE = 0.8;          // stay under 80% of the window: auto-compact and quality loss sit above it
const MIN_HARD = 20000, MIN_SOFT = 10000;
const CONTEXT_CAP = 2500; // CONTEXT.md tokens: context-compressor's ~1,500-word ceiling

const safeDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const k = (n) => (n > 0 && n < 1000 ? "<1k" : Math.round(n / 1000) + "k");
const tok = (chars) => Math.round(chars / 4); // rough chars-to-tokens, labelled "est." in the report

function isPrompt(e) {
  if (e.type !== "user" || e.isSidechain || e.isMeta) return false;
  const c = e.message && e.message.content;
  if (typeof c === "string") return !c.startsWith("<command-") && !c.startsWith("<local-command");
  return Array.isArray(c) && !c.some((p) => p && p.type === "tool_result");
}

// One pass per transcript: main-chain context sizes, per-prompt growth, start-up hook injections, compacts, model.
function readSession(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const sizes = [], promptSizes = [];
  let pending = false, startChars = 0, compacts = 0, model = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "system" && e.subtype === "compact_boundary") compacts++;
    if (e.type === "attachment" && e.attachment && e.attachment.hookEvent === "SessionStart" && !sizes.length) {
      startChars += String(e.attachment.content || "").length;
    }
    if (isPrompt(e)) pending = true;
    if (e.type === "assistant" && !e.isSidechain && e.message && e.message.usage) {
      const u = e.message.usage;
      const n = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      if (n <= 0) continue;
      sizes.push(n);
      if (e.message.model && !e.message.model.startsWith("<")) model = e.message.model;
      if (pending) { promptSizes.push(n); pending = false; }
    }
  }
  if (sizes.length < 2) return null;
  const turnGrowth = [];
  for (let i = 1; i < promptSizes.length; i++) if (promptSizes[i] > promptSizes[i - 1]) turnGrowth.push(promptSizes[i] - promptSizes[i - 1]);
  return { baseline: Math.min(...sizes), peak: Math.max(...sizes), turns: promptSizes.length, turnGrowth, startChars, compacts, model };
}

const cutoff = Date.now() - days * 864e5;
const sessions = [];
for (const d of safeDir(projectsRoot).filter((d) => d === slug || d.startsWith(slug + "--claude-worktrees-"))) {
  for (const f of safeDir(path.join(projectsRoot, d)).filter((f) => f.endsWith(".jsonl"))) {
    const p = path.join(projectsRoot, d, f);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.mtimeMs < cutoff) continue;
    const s = readSession(p);
    if (s) sessions.push(s);
  }
}

const fileChars = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
// Always-loaded instruction files (what Claude Code puts in every session's prompt).
const loaded = [
  ["Global CLAUDE.md", path.join(home, ".claude", "CLAUDE.md")],
  ["CLAUDE.md", path.join(project, "CLAUDE.md")],
  ["AGENTS.md (via @AGENTS.md)", fs.existsSync(path.join(project, "CLAUDE.md")) && /@AGENTS\.md/.test(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8")) ? path.join(project, "AGENTS.md") : ""],
  ["Memory index", path.join(projectsRoot, slug, "memory", "MEMORY.md")],
].filter(([, p]) => p).map(([name, p]) => ({ name, tokens: tok(fileChars(p)) })).filter((x) => x.tokens);
const onDemand = [["CONTEXT.md", "CONTEXT.md"], ["Backlog", ".agents/BACKLOG.md"], ["STATE.md", ".agents/STATE.md"]]
  .map(([name, rel]) => ({ name, tokens: tok(fileChars(path.join(project, rel))) })).filter((x) => x.tokens);

// Project size: tracked files and bytes (code never enters the baseline; shown so growth can be compared to it).
let files = 0, bytes = 0;
const ls = spawnSync("git", ["ls-files", "-z"], { cwd: project, encoding: "utf8", timeout: 5000, maxBuffer: 64 << 20, windowsHide: true });
if (ls.status === 0) for (const f of String(ls.stdout).split("\0")) if (f) { files++; bytes += fileChars(path.join(project, f)); }

const recent = sessions.filter((s) => s.turns >= 2);
const baseline = Math.round(pct(recent.map((s) => s.baseline), 0.5));
const heavyTurn = Math.round(pct(recent.flatMap((s) => s.turnGrowth), 0.9));
const models = recent.map((s) => s.model).filter(Boolean);
const window = Number(arg("window", 0)) || Number(process.env.CC_WATCH_WINDOW) || (models.some((m) => /\[1m\]|-1m\b/i.test(m)) ? 1000000 : 200000);
const safeLimit = Math.round(window * SAFE);
// Hard must fire with room left for one more heavy turn below the safe limit; soft one heavy turn before hard.
const hard = baseline ? Math.max(MIN_HARD, Math.min(COST_HARD, safeLimit - baseline - heavyTurn)) : COST_HARD;
const soft = Math.max(MIN_SOFT, Math.min(COST_SOFT, hard - heavyTurn));
const cap = safeLimit - heavyTurn; // absolute total that forces the hard nudge, whatever the growth
const startInjection = Math.round(pct(recent.map((s) => tok(s.startChars)), 0.5));
const loadedSum = loaded.reduce((a, x) => a + x.tokens, 0);

let prev = {};
try { prev = JSON.parse(fs.readFileSync(profilePath, "utf8")); } catch {}
const today = new Date().toISOString().slice(0, 10);
const history = (prev.history || []).filter((h) => h.date !== today);
if (recent.length) history.push({ date: today, baseline, heavyTurn, sessions: recent.length });
while (history.length > 90) history.shift();

const profile = {
  version: 1, date: today, project, days, sessions: recent.length, window, safeLimit,
  baseline, baselineRange: [pct(recent.map((s) => s.baseline), 0.1), pct(recent.map((s) => s.baseline), 0.9)],
  heavyTurn, peakP90: Math.round(pct(recent.map((s) => s.peak), 0.9)), compacts: recent.reduce((a, s) => a + s.compacts, 0),
  thresholds: { soft, hard, cap },
  baselineParts: { loadedFiles: loaded, startHooks: startInjection, systemAndTools: Math.max(0, baseline - loadedSum - startInjection) },
  onDemand, projectSize: { files, bytes },
  history,
};

try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); fs.writeFileSync(profilePath, JSON.stringify(profile, null, 1)); } catch {}

const first = history.find((h) => h.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)) || history[0];
const trend = first && first.date !== today ? `${k(first.baseline)} on ${first.date} → ${k(baseline)} today` : "first measurement";
const summary = recent.length
  ? `context-profile: baseline ~${k(baseline)} of ${k(window)} window, heavy turn ~${k(heavyTurn)}; nudges at +${k(soft)}/+${k(hard)}, forced at ${k(cap)} total (${recent.length} sessions, ${days}d)`
  : `context-profile: no Claude Code sessions in the last ${days} days; context-watch keeps its defaults`;

if (fs.existsSync(path.join(project, ".agents"))) {
  const row = (name, t) => `| ${name} | ~${k(t)} |`;
  const md = [
    "# Context profile", "",
    `Generated ${today} by \`node ~/.agents/tools/contextProfile.mjs\` (kit; re-runs daily at session start). Measured from ${recent.length} Claude Code sessions in the last ${days} days. Never edit by hand.`, "",
    "## What a fresh chat costs", "",
    "| Measure | Value |", "| :--- | :--- |",
    `| Starting context (baseline, median) | ~${k(baseline)} (10-90%: ${k(profile.baselineRange[0])}-${k(profile.baselineRange[1])}) |`,
    `| Context window / safe limit (${SAFE * 100}%) | ${k(window)} / ${k(safeLimit)} |`,
    `| Headroom after baseline | ~${k(safeLimit - baseline)} |`,
    `| Heavy turn (p90 growth per prompt) | ~${k(heavyTurn)} |`,
    `| Peak context (p90 per session) | ~${k(profile.peakP90)} |`,
    `| Auto-compacts | ${profile.compacts} |`,
    `| Baseline trend | ${trend} |`, "",
    "## Nudges this profile sets (context-watch)", "",
    `- Soft (offer a checkpoint): +${k(soft)} growth over the session's own start.`,
    `- Hard (checkpoint / fresh chat): +${k(hard)} growth, repeated every +30k.`,
    `- Forced hard at ${k(cap)} total, whatever the growth (one heavy turn below the safe limit).`,
    `- Rule: hard = min(${k(COST_HARD)} cost ceiling, safe limit − baseline − heavy turn); soft = min(${k(COST_SOFT)}, hard − heavy turn). Env CC_WATCH_SOFT / CC_WATCH_HARD override.`, "",
    "## What the baseline is made of (est. chars/4)", "",
    "| Part | Tokens |", "| :--- | :--- |",
    ...loaded.map((x) => row(x.name, x.tokens)),
    row("Start-up hook injections (brief, CONTEXT.md pointer)", startInjection),
    row("System prompt, tool schemas, skill list (remainder)", profile.baselineParts.systemAndTools), "",
    "Project code never enters the baseline; it costs tokens only when a session reads it.",
    `Project size: ${files} tracked files, ${(bytes / 1048576).toFixed(1)} MB. Read on demand: ${onDemand.map((x) => `${x.name} ~${k(x.tokens)}`).join(", ") || "none"}.`, "",
    "## Rules of thumb", "",
    `- A task whose reading won't fit in ~${k(hard)} of growth: split it or send the reading to subagents before starting (their reads don't count against the main chat).`,
    `- Baseline above ~${k(window * 0.4)} (40% of the window): trim always-loaded files, plugins or MCP servers.`,
    ...onDemand.filter((x) => x.name === "CONTEXT.md" && x.tokens > CONTEXT_CAP).map((x) => `- ⚠ CONTEXT.md is ~${k(x.tokens)}, over the ~${k(CONTEXT_CAP)} cap: move settled reasoning into decision notes (context-compressor).`),
    "",
  ].join("\n");
  try { fs.mkdirSync(path.join(project, ".agents", "reports"), { recursive: true }); fs.writeFileSync(path.join(project, ".agents", "reports", "context-profile.md"), md); } catch {}
}

if (flag("json")) console.log(JSON.stringify(profile, null, 1));
else if (!flag("quiet")) console.log(summary);
