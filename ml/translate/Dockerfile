# Translate Gemma served by llama-server (llama.cpp). Weights are not baked
# in: entrypoint.sh downloads the GGUF on first start into /models (a volume).
# NVIDIA GPU only. The image already has curl and sha256sum.
FROM ghcr.io/ggml-org/llama.cpp:server-cuda12-b11913

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

# start-period covers the first model download.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15m --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
