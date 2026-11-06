export const DESKTOP_PROTOCOL_VERSION = 1;
export const DESKTOP_READY_TYPE = 'agent-control-ready';

export interface DesktopReadyMessage {
  type: typeof DESKTOP_READY_TYPE;
  protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  host: '127.0.0.1';
  port: number;
  token: string;
}

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function createDesktopReadyLine(input: { port: number; token: string }): string {
  const message: DesktopReadyMessage = {
    type: DESKTOP_READY_TYPE,
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    host: '127.0.0.1',
    port: input.port,
    token: input.token,
  };
  validateDesktopReadyMessage(message);
  return `${JSON.stringify(message)}\n`;
}

export function parseDesktopReadyLine(line: string): DesktopReadyMessage {
  let value: unknown;
  try {
    value = JSON.parse(line.trim());
  } catch {
    throw new Error('Invalid desktop readiness message.');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid desktop readiness message.');
  }
  const allowedKeys = new Set(['type', 'protocolVersion', 'host', 'port', 'token']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error('Invalid desktop readiness message fields.');
  }
  validateDesktopReadyMessage(value as Partial<DesktopReadyMessage>);
  return value as DesktopReadyMessage;
}

function validateDesktopReadyMessage(value: Partial<DesktopReadyMessage>): asserts value is DesktopReadyMessage {
  if (value.type !== DESKTOP_READY_TYPE) throw new Error('Invalid desktop readiness message type.');
  if (value.protocolVersion !== DESKTOP_PROTOCOL_VERSION) throw new Error('Unsupported desktop readiness protocol version.');
  if (value.host !== '127.0.0.1') throw new Error('Desktop readiness host must be loopback.');
  if (!Number.isInteger(value.port) || value.port === undefined || value.port < 1 || value.port > 65535) {
    throw new Error('Invalid desktop readiness port.');
  }
  if (typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token)) {
    throw new Error('Invalid desktop readiness token.');
  }
}
