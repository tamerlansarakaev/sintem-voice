FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODELS_DIR=/models \
    PYTHON=python

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg gcc libc6-dev \
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
