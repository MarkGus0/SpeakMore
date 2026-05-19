const crypto = require('crypto');

const MAX_PROMPT_DICTIONARY_TERMS = 100;
const AUTO_PROMOTE_THRESHOLD = 3;
const ENTRY_SOURCES = new Set(['manual', 'auto']);
const ENTRY_STATUSES = new Set(['active', 'disabled']);
const CANDIDATE_STATUSES = new Set(['candidate', 'ignored', 'promoted']);

function createId(prefix) {
  return `${prefix}_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizePhrase(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueAliases(aliases, phrase = '') {
  const normalizedPhrase = normalizePhrase(phrase).toLowerCase();
  const seen = new Set();
  return (Array.isArray(aliases) ? aliases : [])
    .map(normalizePhrase)
    .filter(Boolean)
    .filter((alias) => alias.toLowerCase() !== normalizedPhrase)
    .filter((alias) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeDictionaryEntry(value = {}, now = new Date().toISOString()) {
  const phrase = normalizePhrase(value.phrase);
  const createdAt = typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : now;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId('dict'),
    phrase,
    aliases: uniqueAliases(value.aliases, phrase),
    source: ENTRY_SOURCES.has(value.source) ? value.source : 'manual',
    status: ENTRY_STATUSES.has(value.status) ? value.status : 'active',
    hitCount: Math.max(0, Number(value.hitCount) || 0),
    createdAt,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt,
    lastLearnedAt: typeof value.lastLearnedAt === 'string' ? value.lastLearnedAt : '',
  };
}

function normalizeDictionaryCandidate(value = {}, now = new Date().toISOString()) {
  const firstSeenAt = typeof value.firstSeenAt === 'string' && value.firstSeenAt ? value.firstSeenAt : now;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createId('candidate'),
    wrong: normalizePhrase(value.wrong),
    correct: normalizePhrase(value.correct),
    count: Math.max(0, Number(value.count) || 0),
    status: CANDIDATE_STATUSES.has(value.status) ? value.status : 'candidate',
    firstSeenAt,
    lastSeenAt: typeof value.lastSeenAt === 'string' && value.lastSeenAt ? value.lastSeenAt : firstSeenAt,
  };
}

function sameEntry(left, right) {
  return normalizePhrase(left.phrase).toLowerCase() === normalizePhrase(right.phrase).toLowerCase();
}

function upsertDictionaryEntry(entries, entry, now = new Date().toISOString()) {
  const normalizedEntries = (Array.isArray(entries) ? entries : []).map((item) => normalizeDictionaryEntry(item, now));
  const normalized = normalizeDictionaryEntry({ ...entry, updatedAt: now }, now);
  if (!normalized.phrase) return normalizedEntries;

  const existingIndex = normalizedEntries.findIndex((item) => sameEntry(item, normalized));
  if (existingIndex === -1) return [normalized, ...normalizedEntries];

  return normalizedEntries.map((item, index) => {
    if (index !== existingIndex) return item;
    return normalizeDictionaryEntry({
      ...item,
      ...normalized,
      id: item.id,
      phrase: item.phrase,
      source: item.source === 'manual' ? 'manual' : normalized.source,
      aliases: uniqueAliases([...item.aliases, ...normalized.aliases], item.phrase),
      hitCount: Math.max(item.hitCount, normalized.hitCount),
      createdAt: item.createdAt,
      updatedAt: now,
    }, now);
  });
}

function buildPromptDictionaryTerms(entries, limit = MAX_PROMPT_DICTIONARY_TERMS) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeDictionaryEntry(entry))
    .filter((entry) => entry.status === 'active' && entry.phrase)
    .sort((left, right) => right.hitCount - left.hitCount || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(({ phrase, aliases }) => ({ phrase, aliases }));
}

function learnDictionaryCandidate(candidates, correction, now = new Date().toISOString()) {
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeDictionaryCandidate(candidate, now));
  const normalized = normalizeDictionaryCandidate({
    wrong: correction?.wrong,
    correct: correction?.correct,
    count: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  }, now);

  if (!normalized.wrong || !normalized.correct || normalized.wrong.toLowerCase() === normalized.correct.toLowerCase()) {
    return { candidates: normalizedCandidates, promotedEntry: null };
  }

  let promotedEntry = null;
  const key = `${normalized.wrong.toLowerCase()}\n${normalized.correct.toLowerCase()}`;
  const index = normalizedCandidates.findIndex((candidate) => (
    `${candidate.wrong.toLowerCase()}\n${candidate.correct.toLowerCase()}` === key
  ));

  if (index === -1) {
    return { candidates: [normalized, ...normalizedCandidates], promotedEntry };
  }

  if (normalizedCandidates[index].status === 'ignored') {
    return { candidates: normalizedCandidates, promotedEntry };
  }

  const updated = normalizeDictionaryCandidate({
    ...normalizedCandidates[index],
    count: normalizedCandidates[index].count + 1,
    lastSeenAt: now,
  }, now);

  if (updated.count >= AUTO_PROMOTE_THRESHOLD) {
    updated.status = 'promoted';
    promotedEntry = normalizeDictionaryEntry({
      phrase: updated.correct,
      aliases: [updated.wrong],
      source: 'auto',
      status: 'active',
      hitCount: updated.count,
      lastLearnedAt: now,
      createdAt: updated.firstSeenAt,
      updatedAt: now,
    }, now);
  }

  const nextCandidates = [...normalizedCandidates];
  nextCandidates[index] = updated;
  return { candidates: nextCandidates, promotedEntry };
}

module.exports = {
  MAX_PROMPT_DICTIONARY_TERMS,
  AUTO_PROMOTE_THRESHOLD,
  normalizeDictionaryEntry,
  normalizeDictionaryCandidate,
  upsertDictionaryEntry,
  buildPromptDictionaryTerms,
  learnDictionaryCandidate,
};
