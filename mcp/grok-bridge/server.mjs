#!/usr/bin/env node
// Grok MCP bridge (stdio, zero dependencies). Decision: see Crownspire .agents/decisions/2026-10-24-grok-bridge-user-scope.md
import readline from "node:readline";
import { recordUsage, getBudgetState, saveHandoffSnapshot, formatBudgetLine } from "./usage.mjs";
import { GROK_MODELS, XAI_BASE_URL, resolveGrokApiKey, resolveGrokModel } from "./models.mjs";

const TOOLS = [
  {
    name: "grok_completion",
    description: "Send a prompt to xAI Grok for witty dialogue, combat formulas, code analysis, or creative game ideas.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The prompt or instruction for Grok." },
        model: {
          type: "string",
          description: `Model to use (default: 'auto' selects optimal model: ${GROK_MODELS.REASONING} for math/formulas, ${GROK_MODELS.BUILD} for code, ${GROK_MODELS.FLAGSHIP} for architecture, ${GROK_MODELS.FAST} for dialogue).`,
          default: "auto",
        },
        system: {
          type: "string",
          description: "Optional system instructions / persona.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "grok_review_code",
    description: "Have xAI Grok review code or brainstorm edge-case game scenarios.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code snippet to analyze." },
        language: { type: "string", description: "Programming language." },
        focus: { type: "string", description: "Specific angle or focus for the review." },
        model: {
          type: "string",
          description: `Model to use (default: ${GROK_MODELS.BUILD}; routes on focus if omitted).`,
          default: GROK_MODELS.BUILD,
        },
      },
      required: ["code"],
    },
  },
  {
    name: "grok_get_budget",
    description: "Check the monthly USD Grok budget (spent, remaining, reset date, tokens used) before dispatching subagents.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const text = (t, extra = {}) => ({ content: [{ type: "text", text: t }], ...extra });

/** POST a chat completion with plain fetch; the key only lives in the Authorization header. */
async function chat(key, model, messages) {
  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages }),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || raw.slice(0, 300);
    throw new Error(`xAI API ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  if (!data) throw new Error("xAI API returned a non-JSON response.");
  return data;
}

function finish(model, completion) {
  const usage = recordUsage({ provider: "grok", model, usage: completion.usage });
  const rawText = completion.choices?.[0]?.message?.content || "(Empty response)";
  const header = `[Subagent Work: xAI Grok (${model}) | Cost: $${usage.entry.costUsd.toFixed(4)} (${usage.entry.totalTokens} tokens) | ${formatBudgetLine(usage)}]\n\n`;
  return text(header + rawText);
}

async function handleToolCall(name, args) {
  if (name === "grok_get_budget") return text(JSON.stringify(getBudgetState(), null, 2));

  if (name !== "grok_completion" && name !== "grok_review_code") {
    return text(`Unknown tool: ${name}`, { isError: true });
  }

  const budget = getBudgetState();
  if (!budget.hasBudgetRemaining) {
    saveHandoffSnapshot({
      fromAgent: "grok",
      toAgent: "claude_or_gemini",
      taskSummary: (args.prompt || args.code || "").slice(0, 120),
      originalPrompt: args.prompt || args.code || "",
      reason: `Monthly Grok budget used up ($${budget.spentUsd.toFixed(2)} of $${budget.budgetUsd.toFixed(2)}); resets ${budget.resetsOn}.`,
    });
    return text(
      `[RELAY TRIGGERED: Grok Budget Depleted] Monthly budget used up ($${budget.spentUsd.toFixed(2)} of $${budget.budgetUsd.toFixed(2)}); resets ${budget.resetsOn}. Handoff snapshot saved. Relaying task to Claude or internal Gemini engine.`,
      { isExhausted: true }
    );
  }

  const key = resolveGrokApiKey();
  if (!key) {
    return text("Error: xAI Grok API key not found. Set XAI_API_KEY or VITE_XAI_API_KEY in the environment, the project .env.local/.env, or ~/.agents/.env.");
  }

  try {
    if (name === "grok_completion") {
      const messages = [];
      if (args.system) messages.push({ role: "system", content: args.system });
      messages.push({ role: "user", content: args.prompt });
      const model = resolveGrokModel(args.model, args.prompt, args.system);
      return finish(model, await chat(key, model, messages));
    }

    const userPrompt = `Please review this ${args.language || "code"}:\n\n\`\`\`${args.language || ""}\n${args.code}\n\`\`\`\n\nFocus: ${args.focus || "General optimization and potential edge-case failures."}`;
    const routedModel = resolveGrokModel(args.model, args.focus);
    const model =
      args.model && args.model.startsWith("grok-")
        ? args.model
        : routedModel === GROK_MODELS.REASONING || routedModel === GROK_MODELS.FLAGSHIP
          ? routedModel
          : GROK_MODELS.BUILD;
    return finish(model, await chat(key, model, [{ role: "user", content: userPrompt }]));
  } catch (err) {
    const msg = String(err?.message || err).split(key).join("[redacted]");
    saveHandoffSnapshot({
      fromAgent: "grok",
      toAgent: "claude_or_gemini",
      taskSummary: (args.prompt || args.code || "").slice(0, 120),
      originalPrompt: args.prompt || args.code || "",
      reason: `Mid-task API failure: ${msg}`,
    });
    return text(
      `[MID-TASK EXHAUSTION / ERROR: Grok] ${msg}. If the project has a .agents folder, state was captured in .agents/ai_handoff_snapshot.json. Relay task with snapshot context to next agent.`,
      { isError: true }
    );
  }
}

// JSON-RPC stdio interface
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let id;
  try {
    const request = JSON.parse(trimmed);
    id = request.id;
    const { method, params } = request;

    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "grok-bridge", version: "1.0.0" },
        },
      });
      return;
    }

    if (method === "notifications/initialized") return;

    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      let toolResult;
      try {
        toolResult = await handleToolCall(params?.name, params?.arguments || {});
      } catch (err) {
        toolResult = text(`[Grok bridge error] ${err?.message || String(err)}`, { isError: true });
      }
      send({ jsonrpc: "2.0", id, result: toolResult });
      return;
    }

    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    process.stderr.write(`Error processing line: ${err.message}\n`);
    if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(err.message) } });
  }
});
