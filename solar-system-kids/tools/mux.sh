#!/usr/bin/env bash
# Combine the rendered picture and the mixed soundtrack into the deliverable MP4.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
ffmpeg -v error -y -i build/video.mp4 -i build/mix.wav \
  -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 48000 \
  -shortest -movflags +faststart \
  -metadata title="我们的太阳系" -metadata:s:a:0 language=chi \
  out/solar_system_kids.mp4
ffprobe -v error -show_entries format=duration,size -of default=nw=1 out/solar_system_kids.mp4
