// session-watch: Claude Code session hygiene. Context size itself is left to Claude Code's native auto-compact
// (FAS-118 retired the growth nudges, context profile and context-compressor skill; the STATE.md baton carries handoff).
//
// SessionStart (startup): refreshes the daily token report (tools/tokenReport.mjs) and the weekly token-hygiene
//   audit (tools/contextHygiene.mjs), and shows their one-line summaries to the user.
//
// Runs only at SessionStart (rules/topics/overhead.md); the per-prompt stale-session notice was removed (WKF-176).

const fs = require("fs");
const path = require("path");
const os = require("os");


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

out({});
