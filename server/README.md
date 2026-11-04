# Server

NestJS backend on port 3000.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable          | Required | Value                                                     |
| ----------------- | -------- | --------------------------------------------------------- |
| `META_API_KEY`    | yes      | Meta API key for speech recognition                       |
| `TRANSLATE_URL`   | yes      | Translation service, e.g. `http://<host>:8100`            |
| `TTS_URL`         | no       | TTS service, e.g. `http://<host>:8200`                    |
| `PORT`            | no       | Listening port, `3000` by default                         |
| `META_LOG_EVENTS` | no       | `true` logs each Meta event type with the recognized text |

Without `TTS_URL` voice translation is disabled.

## Routes

| Route                  | Type      | What                                                     |
| ---------------------- | --------- | -------------------------------------------------------- |
| `GET /`                | HTTP      | Health check, the client uses it to see the server is up |
| `/translate-voice`     | WebSocket | Your speech in, translated speech in your voice out      |
| `/translate-subtitles` | WebSocket | System audio in, translated subtitles out                |

Both sockets take `source` and `target` language codes in the query
(`en`, `ru`, `es`, `de`, `fr`), e.g. `/translate-voice?source=ru&target=en`.
Audio goes in as binary PCM s16le 16 kHz mono and ends with
`{"type":"endStream"}`.

**`/translate-voice`.** The first message is the voice sample to clone,
`{"type":"voice","text","wav"}`. The server answers with `ready`,
`translationDraft` and `translationFinal` with the translated text, then
`audioFormat` and the translated speech as binary mono PCM. The socket
closes once everything is spoken.

**`/translate-subtitles`.** The server answers with `ready` and
`translationDraft` / `translationFinal` with the subtitles text.

On failure either socket sends `{"type":"error","message"}`.

## Run

Development:

```bash
npm run start:dev
```

Production:

```bash
npm run build
npm run start:prod
```
