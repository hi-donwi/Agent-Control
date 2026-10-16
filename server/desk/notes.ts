import { KEY_RE } from './workspace-files.js';
import { reportedLine, type WsInputRunner } from './ws-input.js';

export { realWsInputRunner, type WsInputRunner } from './ws-input.js';

/**
 * The desk's first write: a project note, written by `ws note` and never by this host
 * (Agent-Workspace ADR-0019 §2, ADR-0023). The body goes through stdin, not an argument.
 */
export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 65_536;

export interface NoteRequest {
  project: unknown;
  title: unknown;
  body?: unknown;
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** The note's fields, checked before anything runs; throws with a message for the operator. */
export function validateNote(request: NoteRequest): { project: string; title: string; body: string } {
  const project = typeof request.project === 'string' ? request.project : '';
  if (!KEY_RE.test(project)) throw new Error('choose a project for the note');
  const title = typeof request.title === 'string' ? request.title.replace(/\s+/g, ' ').trim() : '';
  if (!title) throw new Error('a note needs a title');
  if (title.length > NOTE_TITLE_MAX) throw new Error(`the title is longer than ${NOTE_TITLE_MAX} characters`);
  const body = typeof request.body === 'string' ? request.body.replace(/\r\n?/g, '\n') : '';
  if (Buffer.byteLength(body, 'utf-8') > NOTE_BODY_MAX) throw new Error(`the note is larger than ${NOTE_BODY_MAX} bytes`);
  if (CONTROL_RE.test(body)) throw new Error('the note contains control characters');
  return { project, title, body };
}

/** Writes the note through `ws note` and returns the path it printed. */
export async function addNote(run: WsInputRunner, request: NoteRequest): Promise<{ path: string }> {
  const note = validateNote(request);
  const output = await run(['note', note.project, note.title, '-'], note.body);
  const path = reportedLine(output, 'note');
  if (!path) throw new Error('ws note did not report the note it wrote');
  return { path };
}
