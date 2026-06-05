const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deleteMeetingNote,
  normalizeMeetingNote,
  upsertMeetingNote,
} = require('./meeting-note-store');

test('normalizeMeetingNote creates safe local meeting note defaults', () => {
  const note = normalizeMeetingNote({
    title: '  Weekly sync  ',
    status: 'unknown',
    source: 'import',
    transcript: ' transcript ',
    summary: ' summary ',
    durationMs: -1,
  });

  assert.match(note.id, /^meeting_/);
  assert.equal(note.title, 'Weekly sync');
  assert.equal(note.status, 'draft');
  assert.equal(note.source, 'import');
  assert.equal(note.transcript, 'transcript');
  assert.equal(note.summary, 'summary');
  assert.equal(note.durationMs, 0);
});

test('upsertMeetingNote updates existing notes and deleteMeetingNote removes them', () => {
  const created = upsertMeetingNote([], {
    id: 'meeting-1',
    title: 'Planning',
    transcript: 'hello',
  });
  const updated = upsertMeetingNote(created, {
    id: 'meeting-1',
    summary: 'summary',
    status: 'completed',
  });
  const deleted = deleteMeetingNote(updated, 'meeting-1');

  assert.equal(created.length, 1);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].title, 'Planning');
  assert.equal(updated[0].summary, 'summary');
  assert.equal(updated[0].status, 'completed');
  assert.deepEqual(deleted, []);
});
