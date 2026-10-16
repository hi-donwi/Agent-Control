import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, addNote, validateNote, type WsInputRunner } from './notes.js';
import { excerpt } from './collections.js';

describe('validateNote', () => {
  it('trims and flattens the title and normalizes line ends', () => {
    assert.deepEqual(validateNote({ project: 'alpha', title: '  First\n idea ', body: 'a\r\nb' }), { project: 'alpha', title: 'First idea', body: 'a\nb' });
  });

  it('refuses a bad project, an empty or long title, an oversized body, and control characters', () => {
    assert.throws(() => validateNote({ project: '../x', title: 't' }), /choose a project/);
    assert.throws(() => validateNote({ project: 'alpha', title: '   ' }), /needs a title/);
    assert.throws(() => validateNote({ project: 'alpha', title: 'x'.repeat(NOTE_TITLE_MAX + 1) }), /longer than/);
    assert.throws(() => validateNote({ project: 'alpha', title: 't', body: 'x'.repeat(NOTE_BODY_MAX + 1) }), /larger than/);
    assert.throws(() => validateNote({ project: 'alpha', title: 't', body: 'bell\u0007' }), /control characters/);
  });
});

describe('addNote', () => {
  it('runs ws note with the body on stdin and returns the printed path', async () => {
    const calls: Array<{ args: string[]; input: string }> = [];
    const run: WsInputRunner = async (args, input) => {
      calls.push({ args, input });
      return '\u001b[32mnote context/memory/projects/alpha/notes/2026-10-16-first-idea.md\u001b[0m\n';
    };
    assert.deepEqual(await addNote(run, { project: 'alpha', title: 'First idea', body: 'Try a CSV first.' }), {
      path: 'context/memory/projects/alpha/notes/2026-10-16-first-idea.md',
    });
    assert.deepEqual(calls, [{ args: ['note', 'alpha', 'First idea', '-'], input: 'Try a CSV first.' }]);
  });

  it('never runs ws for an invalid note, and reports a ws failure', async () => {
    let ran = false;
    await assert.rejects(addNote(async () => { ran = true; return ''; }, { project: 'alpha', title: '' }), /needs a title/);
    assert.equal(ran, false);
    await assert.rejects(addNote(async () => { throw new Error("project 'alpha' has no memory"); }, { project: 'alpha', title: 't' }), /no memory/);
    await assert.rejects(addNote(async () => 'nothing useful', { project: 'alpha', title: 't' }), /did not report/);
  });
});

describe('note excerpt', () => {
  it('skips the who-and-when comment ws note leaves on the last line', () => {
    assert.equal(excerpt('# Title\n\n<!-- ws note 2026-10-16T10:00:00+07:00 dev-agent-control -->\n'), '');
    assert.equal(excerpt('# Title\n\nBody first.\n\n<!-- ws note x -->\n'), 'Body first.');
  });
});
