#!/bin/sh
# Installs the requirements and downloads the pinned model once, then runs
# the TTS server. Natively it runs from its own venv, ml/tts/.venv (or
# $VENV); the Docker image has the requirements installed and sets $PYTHON.
# Paths default to the native layout; the image overrides them.
set -eu

dir="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${PYTHON:-}" ]; then
  python="$(command -v "$PYTHON")"
else
  venv="${VENV:-$dir/.venv}"
  python="$venv/bin/python"
  # Written last, so an interrupted install runs again.
  if [ ! -f "$venv/.installed" ]; then
    echo "Installing the requirements into $venv"
    python3 -m venv "$venv"
    "$python" -m pip install -r "$dir/requirements.txt"
    touch "$venv/.installed"
  fi
fi

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
  "$(dirname "$python")/hf" download "$repo" --revision "$revision" --local-dir "$model_dir.part"
  mv "$model_dir.part" "$model_dir"
fi

export MODEL_DIR="$model_dir"
cd "$dir"
# exec makes uvicorn PID 1, so it receives the stop signal.
exec "$python" -m uvicorn app.main:app --host 0.0.0.0 --port 8200
