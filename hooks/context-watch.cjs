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
// SessionStart (startup): refreshes the weekly token report (tools/tokenReport.mjs)
//   and shows its one-line summary to the user.
//
// Thresholds (tokens of growth) can be overridden with env vars
// CC_WATCH_SOFT and CC_WATCH_HARD.

const fs = require("fs");
const path = require("path");
const os = require("os");

const SOFT = Number(process.env.CC_WATCH_SOFT) || 40000;
const HARD = Number(process.env.CC_WATCH_HARD) || 80000;
const REPEAT = 40000; // after hard, remind again every this many extra tokens
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

const k = (n) => Math.round(n / 1000) + "k";

const input = readStdin();
const event = input.hook_event_name;

// Weekly token report (startup only): runs the kit tokenReport tool when the
// project report is missing or older than 7 days. Any failure is silent.
function weeklyReport(cwd) {
  try {
    const report = path.join(cwd, ".agents", "reports", "token-report.md");
    let stale = true;
    try { stale = Date.now() - fs.statSync(report).mtimeMs > 7 * 86400000; } catch {}
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

if (event === "SessionStart") {
  const cwd = input.cwd || process.cwd();
  const result = {};
  const ctx = path.join(cwd, "CONTEXT.md");
  if (fs.existsSync(ctx)) {
    let header = "";
    try {
      header = fs.readFileSync(ctx, "utf8").split(String.fromCharCode(10)).slice(0, 2).join(" ").trim();
    } catch {}
    result.hookSpecificOutput = {
      hookEventName: "SessionStart",
      additionalContext:
        `A context checkpoint exists at CONTEXT.md (${header}). ` +
        `If the user's request continues that work (e.g. "continue", "resume"), read it first and start from its Next step. ` +
        `If the request is unrelated, ignore it.`,
    };
  }
  if (input.source === "startup") {
    const line = weeklyReport(cwd);
    if (line) result.systemMessage = line;
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

// Context shrank (e.g. after /compact): reset so warnings can fire again later.
if (growth < SOFT) {
  if (state.level !== 0) saveState(input.session_id, { level: 0, lastHardAt: 0 });
  out({});
}

const stats = `context ~${k(current)} tokens, +${k(growth)} grown in this chat`;

if (growth >= HARD && (state.level < 2 || growth - state.lastHardAt >= REPEAT)) {
  saveState(input.session_id, { level: 2, lastHardAt: growth });
  out({
    systemMessage: `context-watch: ${stats}. Checkpoint recommended.`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[context-watch] This conversation is large (${stats}); every turn now resends all of it. ` +
        `Answer the user's message normally first. Then, at the end of the same reply, use the context-compressor skill: ` +
        `write or update CONTEXT.md in the project root, and tell the user in 2-3 lines to run /clear or start a new session in this folder ` +
        `(the new chat is pointed at CONTEXT.md automatically). Include the short paste-ready resume prompt from the skill. ` +
        `Exception: if you are mid-way through a delicate step whose recent output still matters, finish that step and checkpoint at the next natural break.`,
    },
  });
}

if (growth >= SOFT && state.level < 1) {
  saveState(input.session_id, { level: 1, lastHardAt: 0 });
  out({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[context-watch] Conversation is getting long (${stats}). ` +
        `Answer normally. If this reply finishes a task or milestone, or the topic is changing, add one line offering a checkpoint ` +
        `("say 'checkpoint' and I'll save CONTEXT.md so you can start fresh"). Otherwise say nothing about it.`,
    },
  });
}

out({});
