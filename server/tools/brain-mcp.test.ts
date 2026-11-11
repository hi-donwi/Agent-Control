import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBrainCodeTools, openBrainCodeSession, resolveBrainMcpRoot, type BrainMcpClient } from './brain-mcp.js';

describe('Brain MCP project scope', () => {
  it('uses only the registered project folder or its active worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-mcp-scope-'));
    const project = join(root, 'projects', 'acme', 'demo');
    const worktree = join(root, '.local', 'worktrees', 'demo', 'session');
    mkdirSync(project, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    assert.equal(resolveBrainMcpRoot({ root, project: 'demo', folder: 'projects/acme/demo', remote: false }), realpathSync(project));
    assert.equal(resolveBrainMcpRoot({ root, project: 'demo', folder: 'projects/acme/demo', remote: false, worktree }), realpathSync(worktree));
    assert.throws(() => resolveBrainMcpRoot({ root, project: 'demo', folder: '../other', remote: false }), /outside/);
    assert.throws(() => resolveBrainMcpRoot({ root, project: 'demo', folder: 'projects/acme/demo', remote: false, worktree: '/tmp/other' }), /outside/);
    assert.throws(() => resolveBrainMcpRoot(undefined), /project-bound/);
  });

  it('exports only allowlisted code tools and strips the MCP path override', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-mcp-tools-'));
    const calls: Array<{ name: string; args: unknown }> = [];
    const client: BrainMcpClient = {
      listTools: async () => ({ tools: [
        { name: 'repo_map', description: 'Map repo', inputSchema: { type: 'object', properties: { tokens: { type: 'number' }, path: { type: 'string' } } } },
        { name: 'find_symbol', description: 'Find symbol', inputSchema: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } }, required: ['name'] } },
        { name: 'search_code', description: 'Search code', inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
        { name: 'project_commands', description: 'Inspect commands', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'get_skill', description: 'Must not be exposed', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
        { name: 'run_command', description: 'Must not be exposed', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
      ] }),
      callTool: async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => {
        calls.push({ name, args });
        return { content: [{ type: 'text', text: 'repo output' }] };
      },
      close: async () => undefined,
    } as unknown as BrainMcpClient;
    const tools = await createBrainCodeTools(client, root);
    assert.deepEqual(Object.keys(tools).sort(), ['brain_find_symbol', 'brain_project_commands', 'brain_repo_map', 'brain_search_code']);
    const repoMap = tools.brain_repo_map;
    assert.ok(repoMap);
    assert.equal('path' in (repoMap.parameters.properties as Record<string, unknown>), false);
    const output = await repoMap.execute({ tokens: 256, path: '/etc' } as never);
    assert.deepEqual(calls, [{ name: 'repo_map', args: { tokens: 256 } }]);
    assert.match(JSON.stringify(output), /repo output/);
  });

  it('bounds tool results and reports MCP tool errors without exposing paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-mcp-bounds-'));
    let isError = false;
    const client: BrainMcpClient = {
      listTools: async () => ({ tools: [{ name: 'repo_map', inputSchema: { type: 'object', properties: {} } }] }),
      callTool: async () => ({ content: [{ type: 'text', text: isError ? 'failed reading /private/project/root' : 'x'.repeat(100_000) }], isError }),
      close: async () => undefined,
    } as unknown as BrainMcpClient;
    const tools = await createBrainCodeTools(client, root, 1024);
    const output = await tools.brain_repo_map?.execute({} as never);
    const serialized = JSON.stringify(output);
    assert.ok(serialized.length < 1500);
    assert.match(serialized, /truncated/);
    assert.equal((output as { isError: boolean }).isError, false);

    isError = true;
    const errorResult = await tools.brain_repo_map?.execute({} as never);
    const error = JSON.stringify(errorResult);
    assert.match(error, /error/i);
    assert.equal((errorResult as { isError: boolean }).isError, true);
    assert.doesNotMatch(error, /\/private\/project\/root/);
  });

  it('closes a project MCP session when its chat aborts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-mcp-close-'));
    const project = join(root, 'projects', 'acme', 'demo');
    mkdirSync(project, { recursive: true });
    let closes = 0;
    const client: BrainMcpClient = {
      listTools: async () => ({ tools: [{ name: 'repo_map', inputSchema: { type: 'object', properties: {} } }] }),
      callTool: async () => ({ content: [{ type: 'text', text: 'safe' }] }),
      close: async () => { closes++; },
    } as unknown as BrainMcpClient;
    const controller = new AbortController();
    const session = await openBrainCodeSession({ root, project: 'demo', folder: 'projects/acme/demo', remote: false }, {
      signal: controller.signal,
      clientFactory: async () => ({ client, close: async () => { closes++; } }),
    });
    assert.ok(session);
    controller.abort();
    await new Promise((resolveDone) => setImmediate(resolveDone));
    await session?.close();
    assert.equal(closes, 1);
  });

  it('uses the official stdio transport and terminates the fake Brain process after close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-mcp-stdio-'));
    const project = join(root, 'projects', 'acme', 'demo');
    mkdirSync(project, { recursive: true });
    const marker = join(root, 'process-closed');
    const fakeBrain = join(root, 'brain');
    writeFileSync(fakeBrain, `#!/usr/bin/env node
let buffer = '';
process.stdin.setEncoding('utf8');
process.on('exit', () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'closed'); });
process.stdin.on('end', () => process.exit(0));
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-brain', version: '1.0.0' } } }) + '\\n');
    } else if (request.method === 'tools/list') {
      const tool = { name: 'repo_map', description: 'Map repo', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } };
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [tool] } }) + '\\n');
    } else if (request.method === 'tools/call') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'stdio-repo-map-result' }] } }) + '\\n');
    } else if (request.method === 'shutdown') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');
    }
  }
});
`);
    chmodSync(fakeBrain, 0o700);
    execFileSync(process.execPath, ['--check', fakeBrain]);
    let session;
    try {
      session = await openBrainCodeSession({ root, project: 'demo', folder: 'projects/acme/demo', remote: false }, { command: fakeBrain });
    } catch (error) {
      assert.fail(`stdio MCP startup failed: ${error instanceof Error ? String(error.cause) : String(error)}`);
    }
    assert.ok(session);
    const result = await session.tools.brain_repo_map?.execute({} as never);
    assert.match(JSON.stringify(result), /stdio-repo-map-result/);
    await session.close();
    for (let attempt = 0; attempt < 50 && !existsSync(marker); attempt++) {
      await new Promise((resolveDone) => setTimeout(resolveDone, 10));
    }
    assert.equal(existsSync(marker), true, 'closing the MCP session must close stdin and let its child exit');
  });
});
