# 华强买瓜 2026 · 赛博保熟版

A 95-second parody cartoon. 华强 shows up at an AI melon stall run by a lobster-clawed robot ("龙虾智能体托管"). The original lines are re-cut around 2026 internet trends: 词元另算, 算力瓜, AI幻觉, 显化, 超长长长长长时代, 闪身步 / 浪子踢球, 世界巡演 with a fan who faints and gets carried off on a stretcher, and 爱你老己明天见.

All characters are original drawings made in code. The video contains no footage or likeness from 《征服》, and the violence from the original scene is swapped for gags. The end card reads "本片纯属虚构 · 没有任何瓜摊老板受到伤害".

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| Voices (edge-tts, robot FX, lip-sync envelopes) | `python3 tools/tts.py` | `build/dialogue.wav`, `build/timeline.json` |
| Font subsets (ZCOOL KuaiLe / QingKe HuangYou) | `python3 tools/fonts.py` | `build/fonts/*.ttf` |
| Determinism gate | `node tools/render.js --check` | — |
| Picture (headless Chromium, parallel chunks) | `node tools/render.js --workers 6` | `build/video.mp4`, `build/cues.json` |
| Music + SFX + ducking | `python3 tools/audio.py` | `build/mix.wav` |
| Mux + loudness normalisation | `bash tools/mux.sh` | `out/huaqiang_melon_2026.mp4` |

You can also run `npm run build` to do every step in order. Re-run `tools/fonts.py` whenever you add new on-screen strings to `scene/melon.js`.

`scene/melon.js` must be a pure function of time: `seek(t)` draws the same frame every time. Clocks, frame callbacks, timers, and `Math.random` are banned, and `--check` enforces this.

Preview: serve the folder and open `scene/index.html?preview` to scrub the timeline while `build/mix.wav` plays.

Requirements: Python 3 with `edge-tts`, `numpy`, `fonttools`, and `Pillow`; Node with Playwright Chromium; and `ffmpeg`.
