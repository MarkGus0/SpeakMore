function createKeyboardEventFactory(now) {
  const stamp = () => now();

  return {
    rightAltDown: () => ({
      keyCode: 165,
      keyName: 'RightAlt',
      enKeyName: 'RightAlt',
      isKeydown: true,
      isBlocked: false,
      timestamp: stamp(),
    }),
    rightAltUp: () => ({
      keyCode: 165,
      keyName: 'RightAlt',
      enKeyName: 'RightAlt',
      isKeydown: false,
      isBlocked: false,
      timestamp: stamp(),
    }),
    rightShift: (isKeydown) => ({
      keyCode: 161,
      keyName: 'RightShift',
      enKeyName: 'RightShift',
      isKeydown,
      isBlocked: false,
      timestamp: stamp(),
    }),
    space: (isKeydown) => ({
      keyCode: 32,
      keyName: 'Space',
      enKeyName: 'Space',
      isKeydown,
      isBlocked: false,
      timestamp: stamp(),
    }),
    rightCommand: (isKeydown) => ({
      keyCode: 54,
      keyName: 'RightCommand',
      enKeyName: 'RightCommand',
      isKeydown,
      isBlocked: false,
      timestamp: stamp(),
    }),
  };
}

function normalizeDebugKeys(keys) {
  return keys.map((key) => ({
    keyName: key.keyName,
    isKeydown: key.isKeydown,
  }));
}

function createRightAltRelay({ emitKeyboardState, setTimer, clearTimer, now = Date.now, debugLog = null }) {
  const keyboardStateByName = new Map();
  const events = createKeyboardEventFactory(now);
  let clearStateTimer = null;
  let restoreStateTimer = null;

  function emit(keys) {
    if (typeof debugLog === 'function') {
      debugLog('right-alt-relay:emit', { keys: normalizeDebugKeys(keys) });
    }
    emitKeyboardState(keys);
  }

  function scheduleClearToEmpty() {
    if (clearStateTimer !== null) clearTimer(clearStateTimer);
    clearStateTimer = setTimer(() => {
      emit([]);
      clearStateTimer = null;
    }, 40);
  }

  function scheduleRestoreActiveState() {
    if (restoreStateTimer !== null) clearTimer(restoreStateTimer);
    restoreStateTimer = setTimer(() => {
      emit(Array.from(keyboardStateByName.values()));
      restoreStateTimer = null;
    }, 40);
  }

  function clearPendingEmptyEmission() {
    if (clearStateTimer === null) return;
    clearTimer(clearStateTimer);
    clearStateTimer = null;
  }

  function clearPendingRestoreEmission() {
    if (restoreStateTimer === null) return;
    clearTimer(restoreStateTimer);
    restoreStateTimer = null;
  }

  function eventForReleasedPayload(payload) {
    if (payload.key === 'RightShift') return events.rightShift(false);
    if (payload.key === 'Space') return events.space(false);
    return events.rightCommand(false);
  }

  function handlePayload(payload) {
    if (!payload || (payload.key !== 'RightAlt' && payload.key !== 'RightShift' && payload.key !== 'Space' && payload.key !== 'RightCommand')) return;

    if (payload.isKeydown) {
      if (payload.key !== 'RightAlt' && !keyboardStateByName.has('RightAlt')) return;

      clearPendingEmptyEmission();
      clearPendingRestoreEmission();

      if (payload.key === 'RightAlt') keyboardStateByName.set('RightAlt', events.rightAltDown());
      if (payload.key === 'RightShift') keyboardStateByName.set('RightShift', events.rightShift(true));
      if (payload.key === 'Space') keyboardStateByName.set('Space', events.space(true));
      if (payload.key === 'RightCommand') keyboardStateByName.set('RightCommand', events.rightCommand(true));

      emit(Array.from(keyboardStateByName.values()));
      return;
    }

    if (payload.key === 'RightAlt') {
      clearPendingEmptyEmission();
      clearPendingRestoreEmission();
      keyboardStateByName.clear();
      emit([events.rightAltUp(), events.rightShift(false), events.space(false), events.rightCommand(false)]);
      scheduleClearToEmpty();
      return;
    }

    if (!keyboardStateByName.has(payload.key)) return;

    clearPendingEmptyEmission();
    clearPendingRestoreEmission();
    keyboardStateByName.delete(payload.key);
    emit([eventForReleasedPayload(payload)]);
    scheduleRestoreActiveState();
  }

  function dispose() {
    clearPendingEmptyEmission();
    clearPendingRestoreEmission();
  }

  return {
    handlePayload,
    dispose,
  };
}

module.exports = {
  createRightAltRelay,
};
