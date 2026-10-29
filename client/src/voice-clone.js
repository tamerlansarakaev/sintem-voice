// Records the voice sample the server clones. It is kept on this computer
// only and sent with every live translation session.
const VOICE_SAMPLE_RATE = 44100;
const MIN_SECONDS = 3;
const MAX_SECONDS = 10;
// The exact text goes to the synthesizer with the sample.
const VOICE_PROMPTS = {
  en: [
    'Hello! I am recording my voice for live translation.',
    'Good morning! Today I am testing live translation with my own voice.',
    'Thank you for joining the call. I will speak, and you will hear me in your language.',
  ],
  ru: [
    'Привет! Я записываю свой голос для живого перевода.',
    'Доброе утро! Сегодня я проверяю живой перевод своим голосом.',
    'Спасибо, что пришли на звонок. Я говорю, а вы слышите меня на своём языке.',
  ],
};

const voiceLanguage = document.getElementById('voice-language');
const voiceNewText = document.getElementById('voice-new-text');
const voicePrompt = document.getElementById('voice-prompt');
const voiceRecord = document.getElementById('voice-record');
const voicePause = document.getElementById('voice-pause');
const voiceCreate = document.getElementById('voice-create');
const voiceTimer = document.getElementById('voice-timer');
const voiceProgress = document.getElementById('voice-progress');
const voiceStatus = document.getElementById('voice-status');
const recorder = document.getElementById('recorder');

let promptLanguage = uiLanguage === 'ru' ? 'ru' : 'en';
let promptIndex = 0;
let recording = null;
// The finished recording waiting for Create voice: {wav, text}.
let sample = null;
let recordedOnce = false;
// A status key with its variables, so a language change re-renders it.
let status = { key: 'clone.statusIdle' };

for (const button of voiceLanguage.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    promptLanguage = button.dataset.value;
    promptIndex = 0;
    showPrompt();
  });
}
voiceNewText.addEventListener('click', () => {
  promptIndex = (promptIndex + 1) % VOICE_PROMPTS[promptLanguage].length;
  showPrompt();
});
voiceRecord.addEventListener('click', () => {
  if (recording) finishRecording();
  else startRecording();
});
voicePause.addEventListener('click', () => {
  if (!recording) return;
  if (recording.paused) {
    recording.paused = false;
    recording.resumedAt = Date.now();
    setStatus('clone.statusRecording');
  } else {
    recording.elapsed += Date.now() - recording.resumedAt;
    recording.paused = true;
    setStatus('clone.statusPaused');
  }
  renderClone();
});
voiceCreate.addEventListener('click', createVoice);

function showPrompt() {
  for (const button of voiceLanguage.querySelectorAll('button')) {
    button.setAttribute(
      'aria-checked',
      String(button.dataset.value === promptLanguage),
    );
  }
  const text = VOICE_PROMPTS[promptLanguage][promptIndex];
  // Words light up one by one as the recording advances.
  voicePrompt.replaceChildren(
    ...text.split(' ').flatMap((word, index) => {
      const span = document.createElement('span');
      span.textContent = word;
      return index ? [' ', span] : [span];
    }),
  );
  // A sample must match the text it is sent with.
  if (sample && sample.text !== voicePrompt.textContent) {
    sample = null;
    setStatus('clone.statusIdle');
    showElapsed(0);
  }
  renderClone();
}

function elapsedMs() {
  if (!recording) return 0;
  return (
    recording.elapsed +
    (recording.paused ? 0 : Date.now() - recording.resumedAt)
  );
}

function showElapsed(ms) {
  const seconds = Math.min(MAX_SECONDS, Math.floor(ms / 1000));
  voiceTimer.textContent = `0:${String(seconds).padStart(2, '0')} / 0:${MAX_SECONDS}`;
  const fraction = Math.min(1, ms / (MAX_SECONDS * 1000));
  voiceProgress.style.width = `${fraction * 100}%`;
  const words = voicePrompt.querySelectorAll('span');
  const read = Math.round(fraction * words.length);
  words.forEach((word, index) => word.classList.toggle('read', index < read));
}

async function startRecording() {
  const chunks = [];
  voiceRecord.disabled = true;
  sample = null;
  try {
    const microphone = await startMicrophone(VOICE_SAMPLE_RATE, (chunk) => {
      if (!recording?.paused) chunks.push(chunk);
    });
    recording = {
      stop: microphone.stop,
      chunks,
      text: voicePrompt.textContent,
      paused: false,
      elapsed: 0,
      resumedAt: Date.now(),
      timer: setInterval(() => {
        const ms = elapsedMs();
        showElapsed(ms);
        if (ms >= MAX_SECONDS * 1000) finishRecording();
      }, 100),
    };
    showElapsed(0);
    setStatus('clone.statusRecording');
    updateAppState({ recording: true });
  } catch (err) {
    setStatus('clone.couldNotRecord', { message: err.message });
  } finally {
    voiceRecord.disabled = false;
    renderClone();
  }
}

function finishRecording() {
  const { stop, chunks, text, timer } = recording;
  recording = null;
  clearInterval(timer);
  stop();
  recordedOnce = true;
  updateAppState({ recording: false });

  const samples = chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
  if (samples < MIN_SECONDS * VOICE_SAMPLE_RATE) {
    setStatus('clone.tooShort', { seconds: MIN_SECONDS });
  } else {
    sample = { text, wav: encodeWav(chunks, VOICE_SAMPLE_RATE) };
    setStatus('clone.statusDone');
  }
  renderClone();
}

async function createVoice() {
  if (!sample) return;
  voiceCreate.disabled = true;
  try {
    await window.voice.save({ text: sample.text, wav: bytesToBase64(sample.wav) });
    sample = null;
    setStatus('clone.statusSaved');
    updateAppState({ hasVoice: true });
    toast(t('clone.created'), 'success');
    location.hash = '#voice-translation';
  } catch (err) {
    setStatus('clone.couldNotSave', { message: err.message });
  }
  renderClone();
}

function setStatus(key, vars = {}) {
  status = { key, vars };
  voiceStatus.textContent = t(key, vars);
}

function renderClone() {
  const active = Boolean(recording);
  recorder.classList.toggle('recording', active && !recording.paused);
  recorder.classList.toggle('paused', active && recording.paused);
  voiceRecord.classList.toggle('running', active);
  const recordLabel = t(
    active ? 'clone.stop' : recordedOnce ? 'clone.recordAgain' : 'clone.record',
  );
  voiceRecord.title = recordLabel;
  voiceRecord.setAttribute('aria-label', recordLabel);
  voicePause.hidden = !active;
  const pauseLabel = t(recording?.paused ? 'clone.resume' : 'clone.pause');
  voicePause.title = pauseLabel;
  voicePause.setAttribute('aria-label', pauseLabel);
  voiceCreate.disabled = active || !sample;
  voiceNewText.disabled = active;
  for (const button of voiceLanguage.querySelectorAll('button')) {
    button.disabled = active;
  }
}

document.addEventListener('uilanguagechange', () => {
  setStatus(status.key, status.vars);
  renderClone();
});

async function loadSavedVoice() {
  const voice = await window.voice.load();
  if (!voice) return;
  recordedOnce = true;
  setStatus('clone.statusSaved');
  updateAppState({ hasVoice: true });
  renderClone();
}

showPrompt();
setStatus(status.key);
loadSavedVoice();
