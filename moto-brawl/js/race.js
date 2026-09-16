/*
 * 一场比赛的完整模拟: 骑手物理、近身格斗、对手 AI、交通车辆、名次。
 *
 * 这里只有数字, 不碰 Canvas 也不碰 DOM —— 渲染层每帧读这里的状态去画。
 * 好处是整场比赛能在 Node 里无头跑完, 用来做回归测试和难度配平。
 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var CONFIG = MB.CONFIG;
  var Util = MB.Util;
  var Rng = MB.Rng;

  /* ------------------------------------------------------------------ *
   * 骑手
   * ------------------------------------------------------------------ */

  function Rider(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.color = opts.color;
    this.isPlayer = !!opts.isPlayer;

    // 车辆性能系数
    this.topSpeed = opts.topSpeed || 1;
    this.accel = opts.accel || 1;
    this.grip = opts.grip || 1;
    this.armor = opts.armor || 1;

    // AI 性格
    this.skill = opts.skill || 0.8;
    this.aggression = opts.aggression || 0.5;

    this.z = opts.z || 0;          // 沿赛道走过的世界距离(不绕回)
    this.x = opts.x || 0;          // 横向, ±1 是路边缘
    this.speed = 0;
    this.health = CONFIG.maxHealth;
    this.weapon = 0;

    this.state = 'ride';           // ride | hit | down
    this.stateTime = 0;
    this.lean = 0;                 // 视觉倾斜, 渲染用
    this.attackCd = 0;
    this.attack = null;            // { side, kind, t } 出手动画
    this.flash = 0;                // 挨打时的闪白
    this.grazeCd = 0;              // 蹭车的冷却, 免得贴着一辆车连扣好几次
    this.swingCd = 0;              // AI 两次寻衅之间的间隔

    this.finished = false;
    this.finishTime = 0;
    this.rank = 0;
    this.knockdowns = 0;           // 被打趴下几次
    this.takedowns = 0;            // 打趴下几个人
  }

  Rider.prototype.maxSpeed = function () {
    return CONFIG.maxSpeed * this.topSpeed;
  };

  Rider.prototype.speedPercent = function () {
    return Util.clamp(this.speed / this.maxSpeed(), 0, 1);
  };

  Rider.prototype.isDown = function () { return this.state === 'down'; };

  /** 挨一下。伤害按护甲打折, 同时被横向推开。 */
  Rider.prototype.takeHit = function (damage, fromSide) {
    if (this.isDown()) return false;
    this.health -= damage / this.armor;
    this.flash = 0.18;
    this.x += (fromSide > 0 ? -1 : 1) * CONFIG.hitShove;
    this.speed *= 0.93;

    if (this.health <= 0) {
      this.health = 0;
      this.knockDown();
      return true;
    }
    this.state = 'hit';
    this.stateTime = 0.22;
    return false;
  };

  /** 摔车。躺一会儿, 爬起来血回一半, 速度从零开始。 */
  Rider.prototype.knockDown = function () {
    this.state = 'down';
    this.stateTime = CONFIG.knockdownTime;
    this.speed = 0;
    this.knockdowns++;
    this.attack = null;
  };

  Rider.prototype.getUp = function () {
    this.state = 'ride';
    this.stateTime = 0;
    this.health = CONFIG.maxHealth * 0.55;
    this.x = Util.clamp(this.x, -0.7, 0.7);
  };

  /* ------------------------------------------------------------------ *
   * 比赛
   * ------------------------------------------------------------------ */

  /**
   * options: { track, bike, riders: [车手定义], seed, rivalSkill, rivalRage }
   */
  function Race(options) {
    this.track = options.track;
    this.rng = new Rng(options.seed || 12345);
    this.time = 0;
    this.countdown = options.countdown === undefined ? 3.2 : options.countdown;
    this.state = this.countdown > 0 ? 'countdown' : 'racing';
    this.finishZ = this.track.totalLength() * (this.track.def.laps || 1);
    this.events = [];              // 本帧发生的事, 渲染/音效层来消费

    var bike = options.bike;
    this.player = new Rider({
      id: 'player', name: options.playerName || '你', color: bike.color,
      isPlayer: true,
      topSpeed: bike.topSpeed, accel: bike.accel, grip: bike.grip, armor: bike.armor,
      z: 0, x: 0
    });

    this.riders = [this.player];
    var defs = options.riders || [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      // 对手极速 = 车手底子 x 本赛道的整体节奏。
      // 节奏值(track.rivalSkill)是照着三台车的极速定的: 第一条赛道略低于
      // 起步车, 最后一条要骑上最快的车才追得上 —— 换车才有意义。
      // 对手起步位置错开, 免得开局就叠在一起
      this.riders.push(new Rider({
        id: 'ai' + i, name: d.name, color: d.color,
        topSpeed: (0.74 + d.skill * 0.20) * (options.rivalSkill || 1),
        accel: 0.9 + d.skill * 0.2,
        grip: 1, armor: d.bulk,
        skill: d.skill * (options.rivalSkill || 1),
        aggression: d.aggression * (options.rivalRage || 1),
        z: this.rng.range(-600, 900),
        x: this.rng.range(-0.62, 0.62)
      }));
    }

    this.traffic = this.spawnTraffic(options.trafficDensity || 0.4);
    this.pickups = this.spawnPickups();
    this.updateRanks();
  }

  /** 交通车辆。沿路撒一批, 匀速往前开, 撞上就是一跤。 */
  Race.prototype.spawnTraffic = function (density) {
    var cars = [];
    var total = this.track.totalLength();
    // 极速下一秒要跑一万多个单位, 车距太小就成了「必撞」而不是「要躲」。
    // 最密的城区也留出约半秒反应时间。
    var gap = Util.interpolate(16000, 6000, Util.clamp(density, 0, 1));
    for (var z = 4000; z < total - 4000; z += gap * this.rng.range(0.6, 1.5)) {
      cars.push({
        z: z,
        x: this.rng.range(-0.72, 0.72),
        speed: CONFIG.trafficSpeed * this.rng.range(0.6, 1.25),
        kind: this.rng.int(0, 3),
        alive: true
      });
    }
    return cars;
  };

  /** 路边的钢管。捡到之后几下攻击伤害更高。 */
  Race.prototype.spawnPickups = function () {
    var items = [];
    var total = this.track.totalLength();
    for (var z = 12000; z < total - 8000; z += this.rng.range(16000, 30000)) {
      items.push({ z: z, x: this.rng.range(-0.85, 0.85), taken: false });
    }
    return items;
  };

  /* ---------------- 主循环 ---------------- */

  /**
   * input: { throttle, brake, steer(-1~1), punchLeft, punchRight, kickLeft, kickRight }
   * dt 建议夹在 1/30 以内, 否则高速下会穿过交通车。
   */
  Race.prototype.update = function (dt, input) {
    this.events.length = 0;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.events.push({ type: 'go' });
      }
      // 读秒期间不能动, 但要允许轰油门(纯表现)
      return;
    }

    if (this.state === 'finished') return;

    this.time += dt;

    this.updateTraffic(dt);
    this.updatePlayer(dt, input || {});

    for (var i = 1; i < this.riders.length; i++) {
      this.updateAi(this.riders[i], dt);
    }

    for (i = 0; i < this.riders.length; i++) {
      this.resolveCollisions(this.riders[i], dt);
      this.checkFinish(this.riders[i]);
    }

    this.updateRanks();

    if (this.player.finished) {
      this.state = 'finished';
      this.events.push({ type: 'finish', rank: this.player.rank });
    }
  };

  Race.prototype.updateTraffic = function (dt) {
    var total = this.track.totalLength();
    for (var i = 0; i < this.traffic.length; i++) {
      var car = this.traffic[i];
      car.z += car.speed * dt;
      // 开出赛道尾部就绕回开头, 保证全程都有车
      if (car.z > total) car.z -= total;
    }
  };

  /** 公共的运动学: 油门/刹车/转向/离心力/离地减速。 */
  Race.prototype.driveRider = function (rider, dt, throttle, brake, steer) {
    if (rider.isDown()) {
      rider.stateTime -= dt;
      rider.speed = Math.max(0, rider.speed - 9000 * dt);
      rider.z += rider.speed * dt;
      if (rider.stateTime <= 0) rider.getUp();
      return;
    }

    if (rider.state === 'hit') {
      rider.stateTime -= dt;
      if (rider.stateTime <= 0) rider.state = 'ride';
    }

    var max = rider.maxSpeed();
    if (brake) {
      rider.speed += CONFIG.braking * dt;
    } else if (throttle) {
      rider.speed += CONFIG.accel * rider.accel * dt;
    } else {
      rider.speed += CONFIG.decel * dt;
    }

    var offRoad = Math.abs(rider.x) > 1;
    if (offRoad) {
      rider.speed += CONFIG.offRoadDecel * dt;
      if (rider.speed > CONFIG.offRoadLimit) rider.speed = CONFIG.offRoadLimit;
    }

    rider.speed = Util.clamp(rider.speed, 0, max);

    var pct = rider.speedPercent();
    var dx = dt * CONFIG.steerSpeed * pct;
    if (steer) rider.x += steer * dx * rider.grip;

    // 过弯被甩向外侧, 速度越快甩得越狠
    var seg = this.track.segmentAt(rider.z);
    rider.x -= dx * pct * seg.curve * CONFIG.centrifugal;

    // 冲出路肩也不让他飞太远, 免得镜头里彻底找不着人
    rider.x = Util.clamp(rider.x, -2.2, 2.2);
    rider.z += rider.speed * dt;

    // 视觉倾斜: 转向 + 弯道
    var wantLean = Util.clamp((steer || 0) * 0.7 + seg.curve * 0.12 * pct, -1, 1);
    rider.lean += (wantLean - rider.lean) * Math.min(1, dt * 8);

    if (rider.flash > 0) rider.flash -= dt;
    if (rider.grazeCd > 0) rider.grazeCd -= dt;
    if (rider.swingCd > 0) rider.swingCd -= dt;
    if (rider.attackCd > 0) rider.attackCd -= dt;
    if (rider.attack) {
      rider.attack.t += dt;
      if (rider.attack.t > 0.26) rider.attack = null;
    }
  };

  Race.prototype.updatePlayer = function (dt, input) {
    var p = this.player;
    if (p.finished) return;

    this.driveRider(p, dt, input.throttle, input.brake, input.steer || 0);

    if (p.isDown()) return;

    if (input.punchLeft) this.tryAttack(p, -1, 'punch');
    if (input.punchRight) this.tryAttack(p, 1, 'punch');
    if (input.kickLeft) this.tryAttack(p, -1, 'kick');
    if (input.kickRight) this.tryAttack(p, 1, 'kick');

    this.checkPickups(p);
  };

  Race.prototype.checkPickups = function (rider) {
    for (var i = 0; i < this.pickups.length; i++) {
      var item = this.pickups[i];
      if (item.taken) continue;
      if (Math.abs(item.z - rider.z) < 400 && Math.abs(item.x - rider.x) < 0.3) {
        item.taken = true;
        rider.weapon = CONFIG.weaponUses;
        this.events.push({ type: 'pickup', rider: rider });
      }
    }
  };

  /* ---------------- 格斗 ---------------- */

  /**
   * 朝某一侧出手。够得着才算数, 空挥也要吃冷却 —— 不然可以无脑狂按。
   * side: -1 左, 1 右。kind: 'punch' | 'kick'。
   */
  Race.prototype.tryAttack = function (rider, side, kind) {
    if (rider.attackCd > 0 || rider.isDown()) return null;

    var cd = kind === 'kick' ? CONFIG.kickCooldown : CONFIG.punchCooldown;
    rider.attackCd = cd;
    rider.attack = { side: side, kind: kind, t: 0, hit: false };

    var target = this.findTarget(rider, side);
    if (!target) {
      this.events.push({ type: 'whiff', rider: rider });
      return null;
    }

    var damage = kind === 'kick' ? CONFIG.kickDamage : CONFIG.punchDamage;
    if (rider.weapon > 0) {
      damage += CONFIG.weaponBonus;
      rider.weapon--;
    }

    rider.attack.hit = true;
    var downed = target.takeHit(damage, side);
    if (downed) rider.takedowns++;

    this.events.push({
      type: downed ? 'takedown' : 'hit',
      rider: rider, target: target, kind: kind
    });
    return target;
  };

  /** 找同侧、够得着、还没趴下的最近一个人。 */
  Race.prototype.findTarget = function (rider, side) {
    var best = null;
    var bestDist = Infinity;

    for (var i = 0; i < this.riders.length; i++) {
      var other = this.riders[i];
      if (other === rider || other.isDown() || other.finished) continue;

      var dz = other.z - rider.z;
      if (Math.abs(dz) > CONFIG.reach) continue;

      var dx = other.x - rider.x;
      // 必须在出手的那一侧
      if (side > 0 ? dx < 0.02 : dx > -0.02) continue;
      if (Math.abs(dx) > CONFIG.reachLateral) continue;

      var dist = Math.abs(dz) + Math.abs(dx) * 800;
      if (dist < bestDist) { bestDist = dist; best = other; }
    }
    return best;
  };

  /* ---------------- 对手 AI ---------------- */

  Race.prototype.updateAi = function (ai, dt) {
    if (ai.finished) {
      ai.z += ai.speed * dt;
      return;
    }

    if (ai.isDown()) {
      this.driveRider(ai, dt, false, false, 0);
      return;
    }

    var seg = this.track.segmentAt(ai.z);
    var steer = 0;

    // 走内线: 弯道里往里侧靠, 技术越好靠得越准
    var line = Util.clamp(-seg.curve * 0.11, -0.65, 0.65) * ai.skill;
    steer += Util.clamp((line - ai.x) * 2.2, -1, 1);

    // 躲车: 前方同侧有交通车就往旁边让
    var threat = this.nearestCarAhead(ai);
    if (threat) {
      steer += (ai.x > threat.x ? 1 : -1) * 1.3;
    }

    // 离地了先回到路上
    if (Math.abs(ai.x) > 0.95) steer += (ai.x > 0 ? -1 : 1) * 1.6;

    steer = Util.clamp(steer, -1, 1);

    // 弯太急就松一点油门, 技术差的更早松
    var brake = Math.abs(seg.curve) > 4.2 && ai.speedPercent() > 0.86 - ai.skill * 0.2;

    this.driveRider(ai, dt, !brake, brake, steer);

    // 找人打。出手频率不能高: 五个对手同时够得着玩家时, 单个看着还算克制的
    // 频率乘以五就成了围殴, 玩家全程在地上爬。
    if (ai.attackCd <= 0 && ai.swingCd <= 0 &&
        this.rng.next() < ai.aggression * dt * 0.55) {
      var side = this.player.x > ai.x ? 1 : -1;
      // 优先打玩家 —— AI 互殴的话玩家就成看客了; 够不着再随便找一个
      var victim = this.findTarget(ai, side);
      if (victim !== this.player) {
        side = this.rng.chance(0.5) ? -1 : 1;
        victim = this.findTarget(ai, side);
      }
      if (victim) {
        this.tryAttack(ai, side, this.rng.chance(0.3) ? 'kick' : 'punch');
        // 打完歇一会儿再找下一个目标, 给玩家反打和拉开距离的机会
        ai.swingCd = this.rng.range(1.1, 2.4);
      }
    }
  };

  /**
   * 前方同一条线上最近的一辆车。
   * 视距按当前速度算成「大约一秒后会撞上的距离」—— 写死一个固定值的话,
   * 极速下 3000 个单位只有 0.3 秒反应时间, 等看见了已经撞上了。
   */
  Race.prototype.nearestCarAhead = function (rider) {
    var total = this.track.totalLength();
    var wrapped = ((rider.z % total) + total) % total;
    var lookAhead = Math.max(3000, rider.speed * 1.15);
    var best = null;
    var bestDz = Infinity;

    for (var i = 0; i < this.traffic.length; i++) {
      var car = this.traffic[i];
      var dz = car.z - wrapped;
      if (dz < -total / 2) dz += total;       // 对面刚绕回起点的车
      if (dz <= 0 || dz > lookAhead) continue;
      if (Math.abs(car.x - rider.x) > 0.42) continue;
      if (dz < bestDz) { bestDz = dz; best = car; }
    }
    return best;
  };

  /* ---------------- 碰撞 ---------------- */

  Race.prototype.resolveCollisions = function (rider, dt) {
    if (rider.isDown() || rider.finished) return;

    // 撞交通车。正面撞上才摔车; 蹭一下只掉速掉血 ——
    // 一碰就躺的话, 车流密的赛道基本没法玩。
    var wrapped = ((rider.z % this.track.totalLength()) + this.track.totalLength())
      % this.track.totalLength();
    for (var i = 0; i < this.traffic.length; i++) {
      var car = this.traffic[i];
      if (Math.abs(car.z - wrapped) > 300) continue;
      var gap = Math.abs(car.x - rider.x);
      if (gap > 0.3) continue;

      if (gap < 0.15) {
        rider.knockDown();
        this.events.push({ type: 'crash', rider: rider, cause: 'traffic' });
      } else {
        // 擦身而过: 弹开、掉速、掉点血, 但还骑在车上
        if (rider.grazeCd > 0) continue;
        rider.grazeCd = 0.6;
        rider.x += (rider.x > car.x ? 1 : -1) * 0.22;
        rider.speed *= 0.62;
        rider.health = Math.max(1, rider.health - 6);
        rider.flash = 0.18;
        this.events.push({ type: 'graze', rider: rider });
      }
      return;
    }

    // 骑手之间互相挤开, 不叠在一起
    for (i = 0; i < this.riders.length; i++) {
      var other = this.riders[i];
      if (other === rider || other.isDown()) continue;
      if (Math.abs(other.z - rider.z) > 300) continue;
      var dx = rider.x - other.x;
      if (Math.abs(dx) > 0.26) continue;
      var push = (dx >= 0 ? 1 : -1) * 0.9 * dt;
      rider.x += push;
      other.x -= push;
    }

    // 冲太远的草地上会栽跟头
    if (Math.abs(rider.x) > 1.9 && rider.speed > CONFIG.offRoadLimit * 0.85) {
      rider.knockDown();
      this.events.push({ type: 'crash', rider: rider, cause: 'offroad' });
    }
  };

  Race.prototype.checkFinish = function (rider) {
    if (rider.finished) return;
    if (rider.z >= this.finishZ) {
      rider.finished = true;
      rider.finishTime = this.time;
    }
  };

  /** 已冲线的按用时排, 没冲线的按跑了多远排。 */
  Race.prototype.updateRanks = function () {
    var sorted = this.riders.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.z - a.z;
    });
    for (var i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
    this.ranking = sorted;
    return sorted;
  };

  Race.prototype.progress = function () {
    return Util.clamp(this.player.z / this.finishZ, 0, 1);
  };

  MB.Rider = Rider;
  MB.Race = Race;
})(typeof window !== 'undefined' ? window : this);
