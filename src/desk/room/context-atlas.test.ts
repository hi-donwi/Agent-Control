import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '@context-atlas/model';
import { buildProjectSnapshot } from './context-atlas';
import type { ProjectDetail } from '../types';

const detail: ProjectDetail = {
  key: 'sample-app',
  client: 'synthetic-client',
  group: 'synthetic-group',
  description: 'A synthetic project used to verify the room projection.',
  folder: 'projects/synthetic/sample-app',
  memory: {
    updated: '2026-10-30',
    stage: 'implementation',
    focus: 'Selected room context',
    nextUp: ['Verify the snapshot'],
    blockedOn: [{ item: 'Contract review', waitingFor: 'synthetic reviewer', since: '2026-10-29' }],
    decisions: [{ date: '2026-10-29', title: 'Keep the adapter read-only' }],
    log: [{ date: '2026-10-30', text: 'Added synthetic mapping' }],
    notes: [{ name: 'Study note', updated: '2026-10-30', excerpt: 'Synthetic note excerpt' }],
  },
  tasks: [
    {
      id: 'task-map-context',
      title: 'Map project context',
      status: 'blocked',
      priority: 'high',
      owner: 'synthetic-owner',
      blocked: 'yes',
      blockedReason: 'Waiting for a synthetic review.',
    },
  ],
  plans: [
    {
      id: 'run-one#1',
      run: 'Synthetic run',
      runId: 'run-one',
      n: '1',
      task: 'Project selected context',
      status: 'in_progress',
      notes: 'Use the existing response.',
    },
    {
      id: 'run-one#2',
      run: 'Synthetic run',
      runId: 'run-one',
      n: '2',
      task: 'Validate the snapshot',
      status: 'pending',
      notes: '',
    },
  ],
  runs: [{ id: 'run-one', title: 'Synthetic run', state: 'open' }],
  approvals: [],
  agents: [],
  codingSession: null,
  context: {
    pack: [
      'context/memory/projects/sample-app/project.md',
      'context/memory/projects/sample-app/active.md',
    ],
    policy: null,
  },
};

describe('project room snapshot projection', () => {
  it('creates a valid general snapshot from the selected room response', () => {
    const snapshot = buildProjectSnapshot(detail);
    const validation = validateSnapshot(snapshot);

    assert.equal(snapshot.project.id, 'sample-app');
    assert.equal(snapshot.project.kind, 'general');
    assert.deepEqual(snapshot.project.capabilities, ['overview', 'journey', 'work', 'study']);
    assert.equal(validation.success, true);
    assert.ok(snapshot.sources.every((source) => !source.path.startsWith('/')));
  });

  it('maps blockers, decisions, notes, and ordered run steps without leaking room-only fields', () => {
    const snapshot = buildProjectSnapshot(detail);
    const blockedTask = snapshot.nodes.find((node) => node.label === 'Map project context');
    const journey = snapshot.views.find((view) => view.kind === 'journey');
    const sourceText = JSON.stringify(snapshot);

    assert.equal(blockedTask?.details?.task?.state, 'blocked');
    assert.equal(blockedTask?.details?.task?.priority, 'high');
    assert.ok(snapshot.nodes.some((node) => node.kind === 'decision' && node.label === 'Keep the adapter read-only'));
    assert.ok(snapshot.nodes.some((node) => node.kind === 'document' && node.label === 'Study note'));
    assert.deepEqual(journey?.steps?.map((step) => step.label), [
      'Project selected context',
      'Validate the snapshot',
    ]);
    assert.ok(!sourceText.includes(detail.client));
    assert.ok(!sourceText.includes(detail.group));
    assert.ok(!sourceText.includes(detail.folder));
  });

  it('does not claim API or data views without API or schema facts', () => {
    const snapshot = buildProjectSnapshot({ ...detail, plans: [], tasks: [] });

    assert.ok(!snapshot.project.capabilities.includes('api'));
    assert.ok(!snapshot.project.capabilities.includes('data'));
    assert.ok(!snapshot.views.some((view) => view.kind === 'journey'));
    assert.ok(!snapshot.views.some((view) => view.kind === 'work'));
  });
});
