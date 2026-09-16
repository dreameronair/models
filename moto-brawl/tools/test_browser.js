/*
 * 端到端测试: 用 Playwright 真实驱动页面。
 * 运行: node tools/test_browser.js   (需要先 npm i && npx playwright install chromium)
 *
 * 无头逻辑测试(tools/test_race.js)管数值, 这里管的是「页面真的能玩」:
 * 画面画出来了、按键有反应、界面能跳转、存档能存上、没有报错。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, '.shots');
const PORT = 8231;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

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

/* 一个极简静态服务器, 省得测试还要外部起服务 */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/* 读一份比赛内部状态出来做断言 */
const raceState = (page) => page.evaluate(() => {
  const r = window.__MB_RACE;
  if (!r) return null;
  const p = r.player;
  return {
    state: r.state, time: r.time, progress: r.progress(),
    speed: p.speed, maxSpeed: p.maxSpeed(), x: p.x, z: p.z,
    health: p.health, rank: p.rank, down: p.isDown(),
    riders: r.riders.length, traffic: r.traffic.length,
    attackCd: p.attackCd, weapon: p.weapon,
    hudSpeed: document.getElementById('hudSpeed').textContent,
    hudRank: document.getElementById('hudRank').textContent,
    hudTime: document.getElementById('hudTime').textContent
  };
});

/** 等到画面真的开始跑(而不是卡在读秒) */
async function waitRacing(page) {
  await page.waitForFunction(
    () => window.__MB_RACE && window.__MB_RACE.state === 'racing',
    null, { timeout: 20000 });
}

/** 画面是不是真画出了东西: 采样一堆像素, 看颜色够不够杂 */
const canvasVariety = (page) => page.evaluate(() => {
  const c = document.getElementById('view');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) {
    seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  }
  return seen.size;
});

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 900, height: 520 }, deviceScaleFactor: 2, locale: 'zh-CN'
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('JS 异常: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('请求失败: ' + r.url().slice(0, 80)));

  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });

  /* ---------------------------------------------------------------- */
  section('加载与主菜单');
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MB_READY, null, { timeout: 25000 });
  check('页面加载完成并进入主菜单',
    await page.isVisible('#screen-home'));
  check('模块都挂上了',
    await page.evaluate(() => !!(window.MB && MB.Track && MB.Race && MB.Renderer &&
      MB.Sprites && MB.Sound && MB.Input && MB.UI)));
  await shot('01-home');

  await page.click('#btnHelp');
  await page.waitForSelector('#overlay.is-active');
  const help = await page.textContent('#overlayCard');
  check('操作说明里写了拳和踢', help.includes('拳') && help.includes('踢'));
  check('操作说明里写了钢管', help.includes('钢管'));
  await page.click('[data-action="close"]');

  /* ---------------------------------------------------------------- */
  section('赛道选择');
  await page.click('#btnRace');
  await page.waitForSelector('#screen-tracks.is-active');
  const cards = await page.locator('.card[data-track], .card.is-locked').count();
  check('列出了全部 5 条赛道', cards === 5, '实际 ' + cards);
  const locked = await page.locator('.card.is-locked').count();
  check('首次进入只解锁第 1 条', locked === 4, '锁住 ' + locked);
  await shot('02-tracks');

  /* ---------------------------------------------------------------- */
  section('进入比赛');
  await page.click('.card[data-track="coast"]');
  await page.waitForSelector('#screen-race.is-active');
  await page.waitForFunction(() => window.__MB_RACE, null, { timeout: 10000 });

  let st = await raceState(page);
  check('开局是读秒状态', st.state === 'countdown', st.state);
  check('对手都上场了', st.riders === 6, '实际 ' + st.riders);
  check('路上有社会车辆', st.traffic > 10, '实际 ' + st.traffic);
  await shot('03-countdown');

  await waitRacing(page);
  await page.waitForTimeout(600);
  check('画面确实画出了东西', await canvasVariety(page) > 12);

  /* ---------------------------------------------------------------- */
  section('驾驶');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2500);
  st = await raceState(page);
  check('给油会加速', st.speed > st.maxSpeed * 0.5,
    Math.round(st.speed) + '/' + Math.round(st.maxSpeed));
  check('HUD 速度跟着变', Number(st.hudSpeed) > 0, st.hudSpeed);
  check('HUD 时间在走', st.hudTime !== '0:00.00', st.hudTime);
  check('进度条在推进', st.progress > 0);
  await shot('04-racing');

  const beforeBrake = st.speed;
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(700);
  st = await raceState(page);
  check('刹车会减速', st.speed < beforeBrake * 0.8,
    Math.round(beforeBrake) + ' -> ' + Math.round(st.speed));
  await page.keyboard.up('ArrowDown');

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  const xBefore = (await raceState(page)).x;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  st = await raceState(page);
  check('打右方向会往右移', st.x > xBefore + 0.05,
    xBefore.toFixed(2) + ' -> ' + st.x.toFixed(2));

  /* ---------------------------------------------------------------- */
  section('出拳与踢腿');
  // 把一个对手挪到手边, 保证够得着
  await page.evaluate(() => {
    const r = window.__MB_RACE;
    const foe = r.riders[1];
    foe.z = r.player.z + 60;
    foe.x = r.player.x + 0.18;
    foe.health = 100;
    r.player.attackCd = 0;
    window.__foeHp = foe.health;
  });
  await page.keyboard.press('KeyX');       // 右拳
  await page.waitForTimeout(150);
  const hp = await page.evaluate(() => window.__MB_RACE.riders[1].health);
  check('右拳打中了身边的对手', hp < 100, '对手血 ' + hp.toFixed(0));

  const cd = (await raceState(page)).attackCd;
  check('出手后进入冷却', cd > 0, String(cd));

  await page.evaluate(() => {
    const r = window.__MB_RACE;
    r.riders[1].health = 6;
    r.riders[1].z = r.player.z + 60;
    r.riders[1].x = r.player.x + 0.18;
    r.player.attackCd = 0;
  });
  await page.keyboard.press('KeyV');       // 右踢
  await page.waitForTimeout(200);
  check('把对手踢下车会记一次击倒',
    await page.evaluate(() => window.__MB_RACE.player.takedowns >= 1));
  await shot('05-combat');

  /* ---------------------------------------------------------------- */
  section('钢管');
  await page.evaluate(() => { window.__MB_RACE.player.weapon = 5; });
  await page.waitForTimeout(120);
  check('捡到钢管后 HUD 会显示',
    await page.isVisible('#hudWeapon'));
  await page.evaluate(() => { window.__MB_RACE.player.weapon = 0; });
  await page.waitForTimeout(120);
  check('没有钢管时 HUD 不显示',
    !(await page.isVisible('#hudWeapon')));

  /* ---------------------------------------------------------------- */
  section('暂停');
  await page.keyboard.up('ArrowUp');
  await page.click('#btnPause');
  await page.waitForSelector('#overlay.is-active');
  const zPause = (await raceState(page)).z;
  await page.waitForTimeout(700);
  check('暂停时比赛不再推进',
    Math.abs((await raceState(page)).z - zPause) < 1);
  await shot('06-pause');
  await page.click('[data-action="resume"]');
  await page.waitForTimeout(400);
  check('可以继续比赛', !(await page.isVisible('#overlay.is-active')));

  /* ---------------------------------------------------------------- */
  section('完赛与结算');
  // 直接把玩家推到终点线前, 省得真跑一分钟
  await page.evaluate(() => {
    const r = window.__MB_RACE;
    r.player.z = r.finishZ - 200;
    r.player.speed = r.player.maxSpeed();
  });
  await page.waitForSelector('#overlay.is-active', { timeout: 15000 });
  const result = await page.textContent('#overlayCard');
  check('冲线后弹出结算', result.includes('第'), result.slice(0, 30));
  check('结算里有用时和奖金',
    result.includes('用时') && result.includes('奖金'));
  check('结算里列出了全场排名', (await page.locator('.standings div').count()) === 6);
  await shot('07-result');

  const cash = await page.evaluate(() => window.MB.Save.cash());
  check('拿到了奖金', cash > 0, '现金 ' + cash);
  const unlocked = await page.evaluate(() => window.MB.Save.unlockedTracks());
  check('跑进前三解锁了下一条赛道', unlocked >= 1, '解锁到 ' + unlocked);

  /* ---------------------------------------------------------------- */
  section('车库与存档');
  await page.click('[data-action="garage"]');
  await page.waitForSelector('#screen-garage.is-active');
  check('车库列出 3 台车', (await page.locator('.card[data-bike]').count()) === 3);
  await shot('08-garage');

  await page.evaluate(() => window.MB.Storage.set('cash', 99999));
  // 每一屏都有自己的返回箭头, 选择器要限定到当前这一屏, 否则会点到隐藏的那个
  await page.click('#screen-garage [data-nav="home"]');
  await page.click('#btnGarage');
  await page.click('.card[data-bike="blade"]');
  await page.waitForTimeout(300);
  check('钱够就能买下并换车',
    await page.evaluate(() => window.MB.Save.currentBike() === 'blade' &&
      window.MB.Save.ownedBikes().indexOf('blade') >= 0));

  // 刷新之后进度还在, 说明确实写进了 localStorage
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__MB_READY, null, { timeout: 25000 });
  check('刷新后存档还在',
    await page.evaluate(() => window.MB.Save.currentBike() === 'blade' &&
      window.MB.Save.unlockedTracks() >= 1));

  /* ---------------------------------------------------------------- */
  section('手机与小屏');
  const phone = await browser.newContext({
    viewport: { width: 740, height: 360 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ' +
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49'
  });
  const mpage = await phone.newPage();
  const mErrors = [];
  mpage.on('pageerror', (e) => mErrors.push(e.message));
  await mpage.goto(BASE, { waitUntil: 'load' });
  await mpage.waitForFunction(() => window.__MB_READY, null, { timeout: 25000 });
  check('触屏设备默认自动给油',
    await mpage.evaluate(() => window.MB.__state.input.autoThrottle));

  await mpage.click('#btnRace');
  await mpage.click('.card[data-track="coast"]');
  await mpage.waitForFunction(() => window.__MB_RACE && window.__MB_RACE.state === 'racing',
    null, { timeout: 20000 });
  await mpage.waitForTimeout(1500);
  check('自动给油下车子会往前跑',
    await mpage.evaluate(() => window.__MB_RACE.player.speed > 1000));
  check('触屏按钮是可见的', await mpage.isVisible('.pad-btn[data-act="punchRight"]'));

  const mx0 = await mpage.evaluate(() => window.__MB_RACE.player.x);
  await mpage.tap('.pad-btn[data-act="right"]');
  await mpage.waitForTimeout(500);
  await mpage.evaluate(() => {
    // tap 只是一次点按, 这里补一次按住再松开, 模拟真实操作
    const b = document.querySelector('.pad-btn[data-act="right"]');
    b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
    setTimeout(() => b.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true })), 400);
  });
  await mpage.waitForTimeout(700);
  check('按触屏方向键能转向',
    (await mpage.evaluate(() => window.__MB_RACE.player.x)) > mx0,
    'x ' + mx0.toFixed(2));
  await mpage.screenshot({ path: path.join(SHOT_DIR, '09-mobile.png') });
  check('手机上没有 JS 报错', mErrors.length === 0, mErrors.slice(0, 2).join(' | '));
  await phone.close();

  /* ---------------------------------------------------------------- */
  section('单文件版(file:// 打开)');
  const out = path.join(ROOT, 'dist', 'moto-brawl.html');
  let built = true;
  try {
    execFileSync('python3', [path.join('tools', 'build_single.py')],
      { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    built = false;
    check('打包脚本执行成功', false, (e.stderr || e.message || '').toString().slice(0, 200));
  }

  if (built) {
    check('打包脚本执行成功', fs.existsSync(out));
    const bundle = fs.readFileSync(out, 'utf8');
    check('没有残留的外部 css/js 引用',
      !/<script src=|<link rel="stylesheet"/.test(bundle));

    // 必须挪到空目录里测: 留在 dist/ 下的话隔壁就是 js/ 和 css/,
    // 漏网的相对路径照样能加载, 等于没测
    const solo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-solo-')),
      'moto-brawl.html');
    fs.copyFileSync(out, solo);

    const spage = await context.newPage();
    const sErrors = [];
    spage.on('pageerror', (e) => sErrors.push(e.message));
    spage.on('requestfailed', (r) => sErrors.push('请求失败 ' + r.url().slice(0, 60)));

    await spage.goto('file://' + solo, { waitUntil: 'load' });
    await spage.waitForFunction(() => window.__MB_READY, null, { timeout: 25000 });
    await spage.click('#btnRace');
    await spage.click('.card[data-track="coast"]');
    await spage.waitForFunction(
      () => window.__MB_RACE && window.__MB_RACE.state === 'racing',
      null, { timeout: 20000 });
    await spage.keyboard.down('ArrowUp');
    await spage.waitForTimeout(1800);
    check('单文件版能正常开起来',
      await spage.evaluate(() => window.__MB_RACE.player.speed > 1000));
    // file:// 下画布一旦被外部图片污染就读不了像素。这个游戏没有图片,
    // 所以这条应当永远成立 —— 真挂了说明有人引入了外部图
    check('file:// 下画布没有被跨域污染',
      await spage.evaluate(() => {
        try {
          document.getElementById('view').getContext('2d').getImageData(0, 0, 2, 2);
          return true;
        } catch (e) { return false; }
      }));
    await spage.keyboard.up('ArrowUp');
    await spage.screenshot({ path: path.join(SHOT_DIR, '10-single-file.png') });
    check('单文件版无报错与资源加载失败',
      sErrors.length === 0, sErrors.slice(0, 3).join(' | '));
    await spage.close();
  }

  /* ---------------------------------------------------------------- */
  section('整体');
  check('全程没有报错与资源加载失败',
    errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

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
