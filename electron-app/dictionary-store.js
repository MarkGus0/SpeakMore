/**
 * 词典纯数据算法
 *
 * 需要理解词条规范化、候选计数、自动提升和 prompt 词典裁剪策略时看这里。
 */
const crypto = require('crypto');

const DEFAULT_PROMPT_DICTIONARY_TERMS = 24;
const MIN_PROMPT_DICTIONARY_TERMS = 8;
const HARD_MAX_PROMPT_DICTIONARY_TERMS = 40;
const PROMPT_DICTIONARY_HALF_LIFE_DAYS = 30;
// 三次相同修正才自动提升，避免用户一次偶然改写就污染正式词典。
const AUTO_PROMOTE_THRESHOLD = 3;
const ENTRY_SOURCES = new Set(['manual', 'auto']);
const ENTRY_STATUSES = new Set(['active', 'disabled']);
const CANDIDATE_STATUSES = new Set(['candidate', 'ignored', 'promoted']);

function createId(prefix) {
  // 词典存在本地 JSON 中，稳定 id 让前端列表操作不依赖词条文本本身。
  return `${prefix}_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizePhrase(value) {
  // 统一空白能让“同一个词条的不同空格写法”落到同一个比较维度。
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueAliases(aliases, phrase = '') {
  const normalizedPhrase = normalizePhrase(phrase).toLowerCase();
  const seen = new Set();
  // 别名不能和正确写法相同，也不能重复；否则 prompt 会出现没有信息量的规则。
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
  // 读本地 JSON 时也走规范化，防止旧数据或手改文件里的坏字段扩散到 UI 和后端 prompt。
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
  // 候选保留 wrong/correct/count/status，足够表达“用户重复把某个写法改成另一个写法”。
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
  // 正式词条按正确写法合并，避免同一术语因为大小写差异生成多条。
  return normalizePhrase(left.phrase).toLowerCase() === normalizePhrase(right.phrase).toLowerCase();
}

function clampPromptDictionaryLimit(limit = DEFAULT_PROMPT_DICTIONARY_TERMS) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return DEFAULT_PROMPT_DICTIONARY_TERMS;
  return Math.min(
    HARD_MAX_PROMPT_DICTIONARY_TERMS,
    Math.max(MIN_PROMPT_DICTIONARY_TERMS, Math.floor(numeric)),
  );
}

function readTimestamp(value, fallback = 0) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : fallback;
}

function resolveEntryEffectiveTime(entry) {
  const createdAt = readTimestamp(entry.createdAt, 0);
  return readTimestamp(entry.lastLearnedAt, readTimestamp(entry.updatedAt, createdAt));
}

function calculateRecencyWeight(entry, now = new Date().toISOString()) {
  const nowTime = readTimestamp(now, Date.now());
  const effectiveTime = resolveEntryEffectiveTime(entry);
  if (!effectiveTime || effectiveTime >= nowTime) return 1;
  const ageDays = (nowTime - effectiveTime) / 86400000;
  return Math.pow(0.5, ageDays / PROMPT_DICTIONARY_HALF_LIFE_DAYS);
}

function calculateDictionaryTermScore(entry, now = new Date().toISOString()) {
  const normalized = normalizeDictionaryEntry(entry, now);
  const typeWeight = normalized.source === 'manual' ? 1.05 : 1;
  const frequencyWeight = 1 + Math.log1p(normalized.hitCount);
  return typeWeight * frequencyWeight * calculateRecencyWeight(normalized, now);
}

function normalizePromptDictionaryOptions(options = {}) {
  if (typeof options === 'number') {
    return {
      limit: clampPromptDictionaryLimit(options),
      now: new Date().toISOString(),
    };
  }
  if (!options || typeof options !== 'object') {
    return {
      limit: DEFAULT_PROMPT_DICTIONARY_TERMS,
      now: new Date().toISOString(),
    };
  }
  return {
    limit: clampPromptDictionaryLimit(options.limit),
    now: typeof options.now === 'string' && options.now ? options.now : new Date().toISOString(),
  };
}

function upsertDictionaryEntry(entries, entry, now = new Date().toISOString()) {
  const normalizedEntries = (Array.isArray(entries) ? entries : []).map((item) => normalizeDictionaryEntry(item, now));
  const normalized = normalizeDictionaryEntry({ ...entry, updatedAt: now }, now);
  if (!normalized.phrase) return normalizedEntries;

  const existingIndex = normalizedEntries.findIndex((item) => sameEntry(item, normalized));
  if (existingIndex === -1) return [normalized, ...normalizedEntries];

  return normalizedEntries.map((item, index) => {
    if (index !== existingIndex) return item;
    // 手动词条代表用户明确配置，自动学习只能补充别名和命中信息，不能把来源覆盖成 auto。
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

function buildPromptDictionaryTerms(entries, options = {}) {
  const { limit, now } = normalizePromptDictionaryOptions(options);
  // 传给后端的 prompt 词典只包含启用词条，并按动态分数裁剪，避免无关词条稀释模型注意力。
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeDictionaryEntry(entry, now))
    .filter((entry) => entry.status === 'active' && entry.phrase)
    .map((entry) => ({
      entry,
      score: calculateDictionaryTermScore(entry, now),
      effectiveTime: resolveEntryEffectiveTime(entry),
    }))
    .sort((left, right) => (
      right.score - left.score
      || right.effectiveTime - left.effectiveTime
      || right.entry.updatedAt.localeCompare(left.entry.updatedAt)
      || left.entry.phrase.localeCompare(right.entry.phrase)
    ))
    .slice(0, limit)
    .map(({ entry }) => ({ phrase: entry.phrase, aliases: entry.aliases }));
}

function learnDictionaryCandidate(candidates, correction, now = new Date().toISOString()) {
  // correction 来自“粘贴文本”和“用户改后文本”的差异，不在这里重新做文本 diff。
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeDictionaryCandidate(candidate, now));
  const normalized = normalizeDictionaryCandidate({
    wrong: correction?.wrong,
    correct: correction?.correct,
    count: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  }, now);

  // 空值、自我映射都没有学习价值，直接保留现有候选。
  if (!normalized.wrong || !normalized.correct || normalized.wrong.toLowerCase() === normalized.correct.toLowerCase()) {
    return { candidates: normalizedCandidates, promotedEntry: null };
  }

  let promotedEntry = null;
  // 同一组 wrong -> correct 才累计次数；反向修改或改到其它正确写法应当是另一条候选。
  const key = `${normalized.wrong.toLowerCase()}\n${normalized.correct.toLowerCase()}`;
  const index = normalizedCandidates.findIndex((candidate) => (
    `${candidate.wrong.toLowerCase()}\n${candidate.correct.toLowerCase()}` === key
  ));

  if (index === -1) {
    // 第一次出现只进入候选，不立即影响后端 prompt。
    return { candidates: [normalized, ...normalizedCandidates], promotedEntry };
  }

  if (normalizedCandidates[index].status === 'ignored') {
    // 用户忽略过的候选不再自动累加，避免已经拒绝的学习结果反复回来。
    return { candidates: normalizedCandidates, promotedEntry };
  }

  const updated = normalizeDictionaryCandidate({
    ...normalizedCandidates[index],
    count: normalizedCandidates[index].count + 1,
    lastSeenAt: now,
  }, now);

  if (updated.count >= AUTO_PROMOTE_THRESHOLD) {
    updated.status = 'promoted';
    // 达到阈值后才生成正式词条；wrong 成为别名，correct 成为后端 prompt 的正确写法。
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
  DEFAULT_PROMPT_DICTIONARY_TERMS,
  MIN_PROMPT_DICTIONARY_TERMS,
  HARD_MAX_PROMPT_DICTIONARY_TERMS,
  PROMPT_DICTIONARY_HALF_LIFE_DAYS,
  AUTO_PROMOTE_THRESHOLD,
  clampPromptDictionaryLimit,
  calculateDictionaryTermScore,
  normalizeDictionaryEntry,
  normalizeDictionaryCandidate,
  upsertDictionaryEntry,
  buildPromptDictionaryTerms,
  learnDictionaryCandidate,
};
