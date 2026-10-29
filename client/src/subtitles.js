const SAMPLE_RATE = 16000;
// Finished phrases kept on screen above the one in progress.
const MAX_LINES = 3;
const CONNECT_TIMEOUT_MS = 10_000;

const startButton = document.getElementById('subtitles-start');
const subtitlesText = document.getElementById('subtitles-text');
const sourceSelect = document.getElementById('subtitles-source');
const targetSelect = document.getElementById('subtitles-target');
const placeholder = document.getElementById('subtitles-placeholder');
const body = document.getElementById('subtitles-body');
const dot = document.getElementById('subtitles-dot');

document.documentElement.classList.add(`platform-${window.config.platform}`);
applyTranslations();

let capture = null;
let running = false;
let hasText = false;
// Whether the server translates; without it the window falls back to the
// recognised speech so it is not left empty.
let translated = true;
// A status key with its variables, so a language change re-renders it.
let status = { key: 'live.idle' };
const captions = createBlock(subtitlesText);

fillLanguages(sourceSelect, 'en');
fillLanguages(targetSelect, 'ru');
createDropdown(sourceSelect);
createDropdown(targetSelect);

startButton.addEventListener('click', () => {
  if (capture) stop();
  else start();
});

document.getElementById('subtitles-close').addEventListener('click', () =>
  window.windowControls.close(),
);

document.addEventListener('uilanguagechange', () => {
  fillLanguages(sourceSelect, 'en');
  fillLanguages(targetSelect, 'ru');
  showStatus(status.key, status.vars, status.error);
  setRunning(running);
});

async function start() {
  setRunning(true);
  captions.reset();
  hasText = false;
  translated = true;
  showStatus('live.connecting');
  startButton.disabled = true;

  try {
    capture = await startCapture();
  } catch (err) {
    setRunning(false);
    showStatus('live.couldNotStart', { message: err.message }, true);
  } finally {
    startButton.disabled = false;
  }
}

function stop() {
  const { stream, audioContext, socket } = capture;
  capture = null;
  setRunning(false);
  showStatus('live.idle');

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
    throw new Error(t('live.permission'));
  }

  let socket;
  try {
    socket = await connect(
      await socketUrl('/translate-subtitles', {
        source: sourceSelect.value,
        target: targetSelect.value,
      }),
    );
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
      if (event.code === 1000) showStatus('live.idle');
      else {
        showStatus(
          'live.disconnected',
          { reason: event.reason || event.code },
          true,
        );
      }
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

// Only the translation is shown; recognised speech is used only when the
// server does not translate.
function handleEvent(event) {
  switch (event.type) {
    case 'ready':
      translated = event.translated === true;
      showStatus('live.waiting');
      break;
    case 'transcript':
      // CUMULATIVE mode: every partial is the whole current hypothesis.
      if (!translated) captions.showPartial(event.transcript);
      break;
    case 'speechComplete':
      if (!translated) captions.addLine(event.transcript);
      break;
    case 'translationDraft':
      captions.showPartial(event.text);
      break;
    case 'translationFinal':
      captions.addLine(event.text);
      break;
    case 'error':
      showStatus('live.error', { message: event.message }, true);
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
    hasText = true;
    placeholder.hidden = true;
    element.textContent = text.join('\n');
    body.scrollTop = body.scrollHeight;
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

// Shown in place of the text until the first words arrive; errors also
// turn the dot red.
function showStatus(key, vars = {}, error = false) {
  status = { key, vars, error };
  placeholder.textContent = t(key, vars);
  placeholder.classList.toggle('error', error);
  placeholder.hidden = hasText && !error;
  dot.dataset.state = error ? 'error' : running ? 'active' : 'idle';
}

function setRunning(value) {
  running = value;
  startButton.textContent = t(running ? 'live.stop' : 'live.start');
  startButton.classList.toggle('danger', running);
  sourceSelect.disabled = targetSelect.disabled = running;
  if (dot.dataset.state !== 'error' || running) {
    dot.dataset.state = running ? 'active' : 'idle';
  }
}

showStatus(status.key);
setRunning(false);
