/* 界面层: 页面切换、HUD、弹层、道具栏 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var LEVELS = MK.LEVELS;
  var CHARACTERS = MK.CHARACTERS;
  var Util = MK.Util;
  var Sound = MK.Sound;
  var Storage = MK.Storage;

  var doc = global.document;

  function el(id) { return doc.getElementById(id); }

  var UI = {
    game: null,
    current: 'loading',
    goalNodes: null,
    goalLevel: -1,
    toastTimer: null
  };

  // <img> 用的地址。当前形象是在线图时把画布转成 dataURL, 转换结果缓存起来复用。
  var srcCache = {};

  function spritePath(typeIndex) {
    var character = CHARACTERS[typeIndex];
    var local = 'assets/characters/' + character.sprite + '.png';
    var sprite = MK.Assets.spriteById(character.id);
    if (!sprite) return local;
    if (sprite.tagName === 'IMG') return sprite.src || local;

    var key = MK.Assets.skin + '-' + character.id;
    if (!srcCache[key]) {
      try {
        srcCache[key] = sprite.toDataURL('image/png');
      } catch (e) {
        return local;
      }
    }
    return srcCache[key];
  }

  UI.forgetSpriteCache = function () { srcCache = {}; };

  /* ---------------- 页面切换 ---------------- */

  UI.show = function (name) {
    var screens = doc.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('is-active', screens[i].id === 'screen-' + name);
    }
    UI.current = name;
    if (name === 'game') UI.sizeBoard();
    if (name === 'levels') UI.renderLevels();
    if (name === 'home') UI.renderHomeProgress();
  };

  UI.sizeBoard = function () {
    var wrap = el('boardWrap');
    var canvas = el('board');
    if (!wrap || !canvas) return;
    var size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
    if (size <= 0) return;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    if (UI.game) UI.game.resize();
  };

  /* ---------------- 提示条 ---------------- */

  UI.toast = function (message, duration) {
    var node = el('toast');
    node.textContent = message;
    node.classList.add('is-show');
    if (UI.toastTimer) global.clearTimeout(UI.toastTimer);
    UI.toastTimer = global.setTimeout(function () {
      node.classList.remove('is-show');
    }, duration || 1800);
  };

  /* ---------------- 弹层 ---------------- */

  UI.openCard = function (html) {
    el('overlayCard').innerHTML = html;
    el('overlay').classList.add('is-active');
  };

  UI.closeCard = function () {
    el('overlay').classList.remove('is-active');
    el('overlayCard').innerHTML = '';
  };

  UI.isCardOpen = function () {
    return el('overlay').classList.contains('is-active');
  };

  function actionButton(action, label, kind) {
    return '<button class="btn ' + (kind || '') + '" data-action="' + action + '">' + label + '</button>';
  }

  UI.openPause = function () {
    UI.openCard(
      '<h3>休息一下</h3>' +
      '<p class="card-sub">萌宠们在等你回来哦～</p>' +
      '<div class="card-actions">' +
      actionButton('resume', '继续游戏', 'btn-primary') +
      actionButton('restart', '重玩本关') +
      actionButton('home', '返回主页', 'btn-ghost') +
      '</div>'
    );
  };

  UI.openResult = function (info) {
    var def = LEVELS[info.level];
    var stars = '';
    for (var i = 0; i < 3; i++) {
      stars += i < info.stars ? '<i>★</i>' : '☆';
    }
    var isLast = info.level + 1 >= LEVELS.length;

    if (info.won) {
      UI.openCard(
        '<h3>魔法成功！</h3>' +
        '<div class="card-stars">' + stars + '</div>' +
        '<p class="card-sub">本关得分</p>' +
        '<div class="card-score">' + Util.formatNumber(info.score) + '</div>' +
        '<p class="card-sub">三星目标 ' + Util.formatNumber(Math.round(def.target * 1.5)) + '</p>' +
        '<div class="card-actions">' +
        (isLast ? '' : actionButton('next', '下一关', 'btn-primary')) +
        actionButton('restart', isLast ? '再玩一次' : '重玩本关', isLast ? 'btn-primary' : '') +
        actionButton('share', '分享给好友', 'btn-ghost') +
        actionButton('home', '返回主页', 'btn-ghost') +
        '</div>'
      );
    } else {
      UI.openCard(
        '<h3>步数用完啦</h3>' +
        '<p class="card-sub">再试一次一定可以的！</p>' +
        '<div class="card-score">' + Util.formatNumber(info.score) + '</div>' +
        '<div class="card-actions">' +
        actionButton('restart', '再试一次', 'btn-primary') +
        actionButton('home', '返回主页', 'btn-ghost') +
        '</div>'
      );
    }
  };

  UI.openHelp = function () {
    var legend = '';
    for (var i = 0; i < 3; i++) {
      legend += '<img src="' + spritePath(i) + '" alt="">';
    }
    UI.openCard(
      '<h3>玩法说明</h3>' +
      '<div class="card-help">' +
      '<div class="legend">' + legend + '<span>三只相同即可消除</span></div>' +
      '<h4>基本操作</h4>' +
      '<ul>' +
      '<li>滑动或点击相邻的两只萌宠交换位置</li>' +
      '<li>横向或纵向连成 3 只以上即可消除</li>' +
      '<li>消除后上方萌宠掉落，可能触发连锁加倍得分</li>' +
      '</ul>' +
      '<h4>魔法道具（消除时自动生成）</h4>' +
      '<ul>' +
      '<li><b>横向闪电</b>：四只横向连线生成，消除一整行</li>' +
      '<li><b>纵向闪电</b>：四只纵向连线生成，消除一整列</li>' +
      '<li><b>魔法炸弹</b>：拼出 L 形或 T 形生成，炸掉周围九格</li>' +
      '<li><b>彩虹魔杖</b>：五只连线生成，清除同种萌宠</li>' +
      '<li>两个魔法棋子互换会触发更大范围的合体技</li>' +
      '</ul>' +
      '<h4>通关条件</h4>' +
      '<ul>' +
      '<li>在限定步数内完成上方的收集目标即可通关</li>' +
      '<li>得分越高星级越高，最高三星</li>' +
      '<li>没有可消除组合时会自动洗牌</li>' +
      '</ul>' +
      '</div>' +
      '<div class="card-actions">' + actionButton('close', '知道啦', 'btn-primary') + '</div>'
    );
  };

  UI.openShare = function () {
    UI.openCard(
      '<h3>分享给好友</h3>' +
      '<p class="card-sub">点击微信右上角的「···」<br>选择「发送给朋友」或「分享到朋友圈」，<br>就能邀请好友一起来消萌宠啦！</p>' +
      '<div class="card-actions">' + actionButton('close', '好的', 'btn-primary') + '</div>'
    );
  };

  /* ---------------- 首页 ---------------- */

  UI.renderHomePets = function () {
    var html = '';
    for (var i = 0; i < CHARACTERS.length; i++) {
      html += '<img src="' + spritePath(i) + '" alt="' + MK.Assets.displayName(CHARACTERS[i]) + '">';
    }
    el('homePets').innerHTML = html;
  };

  UI.renderHomeProgress = function () {
    var progress = Storage.get('progress', {});
    var stars = 0;
    var cleared = 0;
    for (var key in progress) {
      if (Object.prototype.hasOwnProperty.call(progress, key)) {
        stars += progress[key].stars || 0;
        cleared++;
      }
    }
    el('homeProgress').textContent =
      '已通关 ' + cleared + '/' + LEVELS.length + ' 关　　收集 ★ ' + stars + '/' + LEVELS.length * 3;
  };

  UI.updateSoundChips = function () {
    el('btnSfx').classList.toggle('is-off', !Sound.sfxOn);
    el('btnBgm').classList.toggle('is-off', !Sound.bgmOn);
    el('btnSfx').textContent = Sound.sfxOn ? '音效 开' : '音效 关';
    el('btnBgm').textContent = Sound.bgmOn ? '音乐 开' : '音乐 关';
  };

  UI.updateSkinChip = function (loading) {
    var chip = el('btnSkin');
    if (!chip) return;
    chip.classList.toggle('is-busy', !!loading);
    if (loading) {
      chip.textContent = '形象 加载中';
      return;
    }
    var official = MK.Assets.skin === 'official';
    chip.classList.toggle('is-off', !official);
    chip.textContent = official ? '形象 官方' : '形象 原创';
  };

  /* ---------------- 关卡选择 ---------------- */

  UI.renderLevels = function () {
    var unlocked = Storage.get('unlocked', 0);
    var progress = Storage.get('progress', {});
    var html = '';

    for (var i = 0; i < LEVELS.length; i++) {
      var locked = i > unlocked;
      var record = progress[i] || { stars: 0, best: 0 };
      var stars = '';
      for (var s = 0; s < 3; s++) {
        stars += s < record.stars ? '<i>★</i>' : '★';
      }
      html += '<button class="level-card' + (locked ? ' is-locked' : '') + '"' +
        (locked ? ' disabled' : ' data-level="' + i + '"') + '>' +
        '<b>' + (locked ? '🔒' : i + 1) + '</b>' +
        '<small>' + (locked ? '未解锁' : LEVELS[i].moves + ' 步') + '</small>' +
        '<div class="stars">' + stars + '</div>' +
        '</button>';
    }
    el('levelGrid').innerHTML = html;
  };

  /* ---------------- 游戏内 HUD ---------------- */

  UI.buildGoals = function (state) {
    var html = '';
    for (var i = 0; i < state.collected.length; i++) {
      var goal = state.collected[i];
      html += '<div class="goal" data-goal="' + i + '">' +
        '<img src="' + spritePath(goal.type) + '" alt="">' +
        '<span>0/' + goal.need + '</span></div>';
    }
    var container = el('hudGoals');
    container.innerHTML = html;
    UI.goalNodes = container.querySelectorAll('.goal');
    UI.goalLevel = state.level;
  };

  UI.renderHud = function (state) {
    el('hudLevel').textContent = state.level + 1;
    el('hudScore').textContent = Util.formatNumber(state.score);
    el('hudMoves').textContent = state.moves;
    el('hudMoves').parentNode.classList.toggle('is-low', state.moves <= 5);

    var threeStar = state.target * 1.5;
    var ratio = Util.clamp(state.score / threeStar, 0, 1);
    el('starFill').style.width = (ratio * 100) + '%';

    var thresholds = [state.target * 0.6, state.target, threeStar];
    var nodes = doc.querySelectorAll('.star-node');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-on', state.score >= thresholds[i]);
    }

    if (UI.goalLevel !== state.level || !UI.goalNodes ||
        UI.goalNodes.length !== state.collected.length) {
      UI.buildGoals(state);
    }
    for (var g = 0; g < state.collected.length; g++) {
      var goal = state.collected[g];
      var node = UI.goalNodes[g];
      if (!node) continue;
      node.querySelector('span').textContent = goal.have + '/' + goal.need;
      node.classList.toggle('is-done', goal.have >= goal.need);
    }

    el('countHammer').textContent = state.props.hammer;
    el('countShuffle').textContent = state.props.shuffle;
    el('propHammer').classList.toggle('is-empty', state.props.hammer <= 0);
    el('propShuffle').classList.toggle('is-empty', state.props.shuffle <= 0);
  };

  UI.setPropMode = function (mode) {
    el('propHammer').classList.toggle('is-active', mode === 'hammer');
  };

  MK.UI = UI;
})(window);
