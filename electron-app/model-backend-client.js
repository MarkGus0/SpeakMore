function createModelBackendClient({
  modelsUrl,
  fetchImpl,
  readJsonSafely,
  resolveVoiceServerProbeDetail,
}) {
  return async function callModelBackend(pathname = '', options = {}) {
    const url = `${modelsUrl}${pathname}`;
    try {
      const response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = await readJsonSafely(response);

      if (!response.ok) {
        return {
          success: false,
          code: response.status === 0 ? 'backend_unavailable' : 'model_request_failed',
          detail: payload?.detail || resolveVoiceServerProbeDetail(url, response.status, payload),
          data: payload,
        };
      }

      return { success: true, data: payload };
    } catch (error) {
      return {
        success: false,
        code: 'backend_unavailable',
        detail: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  };
}

module.exports = {
  createModelBackendClient,
};
