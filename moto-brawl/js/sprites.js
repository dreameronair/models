/*
 * 程序化美术。整个游戏一张图片素材都不用, 车手、摩托、汽车、路边景物
 * 全是这里用 Canvas 路径当场画出来的原创造型。
 *
 * 好处有两个: 一是随便缩放都不糊(伪 3D 里同一辆车从远到近要放大十几倍),
 * 二是颜色能按车手换, 十二个对手不用各画一张图。
 *
 * 约定: 每个 draw* 函数都在「以 (0,0) 为脚下中心、向上为负 y」的局部坐标里
 * 画一个高度约 100 单位的东西, 由调用方 translate + scale 到屏幕上。
 */
(function (global) {
  'use strict';

  var MB = global.MB;

  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) {
      r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount;
    } else {
      r *= (1 + amount); g *= (1 + amount); b *= (1 + amount);
    }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   * 车手 + 摩托(背面视角)
   * ------------------------------------------------------------------ */

  /**
   * opts:
   *   color   车身/骑手服颜色
   *   lean    -1~1 倾斜
   *   attack  null 或 { side:-1|1, kind:'punch'|'kick', t }
   *   down    true 表示摔在地上
   *   flash   >0 时闪白(刚挨打)
   *   weapon  >0 时手里有钢管
   *   shadow  是否画地面投影
   */
  function drawRider(ctx, opts) {
    var color = opts.color || '#e8503a';
    var lean = Math.max(-1, Math.min(1, opts.lean || 0));

    ctx.save();

    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 2, 30, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (opts.down) {
      drawWipeout(ctx, color);
      ctx.restore();
      return;
    }

    // 整体随倾斜歪一点, 转向时看得出在压弯
    ctx.rotate(lean * 0.16);
    ctx.translate(lean * 5, 0);

    var dark = shade(color, -0.4);
    var light = shade(color, 0.25);

    /* --- 后轮 --- */
    ctx.fillStyle = '#1d1f26';
    roundRect(ctx, -9, -30, 18, 30, 7);
    ctx.fill();
    ctx.fillStyle = '#3b3f4a';
    roundRect(ctx, -5, -24, 10, 14, 4);
    ctx.fill();

    /* --- 排气管 --- */
    ctx.fillStyle = '#9aa3b0';
    roundRect(ctx, -22, -26, 9, 7, 3);
    ctx.fill();
    roundRect(ctx, 13, -26, 9, 7, 3);
    ctx.fill();

    /* --- 车身 --- */
    ctx.fillStyle = dark;
    roundRect(ctx, -16, -52, 32, 26, 8);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, -13, -50, 26, 20, 7);
    ctx.fill();

    // 尾灯。刹车时整块亮起来, 跟在后面的人看得见
    ctx.fillStyle = opts.brake ? '#ff4b4b' : '#8c2b2b';
    roundRect(ctx, -7, -46, 14, 5, 2);
    ctx.fill();
    if (opts.brake) {
      ctx.fillStyle = 'rgba(255,90,80,0.35)';
      roundRect(ctx, -13, -49, 26, 11, 4);
      ctx.fill();
    }

    /* --- 车把与后视镜: 从背后看就是两端翘出去的横杆 --- */
    ctx.strokeStyle = '#6f7683';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-26, -66);
    ctx.lineTo(26, -66);
    ctx.stroke();
    ctx.fillStyle = '#3b3f4a';
    roundRect(ctx, -32, -78, 9, 7, 3);
    ctx.fill();
    roundRect(ctx, 23, -78, 9, 7, 3);
    ctx.fill();

    /* --- 腿 --- */
    var kickSide = (opts.attack && opts.attack.kind === 'kick') ? opts.attack.side : 0;
    ctx.fillStyle = shade(color, -0.55);
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      if (s === kickSide) {
        // 踢腿: 整条腿横着伸出去
        ctx.translate(s * 14, -44);
        ctx.rotate(s * 1.15);
        roundRect(ctx, -5, -4, 30, 9, 4);
        ctx.fill();
        ctx.fillStyle = '#23262e';
        roundRect(ctx, 24, -5, 10, 11, 4);   // 靴子
        ctx.fill();
        ctx.fillStyle = shade(color, -0.55);
      } else {
        roundRect(ctx, s * 9 - 5, -50, 10, 22, 4);
        ctx.fill();
      }
      ctx.restore();
    }

    /* --- 躯干 --- */
    ctx.fillStyle = shade(color, -0.15);
    roundRect(ctx, -13, -78, 26, 30, 9);
    ctx.fill();
    // 背后的号码布。压暗一点, 不然缩小之后像块白斑
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = light;
    roundRect(ctx, -6, -73, 12, 13, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* --- 手臂 --- */
    var punchSide = (opts.attack && opts.attack.kind === 'punch') ? opts.attack.side : 0;
    ctx.fillStyle = shade(color, -0.3);
    for (s = -1; s <= 1; s += 2) {
      ctx.save();
      if (s === punchSide) {
        // 出拳: 手臂横向打直
        ctx.translate(s * 11, -70);
        ctx.rotate(s * 1.4);
        roundRect(ctx, -4, -4, 26, 8, 4);
        ctx.fill();
        ctx.fillStyle = '#f0c9a4';
        ctx.beginPath();
        ctx.arc(24, 0, 6, 0, Math.PI * 2);   // 拳头
        ctx.fill();
        if (opts.weapon > 0) {
          ctx.fillStyle = '#b9c0cc';         // 钢管
          roundRect(ctx, 20, -3, 22, 6, 3);
          ctx.fill();
        }
        ctx.fillStyle = shade(color, -0.3);
      } else {
        ctx.translate(s * 11, -72);
        ctx.rotate(s * 0.45);
        roundRect(ctx, -4, -2, 8, 22, 4);
        ctx.fill();
      }
      ctx.restore();
    }

    /* --- 头盔 --- */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -86, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.45);
    roundRect(ctx, -11, -88, 22, 7, 3);       // 帽檐
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-4, -90, 4, 0, Math.PI * 2);      // 高光
    ctx.fill();

    // 刚挨打: 整体闪一下白
    if (opts.flash > 0) {
      ctx.globalAlpha = Math.min(0.75, opts.flash * 4);
      ctx.fillStyle = '#fff';
      roundRect(ctx, -18, -98, 36, 98, 12);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /** 摔车: 人车分离躺一地。 */
  function drawWipeout(ctx, color) {
    ctx.save();
    ctx.translate(0, -14);
    ctx.rotate(-0.5);

    ctx.fillStyle = '#1d1f26';
    roundRect(ctx, -30, -8, 26, 16, 7);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, -12, -10, 30, 18, 7);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.3);
    roundRect(ctx, 14, -6, 20, 11, 5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(34, -2, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // 扬起的尘土
    ctx.fillStyle = 'rgba(210,200,185,0.5)';
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-26 + i * 16, -6 - (i % 2) * 8, 8 + i * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ *
   * 交通车辆(背面视角)
   * ------------------------------------------------------------------ */

  var CAR_COLORS = ['#d9d3c4', '#4a6fa5', '#b8553f', '#6d7a54'];

  function drawCar(ctx, kind) {
    var color = CAR_COLORS[kind % CAR_COLORS.length];
    var isTruck = kind === 3;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, isTruck ? 52 : 40, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    var w = isTruck ? 92 : 70;
    var h = isTruck ? 86 : 56;

    // 车轮
    ctx.fillStyle = '#16181d';
    roundRect(ctx, -w / 2 + 2, -16, 14, 16, 4);
    ctx.fill();
    roundRect(ctx, w / 2 - 16, -16, 14, 16, 4);
    ctx.fill();

    // 车身
    ctx.fillStyle = shade(color, -0.3);
    roundRect(ctx, -w / 2, -h, w, h - 4, 8);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, -w / 2 + 4, -h + 4, w - 8, h - 12, 6);
    ctx.fill();

    // 后窗
    ctx.fillStyle = 'rgba(40,52,66,0.85)';
    roundRect(ctx, -w / 2 + 11, -h + 10, w - 22, isTruck ? 30 : 20, 5);
    ctx.fill();

    // 尾灯
    ctx.fillStyle = '#e8453c';
    roundRect(ctx, -w / 2 + 7, -20, 12, 7, 3);
    ctx.fill();
    roundRect(ctx, w / 2 - 19, -20, 12, 7, 3);
    ctx.fill();

    // 车牌
    ctx.fillStyle = '#e9e4d6';
    roundRect(ctx, -11, -18, 22, 8, 2);
    ctx.fill();

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * 路边景物
   * ------------------------------------------------------------------ */

  function drawProp(ctx, kind, dir) {
    switch (kind) {
      case 'palm':     return drawPalm(ctx);
      case 'pine':     return drawPine(ctx);
      case 'cactus':   return drawCactus(ctx);
      case 'rock':     return drawRock(ctx);
      case 'bush':     return drawBush(ctx);
      case 'lamp':     return drawLamp(ctx);
      case 'building': return drawBuilding(ctx);
      case 'sign':     return drawSign(ctx, dir || 1);
      default:         return drawBush(ctx);
    }
  }

  function drawPalm(ctx) {
    ctx.fillStyle = '#7a6144';
    ctx.beginPath();
    ctx.moveTo(-5, 0); ctx.lineTo(-3, -78); ctx.lineTo(4, -78); ctx.lineTo(5, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2f8f52';
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + (i - 2.5) * 0.55;
      ctx.save();
      ctx.translate(0, -78);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(28, 0, 30, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPine(ctx) {
    ctx.fillStyle = '#5c4630';
    ctx.fillRect(-4, -20, 8, 20);
    ctx.fillStyle = '#25623c';
    for (var i = 0; i < 3; i++) {
      var y = -20 - i * 22;
      var w = 34 - i * 8;
      ctx.beginPath();
      ctx.moveTo(0, y - 34);
      ctx.lineTo(-w, y);
      ctx.lineTo(w, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCactus(ctx) {
    ctx.fillStyle = '#3f7d49';
    roundRect(ctx, -9, -72, 18, 72, 9); ctx.fill();
    roundRect(ctx, -26, -54, 17, 10, 5); ctx.fill();
    roundRect(ctx, -26, -54, 10, 30, 5); ctx.fill();
    roundRect(ctx, 9, -44, 17, 10, 5); ctx.fill();
    roundRect(ctx, 16, -60, 10, 26, 5); ctx.fill();
  }

  function drawRock(ctx) {
    ctx.fillStyle = '#8d8a82';
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(-16, -22); ctx.lineTo(2, -30);
    ctx.lineTo(20, -18); ctx.lineTo(26, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a5a29a';
    ctx.beginPath();
    ctx.moveTo(-16, -22); ctx.lineTo(2, -30); ctx.lineTo(6, -14);
    ctx.closePath(); ctx.fill();
  }

  function drawBush(ctx) {
    ctx.fillStyle = '#356b3a';
    ctx.beginPath();
    ctx.arc(-12, -10, 13, 0, Math.PI * 2);
    ctx.arc(2, -16, 16, 0, Math.PI * 2);
    ctx.arc(15, -9, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLamp(ctx) {
    ctx.fillStyle = '#6b7079';
    ctx.fillRect(-3, -96, 6, 96);
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.quadraticCurveTo(0, -108, 20, -108);
    ctx.lineTo(20, -102);
    ctx.quadraticCurveTo(6, -102, 6, -96);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    roundRect(ctx, 14, -104, 14, 7, 3);
    ctx.fill();
  }

  function drawBuilding(ctx) {
    ctx.fillStyle = '#3b4250';
    ctx.fillRect(-38, -150, 76, 150);
    ctx.fillStyle = '#2c313c';
    ctx.fillRect(-38, -150, 76, 8);
    ctx.fillStyle = '#ffd98a';
    for (var r = 0; r < 6; r++) {
      for (var c = 0; c < 4; c++) {
        // 固定的明暗图案, 不用随机, 免得每帧闪
        if ((r * 7 + c * 3) % 5 < 2) continue;
        ctx.fillRect(-30 + c * 17, -136 + r * 22, 10, 13);
      }
    }
  }

  function drawSign(ctx, dir) {
    ctx.fillStyle = '#6b7079';
    ctx.fillRect(-3, -46, 6, 46);
    ctx.fillStyle = '#f2c230';
    roundRect(ctx, -22, -74, 44, 30, 6);
    ctx.fill();
    // 箭头指出弯向
    ctx.fillStyle = '#2b2b2b';
    ctx.save();
    ctx.translate(0, -59);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(-12, -6); ctx.lineTo(2, -6); ctx.lineTo(2, -12);
    ctx.lineTo(14, 0); ctx.lineTo(2, 12); ctx.lineTo(2, 6); ctx.lineTo(-12, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 路边的钢管拾取物。 */
  function drawPickup(ctx, bob) {
    ctx.save();
    ctx.translate(0, -26 + Math.sin(bob * 4) * 5);
    ctx.fillStyle = 'rgba(255,225,120,0.28)';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-0.5);
    ctx.fillStyle = '#c8cfdb';
    roundRect(ctx, -22, -4, 44, 9, 4);
    ctx.fill();
    ctx.fillStyle = '#8b93a2';
    roundRect(ctx, -22, -4, 12, 9, 4);
    ctx.fill();
    ctx.restore();
  }

  MB.Sprites = {
    shade: shade,
    roundRect: roundRect,
    drawRider: drawRider,
    drawCar: drawCar,
    drawProp: drawProp,
    drawPickup: drawPickup,
    CAR_COLORS: CAR_COLORS
  };
})(typeof window !== 'undefined' ? window : this);
