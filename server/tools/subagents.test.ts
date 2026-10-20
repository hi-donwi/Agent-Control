import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SubagentBudget } from './subagents.js';

it('limits concurrent children, releases slots after failures and rejects nested calls', async () => {
 const budget=new SubagentBudget(1);
 let release!:()=>void;
 const active=budget.run(0,async()=>new Promise<string>((resolve)=>{release=()=>resolve('done');}));
 await assert.rejects(()=>budget.run(0,async()=>''),/concurrent/);
 await assert.rejects(()=>budget.run(1,async()=>''),/nested/);
 release();assert.equal(await active,'done');
 await assert.rejects(()=>budget.run(0,async()=>{throw new Error('failed');}),/failed/);
 assert.equal(await budget.run(0,async()=>'recovered'),'recovered');
});

it('runs a specialist with the inherited mock model and refuses unknown roles', async () => {
 const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
 const { join } = await import('node:path');
 const { tmpdir } = await import('node:os');
 const { execFileSync } = await import('node:child_process');
 const { createMockModel } = await import('../providers/mock.js');
 const { subagentTools } = await import('./subagents.js');
 const root=mkdtempSync(join(tmpdir(),'child-agent-'));
 execFileSync('git',['init','-q'],{cwd:root});
 execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-qm','init'],{cwd:root});
 mkdirSync(join(root,'.local/agent/brain-policies'),{recursive:true});
 mkdirSync(join(root,'.local/agent/policies'),{recursive:true});
 writeFileSync(join(root,'.local/agent/brain-policies/demo.yaml'),'default: allow');
 writeFileSync(join(root,'.local/agent/policies/demo.json'),JSON.stringify({schema_version:1,default:'change',actions:{}}));
 const fake=join(root,'brain');
 writeFileSync(fake,`#!/bin/sh
if [ "$2" = "subagents" ]; then
printf '%s\\n' '{"definitions":[{"Name":"reviewer","Description":"Review","Tools":["read","search","write","subagent"],"MaxTurns":12,"Prompt":"Review only."}],"errors":[]}'
else
printf '%s\\n' '{"decision":"allow","executed":false}'
fi
`,{mode:0o700});
 const previous=process.env.AGENT_BRAIN_BINARY;process.env.AGENT_BRAIN_BINARY=fake;
 try {
  let usage=0;
  const tools=subagentTools({root,project:'demo',folder:'.',remote:false},{},createMockModel('inherited'),undefined,()=>{usage++;});
  const result=await tools.run_subagent.execute({role:'reviewer',task:'inspect'} as never) as {content:string;steps:number};
  assert.equal(result.content,'mock(inherited): inspect');
  assert.equal(result.steps,1);assert.equal(usage,1);
  const missing=await tools.run_subagent.execute({role:'missing',task:'inspect'} as never) as {error:string};
  assert.equal(missing.error,'unknown subagent role');
  const { MockLanguageModelV4 } = await import('ai/test');
  const usageShape={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
  const toolModel=new MockLanguageModelV4({doGenerate:[
    {content:[{type:'tool-call',toolCallId:'escape',toolName:'read_file',input:JSON.stringify({path:'../outside'})}],finishReason:{unified:'tool-calls',raw:undefined},usage:usageShape,warnings:[]},
    {content:[{type:'text',text:'done'}],finishReason:{unified:'stop',raw:undefined},usage:usageShape,warnings:[]},
  ]});
  let reads=0;
  const childTools=subagentTools({root,project:'demo',folder:'.',remote:false},{read_file:{description:'Read',parameters:{properties:{path:{type:'string'}},required:['path']},execute:async()=>{reads++;return {content:'should not run'};}}},toolModel);
  const child=await childTools.run_subagent.execute({role:'reviewer',task:'inspect'} as never) as {content:string};
  assert.equal(child.content,'done');assert.equal(reads,0);
  assert.match(JSON.stringify(toolModel.doGenerateCalls[1].prompt),/confined to the project/);

  const listed=await tools.list_subagents.execute({} as never) as {roles:{tools:string[]}[]};
  assert.deepEqual(listed.roles[0].tools,['read','search']);
 } finally {if(previous===undefined)delete process.env.AGENT_BRAIN_BINARY;else process.env.AGENT_BRAIN_BINARY=previous;}
});
