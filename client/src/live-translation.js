// Speaks the translation of the microphone in the user's own voice.
const MIC_SAMPLE_RATE = 16000;
// Head start before the first chunk, against network jitter.
const START_BUFFER_S = 0.12;
const CONNECT_TIMEOUT_MS = 10_000;

const liveSource = document.getElementById('live-source');
const liveTarget = document.getElementById('live-target');
const liveOutput = document.getElementById('live-output');
const liveStart = document.getElementById('live-start');
const liveStatus = document.getElementById('live-status');
const liveText = document.getElementById('live-text');

let live = null;
// The connection being opened, so Stop can cancel it.
let connecting = null;
let finals = [];
let draft = '';

fillLanguages(liveSource, 'ru');
fillLanguages(liveTarget, 'en');

liveStart.addEventListener('click', () => {
  if (connecting) cancelConnect();
  else if (live) stopLive();
  else startLive();
});

// The virtual microphone is an output device: whatever plays into it is
// what Zoom / Discord / Meet hear.
async function listOutputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const selected = liveOutput.value;
  liveOutput.replaceChildren(new Option('System default', ''));
  for (const device of devices) {
    if (device.kind !== 'audiooutput' || device.deviceId === 'default') continue;
    liveOutput.add(new Option(device.label || 'Output device', device.deviceId));
  }
  liveOutput.value = selected;
  if (liveOutput.selectedIndex < 0) liveOutput.value = '';
}

async function startLive() {
  const voice = await window.voice.load();
  if (!voice) {
    liveStatus.textContent = 'Record your voice on the Voice Clone page first.';
    return;
  }
  if (liveSource.value === liveTarget.value) {
    liveStatus.textContent = 'Choose two different languages.';
    return;
  }

  finals = [];
  draft = '';
  render();
  setControls('running');
  liveStatus.textContent = 'Connecting…';

  let pending;
  let socket;
  let stopMicrophone;
  try {
    pending = connect(await liveUrl());
    connecting = pending;
    try {
      socket = await pending.opened;
    } finally {
      connecting = null;
    }
    // The server keeps no voices: the sample goes first in every session.
    socket.send(JSON.stringify({ type: 'voice', ...voice }));
    const player = createPlayer(liveOutput.value);
    live = { socket, player, stopMicrophone: null };

    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') handleEvent(JSON.parse(data));
      else player.play(data);
    });
    socket.addEventListener('close', (event) => finishLive(socket, event));

    stopMicrophone = await startMicrophone(MIC_SAMPLE_RATE, (chunk) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
    });
    if (live?.socket !== socket) {
      stopMicrophone();
      return;
    }
    live.stopMicrophone = stopMicrophone;
    listOutputs();
  } catch (err) {
    if (live && live.socket === socket) {
      live.player.close();
      live = null;
    }
    socket?.close();
    liveStatus.textContent = pending?.cancelled
      ? 'Stopped.'
      : `Could not start: ${err.message}`;
    setControls('idle');
  }
}

function cancelConnect() {
  connecting.cancelled = true;
  connecting.socket.close();
}

// The server translates and speaks the rest, then closes the socket.
function stopLive() {
  live.stopMicrophone?.();
  live.stopMicrophone = null;
  setControls('finishing');
  liveStatus.textContent = 'Finishing the last phrase…';
  if (live.socket.readyState === WebSocket.OPEN) {
    live.socket.send(JSON.stringify({ type: 'endStream' }));
  } else {
    live.socket.close();
  }
}

function finishLive(socket, event) {
  if (live?.socket !== socket) return;
  live.stopMicrophone?.();
  // Already received speech still plays to the end.
  live.player.close();
  live = null;
  setControls('idle');
  liveStatus.textContent =
    event.code === 1000 ? 'Done.' : `Disconnected: ${event.reason || event.code}`;
}

function handleEvent(event) {
  switch (event.type) {
    case 'ready':
      liveStatus.textContent = 'Listening…';
      break;
    case 'audioFormat':
      live?.player.setSampleRate(event.sampleRate);
      break;
    case 'translationDraft':
      draft = event.text;
      render();
      break;
    case 'translationFinal':
      finals.push(event.text);
      draft = '';
      render();
      break;
    case 'error':
      liveStatus.textContent = `Error: ${event.message}`;
      break;
  }
}

function render() {
  liveText.textContent = [...finals, draft].filter(Boolean).join(' ');
  liveText.scrollTop = liveText.scrollHeight;
}

// Plays s16le mono chunks back to back in the order they arrive.
function createPlayer(sinkId) {
  const audioContext = new AudioContext();
  if (sinkId) audioContext.setSinkId(sinkId).catch(() => {});
  let sampleRate = 48000;
  let nextTime = 0;

  return {
    setSampleRate(rate) {
      sampleRate = rate;
    },
    play(data) {
      const pcm = new Int16Array(data);
      if (pcm.length === 0) return;
      const buffer = audioContext.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      const now = audioContext.currentTime;
      if (nextTime < now) nextTime = now + START_BUFFER_S;
      source.start(nextTime);
      nextTime += buffer.duration;
    },
    close() {
      const left = Math.max(0, nextTime - audioContext.currentTime);
      setTimeout(() => audioContext.close(), left * 1000 + 200);
    },
  };
}

// `opened` rejects when the socket closes before opening (an error or a
// cancel) or does not open in time.
function connect(url) {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const opened = new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer);
      reject(new Error(`cannot reach ${url}`));
    };
    const timer = setTimeout(() => {
      socket.close();
      fail();
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener('close', fail, { once: true });
  });
  return { socket, opened, cancelled: false };
}

// BACKEND_URL is http(s)://host[:port]; the socket uses ws(s) on the same host.
async function liveUrl() {
  const url = new URL('/translate-voice', await window.config.getBackendUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('source', liveSource.value);
  url.searchParams.set('target', liveTarget.value);
  return url.href;
}

function setControls(state) {
  liveStart.textContent = state === 'idle' ? 'Start' : 'Stop';
  liveStart.classList.toggle('running', state !== 'idle');
  liveStart.disabled = state === 'finishing';
  liveSource.disabled = liveTarget.disabled = liveOutput.disabled =
    state !== 'idle';
}

navigator.mediaDevices.addEventListener('devicechange', listOutputs);
listOutputs();
