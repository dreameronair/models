/* 角色/背景图加载。任何一张图加载失败时会用 Canvas 现画一个替代精灵, 保证游戏仍可玩。 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var CHARACTERS = MK.CHARACTERS;

  var Assets = {
    images: {},
    ready: false,
    missing: []
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('加载失败: ' + src)); };
      img.src = src;
    });
  }

  /** 图片缺失时的兜底: 画一只简笔萌宠头像。 */
  function drawFallbackSprite(character) {
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var cx = size / 2;
    var cy = size / 2 + 6;
    var radius = size * 0.33;

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = character.color;

    // 耳朵
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.ellipse(cx + s * radius * 0.72, cy - radius * 0.78, radius * 0.3, radius * 0.46,
        s * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 脸
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 高光
    var grad = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.45, 2, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 眼睛
    for (var e = -1; e <= 1; e += 2) {
      ctx.fillStyle = '#2b2140';
      ctx.beginPath();
      ctx.ellipse(cx + e * radius * 0.36, cy - radius * 0.08, radius * 0.16, radius * 0.21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + e * radius * 0.36 + radius * 0.06, cy - radius * 0.16, radius * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    // 腮红
    ctx.fillStyle = 'rgba(255,120,160,0.45)';
    for (var b = -1; b <= 1; b += 2) {
      ctx.beginPath();
      ctx.ellipse(cx + b * radius * 0.62, cy + radius * 0.22, radius * 0.14, radius * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 嘴
    ctx.strokeStyle = character.dark;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.2, radius * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    return canvas;
  }

  /**
   * 加载全部素材。onProgress(已完成, 总数) 用于进度条。
   * 单张图失败不会中断流程, 只会记录到 Assets.missing 并使用兜底精灵。
   */
  Assets.load = function (onProgress) {
    var tasks = [];
    var total = CHARACTERS.length + 1;
    var done = 0;

    function step() {
      done++;
      if (onProgress) onProgress(done, total);
    }

    CHARACTERS.forEach(function (character) {
      var task = loadImage('assets/characters/' + character.sprite + '.png')
        .then(function (img) {
          Assets.images[character.id] = img;
        })
        .catch(function () {
          Assets.missing.push(character.sprite + '.png');
          Assets.images[character.id] = drawFallbackSprite(character);
        })
        .then(step);
      tasks.push(task);
    });

    tasks.push(
      loadImage('assets/ui/background.jpg')
        .then(function (img) { Assets.images.background = img; })
        .catch(function () { Assets.missing.push('background.jpg'); })
        .then(step)
    );

    return Promise.all(tasks).then(function () {
      Assets.ready = true;
      return Assets;
    });
  };

  Assets.sprite = function (typeIndex) {
    return Assets.images[CHARACTERS[typeIndex].id];
  };

  MK.Assets = Assets;
})(window);
