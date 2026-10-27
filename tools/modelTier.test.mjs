import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelRank, modelTier, recordModel, readQuota } from './modelTier.mjs';
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

test('baton brief passes actual effort to the gate', t => {
  const root=project(t);
  const ctx=makeContext(root,loadConfig(root));
  assert.match(buildBrief(ctx,'codex',{},'gpt-6-astra',false,'high'),/FALLBACK MODEL/);
  assert.doesNotMatch(buildBrief(ctx,'codex',{},'gpt-6-astra',false,'max'),/FALLBACK MODEL/);
});
