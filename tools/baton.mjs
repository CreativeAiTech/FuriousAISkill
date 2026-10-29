#!/usr/bin/env node
/**
 * baton: file-based task board + handoff baton for several AI tools on one repo (EXPERIMENTAL).
 *
 * No daemon, no database: two committed markdown files are the shared memory, and git push is the only lock.
 *   <project>/.agents/STATE.md     the baton: Current Focus, Needs User Decision, handoff log
 *   <project>/.agents/BACKLOG.md   the queue: tickets with status boxes [ ] [~] [!] [x], `needs:`, `target:`, `from:`
 *   <project>/.agents/baton.config.json   optional settings (written by `init`; see DEFAULTS below)
 *
 *   node ~/.agents/tools/baton.mjs init [--project <name>] [--push push-master|commit-only|none]   Write templates (never overwrites)
 *   node ~/.agents/tools/baton.mjs [--agent <name>] [--model <id>] [--effort <effort>] [--hook]   Print the session brief (--hook: never fails)
 *       --model: reported main-session model id. With "modelGate": true the brief reports action scope and authority
 *       evidence; every session starts as manager and ready tickets remain visible (tools/modelTier.mjs).
 *   node ~/.agents/tools/baton.mjs log --agent <name> --done "<what>" [--next "<what>"]   Append a baton line, renew your leases
 *   node ~/.agents/tools/baton.mjs focus --task "<t>" --owner <agent> --status <s> [--next] [--files] [--verify] [--force]
 *   node ~/.agents/tools/baton.mjs focus --clear
 *   node ~/.agents/tools/baton.mjs claim <ID> --agent <name> [--days N] [--force] [--no-push]   Lease a ticket ([~])
 *   node ~/.agents/tools/baton.mjs release <ID> [--no-push]                                     Back to open ([ ])
 *   node ~/.agents/tools/baton.mjs block <ID> --reason "<r>" [--no-push]                        Blocked ([!])
 *   node ~/.agents/tools/baton.mjs done <ID> [--commit <sha>] [--no-push]                       Done ([x]), moved under ## Done
 *   Every command takes --root <dir> (default: nearest folder above cwd with .agents/STATE.md or .agents/baton.config.json).
 *
 * Library use (a project wrapper adds its own brief sections):
 *   import { main } from "<home>/.agents/tools/baton.mjs";
 *   main(process.argv.slice(2), { root, sections: { afterGit: (ctx) => [...lines], beforeProtocol: (ctx) => [...lines] } });
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordModel, readQuota, fallbackWarning, valueAdvisory } from "./modelTier.mjs";

export const DEFAULTS = {
  project: "",
  stateFile: ".agents/STATE.md",
  backlogFile: ".agents/BACKLOG.md",
  leaseDays: 2,
  push: "commit-only", // "push-master" (commit + push HEAD:<branch>) | "commit-only" | "none" (just edit the file)
  remote: "origin",
  branch: "master",
  ticketId: "[A-Z]+-\\d+",
  // Backlog tag → the --agent names that work it. Unlisted names map to themselves.
  agents: { claude: ["claude", "claude-code"], gemini: ["gemini", "antigravity"] },
  humanTags: ["user"], // tickets any agent may claim on the human's behalf
  maxLogEntries: 15,
  command: "node ~/.agents/tools/baton.mjs", // how the brief tells agents to call this tool
  modelGate: false, // legacy option: include model/authority scope advisory (never a session-start tool block)
};
const AUTO_BATON = ".agents/auto-baton.json"; // written by the kit's auto-baton hook
const CONFIG_FILE = ".agents/baton.config.json";
const VALID_STATUSES = ["idle", "in-progress", "blocked", "needs-review", "done"];

/**
 * Registers the merge driver (batonMerge.mjs next to this file) so parallel branches merge STATE.md / BACKLOG.md
 * per log entry and per ticket instead of conflicting. Only when unset, so a project's own registration wins.
 */
function ensureMergeDriver(ctx) {
  if (git(ctx, ["config", "--get", "merge.baton.driver"])) return;
  const driver = path.join(path.dirname(fileURLToPath(import.meta.url)), "batonMerge.mjs").replace(/\\/g, "/");
  git(ctx, ["config", "merge.baton.name", "task-board files (STATE.md, BACKLOG.md) semantic merge"]);
  git(ctx, ["config", "merge.baton.driver", `node "${driver}" %O %A %B %P`]);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE)) || fs.existsSync(path.join(dir, ".agents", "STATE.md"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: start, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return path.resolve(start);
  }
}

function loadConfig(root) {
  let user = {};
  const file = path.join(root, CONFIG_FILE);
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...user, agents: { ...DEFAULTS.agents, ...(user.agents || {}) } };
  if (!["push-master", "commit-only", "none"].includes(cfg.push)) throw new Error(`${CONFIG_FILE}: push must be push-master, commit-only or none`);
  return cfg;
}

/** Everything the commands need, built once per run. */
function makeContext(root, cfg) {
  const idSrc = cfg.ticketId;
  return {
    root,
    cfg,
    stateFile: path.join(root, cfg.stateFile),
    backlogFile: path.join(root, cfg.backlogFile),
    autoFile: path.join(root, AUTO_BATON),
    stateRel: cfg.stateFile.replace(/\\/g, "/"),
    backlogRel: cfg.backlogFile.replace(/\\/g, "/"),
    upstream: `${cfg.remote}/${cfg.branch}`,
    idSrc,
    idExact: new RegExp(`^${idSrc}$`),
    idBold: new RegExp(`\\*\\*(${idSrc})\\*\\*`),
    idInText: new RegExp(`\\b(${idSrc})\\b`),
    cmd: cfg.command,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);
const cleanInline = (value) => String(value).replace(/\s+/g, " ").trim();
const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n") : "");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function git(ctx, args) {
  try {
    return execFileSync("git", args, { cwd: ctx.root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function run(ctx, args) {
  return execFileSync("git", args, { cwd: ctx.root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Writes a file keeping its existing line endings (readText normalizes to LF). */
function writeKeepEol(file, text) {
  const crlf = fs.existsSync(file) && fs.readFileSync(file, "utf-8").includes("\r\n");
  fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text, "utf-8");
}

/** Returns the body of a `## <title>` section (up to the next `## `). */
function section(markdown, title) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (start === -1) return "";
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function parseTickets(ctx, backlogText) {
  const head = new RegExp(`^- \\[[ x~!]\\] \\*\\*${ctx.idSrc}\\*\\*`);
  const strip = new RegExp(`^- \\[.\\] \\*\\*${ctx.idSrc}\\*\\*\\s*(\\(was [^)]*\\))?`);
  return backlogText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => head.test(l))
    .map((line) => ({
      line,
      box: line[3], // " " open · "~" claimed · "!" blocked · "x" done
      open: line[3] !== "x",
      id: line.match(ctx.idBold)[1],
      claimedBy: line.match(/`claimed: (\S+) until (\d{4}-\d{2}-\d{2})`/),
      blockedReason: line.match(/`blocked: ([^`]*)`/)?.[1] ?? "",
      text: line
        .replace(strip, "")
        .replace(/`(?:@[^`]*|needs: [^`]*|target: [^`]*|from: [^`]*|urgent|claimed: [^`]*|blocked: [^`]*)`/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      tag: line.match(/`@([\w-]+)`/)?.[1] ?? "",
      needs: (line.match(/`needs: ([^`]*)`/)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean),
      target: parseFloat(line.match(/`target: ([\d.]+)`/)?.[1] ?? "99"),
      urgent: line.includes("`urgent`"),
    }));
}

/** `--agent claude-code` → the backlog tag it works (`claude`), via config `agents`. */
function agentTag(ctx, agent) {
  if (!agent || agent === true) return "";
  const a = String(agent).toLowerCase();
  for (const [tag, names] of Object.entries(ctx.cfg.agents)) {
    if (a === tag.toLowerCase() || (names || []).some((n) => a === String(n).toLowerCase())) return tag;
  }
  return a;
}

function focusFields(stateText) {
  const body = section(stateText, "Current Focus");
  const get = (label) => body.match(new RegExp(`^- \\*\\*${label}\\*\\*:\\s*(.*)$`, "m"))?.[1].replace(/<!--.*?-->/g, "").trim() ?? "";
  return { task: get("Task"), owner: get("Owner").split(" — ")[0].trim(), status: get("Status").split(/\s/)[0] };
}

function logEntries(stateText) {
  const match = stateText.match(/<!-- log:start -->\n([\s\S]*?)<!-- log:end -->/);
  if (!match) return [];
  return match[1].split("\n").filter((l) => l.trim().startsWith("- "));
}

function autoBatonEntries(ctx) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(ctx.autoFile, "utf-8"));
  } catch {
    return [];
  }
  return Object.values(data?.sessions || {}).map((s) => {
    const files = (s.files || []).join(", ") + (s.moreFiles ? ` +${s.moreFiles} more` : "");
    const commits = s.commits ? ` · ${s.commits} commit(s), last: ${s.lastCommit}` : "";
    const state = s.ended ? "ended" : "may still be open";
    return `- ${s.date} · auto · \`${s.branch}\` (${state})${commits} · changed: ${files || "—"}`;
  });
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------
function buildBrief(ctx, agent = "", sections = {}, model = "", fromHook = false, effort = "") {
  const out = [];
  const me = agentTag(ctx, agent);
  // Model scope advisory (opt-in): role is universal; authority is action-specific. Claude Code's hook input has no
  // model; there hooks/model-check.mjs reads it from the transcript at the first tool call instead.
  const gate = Boolean(ctx.cfg.modelGate);
  if (typeof model !== "string") model = "";
  if (gate && model) recordModel(ctx.root, me || "unknown-tool", model, "--model flag", effort);
  out.push(gate ? fallbackWarning(model, ctx.root, effort) : "MANAGER MODE: own the bounded objective; choose economical available delegation, verify evidence, and gate only actions requiring qualification or authorization.", "");
  const advisory = valueAdvisory(model, effort);
  if (advisory) out.push(advisory, "");
  const stateText = readText(ctx.stateFile);
  const backlogText = readText(ctx.backlogFile);
  const hook = (name) => {
    const extra = typeof sections[name] === "function" ? sections[name]({ ...ctx, agent: me, stateText, backlogText }) : null;
    if (Array.isArray(extra) && extra.length) out.push(...extra, "");
  };

  out.push(`# ${ctx.cfg.project || path.basename(ctx.root)} Session Brief (${today()})`, "");
  const seenFallback = gate ? readQuota(ctx.root).filter((r) => r.tier === "fallback") : [];
  if (seenFallback.length) {
    out.push(`- Reported configurations without benchmark authority: ${seenFallback.map((r) => `${r.tool} (${r.model}, ${r.seen})`).join(", ")} (.agents/QUOTA.md; not measured quota or a manager restriction)`, "");
  }

  const branch = git(ctx, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const dirty = git(ctx, ["status", "--porcelain"]).split("\n").filter(Boolean);
  const commits = git(ctx, ["log", "--oneline", "-5"]).split("\n").filter(Boolean);
  out.push(`## Git`);
  out.push(`- Branch: \`${branch}\` · Uncommitted files: ${dirty.length}`);
  for (const line of dirty.slice(0, 12)) out.push(`  - \`${line.trim()}\``);
  if (dirty.length > 12) out.push(`  - …and ${dirty.length - 12} more`);
  out.push(`- Recent commits:`);
  for (const c of commits) out.push(`  - ${c}`);
  out.push("");
  hook("afterGit");

  if (stateText) {
    out.push(`## Current Focus (from ${ctx.stateRel})`);
    out.push(section(stateText, "Current Focus") || "_empty_");
    const focus = focusFields(stateText);
    const active = ["in-progress", "blocked", "needs-review"].includes(focus.status);
    if (me && active && focus.owner && agentTag(ctx, focus.owner) !== me) {
      out.push(
        focus.status === "needs-review"
          ? `- **Review?** ${focus.owner} finished this and asks for review. Review it only if reviewing is your role; otherwise take your next ticket.`
          : `- **Not yours**: this focus belongs to ${focus.owner}. "Continue" here = your next ticket under Backlog, not this one. Take it over only if the user says so.`
      );
    }
    out.push("");
    const needsUser = section(stateText, "Needs User Decision");
    if (needsUser && needsUser !== "-" && !/^-?\s*_?none/i.test(needsUser)) out.push(`## Needs User Decision`, needsUser, "");
    const log = logEntries(stateText);
    if (log.length) {
      out.push(`## Last Handoffs (3 newest, full log in ${ctx.stateRel})`);
      out.push(...log.slice(0, 3).map((e) => (e.length > 320 ? e.slice(0, 317) + "…" : e)), "");
    }
    const auto = autoBatonEntries(ctx);
    if (auto.length) out.push("## Sessions without a baton (auto; your next `log` clears these)", ...auto, "");
  } else {
    out.push(`> ${ctx.stateRel} missing. Run \`${ctx.cmd} init\`.`, "");
  }

  if (backlogText) {
    const tickets = parseTickets(ctx, backlogText);
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const doneIds = new Set(tickets.filter((t) => !t.open).map((t) => t.id));
    const open = tickets.filter((t) => t.open);
    const pickOrder = (x, y) => Number(y.urgent) - Number(x.urgent) || x.target - y.target;
    const ready = open.filter((t) => t.box === " " && t.needs.every((n) => doneIds.has(n))).sort(pickOrder);
    const clip = (t) => (t.urgent ? "URGENT " : "") + (t.line.length > 180 ? t.line.slice(0, 177) + "…" : t.line);
    const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    const inProgress = open.filter((t) => t.box === "~");
    const blocked = open.filter((t) => t.box === "!");
    const waitingCount = open.filter((t) => t.box === " ").length - ready.length;
    out.push(`## Backlog: ${open.length} open, ${ready.length} ready, ${waitingCount} waiting on needs (pick order: urgent, Current Focus, lowest target)`);
    const allIds = new Set(tickets.map((t) => t.id));
    const warned = new Set();
    for (const t of tickets) {
      for (const n of t.needs) {
        if (ctx.idExact.test(n) && !allIds.has(n) && !warned.has(n)) {
          warned.add(n);
          out.push(`- ⚠️ unknown needs: ${n} (in ${t.id})`);
        }
      }
    }
    if (inProgress.length) {
      out.push("", "## In progress (claimed)");
      for (const t of inProgress) {
        const who = t.claimedBy ? `${t.claimedBy[1]} until ${t.claimedBy[2]}` : "unclaimed";
        const stale = t.claimedBy && t.claimedBy[2] < today();
        out.push(`- ${stale ? "STALE (lease expired) " : ""}${t.id} · ${who} · ${clipText(t.text, 100)}` + (stale ? ` → reclaim with \`claim ${t.id} --agent <you>\`` : ""));
      }
    }
    if (blocked.length) {
      out.push("", "## Blocked");
      for (const t of blocked) out.push(`- ${t.id} · ${t.blockedReason || "no reason"} · ${clipText(t.text, 100)}`);
    }
    if (inProgress.length || blocked.length) out.push("", "## Ready");
    if (!me) {
      for (const t of ready.slice(0, 8)) out.push(clip(t));
      out.push(`- _Tip: pass \`--agent <${Object.keys(ctx.cfg.agents).join("|")}>\` to see only your tickets and what blocks them._`);
    } else {
      // Visibility and ownership are independent of model authority; triage each action's risk.
      const mine = ready.filter((t) => t.tag === me);
      const urgentOthers = ready.filter((t) => t.urgent && t.tag !== me);
      out.push(`### Ready for you (@${me}), in pick order`);
      if (mine.length) for (const t of mine.slice(0, 6)) out.push(clip(t));
      else out.push(`- _Nothing ready for @${me}. Don't take another agent's ticket or guess its decision: tell the user what you wait on (below) and stop._`);
      for (const t of urgentOthers) out.push(`- URGENT for @${t.tag || "untagged"}: **${t.id}** (not yours; tell the user)`);
      const waiting = open.filter((t) => t.box === " " && t.tag === me && !t.needs.every((n) => doneIds.has(n))).sort(pickOrder);
      if (waiting.length) {
        out.push(`### Your tickets waiting on others`);
        for (const t of waiting.slice(0, 6)) {
          const freeText = t.needs.some((n) => !ctx.idExact.test(n));
          const blockers = freeText
            ? [`"${t.needs.join(", ")}" (no ticket yet: needs one)`]
            : t.needs.filter((n) => !doneIds.has(n)).map((n) => `${n} (${byId.get(n) ? "@" + byId.get(n).tag : "unknown ID"})`);
          out.push(`- **${t.id}** waits on ${blockers.join(", ")}`);
        }
        if (waiting.length > 6) out.push(`- …and ${waiting.length - 6} more`);
      }
      const othersReady = ready.filter((t) => t.tag !== me);
      const counts = {};
      for (const t of othersReady) counts[t.tag || "untagged"] = (counts[t.tag || "untagged"] || 0) + 1;
      if (othersReady.length) out.push(`- Ready for other agents (not yours): ${Object.entries(counts).map(([k, n]) => `@${k} ${n}`).join(", ")}`);
    }
    out.push("");
  }

  hook("beforeProtocol");
  out.push(`## Protocol (skill: task-board)`);
  out.push(`- Work on ONE ticket. Claim it: \`${ctx.cmd} claim <ID> --agent <you>\`, then \`${ctx.cmd} focus --task "<ID> …" --owner <you> --status in-progress\``);
  out.push(`- Before you stop: \`${ctx.cmd} log --agent <you> --done "…" --next "…"\` (renews your leases)`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Baton (STATE.md)
// ---------------------------------------------------------------------------
function appendLog(ctx, flags) {
  if (!flags.agent || flags.agent === true || !flags.done || flags.done === true) {
    console.error(`Usage: ${ctx.cmd} log --agent <name> --done "<what>" [--next "<what>"]`);
    process.exit(1);
  }
  const stateText = readText(ctx.stateFile);
  if (!stateText.includes("<!-- log:start -->")) {
    console.error(`${ctx.stateRel} is missing the <!-- log:start --> / <!-- log:end --> markers (run \`${ctx.cmd} init\`).`);
    process.exit(1);
  }
  const next = flags.next && flags.next !== true ? ` → next: ${cleanInline(flags.next)}` : "";
  const entry = `- ${today()} · ${cleanInline(flags.agent)} · ${cleanInline(flags.done)}${next}`;
  const entries = [entry, ...logEntries(stateText)].slice(0, ctx.cfg.maxLogEntries);
  writeKeepEol(ctx.stateFile, stateText.replace(/<!-- log:start -->\n[\s\S]*?<!-- log:end -->/, `<!-- log:start -->\n${entries.join("\n")}\n<!-- log:end -->`));
  fs.rmSync(ctx.autoFile, { force: true }); // a real baton supersedes the auto entries the brief showed
  console.log(`Logged: ${entry}`);

  // Renew this agent's live leases (local edit only; it travels with your next commit).
  const backlog = readText(ctx.backlogFile);
  if (!backlog) return;
  const me = cleanInline(flags.agent).toLowerCase();
  const until = addDays(today(), ctx.cfg.leaseDays);
  const leaseRe = new RegExp(`^\\s*- \\[~\\] \\*\\*(${ctx.idSrc})\\*\\*.*\`claimed: (\\S+) until \\d{4}-\\d{2}-\\d{2}\``);
  const renewed = [];
  const lines = backlog.split("\n").map((l) => {
    const m = l.match(leaseRe);
    if (!m || m[2].toLowerCase() !== me) return l;
    renewed.push(m[1]);
    return l.replace(/`claimed: (\S+) until \d{4}-\d{2}-\d{2}`/, `\`claimed: $1 until ${until}\``);
  });
  const updated = lines.join("\n");
  if (updated !== backlog) {
    writeKeepEol(ctx.backlogFile, updated);
    console.log(`Renewed lease: ${renewed.join(", ")} (until ${until})`);
  }
}

function setFocusField(text, label, value) {
  const re = new RegExp(`^- \\*\\*${label}\\*\\*:.*$`, "m");
  return re.test(text) ? text.replace(re, `- **${label}**: ${value}`) : text;
}

function updateFocus(ctx, flags) {
  let stateText = readText(ctx.stateFile);
  if (!stateText) {
    console.error(`${ctx.stateRel} not found (run \`${ctx.cmd} init\`).`);
    process.exit(1);
  }
  if (flags.clear) {
    flags = { task: "_none — follow the BACKLOG.md pick order (urgent, then lowest-target ready ticket)_", owner: "—", status: "idle", files: "—", next: "—", verify: "—" };
  }
  if (flags.status && !VALID_STATUSES.includes(flags.status)) {
    console.error(`--status must be one of: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }
  // Guard: catches an agent that skipped the brief. `--force` = the user said to take it anyway.
  const claimId = typeof flags.task === "string" ? flags.task.match(ctx.idInText)?.[1] : undefined;
  if (claimId && flags.status === "in-progress" && !flags.force) {
    const tickets = parseTickets(ctx, readText(ctx.backlogFile));
    const ticket = tickets.find((t) => t.id === claimId);
    const doneIds = new Set(tickets.filter((t) => !t.open).map((t) => t.id));
    const problems = [];
    const unmet = ticket ? ticket.needs.filter((n) => !doneIds.has(n)) : [];
    if (unmet.length) problems.push(`${claimId} needs ${unmet.map((n) => `${n} (@${tickets.find((t) => t.id === n)?.tag ?? "?"})`).join(", ")}, not Done yet`);
    const owner = agentTag(ctx, flags.owner);
    if (ticket && ticket.tag && owner && ticket.tag !== owner && !ctx.cfg.humanTags.includes(ticket.tag)) problems.push(`${claimId} is tagged @${ticket.tag}, not @${owner}`);
    if (problems.length) {
      console.error(`Refusing to set focus: ${problems.join("; ")}.`);
      console.error(`Pick your next ready ticket (\`${ctx.cmd} --agent <you>\`), or add --force only if the user told you to take it.`);
      process.exit(1);
    }
  }
  const fields = {
    Task: flags.task,
    Owner: flags.owner && flags.owner !== "—" && flags.owner !== true ? `${cleanInline(flags.owner)} — since ${today()}` : flags.owner,
    Status: flags.status ? `${flags.status}  <!-- ${VALID_STATUSES.join(" | ")} -->` : undefined,
    Branch: flags.branch || (flags.task ? git(ctx, ["rev-parse", "--abbrev-ref", "HEAD"]) : undefined),
    "Files in play": flags.files,
    "Next concrete step": flags.next,
    "Verify with": flags.verify,
  };
  for (const [label, value] of Object.entries(fields)) {
    if (value !== undefined && value !== true && value !== "") stateText = setFocusField(stateText, label, cleanInline(value));
  }
  writeKeepEol(ctx.stateFile, stateText);
  console.log(section(stateText, "Current Focus"));
}

// ---------------------------------------------------------------------------
// Ticket claims (BACKLOG.md)
// ---------------------------------------------------------------------------
const BOX_RE = /^(\s*- )\[[ x~!]\]/;
const FIELD_RE = / `(?:claimed|blocked): [^`]*`/g;

function findTicket(ctx, lines, id) {
  const re = new RegExp(`^\\s*- \\[[ x~!]\\] \\*\\*${escRe(id)}\\*\\*`, "i");
  return lines.findIndex((l) => re.test(l));
}

const setBox = (line, ch) => line.replace(BOX_RE, `$1[${ch}]`);

function insertField(ctx, line, field) {
  const tag = line.match(/`@[\w-]+`/);
  let pos;
  if (tag) pos = tag.index + tag[0].length;
  else {
    const idm = line.match(new RegExp(`\\*\\*${ctx.idSrc}\\*\\*(?: \\(was [^)]*\\))?`));
    pos = idm.index + idm[0].length;
  }
  return line.slice(0, pos) + ` \`${field}\`` + line.slice(pos);
}

function liveForeignClaim(line, me) {
  if (!line || !/^\s*- \[~\]/.test(line)) return null;
  const m = line.match(/`claimed: (\S+) until (\d{4}-\d{2}-\d{2})`/);
  if (!m || m[1].toLowerCase() === me.toLowerCase() || m[2] < today()) return null;
  return { agent: m[1], until: m[2] };
}

/** Commits only BACKLOG.md and (push-master) pushes HEAD:<branch>. Returns {rebased}. Never throws. */
function commitBacklog(ctx, message) {
  const result = { rebased: false };
  const { push, remote, branch } = ctx.cfg;
  if (push === "none") return result;
  try {
    run(ctx, ["add", "--", ctx.backlogRel]);
    run(ctx, ["commit", "-q", "-m", message, "--", ctx.backlogRel]);
  } catch (err) {
    console.warn(`Warning: backlog commit failed: ${String(err.stderr || err.message).trim()}`);
    return result;
  }
  if (push === "commit-only") {
    console.log(`Committed ${ctx.backlogRel} (push mode commit-only: push it yourself so other checkouts see the claim).`);
    return result;
  }
  // Push only the bookkeeping commit: other unpushed local commits may not be approved yet.
  let ahead = 1;
  try {
    ahead = Number(run(ctx, ["rev-list", "--count", `${ctx.upstream}..HEAD`]));
  } catch {
    /* no remote ref yet */
  }
  if (ahead > 1) {
    console.warn(`Warning: committed locally, not pushed: HEAD has ${ahead - 1} other unpushed commit(s). Push them first, or push manually.`);
    return result;
  }
  try {
    run(ctx, ["push", "-q", remote, `HEAD:${branch}`]);
    console.log(`Pushed to ${ctx.upstream}.`);
    return result;
  } catch {
    /* rejected: someone pushed first; rebase and retry once */
  }
  const dirty = run(ctx, ["status", "--porcelain"]).split("\n").filter((l) => l && !l.startsWith("??"));
  if (dirty.length) {
    console.warn("Warning: committed locally; push manually (working tree dirty, so no automatic rebase).");
    return result;
  }
  try {
    run(ctx, ["pull", "-q", "--rebase", remote, branch]);
    result.rebased = true;
    run(ctx, ["push", "-q", remote, `HEAD:${branch}`]);
    console.log(`Pushed to ${ctx.upstream} (after rebase).`);
  } catch (err) {
    try {
      run(ctx, ["rebase", "--abort"]);
    } catch {
      /* none in progress */
    }
    // A rebase conflict on BACKLOG.md almost always means another agent changed the same ticket line first.
    console.warn(`Warning: CONFLICT or push failure: this change did NOT reach ${ctx.upstream} (it is only a local commit).`);
    console.warn(`  Likely another agent edited the same ticket first. Run \`git pull --rebase\`, re-read the ticket, and don't start it unless the claim is yours.`);
    console.warn(`  git said: ${String(err.stderr || err.message).trim().split("\n")[0]}`);
  }
  return result;
}

function ticketCommand(ctx, cmd, positional, flags) {
  const usage = {
    claim: `claim <ID> --agent <name> [--days N=${ctx.cfg.leaseDays}] [--force] [--no-push]`,
    release: "release <ID> [--no-push]",
    block: 'block <ID> --reason "<reason>" [--no-push]',
    done: "done <ID> [--commit <sha>] [--no-push]",
  }[cmd];
  const fail = (msg) => {
    console.error(msg);
    console.error(`Usage: ${ctx.cmd} ${usage}`);
    process.exit(1);
  };
  const id = positional[1];
  if (!id) fail("Missing ticket ID.");
  if (cmd === "claim" && (!flags.agent || flags.agent === true)) fail("--agent is required.");
  if (cmd === "block" && (!flags.reason || flags.reason === true)) fail("--reason is required.");
  let days = ctx.cfg.leaseDays;
  if (cmd === "claim" && flags.days !== undefined) {
    days = Number(flags.days);
    if (!Number.isInteger(days) || days < 1) fail("--days must be a positive integer.");
  }

  const lines = readText(ctx.backlogFile).split("\n");
  const idx = findTicket(ctx, lines, id);
  if (idx === -1) {
    console.error(`Ticket ${id} not found in ${ctx.backlogRel}.`);
    process.exit(1);
  }
  let line = lines[idx];
  const realId = line.match(ctx.idBold)[1];
  const agent = flags.agent === true ? "" : cleanInline(flags.agent || "");
  let message;

  if (cmd === "claim") {
    if (/^\s*- \[x\]/.test(line)) {
      console.error(`${realId} is already done.`);
      process.exit(1);
    }
    let remoteLine = "";
    if (ctx.cfg.push !== "none") {
      try {
        run(ctx, ["fetch", "-q", ctx.cfg.remote]);
      } catch {
        /* offline is fine */
      }
      try {
        const remote = run(ctx, ["show", `${ctx.upstream}:${ctx.backlogRel}`]).replace(/\r\n/g, "\n").split("\n");
        const ri = findTicket(ctx, remote, id);
        if (ri !== -1) remoteLine = remote[ri];
      } catch {
        /* no remote copy */
      }
    }
    if (/^\s*- \[x\]/.test(remoteLine)) {
      console.error(`${realId} is already done on ${ctx.upstream} (pull first).`);
      process.exit(1);
    }
    for (const [where, l] of [["local", line], [ctx.upstream, remoteLine]]) {
      const other = liveForeignClaim(l, agent);
      if (other && !flags.force) {
        console.error(`${realId} is claimed by ${other.agent} until ${other.until} (${where}). Use --force to take it over (only if the user says so).`);
        process.exit(1);
      }
    }
    line = insertField(ctx, setBox(line.replace(FIELD_RE, ""), "~"), `claimed: ${agent} until ${addDays(today(), days)}`);
    message = `chore(backlog): ${agent} claims ${realId}`;
  } else if (cmd === "release") {
    line = setBox(line.replace(FIELD_RE, ""), " ");
    message = `chore(backlog): release ${realId}`;
  } else if (cmd === "block") {
    line = insertField(ctx, setBox(line.replace(FIELD_RE, ""), "!"), `blocked: ${cleanInline(flags.reason)}`);
    message = `chore(backlog): block ${realId}`;
  } else {
    line = setBox(line.replace(FIELD_RE, ""), "x");
    if (flags.commit && flags.commit !== true) line = `${line.trimEnd()} Commit \`${flags.commit}\`.`;
    message = `chore(backlog): ${realId} done`;
  }

  if (cmd === "done") {
    lines.splice(idx, 1);
    const h = lines.findIndex((l) => l.trim().toLowerCase() === "## done");
    if (h === -1) lines.push("", "## Done", "", line);
    else lines.splice(lines[h + 1] !== undefined && lines[h + 1].trim() === "" ? h + 2 : h + 1, 0, line);
  } else {
    lines[idx] = line;
  }
  writeKeepEol(ctx.backlogFile, lines.join("\n"));
  console.log(line.length > 400 ? line.slice(0, 397) + "…" : line);
  if (flags["no-push"]) return;

  const { rebased } = commitBacklog(ctx, message);
  if (cmd === "claim" && rebased) {
    const after = readText(ctx.backlogFile).split("\n");
    const ai = findTicket(ctx, after, id);
    const other = ai === -1 ? null : liveForeignClaim(after[ai], agent);
    if (other) console.warn(`Warning: CONFLICT: after rebase ${realId} is claimed by ${other.agent} until ${other.until}. Pick another ticket.`);
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
function stateTemplate(name, cmd) {
  return `# ${name} Agent State — "The Baton"

> Every agent reads this at session start (\`${cmd} --agent <you>\`) and updates it before ending.
> Keep it short (< 80 lines). History lives in git; the task queue lives in [\`BACKLOG.md\`](BACKLOG.md).

## Current Focus

- **Task**: _none — follow the BACKLOG.md pick order (urgent, then lowest-target ready ticket)_
- **Owner**: —
- **Status**: idle  <!-- ${VALID_STATUSES.join(" | ")} -->
- **Branch**: —
- **Files in play**: —
- **Next concrete step**: —
- **Verify with**: —

## Needs User Decision

- None open.

## Handoff Log (newest first, the tool keeps the newest entries)

<!-- Format: - YYYY-MM-DD · <agent> · <done> → next: <next> -->
<!-- log:start -->
- ${today()} · baton · Task board initialised → next: add tickets to BACKLOG.md
<!-- log:end -->
`;
}

function backlogTemplate(name, cmd, leaseDays, agents) {
  const tags = [...Object.keys(agents), "user"].map((t) => `\`@${t}\``).join(" · ");
  return `# ${name} Backlog — Shared Task Queue

> One queue for every agent. No priority field: order comes from \`needs\`, \`target\` and the \`urgent\` flag.
> **Ticket line**: \`- [ ] **ABC-01** \\\`@agent\\\` \\\`needs: ABC-02\\\` \\\`target: 0.1\\\` One bounded task: goal, files, done-when.\`
> **IDs** are stable forever (area prefix + number), never renumbered.
> **Fields** (backticked, after the agent tag): \`needs: <IDs>\` can't start until those are Done · \`target: 0.x\` the milestone ·
> \`from: <ID>\` found while working on that ticket · \`urgent\` only for a broken build, a crash, or data at risk.
> **Status box**: \`[ ]\` open · \`[~]\` claimed · \`[!]\` blocked (with a \`blocked:\` reason) · \`[x]\` done.
> **Pick order**: 1) any open \`urgent\` ticket, 2) STATE.md Current Focus if it is yours and in progress, 3) your ready ticket
> (all \`needs\` Done) with the lowest \`target\`. \`${cmd} --agent <you>\` lists them in that order.
> **Claim before you start**: \`${cmd} claim <ID> --agent <you>\` refuses tickets another agent holds and adds
> \`claimed: <agent> until <date>\` (a ${leaseDays}-day lease, renewed by every \`log\` you write). Expired leases show as STALE.
> Also \`block <ID> --reason "…"\`, \`release <ID>\`, \`done <ID> --commit <sha>\` (moves it under _Done_).
> **Agent tags**: ${tags}.

## Now

- [ ] **AGT-01** \`@user\` \`target: 0.1\` Replace this example ticket with your first real one.

## Next

## Done
`;
}

function initProject(root, flags) {
  const configPath = path.join(root, CONFIG_FILE);
  const created = [];
  const kept = [];
  if (!fs.existsSync(configPath)) {
    const push = typeof flags.push === "string" ? flags.push : DEFAULTS.push;
    if (!["push-master", "commit-only", "none"].includes(push)) {
      console.error("--push must be push-master, commit-only or none");
      process.exit(1);
    }
    const cfg = {
      project: typeof flags.project === "string" ? flags.project : path.basename(root),
      stateFile: DEFAULTS.stateFile,
      backlogFile: DEFAULTS.backlogFile,
      leaseDays: DEFAULTS.leaseDays,
      push,
      remote: DEFAULTS.remote,
      branch: typeof flags.branch === "string" ? flags.branch : git({ root }, ["symbolic-ref", "--short", "HEAD"]) || DEFAULTS.branch,
      ticketId: DEFAULTS.ticketId,
      agents: DEFAULTS.agents,
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    created.push(CONFIG_FILE);
  } else kept.push(CONFIG_FILE);

  const ctx = makeContext(root, loadConfig(root));
  const name = ctx.cfg.project || path.basename(root);
  for (const [file, rel, body] of [
    [ctx.stateFile, ctx.stateRel, stateTemplate(name, ctx.cmd)],
    [ctx.backlogFile, ctx.backlogRel, backlogTemplate(name, ctx.cmd, ctx.cfg.leaseDays, ctx.cfg.agents)],
  ]) {
    if (fs.existsSync(file)) kept.push(rel);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body, "utf-8");
      created.push(rel);
    }
  }
  const gi = path.join(root, ".gitignore");
  const giText = readText(gi);
  if (!giText.split("\n").some((l) => l.trim() === AUTO_BATON)) {
    fs.writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + `${AUTO_BATON}\n`, "utf-8");
    created.push(`.gitignore (+${AUTO_BATON})`);
  }
  const ga = path.join(root, ".gitattributes");
  const gaText = readText(ga);
  const want = [ctx.stateRel, ctx.backlogRel].map((rel) => `${rel} merge=baton`);
  const missing = want.filter((w) => !gaText.split("\n").some((l) => l.trim() === w));
  if (missing.length) {
    fs.writeFileSync(ga, gaText + (gaText && !gaText.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n", "utf-8");
    created.push(`.gitattributes (+merge=baton)`);
  }
  ensureMergeDriver(ctx);
  if (created.length) console.log(`Created: ${created.join(", ")}`);
  if (kept.length) console.log(`Kept (already there, not touched): ${kept.join(", ")}`);
  console.log(`Next: commit these files, then \`${ctx.cmd} --agent <you>\`. Push mode: ${ctx.cfg.push} (change it in ${CONFIG_FILE}).`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
/** Runs one command. `opts.root` overrides discovery; `opts.sections` adds brief sections (afterGit, beforeProtocol). */
export function main(argv = process.argv.slice(2), opts = {}) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];
  try {
    const root = opts.root || (typeof flags.root === "string" ? path.resolve(flags.root) : findRoot(process.cwd()));
    if (command === "init") return initProject(root, flags);
    const ctx = makeContext(root, loadConfig(root));
    ensureMergeDriver(ctx);
    if (command === "log") appendLog(ctx, flags);
    else if (command === "focus") updateFocus(ctx, flags);
    else if (["claim", "release", "block", "done"].includes(command)) ticketCommand(ctx, command, positional, flags);
    else if (!command) console.log(buildBrief(ctx, flags.agent, opts.sections || {}, flags.model, Boolean(flags.hook), flags.effort));
    else {
      console.error(`Unknown command "${command}". Commands: init, log, focus, claim, release, block, done (none = brief).`);
      process.exit(1);
    }
  } catch (err) {
    if (flags.hook) {
      console.log(`[baton] Could not build brief: ${err.message}. Read .agents/STATE.md manually.`);
      process.exit(0);
    }
    throw err;
  }
}

export { buildBrief, parseTickets, loadConfig, makeContext, findRoot };

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) main();
