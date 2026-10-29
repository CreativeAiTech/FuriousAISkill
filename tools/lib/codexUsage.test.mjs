import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCodexUsage, codexRole, priceCodexModel, toModelValueCall } from "./codexUsage.mjs";

const ts = n => new Date(n * 1000).toISOString();
const u = n => ({ input_tokens: n * 8, cached_input_tokens: n * 2, cache_write_input_tokens: 0, output_tokens: n * 2, reasoning_output_tokens: n, total_tokens: n * 10 });
const meta = (id = "s", cwd = "C:/fixture/project", source = "vscode", start = 1) => ({ type: "session_meta", timestamp: ts(start), payload: { id, cwd, source } });
const event = (t, n, last = n) => ({ type: "event_msg", timestamp: ts(t), payload: { type: "token_count", info: { total_token_usage: u(n), last_token_usage: u(last) } } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-"));
  fs.mkdirSync(path.join(root, "sessions"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, write: (name, records) => fs.writeFileSync(path.join(root, "sessions", name + ".jsonl"), records.map(r => typeof r === "string" ? r : JSON.stringify(r)).join("\n")), read: (opts = {}) => readCodexUsage({ project: "C:/fixture/project", codexHome: root, since: 0, until: 100000, ...opts }) };
}
test("cumulative deltas deduplicate repeats, resumes and files without subset double counting", async t => {
  const f = fixture(t), records = [meta(), event(2, 2), event(3, 5, 3), event(4, 5, 3)];
  f.write("a", records); f.write("resume", [meta(), event(3, 5, 3), event(5, 8, 3)]);
  const r = await f.read();
  assert.equal(r.sessions.length, 1); assert.equal(r.sessions[0].observed.total_tokens, 80);
  assert.equal(r.sessions[0].observed.input_tokens, 64); assert.equal(r.sessions[0].observed.reasoning_output_tokens, 8);
  assert.equal(r.diagnostics.duplicateObservations, 2); assert.equal(r.sessions[0].acceptedObservations, 3); assert.equal(r.coverage, "observed");
  assert.equal(r.uniqueTaskTotal, null); assert.equal(r.cost, null);
});
test("window uses last pre-window baseline and event timestamps", async t => {
  const f = fixture(t); f.write("a", [meta(), event(2, 2), event(3, 5, 3), event(5, 8, 3), event(9, 20, 12)]);
  const r = await f.read({ since: 4000, until: 6000 });
  assert.equal(r.sessions[0].observed.total_tokens, 30); assert.equal(r.coverage, "observed");
});
test("identical partial vectors are repeats without establishing a full origin", async t => {
  const f = fixture(t), first = event(2, 2), repeat = event(3, 2), next = event(4, 5, 3);
  for (const e of [first, repeat, next]) delete e.payload.info.total_token_usage.cached_input_tokens;
  f.write("a", [meta(), first, repeat, next]);
  const r = await f.read();
  assert.equal(r.sessions[0].observed.total_tokens, 30);
  assert.equal(r.sessions[0].observed.cached_input_tokens, null);
  assert.equal(r.sessions[0].acceptedObservations, 1);
  assert.equal(r.diagnostics.duplicateObservations, 1);
  assert.equal(r.coverage, "partial"); assert.ok(r.sessions[0].reasons.includes("partial_history"));
});
test("unknown first snapshot is baseline, never invented zero", async t => {
  const f = fixture(t); f.write("a", [meta(), event(5, 8, 3)]);
  let r = await f.read({ since: 4000 });
  assert.equal(r.sessions[0].observed.total_tokens, null); assert.equal(r.coverage, "partial");
  f.write("a", [meta(), event(5, 8, 3), event(6, 10, 2)]);
  r = await f.read({ since: 4000 }); assert.equal(r.sessions[0].observed.total_tokens, 20);
});
test("counter decreases and ambiguous ordering exclude uncertain increments", async t => {
  const f = fixture(t); f.write("a", [meta(), event(2, 5), event(3, 2), event(4, 8)]);
  let r = await f.read(); assert.equal(r.sessions[0].observed.total_tokens, 50); assert.ok(r.sessions[0].reasons.includes("counter_decrease"));
  f.write("a", [meta(), event(2, 2), event(3, 5), event(3, 6), event(4, 8)]);
  r = await f.read(); assert.equal(r.sessions[0].observed.total_tokens, 20); assert.ok(r.sessions[0].reasons.includes("ambiguous_ordering"));
});
test("malformed, null and missing fields stay partial and unknown", async t => {
  const f = fixture(t), broken = event(3, 4); delete broken.payload.info.total_token_usage.cached_input_tokens;
  broken.payload.info.total_token_usage.reasoning_output_tokens = -1;
  f.write("a", [meta(), '{"type":', null, { type: "event_msg", timestamp: ts(2), payload: { type: "token_count", info: null } }, broken]);
  const r = await f.read(); assert.equal(r.coverage, "partial"); assert.equal(r.sessions[0].observed.cached_input_tokens, null);
  assert.ok(r.diagnostics.malformedRecords); assert.ok(r.diagnostics.unsupportedRecords);
});
test("model changes are preserved without attributing uncertain deltas", async t => {
  const f = fixture(t); f.write("a", [meta(), { type: "turn_context", timestamp: ts(1), payload: { model: "fixture-a", effort: "medium" } }, event(2, 2), { type: "turn_context", timestamp: ts(3), payload: { model: "fixture-b", effort: "max" } }, event(4, 5, 3)]);
  const r = await f.read(); assert.deepEqual(r.sessions[0].configurations.map(c => c.model), ["fixture-a", "fixture-b"]);
  assert.equal(r.sessions[0].observed.total_tokens, 50); assert.equal(r.sessions[0].byModel, undefined);
});
test("backward timestamps and conflicting identities fail closed before sorting", async t => {
  const f = fixture(t); f.write("a", [meta(), event(3, 5), event(2, 2)]);
  let r = await f.read(); assert.equal(r.sessions[0].observed.total_tokens, null); assert.ok(r.sessions[0].reasons.includes("ambiguous_ordering"));
  f.write("a", [meta(), event(2, 2), meta("other"), event(3, 5)]);
  r = await f.read(); assert.equal(r.sessions[0].observed.total_tokens, null); assert.ok(r.sessions[0].reasons.includes("conflicting_identity"));
});
test("conflicting duplicate origin evidence is order independent and excludes only uncertain origin", async t => {
  const f = fixture(t);
  const origin = [meta(), event(2, 5, 5)], baseline = [meta(), event(2, 5, 2), event(3, 8, 3)];
  f.write("a", origin); f.write("b", baseline);
  const forward = await f.read();
  f.write("a", baseline); f.write("b", origin);
  const reverse = await f.read();
  assert.deepEqual(forward, reverse);
  assert.equal(forward.sessions[0].observed.total_tokens, 30);
  assert.equal(forward.sessions[0].acceptedObservations, 1);
  assert.equal(forward.coverage, "partial");
  assert.ok(forward.sessions[0].reasons.includes("conflicting_origin_evidence"));
});
test("repeated metadata cannot overwrite parent, source role or start within a file", async t => {
  const f = fixture(t);
  for (const replacement of [
    { ...meta(), payload: { ...meta().payload, parent_thread_id: "different-parent" } },
    meta("s", "C:/fixture/project", { subagent: { other: "guardian" } }),
    meta("s", "C:/fixture/project", "vscode", 2),
  ]) {
    f.write("a", [meta(), event(2, 2), replacement, event(3, 5, 3)]);
    const r = await f.read();
    assert.equal(r.sessions[0].observed.total_tokens, null);
    assert.equal(r.sessions[0].role, "main"); assert.equal(r.sessions[0].parentId, null);
    assert.ok(r.sessions[0].reasons.includes("conflicting_metadata"));
    assert.equal(r.coverage, "partial");
  }
});
test("roles use source and exact normalized cwd excludes descendants/worktrees", async t => {
  const f = fixture(t);
  for (const [id, source] of [["main", "vscode"], ["worker", { subagent: { thread_spawn: {} } }], ["guardian", { subagent: { other: "guardian" } }], ["unknown", "future"]]) f.write(id, [meta(id, "c:\\fixture\\project\\", source), event(2, 2)]);
  f.write("child", [meta("child", "C:/fixture/project/child"), event(2, 2)]);
  f.write("worktree", [meta("worktree", "C:/fixture/project-worktree"), event(2, 2)]);
  const r = await f.read({ exactCwd: true }); assert.deepEqual(r.roles, { main: 1, worker: 1, guardian: 1, unknown: 1 }); assert.equal(r.diagnostics.excludedFiles, 2);
  assert.equal(codexRole({ parent_thread_id: "parent" }), "unknown");
  const rSub = await f.read(); assert.deepEqual(rSub.roles, { main: 2, worker: 1, guardian: 1, unknown: 1 }); assert.equal(rSub.diagnostics.subdirFiles, 1);
});
test("old damaged sessions retain diagnostics without inflating current role counts", async t => {
  const f = fixture(t), missing = event(2, 5); delete missing.payload.info.total_token_usage.output_tokens;
  f.write("old", [meta("old", "C:/fixture/project", { subagent: { other: "guardian" } }), missing, '{"type":']);
  f.write("current", [meta("current", "C:/fixture/project", "vscode", 5), event(6, 3)]);
  const r = await f.read({ since: 4000 });
  assert.deepEqual(r.sessions.map(s => s.id), ["current"]);
  assert.deepEqual(r.roles, { main: 1, worker: 0, guardian: 0, unknown: 0 });
  assert.equal(r.sessions[0].observed.total_tokens, 30);
  assert.equal(r.diagnostics.malformedRecords, 1); assert.equal(r.coverage, "partial");
});
test("absent/unreadable sources and synthetic message contents cannot leak", async t => {
  const f = fixture(t); f.write("a", [meta(), { type: "response_item", payload: { content: "SYNTHETIC_PRIVATE_SENTINEL" } }, event(2, 2)]);
  const r = await f.read(); assert.ok(!JSON.stringify(r).includes("SYNTHETIC_PRIVATE_SENTINEL"));
  assert.equal((await f.read({ codexHome: path.join(f.root, "absent") })).coverage, "unavailable");
  const original = fs.createReadStream;
  try { fs.createReadStream = () => { throw new Error("fixture denied"); }; const denied = await f.read(); assert.equal(denied.diagnostics.unreadableFiles, 1); assert.equal(denied.coverage, "partial"); }
  finally { fs.createReadStream = original; }
});
test("AGT-80: priceCodexModel requires exact matches and never guesses by family substring", () => {
  const reg = { entries: [{ model: "gpt-6.1-sol", rates: { input: 2, cachedInput: 0.1, output: 10 } }] };
  assert.equal(priceCodexModel("gpt-6.1-sol", reg)?.input, 2);
  assert.equal(priceCodexModel("GPT-6.1-SOL", reg)?.input, 2);
  assert.equal(priceCodexModel("gpt-6.1-sol-preview", reg), null);
  assert.equal(priceCodexModel("gpt-6", reg), null);
  assert.equal(priceCodexModel("gpt-6-astra", reg), null);
});
test("AGT-80: ambiguous/partial counters cannot become complete cost and toModelValueCall bridges clean data", async t => {
  const f = fixture(t);
  const pPath = path.join(f.root, "prices.json");
  fs.writeFileSync(pPath, JSON.stringify({ entries: [{ model: "gpt-6.1-sol", rates: { input: 2, cachedInput: 0.1, output: 10 } }] }));
  f.write("partial-session", [
    meta("partial-session", "C:/fixture/project", "vscode"),
    { type: "turn_context", timestamp: ts(1), payload: { model: "gpt-6.1-sol", effort: "high" } },
    event(2, 2),
    event(3, 1), // counter decrease -> partial
  ]);
  const r = await f.read({ pricesPath: pPath });
  const s = r.sessions[0];
  assert.equal(s.priced, false);
  assert.equal(s.modeledCostUsd, null);
  assert.equal(s.unpricedReason, "ambiguous_or_partial_counters");
  assert.throws(() => toModelValueCall(s), /Cannot export session with coverage/);

  // Clean session
  f.write("clean-session", [
    meta("clean-session", "C:/fixture/project", "vscode"),
    { type: "turn_context", timestamp: ts(1), payload: { model: "gpt-6.1-sol", effort: "high" } },
    event(2, 2),
  ]);
  const r2 = await f.read({ pricesPath: pPath });
  const clean = r2.sessions.find(x => x.id === "clean-session");
  assert.equal(clean.priced, true);
  assert.ok(clean.modeledCostUsd > 0);
  const call = toModelValueCall(clean);
  assert.equal(call.model, "gpt-6.1-sol");
  assert.equal(call.effort, "high");
  assert.equal(call.inputTokens, 16);
});
