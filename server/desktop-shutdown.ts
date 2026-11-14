import type { ServerType } from '@hono/node-server';
import type { Readable } from 'node:stream';

export const DESKTOP_SHUTDOWN_COMMAND = 'AC_DESKTOP_SHUTDOWN_V1';
const MAX_SHUTDOWN_LINE = 128;

/** Accept one fixed shutdown message over the private native stdin pipe, never HTTP. */
export function attachDesktopShutdown(
  server: ServerType,
  input: Readable,
  onClosed: () => void = () => process.exit(0),
): void {
  let pending = '';
  let requested = false;
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    if (requested) return;
    pending += chunk;
    if (pending.length > MAX_SHUTDOWN_LINE && !pending.includes('\n')) {
      pending = '';
      return;
    }
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (line === DESKTOP_SHUTDOWN_COMMAND) {
        requested = true;
        input.pause();
        server.close(() => onClosed());
        return;
      }
      if (line.length > MAX_SHUTDOWN_LINE) pending = '';
      newline = pending.indexOf('\n');
    }
    if (pending.length > MAX_SHUTDOWN_LINE) pending = '';
  });
}
