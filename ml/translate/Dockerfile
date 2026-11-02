# setup.sh reads the tag from here to build the same version natively.
FROM ghcr.io/ggml-org/llama.cpp:server-cuda12-b11913

# start.sh defaults to the native layout; point it at the image's.
ENV MODELS_DIR=/models \
    LLAMA_SERVER=/app/llama-server

COPY --chmod=755 start.sh /start.sh

EXPOSE 8100

ENTRYPOINT ["/start.sh"]
