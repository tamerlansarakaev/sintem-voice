FROM python:3.12-slim

ENV MODELS_DIR=/models \
    PYTHON=python

# ffmpeg for torchcodec; gcc for the kernels Triton compiles at startup.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY --chmod=755 start.sh .

RUN useradd --create-home --uid 1000 app \
 && mkdir -p /models \
 && chown app /models
USER app

EXPOSE 8200

ENTRYPOINT ["/app/start.sh"]
