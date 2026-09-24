/** Token is injected into HTML by the server, or passed as ?token= query param. */
function getToken(): string {
  // From server-injected script
  const injected = (window as unknown as Record<string, string>).__AC_TOKEN__;
  if (injected) return injected;

  // From URL query param
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? '';
}

const TOKEN = getToken();

/** Fetch wrapper with auth token. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

/** Get the auth token for direct fetch calls (e.g., streaming). */
export function getAuthToken(): string {
  return TOKEN;
}
