import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GROK_MODELS = {
  FAST: "grok-4.20-0309-non-reasoning",
  REASONING: "grok-4.20-0309-reasoning",
  BUILD: "grok-build-0.1",
  FLAGSHIP: "grok-4.7",
};

export const DEFAULT_GROK_MODEL = GROK_MODELS.FAST;
export const XAI_BASE_URL = "https://api.x.ai/v1";

const KIT_ENV_FILE = path.join(os.homedir(), ".agents", ".env");

/** Project dir: CLAUDE_PROJECT_DIR, else cwd, walked up to the git root (falls back to the start dir). */
export function resolveProjectRoot() {
  const start = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Env files searched after process.env: project .env.local, project .env, then ~/.agents/.env. */
export function envFiles(projectRoot = resolveProjectRoot()) {
  return [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env"), KIT_ENV_FILE];
}

/** Returns the first value for `names` accepted by `accept`, searching the env files in order. */
export function readEnvFiles(names, accept, projectRoot) {
  for (const file of envFiles(projectRoot)) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [k, ...v] = trimmed.split("=");
      if (!names.includes(k.trim())) continue;
      const val = v.join("=").trim().replace(/^["']|["']$/g, "");
      if (accept(val)) return val;
    }
  }
  return undefined;
}

/** Validates whether an API key candidate looks like a genuine key. */
export function isValidApiKey(key) {
  return (
    typeof key === "string" &&
    key.trim().length > 10 &&
    !key.includes("${") &&
    !key.includes("your_xai_api_key")
  );
}

/** Resolves the xAI API key: env, then project .env.local/.env, then ~/.agents/.env. Never logged. */
export function resolveGrokApiKey(projectRoot) {
  if (isValidApiKey(process.env.XAI_API_KEY)) return process.env.XAI_API_KEY;
  if (isValidApiKey(process.env.VITE_XAI_API_KEY)) return process.env.VITE_XAI_API_KEY;
  return readEnvFiles(["XAI_API_KEY", "VITE_XAI_API_KEY"], isValidApiKey, projectRoot);
}

/** Resolves the optimal Grok model from the requested model and context strings. */
export function resolveGrokModel(requestedModel, ...contextStrings) {
  if (requestedModel && requestedModel !== "auto") {
    if (requestedModel.startsWith("grok-")) return requestedModel;
    contextStrings.unshift(requestedModel);
  }

  const text = contextStrings.filter(Boolean).join(" ");

  if (/\b(reasoning|formula|formulas|math|calculate|calculation|stat balance|combat logic|damage calculation)\b/i.test(text)) {
    return GROK_MODELS.REASONING;
  }
  if (/\b(code review|refactor|refactoring|typescript|bug|bugs|code)\b/i.test(text)) {
    return GROK_MODELS.BUILD;
  }
  if (/\b(deep architecture|complex worldbuilding|epic worldbuilding|grok-4\.7)\b/i.test(text)) {
    return GROK_MODELS.FLAGSHIP;
  }
  return process.env.VITE_GROK_MODEL || DEFAULT_GROK_MODEL;
}
