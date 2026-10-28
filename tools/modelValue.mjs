#!/usr/bin/env node
/** Offline, explicit-rate arithmetic. Never dispatches models or grants authority. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const required = (ok, message) => { if (!ok) throw new Error(message); };
const text = s => typeof s === 'string' && s.trim().length > 0;
const date = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;

/** inputTokens includes cache hits, outputTokens already includes reasoning. */
export function priceCall(call, registry, {now = new Date().toISOString().slice(0,10)} = {}) {
  required(date(now), 'Invalid accounting date');
  required(registry?.service==='direct-api-standard-text', 'Only direct-api-standard-text prices are supported');
  required(registry.currency==='USD' && registry.unit==='per million tokens', 'USD per-million-token registry required');
  const matches=registry.entries?.filter(e=>e.model===call.model)??[];
  required(matches.length===1, `Unknown or duplicate exact model price: ${call.model}`);
  const price=matches[0];
  required(date(price.checkedAt) && price.checkedAt<=now && finite(registry.maxAgeDays) && registry.maxAgeDays>0 && (Date.parse(now)-Date.parse(price.checkedAt))/86400000<=registry.maxAgeDays, 'Price evidence stale or invalid');
  required(price.validThrough===null || date(price.validThrough) && now<=price.validThrough, 'Introductory price expired');
  required(text(price.source) && price.source.startsWith('https://'), 'Missing price source');
  required(finite(price.maxPromptTokens) && price.maxPromptTokens>0, 'Finite positive supported prompt limit required');
  required(call.service==='direct-api-standard-text', 'Explicit Standard direct API service required; subscription/credits/Fast are different');
  for(const key of ['inputTokens','cachedInputTokens','outputTokens','maxPromptTokens','cacheWriteCostUsd','otherCostUsd']) required(finite(call[key]), `Missing/invalid ${key}; unknown is not zero`);
  for(const key of ['inputTokens','cachedInputTokens','outputTokens','maxPromptTokens']) required(Number.isInteger(call[key]), `Integer token count required: ${key}`);
  required(!('reasoningTokens' in call), 'outputTokens must already include reasoning; remove separate reasoningTokens');
  required(call.cachedInputTokens<=call.inputTokens,'Cached tokens must be a subset of inputTokens');
  required(call.maxPromptTokens<=price.maxPromptTokens, 'Unsupported prompt length');
  required(call.inputTokens===0 && call.cacheWriteCostUsd===0 || call.maxPromptTokens>0,'A nonempty or cache-write input needs a positive full-prompt bound');
  required(text(call.effort), 'Exact effort required');
  for(const key of ['input','cachedInput','output']) required(finite(price.rates?.[key]),`Missing/invalid ${key} price`);
  const uncached=call.inputTokens-call.cachedInputTokens;
  const tokenCostUsd=(uncached*price.rates.input+call.cachedInputTokens*price.rates.cachedInput+call.outputTokens*price.rates.output)/1e6;
  const costUsd=tokenCostUsd+call.cacheWriteCostUsd+call.otherCostUsd;
  required(Number.isFinite(costUsd),'Cost overflow');
  return {model:call.model,effort:call.effort,inputTokens:call.inputTokens,cachedInputTokens:call.cachedInputTokens,outputTokens:call.outputTokens,tokenCostUsd,costUsd,source:price.source,checkedAt:price.checkedAt};
}

/** Compare only matched tasks/rubric. Supplied sample outcomes are not forecasts. */
export function compare(scenario, registry, options={}) {
  required(text(scenario?.taskClass) && text(scenario.rubric) && text(scenario.taskSet), 'Task class, shared rubric and matched taskSet are required');
  required(finite(scenario.requiredPassRate) && scenario.requiredPassRate>0 && scenario.requiredPassRate<=1,'requiredPassRate must be >0 and <=1');
  required(Array.isArray(scenario.candidates) && scenario.candidates.length>0,'Candidates required');
  const labels=new Set();
  const candidates=scenario.candidates.map(candidate=>{
    required(text(candidate.id) && !labels.has(candidate.id),'Unique candidate id required'); labels.add(candidate.id);
    const outcome={id:candidate.id,costUsd:null,costPerAcceptedUsd:null,acceptedPerUsd:null,passRate:null,qualityFloorMet:false,rankable:false,evidence:candidate.evidence??null,reason:''};
    try {
      required(['measured','scenario'].includes(candidate.evidence),'evidence must be measured or scenario');
      required(candidate.completeWorkflow===true,'Incomplete workflow coverage; no total-cost value ranking');
      required(Array.isArray(candidate.calls)&&candidate.calls.length>0,'Complete call ledger required');
      required(Number.isInteger(candidate.attempts)&&candidate.attempts>0 && Number.isInteger(candidate.accepted)&&candidate.accepted>=0&&candidate.accepted<=candidate.attempts,'Invalid attempts/accepted sample');
      const calls=candidate.calls.map(c=>priceCall(c,registry,options));
      const total=calls.reduce((s,c)=>s+c.costUsd,0);
      required(Number.isFinite(total)&&total>0,'Zero/invalid cost cannot establish value');
      outcome.costUsd=total;
      outcome.passRate=candidate.accepted/candidate.attempts;
      outcome.qualityFloorMet=outcome.passRate>=scenario.requiredPassRate;
      outcome.costPerAcceptedUsd=candidate.accepted>0?total/candidate.accepted:null;
      outcome.acceptedPerUsd=candidate.accepted/total;
      outcome.rankable=outcome.qualityFloorMet && candidate.evidence==='measured';
      outcome.reason=candidate.evidence==='scenario'?'Illustration only: assumed outcomes/usage cannot qualify or establish a winner':outcome.qualityFloorMet?'Observed sample meets declared quality floor; inspect sample size and risk checks':'Observed sample misses required quality floor';
      outcome.calls=calls;
    } catch(error) { outcome.reason=error.message; }
    return outcome;
  });
  const rankable=candidates.filter(c=>c.rankable).sort((a,b)=>a.costPerAcceptedUsd-b.costPerAcceptedUsd);
  return {taskClass:scenario.taskClass,rubric:scenario.rubric,taskSet:scenario.taskSet,costBasis:'Modeled current Standard API price equivalent of supplied usage; not observed billing or quota',qualification:'No authority granted. Task qualification, capabilities, risk and latency must be checked separately.',bestObservedValue:rankable[0]?.id??null,candidates};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {
    const args=process.argv.slice(2);
    required(args.length===1,'Usage: node tools/modelValue.mjs <scenario.json>');
    const registry=JSON.parse(fs.readFileSync(new URL('../model-prices.json',import.meta.url),'utf8'));
    const scenario=JSON.parse(fs.readFileSync(args[0],'utf8'));
    process.stdout.write(JSON.stringify(compare(scenario,registry),null,2)+'\n');
  } catch(error){ process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
