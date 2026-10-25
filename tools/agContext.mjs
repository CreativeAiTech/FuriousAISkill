#!/usr/bin/env node
// Antigravity context meter: measures this project's own context numbers from its Antigravity (Gemini) chats, then reports
// how far the newest chat has grown, so the agent can checkpoint on measured numbers instead of a turn count.
// Usage: node agContext.mjs [--project <dir>] [--days 14] [--refresh] [--json]   (hidden test flags: --chat <uuid>, --dir <conversations dir>)
// Writes ~/.agents/state/context-profile/antigravity-<slug>.json (daily cache; Claude-side twin is contextProfile.mjs).
// Reads temp copies of the chat DBs, never the live file. Never prints chat content. Any failure → one fallback line, exit 0.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { agDir as defaultDir, openCopy, readMain, chatCalls } from "./lib/agStore.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flag = (n) => argv.includes("--" + n);
const days = Number(arg("days", 14)) || 14;
const WINDOW = 256000;

// Same thresholds policy as contextProfile.mjs.
const COST_HARD = 60000, COST_SOFT = 30000, SAFE = 0.8, MIN_HARD = 20000, MIN_SOFT = 10000;
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const k = (n) => Math.round(n / 1000);

function mainRoot(dir) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", timeout: 3000, windowsHide: true });
  const common = r.status === 0 ? String(r.stdout).trim() : "";
  return common && path.basename(common) === ".git" ? path.dirname(common) : dir;
}
const normPath = (p) => path.resolve(p).split(path.sep).join("/").replace(/\/+$/, "").toLowerCase();

function fail(reason) {
  console.log(`ctx: Antigravity store unreadable (${String(reason).replace(/\s+/g, " ").slice(0, 60)}); use the turn ceiling (AGENTS.md Rule 2)`);
  process.exit(0);
}

try {
  const project = mainRoot(path.resolve(arg("project", process.cwd())));
  const want = normPath(project);
  const slug = project.replace(/[^A-Za-z0-9]/g, "-");
  const dir = arg("dir", defaultDir);
  const profilePath = path.join(os.homedir(), ".agents", "state", "context-profile", "antigravity-" + slug + ".json");
  const today = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(dir)) fail("no conversations dir");

  // Main chats of this project (worktrees included), newest first.
  const chats = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".db"))) {
    const fp = path.join(dir, f);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    chats.push({ id: f.slice(0, -3), fp, mtime: st.mtimeMs });
  }
  chats.sort((a, b) => b.mtime - a.mtime);
  const load = async (c) => {
    let h;
    try { h = await openCopy(c.fp); } catch { return null; } // locked or vanished file: skip it, don't fail the run
    try {
      const m = readMain(h.db);
      if (m.isSub) return null;
      const ws = normPath(fileURLToPath(m.uri));
      if (ws !== want && !ws.startsWith(want + "/")) return null;
      return { ...c, calls: chatCalls(h.db) };
    } catch { return null; } finally { h.close(); }
  };

  let profile = null;
  try { profile = JSON.parse(fs.readFileSync(profilePath, "utf8")); } catch {}
  const needProfile = flag("refresh") || !profile || profile.date !== today;
  const cutoff = Date.now() - days * 864e5;
  let live = null;
  const forced = arg("chat", "");
  const used = [];
  for (const c of chats) {
    const wantLive = !live && (forced ? c.id === forced : true);
    const wantProf = needProfile && c.mtime >= cutoff;
    if (!wantLive && !wantProf) continue;
    const r = await load(c);
    if (!r) continue;
    if (wantLive && r.calls.length) live = r;
    if (wantProf) used.push(r);
    if (!needProfile && live) break;
  }
  if (!live) fail("no matching chat");

  if (needProfile) {
    const ok = used.filter((c) => c.calls.length);
    const baseline = Math.round(pct(ok.map((c) => c.calls[0].prompt), 0.5));
    const growth = [];
    for (const c of ok) {
      const firsts = [];
      let last = -1;
      for (const x of c.calls) if (x.turn !== last) { firsts.push(x.prompt); last = x.turn; }
      for (let i = 1; i < firsts.length; i++) if (firsts[i] > firsts[i - 1]) growth.push(firsts[i] - firsts[i - 1]);
    }
    const heavyTurn = Math.round(pct(growth, 0.9));
    const safeLimit = Math.round(WINDOW * SAFE);
    const hard = baseline ? Math.max(MIN_HARD, Math.min(COST_HARD, safeLimit - baseline - heavyTurn)) : COST_HARD;
    const soft = Math.max(MIN_SOFT, Math.min(COST_SOFT, hard - heavyTurn));
    const cap = safeLimit - heavyTurn;
    profile = { version: 1, date: today, project, days, chats: ok.length, window: WINDOW, safeLimit, baseline, heavyTurn, thresholds: { soft, hard, cap } };
    try { fs.mkdirSync(path.dirname(profilePath), { recursive: true }); fs.writeFileSync(profilePath, JSON.stringify(profile, null, 1)); } catch {}
  }

  const { hard, soft, cap } = profile.thresholds;
  const now = live.calls[live.calls.length - 1].prompt, start = live.calls[0].prompt, growth = now - start;
  const status = growth >= hard || now >= cap ? "checkpoint" : "ok";
  if (flag("json")) console.log(JSON.stringify({ now, start, growth, window: profile.window, hard, soft, cap, status, chat: live.id }));
  else console.log(`ctx: ${k(now)}k of ${k(profile.window)}k; growth +${k(growth)}k vs budget +${k(hard)}k → ${status}`);
} catch (e) {
  fail(e && e.message || "error");
}
