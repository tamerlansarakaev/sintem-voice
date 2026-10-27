// Records the voice sample the server clones. It is kept on this computer
// only and sent with every live translation session.
const VOICE_SAMPLE_RATE = 44100;
const MIN_SECONDS = 3;
const MAX_SECONDS = 10;
// The exact text goes to the synthesizer with the sample.
const VOICE_PROMPTS = {
  en: 'The quick brown fox jumps over the lazy dog. I am recording my own voice for live translation, and I agree to its processing.',
  ru: 'Съешь же ещё этих мягких французских булок, да выпей чаю. Я записываю свой собственный голос для живого перевода и даю согласие на его обработку.',
};

const voiceLanguage = document.getElementById('voice-language');
const voicePrompt = document.getElementById('voice-prompt');
const voiceRecord = document.getElementById('voice-record');
const voiceStatus = document.getElementById('voice-status');
const voicePreview = document.getElementById('voice-preview');

let recording = null;

voiceLanguage.addEventListener('change', showPrompt);
voiceRecord.addEventListener('click', () => {
  if (recording) finishRecording();
  else startRecording();
});

function showPrompt() {
  voicePrompt.textContent = VOICE_PROMPTS[voiceLanguage.value];
}

async function startRecording() {
  const chunks = [];
  voiceRecord.disabled = true;
  try {
    const stop = await startMicrophone(VOICE_SAMPLE_RATE, (chunk) =>
      chunks.push(chunk),
    );
    const startedAt = Date.now();
    recording = {
      stop,
      chunks,
      text: voicePrompt.textContent,
      timer: setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (seconds >= MAX_SECONDS) finishRecording();
        else voiceStatus.textContent = `Recording… ${MAX_SECONDS - seconds} s`;
      }, 200),
    };
    voiceRecord.textContent = 'Stop';
    voiceRecord.classList.add('running');
    voiceLanguage.disabled = true;
  } catch (err) {
    voiceStatus.textContent = `Could not record: ${err.message}`;
  } finally {
    voiceRecord.disabled = false;
  }
}

async function finishRecording() {
  const { stop, chunks, text, timer } = recording;
  recording = null;
  clearInterval(timer);
  stop();
  voiceRecord.textContent = 'Record';
  voiceRecord.classList.remove('running');
  voiceLanguage.disabled = false;

  const samples = chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
  if (samples < MIN_SECONDS * VOICE_SAMPLE_RATE) {
    voiceStatus.textContent = `Too short: read the whole text, at least ${MIN_SECONDS} s.`;
    return;
  }

  const wav = encodeWav(chunks, VOICE_SAMPLE_RATE);
  try {
    await window.voice.save({ text, wav: bytesToBase64(wav) });
    showSavedVoice(wav);
  } catch (err) {
    voiceStatus.textContent = `Could not save: ${err.message}`;
  }
}

function showSavedVoice(wav) {
  voiceStatus.textContent = 'Voice saved.';
  if (voicePreview.src) URL.revokeObjectURL(voicePreview.src);
  voicePreview.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  voicePreview.hidden = false;
}

async function loadSavedVoice() {
  const voice = await window.voice.load();
  if (voice) showSavedVoice(base64ToBytes(voice.wav));
  else voiceStatus.textContent = 'No voice yet.';
}

showPrompt();
loadSavedVoice();
