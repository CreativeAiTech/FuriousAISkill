#!/usr/bin/env node
/**
 * Model tier gate (kit port of Crownspire AGT-36/37). Opt-in per project: `"modelGate": true` in .agents/baton.config.json.
 * Every session starts as manager. baton.mjs reports action scope without blocking startup.
 * Model authority remains a separate exact model/effort evidence check. This file keeps legacy tier APIs and QUOTA.md.
 *
 * Rank table, first found wins: <project>/.agents/model-ranks.json → ~/.agents/model-ranks.json → built-in copy.
 * Case-insensitive regexes, checked small → mid → top (so flash-lite is small; \b because "gemini" contains "mini").
 * No match = "unranked": no inferred authority; bounded authorized work can still proceed.
 *
 *   node ~/.agents/tools/modelTier.mjs rank <model> [--root <dir>]                         Print rank and tier
 *   node ~/.agents/tools/modelTier.mjs learn <model> --rank top|mid|small [--root <dir>] [--no-push]
 *       Adds the exact id to the table in use (project file if it exists, else the kit's), commits it and pushes
 *       (project: per baton.config.json push mode; kit: its own remote). Run only with the user's answer.
 */
import fs from "node:fs";
import { assess } from "./modelAuthority.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_RANKS = path.join(KIT, "model-ranks.json");
const RANKS_REL = path.join(".agents", "model-ranks.json");
const QUOTA_REL = path.join(".agents", "QUOTA.md");
const RANKS = ["small", "mid", "top"];

export const DEFAULT_RANKS = {
  ranks: { small: ["^gpt-6-luna$"], mid: ["^gpt-6\\.1-sol$", "^gpt-6-sol$", "^gpt-6\\.1-terra$"], top: [] },
  allowed: {
    top: "Candidate only; exact effort must pass modelAuthority. No automatic publish authority.",
    mid: "Manager; bounded authorized work and prepared implementation; qualified review for high-risk decisions.",
    small: "Manager; simple research and prepared low-risk scope with verification.",
    unranked: "Manager; no inferred authority; bounded research and prepared low-risk scope with verification.",
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
    const table = JSON.parse(fs.readFileSync(file, "utf8"));
    return table && typeof table === "object" && !Array.isArray(table) ? table : DEFAULT_RANKS;
  } catch {
    return DEFAULT_RANKS;
  }
}

/** "top" | "mid" | "small" | "unranked" | "unknown". */
export function modelRank(model, root) {
  if (!model || typeof model !== "string" || model === "<synthetic>") return "unknown";
  const { ranks } = rankTable(root);
  for (const rank of RANKS) {
    if ((Array.isArray(ranks?.[rank]) ? ranks[rank] : []).some((re) => {
      if (typeof re !== "string") return false;
      try {
        return new RegExp(re, "i").test(model);
      } catch {
        return false; // one bad hand-edited regex must not break the gate
      }
    })) return rank;
  }
  return "unranked";
}

/** Top requires both candidate rank and current exact model/effort evidence. Missing effort is fallback. */
export function modelTier(model, root, effort) {
  const rank = modelRank(model, root);
  return rank === "unknown" ? "unknown" : rank === "top" && assess(model, effort, rankTable(root)).eligible ? "top" : "fallback";
}

export function fallbackWarning(model, root, effort) {
  const rank = modelRank(model, root);
  return (
    `MANAGER MODE: reported model \`${model || "unknown"}\` (rank: ${rank}; effort: ${effort || "unverified"}). ` +
    `Action scope: manage the bounded objective, research, delegate using available controls, and execute authorized prepared low-risk work in an isolated branch with verification. Existing authorization carries forward; no startup approval is required. ` +
    `Ambiguous high-risk decisions and final approval require applicable qualification and current-result evidence; pause only that missing action. ` +
    `Benchmark authority: ${assess(model, effort, rankTable(root)).reason} Manager role and coarse rank grant no authority or publish permission.`
  );
}


/**
 * Non-blocking historical comparison, not measured workflow cost or runtime availability.
 * Returns "" when no nudge applies.
 */
export function valueAdvisory(model, effort) {
  if (!model || typeof model !== "string") return "";
  const m = model.trim().toLowerCase();
  const e = typeof effort === "string" ? effort.trim().toLowerCase() : "";
  if (m === "gpt-6-astra") {
    if (e === "max") {
      return (
        "💡 VALUE NOTICE: You are on `gpt-6-astra` (`max`, 91.38% relative power). This provides **+1.9% more benchmark power** (+1.72 pts) " +
        "than `gpt-6.1-sol` (`max`, 89.66%) at **5× the listed token price ($10/$50 vs $2/$10)**. " +
        "Historical score/rate comparison only, not measured credits or workflow savings. For prepared edits compare available Sol/Terra low/medium routes; choose only supported adequate efforts with current cost/quota evidence."
      );
    }
    if (e === "xhigh") {
      return (
        "💡 VALUE NOTICE: You are on `gpt-6-astra` (`xhigh`, 89.66% relative power). This provides **+0.0% more power** than `gpt-6.1-sol` (`max`, 89.66%) " +
        "and **+2.0% more** than `gpt-6.1-sol` (`xhigh`, 87.93%) at **5× the token price ($10/$50 vs $2/$10)**. " +
        "Historical comparison only. For prepared edits compare available Sol/Terra low/medium routes; actual cost/quota, supported efforts and task quality decide."
      );
    }
    if (e === "high") {
      return (
        "💡 VALUE NOTICE: You are on `gpt-6-astra` (`high`, 87.93% relative power). This provides **+0.0% more power** than `gpt-6.1-sol` (`xhigh`, 87.93%) " +
        "at **5× the token price ($10/$50 vs $2/$10)**. Historical comparison only; consider available Sol/Terra low/medium for prepared edits after checking quality, supported effort and current cost/quota."
      );
    }
    return (
      "💡 VALUE NOTICE: You are on `gpt-6-astra` ($10/$50 per 1M tokens, **5× the base rate** of `gpt-6.1-sol` at $2/$10 for **0%–1.9% score delta**). " +
      "Historical comparison only; manager role never requires Astra/Max. Choose the cheapest adequate available model and supported effort from task/risk and current cost/quota evidence."
    );
  }
  if (m === "claude-fable-5-1") {
    return (
      `💡 VALUE NOTICE: You are on \`${model}\` (91.38% max relative power, $10/$50 per 1M tokens). This provides **−1.8% to −8.6% less benchmark score** ` +
      "than `claude-opus-5-5` (`high` 93.10%, `max` 100.00% at $4/$20) at **2.5× the cost**, and costs **5× more** than `claude-sonnet-5-5` (`max` 96.55% at $2/$10). " +
      "Historical comparison only; choose an adequate available worker at low/medium effort for prepared work. Rates do not establish workflow savings or qualify a decision."
    );
  }
  if (m === "claude-opus-5-5" && (e === "max" || e === "xhigh")) {
    const score = e === "max" ? "100.00%" : "96.55%";
    const gain = e === "max" ? "+7.4%" : "+3.7%";
    return (
      `💡 VALUE NOTICE: You are on \`${model}\` (\`${e}\`, ${score} relative power). \`${e}\` provides **${gain} more benchmark power** than \`claude-opus-5-5\` (\`high\`, 93.10%) ` +
      "and costs **2× the listed base rate** of `claude-sonnet-5-5` (`max` 96.55% at $2/$10). " +
      "Historical comparison only; token consumption and workflow savings are unmeasured. For prepared work compare adequate available low/medium worker routes."
    );
  }
  if (m === "gemini-4-argon" && e === "high") {
    return (
      `💡 VALUE NOTICE: Historical comparison: \`${model}\` (\`high\`, 91.38% relative score, $2/$10 intro rate) ` +
      "has **2.67× the listed base rate** of `gemini-3.8-flash` ($0.75/$3.75). Check current prices/quota, actual availability and adequate supported effort; neither token consumption nor workflow savings was measured."
    );
  }
  return "";
}

// QUOTA.md keeps one row per tool: | tool | model | tier | seen | source |. Rewritten only when model or tier changes.
const HEADER = [
  "# Model availability (auto-written by ~/.agents/tools/modelTier.mjs)",
  "",
  "> Last reported model per tool. Legacy `fallback` means benchmark authority was not established for the reported configuration; it does not describe quota or manager eligibility.",
  "> Every session manages; action-specific qualification and authorization remain separate. Don't hand-edit rows.",
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
export function recordModel(root, tool, model, source, effort) {
  const tier = modelTier(model, root, effort);
  source = `${source}; effort=${effort || "unverified"}`;
  if (tier === "unknown" || !tool || !root) return false;
  const rows = readQuota(root);
  const prev = rows.find((r) => r.tool === tool);
  if (prev && prev.model === model && prev.tier === tier && prev.source === source) return false;
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
    console.log(fallbackWarning(model, root, flag("effort")));
    console.log(`Routing rank ${modelRank(model, root)}; legacy decision tier ${modelTier(model, root, flag("effort"))} (${ranksFile(root) || "built-in table"})`);
  } else if (cmd === "learn" && model) {
    console.log(await learnModel(model, flag("rank"), { root, push: !flag("no-push") }));
  } else {
    console.error("Usage: modelTier.mjs rank <model> [--effort <effort>] | learn <model> --rank top|mid|small [--root <dir>] [--no-push]");
    process.exit(1);
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) cli(process.argv.slice(2)).catch((err) => {
  console.error(`modelTier: ${err.message}`);
  process.exit(1);
});
