import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const KIT=fileURLToPath(new URL('..',import.meta.url));

function copyKit(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'furious-hooks-kit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.cpSync(KIT,dir,{recursive:true,filter:s=>!['.git','node_modules'].some(n=>s.split(path.sep).includes(n))});
  return dir;
}
const sync=(kit,home)=>spawnSync(process.execPath,[path.join(kit,'sync.mjs'),'--target-home',home],{encoding:'utf8',timeout:60000});

test('sync registers only SessionStart/SessionEnd and removes stale per-call kit entries', t => {
  const kit=copyKit(t);
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'furious-hooks-home-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const agents=kit.split(path.sep).join('/');
  const old=(cmd)=>[{matcher:'x',hooks:[{type:'command',command:`node "${agents}/hooks/${cmd}"`}]}];
  const settings=path.join(home,'.claude/settings.json');
  fs.mkdirSync(path.dirname(settings),{recursive:true});
  fs.writeFileSync(settings,JSON.stringify({hooks:{
    PreToolUse:old('session-watch.cjs'),PostToolUse:old('rule-lint.mjs'),UserPromptSubmit:old('session-watch.cjs'),Stop:old('auto-baton.cjs'),
    PostToolUseCustom:[],Notification:[{hooks:[{type:'command',command:'echo mine'}]}],
  }}));
  const r=sync(kit,home);
  assert.equal(r.status,0,r.stderr);
  const hooks=JSON.parse(fs.readFileSync(settings,'utf8')).hooks;
  for(const e of ['PreToolUse','PostToolUse','UserPromptSubmit','Stop']) assert.equal(e in hooks,false,e);
  assert.ok(hooks.SessionStart.length>0);
  assert.ok(hooks.Notification);
});

test('sync refuses a manifest that registers any other event', t => {
  const kit=copyKit(t);
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'furious-hooks-home-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const file=path.join(kit,'hooks','claude-hooks.json');
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  m.Stop=[{hooks:[{type:'command',command:'node x'}]}];
  fs.writeFileSync(file,JSON.stringify(m));
  const r=sync(kit,home);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/overhead\.md/);
  assert.equal(fs.existsSync(path.join(home,'.claude/settings.json')),false);
});
