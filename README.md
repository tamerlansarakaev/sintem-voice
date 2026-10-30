# Sintem Voice

Live speech translation: subtitles and a translated voice on a virtual
microphone.

## Running

Start the parts in this order. Each can run on its own machine.

1. ML services (Linux with an NVIDIA GPU):
   - [Translation](ml/translate/README.md), port 8100
   - [TTS](ml/tts/README.md), port 8200
2. [Server](server/README.md), port 3000. Point it at the ML services with
   `TRANSLATE_URL` and `TTS_URL`.
3. [Client](client/README.md) (macOS). Set the server address with
   `BACKEND_URL`.
