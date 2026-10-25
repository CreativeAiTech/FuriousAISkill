#!/usr/bin/env node
/**
 * Kit release runner: assigns semver at ship time from .changes/ fragments.
 * Decision: .agents/decisions/2026-10-25-kit-version-at-ship-time.md
 *
 * Usage:
 *   node tools/release.mjs [--dry-run] [--repo <path>]
 *
 * Sequence:
 *   1. Refuse if working tree has uncommitted changes, or .changes/ has no fragments.
 *   2. git pull --ff-only (so the version is taken from latest origin).
 *   3. Bump = highest bump across fragments; read VERSION, compute next semver; refuse if tag v<next> exists.
 *   4. Write VERSION; insert ## <next> · <YYYY-MM-DD> · <titles joined by " + "> right above newest release heading; delete fragments.
 *   5. One commit "release: v<next> <title>", annotated tag "v<next>", one atomic push of branch + tag.
 *   6. Push rejected -> git tag -d v<next>, git reset --soft HEAD~1, restore fragments, print "origin moved, rerun".
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUMP_LEVEL = { patch: 1, minor: 2, major: 3 };

function abort(msg) {
  console.error(`release aborted: ${msg}`);
  process.exit(1);
}

// Default repo is the kit root (parent of tools/)
let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let dryRun = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--repo" && i + 1 < args.length) {
    repoDir = path.resolve(args[++i]);
  } else if (arg.startsWith("--repo=")) {
    repoDir = path.resolve(arg.slice("--repo=".length));
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: node release.mjs [--dry-run] [--repo <path>]");
    process.exit(0);
  } else {
    abort(`unknown option: ${arg}`);
  }
}

function execGit(gitArgs, options = {}) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...options,
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    const msg = stderr || err.message || "git command failed";
    throw new Error(msg);
  }
}

function getIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function bumpVersion(currentVersion, bumpType) {
  const m = currentVersion.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    abort(`current VERSION "${currentVersion}" is not a valid semver (X.Y.Z)`);
  }
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (bumpType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === "minor") {
    minor += 1;
    patch = 0;
  } else if (bumpType === "patch") {
    patch += 1;
  } else {
    abort(`unknown bump type "${bumpType}"`);
  }
  return `${major}.${minor}.${patch}`;
}

function parseFragment(filePath, fileName) {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    abort(`fragment ${fileName} is missing YAML frontmatter (--- ... ---)`);
  }
  const frontmatter = m[1];
  const body = m[2].trim();
  if (!body) {
    abort(`fragment ${fileName} has an empty body`);
  }

  let bump = null;
  let title = null;
  for (const line of frontmatter.split(/\r?\n/)) {
    const clean = line.replace(/(^|\s)#.*$/, "").trim();
    const match = clean.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1].toLowerCase();
      const val = match[2].trim().replace(/^["']|["']$/g, "");
      if (key === "bump") bump = val.toLowerCase();
      if (key === "title") title = val;
    }
  }

  if (!bump || !["major", "minor", "patch"].includes(bump)) {
    abort(`fragment ${fileName} has invalid or missing bump (expected major, minor, or patch; got "${bump}")`);
  }
  if (!title) {
    abort(`fragment ${fileName} is missing title in frontmatter`);
  }

  return { file: fileName, bump, title, body };
}

// Repository validation
if (!fs.existsSync(repoDir)) {
  abort(`target repo directory does not exist: ${repoDir}`);
}
const versionPath = path.join(repoDir, "VERSION");
const changelogPath = path.join(repoDir, "CHANGELOG.md");
if (!fs.existsSync(versionPath)) {
  abort(`VERSION file not found in ${repoDir}`);
}
if (!fs.existsSync(changelogPath)) {
  abort(`CHANGELOG.md file not found in ${repoDir}`);
}

// Step 1: Check uncommitted changes & fragments
const status = execGit(["status", "--porcelain"]).trim();
if (!dryRun && status.length > 0) {
  abort("working tree has uncommitted changes");
}

const changesDir = path.join(repoDir, ".changes");
if (!fs.existsSync(changesDir)) {
  abort(".changes/ directory does not exist");
}
const fragmentFiles = fs.readdirSync(changesDir)
  .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
  .sort();

if (fragmentFiles.length === 0) {
  abort(".changes/ has no fragments");
}

const fragments = fragmentFiles.map((f) => parseFragment(path.join(changesDir, f), f));

// Step 2: git pull --ff-only
if (!dryRun) {
  try {
    execGit(["pull", "--ff-only"]);
  } catch (err) {
    const lines = err.message.split("\n").filter((l) => l.trim());
    abort(`git pull --ff-only failed: ${lines.find((l) => l.startsWith("fatal:")) || lines.pop()}`);
  }
}

// Step 3: Compute bump and next semver
let maxLevel = 0;
for (const frag of fragments) {
  if (BUMP_LEVEL[frag.bump] > maxLevel) {
    maxLevel = BUMP_LEVEL[frag.bump];
  }
}
const highestBump = Object.keys(BUMP_LEVEL).find((k) => BUMP_LEVEL[k] === maxLevel);

const currentVersion = fs.readFileSync(versionPath, "utf8").trim();
const nextVersion = bumpVersion(currentVersion, highestBump);

const existingTag = execGit(["tag", "-l", `v${nextVersion}`]).trim();
if (existingTag.length > 0) {
  abort(`tag v${nextVersion} already exists`);
}

// Step 4: Format CHANGELOG entry
const combinedTitles = fragments.map((f) => f.title).join(" + ");
const today = getIsoDate();
const fragmentBodies = fragments.map((f) => f.body).join("\n\n");
const releaseSection = `## ${nextVersion} · ${today} · ${combinedTitles}\n\n${fragmentBodies}`;

if (dryRun) {
  console.log(`[dry-run] Next version: ${nextVersion} (${highestBump} bump from ${currentVersion})`);
  console.log(`[dry-run] Fragments (${fragments.length}): ${fragments.map((f) => f.file).join(", ")}`);
  console.log(`[dry-run] CHANGELOG entry:\n`);
  console.log(releaseSection);
  process.exit(0);
}

const changelogContent = fs.readFileSync(changelogPath, "utf8");
const headingMatch = changelogContent.match(/^## \d+\.\d+\.\d+.*$/m);
if (!headingMatch) {
  abort("CHANGELOG.md has no existing release heading to insert before");
}
const insertIndex = headingMatch.index;
const updatedChangelog = changelogContent.slice(0, insertIndex) + releaseSection + "\n\n" + changelogContent.slice(insertIndex);

fs.writeFileSync(versionPath, `${nextVersion}\n`, "utf8");
fs.writeFileSync(changelogPath, updatedChangelog, "utf8");

for (const frag of fragments) {
  fs.unlinkSync(path.join(changesDir, frag.file));
}

// Step 5: Commit, tag, atomic push (branch + tag land together or not at all), Step 6 rollback
function rollback(committed) {
  if (committed) {
    try { execGit(["tag", "-d", `v${nextVersion}`]); } catch {}
    try { execGit(["reset", "--soft", "HEAD~1"]); } catch {}
  }
  try { execGit(["checkout", "HEAD", "--", ".changes", "VERSION", "CHANGELOG.md"]); } catch {}
  try { execGit(["reset"]); } catch {}
}

let committed = false;
try {
  execGit(["add", "VERSION", "CHANGELOG.md", ".changes"]);
  execGit(["commit", "-m", `release: v${nextVersion} ${combinedTitles}`]);
  committed = true;
  execGit(["tag", "-a", `v${nextVersion}`, "-m", `v${nextVersion}`]);
} catch (err) {
  rollback(committed);
  abort(`commit/tag failed, release undone: ${err.message.split("\n")[0]}`);
}

try {
  execGit(["push", "--atomic", "origin", "HEAD", `refs/tags/v${nextVersion}`]);
} catch (err) {
  rollback(true);
  const reason = err.message.split("\n").find((l) => l.trim()) || "push failed";
  const raced = /rejected|non-fast-forward|fetch first/i.test(err.message);
  abort(raced ? "origin moved, rerun" : `push failed, release undone: ${reason}`);
}

console.log(`v${nextVersion}`);
