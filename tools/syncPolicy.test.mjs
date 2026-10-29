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

test('managed blocks preserve raw CRLF outside bytes and append without changing existing text', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'furious-policy-bytes-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const codex=path.join(root,'.codex/AGENTS.md');
  const claude=path.join(root,'.claude/CLAUDE.md');
  fs.mkdirSync(path.dirname(codex),{recursive:true});
  fs.mkdirSync(path.dirname(claude),{recursive:true});
  const prefix='# CUSTOM prefix  \r\nKeep\r\n';
  const suffix='\r\n# CUSTOM suffix  \r\nNo newline';
  fs.writeFileSync(codex,prefix+'<!-- BEGIN agent-kit rules (old) -->\r\nold\r\n<!-- END agent-kit rules -->'+suffix);
  const noMarker='Custom no markers\r\nNo trailing newline  ';
  fs.writeFileSync(claude,noMarker);
  const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../sync.mjs',import.meta.url)),'--policy-only','--target-home',root],{encoding:'utf8',timeout:15000});
  const first=run();
  assert.equal(first.status,0,first.stderr);
  const result=fs.readFileSync(codex,'utf8');
  const appended=fs.readFileSync(claude,'utf8');
  assert.ok(result.startsWith(prefix));
  assert.ok(result.endsWith(suffix));
  assert.equal(result.replace(/\r\n/g,'' ).includes('\n'),false);
  assert.ok(appended.startsWith(noMarker+'\r\n\r\n<!-- BEGIN'));
  assert.equal(run().status,0);
  assert.equal(fs.readFileSync(codex,'utf8'),result);
  assert.equal(fs.readFileSync(claude,'utf8'),appended);
});

test('malformed markers fail closed and preflight both managed destinations', t => {
  const begin='<!-- BEGIN agent-kit rules (old) -->';
  const end='<!-- END agent-kit rules -->';
  const pair=begin+'\r\nold\r\n'+end;
  const fixtures=[
    begin+'\r\nCUSTOM_OUTSIDE_KEEP\r\n'+pair,
    end,
    pair+'\r\n'+pair,
    begin+'\r\n'+pair+'\r\n'+end,
    begin+'\r\nCUSTOM_OUTSIDE_KEEP',
    '<!-- BEGIN agent-kit rules broken\r\nCUSTOM_OUTSIDE_KEEP\r\n'+pair,
    '<!-- BEGIN ~/.agents/rules -->\nold\n'+end,
  ];
  for(const [i,fixture] of fixtures.entries()) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'furious-policy-invalid-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const codex=path.join(root,'.codex/AGENTS.md');
    const claude=path.join(root,'.claude/CLAUDE.md');
    fs.mkdirSync(path.dirname(codex),{recursive:true});
    fs.mkdirSync(path.dirname(claude),{recursive:true});
    const valid='CUSTOM_CLAUDE\r\n'+pair+'\r\nFOOTER';
    fs.writeFileSync(codex,fixture);
    fs.writeFileSync(claude,valid);
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../sync.mjs',import.meta.url)),'--policy-only','--target-home',root],{encoding:'utf8',timeout:15000});
    assert.notEqual(result.status,0,`fixture ${i}`);
    assert.match(result.stderr,/Malformed managed rule markers/);
    assert.deepEqual(fs.readFileSync(codex),Buffer.from(fixture));
    assert.deepEqual(fs.readFileSync(claude),Buffer.from(valid));
  }
});
