import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSchema } from 'uidl-runtime';
import { SECTIONS, sectionDocument, type SectionId } from './documents';
import { queryParams } from './query-params';

describe('section documents', () => {
  for (const section of Object.keys(SECTIONS) as SectionId[]) {
    it(`${section} is a valid UIDL document`, () => {
      const result = DocumentSchema.safeParse(sectionDocument(section, 'alpha'));
      assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
    });
  }

  it('scopes project sections by a project filter, and leaves Projects unscoped', () => {
    const runs = sectionDocument('runs', 'alpha').dataSources as Record<string, { $query: { filters: unknown[] } }>;
    assert.deepEqual(runs.rows.$query.filters, [{ field: 'project', op: 'eq', value: 'alpha' }]);
    const projects = sectionDocument('projects', 'alpha').dataSources as Record<string, { $query: { filters: unknown[] } }>;
    assert.deepEqual(projects.rows.$query.filters, []);
  });
});

describe('queryParams', () => {
  it('turns a UIDL query into the endpoint\'s parameters', () => {
    const params = queryParams({
      collection: 'runs',
      filters: [
        { field: 'project', op: 'eq', value: 'alpha' },
        { field: 'state', op: 'eq', value: 'open' },
        { field: 'n', op: 'gt', value: 2 },
      ],
      sort: [{ field: 'started', dir: 'desc' }],
      page: { number: 2, size: 25 },
      search: 'export',
    });
    assert.equal(params.toString(), 'project=alpha&eq.state=open&search=export&sort=started%3Adesc&page=2&pageSize=25');
  });
});
