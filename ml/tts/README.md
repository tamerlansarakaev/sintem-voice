# TTS

VoxCPM2 text-to-speech service on port 8200, run by the
[nano-vllm](https://github.com/a710128/nanovllm-voxcpm) engine. Linux with
an NVIDIA GPU only (driver >= 570), Python 3.12.

The service has no auth: allow the port only from the backend host, never
from the internet.

The model is pinned in `start.sh`. On first start it downloads (~5 GB)
and is reused afterwards: into the `tts-models` volume in Docker, into
`ml/models/tts/` without it. The server answers only once the model is
loaded.

TTS takes `GPU_MEMORY_UTILIZATION` (default 0.95) of the GPU memory,
counting what other processes already use. Start the translate service
first when both share a GPU. `INFERENCE_TIMESTEPS` (default 10) trades
voice quality for speed.

## Docker

Needs the NVIDIA Container Toolkit on the host.

```bash
docker compose up -d --build
```

## Without Docker

Run from `ml/tts/`:

```bash
apt-get install -y ffmpeg
python3 -m pip install -r requirements.txt
./start.sh
```

## Check

```bash
curl http://localhost:8200/health
```
