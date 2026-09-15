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

  /* ---------------- 关卡 ---------------- *
   *
   * 100 关分 10 章, 每章 10 关。关卡不是手写死的, 而是按下面几条曲线算出来:
   *
   *   types  本关出现几种角色。种类越少越容易凑三连。
   *   moves  可用步数, 随进度从 27 收到 18。
   *   collect 收集目标, 通关条件就是把它们全收齐(目标分只决定几颗星)。
   *   target 目标分, 达标 2 星, 1.5 倍 3 星。
   *
   * 数值是拿 tools/balance.js 跑机器对局配出来的, 改动后请重新跑一遍,
   * 确认通关率仍然是「从接近 100% 平缓下滑」而不是某关突然掉下去。
   */
  var LEVEL_COUNT = 100;
  var CHAPTER_SIZE = 10;

  // 每 10 关一章, 关卡选择页按章分组, 给小孩一个「又翻过一页」的盼头
  var CHAPTER_NAMES = [
    '初识萌可', '魔法森林', '星光草原', '云朵小镇', '彩虹湖畔',
    '糖果乐园', '月光城堡', '梦境花园', '极光雪原', '萌可王国'
  ];

  // 每章 10 关各自要收集几种角色, 写成图案方便一眼看出节奏。
  // 同章里穿插 1/2/3 种, 相邻关卡的感觉才不会雷同。
  var COLLECT_KINDS = [
    '1111211121',
    '1112112121',
    '1121221221',
    '2122122122',
    '2212232122',
    '2223222322',
    '2232232323',
    '3223232332',
    '3232333233',
    '3233233333'
  ];

  // 一步平均能消掉某个指定角色几个、能拿多少分。这两张表是
  // `node tools/balance.js --calibrate` 实测出来的, 不要凭感觉改。
  //
  // 角色种类少一个, 连锁会猛很多: 5 种时的速率是 6 种的近两倍,
  // 所以「喘息关」用 5 种, 但它的收集量和目标分都得按自己这档算,
  // 否则会变成白送的一关。(4 种更夸张, 一步能消 7 个多, 已经弃用。)
  var YIELD_PER_MOVE = { 5: 2.44, 6: 1.27 };
  var SCORE_PER_MOVE = { 5: 1095, 6: 587 };

  function buildLevels() {
    var levels = [];

    for (var i = 0; i < LEVEL_COUNT; i++) {
      var chapter = Math.floor(i / CHAPTER_SIZE);
      var step = i % CHAPTER_SIZE;
      var t = i / (LEVEL_COUNT - 1);          // 0~1 的总进度

      // 第一章全用 5 种当上手期; 之后每章第 5 关回落一档, 当作喘口气的关卡
      var types = (i < CHAPTER_SIZE || step === 4) ? 5 : 6;

      // 步数整体递减, 每章第一关多给两步, 让新章节开头不至于一上来就紧。
      // 注意收集量要按 baseMoves 算 —— 拿 moves 算的话, 多给的两步会同时
      // 把目标抬高, 白送的两步就没了, 开场关反而成了全章最难的。
      var baseMoves = Math.round(27 - 9 * t);
      var moves = baseMoves + (step === 0 ? 2 : 0);

      // pressure: 预计要用掉多少比例的步数, 也就是这一关有多紧
      var pressure = 0.45 + 0.27 * t;
      var budget = baseMoves * pressure;
      var kinds = parseInt(COLLECT_KINDS[chapter].charAt(step), 10);
      var count = Math.round(budget * YIELD_PER_MOVE[types]);

      // 目标分按预计得分反推: 打得顺手就是 3 星, 勉强收齐是 2 星
      var target = Math.round(budget * SCORE_PER_MOVE[types] * (0.62 + 0.14 * t) / 100) * 100;

      // 起始角色按关卡号轮换, 免得整章都在收集同一只;
      // 同关的几个目标取连续下标, 保证互不重复
      var base = (i * 2 + chapter) % types;
      var collect = [];
      for (var k = 0; k < kinds; k++) {
        collect.push({ type: (base + k) % types, count: count });
      }

      levels.push({ types: types, moves: moves, target: target, collect: collect });
    }

    return levels;
  }

  var LEVELS = buildLevels();

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
    CHAPTER_SIZE: CHAPTER_SIZE,
    CHAPTER_NAMES: CHAPTER_NAMES,
    SPECIAL_LABEL: SPECIAL_LABEL,
    Ease: Ease,
    Anim: Anim,
    Util: Util,
    Storage: Storage,
    assetUrl: assetUrl
  };
})(window);
