/*
 * 输入。桌面用键盘, 手机用屏幕按钮, 两边喂给 race.update 的是同一个结构。
 *
 * 手机上默认自动给油 —— 一只手要同时管方向和拳脚已经够忙了, 再按住油门
 * 基本没法玩; 想减速就按刹车。桌面则是老老实实按住上键加速。
 */
(function (global) {
  'use strict';

  var MB = global.MB;
  var doc = global.document;

  var KEYMAP = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    KeyZ: 'punchLeft', KeyQ: 'punchLeft',
    KeyX: 'punchRight', KeyE: 'punchRight',
    KeyC: 'kickLeft', KeyV: 'kickRight',
    Space: 'kickRight'
  };

  function Input(opts) {
    this.held = {};
    this.pressed = {};          // 只在按下的那一帧为真, 用于出拳这类单次动作
    this.autoThrottle = !!(opts && opts.autoThrottle);
    this.enabled = false;
    this.onPause = opts && opts.onPause;
    this.bind();
  }

  Input.prototype.bind = function () {
    var self = this;

    this.keyDown = function (e) {
      if (e.code === 'Escape' && self.onPause) { self.onPause(); return; }
      var action = KEYMAP[e.code];
      if (!action) return;
      e.preventDefault();
      if (!self.held[action]) self.pressed[action] = true;
      self.held[action] = true;
    };

    this.keyUp = function (e) {
      var action = KEYMAP[e.code];
      if (!action) return;
      e.preventDefault();
      self.held[action] = false;
    };

    // 切后台时把所有键松开, 免得回来还在一直加速
    this.blur = function () { self.held = {}; };

    doc.addEventListener('keydown', this.keyDown);
    doc.addEventListener('keyup', this.keyUp);
    global.addEventListener('blur', this.blur);
  };

  /** 把屏幕按钮接上。每个按钮用 data-act 标明动作。 */
  Input.prototype.bindTouch = function (root) {
    var self = this;
    var buttons = root.querySelectorAll('[data-act]');

    function set(action, on, e) {
      e.preventDefault();
      if (on && !self.held[action]) self.pressed[action] = true;
      self.held[action] = on;
    }

    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        var action = btn.getAttribute('data-act');
        var down = function (e) { btn.classList.add('is-down'); set(action, true, e); };
        var up = function (e) { btn.classList.remove('is-down'); set(action, false, e); };
        btn.addEventListener('touchstart', down, { passive: false });
        btn.addEventListener('touchend', up, { passive: false });
        btn.addEventListener('touchcancel', up, { passive: false });
        // 桌面上用鼠标也能点, 方便调试和没有触屏的设备
        btn.addEventListener('mousedown', down);
        btn.addEventListener('mouseup', up);
        btn.addEventListener('mouseleave', function (e) {
          if (self.held[action]) up(e);
        });
      })(buttons[i]);
    }
  };

  /**
   * 取本帧的输入。读完 pressed 会被清空, 所以一帧只能读一次。
   */
  Input.prototype.read = function () {
    var h = this.held;
    var p = this.pressed;

    var steer = 0;
    if (h.left) steer -= 1;
    if (h.right) steer += 1;

    var out = {
      throttle: this.autoThrottle ? !h.brake : !!h.throttle,
      brake: !!h.brake,
      steer: steer,
      // 攻击是单次触发, 按住不会连发
      punchLeft: !!p.punchLeft,
      punchRight: !!p.punchRight,
      kickLeft: !!p.kickLeft,
      kickRight: !!p.kickRight
    };

    this.pressed = {};
    return out;
  };

  Input.prototype.reset = function () {
    this.held = {};
    this.pressed = {};
  };

  Input.prototype.destroy = function () {
    doc.removeEventListener('keydown', this.keyDown);
    doc.removeEventListener('keyup', this.keyUp);
    global.removeEventListener('blur', this.blur);
  };

  MB.Input = Input;
  MB.KEYMAP = KEYMAP;
})(typeof window !== 'undefined' ? window : this);
