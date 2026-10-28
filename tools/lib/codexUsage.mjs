import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

export const COUNTERS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
const empty = () => Object.fromEntries(COUNTERS.map(k => [k, null]));
const normalized = p => {
  const s = String(p).replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(s) || s.startsWith("//") ? path.posix.normalize(s).replace(/\/$/, "").toLowerCase() : process.platform === "win32" ? path.resolve(s).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() : path.resolve(s).replace(/\\/g, "/").replace(/\/$/, "");
};
const time = x => Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const counters = x => Object.fromEntries(COUNTERS.map(k => [k, Number.isSafeInteger(x?.[k]) && x[k] >= 0 ? x[k] : null]));
const equal = (a, b) => COUNTERS.every(k => a[k] !== null && a[k] === b[k]);
const sameVector = (a, b) => COUNTERS.every(k => a[k] === b[k]);
export function codexRole(source) {
  if (source?.subagent?.thread_spawn) return "worker";
  if (source?.subagent?.other === "guardian") return "guardian";
  return ["cli", "vscode", "exec", "app-server"].includes(source) ? "main" : "unknown";
}

// Only retain metadata and counters. Message/tool payloads are never returned.
export async function readCodexUsage({ project, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), since = 0, until = Date.now() }) {
  const root = path.join(codexHome, "sessions");
  const diagnostics = { files: 0, unreadableFiles: 0, unreadableDirectories: 0, malformedRecords: 0, unsupportedRecords: 0, excludedFiles: 0, duplicateObservations: 0 };
  const sessions = new Map();
  let available = true;
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { diagnostics.unreadableDirectories++; if (dir === root) available = false; return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      diagnostics.files++;
      let meta = null, observations = [], configurations = [], reasons = new Set(), conflictingIdentity = false, lastTimestamp = null;
      let stream, lines;
      try {
        stream = fs.createReadStream(file, { encoding: "utf8" });
        lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
        // Forward read errors to the async iterator, including active files denied sharing.
        stream.on("error", e => lines.close());
        let readError = null;
        stream.on("error", e => { readError = e; });
        for await (const line of lines) {
          if (!line.trim()) continue;
          let record;
          try { record = JSON.parse(line); } catch { diagnostics.malformedRecords++; reasons.add("malformed_records"); continue; }
          if (!record || typeof record !== "object") { diagnostics.unsupportedRecords++; reasons.add("unsupported_records"); continue; }
          const p = record.payload;
          if (record.type === "session_meta") {
            if (typeof p?.id !== "string" || typeof p?.cwd !== "string") { diagnostics.unsupportedRecords++; reasons.add("invalid_metadata"); continue; }
            if (meta && (meta.id !== p.id || normalized(meta.cwd) !== normalized(p.cwd))) {
              conflictingIdentity = true; reasons.add("conflicting_identity"); break;
            }
            const nextMeta = { id: p.id, cwd: p.cwd, parentId: typeof p.parent_thread_id === "string" ? p.parent_thread_id : null, role: codexRole(p.source), start: time(p.timestamp || record.timestamp) };
            if (meta && (meta.role !== nextMeta.role || meta.parentId !== nextMeta.parentId || meta.start !== nextMeta.start)) {
              reasons.add("conflicting_metadata"); break;
            }
            meta = nextMeta;
            if (normalized(meta.cwd) !== normalized(project)) break;
          } else if (record.type === "turn_context") {
            configurations.push({ timestamp: time(record.timestamp), model: typeof p?.model === "string" ? p.model : null, effort: typeof p?.effort === "string" ? p.effort : null });
          } else if (record.type === "event_msg" && p?.type === "token_count") {
            const ts = time(record.timestamp);
            if (ts === null || !p.info?.total_token_usage || typeof p.info.total_token_usage !== "object") { diagnostics.unsupportedRecords++; reasons.add("invalid_usage"); continue; }
            const total = counters(p.info.total_token_usage), last = counters(p.info.last_token_usage);
            if (COUNTERS.some(k => total[k] === null)) reasons.add("missing_or_invalid_counters");
            // A backward timestamp within a stream has uncertain serialization order.
            // Sorting across resumes is safe only when each source stream is ordered.
            if (lastTimestamp !== null && ts < lastTimestamp) reasons.add("ambiguous_ordering");
            lastTimestamp = ts;
            observations.push({ timestamp: ts, total, last });
          }
        }
        if (readError) throw readError;
      } catch { diagnostics.unreadableFiles++; reasons.add("unreadable_file"); }
      finally {
        lines?.close();
        stream?.destroy();
      }
      if (!meta || normalized(meta.cwd) !== normalized(project)) { diagnostics.excludedFiles++; continue; }
      let s = sessions.get(meta.id);
      if (!s) { s = { ...meta, observations: [], configurations: [], reasons: new Set() }; sessions.set(meta.id, s); }
      else if (s.role !== meta.role || s.parentId !== meta.parentId || s.start !== meta.start) s.reasons.add("conflicting_metadata");
      if (!conflictingIdentity) s.observations.push(...observations);
      s.configurations.push(...configurations);
      for (const reason of reasons) s.reasons.add(reason);
    }
  }
  await walk(root);
  const result = [];
  for (const s of sessions.values()) {
    const seen = new Map(), events = [];
    for (const e of s.observations.sort((a, b) => a.timestamp - b.timestamp)) {
      const key = JSON.stringify([e.timestamp, e.total]);
      if (seen.has(key)) {
        const prior = seen.get(key);
        if (JSON.stringify(prior.last) !== JSON.stringify(e.last)) {
          prior.ambiguousOrigin = true; s.reasons.add("conflicting_origin_evidence");
        }
        diagnostics.duplicateObservations++; continue;
      }
      seen.set(key, e); events.push(e);
    }
    const observed = empty();
    let previous = null, blocked = s.reasons.has("ambiguous_ordering") || s.reasons.has("conflicting_identity") || s.reasons.has("conflicting_metadata"), accepted = 0, inWindow = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.timestamp > until) break;
      if (events[i + 1]?.timestamp === e.timestamp || events[i - 1]?.timestamp === e.timestamp) {
        s.reasons.add("ambiguous_ordering"); blocked = true;
      }
      if (e.timestamp < since) { previous = e; continue; }
      inWindow++;
      if (blocked) continue;
      if (previous && sameVector(e.total, previous.total)) {
        diagnostics.duplicateObservations++; previous = e; continue;
      }
      if (previous && COUNTERS.some(k => e.total[k] !== null && previous.total[k] !== null && e.total[k] < previous.total[k])) {
        s.reasons.add("counter_decrease"); blocked = true; continue;
      }
      const origin = !previous && !e.ambiguousOrigin && s.start !== null && s.start >= since && s.start <= e.timestamp && equal(e.total, e.last);
      if (!previous && !origin) s.reasons.add("partial_history");
      let counted = false;
      for (const k of COUNTERS) {
        const delta = origin ? e.total[k] : previous && e.total[k] !== null && previous.total[k] !== null ? e.total[k] - previous.total[k] : null;
        if (delta !== null) { observed[k] = (observed[k] ?? 0) + delta; counted = true; }
      }
      if (counted) accepted++;
      previous = e;
    }
    // Diagnostics may be global, but current role counts require timestamped
    // evidence in the window. Old or undated errors do not establish activity now.
    if (!inWindow && !(s.start !== null && s.start >= since && s.start <= until)) continue;
    const orderedConfigurations = [...new Map(s.configurations.map(c => [JSON.stringify(c), c])).values()].sort((a, b) => a.timestamp - b.timestamp);
    const configurations = orderedConfigurations.filter((c, i) => !i || c.model !== orderedConfigurations[i - 1].model || c.effort !== orderedConfigurations[i - 1].effort);
    result.push({ id: s.id, parentId: s.parentId, role: s.role, configurations, observed, observations: inWindow, acceptedObservations: accepted, coverage: s.reasons.size ? "partial" : accepted ? "observed" : "no_matching_usage", reasons: [...s.reasons].sort() });
  }
  const roles = { main: 0, worker: 0, guardian: 0, unknown: 0 };
  for (const s of result) roles[s.role]++;
  const reasons = [];
  if (diagnostics.unreadableFiles || diagnostics.unreadableDirectories) reasons.push("unreadable_sources");
  if (diagnostics.malformedRecords || diagnostics.unsupportedRecords) reasons.push("unsupported_or_malformed_records");
  if (result.some(s => s.coverage === "partial")) reasons.push("partial_session_history");
  return { project: path.resolve(project), window: { since, until }, coverage: !available ? "unavailable" : reasons.length ? "partial" : result.some(s => s.acceptedObservations) ? "observed" : "no_matching_usage", reasons, roles, sessions: result, diagnostics,
    scope: "Exact normalized cwd only; child directories and worktrees are not implicitly included. Observed does not establish complete task coverage.",
    counterSemantics: "Per-session reported counters; parent/worker overlap unknown. Cached input and reasoning output are subsets, not extra tokens. No unique task-wide total.", cost: null, quotaSavings: null, uniqueTaskTotal: null };
}
