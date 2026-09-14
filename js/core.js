/* 全局配置、角色数据、关卡表与补间动画核心 */
(function (global) {
  'use strict';

  var CONFIG = {
    rows: 8,
    cols: 8,
    // 分数
    scorePerTile: 60,
    comboStep: 0.5,        // 每层连锁的额外倍率
    specialBonus: 200,
    // 动画时长(ms)
    swapTime: 150,
    popTime: 190,
    fallTimePerCell: 62,
    fallTimeMin: 110,
    hintDelay: 4500,
    // 道具初始数量
    props: { hammer: 2, shuffle: 1 }
  };

  // 六个角色。sprite 对应 assets/characters/<sprite>.png(原创形象),
  // official 是切到官方形象时显示的名字, 在线图地址见 js/skins.js。
  var CHARACTERS = [
    { id: 'rabbit',  name: '蜜莉',  official: '爱心萌可', sprite: 'rabbit',  color: '#ff74b3', light: '#ffd9ec', dark: '#d93a84' },
    { id: 'cat',     name: '露娜',  official: '正正萌可', sprite: 'cat',     color: '#4bb4ff', light: '#cfeaff', dark: '#1a76c9' },
    { id: 'bear',    name: '布丁',  official: '勇气萌可', sprite: 'bear',    color: '#ffc32e', light: '#fff0c4', dark: '#d99400' },
    { id: 'dragon',  name: '青青',  official: '盼盼萌可', sprite: 'dragon',  color: '#57d18b', light: '#d6f7e3', dark: '#1f9c58' },
    { id: 'unicorn', name: '星梦',  official: '唱唱萌可', sprite: 'unicorn', color: '#b184ff', light: '#e9dcff', dark: '#7643d6' },
    { id: 'fox',     name: '火火',  official: '娜娜萌可', sprite: 'fox',     color: '#ff894a', light: '#ffdcc8', dark: '#d95515' }
  ];

  // types: 本关出现的角色种类数(越少越容易凑对)
  var LEVELS = [
    { types: 5, moves: 25, target: 1200, collect: [{ type: 0, count: 10 }] },
    { types: 5, moves: 24, target: 2000, collect: [{ type: 1, count: 12 }, { type: 2, count: 12 }] },
    { types: 5, moves: 22, target: 2800, collect: [{ type: 3, count: 14 }] },
    { types: 6, moves: 22, target: 3500, collect: [{ type: 4, count: 14 }, { type: 5, count: 14 }] },
    { types: 6, moves: 20, target: 4200, collect: [{ type: 0, count: 16 }, { type: 1, count: 16 }] },
    { types: 6, moves: 20, target: 5000, collect: [{ type: 2, count: 18 }, { type: 3, count: 18 }] },
    { types: 6, moves: 18, target: 5800, collect: [{ type: 4, count: 18 }, { type: 5, count: 18 }, { type: 0, count: 18 }] },
    { types: 6, moves: 18, target: 6600, collect: [{ type: 1, count: 20 }, { type: 2, count: 20 }] },
    { types: 6, moves: 16, target: 7500, collect: [{ type: 3, count: 20 }, { type: 4, count: 20 }, { type: 5, count: 20 }] },
    { types: 6, moves: 16, target: 8800, collect: [{ type: 0, count: 14 }, { type: 2, count: 14 }, { type: 4, count: 14 }] }
  ];

  var SPECIAL_LABEL = {
    row: '横向闪电',
    col: '纵向闪电',
    bomb: '魔法炸弹',
    rainbow: '彩虹魔杖'
  };

  var Ease = {
    linear: function (t) { return t; },
    quadOut: function (t) { return 1 - (1 - t) * (1 - t); },
    quadIn: function (t) { return t * t; },
    cubicOut: function (t) { return 1 - Math.pow(1 - t, 3); },
    backOut: function (t) {
      var s = 1.9;
      var u = t - 1;
      return 1 + u * u * ((s + 1) * u + s);
    },
    bounceOut: function (t) {
      var n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
      if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
      t -= 2.625 / d;
      return n * t * t + 0.984375;
    },
    // 下落: 先加速, 落地时冲过头一点再回弹
    drop: function (t) {
      if (t < 0.8) { var u = t / 0.8; return u * u; }
      return 1 + Math.sin((t - 0.8) / 0.2 * Math.PI) * 0.045;
    }
  };

  /**
   * 极简补间引擎。每个 to() 返回 Promise, 便于把消除流程串成链。
   * cancelAll() 会立即兑现所有未完成的 Promise, 调用方需要用 generation 令牌
   * 判断自己是否已经过期(见 Game.prototype.gen)。
   */
  var Anim = (function () {
    var active = [];

    function to(target, props, duration, easing) {
      return new Promise(function (resolve) {
        if (duration <= 0) {
          for (var k in props) target[k] = props[k];
          resolve();
          return;
        }
        var from = {};
        for (var key in props) from[key] = target[key];
        active.push({
          target: target, from: from, to: props,
          dur: duration, elapsed: 0,
          ease: easing || Ease.quadOut,
          resolve: resolve
        });
      });
    }

    function wait(ms) {
      return new Promise(function (resolve) {
        active.push({ target: {}, from: {}, to: {}, dur: ms, elapsed: 0, ease: Ease.linear, resolve: resolve });
      });
    }

    function update(dt) {
      if (!active.length) return;
      var done = [];
      for (var i = active.length - 1; i >= 0; i--) {
        var tw = active[i];
        tw.elapsed += dt;
        var p = tw.dur > 0 ? Math.min(1, tw.elapsed / tw.dur) : 1;
        var e = tw.ease(p);
        for (var k in tw.to) {
          tw.target[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        }
        if (p >= 1) {
          for (var k2 in tw.to) tw.target[k2] = tw.to[k2];
          active.splice(i, 1);
          done.push(tw);
        }
      }
      for (var j = 0; j < done.length; j++) done[j].resolve();
    }

    function cancelAll() {
      var pending = active;
      active = [];
      for (var i = 0; i < pending.length; i++) pending[i].resolve();
    }

    function count() { return active.length; }

    return { to: to, wait: wait, update: update, cancelAll: cancelAll, count: count };
  })();

  var Util = {
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
    randInt: function (n) { return Math.floor(Math.random() * n); },
    shuffle: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Util.randInt(i + 1);
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    roundRect: function (ctx, x, y, w, h, r) {
      var rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    },
    formatNumber: function (n) {
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  };

  // 单文件版(tools/build_single.py 产出)会在本脚本之前塞一份 window.MK_INLINE,
  // 把 'assets/xxx.png' 映射成内联的 dataURL。普通版这里是空表, assetUrl 原样返回。
  var INLINE = global.MK_INLINE || {};

  function assetUrl(path) {
    return Object.prototype.hasOwnProperty.call(INLINE, path) ? INLINE[path] : path;
  }

  var Storage = {
    key: 'mengke-match3-v1',
    read: function () {
      try {
        var raw = global.localStorage.getItem(Storage.key);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },
    write: function (data) {
      try {
        global.localStorage.setItem(Storage.key, JSON.stringify(data));
      } catch (e) { /* 隐私模式下忽略 */ }
    },
    get: function (name, fallback) {
      var data = Storage.read();
      return Object.prototype.hasOwnProperty.call(data, name) ? data[name] : fallback;
    },
    set: function (name, value) {
      var data = Storage.read();
      data[name] = value;
      Storage.write(data);
    }
  };

  global.MK = {
    CONFIG: CONFIG,
    CHARACTERS: CHARACTERS,
    LEVELS: LEVELS,
    SPECIAL_LABEL: SPECIAL_LABEL,
    Ease: Ease,
    Anim: Anim,
    Util: Util,
    Storage: Storage,
    assetUrl: assetUrl
  };
})(window);
