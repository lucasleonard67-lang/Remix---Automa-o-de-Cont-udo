# Imagem do render: versões fixas, nada baixado em execução. Base no
# packages/cli/src/docker/Dockerfile.render do HyperFrames 0.8.221.
FROM node:22.23.4-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip xz-utils chromium \
    libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libcups2 libasound2 libpangocairo-1.0-0 \
    libxshmfence1 libgtk-3-0 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-core fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* && apt-get clean && fc-cache -fv

ARG FFMPEG_RELEASE=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-28-12-59
ARG FFMPEG_BUILD=ffmpeg-n8.0.1-66-g27b8d1a017
ARG FFMPEG_SHA256=26d2ecd0cefba99f9d1ea92252a3a4f743a58df4c1c3cf9f8bbaaa40b1fca5b0
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_RELEASE/$FFMPEG_BUILD-linux64-gpl-8.0.tar.xz" \
    && echo "$FFMPEG_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
    && rm /tmp/ffmpeg.tar.xz

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CONTAINER=true
ENV PYTHONPATH=/app
ENV HYPERFRAMES_NO_TELEMETRY=1
ENV DO_NOT_TRACK=1
ENV HYPERFRAMES_SKIP_SKILLS=1

WORKDIR /app
COPY package.json package-lock.json compose.py render_local.py /app/
RUN npm ci --omit=dev
