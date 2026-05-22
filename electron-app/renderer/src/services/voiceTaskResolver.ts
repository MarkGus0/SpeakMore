import type { ShortcutIntent } from './shortcutGuard'
import {
  getFocusedSelectionSnapshot,
  type FocusedInfo,
  type FocusedSelectionSnapshot,
} from './focusedContext'
import type { VoiceMode } from './voiceTypes'

export type VoiceTaskDelivery = 'paste' | 'floating-panel'

// 语音任务是快捷键意图解析后的稳定协议，后续录音链路只消费这份结果。
export type VoiceTask = {
  mode: VoiceMode
  selectedText: string
  source: FocusedSelectionSnapshot['source']
  confidence: FocusedSelectionSnapshot['confidence']
  focusInfo: FocusedInfo | null
  delivery: VoiceTaskDelivery
}

type SelectionSnapshotReader = () => Promise<FocusedSelectionSnapshot>

// 听写和语音翻译不依赖选区，避免有选中文本时误改业务模式。
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
  // 保留结构但清空选区，避免不可信选区被自由提问当成上下文。
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
  // 翻译快捷键是显式语音翻译，不能因为当前有选区就变成选区翻译。
  if (intent === 'TranslateShortcut') {
    return createTask('Translate', NO_SELECTION_SNAPSHOT, 'paste')
  }

  // 普通听写始终优先自动粘贴，不读取 UIA 选区，避免选区状态影响听写语义。
  if (intent !== 'AskShortcut') {
    return createTask('Dictate', NO_SELECTION_SNAPSHOT, 'paste')
  }

  // 只有自由提问需要选区上下文，且必须是 UIA 明确确认的选区。
  const snapshot = await readSelectionSnapshot()
  const hasConfirmedSelection = snapshot.source === 'uia'
    && snapshot.confidence === 'confirmed'
    && Boolean(snapshot.selectedText)

  // 自由提问的结果永远展示在悬浮面板，不参与自动粘贴或替换。
  return createTask('Ask', hasConfirmedSelection ? snapshot : createNoSelectionSnapshot(snapshot), 'floating-panel')
}
