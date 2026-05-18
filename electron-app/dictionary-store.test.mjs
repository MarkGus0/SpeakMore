import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  assert.equal(entries[0].phrase, 'client2api');
  assert.deepEqual(entries[0].aliases, ['client to api', 'client 2 api']);
  assert.equal(entries[0].hitCount, 3);
});
