# Server

NestJS backend on port 3000.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable        | Required | Value                                                  |
| --------------- | -------- | ------------------------------------------------------ |
| `META_API_KEY`  | yes      | Meta API key for speech recognition                    |
| `TRANSLATE_URL` | yes      | Translation service, e.g. `http://<host>:8100`         |
| `TTS_URL`       | no       | TTS service, e.g. `http://<host>:8200`                 |
| `PORT`          | no       | Listening port, `3000` by default                      |

Without `TTS_URL` voice translation is disabled.

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
