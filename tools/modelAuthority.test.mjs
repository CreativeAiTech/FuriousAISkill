import test from "node:test";
import assert from "node:assert/strict";
import { assess } from "./modelAuthority.mjs";

const NOW = "2026-10-27";
function table(score = 53) {
  return { authority: {
    benchmark: "AA Intelligence Index v4.3.2",
    checkedAt: NOW,
    maxAgeDays: 30,
    leaderScore: 58,
    thresholdPercent: 90,
    leaderSource: "https://artificialanalysis.ai/leaderboards/models",
    entries: [{ model: "gpt-6-astra", effort: "max", score,
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

test("53/58 qualifies and 52/58 does not; library preserves precision", () => {
  assert.equal(check(table(53)).eligible, true);
  assert.equal(check(table(53)).relativeScore, 53 / 58 * 100);
  assert.equal(check(table(53)).rawScore, 53);
  denied(table(52), /below/);
  denied(table(52.1999), /below/);
  assert.equal(check(table(52.2)).eligible, true);
});

test("exact case-insensitive pair only, with no aliases, regexes, or effort inheritance", () => {
  assert.equal(check(table(), "GPT-6-ASTRA", "MAX").eligible, true);
  denied(table(), /Unknown model/, "gpt-6-astra-preview");
  denied(table(), /Unknown model/, "^gpt-6-astra$");
  denied(table(), /never inherited/, "gpt-6-astra", "high");
  denied(table(), /never inherited/, "gpt-6-astra", "ultra");
  denied(table(), /Unknown model/, "gpt-6.1-sol");
  denied(table(), /Unknown model/, " gpt-6-astra");
});

test("medium and other low efforts never qualify even at the leader score", () => {
  for (const effort of ["none", "low", "medium", "default"]) {
    const data = table(58);
    data.authority.entries[0].effort = effort;
    denied(data, /requires an exact high/, "gpt-6-astra", effort);
  }
  for (const effort of ["high", "xhigh", "max", "ultra"]) {
    const data = table(58);
    data.authority.entries[0].effort = effort;
    assert.equal(check(data, "gpt-6-astra", effort).eligible, true);
  }
});

test("unknown or absent effort and model fail closed", () => {
  for (const effort of ["highest", "auto", "MAX ", "", undefined, null, 1]) {
    denied(table(), /Unknown effort/, "gpt-6-astra", effort === undefined ? null : effort);
  }
  assert.equal(assess(undefined, "max", table(), { now: NOW }).eligible, false);
  assert.equal(assess("gpt-6-astra", undefined, table(), { now: NOW }).eligible, false);
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
});

test("leader, age and threshold are strict finite numeric metadata", () => {
  for (const leader of [null, undefined, NaN, Infinity, -1, 0, "58"]) {
    const data = table();
    data.authority.leaderScore = leader;
    denied(data, /Leader score/);
  }
  for (const age of [null, undefined, NaN, Infinity, -1, 0, "30"]) {
    const data = table();
    data.authority.maxAgeDays = age;
    denied(data, /maxAgeDays/);
  }
  for (const threshold of [null, undefined, NaN, Infinity, 89.999, 101, "90"]) {
    const data = table();
    data.authority.thresholdPercent = threshold;
    denied(data, /thresholdPercent/);
  }
  const stricter = table(53);
  stricter.authority.thresholdPercent = 92;
  denied(stricter, /below/);
  stricter.authority.entries[0].score = 58;
  stricter.authority.thresholdPercent = 100;
  assert.equal(check(stricter).eligible, true);
});

test("evidence dates are real UTC calendar dates, current, and not future dated", () => {
  for (const date of [undefined, null, "", "2026-02-30", "2026-13-01", "2026-10-27T00:00:00Z", "2026-1-1"]) {
    const data = table();
    data.authority.checkedAt = date;
    denied(data, /invalid UTC date/);
  }
  const future = table();
  future.authority.checkedAt = "2026-10-28";
  denied(future, /future/);
  const stale = table();
  stale.authority.checkedAt = "2026-09-26";
  denied(stale, /stale/);
  stale.authority.checkedAt = "2026-09-27";
  assert.equal(check(stale).eligible, true);
  denied(table(), /invalid UTC date/, "gpt-6-astra", "max", "invalid");
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

test("a lowered denominator cannot ignore a higher recorded model", () => {
  const data = table();
  data.authority.entries.push({ model: "leader", effort: "max", score: 59 });
  denied(data, /Leader score is lower/);
});
