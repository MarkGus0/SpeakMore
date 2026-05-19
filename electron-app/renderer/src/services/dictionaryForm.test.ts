import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitDictionaryAliases } from './dictionaryForm'

test('splitDictionaryAliases 支持中英文分隔符并去重', () => {
  assert.deepEqual(
    splitDictionaryAliases('client to api，client 2 api、Client To API; speak more；SpeakMore\nspeak more'),
    ['client to api', 'client 2 api', 'speak more', 'SpeakMore'],
  )
})
