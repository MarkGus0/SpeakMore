const {
  normalizeDictionaryEntry,
  normalizeDictionaryCandidate,
  upsertDictionaryEntry,
  buildPromptDictionaryTerms,
  learnDictionaryCandidate,
} = require('./dictionary-store');
const {
  createDictionaryEntryResult,
  updateDictionaryEntryResult,
} = require('./dictionary-actions');

function createDictionaryRepository({
  readJsonFile,
  writeJsonFile,
  dictionaryFileName = 'dictionary.json',
  candidatesFileName = 'dictionary-candidates.json',
  logger = null,
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readDictionaryEntries() {
    const value = readJsonFile(dictionaryFileName, []);
    if (!Array.isArray(value)) return [];
    const entries = value.map(normalizeDictionaryEntry).filter((entry) => entry.phrase);
    logger?.info?.('[auto-learning][dictionary] 读取正式词条', {
      fileName: dictionaryFileName,
      count: entries.length,
    });
    return entries;
  }

  function writeDictionaryEntries(entries) {
    const nextEntries = entries.map(normalizeDictionaryEntry).filter((entry) => entry.phrase);
    logger?.info?.('[auto-learning][dictionary] 写入正式词条', {
      fileName: dictionaryFileName,
      count: nextEntries.length,
    });
    return writeJsonFile(
      dictionaryFileName,
      nextEntries,
    );
  }

  function readDictionaryCandidates() {
    const value = readJsonFile(candidatesFileName, []);
    if (!Array.isArray(value)) return [];
    const candidates = value.map(normalizeDictionaryCandidate).filter((candidate) => candidate.wrong && candidate.correct);
    logger?.info?.('[auto-learning][dictionary] 读取候选词条', {
      fileName: candidatesFileName,
      count: candidates.length,
    });
    return candidates;
  }

  function writeDictionaryCandidates(candidates) {
    const nextCandidates = candidates.map(normalizeDictionaryCandidate).filter((candidate) => candidate.wrong && candidate.correct);
    logger?.info?.('[auto-learning][dictionary] 写入候选词条', {
      fileName: candidatesFileName,
      count: nextCandidates.length,
    });
    return writeJsonFile(
      candidatesFileName,
      nextCandidates,
    );
  }

  function readPromptDictionaryTerms() {
    return buildPromptDictionaryTerms(readDictionaryEntries());
  }

  function learnDictionaryCorrection(candidate) {
    logger?.info?.('[auto-learning][dictionary] 开始学习候选', {
      wrong: candidate?.wrong,
      correct: candidate?.correct,
    });
    const result = learnDictionaryCandidate(readDictionaryCandidates(), candidate);
    writeDictionaryCandidates(result.candidates);
    if (result.promotedEntry) {
      writeDictionaryEntries(upsertDictionaryEntry(readDictionaryEntries(), result.promotedEntry));
    }
    logger?.info?.('[auto-learning][dictionary] 学习候选结束', {
      wrong: candidate?.wrong,
      correct: candidate?.correct,
      candidateCount: result.candidates.length,
      promoted: Boolean(result.promotedEntry),
    });
    return result;
  }

  function createEntry(payload = {}, now = new Date().toISOString()) {
    const result = createDictionaryEntryResult(readDictionaryEntries(), payload, now);
    if (result.success) writeDictionaryEntries(result.entries);
    return { success: result.success, code: result.code, data: result.data };
  }

  function updateEntry(payload = {}, now = new Date().toISOString()) {
    const result = updateDictionaryEntryResult(readDictionaryEntries(), payload, now);
    if (result.success) writeDictionaryEntries(result.entries);
    return { success: result.success, code: result.code, data: result.data };
  }

  function deleteEntry(id) {
    writeDictionaryEntries(readDictionaryEntries().filter((entry) => entry.id !== id));
    return { success: true };
  }

  function promoteCandidate(id, now = new Date().toISOString()) {
    const candidates = readDictionaryCandidates();
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return { success: false, code: 'dictionary_candidate_not_found' };

    const entries = upsertDictionaryEntry(readDictionaryEntries(), {
      phrase: candidate.correct,
      aliases: [candidate.wrong],
      source: 'auto',
      status: 'active',
      hitCount: candidate.count,
      lastLearnedAt: now,
    }, now);
    const nextCandidates = candidates.map((item) => (
      item.id === id ? normalizeDictionaryCandidate({ ...item, status: 'promoted', lastSeenAt: now }) : item
    ));
    writeDictionaryEntries(entries);
    writeDictionaryCandidates(nextCandidates);
    logger?.info?.('[auto-learning][dictionary] 候选已提升为正式词条', {
      id,
      wrong: candidate.wrong,
      correct: candidate.correct,
    });
    const promoted = entries.find((entry) => entry.phrase.toLowerCase() === candidate.correct.toLowerCase()) || entries[0] || null;
    return { success: Boolean(promoted), data: promoted };
  }

  function ignoreCandidate(id) {
    const nextCandidates = readDictionaryCandidates().map((item) => (
      item.id === id ? normalizeDictionaryCandidate({ ...item, status: 'ignored' }) : item
    ));
    writeDictionaryCandidates(nextCandidates);
    logger?.info?.('[auto-learning][dictionary] 候选已忽略', { id });
    return { success: true };
  }

  return {
    readDictionaryEntries,
    writeDictionaryEntries,
    readDictionaryCandidates,
    writeDictionaryCandidates,
    readPromptDictionaryTerms,
    learnDictionaryCorrection,
    createEntry,
    updateEntry,
    deleteEntry,
    promoteCandidate,
    ignoreCandidate,
  };
}

module.exports = {
  createDictionaryRepository,
};
