// Speaks the translation of the microphone in the user's own voice.
const MIC_SAMPLE_RATE = 16000;
// Head start before the first chunk, against network jitter.
const START_BUFFER_S = 0.12;
const CONNECT_TIMEOUT_MS = 10_000;

// Mixed under the translation when "Mix original microphone" is on.
const MIX_GAIN = 0.5;

const liveSource = document.getElementById('live-source');
const liveTarget = document.getElementById('live-target');
const liveSwap = document.getElementById('live-swap');
const liveStart = document.getElementById('live-start');
const liveDock = document.getElementById('live-dock');
const liveHint = document.getElementById('live-hint');
const unlock = document.getElementById('unlock');
const stepMic = document.getElementById('step-mic');
const stepVoice = document.getElementById('step-voice');

// The bars keep clear of the button whatever size it scales to.
const liveWave = createBars(document.getElementById('live-wave'), {
  gap: () => liveStart.offsetWidth + 60,
});

let live = null;
// The connection being opened, so Stop can cancel it.
let connecting = null;
let liveState = 'idle';
let listening = false;

fillLanguages(liveSource, 'ru');
fillLanguages(liveTarget, 'en');
createDropdown(liveSource);
createDropdown(liveTarget);

liveStart.addEventListener('click', () => {
  if (connecting) cancelConnect();
  else if (live) stopLive();
  else startLive();
});

liveSwap.addEventListener('click', () => {
  [liveSource.value, liveTarget.value] = [liveTarget.value, liveSource.value];
});

// Why Start cannot run right now, or null.
function blocker() {
  if (!appState.virtualMic) return 'translation.noMic';
  if (!appState.hasVoice) return 'translation.noVoice';
  if (!appState.online) return 'translation.offline';
  return null;
}

async function startLive() {
  if (blocker()) return;
  const voice = await window.voice.load();
  if (!voice) {
    updateAppState({ hasVoice: false });
    return;
  }
  if (liveSource.value === liveTarget.value) {
    toast(t('translation.sameLanguages'), 'error');
    return;
  }

  listening = false;
  setControls('connecting');

  let pending;
  let socket;
  let microphone;
  try {
    pending = connect(
      await socketUrl('/translate-voice', {
        source: liveSource.value,
        target: liveTarget.value,
      }),
    );
    connecting = pending;
    try {
      socket = await pending.opened;
    } finally {
      connecting = null;
    }
    // The server keeps no voices: the sample goes first in every session.
    socket.send(JSON.stringify({ type: 'voice', ...voice }));
    const player = createPlayer(appState.virtualMic?.deviceId, (level) =>
      liveWave.setOutputLevel(level),
    );
    live = { socket, player, stopMicrophone: null };
    setControls('running');

    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') handleEvent(JSON.parse(data));
      else player.play(data);
    });
    socket.addEventListener('close', (event) => finishLive(socket, event));

    microphone = await startMicrophone(MIC_SAMPLE_RATE, (chunk) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
      liveWave.setLevel(chunkLevel(chunk));
    });
    if (live?.socket !== socket) {
      microphone.stop();
      return;
    }
    live.stopMicrophone = microphone.stop;
    if (prefs.get('mixOriginal', false)) player.mix(microphone.stream);
  } catch (err) {
    if (live && live.socket === socket) {
      live.player.close();
      live = null;
    }
    socket?.close();
    if (!pending?.cancelled) {
      toast(t('translation.couldNotStart', { message: err.message }), 'error');
      refreshHealth();
    }
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
  if (event.code !== 1000) {
    toast(
      t('translation.disconnected', { reason: event.reason || event.code }),
      'error',
    );
    refreshHealth();
  }
}

function handleEvent(event) {
  switch (event.type) {
    case 'ready':
      listening = true;
      renderLive();
      break;
    case 'audioFormat':
      live?.player.setSampleRate(event.sampleRate);
      break;
    case 'error':
      toast(t('translation.error', { message: event.message }), 'error');
      break;
  }
}

const LABELS = {
  idle: 'translation.start',
  connecting: 'translation.connecting',
  running: 'translation.stop',
  finishing: 'translation.finishing',
};

function renderLive() {
  const reason = liveState === 'idle' ? blocker() : null;
  let status = '';
  if (reason) status = t(reason);
  else if (liveState === 'connecting' || liveState === 'finishing') {
    status = t(LABELS[liveState]);
  } else if (liveState === 'running') {
    status = t(listening ? 'translation.listening' : 'translation.connecting');
  }
  liveHint.textContent = status;
  liveHint.classList.toggle('warning', Boolean(reason));
  liveStart.disabled = liveState === 'finishing' || Boolean(reason);
  liveStart.setAttribute('aria-label', t(LABELS[liveState]));
  liveStart.title = t(LABELS[liveState]);
  renderUnlock();
}

// Steps unlock in order: the next one gets its button, later ones a lock.
function renderUnlock() {
  const done = [Boolean(appState.virtualMic), appState.hasVoice];
  const current = done.indexOf(false);
  unlock.hidden = current < 0 || liveState !== 'idle';
  [stepMic, stepVoice].forEach((step, index) => {
    step.dataset.state = done[index]
      ? 'done'
      : index === current
        ? 'current'
        : 'locked';
  });
}

// Plays s16le mono chunks back to back in the order they arrive and
// reports each chunk's level when it starts playing.
function createPlayer(sinkId, onLevel) {
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
      const level = chunkLevel(data);
      setTimeout(() => onLevel(level), (nextTime - now) * 1000);
      source.addEventListener('ended', () => {
        if (audioContext.currentTime >= nextTime - 0.05) onLevel(0);
      });
      nextTime += buffer.duration;
    },
    // The raw microphone plays into the same output.
    mix(stream) {
      const gain = audioContext.createGain();
      gain.gain.value = MIX_GAIN;
      audioContext.createMediaStreamSource(stream).connect(gain);
      gain.connect(audioContext.destination);
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

function setControls(state) {
  liveState = state;
  liveDock.dataset.state = state;
  if (state !== 'running') {
    liveWave.setLevel(0);
    liveWave.setOutputLevel(0);
  }
  liveSource.disabled = liveTarget.disabled = liveSwap.disabled =
    state !== 'idle';
  updateAppState({ recording: state === 'connecting' || state === 'running' });
}

document.addEventListener('appstatechange', renderLive);
document.addEventListener('uilanguagechange', () => {
  fillLanguages(liveSource, 'ru');
  fillLanguages(liveTarget, 'en');
  renderLive();
});
renderLive();
