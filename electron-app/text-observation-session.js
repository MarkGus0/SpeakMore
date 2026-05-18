const { extractCorrectionCandidates } = require('./text-correction-learning');

function createTextObservationSessionManager({
  startNativeObservation,
  stopNativeObservation,
  learnCorrection,
  now = () => new Date().toISOString(),
  timeoutMs = 120000,
}) {
  let activeSession = null;
  let timer = null;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function stop(reason = 'stopped') {
    clearTimer();
    const session = activeSession;
    activeSession = null;
    if (session) {
      await stopNativeObservation({ audioId: session.audioId, reason });
    }
  }

  async function start(session) {
    await stop('replaced');
    if (!session?.audioId || !session?.pastedText) {
      return { success: false, code: 'invalid_observation_session' };
    }

    activeSession = {
      audioId: session.audioId,
      pastedText: session.pastedText,
      focusInfo: session.focusInfo || null,
      startedAt: now(),
    };

    const result = await startNativeObservation({
      ...activeSession,
      timeoutMs,
    });

    if (!result?.success) {
      activeSession = null;
      return result || { success: false, code: 'native_observation_failed' };
    }

    timer = setTimeout(() => {
      void stop('timeout');
    }, timeoutMs);

    return { success: true };
  }

  async function handleObservedText(payload) {
    if (!activeSession || payload?.audioId !== activeSession.audioId) {
      return { success: false, code: 'observation_session_mismatch' };
    }

    const candidates = extractCorrectionCandidates(activeSession.pastedText, payload.text);
    for (const candidate of candidates) {
      await learnCorrection(candidate, activeSession);
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
