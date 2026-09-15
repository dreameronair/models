/*
 * 录一段真实操作的演示视频: 从首页进入第 1 关, 用"优先选能凑出魔法棋子的走法"
 * 的策略实际把关卡打通, 最后停在通关结算页。
 *
 * 运行: node tools/demo_record.js [baseUrl] [输出目录]
 */
'use strict';

const path = require('path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const OUT_DIR = process.argv[3] || path.join(__dirname, '..', '.shots', 'video');

const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2d) NetType/WIFI Language/zh_CN';

const waitIdle = (page) =>
  page.waitForFunction(() => window.__MK_GAME && window.__MK_GAME.state !== 'busy',
    null, { timeout: 15000 });

/**
 * 像真人一样挑走法: 优先推进还没完成的收集目标, 其次凑魔法棋子, 最后看消除数量。
 * 只用公开的棋盘接口试算, 试完立即换回原状。
 */
async function pickBestMove(page) {
  return page.evaluate(() => {
    const g = window.__MK_GAME;
    if (!g || g.state !== 'idle') return null;
    const b = g.board;
    const rank = { rainbow: 40, bomb: 30, row: 20, col: 20 };

    const wanted = {};
    g.collected.forEach((goal) => {
      if (goal.have < goal.need) wanted[goal.type] = true;
    });

    let best = null;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const pairs = [];
        if (c + 1 < b.cols) pairs.push([{ r, c }, { r, c: c + 1 }]);
        if (r + 1 < b.rows) pairs.push([{ r, c }, { r: r + 1, c }]);

        for (let i = 0; i < pairs.length; i++) {
          const a = pairs[i][0];
          const d = pairs[i][1];
          if (!b.isValidSwap(a, d)) continue;

          b.swapTiles(a, d);
          const groups = b.findMatches();
          let size = 0;
          let goalTiles = 0;
          let bonus = 0;
          for (let k = 0; k < groups.length; k++) {
            size += groups[k].cells.length;
            if (wanted[groups[k].type]) goalTiles += groups[k].cells.length;
            if (groups[k].special) bonus = Math.max(bonus, rank[groups[k].special] || 0);
          }
          b.swapTiles(a, d);

          const score = goalTiles * 12 + bonus + size;
          if (!best || score > best.score) best = { a, b: d, score };
        }
      }
    }
    if (!best) return null;
    const rect = g.canvas.getBoundingClientRect();
    return {
      from: { x: rect.left + g.cellX(best.a.c), y: rect.top + g.cellY(best.a.r) },
      to: { x: rect.left + g.cellX(best.b.c), y: rect.top + g.cellY(best.b.r) }
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: WECHAT_UA,
    locale: 'zh-CN',
    recordVideo: { dir: OUT_DIR, size: { width: 390, height: 844 } }
  });
  // 模拟一个已经玩过几关的玩家, 这样能走真实的"选择关卡"流程
  await context.addInitScript(() => {
    window.localStorage.setItem('mengke-match3-v1', JSON.stringify({
      unlocked: 4,
      progress: {
        0: { stars: 3, best: 3570 },
        1: { stars: 2, best: 2400 }
      },
      sfxOn: true,
      bgmOn: true
    }));
  });

  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#screen-home.is-active');
  await page.waitForTimeout(1500);

  await page.click('#btnLevels');
  await page.waitForSelector('#screen-levels.is-active');
  await page.waitForTimeout(1200);

  await page.click('.level-card[data-level="2"]');
  await page.waitForSelector('#screen-game.is-active');
  await waitIdle(page);
  await page.waitForTimeout(900);

  let moves = 0;
  for (let i = 0; i < 30; i++) {
    const snap = await page.evaluate(() => ({
      state: window.__MK_GAME.state,
      cleared: window.__MK_GAME.isCleared()
    }));
    if (snap.state !== 'idle' || snap.cleared) break;

    const move = await pickBestMove(page);
    if (!move) break;

    // 慢一点滑, 看起来像真人操作
    await page.mouse.move(move.from.x, move.from.y);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.move(move.to.x, move.to.y, { steps: 12 });
    await page.mouse.up();
    moves++;
    await waitIdle(page);
    await page.waitForTimeout(420);
  }

  // 等结算弹窗出现并停留一会
  await page.waitForSelector('#overlay.is-active', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2600);

  const finalState = await page.evaluate(() => ({
    score: window.__MK_GAME.score,
    movesLeft: window.__MK_GAME.moves,
    card: (document.getElementById('overlayCard').textContent || '').slice(0, 30)
  }));

  await context.close();
  await browser.close();

  console.log('实际走了 ' + moves + ' 步, 得分 ' + finalState.score +
    ', 剩余步数 ' + finalState.movesLeft);
  console.log('结算内容: ' + finalState.card);
  console.log('视频输出目录: ' + OUT_DIR);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
