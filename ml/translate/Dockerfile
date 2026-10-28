# Translate Gemma served by llama-server (llama.cpp). Weights are not baked
# in: start.sh downloads the GGUF on first start into /models (a volume).
# NVIDIA GPU only. The image already has curl.
# Keep the tag in sync with setup.sh, which builds the same version natively.
FROM ghcr.io/ggml-org/llama.cpp:server-cuda12-b11913

# start.sh defaults to the native layout; point it at the image's.
ENV MODELS_DIR=/models \
    LLAMA_SERVER=/app/llama-server

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8100

# start-period covers the first model download.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15m --retries=3 \
  CMD curl -fsS http://localhost:8100/health || exit 1

ENTRYPOINT ["/start.sh"]
