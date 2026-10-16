import type { DataAdapter, Query, QueryResult } from 'uidl-runtime';
import { apiFetch } from '../../lib/api';
import { queryParams } from './query-params';

const readOnly = () => Promise.reject(new Error('The desk is read-only in this phase; changes go through ws.'));

/**
 * The one `DataAdapter` every desk section reads through. Writes are refused: notes,
 * tasks, and runs change through `ws` commands in a later phase (ADR-0019 §2).
 */
export const deskAdapter: DataAdapter = {
  query<T = Record<string, unknown>>(query: Query, signal?: AbortSignal) {
    const collection = encodeURIComponent(query.collection);
    return apiFetch<QueryResult<T>>(`desk/collections/${collection}?${queryParams(query)}`, { signal });
  },
  get: () => Promise.resolve(undefined),
  create: readOnly,
  update: readOnly,
  remove: readOnly,
  transition: readOnly,
  report: readOnly,
};
