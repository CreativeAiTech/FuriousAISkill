import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnvFiles, resolveProjectRoot } from "./models.mjs";

// One ledger per machine: the xAI budget is per account, not per project.
const STATE_FILE = path.join(os.homedir(), ".agents", "state", "grok-budget.json");

const DEFAULT_MONTHLY_USD = 20;
const TICKS_PER_USD = 1e10;

// USD per 1M tokens: [input, cachedInput, output]. Output rate applies to completion + reasoning tokens.
const PRICE_TABLE = {
  "grok-4.20-0309-non-reasoning": [1.25, 0.2, 2.5],
  "grok-4.20-0309-reasoning": [1.25, 0.2, 2.5],
  "grok-4.20-multi-agent-0309": [1.25, 0.2, 2.5],
  "grok-4.3": [1.25, 0.2, 2.5],
  "grok-4.5": [2.0, 0.3, 6.0],
  "grok-4.6": [2.0, 0.5, 6.0],
  "grok-4.7": [2.0, 0.5, 6.0],
  "grok-build-0.1": [1.0, 0.2, 2.0],
};
const UNKNOWN_MODEL_PRICE = [2.0, 0.5, 6.0]; // Conservative

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const money = (n) => `$${n.toFixed(2)}`;
const parsePositive = (raw) => {
  const val = parseFloat(raw);
  return !isNaN(val) && val > 0 ? val : null;
};

function getBudgetLimit() {
  const fromEnv = parsePositive(process.env.AI_USD_BUDGET_MONTHLY);
  if (fromEnv) return fromEnv;
  const fromFiles = readEnvFiles(["AI_USD_BUDGET_MONTHLY"], (v) => parsePositive(v) !== null);
  return fromFiles ? parsePositive(fromFiles) : DEFAULT_MONTHLY_USD;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function nextMonthStart(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function freshState(month) {
  return {
    month,
    spentUsd: 0,
    callsCount: 0,
    promptTokensUsed: 0,
    completionTokensUsed: 0,
    reasoningTokensUsed: 0,
    totalTokensUsed: 0,
    history: [],
  };
}

/** Loads the ledger; starts a fresh month when the stored month is not the current UTC month. */
function loadState() {
  const month = currentMonth();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.month === month) return { ...freshState(month), ...data };
    }
  } catch (err) {
    console.error("[grok-bridge] Error reading ledger:", err.message);
  }
  return freshState(month);
}

/** Exact cost in USD for one call: xAI's cost_in_usd_ticks if present, else the price table. */
export function estimateCostUsd(model, usage = {}) {
  if (typeof usage.cost_in_usd_ticks === "number") return usage.cost_in_usd_ticks / TICKS_PER_USD;
  const [inRate, cachedRate, outRate] = PRICE_TABLE[model] || UNKNOWN_MODEL_PRICE;
  const prompt = usage.prompt_tokens || 0;
  const cached = Math.min(usage.prompt_tokens_details?.cached_tokens || 0, prompt);
  const completion = usage.completion_tokens || 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens || 0;
  return ((prompt - cached) * inRate + cached * cachedRate + (completion + reasoning) * outRate) / 1e6;
}

/** One-line budget summary, e.g. "$19.98 / $20.00 left this month (resets 2026-11-01)". */
export function formatBudgetLine(state) {
  return `${money(state.remainingUsd)} / ${money(state.budgetUsd)} left this month (resets ${state.resetsOn})`;
}

export function getBudgetState() {
  const budgetUsd = getBudgetLimit();
  const state = loadState();
  const spentUsd = round6(state.spentUsd);
  const remainingUsd = round6(Math.max(0, budgetUsd - spentUsd));

  return {
    month: state.month,
    budgetUsd,
    spentUsd,
    remainingUsd,
    percentRemaining: Number(((remainingUsd / budgetUsd) * 100).toFixed(1)),
    callsCount: state.callsCount,
    promptTokensUsed: state.promptTokensUsed,
    completionTokensUsed: state.completionTokensUsed,
    reasoningTokensUsed: state.reasoningTokensUsed,
    totalTokensUsed: state.totalTokensUsed,
    resetsOn: nextMonthStart(state.month),
    lastCall: state.history[state.history.length - 1] || null,
    hasBudgetRemaining: remainingUsd > 0.05,
  };
}

/** Records one call; `usage` is the raw API usage object. */
export function recordUsage(params) {
  const { provider, model } = params;
  const usage = params.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
  const totalTokens = promptTokens + completionTokens + reasoningTokens;
  const costUsd = round6(estimateCostUsd(model, usage));
  const budgetUsd = getBudgetLimit();

  const state = loadState();
  state.spentUsd = round6(state.spentUsd + costUsd);
  state.promptTokensUsed += promptTokens;
  state.completionTokensUsed += completionTokens;
  state.reasoningTokensUsed += reasoningTokens;
  state.totalTokensUsed += totalTokens;
  state.callsCount += 1;

  const entry = {
    timestamp: new Date().toISOString(),
    provider,
    model,
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    remainingUsdAfter: round6(Math.max(0, budgetUsd - state.spentUsd)),
  };

  state.history.push(entry);
  if (state.history.length > 50) state.history.shift(); // Keep last 50 calls

  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error("[grok-bridge] Failed to write ledger:", err.message);
  }

  return {
    entry,
    spentUsd: state.spentUsd,
    remainingUsd: entry.remainingUsdAfter,
    budgetUsd,
    resetsOn: nextMonthStart(state.month),
  };
}

/**
 * Saves a handoff checkpoint to <project>/.agents/ai_handoff_snapshot.json,
 * only when <project>/.agents already exists. Returns the snapshot either way.
 */
export function saveHandoffSnapshot(params) {
  const { fromAgent, toAgent, taskSummary, originalPrompt, partialOutput = "", reason } = params;
  const snapshot = {
    timestamp: new Date().toISOString(),
    fromAgent,
    toAgent,
    taskSummary,
    originalPrompt,
    partialOutput,
    reason,
  };
  try {
    const dir = path.join(resolveProjectRoot(), ".agents");
    if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, "ai_handoff_snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    console.error("[grok-bridge] Failed to save handoff snapshot:", err.message);
  }
  return snapshot;
}
