#!/usr/bin/env node
/**
 * Git merge driver for the task-board files (STATE.md, BACKLOG.md), shipped with tools/baton.mjs.
 * Same file as Crownspire's tools/batonMerge.mjs (decision: .agents/decisions/2026-10-24-baton-merge-driver.md there).
 *
 * `baton.mjs` registers it in git config (merge.baton.driver, only when unset) and `init` wires .gitattributes:
 *   <stateFile> merge=baton
 *   <backlogFile> merge=baton
 * Git calls it as: batonMerge.mjs <base> <ours (result is written here)> <theirs> [path]
 *
 * It merges what parallel branches actually do to these files, without conflicts:
 * - STATE.md handoff log: union of both sides' new entries (theirs first, newest on top), entries rotated out
 *   by either side stay out, trimmed back to the cap a rotating side kept.
 * - STATE.md Current Focus: one block; if both sides changed it, ours (the branch merged into) wins.
 * - BACKLOG.md tickets: merged per ticket ID (a ticket = its `- [ ] **ID**` line plus indented sub-lines).
 *   One side changed → that side. Both changed → the more advanced box wins ([x] > [!] > [~] > [ ]), tie → ours.
 *   A ticket moved to `## Done` on one side appears once, under Done.
 * Anything else that conflicts (prose edited on both sides) is a real conflict: it falls back to git's normal
 * text merge with conflict markers and exits 1, exactly what git does without this driver.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LOG_RE = /<!-- log:start -->\n([\s\S]*?)<!-- log:end -->/;
const FOCUS_RE = /^## Current Focus\n[\s\S]*?(?=^## |(?![\s\S]))/m;
const TICKET_RE = /^\s*- \[([ x~!])\] \*\*([A-Za-z][A-Za-z0-9]*-\d+)\*\*/;
const PH = "\u0001baton-ticket:";
const RANK = { " ": 0, "~": 1, "!": 2, x: 3 };

/** 3-way text merge via `git merge-file`. Returns { text, conflicts }. */
function mergeFile(base, ours, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baton-merge-"));
  try {
    const [o, b, t] = ["ours", "base", "theirs"].map((n) => path.join(dir, n));
    fs.writeFileSync(o, ours);
    fs.writeFileSync(b, base);
    fs.writeFileSync(t, theirs);
    const args = ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "theirs", o, b, t];
    try {
      return { text: execFileSync("git", args, { encoding: "utf-8" }), conflicts: 0 };
    } catch (err) {
      if (typeof err.status === "number" && err.status > 0 && err.status < 128 && typeof err.stdout === "string") {
        return { text: err.stdout, conflicts: err.status };
      }
      throw err;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// STATE.md
// ---------------------------------------------------------------------------
function logLines(text) {
  const m = text.match(LOG_RE);
  return m ? m[1].split("\n").filter((l) => l.trim().startsWith("- ")) : null;
}

function mergeLog(b, o, t) {
  const B = new Set(b), O = new Set(o), T = new Set(t);
  const dropped = (e) => B.has(e) && (!O.has(e) || !T.has(e)); // rotated (or removed) by either side
  const theirsNew = t.filter((e) => !B.has(e) && !O.has(e));
  let merged = [...new Set([...theirsNew, ...o])].filter((e) => !dropped(e));
  // A side that dropped base entries was at the cap; keep the merged log at that size.
  const caps = [o, t].filter((side) => b.some((e) => !side.includes(e))).map((side) => side.length);
  if (caps.length) merged = merged.slice(0, Math.max(...caps));
  return merged;
}

function setLog(text, entries) {
  return text.replace(LOG_RE, () => `<!-- log:start -->\n${entries.map((e) => `${e}\n`).join("")}<!-- log:end -->`);
}

function mergeState(base, ours, theirs) {
  let [b, o, t] = [base, ours, theirs];
  const logs = [b, o, t].map(logLines);
  if (logs.every(Boolean)) {
    const merged = mergeLog(...logs);
    [b, o, t] = [b, o, t].map((x) => setLog(x, merged));
  }
  const focus = [b, o, t].map((x) => x.match(FOCUS_RE)?.[0]);
  if (focus.every((f) => f !== undefined)) {
    const [fb, fo, ft] = focus;
    const winner = fo === fb ? ft : fo;
    if (fo !== fb && ft !== fb && fo !== ft) process.stderr.write("baton merge: Current Focus changed on both sides, kept ours\n");
    [b, o, t] = [b, o, t].map((x) => x.replace(FOCUS_RE, () => winner));
  }
  const { text, conflicts } = mergeFile(b, o, t);
  return conflicts ? null : text;
}

// ---------------------------------------------------------------------------
// BACKLOG.md
// ---------------------------------------------------------------------------
/** Replaces each ticket block with one placeholder line. Returns { skeleton, blocks: Map<id, text> }. */
function splitTickets(text) {
  const lines = text.split("\n");
  const out = [];
  const blocks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TICKET_RE);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const id = m[2].toUpperCase();
    if (blocks.has(id)) throw new Error(`duplicate ticket ${id}`);
    const block = [lines[i]];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !TICKET_RE.test(lines[i + 1])) block.push(lines[++i]);
    blocks.set(id, block.join("\n"));
    out.push(PH + id);
  }
  return { skeleton: out.join("\n"), blocks };
}

const box = (block) => block.match(TICKET_RE)[1];

function resolveTicket(id, b, o, t) {
  if (o === t) return o;
  if (o === b) return t;
  if (t === b) return o;
  if (o === undefined) return t; // deleted on one side, changed on the other: keep the change
  if (t === undefined) return o;
  const ro = RANK[box(o)], rt = RANK[box(t)];
  if (ro === rt) process.stderr.write(`baton merge: ${id} changed on both sides, kept ours\n`);
  return rt > ro ? t : o;
}

/**
 * Resolves conflict hunks whose sides differ only in ticket placeholders: the other lines (headers, blanks) must
 * match. Theirs' placeholders go in at the same spot relative to those lines, ahead of ours (newest first).
 * Duplicates are fine here; mergeBacklog keeps one per ticket.
 */
function unionPlaceholderHunks(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< ")) {
      out.push(lines[i]);
      continue;
    }
    const ours = [], theirs = [];
    let side = ours;
    for (i++; i < lines.length && !lines[i].startsWith(">>>>>>> "); i++) {
      if (lines[i] === "=======") side = theirs;
      else side.push(lines[i]);
    }
    const isPH = (l) => l.startsWith(PH);
    const frame = (side) => side.filter((l) => !isPH(l) && l.trim() !== "");
    if (frame(ours).join("\n") !== frame(theirs).join("\n")) return null;
    // slots[k] = theirs' placeholders that follow the k-th frame line
    const slots = [[]];
    for (const l of theirs) {
      if (isPH(l)) slots[slots.length - 1].push(l);
      else if (l.trim() !== "") slots.push([]);
    }
    let k = 0;
    const flush = () => out.push(...(slots[k] || []).splice(0));
    for (const l of ours) {
      if (isPH(l)) {
        flush();
        out.push(l);
      } else {
        if (l.trim() !== "") {
          flush();
          k++;
        }
        out.push(l);
      }
    }
    flush();
  }
  return out.join("\n");
}

function mergeBacklog(base, ours, theirs) {
  const [sb, so, st] = [base, ours, theirs].map(splitTickets);
  let { text, conflicts } = mergeFile(sb.skeleton, so.skeleton, st.skeleton);
  if (conflicts) text = unionPlaceholderHunks(text);
  if (text === null) return null;

  const resolved = new Map();
  for (const id of new Set([...sb.blocks.keys(), ...so.blocks.keys(), ...st.blocks.keys()])) {
    resolved.set(id, resolveTicket(id, sb.blocks.get(id), so.blocks.get(id), st.blocks.get(id)));
  }

  // Each ticket appears once: under ## Done when resolved [x], elsewhere otherwise.
  const lines = text.split("\n");
  const where = new Map();
  let inDone = false;
  lines.forEach((l, i) => {
    if (l.startsWith("## ")) inDone = l.trim().toLowerCase() === "## done";
    if (!l.startsWith(PH)) return;
    const id = l.slice(PH.length);
    if (!where.has(id)) where.set(id, []);
    where.get(id).push({ i, inDone });
  });
  for (const [id, block] of resolved) {
    if (block !== undefined && !where.has(id)) throw new Error(`${id} was removed on one side and edited on the other`);
  }
  const keep = new Set();
  for (const [id, spots] of where) {
    const block = resolved.get(id);
    if (block === undefined) continue;
    const wantDone = box(block) === "x";
    keep.add((spots.find((s) => s.inDone === wantDone) ?? spots[0]).i);
  }
  return lines
    .filter((l, i) => !l.startsWith(PH) || keep.has(i))
    .map((l) => (l.startsWith(PH) ? resolved.get(l.slice(PH.length)) : l))
    .join("\n");
}

// ---------------------------------------------------------------------------
function main() {
  const [basePath, oursPath, theirsPath, name = ""] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    console.error("Usage: node ~/.agents/tools/batonMerge.mjs <base> <ours> <theirs> [path]");
    process.exit(2);
  }
  const raw = [basePath, oursPath, theirsPath].map((p) => fs.readFileSync(p, "utf-8"));
  const crlf = raw[1].includes("\r\n");
  const [base, ours, theirs] = raw.map((x) => x.replace(/\r\n/g, "\n"));
  const restore = (x) => (crlf ? x.replace(/\n/g, "\r\n") : x);

  let merged = null;
  try {
    if (LOG_RE.test(ours) || FOCUS_RE.test(ours)) merged = mergeState(base, ours, theirs);
    else if (ours.split("\n").some((l) => TICKET_RE.test(l))) merged = mergeBacklog(base, ours, theirs);
  } catch (err) {
    process.stderr.write(`baton merge: ${err.message}; falling back to a normal merge\n`);
  }
  if (merged !== null) {
    fs.writeFileSync(oursPath, restore(merged));
    process.exit(0);
  }
  const plain = mergeFile(base, ours, theirs);
  fs.writeFileSync(oursPath, restore(plain.text));
  if (plain.conflicts) process.stderr.write(`baton merge: real conflict in ${name || oursPath}, resolve by hand\n`);
  process.exit(plain.conflicts ? 1 : 0);
}

main();
