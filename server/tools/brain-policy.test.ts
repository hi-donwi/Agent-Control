import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateBrainPolicy } from './brain-policy.js';

it('is inactive unless the operator configures a project Brain policy', async () => {
 const root=mkdtempSync(join(tmpdir(),'brain-policy-'));
 assert.equal((await evaluateBrainPolicy({root,project:'demo',cwd:root,action:'write_file'},{path:'a'})).decision,'inactive');
});
it('fails closed for configured policy when Brain is unavailable', async () => {
 const root=mkdtempSync(join(tmpdir(),'brain-policy-'));
 mkdirSync(join(root,'.local/agent/brain-policies'),{recursive:true});
 writeFileSync(join(root,'.local/agent/brain-policies/demo.yaml'),'default: deny');
 const result=await evaluateBrainPolicy({root,project:'demo',cwd:root,action:'write_file'},{path:'a'},'/nonexistent/brain');
 assert.equal(result.decision,'deny');
});
it('passes structured command arguments and rejects extra Brain output', async () => {
 const root=mkdtempSync(join(tmpdir(),'brain-policy-'));
 mkdirSync(join(root,'.local/agent/brain-policies'),{recursive:true});
 writeFileSync(join(root,'.local/agent/brain-policies/demo.yaml'),'default: ask');
 const fake=join(root,'brain');
 writeFileSync(fake,'#!/bin/sh\nprintf \'{"decision":"ask","executed":false}\\n\'\n',{mode:0o700});
 const result=await evaluateBrainPolicy({root,project:'demo',cwd:root,action:'run_command'},{command:'echo',args:['$(touch /tmp/never-run)']},fake);
 assert.equal(result.decision,'ask');
 assert.ok(result.fingerprint);
 writeFileSync(fake,'#!/bin/sh\nprintf \'{"decision":"allow","executed":true}\\n\'\n',{mode:0o700});
 assert.equal((await evaluateBrainPolicy({root,project:'demo',cwd:root,action:'write_file'},{path:'a'},fake)).decision,'deny');
});

it('Brain ask forces approval even when workspace permits; policy changes void it', async () => {
 const { execFileSync } = await import('node:child_process');
 const { gate } = await import('./gate.js');
 const { decide } = await import('../approvals.js');
 const root=mkdtempSync(join(tmpdir(),'brain-gate-'));
 execFileSync('git',['init','-q'],{cwd:root});
 execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-qm','init'],{cwd:root});
 mkdirSync(join(root,'.local/agent/brain-policies'),{recursive:true});
 mkdirSync(join(root,'.local/agent/policies'),{recursive:true});
 const policy=join(root,'.local/agent/brain-policies/demo.yaml');
 writeFileSync(policy,'default: ask');
 writeFileSync(join(root,'.local/agent/policies/demo.json'),JSON.stringify({schema_version:1,default:'change',actions:{}}));
 const fake=join(root,'brain');
 writeFileSync(fake,'#!/bin/sh\nprintf \'{"decision":"ask","executed":false}\\n\'\n',{mode:0o700});
 const previous=process.env.AGENT_BRAIN_BINARY;process.env.AGENT_BRAIN_BINARY=fake;
 try {
  let calls=0;
  const deps={root,project:'demo',cwd:root,action:'write_file'};
  const first=await gate(deps,undefined,{path:'a'},async()=>++calls);
  assert.ok(!first.ran && 'approvalRequired' in first);
  assert.equal(calls,0);
  decide(root,'demo',first.requestId,'approved');
  writeFileSync(policy,'default: ask\n# changed');
  const changed=await gate(deps,first.requestId,{path:'a'},async()=>++calls);
  assert.ok(!changed.ran && 'error' in changed);
  assert.equal(calls,0);
  const second=await gate(deps,undefined,{path:'a'},async()=>++calls);
  assert.ok(!second.ran && 'approvalRequired' in second);
  decide(root,'demo',second.requestId,'approved');
  assert.equal((await gate(deps,second.requestId,{path:'a'},async()=>++calls)).ran,true);
  assert.equal(calls,1);
  assert.equal((await gate(deps,second.requestId,{path:'a'},async()=>++calls)).ran,false);
  assert.equal(calls,1);
 } finally {if(previous===undefined)delete process.env.AGENT_BRAIN_BINARY;else process.env.AGENT_BRAIN_BINARY=previous;}
});
