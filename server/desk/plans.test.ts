import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanConflictError, setPlanStatus } from './plans.js';
import type { WsInputRunner } from './ws-input.js';

const REV = 'mtime:1792160000000000000:size:900';
const RUN = '2026-10-16-090000-dev-x-add-export';

describe('setPlanStatus', () => {
  it('runs ws plan status as the operator with the revision it was given', async () => {
    const calls: string[][] = [];
    const run: WsInputRunner = async (args) => { calls.push(args); return `plan ${RUN} 2 in_progress ${REV}\n`; };
    assert.deepEqual(await setPlanStatus(run, { project: 'alpha', run: RUN, n: '2', status: 'in_progress', revision: REV }), {
      run: RUN, n: '2', status: 'in_progress', revision: REV,
    });
    assert.deepEqual(calls, [['plan', 'status', 'alpha', RUN, '2', 'in_progress', '--revision', REV, '--operator']]);
  });

  it('passes a reason in Notes when one is given', async () => {
    const calls: string[][] = [];
    const run: WsInputRunner = async (args) => { calls.push(args); return `plan ${RUN} 1 blocked ${REV}\n`; };
    await setPlanStatus(run, { project: 'alpha', run: RUN, n: 1, status: 'blocked', revision: REV, notes: 'waits on the API' });
    assert.deepEqual(calls[0].slice(-2), ['--notes', 'waits on the API']);
  });

  it('refuses before running ws', async () => {
    let ran = false;
    const run: WsInputRunner = async () => { ran = true; return ''; };
    await assert.rejects(setPlanStatus(run, { project: 'alpha', run: '../x', n: '1', status: 'done', revision: REV }), /choose a run/);
    await assert.rejects(setPlanStatus(run, { project: 'alpha', run: RUN, n: 'x', status: 'done', revision: REV }), /plan row/);
    await assert.rejects(setPlanStatus(run, { project: 'alpha', run: RUN, n: '1', status: 'finished', revision: REV }), /unknown status/);
    await assert.rejects(setPlanStatus(run, { project: 'alpha', run: RUN, n: '1', status: 'done' }), /reload/);
    assert.equal(ran, false);
  });

  it('maps a stale revision to a conflict and passes the run rules through', async () => {
    const stale: WsInputRunner = async () => { throw new Error('plan: revision mismatch: the plan changed since it was read'); };
    await assert.rejects(setPlanStatus(stale, { project: 'alpha', run: RUN, n: '1', status: 'done', revision: REV }), PlanConflictError);
    const busy: WsInputRunner = async () => { throw new Error('plan: row 2 is already in progress - one row in_progress per run'); };
    await assert.rejects(setPlanStatus(busy, { project: 'alpha', run: RUN, n: '1', status: 'in_progress', revision: REV }), /^Error: row 2 is already in progress/);
  });
});
