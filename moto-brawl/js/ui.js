/* 界面层: 页面切换、HUD 刷新、赛道/车库列表、结算弹层。 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var CONFIG = MB.CONFIG;
  var TRACKS = MB.TRACKS;
  var BIKES = MB.BIKES;
  var Util = MB.Util;
  var Sprites = MB.Sprites;
  var doc = global.document;

  function el(id) { return doc.getElementById(id); }

  var UI = {
    current: 'loading',
    onAction: null      // main.js 挂上来, 接管弹层按钮
  };

  /* ---------------- 页面切换 ---------------- */

  UI.show = function (name) {
    var screens = doc.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('is-active', screens[i].id === 'screen-' + name);
    }
    UI.current = name;
    if (name === 'tracks') UI.renderTracks();
    if (name === 'garage') UI.renderGarage();
    if (name === 'home') UI.renderHome();
  };

  /* ---------------- 主菜单 ---------------- */

  UI.renderHome = function () {
    var save = MB.Save;
    el('homeCash').textContent = save.cash();
    el('homeDone').textContent = save.clearedCount();
    el('homeTotal').textContent = TRACKS.length;
  };

  UI.updateSoundChips = function () {
    var Sound = MB.Sound;
    var sfx = el('btnSfx');
    sfx.textContent = Sound.sfxOn ? '音效 开' : '音效 关';
    sfx.classList.toggle('is-off', !Sound.sfxOn);
    var eng = el('btnEngine');
    eng.textContent = Sound.engineOn ? '引擎声 开' : '引擎声 关';
    eng.classList.toggle('is-off', !Sound.engineOn);
  };

  /* ---------------- 赛道列表 ---------------- */

  UI.renderTracks = function () {
    var save = MB.Save;
    var unlocked = save.unlockedTracks();
    var html = '';

    for (var i = 0; i < TRACKS.length; i++) {
      var t = TRACKS[i];
      var locked = i > unlocked;
      var best = save.bestRank(t.id);
      var badge = locked ? '未解锁'
        : (best ? Util.ordinal(best) : '未完赛');

      html += '<button class="card' + (locked ? ' is-locked' : '') + '"' +
        (locked ? ' disabled' : ' data-track="' + t.id + '"') + '>' +
        '<canvas class="card-thumb" data-scene="' + t.scene + '" width="128" height="92"></canvas>' +
        '<div class="card-body">' +
          '<div class="card-title">' + t.name + '</div>' +
          '<div class="card-desc">' + (locked ? '先跑完上一条赛道' : t.desc) + '</div>' +
          '<div class="card-meta">全长 ' + Math.round(t.length * CONFIG.segmentLength / 1000) +
            ' 公里 · 对手 ' + CONFIG.rivalCount + ' 人 · 冠军奖金 <b>' + t.reward + '</b></div>' +
        '</div>' +
        '<div class="card-badge">' + badge + '</div>' +
        '</button>';
    }

    el('trackList').innerHTML = html;
    el('trackCash').textContent = save.cash();
    paintThumbs();
  };

  /** 赛道缩略图: 用各自的配色画一小段路, 比纯色块好认。 */
  function paintThumbs() {
    var canvases = doc.querySelectorAll('.card-thumb[data-scene]');
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      var pal = MB.PALETTES[c.getAttribute('data-scene')] || MB.PALETTES.coast;
      var ctx = c.getContext('2d');
      var w = c.width, h = c.height;

      var sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
      sky.addColorStop(0, pal.sky[0]);
      sky.addColorStop(1, pal.sky[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = pal.hill;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.55);
      ctx.lineTo(w * 0.3, h * 0.38);
      ctx.lineTo(w * 0.55, h * 0.5);
      ctx.lineTo(w * 0.8, h * 0.34);
      ctx.lineTo(w, h * 0.5);
      ctx.lineTo(w, h * 0.6);
      ctx.lineTo(0, h * 0.6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = pal.grass[0];
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      // 一条往远处收的路
      ctx.fillStyle = pal.road[0];
      ctx.beginPath();
      ctx.moveTo(w * 0.42, h * 0.55);
      ctx.lineTo(w * 0.58, h * 0.55);
      ctx.lineTo(w * 1.05, h);
      ctx.lineTo(w * -0.05, h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = pal.rumble[1];
      ctx.fillRect(w * 0.47, h * 0.7, w * 0.06, h * 0.08);
      ctx.fillRect(w * 0.46, h * 0.88, w * 0.08, h * 0.1);
    }
  }

  /* ---------------- 车库 ---------------- */

  UI.renderGarage = function () {
    var save = MB.Save;
    var owned = save.ownedBikes();
    var current = save.currentBike();
    var cash = save.cash();
    var html = '';

    for (var i = 0; i < BIKES.length; i++) {
      var b = BIKES[i];
      var have = owned.indexOf(b.id) >= 0;
      var isCurrent = current === b.id;
      var afford = cash >= b.price;

      var badge = isCurrent ? '使用中'
        : (have ? '选它' : (afford ? ('¥' + b.price) : ('差 ' + (b.price - cash))));

      html += '<button class="card' + (isCurrent ? ' is-owned' : '') +
        (!have && !afford ? ' is-locked' : '') + '"' +
        ' data-bike="' + b.id + '">' +
        '<canvas class="card-thumb" data-bike-color="' + b.color + '" width="128" height="92"></canvas>' +
        '<div class="card-body">' +
          '<div class="card-title">' + b.name + '</div>' +
          '<div class="card-desc">' + b.desc + '</div>' +
          '<div class="stat-row">' +
            statBar('极速', b.topSpeed, 1.2) +
            statBar('加速', b.accel, 1.25) +
            statBar('抗揍', b.armor, 1.5) +
          '</div>' +
        '</div>' +
        '<div class="card-badge">' + badge + '</div>' +
        '</button>';
    }

    el('bikeList').innerHTML = html;
    el('garageCash').textContent = cash;
    paintBikeThumbs();
  };

  function statBar(label, value, max) {
    var pct = Math.round(Util.clamp(value / max, 0, 1) * 100);
    return '<div class="stat">' + label + '<i><b style="width:' + pct + '%"></b></i></div>';
  }

  function paintBikeThumbs() {
    var canvases = doc.querySelectorAll('.card-thumb[data-bike-color]');
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      var ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#11141b';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.translate(c.width / 2, c.height - 8);
      ctx.scale(0.66, 0.66);
      Sprites.drawRider(ctx, {
        color: c.getAttribute('data-bike-color'), lean: 0, shadow: false
      });
      ctx.restore();
    }
  }

  /* ---------------- 比赛 HUD ---------------- */

  var hud = null;

  function hudRefs() {
    if (hud) return hud;
    hud = {
      rank: el('hudRank'), rankTotal: el('hudRankTotal'),
      time: el('hudTime'), speed: el('hudSpeed'),
      progress: el('hudProgress'), health: el('hudHealth'),
      weapon: el('hudWeapon'), weaponN: el('hudWeaponN'),
      msg: el('centerMsg')
    };
    return hud;
  }

  UI.updateHud = function (race) {
    var h = hudRefs();
    var p = race.player;

    h.rank.textContent = p.rank;
    h.rankTotal.textContent = '/' + race.riders.length;
    h.time.textContent = Util.formatTime(race.time);
    // 世界单位换成好看的数字, 纯观感, 不参与物理
    h.speed.textContent = Math.round(p.speed / 40);
    h.progress.style.width = (race.progress() * 100).toFixed(1) + '%';

    var pct = Util.clamp(p.health / CONFIG.maxHealth, 0, 1);
    h.health.style.width = (pct * 100).toFixed(0) + '%';
    h.health.classList.toggle('is-low', pct <= 0.5 && pct > 0.22);
    h.health.classList.toggle('is-crit', pct <= 0.22);

    if (p.weapon > 0) {
      h.weapon.hidden = false;
      h.weaponN.textContent = p.weapon;
    } else {
      h.weapon.hidden = true;
    }
  };

  var msgTimer = null;

  UI.centerMessage = function (text, holdMs) {
    var h = hudRefs();
    h.msg.textContent = text;
    h.msg.classList.add('is-on');
    if (msgTimer) clearTimeout(msgTimer);
    if (holdMs) {
      msgTimer = setTimeout(function () { h.msg.classList.remove('is-on'); }, holdMs);
    }
  };

  UI.hideCenterMessage = function () {
    hudRefs().msg.classList.remove('is-on');
  };

  /* ---------------- 弹层 ---------------- */

  UI.openCard = function (html) {
    el('overlayCard').innerHTML = html;
    el('overlay').classList.add('is-active');
  };

  UI.closeCard = function () {
    el('overlay').classList.remove('is-active');
  };

  UI.isCardOpen = function () {
    return el('overlay').classList.contains('is-active');
  };

  function action(name, label, cls) {
    return '<button class="btn ' + (cls || '') + '" data-action="' + name + '">' +
      label + '</button>';
  }

  UI.openHelp = function () {
    UI.openCard(
      '<h3>怎么玩</h3>' +
      '<p class="sub">跑赢他们，或者把他们全打趴下</p>' +
      '<div class="help-list">' +
        '<b>键盘</b><br>' +
        '<kbd>↑</kbd> 加速　<kbd>↓</kbd> 刹车　<kbd>←</kbd><kbd>→</kbd> 转向<br>' +
        '<kbd>Z</kbd> 左拳　<kbd>X</kbd> 右拳　<kbd>C</kbd><kbd>V</kbd> 左右飞踢<br>' +
        '<kbd>Esc</kbd> 暂停<br><br>' +
        '<b>手机</b><br>' +
        '自动给油，左下角转向，右下角刹车和拳脚。<br><br>' +
        '<b>要点</b><br>' +
        '· 只有跟对手并排时出手才打得中，空挥一样要等冷却。<br>' +
        '· 血被打空就会摔车，爬起来要好几秒，名次基本就没了。<br>' +
        '· 路边偶尔有<b>钢管</b>，捡到后几下攻击伤害翻倍。<br>' +
        '· 撞上社会车辆直接摔，冲进草地会掉速。<br>' +
        '· 拿到名次有奖金，攒钱去<b>车库</b>换车。' +
      '</div>' +
      '<div style="margin-top:16px">' + action('close', '知道了', 'btn-primary') + '</div>'
    );
  };

  UI.openPause = function () {
    UI.openCard(
      '<h3>暂停</h3>' +
      '<p class="sub">松口气，喝口水</p>' +
      action('resume', '继续比赛', 'btn-primary') +
      action('restart', '重跑本赛道') +
      action('quit', '退出到菜单', 'btn-ghost')
    );
  };

  /** 结算。名次、用时、奖金、以及全场排名表。 */
  UI.openResult = function (info) {
    var rows = '';
    for (var i = 0; i < info.standings.length; i++) {
      var r = info.standings[i];
      rows += '<div>' +
        '<span class="pos">' + (i + 1) + '</span>' +
        '<span class="dot" style="background:' + r.color + '"></span>' +
        '<span class="who' + (r.isPlayer ? ' me' : '') + '">' + r.name + '</span>' +
        '<span>' + (r.finished ? Util.formatTime(r.finishTime) : '未完赛') + '</span>' +
        '</div>';
    }

    UI.openCard(
      '<h3>' + (info.rank === 1 ? '第一个冲线' : '比赛结束') + '</h3>' +
      '<div class="result-rank">' + Util.ordinal(info.rank) + '</div>' +
      '<div class="result-rows">' +
        '<div><span>用时</span><b>' + Util.formatTime(info.time) + '</b></div>' +
        '<div><span>打趴对手</span><b>' + info.takedowns + ' 人</b></div>' +
        '<div><span>自己摔车</span><b>' + info.knockdowns + ' 次</b></div>' +
        '<div><span>奖金</span><b>+' + info.reward + '</b></div>' +
      '</div>' +
      '<div class="standings">' + rows + '</div>' +
      (info.unlocked ? '<p class="sub">解锁了新赛道：' + info.unlocked + '</p>' : '') +
      (info.nextTrack ? action('next', '下一条赛道', 'btn-primary') : '') +
      action('restart', '再跑一次', info.nextTrack ? '' : 'btn-primary') +
      action('garage', '去车库', 'btn-ghost') +
      action('quit', '回菜单', 'btn-ghost')
    );
  };

  /* ---------------- 提示条 ---------------- */

  var toastTimer = null;

  UI.toast = function (text, ms) {
    var node = el('toast');
    node.textContent = text;
    node.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove('is-on');
    }, ms || 1600);
  };

  MB.UI = UI;
})(typeof window !== 'undefined' ? window : this);
