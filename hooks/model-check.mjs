#!/usr/bin/env node
// PreToolUse hook (Claude Code): the measured half of the kit's model gate (tools/modelTier.mjs).
// Acts only in projects with "modelGate": true in .agents/baton.config.json. SessionStart input carries no model
// (measured 2026-10-25, CLI 2.1.299), but by the first tool call the transcript holds the main session's first assistant
// message with its real model id. Once per session: top model → record it in .agents/QUOTA.md, stay silent; fallback or
// unranked → record it and deny this one call so the agent must stop and ask (and rank a new model). Later calls pass.
// Effort is not established by this transcript reader: missing effort never grants top authority.
// Verify the actual effort separately with modelAuthority.mjs; this is a one-time advisory hook, not a push guard.
// Subagents (agent_id set) are skipped: they run small models by design. Fails open on any read/parse problem.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelTier, recordModel, fallbackWarning } from "../tools/modelTier.mjs";
import { findRoot, loadConfig } from "../tools/baton.mjs";

const TAIL_BYTES = 512 * 1024;

function lastMainModel(transcriptPath) {
  const size = fs.statSync(transcriptPath).size;
  const fd = fs.openSync(transcriptPath, "r");
  const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      const e = JSON.parse(lines[i]);
      const model = e.message?.model;
      if (e.type === "assistant" && !e.isSidechain && model && model !== "<synthetic>") return model;
    } catch {
      // first line of the tail may be cut mid-record
    }
  }
  return "";
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    if (input.agent_id || !input.session_id || !input.transcript_path) process.exit(0);
    const marker = path.join(os.tmpdir(), `agents-model-${String(input.session_id).replace(/[^\w-]/g, "")}`);
    if (fs.existsSync(marker)) process.exit(0);
    const root = findRoot(input.cwd || process.cwd());
    if (!loadConfig(root).modelGate) {
      fs.writeFileSync(marker, "gate off");
      process.exit(0);
    }
    const model = lastMainModel(input.transcript_path);
    if (!model) process.exit(0); // not flushed yet: try again on the next call
    fs.writeFileSync(marker, model);
    recordModel(root, "claude-code", model, "transcript (PreToolUse)");
    if (modelTier(model, root) === "top") process.exit(0);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${fallbackWarning(model, root)} (Blocked once by ~/.agents/hooks/model-check.mjs; later calls pass.)`,
      },
    }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
