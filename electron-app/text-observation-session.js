const { extractCorrectionCandidates } = require('./text-correction-learning');

function createTextObservationSessionManager({
  startNativeObservation,
  stopNativeObservation,
  learnCorrection,
  logger = null,
  now = () => new Date().toISOString(),
  timeoutMs = 120000,
}) {
  let activeSession = null;
  let timer = null;

  function log(level, message, details = {}) {
    logger?.[level]?.(`[auto-learning][session] ${message}`, details);
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function stop(reason = 'stopped') {
    clearTimer();
    const session = activeSession;
    activeSession = null;
    log('info', '停止观察会话', {
      reason,
      audioId: session?.audioId || null,
    });
    if (session) {
      await stopNativeObservation({ audioId: session.audioId, reason });
    }
  }

  async function start(session) {
    log('info', '收到开始观察请求', {
      audioId: session?.audioId || null,
      pastedText: session?.pastedText || '',
      focusInfo: session?.focusInfo || null,
    });
    await stop('replaced');
    if (!session?.audioId || !session?.pastedText) {
      log('warn', '观察会话参数无效', {
        audioId: session?.audioId || null,
        hasPastedText: Boolean(session?.pastedText),
      });
      return { success: false, code: 'invalid_observation_session' };
    }

    activeSession = {
      audioId: session.audioId,
      pastedText: session.pastedText,
      focusInfo: session.focusInfo || null,
      startedAt: now(),
    };
    log('info', '创建活动观察会话', activeSession);

    const result = await startNativeObservation({
      ...activeSession,
      timeoutMs,
    });
    log('info', '原生观察启动结果', {
      audioId: activeSession.audioId,
      result,
    });

    if (!result?.success) {
      activeSession = null;
      log('info', '原生观察启动失败，已静默结束观察会话', {
        audioId: session.audioId,
        result,
      });
      return result || { success: false, code: 'native_observation_failed' };
    }

    timer = setTimeout(() => {
      log('info', '观察会话超时，准备停止', {
        audioId: session.audioId,
        timeoutMs,
      });
      void stop('timeout');
    }, timeoutMs);

    return { success: true };
  }

  async function handleObservedText(payload) {
    log('info', '收到观察文本', {
      payload,
      activeAudioId: activeSession?.audioId || null,
    });
    if (!activeSession || payload?.audioId !== activeSession.audioId) {
      log('warn', '观察文本会话不匹配，已忽略', {
        payloadAudioId: payload?.audioId || null,
        activeAudioId: activeSession?.audioId || null,
      });
      return { success: false, code: 'observation_session_mismatch' };
    }

    const candidates = extractCorrectionCandidates(activeSession.pastedText, payload.text);
    log('info', '候选提取结果', {
      audioId: activeSession.audioId,
      pastedText: activeSession.pastedText,
      observedText: payload.text,
      candidates,
    });
    for (const candidate of candidates) {
      log('info', '开始学习候选', {
        audioId: activeSession.audioId,
        candidate,
      });
      await learnCorrection(candidate, activeSession);
      log('info', '学习候选完成', {
        audioId: activeSession.audioId,
        candidate,
      });
    }
    if (candidates.length > 0) {
      await stop('learned');
    }
    return { success: true, candidates };
  }

  return {
    start,
    stop,
    handleObservedText,
    getActiveSession: () => activeSession,
  };
}

module.exports = {
  createTextObservationSessionManager,
};
