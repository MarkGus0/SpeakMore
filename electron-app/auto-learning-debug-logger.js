/**
 * 自动学习诊断日志
 *
 * 需要排查本轮粘贴后的文本观察、候选提取和词典写入链路时看这里。
 */
const path = require('path');

function normalizeLogValue(value, seen = new WeakSet()) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      stack: value.stack,
    };
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => normalizeLogValue(item, seen));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item !== 'function')
      .map(([key, item]) => [key, normalizeLogValue(item, seen)]),
  );
}

function stringifyDetails(details) {
  try {
    return JSON.stringify(normalizeLogValue(details));
  } catch (error) {
    return JSON.stringify({ stringifyError: error.message });
  }
}

function createAutoLearningDebugLogger({
  fs,
  logFilePath,
  consoleLogger = console,
  now = () => new Date().toISOString(),
} = {}) {
  function resolveLogFilePath() {
    return typeof logFilePath === 'function' ? logFilePath() : logFilePath;
  }

  function write(level, message, details = {}) {
    const payload = normalizeLogValue(details);
    const line = `[${now()}] [${level}] ${message} ${stringifyDetails(payload)}\n`;
    try {
      const filePath = resolveLogFilePath();
      if (fs && filePath) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, line, 'utf8');
      }
    } catch (error) {
      consoleLogger?.warn?.('[auto-learning] 写入诊断日志失败', error);
    }

    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    consoleLogger?.[method]?.(`[auto-learning] ${message}`, payload);
  }

  return {
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
  };
}

module.exports = {
  createAutoLearningDebugLogger,
};
