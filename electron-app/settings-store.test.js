const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LANGUAGE,
  DEFAULT_ASR_DEVICE_MODE,
  DEFAULT_LLM_PROVIDERS,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  normalizeLocalSettings,
  createSettingsStore,
} = require('./settings-store');
const sharedLlmProviders = require('../shared/llm-providers.json');

test('默认 LLM provider 元数据来自共享 JSON', () => {
  assert.strictEqual(DEFAULT_LLM_PROVIDERS, sharedLlmProviders);

  const openaiProvider = DEFAULT_LLM_PROVIDERS.find((provider) => provider.id === 'openai');
  assert.equal(openaiProvider.defaultModel, 'gpt-5.4');
});

test('normalizeLocalSettings 会回退不支持的翻译目标语言和空设备', () => {
  const settings = normalizeLocalSettings({
    translationTargetLanguage: 'xx',
    selectedAudioDeviceId: '',
    launchAtSystemStartup: 1,
    modelCacheDir: 123,
    asrDeviceMode: 'gpu',
  });

  assert.equal(settings.preferredLanguage, DEFAULT_LANGUAGE);
  assert.equal(settings.translationTargetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
  assert.equal(settings.selectedAudioDeviceId, 'default');
  assert.equal(settings.launchAtSystemStartup, true);
  assert.equal(settings.interactionSoundsEnabled, true);
  assert.equal(settings.muteBackgroundAudioDuringRecording, true);
  assert.equal(settings.showActiveMicrophoneHint, true);
  assert.equal(settings.remindOnNewAudioDevice, true);
  assert.equal(settings.showFloatingBar, true);
  assert.equal(settings.hideMainWindowOnClose, true);
  assert.equal(settings.modelCacheDir, '');
  assert.equal(settings.asrDeviceMode, DEFAULT_ASR_DEVICE_MODE);
});

test('normalizeLocalSettings 会保留音频和应用行为开关', () => {
  const settings = normalizeLocalSettings({
    interactionSoundsEnabled: false,
    muteBackgroundAudioDuringRecording: false,
    showActiveMicrophoneHint: false,
    remindOnNewAudioDevice: false,
    showFloatingBar: false,
    hideMainWindowOnClose: false,
  });

  assert.equal(settings.interactionSoundsEnabled, false);
  assert.equal(settings.muteBackgroundAudioDuringRecording, false);
  assert.equal(settings.showActiveMicrophoneHint, false);
  assert.equal(settings.remindOnNewAudioDevice, false);
  assert.equal(settings.showFloatingBar, false);
  assert.equal(settings.hideMainWindowOnClose, false);
});

test('normalizeLocalSettings 会保留用户选择的模型缓存目录', () => {
  const settings = normalizeLocalSettings({
    modelCacheDir: '  D:\\Models\\SenseVoice  ',
  });

  assert.equal(settings.modelCacheDir, 'D:\\Models\\SenseVoice');
});

test('normalizeLocalSettings 会保留合法的 ASR 运行设备模式', () => {
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'mps' }).asrDeviceMode, 'mps');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'cuda' }).asrDeviceMode, 'cuda');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'cpu' }).asrDeviceMode, 'cpu');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'auto' }).asrDeviceMode, DEFAULT_ASR_DEVICE_MODE);
});

test('normalizeLocalSettings 会保留英文界面语言并回退未知界面语言', () => {
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'en-US' }).preferredLanguage,
    'en-US',
  );
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'xx' }).preferredLanguage,
    DEFAULT_LANGUAGE,
  );
});

test('normalizeLocalSettings 会保留合法的 LLM 配置', () => {
  const settings = normalizeLocalSettings({
    llm: {
      providerId: 'custom',
      providers: [
        {
          id: 'custom',
          label: '  Custom API  ',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'gpt-4.1',
          allowBaseUrlEdit: true,
          authType: 'bearer',
        },
      ],
      apiKeys: { custom: 'abc123' },
      models: { custom: '  model-x  ' },
    },
  });

  const customProvider = settings.llm.providers.find((provider) => provider.id === 'custom');
  assert.equal(settings.llm.providerId, 'custom');
  assert.equal(customProvider.label, 'Custom API');
  assert.equal(customProvider.baseUrl, 'http://localhost:11434/v1');
  assert.equal(settings.llm.apiKeys.custom, 'abc123');
  assert.equal(settings.llm.models.custom, 'model-x');
});

test('createSettingsStore 读取和写入时都会同步 legacy store', () => {
  let written = null;
  let synced = null;
  const store = createSettingsStore({
    readJsonFile: () => ({
      translationTargetLanguage: 'ja',
      selectedAudioDeviceId: 'mic-1',
      modelCacheDir: 'D:\\Models\\FunASR',
      asrDeviceMode: 'mps',
      launchAtSystemStartup: true,
      muteBackgroundAudioDuringRecording: false,
      showFloatingBar: false,
      llm: {
        providerId: 'openai',
        providers: [],
        apiKeys: { openai: 'sk-test' },
        models: { openai: 'gpt-5.4' },
      },
    }),
    writeJsonFile: (_, value) => {
      written = value;
      return value;
    },
    syncSettings: (value) => {
      synced = value;
    },
  });

  const settings = store.readLocalSettings();
  assert.equal(settings.translationTargetLanguage, 'ja');
  assert.equal(synced.selectedAudioDeviceId, 'mic-1');
  assert.equal(settings.modelCacheDir, 'D:\\Models\\FunASR');
  assert.equal(settings.asrDeviceMode, 'mps');
  assert.equal(settings.muteBackgroundAudioDuringRecording, false);
  assert.equal(synced.showFloatingBar, false);

  const next = store.writeLocalSettings({
    translationTargetLanguage: 'en',
    selectedAudioDeviceId: 'default',
    modelCacheDir: 'E:\\SpeakMoreModels',
    asrDeviceMode: 'cpu',
    launchAtSystemStartup: false,
    interactionSoundsEnabled: false,
    muteBackgroundAudioDuringRecording: true,
    showActiveMicrophoneHint: false,
    remindOnNewAudioDevice: false,
    showFloatingBar: true,
    hideMainWindowOnClose: false,
    llm: settings.llm,
  });

  assert.equal(written.translationTargetLanguage, 'en');
  assert.equal(written.modelCacheDir, 'E:\\SpeakMoreModels');
  assert.equal(written.asrDeviceMode, 'cpu');
  assert.equal(written.interactionSoundsEnabled, false);
  assert.equal(written.hideMainWindowOnClose, false);
  assert.equal(next.translationTargetLanguage, 'en');
  assert.equal(synced.translationTargetLanguage, 'en');
  assert.equal(synced.muteBackgroundAudioDuringRecording, true);
});

test('buildCurrentLlmRequestConfig 会按当前 provider 生成请求配置', () => {
  const store = createSettingsStore({
    readJsonFile: () => ({
      translationTargetLanguage: 'en',
      selectedAudioDeviceId: 'default',
      llm: {
        providerId: 'anthropic',
        providers: [],
        apiKeys: { anthropic: 'sk-anthropic' },
        models: { anthropic: 'claude-sonnet-4-5' },
      },
    }),
    writeJsonFile: () => undefined,
    syncSettings: () => undefined,
  });

  assert.deepEqual(store.buildCurrentLlmRequestConfig(), {
    provider_id: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    api_key: 'sk-anthropic',
    model: 'claude-sonnet-4-5',
    auth_type: 'anthropic',
  });
});
