const crypto = require('crypto');

const MEETING_NOTE_STATUSES = new Set(['draft', 'recording', 'processing', 'completed', 'error']);
const MEETING_NOTE_SOURCES = new Set(['manual', 'recording', 'import']);
const MAX_MEETING_TITLE_LENGTH = 120;
const MAX_MEETING_TEXT_LENGTH = 2_000_000;

function createMeetingNoteId() {
  return `meeting_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizeText(value, maxLength = MAX_MEETING_TEXT_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeOptionalString(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeMeetingNote(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const now = new Date().toISOString();
  const title = normalizeOptionalString(source.title ?? base.title, MAX_MEETING_TITLE_LENGTH);
  const transcript = normalizeText(source.transcript ?? base.transcript);
  const summary = normalizeText(source.summary ?? base.summary);
  const status = MEETING_NOTE_STATUSES.has(source.status) ? source.status : base.status || 'draft';
  const sourceType = MEETING_NOTE_SOURCES.has(source.source) ? source.source : base.source || 'manual';
  const importFile = source.importFile && typeof source.importFile === 'object' && !Array.isArray(source.importFile)
    ? source.importFile
    : base.importFile || null;

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : base.id || createMeetingNoteId(),
    title: title || 'Untitled Meeting',
    status,
    source: sourceType,
    transcript,
    summary,
    durationMs: Math.max(0, Number(source.durationMs ?? base.durationMs) || 0),
    importFile: importFile ? {
      name: normalizeOptionalString(importFile.name, 240),
      size: Math.max(0, Number(importFile.size) || 0),
      type: normalizeOptionalString(importFile.type, 120),
    } : null,
    createdAt: normalizeOptionalString(source.createdAt ?? base.createdAt, 80) || now,
    updatedAt: normalizeOptionalString(source.updatedAt ?? base.updatedAt, 80) || now,
    error: normalizeOptionalString(source.error ?? base.error, 1000),
  };
}

function normalizeMeetingNotes(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeMeetingNote(item))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function upsertMeetingNote(notes, payload = {}) {
  const existing = normalizeMeetingNotes(notes);
  const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : '';
  const current = id ? existing.find((note) => note.id === id) : null;
  const nextNote = normalizeMeetingNote({
    ...current,
    ...payload,
    id: current?.id || id || undefined,
    updatedAt: new Date().toISOString(),
  }, current || {});
  const nextNotes = current
    ? existing.map((note) => (note.id === current.id ? nextNote : note))
    : [nextNote, ...existing];
  return normalizeMeetingNotes(nextNotes);
}

function deleteMeetingNote(notes, id) {
  return normalizeMeetingNotes(notes).filter((note) => note.id !== id);
}

module.exports = {
  MEETING_NOTE_STATUSES,
  MEETING_NOTE_SOURCES,
  normalizeMeetingNote,
  normalizeMeetingNotes,
  upsertMeetingNote,
  deleteMeetingNote,
};
