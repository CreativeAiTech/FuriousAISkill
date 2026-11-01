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
