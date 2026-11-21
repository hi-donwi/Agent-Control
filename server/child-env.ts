const ALLOWED_ENV_KEYS = new Set(['PATH', 'HOME', 'LANG', 'TERM']);

function allowed(key: string): boolean {
  return ALLOWED_ENV_KEYS.has(key) || key.startsWith('WS_');
}

/** Build the only environment passed to agent commands and workspace CLI processes. */
export function allowlistedChildEnv(
  source: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries({ ...source, ...overrides })) {
    if (allowed(key) && value !== undefined) env[key] = value;
  }
  return env;
}
