import type { ShortcutIntent } from './shortcutGuard'
import {
  getFocusedSelectionSnapshot,
  type FocusedInfo,
  type FocusedSelectionSnapshot,
} from './focusedContext'
import type { VoiceMode } from './voiceTypes'

export type VoiceTaskDelivery = 'paste' | 'floating-panel'

export type VoiceTask = {
  mode: VoiceMode
  selectedText: string
  source: FocusedSelectionSnapshot['source']
  confidence: FocusedSelectionSnapshot['confidence']
  focusInfo: FocusedInfo | null
  delivery: VoiceTaskDelivery
}

type SelectionSnapshotReader = () => Promise<FocusedSelectionSnapshot>

const NO_SELECTION_SNAPSHOT: FocusedSelectionSnapshot = {
  selectedText: '',
  source: 'none',
  confidence: 'none',
  focusInfo: null,
}

function createTask(
  mode: VoiceMode,
  snapshot: FocusedSelectionSnapshot,
  delivery: VoiceTaskDelivery,
): VoiceTask {
  return {
    mode,
    selectedText: snapshot.selectedText,
    source: snapshot.source,
    confidence: snapshot.confidence,
    focusInfo: snapshot.focusInfo,
    delivery,
  }
}

function createNoSelectionSnapshot(snapshot: FocusedSelectionSnapshot): FocusedSelectionSnapshot {
  return {
    ...snapshot,
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }
}

export async function resolveVoiceTask(
  intent: ShortcutIntent,
  readSelectionSnapshot: SelectionSnapshotReader = getFocusedSelectionSnapshot,
): Promise<VoiceTask> {
  if (intent === 'TranslateShortcut') {
    return createTask('Translate', NO_SELECTION_SNAPSHOT, 'paste')
  }

  if (intent !== 'AskShortcut') {
    return createTask('Dictate', NO_SELECTION_SNAPSHOT, 'paste')
  }

  const snapshot = await readSelectionSnapshot()
  const hasConfirmedSelection = snapshot.source === 'uia'
    && snapshot.confidence === 'confirmed'
    && Boolean(snapshot.selectedText)

  return createTask('Ask', hasConfirmedSelection ? snapshot : createNoSelectionSnapshot(snapshot), 'floating-panel')
}
