import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stepCountIs, streamText } from 'ai';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatTools } from './chat-tools.js';
import { WorkspaceBridge } from './workspace.js';
import type { Tool } from 'ai';
import { createMockModel } from '../providers/mock.js';

describe('createChatTools', () => {
  it('declares every tool so a chat runs at all', async () => {
    // Plain-object schemas are read as zod schemas by the AI SDK and threw on every
    // request ("Cannot read properties of undefined (reading 'typeName')").
    const tools = createChatTools(new WorkspaceBridge('/nonexistent-workspace'));
    assert.ok(Object.keys(tools).length >= 10);
    const result = streamText({
      model: createMockModel('echo'),
      messages: [{ role: 'user', content: 'ping' }],
      tools,
      stopWhen: stepCountIs(5),
    });
    let text = '';
    let error: unknown;
    for await (const part of result.fullStream) {
      if (part.type === 'error') error = part.error;
      if (part.type === 'text-delta') text += part.text;
    }
    assert.equal(error, undefined);
    assert.equal(text, 'mock(echo): ping');
  });
});

/** A bridge that records what it was asked, instead of running ws. */
function fakeBridge(calls: string[]): WorkspaceBridge {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name}:${JSON.stringify(args)}`); return 'ok'; };
  return {
    listProjects: record('listProjects'), tree: record('tree'), contextPack: record('contextPack'),
    readProjectFile: record('readProjectFile'), search: record('search'), route: record('route'),
    readSkill: record('readSkill'), dbakit: record('dbakit'), opskit: record('opskit'), agentSecure: record('agentSecure'),
  } as unknown as WorkspaceBridge;
}

function run(tools: Record<string, Tool>, name: string, input: unknown): Promise<unknown> {
  return (tools[name].execute as (input: unknown, options: unknown) => Promise<unknown>)(input, { toolCallId: 't', messages: [] });
}

describe('createChatTools bound to a project (ADR-0011)', () => {
  const scope = { root: '/ws', project: 'demo', folder: 'projects/acme/demo', remote: true };

  it('offers no tool that lists other projects, and no host diagnostics to a remote model', () => {
    const tools = createChatTools(fakeBridge([]), scope);
    for (const name of ['list_projects', 'project_tree', 'diagnose_database', 'diagnose_infra']) {
      assert.equal(name in tools, false, name);
    }
    assert.ok('diagnose_infra' in createChatTools(fakeBridge([]), { ...scope, remote: false }));
  });

  it('loads only its own context pack and scans only its own project', async () => {
    const calls: string[] = [];
    const tools = createChatTools(fakeBridge(calls), scope);
    await assert.rejects(() => run(tools, 'context_pack', { projectKey: 'other' }), /bound to demo/);
    await assert.rejects(() => run(tools, 'scan_security', { projectKey: 'other' }), /bound to demo/);
    await run(tools, 'context_pack', { projectKey: 'demo' });
    await run(tools, 'route_skills', { taskDescription: 'x', projectKey: 'other' });
    assert.deepEqual(calls, ['contextPack:["demo"]', 'route:["x","demo"]']);
  });

  it('reads files of its project, its memory and runs, and the framework - nothing else', async () => {
    const calls: string[] = [];
    const tools = createChatTools(fakeBridge(calls), scope);
    for (const path of ['projects/acme/demo/src/a.ts', 'context/memory/projects/demo/active.md',
      'context/runs/demo/r1/plan.md', '.agents/standards/core/x.md', 'AGENTS.md']) {
      await run(tools, 'read_file', { path });
    }
    for (const path of ['projects/acme/other/a.ts', 'context/memory/projects/other/active.md',
      'context/clients/acme/client.md', 'projects/acme/demo/../other/a.ts', '/etc/passwd']) {
      await assert.rejects(() => run(tools, 'read_file', { path }), /outside project demo/, path);
    }
    assert.equal(calls.length, 5);
  });

  it('searches inside its project folder only', async () => {
    const calls: string[] = [];
    const tools = createChatTools(fakeBridge(calls), scope);
    await run(tools, 'search_code', { query: 'q' });
    await run(tools, 'search_code', { query: 'q', folder: 'projects/acme/demo/src' });
    await assert.rejects(() => run(tools, 'search_code', { query: 'q', folder: 'projects/acme' }), /outside project demo/);
    assert.deepEqual(calls, ['search:["q","projects/acme/demo"]', 'search:["q","projects/acme/demo/src"]']);
  });
});

describe('run_command is scoped to a bound project', () => {
  it('is not offered to an unbound chat - no project folder to run it in', () => {
    assert.equal('run_command' in createChatTools(new WorkspaceBridge('/nonexistent-workspace')), false);
  });

  it('runs in the project folder once its policy allows it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ac-chattools-runcmd-'));
    const folder = 'projects/acme/demo';
    const cwd = join(root, folder);
    mkdirSync(cwd, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd });
    mkdirSync(join(root, '.local', 'agent', 'policies'), { recursive: true });
    writeFileSync(join(root, '.local', 'agent', 'policies', 'demo.json'),
      JSON.stringify({ schema_version: 1, default: 'read', actions: {} }));
    const tools = createChatTools(new WorkspaceBridge(root), { root, project: 'demo', folder, remote: false });
    assert.ok('run_command' in tools);
    const result = await (tools.run_command.execute as (input: unknown, options: unknown) => Promise<unknown>)(
      { command: 'echo', args: ['from-chat-tools'] }, { toolCallId: 't', messages: [] });
    assert.ok((result as { content: string }).content.includes('from-chat-tools'));
  });
});
