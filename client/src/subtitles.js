const SAMPLE_RATE = 16000;
// Finished phrases kept on screen above the one in progress.
const MAX_LINES = 3;
const CONNECT_TIMEOUT_MS = 10_000;

const startButton = document.getElementById('subtitles-start');
const subtitlesText = document.getElementById('subtitles-text');
const translationText = document.getElementById('subtitles-translation');
const sourceSelect = document.getElementById('subtitles-source');
const targetSelect = document.getElementById('subtitles-target');

let capture = null;
const original = createBlock(subtitlesText);
const translation = createBlock(translationText);

fillLanguages(sourceSelect, 'en');
fillLanguages(targetSelect, 'ru');

startButton.addEventListener('click', () => {
  if (capture) stop();
  else start();
});

async function start() {
  setRunning(true);
  original.reset();
  translation.reset();
  // Shown once the server confirms it translates (TRANSLATE_URL is set).
  translationText.hidden = true;
  showStatus('Connecting…');
  startButton.disabled = true;

  try {
    capture = await startCapture();
  } catch (err) {
    setRunning(false);
    showStatus(`Could not start: ${err.message}`);
  } finally {
    startButton.disabled = false;
  }
}

function stop() {
  const { stream, audioContext, socket } = capture;
  capture = null;
  setRunning(false);

  stream.getTracks().forEach((track) => track.stop());
  audioContext.close();
  // The server flushes the last phrase, then closes the socket.
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'endStream' }));
  } else {
    socket.close();
  }
}

async function startCapture() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  // Only the audio is needed; the video track exists because Chromium requires it.
  stream.getVideoTracks().forEach((track) => track.stop());
  const [audioTrack] = stream.getAudioTracks();
  if (!audioTrack || audioTrack.readyState === 'ended') {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('allow "System Audio Recording" in macOS settings');
  }

  let socket;
  try {
    socket = await connect(await subtitlesUrl());
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    throw err;
  }
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') handleEvent(JSON.parse(event.data));
  });
  socket.addEventListener('close', (event) => {
    if (capture?.socket === socket) {
      stop();
      showStatus(`Disconnected: ${event.reason || event.code}`);
    }
  });

  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioContext.audioWorklet.addModule('pcm-worklet.js');
  const worklet = new AudioWorkletNode(audioContext, 'pcm-worklet', {
    numberOfOutputs: 0,
  });
  worklet.port.onmessage = ({ data }) => {
    // The server buffers audio until Meta is ready, so send right away.
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  };
  audioContext.createMediaStreamSource(stream).connect(worklet);

  // The close handler ignores sockets that closed before capture was set.
  if (socket.readyState !== WebSocket.OPEN) {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
    throw new Error('server closed the connection');
  }
  return { stream, audioContext, socket };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const fail = () => {
      clearTimeout(timer);
      reject(new Error(`cannot reach ${url}`));
    };
    // A host that never answers would leave the socket connecting forever.
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
}

// BACKEND_URL is http(s)://host[:port]; the socket uses ws(s) on the same host.
async function subtitlesUrl() {
  const url = new URL('/translate-subtitles', await window.config.getBackendUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('source', sourceSelect.value);
  url.searchParams.set('target', targetSelect.value);
  return url.href;
}

// Meta events (https://dev.meta.ai/docs/speech-to-text) fill the original
// block, translation events the translation block under it.
function handleEvent(event) {
  switch (event.type) {
    case 'ready':
      translationText.hidden = event.translated !== true;
      showStatus('Listening…');
      break;
    case 'transcript':
      // CUMULATIVE mode: every partial is the whole current hypothesis.
      original.showPartial(event.transcript);
      break;
    case 'speechComplete':
      original.addLine(event.transcript);
      break;
    case 'translationDraft':
      translation.showPartial(event.text);
      break;
    case 'translationFinal':
      translation.addLine(event.text);
      break;
    case 'error':
      showStatus(`Error: ${event.message}`);
      break;
  }
}

// Finished lines plus the one in progress, rendered into one element.
function createBlock(element) {
  let lines = [];
  let partial = '';

  function render() {
    const text = [...lines, partial].filter(Boolean);
    if (text.length === 0) return;
    element.classList.add('live');
    element.textContent = text.join('\n');
    element.scrollTop = element.scrollHeight;
  }

  return {
    reset() {
      lines = [];
      partial = '';
      element.textContent = '';
    },
    showPartial(text) {
      partial = text;
      render();
    },
    addLine(text) {
      partial = '';
      if (text) lines = [...lines, text].slice(-MAX_LINES);
      render();
    },
  };
}

function showStatus(message) {
  subtitlesText.classList.remove('live');
  subtitlesText.textContent = message;
}

function setRunning(running) {
  startButton.textContent = running ? 'Stop' : 'Start';
  startButton.classList.toggle('running', running);
  sourceSelect.disabled = targetSelect.disabled = running;
}
