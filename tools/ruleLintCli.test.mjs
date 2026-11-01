import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI=fileURLToPath(new URL('../hooks/rule-lint.mjs',import.meta.url));
const lint=(args,cwd)=>spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',cwd,timeout:15000});

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'furious-rulelint-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const rules=path.join(root,'.agents','rules');
  fs.mkdirSync(rules,{recursive:true});
  fs.mkdirSync(path.join(root,'.git'));
  const topic=path.join(rules,'x.md'); // topic file without Keywords: -> warning
  fs.writeFileSync(topic,'# x\n\nSome rule text.\n');
  return {root,topic};
}

test('rule-lint warns for backslash and forward-slash paths', t => {
  const {root,topic}=fixture(t);
  const fwd=lint([topic.split(path.sep).join('/')],root);
  assert.equal(fwd.status,0,fwd.stderr);
  assert.match(fwd.stdout,/rule-lint x\.md:/);
  const back=lint([topic.split(path.sep).join('\\')],root);
  assert.match(back.stdout,/rule-lint x\.md:|skipped/); // on POSIX a backslash path is one odd filename
  if(path.sep===String.fromCharCode(92)) assert.match(back.stdout,/rule-lint x\.md:/);
});

test('rule-lint matches the resolved path and reports skipped non-rule files', t => {
  const {root}=fixture(t);
  const rel=lint(['.agents/rules/x.md'],root);
  assert.match(rel.stdout,/rule-lint x\.md:/);
  fs.writeFileSync(path.join(root,'notes.txt'),'hi');
  const skipped=lint(['notes.txt'],root);
  assert.equal(skipped.stdout.trim(),'rule-lint: skipped notes.txt (not a rule file)');
});
