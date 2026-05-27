const COMMON_CHROMIUM_CLASS_NAMES = ['Chrome_WidgetWin_1', 'Chrome_WidgetWin_0'];

const COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS = [
  /登录/,
  /设置/,
  /图片查看/,
  /文件预览/,
  /Settings/i,
  /Preferences/i,
  /Login/i,
  /Sign in/i,
  /Welcome/i,
  /About/i,
  /Updater/i,
  /Installer/i,
  /Update/i,
];

const APP_COMPAT_RULES = [
  {
    appFamily: 'wechat',
    processNames: ['wechat', 'weixin'],
    requiredClassNames: ['MMUIRenderSubWindowHW'],
    blockedTitlePatterns: [/登录/, /设置/, /图片查看/, /文件预览/],
  },
  {
    appFamily: 'qq',
    processNames: ['qq', 'qqnt'],
    requiredClassNames: ['TXGuiFoundation', 'Chrome_WidgetWin_1'],
    blockedTitlePatterns: [/登录/, /设置/, /图片查看/, /文件预览/],
  },
  {
    appFamily: 'discord',
    processNames: ['discord'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'codex',
    processNames: ['codex'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'claude_code',
    processNames: ['claude code', 'claude-code', 'claude'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'chatgpt',
    processNames: ['chatgpt'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'vscode',
    processNames: ['code'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'cursor',
    processNames: ['cursor'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'slack',
    processNames: ['slack'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'notion',
    processNames: ['notion'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
  {
    appFamily: 'spotify',
    processNames: ['spotify'],
    requiredClassNames: COMMON_CHROMIUM_CLASS_NAMES,
    blockedTitlePatterns: COMMON_TEXT_APP_BLOCKED_TITLE_PATTERNS,
  },
];

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeClassNames(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

function findCompatRule(processName) {
  const normalizedProcessName = normalizeLower(processName).replace(/\.exe$/, '');
  return APP_COMPAT_RULES.find((rule) => rule.processNames.includes(normalizedProcessName)) || null;
}

function findMatchedClass(rule, classNames) {
  return rule.requiredClassNames.find((className) => classNames.includes(className)) || '';
}

function isBlockedTitle(rule, windowTitle) {
  return rule.blockedTitlePatterns.some((pattern) => pattern.test(String(windowTitle || '')));
}

function createAppCompatFailure(reason, raw = {}) {
  return {
    success: false,
    source: 'none',
    confidence: 'none',
    reason,
    app_family: '',
    foreground_hwnd: String(raw.foreground_hwnd || ''),
    matched_signals: [],
  };
}

function detectAppCompatTextTarget(raw = {}) {
  if (!raw || raw.success === false) return createAppCompatFailure(raw.reason || 'window_tree_unavailable', raw);

  const rule = findCompatRule(raw.process_name);
  if (!rule) return createAppCompatFailure('app_family_not_allowed', raw);

  const foregroundHwnd = String(raw.foreground_hwnd || '');
  const startForegroundHwnd = String(raw.start_foreground_hwnd || '');
  if (startForegroundHwnd && foregroundHwnd && startForegroundHwnd !== foregroundHwnd) {
    return createAppCompatFailure('foreground_changed', raw);
  }

  if (isBlockedTitle(rule, raw.window_title)) {
    return createAppCompatFailure('blocked_window_title', raw);
  }

  const classNames = normalizeClassNames(raw.class_names);
  const matchedClass = findMatchedClass(rule, classNames);
  if (!matchedClass) return createAppCompatFailure('app_compat_signal_missing', raw);

  return {
    success: true,
    source: 'app_compat',
    confidence: 'weak',
    reason: 'app_compat_match',
    app_family: rule.appFamily,
    foreground_hwnd: foregroundHwnd,
    matched_signals: [
      `process:${rule.appFamily}`,
      ...(startForegroundHwnd ? ['same_foreground_hwnd'] : []),
      `class:${matchedClass}`,
    ],
  };
}

module.exports = {
  APP_COMPAT_RULES,
  detectAppCompatTextTarget,
};
