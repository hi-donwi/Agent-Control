import type { Query } from 'uidl-runtime';

/**
 * A UIDL `Query` as the desk collections endpoint reads it: `project` scopes the set,
 * `eq.<field>` is an equality filter, `sort=<field>:<dir>`, and one page. Operators other
 * than `eq` are not supported by the endpoint and are left out rather than half-applied.
 */
export function queryParams(query: Query): URLSearchParams {
  const params = new URLSearchParams();
  for (const filter of query.filters ?? []) {
    if (filter.op !== 'eq' || filter.value === undefined || filter.value === null || filter.value === '') continue;
    params.set(filter.field === 'project' ? 'project' : `eq.${filter.field}`, String(filter.value));
  }
  if (query.search) params.set('search', query.search);
  const sort = query.sort?.[0];
  if (sort) params.set('sort', `${sort.field}:${sort.dir}`);
  if (query.page) {
    params.set('page', String(query.page.number));
    params.set('pageSize', String(query.page.size));
  }
  return params;
}
