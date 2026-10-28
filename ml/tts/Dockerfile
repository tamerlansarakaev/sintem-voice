# VoxCPM2 TTS service. Weights are not baked in: start.sh downloads them on
# first start into /models (a volume). NVIDIA GPU only.
#
# torch wheels bundle the CUDA libraries, so the host only needs the NVIDIA
# driver (>= 570 for cu128) and the NVIDIA Container Toolkit.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODELS_DIR=/models

# ffmpeg for torchcodec. soundfile wheels bundle libsndfile.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ app/
COPY start.sh .
RUN chmod +x start.sh

RUN useradd --create-home --uid 1000 app \
 && mkdir -p /models \
 && chown app /models
USER app

EXPOSE 8200

# start-period covers the first model download.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15m --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8200/health')"

ENTRYPOINT ["/app/start.sh"]
