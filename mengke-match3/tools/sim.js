/*
 * 无头对局模拟。把 js/core.js + js/board.js 跑在 vm 沙箱里, 再照着
 * js/game.js 的消除流程复现一遍(连锁、特殊棋子、计分、收集进度)。
 *
 * tools/test_board.js 用它验证棋盘不变量,
 * tools/balance.js 用它跑关卡配平。
 *
 * 注意: 这里的消除顺序与计分公式必须跟 js/game.js 保持一致, 改了那边
 * 记得同步, 否则配平出来的数值对不上真实手感。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/** 可复现的伪随机数(mulberry32), 配平时同一批种子才能横向比较。 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 载入一份独立的 MK 运行时。传 seed 则棋盘生成可复现。 */
function createRuntime(seed) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.localStorage = null;
  sandbox.document = { addEventListener() {} };
  if (seed === undefined) {
    sandbox.Math = Math;
  } else {
    const math = Object.create(Math);
    math.random = makeRng(seed);
    sandbox.Math = math;
  }

  const context = vm.createContext(sandbox);
  for (const file of ['js/core.js', 'js/board.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return sandbox.MK;
}

/* ------------------------------------------------------------------ *
 * 消除流程(对应 js/game.js 的 resolveCascade)
 * ------------------------------------------------------------------ */

/** 特殊棋子生成在哪一格: 优先落在刚交换的那格, 其次是横竖交叉点。 */
function pickCreationCell(group, lastSwap) {
  if (lastSwap) {
    for (const cell of group.cells) {
      if ((cell.r === lastSwap.a.r && cell.c === lastSwap.a.c) ||
          (cell.r === lastSwap.b.r && cell.c === lastSwap.b.c)) return cell;
    }
  }
  const hRuns = group.runs.filter((r) => r.dir === 'h');
  const vRuns = group.runs.filter((r) => r.dir === 'v');
  for (const h of hRuns) {
    for (const v of vRuns) {
      if (h.r >= v.r && h.r < v.r + v.len && v.c >= h.c && v.c < h.c + h.len) {
        return { r: h.r, c: v.c };
      }
    }
  }
  const longest = group.runs.reduce((a, b) => (b.len > a.len ? b : a));
  const mid = Math.floor(longest.len / 2);
  return longest.dir === 'h'
    ? { r: longest.r, c: longest.c + mid }
    : { r: longest.r + mid, c: longest.c };
}

/**
 * 跑完一次交换引发的全部连锁。
 * onStep({ cleared, effects, creations, cascade }) 每层连锁回调一次。
 * 返回连锁层数。
 */
function resolve(board, trigger, lastSwap, onStep) {
  let pending = trigger || { seeds: [], partnerType: null, extra: [] };
  let cascade = 0;

  for (;;) {
    if (++cascade > 400) throw new Error('消除流程没有收敛');
    const groups = board.findMatches();
    if (!groups.length && !pending.seeds.length && !pending.extra.length) break;

    const reserved = new Set();
    const creations = [];
    const seeds = [];

    for (const group of groups) {
      seeds.push(...group.cells);
      if (group.special) {
        const pos = pickCreationCell(group, lastSwap);
        reserved.add(pos.r + ',' + pos.c);
        creations.push({ r: pos.r, c: pos.c, special: group.special, type: group.type });
      }
    }
    seeds.push(...pending.seeds, ...pending.extra);
    const partnerType = pending.partnerType;
    pending = { seeds: [], partnerType: null, extra: [] };

    const res = board.expandClears(seeds, partnerType);
    const cleared = res.cleared.filter((x) => !reserved.has(x.r + ',' + x.c));
    if (!cleared.length && !creations.length) break;

    if (onStep) onStep({ cleared, effects: res.effects, creations, cascade });

    for (const c of cleared) board.remove(c.r, c.c);
    for (const creation of creations) {
      const tile = board.get(creation.r, creation.c);
      if (tile) {
        tile.special = creation.special;
        tile.type = creation.type;
      }
    }
    board.collapse();
    lastSwap = null;
  }
  return cascade;
}

/** 交换两格时, 特殊棋子本身要被引爆的那部分。 */
function buildTrigger(board, a, b) {
  const ta = board.get(a.r, a.c);
  const tb = board.get(b.r, b.c);
  const trigger = { seeds: [], partnerType: null, extra: [] };
  if (ta.special) trigger.seeds.push({ r: a.r, c: a.c });
  if (tb.special) trigger.seeds.push({ r: b.r, c: b.c });
  if (ta.special === 'rainbow' && !tb.special) trigger.partnerType = tb.type;
  if (tb.special === 'rainbow' && !ta.special) trigger.partnerType = ta.type;
  return trigger;
}

/* ------------------------------------------------------------------ *
 * 会看目标的机器玩家
 * ------------------------------------------------------------------ */

/**
 * 给每个可行走法打分: 只看交换后立刻成型的那几组(不展开连锁, 够快也够像
 * 人眼能看到的信息)。能推进收集目标的组权重更高, 能凑出特殊棋子再加一笔。
 */
function pickMove(board, needs, rng) {
  const SPECIAL_WEIGHT = { row: 6, col: 6, bomb: 9, rainbow: 16 };
  let best = null;
  let bestScore = -1;

  const consider = (a, b) => {
    if (!board.inside(b.r, b.c)) return;
    if (!board.isValidSwap(a, b)) return;

    board.swapTiles(a, b);
    let score = 0;
    for (const group of board.findMatches()) {
      score += group.cells.length * (needs[group.type] > 0 ? 4 : 1);
      if (group.special) score += SPECIAL_WEIGHT[group.special] || 0;
    }
    const ta = board.get(a.r, a.c);
    const tb = board.get(b.r, b.c);
    if (ta && ta.special) score += SPECIAL_WEIGHT[ta.special] || 0;
    if (tb && tb.special) score += SPECIAL_WEIGHT[tb.special] || 0;
    board.swapTiles(a, b);

    // 同分时随机挑一个, 免得总走左上角那步, 显得过于机械
    if (score > bestScore || (score === bestScore && rng() < 0.5)) {
      bestScore = score;
      best = { a: { r: a.r, c: a.c }, b: { r: b.r, c: b.c } };
    }
  };

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      consider({ r, c }, { r, c: c + 1 });
      consider({ r, c }, { r: r + 1, c });
    }
  }
  return best;
}

/**
 * 打一关。skill 是 0~1 的操作水平: 每步有 (1-skill) 的概率乱走一步,
 * 用来模拟小孩不会每次都找到最优解。
 * 返回 { won, score, stars, movesUsed, shuffles }。
 */
function playLevel(MK, level, options) {
  const opts = options || {};
  const rng = opts.rng || Math.random;
  const skill = opts.skill === undefined ? 1 : opts.skill;
  const CONFIG = MK.CONFIG;

  const board = new MK.Board(CONFIG.rows, CONFIG.cols, level.types);
  board.generate();

  const goals = level.collect.map((g) => ({ type: g.type, need: g.count, have: 0 }));
  const needs = {};
  const refreshNeeds = () => {
    for (const k of Object.keys(needs)) delete needs[k];
    for (const g of goals) if (g.have < g.need) needs[g.type] = 1;
  };
  refreshNeeds();

  let score = 0;
  let shuffles = 0;
  let moves = level.moves;
  const cleared = () => goals.every((g) => g.have >= g.need);

  const onStep = ({ cleared: gone, effects, cascade }) => {
    const multiplier = 1 + CONFIG.comboStep * (cascade - 1);
    score += Math.round(gone.length * CONFIG.scorePerTile * multiplier) +
             effects.length * CONFIG.specialBonus;
    for (const cell of gone) {
      for (const g of goals) {
        if (g.type === cell.tile.type && g.have < g.need) g.have++;
      }
    }
    refreshNeeds();
  };

  // 开局先把生成时可能残留的连锁清掉, 这部分不计步数
  resolve(board, null, null, onStep);

  while (moves > 0 && !cleared()) {
    let move = board.findMove();
    if (!move) {
      shuffles++;
      board.shuffleBoard();
      move = board.findMove();
      if (!move) break;
    } else if (rng() < skill) {
      move = pickMove(board, needs, rng) || move;
    }

    board.swapTiles(move.a, move.b);
    moves--;
    resolve(board, buildTrigger(board, move.a, move.b), { a: move.a, b: move.b }, onStep);
  }

  const won = cleared();
  let stars = 0;
  if (won) {
    const ratio = score / level.target;
    stars = ratio >= 1.5 ? 3 : (ratio >= 1 ? 2 : 1);
  }
  return { won, score, stars, movesUsed: level.moves - moves, shuffles, goals };
}

module.exports = {
  ROOT,
  makeRng,
  createRuntime,
  pickCreationCell,
  resolve,
  buildTrigger,
  pickMove,
  playLevel
};
