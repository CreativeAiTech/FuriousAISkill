#!/usr/bin/env node
/**
 * Model tier gate (kit port of Crownspire AGT-36/37). Opt-in per project: `"modelGate": true` in .agents/baton.config.json.
 * A project that expects the top model on every main session stops a smaller one before any work: baton.mjs puts a
 * warning at the top of the brief (self-reported `--model`), hooks/model-check.mjs denies the first Claude Code tool
 * call once (real model id read from the transcript). This file ranks model ids and keeps .agents/QUOTA.md.
 *
 * Rank table, first found wins: <project>/.agents/model-ranks.json → ~/.agents/model-ranks.json → built-in copy.
 * Case-insensitive regexes, checked small → mid → top (so flash-lite is small; \b because "gemini" contains "mini").
 * No match = "unranked": gated like any fallback, and the warning asks the user to rank it once (learn on first sight).
 *
 *   node ~/.agents/tools/modelTier.mjs rank <model> [--root <dir>]                         Print rank and tier
 *   node ~/.agents/tools/modelTier.mjs learn <model> --rank top|mid|small [--root <dir>] [--no-push]
 *       Adds the exact id to the table in use (project file if it exists, else the kit's), commits it and pushes
 *       (project: per baton.config.json push mode; kit: its own remote). Run only with the user's answer.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_RANKS = path.join(KIT, "model-ranks.json");
const RANKS_REL = path.join(".agents", "model-ranks.json");
const QUOTA_REL = path.join(".agents", "QUOTA.md");
const RANKS = ["small", "mid", "top"];

export const DEFAULT_RANKS = {
  ranks: { small: ["^gpt-6-luna$", "haiku", "\\blite\\b", "\\bmini\\b", "\\bnano\\b"], mid: ["sonnet", "flash", "^gpt-6\\.1-sol$", "^gpt-6-sol$", "^gpt-6\\.1-terra$"], top: ["opus", "fable", "argon", "gemini[\\w.\\s-]*\\bpro\\b", "^gpt-6$", "^gpt-6-astra$"] },
  allowed: {
    top: "Everything; the project's top-tier areas still at high effort.",
    mid: "feature work inside one module, UI, tooling, written specs. No top-tier decisions.",
    small: "content, docs, verify runs, tickets with a ready spec only.",
    unranked: "treated as small until ranked.",
  },
};

/** Path of the table in use for this project root ("" = built-in). */
export function ranksFile(root) {
  if (root && fs.existsSync(path.join(root, RANKS_REL))) return path.join(root, RANKS_REL);
  return fs.existsSync(KIT_RANKS) ? KIT_RANKS : "";
}

function rankTable(root) {
  const file = ranksFile(root);
  if (!file) return DEFAULT_RANKS;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return DEFAULT_RANKS;
  }
}

/** "top" | "mid" | "small" | "unranked" | "unknown". */
export function modelRank(model, root) {
  if (!model || typeof model !== "string" || model === "<synthetic>") return "unknown";
  const { ranks } = rankTable(root);
  for (const rank of RANKS) {
    if ((ranks?.[rank] || []).some((re) => {
      try {
        return new RegExp(re, "i").test(model);
      } catch {
        return false; // one bad hand-edited regex must not break the gate
      }
    })) return rank;
  }
  return "unranked";
}

/** "top" | "fallback" | "unknown". Every rank below top (and unranked) is a fallback. */
export function modelTier(model, root) {
  const rank = modelRank(model, root);
  return rank === "unknown" ? "unknown" : rank === "top" ? "top" : "fallback";
}

export function fallbackWarning(model, root) {
  const rank = modelRank(model, root);
  const scope = rankTable(root).allowed?.[rank];
  const learn =
    rank === "unranked"
      ? ` New model: also ask "${model} is new to the rank table: top, mid or small?" and record the answer with ` +
        `\`node ~/.agents/tools/modelTier.mjs learn ${model} --rank <answer>\` (only the user's answer, never your guess).`
      : "";
  return (
    `⛔ FALLBACK MODEL: this session runs on \`${model}\` (rank: ${rank}), not the top model (Opus / Fable / Gemini Pro / Argon class). ` +
    `Before ANY work, stop and ask the user: "This project expects the top model; I'm on ${model}. Switch models, or continue in ` +
    `fallback mode (ready-made specs only, no decisions)?" Continue only on an explicit yes.` +
    (scope ? ` Rank ${rank} scope: ${scope}` : "") + learn
  );
}

// QUOTA.md keeps one row per tool: | tool | model | tier | seen | source |. Rewritten only when model or tier changes.
const HEADER = [
  "# Model availability (auto-written by ~/.agents/tools/modelTier.mjs)",
  "",
  "> Last model each tool's main session ran on. `fallback` = the top model wasn't available (quota or mistake):",
  "> the brief warns and lists only tickets with a ready `.agents/tasks/<ID>/spec.md`. Don't hand-edit rows.",
  "",
  "| Tool | Model | Tier | Seen | Source |",
  "| :--- | :--- | :--- | :--- | :--- |",
];

export function readQuota(root) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, QUOTA_REL), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter((l) => /^\| (?!Tool |:)/.test(l)).map((l) => {
    const [tool, model, tier, seen, source] = l.split("|").slice(1, 6).map((c) => c.trim().replace(/`/g, ""));
    return { tool, model, tier, seen, source };
  });
}

/** Records a known model for a tool in <root>/.agents/QUOTA.md. Returns true when the file changed. */
export function recordModel(root, tool, model, source) {
  const tier = modelTier(model, root);
  if (tier === "unknown" || !tool || !root) return false;
  const rows = readQuota(root);
  const prev = rows.find((r) => r.tool === tool);
  if (prev && prev.model === model && prev.tier === tier) return false;
  const seen = new Date().toISOString().slice(0, 10);
  const next = rows.filter((r) => r.tool !== tool).concat({ tool, model, tier, seen, source });
  next.sort((a, b) => a.tool.localeCompare(b.tool));
  const lines = HEADER.concat(next.map((r) => `| ${r.tool} | \`${r.model}\` | ${r.tier} | ${r.seen} | ${r.source} |`));
  try {
    fs.mkdirSync(path.join(root, ".agents"), { recursive: true });
    fs.writeFileSync(path.join(root, QUOTA_REL), lines.join("\n") + "\n");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// learn: write the user's answer for a new model into the table, commit, push
// ---------------------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Commits one file and pushes when it's the only unpushed commit (other local commits may not be approved yet). */
function commitAndPush(repo, file, message, { push, remote, branch }) {
  const rel = path.relative(repo, file).replace(/\\/g, "/");
  git(repo, ["add", "--", rel]);
  git(repo, ["commit", "-q", "-m", message, "--", rel]);
  if (!push) return `Committed ${rel} (not pushed).`;
  let ahead = 1;
  try {
    ahead = Number(git(repo, ["rev-list", "--count", `${remote}/${branch}..HEAD`]));
  } catch {
    /* no remote ref yet */
  }
  if (ahead > 1) return `Committed ${rel}; not pushed: ${ahead - 1} other unpushed commit(s) on HEAD. Push them first.`;
  try {
    git(repo, ["push", "-q", remote, `HEAD:${branch}`]);
    return `Committed and pushed ${rel} to ${remote}/${branch}.`;
  } catch (err) {
    return `Committed ${rel}; push failed (${String(err.stderr || err.message).trim().split("\n")[0]}). Pull --rebase and push.`;
  }
}

export async function learnModel(model, rank, { root, push = true } = {}) {
  if (!model || typeof model !== "string") throw new Error("learn needs a model id.");
  if (!RANKS.includes(rank)) throw new Error("--rank must be top, mid or small.");
  const before = modelRank(model, root);
  if (before !== "unranked") return `${model} is already ranked ${before} (${ranksFile(root) || "built-in table"}); nothing to learn.`;
  const projectFile = root ? path.join(root, RANKS_REL) : "";
  const file = projectFile && fs.existsSync(projectFile) ? projectFile : KIT_RANKS;
  const table = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : structuredClone(DEFAULT_RANKS);
  table.ranks = table.ranks || {};
  table.ranks[rank] = [...(table.ranks[rank] || []), `^${escapeRe(model.toLowerCase())}$`];
  fs.writeFileSync(file, JSON.stringify(table, null, 2) + "\n");
  const message = `chore(models): rank ${model} as ${rank} (learned on first sight, user's answer)`;
  let pushed;
  if (file === KIT_RANKS) {
    pushed = commitAndPush(KIT, file, message, { push, remote: "origin", branch: git(KIT, ["rev-parse", "--abbrev-ref", "HEAD"]) });
  } else {
    const { loadConfig } = await import(pathToFileURL(path.join(KIT, "tools", "baton.mjs")).href);
    const cfg = loadConfig(root);
    pushed = cfg.push === "none" ? "Edited only (push mode none)." : commitAndPush(root, file, message, { push: push && cfg.push === "push-master", remote: cfg.remote, branch: cfg.branch });
  }
  return `Ranked ${model} as ${rank} in ${file}. ${pushed}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function cli(argv) {
  const [cmd, model] = argv;
  const flag = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i < 0 ? undefined : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
  };
  let root = typeof flag("root") === "string" ? path.resolve(flag("root")) : "";
  if (!root) {
    const { findRoot } = await import(pathToFileURL(path.join(KIT, "tools", "baton.mjs")).href);
    root = findRoot(process.cwd());
  }
  if (cmd === "rank" && model) {
    console.log(`${model}: rank ${modelRank(model, root)}, tier ${modelTier(model, root)} (${ranksFile(root) || "built-in table"})`);
  } else if (cmd === "learn" && model) {
    console.log(await learnModel(model, flag("rank"), { root, push: !flag("no-push") }));
  } else {
    console.error("Usage: modelTier.mjs rank <model> | learn <model> --rank top|mid|small [--root <dir>] [--no-push]");
    process.exit(1);
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) cli(process.argv.slice(2)).catch((err) => {
  console.error(`modelTier: ${err.message}`);
  process.exit(1);
});
