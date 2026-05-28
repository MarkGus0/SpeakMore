import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROMPT_DICTIONARY_TERMS,
  HARD_MAX_PROMPT_DICTIONARY_TERMS,
  normalizeDictionaryEntry,
  upsertDictionaryEntry,
  buildPromptDictionaryTerms,
  learnDictionaryCandidate,
} from './dictionary-store.js';

test('normalizeDictionaryEntry 归一化正式词条', () => {
  const entry = normalizeDictionaryEntry({
    phrase: '  Client2API  ',
    aliases: [' client to api ', '', 'client 2 api', 'client to api'],
    source: 'auto',
    status: 'disabled',
    hitCount: '2',
    createdAt: '2026-05-18T00:00:00.000Z',
  });

  assert.equal(entry.phrase, 'Client2API');
  assert.deepEqual(entry.aliases, ['client to api', 'client 2 api']);
  assert.equal(entry.source, 'auto');
  assert.equal(entry.status, 'disabled');
  assert.equal(entry.hitCount, 2);
  assert.match(entry.id, /^dict_/);
});

test('learnDictionaryCandidate 同一纠错出现三次后转为自动词条', () => {
  const first = learnDictionaryCandidate([], { wrong: 'client to api', correct: 'Client2API' }, '2026-05-18T00:00:00.000Z');
  const second = learnDictionaryCandidate(first.candidates, { wrong: 'client to api', correct: 'Client2API' }, '2026-05-18T00:01:00.000Z');
  const third = learnDictionaryCandidate(second.candidates, { wrong: 'client to api', correct: 'Client2API' }, '2026-05-18T00:02:00.000Z');

  assert.equal(third.candidates[0].count, 3);
  assert.equal(third.candidates[0].status, 'promoted');
  assert.equal(third.promotedEntry.phrase, 'Client2API');
  assert.deepEqual(third.promotedEntry.aliases, ['client to api']);
  assert.equal(third.promotedEntry.source, 'auto');
});

test('buildPromptDictionaryTerms 只返回启用词条并按命中数排序', () => {
  const terms = buildPromptDictionaryTerms([
    { phrase: '低频词', aliases: ['di pin ci'], status: 'active', hitCount: 1 },
    { phrase: '禁用词', aliases: ['jin yong ci'], status: 'disabled', hitCount: 100 },
    { phrase: 'Client2API', aliases: ['client to api'], status: 'active', hitCount: 5 },
  ]);

  assert.deepEqual(terms, [
    { phrase: 'Client2API', aliases: ['client to api'] },
    { phrase: '低频词', aliases: ['di pin ci'] },
  ]);
});

test('upsertDictionaryEntry 合并同名词条和别名', () => {
  const entries = upsertDictionaryEntry([
    {
      id: 'dict_existing',
      phrase: 'Client2API',
      aliases: ['client to api'],
      source: 'manual',
      status: 'active',
      hitCount: 1,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      lastLearnedAt: '',
    },
  ], {
    phrase: ' client2api ',
    aliases: ['client 2 api'],
    source: 'auto',
    hitCount: 3,
  }, '2026-05-18T00:03:00.000Z');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'dict_existing');
  assert.equal(entries[0].phrase, 'Client2API');
  assert.deepEqual(entries[0].aliases, ['client to api', 'client 2 api']);
  assert.equal(entries[0].hitCount, 3);
});

test('learnDictionaryCandidate 不会重新累计已忽略候选', () => {
  const result = learnDictionaryCandidate([
    {
      id: 'candidate_ignored',
      wrong: 'client to api',
      correct: 'Client2API',
      count: 2,
      status: 'ignored',
      firstSeenAt: '2026-05-18T00:00:00.000Z',
      lastSeenAt: '2026-05-18T00:01:00.000Z',
    },
  ], { wrong: 'client to api', correct: 'Client2API' }, '2026-05-18T00:02:00.000Z');

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, 'ignored');
  assert.equal(result.candidates[0].count, 2);
  assert.equal(result.promotedEntry, null);
});

test('upsertDictionaryEntry 合并同名词条时保留已有正确写法和手动来源', () => {
  const entries = upsertDictionaryEntry([
    {
      id: 'dict_existing',
      phrase: 'Client2API',
      aliases: ['client to api'],
      source: 'manual',
      status: 'active',
      hitCount: 1,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      lastLearnedAt: '',
    },
  ], {
    phrase: 'client2api',
    aliases: ['client 2 api'],
    source: 'auto',
    hitCount: 3,
  }, '2026-05-18T00:03:00.000Z');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'dict_existing');
  assert.equal(entries[0].phrase, 'Client2API');
  assert.equal(entries[0].source, 'manual');
  assert.deepEqual(entries[0].aliases, ['client to api', 'client 2 api']);
  assert.equal(entries[0].hitCount, 3);
});

test('buildPromptDictionaryTerms 默认最多返回 24 条', () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    phrase: `词${index}`,
    aliases: [`alias${index}`],
    status: 'active',
    hitCount: index,
    updatedAt: `2026-05-${String(index % 28 + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

  const terms = buildPromptDictionaryTerms(entries, { now: '2026-05-28T00:00:00.000Z' });

  assert.equal(DEFAULT_PROMPT_DICTIONARY_TERMS, 24);
  assert.equal(terms.length, 24);
});

test('buildPromptDictionaryTerms 把传入上限限制在 8 到 40 之间', () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({
    phrase: `词${index}`,
    aliases: [`alias${index}`],
    status: 'active',
    hitCount: index,
    updatedAt: `2026-05-${String(index % 28 + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

  const tooHigh = buildPromptDictionaryTerms(entries, {
    limit: 100,
    now: '2026-05-28T00:00:00.000Z',
  });
  const tooLow = buildPromptDictionaryTerms(entries, {
    limit: 1,
    now: '2026-05-28T00:00:00.000Z',
  });

  assert.equal(HARD_MAX_PROMPT_DICTIONARY_TERMS, 40);
  assert.equal(tooHigh.length, 40);
  assert.equal(tooLow.length, 8);
});

test('buildPromptDictionaryTerms 使用时间衰减让近期自动词条超过旧手动词条', () => {
  const terms = buildPromptDictionaryTerms([
    {
      phrase: '旧手动词',
      aliases: ['old manual'],
      source: 'manual',
      status: 'active',
      hitCount: 100,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      lastLearnedAt: '',
    },
    {
      phrase: 'Openclaw',
      aliases: ['Open Cloud'],
      source: 'auto',
      status: 'active',
      hitCount: 3,
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      lastLearnedAt: '2026-05-27T00:00:00.000Z',
    },
  ], { now: '2026-05-28T00:00:00.000Z' });

  assert.deepEqual(terms, [
    { phrase: 'Openclaw', aliases: ['Open Cloud'] },
    { phrase: '旧手动词', aliases: ['old manual'] },
  ]);
});

test('buildPromptDictionaryTerms 不返回禁用词条且不修改原始词条', () => {
  const entries = [
    {
      phrase: '禁用词',
      aliases: ['disabled alias'],
      source: 'manual',
      status: 'disabled',
      hitCount: 100,
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
    {
      phrase: '启用词',
      aliases: ['active alias'],
      source: 'auto',
      status: 'active',
      hitCount: 1,
      updatedAt: '2026-05-28T00:00:00.000Z',
    },
  ];

  const before = JSON.stringify(entries);
  const terms = buildPromptDictionaryTerms(entries, { now: '2026-05-28T00:00:00.000Z' });

  assert.deepEqual(terms, [
    { phrase: '启用词', aliases: ['active alias'] },
  ]);
  assert.equal(JSON.stringify(entries), before);
});
