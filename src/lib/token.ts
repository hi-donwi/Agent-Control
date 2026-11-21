const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Validate the JSON returned by the loopback-only GET /auth exchange. */
export function parseAuthToken(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid authentication response');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.token !== 'string' || !TOKEN_PATTERN.test(record.token)) {
    throw new Error('invalid authentication response');
  }
  return record.token;
}

/** Remove credentials in stale URLs from before the explicit /auth exchange. */
export function withoutToken(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has('token')) return search;
  params.delete('token');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
