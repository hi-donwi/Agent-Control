import assert from 'node:assert/strict';
import test from 'node:test';
import type { Floor } from '../types';
import type { EvidenceMetadata, ProjectInfo, Provider } from '../../lib/types';
import {
  availableEvidenceActions,
  availableClosureActions,
  buildCommandTargets,
  buildNoteDraft,
  buildTaskDraft,
  priorAssistantResponses,
  resolveChatChoice,
  transitionDispatch,
  type DispatchEvent,
} from './command-state';

const floor: Floor = {
  generatedAt: '2026-10-28T00:00:00.000Z',
  totals: { projects: 1, agents: 2, active: 1, waiting: 0 },
  zones: [{
    client: 'workspace',
    rooms: [{
      key: 'alpha',
      group: '-',
      description: 'Alpha project',
      pendingApprovals: 0,
      codingSession: false,
      agents: [
        { id: 'host-alpha', tool: 'agent-control', project: 'alpha', state: 'thinking', detail: 'waiting for the model', since: '', source: 'host' },
        { id: 'external-alpha', tool: 'opencode', project: 'alpha', state: 'working', detail: 'editing', since: '', source: 'activity' },
      ],
    }],
  }],
};

test('builds honest command targets from floor presence', () => {
  const targets = buildCommandTargets(floor);

  assert.deepEqual(targets.map((target) => target.id), ['control-plane', 'host-alpha', 'external-alpha']);
  assert.equal(targets[0].writable, true);
  assert.equal(targets[1].writable, true);
  assert.equal(targets[2].writable, false);
  assert.equal(targets[2].observedOnly, true);
  assert.equal(targets[2].availability, 'observed-only');
});

test('keeps remote providers out of an unbound workspace', () => {
  const providers: Provider[] = [
    { id: 'remote', name: 'Remote', models: ['remote-model'], locality: 'remote' },
    { id: 'local', name: 'Local', models: ['local-model'], locality: 'local' },
  ];

  const choice = resolveChatChoice(providers, [], '', 'remote', 'remote-model');

  assert.deepEqual(choice, { provider: 'local', model: 'local-model' });
});

test('allows a project policy to select its permitted remote provider', () => {
  const providers: Provider[] = [{ id: 'remote', name: 'Remote', models: ['remote-model'], locality: 'remote' }];
  const projects: ProjectInfo[] = [{ key: 'alpha', client: 'workspace', folder: 'projects/alpha', allowedEndpoints: ['remote'] }];

  const choice = resolveChatChoice(providers, projects, 'alpha', 'remote', 'remote-model');

  assert.deepEqual(choice, { provider: 'remote', model: 'remote-model' });
});

test('transitions dispatch state from transport events, not animation completion', () => {
  const events: DispatchEvent[] = ['send', 'stream-start', 'stream-end'];

  assert.equal(events.reduce(transitionDispatch, 'ready'), 'complete');
  assert.equal(transitionDispatch('routing', 'animation-end'), 'routing');
  assert.equal(transitionDispatch('routing', 'error'), 'failed');
  assert.equal(transitionDispatch('routing', 'approval'), 'waiting');
});

test('offers evidence and review only when the response and target support them', () => {
  const reviewFloor: Floor = {
    ...floor,
    zones: floor.zones.map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => ({ ...room, codingSession: true })),
    })),
  };
  const target = buildCommandTargets(reviewFloor).find((item) => item.id === 'host-alpha');
  assert(target);

  assert.deepEqual(availableClosureActions(target, {
    id: 'assistant-1', role: 'assistant', content: 'Reviewed changes.', createdAt: 0,
    toolCalls: [{ name: 'git_diff', args: {}, status: 'done' }],
  }), ['continue', 'evidence', 'review']);
  assert.deepEqual(availableClosureActions(buildCommandTargets(floor)[2], {
    id: 'assistant-2', role: 'assistant', content: 'Observed.', createdAt: 0,
  }), ['continue']);
  assert.deepEqual(availableClosureActions(target, {
    id: 'assistant-3', role: 'assistant', content: 'Evidence attached.', createdAt: 0,
    evidence: [{ id: 'call-1', tool: 'list_tasks', status: 'done', references: [] }],
  }), ['continue', 'evidence', 'review']);
});

test('offers only scoped task and approval review handoffs for writable project targets', () => {
  const target = buildCommandTargets(floor).find((item) => item.id === 'host-alpha');
  const observed = buildCommandTargets(floor).find((item) => item.id === 'external-alpha');
  assert(target);
  assert(observed);
  const evidence: EvidenceMetadata[] = [
    {
      id: 'call-task', tool: 'list_tasks', status: 'done',
      references: [{ kind: 'task', id: 'task_alpha', scope: 'alpha' }],
    },
    {
      id: 'call-other-scope', tool: 'list_tasks', status: 'done',
      references: [{ kind: 'task', id: 'task_beta', scope: 'beta' }],
    },
    {
      id: 'call-approval', tool: 'update_task', status: 'done',
      references: [{ kind: 'approval', id: '123e4567-e89b-12d3-a456-426614174000' }],
    },
    {
      id: 'call-invalid-approval', tool: 'update_task', status: 'done',
      references: [{ kind: 'approval', id: 'not-an-approval-id' }],
    },
    {
      id: 'call-untrusted-tool', tool: 'read_file', status: 'done',
      references: [{ kind: 'task', id: 'task_alpha', scope: 'alpha' }],
    },
  ];

  assert.deepEqual(availableEvidenceActions(target, evidence), [
    { kind: 'open-task', id: 'task_alpha', scope: 'alpha', evidenceId: 'call-task' },
    { kind: 'review-approval', id: '123e4567-e89b-12d3-a456-426614174000', evidenceId: 'call-approval' },
  ]);
  assert.deepEqual(availableEvidenceActions(observed, evidence), []);
  assert.deepEqual(availableEvidenceActions(buildCommandTargets(floor)[0], evidence), []);
});

test('offers Open diff only for matching git diff evidence when the project has a coding session', () => {
  const reviewFloor: Floor = {
    ...floor,
    zones: floor.zones.map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => ({ ...room, codingSession: true })),
    })),
  };
  const target = buildCommandTargets(reviewFloor).find((item) => item.id === 'host-alpha');
  const noSessionTarget = buildCommandTargets(floor).find((item) => item.id === 'host-alpha');
  assert(target);
  assert(noSessionTarget);
  const evidence: EvidenceMetadata[] = [{
    id: 'call-diff', tool: 'git_diff', status: 'done',
    references: [{ kind: 'diff', id: 'call-diff' }],
  }];

  assert.deepEqual(availableEvidenceActions(target, evidence), [
    { kind: 'open-diff', evidenceId: 'call-diff' },
  ]);
  assert.deepEqual(availableEvidenceActions(noSessionTarget, evidence), []);
  assert.deepEqual(availableEvidenceActions(target, [{
    ...evidence[0], references: [{ kind: 'diff', id: 'another-call' }],
  }]), []);
  assert.deepEqual(availableEvidenceActions(target, [{
    ...evidence[0], tool: 'read_file',
  }]), []);
});

test('builds an editable project task draft from the first response sentence', () => {
  const target = buildCommandTargets(floor).find((item) => item.id === 'host-alpha');
  const observed = buildCommandTargets(floor).find((item) => item.id === 'external-alpha');
  assert(target);
  assert(observed);
  const message = {
    id: 'assistant-task-draft',
    role: 'assistant' as const,
    content: '## Summary\n**The API validates input.** It also scopes results.\n- A later detail',
    createdAt: 0,
  };

  assert.deepEqual(buildTaskDraft(target, message), { scope: 'alpha', title: 'The API validates input' });
  assert.equal(buildTaskDraft(observed, message), null);
  assert.equal(buildTaskDraft(target, { ...message, content: '  \n' }), null);
  assert.equal(buildTaskDraft(target, { ...message, content: 'x'.repeat(140) })?.title.length, 120);
});

test('builds a scoped Markdown note draft without permitting observed targets', () => {
  const target = buildCommandTargets(floor).find((item) => item.id === 'host-alpha');
  const observed = buildCommandTargets(floor).find((item) => item.id === 'external-alpha');
  assert(target);
  assert(observed);
  const message = {
    id: 'assistant-note-draft',
    role: 'assistant' as const,
    content: '## Findings\n**The API validates input.**\n\n- Results stay scoped.',
    createdAt: 0,
  };

  assert.deepEqual(buildNoteDraft(target, message), {
    scope: 'alpha',
    title: 'The API validates input',
    body: message.content,
  });
  assert.equal(buildNoteDraft(observed, message), null);
  assert.equal(buildNoteDraft(target, { ...message, content: '  \n' }), null);
});

test('selects only earlier non-empty assistant responses from the same conversation list', () => {
  const messages = [
    { id: 'user-1', role: 'user' as const, content: 'First question', createdAt: 1 },
    { id: 'assistant-1', role: 'assistant' as const, content: 'First answer', createdAt: 2 },
    { id: 'user-2', role: 'user' as const, content: 'Follow-up', createdAt: 3 },
    { id: 'assistant-empty', role: 'assistant' as const, content: ' ', createdAt: 4 },
    { id: 'assistant-2', role: 'assistant' as const, content: 'Current answer', createdAt: 5 },
    { id: 'assistant-future', role: 'assistant' as const, content: 'Future answer', createdAt: 6 },
  ];

  assert.deepEqual(priorAssistantResponses(messages, 'assistant-2').map((message) => message.id), ['assistant-1']);
  assert.deepEqual(priorAssistantResponses(messages, 'assistant-future').map((message) => message.id), ['assistant-2', 'assistant-1']);
  assert.deepEqual(priorAssistantResponses(messages, 'unknown'), []);
});
