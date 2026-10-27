const SAMPLE_RATE = 16000;
// Finished phrases kept on screen above the one in progress.
const MAX_LINES = 3;

const startButton = document.getElementById('subtitles-start');
const subtitlesText = document.getElementById('subtitles-text');

let capture = null;
let lines = [];
let partial = '';

startButton.addEventListener('click', () => {
  if (capture) stop();
  else start();
});

async function start() {
  setRunning(true);
  lines = [];
  partial = '';
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
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error(`cannot reach ${url}`)),
      { once: true },
    );
  });
}

// BACKEND_URL is http(s)://host[:port]; the socket uses ws(s) on the same host.
async function subtitlesUrl() {
  const url = new URL('/translate-subtitles', await window.config.getBackendUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

// Meta events: https://dev.meta.ai/docs/speech-to-text
function handleEvent(event) {
  switch (event.type) {
    case 'ready':
      showStatus('Listening…');
      break;
    case 'transcript':
      // CUMULATIVE mode: every partial is the whole current hypothesis.
      partial = event.transcript;
      render();
      break;
    case 'speechComplete':
      partial = '';
      if (event.transcript) lines = [...lines, event.transcript].slice(-MAX_LINES);
      render();
      break;
    case 'error':
      showStatus(`Error: ${event.message}`);
      break;
  }
}

function render() {
  const text = [...lines, partial].filter(Boolean);
  if (text.length === 0) return;
  subtitlesText.classList.add('live');
  subtitlesText.textContent = text.join('\n');
  subtitlesText.scrollTop = subtitlesText.scrollHeight;
}

function showStatus(message) {
  subtitlesText.classList.remove('live');
  subtitlesText.textContent = message;
}

function setRunning(running) {
  startButton.textContent = running ? 'Stop' : 'Start';
  startButton.classList.toggle('running', running);
}
