/* 棋盘与消除规则(纯逻辑, 不涉及渲染) */
(function (global) {
  'use strict';

  var Util = global.MK.Util;

  var DIRS = [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: -1, dc: 0 }];

  function key(r, c) { return r * 100 + c; }

  /** 棋子。渲染需要的 x/y/scale/alpha 也挂在同一个对象上, 保证逻辑与画面单一数据源。 */
  function Tile(type, r, c) {
    this.type = type;
    this.special = null;   // null | 'row' | 'col' | 'bomb' | 'rainbow'
    this.r = r;
    this.c = c;
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.alpha = 1;
    this.spin = 0;
  }

  function Board(rows, cols, typeCount) {
    this.rows = rows;
    this.cols = cols;
    this.typeCount = typeCount;
    this.cells = [];
    this.reset();
  }

  Board.prototype.reset = function () {
    this.cells = [];
    for (var r = 0; r < this.rows; r++) {
      var row = [];
      for (var c = 0; c < this.cols; c++) row.push(null);
      this.cells.push(row);
    }
  };

  Board.prototype.inside = function (r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  };

  Board.prototype.get = function (r, c) {
    return this.inside(r, c) ? this.cells[r][c] : null;
  };

  Board.prototype.set = function (r, c, tile) {
    this.cells[r][c] = tile;
    if (tile) { tile.r = r; tile.c = c; }
  };

  Board.prototype.forEach = function (fn) {
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (this.cells[r][c]) fn(this.cells[r][c], r, c);
      }
    }
  };

  Board.prototype.randomType = function () {
    return Util.randInt(this.typeCount);
  };

  /** 生成一个初始无三连、且至少存在一个可行走法的棋盘。 */
  Board.prototype.generate = function () {
    for (var attempt = 0; attempt < 60; attempt++) {
      this.reset();
      for (var r = 0; r < this.rows; r++) {
        for (var c = 0; c < this.cols; c++) {
          var banned = {};
          var left = this.get(r, c - 1), left2 = this.get(r, c - 2);
          if (left && left2 && left.type === left2.type) banned[left.type] = true;
          var up = this.get(r - 1, c), up2 = this.get(r - 2, c);
          if (up && up2 && up.type === up2.type) banned[up.type] = true;

          var pool = [];
          for (var t = 0; t < this.typeCount; t++) if (!banned[t]) pool.push(t);
          var picked = pool.length ? pool[Util.randInt(pool.length)] : this.randomType();
          this.set(r, c, new Tile(picked, r, c));
        }
      }
      if (!this.findRuns().length && this.findMove()) return;
    }
  };

  /** 找出所有横向/纵向长度 >= 3 的连续段。 */
  Board.prototype.findRuns = function () {
    var runs = [];
    var r, c, end, tile;

    for (r = 0; r < this.rows; r++) {
      c = 0;
      while (c < this.cols) {
        tile = this.cells[r][c];
        if (!tile) { c++; continue; }
        end = c;
        while (end + 1 < this.cols && this.cells[r][end + 1] && this.cells[r][end + 1].type === tile.type) end++;
        if (end - c + 1 >= 3) runs.push({ dir: 'h', r: r, c: c, len: end - c + 1, type: tile.type });
        c = end + 1;
      }
    }

    for (c = 0; c < this.cols; c++) {
      r = 0;
      while (r < this.rows) {
        tile = this.cells[r][c];
        if (!tile) { r++; continue; }
        end = r;
        while (end + 1 < this.rows && this.cells[end + 1][c] && this.cells[end + 1][c].type === tile.type) end++;
        if (end - r + 1 >= 3) runs.push({ dir: 'v', r: r, c: c, len: end - r + 1, type: tile.type });
        r = end + 1;
      }
    }
    return runs;
  };

  function runCells(run) {
    var cells = [];
    for (var i = 0; i < run.len; i++) {
      cells.push(run.dir === 'h' ? { r: run.r, c: run.c + i } : { r: run.r + i, c: run.c });
    }
    return cells;
  }

  /**
   * 把相交的连续段合并成一个消除组, 并判定该组应该产出什么特殊棋子:
   * 5 连 -> 彩虹魔杖, L/T 形 -> 魔法炸弹, 4 连 -> 对应方向的闪电。
   */
  Board.prototype.findMatches = function () {
    var runs = this.findRuns();
    if (!runs.length) return [];

    var groups = [];
    var cellOwner = {};

    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      var cells = runCells(run);
      var merged = null;

      for (var j = 0; j < cells.length; j++) {
        var owner = cellOwner[key(cells[j].r, cells[j].c)];
        if (owner !== undefined && groups[owner]) { merged = owner; break; }
      }

      if (merged === null) {
        groups.push({ type: run.type, runs: [run], cells: cells.slice() });
        merged = groups.length - 1;
      } else {
        var g = groups[merged];
        g.runs.push(run);
        for (var k = 0; k < cells.length; k++) {
          if (cellOwner[key(cells[k].r, cells[k].c)] === undefined) g.cells.push(cells[k]);
        }
      }
      for (var m = 0; m < cells.length; m++) cellOwner[key(cells[m].r, cells[m].c)] = merged;
    }

    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var maxLen = 0, hasH = false, hasV = false, longest = group.runs[0];
      for (var ri = 0; ri < group.runs.length; ri++) {
        var rr = group.runs[ri];
        if (rr.dir === 'h') hasH = true; else hasV = true;
        if (rr.len > maxLen) { maxLen = rr.len; longest = rr; }
      }
      group.maxLen = maxLen;

      if (maxLen >= 5) group.special = 'rainbow';
      else if (hasH && hasV) group.special = 'bomb';
      else if (maxLen === 4) group.special = longest.dir === 'h' ? 'row' : 'col';
      else group.special = null;

      group.longest = longest;
    }
    return groups;
  };

  /** 某个位置放上指定 type 后是否会形成三连(用于试算走法)。 */
  Board.prototype.wouldMatchAt = function (r, c, type) {
    var dirs = [[0, 1], [1, 0]];
    for (var d = 0; d < dirs.length; d++) {
      var count = 1;
      for (var sign = -1; sign <= 1; sign += 2) {
        var step = 1;
        while (true) {
          var nr = r + dirs[d][0] * step * sign;
          var nc = c + dirs[d][1] * step * sign;
          var tile = this.get(nr, nc);
          if (!tile || tile.type !== type) break;
          count++;
          step++;
        }
      }
      if (count >= 3) return true;
    }
    return false;
  };

  Board.prototype.swapTiles = function (a, b) {
    var ta = this.get(a.r, a.c);
    var tb = this.get(b.r, b.c);
    this.set(a.r, a.c, tb);
    this.set(b.r, b.c, ta);
  };

  /** 交换后是否产生消除(特殊棋子参与交换时永远有效)。 */
  Board.prototype.isValidSwap = function (a, b) {
    var ta = this.get(a.r, a.c);
    var tb = this.get(b.r, b.c);
    if (!ta || !tb) return false;
    if (ta.special || tb.special) return true;

    this.swapTiles(a, b);
    var ok = this.wouldMatchAt(a.r, a.c, this.get(a.r, a.c).type) ||
             this.wouldMatchAt(b.r, b.c, this.get(b.r, b.c).type);
    this.swapTiles(a, b);
    return ok;
  };

  /** 返回任意一个可行走法 {a, b}, 没有则返回 null。 */
  Board.prototype.findMove = function () {
    var candidates = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (c + 1 < this.cols) candidates.push([{ r: r, c: c }, { r: r, c: c + 1 }]);
        if (r + 1 < this.rows) candidates.push([{ r: r, c: c }, { r: r + 1, c: c }]);
      }
    }
    Util.shuffle(candidates);
    for (var i = 0; i < candidates.length; i++) {
      if (this.isValidSwap(candidates[i][0], candidates[i][1])) {
        return { a: candidates[i][0], b: candidates[i][1] };
      }
    }
    return null;
  };

  /** 原地重排现有棋子, 直到无三连且有解。 */
  Board.prototype.shuffleBoard = function () {
    var tiles = [];
    this.forEach(function (tile) { tiles.push(tile); });

    for (var attempt = 0; attempt < 80; attempt++) {
      Util.shuffle(tiles);
      var i = 0;
      for (var r = 0; r < this.rows; r++) {
        for (var c = 0; c < this.cols; c++) {
          if (i < tiles.length) this.set(r, c, tiles[i++]);
        }
      }
      if (!this.findRuns().length && this.findMove()) return true;
    }
    return false;
  };

  /**
   * 以 seeds 为起点向外展开消除范围, 逐个引爆遇到的特殊棋子(可连锁)。
   * partnerType: 彩虹魔杖被交换触发时, 指定要清除的角色种类。
   */
  Board.prototype.expandClears = function (seeds, partnerType) {
    var self = this;
    var marked = {};
    var queue = [];
    var cleared = [];
    var effects = [];

    function push(r, c) {
      if (!self.inside(r, c)) return;
      if (marked[key(r, c)]) return;
      var tile = self.get(r, c);
      if (!tile) return;
      marked[key(r, c)] = true;
      cleared.push({ r: r, c: c, tile: tile });
      queue.push({ r: r, c: c, tile: tile });
    }

    for (var i = 0; i < seeds.length; i++) push(seeds[i].r, seeds[i].c);

    while (queue.length) {
      var cur = queue.shift();
      var special = cur.tile.special;
      if (!special) continue;

      effects.push({ r: cur.r, c: cur.c, special: special, type: cur.tile.type });

      if (special === 'row') {
        for (var c1 = 0; c1 < this.cols; c1++) push(cur.r, c1);
      } else if (special === 'col') {
        for (var r1 = 0; r1 < this.rows; r1++) push(r1, cur.c);
      } else if (special === 'bomb') {
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) push(cur.r + dr, cur.c + dc);
        }
      } else if (special === 'rainbow') {
        var target = (partnerType === null || partnerType === undefined) ? cur.tile.type : partnerType;
        partnerType = null; // 只对首个彩虹生效, 连锁的彩虹用自身颜色
        for (var r2 = 0; r2 < this.rows; r2++) {
          for (var c2 = 0; c2 < this.cols; c2++) {
            var t = this.get(r2, c2);
            if (t && t.type === target) push(r2, c2);
          }
        }
      }
    }

    return { cleared: cleared, effects: effects };
  };

  /** 让棋子下落并在顶部补充新棋子。返回本次的移动与新生成列表, 交给渲染层做动画。 */
  Board.prototype.collapse = function () {
    var moves = [];
    var spawns = [];

    for (var c = 0; c < this.cols; c++) {
      var writeRow = this.rows - 1;
      for (var r = this.rows - 1; r >= 0; r--) {
        var tile = this.cells[r][c];
        if (!tile) continue;
        if (r !== writeRow) {
          this.cells[r][c] = null;
          this.set(writeRow, c, tile);
          moves.push({ tile: tile, fromRow: r, toRow: writeRow, distance: writeRow - r });
        }
        writeRow--;
      }
      var spawnIndex = 0;
      for (var nr = writeRow; nr >= 0; nr--) {
        var fresh = new Tile(this.randomType(), nr, c);
        this.set(nr, c, fresh);
        spawns.push({ tile: fresh, row: nr, col: c, offset: spawnIndex + 1 });
        spawnIndex++;
      }
    }
    return { moves: moves, spawns: spawns };
  };

  Board.prototype.remove = function (r, c) {
    this.cells[r][c] = null;
  };

  global.MK.Board = Board;
  global.MK.Tile = Tile;
})(window);
