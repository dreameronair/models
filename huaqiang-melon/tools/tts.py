#!/usr/bin/env python3
"""Synthesize every dialogue line and derive the master timeline from the real audio lengths.

Outputs (in build/):
  voice/<hash>.mp3   cached TTS per line
  dialogue.wav       48 kHz mono, every line placed at its timeline start (robot lines processed)
  timeline.json      scenes, lines (speaker, text, caption, danmu) and a 30 fps mouth envelope per line
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
FPS = 30
TRANSITION = 0.5


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def trim(x, thresh_db=-42.0, pad=0.03):
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


def robot(x):
    """Metallic robot voice: ring modulation blended with a short resonant comb."""
    t = np.arange(len(x)) / SR
    ring = x * np.sin(2 * np.pi * 55 * t)
    y = 0.62 * x + 0.5 * ring
    d = int(0.0045 * SR)
    out = np.copy(y)
    for i in range(d, len(out)):
        out[i] += 0.38 * out[i - d]
    return out / (np.max(np.abs(out)) + 1e-9) * np.max(np.abs(x))


def mouth_envelope(x):
    """Per-frame mouth openness 0..9 for lip sync."""
    hop = SR // FPS
    n = int(np.ceil(len(x) / hop))
    pad = np.pad(x, (0, n * hop - len(x)))
    rms = np.sqrt(np.mean(pad.reshape(n, hop) ** 2, axis=1))
    ref = np.percentile(rms, 90) + 1e-9
    return [int(v) for v in np.clip(np.round(rms / ref * 9), 0, 9)]


async def synth(text, sp, out):
    import edge_tts
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, sp["voice"], rate=sp["rate"], pitch=sp["pitch"]).save(str(out))
            return
        except Exception as exc:
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1}: {exc}", file=sys.stderr)
            await asyncio.sleep(2 ** (attempt + 2))


async def main():
    script = json.loads((ROOT / "script.json").read_text("utf-8"))
    voice_dir = BUILD / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    speakers = script["speakers"]
    gap = script["lineGap"]

    clips = []
    for scene in script["scenes"]:
        for line in scene["lines"]:
            sp = speakers[line["who"]]
            key = hashlib.sha1(f'{sp["voice"]}|{sp["rate"]}|{sp["pitch"]}|{line["text"]}'.encode()).hexdigest()[:16]
            mp3 = voice_dir / f"{key}.mp3"
            if not mp3.exists():
                print(f'tts [{line["who"]}]: {line["text"]}')
                await synth(line["text"], sp, mp3)
            x = trim(decode(mp3))
            if sp.get("fx") == "robot":
                x = robot(x)
            clips.append(x)

    timeline = {"fps": FPS, "width": 1920, "height": 1080, "transition": TRANSITION, "scenes": []}
    cursor, k = 0.0, 0
    placed = []
    for scene in script["scenes"]:
        start = cursor
        t = start + scene["lead"]
        lines = []
        for i, line in enumerate(scene["lines"]):
            dur = len(clips[k]) / SR
            entry = {"who": line["who"], "text": line["text"], "start": round(t, 3), "end": round(t + dur, 3),
                     "mouth": mouth_envelope(clips[k])}
            for key in ("caption", "danmu"):
                if key in line:
                    entry[key] = line[key]
            lines.append(entry)
            placed.append((t, clips[k]))
            # Punchlines (lines with a caption) get a reaction beat unless the script overrides it.
            beat = line.get("beat", 1.0 if "caption" in line else 0.0)
            t += dur + beat + (gap if i < len(scene["lines"]) - 1 else 0)
            k += 1
        end = t + scene["tail"]
        timeline["scenes"].append({"id": scene["id"], "start": round(start, 3), "end": round(end, 3), "lines": lines})
        cursor = end
    timeline["duration"] = round(cursor, 3)

    total = np.zeros(int(np.ceil(cursor * SR)) + SR)
    for t, clip in placed:
        i = int(round(t * SR))
        total[i : i + len(clip)] += clip
    total *= 0.89 / (np.max(np.abs(total)) or 1.0)
    pcm = (np.clip(total, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", str(BUILD / "dialogue.wav")],
        input=pcm, check=True,
    )
    (BUILD / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False), "utf-8")
    print(f"timeline: {len(timeline['scenes'])} scenes, {cursor:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
