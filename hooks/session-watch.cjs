// session-watch: Claude Code session hygiene. Context size itself is left to Claude Code's native auto-compact
// (FAS-118 retired the growth nudges, context profile and context-compressor skill; the STATE.md baton carries handoff).
//
// SessionStart (startup): refreshes the daily token report (tools/tokenReport.mjs) and the weekly token-hygiene
//   audit (tools/contextHygiene.mjs), and shows their one-line summaries to the user.
//
// Stale session (UserPromptSubmit, once per session): the chat started more than CC_WATCH_MAX_AGE_H hours ago
//   (default 24). A clear would keep the old worktree, branch and loaded skills, so at the next task boundary the
//   agent opens a NEW session (desktop start_session, brief "continue") instead of clearing; without that tool it
//   asks the user for a new chat.

const fs = require("fs");
const path = require("path");
const os = require("os");

const VERSION = (() => { try { return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim(); } catch { return "dev"; } })();
const STATE_DIR = path.join(os.homedir(), ".claude", "hooks", "state");

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function loadState(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, id + ".json"), "utf8"));
  } catch {
    return {};
  }
}

function saveState(id, s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, id + ".json"), JSON.stringify(s));
  } catch {}
}

// First timestamp in the transcript = when this session started (ms), or 0.
function sessionStart(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString("utf8", 0, n).match(/"timestamp":"([^"]+)"/);
    return m ? Date.parse(m[1]) || 0 : 0;
  } catch {
    return 0;
  }
}

// Why this session is stale, or "" if it isn't. Age only: a "rules changed since start" check can't tell this
// chat's own commits from other agents', so it fired falsely in sessions that edit rules (removed 2026-10-26).
function staleReason(startMs) {
  if (!startMs) return "";
  const maxH = Number(process.env.CC_WATCH_MAX_AGE_H) || 24;
  const ageH = (Date.now() - startMs) / 36e5;
  return ageH >= maxH ? `this chat started ${Math.floor(ageH)}h ago` : "";
}

const NEW_SESSION =
  `New session instead of clear: if you have the start_session tool (load it via ToolSearch if deferred), save first (baton, plus a decision note or backlog item for anything git lacks), ` +
  `then start one fresh session in this project with initiation "user_asked" (the user's standing ask), context "fresh", a worktree, and the brief "continue" plus one line on what is next; ` +
  `end the reply with "Opened a fresh session with the latest skills and rules; this one can be archived." Without that tool, tell the user to open a new chat in this folder and type continue (not /clear). `;

// Worktrees share the main checkout's hygiene state.
function mainRoot(cwd) {
  const r = require("child_process").spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, timeout: 3000, encoding: "utf8", windowsHide: true });
  const common = r.status === 0 ? String(r.stdout || "").trim() : "";
  return common && path.basename(common) === ".git" ? path.dirname(common) : path.resolve(cwd);
}

const input = readStdin();
const event = input.hook_event_name;

// Daily token report (startup only): runs the kit tokenReport tool when the
// project report is missing or was last written on an earlier day. Any failure is silent.
function dailyReport(cwd) {
  try {
    const report = path.join(cwd, ".agents", "reports", "token-report.md");
    let stale = true;
    try { stale = new Date(fs.statSync(report).mtimeMs).toDateString() !== new Date().toDateString(); } catch {}
    if (!stale) return null;
    const slug = path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-");
    if (!fs.existsSync(path.join(os.homedir(), ".claude", "projects", slug))) return null;
    const tool = path.join(__dirname, "..", "tools", "tokenReport.mjs");
    const r = require("child_process").spawnSync(process.execPath, [tool, "--project", cwd, "--summary"], {
      timeout: 6000, encoding: "utf8", windowsHide: true,
    });
    const line = r.status === 0 ? String(r.stdout || "").trim().split(String.fromCharCode(10)).pop() : "";
    return line || null;
  } catch {
    return null;
  }
}

// Weekly token-hygiene audit (startup only): first run in a project, then every 7 days. Synchronous (short), silent on failure.
function weeklyHygiene(cwd) {
  try {
    const root = mainRoot(cwd);
    const st = path.join(os.homedir(), ".claude", "hooks", "state", "context-hygiene", root.replace(/[^A-Za-z0-9]/g, "-") + ".json");
    let due = true;
    try { const d = JSON.parse(fs.readFileSync(st, "utf8")).date; due = !(Date.now() - Date.parse(d) < 7 * 864e5); } catch {}
    if (!due) return null;
    const tool = path.join(__dirname, "..", "tools", "contextHygiene.mjs");
    const r = require("child_process").spawnSync(process.execPath, [tool, "--project", root, "--quiet"], { timeout: 6000, encoding: "utf8", windowsHide: true });
    const line = r.status === 0 ? String(r.stdout || "").trim().split(String.fromCharCode(10)).pop() : "";
    return line || null;
  } catch {
    return null;
  }
}

if (event === "SessionStart") {
  const cwd = input.cwd || process.cwd();
  const result = {};
  if (input.source === "startup") {
    const line = dailyReport(cwd);
    const hyg = weeklyHygiene(cwd);
    const msg = [line, hyg].filter(Boolean).join(" · ");
    if (msg) result.systemMessage = msg;
  }
  out(result);
}

if (event !== "UserPromptSubmit" || !input.transcript_path || !input.session_id) out({});

const state = loadState(input.session_id);
const stale = state.stale || staleReason(sessionStart(input.transcript_path));

if (stale && !state.staleNoted) {
  saveState(input.session_id, { ...state, stale, staleNoted: true });
  out({
    systemMessage: `session-watch: stale session (${stale}). A fresh session will be opened at the next task boundary.`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[session-watch v${VERSION}] Stale session: ${stale}. A fresh session loads newer skills and rules and gets a worktree from current main; a clear would keep this old one. ` +
        `Answer the user's message normally first. If this reply finishes a task, or the user starts a new topic, do this at its end; otherwise do it at the first later reply that does. ` +
        NEW_SESSION +
        `Never mid-step, with unsaved work, or with a question to the user still open.`,
    },
  });
}

out({});
