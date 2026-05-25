const DEFAULT_VOICE_SERVER_URL = 'http://127.0.0.1:8000';

function createVoiceBackendUrls(voiceServerUrl = DEFAULT_VOICE_SERVER_URL) {
  return {
    healthUrl: `${voiceServerUrl}/health`,
    readyUrl: `${voiceServerUrl}/ready`,
    voiceFlowUrl: `${voiceServerUrl}/ai/voice_flow`,
    configReloadUrl: `${voiceServerUrl}/config/reload`,
  };
}

module.exports = {
  DEFAULT_VOICE_SERVER_URL,
  createVoiceBackendUrls,
};
