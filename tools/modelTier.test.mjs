import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { modelRank, modelTier, recordModel, readQuota, valueAdvisory, fallbackWarning } from './modelTier.mjs';
import { assess } from './modelAuthority.mjs';
import { buildBrief, makeContext, loadConfig } from './baton.mjs';

const shipped = JSON.parse(fs.readFileSync(new URL('../model-ranks.json', import.meta.url), 'utf8'));
function project(t, table = structuredClone(shipped)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'furious-model-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.agents'));
  if (table.authority) table.authority.checkedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(root, '.agents/model-ranks.json'), JSON.stringify(table));
  fs.writeFileSync(path.join(root, '.agents/baton.config.json'), JSON.stringify({ modelGate: true, push: 'none' }));
  return root;
}

test('integrated tier separates exact effort despite a candidate family rank', t => {
  const root=project(t);
  assert.equal(modelRank('gpt-6-astra',root),'top');
  for (const effort of [undefined,'low','medium','high','xhigh','ultra']) {
    assert.equal(modelTier('gpt-6-astra',root,effort),'fallback');
  }
  assert.equal(modelTier('gpt-6-astra',root,'max'),'top');
  assert.equal(modelTier('claude-sonnet-5-5',root,'high'),'fallback');
  assert.equal(modelTier('claude-sonnet-5-5',root,'max'),'top');
  assert.equal(modelTier('gpt-6.1-sol',root,'max'),'fallback');
  assert.equal(modelTier('future-opus-999',root,'max'),'fallback');
});

test('legacy broad project overrides cannot bypass evidence', t => {
  const root=project(t,{ranks:{top:['opus']}});
  assert.equal(modelRank('opus-999',root),'top');
  assert.equal(modelTier('opus-999',root,'max'),'fallback');
});

test('project may restrict a scored model and malformed table cannot grant top', t => {
  const table=structuredClone(shipped);
  table.ranks.top=[];
  const root=project(t,table);
  assert.equal(modelTier('gpt-6-astra',root,'max'),'fallback');
  fs.writeFileSync(path.join(root,'.agents/model-ranks.json'),'null');
  assert.equal(modelTier('gpt-6-astra',root,'max'),'fallback');
});

test('quota records effort transitions without conflating family and eligibility', t => {
  const root=project(t);
  assert.equal(recordModel(root,'codex','gpt-6-astra','test','max'),true);
  assert.equal(readQuota(root)[0].tier,'top');
  assert.equal(recordModel(root,'codex','gpt-6-astra','test','high'),true);
  assert.equal(readQuota(root)[0].tier,'fallback');
  assert.match(readQuota(root)[0].source,/effort=high/);
});

test('baton brief reports manager scope while preserving exact effort authority', t => {
  const root=project(t);
  const ctx=makeContext(root,loadConfig(root));
  const high=buildBrief(ctx,'codex',{},'gpt-6-astra',false,'high');
  const max=buildBrief(ctx,'codex',{},'gpt-6-astra',false,'max');
  assert.match(high,/MANAGER MODE/);
  assert.match(max,/MANAGER MODE/);
  assert.equal(modelTier('gpt-6-astra',root,'high'),'fallback');
  assert.equal(modelTier('gpt-6-astra',root,'max'),'top');
});

test('small, mid, unknown and unreported sessions manage without hiding ready owned work', t => {
  const root=project(t);
  fs.writeFileSync(path.join(root,'.agents/BACKLOG.md'),'- [ ] **AGT-87** `@codex` Ready bounded policy edits\n');
  const ctx=makeContext(root,loadConfig(root));
  for(const model of ['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol','unknown-model','']) {
    const brief=buildBrief(ctx,'codex',{},model,false,'low');
    assert.match(brief,/MANAGER MODE/);
    assert.match(brief,/AGT-87/);
    assert.doesNotMatch(brief,/Before ANY work|stop and ask|listing only tickets|explicit yes|FALLBACK MODEL/);
    assert.equal(assess(model,'low',shipped).eligible,false,'manager role cannot qualify high-risk authority');
  }
  fs.writeFileSync(path.join(root,'.agents/baton.config.json'),JSON.stringify({modelGate:false,push:'none'}));
  assert.match(buildBrief(makeContext(root,loadConfig(root)),'codex'),/MANAGER MODE/);
});

test('existing fallback authorization never turns into repeated startup approval', t => {
  const root=project(t);
  fs.writeFileSync(path.join(root,'.agents/STATE.md'),'# State\n## Current Focus\nAuthorized fallback: implement prepared low-risk scope.\n');
  const ctx=makeContext(root,loadConfig(root));
  for(let run=0;run<2;run++) {
    const brief=buildBrief(ctx,'codex',{},'future-model',false,'medium');
    assert.match(brief,/Existing authorization carries forward/);
    assert.doesNotMatch(brief,/stop and ask|explicit yes|Before ANY work/);
  }
  assert.match(fallbackWarning('future-model',root,'medium'),/pause only that missing action/);
});

test('model hook records model but never denies startup; second call is silent', t => {
  const root=project(t);
  const hook=fileURLToPath(new URL('../hooks/model-check.mjs',import.meta.url));
  for(const model of ['gpt-6-luna','gpt-6.1-terra','unknown-model']) {
    const session=randomUUID();
    const marker=path.join(os.tmpdir(),`agents-model-${session}`);
    t.after(()=>fs.rmSync(marker,{force:true}));
    const transcript=path.join(root,`${session}.jsonl`);
    fs.writeFileSync(transcript,JSON.stringify({type:'assistant',message:{model}})+'\n');
    const input=JSON.stringify({session_id:session,cwd:root,transcript_path:transcript});
    const invoke=()=>spawnSync(process.execPath,[hook],{input,encoding:'utf8',timeout:10000});
    const first=invoke();
    assert.equal(first.status,0,first.stderr);
    const output=JSON.parse(first.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName,'PreToolUse');
    assert.equal(output.permissionDecision,undefined);
    assert.match(output.additionalContext,/MANAGER MODE/);
    assert.doesNotMatch(first.stdout,/Before ANY work|stop and ask|explicit yes/);
    assert.equal(readQuota(root).find(r=>r.tool==='claude-code').model,model);
    const second=invoke();
    assert.equal(second.status,0,second.stderr);
    assert.equal(second.stdout,'');
  }
});

test('valueAdvisory nudges on overpriced models/efforts with exact % power vs cost multiplier', t => {
  const root=project(t);
  const ctx=makeContext(root,loadConfig(root));
  assert.match(valueAdvisory('gpt-6-astra','max'),/\+1\.9%.*5×/);
  assert.match(valueAdvisory('gpt-6-astra','high'),/\+0\.0%.*5×/);
  assert.match(valueAdvisory('claude-fable-5-1','max'),/2\.5×.*5×/);
  assert.match(valueAdvisory('claude-opus-5-5','max'),/\+7\.4%.*2×/);
  assert.match(valueAdvisory('gemini-4-argon','high'),/2\.67×/);
  assert.equal(valueAdvisory('gpt-6.1-sol','high'),'');
  assert.equal(valueAdvisory('claude-opus-5-5','high'),'');
  assert.equal(valueAdvisory('gemini-4-argon','medium'),'');
  assert.match(buildBrief(ctx,'codex',{},'gpt-6-astra',false,'max'),/VALUE NOTICE/);
});
