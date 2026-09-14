/* WebAudio 实时合成音效与背景音乐。不依赖任何音频文件, 首包体积为零。 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var Storage = MK.Storage;

  // 五声音阶(C 大调宫调式), 连锁时逐级升高, 听感上就是"越连越爽"
  var PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98];

  var Sound = {
    sfxOn: Storage.get('sfxOn', true),
    bgmOn: Storage.get('bgmOn', true),
    unlocked: false
  };

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var bgmBus = null;
  var bgmTimer = null;
  var bgmStep = 0;

  function ensureContext() {
    if (ctx) return ctx;
    var AudioCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      ctx = new AudioCtor();
    } catch (e) {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.32;
    sfxBus.connect(master);

    bgmBus = ctx.createGain();
    bgmBus.gain.value = 0.075;
    bgmBus.connect(master);
    return ctx;
  }

  /** iOS / 微信必须在用户手势里恢复音频上下文。 */
  Sound.unlock = function () {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    Sound.unlocked = true;
    if (Sound.bgmOn) Sound.startBgm();
  };

  function note(opts) {
    if (!ensureContext()) return;
    var isBgm = opts.channel === 'bgm';
    if (isBgm ? !Sound.bgmOn : !Sound.sfxOn) return;

    var now = ctx.currentTime + (opts.delay || 0);
    var dur = opts.duration || 0.16;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.toFreq), now + dur);

    var peak = opts.gain === undefined ? 0.5 : opts.gain;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + Math.min(0.02, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(isBgm ? bgmBus : sfxBus);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  function noise(opts) {
    if (!Sound.sfxOn || !ensureContext()) return;
    var dur = opts.duration || 0.2;
    var length = Math.floor(ctx.sampleRate * dur);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq || 1200;
    filter.Q.value = 0.9;

    var gain = ctx.createGain();
    gain.gain.value = opts.gain === undefined ? 0.35 : opts.gain;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    src.start();
  }

  Sound.swap = function () {
    note({ type: 'sine', freq: 520, toFreq: 700, duration: 0.09, gain: 0.28 });
  };

  Sound.invalid = function () {
    note({ type: 'square', freq: 190, toFreq: 130, duration: 0.14, gain: 0.16 });
  };

  Sound.select = function () {
    note({ type: 'triangle', freq: 880, duration: 0.06, gain: 0.2 });
  };

  /** cascade 从 1 开始, 连锁越深音高越高。 */
  Sound.pop = function (cascade) {
    var idx = Math.min(PENTATONIC.length - 1, (cascade || 1) - 1);
    note({ type: 'triangle', freq: PENTATONIC[idx], duration: 0.16, gain: 0.36 });
    note({ type: 'sine', freq: PENTATONIC[idx] * 2, duration: 0.1, gain: 0.14, delay: 0.01 });
    noise({ freq: 2600, duration: 0.12, gain: 0.12 });
  };

  Sound.special = function (kind) {
    if (kind === 'rainbow') {
      for (var i = 0; i < 6; i++) {
        note({ type: 'sine', freq: PENTATONIC[i], duration: 0.3, gain: 0.24, delay: i * 0.045 });
      }
    } else if (kind === 'bomb') {
      note({ type: 'sawtooth', freq: 220, toFreq: 60, duration: 0.34, gain: 0.3 });
      noise({ freq: 500, duration: 0.36, gain: 0.3 });
    } else {
      note({ type: 'sawtooth', freq: 900, toFreq: 260, duration: 0.24, gain: 0.24 });
      noise({ freq: 1800, duration: 0.2, gain: 0.16 });
    }
  };

  Sound.create = function () {
    note({ type: 'sine', freq: 1046, duration: 0.22, gain: 0.3 });
    note({ type: 'sine', freq: 1568, duration: 0.26, gain: 0.18, delay: 0.06 });
  };

  Sound.win = function () {
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
      note({ type: 'triangle', freq: f, duration: 0.42, gain: 0.34, delay: i * 0.12 });
    });
  };

  Sound.lose = function () {
    [523.25, 466.16, 392.0, 311.13].forEach(function (f, i) {
      note({ type: 'triangle', freq: f, duration: 0.34, gain: 0.28, delay: i * 0.14 });
    });
  };

  Sound.star = function (index) {
    note({ type: 'sine', freq: 880 * Math.pow(1.26, index || 0), duration: 0.35, gain: 0.32 });
  };

  Sound.click = function () {
    note({ type: 'sine', freq: 660, toFreq: 880, duration: 0.07, gain: 0.22 });
  };

  // 缓慢的五声音阶琶音 + 低音垫, 循环 8 小节
  var BGM_PATTERN = [0, 2, 4, 2, 5, 4, 2, 0, 1, 3, 5, 3, 6, 5, 3, 1];
  var BGM_BASS = [130.81, 130.81, 174.61, 174.61, 196.0, 196.0, 146.83, 146.83];

  Sound.startBgm = function () {
    if (!Sound.bgmOn || bgmTimer || !ensureContext()) return;
    var beat = 340;
    bgmTimer = global.setInterval(function () {
      if (!ctx || ctx.state === 'suspended') return;
      var idx = bgmStep % BGM_PATTERN.length;
      note({
        channel: 'bgm',
        type: 'sine',
        freq: PENTATONIC[BGM_PATTERN[idx]],
        duration: 0.5,
        gain: 0.5
      });
      if (idx % 2 === 0) {
        note({
          channel: 'bgm',
          type: 'triangle',
          freq: BGM_BASS[(bgmStep / 2 | 0) % BGM_BASS.length],
          duration: 0.72,
          gain: 0.42
        });
      }
      bgmStep++;
    }, beat);
  };

  Sound.stopBgm = function () {
    if (bgmTimer) {
      global.clearInterval(bgmTimer);
      bgmTimer = null;
    }
  };

  Sound.setSfx = function (on) {
    Sound.sfxOn = !!on;
    Storage.set('sfxOn', Sound.sfxOn);
  };

  Sound.setBgm = function (on) {
    Sound.bgmOn = !!on;
    Storage.set('bgmOn', Sound.bgmOn);
    if (Sound.bgmOn) Sound.startBgm(); else Sound.stopBgm();
  };

  // 切到后台时静音, 回到前台恢复
  global.document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (global.document.hidden) {
      Sound.stopBgm();
      if (ctx.suspend) ctx.suspend();
    } else {
      if (ctx.resume) ctx.resume();
      if (Sound.bgmOn && Sound.unlocked) Sound.startBgm();
    }
  });

  MK.Sound = Sound;
})(window);
