export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Splits a server-sent-events buffer into complete messages and the unfinished rest.
 * Only `event:` and `data:` fields are read; comments and other fields are skipped.
 * (`EventSource` cannot send an Authorization header, so the desk reads the stream with
 * fetch and parses it here.)
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages = blocks.flatMap((block) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length || event !== 'message' ? [{ event, data: data.join('\n') }] : [];
  });
  return { messages, rest };
}
