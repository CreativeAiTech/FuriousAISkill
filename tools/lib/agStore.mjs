// Antigravity (Gemini) chat store helpers, shared by tokenReport.mjs and agContext.mjs.
// Chats live in ~/.gemini/antigravity/conversations/<uuid>.db (SQLite). Never open a live file: openCopy() reads a temp copy.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function pbVarint(b, i) { let r = 0, m = 1; for (;;) { if (i >= b.length) throw new Error("pb: eof"); const x = b[i++]; r += (x & 0x7f) * m; m *= 128; if (!(x & 0x80)) return [r, i]; } }
export function pbFields(b) {
  const o = {}; let i = 0;
  while (i < b.length) {
    let t; [t, i] = pbVarint(b, i);
    const f = Math.floor(t / 8), w = t % 8; let v;
    if (w === 0) [v, i] = pbVarint(b, i);
    else if (w === 2) { let l; [l, i] = pbVarint(b, i); if (i + l > b.length) throw new Error("pb: len"); v = b.subarray(i, i + l); i += l; }
    else if (w === 1) { i += 8; continue; }
    else if (w === 5) { i += 4; continue; }
    else throw new Error("pb: wire type " + w);
    (o[f] ??= []).push(v);
  }
  return o;
}

export const agDir = path.join(os.homedir(), ".gemini", "antigravity", "conversations");

/** Copies the chat file to a temp file and opens the copy read-only. close() closes and deletes the copy. */
export async function openCopy(fp) {
  const { DatabaseSync } = await import("node:sqlite");
  const tmp = path.join(os.tmpdir(), `agctx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(fp, tmp);
  let db;
  try { db = new DatabaseSync(tmp, { readOnly: true }); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  return { db, close() { try { db.close(); } catch {} for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + s); } catch {} } } };
}

/** { uri, isSub } from the trajectory metadata (workspace file URI; field 5 or 17 = subagent). */
export function readMain(db) {
  const meta = pbFields(Buffer.from(db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get().data));
  const uri = pbFields(meta[1][0])[1][0].toString();
  return { uri, isSub: Boolean(meta[5] || meta[17]) };
}

/** One { prompt, turn } per model call with usage; prompt = input + cache write + cache read; turn = user messages before the call. */
export function chatCalls(db) {
  const turnOf = [];
  let users = 0;
  for (const r of db.prepare("SELECT step_type FROM steps ORDER BY idx").all()) {
    if (r.step_type === 14) users++;
    else if (r.step_type === 15) turnOf.push(users);
  }
  const calls = [];
  let k = 0;
  for (const r of db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all()) {
    const turn = turnOf[k++] ?? users;
    const g = pbFields(pbFields(Buffer.from(r.data))[1][0]);
    if (!g[4]) continue;
    const u = pbFields(g[4][0]), n = (f) => u[f]?.[0] ?? 0;
    if (!u[2] && !u[3]) continue;
    calls.push({ prompt: n(2) + n(4) + n(5), turn });
  }
  return calls;
}
