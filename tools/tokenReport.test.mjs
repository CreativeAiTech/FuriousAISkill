import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { lastGate, gateLine, notificationResults } from "./tokenReport.mjs";
import { readCodexUsage } from "./lib/codexUsage.mjs";

function runFixture(root, project, codexHome, out) {
  return execFileSync(process.execPath, [fileURLToPath(new URL("./tokenReport.mjs", import.meta.url)), "--project", project, "--codex-home", codexHome, "--out", out, "--summary"], {
    encoding: "utf8", env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: codexHome },
  });
}

function csvCells(out) {
  const [header, row] = fs.readFileSync(path.join(out, "history.csv"), "utf8").trimEnd().split("\n").map(x => x.split(","));
  assert.equal(row.length, header.length);
  return key => row[header.indexOf(key)];
}

function varint(n) {
  const bytes = [];
  do { const byte = n % 128; n = Math.floor(n / 128); bytes.push(byte | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
const blob = (field, value) => {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
};
const number = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);

// All stores and their workspace URIs are synthetic and fixture-local.
function antigravityDb(root, project, name, usage, model = "gemini-3.8-flash", reqs = 1) {
  const dir = path.join(root, ".gemini", "antigravity", "conversations");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + ".db"), db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE trajectory_metadata_blob(id TEXT, data BLOB); CREATE TABLE gen_metadata(idx INTEGER, data BLOB)");
    db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?, ?)").run("main", blob(1, blob(1, pathToFileURL(project).href)));
    if (usage) {
      const counters = Buffer.concat(Object.entries(usage).map(([field, value]) => number(Number(field), value)));
      for (let i = 1; i <= reqs; i++) db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(i, blob(1, Buffer.concat([blob(19, model), blob(4, counters)])));
    }
  } finally { db.close(); }
  return file;
}

function codexObservation(project, codexHome) {
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const usage = { input_tokens: 80, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 100 };
  fs.writeFileSync(path.join(codexHome, "sessions", "main.jsonl"), [
    { type: "session_meta", timestamp, payload: { id: "scoped-codex", cwd: project, source: "vscode" } },
    { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
  ].map(row => JSON.stringify(row)).join("\n"));
}

test("CLI Codex-only fixture exposes observations, unknown costs and unchanged CSV positions", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "unique-project"), home = path.join(root, "codex"), out = path.join(root, "out");
  fs.mkdirSync(path.join(home, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const usage = { input_tokens: 80, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 100 };
  fs.writeFileSync(path.join(home, "sessions", "fixture.jsonl"), [
    { type: "session_meta", timestamp, payload: { id: "fixture-main", cwd: project, source: "vscode" } },
    { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    { type: "response_item", payload: { content: "SYNTHETIC_PRIVATE_SENTINEL" } },
  ].map(r => JSON.stringify(r)).join("\n"));
  const summary = runFixture(root, project, home, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8"), json = JSON.parse(fs.readFileSync(path.join(out, "codex-usage.json")));
  assert.equal(json.sessions[0].observed.total_tokens, 100); assert.equal(json.cost, null);
  assert.match(summary, /Codex observed, 1 sessions/); assert.match(summary, /cost unknown/);
  assert.match(summary, /Antigravity no source; costs and delegation unknown/);
  assert.equal(summary.trim().split("\n").length, 1);
  assert.match(report, /fixture-main.*100/); assert.match(report, /Claude Code usage unavailable/);
  assert.doesNotMatch(report, /window lasts|Same for weekly|kit looks healthy|saved nothing yet|Delegation isn't happening|\*\*\$0\.00\*\*/);
  assert.ok(![report, summary, JSON.stringify(json)].join().includes("SYNTHETIC_PRIVATE_SENTINEL"));
  const csv = fs.readFileSync(path.join(out, "history.csv"), "utf8").trimEnd().split("\n");
  assert.equal(csv.length, 2);
  const [header, row] = csv.map(x => x.split(","));
  assert.deepEqual(header, ["date", "days", "sessions", "spend_usd", "kit_overhead_usd", "delegation_savings_usd", "checkpoint_waste_usd", "spawns", "wasteful_spawns", "antigravity_usd", "baseline_usd", "saved_net_usd", "stretch_cc", "stretch_ag", "ag_same_tier_pct", "peak5h_usd", "kit_version"]);
  assert.equal(row.length, header.length); for (const i of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) assert.equal(row[i], "");
});

test("mixed Claude and Codex fixture retains known modeled prices without global delegation claims", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-mixed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true }); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(claudeDir, "fixture.jsonl"), JSON.stringify({ type: "assistant", timestamp, message: { id: "fixture-turn", model: "sonnet", usage: { input_tokens: 1000000, output_tokens: 100000 }, content: [] } }));
  const usage = { input_tokens: 80, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 100 };
  fs.writeFileSync(path.join(codexHome, "sessions", "worker.jsonl"), [
    { type: "session_meta", timestamp, payload: { id: "fixture-worker", cwd: project, parent_thread_id: "fixture-parent", source: { subagent: { thread_spawn: {} } } } },
    { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
  ].map(r => JSON.stringify(r)).join("\n"));
  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(out, "codex-usage.json")));
  assert.match(summary, /Claude 1 sessions, modeled spend \$4\.50/);
  assert.match(summary, /worker 1/); assert.equal(json.roles.worker, 1);
  assert.match(report, /fixture-worker.*worker.*100/);
  assert.doesNotMatch(report, /Delegation isn't happening|enforce it or drop|saved nothing yet/);
  const [header, row] = fs.readFileSync(path.join(out, "history.csv"), "utf8").trimEnd().split("\n").map(x => x.split(","));
  const cell = key => row[header.indexOf(key)];
  assert.equal(cell("sessions"), "1"); assert.equal(cell("spend_usd"), "4.50");
  assert.equal(cell("baseline_usd"), "7.50"); assert.equal(cell("spawns"), "0");
  for (const key of ["kit_overhead_usd", "delegation_savings_usd", "checkpoint_waste_usd", "saved_net_usd"]) assert.ok(Number.isFinite(Number(cell(key))) && cell(key) !== "");
  assert.equal(json.cost, null); assert.equal(json.uniqueTaskTotal, null);
});

for (const scenario of ["empty", "unrelated", "pre-window", "empty-and-corrupt"]) {
  test(`Antigravity ${scenario} storage has no matching usage or monetary conclusions`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-ag-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
    codexObservation(project, codexHome);
    const usage = { 2: 1000000, 3: 100000 };
    const file = antigravityDb(root, scenario === "unrelated" ? path.join(root, "other-project") : project, "fixture", scenario === "empty" || scenario === "empty-and-corrupt" ? null : usage);
    if (scenario === "pre-window") {
      const old = new Date(Date.now() - 60 * 86400000);
      fs.utimesSync(file, old, old);
    }
    if (scenario === "empty-and-corrupt") fs.writeFileSync(path.join(path.dirname(file), "corrupt.db"), "synthetic invalid SQLite");
    const summary = runFixture(root, project, codexHome, out);
    const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
    const json = JSON.parse(fs.readFileSync(path.join(out, "codex-usage.json")));
    assert.match(summary, /Antigravity no matching usage; costs and delegation unknown/);
    assert.match(report, /Antigravity: no matching usage observed for this project\/window/);
    assert.match(report, /Cost, overhead and delegation conclusions are unavailable/);
    assert.doesNotMatch(report, /\| Antigravity vs|\*\*\$0\.00\*\*|Total Antigravity kit overhead|Antigravity kit overhead:|No subagents spawned|### Delegation/);
    assert.doesNotMatch(summary, /\$|saved|overhead/);
    assert.match(report, /scoped-codex.*100/);
    assert.equal(json.sessions[0].observed.total_tokens, 100);
    if (scenario === "empty-and-corrupt") {
      assert.match(report, /1 unreadable DBs skipped; coverage is incomplete/);
      assert.match(summary, /1 unreadable DBs skipped; incomplete coverage/);
    }
    const cell = csvCells(out);
    for (const key of ["antigravity_usd", "stretch_ag", "ag_same_tier_pct"]) assert.equal(cell(key), "");
  });
}

test("Antigravity unreadable-only source remains distinct from absent and unmatched usage", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-corrupt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const dir = path.join(root, ".gemini", "antigravity", "conversations");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "corrupt.db"), "synthetic invalid SQLite");
  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.match(summary, /Antigravity not readable; costs and delegation unknown/);
  assert.match(report, /Antigravity: usage not readable/);
  assert.doesNotMatch(report, /\| Antigravity vs|No subagents spawned/);
  const cell = csvCells(out);
  for (const key of ["antigravity_usd", "stretch_ag", "ag_same_tier_pct"]) assert.equal(cell(key), "");
});

for (const [label, usage, cost, baseline, gross] of [
  ["known price", { 2: 1000000, 3: 100000 }, "0.80", "3.20", "2.40"],
  ["observed zero usage", { 2: 0, 3: 0 }, "0.00", "0.00", "0.00"],
]) {
  test(`Antigravity ${label} retains observed sessions and modeled numeric output`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-priced-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
    antigravityDb(root, project, "main", usage);
    const summary = runFixture(root, project, codexHome, out);
    const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
    assert.ok(summary.includes(`Antigravity modeled spend $${cost} (1 main, 0 sub; modeled overhead $`));
    assert.match(summary, /modeled delegation difference \$0\.00/);
    assert.match(report, /1 main sessions, 0 subagents with usage/);
    assert.match(report, /gemini-3\.8-flash \| 1 \|/);
    assert.ok(report.includes(`| Antigravity vs pro | $${cost} | $${baseline} | $${gross} |`));
    assert.match(report, /configured historical API list prices/);
    assert.doesNotMatch(report, /no matching usage observed/);
    const cell = csvCells(out);
    assert.equal(cell("antigravity_usd"), cost);
    if (cost === "0.80") {
      const comparison = report.split("\n").find(line => line.startsWith("| Antigravity vs pro |"));
      const overhead = Number(comparison.split("|")[5].trim().slice(1));
      const ratio = Number(cell("stretch_ag"));
      assert.ok(Math.abs(ratio - (3.20 - overhead) / 0.80) <= 0.02);
    } else assert.equal(cell("stretch_ag"), "");
    assert.equal(cell("ag_same_tier_pct"), "");
  });
}

test("AGT-81: model-prices.json prices gemini-4-argon-trial at argon rates (not flash) and Claude cachedInput rates", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-prices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  fs.mkdirSync(path.join(root, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "model-prices.json"), JSON.stringify({
    schemaVersion: 1, currency: "USD", unit: "per million tokens", service: "direct-api-standard-text", maxAgeDays: 30,
    entries: [
      { model: "claude-opus-5-5", rates: { input: 4, cachedInput: 0.2, output: 20 } },
      { model: "gemini-4-argon", rates: { input: 2, cachedInput: 0.1, output: 10 } },
      { model: "gemini-3.8-flash", rates: { input: 0.75, cachedInput: 0.075, output: 3.75 } },
    ],
  }));

  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  // Claude opus with 1M input, 1M cache read, 100k output -> (1M*4 + 1M*0.2 + 100k*20)/1e6 = $6.20 (legacy was $8.00)
  fs.writeFileSync(path.join(claudeDir, "session.jsonl"), JSON.stringify({
    type: "assistant", timestamp,
    message: { id: "turn-1", model: "opus", usage: { input_tokens: 1000000, cache_read_input_tokens: 1000000, output_tokens: 100000 }, content: [] }
  }));

  // Antigravity gemini-4-argon-trial with 1M input (2), 1M cache read (5), 100k output (3) -> (1M*2 + 1M*0.1 + 100k*10)/1e6 = $3.10 (flash rate would be $1.20)
  antigravityDb(root, project, "argon-session", { 2: 1000000, 5: 1000000, 3: 100000 }, "gemini-4-argon-trial");

  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");

  assert.match(summary, /Claude 1 sessions, modeled spend \$6\.20/);
  assert.match(summary, /Antigravity modeled spend \$3\.10/);
  assert.match(report, /gemini-4-argon-trial \| 1 \| 1,000,000 \| 0 \| 1,000,000 \| 100,000 \| 0 \| 0% \| \$3\.10/);
});

test("AGT-81: codexUsage matches child cwd and worktrees, computes modeled cost from model-prices, keeps guardian unpriced", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex");
  const pricesPath = path.join(root, "model-prices.json");
  fs.writeFileSync(pricesPath, JSON.stringify({
    schemaVersion: 1, currency: "USD", unit: "per million tokens", service: "direct-api-standard-text", maxAgeDays: 30,
    entries: [
      { model: "gpt-6.1-sol", rates: { input: 2, cachedInput: 0.1, output: 10 } },
    ],
  }));

  const subDir = path.join(project, "packages", "engine");
  const wtDir = path.join(project, ".claude", "worktrees", "worker-branch");
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });

  const timestamp = new Date(Date.now() - 1000).toISOString();
  // Session 1: child cwd worker with gpt-6.1-sol (input 1000, cached 200, output 100)
  // uncached 800 * 2 + cached 200 * 0.1 + output 100 * 10 = (1600 + 20 + 1000) / 1e6 = $0.00262
  const usage1 = { input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 10, total_tokens: 1100 };
  fs.writeFileSync(path.join(codexHome, "sessions", "worker.jsonl"), [
    { type: "session_meta", timestamp, payload: { id: "child-worker", cwd: subDir, source: { subagent: { thread_spawn: {} } } } },
    { type: "turn_context", timestamp, payload: { model: "gpt-6.1-sol" } },
    { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage1, last_token_usage: usage1 } } },
  ].map(r => JSON.stringify(r)).join("\n"));

  // Session 2: worktree guardian with codex-auto-review (unpriced)
  const usage2 = { input_tokens: 5000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 50, total_tokens: 5500 };
  fs.writeFileSync(path.join(codexHome, "sessions", "guardian.jsonl"), [
    { type: "session_meta", timestamp, payload: { id: "worktree-guardian", cwd: wtDir, source: { subagent: { other: "guardian" } } } },
    { type: "turn_context", timestamp, payload: { model: "codex-auto-review" } },
    { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage2, last_token_usage: usage2 } } },
  ].map(r => JSON.stringify(r)).join("\n"));

  const res = await readCodexUsage({ project, codexHome, pricesPath });
  assert.equal(res.sessions.length, 2);
  assert.equal(res.diagnostics.subdirFiles, 1);
  assert.equal(res.diagnostics.worktreeFiles, 1);
  assert.equal(res.pricedSessions, 1);
  assert.equal(res.unpricedSessions, 1);

  const s1 = res.sessions.find(s => s.id === "child-worker");
  assert.equal(s1.priced, true);
  assert.ok(Math.abs(s1.modeledCostUsd - 0.00262) < 0.000001);

  const s2 = res.sessions.find(s => s.id === "worktree-guardian");
  assert.equal(s2.priced, false);
  assert.equal(s2.modeledCostUsd, null);
  assert.equal(s2.unpricedReason, "guardian_role");
});

test("AGT-81: lastGate matches markdown-bolded, case-insensitive, and indented variants", () => {
  assert.equal(lastGate("**GATE:** pass"), "pass");
  assert.equal(lastGate("**GATE**: fail"), "fail");
  assert.equal(lastGate("Gate: PASS"), "pass");
  assert.equal(lastGate("  GATE: none"), "none");
  assert.equal(lastGate("`GATE: pass`"), "pass");
  assert.equal(lastGate("> **GATE**: pass"), "pass");
  assert.equal(lastGate("- **GATE**: fail <yarn tsc>"), "fail");
  assert.equal(lastGate("random response without gate line"), null);
});

test("notificationResults extracts task-notification results by tool-use id", () => {
  const block = (id, body) => `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<result>${body}</result>\n<usage>x</usage>\n</task-notification>`;
  const one = notificationResults(block("toolu_A", "done\n\nGATE: none"));
  assert.equal(one.length, 1); assert.equal(one[0].toolUseId, "toolu_A"); assert.equal(lastGate(one[0].result), "none");
  const two = notificationResults(block("toolu_A", "x\nGATE: pass") + "\n" + block("toolu_B", "y\nGATE: fail"));
  assert.deepEqual(two.map(r => r.toolUseId), ["toolu_A", "toolu_B"]);
  assert.deepEqual(two.map(r => lastGate(r.result)), ["pass", "fail"]);
  assert.deepEqual(notificationResults("plain user text, no notification"), []);
  assert.deepEqual(notificationResults(null), []);
});

test("routing outcomes count GATE lines delivered by background subagent task-notifications", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-async-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true }); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const rows = [
    { type: "assistant", timestamp, message: { id: "turn-1", model: "sonnet", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id: "toolu_ASYNC1", name: "Agent", input: { subagent_type: "worker", description: "impl", prompt: "do it" } }] } },
    { type: "user", timestamp, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_ASYNC1", content: "Async agent launched successfully." }] } },
    { type: "user", timestamp, origin: { kind: "task-notification" }, message: { role: "user", content: "<task-notification>\n<task-id>a838</task-id>\n<tool-use-id>toolu_ASYNC1</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n<result>Changed x.\n\nGATE: pass</result>\n<usage>total_tokens: 5</usage>\n</task-notification>" } },
  ];
  fs.writeFileSync(path.join(claudeDir, "async.jsonl"), rows.map(r => JSON.stringify(r)).join("\n"));
  runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.match(report, /1 of 1 implementation spawns carried a GATE line/);
});

test("gateLine returns the last GATE line with its command", () => {
  assert.deepEqual(gateLine("done\nGATE: pass node --test a.test.mjs"), { gate: "pass", cmd: "node --test a.test.mjs" });
  assert.deepEqual(gateLine("x\nGATE: fail first\n**GATE: pass \`yarn  tsc --noEmit\`**"), { gate: "pass", cmd: "yarn tsc --noEmit" });
  assert.deepEqual(gateLine("    > \`GATE: fail\` npm test"), { gate: "fail", cmd: "npm test" });
  assert.deepEqual(gateLine("ok\nGATE: none"), { gate: "none", cmd: "" });
  assert.deepEqual(gateLine("no gate here"), { gate: null, cmd: "" });
});

test("routing outcomes attribute each verifier to the worker whose command it reran", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-verifier-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true }); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const spawn = (id, type, extra, reply) => [
    { type: "assistant", timestamp, message: { id: "turn-" + id, model: "sonnet", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: type, description: id, prompt: "do it", ...extra } }] } },
    { type: "user", timestamp, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: reply }] } },
  ];
  const rows = [
    ...spawn("toolu_A", "worker", {}, "Changed a.\n\nGATE: pass node --test a.test.mjs"),
    ...spawn("toolu_B", "worker", { model: "opus" }, "Changed b.\n\nGATE: pass yarn tsc --noEmit"),
    ...spawn("toolu_V1", "verifier", {}, "Failed.\n\nGATE: fail node --test a.test.mjs"),
    ...spawn("toolu_V2", "verifier", {}, "Ok.\n\nGATE: pass yarn tsc --noEmit"),
    ...spawn("toolu_V3", "verifier", {}, "Ok.\n\nGATE: pass yarn tsc --noEmit"),
  ];
  fs.writeFileSync(path.join(claudeDir, "verifier.jsonl"), rows.map(r => JSON.stringify(r)).join("\n"));
  runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.ok(report.includes("| sonnet | 1 | 1 | 0 | n=1, collecting (need 10) | 1 | 1 |"), report);
  assert.ok(report.includes("| opus | 1 | 1 | 0 | n=1, collecting (need 10) | 1 | 0 |"), report);
});

// RPT-AGT-001: monolithic session heuristic (5+ distinct edited files, no implementation spawn; bookkeeping paths excluded)
test("monolithic sessions flag multi-file edits without implementation spawns", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-mono-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true }); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const edit = (sid, i, fp, name = "Edit") => ({ type: "assistant", timestamp, message: { id: `${sid}-t${i}`, model: "sonnet", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id: `${sid}-u${i}`, name, input: { file_path: fp } }] } });
  const win = p => p.split("/").join(String.fromCharCode(92)); // Windows-style paths exercise the backslash normalization
  const src = n => Array.from({ length: n }, (_, i) => win(`D:/proj/src/f${i}.ts`));
  const session = (sid, paths, extra = []) => fs.writeFileSync(path.join(claudeDir, sid + ".jsonl"), [...paths.map((p, i) => edit(sid, i, p)), ...extra].map(r => JSON.stringify(r)).join("\n"));
  const spawn = { type: "assistant", timestamp, message: { id: "mono-b-spawn", model: "sonnet", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id: "toolu_M", name: "Agent", input: { subagent_type: "worker", description: "impl", prompt: "do it" } }] } };
  const result = { type: "user", timestamp, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_M", content: "ok\n\nGATE: pass x" }] } };
  session("mono-a-flagged", [...src(4), win("D:/proj/src/f0.ts"), win("D:/proj/src/f4.ts")]); // 5 distinct (one repeat)
  session("mono-b-delegated", src(5), [spawn, result]);
  session("mono-c-bookkeeping", [...src(3), win("D:/proj/.agents/backlog/x.md"), win("D:/proj/.agents/STATE.md"), win("C:/u/.claude/projects/p/memory/m.md"), win("C:/tmp/scratchpad/s.mjs")]);
  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.match(summary, /Monolithic sessions: Claude 1\/3, Antigravity n\/a/);
  const start = report.indexOf("#### Monolithic sessions"), section = report.slice(start, report.indexOf("\n## ", start));
  assert.match(section, /at least 5 distinct files/);
  assert.ok(section.includes("| mono-a-f | sonnet | 5 |"), section);
  assert.ok(!section.includes("mono-b-d") && !section.includes("mono-c-b"), section);
});

test("monolithic sessions render the section even with no spawns and none flagged", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-mono-none-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  const claudeDir = path.join(root, ".claude", "projects", project.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(claudeDir, { recursive: true }); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const timestamp = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(claudeDir, "one.jsonl"), JSON.stringify({ type: "assistant", timestamp, message: { id: "t1", model: "sonnet", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "text", text: "hi" }] } }));
  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.match(summary, /Monolithic sessions: Claude 0\/1/);
  assert.match(report, /No Claude Code spawns observed[^\n]*\n+#### Monolithic sessions[\s\S]*None flagged in 1 sessions\./);
});

test("monolithic sessions flag Antigravity main sessions with many requests and no subagent", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-report-mono-ag-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), codexHome = path.join(root, "codex"), out = path.join(root, "out");
  antigravityDb(root, project, "busy", { 2: 1000, 3: 100 }, "gemini-3.8-flash", 40);
  antigravityDb(root, project, "quiet", { 2: 1000, 3: 100 }, "gemini-3.8-flash", 39);
  const summary = runFixture(root, project, codexHome, out);
  const report = fs.readFileSync(path.join(out, "token-report.md"), "utf8");
  assert.match(summary, /Antigravity 1\/2/);
  assert.ok(report.includes("| busy | gemini-3.8-flash | 40 |"), report);
  assert.ok(!report.includes("| quiet | gemini-3.8-flash |"), report);
});
