# TTS

VoxCPM2 text-to-speech service on port 8200. Linux with an NVIDIA GPU
only (driver >= 570).

The service has no auth: allow the port only from the backend host, never
from the internet.

The model is pinned in `start.sh`. On first start it downloads (~5 GB)
and is reused afterwards: into the `tts-models` volume in Docker, into
`ml/models/tts/` without it. The server answers only once the model is
loaded.

## Docker

Needs the NVIDIA Container Toolkit on the host.

```bash
docker compose up -d --build
```

## Without Docker

E.g. on a Vast.ai instance. Run from `ml/tts/`:

```bash
apt-get install -y ffmpeg
pip install -r requirements.txt
./start.sh
```

## Check

```bash
curl http://localhost:8200/health
```
