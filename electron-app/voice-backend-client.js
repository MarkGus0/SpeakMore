const {
  DEFAULT_VOICE_SERVER_URL,
  createVoiceBackendUrls,
} = require('./voice-backend-urls');
const {
  readJsonSafely,
  resolveVoiceServerProbeDetail,
  probeVoiceServer,
} = require('./backend-http-utils');
const {
  normalizeVoiceMode,
  bufferFromVoicePayload,
  appendJsonFormField,
  parseJsonObject,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
} = require('./voice-flow-form-data');
const { createVoiceConfigClient } = require('./voice-config-client');

function createVoiceBackendClient({
  voiceServerUrl = DEFAULT_VOICE_SERVER_URL,
  fetchImpl = fetch,
  checkReadyFetchImpl = fetchImpl,
  buildCurrentLlmRequestConfig = () => ({}),
  normalizeLlmRequestConfig = (value) => value || null,
} = {}) {
  const urls = createVoiceBackendUrls(voiceServerUrl);
  const formOptions = { buildCurrentLlmRequestConfig, normalizeLlmRequestConfig };
  const reloadVoiceServerConfig = createVoiceConfigClient({
    configReloadUrl: urls.configReloadUrl,
    fetchImpl,
    readJsonSafely,
    resolveVoiceServerProbeDetail,
  });

  async function checkVoiceServerReady() {
    return probeVoiceServer(urls.readyUrl, { fetchImpl: checkReadyFetchImpl });
  }

  async function getVoiceModelStatus() {
    const response = await fetchImpl(urls.modelStatusUrl);
    const payload = await readJsonSafely(response);
    if (!response.ok || !payload || typeof payload !== 'object') {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(urls.modelStatusUrl, response.status, payload),
        payload,
      };
    }
    return {
      success: true,
      ...payload,
      payload,
    };
  }

  async function startVoiceModelDownload() {
    const response = await fetchImpl(urls.modelDownloadUrl, { method: 'POST' });
    const payload = await readJsonSafely(response);
    if (!response.ok || !payload || typeof payload !== 'object') {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(urls.modelDownloadUrl, response.status, payload),
        payload,
      };
    }
    return {
      success: true,
      ...payload,
      payload,
    };
  }

  async function callVoiceFlowBackend(payload = {}) {
    const readyState = await checkVoiceServerReady();
    if (!readyState.success) {
      return {
        success: false,
        aborted: false,
        debug: readyState.payload,
        detail: readyState.detail,
        code: 'backend_not_ready',
        paywall: null,
        error: readyState.detail,
      };
    }

    const response = await fetchImpl(urls.voiceFlowUrl, {
      method: 'POST',
      body: buildVoiceFlowFormData(payload, formOptions),
    });
    const result = await readJsonSafely(response);

    if (!response.ok || !result || typeof result !== 'object' || result?.status === 'ERROR') {
      const detail = result?.data?.detail || result?.data?.refine_text || resolveVoiceServerProbeDetail(urls.voiceFlowUrl, response.status, result);
      return {
        success: false,
        aborted: false,
        debug: result,
        detail,
        code: result?.data?.code || 'voice_flow_failed',
        paywall: result?.data?.important_notification || null,
        web_metadata: result?.data?.web_metadata ?? null,
        external_action: result?.data?.external_action ?? null,
        error: result?.data?.refine_text || detail,
      };
    }

    const resultData = result.data || {};

    return {
      success: true,
      aborted: false,
      debug: result,
      data: resultData,
      detail: '',
      code: '',
      paywall: null,
      web_metadata: resultData.web_metadata ?? null,
      external_action: resultData.external_action ?? null,
      ...resultData,
    };
  }

  return {
    urls,
    checkVoiceServerReady,
    getVoiceModelStatus,
    startVoiceModelDownload,
    reloadVoiceServerConfig,
    callVoiceFlowBackend,
  };
}

module.exports = {
  DEFAULT_VOICE_SERVER_URL,
  createVoiceBackendUrls,
  createVoiceBackendClient,
  readJsonSafely,
  resolveVoiceServerProbeDetail,
  probeVoiceServer,
  normalizeVoiceMode,
  bufferFromVoicePayload,
  appendJsonFormField,
  parseJsonObject,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
};
