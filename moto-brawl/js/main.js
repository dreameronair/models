/* 启动入口: 存档、主循环、事件绑定。 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var CONFIG = MB.CONFIG;
  var TRACKS = MB.TRACKS;
  var BIKES = MB.BIKES;
  var RIDERS = MB.RIDERS;
  var Util = MB.Util;
  var Storage = MB.Storage;
  var Sound = MB.Sound;
  var UI = MB.UI;
  var doc = global.document;

  function el(id) { return doc.getElementById(id); }

  /* ------------------------------------------------------------------ *
   * 存档
   * ------------------------------------------------------------------ */

  var Save = {
    cash: function () { return Storage.get('cash', 0); },
    addCash: function (n) { Storage.set('cash', Save.cash() + n); },

    // unlocked 是已解锁赛道的最大下标
    unlockedTracks: function () { return Storage.get('unlocked', 0); },

    unlockUpTo: function (index) {
      if (index > Save.unlockedTracks() && index < TRACKS.length) {
        Storage.set('unlocked', index);
        return true;
      }
      return false;
    },

    results: function () { return Storage.get('results', {}); },

    bestRank: function (trackId) {
      var r = Save.results()[trackId];
      return r ? r.rank : 0;
    },

    recordResult: function (trackId, rank, time) {
      var all = Save.results();
      var prev = all[trackId];
      // 名次优先, 名次相同再比时间
      if (!prev || rank < prev.rank || (rank === prev.rank && time < prev.time)) {
        all[trackId] = { rank: rank, time: time };
        Storage.set('results', all);
      }
    },

    clearedCount: function () {
      var all = Save.results();
      var n = 0;
      for (var k in all) {
        if (Object.prototype.hasOwnProperty.call(all, k)) n++;
      }
      return n;
    },

    ownedBikes: function () { return Storage.get('bikes', ['scrap']); },

    buyBike: function (id) {
      var bike = BIKES.filter(function (b) { return b.id === id; })[0];
      if (!bike) return false;
      var owned = Save.ownedBikes();
      if (owned.indexOf(id) >= 0) return true;
      if (Save.cash() < bike.price) return false;
      Storage.set('cash', Save.cash() - bike.price);
      owned.push(id);
      Storage.set('bikes', owned);
      return true;
    },

    currentBike: function () { return Storage.get('bike', 'scrap'); },
    setBike: function (id) { Storage.set('bike', id); }
  };

  MB.Save = Save;

  /* ------------------------------------------------------------------ *
   * 比赛流程
   * ------------------------------------------------------------------ */

  var state = {
    race: null,
    renderer: null,
    input: null,
    trackIndex: 0,
    running: false,
    paused: false,
    lastTime: 0,
    raf: 0
  };

  function bikeById(id) {
    return BIKES.filter(function (b) { return b.id === id; })[0] || BIKES[0];
  }

  function startRace(trackIndex) {
    var def = TRACKS[trackIndex];
    state.trackIndex = trackIndex;

    var track = new MB.Track(def);
    var bike = bikeById(Save.currentBike());

    state.race = new MB.Race({
      track: track,
      bike: bike,
      riders: RIDERS.slice(0, CONFIG.rivalCount),
      seed: def.seed + 7,
      rivalSkill: def.rivalSkill,
      rivalRage: def.rivalRage,
      trafficDensity: def.traffic,
      countdown: 3.2
    });

    state.renderer = new MB.Renderer(el('view'), track);
    state.input.reset();
    state.paused = false;

    UI.show('race');
    // 切到比赛页之后 canvas 才有尺寸, 这时候量才准
    state.renderer.resize();
    UI.updateHud(state.race);
    UI.centerMessage('3');

    Sound.unlock();
    Sound.startEngine();

    state.lastTime = 0;
    state.running = true;
    if (!state.raf) state.raf = requestAnimationFrame(loop);

    global.__MB_RACE = state.race;   // 测试脚本用
  }

  function quitRace() {
    state.running = false;
    state.race = null;
    Sound.stopEngine();
    UI.hideCenterMessage();
    UI.closeCard();
    UI.show('home');
  }

  /* ---------------- 主循环 ---------------- */

  var lastCountdownShown = -1;

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (!state.running || !state.race) return;

    if (!state.lastTime) state.lastTime = now;
    // 夹住 dt: 切后台回来时一次跳几秒会直接穿过交通车
    var dt = Math.min((now - state.lastTime) / 1000, 1 / 30);
    state.lastTime = now;

    var race = state.race;

    if (!state.paused) {
      var input = state.input.read();
      race.__braking = input.brake;

      if (race.state === 'countdown') {
        var n = Math.ceil(race.countdown);
        if (n !== lastCountdownShown) {
          lastCountdownShown = n;
          if (n > 0) {
            UI.centerMessage(String(n));
            Sound.beep(false);
          }
        }
      }

      race.update(dt, input);
      handleEvents(race);

      if (race.state === 'racing') {
        var seg = race.track.segmentAt(race.player.z);
        state.renderer.updateParallax(dt, seg.curve, race.player.speedPercent());
      }

      UI.updateHud(race);
    }

    state.renderer.render(race, now / 1000);

    Sound.engineUpdate(race.player.speedPercent(),
      !!race.__braking === false, race.player.isDown());
  }

  /** 消费本帧事件: 放音效、抖屏、弹提示。 */
  function handleEvents(race) {
    for (var i = 0; i < race.events.length; i++) {
      var ev = race.events[i];
      switch (ev.type) {
        case 'go':
          UI.centerMessage('冲！', 700);
          Sound.beep(true);
          break;
        case 'hit':
          if (ev.rider.isPlayer) {
            (ev.kind === 'kick' ? Sound.kick : Sound.punch)();
          } else if (ev.target.isPlayer) {
            (ev.kind === 'kick' ? Sound.kick : Sound.punch)();
            state.renderer.addShake(0.5);
          }
          break;
        case 'whiff':
          if (ev.rider.isPlayer) Sound.whiff();
          break;
        case 'takedown':
          Sound.takedown();
          if (ev.rider.isPlayer) {
            UI.toast(ev.target.name + ' 被你打下车了');
          } else if (ev.target.isPlayer) {
            state.renderer.addShake(1);
            UI.centerMessage('摔车！', 1200);
          }
          break;
        case 'crash':
          if (ev.rider.isPlayer) {
            Sound.crash();
            state.renderer.addShake(1);
            UI.centerMessage(ev.cause === 'traffic' ? '撞车！' : '冲出赛道！', 1200);
          }
          break;
        case 'pickup':
          if (ev.rider.isPlayer) {
            Sound.pickup();
            UI.toast('捡到钢管，接下来几下更疼');
          }
          break;
        case 'finish':
          finishRace();
          break;
      }
    }
  }

  function finishRace() {
    state.running = false;
    Sound.stopEngine();
    Sound.finish();
    UI.hideCenterMessage();

    var race = state.race;
    var def = TRACKS[state.trackIndex];
    var rank = race.player.rank;

    // 奖金: 冠军拿全额, 往后递减, 前三名之外只有辛苦费
    var payout = [1, 0.6, 0.35, 0.15, 0.08, 0.05][rank - 1] || 0.05;
    var reward = Math.round(def.reward * payout);
    Save.addCash(reward);
    Save.recordResult(def.id, rank, race.player.finishTime);

    // 拿到前三才解锁下一条
    var unlockedName = null;
    if (rank <= 3 && Save.unlockUpTo(state.trackIndex + 1)) {
      unlockedName = TRACKS[state.trackIndex + 1].name;
    }

    var hasNext = state.trackIndex + 1 < TRACKS.length &&
      Save.unlockedTracks() >= state.trackIndex + 1;

    UI.openResult({
      rank: rank,
      time: race.player.finishTime,
      takedowns: race.player.takedowns,
      knockdowns: race.player.knockdowns,
      reward: reward,
      unlocked: unlockedName,
      nextTrack: hasNext,
      standings: race.updateRanks()
    });
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */

  function pauseRace() {
    if (!state.running || state.paused) return;
    state.paused = true;
    UI.openPause();
  }

  function resumeRace() {
    state.paused = false;
    state.lastTime = 0;       // 别把暂停那段时间算进 dt
    UI.closeCard();
  }

  function bindEvents() {
    el('btnRace').addEventListener('click', function () {
      Sound.unlock(); Sound.click();
      UI.show('tracks');
    });
    el('btnGarage').addEventListener('click', function () {
      Sound.unlock(); Sound.click();
      UI.show('garage');
    });
    el('btnHelp').addEventListener('click', function () {
      Sound.unlock(); Sound.click();
      UI.openHelp();
    });

    el('btnSfx').addEventListener('click', function () {
      Sound.sfxOn = !Sound.sfxOn;
      Storage.set('sfx', Sound.sfxOn);
      UI.updateSoundChips();
      Sound.click();
    });
    el('btnEngine').addEventListener('click', function () {
      Sound.engineOn = !Sound.engineOn;
      Storage.set('engine', Sound.engineOn);
      UI.updateSoundChips();
      Sound.click();
    });

    el('btnPause').addEventListener('click', pauseRace);

    // 返回箭头
    var navs = doc.querySelectorAll('[data-nav]');
    for (var i = 0; i < navs.length; i++) {
      navs[i].addEventListener('click', function () {
        Sound.click();
        UI.show(this.getAttribute('data-nav'));
      });
    }

    // 赛道列表
    el('trackList').addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== this && !node.getAttribute('data-track')) node = node.parentNode;
      if (!node || node === this) return;
      var id = node.getAttribute('data-track');
      var index = 0;
      for (var k = 0; k < TRACKS.length; k++) if (TRACKS[k].id === id) index = k;
      Sound.click();
      startRace(index);
    });

    // 车库
    el('bikeList').addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== this && !node.getAttribute('data-bike')) node = node.parentNode;
      if (!node || node === this) return;
      var id = node.getAttribute('data-bike');
      var owned = Save.ownedBikes();

      if (owned.indexOf(id) >= 0) {
        Save.setBike(id);
        Sound.click();
        UI.toast('换好了');
      } else if (Save.buyBike(id)) {
        Save.setBike(id);
        Sound.pickup();
        UI.toast('买下了，已经骑上');
      } else {
        Sound.whiff();
        UI.toast('钱还不够');
        return;
      }
      UI.renderGarage();
    });

    // 弹层按钮
    el('overlay').addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== this && !node.getAttribute('data-action')) node = node.parentNode;
      if (!node || node === this) return;
      var act = node.getAttribute('data-action');
      Sound.click();

      switch (act) {
        case 'close': UI.closeCard(); break;
        case 'resume': resumeRace(); break;
        case 'restart': UI.closeCard(); startRace(state.trackIndex); break;
        case 'next': UI.closeCard(); startRace(state.trackIndex + 1); break;
        case 'garage': UI.closeCard(); state.running = false; UI.show('garage'); break;
        case 'quit': quitRace(); break;
      }
    });

    global.addEventListener('resize', function () {
      if (state.renderer) state.renderer.resize();
    });

    // 切后台自动暂停, 回来不至于已经撞死了
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && state.running && !state.paused) pauseRace();
    });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */

  function boot() {
    var fill = el('loadFill');
    var tip = el('loadTip');

    Sound.sfxOn = Storage.get('sfx', true);
    Sound.engineOn = Storage.get('engine', true);
    Sound.init();

    // 触屏设备默认自动给油: 一只手同时管方向和拳脚已经忙不过来了
    var touch = ('ontouchstart' in global) || navigator.maxTouchPoints > 0;
    state.input = new MB.Input({ autoThrottle: touch, onPause: pauseRace });
    state.input.bindTouch(el('touchPad'));

    bindEvents();

    // 预生成第一条赛道。几千段的数组构建要几十毫秒, 提前做掉,
    // 免得点「开始」之后卡一下
    fill.style.width = '40%';
    tip.textContent = '正在铺路…';

    setTimeout(function () {
      try {
        new MB.Track(TRACKS[0]);
      } catch (e) {
        tip.textContent = '赛道生成失败：' + e.message;
        return;
      }
      fill.style.width = '100%';
      tip.textContent = '准备就绪';

      setTimeout(function () {
        UI.updateSoundChips();
        UI.show('home');
        global.__MB_READY = true;
      }, 180);
    }, 60);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  MB.__state = state;          // 测试脚本用
  MB.startRace = startRace;
})(typeof window !== 'undefined' ? window : this);
