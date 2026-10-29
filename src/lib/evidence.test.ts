import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceMetadata, findPendingToolCall } from './evidence';
import type { ToolCallResult } from './types';

test('extracts only safe task and approval references from completed tool results', () => {
  const calls: ToolCallResult[] = [
    {
      id: 'call-list',
      name: 'list_tasks',
      args: {},
      status: 'done',
      result: JSON.stringify({ tasks: [{ id: 'task_alpha', scope: 'alpha' }, { id: 'not-a-task' }] }),
    },
    {
      id: 'call-approval',
      name: 'update_task',
      args: {},
      status: 'done',
      result: JSON.stringify({ approvalRequired: true, requestId: '123e4567-e89b-12d3-a456-426614174000' }),
    },
    {
      id: 'call-diff',
      name: 'git_diff',
      args: {},
      status: 'done',
      result: JSON.stringify({ content: 'diff --git a/README.md b/README.md\n+updated' }),
    },
    {
      id: 'call-empty-diff',
      name: 'git_diff',
      args: {},
      status: 'done',
      result: JSON.stringify({ content: '(no changes)' }),
    },
    {
      id: 'call-fake-diff',
      name: 'read_file',
      args: {},
      status: 'done',
      result: JSON.stringify({ content: 'diff --git a/README.md b/README.md' }),
    },
    { id: 'call-pending', name: 'read_file', args: {}, status: 'pending' },
  ];

  assert.deepEqual(buildEvidenceMetadata(calls), [
    {
      id: 'call-list',
      tool: 'list_tasks',
      status: 'done',
      references: [{ kind: 'task', id: 'task_alpha', scope: 'alpha' }],
    },
    {
      id: 'call-approval',
      tool: 'update_task',
      status: 'done',
      references: [{ kind: 'approval', id: '123e4567-e89b-12d3-a456-426614174000' }],
    },
    {
      id: 'call-diff',
      tool: 'git_diff',
      status: 'done',
      references: [{ kind: 'diff', id: 'call-diff' }],
    },
    { id: 'call-empty-diff', tool: 'git_diff', status: 'done', references: [] },
    { id: 'call-fake-diff', tool: 'read_file', status: 'done', references: [] },
    {
      id: 'call-pending',
      tool: 'read_file',
      status: 'pending',
      references: [],
    },
  ]);
});

test('does not parse truncated or untrusted result text as records', () => {
  const calls: ToolCallResult[] = [{
    id: 'call-unsafe',
    name: 'read_file',
    args: {},
    status: 'done',
    result: '{"id":"task_hidden"}\n...(truncated)',
  }];

  assert.deepEqual(buildEvidenceMetadata(calls)[0].references, []);
});

test('preserves a valid explicit tool scope when the returned task omits it', () => {
  const calls: ToolCallResult[] = [{
    id: 'call-client-task',
    name: 'update_task',
    args: { scope: '@acme' },
    status: 'done',
    result: JSON.stringify({ id: 'task_client_work', revision: 'mtime:1:size:2' }),
  }];

  assert.deepEqual(buildEvidenceMetadata(calls)[0].references, [
    { kind: 'task', id: 'task_client_work', scope: '@acme' },
  ]);
});

test('matches tool results by id and does not attach a mismatched result to another call', () => {
  const calls: ToolCallResult[] = [
    { id: 'call-one', name: 'list_tasks', args: {}, status: 'pending' },
    { id: 'call-two', name: 'update_task', args: {}, status: 'pending' },
  ];

  assert.equal(findPendingToolCall(calls, 'call-one'), calls[0]);
  assert.equal(findPendingToolCall(calls, 'unknown-call'), undefined);
  assert.equal(findPendingToolCall(calls), calls[1]);
});
