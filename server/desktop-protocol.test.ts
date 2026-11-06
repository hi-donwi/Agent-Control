import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopReadyLine, parseDesktopReadyLine } from './desktop-protocol.js';

describe('desktop sidecar readiness protocol', () => {
  const token = 'a'.repeat(64);

  it('serializes one versioned readiness line with loopback endpoint and process token', () => {
    const line = createDesktopReadyLine({ port: 43210, token });

    assert.equal(line.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(line), {
      type: 'agent-control-ready',
      protocolVersion: 1,
      host: '127.0.0.1',
      port: 43210,
      token,
    });
  });

  it('parses a valid readiness line and rejects an incompatible protocol', () => {
    const line = createDesktopReadyLine({ port: 43210, token });
    assert.deepEqual(parseDesktopReadyLine(line), {
      type: 'agent-control-ready',
      protocolVersion: 1,
      host: '127.0.0.1',
      port: 43210,
      token,
    });

    const incompatible = JSON.stringify({ ...JSON.parse(line), protocolVersion: 2 });
    assert.throws(() => parseDesktopReadyLine(incompatible), /protocol/i);
  });

  it('rejects malformed, non-loopback, invalid-port, or invalid-token readiness', () => {
    assert.throws(() => parseDesktopReadyLine('not json'), /readiness/i);
    for (const patch of [
      { host: '0.0.0.0' },
      { port: 0 },
      { port: 65536 },
      { token: 'short' },
      { extra: 'unexpected' },
    ]) {
      const value = { ...JSON.parse(createDesktopReadyLine({ port: 43210, token })), ...patch };
      assert.throws(() => parseDesktopReadyLine(JSON.stringify(value)), /readiness|loopback|port|token/i);
    }
  });
});
