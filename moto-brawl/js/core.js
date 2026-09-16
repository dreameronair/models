/*
 * 《铁骑狂飙》全局配置、数学工具与本地存档。
 *
 * 这是一款原创的摩托格斗竞速游戏: 一边跑圈一边把对手打下车。
 * 玩法类型参考经典街机摩托格斗游戏, 但赛道、车手、涂装、音效全部是
 * 本仓库自己生成的, 没有使用任何第三方美术或音频资源。
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /* ---- 赛道几何 ---- */
    segmentLength: 200,      // 一段赛道的世界长度
    rumbleLength: 3,         // 几段拼成一条路肩条纹
    roadWidth: 2000,         // 路面半宽
    lanes: 3,
    drawDistance: 300,       // 往前画多少段
    fieldOfView: 100,        // 视角(度)
    cameraHeight: 1000,
    fogDensity: 4,

    /* ---- 车辆性能 ---- */
    maxSpeed: 12000,         // 世界单位/秒
    accel: 3800,
    braking: -11000,
    decel: -1700,            // 松油门自然减速
    offRoadDecel: -3600,
    offRoadLimit: 4200,      // 草地上的极速
    // 离心力与转向力必须是可比的: 转向每帧给 dx, 离心力给 dx*pct*curve*centrifugal,
    // 两者之比就是 pct*curve*centrifugal。配上下面的 maxCurve(6.5), 满速过最急的
    // 弯时比值是 0.975 —— 方向打满刚好压得住(留了点余量), 松一点油门就轻松,
    // 这才叫「难」。比值一旦过 1, 长弯里再怎么打方向都会被慢慢推出赛道。
    // 之前 centrifugal 是 0.32, 比值 2.6, 等于无论如何都会被甩出赛道。
    centrifugal: 0.15,       // 过弯被甩出去的力度
    steerSpeed: 2.6,         // 每秒能横移几个路宽
    maxCurve: 6.5,           // 单段弯道的上限, 再急就不讲道理了

    /* ---- 战斗 ---- */
    reach: 520,              // 出手够得着的纵向距离
    reachLateral: 0.42,      // 够得着的横向距离(路宽的比例)
    punchDamage: 12,
    kickDamage: 19,
    punchCooldown: 0.34,
    kickCooldown: 0.62,
    weaponBonus: 14,         // 捡到钢管后的额外伤害
    weaponUses: 12,
    maxHealth: 100,
    hitShove: 0.16,          // 挨打时被推开多少
    knockdownTime: 2.6,      // 摔车后爬起来要多久

    /* ---- 其它 ---- */
    trafficSpeed: 3200,
    rivalCount: 5
  };

  // 十二位对手车手。名字、涂装、脾气都是原创的。
  // aggression 越高越爱动手, skill 越高跑得越快, bulk 越高越抗揍。
  var RIDERS = [
    { name: '铁猴子', color: '#e8503a', skill: 0.72, aggression: 0.55, bulk: 0.9 },
    { name: '夜猫子', color: '#3aa0e8', skill: 0.76, aggression: 0.40, bulk: 0.8 },
    { name: '大扳手', color: '#f0a92b', skill: 0.70, aggression: 0.80, bulk: 1.3 },
    { name: '闪电婆', color: '#c86ae8', skill: 0.84, aggression: 0.45, bulk: 0.7 },
    { name: '老烟枪', color: '#7d8a99', skill: 0.66, aggression: 0.70, bulk: 1.2 },
    { name: '花衬衫', color: '#2fc08a', skill: 0.74, aggression: 0.50, bulk: 0.9 },
    { name: '钉子户', color: '#b5502f', skill: 0.80, aggression: 0.85, bulk: 1.4 },
    { name: '小旋风', color: '#e8d84a', skill: 0.88, aggression: 0.35, bulk: 0.6 },
    { name: '黑手套', color: '#5a5f75', skill: 0.82, aggression: 0.75, bulk: 1.1 },
    { name: '断头台', color: '#d4374f', skill: 0.86, aggression: 0.90, bulk: 1.5 },
    { name: '风筝哥', color: '#49c7d6', skill: 0.90, aggression: 0.55, bulk: 0.8 },
    { name: '疯婆子', color: '#ef7fb0', skill: 0.92, aggression: 0.95, bulk: 1.0 }
  ];

  /*
   * 五条赛道。seed 决定路形(同一个 seed 永远生成同一条路, 方便复现和测试),
   * length 是段数, reward 是冠军奖金。
   *
   * rivalSkill 是这条赛道的整体节奏, 直接乘在对手极速上。数值不是拍脑袋,
   * 是照着「这条赛道预期骑哪台车」反推的 —— 前两条用起步车, 中间两条换
   * 重机车, 最后一条上刀锋, 让对手速度相对当前座驾逐条走高。第三条跳一下
   * 是因为刚换车, 正好让买车立刻有获得感。跑 npm run balance 复核。
   * rivalRage 是他们多爱动手。
   */
  var TRACKS = [
    {
      id: 'coast', name: '海岸公路', scene: 'coast',
      seed: 10704, length: 2600, laps: 1,
      curviness: 0.6, hilliness: 0.5, traffic: 0.35,
      rivalSkill: 0.90, rivalRage: 0.5, reward: 1000,
      desc: '路宽弯缓，适合先摸清油门和拳头。'
    },
    {
      id: 'desert', name: '戈壁国道', scene: 'desert',
      seed: 31337, length: 3200, laps: 1,
      curviness: 0.85, hilliness: 1.0, traffic: 0.5,
      rivalSkill: 0.96, rivalRage: 0.65, reward: 1600,
      desc: '起伏大，冲坡时看不见前面有没有车。'
    },
    {
      id: 'forest', name: '盘山林道', scene: 'forest',
      seed: 52011, length: 3600, laps: 1,
      curviness: 1.35, hilliness: 0.8, traffic: 0.55,
      rivalSkill: 1.12, rivalRage: 0.75, reward: 2400,
      desc: '连续急弯，甩出去就是一头栽进树里。'
    },
    {
      id: 'city', name: '午夜城区', scene: 'city',
      seed: 74203, length: 4000, laps: 1,
      curviness: 1.0, hilliness: 0.45, traffic: 0.95,
      rivalSkill: 1.12, rivalRage: 0.85, reward: 3400,
      desc: '车流密得像下饺子，对手还专挑这种地方动手。'
    },
    {
      id: 'storm', name: '暴雨山口', scene: 'storm',
      seed: 90617, length: 4600, laps: 1,
      curviness: 1.5, hilliness: 1.2, traffic: 0.7,
      rivalSkill: 1.52, rivalRage: 1.0, reward: 5000,
      desc: '又湿又滑又黑，最后一条路，谁都不让谁。'
    }
  ];

  /*
   * 三台可买的车。加速、极速、抗揍各有取舍, 不存在全面碾压的一台。
   */
  var BIKES = [
    {
      id: 'scrap', name: '拼装车', price: 0, color: '#8b8f98',
      topSpeed: 0.86, accel: 1.0, grip: 1.0, armor: 1.0,
      desc: '东拼西凑的起步车，胜在轻快好拐。'
    },
    {
      id: 'cruiser', name: '重机车', price: 2600, color: '#2f6fd0',
      topSpeed: 1.0, accel: 0.88, grip: 0.92, armor: 1.35,
      desc: '又沉又快，撞人吃亏的是对方。'
    },
    {
      id: 'blade', name: '刀锋', price: 5800, color: '#d63a52',
      topSpeed: 1.12, accel: 1.18, grip: 1.1, armor: 0.85,
      desc: '快得离谱，但摔一下就够你喝一壶。'
    }
  ];

  /* ------------------------------------------------------------------ *
   * 数学与随机
   * ------------------------------------------------------------------ */

  var Util = {
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },

    lerp: function (a, b, t) { return a + (b - a) * t; },

    // 缓入缓出, 用来做弯道和坡道的过渡段
    easeIn: function (a, b, p) { return a + (b - a) * Math.pow(p, 2); },
    easeOut: function (a, b, p) { return a + (b - a) * (1 - Math.pow(1 - p, 2)); },
    easeInOut: function (a, b, p) {
      return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
    },

    // 把百分比映射到区间, 常用于「速度越快抖得越厉害」这类
    interpolate: function (lo, hi, p) { return lo + (hi - lo) * p; },

    percent: function (v, max) { return max ? v / max : 0; },

    formatTime: function (seconds) {
      if (!isFinite(seconds) || seconds < 0) seconds = 0;
      var m = Math.floor(seconds / 60);
      var s = Math.floor(seconds % 60);
      var cs = Math.floor((seconds * 100) % 100);
      return m + ':' + (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
    },

    ordinal: function (n) { return ['第一', '第二', '第三', '第四', '第五', '第六',
      '第七', '第八', '第九', '第十'][n - 1] || ('第' + n); }
  };

  /*
   * 可复现的伪随机数(mulberry32)。赛道、路边景物、交通车全都走这个,
   * 所以同一条赛道每次生成的路形完全一样 —— 玩家能背路, 测试也能断言。
   */
  function Rng(seed) {
    this.state = (seed >>> 0) || 1;
  }

  Rng.prototype.next = function () {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    var t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  Rng.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };

  Rng.prototype.int = function (lo, hi) { return Math.floor(this.range(lo, hi + 1)); };

  Rng.prototype.pick = function (arr) { return arr[this.int(0, arr.length - 1)]; };

  Rng.prototype.chance = function (p) { return this.next() < p; };

  /* ------------------------------------------------------------------ *
   * 存档
   * ------------------------------------------------------------------ */

  var Storage = {
    key: 'moto-brawl-v1',

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
      } catch (e) { /* 无痕模式下忽略 */ }
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

  global.MB = {
    CONFIG: CONFIG,
    RIDERS: RIDERS,
    TRACKS: TRACKS,
    BIKES: BIKES,
    Util: Util,
    Rng: Rng,
    Storage: Storage
  };
})(typeof window !== 'undefined' ? window : this);
