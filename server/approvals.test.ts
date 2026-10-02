import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, listPending, requestApproval, sha256Hex, verifyAndConsume } from './approvals.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ac-approvals-'));
}

const CTX = { project: 'demo', headSha: 'a'.repeat(40), action: 'run_command', inputHash: sha256Hex('ls'), policyHash: sha256Hex('{}') };

describe('requestApproval (ADR-0020 binding)', () => {
  it('creates a single-use, time-bound request and records it as 0600 JSONL', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    assert.match(req.id, /^[a-f0-9-]{16,}$/);
    assert.equal(req.project, 'demo');
    assert.ok(new Date(req.expiresAt).getTime() > new Date(req.requestedAt).getTime());
    const month = req.requestedAt.slice(0, 7);
    const path = join(root, '.local', 'agent', 'approvals', 'demo', `${month}.jsonl`);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const event = JSON.parse(readFileSync(path, 'utf-8').trim());
    assert.equal(event.type, 'requested');
    assert.equal(event.inputHash, CTX.inputHash);
  });

  it('defaults to a 15 minute expiry, and accepts a shorter one', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    const minutes = (new Date(req.expiresAt).getTime() - new Date(req.requestedAt).getTime()) / 60_000;
    assert.ok(Math.abs(minutes - 15) < 0.1);
    const short = requestApproval(root, CTX, 1000);
    assert.ok(new Date(short.expiresAt).getTime() - new Date(short.requestedAt).getTime() === 1000);
  });
});

describe('listPending', () => {
  it('lists a fresh request and excludes a decided or expired one', () => {
    const root = tmpRoot();
    const pending = requestApproval(root, CTX);
    const approved = requestApproval(root, CTX);
    decide(root, approved.project, approved.id, 'approved');
    const expired = requestApproval(root, CTX, -1);
    const ids = listPending(root, 'demo').map((r) => r.id);
    assert.deepEqual(ids, [pending.id]);
    assert.notEqual(expired.id, pending.id);
  });

  it('is empty for a project with no requests', () => {
    assert.deepEqual(listPending(tmpRoot(), 'demo'), []);
  });
});

describe('decide', () => {
  it('moves a pending request to approved or denied, once', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    assert.equal(decide(root, req.project, req.id, 'approved'), true);
    assert.deepEqual(listPending(root, 'demo'), []);
    assert.equal(decide(root, req.project, req.id, 'denied'), false, 'already decided');
  });

  it('refuses to decide an unknown or expired request', () => {
    const root = tmpRoot();
    assert.equal(decide(root, 'demo', 'nope', 'approved'), false);
    const expired = requestApproval(root, CTX, -1);
    assert.equal(decide(root, expired.project, expired.id, 'approved'), false);
  });
});

describe('verifyAndConsume (ADR-0020 §4: independent re-verification)', () => {
  it('consumes an approved request whose context matches exactly, once', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    decide(root, req.project, req.id, 'approved');
    assert.deepEqual(verifyAndConsume(root, req.id, CTX), { ok: true });
    assert.deepEqual(verifyAndConsume(root, req.id, CTX), { ok: false, reason: 'already consumed' });
  });

  it('voids the approval when HEAD, the input, or the policy changed since the request', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    decide(root, req.project, req.id, 'approved');
    assert.deepEqual(verifyAndConsume(root, req.id, { ...CTX, headSha: 'b'.repeat(40) }),
      { ok: false, reason: 'context changed since the request' });
    assert.deepEqual(verifyAndConsume(root, req.id, { ...CTX, inputHash: sha256Hex('rm -rf /') }),
      { ok: false, reason: 'context changed since the request' });
  });

  it('matches context field by field, not by key order', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    decide(root, req.project, req.id, 'approved');
    const reordered = { policyHash: CTX.policyHash, action: CTX.action, project: CTX.project, inputHash: CTX.inputHash, headSha: CTX.headSha };
    assert.deepEqual(verifyAndConsume(root, req.id, reordered), { ok: true });
  });

  it('distinguishes a still-pending request from one the operator denied', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX);
    assert.deepEqual(verifyAndConsume(root, req.id, CTX), { ok: false, reason: 'awaiting approval' });
    decide(root, req.project, req.id, 'denied');
    assert.deepEqual(verifyAndConsume(root, req.id, CTX), { ok: false, reason: 'denied' });
  });

  it('refuses an approval that expired before execution', () => {
    const root = tmpRoot();
    const req = requestApproval(root, CTX, 50);
    decide(root, req.project, req.id, 'approved');
    assert.deepEqual(verifyAndConsume(root, req.id, CTX, Date.now() + 100), { ok: false, reason: 'expired' });
  });
});

describe('sha256Hex', () => {
  it('is deterministic and never the input itself', () => {
    assert.equal(sha256Hex('ls'), sha256Hex('ls'));
    assert.notEqual(sha256Hex('ls'), 'ls');
    assert.equal(sha256Hex('ls').length, 64);
  });
});
