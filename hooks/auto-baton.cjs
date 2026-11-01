// auto-baton: safety net for sessions that end without writing a handoff baton.
//
// SessionStart (startup|clear): records a baseline per session (HEAD, dirty files,
//   newest STATE.md log entry) in ~/.claude/hooks/state/.
// SessionEnd: if the session changed files or made commits but the newest
//   STATE.md log entry is unchanged (no `agentBrief.mjs log`), upserts an `auto`
//   entry for this session into <project>/.agents/auto-baton.json (gitignored).
//   The project's brief shows those entries; once a baton is written, this
//   session's entry is removed again.
//
// Only acts in projects that have a baton file (.agents/STATE.md, or stateFile in
// .agents/baton.config.json). No LLM call, no transcript reads, never records
// prompt text. Every failure is swallowed: never fatal.
// Part of the EXPERIMENTAL task-board feature (tools/baton.mjs); registered by
// sync.mjs only after `node sync.mjs --enable task-board`.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const STATE_DIR = path.join(os.homedir(), ".claude", "hooks", "state");
const MAX_FILES = 15;
const PRUNE_MS = 7 * 24 * 3600 * 1000;

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** STATE.md path: stateFile from .agents/baton.config.json, else .agents/STATE.md. */
function stateFile(root) {
  const cfg = readJson(path.join(root, ".agents", "baton.config.json"), {});
  return path.join(root, typeof cfg.stateFile === "string" ? cfg.stateFile : path.join(".agents", "STATE.md"));
}

/** Newest log entry of a STATE.md, or "" (the baton signal). */
function topLogEntry(root) {
  try {
    const text = fs.readFileSync(stateFile(root), "utf8");
    const m = text.match(/<!-- log:start -->\r?\n([^\r\n]*)/);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function snapshot(cwd, projectDir) {
  return {
    head: git(cwd, ["rev-parse", "HEAD"]),
    dirty: git(cwd, ["status", "--porcelain"]).split("\n").filter(Boolean),
    // A worktree session writes the baton into its own STATE.md, a main-checkout session into the project's.
    batons: [topLogEntry(cwd), topLogEntry(projectDir)],
  };
}

function prune() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.startsWith("baton-")) continue;
      const p = path.join(STATE_DIR, f);
      if (now - fs.statSync(p).mtimeMs > PRUNE_MS) fs.unlinkSync(p);
    }
  } catch {}
}

function main() {
  const input = readStdin();
  const event = input.hook_event_name || "";
  const sessionId = String(input.session_id || "").replace(/[^\w-]/g, "");
  const cwd = input.cwd || process.cwd();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  if (!sessionId) return;
  if (!fs.existsSync(stateFile(projectDir))) return;

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const baseFile = path.join(STATE_DIR, `baton-${sessionId}.json`);

  if (event === "SessionStart") {
    // compact/resume continue the same session: keep the original baseline.
    if (input.source === "compact" || input.source === "resume") {
      if (fs.existsSync(baseFile)) return;
    }
    fs.writeFileSync(baseFile, JSON.stringify(snapshot(cwd, projectDir)));
    prune();
    return;
  }

  const base = readJson(baseFile, null);
  if (!base) return; // no baseline (kit installed mid-session): stay silent
  const now = snapshot(cwd, projectDir);

  const batonWritten = now.batons.some((b, i) => b && b !== base.batons[i]);
  const baseDirty = new Set(base.dirty);
  const newDirty = now.dirty.filter((l) => !baseDirty.has(l) && !l.endsWith(".agents/auto-baton.json"));
  const committed = Boolean(now.head && base.head && now.head !== base.head);
  const changed = committed || newDirty.length > 0;

  const autoFile = path.join(projectDir, ".agents", "auto-baton.json");
  const data = readJson(autoFile, { sessions: {} });
  if (!data.sessions || typeof data.sessions !== "object") data.sessions = {};
  const had = Boolean(data.sessions[sessionId]);

  if (batonWritten || !changed) {
    delete data.sessions[sessionId];
  } else {
    const files = new Set(newDirty.map((l) => l.slice(3).trim()));
    if (committed) {
      for (const f of git(cwd, ["diff", "--name-only", `${base.head}..${now.head}`]).split("\n")) if (f) files.add(f);
    }
    const list = [...files];
    data.sessions[sessionId] = {
      date: new Date().toISOString().slice(0, 10),
      ended: event === "SessionEnd",
      branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown",
      cwd: cwd.replace(/\\/g, "/"),
      commits: committed ? Number(git(cwd, ["rev-list", "--count", `${base.head}..${now.head}`])) || 0 : 0,
      lastCommit: committed ? git(cwd, ["log", "-1", "--format=%h %s"]).slice(0, 120) : "",
      files: list.slice(0, MAX_FILES),
      moreFiles: Math.max(0, list.length - MAX_FILES),
    };
  }

  const empty = Object.keys(data.sessions).length === 0;
  if (empty && had) fs.rmSync(autoFile, { force: true });
  else if (!empty) fs.writeFileSync(autoFile, JSON.stringify(data, null, 2) + "\n");
  if (event === "SessionEnd") fs.rmSync(baseFile, { force: true });
}

try {
  main();
} catch {}
process.exit(0);
