#!/usr/bin/env python3
"""Synthesize music + sound effects and mix them under the dialogue.

Inputs:  build/timeline.json, build/cues.json ({sfx, music} from the renderer), build/dialogue.wav
Output:  build/mix.wav (48 kHz stereo)

Music sections (from cues.music): comic (ragtime-ish bounce), disco (four-on-the-floor), stage (drums + crowd).
Everything is seeded, so the output is reproducible.
"""
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SR = 48000
RND = np.random.default_rng(2026)


def hz(semi, octave=4):
    return 261.6256 * 2 ** ((semi + 12 * (octave - 4)) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def add(buf, start, sig, gain=1.0):
    i = int(round(start * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    j0 = max(0, -i)
    i = max(0, i)
    seg = sig[j0 : j0 + len(buf) - i]
    buf[i : i + len(seg)] += seg * gain


def lowpass(x, cut):
    """One-pole lowpass; cut may be a scalar or per-sample array (Hz)."""
    cut = np.broadcast_to(np.asarray(cut, dtype=np.float64), x.shape)
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def noise(dur):
    return RND.standard_normal(int(dur * SR))


# ---------- instruments (rendered once, reused) ----------
def pluck(f, dur=0.5, bright=1.0):
    t = tt(dur)
    s = np.sin(2 * np.pi * f * t) + 0.5 * bright * np.sin(4 * np.pi * f * t) + 0.25 * bright * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t / 0.12) * np.clip(t / 0.003, 0, 1)


def bass(f, dur=0.35):
    t = tt(dur)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)
    return s * np.exp(-t / 0.18) * np.clip(t / 0.004, 0, 1)


KICK = (lambda t: np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-t / 0.04)) / SR) * np.exp(-t / 0.22))(tt(0.4))
_hn = noise(0.06)
HAT = (_hn - lowpass(_hn, 6000)) * np.exp(-tt(0.06) / 0.015)
_on = noise(0.25)
OPENHAT = (_on - lowpass(_on, 6000)) * np.exp(-tt(0.25) / 0.08)
_cn = noise(0.2)
_cb = lowpass(_cn, 2500) - lowpass(_cn, 900)
CLAP = sum(np.pad(_cb * np.exp(-tt(0.2) / 0.05), (int(k * 0.011 * SR), 0))[: len(_cb)] for k in range(3)) * 2.2
WOOD = (lambda t: (np.sin(2 * np.pi * 1250 * t) + 0.5 * np.sin(2 * np.pi * 1870 * t)) * np.exp(-t / 0.03))(tt(0.12))


def comic(dur):
    out = np.zeros(int(dur * SR) + SR)
    beat = 60 / 116
    prog = [([0, 4, 7], 0), ([9, 13, 16], 9 - 12), ([2, 5, 9], 2), ([7, 11, 14], 7 - 12)]  # C A7 Dm G7
    t, bar = 0.0, 0
    while t < dur:
        chord, root = prog[bar % 4]
        for b in range(4):
            bt = t + b * beat
            rf = hz(root + (7 if b % 2 else 0), 2)
            add(out, bt, bass(rf), 0.5)
            add(out, bt + beat / 2, sum(pluck(hz(s, 4), 0.25, 0.6) for s in chord), 0.07)
            if b % 2:
                add(out, bt, WOOD, 0.12)
        if bar % 2 == 1:
            for i, s in enumerate([chord[2] + 12, chord[1] + 12, chord[0] + 12, chord[1] + 12]):
                add(out, t + 2 * beat + i * beat / 2, pluck(hz(s, 5), 0.3), 0.09)
        t += 4 * beat
        bar += 1
    return out


def disco(dur):
    out = np.zeros(int(dur * SR) + SR)
    beat = 60 / 124
    prog = [(9, [9, 12, 16]), (5, [5, 9, 12]), (0, [0, 4, 7]), (7, [7, 11, 14])]
    t, bar = 0.0, 0
    while t < dur:
        root, chord = prog[bar % 4]
        for b in range(4):
            bt = t + b * beat
            add(out, bt, KICK, 0.75)
            add(out, bt + beat / 2, OPENHAT, 0.16)
            add(out, bt + beat / 4, HAT, 0.1)
            add(out, bt + 3 * beat / 4, HAT, 0.1)
            if b % 2:
                add(out, bt, CLAP, 0.25)
            for e in range(2):
                add(out, bt + e * beat / 2, bass(hz(root + 12 * e, 2), 0.22), 0.4)
            if b in (1, 3):
                add(out, bt + beat / 2, sum(pluck(hz(s, 4), 0.2, 1.2) for s in chord), 0.08)
        t += 4 * beat
        bar += 1
    return out


def stage(dur):
    out = np.zeros(int(dur * SR) + SR)
    roll = np.zeros(int(1.2 * SR))
    for k in range(40):
        add(roll, k * 0.03, CLAP * (0.3 + k / 60), 0.5)
    add(out, 0, roll, 0.6)
    add(out, 1.2, KICK * 1.5, 1.0)
    add(out, 1.2, sum(pluck(hz(s, 3), 2.0, 1.4) for s in [0, 7, 12, 16]), 0.12)
    beat = 60 / 120
    t = 1.2 + beat
    while t < dur:
        add(out, t, KICK, 0.55)
        add(out, t + beat / 2, OPENHAT, 0.1)
        t += beat
    crowd = lowpass(noise(dur), 900) * 0.6
    swell = 0.5 + 0.5 * np.sin(np.linspace(0, 3 * np.pi, len(crowd)))
    add(out, 0, crowd * swell, 0.4)
    return out


STYLES = {"comic": comic, "disco": disco, "stage": stage}


def music(sections, total):
    out = np.zeros(int(total * SR) + SR)
    fade = int(0.25 * SR)
    for s in sections:
        dur = s["to"] - s["from"]
        seg = STYLES[s["style"]](dur)[: int(dur * SR)]
        env = np.ones(len(seg))
        env[:fade] = np.linspace(0, 1, min(fade, len(seg)))[: len(env[:fade])]
        env[-fade:] = np.linspace(1, 0, fade)
        add(out, s["from"], seg * env)
    return out[: int(total * SR)]


# ---------- sound effects ----------
def sfx(kind):
    if kind == "whoosh":
        n = noise(0.6)
        shape = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 2
        y = lowpass(n, 300 + 4000 * shape)
        return (y - lowpass(y, 200)) * shape, 0.5
    if kind == "boom":
        return np.concatenate([KICK * 1.5, np.zeros(SR // 4)]) + np.pad(lowpass(noise(0.5), 400) * np.exp(-tt(0.5) / 0.15), (0, len(KICK) + SR // 4 - int(0.5 * SR))), 0.6
    if kind == "scooter":
        t = tt(1.6)
        f = 320 + 380 * np.clip(t / 0.8, 0, 1) + 8 * np.sin(2 * np.pi * 7 * t)
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)
        return s * np.clip(t / 0.1, 0, 1) * np.clip((1.6 - t) / 0.5, 0, 1), 0.1
    if kind == "boing":
        t = tt(0.55)
        f = 180 + 260 * (1 - np.exp(-t / 0.05)) + 90 * np.sin(2 * np.pi * 14 * t) * np.exp(-t / 0.2)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22), 0.35
    if kind == "coins":
        out = np.zeros(int(0.9 * SR))
        for i in range(8):
            add(out, i * 0.045 + RND.random() * 0.01, pluck(2400 + RND.random() * 1600, 0.15, 0.3), 0.6)
        add(out, 0.4, pluck(hz(4, 6), 0.5) + pluck(hz(11, 6), 0.5), 0.8)
        return out, 0.18
    if kind == "glitch":
        out = np.zeros(int(0.7 * SR))
        for i in range(12):
            d = 0.02 + RND.random() * 0.04
            t = tt(d)
            sq = np.sign(np.sin(2 * np.pi * (200 + RND.random() * 1800) * t))
            add(out, i * 0.055, sq, 0.5)
        return out, 0.12
    if kind == "sparkle":
        out = np.zeros(int(0.9 * SR))
        for i, p in enumerate([7, 12, 16, 19, 24]):
            add(out, i * 0.06, pluck(hz(p, 6), 0.6, 0.2), 1.0)
        return out, 0.12
    if kind == "scratch":
        t = tt(0.4)
        f = 1800 * np.abs(np.sin(2 * np.pi * 2.5 * t)) + 300
        carrier = np.sin(2 * np.pi * np.cumsum(f) / SR)
        return carrier * lowpass(noise(0.4), 2500) * 3 * np.exp(-t / 0.2), 0.3
    if kind == "chop":
        t = tt(0.25)
        thud = np.sin(2 * np.pi * np.cumsum(80 + 120 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.08)
        crack = (lambda n: n - lowpass(n, 2000))(noise(0.25)) * np.exp(-t / 0.02)
        return thud + crack * 0.6, 0.45
    if kind == "kick":
        t = tt(0.5)
        thump = np.sin(2 * np.pi * np.cumsum(60 + 150 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.1)
        w, _ = sfx("whoosh")
        return thump + np.pad(w, (0, max(0, len(thump) - len(w))))[: len(thump)] * 0.8, 0.5
    if kind == "faint":
        t = tt(0.9)
        f = 1300 * np.exp(-t / 0.5) + 250 + 20 * np.sin(2 * np.pi * 6 * t)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.clip((0.9 - t) / 0.2, 0, 1), 0.2
    if kind == "cheer":
        n = lowpass(noise(2.8), 1800) - lowpass(noise(2.8), 300) * 0.5
        t = tt(2.8)
        env = np.clip(t / 0.3, 0, 1) * np.clip((2.8 - t) / 1.2, 0, 1)
        out = n * env * 1.6
        for i in range(5):
            st = 0.2 + RND.random() * 1.6
            w = tt(0.35)
            add(out, st, np.sin(2 * np.pi * np.cumsum(2200 + 600 * np.sin(2 * np.pi * 3 * w)) / SR) * np.exp(-w / 0.2), 0.15)
        return out, 0.35
    if kind == "pop":
        t = tt(0.14)
        f = 600 * (1.6 - 0.6 * np.clip(t / 0.05, 0, 1))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.04), 0.25
    raise ValueError(kind)


def envelope_follow(x, attack=0.02, release=0.3):
    win = int(SR * 0.01)
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1))
    a_att, a_rel = np.exp(-0.01 / attack), np.exp(-0.01 / release)
    env = np.empty(n)
    acc = 0.0
    for i, v in enumerate(rms):
        a = a_att if v > acc else a_rel
        acc = a * acc + (1 - a) * v
        env[i] = acc
    return np.interp(np.arange(len(x)), np.arange(n) * win + win / 2, env)


def read_mono(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def main():
    tl = json.loads((BUILD / "timeline.json").read_text("utf-8"))
    cues = json.loads((BUILD / "cues.json").read_text("utf-8"))
    duration = tl["duration"]
    n = int(np.ceil(duration * SR))

    voice = read_mono(BUILD / "dialogue.wav")[:n]
    voice = np.pad(voice, (0, n - len(voice)))
    bgm = music(cues["music"], duration)[:n]
    bgm *= 0.32 / (np.max(np.abs(bgm)) or 1)
    bgm *= 1 - 0.55 * np.clip(envelope_follow(voice) / 0.05, 0, 1)
    tail = np.clip((duration - np.arange(n) / SR) / 2.5, 0, 1)
    bgm *= tail

    fx = np.zeros(n)
    cache = {}
    for c in cues["sfx"]:
        if c["type"] not in cache:
            cache[c["type"]] = sfx(c["type"])
        sig, gain = cache[c["type"]]
        add(fx, c["t"], sig / (np.max(np.abs(sig)) or 1), gain)

    mix = voice * 0.9 + bgm + fx * 0.8
    mix *= 0.93 / np.max(np.abs(mix))
    stereo = np.stack([mix, mix], 1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-", str(BUILD / "mix.wav")],
                   input=pcm, check=True)
    print(f"mix: build/mix.wav ({duration:.1f}s, {len(cues['sfx'])} sfx, {len(cues['music'])} music sections)")


if __name__ == "__main__":
    main()
