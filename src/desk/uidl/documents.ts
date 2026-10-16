import type { UIDLDocument, UIDLNode } from 'uidl-runtime';
import type { FloorRoom } from '../types';

/**
 * Node ids follow a convention desk.css styles by, because uidl-runtime 0.1.4 renders a
 * node's `style` values as class names rather than CSS: `<doc>-root` stacks its children,
 * `*-form` is a form panel whose button is primary, `*-error` is an error line hidden when
 * empty.
 *
 * Drawer sections as UIDL documents. Each one binds a `DataTable` to a `$query` data
 * source, so the same document renders against the desk endpoint here, against an
 * in-memory adapter in a test, or in UIDL-Builder for editing.
 */
export type SectionId = 'projects' | 'agents' | 'approvals' | 'context' | 'memory' | 'runs' | 'tasks' | 'notes';

export interface SectionMeta {
  title: string;
  /** Project sections need a project selected; workspace sections can filter by one. */
  scope: 'workspace' | 'project';
}

export const SECTIONS: Record<SectionId, SectionMeta> = {
  projects: { title: 'Projects', scope: 'workspace' },
  agents: { title: 'Agents', scope: 'workspace' },
  approvals: { title: 'Approvals', scope: 'workspace' },
  context: { title: 'Context', scope: 'project' },
  memory: { title: 'Memory', scope: 'project' },
  runs: { title: 'Runs', scope: 'project' },
  tasks: { title: 'Tasks', scope: 'project' },
  notes: { title: 'Notes', scope: 'project' },
};

interface Column {
  key: string;
  label: string;
  format?: 'text' | 'status' | 'integer';
}

function table(id: string, source: string, columns: Column[], emptyMessage: string, title?: string): UIDLNode {
  return {
    id,
    type: 'DataTable',
    props: { dataSource: source, columns, emptyMessage, showIndex: false, ...(title ? { title } : {}) },
  };
}

function text(id: string, value: string): UIDLNode {
  return { id, type: 'Text', props: { value } };
}

function query(collection: string, project: string | undefined, sort?: { field: string; dir: 'asc' | 'desc' }) {
  return {
    $query: {
      collection,
      filters: project ? [{ field: 'project', op: 'eq', value: project }] : [],
      ...(sort ? { sort: [sort] } : {}),
    },
  };
}

function document(id: string, name: string, children: UIDLNode[], dataSources: Record<string, unknown>): UIDLDocument {
  return {
    version: '1.0.0',
    id,
    name,
    dataSources,
    root: { id: `${id}-root`, type: 'Column', style: { gap: '16px' }, children },
  };
}

const AGENT_COLUMNS: Column[] = [
  { key: 'tool', label: 'Agent' },
  { key: 'project', label: 'Project' },
  { key: 'state', label: 'State', format: 'status' },
  { key: 'detail', label: 'Detail' },
];

const APPROVAL_COLUMNS: Column[] = [
  { key: 'project', label: 'Project' },
  { key: 'action', label: 'Action' },
  { key: 'requestedAt', label: 'Requested' },
  { key: 'expiresAt', label: 'Expires' },
];

/** A form field whose value lives at `state.<path>` and follows every change. */
function field(id: string, type: 'TextField' | 'Textarea', label: string, path: string, extra: Record<string, unknown> = {}): UIDLNode {
  return {
    id,
    type,
    props: { label, value: { $bind: `state.${path}` }, ...extra },
    events: { onChange: [{ setState: { path, value: null } }] },
  } as UIDLNode;
}

/**
 * The note form. The button runs the host command `notes.add`, which reads `state.note`
 * and writes through `ws note`; on success the form clears and the table reloads.
 */
function noteForm(): UIDLNode {
  return {
    id: 'note-form',
    type: 'Column',
    style: { gap: '8px' },
    children: [
      field('note-title', 'TextField', 'Title', 'note.title', { placeholder: 'What is this note about?' }),
      field('note-body', 'Textarea', 'Note', 'note.body', { rows: 4, placeholder: 'Markdown is fine.' }),
      { id: 'note-error', type: 'Text', props: { value: { $bind: 'state.note.error' } } },
      {
        id: 'note-add',
        type: 'Button',
        props: { label: 'Add note' },
        events: {
          onClick: [{
            command: {
              name: 'notes.add',
              statusPath: 'note.status',
              errorPath: 'note.error',
              onSuccess: {
                sequence: [
                  { setState: { path: 'note.title', value: '' } },
                  { setState: { path: 'note.body', value: '' } },
                  { query: { target: 'rows' } },
                  { showSnackbar: { message: 'Note added' } },
                ],
              },
            },
          }],
        },
      } as UIDLNode,
    ],
  };
}

/** The document for one section; `project` scopes it (required for project sections). */
export function sectionDocument(section: SectionId, project: string | undefined, room?: FloorRoom): UIDLDocument {
  const id = `desk-${section}${project ? `-${project}` : ''}`;
  const name = SECTIONS[section].title;
  switch (section) {
    case 'projects':
      return document(id, name, [
        table('projects', 'rows', [
          { key: 'key', label: 'Project' },
          { key: 'client', label: 'Client' },
          { key: 'group', label: 'Group' },
          { key: 'agents', label: 'Agents', format: 'integer' },
          { key: 'approvals', label: 'Approvals', format: 'integer' },
        ], 'No projects registered.'),
      ], { rows: query('projects', undefined, { field: 'key', dir: 'asc' }) });
    case 'agents':
      return document(id, name, [
        table('agents', 'rows', AGENT_COLUMNS, 'No agent is clocked in or chatting.'),
      ], { rows: query('agents', project) });
    case 'approvals':
      return document(id, name, [
        text('approvals-hint', 'Approve or deny from the agent that raised its hand on the floor. Each approval is single use.'),
        table('approvals', 'rows', APPROVAL_COLUMNS, 'Nothing is waiting for you.'),
      ], { rows: query('approvals', project, { field: 'requestedAt', dir: 'asc' }) });
    case 'context':
      return document(id, name, [
        table('facts', 'facts', [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Value' }], '', 'Project'),
        table('agents', 'agents', AGENT_COLUMNS, 'Nobody is working here right now.', 'Working here'),
        table('approvals', 'approvals', APPROVAL_COLUMNS, 'Nothing is waiting for you.', 'Waiting for you'),
      ], {
        facts: [
          { id: 'key', field: 'Key', value: project ?? '' },
          { id: 'group', field: 'Group', value: room?.group ?? '-' },
          { id: 'description', field: 'Description', value: room?.description || '-' },
          { id: 'session', field: 'Coding session', value: room?.codingSession ? 'active' : 'none' },
        ],
        agents: query('agents', project),
        approvals: query('approvals', project),
      });
    case 'memory':
      return document(id, name, [
        table('memory', 'rows', [
          { key: 'name', label: 'File' },
          { key: 'updated', label: 'Updated' },
          { key: 'excerpt', label: 'First line' },
        ], 'This project has no memory files yet.'),
      ], { rows: query('memory', project) });
    case 'runs':
      return document(id, name, [
        table('runs', 'rows', [
          { key: 'started', label: 'Started' },
          { key: 'title', label: 'Title' },
          { key: 'state', label: 'State', format: 'status' },
        ], 'No runs yet. Start one with ws run.'),
      ], { rows: query('runs', project) });
    case 'tasks':
      return document(id, name, [
        text('tasks-hint', 'Plan rows of every run that is not done.'),
        table('tasks', 'rows', [
          { key: 'task', label: 'Task' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'run', label: 'Run' },
          { key: 'notes', label: 'Notes' },
        ], 'No open tasks.'),
      ], { rows: query('tasks', project) });
    case 'notes':
      return {
        ...document(id, name, [
          text('notes-hint', 'Notes are Markdown files in this project\'s memory, written by ws note.'),
          noteForm(),
          table('notes', 'rows', [
            { key: 'name', label: 'Note' },
            { key: 'updated', label: 'Updated' },
            { key: 'excerpt', label: 'First line' },
          ], 'No notes yet.'),
        ], { rows: query('notes', project, { field: 'updated', dir: 'desc' }) }),
        state: { note: { title: '', body: '' } },
      };
  }
}
