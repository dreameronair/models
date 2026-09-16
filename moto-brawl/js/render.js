/*
 * 伪 3D 渲染。
 *
 * 路面: 从最远的一段往回画, 每段是一个梯形。画的时候记住当前画到的最高
 * 屏幕 y(maxy), 比它还低的段直接跳过 —— 这样翻过坡顶时, 坡后面的路会被
 * 坡自然挡住, 不需要任何深度缓冲。
 *
 * 精灵: 反过来从近往远画不行(会盖住路), 所以先画完路, 再由远及近画精灵,
 * 并且用所在路段记下的 clip 值裁掉陷进山坡里的部分。
 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var CONFIG = MB.CONFIG;
  var Util = MB.Util;
  var Sprites = MB.Sprites;
  var project = MB.project;

  /* 各场景的配色。road/grass 有深浅两档, 交替出现形成速度条纹。 */
  var PALETTES = {
    coast: {
      sky: ['#5fc6f0', '#bde9fb'], sun: '#fff3bd', sunPos: 0.7,
      hill: '#7fae86', hillFar: '#a9c9ad',
      grass: ['#6fae5c', '#66a355'], road: ['#4a4e57', '#474b54'],
      rumble: ['#e8e4dc', '#c8453f'], lane: '#e8e4dc', fog: '#bde9fb'
    },
    desert: {
      sky: ['#f0a95f', '#ffe2b0'], sun: '#fff0c0', sunPos: 0.45,
      hill: '#c0925e', hillFar: '#d9b489',
      grass: ['#d8b273', '#d0a869'], road: ['#5a5147', '#564e45'],
      rumble: ['#f3ece0', '#b8562f'], lane: '#f3ece0', fog: '#ffe2b0'
    },
    forest: {
      sky: ['#7fb8d8', '#cfe6ef'], sun: '#fdf6d8', sunPos: 0.25,
      hill: '#3f6f4c', hillFar: '#6b9370',
      grass: ['#3e7a48', '#397043'], road: ['#484c54', '#454951'],
      rumble: ['#e4e0d6', '#9c6b3c'], lane: '#e4e0d6', fog: '#cfe6ef'
    },
    city: {
      sky: ['#1b2140', '#3b3560'], sun: '#f7f0c8', sunPos: 0.8,
      hill: '#252a44', hillFar: '#333a58',
      grass: ['#2b3048', '#282d43'], road: ['#33363f', '#30333c'],
      rumble: ['#d8d4c8', '#c9a13a'], lane: '#d8d4c8', fog: '#3b3560'
    },
    storm: {
      sky: ['#39424f', '#6b7480'], sun: '#c9d2da', sunPos: 0.35,
      hill: '#3c4550', hillFar: '#525c68',
      grass: ['#46534b', '#424e47'], road: ['#3c4046', '#393d43'],
      rumble: ['#cfd4d8', '#7d5a8c'], lane: '#cfd4d8', fog: '#6b7480'
    }
  };

  function Renderer(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.palette = PALETTES[track.def.scene] || PALETTES.coast;
    this.cameraDepth = MB.cameraDepthFor(CONFIG.fieldOfView);
    this.playerZ = CONFIG.cameraHeight * this.cameraDepth;
    this.skyOffset = 0;
    this.hillOffset = 0;
    this.shake = 0;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.dpr = dpr;
  };

  /** 天空随弯道缓慢横移, 制造「在转弯」的错觉。 */
  Renderer.prototype.updateParallax = function (dt, curve, speedPercent) {
    this.skyOffset += curve * speedPercent * dt * 0.6;
    this.hillOffset += curve * speedPercent * dt * 2.4;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
  };

  Renderer.prototype.addShake = function (amount) {
    this.shake = Math.min(1, this.shake + amount);
  };

  /* ------------------------------------------------------------------ */

  Renderer.prototype.render = function (race, time) {
    var ctx = this.ctx;
    var width = this.width;
    var height = this.height;
    var track = this.track;
    var segments = track.segments;
    var pal = this.palette;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 14 * this.shake,
                    (Math.random() - 0.5) * 10 * this.shake);
    }

    var player = race.player;
    var position = player.z;
    var playerX = player.x;

    var baseSegment = track.segmentAt(position);
    var basePercent = (position % CONFIG.segmentLength) / CONFIG.segmentLength;
    var playerSegment = track.segmentAt(position + this.playerZ);
    var playerPercent = ((position + this.playerZ) % CONFIG.segmentLength)
      / CONFIG.segmentLength;
    var playerY = Util.interpolate(playerSegment.p1.world.y,
      playerSegment.p2.world.y, playerPercent);

    this.drawSky(ctx, width, height, pal);
    this.drawHills(ctx, width, height, pal, playerY);

    var maxy = height;
    var x = 0;
    var dx = -(baseSegment.curve * basePercent);
    var n, segment;
    var trackLength = track.totalLength();

    /* ---- 路面: 由远及近 ---- */
    for (n = 0; n < CONFIG.drawDistance; n++) {
      segment = segments[(baseSegment.index + n) % segments.length];
      segment.looped = segment.index < baseSegment.index;
      // 越远越淡, 平方衰减比线性看着自然
      var t = n / CONFIG.drawDistance;
      segment.fog = 1 / Math.exp(CONFIG.fogDensity * t * t);
      segment.clip = maxy;

      project(segment.p1, (playerX * CONFIG.roadWidth) - x,
        playerY + CONFIG.cameraHeight,
        position - (segment.looped ? trackLength : 0),
        this.cameraDepth, width, height, CONFIG.roadWidth);
      project(segment.p2, (playerX * CONFIG.roadWidth) - x - dx,
        playerY + CONFIG.cameraHeight,
        position - (segment.looped ? trackLength : 0),
        this.cameraDepth, width, height, CONFIG.roadWidth);

      x += dx;
      dx += segment.curve;

      if (segment.p1.camera.z <= this.cameraDepth) continue;
      if (segment.p2.screen.y >= segment.p1.screen.y) continue;
      if (segment.p2.screen.y >= maxy) continue;

      this.drawSegment(ctx, width, segment, pal);
      maxy = segment.p2.screen.y;
    }

    /* ---- 精灵: 由远及近盖上去 ---- */
    for (n = CONFIG.drawDistance - 1; n > 0; n--) {
      segment = segments[(baseSegment.index + n) % segments.length];
      this.drawSegmentSprites(ctx, segment, race, time);
    }

    this.drawPlayer(ctx, width, height, race, playerSegment, time);

    ctx.restore();
  };

  /* ---------------- 背景 ---------------- */

  Renderer.prototype.drawSky = function (ctx, width, height, pal) {
    var grad = ctx.createLinearGradient(0, 0, 0, height * 0.62);
    grad.addColorStop(0, pal.sky[0]);
    grad.addColorStop(1, pal.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 太阳/月亮。横向随弯道飘, 但不出屏幕
    var sx = (((this.skyOffset * 0.02 + pal.sunPos) % 1) + 1) % 1;
    ctx.fillStyle = pal.sun;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(sx * width, height * 0.2, Math.min(width, height) * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawHills = function (ctx, width, height, pal, playerY) {
    // 远山跟着高度上下浮动, 冲坡时地平线才会跟着动
    var horizon = height * 0.58 - playerY * 0.00018 * height;
    var off = this.hillOffset * 0.6;

    ctx.fillStyle = pal.hillFar;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (var i = 0; i <= 12; i++) {
      var px = (i / 12) * width;
      var h = 34 + Math.sin(i * 1.7 + off * 0.01) * 22 + Math.sin(i * 0.6) * 14;
      ctx.lineTo(px, horizon - h);
    }
    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = pal.hill;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (i = 0; i <= 9; i++) {
      px = (i / 9) * width;
      h = 18 + Math.sin(i * 2.3 + off * 0.016 + 1.2) * 16;
      ctx.lineTo(px, horizon - h);
    }
    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();
  };

  /* ---------------- 路面 ---------------- */

  Renderer.prototype.drawSegment = function (ctx, width, segment, pal) {
    var p1 = segment.p1.screen;
    var p2 = segment.p2.screen;
    var i = segment.dark ? 1 : 0;

    // 草地铺满整条横带
    ctx.fillStyle = pal.grass[i];
    ctx.fillRect(0, p2.y, width, p1.y - p2.y);

    var rumbleW1 = p1.w / 5;
    var rumbleW2 = p2.w / 5;
    var laneW1 = p1.w / 28;
    var laneW2 = p2.w / 28;

    // 路肩
    poly(ctx, p1.x - p1.w - rumbleW1, p1.y, p1.x - p1.w, p1.y,
      p2.x - p2.w, p2.y, p2.x - p2.w - rumbleW2, p2.y, pal.rumble[i]);
    poly(ctx, p1.x + p1.w + rumbleW1, p1.y, p1.x + p1.w, p1.y,
      p2.x + p2.w, p2.y, p2.x + p2.w + rumbleW2, p2.y, pal.rumble[i]);

    // 路面
    poly(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y,
      p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, pal.road[i]);

    // 车道线只在浅色段画, 形成虚线
    if (!segment.dark) {
      var lanes = CONFIG.lanes;
      var lw1 = p1.w * 2 / lanes;
      var lw2 = p2.w * 2 / lanes;
      var lx1 = p1.x - p1.w + lw1;
      var lx2 = p2.x - p2.w + lw2;
      for (var l = 1; l < lanes; l++) {
        poly(ctx, lx1 - laneW1, p1.y, lx1 + laneW1, p1.y,
          lx2 + laneW2, p2.y, lx2 - laneW2, p2.y, pal.lane);
        lx1 += lw1;
        lx2 += lw2;
      }
    }

    // 起终点线
    if (segment.marker) {
      ctx.fillStyle = segment.marker === 1 ? '#ffffff' : '#111111';
      poly(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y,
        p2.x + p2.w, p2.y, p2.x - p2.w, p2.y,
        segment.marker === 1 ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,20,0.75)');
    }

    // 雾: 越远越接近天色
    if (segment.fog < 1) {
      ctx.globalAlpha = 1 - segment.fog;
      ctx.fillStyle = pal.fog;
      ctx.fillRect(0, p2.y, width, p1.y - p2.y);
      ctx.globalAlpha = 1;
    }
  };

  function poly(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- 精灵 ---------------- */

  /**
   * 把「路面横向比例 offset + 所在路段」换算成屏幕位置和缩放。
   * percent 是在这一段里的进度, 用来在两个端点之间插值。
   */
  Renderer.prototype.locate = function (segment, offset, percent) {
    var p1 = segment.p1.screen;
    var p2 = segment.p2.screen;
    var scale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, percent);
    var x = Util.interpolate(p1.x, p2.x, percent);
    var y = Util.interpolate(p1.y, p2.y, percent);
    var w = Util.interpolate(p1.w, p2.w, percent);
    return { x: x + w * offset, y: y, scale: scale, w: w };
  };

  Renderer.prototype.drawSegmentSprites = function (ctx, segment, race, time) {
    if (!segment.p1.screen.scale) return;
    var self = this;
    var clip = segment.clip;
    var i;

    // 路边景物
    for (i = 0; i < segment.props.length; i++) {
      var prop = segment.props[i];
      var spot = this.locate(segment, prop.offset, 0.5);
      this.stamp(ctx, spot, clip, segment.fog, prop.scale * 2.1, function (c) {
        Sprites.drawProp(c, prop.kind, prop.dir);
      });
    }

    var segStart = segment.index * CONFIG.segmentLength;
    var trackLength = this.track.totalLength();

    // 钢管
    for (i = 0; i < race.pickups.length; i++) {
      var item = race.pickups[i];
      if (item.taken) continue;
      if (!inSegment(item.z, segStart)) continue;
      var pspot = this.locate(segment, item.x, percentIn(item.z, segStart));
      this.stamp(ctx, pspot, clip, segment.fog, 0.55, function (c) {
        Sprites.drawPickup(c, time);
      });
    }

    // 交通车
    for (i = 0; i < race.traffic.length; i++) {
      var car = race.traffic[i];
      if (!inSegment(car.z, segStart)) continue;
      var cspot = this.locate(segment, car.x, percentIn(car.z, segStart));
      this.stamp(ctx, cspot, clip, segment.fog, 1.0, function (c) {
        Sprites.drawCar(c, car.kind);
      });
    }

    // 对手。用绕回后的 z 去比对, 多圈赛道才不会漏画
    for (i = 1; i < race.riders.length; i++) {
      var rider = race.riders[i];
      var rz = ((rider.z % trackLength) + trackLength) % trackLength;
      if (!inSegment(rz, segStart)) continue;
      var rspot = this.locate(segment, rider.x, percentIn(rz, segStart));
      this.stamp(ctx, rspot, clip, segment.fog, 0.95, function (c) {
        Sprites.drawRider(c, {
          color: rider.color, lean: rider.lean, attack: rider.attack,
          down: rider.isDown(), flash: rider.flash, weapon: rider.weapon
        });
      });
      // 血条: 只在打得到的距离内显示, 免得满屏都是条
      if (!rider.isDown()) {
        this.healthBar(ctx, rspot, rider, clip);
      }
    }
  };

  function inSegment(z, segStart) {
    return z >= segStart && z < segStart + CONFIG.segmentLength;
  }

  function percentIn(z, segStart) {
    return (z - segStart) / CONFIG.segmentLength;
  }

  /**
   * 把一个局部坐标里画好的东西盖到屏幕上。
   *
   * 缩放基准是 spot.w —— 也就是这一段路投影之后的半宽(像素)。用它而不是
   * 原始的 screen.scale, 是因为它已经把视角、距离、画布宽度都算进去了:
   * 同一个东西不管远近, 相对路面的大小始终一致, 换分辨率也不用重新调。
   * 0.0025 是标定出来的系数, 让 sizeScale=1 差不多是一辆小汽车的大小。
   */
  Renderer.prototype.stamp = function (ctx, spot, clip, fog, sizeScale, draw) {
    var scale = spot.w * sizeScale * 0.0025;
    if (scale <= 0.004) return;          // 太小了就别画, 省得白算一堆路径
    if (spot.y > this.height + 200) return;

    ctx.save();
    // 被前面的坡挡住的部分要裁掉, 不然景物会浮在山体上
    if (clip < this.height) {
      ctx.beginPath();
      ctx.rect(0, 0, this.width, clip);
      ctx.clip();
    }
    ctx.translate(spot.x, spot.y);
    ctx.scale(scale, scale);
    if (fog < 1) ctx.globalAlpha = Math.max(0, fog);
    draw(ctx);
    ctx.restore();
  };

  Renderer.prototype.healthBar = function (ctx, spot, rider, clip) {
    var w = spot.w * 0.16;
    if (w < 16) return;                  // 太远了就不显示, 免得满屏小条
    var h = Math.max(4, w * 0.13);
    var y = spot.y - spot.w * 0.28;
    if (y > clip) return;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(spot.x - w / 2, y, w, h);
    var pct = Util.clamp(rider.health / CONFIG.maxHealth, 0, 1);
    ctx.fillStyle = pct > 0.5 ? '#5cd16b' : (pct > 0.22 ? '#e8c53a' : '#e8503a');
    ctx.fillRect(spot.x - w / 2 + 1, y + 1, (w - 2) * pct, h - 2);
    ctx.restore();
  };

  /* ---------------- 玩家 ---------------- */

  Renderer.prototype.drawPlayer = function (ctx, width, height, race, playerSegment, time) {
    var player = race.player;
    var pct = player.speedPercent();

    // 车固定画在屏幕下方。速度越快抖得越明显, 摔车时沉下去
    var bounce = Math.sin(time * 22) * 1.6 * pct * (1 - player.speedPercent() * 0.3);
    var baseY = height * 0.88 + bounce;
    var scale = width * 0.5 * 0.0042;

    ctx.save();
    ctx.translate(width / 2 + player.lean * width * 0.02, baseY);
    ctx.scale(scale, scale);
    Sprites.drawRider(ctx, {
      color: player.color,
      lean: player.lean,
      attack: player.attack,
      down: player.isDown(),
      flash: player.flash,
      weapon: player.weapon,
      brake: race.__braking
    });
    ctx.restore();

    // 高速时的速度线。从消失点往外甩, 但只画屏幕边缘那一圈 ——
    // 画到中间会糊住路面, 看着像划痕
    if (pct > 0.62) {
      var amount = (pct - 0.62) / 0.38;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      var cx = width / 2;
      var cy = height * 0.56;
      for (var i = 0; i < 14; i++) {
        // 每条线有自己的相位, 循环着往外飞
        var a = (i / 14) * Math.PI * 2 + i * 1.7;
        var phase = (time * (1.1 + (i % 3) * 0.25) + i * 0.37) % 1;
        var r0 = width * (0.34 + phase * 0.5);
        var r1 = r0 + width * 0.07 * amount;
        // 越靠外越明显, 靠近中心的直接不画
        ctx.globalAlpha = amount * 0.42 * Math.min(1, phase * 2.2);
        ctx.lineWidth = 1.5 + amount * 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.62);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.62);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  MB.Renderer = Renderer;
  MB.PALETTES = PALETTES;
})(typeof window !== 'undefined' ? window : this);
