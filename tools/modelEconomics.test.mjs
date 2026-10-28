import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { priceCall, compare } from './modelValue.mjs';
import { assessTask } from './modelAuthority.mjs';
const now='2026-10-28';
const prices=JSON.parse(fs.readFileSync(new URL('../model-prices.json',import.meta.url),'utf8'));
const call=(model='gpt-6.1-sol',outputTokens=10000)=>({model,effort:'max',service:'direct-api-standard-text',inputTokens:100000,cachedInputTokens:0,outputTokens,maxPromptTokens:100000,cacheWriteCostUsd:0,otherCostUsd:0});
const ctx={project:'example-project',task:'ui-layout',configuration:'sol-max-v1',risk:'low',now};
const qualification=()=>({id:'example-ui',status:'active',model:'gpt-6.1-sol',effort:'max',project:ctx.project,task:ctx.task,configuration:ctx.configuration,risk:'low',checkedAt:now,expiresAt:'2026-11-28',scope:'Responsive marketing-page layout only',exclusions:['authentication','payments'],configurationDetails:{endpoint:'explicit test endpoint',fallback:'none',harness:'fixture-v1',tools:'browser-v1',settings:'max, fixture token cap'},quality:{rubric:'layout-v1',criteria:'Independent visual/accessibility checklist passed',predeclared:true,artifacts:['fixture-results.json'],trials:20,accepted:19,minTrials:20,minPassRate:.9},review:{by:'fixture independent reviewer',independent:true,approvedAt:now,decision:'fixture-decision.md'},verification:'fixture-results.json'});
test('5x rates: same supplied workload costs $1.50 Astra vs $0.30 Sol',()=>{
 assert.equal(priceCall(call(),prices,{now}).costUsd,.3);
 assert.equal(priceCall(call('gpt-6-astra'),prices,{now}).costUsd,1.5);
});
test('cross-provider accessible models (Gemini Flash-Lite/Flash, Grok 4.20/Build) price accurately',()=>{
 assert.equal(priceCall(call('gemini-3.5-flash-lite'),prices,{now}).costUsd,.055);
 assert.equal(priceCall(call('gemini-3.6-flash'),prices,{now}).costUsd,.1125);
 assert.equal(priceCall(call('grok-4.20-0309-non-reasoning'),prices,{now}).costUsd,.15);
 assert.equal(priceCall(call('grok-4.20-0309-reasoning'),prices,{now}).costUsd,.15);
 assert.equal(priceCall(call('grok-build-0.1'),prices,{now}).costUsd,.12);
});
test('effort affects cost through consumed tokens, not an invented price multiplier',()=>{
 assert.equal(priceCall(call('gpt-6.1-sol',30000),prices,{now}).costUsd,.5);
 const higher={...call(),effort:'high'};
 assert.equal(priceCall(higher,prices,{now}).costUsd,.3);
});
test('full prompt can exceed ordinary input when separately billed cache writes are excluded',()=>{
 const c={...call(),inputTokens:2000,maxPromptTokens:100000,outputTokens:0,cacheWriteCostUsd:.245};
 assert.equal(priceCall(c,prices,{now}).costUsd,.249);
 const cacheOnly={...c,inputTokens:0,cacheWriteCostUsd:.25};
 assert.equal(priceCall(cacheOnly,prices,{now}).costUsd,.25);
 assert.throws(()=>priceCall({...cacheOnly,maxPromptTokens:0},prices,{now}),/full-prompt/);
});
test('unknown currency or billing unit cannot be silently labeled USD',()=>{
 assert.throws(()=>priceCall(call(),{...prices,currency:'EUR'},{now}),/USD/);
 assert.throws(()=>priceCall(call(),{...prices,unit:'per token'},{now}),/per-million/);
});
test('cache subset charged once, output already includes reasoning',()=>{
 const c={...call(),cachedInputTokens:80000};
 assert.equal(priceCall(c,prices,{now}).costUsd,.148);
 assert.throws(()=>priceCall({...c,cachedInputTokens:100001},prices,{now}),/subset/);
 assert.throws(()=>priceCall({...c,reasoningTokens:1000},prices,{now}),/already include/);
});
test('unknown models, null usage, missing charges, wrong mode and long context fail closed',()=>{
 for(const c of [{...call(),model:'gpt-6-sol-unknown'},{...call(),inputTokens:null},{...call(),otherCostUsd:undefined},{...call(),service:'subscription'},{...call(),inputTokens:300000,maxPromptTokens:300000}]) assert.throws(()=>priceCall(c,prices,{now}));
});
test('expired introductory and stale prices cannot be used',()=>{
 assert.throws(()=>priceCall(call('gemini-4-argon'),prices,{now:'2026-12-01'}),/stale|expired/);
 const fresh=structuredClone(prices); fresh.entries.find(e=>e.model==='gemini-4-argon').checkedAt='2026-12-01';
 assert.throws(()=>priceCall(call('gemini-4-argon'),fresh,{now:'2026-12-01'}),/expired/);
});
const scenario=()=>({taskClass:'ui-layout',rubric:'layout-v1',taskSet:'matched-fixtures-v1',requiredPassRate:.9,candidates:[{id:'sol',evidence:'measured',completeWorkflow:true,attempts:10,accepted:9,calls:[call(),call('gpt-6-astra')]}]});
test('workflow total includes review and failed attempts; accepted results are denominator',()=>{
 const out=compare(scenario(),prices,{now});
 assert.equal(out.candidates[0].costUsd,1.8);
 assert.equal(out.candidates[0].costPerAcceptedUsd,.2);
 assert.equal(out.bestObservedValue,'sol');
});
test('incomplete totals, failed quality, hypothetical outcomes and zero acceptance do not win',()=>{
 for(const patch of [{completeWorkflow:false},{evidence:'scenario'},{accepted:8},{accepted:0}]){
  const s=scenario();Object.assign(s.candidates[0],patch);const out=compare(s,prices,{now});assert.equal(out.bestObservedValue,null);
  if(patch.accepted===0){assert.equal(out.candidates[0].acceptedPerUsd,0);assert.equal(out.candidates[0].costPerAcceptedUsd,null);}
 }
});
test('zero-cost episode never creates infinite value',()=>{
 const s=scenario();s.candidates[0].calls=[{...call(),inputTokens:0,outputTokens:0,maxPromptTokens:0}];
 assert.equal(compare(s,prices,{now}).bestObservedValue,null);
});
test('below-cutoff Sol can qualify for exact reviewed task without global promotion',()=>{
 assert.equal(assessTask('gpt-6.1-sol','max',qualification(),ctx).eligible,true);
});
test('task/project/configuration/effort/risk mismatch never inherits qualification',()=>{
 for(const field of ['task','project','configuration','risk']) assert.equal(assessTask('gpt-6.1-sol','max',qualification(),{...ctx,[field]:'other'}).eligible,false);
 assert.equal(assessTask('gpt-6.1-sol','high',qualification(),ctx).eligible,false);
 assert.equal(assessTask('gpt-6-astra','max',qualification(),ctx).eligible,false);
});
test('revoked, unreviewed, expired and insufficient evidence cannot qualify',()=>{
 for(const mutate of [q=>q.status='revoked',q=>q.expiresAt='2026-10-27',q=>q.review={},q=>q.quality.trials=0,q=>q.quality.accepted=10,q=>q.quality.predeclared=false,q=>q.quality.artifacts=[],q=>q.configurationDetails.fallback='']){
  const q=qualification();mutate(q);assert.equal(assessTask('gpt-6.1-sol','max',q,ctx).eligible,false);
 }
});
test('high-risk qualification retains high+ and independent current-result verification',()=>{
 const q=qualification();q.risk='high';const c={...ctx,risk:'high'};
 assert.equal(assessTask(q.model,q.effort,q,c).eligible,false);
 q.currentResultReview='independent review of fixture revision abc';assert.equal(assessTask(q.model,q.effort,q,c).eligible,true);
 q.review.independent=false;q.review.user=true;assert.equal(assessTask(q.model,q.effort,q,c).eligible,false);
 q.review.independent=true;q.effort='medium';assert.equal(assessTask(q.model,q.effort,q,c).eligible,false);
});
test('explicit CLI qualification has exact context and never falls back to benchmark approval',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'furious-value-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'qualification.json');const q=qualification();
 const today=new Date().toISOString().slice(0,10);q.checkedAt=today;q.review.approvedAt=today;q.expiresAt=today;
 fs.writeFileSync(file,JSON.stringify(q));
 const cli=fileURLToPath(new URL('./modelAuthority.mjs',import.meta.url));
 const args=['--effort','max','--qualification',file,'--task',ctx.task,'--project',ctx.project,'--configuration',ctx.configuration,'--risk','low'];
 const good=spawnSync(process.execPath,[cli,q.model,...args],{encoding:'utf8'});assert.equal(good.status,0);assert.equal(JSON.parse(good.stdout).basis,'reviewed-task-qualification');
 const mismatch=spawnSync(process.execPath,[cli,'gpt-6-astra',...args],{encoding:'utf8'});assert.equal(mismatch.status,2);assert.equal(JSON.parse(mismatch.stdout).eligible,false);
 const missing=spawnSync(process.execPath,[cli,q.model,...args.slice(0,-2)],{encoding:'utf8'});assert.equal(missing.status,1);
});
