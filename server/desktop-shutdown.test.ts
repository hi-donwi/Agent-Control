import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import test from 'node:test';

import { attachDesktopShutdown } from './desktop-shutdown.js';

test('desktop shutdown pipe ignores unknown messages and closes the server on the fixed command', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const input = new PassThrough();
  let closed = false;
  attachDesktopShutdown(server, input, () => { closed = true; });

  input.write('not-a-command\n');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.listening, true);
  assert.equal(closed, false);

  const close = once(server, 'close');
  input.write('AC_DESKTOP_SHUTDOWN_V1\n');
  await close;
  assert.equal(closed, true);
  input.destroy();
});

test('desktop shutdown parser discards oversized lines without stopping the host', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const input = new PassThrough();
  let closed = false;
  attachDesktopShutdown(server, input, () => { closed = true; });

  input.write(`${'x'.repeat(2048)}\n`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.listening, true);
  assert.equal(closed, false);

  server.close();
  await once(server, 'close');
  input.destroy();
});
