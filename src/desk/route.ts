import { PM_PAGE_TITLE, type PmPage } from './pm/pages';

/**
 * Where the desk is, as the address carries it: the floor at a level and a page of its
 * tables, a project's room, a project management view, or a client's dossier. It lives in
 * the hash, because the project's visual context rewrites the query for its own selection
 * and keeps only the hash.
 *
 *   #/                      the floor at its home level
 *   #/level/<client>[/<n>]  a level, at page n (from 1)
 *   #/project/<key>         a project's room
 *   #/today, #/backlog, ... a project management view
 *   #/client/<name>         a client's dossier
 */
export type DeskRoute =
  | { view: 'floor'; level: string | null; page: number }
  | { view: 'project'; key: string }
  | { view: 'pm'; page: PmPage }
  | { view: 'client'; client: string };

export const HOME: DeskRoute = { view: 'floor', level: null, page: 0 };

/** Query parameters the visual context writes for its selection; stale outside a project's room. */
const ROOM_PARAMS = ['project', 'view', 'node', 'module'];

function decode(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function isPmPage(value: string): value is PmPage {
  return Object.hasOwn(PM_PAGE_TITLE, value);
}

export function parseRoute(hash: string): DeskRoute {
  const [head = '', name = '', count = ''] = hash.replace(/^#\/?/, '').split('/').map(decode);
  if (head === 'level' && name) {
    const page = Number.parseInt(count, 10);
    return { view: 'floor', level: name, page: Number.isInteger(page) && page > 1 ? page - 1 : 0 };
  }
  if (head === 'project' && name) return { view: 'project', key: name };
  if (head === 'client' && name) return { view: 'client', client: name };
  if (isPmPage(head) && !name) return { view: 'pm', page: head };
  return HOME;
}

/** The hash for a route; the home floor has none. */
export function routeHash(route: DeskRoute): string {
  switch (route.view) {
    case 'floor':
      if (!route.level) return '';
      return `#/level/${encodeURIComponent(route.level)}${route.page > 0 ? `/${route.page + 1}` : ''}`;
    case 'project':
      return `#/project/${encodeURIComponent(route.key)}`;
    case 'pm':
      return `#/${route.page}`;
    case 'client':
      return `#/client/${encodeURIComponent(route.client)}`;
  }
}

/**
 * The history entry a route belongs to. Walking the floor's levels and pages stays one entry,
 * so Back leaves the floor rather than retracing every key press; any other view is its own.
 */
export function historyEntry(route: DeskRoute): string {
  return route.view === 'floor' ? 'floor' : routeHash(route);
}

/** The query and hash for a route, from the current query: other parameters stay, stale room ones go. */
export function routeAddress(route: DeskRoute, search: string): string {
  if (route.view === 'project') return `${search}${routeHash(route)}`;
  const params = new URLSearchParams(search);
  if (!ROOM_PARAMS.some((name) => params.has(name))) return `${search}${routeHash(route)}`;
  for (const name of ROOM_PARAMS) params.delete(name);
  const rest = params.toString();
  return `${rest ? `?${rest}` : ''}${routeHash(route)}`;
}
