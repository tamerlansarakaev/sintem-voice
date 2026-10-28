// Audio helpers shared by the main window pages.

// Streams the microphone as mono s16le PCM chunks at `sampleRate`.
// Browser processing is off: it colours the voice, and the server and the
// voice sample should hear the same raw microphone. Returns a stop function.
async function startMicrophone(sampleRate, onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const audioContext = new AudioContext({ sampleRate });
  try {
    await audioContext.audioWorklet.addModule('pcm-worklet.js');
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
    throw err;
  }
  const worklet = new AudioWorkletNode(audioContext, 'pcm-worklet', {
    numberOfOutputs: 0,
  });
  worklet.port.onmessage = ({ data }) => onChunk(data);
  audioContext.createMediaStreamSource(stream).connect(worklet);

  return () => {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
  };
}

// 16-bit mono PCM WAV with the plain 44-byte header.
function encodeWav(chunks, sampleRate) {
  const dataBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    wav.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return wav;
}

function bytesToBase64(bytes) {
  let binary = '';
  // In slices: String.fromCharCode cannot take a megabyte of arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
