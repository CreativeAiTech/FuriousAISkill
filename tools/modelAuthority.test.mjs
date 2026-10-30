import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assess, brainCheck } from "./modelAuthority.mjs";

const NOW = "2026-10-27";
const SCRIPT = fileURLToPath(new URL("./modelAuthority.mjs", import.meta.url));
const shipped = JSON.parse(fs.readFileSync(new URL("../model-ranks.json", import.meta.url), "utf8"));
const shippedPrices = JSON.parse(fs.readFileSync(new URL("../model-prices.json", import.meta.url), "utf8"));

function table(score = 53, effort = "max") {
  return { authority: {
    benchmark: "AA Intelligence Index v4.3.2",
    checkedAt: NOW,
    leaderScore: 58,
    bar: { percent: 85, ofLeaderScore: 58, score: 49.3 },
    leaderSource: "https://artificialanalysis.ai/leaderboards/models",
    entries: [{ model: "gpt-6-astra", effort, score,
      source: "https://artificialanalysis.ai/models/gpt-6-astra", configuration: "max reasoning effort" }],
  } };
}
const check = (data, model = "gpt-6-astra", effort = "max", now = NOW) => assess(model, effort, data, { now });
const denied = (data, pattern, model, effort, now) => {
  const result = check(data, model, effort, now);
  assert.equal(result.eligible, false);
  if (pattern) assert.match(result.reason, pattern);
  return result;
};
const verdict = (model, effort) => brainCheck(model, effort, shipped, shippedPrices, { now: NOW });

test("the frozen bar is 49.3 absolute points: 49.3 qualifies and 49.29 does not", () => {
  assert.equal(check(table(49.3)).eligible, true);
  denied(table(49.29), /below the brain bar/);
  const ok = check(table(53));
  assert.equal(ok.eligible, true);
  assert.equal(ok.rawScore, 53);
  assert.equal(ok.barScore, 49.3);
  assert.equal(ok.relativeScore, 53 / 58 * 100);
});

test("shipped table: Opus medium 51 is a brain; Fable medium 49, flash 41, sonnet high 47 are not; sonnet max 56 is", () => {
  assert.equal(shipped.authority.bar.score, 49.3);
  assert.equal(verdict("claude-opus-5-5", "medium").brain, true);
  assert.equal(verdict("claude-fable-5-1", "medium").brain, false);
  assert.equal(verdict("claude-fable-5-1", "medium").score, 49);
  assert.equal(verdict("gemini-3.8-flash", "high").brain, false);
  assert.equal(verdict("gemini-3.8-flash", "high").score, 41);
  assert.equal(verdict("claude-sonnet-5-5", "high").brain, false);
  assert.equal(verdict("claude-sonnet-5-5", "high").score, 47);
  assert.equal(verdict("claude-sonnet-5-5", "max").brain, true);
  assert.equal(verdict("claude-sonnet-5-5", "max").score, 56);
});

test("score at the exact listed effort alone decides: no high-effort floor, no inheritance", () => {
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max", "ultra"]) {
    const data = table(58, effort);
    assert.equal(check(data, "gpt-6-astra", effort).eligible, true);
    for (const other of ["none", "low", "medium", "high", "xhigh", "max", "ultra"]) {
      if (other !== effort) denied(data, /never inherited/, "gpt-6-astra", other);
    }
  }
  assert.equal(verdict("gpt-6-astra", "medium").brain, true);
  assert.equal(verdict("gpt-6.1-sol", "medium").brain, false);
});

test("exact case-insensitive pair only, with no aliases or regexes", () => {
  assert.equal(check(table(), "GPT-6-ASTRA", "MAX").eligible, true);
  denied(table(), /Unknown model/, "gpt-6-astra-preview");
  denied(table(), /Unknown model/, "^gpt-6-astra$");
  denied(table(), /Unknown model/, "gpt-6.1-sol");
  denied(table(), /Unknown model/, " gpt-6-astra");
});

test("default, unreported, unknown and absent efforts never qualify", () => {
  denied(table(58, "default"), /Effort default never qualifies/, "gpt-6-astra", "default");
  denied(table(58, "unreported"), /Unknown effort/, "gpt-6-astra", "unreported");
  for (const effort of ["highest", "auto", "MAX ", "", undefined, null, 1]) {
    denied(table(), /Unknown effort/, "gpt-6-astra", effort === undefined ? null : effort);
  }
  assert.equal(assess(undefined, "max", table(), { now: NOW }).eligible, false);
  assert.equal(assess("gpt-6-astra", undefined, table(), { now: NOW }).eligible, false);
  assert.equal(verdict("qwen3.8-max-0902", "unreported").brain, false);
  assert.equal(verdict("kimi-k3-1-pro", "unreported").brain, false);
  assert.equal(verdict("claude-opus-5-5", "default").brain, false);
});

test("missing and null scores are unverified; invalid scores fail closed", () => {
  const missing = table();
  delete missing.authority.entries[0].score;
  for (const data of [missing, table(null)]) {
    const result = denied(data, /Unverified/);
    assert.equal(result.rawScore, null);
    assert.equal(result.relativeScore, null);
  }
  for (const score of [NaN, Infinity, -Infinity, -1, 58.1, "53", {}, false]) {
    const result = denied(table(score), /Model score|Leader score is lower/);
    assert.equal(result.relativeScore, null);
  }
  assert.equal(check(table(0)).rawScore, 0);
  assert.equal(check(table(0)).eligible, false);
});

test("bar validation: percent below the 85 code floor, mismatched score and bad fields are rejected", () => {
  for (const percent of [84, 84.99, 0, -1, 101, NaN, Infinity, null, undefined, "85"]) {
    const data = table();
    data.authority.bar = { percent, ofLeaderScore: 58, score: 49.3 };
    denied(data, /bar\.percent/);
  }
  const lowered = table(45);
  lowered.authority.bar = { percent: 84, ofLeaderScore: 58, score: 48.72 };
  denied(lowered, /bar\.percent/);
  for (const score of [40, 49.36, 49.24, 58.1, NaN, null, undefined, "49.3"]) {
    const data = table();
    data.authority.bar.score = score;
    denied(data, /bar\.score/);
  }
  for (const ofLeaderScore of [0, -58, NaN, null, undefined, "58"]) {
    const data = table();
    data.authority.bar.ofLeaderScore = ofLeaderScore;
    denied(data, /bar\.ofLeaderScore/);
  }
  const noBar = table();
  delete noBar.authority.bar;
  denied(noBar, /bar configuration/);
  const above = table();
  above.authority.leaderScore = 49;
  above.authority.bar = { percent: 100, ofLeaderScore: 50, score: 50 };
  denied(above, /bar\.score must not exceed/);
  const stricter = table(53);
  stricter.authority.bar = { percent: 92, ofLeaderScore: 58, score: 53.36 };
  denied(stricter, /below the brain bar/);
  stricter.authority.entries[0].score = 54;
  assert.equal(check(stricter).eligible, true);
});

test("a new leader on the same benchmark does not move the frozen bar", () => {
  const data = structuredClone(shipped);
  data.authority.leaderScore = 62;
  data.authority.entries.push({ provider: "Test", model: "new-leader", effort: "max", score: 62,
    source: "https://example.com/new-leader", configuration: "test" });
  const result = brainCheck("claude-opus-5-5", "medium", data, shippedPrices, { now: NOW });
  assert.equal(result.brain, true);
  assert.equal(result.barScore, 49.3);
  assert.equal(result.relativeScore, 51 / 62 * 100);
  assert.equal(brainCheck("claude-fable-5-1", "medium", data, shippedPrices, { now: NOW }).brain, false);
});

test("leader metadata is strict and a lowered denominator cannot ignore a higher recorded model", () => {
  for (const leader of [null, undefined, NaN, Infinity, -1, 0, "58"]) {
    const data = table();
    data.authority.leaderScore = leader;
    denied(data, /Leader score/);
  }
  const data = table();
  data.authority.entries.push({ model: "leader", effort: "max", score: 59 });
  denied(data, /Leader score is lower/);
});

test("no expiry: very old evidence stays eligible, but future-dated or malformed dates are rejected", () => {
  const old = table();
  old.authority.checkedAt = "2020-01-01";
  assert.equal(check(old).eligible, true);
  assert.equal(check(old, "gpt-6-astra", "max", "2036-10-27").eligible, true);
  const future = table();
  future.authority.checkedAt = "2026-10-28";
  denied(future, /future/);
  future.authority.checkedAt = NOW;
  assert.equal(check(future).eligible, true);
  for (const date of [undefined, null, "", "2026-02-30", "2026-13-01", "2026-10-27T00:00:00Z", "2026-1-1"]) {
    const data = table();
    data.authority.checkedAt = date;
    denied(data, /invalid UTC date/);
  }
  denied(table(), /invalid UTC date/, "gpt-6-astra", "max", "invalid");
  const legacy = table();
  legacy.authority.maxAgeDays = 30;
  legacy.authority.checkedAt = "2020-01-01";
  assert.equal(check(legacy).eligible, true);
});

test("missing or malformed evidence configuration fails closed", () => {
  for (const data of [undefined, null, {}, [], { authority: [] }, { authority: "yes" }]) {
    denied(data, /configuration/);
  }
  for (const [field, value, pattern] of [
    ["benchmark", "AA Intelligence Index v4", /benchmark/],
    ["leaderSource", "", /leader source/],
    ["leaderSource", "javascript:alert(1)", /leader source/],
    ["entries", null, /authority entries/],
  ]) {
    const data = table();
    data.authority[field] = value;
    denied(data, pattern);
  }
  for (const [field, value, pattern] of [
    ["source", "", /score source/], ["source", "not-a-url", /score source/],
    ["configuration", "", /configuration/], ["configuration", {}, /configuration/],
  ]) {
    const data = table();
    data.authority.entries[0][field] = value;
    denied(data, pattern);
  }
});

test("duplicate matching evidence fails, unrelated entries do not grant or remove authority", () => {
  const duplicate = table();
  duplicate.authority.entries.push({ ...duplicate.authority.entries[0], model: "GPT-6-ASTRA", effort: "MAX" });
  denied(duplicate, /Duplicate/);
  const unrelated = table();
  unrelated.authority.entries.push(null, { model: "other", effort: "max", score: null });
  assert.equal(check(unrelated).eligible, true);
  denied(unrelated, /source/, "other");
});

test("default clock uses the runtime UTC day", () => {
  const data = table();
  data.authority.checkedAt = new Date().toISOString().slice(0, 10);
  assert.equal(assess("gpt-6-astra", "max", data).eligible, true);
});

test("tiers: preferred, eligible and overkill come from the listing, only for real brains", () => {
  assert.equal(verdict("claude-opus-5-5", "medium").tier, "preferred");
  assert.equal(verdict("claude-opus-5-5", "high").tier, "eligible");
  assert.equal(verdict("claude-opus-5-5", "xhigh").tier, "overkill");
  assert.equal(verdict("claude-opus-5-5", "max").tier, "overkill");
  assert.equal(verdict("claude-fable-5-1", "high").tier, "overkill");
  assert.equal(verdict("gpt-6.1-sol", "high").tier, "preferred");
  assert.equal(verdict("gpt-6.1-sol", "xhigh").tier, "eligible");
  assert.equal(verdict("gpt-6.1-sol", "max").tier, "overkill");
  assert.equal(verdict("gpt-6-astra", "medium").tier, "overkill");
  assert.equal(verdict("gemini-4-argon", "high").tier, "preferred");
  assert.equal(verdict("muse-wonder-full", "max").tier, "eligible");
  assert.equal(verdict("claude-fable-5-1", "medium").tier, null);
});

test("listing a non-eligible model as preferred or overkill grants nothing", () => {
  const data = structuredClone(shipped);
  data.brains["claude-code"].preferred.push({ model: "claude-fable-5-1", effort: "medium" });
  data.brains["claude-code"].overkill.push({ model: "claude-sonnet-5-5", effort: "high" });
  data.brains["claude-code"].preferred.push({ model: "claude-haiku-5-5", effort: "max" });
  for (const [model, effort] of [["claude-fable-5-1", "medium"], ["claude-sonnet-5-5", "high"], ["claude-haiku-5-5", "max"]]) {
    const result = brainCheck(model, effort, data, shippedPrices, { now: NOW });
    assert.equal(result.brain, false);
    assert.equal(result.tier, null);
    assert.equal(result.permissions.decide, false);
    assert.equal(result.permissions.merge, false);
  }
  const bare = structuredClone(shipped);
  delete bare.brains;
  delete bare.models;
  const open = brainCheck("claude-opus-5-5", "medium", bare, shippedPrices, { now: NOW });
  assert.equal(open.brain, true);
  assert.equal(open.tier, "eligible");
  assert.equal(open.codeName, null);
});

test("permissions are derived: brain shape", () => {
  const result = verdict("claude-opus-5-5", "medium");
  assert.equal(result.codeName, "opus-5.5");
  assert.deepEqual(result.tools, ["claude-code"]);
  assert.equal(result.barScore, 49.3);
  assert.equal(result.score, 51);
  const p = result.permissions;
  assert.equal(p.decide, true);
  assert.equal(p.review, "any");
  assert.equal(p.merge, "with-user-authorization");
  assert.equal(p.pushMain, true);
  assert.equal(p.forcePushMain, "force-with-lease-and-owner-ok");
  assert.deepEqual(p.escalateTo, ["opus-5.5@xhigh", "opus-5.5@max", "fable-5.1@high", "fable-5.1@xhigh", "fable-5.1@max"]);
  assert.ok(p.delegateTo.includes("opus-5.5") && p.delegateTo.includes("haiku-5.5") && p.delegateTo.includes("sonnet-5.5"));
  assert.ok(!p.delegateTo.includes("fable-5.1") && !p.delegateTo.includes("astra-6"));
  assert.deepEqual(p.delegateTo, [...p.delegateTo].sort());
});

test("permissions are derived: non-brain shape", () => {
  const result = verdict("gpt-6.1-sol", "medium");
  assert.equal(result.brain, false);
  assert.equal(result.codeName, "sol-6.1");
  const p = result.permissions;
  assert.equal(p.decide, false);
  assert.equal(p.review, "bounded");
  assert.equal(p.merge, false);
  assert.equal(p.pushMain, "bookkeeping-fast-forward-only");
  assert.equal(p.forcePushMain, false);
  assert.deepEqual(p.escalateTo, ["sol-6.1@high"]);
  assert.ok(p.delegateTo.includes("sol-6.1") && p.delegateTo.includes("luna-6"));
  assert.ok(!p.delegateTo.includes("opus-5.5") && !p.delegateTo.includes("astra-6"));
  const unknown = brainCheck("nope", "high", shipped, shippedPrices, { now: NOW });
  assert.equal(unknown.brain, false);
  assert.equal(unknown.codeName, null);
  assert.deepEqual(unknown.tools, []);
  assert.deepEqual(unknown.permissions.escalateTo, []);
  assert.deepEqual(unknown.permissions.delegateTo, []);
});

test("permissions never come from JSON: injected permission fields are ignored", () => {
  const data = structuredClone(shipped);
  data.models["claude-fable-5-1"].permissions = { decide: true };
  data.authority.entries.find((e) => e.model === "claude-fable-5-1" && e.effort === "medium").permissions = { decide: true };
  const result = brainCheck("claude-fable-5-1", "medium", data, shippedPrices, { now: NOW });
  assert.equal(result.brain, false);
  assert.equal(result.permissions.decide, false);
});

test("price failure never changes the verdict", () => {
  const unusable = [undefined, null, "x", {}, { entries: null }, { entries: [null, { model: "claude-opus-5-5", rates: { output: "20" } }] },
    { entries: [{ model: "claude-haiku-5-5", rates: { output: 0.5 } }] }];
  for (const prices of unusable) {
    const brain = brainCheck("claude-opus-5-5", "medium", shipped, prices, { now: NOW });
    assert.equal(brain.brain, true);
    assert.equal(brain.tier, "preferred");
    assert.deepEqual(brain.permissions.delegateTo, []);
    assert.equal(brain.permissions.decide, true);
    const worker = brainCheck("gpt-6.1-sol", "medium", shipped, prices, { now: NOW });
    assert.equal(worker.brain, false);
    assert.deepEqual(worker.permissions.delegateTo, []);
  }
  assert.deepEqual(brainCheck("claude-opus-5-5", "medium", shipped, undefined, { now: NOW }).permissions.delegateTo, []);
});

function run(args, extra = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", ...extra });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test("CLI check exits 0 for a brain, 2 for a non-brain or unknown model, 1 for usage and read errors", () => {
  const brain = run(["check", "claude-opus-5-5", "--effort", "medium"]);
  assert.equal(brain.code, 0);
  const json = JSON.parse(brain.out);
  assert.equal(json.brain, true);
  assert.equal(json.tier, "preferred");
  assert.equal(json.relativeScore, 87.93);
  assert.equal(run(["check", "gemini-3.8-flash", "--effort", "high"]).code, 2);
  assert.equal(JSON.parse(run(["check", "gemini-3.8-flash", "--effort", "high"]).out).brain, false);
  assert.equal(run(["check", "nope", "--effort", "high"]).code, 2);
  assert.equal(run(["check", "claude-opus-5-5", "--effort", "default"]).code, 2);
  for (const args of [["check"], ["check", "--effort", "high"], ["check", "claude-opus-5-5"], ["check", "claude-opus-5-5", "--effort"],
    ["check", "claude-opus-5-5", "--effort", "high", "--bogus", "x"], ["check", "claude-opus-5-5", "--effort", "high", "--effort", "max"]]) {
    const result = run(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.match(JSON.parse(result.err).error, /Usage/);
  }
  const missing = run(["check", "claude-opus-5-5", "--effort", "medium", "--table", path.join(os.tmpdir(), "no-such-table.json")]);
  assert.equal(missing.code, 1);
  assert.ok(JSON.parse(missing.err).error);
});

test("CLI check honours --table and --prices; broken prices keep the verdict", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "furious-authority-"));
  try {
    const tableFile = path.join(dir, "table.json");
    fs.writeFileSync(tableFile, JSON.stringify(table(53)));
    assert.equal(run(["check", "gpt-6-astra", "--effort", "max", "--table", tableFile]).code, 0);
    assert.equal(run(["check", "claude-opus-5-5", "--effort", "medium", "--table", tableFile]).code, 2);
    fs.writeFileSync(tableFile, "{not json");
    assert.equal(run(["check", "gpt-6-astra", "--effort", "max", "--table", tableFile]).code, 1);
    const pricesFile = path.join(dir, "prices.json");
    fs.writeFileSync(pricesFile, "{broken");
    const broken = run(["check", "claude-opus-5-5", "--effort", "medium", "--prices", pricesFile]);
    assert.equal(broken.code, 0);
    assert.deepEqual(JSON.parse(broken.out).permissions.delegateTo, []);
    const absent = run(["check", "claude-opus-5-5", "--effort", "medium", "--prices", path.join(dir, "none.json")]);
    assert.equal(absent.code, 0);
    fs.writeFileSync(pricesFile, JSON.stringify({ entries: [{ model: "claude-opus-5-5", rates: { output: 20 } }, { model: "claude-haiku-5-5", rates: { output: 0.5 } }] }));
    const custom = run(["check", "claude-opus-5-5", "--effort", "medium", "--prices", pricesFile]);
    assert.deepEqual(JSON.parse(custom.out).permissions.delegateTo, ["haiku-5.5", "opus-5.5"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy positional CLI form still works and reports the bar", () => {
  const ok = run(["claude-opus-5-5", "--effort", "medium"]);
  assert.equal(ok.code, 0);
  const json = JSON.parse(ok.out);
  assert.equal(json.eligible, true);
  assert.equal(json.barScore, 49.3);
  assert.equal(run(["claude-fable-5-1", "--effort", "medium"]).code, 2);
  assert.equal(run([]).code, 1);
  assert.equal(run(["claude-opus-5-5"]).code, 1);
});
