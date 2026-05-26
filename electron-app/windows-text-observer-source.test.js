const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('WindowsTextObserver 支持 TextPattern 不可用时的 ValuePattern 观察', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'windows-text-observer', 'TextObserver.cs'),
    'utf8',
  );

  assert.match(source, /ValuePattern\.Pattern/);
  assert.match(source, /ValuePattern\.ValueProperty/);
  assert.match(source, /GetCurrentPattern\(ValuePattern\.Pattern\)/);
});
