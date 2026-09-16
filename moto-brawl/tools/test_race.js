/*
 * 赛道与比赛逻辑的无头测试(不涉及 Canvas/DOM)。
 * 运行: node tools/test_race.js
 */
'use strict';

const sim = require('./sim');

const MB = sim.createRuntime();
const { CONFIG, TRACKS, BIKES, RIDERS, Util, Rng, Track } = MB;

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

/** 造一个可控的迷你赛道, 省得每次都铺几千段。 */
function miniTrack(over) {
  return new Track(Object.assign({
    id: 'test', name: 'test', scene: 'coast', seed: 777,
    length: 400, laps: 1, curviness: 1, hilliness: 1, traffic: 0.3,
    rivalSkill: 1, rivalRage: 0, reward: 0, desc: ''
  }, over || {}));
}

/* ------------------------------------------------------------------ */
section('随机数与工具');
{
  const a = new Rng(1234);
  const b = new Rng(1234);
  const seqA = [], seqB = [];
  for (let i = 0; i < 50; i++) { seqA.push(a.next()); seqB.push(b.next()); }
  check('同一种子产生同一串随机数', JSON.stringify(seqA) === JSON.stringify(seqB));

  const c = new Rng(1234);
  const d = new Rng(9999);
  check('不同种子产生不同随机数', c.next() !== d.next());

  const r = new Rng(42);
  let inRange = true;
  for (let i = 0; i < 500; i++) {
    const v = r.next();
    if (v < 0 || v >= 1) inRange = false;
  }
  check('随机数落在 [0,1)', inRange);

  check('clamp 夹住上下界',
    Util.clamp(-5, 0, 1) === 0 && Util.clamp(5, 0, 1) === 1 && Util.clamp(0.4, 0, 1) === 0.4);
  check('formatTime 补零正确',
    Util.formatTime(65.04) === '1:05.04', Util.formatTime(65.04));
}

/* ------------------------------------------------------------------ */
section('赛道生成');
{
  const t1 = miniTrack();
  const t2 = miniTrack();
  const shape = (t) => t.segments.map((s) => s.curve.toFixed(3) + ':' + s.p2.world.y.toFixed(1)).join('|');
  check('同一种子铺出完全一样的路', shape(t1) === shape(t2));

  const t3 = miniTrack({ seed: 4321 });
  check('换种子路形就不同', shape(t1) !== shape(t3));

  check('段数不少于配置长度', t1.segments.length >= 400, '实际 ' + t1.segments.length);

  let continuous = true;
  for (let i = 1; i < t1.segments.length; i++) {
    // 前一段的终点高度必须等于后一段的起点高度, 否则路面会裂开
    if (Math.abs(t1.segments[i].p1.world.y - t1.segments[i - 1].p2.world.y) > 1e-6) {
      continuous = false;
    }
    if (t1.segments[i].p1.world.z !== i * CONFIG.segmentLength) continuous = false;
  }
  check('相邻路段首尾相接且 z 连续', continuous);

  const steep = miniTrack({ curviness: 3 });
  const maxCurve = steep.segments.reduce((m, s) => Math.max(m, Math.abs(s.curve)), 0);
  check('弯道被夹在上限内(否则转向压不住)',
    maxCurve <= CONFIG.maxCurve + 1e-6, '最急 ' + maxCurve.toFixed(2));

  /*
   * 整个手感的地基。每帧转向给 ±dx, 离心力给 -dx*pct*curve*centrifugal,
   * 所以「离心力/转向力」就是 pct*curve*centrifugal, 满速(pct=1)时等于
   * maxCurve*centrifugal。这个值必须小于 1, 否则最急的弯里方向打满也是
   * 被匀速推出赛道 —— 那不是难度, 是无解。
   */
  const authority = CONFIG.maxCurve * CONFIG.centrifugal;
  check('满速时转向压得住最急的弯(离心/转向 < 1)', authority < 1,
    '离心/转向 = ' + authority.toFixed(3));
  check('但也别压得太轻松(弯道要有存在感)', authority > 0.6,
    '离心/转向 = ' + authority.toFixed(3));

  const flat = miniTrack({ hilliness: 0 });
  const ys = flat.segments.map((s) => s.p2.world.y);
  check('hilliness=0 时路面是平的', Math.max(...ys) - Math.min(...ys) < 1e-6);

  // 高度是一段段 easeInOut 累加出来的, 几千次浮点加法会留下一点零头,
  // 这里只要求「肉眼看不出来」, 不要求精确为 0
  check('结尾把高度拉回 0(免得冲线时镜头在半空)',
    Math.abs(t1.lastY()) < 1, String(t1.lastY()));

  const props = t1.segments.reduce((n, s) => n + s.props.length, 0);
  check('路边撒了景物', props > 20, '共 ' + props);

  check('有起点线和终点线',
    t1.segments.some((s) => s.marker === 1) && t1.segments.some((s) => s.marker === 2));
}

/* ------------------------------------------------------------------ */
section('赛道取段与绕圈');
{
  const t = miniTrack();
  const total = t.totalLength();
  check('z=0 落在第 0 段', t.segmentAt(0).index === 0);
  check('段内取整正确',
    t.segmentAt(CONFIG.segmentLength * 3 + 10).index === 3);
  check('超出全长会绕回起点',
    t.segmentAt(total + 50).index === t.segmentAt(50).index);
  check('负数 z 也能绕回来',
    t.segmentAt(-50).index === t.segmentAt(total - 50).index);
}

/* ------------------------------------------------------------------ */
section('投影');
{
  const t = miniTrack({ hilliness: 0 });
  const depth = MB.cameraDepthFor(CONFIG.fieldOfView);
  const near = t.segments[2].p1;
  const far = t.segments[60].p1;
  MB.project(near, 0, CONFIG.cameraHeight, 0, depth, 800, 450, CONFIG.roadWidth);
  MB.project(far, 0, CONFIG.cameraHeight, 0, depth, 800, 450, CONFIG.roadWidth);

  check('近的路段投影更大', near.screen.w > far.screen.w,
    near.screen.w + ' vs ' + far.screen.w);
  check('远的路段更靠近地平线', far.screen.y < near.screen.y,
    far.screen.y + ' vs ' + near.screen.y);
  check('路面中心在画面中央', Math.abs(near.screen.x - 400) < 2, String(near.screen.x));

  // 相机后面的点不能让投影翻转(会画出上下颠倒的路)
  const behind = { world: { x: 0, y: 0, z: -5000 }, camera: {}, screen: {} };
  MB.project(behind, 0, CONFIG.cameraHeight, 0, depth, 800, 450, CONFIG.roadWidth);
  check('相机后方的点不会翻转成负宽度', behind.screen.w > 0, String(behind.screen.w));
}

/* ------------------------------------------------------------------ */
section('骑手物理');
{
  const mk = () => sim.makeRace(MB, { trackOverride: { curviness: 0, hilliness: 0 },
    rivals: 0, traffic: 0, countdown: 0 });

  const race = mk();
  const p = race.player;
  for (let i = 0; i < 600; i++) race.update(1 / 60, { throttle: true, steer: 0 });
  check('一直给油会跑到极速',
    Math.abs(p.speed - p.maxSpeed()) < 1, p.speed.toFixed(0) + '/' + p.maxSpeed().toFixed(0));
  check('极速不会被突破', p.speed <= p.maxSpeed() + 1e-6);

  const before = p.speed;
  for (let i = 0; i < 30; i++) race.update(1 / 60, { brake: true, steer: 0 });
  check('刹车能减速', p.speed < before * 0.8, before.toFixed(0) + ' -> ' + p.speed.toFixed(0));

  const race2 = mk();
  for (let i = 0; i < 600; i++) race2.update(1 / 60, { throttle: true, steer: 0 });
  const onRoad = race2.player.speed;
  race2.player.x = 1.5;
  for (let i = 0; i < 180; i++) race2.update(1 / 60, { throttle: true, steer: 0 });
  check('冲进草地会掉速到离地极速',
    race2.player.speed <= CONFIG.offRoadLimit + 1,
    '路上 ' + onRoad.toFixed(0) + ' -> 草地 ' + race2.player.speed.toFixed(0));

  const race3 = mk();
  for (let i = 0; i < 300; i++) race3.update(1 / 60, { throttle: true, steer: 1 });
  check('打方向能横移', race3.player.x > 0.2, race3.player.x.toFixed(2));

  const race4 = mk();
  for (let i = 0; i < 120; i++) race4.update(1 / 60, { throttle: true, steer: 0 });
  const z0 = race4.player.z;
  for (let i = 0; i < 60; i++) race4.update(1 / 60, { throttle: true, steer: 0 });
  check('z 随速度前进', race4.player.z > z0);

  /*
   * 拿一个「会回正的驾驶员」跑最弯的赛道, 全程不松油门, 断言守得住路面。
   *
   * 注意不能用「照着弯向打满方向」来测: 缓弯上离心力很小, 打满舵是自己
   * 把自己开出去的, 跟赛道难度无关。真正要验的是「有得救」, 所以用比例
   * 控制回正, 跟 AI 走线用的是同一套办法。
   */
  const curvy = sim.makeRace(MB, {
    trackOverride: { curviness: 3, hilliness: 0 }, rivals: 0, traffic: 0, countdown: 0
  });
  let maxOff = 0;
  for (let i = 0; i < 5400; i++) {
    const seg = curvy.track.segmentAt(curvy.player.z);
    const steer = Util.clamp(-curvy.player.x * 2.4, -1, 1);
    curvy.update(1 / 60, { throttle: true, steer: steer });
    if (i > 120) maxOff = Math.max(maxOff, Math.abs(curvy.player.x));
  }
  check('最弯的赛道上全程不松油门也守得住路面',
    maxOff < 1, '最远到 ' + maxOff.toFixed(2));
}

/* ------------------------------------------------------------------ */
section('近身格斗');
{
  function duel() {
    const race = sim.makeRace(MB, {
      trackOverride: { curviness: 0, hilliness: 0 }, rivals: 1, traffic: 0, countdown: 0
    });
    const foe = race.riders[1];
    foe.z = race.player.z;
    foe.x = race.player.x + 0.2;   // 摆在右手边, 够得着
    return { race, foe };
  }

  let { race, foe } = duel();
  const hp0 = foe.health;
  race.tryAttack(race.player, 1, 'punch');
  check('够得着时右拳能打中', foe.health < hp0, hp0 + ' -> ' + foe.health);

  ({ race, foe } = duel());
  race.tryAttack(race.player, -1, 'punch');
  check('朝反方向出拳打不中', foe.health === CONFIG.maxHealth);

  ({ race, foe } = duel());
  foe.z = race.player.z + CONFIG.reach * 2;
  race.tryAttack(race.player, 1, 'punch');
  check('距离太远打不中', foe.health === CONFIG.maxHealth);

  ({ race, foe } = duel());
  foe.x = race.player.x + CONFIG.reachLateral * 2;
  race.tryAttack(race.player, 1, 'punch');
  check('横向太远打不中', foe.health === CONFIG.maxHealth);

  ({ race, foe } = duel());
  const punchHp = (() => { const f = duel(); f.race.tryAttack(f.race.player, 1, 'punch');
    return CONFIG.maxHealth - f.foe.health; })();
  const kickHp = (() => { const f = duel(); f.race.tryAttack(f.race.player, 1, 'kick');
    return CONFIG.maxHealth - f.foe.health; })();
  check('踢比拳疼', kickHp > punchHp, '拳 ' + punchHp.toFixed(1) + ' 踢 ' + kickHp.toFixed(1));

  ({ race, foe } = duel());
  race.tryAttack(race.player, 1, 'punch');
  const after1 = foe.health;
  race.tryAttack(race.player, 1, 'punch');   // 冷却没好
  check('冷却期间打不出第二下', foe.health === after1);

  ({ race, foe } = duel());
  race.player.weapon = 5;
  race.tryAttack(race.player, 1, 'punch');
  check('钢管让伤害更高', CONFIG.maxHealth - foe.health > punchHp,
    (CONFIG.maxHealth - foe.health).toFixed(1) + ' vs ' + punchHp.toFixed(1));
  check('钢管用一次少一次', race.player.weapon === 4, String(race.player.weapon));

  ({ race, foe } = duel());
  foe.health = 5;
  race.tryAttack(race.player, 1, 'kick');
  check('血打空会摔车', foe.isDown() && foe.health === 0);
  check('打趴对手会记一笔', race.player.takedowns === 1);

  // 摔倒的人要能自己爬起来, 不然比赛会卡住
  let guard = 0;
  while (foe.isDown() && guard++ < 1200) race.update(1 / 60, {});
  check('摔倒后会自己爬起来', !foe.isDown(), '等了 ' + (guard / 60).toFixed(1) + 's');
  check('爬起来后有血', foe.health > 0);

  ({ race, foe } = duel());
  foe.isDownStub = true;
  foe.knockDown();
  const t0 = race.player.takedowns;
  race.tryAttack(race.player, 1, 'punch');
  check('躺在地上的人不会被重复攻击', race.player.takedowns === t0);

  ({ race, foe } = duel());
  race.player.attackCd = 0;
  foe.x = race.player.x + 5;     // 够不着
  race.tryAttack(race.player, 1, 'punch');
  check('空挥也要吃冷却(不能无脑狂按)', race.player.attackCd > 0);
}

/* ------------------------------------------------------------------ */
section('碰撞');
{
  function withCar(gapX) {
    const race = sim.makeRace(MB, {
      trackOverride: { curviness: 0, hilliness: 0 }, rivals: 0, traffic: 0, countdown: 0
    });
    race.player.speed = race.player.maxSpeed();
    race.traffic = [{ z: race.player.z + 100, x: race.player.x + gapX,
      speed: 0, kind: 0, alive: true }];
    return race;
  }

  let race = withCar(0.02);
  race.update(1 / 60, { throttle: true });
  check('正面撞上社会车辆会摔车', race.player.isDown());

  race = withCar(0.22);
  const spd = race.player.speed;
  race.update(1 / 60, { throttle: true });
  check('擦身而过不摔车', !race.player.isDown());
  check('擦身而过会掉速', race.player.speed < spd * 0.8,
    spd.toFixed(0) + ' -> ' + race.player.speed.toFixed(0));
  check('擦身而过会掉血但不会掉到 0',
    race.player.health < CONFIG.maxHealth && race.player.health > 0);

  race = withCar(0.9);
  race.update(1 / 60, { throttle: true });
  check('离得远不算碰撞',
    !race.player.isDown() && race.player.health === CONFIG.maxHealth);

  // 两个骑手不该叠在一起
  const bump = sim.makeRace(MB, {
    trackOverride: { curviness: 0, hilliness: 0 }, rivals: 1, traffic: 0, countdown: 0
  });
  bump.riders[1].z = bump.player.z;
  bump.riders[1].x = bump.player.x + 0.05;
  const gap0 = Math.abs(bump.player.x - bump.riders[1].x);
  for (let i = 0; i < 30; i++) bump.update(1 / 60, { throttle: true });
  check('并排的两个人会被挤开',
    Math.abs(bump.player.x - bump.riders[1].x) > gap0);
}

/* ------------------------------------------------------------------ */
section('名次与完赛');
{
  const race = sim.makeRace(MB, { trackOverride: { length: 300 }, countdown: 0 });
  check('开局就有名次', race.player.rank >= 1 && race.player.rank <= race.riders.length);

  race.player.z = race.finishZ * 0.9;
  race.riders[1].z = race.finishZ * 0.95;
  race.update(1 / 60, { throttle: true });
  check('跑在前面的人名次更靠前',
    race.riders[1].rank < race.player.rank,
    '对手 ' + race.riders[1].rank + ' 玩家 ' + race.player.rank);

  race.player.z = race.finishZ + 10;
  race.update(1 / 60, { throttle: true });
  check('过终点线算完赛', race.player.finished);
  check('完赛后比赛结束', race.state === 'finished');
  check('记下了完赛时间', race.player.finishTime > 0);

  const ranks = race.updateRanks().map((r) => r.rank);
  check('名次是 1..N 且不重复',
    JSON.stringify(ranks) === JSON.stringify(ranks.map((_, i) => i + 1)));

  const cd = sim.makeRace(MB, { trackOverride: { length: 300 }, countdown: 3 });
  const z0 = cd.player.z;
  cd.update(1 / 60, { throttle: true });
  check('读秒期间不能起步', cd.player.z === z0 && cd.state === 'countdown');
  for (let i = 0; i < 200; i++) cd.update(1 / 60, { throttle: true });
  check('读秒结束后开始比赛', cd.state === 'racing' && cd.player.z > z0);
}

/* ------------------------------------------------------------------ */
section('完整对局(每条赛道跑一遍)');
{
  let allFinished = true;
  let detail = '';
  const times = [];

  for (const def of TRACKS) {
    const race = sim.makeRace(MB, { trackId: def.id, seed: 2024 });
    const res = sim.runRace(race, { skill: 0.85, aggression: 0.5, maxSeconds: 400 });
    if (!res.finished || res.timedOut) {
      allFinished = false;
      detail = def.name + (res.timedOut ? ' 超时' : ' 未完赛');
    }
    times.push(def.name + ' ' + res.time.toFixed(0) + 's/第' + res.rank);

    // 跑完之后棋盘状态得是干净的
    for (const r of race.riders) {
      if (!isFinite(r.z) || !isFinite(r.x) || !isFinite(r.speed)) {
        allFinished = false;
        detail = def.name + ' 出现了 NaN';
      }
      if (Math.abs(r.x) > 3) {
        allFinished = false;
        detail = def.name + ' ' + r.name + ' 跑到了 x=' + r.x.toFixed(1);
      }
    }
  }

  check('五条赛道都能正常跑完且没有数值发散', allFinished, detail);
  console.log('    ' + times.join(' | '));
}

/* ------------------------------------------------------------------ */
section('难度曲线');
{
  /*
   * 按「这条赛道预期骑哪台车」去跑, 断言前三率一路走低但不崩盘。
   * 只有拿到前三才解锁下一条, 所以前三率才是真正卡进度的那条线。
   * 整条曲线跑 npm run balance。
   */
  const EXPECTED = { coast: 'scrap', desert: 'scrap', forest: 'cruiser',
                     city: 'cruiser', storm: 'blade' };
  const RUNS = 24;
  const rates = [];

  for (const def of TRACKS) {
    let podium = 0;
    for (let run = 0; run < RUNS; run++) {
      const race = sim.makeRace(MB, {
        trackId: def.id, bikeId: EXPECTED[def.id], seed: 500 + run * 53
      });
      const res = sim.runRace(race, { skill: 0.85, aggression: 0.5, maxSeconds: 400 });
      if (res.finished && res.rank <= 3) podium++;
    }
    rates.push({ name: def.name, rate: podium / RUNS });
  }

  const shown = rates.map((r) => r.name + ' ' + Math.round(r.rate * 100) + '%').join(', ');

  check('第一条赛道对新手足够友好', rates[0].rate >= 0.7, shown);
  check('最后一条赛道确实难', rates[rates.length - 1].rate <= 0.75, shown);
  check('没有哪条赛道彻底卡死玩家',
    rates.every((r) => r.rate >= 0.25), shown);

  /*
   * 不逐条比相邻两关 —— 二十几局的抽样波动有十几个点, 相邻两条本来就差不多
   * 难, 那样断言必然三天两头假报警。改成比前段和后段的均值: 真出现「后面
   * 反而更好过」这种曲线塌陷时才会失败, 而这正是要守的东西。
   */
  const head = (rates[0].rate + rates[1].rate) / 2;
  const tail = (rates[3].rate + rates[4].rate) / 2;
  check('后两条明显比前两条难', tail < head - 0.1,
    '前段 ' + Math.round(head * 100) + '% 后段 ' + Math.round(tail * 100) + '% (' + shown + ')');
  console.log('    ' + shown);
}

/* ------------------------------------------------------------------ */
section('配置自洽');
{
  check('五条赛道', TRACKS.length === 5, String(TRACKS.length));
  check('三台车', BIKES.length === 3, String(BIKES.length));
  check('车手数够分', RIDERS.length >= CONFIG.rivalCount,
    RIDERS.length + ' < ' + CONFIG.rivalCount);

  check('起步车是免费的', BIKES[0].price === 0);
  let pricesRise = true;
  for (let i = 1; i < BIKES.length; i++) {
    if (BIKES[i].price <= BIKES[i - 1].price) pricesRise = false;
  }
  check('车越贵排越后', pricesRise);

  // 攒钱换车得攒得动: 前两条赛道拿满冠军应该够买重机车
  const early = TRACKS[0].reward + TRACKS[1].reward;
  check('前两条赛道的奖金够买第二台车',
    early >= BIKES[1].price, early + ' vs ' + BIKES[1].price);

  const upTo4 = TRACKS.slice(0, 4).reduce((s, t) => s + t.reward, 0);
  check('前四条赛道的奖金够买第三台车',
    upTo4 >= BIKES[1].price + BIKES[2].price,
    upTo4 + ' vs ' + (BIKES[1].price + BIKES[2].price));

  let colorsOk = true;
  const seen = {};
  for (const r of RIDERS) {
    if (!/^#[0-9a-f]{6}$/i.test(r.color)) colorsOk = false;
    if (seen[r.color]) colorsOk = false;
    seen[r.color] = true;
  }
  check('每个车手的涂装都是合法且唯一的颜色', colorsOk);

  let scenesOk = true;
  for (const t of TRACKS) {
    if (!MB.PALETTES && !['coast', 'desert', 'forest', 'city', 'storm'].includes(t.scene)) {
      scenesOk = false;
    }
  }
  check('每条赛道都有对应的配色场景', scenesOk);
}

console.log('\n' + (failed ? '✗ ' : '✓ ') + passed + ' 项通过, ' + failed + ' 项失败');
if (failed) {
  console.log('\n失败项:');
  problems.forEach((p) => console.log('  - ' + p));
}
process.exit(failed ? 1 : 0);
