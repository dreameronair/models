/*
 * 赛道: 分段生成 + 伪 3D 投影。
 *
 * 赛道被切成一段段等长的路面(segment), 每段记录自己的世界坐标、弯曲度、
 * 路肩颜色和挂在上面的景物。渲染时把每段的两个端点投影到屏幕, 画成一个
 * 梯形, 从远往近盖过去 —— 这样上坡时远处的路自然会被近处的挡住。
 *
 * 本文件是纯逻辑, 不碰 DOM 和 Canvas, 可以直接在 Node 里跑测试。
 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var CONFIG = MB.CONFIG;
  var Util = MB.Util;
  var Rng = MB.Rng;

  /* 弯道与坡道的强度档位 */
  var CURVE = { none: 0, easy: 2, medium: 4, hard: 6 };
  var HILL = { none: 0, low: 20, medium: 40, high: 60 };
  var LEN = { short: 25, medium: 50, long: 100 };

  function Track(def) {
    this.def = def;
    this.segments = [];
    this.props = [];       // 路边景物, 挂在 segment 上
    this.build();
  }

  Track.prototype.segmentCount = function () { return this.segments.length; };

  Track.prototype.totalLength = function () {
    return this.segments.length * CONFIG.segmentLength;
  };

  /** 取某个世界 z 所在的那一段。z 会自动绕回起点, 支持多圈。 */
  Track.prototype.segmentAt = function (z) {
    var total = this.totalLength();
    var wrapped = ((z % total) + total) % total;
    var index = Math.floor(wrapped / CONFIG.segmentLength) % this.segments.length;
    return this.segments[index];
  };

  Track.prototype.lastY = function () {
    return this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0;
  };

  /**
   * 铺一段路。enter/hold/leave 是进弯、持弯、出弯的段数,
   * curve 是弯曲度(正右负左), y 是这一段结束时的高度。
   */
  Track.prototype.addRoad = function (enter, hold, leave, curve, y) {
    var startY = this.lastY();
    var endY = startY + y;
    var total = enter + hold + leave;
    var i;

    for (i = 0; i < enter; i++) {
      this.addSegment(Util.easeIn(0, curve, i / enter),
        Util.easeInOut(startY, endY, i / total));
    }
    for (i = 0; i < hold; i++) {
      this.addSegment(curve, Util.easeInOut(startY, endY, (enter + i) / total));
    }
    for (i = 0; i < leave; i++) {
      this.addSegment(Util.easeInOut(curve, 0, i / leave),
        Util.easeInOut(startY, endY, (enter + hold + i) / total));
    }
  };

  Track.prototype.addSegment = function (curve, y) {
    var n = this.segments.length;
    this.segments.push({
      index: n,
      p1: { world: { x: 0, y: this.lastY(), z: n * CONFIG.segmentLength },
            camera: {}, screen: {} },
      p2: { world: { x: 0, y: y, z: (n + 1) * CONFIG.segmentLength },
            camera: {}, screen: {} },
      curve: curve,
      // 每 rumbleLength 段换一次深浅, 跑起来才有速度感
      dark: Math.floor(n / CONFIG.rumbleLength) % 2 === 1,
      props: [],
      cars: [],
      // 起点/终点线
      marker: 0,
      clip: 0
    });
  };

  /** 按赛道定义随机铺出整条路。同一个 seed 结果完全一致。 */
  Track.prototype.build = function () {
    var def = this.def;
    var rng = new Rng(def.seed);
    this.segments = [];

    // 开头留一段直路, 让玩家有时间起步
    this.addRoad(LEN.short, LEN.short, LEN.short, 0, 0);

    var curviness = def.curviness === undefined ? 1 : def.curviness;
    var hilliness = def.hilliness === undefined ? 1 : def.hilliness;

    while (this.segments.length < def.length) {
      var roll = rng.next();
      var enter = rng.pick([LEN.short, LEN.medium, LEN.long]);
      var hold = rng.pick([LEN.short, LEN.medium]);
      var leave = rng.pick([LEN.short, LEN.medium]);
      var curve = 0;
      var hill = 0;

      if (roll < 0.28) {
        // 直路
      } else if (roll < 0.72) {
        curve = rng.pick([CURVE.easy, CURVE.medium, CURVE.hard]) * curviness;
        if (rng.chance(0.5)) curve = -curve;
      } else {
        curve = rng.pick([CURVE.easy, CURVE.medium]) * curviness;
        if (rng.chance(0.5)) curve = -curve;
      }
      // 夹住弯道上限。curviness 大于 1 的赛道原本会造出转向根本压不住的弯,
      // 那不是难度, 是必然被甩出赛道。夹完之后 curviness 的作用变成
      // 「急弯更密」而不是「急弯更离谱」。
      curve = Util.clamp(curve, -CONFIG.maxCurve, CONFIG.maxCurve);

      if (rng.chance(0.55)) {
        hill = rng.pick([HILL.low, HILL.medium, HILL.high]) * hilliness;
        if (rng.chance(0.5)) hill = -hill;
      }

      this.addRoad(enter, hold, leave, curve, hill);
    }

    // 结尾拉平, 免得冲线时镜头在半空
    this.addRoad(LEN.medium, LEN.medium, LEN.medium, 0, -this.lastY());

    this.markLines();
    this.scatterProps(rng);
  };

  /** 起点线和终点线。marker: 1 起点, 2 终点。 */
  Track.prototype.markLines = function () {
    var i;
    for (i = 0; i < 4 && i < this.segments.length; i++) {
      this.segments[i].marker = 1;
    }
    for (i = this.segments.length - 6; i < this.segments.length; i++) {
      if (i >= 0) this.segments[i].marker = 2;
    }
  };

  /**
   * 撒路边景物。offset 是横向位置(1 就是路边缘, 大于 1 在路外),
   * kind 交给渲染层去画成树、路灯、仙人掌还是楼。
   */
  Track.prototype.scatterProps = function (rng) {
    var kinds = SCENE_PROPS[this.def.scene] || SCENE_PROPS.coast;
    var n = this.segments.length;

    for (var i = 20; i < n - 20; i++) {
      var seg = this.segments[i];
      // 疏密交替, 全程等间距会很假
      if (!rng.chance(0.16)) continue;

      var side = rng.chance(0.5) ? -1 : 1;
      var offset = side * rng.range(1.25, 3.4);
      seg.props.push({
        kind: rng.pick(kinds),
        offset: offset,
        scale: rng.range(0.8, 1.45)
      });
    }

    // 弯道外侧补一排, 提前提示弯向
    for (i = 20; i < n - 20; i++) {
      var s = this.segments[i];
      if (Math.abs(s.curve) < 2.5) continue;
      if (i % 5 !== 0) continue;
      s.props.push({
        kind: 'sign',
        offset: s.curve > 0 ? -1.18 : 1.18,
        scale: 1,
        dir: s.curve > 0 ? 1 : -1
      });
    }
  };

  var SCENE_PROPS = {
    coast: ['palm', 'palm', 'rock', 'lamp'],
    desert: ['cactus', 'cactus', 'rock', 'rock'],
    forest: ['pine', 'pine', 'pine', 'bush'],
    city: ['building', 'building', 'lamp', 'lamp'],
    storm: ['pine', 'rock', 'lamp', 'bush']
  };

  /* ------------------------------------------------------------------ *
   * 投影
   * ------------------------------------------------------------------ */

  /**
   * 把一个世界坐标点投到屏幕。
   * cameraDepth 由视角算出, 越大看着越"长焦"。
   */
  function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    // z 落到相机后面时投影会翻转, 夹一个很小的正数挡住
    var cz = p.camera.z <= 0.1 ? 0.1 : p.camera.z;
    p.screen.scale = cameraDepth / cz;
    p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
    p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
    p.screen.w = Math.round(p.screen.scale * roadWidth * width / 2);
    return p;
  }

  function cameraDepthFor(fieldOfView) {
    return 1 / Math.tan((fieldOfView / 2) * Math.PI / 180);
  }

  MB.Track = Track;
  MB.project = project;
  MB.cameraDepthFor = cameraDepthFor;
  MB.CURVE = CURVE;
  MB.HILL = HILL;
  MB.SEG_LEN = LEN;
})(typeof window !== 'undefined' ? window : this);
