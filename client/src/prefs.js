// Preferences shared by every window. localStorage of the file:// origin is
// common to all windows, so a change in one reaches the others through the
// `storage` event.
const prefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: the choice lasts until the window closes.
    }
  },
};

// A server address typed on the connection screen wins over BACKEND_URL.
async function backendUrl() {
  return prefs.get('backendUrl') || (await window.config.getBackendUrl());
}

// BACKEND_URL is http(s)://host[:port]; sockets use ws(s) on the same host.
async function socketUrl(pathname, params) {
  const url = new URL(pathname, await backendUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.href;
}

// Virtual audio drivers expose an output device whatever plays into it
// becomes the input of a matching microphone.
const VIRTUAL_DEVICE = /blackhole|vb-?audio|cable input|voicemeeter|loopback|soundflower|virtual/i;

async function listVirtualOutputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) =>
      device.kind === 'audiooutput' &&
      device.deviceId !== 'default' &&
      VIRTUAL_DEVICE.test(device.label),
  );
}

// The added virtual microphone, matched by id and then by name because
// ids can change between launches. null when not added or not connected.
async function findVirtualOutput() {
  const added = prefs.get('virtualMic');
  if (!added) return null;
  const outputs = await listVirtualOutputs();
  return (
    outputs.find((device) => device.deviceId === added.deviceId) ??
    outputs.find((device) => device.label === added.label) ??
    null
  );
}
