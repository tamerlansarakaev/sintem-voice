#!/bin/sh
# Downloads the pinned GGUF once, verifies it, then runs llama-server.
set -eu

model="/models/$MODEL_FILE"

if [ ! -f "$model" ]; then
  echo "Downloading $MODEL_REPO@$MODEL_REVISION/$MODEL_FILE"
  tmp="$model.part"
  curl -fL --retry 3 -o "$tmp" \
    "https://huggingface.co/$MODEL_REPO/resolve/$MODEL_REVISION/$MODEL_FILE"
  # A broken or swapped file never becomes the model.
  echo "$MODEL_SHA256  $tmp" | sha256sum -c -
  mv "$tmp" "$model"
fi

# One slot: requests run one at a time. exec makes llama-server PID 1,
# so it receives the stop signal.
exec /app/llama-server \
  -m "$model" \
  --host 0.0.0.0 \
  --port 8080 \
  --parallel 1 \
  -c "${CTX_SIZE:-4096}" \
  -ngl 99 \
  --reasoning-budget 0
