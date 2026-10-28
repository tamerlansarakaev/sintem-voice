#!/usr/bin/env bash
# Builds llama-server with CUDA so translate can run without Docker
# (e.g. on a Vast.ai instance). Needs a CUDA devel image (nvcc).
# Safe to run again: an existing build is kept.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
# Keep in sync with the base image tag in the Dockerfile. After changing
# it, delete llama.cpp/ so the next run rebuilds.
tag="b11913"
src="$dir/llama.cpp"
bin="$src/build/bin/llama-server"

if [ -x "$bin" ]; then
  echo "llama-server is already built: $bin"
  exit 0
fi

command -v nvcc >/dev/null || { echo "nvcc not found: use a CUDA devel image" >&2; exit 1; }

apt-get update
apt-get install -y git cmake build-essential curl

[ -d "$src" ] || git clone --depth 1 --branch "$tag" https://github.com/ggml-org/llama.cpp "$src"

cmake -S "$src" -B "$src/build" -DGGML_CUDA=ON -DLLAMA_CURL=OFF
cmake --build "$src/build" -j "$(nproc)" --target llama-server

[ -f "$dir/.env" ] || cp "$dir/.env.example" "$dir/.env"

echo "Built: $bin"
