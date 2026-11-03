/**
 * Where a tab keeps a token the server accepted, so a reload or a page that rewrites the
 * address (the project's visual context does) stays signed in. It is sessionStorage, not
 * localStorage: the dev origin is shared with other local apps, and a tab is as long as a
 * token needs to live - the server makes a new one each time it starts.
 */
export const TOKEN_KEY = 'agent-control:token';

export interface TokenSources {
  /** The token the server wrote into the HTML it served. */
  injected?: string | null;
  /** The page's query, which carries `?token=` when opened from the link the server printed. */
  search: string;
  /** The token this tab kept after the server last accepted it. */
  stored?: string | null;
}

/** The token to use, freshest first: injected, then the address, then the tab's own copy. */
export function resolveToken({ injected, search, stored }: TokenSources): string {
  return injected || new URLSearchParams(search).get('token') || stored || '';
}

/** The query without its token, every other parameter kept. */
export function withoutToken(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has('token')) return search;
  params.delete('token');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
