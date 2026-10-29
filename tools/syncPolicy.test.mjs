import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { alwaysOnFiles, lintRuleFile } from './lib/ruleLint.mjs';

test('policy-only sync covers Codex, preserves custom instructions and never touches settings', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'furious-policy-sync-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const codex=path.join(root,'.codex/AGENTS.md');
  const claude=path.join(root,'.claude/CLAUDE.md');
  const settings=path.join(root,'.claude/settings.json');
  const mcp=path.join(root,'.claude.json');
  fs.mkdirSync(path.dirname(codex),{recursive:true});
  fs.mkdirSync(path.dirname(claude),{recursive:true});
  const before='\n# Personal instructions\nPreserve this content.  \n\n';
  const after='\n\n# Personal footer\nKeep this too.  \n';
  fs.writeFileSync(codex,before+'<!-- BEGIN agent-kit rules (old) -->\nStale stop before ANY work\n<!-- END agent-kit rules -->'+after);
  fs.writeFileSync(claude,before);
  fs.writeFileSync(settings,'{"permissions":{"defaultMode":"default"},"hooks":{"custom":[]}}\n');
  fs.writeFileSync(mcp,'{"mcpServers":{"custom":{"command":"unchanged"}}}\n');
  const settingsBefore=fs.readFileSync(settings,'utf8');
  const mcpBefore=fs.readFileSync(mcp,'utf8');
  const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../sync.mjs',import.meta.url)),'--policy-only','--target-home',root],{encoding:'utf8',timeout:15000});
  const first=run();
  assert.equal(first.status,0,first.stderr);
  const generated=fs.readFileSync(codex,'utf8');
  assert.ok(generated.startsWith(before));
  assert.ok(generated.endsWith(after));
  assert.match(generated,/Every chat starts as MANAGER/);
  assert.doesNotMatch(generated,/Stale stop/);
  assert.equal((generated.match(/<!-- BEGIN agent-kit rules/g)||[]).length,1);
  assert.ok(alwaysOnFiles(root,root).includes(codex));
  assert.doesNotMatch(lintRuleFile(codex,root,root).join('\n'),/duplicated/);
  assert.equal(fs.readFileSync(settings,'utf8'),settingsBefore);
  assert.equal(fs.readFileSync(mcp,'utf8'),mcpBefore);
  assert.equal(fs.existsSync(path.join(root,'.claude/agents')),false);
  const skill=fs.readFileSync(path.join(root,'.claude/skills/model-orchestrator/SKILL.md'),'utf8');
  assert.match(skill,/^---\n/,'synced skill retains frontmatter');
  assert.match(skill,/Every chat\/session starts in \*\*MANAGER/);
  const second=run();
  assert.equal(second.status,0,second.stderr);
  assert.match(second.stdout,/already in sync/);
  assert.equal(fs.readFileSync(codex,'utf8'),generated);
  assert.equal(fs.readFileSync(settings,'utf8'),settingsBefore);
});

test('policy-only refuses opt-in mutation and relative fixture destinations', () => {
  const sync=fileURLToPath(new URL('../sync.mjs',import.meta.url));
  for(const args of [['--policy-only','--enable','task-board'],['--policy-only','--target-home','relative']]) {
    const result=spawnSync(process.execPath,[sync,...args],{encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0);
  }
});
