/* 游戏主体: Canvas 渲染 / 触控输入 / 消除流程编排 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var CONFIG = MK.CONFIG;
  var CHARACTERS = MK.CHARACTERS;
  var LEVELS = MK.LEVELS;
  var Ease = MK.Ease;
  var Anim = MK.Anim;
  var Util = MK.Util;
  var Board = MK.Board;
  var Assets = MK.Assets;
  var Sound = MK.Sound;

  function cellKey(r, c) { return r * 100 + c; }

  function rgba(hex, alpha) {
    var v = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + alpha + ')';
  }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.size = 0;
    this.tile = 0;

    this.board = null;
    this.gen = 0;              // 每次重开局自增, 用来废弃过期的异步流程
    this.state = 'idle';       // idle | busy | over
    this.paused = false;
    this.running = false;

    this.levelIndex = 0;
    this.score = 0;
    this.moves = 0;
    this.collected = [];
    this.props = { hammer: 0, shuffle: 0 };
    this.propMode = null;

    this.selected = null;
    this.hint = null;
    this.idleTime = 0;
    this.time = 0;

    this.particles = [];
    this.floaters = [];
    this.effects = [];

    this.lastSwap = null;
    this.handlers = {};

    this.bindInput();
  }

  Game.prototype.on = function (name, fn) {
    this.handlers[name] = fn;
    return this;
  };

  Game.prototype.emit = function (name, payload) {
    if (this.handlers[name]) this.handlers[name](payload);
  };

  /* ---------------- 尺寸与坐标 ---------------- */

  Game.prototype.resize = function () {
    var css = this.canvas.clientWidth;
    if (!css) return;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.size = css;
    this.tile = css / CONFIG.cols;
    this.canvas.width = Math.round(css * this.dpr);
    this.canvas.height = Math.round(css * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.board) this.snapTiles();
  };

  Game.prototype.cellX = function (c) { return c * this.tile + this.tile / 2; };
  Game.prototype.cellY = function (r) { return r * this.tile + this.tile / 2; };

  Game.prototype.snapTiles = function () {
    var self = this;
    this.board.forEach(function (tile, r, c) {
      tile.x = self.cellX(c);
      tile.y = self.cellY(r);
    });
  };

  Game.prototype.pointToCell = function (x, y) {
    var c = Math.floor(x / this.tile);
    var r = Math.floor(y / this.tile);
    if (!this.board || !this.board.inside(r, c)) return null;
    return { r: r, c: c };
  };

  /* ---------------- 输入 ---------------- */

  Game.prototype.bindInput = function () {
    var self = this;
    var el = this.canvas;
    var dragging = false;
    var origin = null;
    var startX = 0;
    var startY = 0;

    function local(e) {
      var rect = el.getBoundingClientRect();
      var t = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    function down(e) {
      if (e.cancelable) e.preventDefault();
      if (!self.interactive()) return;
      var p = local(e);
      origin = self.pointToCell(p.x, p.y);
      if (!origin) return;
      startX = p.x;
      startY = p.y;
      dragging = true;
      self.idleTime = 0;
      self.hint = null;

      if (self.propMode === 'hammer') {
        var target = origin;
        dragging = false;
        origin = null;
        self.useHammer(target);
      }
    }

    function move(e) {
      if (!dragging || !origin) return;
      if (e.cancelable) e.preventDefault();
      var p = local(e);
      var dx = p.x - startX;
      var dy = p.y - startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < self.tile * 0.38) return;

      var target;
      if (Math.abs(dx) > Math.abs(dy)) {
        target = { r: origin.r, c: origin.c + (dx > 0 ? 1 : -1) };
      } else {
        target = { r: origin.r + (dy > 0 ? 1 : -1), c: origin.c };
      }
      var from = origin;
      dragging = false;
      origin = null;
      if (self.board.inside(target.r, target.c)) self.trySwap(from, target);
    }

    function up(e) {
      if (!dragging || !origin) { dragging = false; origin = null; return; }
      if (e.cancelable) e.preventDefault();
      dragging = false;
      var cell = origin;
      origin = null;
      self.tapCell(cell);
    }

    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', function () { dragging = false; origin = null; });
    el.addEventListener('mousedown', down);
    el.addEventListener('mousemove', function (e) { if (dragging) move(e); });
    el.addEventListener('mouseup', up);
  };

  Game.prototype.interactive = function () {
    return this.state === 'idle' && !this.paused && !!this.board;
  };

  Game.prototype.tapCell = function (cell) {
    if (!this.interactive()) return;
    var prev = this.selected;

    if (!prev) {
      this.select(cell);
      return;
    }
    if (prev.r === cell.r && prev.c === cell.c) {
      this.select(null);
      return;
    }
    var adjacent = Math.abs(prev.r - cell.r) + Math.abs(prev.c - cell.c) === 1;
    if (adjacent) {
      this.select(null);
      this.trySwap(prev, cell);
    } else {
      this.select(cell);
    }
  };

  Game.prototype.select = function (cell) {
    var old = this.selected;
    if (old) {
      var oldTile = this.board.get(old.r, old.c);
      if (oldTile) Anim.to(oldTile, { scale: 1 }, 110, Ease.quadOut);
    }
    this.selected = cell;
    if (cell) {
      var tile = this.board.get(cell.r, cell.c);
      if (tile) Anim.to(tile, { scale: 1.1 }, 130, Ease.backOut);
      Sound.select();
    }
  };

  /* ---------------- 开局 ---------------- */

  Game.prototype.start = function (levelIndex) {
    this.gen++;
    Anim.cancelAll();

    this.levelIndex = levelIndex;
    var def = LEVELS[levelIndex];

    this.board = new Board(CONFIG.rows, CONFIG.cols, def.types);
    this.board.generate();

    this.score = 0;
    this.moves = def.moves;
    this.collected = def.collect.map(function (goal) {
      return { type: goal.type, need: goal.count, have: 0 };
    });
    this.props = { hammer: CONFIG.props.hammer, shuffle: CONFIG.props.shuffle };
    this.propMode = null;
    this.selected = null;
    this.hint = null;
    this.idleTime = 0;
    this.particles = [];
    this.floaters = [];
    this.effects = [];
    this.paused = false;
    this.state = 'busy';

    this.resize();
    this.pushHud();
    if (!this.running) this.loop();
    this.playIntro(this.gen);
  };

  Game.prototype.playIntro = function (gen) {
    var self = this;
    var promises = [];
    this.board.forEach(function (tile, r, c) {
      tile.x = self.cellX(c);
      tile.y = self.cellY(r) - self.size * 1.15;
      tile.alpha = 1;
      var delay = c * 26 + r * 12;
      promises.push(
        Anim.wait(delay).then(function () {
          if (gen !== self.gen) return null;
          return Anim.to(tile, { y: self.cellY(r) }, 420, Ease.drop);
        })
      );
    });
    Promise.all(promises).then(function () {
      if (gen !== self.gen) return;
      self.state = 'idle';
      self.idleTime = 0;
    });
  };

  /* ---------------- 交换与消除 ---------------- */

  Game.prototype.animateSwap = function (ta, tb) {
    var ax = ta.x, ay = ta.y, bx = tb.x, by = tb.y;
    return Promise.all([
      Anim.to(ta, { x: bx, y: by }, CONFIG.swapTime, Ease.quadOut),
      Anim.to(tb, { x: ax, y: ay }, CONFIG.swapTime, Ease.quadOut)
    ]);
  };

  Game.prototype.trySwap = function (a, b) {
    if (!this.interactive()) return;
    var self = this;
    var gen = this.gen;
    var ta = this.board.get(a.r, a.c);
    var tb = this.board.get(b.r, b.c);
    if (!ta || !tb) return;

    this.state = 'busy';
    this.select(null);
    this.idleTime = 0;
    this.hint = null;

    var valid = this.board.isValidSwap(a, b);
    Sound.swap();

    this.animateSwap(ta, tb).then(function () {
      if (gen !== self.gen) return null;
      if (!valid) {
        Sound.invalid();
        return self.animateSwap(ta, tb).then(function () {
          if (gen !== self.gen) return;
          self.state = 'idle';
          self.idleTime = 0;
        });
      }

      self.board.swapTiles(a, b);
      self.lastSwap = { a: { r: a.r, c: a.c }, b: { r: b.r, c: b.c } };
      self.moves--;
      self.vibrate(12);
      self.pushHud();

      var trigger = self.buildSwapTrigger(a, b);
      return self.runCascade(gen, trigger);
    });
  };

  /** 交换涉及特殊棋子时, 组装首轮要引爆的种子格与彩虹目标色。 */
  Game.prototype.buildSwapTrigger = function (a, b) {
    var ta = this.board.get(a.r, a.c);
    var tb = this.board.get(b.r, b.c);
    var trigger = { seeds: [], partnerType: null, extra: [] };
    if (!ta || !tb) return trigger;

    var sa = ta.special;
    var sb = tb.special;
    if (!sa && !sb) return trigger;

    if (sa) trigger.seeds.push({ r: a.r, c: a.c });
    if (sb) trigger.seeds.push({ r: b.r, c: b.c });

    if (sa === 'rainbow' && !sb) trigger.partnerType = tb.type;
    if (sb === 'rainbow' && !sa) trigger.partnerType = ta.type;

    if (sa && sb) {
      // 双特殊组合技
      if (sa === 'rainbow' && sb === 'rainbow') {
        for (var r = 0; r < this.board.rows; r++) {
          for (var c = 0; c < this.board.cols; c++) trigger.extra.push({ r: r, c: c });
        }
      } else if ((sa === 'bomb' && (sb === 'row' || sb === 'col')) ||
                 (sb === 'bomb' && (sa === 'row' || sa === 'col'))) {
        // 十字大范围: 以交换点为中心的三行三列
        for (var d = -1; d <= 1; d++) {
          for (var i = 0; i < this.board.cols; i++) trigger.extra.push({ r: b.r + d, c: i });
          for (var j = 0; j < this.board.rows; j++) trigger.extra.push({ r: j, c: b.c + d });
        }
      }
    }
    return trigger;
  };

  /** 选择特殊棋子的生成位置: 优先玩家刚交换的格子, 其次十字交点, 最后取最长段中点。 */
  Game.prototype.pickCreationCell = function (group) {
    var swap = this.lastSwap;
    var i;
    if (swap) {
      for (i = 0; i < group.cells.length; i++) {
        var cell = group.cells[i];
        if ((cell.r === swap.a.r && cell.c === swap.a.c) ||
            (cell.r === swap.b.r && cell.c === swap.b.c)) {
          return cell;
        }
      }
    }

    var hRuns = [], vRuns = [];
    for (i = 0; i < group.runs.length; i++) {
      (group.runs[i].dir === 'h' ? hRuns : vRuns).push(group.runs[i]);
    }
    for (i = 0; i < hRuns.length; i++) {
      for (var j = 0; j < vRuns.length; j++) {
        var h = hRuns[i], v = vRuns[j];
        if (h.r >= v.r && h.r < v.r + v.len && v.c >= h.c && v.c < h.c + h.len) {
          return { r: h.r, c: v.c };
        }
      }
    }

    var longest = group.longest;
    var mid = Math.floor(longest.len / 2);
    return longest.dir === 'h'
      ? { r: longest.r, c: longest.c + mid }
      : { r: longest.r + mid, c: longest.c };
  };

  Game.prototype.runCascade = function (gen, trigger) {
    var self = this;
    var cascade = 0;
    var pending = trigger || { seeds: [], partnerType: null, extra: [] };

    function stepOnce() {
      if (gen !== self.gen) return Promise.resolve();

      var groups = self.board.findMatches();
      var hasTrigger = pending.seeds.length > 0 || pending.extra.length > 0;
      if (!groups.length && !hasTrigger) return Promise.resolve();

      cascade++;

      var creations = [];
      var reserved = {};
      var seeds = [];
      var gi, ci;

      for (gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        for (ci = 0; ci < group.cells.length; ci++) seeds.push(group.cells[ci]);
        if (group.special) {
          var pos = self.pickCreationCell(group);
          reserved[cellKey(pos.r, pos.c)] = true;
          creations.push({ r: pos.r, c: pos.c, special: group.special, type: group.type });
        }
      }
      for (ci = 0; ci < pending.seeds.length; ci++) seeds.push(pending.seeds[ci]);
      for (ci = 0; ci < pending.extra.length; ci++) seeds.push(pending.extra[ci]);

      var partnerType = pending.partnerType;
      pending = { seeds: [], partnerType: null, extra: [] };

      var result = self.board.expandClears(seeds, partnerType);
      var cleared = [];
      for (ci = 0; ci < result.cleared.length; ci++) {
        if (!reserved[cellKey(result.cleared[ci].r, result.cleared[ci].c)]) {
          cleared.push(result.cleared[ci]);
        }
      }
      if (!cleared.length && !creations.length) return Promise.resolve();

      return self.applyClears(gen, cleared, result.effects, creations, cascade)
        .then(function () {
          if (gen !== self.gen) return null;
          return self.applyCollapse(gen);
        })
        .then(function () {
          if (gen !== self.gen) return null;
          self.lastSwap = null;
          return stepOnce();
        });
    }

    return stepOnce().then(function () {
      if (gen !== self.gen) return null;
      return self.afterCascade(gen, cascade);
    });
  };

  Game.prototype.applyClears = function (gen, cleared, effects, creations, cascade) {
    var self = this;
    var multiplier = 1 + CONFIG.comboStep * (cascade - 1);
    var gained = Math.round(cleared.length * CONFIG.scorePerTile * multiplier) +
                 effects.length * CONFIG.specialBonus;
    this.score += gained;

    var i;
    // 记录收集目标进度
    for (i = 0; i < cleared.length; i++) {
      var type = cleared[i].tile.type;
      for (var g = 0; g < this.collected.length; g++) {
        if (this.collected[g].type === type && this.collected[g].have < this.collected[g].need) {
          this.collected[g].have++;
        }
      }
    }

    // 特殊棋子的视觉特效
    for (i = 0; i < effects.length; i++) {
      var fx = effects[i];
      this.effects.push({
        kind: fx.special,
        x: this.cellX(fx.c),
        y: this.cellY(fx.r),
        row: fx.r,
        col: fx.c,
        color: CHARACTERS[fx.type].color,
        life: 0,
        maxLife: fx.special === 'rainbow' ? 520 : 380
      });
      Sound.special(fx.special);
    }
    if (effects.length) this.vibrate(28);

    Sound.pop(cascade);

    // 飘分
    var cx = 0, cy = 0;
    for (i = 0; i < cleared.length; i++) {
      cx += cleared[i].tile.x;
      cy += cleared[i].tile.y;
    }
    if (cleared.length) {
      this.floaters.push({
        x: cx / cleared.length,
        y: cy / cleared.length,
        text: '+' + gained,
        sub: cascade > 1 ? ('连锁 x' + cascade) : '',
        life: 0,
        maxLife: 900
      });
    }

    var promises = [];
    for (i = 0; i < cleared.length; i++) {
      promises.push(this.popTile(cleared[i], Math.min(160, i * 9), gen));
    }
    for (i = 0; i < creations.length; i++) {
      promises.push(this.promoteTile(creations[i], gen));
    }

    this.pushHud();
    return Promise.all(promises).then(function () {
      if (gen !== self.gen) return;
      for (var k = 0; k < cleared.length; k++) {
        self.board.remove(cleared[k].r, cleared[k].c);
      }
    });
  };

  Game.prototype.popTile = function (entry, delay, gen) {
    var self = this;
    var tile = entry.tile;
    return Anim.wait(delay).then(function () {
      if (gen !== self.gen) return null;
      self.spawnParticles(tile.x, tile.y, CHARACTERS[tile.type].color);
      return Anim.to(tile, { scale: 1.28 }, CONFIG.popTime * 0.35, Ease.quadOut)
        .then(function () {
          if (gen !== self.gen) return null;
          return Anim.to(tile, { scale: 0, alpha: 0 }, CONFIG.popTime * 0.65, Ease.quadIn);
        });
    });
  };

  Game.prototype.promoteTile = function (creation, gen) {
    var self = this;
    var tile = this.board.get(creation.r, creation.c);
    if (!tile) return Promise.resolve();
    tile.special = creation.special;
    tile.type = creation.type;
    Sound.create();
    this.floaters.push({
      x: tile.x,
      y: tile.y - this.tile * 0.55,
      text: MK.SPECIAL_LABEL[creation.special],
      sub: '',
      life: 0,
      maxLife: 1000,
      small: true
    });
    return Anim.to(tile, { scale: 1.35 }, 150, Ease.backOut).then(function () {
      if (gen !== self.gen) return null;
      return Anim.to(tile, { scale: 1 }, 180, Ease.quadOut);
    });
  };

  Game.prototype.applyCollapse = function (gen) {
    var self = this;
    var res = this.board.collapse();
    var promises = [];
    var i;

    for (i = 0; i < res.moves.length; i++) {
      var mv = res.moves[i];
      var dur = Math.max(CONFIG.fallTimeMin, mv.distance * CONFIG.fallTimePerCell);
      promises.push(Anim.to(mv.tile, { y: this.cellY(mv.toRow) }, dur, Ease.drop));
    }
    for (i = 0; i < res.spawns.length; i++) {
      var sp = res.spawns[i];
      sp.tile.x = this.cellX(sp.col);
      sp.tile.y = this.cellY(-sp.offset);
      sp.tile.scale = 1;
      sp.tile.alpha = 1;
      var d2 = Math.max(CONFIG.fallTimeMin, (sp.row + sp.offset) * CONFIG.fallTimePerCell);
      promises.push(Anim.to(sp.tile, { y: this.cellY(sp.row) }, d2, Ease.drop));
    }

    return Promise.all(promises).then(function () {
      if (gen !== self.gen) return;
      self.snapTiles();
    });
  };

  Game.prototype.afterCascade = function (gen, cascade) {
    var self = this;
    this.pushHud();

    if (this.isCleared()) {
      this.finish(true);
      return Promise.resolve();
    }
    if (this.moves <= 0) {
      this.finish(false);
      return Promise.resolve();
    }
    if (!this.board.findMove()) {
      this.emit('toast', '没有可以消除的组合啦，自动洗牌～');
      return this.doShuffle(gen).then(function () {
        if (gen !== self.gen) return;
        self.state = 'idle';
        self.idleTime = 0;
      });
    }

    this.state = 'idle';
    this.idleTime = 0;
    return Promise.resolve();
  };

  Game.prototype.isCleared = function () {
    for (var i = 0; i < this.collected.length; i++) {
      if (this.collected[i].have < this.collected[i].need) return false;
    }
    return true;
  };

  Game.prototype.finish = function (won) {
    var def = LEVELS[this.levelIndex];
    this.state = 'over';
    this.selected = null;
    this.hint = null;

    var stars = 0;
    if (won) {
      var ratio = this.score / def.target;
      stars = ratio >= 1.5 ? 3 : (ratio >= 1 ? 2 : 1);
      Sound.win();
    } else {
      Sound.lose();
    }

    if (won) {
      var progress = MK.Storage.get('progress', {});
      var record = progress[this.levelIndex] || { stars: 0, best: 0 };
      record.stars = Math.max(record.stars, stars);
      record.best = Math.max(record.best, this.score);
      progress[this.levelIndex] = record;
      MK.Storage.set('progress', progress);

      var unlocked = MK.Storage.get('unlocked', 0);
      if (this.levelIndex >= unlocked && this.levelIndex + 1 < LEVELS.length) {
        MK.Storage.set('unlocked', this.levelIndex + 1);
      }
    }

    this.emit('finish', {
      won: won,
      stars: stars,
      score: this.score,
      target: def.target,
      level: this.levelIndex
    });
  };

  /* ---------------- 道具 ---------------- */

  Game.prototype.setPropMode = function (mode) {
    this.propMode = this.propMode === mode ? null : mode;
    this.select(null);
    this.emit('propmode', this.propMode);
  };

  Game.prototype.useHammer = function (cell) {
    if (!cell || !this.interactive() || this.props.hammer <= 0) return;
    var gen = this.gen;
    this.props.hammer--;
    this.propMode = null;
    this.emit('propmode', null);
    this.state = 'busy';
    this.vibrate(20);
    this.pushHud();
    this.runCascade(gen, { seeds: [{ r: cell.r, c: cell.c }], partnerType: null, extra: [] });
  };

  Game.prototype.useShuffle = function () {
    if (!this.interactive() || this.props.shuffle <= 0) return;
    var gen = this.gen;
    var self = this;
    this.props.shuffle--;
    this.propMode = null;
    this.emit('propmode', null);
    this.state = 'busy';
    this.pushHud();
    this.doShuffle(gen).then(function () {
      if (gen !== self.gen) return null;
      return self.runCascade(gen, null);
    });
  };

  Game.prototype.doShuffle = function (gen) {
    var self = this;
    var tiles = [];
    this.board.forEach(function (tile) { tiles.push(tile); });

    var out = tiles.map(function (tile) {
      return Anim.to(tile, { scale: 0.15, spin: 0.6 }, 200, Ease.quadIn);
    });

    return Promise.all(out).then(function () {
      if (gen !== self.gen) return null;
      self.board.shuffleBoard();
      self.snapTiles();
      var back = [];
      self.board.forEach(function (tile) {
        back.push(Anim.to(tile, { scale: 1, spin: 0 }, 260, Ease.backOut));
      });
      Sound.create();
      return Promise.all(back);
    });
  };

  /* ---------------- 提示 / 粒子 ---------------- */

  Game.prototype.pause = function () {
    this.paused = true;
  };

  Game.prototype.resume = function () {
    this.paused = false;
    this.idleTime = 0;
  };

  Game.prototype.showHint = function () {
    if (!this.interactive()) return;
    var move = this.board.findMove();
    if (move) this.hint = move;
  };

  Game.prototype.spawnParticles = function (x, y, color) {
    var count = 5;
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = (0.06 + Math.random() * 0.13) * this.tile;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - this.tile * 0.05,
        size: this.tile * (0.05 + Math.random() * 0.08),
        color: color,
        star: Math.random() < 0.45,
        life: 0,
        maxLife: 420 + Math.random() * 260
      });
    }
  };

  Game.prototype.vibrate = function (ms) {
    if (global.navigator && global.navigator.vibrate) {
      try { global.navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
    }
  };

  Game.prototype.pushHud = function () {
    var def = LEVELS[this.levelIndex];
    this.emit('hud', {
      level: this.levelIndex,
      score: this.score,
      target: def.target,
      moves: Math.max(0, this.moves),
      collected: this.collected,
      props: this.props
    });
  };

  /* ---------------- 主循环与渲染 ---------------- */

  Game.prototype.loop = function () {
    var self = this;
    var last = 0;
    this.running = true;

    function frame(now) {
      if (!last) last = now;
      var dt = Math.min(48, now - last);
      last = now;

      if (!self.paused) {
        self.time += dt;
        Anim.update(dt);
        self.updateEffects(dt);
        if (self.state === 'idle') {
          self.idleTime += dt;
          if (self.idleTime > CONFIG.hintDelay && !self.hint) self.showHint();
        }
      }
      self.render();
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);
  };

  Game.prototype.updateEffects = function (dt) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vy += this.tile * 0.0085 * dt * 0.06;
    }
    for (i = this.floaters.length - 1; i >= 0; i--) {
      p = this.floaters[i];
      p.life += dt;
      if (p.life >= p.maxLife) this.floaters.splice(i, 1);
    }
    for (i = this.effects.length - 1; i >= 0; i--) {
      p = this.effects[i];
      p.life += dt;
      if (p.life >= p.maxLife) this.effects.splice(i, 1);
    }
  };

  Game.prototype.render = function () {
    var ctx = this.ctx;
    var size = this.size;
    if (!size) return;

    ctx.clearRect(0, 0, size, size);
    if (!this.board) return;

    var radius = this.tile * 0.34;

    // 棋盘底
    ctx.save();
    Util.roundRect(ctx, 0, 0, size, size, radius);
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fill();
    ctx.clip();

    // 格子底纹
    for (var r = 0; r < CONFIG.rows; r++) {
      for (var c = 0; c < CONFIG.cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(c * this.tile, r * this.tile, this.tile, this.tile);
      }
    }

    this.drawHint(ctx);
    this.drawSelection(ctx);

    var self = this;
    var specials = [];
    this.board.forEach(function (tile) {
      if (tile.special) specials.push(tile);
      else self.drawTile(tile);
    });
    // 特殊棋子最后画, 保证发光不被遮住
    for (var s = 0; s < specials.length; s++) this.drawTile(specials[s]);

    this.drawEffects(ctx);
    this.drawParticles(ctx);
    ctx.restore();

    this.drawFloaters(ctx);
  };

  Game.prototype.drawSelection = function (ctx) {
    if (!this.selected) return;
    var pulse = 0.5 + 0.5 * Math.sin(this.time * 0.012);
    var x = this.selected.c * this.tile;
    var y = this.selected.r * this.tile;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 + pulse * 0.4) + ')';
    ctx.lineWidth = this.tile * 0.07;
    Util.roundRect(ctx, x + 2, y + 2, this.tile - 4, this.tile - 4, this.tile * 0.26);
    ctx.stroke();
    ctx.restore();
  };

  Game.prototype.drawHint = function (ctx) {
    if (!this.hint) return;
    var pulse = 0.5 + 0.5 * Math.sin(this.time * 0.008);
    var cells = [this.hint.a, this.hint.b];
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + pulse * 0.3) + ')';
    for (var i = 0; i < cells.length; i++) {
      Util.roundRect(ctx, cells[i].c * this.tile + 2, cells[i].r * this.tile + 2,
        this.tile - 4, this.tile - 4, this.tile * 0.26);
      ctx.fill();
    }
    ctx.restore();
  };

  Game.prototype.drawTile = function (tile) {
    var ctx = this.ctx;
    var ch = CHARACTERS[tile.type];
    var s = this.tile * 0.92 * tile.scale;
    if (s <= 0.5 || tile.alpha <= 0.01) return;

    ctx.save();
    ctx.translate(tile.x, tile.y);
    if (tile.spin) ctx.rotate(tile.spin);
    ctx.globalAlpha = tile.alpha;

    var half = s / 2;
    var corner = s * 0.3;

    // 底板
    var grad = ctx.createLinearGradient(0, -half, 0, half);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, rgba(ch.color, 0.5));
    Util.roundRect(ctx, -half, -half, s, s, corner);
    ctx.fillStyle = grad;
    ctx.fill();

    // 方向闪电的条纹画在角色下面
    if (tile.special === 'row' || tile.special === 'col') {
      ctx.save();
      Util.roundRect(ctx, -half, -half, s, s, corner);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (var k = -1; k <= 1; k += 2) {
        if (tile.special === 'row') ctx.fillRect(-half, k * s * 0.26 - s * 0.045, s, s * 0.09);
        else ctx.fillRect(k * s * 0.26 - s * 0.045, -half, s * 0.09, s);
      }
      ctx.restore();
    }

    ctx.lineWidth = Math.max(1.2, s * 0.045);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    Util.roundRect(ctx, -half, -half, s, s, corner);
    ctx.stroke();

    var img = Assets.sprite(tile.type);
    if (img) {
      var sp = s * 0.95;
      ctx.drawImage(img, -sp / 2, -sp / 2, sp, sp);
    }

    if (tile.special === 'bomb') {
      ctx.fillStyle = 'rgba(40,26,64,0.9)';
      ctx.beginPath();
      ctx.arc(half * 0.56, half * 0.56, s * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.arc(half * 0.56, half * 0.56, s * 0.17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath();
      ctx.arc(half * 0.56, half * 0.56, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    } else if (tile.special === 'rainbow') {
      var colors = ['#ff5f8f', '#ffb43d', '#ffe94d', '#6fdd8a', '#4fb6ff', '#b184ff'];
      ctx.lineWidth = s * 0.075;
      var spin = this.time * 0.002;
      for (var i = 0; i < colors.length; i++) {
        ctx.strokeStyle = colors[i];
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.96, spin + i * Math.PI / 3, spin + (i + 1) * Math.PI / 3);
        ctx.stroke();
      }
    } else if (tile.special === 'row' || tile.special === 'col') {
      ctx.strokeStyle = '#ffe94d';
      ctx.lineWidth = Math.max(1.2, s * 0.05);
      Util.roundRect(ctx, -half, -half, s, s, corner);
      ctx.stroke();
    }

    ctx.restore();
  };

  Game.prototype.drawEffects = function (ctx) {
    for (var i = 0; i < this.effects.length; i++) {
      var fx = this.effects[i];
      var p = fx.life / fx.maxLife;
      var fade = 1 - p;
      ctx.save();
      ctx.globalAlpha = fade;

      if (fx.kind === 'row' || fx.kind === 'col') {
        var thickness = this.tile * (0.35 + p * 0.55);
        var grad = fx.kind === 'row'
          ? ctx.createLinearGradient(0, fx.y - thickness, 0, fx.y + thickness)
          : ctx.createLinearGradient(fx.x - thickness, 0, fx.x + thickness, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, 'rgba(255,255,190,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        if (fx.kind === 'row') ctx.fillRect(0, fx.y - thickness, this.size, thickness * 2);
        else ctx.fillRect(fx.x - thickness, 0, thickness * 2, this.size);
      } else if (fx.kind === 'bomb') {
        var radius = this.tile * (0.6 + p * 1.9);
        var ring = ctx.createRadialGradient(fx.x, fx.y, radius * 0.45, fx.x, fx.y, radius);
        ring.addColorStop(0, 'rgba(255,220,120,0)');
        ring.addColorStop(0.7, 'rgba(255,180,80,0.75)');
        ring.addColorStop(1, 'rgba(255,120,60,0)');
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var rr = this.size * (0.15 + p * 1.05);
        ctx.lineWidth = this.tile * 0.3 * fade;
        var colors = ['#ff5f8f', '#ffe94d', '#6fdd8a', '#4fb6ff', '#b184ff'];
        for (var k = 0; k < colors.length; k++) {
          ctx.strokeStyle = colors[k];
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, rr - k * this.tile * 0.16, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };

  Game.prototype.drawParticles = function (ctx) {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var fade = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = p.color;
      if (p.star) {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 0.006);
        ctx.beginPath();
        for (var s = 0; s < 10; s++) {
          var rad = s % 2 === 0 ? p.size : p.size * 0.45;
          var ang = Math.PI / 5 * s - Math.PI / 2;
          if (s === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * fade, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  Game.prototype.drawFloaters = function (ctx) {
    for (var i = 0; i < this.floaters.length; i++) {
      var f = this.floaters[i];
      var p = f.life / f.maxLife;
      var fontSize = this.tile * (f.small ? 0.3 : 0.42);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(p, 2.2));
      ctx.translate(f.x, f.y - this.tile * 0.9 * p);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 ' + fontSize + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = fontSize * 0.24;
      ctx.strokeStyle = 'rgba(90,40,110,0.85)';
      ctx.fillStyle = '#fff6b0';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillText(f.text, 0, 0);
      if (f.sub) {
        ctx.font = '800 ' + fontSize * 0.7 + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = fontSize * 0.18;
        ctx.fillStyle = '#ffd0ea';
        ctx.strokeText(f.sub, 0, fontSize * 0.95);
        ctx.fillText(f.sub, 0, fontSize * 0.95);
      }
      ctx.restore();
    }
  };

  MK.Game = Game;
})(window);
