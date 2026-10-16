import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityRegistry, IDLE_TTL_MS, stateForTool } from './activity.js';

async function* parts(list: Array<{ type: string; toolName?: string }>) {
  for (const part of list) yield part;
}

async function drain<T>(stream: AsyncIterable<T>, onEach?: (part: T) => void): Promise<T[]> {
  const seen: T[] = [];
  for await (const part of stream) {
    onEach?.(part);
    seen.push(part);
  }
  return seen;
}

describe('stateForTool', () => {
  it('maps reading, writing, running, and learning tools', () => {
    assert.equal(stateForTool('read_file'), 'reading');
    assert.equal(stateForTool('edit_file'), 'typing');
    assert.equal(stateForTool('run_command'), 'running');
    assert.equal(stateForTool('get_skill'), 'learning');
    assert.equal(stateForTool('something_new'), 'running');
  });
});

describe('ActivityRegistry.tap', () => {
  it('passes every part through and records the pose each one implies', async () => {
    const registry = new ActivityRegistry();
    const input = [{ type: 'start-step' }, { type: 'tool-call', toolName: 'read_file' }, { type: 'tool-result' }, { type: 'text-delta' }, { type: 'finish' }];
    const poses: string[] = [];
    const seen = await drain(registry.tap('alpha', parts(input)), () => poses.push(registry.get('alpha')!.state));
    assert.deepEqual(seen, input);
    assert.deepEqual(poses, ['thinking', 'reading', 'thinking', 'typing', 'idle']);
  });

  it('leaves a warning after an error, and idle after a turn the browser stopped', async () => {
    const registry = new ActivityRegistry();
    await drain(registry.tap('alpha', parts([{ type: 'text-delta' }, { type: 'error' }])));
    assert.equal(registry.get('alpha')!.state, 'warning');

    const stopped = registry.tap('beta', parts([{ type: 'text-delta' }, { type: 'text-delta' }]));
    await stopped.next();
    await stopped.return(undefined);
    assert.equal(registry.get('beta')!.state, 'idle');
    assert.equal(registry.get('beta')!.detail, 'turn stopped');
  });

  it('keeps `since` while the state holds, and drops long-idle hosts', () => {
    let now = 1_000;
    const registry = new ActivityRegistry(() => now);
    registry.set('alpha', 'typing', 'writing the answer');
    const since = registry.get('alpha')!.since;
    now += 500;
    registry.set('alpha', 'typing', 'writing the answer');
    assert.equal(registry.get('alpha')!.since, since);

    registry.set('alpha', 'idle', 'turn finished');
    now += IDLE_TTL_MS + 1;
    assert.deepEqual(registry.list(), []);
  });
});
