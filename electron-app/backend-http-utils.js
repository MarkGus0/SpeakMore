async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveVoiceServerProbeDetail(url, status, payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (typeof payload.status === 'string' && payload.status) return payload.status;
  }

  return status > 0 ? `${url} 返回 ${status}` : `无法连接 ${url}`;
}

async function probeVoiceServer(url, {
  fetchImpl = fetch,
  timeoutMs = 700,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const payload = await readJsonSafely(response);
    return {
      success: response.ok,
      status: response.status,
      detail: resolveVoiceServerProbeDetail(url, response.status, payload),
      payload,
    };
  } catch {
    return {
      success: false,
      status: 0,
      detail: `无法连接 ${url}`,
      payload: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  readJsonSafely,
  resolveVoiceServerProbeDetail,
  probeVoiceServer,
};
