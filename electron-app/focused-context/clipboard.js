const { createSendKeysShortcut, wait } = require('./powershell');

const DEFAULT_SELECTION_MARKER = `__TYPELESS_SELECTION_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
const COPY_WAIT_MS = 80;

// Electron 的 NativeImage 可能存在对象但内容为空，需要避免把空图片误当作可恢复数据。
function isNonEmptyClipboardImage(image) {
  if (!image) return false;
  return typeof image.isEmpty === 'function' ? !image.isEmpty() : true;
}

// 复制选区会临时占用系统剪贴板，所以读取前必须尽量保留用户原有内容。
function createClipboardSnapshot(clipboard) {
  const data = {};

  const text = clipboard.readText();
  if (text) data.text = text;

  if (typeof clipboard.readHTML === 'function') {
    const html = clipboard.readHTML();
    if (html) data.html = html;
  }

  if (typeof clipboard.readRTF === 'function') {
    const rtf = clipboard.readRTF();
    if (rtf) data.rtf = rtf;
  }

  if (typeof clipboard.readImage === 'function') {
    const image = clipboard.readImage();
    if (isNonEmptyClipboardImage(image)) data.image = image;
  }

  return data;
}

// 有完整 write 能力时恢复全部格式；旧兼容环境只能退回到纯文本恢复。
function restoreClipboardSnapshot(clipboard, snapshot) {
  if (typeof clipboard.write === 'function') {
    clipboard.write(snapshot);
    return;
  }

  clipboard.writeText(snapshot.text || '');
}

// 剪贴板读取只是 UIA 不可用时的旧兼容兜底，必须保证失败时可解释、结束时尽量还原现场。
async function readSelectedTextByClipboard({
  clipboard,
  sendCopyShortcut = createSendKeysShortcut('^c'),
  wait: waitForClipboard = wait,
  marker = DEFAULT_SELECTION_MARKER,
  copyWaitMs = COPY_WAIT_MS,
} = {}) {
  if (!clipboard || typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    return { success: false, text: '', source: 'clipboard', reason: 'clipboard_unavailable' };
  }

  const previousClipboard = createClipboardSnapshot(clipboard);
  let restoreFailed = false;

  try {
    // marker 用来区分“没有选区”和“复制后得到的文本刚好为空”，避免把旧剪贴板内容误判为选区。
    clipboard.writeText(marker);
    await sendCopyShortcut();
    await waitForClipboard(copyWaitMs);

    const copiedText = clipboard.readText();
    const text = copiedText === marker ? '' : String(copiedText || '').trim();

    if (!text) {
      return { success: false, text: '', source: 'clipboard', reason: 'empty' };
    }

    return { success: true, text, source: 'clipboard' };
  } catch (error) {
    return {
      success: false,
      text: '',
      source: 'clipboard',
      reason: 'copy_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      restoreClipboardSnapshot(clipboard, previousClipboard);
    } catch {
      restoreFailed = true;
    }

    if (restoreFailed) {
      console.warn('恢复剪贴板文本失败');
    }
  }
}

module.exports = {
  COPY_WAIT_MS,
  DEFAULT_SELECTION_MARKER,
  createClipboardSnapshot,
  isNonEmptyClipboardImage,
  readSelectedTextByClipboard,
  restoreClipboardSnapshot,
};
