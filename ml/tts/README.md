# TTS

VoxCPM2 text-to-speech service on port 8200, run by the
[nano-vllm](https://github.com/a710128/nanovllm-voxcpm) engine. Linux with
an NVIDIA GPU only (driver >= 570).

The model is pinned in `start.sh`. On first start it downloads (~5 GB)
and is reused afterwards: into the `tts-models` volume in Docker, into
`ml/models/tts/` without it. The server answers only once the model is
loaded.

TTS takes `GPU_MEMORY_UTILIZATION` (default 0.75) of the GPU memory,
counting what other processes already use. Start the translate service
first when both share a GPU. `INFERENCE_TIMESTEPS` (default 10) trades
voice quality for speed. `TTS_HISTORY_S` (default 10) is how many seconds
of the session's earlier speech each new portion continues, so a sentence
spoken in parts keeps its flow; 0 turns it off.

## Docker

Needs the NVIDIA Container Toolkit on the host.

```bash
docker compose up -d --build
```

## Without Docker

Needs Python 3.12. Run from `ml/tts/`:

```bash
apt-get install -y ffmpeg
./start.sh
```

On first start `start.sh` installs the requirements into `ml/tts/.venv`,
or into `$VENV` if set.

## Check

```bash
curl http://localhost:8200/health
```
