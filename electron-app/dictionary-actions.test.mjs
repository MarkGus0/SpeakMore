import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDictionaryEntryResult,
  updateDictionaryEntryResult,
} from './dictionary-actions.js';

const existingEntry = {
  id: 'dict_existing',
  phrase: 'Client2API',
  aliases: ['client to api'],
  source: 'manual',
  status: 'active',
  hitCount: 1,
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  lastLearnedAt: '',
};

test('createDictionaryEntryResult 拒绝空正确写法', () => {
  const result = createDictionaryEntryResult([existingEntry], { phrase: '   ' }, '2026-05-18T00:01:00.000Z');

  assert.equal(result.success, false);
  assert.equal(result.code, 'dictionary_entry_invalid');
  assert.equal(result.data, null);
  assert.deepEqual(result.entries, [existingEntry]);
});

test('createDictionaryEntryResult 返回实际创建的词条', () => {
  const result = createDictionaryEntryResult([], {
    phrase: ' SpeakMore ',
    aliases: ['speak more'],
    source: 'manual',
    status: 'active',
  }, '2026-05-18T00:01:00.000Z');

  assert.equal(result.success, true);
  assert.equal(result.code, undefined);
  assert.equal(result.entries.length, 1);
  assert.equal(result.data.phrase, 'SpeakMore');
  assert.deepEqual(result.data.aliases, ['speak more']);
});

test('updateDictionaryEntryResult 拒绝把正确写法更新为空', () => {
  const result = updateDictionaryEntryResult([existingEntry], {
    id: 'dict_existing',
    phrase: '   ',
  }, '2026-05-18T00:02:00.000Z');

  assert.equal(result.success, false);
  assert.equal(result.code, 'dictionary_entry_invalid');
  assert.equal(result.data, null);
  assert.deepEqual(result.entries, [existingEntry]);
});

test('updateDictionaryEntryResult 找不到词条时返回 not found', () => {
  const result = updateDictionaryEntryResult([existingEntry], {
    id: 'dict_missing',
    status: 'disabled',
  }, '2026-05-18T00:02:00.000Z');

  assert.equal(result.success, false);
  assert.equal(result.code, 'dictionary_entry_not_found');
  assert.equal(result.data, null);
  assert.deepEqual(result.entries, [existingEntry]);
});

test('updateDictionaryEntryResult 正常更新词条状态', () => {
  const result = updateDictionaryEntryResult([existingEntry], {
    id: 'dict_existing',
    status: 'disabled',
  }, '2026-05-18T00:02:00.000Z');

  assert.equal(result.success, true);
  assert.equal(result.code, undefined);
  assert.equal(result.data.id, 'dict_existing');
  assert.equal(result.data.status, 'disabled');
  assert.equal(result.data.phrase, 'Client2API');
  assert.equal(result.entries[0].updatedAt, '2026-05-18T00:02:00.000Z');
});
