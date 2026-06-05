const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ABSTRACT_MODE_PROMPT,
  INTERNET_DARK_PROMPT,
  mergeShortcutCommands,
  upsertShortcutCommand,
} = require('./shortcut-command-store');

test('mergeShortcutCommands keeps built-in defaults and persisted enabled state', () => {
  const commands = mergeShortcutCommands([
    {
      id: 'voice_input',
      name: 'Changed name',
      prompt: 'ignored prompt',
      enabled: false,
    },
  ]);
  const voiceInput = commands.find((command) => command.id === 'voice_input');

  assert.equal(voiceInput.name, 'Voice Input');
  assert.equal(voiceInput.prompt, '');
  assert.equal(voiceInput.enabled, false);
});

test('upsertShortcutCommand allows built-in shortcut edits without prompt edits', () => {
  const commands = upsertShortcutCommand([], {
    id: 'hands_free_mode',
    name: 'Ignored',
    prompt: 'ignored',
    enabled: true,
    shortcut: { accelerator: 'F8', keys: ['F8'], display: 'F8' },
  });
  const handsFree = commands.find((command) => command.id === 'hands_free_mode');

  assert.equal(handsFree.name, 'Hands-Free Mode');
  assert.equal(handsFree.prompt, '');
  assert.equal(handsFree.enabled, true);
  assert.equal(handsFree.shortcut.accelerator, 'F8');
});

test('upsertShortcutCommand creates editable custom commands', () => {
  const commands = upsertShortcutCommand([], {
    name: 'My command',
    description: 'Run my voice command',
    prompt: 'Rewrite this.',
    shortcut: { accelerator: 'Ctrl+Shift+Y', keys: ['Ctrl', 'Shift', 'Y'], display: 'Ctrl + Shift + Y' },
  });
  const custom = commands[0];

  assert.match(custom.id, /^command_/);
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.category, 'custom');
  assert.equal(custom.editable, true);
  assert.equal(custom.deletable, true);
  assert.equal(custom.prompt, 'Rewrite this.');
});

test('default rewriting prompts preserve requested style markers', () => {
  assert.match(ABSTRACT_MODE_PROMPT, /🥵✨👠🥺👊/u);
  assert.match(ABSTRACT_MODE_PROMPT, /enough—add/);
  assert.match(INTERNET_DARK_PROMPT, /value—make/);
});
