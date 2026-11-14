export interface DesktopBootstrap {
  protocolVersion: number;
  apiBaseUrl: string;
  token: string;
}

export interface DesktopHostStatus {
  lifecycle: 'running' | 'restarting' | 'stopped';
  restartCount: number;
  lastExitCode: number | null;
}

export function validateDesktopHostStatus(value: unknown): DesktopHostStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid desktop host status.');
  }
  const record = value as Record<string, unknown>;
  const keys = new Set(['lifecycle', 'restartCount', 'lastExitCode']);
  if (Object.keys(record).some((key) => !keys.has(key))
    || !['running', 'restarting', 'stopped'].includes(String(record.lifecycle))
    || !Number.isInteger(record.restartCount)
    || Number(record.restartCount) < 0
    || !(record.lastExitCode === null || Number.isInteger(record.lastExitCode))) {
    throw new Error('Invalid desktop host status.');
  }
  return {
    lifecycle: record.lifecycle as DesktopHostStatus['lifecycle'],
    restartCount: record.restartCount as number,
    lastExitCode: record.lastExitCode as number | null,
  };
}

/** Validate the native desktop's selected-workspace status before rendering or using it. */
export function validateDesktopWorkspaceRoot(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new Error('Invalid desktop workspace selection.');
  }
  return value;
}

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Validate the native bootstrap response before trusting its endpoint or bearer token. */
export function validateDesktopBootstrap(value: unknown): DesktopBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid desktop bootstrap response.');
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['protocolVersion', 'apiBaseUrl', 'token']);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))
    || record.protocolVersion !== 1
    || typeof record.apiBaseUrl !== 'string'
    || typeof record.token !== 'string'
    || !TOKEN_PATTERN.test(record.token)) {
    throw new Error('Invalid desktop bootstrap response.');
  }

  let url: URL;
  try {
    url = new URL(record.apiBaseUrl);
  } catch {
    throw new Error('Invalid desktop API endpoint.');
  }

  const port = Number(url.port);
  if (url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || !url.port
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    throw new Error('Desktop API endpoint must be an unauthenticated loopback URL.');
  }

  return {
    protocolVersion: 1,
    apiBaseUrl: url.origin,
    token: record.token,
  };
}
