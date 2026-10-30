# Client

Electron app. macOS.

## Setup

```bash
npm install
cp .env.example .env
```

Set the server address in `.env`:

```
BACKEND_URL=http://<host>:3000
```

It is built into the app, so restart `npm start` or rebuild the package
after changing it.

The virtual microphone driver needs Xcode:

```bash
npm run driver:build
```

## Run

```bash
npm start
```

Install the virtual microphone from Settings.

## Build

```bash
npm run driver:build
npm run make
```

The package is written to `out/make/`.
