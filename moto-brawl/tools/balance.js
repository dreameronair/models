/*
 * 难度配平: 让机器玩家把每条赛道跑若干遍, 看名次、摔车次数、用时。
 *
 * 想要的曲线是「第一条随便跑跑就能进前三, 最后一条得拼一拼」, 而不是
 * 从头到尾被五个对手围殴。
 *
 * 用法:
 *   node tools/balance.js                # 全部赛道, 每条 20 局
 *   node tools/balance.js --runs 40
 *   node tools/balance.js --skill 0.6    # 手生一点的玩家
 *   node tools/balance.js --track city
 */
'use strict';

const { createRuntime, makeRace, runRace } = require('./sim');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return isNaN(Number(v)) ? v : Number(v);
}

const RUNS = arg('runs', 20);
const SKILL = arg('skill', 0.85);
const AGGRO = arg('aggro', 0.5);
const ONLY = arg('track', null);
const BIKE = arg('bike', null);

/*
 * 每条赛道「预期骑什么车」。奖金攒得动的节奏大致是: 前两条用起步车,
 * 中间两条换重机车, 最后一条上刀锋。配平要按这个来看, 全程拿起步车去测
 * 后面的赛道当然打不过 —— 那正是逼玩家换车的设计。
 */
const EXPECTED_BIKE = {
  coast: 'scrap', desert: 'scrap',
  forest: 'cruiser', city: 'cruiser',
  storm: 'blade'
};

const MB = createRuntime();
const tracks = MB.TRACKS.filter((t) => !ONLY || t.id === ONLY);

console.log('每条赛道 %d 局, 操作水平 %s, 出手频率 %s, 车 %s\n',
  RUNS, SKILL, AGGRO, BIKE || '按预期进度');
console.log('  赛道        车      平均名次  夺冠率  前三率  自己摔车  打趴对手   平均用时');

const rows = [];
for (const def of tracks) {
  let rankSum = 0, wins = 0, podium = 0, kd = 0, td = 0, timeSum = 0, dnf = 0;

  const bikeId = BIKE || EXPECTED_BIKE[def.id] || 'scrap';
  const bikeName = MB.BIKES.filter((b) => b.id === bikeId)[0].name;

  for (let run = 0; run < RUNS; run++) {
    const race = makeRace(MB, { trackId: def.id, bikeId, seed: 1000 + run * 37 });
    const res = runRace(race, { skill: SKILL, aggression: AGGRO });
    if (res.timedOut) { dnf++; continue; }
    rankSum += res.rank;
    if (res.rank === 1) wins++;
    if (res.rank <= 3) podium++;
    kd += res.knockdowns;
    td += res.takedowns;
    timeSum += res.time;
  }

  const n = RUNS - dnf || 1;
  const row = {
    id: def.id, name: def.name,
    rank: rankSum / n, win: wins / RUNS, podium: podium / RUNS,
    kd: kd / n, td: td / n, time: timeSum / n, dnf
  };
  rows.push(row);

  console.log('  %s %s %s %s %s %s %s %s',
    def.name.padEnd(10),
    bikeName.padEnd(6),
    row.rank.toFixed(2).padStart(7),
    (Math.round(row.win * 100) + '%').padStart(7),
    (Math.round(row.podium * 100) + '%').padStart(7),
    row.kd.toFixed(1).padStart(9),
    row.td.toFixed(1).padStart(9),
    (row.time.toFixed(1) + 's').padStart(10));
}

const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log('\n整体: 平均名次 %s, 夺冠率 %s%%, 前三率 %s%%, 平均摔 %s 次',
  avg((r) => r.rank).toFixed(2),
  (avg((r) => r.win) * 100).toFixed(0),
  (avg((r) => r.podium) * 100).toFixed(0),
  avg((r) => r.kd).toFixed(1));

// 解锁靠的是前三名, 所以前三率才是真正卡进度的那条线
const stuck = rows.filter((r) => r.podium < 0.35);
if (stuck.length) {
  console.log('\n前三率偏低(可能卡住玩家): ' +
    stuck.map((r) => r.name + ' ' + Math.round(r.podium * 100) + '%').join(', '));
}
