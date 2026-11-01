import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = fileURLToPath(new URL("./memoryHygiene.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "memhyg-"));
const repo = path.join(root, "repo"), mem = path.join(root, "mem"), idxOut = path.join(root, "out", "index.md");
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const note = (file, name, desc, body, type = "feedback") =>
  w(path.join(mem, file), `---\nname: ${name}\ndescription: "${desc}"\nmetadata:\n  node_type: memory\n  type: ${type}\n  modified: 2026-10-31T10:00:00.000Z\n---\n\n${body}\n`);
const run = (...a) => spawnSync(process.execPath, [tool, "--memory", mem, "--repo", repo, "--store", path.join(root, "store"), ...a], { encoding: "utf8" });
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: "ignore" });

const RULE = "Session titles: `[A] X-1 short task` rank first so the owner can react; no rank, ID first";
test.before(() => {
  w(path.join(repo, "CLAUDE.md"), `# Rules\n\n${RULE}; no ticket: the short task only.\n\n| Before you | Read |\n| --- | --- |\n| start a Codex session | codex.md |\n`);
  w(path.join(repo, ".agents/rules/codex.md"), "codex\n");
  w(path.join(repo, "tools/exists.mjs"), "//\n");
  execFileSync("git", ["init", "-q", "-b", "main", repo]); git("add", "-A"); git("commit", "-qm", "init");
  note("proj.md", "proj", "Project branch notes", "Project uses `master` for pushes.\n\n**Why:** On 2026-10-23 someone pushed it to master by mistake.");
  note("unlinked.md", "unlinked", "Not in the index yet", "Some body text about nothing.");
  note("mismatch.md", "other-name", "Name differs from stem", "Body.");
  note("dup-a.md", "dup-a", "Alpha bravo charlie delta", "Always remember quarterly planning meetings produce roadmap documents including budget allocations and staffing proposals.");
  note("dup-b.md", "dup-b", "Alpha bravo charlie delta", "Always remember quarterly planning meetings produce roadmap documents including budget allocations and staffing estimates.");
  note("rule.md", "rule", "Titles", `${RULE}; no ticket: the short task only.`);
  note("caveat.md", "caveat", "Temporary", "Keep this workaround until CLAUDE.md is updated to say so.");
  note("env-pro-session-limit.md", "env-pro-session-limit", "Plan is now Max (2026-10-31; was Pro, which hit limits)", "Body.", "reference");
  note("codex-note.md", "codex-note", "Tools", "Codex is cancelled for this project.", "user");
  note("paths.md", "paths", "Paths", "See `tools/exists.mjs` and `tools/missing.mjs` for details. Links [[proj]] and [[ghost]].", "project");
  note("untyped.md", "untyped", "No type", "x");
  fs.writeFileSync(path.join(mem, "untyped.md"), fs.readFileSync(path.join(mem, "untyped.md"), "utf8").replace("  type: feedback\n", ""));
  const links = ["proj", "mismatch", "dup-a", "dup-b", "rule", "caveat", "env-pro-session-limit", "codex-note", "paths", "untyped"].map((n) => `- [${n}](${n}.md) — hook`);
  w(path.join(mem, "MEMORY.md"), `${links.join("\n")}\n- [Gone](gone.md) — dead\n`);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const report = () => JSON.parse(run("--json").stdout);
const has = (r, check, file, rx) => r.findings.some((f) => f.check === check && f.file === file && (!rx || rx.test(f.evidence)));

test("findings cover each check and carry file:line + evidence", () => {
  const r = report();
  assert.ok(has(r, "stale-branch", "proj.md", /master/));
  assert.ok(!r.findings.some((f) => f.check === "stale-branch" && /On 2026-10-23/.test(f.evidence)));
  assert.ok(has(r, "index", "unlinked.md"));
  assert.ok(has(r, "index", "MEMORY.md", /gone\.md/));
  assert.ok(has(r, "index", "mismatch.md", /other-name/));
  assert.ok(r.findings.some((f) => f.check === "duplicate" && f.file === "dup-a.md" && f.other === "dup-b.md"));
  assert.ok(has(r, "restates-rule", "rule.md"));
  assert.ok(has(r, "conditional-caveat", "caveat.md"));
  assert.ok(r.findings.find((f) => f.check === "conditional-caveat").proposal.includes("CLAUDE.md"));
  assert.ok(has(r, "filename-drift", "env-pro-session-limit.md"));
  assert.ok(has(r, "retired-but-routed", "codex-note.md", /Codex/));
  assert.ok(has(r, "stale-path", "paths.md", /missing\.mjs/));
  assert.ok(!r.findings.some((f) => f.check === "stale-path" && /exists\.mjs`? and/.test(f.proposal)));
  assert.equal(r.findings.filter((f) => f.check === "stale-path").length, 1);
  for (const f of r.findings) { assert.ok(f.file); assert.ok(Number.isInteger(f.line) && f.line > 0); assert.ok(f.evidence); }
});

test("report mode writes nothing; first line is the summary", () => {
  const out = run().stdout;
  assert.match(out.split("\n")[0], /^memory hygiene: \d+ findings \(.*\) · 0 safe fixes applied$/);
  assert.equal(fs.existsSync(path.join(mem, ".hygiene-backup")), false);
});

test("--fix appends the missing index line, backs up, logs, and is idempotent", () => {
  const before = fs.readFileSync(path.join(mem, "MEMORY.md"), "utf8");
  const r1 = JSON.parse(run("--json", "--fix").stdout);
  assert.deepEqual(r1.fixes, [{ action: "append-index-line", file: "unlinked.md" }]);
  const after = fs.readFileSync(path.join(mem, "MEMORY.md"), "utf8");
  assert.ok(after.startsWith(before) && after.includes("- [unlinked](unlinked.md) — Not in the index yet"));
  const bdir = path.join(mem, ".hygiene-backup");
  const stamps = fs.readdirSync(bdir).filter((d) => d !== "hygiene.log");
  assert.equal(stamps.length, 1);
  assert.ok(fs.existsSync(path.join(bdir, stamps[0], "proj.md")));
  assert.match(fs.readFileSync(path.join(bdir, "hygiene.log"), "utf8"), /append-index-line unlinked\.md/);
  const r2 = JSON.parse(run("--json", "--fix").stdout);
  assert.deepEqual(r2.fixes, []);
  assert.equal(fs.readFileSync(path.join(mem, "MEMORY.md"), "utf8"), after);
  assert.equal(fs.readdirSync(bdir).length, 2);
});

test("--index-out writes a grouped index outside the memory dir", () => {
  const r = JSON.parse(run("--json", "--index-out", idxOut).stdout);
  assert.ok(r.sizes.indexTokens > 0);
  const t = fs.readFileSync(idxOut, "utf8");
  assert.match(t.split("\n")[0], /^memory index \d{4}-\d{2}-\d{2}: 11 memories \(.*\) · ~\d+ tokens \(chars\/4\) for MEMORY\.md$/);
  assert.ok(t.indexOf("## user") < t.indexOf("## feedback") && t.indexOf("## reference") < t.indexOf("## untyped"));
  assert.match(t, /- paths \(paths\.md, modified 2026-10-31\) — Paths · links: \[\[proj\]\], \[\[ghost\]\]\?/);
  assert.notEqual(run("--index-out", path.join(mem, "x.md")).status, 0);
});

test("invalid args exit 2; missing memory dir exits 0", () => {
  assert.equal(spawnSync(process.execPath, [tool, "--bogus"]).status, 2);
  const r = spawnSync(process.execPath, [tool, "--memory", path.join(root, "nope")], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no memory dir/);
});

// ---- review fixes (FAS-128)
import { insideDir, encodeLink } from "./memoryHygiene.mjs";
const mk = (name, files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "memhyg2-")), m = path.join(d, name);
  for (const [f, t] of Object.entries(files)) w(path.join(m, f), t);
  return { d, m };
};
const fm = (n, desc = "d") => `---\nname: ${n}\ndescription: "${desc}"\nmetadata:\n  type: user\n---\n\nbody\n`;
const cli = (m, ...a) => spawnSync(process.execPath, [tool, "--memory", m, "--repo", repo, "--store", path.join(root, "store"), ...a], { encoding: "utf8" });

test("insideDir is case-folded on win32 and handles ..", () => {
  const { d, m } = mk("mem", { "a.md": fm("a") });
  assert.equal(insideDir(m, path.join(m, "x", "y.md")), true);
  assert.equal(insideDir(m, m), true);
  assert.equal(insideDir(m, path.join(d, "mem2", "x.md")), false);
  assert.equal(insideDir(m, path.join(m, "..", "x.md")), false);
  if (process.platform === "win32") assert.equal(insideDir(m, path.join(m.toUpperCase(), "x.md")), true);
});

test("--out / --index-out inside the memory dir exit 2 and nothing is written (also with --fix)", () => {
  const { m } = mk("mem", { "a.md": fm("a"), "MEMORY.md": "" });
  const upper = process.platform === "win32" ? m.toUpperCase() : m;
  for (const flag of ["--out", "--index-out"]) for (const target of [path.join(m, "r.md"), path.join(upper, "r2.md")]) {
    const r = cli(m, "--fix", flag, target);
    assert.equal(r.status, 2);
    assert.equal(fs.existsSync(target), false);
  }
  assert.equal(fs.existsSync(path.join(m, ".hygiene-backup")), false);
  assert.equal(fs.readFileSync(path.join(m, "MEMORY.md"), "utf8"), "");
});

test("bad --out with --fix has no side effects; --memory as a file exits 2", () => {
  const { d, m } = mk("mem", { "a.md": fm("a"), "MEMORY.md": "" });
  assert.equal(cli(m, "--fix", "--out", d).status, 2); // a directory
  assert.equal(fs.existsSync(path.join(m, ".hygiene-backup")), false);
  assert.equal(fs.readFileSync(path.join(m, "MEMORY.md"), "utf8"), "");
  const r = cli(path.join(m, "a.md"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a directory/);
});

test("odd filenames: encoded link, no duplicates on a second --fix, CRLF kept, atomic", () => {
  const files = { "a b (1).md": fm("a b (1)", "spaced"), "p%20q.md": fm("p%20q", ""), "anch.md": fm("anch"), "titled.md": fm("titled"), "angle one.md": fm("angle one"), "paren (x).md": fm("paren (x)"), "MEMORY.md": "- [anch](anch.md#top) — x\r\n- [t](titled.md \"Title\") — x\r\n- [ang](<angle one.md>) — x\r\n- [pp](paren (x).md) — raw parens\r\n" };
  const { m } = mk("mem", files);
  const r1 = JSON.parse(cli(m, "--json", "--fix").stdout);
  assert.deepEqual(r1.fixes.map((x) => x.file).sort(), ["a b (1).md", "p%20q.md"]);
  const t = fs.readFileSync(path.join(m, "MEMORY.md"), "utf8");
  assert.ok(t.includes("](a%20b%20%281%29.md) — spaced\r\n"));
  assert.ok(t.includes("](p%2520q.md)\r\n")); // empty description: no dash
  assert.ok(!/[^\r]\n/.test(t));
  assert.equal(encodeLink("a (b).md"), "a%20%28b%29.md");
  assert.deepEqual(fs.readdirSync(m).filter((f) => f.endsWith(".tmp")), []);
  const r2 = JSON.parse(cli(m, "--json", "--fix").stdout);
  assert.deepEqual(r2.fixes, []);
  assert.equal(fs.readFileSync(path.join(m, "MEMORY.md"), "utf8"), t);
  assert.equal(r2.findings.filter((f) => f.fixable === undefined && f.check === "index").length, 0);
});

test("malformed percent link does not crash; unreadable entry is skipped", () => {
  const { m } = mk("mem", { "a.md": fm("a"), "MEMORY.md": "- [x](bad%zz.md) — x\n- [a](a.md) — a\n" });
  const r = cli(m, "--json");
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).findings.some((f) => /bad%zz\.md/.test(f.evidence)));
  fs.mkdirSync(path.join(m, "dir.md")); // a directory named *.md is skipped, not fatal
  assert.equal(cli(m, "--json").status, 0);
});

test("stale-branch: repo without refs is skipped; other remote names are stripped", () => {
  const bare = path.join(root, "norefs"); execFileSync("git", ["init", "-q", "-b", "main", bare]);
  const { m } = mk("mem", { "a.md": fm("a").replace("body", "Etherium uses `master`."), "MEMORY.md": "- [a](a.md) — a\n" });
  const r = JSON.parse(spawnSync(process.execPath, [tool, "--memory", m, "--repo", bare, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(r.findings.filter((f) => f.check === "stale-branch").length, 0);
  // with a commit on main plus a remote named "upstream" holding master, master exists via upstream/master
  execFileSync("git", ["-C", bare, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"]);
  execFileSync("git", ["-C", bare, "update-ref", "refs/remotes/upstream/master", "HEAD"]);
  const r2 = JSON.parse(spawnSync(process.execPath, [tool, "--memory", m, "--repo", bare, "--json"], { encoding: "utf8" }).stdout);
  assert.equal(r2.findings.filter((f) => f.check === "stale-branch").length, 0);
});

test("backup dirs never overwrite: same-millisecond stamp gets a suffix", async () => {
  const { applyFixes, loadMemories, audit } = await import("./memoryHygiene.mjs");
  const { m } = mk("mem", { "a.md": fm("a"), "b.md": fm("b"), "MEMORY.md": "" });
  const now = new Date(2026, 0, 2, 3, 4, 5, 6);
  const run1 = () => { const { findings, mems } = audit({ memory: m, repo, rules: [], store: [] }); return applyFixes(m, mems, findings, now); };
  assert.equal(run1().length, 2);
  fs.appendFileSync(path.join(m, "c.md"), fm("c")); // new unlinked file, same stamp
  assert.equal(run1().length, 1);
  const dirs = fs.readdirSync(path.join(m, ".hygiene-backup")).filter((x) => x !== "hygiene.log").sort();
  assert.equal(dirs.length, 2);
  assert.match(dirs[0], /^20260102-030405006(-1)?$/);
  assert.ok(loadMemories(m).length === 3);
});
