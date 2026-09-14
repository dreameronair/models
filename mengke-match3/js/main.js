/* 启动入口: 加载素材、装配 UI 与游戏、绑定交互 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var UI = MK.UI;
  var Sound = MK.Sound;
  var Assets = MK.Assets;
  var Storage = MK.Storage;
  var LEVELS = MK.LEVELS;
  var Wechat = MK.Wechat;

  var doc = global.document;
  var game = null;

  function el(id) { return doc.getElementById(id); }

  /* ---------- 微信里禁止页面拖动/回弹, 但保留弹层与关卡列表的滚动 ---------- */
  function lockPageScroll() {
    doc.addEventListener('touchmove', function (e) {
      var node = e.target;
      while (node && node !== doc.body) {
        if (node.classList &&
            (node.classList.contains('scrollable') || node.classList.contains('card'))) {
          return;
        }
        node = node.parentNode;
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    doc.addEventListener('gesturestart', function (e) {
      if (e.cancelable) e.preventDefault();
    });
    doc.addEventListener('contextmenu', function (e) {
      if (e.cancelable) e.preventDefault();
    });
  }

  /* ---------- 音频解锁: 微信/iOS 必须由用户手势触发 ---------- */
  function setupAudioUnlock() {
    var unlocked = false;
    function unlock() {
      if (unlocked) return;
      unlocked = true;
      Sound.unlock();
      doc.removeEventListener('touchend', unlock);
      doc.removeEventListener('mousedown', unlock);
    }
    doc.addEventListener('touchend', unlock, false);
    doc.addEventListener('mousedown', unlock, false);
    Wechat.onBridgeReady(function () { Sound.unlock(); });
  }

  /* ---------- 关卡进入 ---------- */
  function startLevel(index) {
    UI.closeCard();
    UI.show('game');
    game.start(index);
  }

  function nextLevel() {
    var next = game.levelIndex + 1;
    if (next >= LEVELS.length) {
      UI.show('home');
      UI.toast('全部关卡都通关啦，太厉害了！', 2400);
      return;
    }
    startLevel(next);
  }

  function continueLevel() {
    var unlocked = Storage.get('unlocked', 0);
    startLevel(Math.min(unlocked, LEVELS.length - 1));
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    el('btnPlay').addEventListener('click', function () {
      Sound.click();
      continueLevel();
    });
    el('btnLevels').addEventListener('click', function () {
      Sound.click();
      UI.show('levels');
    });
    el('btnHowTo').addEventListener('click', function () {
      Sound.click();
      UI.openHelp();
    });
    el('btnShare').addEventListener('click', function () {
      Sound.click();
      UI.openShare();
    });

    el('btnSfx').addEventListener('click', function () {
      Sound.setSfx(!Sound.sfxOn);
      UI.updateSoundChips();
      Sound.click();
    });
    el('btnBgm').addEventListener('click', function () {
      Sound.setBgm(!Sound.bgmOn);
      UI.updateSoundChips();
    });

    var navButtons = doc.querySelectorAll('[data-nav]');
    for (var i = 0; i < navButtons.length; i++) {
      navButtons[i].addEventListener('click', function () {
        Sound.click();
        UI.show(this.getAttribute('data-nav'));
      });
    }

    el('levelGrid').addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== this && !node.getAttribute('data-level')) node = node.parentNode;
      if (!node || node === this) return;
      Sound.click();
      startLevel(parseInt(node.getAttribute('data-level'), 10));
    });

    el('btnPause').addEventListener('click', function () {
      Sound.click();
      game.pause();
      UI.openPause();
    });

    el('propHammer').addEventListener('click', function () {
      if (game.props.hammer <= 0) {
        UI.toast('魔法锤用完了～');
        return;
      }
      Sound.click();
      game.setPropMode('hammer');
      UI.toast(game.propMode ? '点一下想敲掉的萌宠' : '已取消魔法锤');
    });

    el('propShuffle').addEventListener('click', function () {
      if (game.props.shuffle <= 0) {
        UI.toast('洗牌次数用完了～');
        return;
      }
      Sound.click();
      game.useShuffle();
    });

    el('propHint').addEventListener('click', function () {
      Sound.click();
      game.showHint();
      if (!game.hint) UI.toast('现在没有可消除的组合哦');
    });

    // 弹层按钮统一走 data-action
    el('overlayCard').addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== this && !node.getAttribute('data-action')) node = node.parentNode;
      if (!node || node === this) return;

      var action = node.getAttribute('data-action');
      Sound.click();

      if (action === 'resume') {
        UI.closeCard();
        game.resume();
      } else if (action === 'restart') {
        startLevel(game.levelIndex);
      } else if (action === 'next') {
        nextLevel();
      } else if (action === 'home') {
        UI.closeCard();
        game.resume();
        UI.show('home');
      } else if (action === 'share') {
        UI.openShare();
      } else if (action === 'close') {
        UI.closeCard();
      }
    });

    var resizeTimer = null;
    function onResize() {
      if (resizeTimer) global.clearTimeout(resizeTimer);
      resizeTimer = global.setTimeout(function () {
        if (UI.current === 'game') UI.sizeBoard();
      }, 120);
    }
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    lockPageScroll();
    setupAudioUnlock();

    var fill = el('loadingFill');
    var tip = el('loadingTip');

    Assets.load(function (done, total) {
      fill.style.width = Math.round(done / total * 100) + '%';
    }).then(function () {
      if (Assets.images.background) doc.getElementById('app').classList.add('has-bg');
      if (Assets.missing.length) {
        tip.textContent = '部分素材缺失，已使用备用形象';
      }

      game = new MK.Game(el('board'));
      UI.game = game;

      game.on('hud', function (state) { UI.renderHud(state); });
      game.on('toast', function (message) { UI.toast(message); });
      game.on('propmode', function (mode) { UI.setPropMode(mode); });
      game.on('finish', function (info) {
        global.setTimeout(function () { UI.openResult(info); }, 620);
      });

      UI.renderHomePets();
      UI.updateSoundChips();
      bindEvents();
      Wechat.setupShare(Wechat.shareInfo());

      global.setTimeout(function () {
        UI.show('home');
      }, 260);

      global.__MK_GAME = game;
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
