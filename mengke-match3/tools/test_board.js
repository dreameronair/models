/*
 * 棋盘逻辑的无头测试(不涉及 Canvas/DOM)。
 * 运行: node tools/test_board.js
 */
'use strict';

const sim = require('./sim');

const MK = sim.createRuntime();
const { Board, Tile, CONFIG, LEVELS } = MK;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.log('  ✗ ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

/** 用字符矩阵搭棋盘, '.' 表示空格。 */
function buildBoard(rows) {
  const board = new Board(rows.length, rows[0].length, 6);
  rows.forEach((line, r) => {
    line.split('').forEach((ch, c) => {
      board.set(r, c, ch === '.' ? null : new Tile(parseInt(ch, 10), r, c));
    });
  });
  return board;
}

function countTiles(board) {
  let n = 0;
  board.forEach(() => n++);
  return n;
}

function cellSet(list) {
  return new Set(list.map((x) => x.r + ',' + x.c));
}

/* ------------------------------------------------------------------ */
section('初始棋盘生成');
{
  for (let attempt = 0; attempt < 40; attempt++) {
    const board = new Board(8, 8, 5);
    board.generate();
    if (countTiles(board) !== 64) {
      check('每次生成都填满 64 格', false, '第 ' + attempt + ' 次只有 ' + countTiles(board));
      break;
    }
    if (board.findRuns().length) {
      check('生成时不存在三连', false, '第 ' + attempt + ' 次出现现成的三连');
      break;
    }
    if (!board.findMove()) {
      check('生成时至少有一个可行走法', false, '第 ' + attempt + ' 次开局即死局');
      break;
    }
    if (attempt === 39) {
      check('40 次生成均填满 64 格且无三连、有解', true);
    }
  }
}

/* ------------------------------------------------------------------ */
section('三连识别与特殊棋子判定');
{
  const board = buildBoard([
    '1110',
    '2323',
    '4545',
    '0101'
  ]);
  const groups = board.findMatches();
  check('横向三连识别为 1 组', groups.length === 1, '实际 ' + groups.length + ' 组');
  check('三连不产出特殊棋子', groups[0] && groups[0].special === null,
    '实际 ' + (groups[0] && groups[0].special));
  check('三连覆盖 3 格', groups[0] && groups[0].cells.length === 3);
}
{
  const g = buildBoard(['11110', '23232', '45454', '01010', '23232']).findMatches();
  check('横向四连 -> 横向闪电', g.length === 1 && g[0].special === 'row',
    '实际 ' + (g[0] && g[0].special));
}
{
  const g = buildBoard(['10000', '12222', '13333', '14444', '05555']).findMatches();
  const forCol = g.filter((x) => x.type === 1)[0];
  check('纵向四连 -> 纵向闪电', forCol && forCol.special === 'col',
    '实际 ' + (forCol && forCol.special));
}
{
  const g = buildBoard(['111110', '232323', '454545', '010101', '232323', '454545']).findMatches();
  check('五连 -> 彩虹魔杖', g.length === 1 && g[0].special === 'rainbow',
    '实际 ' + (g[0] && g[0].special));
  check('五连覆盖 5 格', g[0] && g[0].cells.length === 5);
}
{
  // L 形: 第 0 行三连 + 第 0 列三连, 共用左上角
  const g = buildBoard(['1112', '1232', '1454', '2323']).findMatches();
  check('L 形 -> 魔法炸弹', g.length === 1 && g[0].special === 'bomb',
    '实际 ' + g.length + ' 组 / ' + (g[0] && g[0].special));
  check('L 形合并为 5 格', g[0] && g[0].cells.length === 5,
    '实际 ' + (g[0] && g[0].cells.length));
}
{
  // T 形: 中间列三连 + 中间行三连
  const g = buildBoard(['21312', '11132', '21312', '32123']).findMatches();
  const t = g.filter((x) => x.type === 1)[0];
  check('T 形 -> 魔法炸弹', t && t.special === 'bomb', '实际 ' + (t && t.special));
}
{
  const board = buildBoard(['1112', '1112', '3333', '2323']);
  const groups = board.findMatches();
  const total = groups.reduce((sum, g) => sum + g.cells.length, 0);
  const unique = cellSet(groups.reduce((acc, g) => acc.concat(g.cells), []));
  check('多组同时消除时格子不重复统计', total === unique.size,
    '累计 ' + total + ' / 去重 ' + unique.size);
}

/* ------------------------------------------------------------------ */
section('特殊棋子引爆范围');
{
  const board = buildBoard([
    '012345',
    '123450',
    '234501',
    '345012',
    '450123',
    '501234'
  ]);
  board.get(2, 3).special = 'row';
  const res = board.expandClears([{ r: 2, c: 3 }], null);
  check('横向闪电清掉整行 6 格', res.cleared.length === 6, '实际 ' + res.cleared.length);
  check('横向闪电只影响该行', res.cleared.every((x) => x.r === 2));
}
{
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(3, 1).special = 'col';
  const res = board.expandClears([{ r: 3, c: 1 }], null);
  check('纵向闪电清掉整列 6 格', res.cleared.length === 6, '实际 ' + res.cleared.length);
  check('纵向闪电只影响该列', res.cleared.every((x) => x.c === 1));
}
{
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(2, 2).special = 'bomb';
  const res = board.expandClears([{ r: 2, c: 2 }], null);
  check('炸弹清掉九宫格', res.cleared.length === 9, '实际 ' + res.cleared.length);
}
{
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(0, 0).special = 'bomb';
  const res = board.expandClears([{ r: 0, c: 0 }], null);
  check('角上的炸弹只清 4 格(不越界)', res.cleared.length === 4, '实际 ' + res.cleared.length);
}
{
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(0, 0).special = 'rainbow';
  const res = board.expandClears([{ r: 0, c: 0 }], 3);
  const nonTarget = res.cleared.filter((x) => x.tile.type !== 3 && !(x.r === 0 && x.c === 0));
  check('彩虹魔杖清除指定颜色的全部棋子', res.cleared.length === 7, '实际 ' + res.cleared.length);
  check('彩虹魔杖不误伤其他颜色', nonTarget.length === 0);
}
{
  // 连锁: 横向闪电扫到同一行的纵向闪电
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(2, 0).special = 'row';
  board.get(2, 4).special = 'col';
  const res = board.expandClears([{ r: 2, c: 0 }], null);
  check('特殊棋子可以连锁引爆', res.cleared.length === 11, '实际 ' + res.cleared.length);
  check('连锁记录了两个特效', res.effects.length === 2, '实际 ' + res.effects.length);
}
{
  const board = buildBoard(['012345', '123450', '234501', '345012', '450123', '501234']);
  board.get(0, 0).special = 'row';
  board.get(0, 1).special = 'row';
  const res = board.expandClears([{ r: 0, c: 0 }], null);
  check('重复引爆不会死循环', res.cleared.length === 6, '实际 ' + res.cleared.length);
}

/* ------------------------------------------------------------------ */
section('下落与补充');
{
  const board = buildBoard([
    '0123',
    '1234',
    '2345',
    '3450'
  ]);
  board.remove(3, 0);
  board.remove(2, 0);
  board.remove(0, 2);
  const before = countTiles(board);
  const res = board.collapse();

  check('下落后棋盘重新填满', countTiles(board) === 16, '实际 ' + countTiles(board));
  check('新生成的数量等于空缺数', res.spawns.length === 16 - before,
    '空缺 ' + (16 - before) + ' / 新生 ' + res.spawns.length);
  check('列 0 的原有棋子被压到底部',
    board.get(3, 0).type === 1 && board.get(2, 0).type === 0);
  check('移动记录带有正的下落距离', res.moves.every((m) => m.distance > 0));
  check('新棋子的行列坐标与自身一致',
    res.spawns.every((s) => s.tile.r === s.row && s.tile.c === s.col));
  check('新棋子出现在空缺列的顶部', res.spawns.every((s) => s.col === 0 || s.col === 2));
}

/* ------------------------------------------------------------------ */
section('走法判定');
{
  const board = buildBoard([
    '01234',
    '10234',
    '23401',
    '34012',
    '40123'
  ]);
  // (0,0)=0 与 (1,0)=1 交换后, 第 0 列变成 1/0..., 第 0 行变成 1 0 2 3 4
  check('无效交换被拒绝',
    !board.isValidSwap({ r: 0, c: 3 }, { r: 0, c: 4 }));

  const b2 = buildBoard(['0012', '1201', '0120', '2101']);
  check('能凑成三连的交换判定为有效',
    b2.isValidSwap({ r: 0, c: 2 }, { r: 1, c: 2 }),
    '(0,2)与(1,2)交换后第 0 行应为 0 0 0');

  const b3 = buildBoard(['0123', '1230', '2301', '3012']);
  b3.get(0, 0).special = 'bomb';
  check('特殊棋子参与的交换永远有效', b3.isValidSwap({ r: 0, c: 0 }, { r: 0, c: 1 }));

  // 每行是 ABAB 且相邻行不共用颜色 -> 任何一次交换都凑不出三连
  const dead = buildBoard(['0101', '2323', '4545', '0101']);
  check('棋盘无解时 findMove 返回 null', dead.findMove() === null);

  const alive = buildBoard(['0012', '1201', '0120', '2101']);
  check('有解时 findMove 返回可行走法', alive.findMove() !== null);
  const move = alive.findMove();
  check('findMove 返回的走法确实有效', alive.isValidSwap(move.a, move.b));
  check('findMove 返回的两格相邻',
    Math.abs(move.a.r - move.b.r) + Math.abs(move.a.c - move.b.c) === 1);
}
{
  const board = new Board(8, 8, 6);
  board.generate();
  const snapshot = [];
  board.forEach((t) => snapshot.push(t.type));
  const ok = board.shuffleBoard();
  const after = [];
  board.forEach((t) => after.push(t.type));
  check('洗牌成功并保持无三连有解',
    ok && !board.findRuns().length && board.findMove() !== null);
  check('洗牌不改变棋子总数与颜色分布',
    after.length === snapshot.length &&
    snapshot.slice().sort().join() === after.slice().sort().join());
}

/* ------------------------------------------------------------------ */
section('完整对局模拟(复用 Game 的消除流程逻辑)');
{
  // 消除流程与机器玩家都放在 tools/sim.js, tools/balance.js 配平时用的是
  // 同一份代码, 免得测试和配平各跑各的、结论对不上
  const { resolve, buildTrigger } = sim;

  let invariantBroken = null;
  const stats = { cleared: 0, specialsMade: 0, specialsFired: 0, shuffles: 0, moves: 0 };

  for (let game = 0; game < 30 && !invariantBroken; game++) {
    const level = LEVELS[game % LEVELS.length];
    const board = new Board(CONFIG.rows, CONFIG.cols, level.types);
    board.generate();

    for (let turn = 0; turn < 60; turn++) {
      let move = board.findMove();
      if (!move) {
        stats.shuffles++;
        board.shuffleBoard();
        move = board.findMove();
        if (!move) { invariantBroken = '洗牌后依然无解'; break; }
      }

      board.swapTiles(move.a, move.b);
      stats.moves++;
      const trigger = buildTrigger(board, move.a, move.b);
      resolve(board, trigger, { a: move.a, b: move.b }, (step) => {
        stats.cleared += step.cleared.length;
        stats.specialsMade += step.creations.length;
        stats.specialsFired += step.effects.length;
      });

      if (countTiles(board) !== CONFIG.rows * CONFIG.cols) {
        invariantBroken = '消除结束后棋盘有空格: ' + countTiles(board);
        break;
      }
      if (board.findRuns().length) {
        invariantBroken = '消除结束后仍存在未处理的三连';
        break;
      }
      let coordsOk = true;
      board.forEach((tile, r, c) => {
        if (tile.r !== r || tile.c !== c) coordsOk = false;
        if (tile.type < 0 || tile.type >= level.types) coordsOk = false;
      });
      if (!coordsOk) { invariantBroken = '棋子坐标或颜色越界'; break; }
    }
  }

  check('30 局 x 60 步全程无异常', !invariantBroken, invariantBroken || '');
  check('模拟过程确实在消除棋子', stats.cleared > 10000, '共消除 ' + stats.cleared);
  check('模拟过程生成过特殊棋子', stats.specialsMade > 50, '共生成 ' + stats.specialsMade);
  check('模拟过程引爆过特殊棋子', stats.specialsFired > 20, '共引爆 ' + stats.specialsFired);
  console.log('    统计: ' + JSON.stringify(stats));
}

/* ------------------------------------------------------------------ */
section('关卡配置');
{
  let ok = true;
  let detail = '';
  LEVELS.forEach((level, i) => {
    if (level.types < 3 || level.types > MK.CHARACTERS.length) {
      ok = false; detail = '第 ' + (i + 1) + ' 关角色种类数越界';
    }
    if (level.moves <= 0 || level.target <= 0) {
      ok = false; detail = '第 ' + (i + 1) + ' 关步数或目标分非正数';
    }
    level.collect.forEach((goal) => {
      if (goal.type >= level.types) {
        ok = false;
        detail = '第 ' + (i + 1) + ' 关的收集目标 ' + goal.type + ' 不在本关角色池内';
      }
      // 每步理论上至少能消 3 个, 收集目标不该超过理论上限
      if (goal.count > level.moves * 3) {
        ok = false; detail = '第 ' + (i + 1) + ' 关收集目标过高';
      }
    });
  });
  check('所有关卡配置自洽(收集目标都在本关角色池内且可达)', ok, detail);

  check('一共 100 关', LEVELS.length === 100, '实际 ' + LEVELS.length + ' 关');

  {
    let bad = '';
    LEVELS.forEach((level, i) => {
      const types = level.collect.map((g) => g.type);
      if (new Set(types).size !== types.length) bad = '第 ' + (i + 1) + ' 关';
    });
    check('同一关的收集目标不会重复同一个角色', !bad, bad);
  }

  {
    // 六个角色都得在某些关里当过目标, 否则有人从头到尾只是背景板
    const seen = new Set();
    LEVELS.forEach((level) => level.collect.forEach((g) => seen.add(g.type)));
    check('六个角色都当过收集目标', seen.size === MK.CHARACTERS.length,
      '只用到 ' + seen.size + ' 个');
  }

  {
    // 难度用「每步需要消掉多少个目标」衡量。同种类数的关卡之间, 分章看应当
    // 越往后越紧 —— 5 种和 6 种的速率差快一倍, 混在一起比没有意义。
    let bad = '';
    for (const types of [5, 6]) {
      const perChapter = [];
      for (let c = 0; c < 10; c++) {
        const part = LEVELS.slice(c * 10, c * 10 + 10).filter((l) => l.types === types);
        if (!part.length) continue;
        const avg = part.reduce((s, l) => s + l.collect[0].count / l.moves, 0) / part.length;
        perChapter.push({ c: c + 1, avg });
      }
      for (let k = 1; k < perChapter.length; k++) {
        if (perChapter[k].avg < perChapter[k - 1].avg - 0.02) {
          bad = types + ' 种角色: 第 ' + perChapter[k].c + ' 章比上一章松了';
        }
      }
    }
    check('难度逐章递增(每步需消除量不回落)', !bad, bad);
  }

  {
    // 每章第一关多给两步当缓冲, 收集量不该跟着水涨船高
    let bad = '';
    for (let c = 1; c < 10; c++) {
      const opener = LEVELS[c * 10];
      const next = LEVELS[c * 10 + 1];
      if (opener.types !== next.types) continue;
      if (opener.collect[0].count / opener.moves >= next.collect[0].count / next.moves) {
        bad = '第 ' + (c * 10 + 1) + ' 关并不比下一关松';
      }
    }
    check('每章开场关确实更宽松', !bad, bad);
  }
}

console.log('\n' + (failed ? '✗ ' : '✓ ') + passed + ' 项通过, ' + failed + ' 项失败');
process.exit(failed ? 1 : 0);
