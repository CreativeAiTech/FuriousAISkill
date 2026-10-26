// context-watch: measures how much a Claude Code conversation has grown and
// nudges Claude to checkpoint (context-compressor skill) before it gets costly.
//
// UserPromptSubmit: reads token usage from the transcript. Growth = current
//   context minus the session's smallest context (the fixed baseline of system
//   prompt + tools). Soft level: offer a checkpoint at a natural break.
//   Hard level: write CONTEXT.md after answering and tell the user to start fresh.
// SessionStart (startup|clear|compact): if CONTEXT.md exists in the project,
//   tell Claude it's there so a fresh chat can resume from it.
//
// SessionStart (startup): refreshes the daily token report (tools/tokenReport.mjs)
//   and shows its one-line summary to the user.
//
// SessionStart (startup): refreshes the project's context profile (tools/contextProfile.mjs) once a day, detached.
//
// Thresholds come from that profile (the project's measured baseline, heavy-turn size and window): soft/hard growth,
// plus a forced hard nudge once the total nears the window whatever the growth, and a one-time note when a session
// starts well above the project's usual baseline. No profile yet: 30k/60k growth (v1.1.0 defaults).
// Env vars CC_WATCH_SOFT and CC_WATCH_HARD override the growth thresholds.
//
// Stale session (UserPromptSubmit, once per session): the chat started more than CC_WATCH_MAX_AGE_H hours ago
//   (default 12), or the kit (~/.agents) or the project's rules/skills got a commit after it started. A clear would
//   keep the old worktree, branch and loaded skills, so at the next task boundary the agent opens a NEW session
//   (desktop start_session, brief "continue") instead of clearing; without that tool it asks the user for a new chat.

const fs = require("fs");
const path = require("path");
const os = require("os");

const VERSION = (() => { try { return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim(); } catch { return "dev"; } })();
// v1.1.0: 40k/80k/40k -> 30k/60k/30k. One heavy turn adds 30-45k, so the old soft note landed a turn late (CHANGELOG.md).
const DEFAULT_SOFT = 30000;
const DEFAULT_HARD = 60000;
const REPEAT = 30000; // after hard, remind again every this many extra tokens
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

function contextSizes(transcriptPath) {
  const sizes = [];
  let text;
  try {
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return sizes;
  }
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type !== "assistant" || e.isSidechain) continue;
      const u = e.message && e.message.usage;
      if (!u) continue;
      const n =
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0);
      if (n > 0) sizes.push(n);
    } catch {}
  }
  return sizes;
}

function loadState(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, id + ".json"), "utf8"));
  } catch {
    return { level: 0, lastHardAt: 0 };
  }
}

function saveState(id, s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, id + ".json"), JSON.stringify(s));
  } catch {}
}

// Is the chat's work already safe in git? Clean tree and nothing unpushed means a
// checkpoint would only duplicate history, so the hook asks for a plain "open a fresh chat" line instead.
function gitSaved(cwd) {
  const run = (args) => {
    const r = require("child_process").spawnSync("git", args, { cwd, timeout: 3000, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? String(r.stdout || "").trim() : null;
  };
  const status = run(["status", "--porcelain"]);
  if (status === null) return null; // not a repo or git failed: unknown
  // No upstream (worktree branches push HEAD:master): compare with the remote default branch instead.
  const ahead = run(["rev-list", "--count", "@{u}..HEAD"]) ?? run(["rev-list", "--count", "origin/HEAD..HEAD"]) ?? run(["rev-list", "--count", "origin/master..HEAD"]);
  return status === "" && (ahead === null || ahead === "0");
}

const k = (n) => Math.round(n / 1000) + "k";

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

// Why this session is stale, or "" if it isn't. Age first (cheap), then newer commits to the kit or project rules.
function staleReason(cwd, startMs) {
  if (!startMs) return "";
  const maxH = Number(process.env.CC_WATCH_MAX_AGE_H) || 12;
  const ageH = (Date.now() - startMs) / 36e5;
  if (ageH >= maxH) return `this chat started ${Math.floor(ageH)}h ago`;
  const lastCommit = (dir, paths) => {
    const r = require("child_process").spawnSync("git", ["log", "-1", "--format=%ct", "--all", "--", ...paths], { cwd: dir, timeout: 3000, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? Number(String(r.stdout).trim()) * 1000 || 0 : 0;
  };
  if (lastCommit(path.join(os.homedir(), ".agents"), ["rules", "skills", "hooks", "agents"]) > startMs) return "the FuriousAI kit (skills/rules/hooks) changed after this chat started";
  if (lastCommit(cwd, ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".agents/rules", ".agents/skills", ".claude"]) > startMs) return "this project's rules or skills changed after this chat started";
  return "";
}

const NEW_SESSION =
  `New session instead of clear: if you have the start_session tool (load it via ToolSearch if deferred), save first (baton; CONTEXT.md only for what git lacks), ` +
  `then start one fresh session in this project with initiation "user_asked" (the user's standing ask), context "fresh", a worktree, and the brief "continue" plus one line on what is next; ` +
  `end the reply with "Opened a fresh session with the latest skills and rules; this one can be archived." Without that tool, tell the user to open a new chat in this folder and type continue (not /clear). `;

// Worktrees share the main checkout's profile (same slug rule as tools/contextProfile.mjs).
function mainRoot(cwd) {
  const r = require("child_process").spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, timeout: 3000, encoding: "utf8", windowsHide: true });
  const common = r.status === 0 ? String(r.stdout || "").trim() : "";
  return common && path.basename(common) === ".git" ? path.dirname(common) : path.resolve(cwd);
}
const profileFile = (root) => path.join(os.homedir(), ".claude", "hooks", "state", "context-profile", root.replace(/[^A-Za-z0-9]/g, "-") + ".json");
function loadProfile(root) {
  try { return JSON.parse(fs.readFileSync(profileFile(root), "utf8")); } catch { return null; }
}

// Daily profile refresh (startup only): detached so it never delays the session; this session uses the previous profile.
function refreshProfile(cwd) {
  try {
    const root = mainRoot(cwd);
    const p = loadProfile(root);
    if (p && p.date === new Date().toISOString().slice(0, 10)) return;
    const tool = path.join(__dirname, "..", "tools", "contextProfile.mjs");
    require("child_process").spawn(process.execPath, [tool, "--project", root, "--quiet"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
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
  const ctx = path.join(cwd, "CONTEXT.md");
  if (fs.existsSync(ctx)) {
    let header = "";
    try {
      header = fs.readFileSync(ctx, "utf8").split(String.fromCharCode(10)).slice(0, 2).join(" ").trim();
      if (header.length > 200) header = header.slice(0, 199) + "…";
    } catch {}
    // A live baton (.agents/STATE.md) is updated every session; CONTEXT.md only at checkpoints, so the baton wins on "what next".
    const hasBaton = fs.existsSync(path.join(cwd, ".agents", "STATE.md"));
    result.hookSpecificOutput = {
      hookEventName: "SessionStart",
      additionalContext: hasBaton
        ? `A context checkpoint exists at CONTEXT.md (${header}). It holds background and reasoning only. ` +
          `For "continue"/"resume", the next task is .agents/STATE.md Current Focus (the brief), never CONTEXT.md's Next step, which may be stale. ` +
          `Read CONTEXT.md only when you need the why behind a decision.`
        : `A context checkpoint exists at CONTEXT.md (${header}). ` +
          `If the user's request continues that work (e.g. "continue", "resume"), read it first and start from its Next step. ` +
          `If the request is unrelated, ignore it.`,
    };
  }
  if (input.source === "startup") {
    refreshProfile(cwd);
    const line = dailyReport(cwd);
    const hyg = weeklyHygiene(cwd);
    const msg = [line, hyg].filter(Boolean).join(" · ");
    if (msg) result.systemMessage = msg;
  }
  out(result);
}

if (event !== "UserPromptSubmit" || !input.transcript_path || !input.session_id) out({});

const sizes = contextSizes(input.transcript_path);
if (sizes.length < 2) out({});
const current = sizes[sizes.length - 1];
const baseline = Math.min(...sizes);
const growth = current - baseline;

const state = loadState(input.session_id);
const cwdNow = input.cwd || process.cwd();
const stale = state.stale || staleReason(cwdNow, sessionStart(input.transcript_path));
const profile = loadProfile(mainRoot(cwdNow));
const t = (profile && profile.thresholds) || {};
const SOFT = Number(process.env.CC_WATCH_SOFT) || t.soft || DEFAULT_SOFT;
const HARD = Number(process.env.CC_WATCH_HARD) || t.hard || DEFAULT_HARD;
const CAP = t.cap || 0; // total context that forces the hard nudge, whatever the growth
const forced = CAP > 0 && current >= CAP;

// Baseline creep: this session started well above the project's usual start (new plugin, MCP server, big rules file).
let creepNote = "";
if (profile && profile.baseline && !state.creep && baseline > profile.baseline * 1.15 && baseline - profile.baseline > 10000) {
  state.creep = true;
  saveState(input.session_id, state);
  creepNote = `context-watch: this chat started at ~${k(baseline)}, above this project's usual ~${k(profile.baseline)}. See .agents/reports/context-profile.md for what the start is made of.`;
}

if (stale && !state.staleNoted) {
  state.stale = stale;
  state.staleNoted = true;
  saveState(input.session_id, state);
  out({
    systemMessage: `context-watch: stale session (${stale}). A fresh session will be opened at the next task boundary.`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[context-watch v${VERSION}] Stale session: ${stale}. A fresh session loads newer skills and rules and gets a worktree from current master; a clear would keep this old one. ` +
        `Answer the user's message normally first. If this reply finishes a task, or the user starts a new topic, do this at its end; otherwise do it at the first later reply that does. ` +
        NEW_SESSION +
        `Never mid-step, with unsaved work, or with a question to the user still open.`,
    },
  });
}

// Context shrank (e.g. after /compact): reset so warnings can fire again later.
if (growth < SOFT && !forced) {
  if (state.level !== 0) saveState(input.session_id, { ...state, level: 0, lastHardAt: 0 });
  out(creepNote ? { systemMessage: creepNote } : {});
}

const stats = `context ~${k(current)} tokens, +${k(growth)} grown in this chat` + (forced ? `, near this project's safe limit (${k(CAP)})` : "");
const saved = gitSaved(cwdNow);
const freshLine = `"This task is finished and saved in git. This chat is now ~${k(current)} tokens, so continuing here costs more on every turn; please open a fresh chat for the next task."`;
const savedNote =
  `Git shows everything committed and pushed. Do NOT write CONTEXT.md, a baton entry or a checkpoint that would only repeat git history. ` +
  `Only if this chat produced something not yet in a commit, decision note, backlog item or the baton (a decision, a finding, an open question), save just that piece. `;

if ((growth >= HARD || forced) && (state.level < 2 || growth - state.lastHardAt >= REPEAT)) {
  saveState(input.session_id, { ...state, level: 2, lastHardAt: growth });
  out({
    systemMessage: `context-watch: ${stats}. ${saved ? "Work is in git: open a fresh chat." : "Checkpoint recommended."}` + (creepNote ? " " + creepNote : ""),
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[context-watch v${VERSION}] This conversation is large (${stats}); every turn now resends all of it. ` +
        `Answer the user's message normally first. ` +
        (saved
          ? savedNote + `Then end the reply with this line (and nothing more about checkpoints): ${freshLine} `
          : `Then, at the end of the same reply, use the context-compressor skill: ` +
        `write or update CONTEXT.md in the project root (the next chat is pointed at it automatically). `) +
        (stale
          ? `This session is also stale (${stale}). ` + NEW_SESSION
          : `Auto-clear: if you have the clear_session tool (load it via ToolSearch if deferred), call it with session_id "self" as the last call of the reply, ` +
            `without asking, and say "type continue here to resume" instead of asking for a fresh chat; without that tool, tell the user to run /clear or open a new chat in this folder. `) +
        `Exception: if you are mid-way through a delicate step whose recent output still matters, or a question to the user is still open, finish that first and checkpoint at the next natural break.`,
    },
  });
}

if (growth >= SOFT && state.level < 1) {
  saveState(input.session_id, { ...state, level: 1, lastHardAt: 0 });
  out({
    ...(creepNote ? { systemMessage: creepNote } : {}),
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[context-watch v${VERSION}] Conversation is getting long (${stats}). ` +
        `Answer normally. If this reply finishes a task or milestone, or the topic is changing, end it with one line: ` +
        `${saved === false
          ? `offer a checkpoint ("say 'checkpoint' and I'll save CONTEXT.md so you can start fresh"), saving only what git does not already hold`
          : `if git then shows everything committed and pushed, skip the checkpoint and say ${freshLine}; otherwise offer a checkpoint of only what git does not hold`}. ` +
        `If not, make that offer at the first later reply that does; don't drop it.`,
    },
  });
}

out(creepNote ? { systemMessage: creepNote } : {});
