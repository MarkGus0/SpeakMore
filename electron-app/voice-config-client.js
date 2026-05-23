function createVoiceConfigClient({
  configReloadUrl,
  fetchImpl,
  readJsonSafely,
  resolveVoiceServerProbeDetail,
}) {
  return async function reloadVoiceServerConfig() {
    try {
      const response = await fetchImpl(configReloadUrl, { method: 'POST' });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        return {
          success: false,
          code: 'config_reload_failed',
          detail: payload?.detail || resolveVoiceServerProbeDetail(configReloadUrl, response.status, payload),
          data: payload,
        };
      }
      return { success: true, detail: payload?.detail || '大模型配置已重载', data: payload };
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
  createVoiceConfigClient,
};
