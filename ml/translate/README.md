# Translate

llama.cpp translation service on port 8100. Linux with an NVIDIA GPU only.

The service has no auth: allow the port only from the backend host, never
from the internet.

The model is pinned in `start.sh`. On first start it downloads into
`ml/models/translate/` and is reused afterwards, with or without Docker.

`PARALLEL` sets how many requests run at once and `CTX_SIZE` the context
shared between them (defaults 1 and 4096).

## Docker

Needs the NVIDIA Container Toolkit on the host.

```bash
docker compose up -d --build
```

With other settings, from the shell or from `.env` (`cp .env.example .env`):

```bash
PARALLEL=2 CTX_SIZE=8192 docker compose up -d --build
```

## Without Docker

Needs a CUDA toolkit with `nvcc`. Run from `ml/translate/`:

```bash
./setup.sh
./start.sh
```

`setup.sh` builds llama-server once and creates `.env`; edit `.env` to
change the settings. Variables set in the shell win over `.env`. After the
tag in the `Dockerfile` changes, `setup.sh` builds the new version.

## Check

```bash
curl http://localhost:8100/health
```
