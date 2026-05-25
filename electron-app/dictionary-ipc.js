function shouldEmitDictionaryChanged(result) {
  return !(result && typeof result === 'object' && result.success === false);
}

function emitAfterDictionaryChange(result, reason, emitDictionaryChanged) {
  if (shouldEmitDictionaryChanged(result)) {
    emitDictionaryChanged({ reason });
  }
  return result;
}

function registerDictionaryIpcHandlers({
  ipcMain,
  dictionaryRepository,
  emitDictionaryChanged = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!dictionaryRepository) {
    throw new Error('dictionaryRepository is required');
  }

  ipcMain.handle('dictionary:list', () => dictionaryRepository.readDictionaryEntries());
  ipcMain.handle('dictionary:create', (_, payload = {}) => emitAfterDictionaryChange(
    dictionaryRepository.createEntry(payload),
    'manual-create',
    emitDictionaryChanged,
  ));
  ipcMain.handle('dictionary:update', (_, payload = {}) => emitAfterDictionaryChange(
    dictionaryRepository.updateEntry(payload),
    'manual-update',
    emitDictionaryChanged,
  ));
  ipcMain.handle('dictionary:delete', (_, id) => emitAfterDictionaryChange(
    dictionaryRepository.deleteEntry(id),
    'manual-delete',
    emitDictionaryChanged,
  ));
  ipcMain.handle('dictionary:candidates-list', () => dictionaryRepository.readDictionaryCandidates());
  ipcMain.handle('dictionary:candidate-promote', (_, id) => emitAfterDictionaryChange(
    dictionaryRepository.promoteCandidate(id),
    'candidate-promote',
    emitDictionaryChanged,
  ));
  ipcMain.handle('dictionary:candidate-ignore', (_, id) => emitAfterDictionaryChange(
    dictionaryRepository.ignoreCandidate(id),
    'candidate-ignore',
    emitDictionaryChanged,
  ));
  ipcMain.handle('dictionary:prompt-terms', () => dictionaryRepository.readPromptDictionaryTerms());
}

module.exports = {
  registerDictionaryIpcHandlers,
};
