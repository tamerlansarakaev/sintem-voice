#!/bin/sh
# Downloads the pinned model once, then runs the TTS server. Used both as
# the Docker entrypoint and natively (with hf and uvicorn on PATH, e.g. an
# activated venv). Paths default to the native layout; the image overrides
# them.
set -eu

dir="$(cd "$(dirname "$0")" && pwd)"

# The pinned model. The revision must be a full commit hash, not a branch:
# that fixes the files' content.
repo="openbmb/VoxCPM2"
revision="32279effe8c19989596f05d353d1447f51d9e915"

models_dir="${MODELS_DIR:-$dir/../models/tts}"
# The revision is in the name, so a new pin downloads into a new folder.
model_dir="$models_dir/${repo##*/}-$revision"

if [ ! -d "$model_dir" ]; then
  echo "Downloading $repo@$revision"
  # .part keeps an interrupted download from being taken for the model.
  hf download "$repo" --revision "$revision" --local-dir "$model_dir.part"
  mv "$model_dir.part" "$model_dir"
fi

export MODEL_DIR="$model_dir"
cd "$dir"
# exec makes uvicorn PID 1, so it receives the stop signal.
exec uvicorn app.main:app --host 0.0.0.0 --port 8200
