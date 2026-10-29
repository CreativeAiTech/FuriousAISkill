import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBrief, makeContext, loadConfig } from './baton.mjs';

const baton = new URL('./baton.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (root, ...args) => spawnSync(process.execPath, [baton, ...args], { cwd: root, encoding: 'utf8' });

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-tags-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.agents'));
  fs.writeFileSync(path.join(root, '.agents/baton.config.json'), JSON.stringify({ push: 'none' }));
  assert.equal(run(root, 'init').status, 0);
  fs.writeFileSync(path.join(root, '.agents/BACKLOG.md'),
    '# Backlog\n\n## Now\n\n- [ ] **TST-01** `@a` Work tagged for agent a\n- [ ] **TST-02** `@user` Human decision\n');
  return root;
}

test('any agent sees a ready ticket tagged for another agent; @user stays reserved', t => {
  const root = project(t);
  const brief = buildBrief(makeContext(root, loadConfig(root)), 'b');
  const ready = brief.split('### Ready for you')[1].split('\n').filter(l => l.startsWith('- ') && l.includes('**TST-')).join('\n');
  assert.match(ready, /TST-01/);
  assert.doesNotMatch(ready, /TST-02/);
});

test('focus on a ticket tagged for another agent is not refused', t => {
  const root = project(t);
  const res = run(root, 'focus', '--task', 'TST-01 do it', '--owner', 'b', '--status', 'in-progress');
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stderr, /tagged/);
});
