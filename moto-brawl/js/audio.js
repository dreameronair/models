/*
 * 声音全部用 WebAudio 实时合成, 不带任何音频文件。
 *
 * 引擎是重点: 两个略微失谐的锯齿波 + 一点噪声, 频率跟着车速走, 松油门时
 * 音色变闷。这样加速、拉到红线、撞车熄火都能听出来, 而不是循环播一段。
 */
(function (global) {
  'use strict';

  var MB = global.MB;

  var Sound = {
    ctx: null,
    master: null,
    ready: false,
    sfxOn: true,
    engineOn: true,
    engine: null
  };

  function now() { return Sound.ctx ? Sound.ctx.currentTime : 0; }

  Sound.init = function () {
    if (Sound.ctx) return Sound.ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      Sound.ctx = new AC();
    } catch (e) {
      return null;
    }
    Sound.master = Sound.ctx.createGain();
    Sound.master.gain.value = 0.5;
    Sound.master.connect(Sound.ctx.destination);
    Sound.ready = true;
    return Sound.ctx;
  };

  /** iOS/微信里必须在用户手势里 resume 一次, 否则一直是 suspended。 */
  Sound.unlock = function () {
    if (!Sound.ctx) Sound.init();
    if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
  };

  /* ------------------------------------------------------------------ *
   * 引擎
   * ------------------------------------------------------------------ */

  Sound.startEngine = function () {
    if (!Sound.ctx || Sound.engine) return;
    var ctx = Sound.ctx;

    var gain = ctx.createGain();
    gain.gain.value = 0;

    // 低通让松油门时听着发闷
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.2;

    var osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 60;

    // 第二个振荡器故意差几个 Hz, 拍频听起来像单缸抖动
    var osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 62;

    var oscGain2 = ctx.createGain();
    oscGain2.gain.value = 0.35;

    // 一点白噪声当机械噪音
    var noise = ctx.createBufferSource();
    var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    var noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;

    osc1.connect(filter);
    osc2.connect(oscGain2);
    oscGain2.connect(filter);
    noise.connect(noiseGain);
    noiseGain.connect(filter);
    filter.connect(gain);
    gain.connect(Sound.master);

    osc1.start();
    osc2.start();
    noise.start();

    Sound.engine = { osc1: osc1, osc2: osc2, gain: gain, filter: filter,
                     noiseGain: noiseGain };
  };

  Sound.stopEngine = function () {
    if (!Sound.engine) return;
    var e = Sound.engine;
    try {
      e.osc1.stop(); e.osc2.stop();
    } catch (err) { /* 已经停过 */ }
    e.gain.disconnect();
    Sound.engine = null;
  };

  /**
   * 每帧喂进来当前转速。
   * rpm 0~1, throttle 表示是否在给油, down 表示摔了(熄火)。
   */
  Sound.engineUpdate = function (rpm, throttle, down) {
    if (!Sound.engine || !Sound.ctx) return;
    var e = Sound.engine;
    var t = now();
    var vol = Sound.engineOn && !down ? 0.16 + rpm * 0.2 : 0;

    // 挂档感: 频率在每个"档位"里爬升, 到顶再掉回来重新爬
    var gearSpan = 0.22;
    var gear = Math.min(4, Math.floor(rpm / gearSpan));
    var within = (rpm - gear * gearSpan) / gearSpan;
    var base = 52 + gear * 14 + within * 70;

    e.osc1.frequency.setTargetAtTime(base, t, 0.06);
    e.osc2.frequency.setTargetAtTime(base * 1.01 + 2, t, 0.06);
    e.filter.frequency.setTargetAtTime(
      throttle ? 700 + rpm * 2600 : 380 + rpm * 900, t, 0.09);
    e.gain.gain.setTargetAtTime(vol, t, 0.08);
    e.noiseGain.gain.setTargetAtTime(0.02 + rpm * 0.07, t, 0.1);
  };

  /* ------------------------------------------------------------------ *
   * 音效
   * ------------------------------------------------------------------ */

  function blip(opts) {
    if (!Sound.ready || !Sound.sfxOn || !Sound.ctx) return;
    var ctx = Sound.ctx;
    var t = now();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.from, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(opts.vol || 0.3, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(gain);
    gain.connect(Sound.master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.02);
  }

  function burst(dur, vol, filterFreq) {
    if (!Sound.ready || !Sound.sfxOn || !Sound.ctx) return;
    var ctx = Sound.ctx;
    var t = now();
    var len = Math.ceil(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1800;
    var gain = ctx.createGain();
    gain.gain.value = vol || 0.4;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(Sound.master);
    src.start(t);
  }

  Sound.punch = function () {
    blip({ type: 'square', from: 220, to: 70, dur: 0.1, vol: 0.28 });
    burst(0.09, 0.32, 1200);
  };

  Sound.kick = function () {
    blip({ type: 'sawtooth', from: 170, to: 45, dur: 0.16, vol: 0.34 });
    burst(0.14, 0.4, 900);
  };

  Sound.whiff = function () {
    burst(0.07, 0.12, 3200);
  };

  Sound.crash = function () {
    burst(0.55, 0.6, 2600);
    blip({ type: 'sawtooth', from: 140, to: 30, dur: 0.45, vol: 0.32 });
  };

  Sound.takedown = function () {
    blip({ type: 'square', from: 320, to: 90, dur: 0.22, vol: 0.34 });
    burst(0.3, 0.45, 1400);
  };

  Sound.pickup = function () {
    blip({ type: 'triangle', from: 640, to: 1180, dur: 0.16, vol: 0.28 });
  };

  Sound.beep = function (high) {
    blip({ type: 'square', from: high ? 880 : 440, to: high ? 880 : 440,
           dur: high ? 0.42 : 0.16, vol: 0.26 });
  };

  Sound.click = function () {
    blip({ type: 'square', from: 520, to: 660, dur: 0.06, vol: 0.18 });
  };

  Sound.finish = function () {
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () {
        blip({ type: 'triangle', from: f, to: f, dur: 0.22, vol: 0.3 });
      }, i * 110);
    });
  };

  MB.Sound = Sound;
})(typeof window !== 'undefined' ? window : this);
