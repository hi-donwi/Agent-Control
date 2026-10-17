import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canAssign, canMove, cardsFrom, moveRequest } from './stations';
import { readCodingSession, startCodingSession, type SessionRunner } from '../../../server/coding-sessions.js';
import type { ProjectDetail } from '../types';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ac-board-agent-flow-'));
}

function fakeSessionRunner(worktree = '/tmp/fake-worktree'): SessionRunner & { calls: Array<{ args: string[]; env: Record<string, string> }> } {
  const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
  return {
    calls,
    runWs: async (args, env) => {
      calls.push({ args, env });
      if (args[0] === 'agent' && args[1] === 'start') {
        return `\u001b[32m-> agent start demo (session test)\u001b[0m\ncd ${worktree}\n\u001b[2m  do not...\u001b[0m\n`;
      }
      return '';
    },
    currentBranch: async () => 'agent-test-demo-works',
  };
}

describe('board-agent end-to-end lifecycle', () => {
  it('walks through: queue -> ready -> assign to agent -> hands -> review -> ship -> shipped', async () => {
    const root = tmpRoot();
    const runner = fakeSessionRunner('/tmp/board-worktree-1');

    // 1. Initial project detail with 1 task in queue ('open' status)
    let detail: ProjectDetail = {
      key: 'demo-proj',
      client: 'testclient',
      group: '-',
      description: 'Test project',
      folder: 'projects/testclient/demo-proj',
      tasks: [
        {
          id: 'task_e2e_1',
          title: 'Implement feature X',
          priority: 'high',
          status: 'open',
          blocked: 'no',
          blockedReason: '',
          revision: 'rev-1',
        },
      ],
      plans: [],
      approvals: [],
      agents: [],
      runs: [],
      memory: { stage: 'dev', focus: 'board', updated: 'now', nextUp: [], decisions: [], log: [], notes: [], blockedOn: [] },
      context: { pack: [], policy: null },
      codingSession: null,
    };

    // Card in Queue
    let [card] = cardsFrom(detail);
    assert.equal(card.station, 'queue');
    assert.equal(canAssign(card), false, 'cannot assign cards in queue');
    assert.equal(canMove(card, 'ready'), true);

    // 2. Move to Ready station
    const readyReq = moveRequest(card, 'ready', detail.key);
    assert.deepEqual(readyReq, {
      path: 'desk/tasks/status',
      body: { project: 'demo-proj', id: 'task_e2e_1', status: 'ready', revision: 'rev-1' },
    });

    // Simulate task moved to ready in project detail
    detail = {
      ...detail,
      tasks: [{ ...detail.tasks[0], status: 'ready', revision: 'rev-2' }],
    };
    [card] = cardsFrom(detail);
    assert.equal(card.station, 'ready');
    assert.equal(canAssign(card), true, 'cards in ready station can be assigned');

    // 3. Assign to agent: starts coding session with card title as brief and cardKey
    const session = await startCodingSession(root, detail.key, runner, {
      brief: card.title,
      cardKey: card.key,
    });
    assert.equal(session.brief, 'Implement feature X');
    assert.equal(session.cardKey, card.key);
    assert.equal(session.worktree, '/tmp/board-worktree-1');
    assert.equal(session.branch, 'agent-test-demo-works');

    // 4. Move to hands: task status changes to in_progress
    const handsReq = moveRequest(card, 'hands', detail.key);
    assert.deepEqual(handsReq, {
      path: 'desk/tasks/status',
      body: { project: 'demo-proj', id: 'task_e2e_1', status: 'in_progress', revision: 'rev-2' },
    });

    detail = {
      ...detail,
      codingSession: session,
      tasks: [{ ...detail.tasks[0], status: 'in_progress', revision: 'rev-3' }],
    };
    [card] = cardsFrom(detail);
    assert.equal(card.station, 'hands');
    assert.equal(readCodingSession(root, detail.key)?.cardKey, card.key);

    // 5. Ready for review: card moves to review station
    const reviewReq = moveRequest(card, 'review', detail.key);
    assert.deepEqual(reviewReq, {
      path: 'desk/tasks/status',
      body: { project: 'demo-proj', id: 'task_e2e_1', status: 'review', revision: 'rev-3' },
    });

    detail = {
      ...detail,
      tasks: [{ ...detail.tasks[0], status: 'review', revision: 'rev-4' }],
    };
    [card] = cardsFrom(detail);
    assert.equal(card.station, 'review');

    // 6. When shipped: card moves to shipped station ('done')
    const shippedReq = moveRequest(card, 'shipped', detail.key);
    assert.deepEqual(shippedReq, {
      path: 'desk/tasks/status',
      body: { project: 'demo-proj', id: 'task_e2e_1', status: 'done', revision: 'rev-4' },
    });

    detail = {
      ...detail,
      tasks: [{ ...detail.tasks[0], status: 'done', revision: 'rev-5' }],
    };
    [card] = cardsFrom(detail);
    assert.equal(card.station, 'shipped');
  });
});
