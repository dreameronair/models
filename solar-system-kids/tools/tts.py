#!/usr/bin/env python3
"""Synthesize narration line by line and derive the master timeline from real audio lengths.

Outputs (in build/):
  voice/<hash>.mp3   cached TTS per line
  narration.wav      48 kHz mono, every line placed at its timeline start
  timeline.json      scene and line timings consumed by the renderer and the audio mixer
"""
import asyncio
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SR = 48000
TRANSITION = 0.8


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def trim(x, thresh_db=-42.0, pad=0.04):
    win = int(SR * 0.01)
    n = len(x) // win
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    loud = np.nonzero(20 * np.log10(rms) > thresh_db)[0]
    if len(loud) == 0:
        return x
    a = max(0, loud[0] * win - int(pad * SR))
    b = min(len(x), (loud[-1] + 1) * win + int(pad * SR))
    return x[a:b]


async def synth(text, voice, rate, pitch, out):
    import edge_tts
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(out))
            return
        except Exception as exc:  # network hiccups
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1}: {exc}", file=sys.stderr)
            await asyncio.sleep(2 ** (attempt + 2))


async def main():
    script = json.loads((ROOT / "script.json").read_text("utf-8"))
    voice_dir = BUILD / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    voice, rate, pitch = script["voice"], script["rate"], script["pitch"]
    gap = script["lineGap"]

    clips = []
    for scene in script["scenes"]:
        for text in scene["lines"]:
            key = hashlib.sha1(f"{voice}|{rate}|{pitch}|{text}".encode()).hexdigest()[:16]
            mp3 = voice_dir / f"{key}.mp3"
            if not mp3.exists():
                print(f"tts: {text}")
                await synth(text, voice, rate, pitch, mp3)
            clips.append(trim(decode(mp3)))

    timeline = {"fps": 30, "width": 1920, "height": 1080, "transition": TRANSITION, "scenes": []}
    cursor, k = 0.0, 0
    placed = []
    for scene in script["scenes"]:
        start = cursor
        t = start + scene["lead"]
        lines = []
        for i, text in enumerate(scene["lines"]):
            dur = len(clips[k]) / SR
            lines.append({"text": text, "start": round(t, 3), "end": round(t + dur, 3)})
            placed.append((t, clips[k]))
            t += dur + (gap if i < len(scene["lines"]) - 1 else 0)
            k += 1
        end = t + scene["tail"]
        timeline["scenes"].append({"id": scene["id"], "start": round(start, 3), "end": round(end, 3), "lines": lines})
        cursor = end
    timeline["duration"] = round(cursor, 3)

    total = np.zeros(int(np.ceil(cursor * SR)) + SR, dtype=np.float32)
    for t, clip in placed:
        i = int(round(t * SR))
        total[i : i + len(clip)] += clip
    peak = float(np.max(np.abs(total))) or 1.0
    total *= 0.89 / peak
    pcm = (np.clip(total, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", str(BUILD / "narration.wav")],
        input=pcm, check=True,
    )
    (BUILD / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1), "utf-8")
    print(f"timeline: {len(timeline['scenes'])} scenes, {cursor:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
