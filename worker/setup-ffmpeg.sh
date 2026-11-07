#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
curl -sL -o /tmp/ffsta.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
tar xf /tmp/ffsta.tar.xz -C /tmp
D=$(ls -d /tmp/ffmpeg-*-static | head -1)
cp "$D/ffmpeg" "$D/ffprobe" bin/
echo "ok: $(bin/ffmpeg -version | head -1)"
