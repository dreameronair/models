#!/usr/bin/env python3
"""Synthesize the soundtrack and mix it with the narration.

Inputs:  build/timeline.json, build/cues.json (from the renderer), build/narration.wav
Output:  build/mix.wav (48 kHz stereo)

Music: a gentle music-box loop (I-vi-IV-V) with pad and bass, ducked under the voice.
SFX:   whoosh (panned left->right with the rocket), chime, pop, sparkle, all from cues.json.
Everything is seeded, so the output is reproducible.
"""
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SR = 48000
BPM = 92
BEAT = 60 / BPM

PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
CHORDS = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]]  # C Am F G (semitones from C)


def hz(semi, octave=4):
    return 261.6256 * 2 ** ((semi + 12 * (octave - 4)) / 12)


def env_exp(n, tau, attack=0.004):
    t = np.arange(n) / SR
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / tau)


def add(buf, start, sig, gain=1.0):
    i = int(round(start * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    j0 = max(0, -i)
    i = max(0, i)
    seg = sig[j0 : j0 + len(buf) - i]
    buf[i : i + len(seg)] += seg * gain


def bell(f, dur, tau, partials=((1, 1.0), (2.0, 0.35), (3.01, 0.12), (4.2, 0.05))):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * k / (tau * 1.0)) for k, a in partials)
    return s * env_exp(n, tau * 1.6, 0.003)


def music(duration):
    out = np.zeros(int(duration * SR) + SR, dtype=np.float64)
    bar = 4 * BEAT
    arp = [0, 1, 2, 1, 0, 2, 1, 2]
    k = 0
    t = 0.0
    while t < duration:
        chord = CHORDS[k % 4]
        for i, step in enumerate(arp):
            semi = chord[step] + (12 if i in (2, 5) else 0)
            add(out, t + i * BEAT / 2, bell(hz(semi, 5), 1.2, 0.35), 0.16 if i % 2 == 0 else 0.11)
        n = int(bar * SR * 1.1)
        tt = np.arange(n) / SR
        pad_env = np.clip(tt / 0.6, 0, 1) * np.clip((bar * 1.1 - tt) / 0.5, 0, 1)
        pad = sum(np.sin(2 * np.pi * hz(s, 3) * tt) + 0.4 * np.sin(2 * np.pi * hz(s, 3) * 1.003 * tt) for s in chord)
        add(out, t, pad * pad_env * (0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * tt)), 0.018)
        for b in (0, 2):
            add(out, t + b * BEAT, bell(hz(chord[0], 2), 1.0, 0.45, ((1, 1.0), (2, 0.2))), 0.2)
        if k % 2 == 1:
            add(out, t + 3.5 * BEAT, bell(hz(chord[2] + 12, 6), 1.0, 0.3), 0.05)
        t += bar
        k += 1
    n = len(out)
    tt = np.arange(n) / SR
    out *= np.clip(tt / 2.0, 0, 1) * np.clip((duration - tt) / 3.5, 0, 1)
    return out


def one_pole_lp(x, cut):
    """Time-varying one-pole lowpass; cut is an array of cutoff Hz per sample."""
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def sfx(kind, pitch, rnd):
    if kind == "whoosh":
        dur = 1.0
        n = int(dur * SR)
        t = np.arange(n) / n
        noise = rnd.standard_normal(n)
        shape = np.sin(np.pi * np.clip(t, 0, 1)) ** 2
        cut = 300 + 3200 * shape
        lp = one_pole_lp(noise, cut)
        hp = lp - one_pole_lp(lp, np.full(n, 180.0))
        sig = hp * shape * 0.9
        pan = np.clip(t * 1.2 - 0.1, 0, 1)
        return np.stack([sig * np.cos(pan * np.pi / 2), sig * np.sin(pan * np.pi / 2)], 1), 0.32
    if kind == "chime":
        p = PENTA[(pitch or 0) % 5]
        s = bell(hz(p + 4, 6), 1.8, 0.6)
        add(s, 0.09, bell(hz(p + 11, 6), 1.7, 0.55), 0.7)
        return np.stack([s, s], 1), 0.11
    if kind == "pop":
        n = int(0.14 * SR)
        t = np.arange(n) / SR
        base = 520 * 2 ** (PENTA[(pitch or 0) % len(PENTA)] / 12)
        f = base * (1.6 - 0.6 * np.clip(t / 0.05, 0, 1))
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.04)
        return np.stack([s, s], 1), 0.2
    if kind == "sparkle":
        out = np.zeros(int(0.9 * SR))
        for i, p in enumerate([7, 12, 16, 19]):
            add(out, i * 0.055, bell(hz(p, 6), 0.7, 0.18), 1.0)
        return np.stack([out, out], 1), 0.07
    raise ValueError(kind)


def envelope_follow(x, attack=0.02, release=0.35):
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


def read_wav_mono(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def main():
    tl = json.loads((BUILD / "timeline.json").read_text("utf-8"))
    cues = json.loads((BUILD / "cues.json").read_text("utf-8"))
    duration = tl["duration"]
    n = int(np.ceil(duration * SR))

    voice = read_wav_mono(BUILD / "narration.wav")[:n]
    voice = np.pad(voice, (0, n - len(voice)))
    bgm = music(duration)[:n]
    env = envelope_follow(voice)
    duck = 1 - 0.62 * np.clip(env / 0.05, 0, 1)
    bgm *= duck

    rnd = np.random.default_rng(2026)
    fx = np.zeros((n, 2))
    for c in cues:
        sig, gain = sfx(c["type"], c.get("pitch"), rnd)
        i = int(round(c["t"] * SR))
        if i >= n:
            continue
        seg = sig[: n - max(i, 0)]
        fx[max(i, 0) : max(i, 0) + len(seg)] += seg * gain

    mix = np.stack([voice, voice], 1) * 0.9 + np.stack([bgm, bgm], 1) * 0.55 + fx
    peak = np.max(np.abs(mix))
    mix *= 0.93 / peak
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-", str(BUILD / "mix.wav")],
                   input=pcm, check=True)
    print(f"mix: build/mix.wav ({duration:.1f}s, {len(cues)} cues)")


if __name__ == "__main__":
    main()
