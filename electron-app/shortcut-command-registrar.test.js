const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcutCommandRegistrar } = require('./shortcut-command-registrar');

test('createShortcutCommandRegistrar registers enabled editable accelerators and emits triggers', () => {
  const registered = new Map();
  const unregistered = [];
  const triggered = [];
  const commands = [
    {
      id: 'fixed',
      name: 'Fixed',
      enabled: true,
      shortcut: { accelerator: '', fixed: true },
    },
    {
      id: 'custom',
      name: 'Custom',
      enabled: true,
      shortcut: { accelerator: 'F9', fixed: false },
    },
    {
      id: 'disabled',
      name: 'Disabled',
      enabled: false,
      shortcut: { accelerator: 'F10', fixed: false },
    },
  ];
  const registrar = createShortcutCommandRegistrar({
    globalShortcut: {
      register(accelerator, callback) {
        registered.set(accelerator, callback);
        return true;
      },
      unregister(accelerator) {
        unregistered.push(accelerator);
      },
    },
    readShortcutCommands: () => commands,
    emitTriggered: (command) => triggered.push(command.id),
  });

  const status = registrar.registerAll();
  assert.equal(status.fixed.status, 'fixed');
  assert.equal(status.custom.status, 'registered');
  assert.equal(status.disabled.status, 'disabled');
  registered.get('F9')();
  assert.deepEqual(triggered, ['custom']);

  registrar.dispose();
  assert.deepEqual(unregistered, ['F9']);
});

test('createShortcutCommandRegistrar reports duplicate accelerator conflicts', () => {
  const registrar = createShortcutCommandRegistrar({
    globalShortcut: {
      register() {
        return true;
      },
      unregister() {},
    },
    readShortcutCommands: () => [
      { id: 'a', name: 'A', enabled: true, shortcut: { accelerator: 'Tab', fixed: false } },
      { id: 'b', name: 'B', enabled: true, shortcut: { accelerator: 'Tab', fixed: false } },
    ],
  });

  const status = registrar.registerAll();
  assert.equal(status.a.status, 'registered');
  assert.equal(status.b.status, 'conflict');
  assert.equal(status.b.detail, 'duplicate_accelerator');
});
