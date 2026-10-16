/**
 * What this host's own chat is doing, per project. Only the host sees its agent loop step
 * by step, so only host agents show specific poses; the chat stream feeds this registry
 * through `tap()` as it passes to the browser.
 */
export type HostState = 'idle' | 'thinking' | 'reading' | 'typing' | 'running' | 'learning' | 'warning';

export interface HostActivity {
  project: string;
  state: HostState;
  detail: string;
  /** When the current state began. */
  since: string;
  /** Last change of any kind, for pruning hosts that went quiet long ago. */
  updatedMs: number;
}

const TOOL_STATES: Record<string, HostState> = {
  read_file: 'reading',
  search_code: 'reading',
  context_pack: 'reading',
  list_projects: 'reading',
  project_tree: 'reading',
  git_diff: 'reading',
  write_file: 'typing',
  edit_file: 'typing',
  run_command: 'running',
  diagnose_database: 'running',
  diagnose_infra: 'running',
  scan_security: 'running',
  get_skill: 'learning',
  route_skills: 'learning',
};

export function stateForTool(name: string): HostState {
  return TOOL_STATES[name] ?? 'running';
}

/** An idle host agent leaves the floor after this long without a turn. */
export const IDLE_TTL_MS = 60 * 60 * 1000;

interface StreamPart {
  type: string;
  toolName?: string;
}

export class ActivityRegistry {
  private readonly entries = new Map<string, HostActivity>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  set(project: string, state: HostState, detail: string): void {
    const nowMs = this.now();
    const current = this.entries.get(project);
    if (current && current.state === state && current.detail === detail) {
      current.updatedMs = nowMs;
      return;
    }
    this.entries.set(project, { project, state, detail, since: new Date(nowMs).toISOString(), updatedMs: nowMs });
  }

  get(project: string): HostActivity | undefined {
    return this.entries.get(project);
  }

  /** Every project with host activity, dropping idle ones older than `IDLE_TTL_MS`. */
  list(): HostActivity[] {
    const nowMs = this.now();
    for (const [project, entry] of this.entries) {
      if (entry.state === 'idle' && nowMs - entry.updatedMs > IDLE_TTL_MS) this.entries.delete(project);
    }
    return [...this.entries.values()];
  }

  /**
   * Passes `parts` through unchanged while recording what each one says the turn is doing.
   * A turn that ends without a finish part (the browser stopped it) leaves the agent idle.
   */
  async *tap<T extends StreamPart>(project: string, parts: AsyncIterable<T>): AsyncGenerator<T> {
    this.set(project, 'thinking', 'waiting for the model');
    let settled = false;
    try {
      for await (const part of parts) {
        switch (part.type) {
          case 'text-delta':
            this.set(project, 'typing', 'writing the answer');
            break;
          case 'reasoning-delta':
          case 'start-step':
            this.set(project, 'thinking', 'waiting for the model');
            break;
          case 'tool-call': {
            const name = part.toolName ?? 'tool';
            this.set(project, stateForTool(name), name);
            break;
          }
          case 'tool-result':
            this.set(project, 'thinking', 'reading the tool result');
            break;
          case 'tool-error':
            this.set(project, 'warning', `${part.toolName ?? 'tool'} failed`);
            break;
          case 'error':
            this.set(project, 'warning', 'the turn failed');
            settled = true;
            break;
          case 'finish':
            this.set(project, 'idle', 'turn finished');
            settled = true;
            break;
        }
        yield part;
      }
    } finally {
      if (!settled) this.set(project, 'idle', 'turn stopped');
    }
  }
}
