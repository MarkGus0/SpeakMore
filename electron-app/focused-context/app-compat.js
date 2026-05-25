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
    requiredClassNames: ['Chrome_WidgetWin_1'],
    blockedTitlePatterns: [/Settings/i, /Login/i, /Updater/i, /Installer/i],
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
