const {
  normalizeDictionaryEntry,
  upsertDictionaryEntry,
} = require('./dictionary-store');

function stableEntries(entries) {
  return Array.isArray(entries) ? entries : [];
}

function createDictionaryEntryResult(entries, payload = {}, now = new Date().toISOString()) {
  const currentEntries = stableEntries(entries);
  const normalizedPayload = normalizeDictionaryEntry({
    ...payload,
    source: payload.source === 'auto' ? 'auto' : 'manual',
    status: payload.status === 'disabled' ? 'disabled' : 'active',
  }, now);

  if (!normalizedPayload.phrase) {
    return {
      success: false,
      code: 'dictionary_entry_invalid',
      data: null,
      entries: currentEntries,
    };
  }

  const nextEntries = upsertDictionaryEntry(currentEntries, normalizedPayload, now);
  const created = nextEntries.find((entry) => (
    entry.phrase.toLowerCase() === normalizedPayload.phrase.toLowerCase()
  )) || null;

  return {
    success: Boolean(created),
    data: created,
    entries: nextEntries,
  };
}

function updateDictionaryEntryResult(entries, payload = {}, now = new Date().toISOString()) {
  const currentEntries = stableEntries(entries);
  const target = currentEntries.find((entry) => entry.id === payload.id);
  if (!target) {
    return {
      success: false,
      code: 'dictionary_entry_not_found',
      data: null,
      entries: currentEntries,
    };
  }

  const updated = normalizeDictionaryEntry({
    ...target,
    ...payload,
    id: target.id,
    createdAt: target.createdAt,
    updatedAt: now,
  }, now);

  if (!updated.phrase) {
    return {
      success: false,
      code: 'dictionary_entry_invalid',
      data: null,
      entries: currentEntries,
    };
  }

  return {
    success: true,
    data: updated,
    entries: currentEntries.map((entry) => (entry.id === target.id ? updated : entry)),
  };
}

module.exports = {
  createDictionaryEntryResult,
  updateDictionaryEntryResult,
};
