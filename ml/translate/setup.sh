#!/usr/bin/env bash
# Builds llama-server with CUDA so translate can run without Docker
# (e.g. on a Vast.ai instance). Needs a CUDA devel image (nvcc).
# Safe to run again: a build of the same tag is kept.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
tag="$(sed -n 's/^FROM .*:server-cuda12-//p' "$dir/Dockerfile")"
[ -n "$tag" ] || { echo "no llama.cpp tag in the Dockerfile" >&2; exit 1; }
src="$dir/llama.cpp"
bin="$src/build/bin/llama-server"

if [ -x "$bin" ] && [ "$(cat "$src/.tag" 2>/dev/null)" = "$tag" ]; then
  echo "llama-server $tag is already built: $bin"
  exit 0
fi

command -v nvcc >/dev/null || { echo "nvcc not found: use a CUDA devel image" >&2; exit 1; }

apt-get update
apt-get install -y git cmake build-essential curl

rm -rf "$src" "$src.part"
git clone --depth 1 --branch "$tag" https://github.com/ggml-org/llama.cpp "$src.part"
mv "$src.part" "$src"

cmake -S "$src" -B "$src/build" -DGGML_CUDA=ON -DLLAMA_CURL=OFF
cmake --build "$src/build" -j "$(nproc)" --target llama-server
# Written last, so an interrupted build runs again.
echo "$tag" > "$src/.tag"

[ -f "$dir/.env" ] || cp "$dir/.env.example" "$dir/.env"

echo "Built: $bin"
