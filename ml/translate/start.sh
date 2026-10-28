#!/bin/sh
# Downloads the pinned GGUF once, then runs llama-server. Used both as the
# Docker entrypoint and natively (after setup.sh). Paths default to the
# native layout; the Docker image overrides them.
set -eu

dir="$(cd "$(dirname "$0")" && pwd)"

# Native runs read settings from .env; in Docker they come from compose.
if [ -f "$dir/.env" ]; then
  set -a; . "$dir/.env"; set +a
fi

# The pinned model. The URL must name a full commit hash, not a branch:
# that fixes the file's content, so no separate checksum is needed.
: "${MODEL_URL:=https://huggingface.co/17slever17/translate-gemma-4-sub-e2b-GGUF/resolve/dc7285667d34af7679d4d6b824d6565e7b69ec84/translate_gemma4_sub-E2B-Q4_K_XL.gguf}"

models_dir="${MODELS_DIR:-$dir/../models/translate}"
llama_server="${LLAMA_SERVER:-$dir/llama.cpp/build/bin/llama-server}"
model="$models_dir/${MODEL_URL##*/}"

mkdir -p "$models_dir"

if [ ! -f "$model" ]; then
  echo "Downloading $MODEL_URL"
  # .part keeps an interrupted download from being taken for the model.
  curl -fL --retry 3 -o "$model.part" "$MODEL_URL"
  mv "$model.part" "$model"
fi

# PARALLEL slots run requests concurrently; CTX_SIZE is split between
# them. exec makes llama-server PID 1, so it receives the stop signal.
exec "$llama_server" \
  -m "$model" \
  --host 0.0.0.0 \
  --port 8100 \
  --parallel "${PARALLEL:-1}" \
  -c "${CTX_SIZE:-4096}" \
  -ngl 99 \
  --reasoning-budget 0
