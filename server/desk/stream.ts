import type { Floor } from './floor.js';

export interface FloorEvent {
  event: 'floor' | 'ping';
  data: string;
}

interface Options {
  /** Builds the current floor; called once per tick. */
  read: () => Floor;
  /** Waits between ticks; injected so tests do not sleep. */
  sleep: (ms: number) => Promise<void>;
  /** True once the client has gone. */
  stopped: () => boolean;
  tickMs?: number;
  /** Ticks without a change before a keep-alive ping. */
  pingEvery?: number;
}

/**
 * The floor as a stream: the first floor at once, then a new one only when something on
 * it changed (its timestamp aside), and a ping now and then so idle connections survive
 * proxies. One file scan per tick, whatever the number of agents.
 */
export async function* floorEvents({ read, sleep, stopped, tickMs = 1000, pingEvery = 15 }: Options): AsyncGenerator<FloorEvent> {
  let last = '';
  let quiet = 0;
  while (!stopped()) {
    const floor = read();
    const { generatedAt: _generatedAt, ...content } = floor;
    const key = JSON.stringify(content);
    if (key !== last) {
      last = key;
      quiet = 0;
      yield { event: 'floor', data: JSON.stringify(floor) };
    } else if (++quiet >= pingEvery) {
      quiet = 0;
      yield { event: 'ping', data: '' };
    }
    await sleep(tickMs);
  }
}
