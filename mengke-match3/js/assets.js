/*
 * 素材加载。
 *
 * 两套形象:
 *   original — 仓库自带的原创萌宠 PNG, 离线可用, 永远作为兜底。
 *   official — 奇妙萌可官方角色, 在线加载(地址见 js/skins.js)。
 *
 * 在线图的处理流程: 先查本地缓存 -> 没有就下载 -> 按不透明像素裁掉四周空白并居中
 * 到正方形(这样各张图在棋盘上大小一致) -> 缓存成 dataURL 下次直接用。
 * 下载失败或超时会退回原创形象, 不会白屏。
 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var CHARACTERS = MK.CHARACTERS;
  var Storage = MK.Storage;

  var SPRITE_SIZE = 256;
  var REMOTE_TIMEOUT = 9000;
  var CACHE_PREFIX = 'mengke-skin-v3-';
  // 有防盗链的图床常把 404 也回一张小占位图, 浏览器会当成加载成功。
  // 角色图都在 320px 以上, 所以小于这个尺寸的一律按失败处理, 免得棋盘上画出破图。
  var MIN_REMOTE_SIZE = 96;

  var Assets = {
    images: {},        // 原创形象, 也是兜底
    remote: {},        // 已就绪的在线形象
    skin: Storage.get('skin', 'official'),
    ready: false,
    missing: [],       // 本地缺失的文件名
    remoteFailed: []   // 在线加载失败的角色 id
  };

  function loadImage(src, crossOrigin) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('加载失败: ' + src)); };
      img.src = src;
    });
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('超时')); }
      }, ms);
      promise.then(function (v) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        resolve(v);
      }, function (e) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        reject(e);
      });
    });
  }

  /** 图片缺失时的兜底: 画一只简笔萌宠头像。 */
  function drawFallbackSprite(character) {
    var size = SPRITE_SIZE;
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
   * 描一圈边。官方图是粉彩色又没有轮廓线, 贴到同色系底板上会糊成一团;
   * 用角色自己的深色描边, 既能和底板分开, 也顺手强化了"这是哪一只"的颜色识别
   * (爱心和唱唱本身就是浅粉/浅紫, 描白边只会更糊)。
   * 做法是先取纯色剪影, 沿一圈方向盖一遍, 再压上原图。
   */
  function addOutline(sprite, thickness, color) {
    var size = sprite.width;

    var silhouette = document.createElement('canvas');
    silhouette.width = silhouette.height = size;
    var sctx = silhouette.getContext('2d');
    sctx.drawImage(sprite, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = color;
    sctx.fillRect(0, 0, size, size);

    var out = document.createElement('canvas');
    out.width = out.height = size;
    var octx = out.getContext('2d');
    var steps = 20;
    for (var i = 0; i < steps; i++) {
      var angle = i / steps * Math.PI * 2;
      octx.drawImage(silhouette, Math.cos(angle) * thickness, Math.sin(angle) * thickness);
    }
    octx.drawImage(sprite, 0, 0);
    return out;
  }

  /**
   * 裁掉四周透明边并居中到 SPRITE_SIZE 的正方形, 再加白边。
   * 在线图尺寸和留白各不相同, 不归一化的话棋盘上大小会参差不齐。
   * 读像素需要图片允许跨域, 拿不到就原图返回。
   */
  function normalize(img, character) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return img;

    var probeW = Math.min(w, 320);
    var probeH = Math.max(1, Math.round(h * probeW / w));
    var data;
    try {
      var probe = document.createElement('canvas');
      probe.width = probeW;
      probe.height = probeH;
      var pctx = probe.getContext('2d');
      pctx.drawImage(img, 0, 0, probeW, probeH);
      data = pctx.getImageData(0, 0, probeW, probeH).data;
    } catch (e) {
      return img;
    }

    var minX = probeW, minY = probeH, maxX = -1, maxY = -1;
    for (var y = 0; y < probeH; y++) {
      for (var x = 0; x < probeW; x++) {
        if (data[(y * probeW + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return img;

    var scale = w / probeW;
    var sx = minX * scale;
    var sy = minY * scale;
    var sw = (maxX - minX + 1) * scale;
    var sh = (maxY - minY + 1) * scale;
    // 留白刚好放得下白边(白边 2.8%, 每侧留 4%), 再多角色就显小了
    var side = Math.max(sw, sh) * 1.08;
    var k = SPRITE_SIZE / side;

    var out = document.createElement('canvas');
    out.width = out.height = SPRITE_SIZE;
    var octx = out.getContext('2d');
    octx.drawImage(img, sx, sy, sw, sh,
      (SPRITE_SIZE - sw * k) / 2, (SPRITE_SIZE - sh * k) / 2, sw * k, sh * k);
    return addOutline(out, SPRITE_SIZE * 0.026, character.dark);
  }

  // 在线图缓存单独放 key, 避免把几百 KB 的 base64 塞进设置用的那份 JSON
  function cacheKey(skinId, id) { return CACHE_PREFIX + skinId + '-' + id; }

  function cacheGet(skinId, id) {
    try {
      return global.localStorage.getItem(cacheKey(skinId, id));
    } catch (e) {
      return null;
    }
  }

  function cacheSet(skinId, id, dataUrl) {
    if (!dataUrl) return;
    try {
      global.localStorage.setItem(cacheKey(skinId, id), dataUrl);
    } catch (e) { /* 配额满或隐私模式, 忽略 */ }
  }

  function cacheDrop(skinId, id) {
    try {
      global.localStorage.removeItem(cacheKey(skinId, id));
    } catch (e) { /* 忽略 */ }
  }

  Assets.clearSkinCache = function () {
    Object.keys(MK.SKINS).forEach(function (skinId) {
      CHARACTERS.forEach(function (ch) { cacheDrop(skinId, ch.id); });
    });
  };

  function toDataUrl(canvas) {
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;   // 画布被跨域污染
    }
  }

  function tooSmall(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    return !w || !h || w < MIN_REMOTE_SIZE || h < MIN_REMOTE_SIZE;
  }

  function loadRealImage(url, crossOrigin) {
    return withTimeout(loadImage(url, crossOrigin), REMOTE_TIMEOUT).then(function (img) {
      if (tooSmall(img)) throw new Error('疑似占位图: ' + url);
      return img;
    });
  }

  /** 下载一张在线图并归一化, 顺带写缓存。 */
  function fetchRemote(skinId, ch, url) {
    return loadRealImage(url, 'anonymous')
      .then(function (img) {
        var sprite = normalize(img, ch);
        Assets.remote[ch.id] = sprite;
        if (sprite !== img) cacheSet(skinId, ch.id, toDataUrl(sprite));
      })
      .catch(function () {
        // 带 crossOrigin 失败时再裸试一次: 拿不到像素也就没法裁切和缓存, 但至少能显示
        return loadRealImage(url, null)
          .then(function (img) { Assets.remote[ch.id] = img; })
          .catch(function () { Assets.remoteFailed.push(ch.id); });
      });
  }

  function loadRemoteOne(skinId, ch, url) {
    var cached = cacheGet(skinId, ch.id);
    if (!cached) return fetchRemote(skinId, ch, url);
    return loadImage(cached, null)
      .then(function (img) { Assets.remote[ch.id] = img; })
      .catch(function () {
        cacheDrop(skinId, ch.id);
        return fetchRemote(skinId, ch, url);
      });
  }

  /**
   * 加载本地素材。onProgress(已完成, 总数) 用于进度条。
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
      var task = loadImage(MK.assetUrl('assets/characters/' + character.sprite + '.png'))
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
      loadImage(MK.assetUrl('assets/ui/background.jpg'))
        .then(function (img) { Assets.images.background = img; })
        .catch(function () { Assets.missing.push('background.jpg'); })
        .then(step)
    );

    return Promise.all(tasks).then(function () {
      Assets.ready = true;
      return Assets;
    });
  };

  /**
   * 加载在线形象。失败的角色会留在 Assets.remoteFailed 里, 渲染时自动用原创形象顶上。
   * 解析结果为成功加载的张数。
   */
  Assets.loadSkin = function (skinId, onProgress) {
    var skin = MK.SKINS[skinId];
    if (!skin || skin.source !== 'remote') {
      Assets.remoteFailed = [];
      return Promise.resolve(0);
    }

    Assets.remote = {};
    Assets.remoteFailed = [];
    var list = CHARACTERS.filter(function (ch) { return skin.images[ch.id]; });
    var done = 0;

    var tasks = list.map(function (ch) {
      return loadRemoteOne(skinId, ch, skin.images[ch.id]).then(function () {
        done++;
        if (onProgress) onProgress(done, list.length);
      });
    });

    return Promise.all(tasks).then(function () {
      return Object.keys(Assets.remote).length;
    });
  };

  /** 切换形象, 需要时下载在线图。解析结果为成功加载的张数(原创形象为 -1)。 */
  Assets.setSkin = function (skinId, onProgress) {
    if (!MK.SKINS[skinId]) return Promise.resolve(-1);
    Assets.skin = skinId;
    Storage.set('skin', skinId);
    if (MK.SKINS[skinId].source !== 'remote') {
      Assets.remote = {};
      Assets.remoteFailed = [];
      return Promise.resolve(-1);
    }
    return Assets.loadSkin(skinId, onProgress);
  };

  Assets.spriteById = function (id) {
    if (Assets.skin !== 'original' && Assets.remote[id]) return Assets.remote[id];
    return Assets.images[id];
  };

  Assets.sprite = function (typeIndex) {
    return Assets.spriteById(CHARACTERS[typeIndex].id);
  };

  /** 当前形象下角色的显示名。 */
  Assets.displayName = function (character) {
    if (Assets.skin === 'official' && Assets.remote[character.id] && character.official) {
      return character.official;
    }
    return character.name;
  };

  MK.Assets = Assets;
})(window);
