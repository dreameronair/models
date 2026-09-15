/*
 * 端到端验证: 用移动端视口 + 微信 UA 打开游戏, 走真实的指针/触摸事件下棋,
 * 检查分数、步数、特殊棋子、通关流程, 并输出截图。
 *
 * 运行: node tools/test_browser.js [baseUrl] [截图输出目录]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const SHOT_DIR = process.argv[3] || path.join(__dirname, '..', '.shots');

const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2d) NetType/WIFI Language/zh_CN';

let passed = 0;
let failed = 0;
const problems = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    problems.push(name + (detail ? ' -> ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function section(title) { console.log('\n' + title); }

const state = (page) => page.evaluate(() => {
  const g = window.__MK_GAME;
  if (!g) return null;
  const specials = {};
  g.board.forEach((t) => {
    if (t.special) specials[t.special] = (specials[t.special] || 0) + 1;
  });
  let tiles = 0;
  g.board.forEach(() => tiles++);
  return {
    state: g.state,
    score: g.score,
    moves: g.moves,
    level: g.levelIndex,
    tiles,
    specials,
    runs: g.board.findRuns().length,
    hasMove: g.board.findMove() !== null,
    collected: g.collected.map((c) => c.have + '/' + c.need),
    hudScore: document.getElementById('hudScore').textContent,
    hudMoves: document.getElementById('hudMoves').textContent,
    activeScreen: (document.querySelector('.screen.is-active') || {}).id
  };
});

const waitIdle = (page) =>
  page.waitForFunction(() => window.__MK_GAME && window.__MK_GAME.state !== 'busy',
    null, { timeout: 15000 });

async function swipeMove(page) {
  const move = await page.evaluate(() => {
    const g = window.__MK_GAME;
    if (!g || g.state !== 'idle') return null;
    const m = g.board.findMove();
    if (!m) return null;
    const rect = g.canvas.getBoundingClientRect();
    return {
      from: { x: rect.left + g.cellX(m.a.c), y: rect.top + g.cellY(m.a.r) },
      to: { x: rect.left + g.cellX(m.b.c), y: rect.top + g.cellY(m.b.r) }
    };
  });
  if (!move) return false;
  await page.mouse.move(move.from.x, move.from.y);
  await page.mouse.down();
  await page.mouse.move(move.to.x, move.to.y, { steps: 8 });
  await page.mouse.up();
  await waitIdle(page);
  return true;
}

/**
 * 铺一个确定性棋盘: 基底用 (r + 2c) % 种类数 保证横竖都不会自然三连,
 * 再套用 overrides 摆出想验证的形状。返回摆好后的自检信息。
 */
async function stageBoard(page, overrides, swap) {
  return page.evaluate((payload) => {
    const g = window.__MK_GAME;
    const b = g.board;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const tile = b.get(r, c);
        tile.type = (r + 2 * c) % b.typeCount;
        tile.special = null;
        tile.scale = 1;
        tile.alpha = 1;
        tile.spin = 0;
      }
    }
    payload.overrides.forEach((o) => { b.get(o[0], o[1]).type = o[2]; });
    g.snapTiles();
    return {
      runsBefore: b.findRuns().length,
      swapValid: b.isValidSwap(payload.swap.a, payload.swap.b)
    };
  }, { overrides, swap });
}

/** 读出棋盘上所有特殊棋子的位置与种类。 */
const specialList = (page) => page.evaluate(() => {
  const out = [];
  window.__MK_GAME.board.forEach((t, r, c) => {
    if (t.special) out.push({ r, c, special: t.special, type: t.type });
  });
  return out;
});

/** 关掉可能存在的弹层并重开一关, 让后续用例从干净状态开始。 */
async function resetLevel(page, index) {
  await page.evaluate((lv) => {
    window.MK.UI.closeCard();
    window.__MK_GAME.start(lv);
  }, index);
  await waitIdle(page);
}

/**
 * 验证单个机制时用的沙盒: 放宽步数并把收集目标抬到不可能达成,
 * 避免测试中途意外通关/失败导致后续操作被忽略。
 */
async function sandbox(page, moves) {
  await page.evaluate((m) => {
    const g = window.__MK_GAME;
    g.moves = m;
    g.collected.forEach((goal) => { goal.need = 99999; goal.have = 0; });
    g.pushHud();
  }, moves);
}

/** 用真实 TouchEvent 走一遍滑动, 验证移动端输入路径。 */
async function touchSwipe(page) {
  return page.evaluate(() => {
    const g = window.__MK_GAME;
    if (!g || g.state !== 'idle') return false;
    const m = g.board.findMove();
    if (!m) return false;
    const canvas = g.canvas;
    const rect = canvas.getBoundingClientRect();
    const from = { x: rect.left + g.cellX(m.a.c), y: rect.top + g.cellY(m.a.r) };
    const to = { x: rect.left + g.cellX(m.b.c), y: rect.top + g.cellY(m.b.r) };

    function fire(type, point) {
      const touch = new Touch({
        identifier: 1, target: canvas,
        clientX: point.x, clientY: point.y,
        pageX: point.x, pageY: point.y
      });
      canvas.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true, cancelable: true
      }));
    }
    fire('touchstart', from);
    fire('touchmove', to);
    fire('touchend', to);
    return true;
  });
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: WECHAT_UA,
    locale: 'zh-CN'
  });
  const page = await context.newPage();

  // 主流程钉在原创形象上: 不碰外网, 结果可复现。在线形象另有专门一节测。
  await page.addInitScript(() => {
    localStorage.setItem('mengke-match3-v1', JSON.stringify({ skin: 'original' }));
  });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  const failedRequests = [];
  page.on('requestfailed', (req) => failedRequests.push(req.url()));
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(res.status() + ' ' + res.url());
  });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
  };

  /* ---------------------------------------------------------------- */
  section('加载与首页');
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#screen-home.is-active', { timeout: 15000 });
  check('首页正常显示', true);
  check('所有静态资源加载成功', failedRequests.length === 0, failedRequests.join(', '));

  const petCount = await page.locator('.home-pets img').count();
  check('首页展示 6 只萌宠形象', petCount === 6, '实际 ' + petCount);

  const petLoaded = await page.evaluate(() =>
    Array.prototype.every.call(document.querySelectorAll('.home-pets img'),
      (img) => img.complete && img.naturalWidth > 0));
  check('萌宠图片全部解码成功', petLoaded);

  const noFallback = await page.evaluate(() => window.MK.Assets.missing.length === 0);
  check('没有走兜底精灵(说明图片路径正确)', noFallback);
  await shot('01-home');

  /* ---------------------------------------------------------------- */
  section('玩法说明与关卡选择');
  await page.click('#btnHowTo');
  await page.waitForSelector('#overlay.is-active');
  const helpText = await page.textContent('#overlayCard');
  check('玩法说明包含四种魔法棋子',
    ['横向闪电', '纵向闪电', '魔法炸弹', '彩虹魔杖'].every((k) => helpText.includes(k)));
  await shot('02-help');
  await page.click('[data-action="close"]');

  await page.click('#btnLevels');
  await page.waitForSelector('#screen-levels.is-active');
  const levelCount = await page.locator('.level-card').count();
  const lockedCount = await page.locator('.level-card.is-locked').count();
  const chapterCount = await page.locator('.chapter-head').count();
  check('关卡列表渲染 100 关', levelCount === 100, '实际 ' + levelCount);
  check('关卡按 10 章分组', chapterCount === 10, '实际 ' + chapterCount);
  check('首次进入只解锁第 1 关', lockedCount === 99, '实际锁住 ' + lockedCount);
  check('当前关卡有高亮',
    await page.locator('.level-card.is-current b').textContent() === '1');
  await shot('03-levels');

  /* ---------------------------------------------------------------- */
  section('进入关卡');
  await page.click('.level-card[data-level="0"]');
  await page.waitForSelector('#screen-game.is-active');
  await waitIdle(page);

  let snapshot = await state(page);
  check('棋盘填满 64 格', snapshot.tiles === 64, '实际 ' + snapshot.tiles);
  check('开局没有现成三连', snapshot.runs === 0, '实际 ' + snapshot.runs);
  check('开局有可行走法', snapshot.hasMove);
  // 步数跟着关卡配置走, 别写死数字, 不然每次重新配平都要改测试
  const firstMoves = await page.evaluate(() => window.MK.LEVELS[0].moves);
  check('步数按关卡配置初始化', snapshot.moves === firstMoves,
    '实际 ' + snapshot.moves + ', 配置 ' + firstMoves);
  check('HUD 步数与内部状态一致', snapshot.hudMoves === String(firstMoves),
    '实际 ' + snapshot.hudMoves);

  const canvasBox = await page.locator('#board').boundingBox();
  check('棋盘为正方形', Math.abs(canvasBox.width - canvasBox.height) < 1.5,
    canvasBox.width + 'x' + canvasBox.height);
  check('棋盘宽度适配屏幕', canvasBox.width > 300 && canvasBox.width <= 390,
    '实际 ' + canvasBox.width);

  const fitsViewport = await page.evaluate(() => {
    const props = document.querySelector('.props').getBoundingClientRect();
    return props.bottom <= window.innerHeight + 1;
  });
  check('道具栏没有被挤出屏幕', fitsViewport);
  await shot('04-board');

  /* ---------------------------------------------------------------- */
  section('点选交换');
  const beforeTap = await state(page);
  const tapped = await page.evaluate(() => {
    const g = window.__MK_GAME;
    const m = g.board.findMove();
    const rect = g.canvas.getBoundingClientRect();
    window.__tapTargets = {
      a: { x: rect.left + g.cellX(m.a.c), y: rect.top + g.cellY(m.a.r) },
      b: { x: rect.left + g.cellX(m.b.c), y: rect.top + g.cellY(m.b.r) }
    };
    return true;
  });
  const targets = await page.evaluate(() => window.__tapTargets);
  await page.mouse.click(targets.a.x, targets.a.y);
  const selected = await page.evaluate(() => window.__MK_GAME.selected !== null);
  check('点击第一格后进入选中态', selected);
  await page.mouse.click(targets.b.x, targets.b.y);
  await waitIdle(page);
  let afterTap = await state(page);
  check('点选相邻格完成一次交换并得分', afterTap.score > beforeTap.score,
    beforeTap.score + ' -> ' + afterTap.score);
  check('交换消耗一步', afterTap.moves === beforeTap.moves - 1,
    beforeTap.moves + ' -> ' + afterTap.moves);
  check('消除后棋盘依旧填满', afterTap.tiles === 64, '实际 ' + afterTap.tiles);
  check('消除后没有残留三连', afterTap.runs === 0, '实际 ' + afterTap.runs);

  /* ---------------------------------------------------------------- */
  section('触摸滑动交换');
  const beforeTouch = await state(page);
  const touched = await touchSwipe(page);
  check('触摸事件被正确接收', touched);
  await waitIdle(page);
  const afterTouch = await state(page);
  check('滑动同样能完成交换', afterTouch.moves === beforeTouch.moves - 1,
    beforeTouch.moves + ' -> ' + afterTouch.moves);

  /* ---------------------------------------------------------------- */
  section('无效交换不消耗步数');
  const beforeBad = await state(page);
  const badDone = await page.evaluate(async () => {
    const g = window.__MK_GAME;
    // 找一对交换后不产生消除的相邻棋子
    for (let r = 0; r < g.board.rows; r++) {
      for (let c = 0; c < g.board.cols - 1; c++) {
        const a = { r, c }, b = { r, c: c + 1 };
        if (!g.board.isValidSwap(a, b)) {
          const rect = g.canvas.getBoundingClientRect();
          window.__badTargets = {
            a: { x: rect.left + g.cellX(a.c), y: rect.top + g.cellY(a.r) },
            b: { x: rect.left + g.cellX(b.c), y: rect.top + g.cellY(b.r) }
          };
          return true;
        }
      }
    }
    return false;
  });
  if (badDone) {
    const bad = await page.evaluate(() => window.__badTargets);
    await page.mouse.move(bad.a.x, bad.a.y);
    await page.mouse.down();
    await page.mouse.move(bad.b.x, bad.b.y, { steps: 8 });
    await page.mouse.up();
    await waitIdle(page);
    const afterBad = await state(page);
    check('无效交换会弹回且不扣步数', afterBad.moves === beforeBad.moves,
      beforeBad.moves + ' -> ' + afterBad.moves);
    check('无效交换不加分', afterBad.score === beforeBad.score);
  } else {
    check('无效交换会弹回且不扣步数', false, '没找到无效交换的样本');
  }

  /* ---------------------------------------------------------------- */
  section('特殊棋子生成(确定性棋盘)');
  await resetLevel(page, 0);
  await sandbox(page, 500);

  // 横向四连 -> 横向闪电, 且生成在玩家交换的那一格
  let staged = await stageBoard(page,
    [[4, 1, 0], [4, 2, 0], [4, 4, 0], [3, 3, 0], [4, 3, 1]],
    { a: { r: 3, c: 3 }, b: { r: 4, c: 3 } });
  check('四连棋盘摆好时本身没有三连', staged.runsBefore === 0, '实际 ' + staged.runsBefore);
  check('该交换被判定为有效', staged.swapValid);
  await page.evaluate(() => window.__MK_GAME.trySwap({ r: 3, c: 3 }, { r: 4, c: 3 }));
  await waitIdle(page);
  let specials = await specialList(page);
  check('横向四连生成了横向闪电',
    specials.length === 1 && specials[0].special === 'row',
    JSON.stringify(specials));
  check('闪电生成在玩家交换的格子上',
    specials.length === 1 && specials[0].c === 3,
    JSON.stringify(specials));
  await shot('05-special-row');

  // 纵向四连 -> 纵向闪电
  staged = await stageBoard(page,
    [[1, 4, 0], [2, 4, 0], [4, 4, 0], [3, 3, 0], [3, 4, 1]],
    { a: { r: 3, c: 3 }, b: { r: 3, c: 4 } });
  check('纵向四连棋盘摆好时没有三连', staged.runsBefore === 0, '实际 ' + staged.runsBefore);
  await page.evaluate(() => window.__MK_GAME.trySwap({ r: 3, c: 3 }, { r: 3, c: 4 }));
  await waitIdle(page);
  specials = await specialList(page);
  check('纵向四连生成了纵向闪电',
    specials.length === 1 && specials[0].special === 'col',
    JSON.stringify(specials));

  // L 形 -> 魔法炸弹
  staged = await stageBoard(page,
    [[4, 1, 1], [4, 2, 0], [4, 3, 0], [5, 1, 0], [6, 1, 0], [3, 1, 0]],
    { a: { r: 3, c: 1 }, b: { r: 4, c: 1 } });
  check('L 形棋盘摆好时没有三连', staged.runsBefore === 0, '实际 ' + staged.runsBefore);
  await page.evaluate(() => window.__MK_GAME.trySwap({ r: 3, c: 1 }, { r: 4, c: 1 }));
  await waitIdle(page);
  specials = await specialList(page);
  check('L 形生成了魔法炸弹',
    specials.length === 1 && specials[0].special === 'bomb',
    JSON.stringify(specials));

  // 五连 -> 彩虹魔杖
  staged = await stageBoard(page,
    [[4, 1, 0], [4, 2, 0], [4, 4, 0], [4, 5, 0], [3, 3, 0], [4, 3, 1]],
    { a: { r: 3, c: 3 }, b: { r: 4, c: 3 } });
  check('五连棋盘摆好时没有三连', staged.runsBefore === 0, '实际 ' + staged.runsBefore);
  await page.evaluate(() => window.__MK_GAME.trySwap({ r: 3, c: 3 }, { r: 4, c: 3 }));
  await waitIdle(page);
  specials = await specialList(page);
  check('五连生成了彩虹魔杖',
    specials.length === 1 && specials[0].special === 'rainbow',
    JSON.stringify(specials));

  // 四种魔法棋子同时在场, 用于确认标识画得出来且互相区分
  await stageBoard(page, [], { a: { r: 0, c: 0 }, b: { r: 0, c: 1 } });
  await page.evaluate(() => {
    const b = window.__MK_GAME.board;
    b.get(2, 2).special = 'row';
    b.get(2, 5).special = 'col';
    b.get(5, 2).special = 'bomb';
    b.get(5, 5).special = 'rainbow';
  });
  await page.waitForTimeout(350);
  specials = await specialList(page);
  check('四种魔法棋子可以同时存在', specials.length === 4, JSON.stringify(specials));
  check('棋盘上没有意外的三连',
    (await state(page)).runs === 0);
  await shot('06-all-specials');

  /* ---------------------------------------------------------------- */
  section('特殊棋子引爆');
  // 横向闪电: 交换即引爆整行
  staged = await stageBoard(page, [], { a: { r: 4, c: 3 }, b: { r: 4, c: 4 } });
  const rowBlast = await page.evaluate(() => {
    const g = window.__MK_GAME;
    g.board.get(4, 3).special = 'row';
    const before = g.score;
    g.trySwap({ r: 4, c: 3 }, { r: 4, c: 4 });
    return before;
  });
  await waitIdle(page);
  let snap = await state(page);
  check('横向闪电交换后立即引爆并加分', snap.score - rowBlast >= 8 * 60,
    '加了 ' + (snap.score - rowBlast) + ' 分');
  check('引爆后棋盘完整无残留三连', snap.tiles === 64 && snap.runs === 0);

  // 彩虹魔杖: 与普通棋子交换, 清掉该颜色全部
  const rainbowBlast = await page.evaluate(() => {
    const g = window.__MK_GAME;
    g.board.forEach((t) => { t.special = null; });
    g.board.get(4, 4).special = 'rainbow';
    const targetType = g.board.get(4, 3).type;
    let sameBefore = 0;
    g.board.forEach((t) => { if (t.type === targetType) sameBefore++; });
    const before = g.score;
    g.trySwap({ r: 4, c: 4 }, { r: 4, c: 3 });
    return { sameBefore, before, targetType };
  });
  await waitIdle(page);
  snap = await state(page);
  check('彩虹魔杖清掉整种颜色并大幅加分',
    snap.score - rainbowBlast.before > rainbowBlast.sameBefore * 60,
    '同色 ' + rainbowBlast.sameBefore + ' 个, 加了 ' + (snap.score - rainbowBlast.before) + ' 分');
  check('彩虹魔杖引爆后棋盘仍然完整', snap.tiles === 64 && snap.runs === 0);

  // 炸弹 + 闪电的合体技: 应该清掉三行三列
  const comboBlast = await page.evaluate(() => {
    const g = window.__MK_GAME;
    g.board.forEach((t) => { t.special = null; });
    g.board.get(4, 3).special = 'bomb';
    g.board.get(4, 4).special = 'row';
    const before = g.score;
    g.trySwap({ r: 4, c: 3 }, { r: 4, c: 4 });
    return before;
  });
  await waitIdle(page);
  snap = await state(page);
  check('炸弹与闪电的合体技清掉大片棋子',
    snap.score - comboBlast >= 30 * 60,
    '加了 ' + (snap.score - comboBlast) + ' 分');
  check('合体技后棋盘仍然完整', snap.tiles === 64 && snap.runs === 0);
  await shot('06b-after-combo');

  /* ---------------------------------------------------------------- */
  section('道具');
  // 上一节改过棋盘, 重开一关保证从可操作状态开始
  await resetLevel(page, 0);
  await sandbox(page, 500);
  const beforeHammer = await state(page);
  check('重开关卡后回到可操作状态', beforeHammer.state === 'idle', beforeHammer.state);
  await page.click('#propHammer');
  const hammerArmed = await page.evaluate(() => window.__MK_GAME.propMode === 'hammer');
  check('点击魔法锤进入待选状态', hammerArmed);
  const hammerTarget = await page.evaluate(() => {
    const g = window.__MK_GAME;
    const rect = g.canvas.getBoundingClientRect();
    return { x: rect.left + g.cellX(3), y: rect.top + g.cellY(3) };
  });
  await page.mouse.click(hammerTarget.x, hammerTarget.y);
  await waitIdle(page);
  const afterHammer = await state(page);
  check('魔法锤消耗一次道具',
    await page.evaluate(() => window.__MK_GAME.props.hammer) === 1);
  check('魔法锤不消耗步数', afterHammer.moves === beforeHammer.moves,
    beforeHammer.moves + ' -> ' + afterHammer.moves);
  check('魔法锤后棋盘仍然完整', afterHammer.tiles === 64 && afterHammer.runs === 0);

  const beforeShuffle = await state(page);
  await page.click('#propShuffle');
  await waitIdle(page);
  const afterShuffle = await state(page);
  check('洗牌后棋盘无三连且有解',
    afterShuffle.runs === 0 && afterShuffle.hasMove && afterShuffle.tiles === 64);
  check('洗牌不消耗步数', afterShuffle.moves === beforeShuffle.moves);

  await page.click('#propHint');
  const hintShown = await page.evaluate(() => window.__MK_GAME.hint !== null);
  check('提示能找出一个可行走法', hintShown);
  await shot('07-hint');

  /* ---------------------------------------------------------------- */
  section('暂停与恢复');
  await page.click('#btnPause');
  await page.waitForSelector('#overlay.is-active');
  check('暂停时游戏循环冻结', await page.evaluate(() => window.__MK_GAME.paused));
  await shot('08-pause');
  await page.click('[data-action="resume"]');
  check('恢复后可继续操作', !(await page.evaluate(() => window.__MK_GAME.paused)));

  /* ---------------------------------------------------------------- */
  section('连续对局稳定性');
  await resetLevel(page, 4);
  await sandbox(page, 500);
  let movesPlayed = 0;
  for (let i = 0; i < 25; i++) {
    const snap = await state(page);
    if (snap.activeScreen !== 'screen-game' || snap.state === 'over') break;
    const ok = await swipeMove(page);
    if (!ok) break;
    movesPlayed++;
    const after = await state(page);
    if (after.tiles !== 64 || after.runs !== 0) {
      check('连续对局中棋盘不变式保持', false,
        '第 ' + movesPlayed + ' 步后 tiles=' + after.tiles + ' runs=' + after.runs);
      break;
    }
  }
  check('可以连续走 ' + movesPlayed + ' 步不出错', movesPlayed >= 20, '只走了 ' + movesPlayed);

  /* ---------------------------------------------------------------- */
  section('失败流程');
  await resetLevel(page, 0);
  await page.evaluate(() => {
    const g = window.__MK_GAME;
    // 目标不可能达成 + 只剩一步 -> 必定判负
    g.collected.forEach((goal) => { goal.need = 99999; goal.have = 0; });
    g.moves = 1;
    g.pushHud();
  });
  let guard = 0;
  while (guard++ < 8) {
    const snap = await state(page);
    if (snap.state === 'over') break;
    if (!(await swipeMove(page))) break;
  }
  await page.waitForSelector('#overlay.is-active', { timeout: 8000 });
  const loseText = await page.textContent('#overlayCard');
  check('步数用完时弹出失败结算', loseText.includes('步数用完'), loseText.slice(0, 40));
  await shot('09-lose');
  await page.click('[data-action="restart"]');
  await waitIdle(page);
  const afterRestart = await state(page);
  check('重玩后分数与步数重置',
    afterRestart.score === 0 && afterRestart.moves === firstMoves,
    'score=' + afterRestart.score + ' moves=' + afterRestart.moves);

  /* ---------------------------------------------------------------- */
  section('通关与解锁');
  await resetLevel(page, 0);
  await page.evaluate(() => {
    const g = window.__MK_GAME;
    g.score = Math.round(window.MK.LEVELS[g.levelIndex].target * 1.6);
    g.collected.forEach((goal) => { goal.have = goal.need - 1; });
    g.pushHud();
  });
  guard = 0;
  while (guard++ < 25) {
    const snap = await state(page);
    if (snap.state === 'over') break;
    if (!(await swipeMove(page))) break;
    const done = await page.evaluate(() => window.__MK_GAME.isCleared());
    if (done) break;
  }
  await page.waitForSelector('#overlay.is-active', { timeout: 8000 });
  const winText = await page.textContent('#overlayCard');
  check('完成收集目标后弹出通关结算', winText.includes('魔法成功'), winText.slice(0, 40));
  const starCount = await page.locator('.card-stars i').count();
  check('高分通关拿到 3 星', starCount === 3, '实际 ' + starCount);
  await page.waitForTimeout(800); // 等星星弹出动画播完再截图
  await shot('10-win');

  const unlocked = await page.evaluate(() => window.MK.Storage.get('unlocked', 0));
  check('通关后解锁下一关', unlocked === 1, '实际 ' + unlocked);

  await page.click('[data-action="next"]');
  await waitIdle(page);
  const nextSnapshot = await state(page);
  const secondMoves = await page.evaluate(() => window.MK.LEVELS[1].moves);
  check('可以进入第 2 关', nextSnapshot.level === 1 && nextSnapshot.moves === secondMoves,
    'level=' + nextSnapshot.level + ' moves=' + nextSnapshot.moves);
  await shot('11-level2');

  /* ---------------------------------------------------------------- */
  section('分享与横竖屏');
  await page.click('#btnPause');
  await page.click('[data-action="home"]');
  await page.waitForSelector('#screen-home.is-active');
  await page.click('#btnShare');
  const shareText = await page.textContent('#overlayCard');
  check('分享引导提示微信右上角菜单', shareText.includes('右上角'));
  await page.click('[data-action="close"]');

  const progressText = await page.textContent('#homeProgress');
  check('首页显示通关进度', /已通关 1\/10/.test(progressText), progressText);
  await shot('12-home-progress');

  // 小屏机型(iPhone SE)
  await page.setViewportSize({ width: 320, height: 568 });
  await page.click('#btnPlay');
  await page.waitForSelector('#screen-game.is-active');
  await waitIdle(page);
  const smallFits = await page.evaluate(() => {
    const props = document.querySelector('.props').getBoundingClientRect();
    const board = document.getElementById('board').getBoundingClientRect();
    return props.bottom <= window.innerHeight + 1 && board.width > 200;
  });
  check('320x568 小屏下布局不溢出', smallFits);
  await shot('13-small-screen');

  await page.setViewportSize({ width: 390, height: 844 });

  /* ---------------------------------------------------------------- */
  section('运行时错误');
  check('全程没有 console 报错', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
  check('全程没有资源请求失败', failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '));

  await runSkinTests(browser, shot);
  await runSingleFileTests(browser);

  await browser.close();

  console.log('\n截图输出: ' + SHOT_DIR);
  console.log((failed ? '✗ ' : '✓ ') + passed + ' 项通过, ' + failed + ' 项失败');
  if (failed) {
    console.log('\n失败项:');
    problems.forEach((p) => console.log('  - ' + p));
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('\n测试脚本异常:', err);
  process.exit(2);
});

/* 1x1 的透明 PNG, 用来冒充防盗链站点返回的 404 占位图 */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64');

const CDN_GLOB = '**://static.wikia.nocookie.net/**';

async function newSkinContext(browser, skin) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: WECHAT_UA,
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem('mengke-match3-v1', JSON.stringify({ skin: s }));
  }, skin);
  return { context, page };
}

const skinState = (page) => page.evaluate(() => ({
  skin: MK.Assets.skin,
  loaded: Object.keys(MK.Assets.remote),
  failed: MK.Assets.remoteFailed.slice(),
  // 归一化后应该是统一尺寸的 canvas
  shapes: Object.keys(MK.Assets.remote).map((id) => {
    const s = MK.Assets.remote[id];
    return s.tagName + ':' + s.width + 'x' + s.height;
  }),
  usesRemote: MK.CHARACTERS.every((ch, i) =>
    MK.Assets.sprite(i) === MK.Assets.remote[ch.id]),
  usesLocal: MK.CHARACTERS.every((ch, i) =>
    MK.Assets.sprite(i) === MK.Assets.images[ch.id]),
  cacheKeys: Object.keys(localStorage)
    .filter((k) => /^mengke-skin-v\d+-official-/.test(k)).length
}));

async function boot(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#screen-home.is-active', { timeout: 30000 });
}

/** 在线形象: 加载、归一化、缓存、以及各种失败情形下回退到原创形象。 */
async function runSkinTests(browser, shot) {
  section('在线官方形象');

  const total = 6;
  const { context, page } = await newSkinContext(browser, 'official');
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await boot(page);
  let st = await skinState(page);
  check('官方形象 6 张全部加载成功',
    st.loaded.length === total && st.failed.length === 0,
    '成功 ' + st.loaded.length + ', 失败 ' + st.failed.join(','));
  check('在线图被归一化成同尺寸画布',
    st.shapes.length === total && st.shapes.every((s) => s === 'CANVAS:256x256'),
    st.shapes.join(' '));
  check('棋盘取用的是在线形象', st.usesRemote);
  check('在线图已写入本地缓存', st.cacheKeys === total, '缓存 ' + st.cacheKeys + ' 项');

  await page.click('#btnPlay');
  await page.waitForSelector('#screen-game.is-active');
  await page.waitForTimeout(1200);
  await shot('14-skin-official-board');

  // 首页的形象开关来回切一次
  await page.click('#btnPause');
  await page.click('[data-action="home"]');
  await page.waitForSelector('#screen-home.is-active');
  await page.click('#btnSkin');
  await page.waitForFunction(() => MK.Assets.skin === 'original', { timeout: 15000 });
  st = await skinState(page);
  check('切到原创形象后棋盘改用本地图', st.usesLocal && st.loaded.length === 0);
  check('形象按钮显示当前是原创',
    (await page.textContent('#btnSkin')).includes('原创'));

  await page.click('#btnSkin');
  await page.waitForFunction(() => MK.Assets.skin === 'official'
    && Object.keys(MK.Assets.remote).length === 6, { timeout: 20000 });
  check('切回官方形象能从缓存立刻恢复', (await skinState(page)).usesRemote);

  // 缓存写好之后断网重开, 应该照样是官方形象
  await page.route(CDN_GLOB, (route) => route.abort());
  await boot(page);
  st = await skinState(page);
  check('断网后靠缓存仍能显示官方形象',
    st.loaded.length === total && st.failed.length === 0,
    '成功 ' + st.loaded.length);
  check('切换与断网过程无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();

  // 无缓存 + 请求全挂: 应当静默回退到原创形象, 游戏照常可玩
  const offline = await newSkinContext(browser, 'official');
  await offline.page.route(CDN_GLOB, (route) => route.abort());
  await boot(offline.page);
  st = await skinState(offline.page);
  check('首次加载就断网时回退到原创形象',
    st.failed.length === total && st.usesLocal,
    '失败 ' + st.failed.length + ', 用本地 ' + st.usesLocal);
  await offline.page.click('#btnPlay');
  await offline.page.waitForSelector('#screen-game.is-active');
  const playable = await offline.page.evaluate(() => !!window.__MK_GAME && !MK.Assets.missing.length);
  check('回退后仍能正常进入关卡', playable);
  await offline.context.close();

  // 防盗链站点常把 404 也回一张小占位图, 浏览器会当成加载成功 —— 必须识别出来
  const bogus = await newSkinContext(browser, 'official');
  await bogus.page.route(CDN_GLOB, (route) => route.fulfill({
    status: 404,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: PLACEHOLDER_PNG
  }));
  await boot(bogus.page);
  st = await skinState(bogus.page);
  check('把防盗链返回的占位图判为失败',
    st.failed.length === total && st.usesLocal,
    '失败 ' + st.failed.length + ', 用本地 ' + st.usesLocal);
  const noBogusCache = (await skinState(bogus.page)).cacheKeys === 0;
  check('占位图不会被写进缓存', noBogusCache);
  await bogus.context.close();
}

/**
 * 单文件版: 现打一份, 用 file:// 打开跑一遍。
 * 这一节主要防的是"加了新脚本或新图片却忘了改打包脚本"——那样线上没事,
 * 单文件版却会缺东西。同时确认 file:// 下画布不会因跨域被污染。
 */
async function runSingleFileTests(browser) {
  section('单文件版(file:// 打开)');

  const repo = path.join(__dirname, '..');
  const out = path.join(repo, 'dist', 'mengke-match3.html');
  try {
    execFileSync('python3', [path.join('tools', 'build_single.py')],
      { cwd: repo, stdio: 'pipe' });
  } catch (e) {
    check('打包脚本执行成功', false, (e.stderr || e.message || '').toString().slice(0, 200));
    return;
  }
  check('打包脚本执行成功', fs.existsSync(out));

  const html = fs.readFileSync(out, 'utf8');
  check('没有残留的外部 css/js 引用',
    !/<script src=|<link rel="stylesheet"/.test(html));
  check('图片已内联成 dataURL',
    (html.match(/data:image\/(png|jpeg);base64,/g) || []).length >= 8);
  check('css 里的背景图也内联了', !/url\(\s*["']?\.\./.test(html));

  // 单文件版是拿来单独发给别人的, 必须挪到空目录里测:
  // 留在 dist/ 下的话, ../assets/ 刚好还在, 相对路径漏网也测不出来
  const solo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-solo-')),
    'mengke-match3.html');
  fs.copyFileSync(out, solo);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: WECHAT_UA,
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => {
    // 在线官方形象另有兜底, 这里只关心本地资源
    if (!req.url().includes('wikia')) errors.push('请求失败 ' + req.url().slice(0, 60));
  });

  await page.goto('file://' + solo, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#screen-home.is-active', { timeout: 45000 });
  await page.waitForFunction(() => window.__MK_GAME, { timeout: 45000 });

  const st = await page.evaluate(() => ({
    missing: MK.Assets.missing.slice(),
    hasBg: !!MK.Assets.images.background,
    petSrc: (document.querySelector('.home-pets img') || {}).src || '',
    remote: Object.keys(MK.Assets.remote).length,
    storage: (function () {
      try {
        localStorage.setItem('__probe', '1');
        localStorage.removeItem('__probe');
        return true;
      } catch (e) { return false; }
    })()
  }));
  check('内联素材全部就位', st.missing.length === 0 && st.hasBg, st.missing.join(','));
  check('首页角色图用的是内联数据', st.petSrc.indexOf('data:image') === 0,
    st.petSrc.slice(0, 30));
  check('file:// 下 localStorage 可用', st.storage);
  check('file:// 下仍能取到在线官方形象', st.remote === 6, '拿到 ' + st.remote + '/6');

  // file:// 下画布容易被跨域污染, 污染了就读不了像素, 在线形象的裁切描边会失效
  await page.click('#btnPlay');
  await page.waitForSelector('#screen-game.is-active');
  await page.waitForTimeout(1200);
  const canvasOk = await page.evaluate(() => {
    try {
      const c = document.getElementById('board');
      c.getContext('2d').getImageData(0, 0, 2, 2);
      return true;
    } catch (e) { return false; }
  });
  check('棋盘画布没有被跨域污染', canvasOk);
  check('单文件版无 JS 报错与本地资源失败', errors.length === 0, errors.slice(0, 3).join(' | '));

  await context.close();
}
