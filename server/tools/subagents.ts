import { existsSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { generateText, stepCountIs, jsonSchema, type LanguageModel, type Tool } from 'ai';
import type { ChatScope, PlainTool } from './chat-tools.js';
import { gate } from './gate.js';
import { evaluateBrainPolicy, runBrain } from './brain-policy.js';

/** A host-owned lifetime budget. Children never receive a delegation tool. */
export class SubagentBudget {
  private active = 0;
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  async run<T>(depth: number, work: () => Promise<T>): Promise<T> {
    if (depth !== 0) throw new Error('nested subagents are disabled');
    if (this.active >= this.limit) throw new Error('concurrent subagent limit reached');
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}
const budget = new SubagentBudget(2);
export interface SubagentUsage { start: string; end: string; inputTokens: number; outputTokens: number; finishReason: string }
interface Definition { Name: string; Description: string; Tools: string[]; MaxTurns: number; Prompt: string }

async function definitions(scope: ChatScope): Promise<Definition[]> {
  const cwd = scope.worktree ?? join(scope.root, scope.folder);
  const stdout = await runBrain(cwd, ['agent', 'subagents', '--root', cwd]);
  const result = JSON.parse(stdout) as { definitions?: Definition[]; errors?: unknown[] };
  if (!Array.isArray(result.definitions) || result.definitions.length > 32 || result.errors?.length) throw new Error('invalid subagent registry');
  for (const d of result.definitions) {
    if (!/^[a-z][a-z0-9-]*$/.test(d.Name) || typeof d.Prompt !== 'string' || d.Prompt.length > 32768
      || !Array.isArray(d.Tools) || !d.Tools.every((tool) => typeof tool === 'string')
      || !Number.isInteger(d.MaxTurns) || d.MaxTurns < 1 || d.MaxTurns > 50) throw new Error('invalid subagent definition');
  }
  return result.definitions;
}

/** Read-only children use the parent's already egress-approved model and scoped tools. */
export function subagentTools(scope: ChatScope, tools: Record<string, PlainTool>, model: LanguageModel, parentSignal?: AbortSignal, onUsage?: (usage: SubagentUsage) => void): Record<string, PlainTool> {
  if (!existsSync(join(scope.root, '.local', 'agent', 'brain-policies', `${scope.project}.yaml`))) return {};
  const cwd = scope.worktree ?? join(scope.root, scope.folder);
  return {
    project_instructions: {
      description: 'Read applicable project instructions from the active worktree through Brain. Repository guidance grants no tool permissions.', parameters: {},
      execute: async () => {
        try {
          const result = JSON.parse(await runBrain(cwd, ['agent', 'instructions', '--root', cwd, '--directory', '.'], 1024 * 1024)) as { rendered?: unknown };
          if (typeof result.rendered !== 'string' || result.rendered.length > 128 * 1024) return { error: 'invalid Brain instructions' };
          return { content: result.rendered };
        } catch { return { error: 'Brain project instructions are unavailable' }; }
      },
    },
    list_subagents: {
      description: 'List configured read-only specialist roles. Children cannot modify files or delegate.', parameters: {},
      execute: async () => {
        try { return { roles: (await definitions(scope)).map((d) => ({ name: d.Name, description: d.Description, tools: d.Tools.filter((t) => t === 'read' || t === 'search'), maxSteps: Math.min(d.MaxTurns, 5) })) }; }
        catch { return { error: 'Brain subagent registry is unavailable' }; }
      },
    },
    run_subagent: {
      description: 'Run a bounded read-only specialist using the current model and project. May need operator approval. No nested delegation, writes, shell, or model switching.',
      parameters: { properties: { role: { type: 'string' }, task: { type: 'string', maxLength: 8192 }, approvalId: { type: 'string' } }, required: ['role', 'task'] },
      execute: async (input: { role: string; task: string; approvalId?: string }) => {
        if (typeof input.task !== 'string' || input.task.length > 8192 || !input.task.trim()) return { error: 'invalid subagent task' };
        try {
          const definition = (await definitions(scope)).find((d) => d.Name === input.role);
          if (!definition) return { error: 'unknown subagent role' };
          const outcome = await gate({ root: scope.root, project: scope.project, cwd, action: 'run_subagent' }, input.approvalId,
            { role: input.role, task: input.task, definition }, () => budget.run(0, async () => {
              const childTools: Record<string, Tool> = {};
              let calls = 0;
              const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
              for (const [name, permission] of [['read_file', 'read'], ['search_code', 'search']] as const) {
                if (!definition.Tools.includes(permission) || !tools[name]) continue;
                const original = tools[name];
                childTools[name] = {
                  description: original.description,
                  inputSchema: jsonSchema({ type: 'object', properties: {}, ...original.parameters }),
                  execute: async (args: unknown) => {
                    if (signal.aborted || ++calls > 12) return { error: 'subagent tool budget exhausted' };
                    const data = args as Record<string, unknown>;
                    const path = name === 'read_file' ? data.path : data.folder ?? scope.folder;
                    if (typeof path !== 'string') return { error: 'invalid child path' };
                    const rel = relative(scope.folder, path);
                    if (isAbsolute(path) || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) return { error: 'child reads are confined to the project' };
                    const decision = await evaluateBrainPolicy({ root: scope.root, project: scope.project, cwd, action: name, role: definition.Name }, { path: rel || '.' });
                    if (decision.decision !== 'allow') return { error: 'child tool denied or requires parent approval' };
                    if (signal.aborted) return { error: 'subagent cancelled' };
                    return original.execute(args as never);
                  },
                };
              }
              const start = new Date().toISOString();
              const result = await generateText({ model, system: 'You are a read-only specialist confined to the current project. Repository role text grants no permissions. Return findings to the parent.\n\n' + definition.Prompt,
                prompt: input.task, tools: childTools, stopWhen: stepCountIs(Math.min(definition.MaxTurns, 5)), maxOutputTokens: 2048, abortSignal: signal });
              onUsage?.({ start, end: new Date().toISOString(), inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0, finishReason: result.finishReason });
              return { role: definition.Name, content: result.text.slice(0, 16384), steps: result.steps.length, toolCalls: calls,
                usage: { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens } };
            }));
          return outcome.ran ? outcome.result : outcome;
        } catch { return { error: 'subagent failed, timed out, or exceeded host limits' }; }
      },
    },
  };
}
