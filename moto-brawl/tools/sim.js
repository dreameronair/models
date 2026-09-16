/*
 * 无头跑比赛。把 js/core.js + track.js + race.js 装进 vm 沙箱, 不需要浏览器。
 *
 * tools/test_race.js 用它做回归测试, tools/balance.js 用它配平难度。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/core.js', 'js/track.js', 'js/race.js'];

/** 载入一份独立的 MB 运行时。每次都是全新的, 互不干扰。 */
function createRuntime() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Math = Math;
  sandbox.localStorage = null;

  const context = vm.createContext(sandbox);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context,
      { filename: file });
  }
  return sandbox.MB;
}

/**
 * 造一场比赛。trackId 不传就用第一条, bikeId 不传就用起步车。
 */
function makeRace(MB, opts = {}) {
  const def = MB.TRACKS.find((t) => t.id === opts.trackId) || MB.TRACKS[0];
  const bike = MB.BIKES.find((b) => b.id === opts.bikeId) || MB.BIKES[0];
  const track = new MB.Track(Object.assign({}, def, opts.trackOverride || {}));
  return new MB.Race({
    track,
    bike,
    riders: MB.RIDERS.slice(0, opts.rivals === undefined ? MB.CONFIG.rivalCount : opts.rivals),
    seed: opts.seed === undefined ? 4242 : opts.seed,
    rivalSkill: opts.rivalSkill === undefined ? def.rivalSkill : opts.rivalSkill,
    rivalRage: opts.rivalRage === undefined ? def.rivalRage : opts.rivalRage,
    trafficDensity: opts.traffic === undefined ? def.traffic : opts.traffic,
    countdown: opts.countdown === undefined ? 0 : opts.countdown
  });
}

/**
 * 一个会开车也会打架的机器玩家。
 * skill 0~1: 走线准不准、躲不躲车。aggression 0~1: 多爱动手。
 */
function botInput(race, skill = 0.85, aggression = 0.5) {
  const p = race.player;
  const seg = race.track.segmentAt(p.z);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // 走内线
  const line = clamp(-seg.curve * 0.11, -0.6, 0.6) * skill;
  let steer = clamp((line - p.x) * 2.2, -1, 1);

  // 躲前面的交通车。视距跟着速度走, 跟 race.js 里 AI 用的是同一套标准
  const threat = race.nearestCarAhead(p);
  if (threat) steer += (p.x > threat.x ? 1 : -1) * 1.4;
  if (Math.abs(p.x) > 0.95) steer += (p.x > 0 ? -1 : 1) * 1.6;
  steer = clamp(steer, -1, 1);

  const brake = Math.abs(seg.curve) > 4.4 && p.speedPercent() > 0.9 - skill * 0.2;

  // 旁边有人就揍
  let punchLeft = false, punchRight = false;
  if (p.attackCd <= 0 && aggression > 0) {
    if (race.findTarget(p, -1)) punchLeft = Math.random() < aggression;
    else if (race.findTarget(p, 1)) punchRight = Math.random() < aggression;
  }

  return { throttle: !brake, brake, steer, punchLeft, punchRight };
}

/**
 * 跑完一整场。返回 { rank, time, finished, knockdowns, takedowns, steps }。
 * maxSeconds 是保险丝, 防止卡住的比赛把测试挂死。
 */
function runRace(race, opts = {}) {
  const dt = opts.dt || 1 / 60;
  const maxSeconds = opts.maxSeconds || 600;
  const skill = opts.skill === undefined ? 0.85 : opts.skill;
  const aggression = opts.aggression === undefined ? 0.5 : opts.aggression;
  const input = opts.input;

  let steps = 0;
  const limit = Math.ceil(maxSeconds / dt);
  while (race.state !== 'finished' && steps < limit) {
    race.update(dt, input ? input(race) : botInput(race, skill, aggression));
    steps++;
  }

  const p = race.player;
  return {
    rank: p.rank,
    time: p.finishTime,
    finished: p.finished,
    knockdowns: p.knockdowns,
    takedowns: p.takedowns,
    avgSpeed: p.finished ? race.finishZ / p.finishTime : 0,
    steps,
    timedOut: steps >= limit
  };
}

module.exports = { ROOT, createRuntime, makeRace, botInput, runRace };
