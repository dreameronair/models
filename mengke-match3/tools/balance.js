/*
 * 关卡配平: 用 tools/sim.js 的机器玩家把每一关打若干遍, 统计通关率与星级,
 * 好确认 100 关的曲线是「越来越难但一直打得过」, 而不是某关突然卡死。
 *
 * 用法:
 *   node tools/balance.js                 # 全部关卡, 每关 40 局
 *   node tools/balance.js --runs 80       # 加大样本
 *   node tools/balance.js --skill 0.7     # 模拟手生一点的玩家
 *   node tools/balance.js --from 60 --to 80
 */
'use strict';

const { createRuntime, makeRng, playLevel } = require('./sim');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const RUNS = arg('runs', 40);
const SKILL = arg('skill', 0.85);

/*
 * 标定模式: 量一量「一步到底能消掉目标角色几个、能得多少分」。
 * 角色种类越少连锁越猛, 这个值差得很远(4 种时是 6 种的四倍多),
 * 拍脑袋估是估不准的, core.js 里的 YIELD / SCORE 表就是这么测出来的。
 */
if (process.argv.includes('--calibrate')) {
  const BUDGET = 30;
  console.log('每步产出标定(每档 %d 局 x %d 步, 操作水平 %s)\n', RUNS, BUDGET, SKILL);
  console.log(' 种类  目标种类数   每步消掉(每种)   每步得分');
  for (const types of [4, 5, 6]) {
    for (let kinds = 1; kinds <= 3 && kinds <= types; kinds++) {
      // count 给到用不完, 这样必定打满 BUDGET 步, 量的才是稳定速率
      const probe = {
        types,
        moves: BUDGET,
        target: 1,
        collect: Array.from({ length: kinds }, (_, k) => ({ type: k, count: 99999 }))
      };
      let got = 0, score = 0, used = 0;
      for (let run = 0; run < RUNS; run++) {
        const rt = createRuntime(types * 100000 + kinds * 1000 + run);
        const res = playLevel(rt, probe, { skill: SKILL, rng: makeRng(types * 31 + kinds * 7 + run) });
        got += res.goals.reduce((n, g) => n + g.have, 0) / kinds;
        score += res.score;
        used += res.movesUsed;
      }
      console.log('%s %s %s %s',
        String(types).padStart(4), String(kinds).padStart(10),
        (got / used).toFixed(2).padStart(15), Math.round(score / used).toString().padStart(11));
    }
  }
  process.exit(0);
}

const MK = createRuntime(1);
const LEVELS = MK.LEVELS;
const FROM = arg('from', 1) - 1;
const TO = arg('to', LEVELS.length);

const rows = [];
for (let i = FROM; i < TO; i++) {
  const level = LEVELS[i];
  let wins = 0, stars = 0, score = 0, used = 0;
  for (let run = 0; run < RUNS; run++) {
    const rt = createRuntime(i * 1000 + run);
    const res = playLevel(rt, level, { skill: SKILL, rng: makeRng(i * 7919 + run) });
    if (res.won) wins++;
    stars += res.stars;
    score += res.score;
    used += res.movesUsed;
  }
  rows.push({
    level: i + 1,
    types: level.types,
    moves: level.moves,
    target: level.target,
    goals: level.collect.reduce((n, g) => n + g.count, 0),
    win: wins / RUNS,
    stars: stars / RUNS,
    score: Math.round(score / RUNS),
    used: (used / RUNS).toFixed(1)
  });
}

console.log('每关 %d 局, 操作水平 %s\n', RUNS, SKILL);
console.log(' 关卡 种类 步数   目标分  收集  通关率  平均星  平均分  用掉步数');
for (const r of rows) {
  console.log('%s %s %s %s %s %s %s %s %s',
    String(r.level).padStart(4),
    String(r.types).padStart(4),
    String(r.moves).padStart(4),
    String(r.target).padStart(8),
    String(r.goals).padStart(5),
    (Math.round(r.win * 100) + '%').padStart(7),
    r.stars.toFixed(2).padStart(7),
    String(r.score).padStart(7),
    String(r.used).padStart(9));
}

const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const worst = rows.reduce((a, b) => (b.win < a.win ? b : a));
console.log('\n平均通关率 %s%%, 平均星级 %s',
  (avg((r) => r.win) * 100).toFixed(1), avg((r) => r.stars).toFixed(2));
console.log('最难的一关: 第 %d 关, 通关率 %s%%', worst.level, Math.round(worst.win * 100));

// 分组看曲线是否单调
const CHUNK = 10;
if (rows.length > CHUNK) {
  console.log('\n每 %d 关一段:', CHUNK);
  for (let s = 0; s < rows.length; s += CHUNK) {
    const part = rows.slice(s, s + CHUNK);
    const w = part.reduce((n, r) => n + r.win, 0) / part.length;
    const st = part.reduce((n, r) => n + r.stars, 0) / part.length;
    console.log('  第 %s-%s 关   通关率 %s%%   平均星 %s',
      String(part[0].level).padStart(3), String(part[part.length - 1].level).padStart(3),
      (w * 100).toFixed(0).padStart(3), st.toFixed(2));
  }
}
