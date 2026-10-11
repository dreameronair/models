/*
 * 《华强买瓜 2026 · 赛博保熟版》scene. Every frame is a pure function of (timeline, t):
 * no clocks, no frame callbacks, no unseeded randomness. Characters are original cartoons.
 */
(function () {
  'use strict';

  const W = 1920, H = 1080, TAU = Math.PI * 2;

  const C = {
    ink: '#24161A', skin: '#F2C6A0', skinShade: '#DDA982', hair: '#1C1A1F',
    jacket: '#2A2A31', jacketHi: '#44444F', tee: '#F4F1EA', pants: '#2F3552', shoe: '#151418',
    melon: '#3E9B47', melonDark: '#1F5E2A', melonHi: '#7FD07A', flesh: '#F0475A', seed: '#2B1B12',
    metal: '#D9E0EA', metalShade: '#A9B4C4', screen: '#132036', cyan: '#7FF3FF', claw: '#E8443A', clawDark: '#B22D25',
    wood: '#C9874A', woodDark: '#8B5A2B', red: '#E8443A', cream: '#FFF4E6',
    yellow: '#FFE14D', pink: '#FF6FAE', white: '#FFFDF7',
    hq: '#FFFFFF', robot: '#9AF6FF',
  };
  const FONT = {
    body: '"Kuaile", "WenQuanYi Micro Hei", sans-serif',
    display: '"HuangYou", "Kuaile", "WenQuanYi Micro Hei", sans-serif',
  };
  const DUR = { fast: 0.18, base: 0.35, slow: 0.7, blend: 0.22 };

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, a, d) => clamp((t - a) / d);
  const frac = (x) => x - Math.floor(x);
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(u) - x, d = dx(u);
        if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
        u -= e / d;
      }
      return sy(clamp(u));
    };
  }
  const easeOut = cubicBezier(0.22, 1, 0.36, 1);
  const easeInOut = cubicBezier(0.65, 0, 0.35, 1);
  const easeIn = cubicBezier(0.55, 0, 0.75, 0.2);
  const backOut = (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const c1 = 2.2, c3 = c1 + 1, q = p - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- canvas ----------
  const canvas = document.getElementById('stage');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  function text(str, x, y, size, o = {}) {
    ctx.save();
    ctx.font = `${size}px ${o.font || FONT.body}`;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.lineJoin = 'round';
    if (o.shadow) {
      ctx.fillStyle = o.shadow;
      if (o.stroke) {
        ctx.strokeStyle = o.shadow;
        ctx.lineWidth = o.strokeW || size * 0.16;
        ctx.strokeText(str, x + size * 0.06, y + size * 0.07);
      }
      ctx.fillText(str, x + size * 0.06, y + size * 0.07);
    }
    if (o.stroke) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.strokeW || size * 0.16;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color || C.white;
    ctx.fillText(str, x, y);
    ctx.restore();
  }
  function measure(str, size, font) {
    ctx.save();
    ctx.font = `${size}px ${font || FONT.body}`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fillStroke(fill, lw = 6, stroke = C.ink) {
    ctx.fillStyle = fill;
    ctx.fill();
    if (lw) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
  function capsule(x1, y1, x2, y2, w, fill, lw = 5) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = w + lw * 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
  }
  const dir = (a) => [Math.sin(a), Math.cos(a)];

  // ---------- timeline ----------
  let TL = null, LINES = [];
  const SC = (id) => TL.scenes.find((s) => s.id === id);
  const LN = (id, i) => SC(id).lines[i];
  const lineEnd = (l) => l.end + (l.caption ? 1.0 : 0);

  function mouthOf(who, t) {
    for (const l of LINES) {
      if (l.who !== who || t < l.start || t >= l.end) continue;
      const v = l.mouth[Math.floor((t - l.start) * TL.fps)] || 0;
      return v / 9;
    }
    return 0;
  }

  /** Keyframe track: returns {prev, cur, p} for blending discrete states. */
  function track(keys, t) {
    let prev = keys[0].v, cur = keys[0].v, kt = -1e9;
    for (const k of keys) {
      if (k.t > t) break;
      prev = cur;
      cur = k.v;
      kt = k.t;
    }
    return { prev, cur, p: easeInOut(prog(t, kt, DUR.blend)) };
  }

  // ---------- melons ----------
  function melon(x, y, rx, ry, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    fillStroke(C.melon, o.lw == null ? 6 : o.lw);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = C.melonDark;
    ctx.lineWidth = Math.max(4, rx * 0.14);
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const yy = -ry + (2 * ry * i) / 16;
        const curve = Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2));
        const xx = (k / 3.4) * rx * curve + Math.sin(i * 1.3 + k) * rx * 0.05;
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
    if (o.chip) {
      ctx.strokeStyle = `rgba(127,243,255,${0.6 + 0.4 * Math.sin(o.t * 8)})`;
      ctx.lineWidth = 4;
      const R = rng(9);
      for (let i = 0; i < 9; i++) {
        let px = (R() - 0.5) * rx * 1.6, py = (R() - 0.5) * ry * 1.6;
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let s = 0; s < 3; s++) {
          if (s % 2) py += (R() - 0.5) * ry; else px += (R() - 0.5) * rx;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = C.cyan;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.35, -ry * 0.45, rx * 0.3, ry * 0.16, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (o.face) melonFace(rx, o.t, o.face, o.seed || 0);
    ctx.restore();
  }

  function melonFace(r, t, mood, seed) {
    const blinkPh = frac((t + seed * 0.71) / (2.6 + (seed % 5) * 0.3));
    const open = blinkPh < 0.05 ? 0.15 : 1;
    ctx.fillStyle = C.ink;
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.08);
    if (mood === 'faint') {
      for (const sx of [-1, 1]) {
        const ex = sx * r * 0.32, ey = -r * 0.05, s = r * 0.12;
        ctx.beginPath();
        ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s);
        ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, r * 0.32, r * 0.1, 0, TAU);
      ctx.stroke();
      return;
    }
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * r * 0.32, -r * 0.05);
      ctx.scale(1, open);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.1, r * 0.13, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,120,150,0.5)';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.55, r * 0.18, r * 0.12, r * 0.07, 0, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    if (mood === 'cheer') {
      ctx.fillStyle = C.ink;
      ctx.ellipse(0, r * 0.28, r * 0.14, r * 0.12, 0, 0, Math.PI);
      ctx.fill();
    } else {
      ctx.arc(0, r * 0.18, r * 0.14, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }
  }

  function longMelon(cx, cy, len, h, t) {
    const x0 = cx - len / 2;
    ctx.save();
    roundRect(x0, cy - h / 2, len, h, h / 2);
    fillStroke(C.melon, 7);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = C.melonDark;
    ctx.lineWidth = 14;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const yy = cy - h / 2 + (k + 0.5) * (h / 4);
      for (let x = x0; x <= x0 + len; x += 40) {
        const y = yy + Math.sin(x * 0.02 + k) * 6;
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x0, cy - h * 0.38, len, h * 0.1);
    ctx.restore();
    ctx.restore();
  }

  // ---------- characters ----------
  const HQ_POSES = {
    idle: { la: [-0.16, 0.12], ra: [0.16, -0.12], ll: [-0.05, 0], rl: [0.05, 0], lean: 0 },
    point: { la: [-0.16, 0.12], ra: [1.55, 0.05], ll: [-0.05, 0], rl: [0.1, 0], lean: 0.04 },
    shrug: { la: [-0.95, -1.5], ra: [0.95, 1.5], ll: [-0.1, 0], rl: [0.1, 0], lean: 0 },
    hips: { la: [-0.75, 1.95], ra: [0.75, -1.95], ll: [-0.12, 0], rl: [0.12, 0], lean: 0.07 },
    shocked: { la: [-2.55, -0.35], ra: [2.55, 0.35], ll: [-0.15, 0], rl: [0.15, 0], lean: -0.06 },
    kick: { la: [-1.3, -0.5], ra: [1.0, 0.7], ll: [-0.25, 0.15], rl: [1.45, -0.35], lean: -0.14 },
    mic: { la: [-2.35, -0.5], ra: [0.45, 2.35], ll: [-0.1, 0], rl: [0.1, 0], lean: 0 },
    ride: { la: [1.05, 0.35], ra: [1.25, 0.2], ll: [1.15, -1.25], rl: [1.3, -1.35], lean: 0.05 },
    wave: { la: [1.05, 0.35], ra: [2.5, 0.4], ll: [1.15, -1.25], rl: [1.3, -1.35], lean: 0.05 },
  };

  function blendPose(a, b, p) {
    const out = {};
    for (const k of Object.keys(a)) {
      out[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], p)) : lerp(a[k], b[k], p);
    }
    return out;
  }

  /** 华强: original chibi character. (x, footY) is the ground point; sitting lowers the hip. */
  function drawHQ(x, footY, pose, o) {
    const sit = o.sit || 0;
    const bob = o.bob || 0;
    const hipY = footY - 170 + sit * 70 + bob;
    const leg = (side, ang) => {
      const hx = x + side * 30, hy = hipY;
      const d1 = dir(ang[0]), d2 = dir(ang[0] + ang[1]);
      const kx = hx + d1[0] * 88, ky = hy + d1[1] * 88;
      const fx = kx + d2[0] * 86, fy = ky + d2[1] * 86;
      capsule(hx, hy, kx, ky, 44, C.pants);
      capsule(kx, ky, fx, fy, 40, C.pants);
      ctx.beginPath();
      ctx.ellipse(fx + 16, fy + 6, 34, 16, 0, 0, TAU);
      fillStroke(C.shoe, 5);
    };
    leg(-1, pose.ll);
    leg(1, pose.rl);

    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(pose.lean);
    const shY = -200, arm = (side, ang) => {
      const sx = side * 74, sy = shY + 18;
      const d1 = dir(ang[0]), d2 = dir(ang[0] + ang[1]);
      const ex = sx + d1[0] * 84, ey = sy + d1[1] * 84;
      const hx = ex + d2[0] * 80, hy = ey + d2[1] * 80;
      capsule(sx, sy, ex, ey, 40, C.jacket);
      capsule(ex, ey, hx, hy, 36, C.jacket);
      ctx.beginPath();
      ctx.arc(hx + d2[0] * 8, hy + d2[1] * 8, 19, 0, TAU);
      fillStroke(C.skin, 5);
      return [hx, hy];
    };
    const back = arm(-1, pose.la);
    // torso
    ctx.beginPath();
    ctx.moveTo(-82, shY);
    ctx.quadraticCurveTo(0, shY - 18, 82, shY);
    ctx.lineTo(70, 10);
    ctx.quadraticCurveTo(0, 22, -70, 10);
    ctx.closePath();
    fillStroke(C.jacket, 6);
    ctx.beginPath();
    ctx.moveTo(-26, shY - 6);
    ctx.lineTo(0, shY + 70);
    ctx.lineTo(26, shY - 6);
    ctx.closePath();
    fillStroke(C.tee, 4);
    ctx.strokeStyle = C.jacketHi;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-28, shY + 10); ctx.lineTo(-58, shY + 90);
    ctx.moveTo(28, shY + 10); ctx.lineTo(58, shY + 90);
    ctx.moveTo(4, shY + 76); ctx.lineTo(4, 10);
    ctx.stroke();
    ctx.restore();

    // head (drawn upright relative to lean)
    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(pose.lean);
    ctx.translate(0, shY - 92);
    drawHQHead(o);
    ctx.restore();

    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(pose.lean);
    const front = arm(1, pose.ra);
    if (o.mic) {
      ctx.save();
      ctx.translate(front[0], front[1]);
      ctx.rotate(-0.5);
      roundRect(-9, -60, 18, 60, 8);
      fillStroke('#3A3A44', 4);
      ctx.beginPath();
      ctx.arc(0, -66, 18, 0, TAU);
      fillStroke('#9AA3B5', 4);
      ctx.restore();
    }
    ctx.restore();
    return { back, front };
  }

  function drawHQHead(o) {
    const r = 92;
    ctx.beginPath();
    ctx.ellipse(-r * 0.98, 8, 16, 22, 0, 0, TAU);
    ctx.ellipse(r * 0.98, 8, 16, 22, 0, 0, TAU);
    fillStroke(C.skin, 5);
    ctx.beginPath();
    ctx.moveTo(-r, -20);
    ctx.quadraticCurveTo(-r, r * 0.95, 0, r * 1.02);
    ctx.quadraticCurveTo(r, r * 0.95, r, -20);
    ctx.quadraticCurveTo(r, -r * 0.9, 0, -r * 0.92);
    ctx.quadraticCurveTo(-r, -r * 0.9, -r, -20);
    fillStroke(C.skin, 6);
    // flat-top hair with a side part
    ctx.beginPath();
    ctx.moveTo(-r * 1.02, -6);
    ctx.lineTo(-r * 1.02, -r * 0.62);
    ctx.quadraticCurveTo(-r * 0.95, -r * 1.12, -r * 0.2, -r * 1.12);
    ctx.lineTo(r * 0.85, -r * 1.1);
    ctx.quadraticCurveTo(r * 1.08, -r * 1.02, r * 1.03, -r * 0.5);
    ctx.lineTo(r * 1.0, -8);
    ctx.lineTo(r * 0.86, -8);
    ctx.lineTo(r * 0.8, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.42, -r * 0.35, -r * 0.62);
    ctx.lineTo(-r * 0.8, -r * 0.45);
    ctx.lineTo(-r * 0.86, -6);
    ctx.closePath();
    fillStroke(C.hair, 6);
    ctx.strokeStyle = '#3A3740';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 1.08);
    ctx.lineTo(-r * 0.45, -r * 0.66);
    ctx.stroke();

    const expr = o.expr || 'normal';
    const look = o.look == null ? 0.5 : o.look;
    const ey = 4, ex = 34;
    // brows: thick and serious
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = 11;
    const browLift = expr === 'wide' ? -14 : expr === 'narrow' ? 6 : 0;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * (ex - 20), ey - 30 + browLift + (expr === 'narrow' ? 4 : 0));
      ctx.lineTo(s * (ex + 22), ey - 36 + browLift - (expr === 'wide' ? 4 : 0));
      ctx.stroke();
    }
    for (const s of [-1, 1]) {
      const cx = s * ex;
      if (expr === 'happy') {
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(cx, ey + 6, 13, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        continue;
      }
      const ry = expr === 'wide' ? 22 : expr === 'narrow' ? 7 : 15;
      const rx = expr === 'wide' ? 19 : 15;
      ctx.beginPath();
      ctx.ellipse(cx, ey, rx, ry, 0, 0, TAU);
      fillStroke('#FFFFFF', 4);
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(cx + look * 6, ey + 1, expr === 'wide' ? 6 : 8, 0, TAU);
      ctx.fill();
    }
    // nose
    ctx.strokeStyle = C.skinShade;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(4, ey + 14);
    ctx.quadraticCurveTo(12, ey + 32, 2, ey + 36);
    ctx.stroke();
    // mouth: lip-synced
    const m = o.mouth || 0;
    const my = 62;
    if (m > 0.08) {
      ctx.beginPath();
      ctx.ellipse(2, my, 16 + m * 6, 4 + m * 18, 0, 0, TAU);
      fillStroke('#5A1E22', 4);
      ctx.fillStyle = '#FF8C95';
      ctx.beginPath();
      ctx.ellipse(2, my + m * 10, 9, 3 + m * 5, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      if (expr === 'happy') ctx.arc(2, my - 10, 18, 0.2 * Math.PI, 0.8 * Math.PI);
      else if (expr === 'wide') ctx.ellipse(2, my, 10, 12, 0, 0, TAU);
      else { ctx.moveTo(-16, my); ctx.lineTo(18, my - 2); }
      ctx.stroke();
    }
  }

  function scooter(x, footY, t, moving) {
    const wy = footY - 34;
    ctx.save();
    for (const wx of [x - 120, x + 120]) {
      ctx.beginPath();
      ctx.arc(wx, wy, 36, 0, TAU);
      fillStroke('#2B2B33', 6);
      ctx.beginPath();
      ctx.arc(wx, wy, 14, 0, TAU);
      fillStroke('#B8C0CC', 4);
      if (moving) {
        ctx.strokeStyle = '#B8C0CC';
        ctx.lineWidth = 3;
        const a = t * 18;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(a) * 26, wy + Math.sin(a) * 26);
        ctx.lineTo(wx - Math.cos(a) * 26, wy - Math.sin(a) * 26);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.moveTo(x - 150, wy - 30);
    ctx.lineTo(x + 70, wy - 30);
    ctx.lineTo(x + 130, wy - 4);
    ctx.lineTo(x + 90, wy + 8);
    ctx.lineTo(x - 160, wy + 2);
    ctx.closePath();
    fillStroke('#4FC3A1', 6);
    ctx.beginPath();
    ctx.moveTo(x - 110, wy - 30);
    ctx.lineTo(x - 70, wy - 70);
    ctx.lineTo(x + 30, wy - 70);
    ctx.lineTo(x + 50, wy - 30);
    ctx.closePath();
    fillStroke('#3BA587', 5);
    capsule(x + 110, wy - 10, x + 140, wy - 210, 14, '#5A5F6E', 4);
    capsule(x + 110, wy - 210, x + 175, wy - 214, 14, '#2B2B33', 4);
    ctx.beginPath();
    ctx.arc(x + 160, wy - 150, 18, 0, TAU);
    fillStroke('#FFF3B0', 4);
    ctx.restore();
  }

  // Robot vendor.
  const RB_POSES = {
    rest: { la: [-0.35, 0.55], ra: [0.35, -0.55] },
    snap: { la: [-2.4, -0.45], ra: [2.4, 0.45] },
    present: { la: [-0.35, 0.55], ra: [2.25, 0.55] },
    angry: { la: [-2.65, -0.25], ra: [2.65, 0.25] },
    chop: { la: [-0.35, 0.55], ra: [2.6, 0.2] },
    wave: { la: [-0.35, 0.55], ra: [2.55, 0.35] },
    reach: { la: [-0.35, 0.55], ra: [1.2, 0.3] },
  };

  function claw(x, y, ang, open, size = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-ang);
    ctx.scale(size, size);
    const o = 0.18 + open * 0.45;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.rotate(s * o);
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(s * 38, 26, s * 6, 62);
      ctx.quadraticCurveTo(s * 2, 30, -6 * s, 6);
      ctx.closePath();
      fillStroke(C.claw, 5);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(0, -2, 20, 16, 0, 0, TAU);
    fillStroke(C.clawDark, 5);
    ctx.restore();
  }

  function robotFace(w, h, expr, mouth, t) {
    ctx.save();
    roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 18);
    ctx.fillStyle = expr === 'angry' ? '#3A0F18' : C.screen;
    ctx.fill();
    ctx.clip();
    const col = expr === 'angry' ? '#FF5A5A' : expr === 'heart' ? C.pink : C.cyan;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    const ey = -h * 0.12, ex = w * 0.2;
    for (const s of [-1, 1]) {
      const cx = s * ex;
      ctx.save();
      ctx.translate(cx, ey);
      if (expr === 'happy' || expr === 'proud') {
        ctx.beginPath();
        ctx.arc(0, 8, 16, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else if (expr === 'angry') {
        ctx.beginPath();
        ctx.moveTo(-18, -14 * s * -1 - 4);
        ctx.lineTo(18, 14 * s * -1 - 4);
        ctx.stroke();
        ctx.fillRect(-8, 2, 16, 14);
      } else if (expr === 'swirl') {
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let a = 0; a < TAU * 2.2; a += 0.2) {
          const rr = 2 + a * 2.6;
          const aa = a + t * 9 * s;
          a === 0 ? ctx.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr) : ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        ctx.stroke();
      } else if (expr === 'chip') {
        ctx.lineWidth = 4;
        ctx.strokeRect(-14, -14, 28, 28);
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo(k * 8, -14); ctx.lineTo(k * 8, -22);
          ctx.moveTo(k * 8, 14); ctx.lineTo(k * 8, 22);
          ctx.moveTo(-14, k * 8); ctx.lineTo(-22, k * 8);
          ctx.moveTo(14, k * 8); ctx.lineTo(22, k * 8);
          ctx.stroke();
        }
      } else if (expr === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? 8 : 20, a = (i / 10) * TAU - Math.PI / 2 + t * 2;
          i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      } else if (expr === 'heart') {
        const s2 = 1 + 0.12 * Math.sin(t * 10);
        ctx.scale(s2, s2);
        ctx.beginPath();
        ctx.moveTo(0, 14);
        ctx.bezierCurveTo(-26, -4, -12, -24, 0, -10);
        ctx.bezierCurveTo(12, -24, 26, -4, 0, 14);
        ctx.fill();
      } else {
        const blink = frac(t / 3.3) < 0.04 ? 0.15 : 1;
        ctx.scale(1, blink);
        roundRect(-10, -16, 20, 32, 9);
        ctx.fill();
      }
      ctx.restore();
    }
    const mh = 6 + mouth * 34;
    roundRect(-w * 0.16, h * 0.18 - mh / 2, w * 0.32, mh, Math.min(10, mh / 2));
    ctx.fill();
    ctx.fillStyle = 'rgba(127,243,255,0.06)';
    for (let y = -h / 2; y < h / 2; y += 6) ctx.fillRect(-w / 2, y, w, 2);
    ctx.restore();
  }

  /** Robot: (x, baseY) is the bottom of the torso; legs are drawn below when visible. */
  function drawRobot(x, baseY, pose, o) {
    const t = o.t;
    const bw = 190, bh = 175;
    const top = baseY - bh;
    if (o.legs) {
      for (const s of [-1, 1]) {
        const step = o.step ? o.step * s : 0;
        capsule(x + s * 45, baseY, x + s * 45 + step * 20, baseY + 70 - Math.abs(step) * 10, 26, C.metalShade);
        ctx.beginPath();
        ctx.ellipse(x + s * 45 + step * 20 + s * 8, baseY + 78 - Math.abs(step) * 10, 34, 14, 0, 0, TAU);
        fillStroke('#5A6375', 5);
      }
    }
    const arm = (side, ang) => {
      const sx = x + side * (bw / 2 + 4), sy = top + 32;
      const d1 = dir(ang[0]), d2 = dir(ang[0] + ang[1]);
      const ex = sx + d1[0] * 70, ey = sy + d1[1] * 70;
      const hx = ex + d2[0] * 66, hy = ey + d2[1] * 66;
      capsule(sx, sy, ex, ey, 22, C.metalShade);
      capsule(ex, ey, hx, hy, 20, C.metalShade);
      claw(hx, hy, ang[0] + ang[1], o.open == null ? 0.3 : o.open);
      return [hx + d2[0] * 50, hy + d2[1] * 50, ang[0] + ang[1]];
    };
    const back = arm(-1, pose.la);
    roundRect(x - bw / 2, top, bw, bh + 40, 30);
    fillStroke(C.metal, 7);
    roundRect(x - 60, top + 40, 120, 70, 14);
    fillStroke('#EAF0F7', 4);
    text('瓜Agent', x, top + 76, 28, { color: '#2B6CB0' });
    ctx.fillStyle = C.metalShade;
    ctx.fillRect(x - 22, top - 26, 44, 30);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 5;
    ctx.strokeRect(x - 22, top - 26, 44, 30);
    const hw = 200, hh = 150, hy = top - 26 - hh / 2 + 4;
    ctx.save();
    ctx.translate(x, hy);
    if (o.tilt) ctx.rotate(o.tilt);
    capsule(0, -hh / 2, 0, -hh / 2 - 46, 8, C.metalShade, 4);
    ctx.beginPath();
    ctx.arc(0, -hh / 2 - 54, 13, 0, TAU);
    fillStroke(frac(t * 1.2) < 0.5 ? '#FF5A5A' : '#FFB3B3', 4);
    roundRect(-hw / 2, -hh / 2, hw, hh, 28);
    fillStroke(C.metal, 7);
    robotFace(hw, hh, o.expr, o.mouth || 0, t);
    ctx.restore();
    const front = arm(1, pose.ra);
    return { back, front };
  }

  // ---------- sets ----------
  const CITY = (() => {
    const R = rng(3), out = [];
    let x = -400;
    while (x < W + 400) {
      const w = 110 + R() * 140, h = 180 + R() * 300;
      const wins = [];
      for (let yy = 30; yy < h - 30; yy += 38) for (let xx = 18; xx < w - 24; xx += 32) if (R() < 0.45) wins.push([xx, yy, R()]);
      out.push({ x, w, h, wins, hue: R() });
      x += w + 6;
    }
    return out;
  })();

  function drawSky(t, night) {
    const g = ctx.createLinearGradient(0, 0, 0, 700);
    g.addColorStop(0, night ? '#1B1340' : '#4A2E7A');
    g.addColorStop(0.55, night ? '#3A2160' : '#C2618A');
    g.addColorStop(1, night ? '#6B3A6A' : '#FFB070');
    ctx.fillStyle = g;
    ctx.fillRect(-600, -600, W + 1200, 1400);
    ctx.fillStyle = night ? 'rgba(255,240,200,0.85)' : 'rgba(255,236,190,0.9)';
    ctx.beginPath();
    ctx.arc(300, 220, night ? 50 : 70, 0, TAU);
    ctx.fill();
    for (const b of CITY) {
      const y = 700 - b.h;
      ctx.fillStyle = b.hue < 0.5 ? '#2E2150' : '#3A2A5E';
      ctx.fillRect(b.x, y, b.w, b.h + 20);
      for (const [wx, wy, r] of b.wins) {
        const on = night ? r < 0.85 : r < 0.5;
        if (!on) continue;
        ctx.fillStyle = r < 0.2 ? 'rgba(127,243,255,0.8)' : 'rgba(255,214,120,0.8)';
        ctx.fillRect(b.x + wx, y + wy, 16, 20);
      }
    }
    const blink = frac(t * 0.8) < 0.85 ? 1 : 0.3;
    text('瓜', 210, 470, 90, { font: FONT.display, color: '#FF6FAE', alpha: blink, stroke: 'rgba(255,111,174,0.35)', strokeW: 22 });
    text('AI', 1780, 420, 80, { font: FONT.display, color: C.cyan, alpha: 0.6 + 0.4 * Math.sin(t * 3), stroke: 'rgba(127,243,255,0.3)', strokeW: 20 });
  }

  function drawGround() {
    ctx.fillStyle = '#3E3550';
    ctx.fillRect(-600, 700, W + 1200, 200);
    ctx.fillStyle = '#8C7C8F';
    ctx.fillRect(-600, 880, W + 1200, 800);
    ctx.fillStyle = '#A2929F';
    for (let x = -600; x < W + 600; x += 160) ctx.fillRect(x, 880, 150, 8);
  }

  const STALL = { x0: 960, x1: 1760, top: 640, scaleX: 1110 };
  const PILE = [[1560, 590], [1660, 595], [1610, 540], [1470, 600], [1705, 545]];

  function drawStallBack(t, o) {
    capsule(STALL.x0 + 20, 300, STALL.x0 + 20, 880, 22, C.woodDark);
    capsule(STALL.x1 - 20, 300, STALL.x1 - 20, 880, 22, C.woodDark);
    // sign
    roundRect(1060, 120, 620, 120, 20);
    fillStroke('#2B2340', 7);
    text('AI无人瓜摊', 1370, 168, 70, { font: FONT.display, color: C.cyan, stroke: 'rgba(127,243,255,0.25)', strokeW: 18 });
    text('龙虾智能体托管 · 保熟', 1370, 218, 30, { color: C.pink });
    // awning
    const ax0 = STALL.x0 - 30, ax1 = STALL.x1 + 30, ay = 250, ah = 110;
    const n = 9, sw = (ax1 - ax0) / n;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(ax0 + i * sw, ay);
      ctx.lineTo(ax0 + (i + 1) * sw, ay);
      ctx.lineTo(ax0 + (i + 1) * sw, ay + ah);
      ctx.quadraticCurveTo(ax0 + (i + 0.5) * sw, ay + ah + 34, ax0 + i * sw, ay + ah);
      ctx.closePath();
      fillStroke(i % 2 ? C.cream : C.red, 5);
    }
    if (o.disco) {
      capsule(1360, 360, 1360, 420, 4, '#888', 2);
      ctx.save();
      ctx.translate(1360, 455);
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, TAU);
      fillStroke('#C9D2E0', 5);
      ctx.clip();
      for (let i = 0; i < 40; i++) {
        const a = (i * 2.4 + t * 2) % TAU;
        ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.8)' : 'rgba(127,243,255,0.9)';
        ctx.fillRect(Math.cos(a) * 30 - 5, ((i * 13) % 80) - 40, 10, 8);
      }
      ctx.restore();
    }
  }

  function drawCounter(t, o) {
    ctx.beginPath();
    ctx.rect(STALL.x0, STALL.top, STALL.x1 - STALL.x0, 240);
    fillStroke(C.wood, 7);
    ctx.strokeStyle = C.woodDark;
    ctx.lineWidth = 4;
    for (let y = STALL.top + 60; y < STALL.top + 240; y += 60) {
      ctx.beginPath();
      ctx.moveTo(STALL.x0 + 8, y);
      ctx.lineTo(STALL.x1 - 8, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(STALL.x0 - 20, STALL.top - 16, STALL.x1 - STALL.x0 + 40, 22);
    fillStroke('#E0A56A', 6);
    // price card
    ctx.save();
    ctx.translate(1240, 770);
    ctx.rotate(-0.04);
    roundRect(-120, -70, 240, 140, 14);
    fillStroke(C.white, 6);
    text('2元/斤', 0, -24, 56, { font: FONT.display, color: C.red });
    const tok = o.tokens || 0;
    text(tok > 0 ? `+词元 ${tok.toLocaleString('en-US')}` : '词元另算', 0, 36, 30, { color: '#2B6CB0' });
    ctx.restore();
    // scale
    const sx = STALL.scaleX;
    roundRect(sx - 90, STALL.top - 70, 180, 60, 12);
    fillStroke('#B9C2CF', 6);
    ctx.beginPath();
    ctx.ellipse(sx, STALL.top - 76, 100, 14, 0, 0, TAU);
    fillStroke('#DDE3EA', 5);
    roundRect(sx - 64, STALL.top - 60, 128, 40, 8);
    const beauty = o.beauty || 0;
    ctx.fillStyle = beauty > 0 ? '#3A0F2E' : '#0E2A1E';
    ctx.fill();
    text(o.scaleText || '0.00', sx, STALL.top - 40, 30, { font: FONT.display, color: beauty > 0 ? C.pink : '#7CFFB2' });
    // pile
    PILE.forEach(([px, py], i) => {
      if (o.hidePile && o.hidePile(i)) return;
      melon(px, py, 66, 54, { rot: (i - 2) * 0.1 });
    });
    const half = o.half;
    if (half) {
      ctx.save();
      ctx.translate(1480, STALL.top - 22);
      ctx.beginPath();
      ctx.ellipse(0, 0, 60, 26, 0, Math.PI, TAU);
      fillStroke(C.melon, 5);
      ctx.beginPath();
      ctx.ellipse(0, -4, 52, 20, 0, 0, TAU);
      fillStroke(C.flesh, 4);
      ctx.restore();
    }
  }

  // ---------- director: stall world state at time t ----------
  let DIR = null;

  function buildDirector() {
    const s = (id) => SC(id), l = LN;
    const k = (t, v) => ({ t, v });
    const hqPose = [k(-1, 'ride'), k(s('arrive').start + 1.9, 'idle'), k(l('arrive', 0).start, 'point'), k(l('arrive', 0).end + 0.3, 'idle'),
      k(l('price', 0).start + 0.1, 'shrug'), k(l('price', 0).end + 0.3, 'idle'),
      k(l('ripe', 0).start, 'hips'), k(l('ripe', 2).start, 'point'), k(l('ripe', 3).start + 0.3, 'shrug'), k(l('ripe', 3).end + 1.0, 'idle'),
      k(l('scale', 0).start, 'point'), k(l('scale', 0).end + 0.3, 'idle'), k(l('scale', 2).start, 'point'), k(l('scale', 3).start + 0.6, 'shocked'), k(l('scale', 3).end + 0.8, 'idle'),
      k(l('cut', 0).start + 0.2, 'hips'), k(l('cut', 1).start, 'shrug'), k(l('cut', 1).end + 0.3, 'idle'), k(l('cut', 3).start - 0.1, 'shocked'),
      k(s('dance').start + 0.3, 'dance'), k(l('dance', 1).start, 'kick'), k(l('dance', 1).end + 0.5, 'dance'),
      k(s('outro').start, 'idle'), k(l('outro', 1).start - 0.7, 'ride'), k(l('outro', 1).end + 0.2, 'wave')];
    const hqExpr = [k(-1, 'normal'), k(l('ripe', 0).start, 'narrow'), k(l('ripe', 3).start + 0.3, 'wide'), k(l('ripe', 3).end + 1.0, 'normal'),
      k(l('scale', 2).start, 'narrow'), k(l('scale', 3).start + 0.6, 'wide'), k(l('scale', 3).end + 0.8, 'normal'),
      k(l('cut', 0).start, 'narrow'), k(l('cut', 3).start - 0.1, 'wide'), k(s('dance').start + 0.3, 'happy'), k(l('dance', 1).start, 'normal'), k(l('dance', 1).end + 0.5, 'happy'),
      k(s('outro').start, 'normal'), k(l('outro', 1).start, 'happy')];
    const rbPose = [k(-1, 'rest'), k(atPhrase(l('arrive', 1), '龙虾') - 0.2, 'snap'), k(l('arrive', 1).end + 0.2, 'rest'),
      k(l('price', 1).start, 'present'), k(l('price', 1).end + 1.2, 'rest'),
      k(l('ripe', 1).start, 'present'), k(l('ripe', 1).end + 0.2, 'rest'), k(l('ripe', 3).start, 'snap'), k(l('ripe', 3).end + 0.8, 'rest'),
      k(l('scale', 1).start - 0.4, 'reach'), k(l('scale', 1).end + 0.2, 'rest'), k(l('scale', 3).start, 'present'), k(l('scale', 3).end + 0.6, 'rest'),
      k(l('cut', 0).start, 'angry'), k(l('cut', 0).end + 0.3, 'rest'), k(l('cut', 2).start, 'chop'), k(l('cut', 4).end + 0.6, 'rest'),
      k(s('outro').start, 'rest'), k(l('outro', 0).start, 'wave')];
    const rbExpr = [k(-1, 'normal'), k(l('arrive', 1).start, 'happy'), k(l('arrive', 1).end + 0.5, 'normal'),
      k(l('price', 1).start, 'chip'), k(l('price', 1).end + 1.2, 'normal'),
      k(l('ripe', 1).start, 'proud'), k(l('ripe', 1).end + 0.3, 'normal'), k(l('ripe', 3).start, 'swirl'), k(l('ripe', 3).end + 1.0, 'normal'),
      k(l('scale', 1).start, 'happy'), k(l('scale', 2).start, 'normal'), k(l('scale', 3).start, 'star'), k(l('scale', 3).end + 1.0, 'normal'),
      k(l('cut', 0).start, 'angry'), k(l('cut', 1).end, 'normal'), k(l('cut', 4).start, 'proud'),
      k(s('dance').start, 'happy'), k(s('outro').start, 'happy'), k(atPhrase(l('outro', 0), '爱你'), 'heart')];
    const cutStart = l('cut', 2).end - 0.1, chopsEnd = l('cut', 4).end;
    const chops = [];
    for (let c = cutStart; c < chopsEnd; c += 0.42) chops.push(c);
    DIR = { hqPose, hqExpr, rbPose, rbExpr, chops };
  }

  function atPhrase(line, phrase) {
    const i = line.text.indexOf(phrase);
    if (i < 0) return line.start;
    return lerp(line.start, line.end, [...line.text.slice(0, i)].length / [...line.text].length);
  }

  function cameraAt(t) {
    // Base framing per speaker, plus punch-in on caption lines.
    let target = { z: 1, x: 960, y: 540 };
    let from = target, since = -1e9;
    for (const sc of TL.scenes) {
      if (!['arrive', 'price', 'ripe', 'scale', 'cut', 'outro'].includes(sc.id)) continue;
      for (const ln of sc.lines) {
        const tgt = ln.who === 'huaqiang' ? { z: 1.1, x: 760, y: 560 } : { z: 1.1, x: 1280, y: 500 };
        if (ln.caption) Object.assign(tgt, { z: 1.24 });
        if (sc.id === 'cut' && ln === sc.lines[4]) Object.assign(tgt, { z: 0.92, x: 960, y: 560 });
        if (t >= ln.start - 0.15) { from = target; target = tgt; since = ln.start - 0.15; }
      }
    }
    const p = easeInOut(prog(t, since, 0.5));
    return { z: lerp(from.z, target.z, p), x: lerp(from.x, target.x, p), y: lerp(from.y, target.y, p) };
  }

  function drawStallWorld(t) {
    const S = (id) => SC(id), l = LN;
    const night = t > S('outro').start ? easeInOut(prog(t, S('outro').start, 1.5)) : 0;
    const dance = S('dance');
    const inDance = t >= dance.start - 0.3 && t < dance.end + 0.3;
    const discoAmt = inDance ? Math.min(prog(t, dance.start - 0.3, 0.5), 1 - prog(t, dance.end - 0.2, 0.4)) : 0;

    const cam = cameraAt(t);
    let shake = 0;
    const angry = l('cut', 0);
    if (t > angry.start && t < angry.end) shake = 7;
    for (const c of DIR.chops) if (t > c && t < c + 0.15) shake = 10 * (1 - (t - c) / 0.15);
    ctx.save();
    ctx.translate(W / 2 + Math.sin(t * 71) * shake, H / 2 + Math.cos(t * 53) * shake);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    drawSky(t, night > 0.5 || discoAmt > 0.5);
    drawGround();
    drawStallBack(t, { disco: discoAmt > 0.01 });
    if (discoAmt > 0) discoBack(t, discoAmt);

    // robot placement: behind counter, hops to the front for the dance
    const hop = prog(t, dance.start + 0.1, 0.7) * (1 - prog(t, dance.end - 0.1, 0.6));
    const hopE = easeInOut(hop);
    const rbX = lerp(1370, 1180, hopE);
    const rbBase = lerp(720, 822, hopE) - Math.sin(hop * Math.PI) * 160 * (hop > 0 && hop < 1 ? 1 : 0);
    const robotFront = hop > 0.5;
    const beat = 60 / 124;
    const danceT = t - dance.start;
    const step = inDance && hop >= 1 ? Math.sign(Math.sin((danceT / beat) * Math.PI)) * easeOut(Math.abs(Math.sin((danceT / beat) * Math.PI))) : 0;

    const rp = track(DIR.rbPose, t);
    let rpose = blendPose(RB_POSES[rp.prev], RB_POSES[rp.cur], rp.p);
    let open = 0.3;
    if (rp.cur === 'snap') open = 0.5 + 0.5 * Math.sin(t * 22);
    if (rp.cur === 'angry') rpose = blendPose(rpose, { la: [-2.65 + Math.sin(t * 30) * 0.15, -0.25], ra: [2.65 - Math.sin(t * 30) * 0.15, 0.25] }, 1);
    let chopPhase = 0;
    for (const c of DIR.chops) if (t >= c - 0.2 && t < c + 0.22) chopPhase = t < c ? easeIn(prog(t, c - 0.2, 0.2)) : 1 - prog(t, c, 0.22);
    if (rp.cur === 'chop') rpose = { la: rpose.la, ra: [lerp(2.6, 1.15, chopPhase), lerp(0.2, 0.15, chopPhase)] };
    if (inDance && hop >= 1) rpose = { la: [-0.9 - step * 0.6, -0.8], ra: [0.9 - step * 0.6, 0.8] };
    if (rp.cur === 'wave') rpose = { la: rpose.la, ra: [2.55, 0.35 + Math.sin(t * 9) * 0.35] };

    // scale & pile state
    const pick = l('scale', 1);
    const pickP = easeInOut(prog(t, pick.start - 0.4, 0.9));
    const onScale = t >= pick.start + 0.5;
    const scaleLine = l('scale', 3);
    const beauty = t >= scaleLine.start + 0.3 ? 1 : 0;
    const doubt = l('scale', 2);
    let scaleText = onScale ? '15.00斤' : '0.00';
    if (t > doubt.start + 0.8 && t < scaleLine.start + 0.3) scaleText = frac(t * 6) < 0.5 ? '9.80斤' : '15.00斤';
    if (beauty) scaleText = '15.00斤';
    const cutDone = t > S('cut').end - 0.3;
    const tokens = (() => {
      const ln = l('arrive', 1);
      const a = atPhrase(ln, '词元');
      if (t < a) return 0;
      return Math.round(1024 * Math.pow(2, Math.min(12, (t - a) * 4)));
    })();

    const drawRobotNow = (front) => {
      if (front !== robotFront) return;
      const mouth = mouthOf('robot', t);
      const r = drawRobot(rbX + (inDance && hop >= 1 ? step * 50 : 0), rbBase, rpose, {
        t, expr: track(DIR.rbExpr, t).cur, mouth, open, legs: hop > 0, step: inDance && hop >= 1 ? step : 0,
        tilt: inDance && hop >= 1 ? step * 0.12 : rp.cur === 'angry' ? Math.sin(t * 40) * 0.04 : 0,
      });
      const hand = r.front;
      const priceLine = l('price', 1);
      if (rp.cur === 'present' && t >= priceLine.start && t < priceLine.end + 1.2) {
        melon(hand[0], hand[1] - 40, 70, 58, { chip: true, t });
      }
      if (rp.cur === 'present' && t >= l('ripe', 1).start && t < l('ripe', 1).end + 0.2) {
        ctx.save();
        ctx.translate(hand[0], hand[1] - 30);
        roundRect(-34, -24, 68, 48, 8);
        fillStroke(C.yellow, 5);
        text('99.9', 0, 2, 26, { font: FONT.display, color: C.ink });
        ctx.restore();
      }
      if (rp.cur === 'reach' && !onScale) {
        const from = PILE[2], to = [STALL.scaleX, STALL.top - 130];
        const mx = lerp(from[0], to[0], pickP), my = lerp(from[1], to[1], pickP) - Math.sin(pickP * Math.PI) * 160;
        melon(mx, my, 70, 58, {});
      }
      if (rp.cur === 'chop') {
        ctx.save();
        ctx.translate(hand[0], hand[1]);
        ctx.rotate(-(rpose.ra[0] + rpose.ra[1]) + Math.PI);
        roundRect(-14, -10, 28, 60, 8);
        fillStroke('#6B4A2E', 5);
        ctx.beginPath();
        ctx.moveTo(-40, -10); ctx.lineTo(60, -10); ctx.lineTo(60, -110); ctx.lineTo(-40, -90);
        ctx.closePath();
        fillStroke('#CFD6DF', 6);
        ctx.restore();
      }
    };

    drawRobotNow(false);
    drawCounter(t, {
      tokens, scaleText, beauty,
      hidePile: (i) => i === 2 && (pickP > 0 || t > pick.start),
      half: false,
    });
    // melon on the scale and the ever-longer melon
    const sx = STALL.scaleX, sy = STALL.top - 130;
    let len = 0;
    if (onScale && !cutDone) {
      const n = DIR.chops.filter((c) => t >= c).length;
      if (n === 0) melon(sx, sy, 72, 58, {});
      else {
        const lastC = DIR.chops[n - 1];
        const target = 150 + n * 330, prevT = 150 + (n - 1) * 330;
        len = lerp(prevT, target, backOut(prog(t, lastC, 0.3)));
        longMelon(sx + len * 0.3, STALL.top - 70, len, 116, t);
      }
    }
    if (cutDone && t < S('dance').start + 0.6) {
      const p = prog(t, S('cut').end - 0.3, 0.6);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      longMelon(sx + 1800 * 0.3, STALL.top - 70, 1800 * (1 - easeIn(p) * 0.9), 116, t);
      ctx.restore();
      poof(sx + 300, sy, p);
    }
    for (const c of DIR.chops) {
      if (t >= c && t < c + 0.45) {
        const p = prog(t, c, 0.45);
        text('咔!', sx - 40 + frac(c * 97) * 100, sy - 60 - easeOut(p) * 40, 64, { font: FONT.display, color: C.yellow, stroke: C.ink, strokeW: 10, alpha: 1 - p });
      }
    }
    if (beauty && t < scaleLine.end + 2.5) sparkles(sx, STALL.top - 60, t, 1 - prog(t, scaleLine.end + 1.8, 0.7));
    drawRobotNow(true);

    // certificate hologram
    const cert = l('ripe', 1), hallu = l('ripe', 3);
    const cp = prog(t, atPhrase(cert, 'AI') - 0.2, DUR.slow) * (1 - prog(t, hallu.end + 1.0, 0.4));
    if (cp > 0) certificate(1640, 330, t, easeOut(cp), t > hallu.start + 0.1 ? 1 : 0);

    // 华强
    const hp = track(DIR.hqPose, t);
    let pose;
    const poseOf = (name) => (name === 'dance' ? dancePose(t) : HQ_POSES[name]);
    pose = blendPose(poseOf(hp.prev), poseOf(hp.cur), hp.p);
    const arrive = S('arrive');
    const rideIn = easeOut(prog(t, arrive.start, 1.8));
    const outro = S('outro'), o1 = LN('outro', 1);
    const leave = easeIn(prog(t, o1.end + 0.6, 1.8));
    let scX = lerp(-420, 420, rideIn) - leave * 1100;
    const onScooter = t < arrive.start + 1.9 || t > o1.start - 0.7;
    const toScooter = t > o1.start - 0.7 ? easeInOut(prog(t, o1.start - 0.7, 0.4)) : 0;
    const offScooter = easeInOut(prog(t, arrive.start + 1.9, 0.4));
    let hqX = 650, sit = 0, footY = 905;
    if (t < arrive.start + 2.3) { hqX = lerp(scX + 10, 650, offScooter); sit = 1 - offScooter; footY = lerp(840, 905, offScooter); }
    if (t > o1.start - 0.7) { hqX = lerp(650, scX + 10, toScooter); sit = toScooter; footY = lerp(905, 840, toScooter); }
    const bob = hp.cur === 'dance' ? Math.abs(Math.sin((t / beat) * Math.PI)) * -14 : 0;
    if (t < arrive.start + 2.3 || t > o1.start - 0.7) scooter(scX, 905, t, rideIn < 1 || leave > 0);
    else scooter(420, 905, t, false);
    if (t > o1.start - 0.7 && t > o1.start - 0.3) melon(scX - 150, 790, 52, 42, {});
    const hx = hqX + (hp.cur === 'dance' ? Math.sin((t / beat) * Math.PI) * 26 : 0);
    const hands = drawHQ(hx, footY, pose, { expr: track(DIR.hqExpr, t).cur, mouth: mouthOf('huaqiang', t), sit, bob, look: 0.6 });
    void onScooter;

    // kicked melon
    const kick = l('dance', 1);
    const kp = prog(t, kick.start + 0.15, 1.3);
    if (t > kick.start - 0.4 && kp < 1) {
      const fx = hx + 150, fy = 860;
      if (kp <= 0) melon(fx + 40, fy, 52, 42, {});
      else melon(lerp(fx + 40, 2300, kp), fy - Math.sin(kp * Math.PI * 0.9) * 700 - kp * 200, 52, 42, { rot: kp * 18 });
    }
    void hands;

    if (discoAmt > 0) discoFront(t, discoAmt);
    if (night > 0) {
      ctx.fillStyle = `rgba(20,10,50,${0.25 * night})`;
      ctx.fillRect(-200, -200, W + 400, H + 400);
    }
    ctx.restore();
  }

  function dancePose(t) {
    const ph = Math.sin((t / (60 / 124)) * Math.PI);
    return {
      la: [-1.2 + ph * 0.6, -1.2], ra: [1.2 + ph * 0.6, 1.2],
      ll: [-0.25 + ph * 0.2, 0.2], rl: [0.25 + ph * 0.2, -0.2], lean: ph * 0.08,
    };
  }

  function poof(x, y, p) {
    if (p <= 0 || p >= 1) return;
    const R = rng(77);
    for (let i = 0; i < 14; i++) {
      const a = R() * TAU, d = easeOut(p) * (80 + R() * 160);
      ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 26 + R() * 30, 0, TAU);
      ctx.fill();
    }
  }

  function sparkles(x, y, t, a) {
    if (a <= 0) return;
    const R = rng(21);
    for (let i = 0; i < 16; i++) {
      const ang = R() * TAU, d = 70 + R() * 120;
      const s = (0.5 + 0.5 * Math.sin(t * 9 + i)) * 18 * a;
      const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d * 0.7;
      ctx.fillStyle = i % 2 ? C.pink : C.yellow;
      ctx.beginPath();
      ctx.moveTo(px, py - s); ctx.lineTo(px + s * 0.3, py - s * 0.3); ctx.lineTo(px + s, py);
      ctx.lineTo(px + s * 0.3, py + s * 0.3); ctx.lineTo(px, py + s); ctx.lineTo(px - s * 0.3, py + s * 0.3);
      ctx.lineTo(px - s, py); ctx.lineTo(px - s * 0.3, py - s * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    text('美颜模式 ON', x, y - 150, 40, { font: FONT.display, color: C.pink, stroke: C.white, strokeW: 8, alpha: a });
  }

  function certificate(x, y, t, a, glitch) {
    ctx.save();
    ctx.globalAlpha = a;
    const w = 420, h = 230;
    const draw = (dx, color) => {
      ctx.save();
      ctx.translate(dx, 0);
      roundRect(x - w / 2, y - h / 2, w, h, 18);
      ctx.fillStyle = color || 'rgba(30,80,120,0.55)';
      ctx.fill();
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 4;
      ctx.stroke();
      text('AI 鉴定报告', x, y - 70, 40, { font: FONT.display, color: C.cyan });
      text('保熟率', x - 90, y, 34, { color: C.white });
      text('99.9%', x + 70, y, 56, { font: FONT.display, color: C.yellow });
      roundRect(x - 160, y + 52, 320, 24, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fill();
      roundRect(x - 160, y + 52, 320 * 0.999, 24, 12);
      ctx.fillStyle = C.cyan;
      ctx.fill();
      ctx.restore();
    };
    if (glitch) {
      const j = Math.sin(t * 50) * 12;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.6;
      draw(j, 'rgba(255,40,80,0.35)');
      draw(-j, 'rgba(40,200,255,0.35)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      text('剩余0.1% = 幻觉', x, y + 150, 38, { font: FONT.display, color: C.pink, stroke: C.ink, strokeW: 8 });
    } else draw(0);
    ctx.restore();
  }

  function discoBack(t, a) {
    ctx.save();
    ctx.fillStyle = `rgba(25,5,50,${0.45 * a})`;
    ctx.fillRect(-600, -600, W + 1200, H + 1200);
    ctx.globalCompositeOperation = 'lighter';
    const cols = ['255,80,180', '80,220,255', '255,230,90', '140,255,140'];
    for (let i = 0; i < 6; i++) {
      const ang = Math.sin(t * 1.3 + i * 1.7) * 0.7;
      const ox = 260 + i * 280;
      ctx.save();
      ctx.translate(ox, -40);
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, 0, 1100);
      g.addColorStop(0, `rgba(${cols[i % 4]},${0.5 * a})`);
      g.addColorStop(1, `rgba(${cols[i % 4]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(180, 1100); ctx.lineTo(-180, 1100);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Characters stay in front of the beams; additive light over dark clothing makes them look see-through.
  function discoFront(t, a) {
    ctx.save();
    ctx.fillStyle = `rgba(25,5,50,${0.12 * a})`;
    ctx.fillRect(-600, -600, W + 1200, H + 1200);
    ctx.globalCompositeOperation = 'lighter';
    const cols = ['255,80,180', '80,220,255', '255,230,90', '140,255,140'];
    const R = rng(5);
    for (let i = 0; i < 40; i++) {
      const x = frac(R() + t * 0.05 * (R() - 0.5)) * W, y = 900 + R() * 180;
      ctx.fillStyle = `rgba(${cols[i % 4]},${0.5 * a * (0.5 + 0.5 * Math.sin(t * 6 + i))})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 40, 12, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- title set ----------
  function drawTitle(t) {
    const sc = SC('title');
    const lt = t - sc.start;
    ctx.save();
    ctx.fillStyle = '#FF9F1C';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(lt * 0.25);
    for (let i = 0; i < 18; i++) {
      ctx.rotate(TAU / 18);
      ctx.fillStyle = i % 2 ? '#FFD23F' : '#FF9F1C';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1400, -170);
      ctx.lineTo(1400, 170);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const p1 = prog(lt, 0.2, 0.5);
    ctx.save();
    ctx.translate(W / 2, 400);
    ctx.rotate(-0.05);
    const s1 = lerp(2.4, 1, backOut(p1));
    ctx.scale(s1, s1);
    text('华强买瓜', 0, 0, 220, { font: FONT.display, color: C.white, stroke: C.ink, strokeW: 26, shadow: C.red, alpha: clamp(p1 * 3) });
    ctx.restore();
    const p2 = prog(lt, 0.8, 0.5);
    ctx.save();
    ctx.translate(W / 2 + 330, 560);
    ctx.rotate(0.08);
    ctx.scale(backOut(p2), backOut(p2));
    roundRect(-150, -60, 300, 120, 24);
    fillStroke('#1B1340', 8);
    text('2026', 0, 4, 100, { font: FONT.display, color: C.cyan });
    ctx.restore();
    const p3 = prog(lt, 1.3, 0.5);
    text('赛博保熟版', W / 2 - 140, 580, 84, { font: FONT.display, color: C.yellow, stroke: C.ink, strokeW: 14, alpha: easeOut(p3) });
    const mp = prog(lt, 0.4, 0.8);
    melon(360, lerp(1300, 760, easeOut(mp)) + Math.abs(Math.sin(lt * 4)) * -30, 120, 100, { rot: lt * 1.5, face: 'cheer', t });
    const rp = easeOut(prog(lt, 1.0, 0.6));
    drawRobot(1580, lerp(1400, 1090, rp), RB_POSES.wave, { t, expr: 'happy', mouth: mouthOf('robot', t), open: 0.5 });
  }

  // ---------- stage set ----------
  function drawStage(t) {
    const sc = SC('tour');
    const l0 = sc.lines[0], l1 = sc.lines[1];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#120A2E');
    g.addColorStop(1, '#2C1450');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    roundRect(300, 30, 1320, 190, 20);
    fillStroke('#050510', 8);
    const hue = (t * 60) % 360;
    ctx.save();
    roundRect(312, 42, 1296, 166, 14);
    ctx.clip();
    const lg = ctx.createLinearGradient(312, 0, 1608, 0);
    lg.addColorStop(0, `hsl(${hue},80%,35%)`);
    lg.addColorStop(1, `hsl(${(hue + 120) % 360},80%,35%)`);
    ctx.fillStyle = lg;
    ctx.fillRect(312, 42, 1296, 166);
    if (t < l0.end + 0.2) {
      ctx.save();
      ctx.translate(1380, 125);
      ctx.scale(0.75, 0.75);
      drawRobotHeadOnly(t);
      ctx.restore();
      text('瓜Agent 现场连线', 800, 125, 64, { font: FONT.display, color: C.white, stroke: C.ink, strokeW: 10 });
    } else {
      text('华强买瓜 · 世界巡演 2026', 960, 125, 84, { font: FONT.display, color: C.yellow, stroke: C.ink, strokeW: 12 });
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const ang = Math.sin(t * 1.1 + i * 1.3) * 0.45;
      ctx.save();
      ctx.translate(200 + i * 380, -20);
      ctx.rotate(ang);
      const sg = ctx.createLinearGradient(0, 0, 0, 900);
      sg.addColorStop(0, 'rgba(255,240,200,0.45)');
      sg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.lineTo(200, 900); ctx.lineTo(-200, 900);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#3A2466';
    ctx.fillRect(0, 760, W, 80);
    ctx.fillStyle = '#5B3A94';
    ctx.fillRect(0, 760, W, 10);
    const pose = t > l1.start - 0.3 ? HQ_POSES.mic : blendPose(HQ_POSES.idle, HQ_POSES.mic, easeInOut(prog(t, sc.start + 0.4, 0.4)));
    drawHQ(960, 800, pose, { expr: t > l1.end ? 'happy' : 'normal', mouth: mouthOf('huaqiang', t), mic: true, look: 0 });

    // audience of melons
    const faintIdx = 3;
    const faintAt = l0.end + 0.5;
    let faint = null;
    const R = rng(12);
    const rows = [[880, 9, 74], [990, 10, 86]];
    rows.forEach(([y, n, r], ri) => {
      for (let i = 0; i < n; i++) {
        const x = 90 + i * (1740 / (n - 1)) + (ri ? 0 : 40);
        const idx = ri * 100 + i;
        const ph = R() * TAU;
        let yy = y - Math.abs(Math.sin(t * 5 + ph)) * 18;
        let rot = Math.sin(t * 3 + ph) * 0.08;
        const mood = t > l1.end - 0.2 ? 'cheer' : 'smile';
        if (ri === 1 && i === faintIdx && t > faintAt) {
          faint = { x, y, r };
          continue;
        }
        melon(x, yy, r, r * 0.85, { rot, face: mood, t, seed: idx });
        const sx = x + (i % 2 ? 1 : -1) * r * 0.9;
        const swing = Math.sin(t * 6 + ph) * 0.5;
        capsule(sx, yy - r * 0.3, sx + Math.sin(swing) * 70, yy - r * 0.3 - Math.cos(swing) * 70, 12, ['#FF6FAE', '#7FF3FF', '#FFE14D'][idx % 3], 3);
      }
    });
    if (faint) {
      // The fainting fan is drawn on top and carried off above the crowd so the gag reads.
      const fp = easeOut(prog(t, faintAt, 0.5));
      const lift = easeOut(prog(t, faintAt + 0.6, 0.4));
      const carry = easeInOut(prog(t, faintAt + 1.0, 3.2));
      const fx = faint.x + carry * 1400, fy = faint.y - lift * 150 + fp * 20;
      if (lift > 0) stretcher(fx, fy + faint.r * 0.75, t);
      melon(fx, fy, faint.r, faint.r * 0.85, { rot: lerp(fp * 1.4, Math.PI / 2, lift), face: 'faint', t });
      for (let s = 0; s < 3; s++) {
        const a = t * 5 + (s * TAU) / 3;
        star(fx + Math.cos(a) * 70, fy - 90 + Math.sin(a) * 18, 14, C.yellow);
      }
      text('激动晕倒', fx, fy - 150, 40, { font: FONT.display, color: C.pink, stroke: C.ink, strokeW: 8, alpha: fp });
    }
    if (t > l1.start) confetti(t - l1.start);
  }

  function drawRobotHeadOnly(t) {
    roundRect(-130, -95, 260, 190, 30);
    fillStroke(C.metal, 7);
    robotFace(260, 190, 'happy', mouthOf('robot', t), t);
  }

  function star(x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r, a = (i / 10) * TAU - Math.PI / 2;
      i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    fillStroke(color, 3);
  }

  function stretcher(x, y, t) {
    roundRect(x - 120, y - 10, 240, 20, 8);
    fillStroke(C.cream, 5);
    for (const s of [-1, 1]) {
      const px = x + s * 150, py = y + 20 + Math.abs(Math.sin(t * 12 + s)) * -6;
      melon(px, py, 34, 30, { face: 'smile', t, seed: s + 3 });
      capsule(px - 10, py + 26, px - 14 + Math.sin(t * 14) * 8, py + 52, 8, C.melonDark, 3);
      capsule(px + 10, py + 26, px + 14 - Math.sin(t * 14) * 8, py + 52, 8, C.melonDark, 3);
    }
  }

  function confetti(lt) {
    const R = rng(31);
    for (let i = 0; i < 90; i++) {
      const x = R() * W, sp = 180 + R() * 220, ph = R() * TAU;
      const y = -40 + lt * sp - R() * 300;
      if (y < -40 || y > H) continue;
      ctx.save();
      ctx.translate(x + Math.sin(lt * 3 + ph) * 30, y);
      ctx.rotate(lt * 4 + ph);
      ctx.fillStyle = ['#FF6FAE', '#7FF3FF', '#FFE14D', '#8CFF8C'][i % 4];
      ctx.fillRect(-8, -4, 16, 8);
      ctx.restore();
    }
  }

  // ---------- overlays ----------
  function subtitles(t) {
    for (let i = 0; i < LINES.length; i++) {
      const l = LINES[i], next = LINES[i + 1];
      const end = Math.min(l.end + 0.3, next ? next.start - 0.08 : Infinity);
      if (t < l.start - 0.1 || t > end) continue;
      const a = Math.min(prog(t, l.start - 0.1, DUR.fast), 1 - prog(t, end - DUR.fast, DUR.fast));
      const size = [...l.text].length > 24 ? 50 : 56;
      const tag = l.who === 'huaqiang' ? '华强' : '瓜Agent';
      const tagW = measure(tag, 30) + 28;
      const tw = measure(l.text, size);
      const total = tagW + 16 + tw;
      const x0 = W / 2 - total / 2;
      ctx.save();
      ctx.globalAlpha = easeOut(a);
      roundRect(x0, 960 - 22, tagW, 44, 22);
      ctx.fillStyle = l.who === 'huaqiang' ? '#2A2A31' : '#1C6E8C';
      ctx.fill();
      text(tag, x0 + tagW / 2, 961, 30, { color: C.white });
      text(l.text, x0 + tagW + 16 + tw / 2, 960, size, { color: l.who === 'huaqiang' ? C.hq : C.robot, stroke: C.ink, strokeW: 10 });
      ctx.restore();
    }
  }

  function captions(t) {
    for (const l of LINES) {
      if (!l.caption) continue;
      const at = Math.max(l.start, l.end - 0.9);
      const end = lineEnd(l) + 0.25;
      if (t < at || t > end + 0.2) continue;
      const p = prog(t, at, 0.32);
      const out = prog(t, end, 0.2);
      const s = lerp(2.2, 1, backOut(p)) * (1 + out * 0.3);
      // Opposite the speaker so the speaker's face (and the robot's screen gags) stay visible.
      const scene = TL.scenes.find((sc) => sc.lines.includes(l));
      const [cx, cy] = scene.id === 'tour' ? [520, 620] : l.who === 'robot' ? [560, 270] : [1360, 270];
      ctx.save();
      ctx.globalAlpha = (1 - out) * clamp(p * 4);
      ctx.translate(cx + Math.sin(t * 60) * (1 - p) * 10, cy);
      ctx.rotate(-0.06);
      ctx.scale(s, s);
      const n = [...l.caption].length;
      const size = n > 5 ? 96 : n > 4 ? 112 : 136;
      const w = measure(l.caption, size, FONT.display);
      ctx.beginPath();
      const spikes = 18, rx = w / 2 + 120, ry = size * 0.95;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU;
        const rr = i % 2 ? 0.78 : 1;
        const px = Math.cos(a) * rx * rr, py = Math.sin(a) * ry * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      fillStroke(C.white, 8);
      text(l.caption, 0, 4, size, { font: FONT.display, color: C.yellow, stroke: C.ink, strokeW: size * 0.16, shadow: C.red });
      ctx.restore();
    }
  }

  function danmaku(t) {
    let n = 0;
    const colors = [C.white, C.white, C.yellow, '#9AF6FF', '#FFB3D9'];
    for (const l of LINES) {
      if (!l.danmu) continue;
      l.danmu.forEach((msg, i) => {
        const idx = n++;
        const start = l.start + 0.3 + i * 0.75;
        const dur = 6.5;
        if (t < start || t > start + dur) return;
        const size = 42;
        const w = measure(msg, size);
        const x = lerp(W + 20, -w - 20, (t - start) / dur);
        const row = (idx * 3) % 5;
        text(msg, x, 110 + row * 64, size, { align: 'left', color: colors[idx % colors.length], stroke: 'rgba(20,10,20,0.85)', strokeW: 7 });
      });
    }
  }

  function endCard(t) {
    const sc = SC('outro');
    const p = prog(t, sc.end - 2.6, 0.6);
    if (p <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(16,10,30,${0.82 * easeOut(p)})`;
    ctx.fillRect(0, 0, W, H);
    const p1 = prog(t, sc.end - 2.4, 0.5);
    text('本片纯属虚构', W / 2, 380, 90, { font: FONT.display, color: C.white, stroke: C.ink, strokeW: 12, alpha: easeOut(p1) });
    text('没有任何瓜摊老板受到伤害', W / 2, 500, 60, { color: C.yellow, alpha: easeOut(prog(t, sc.end - 2.0, 0.5)) });
    ['点赞', '关注', '保熟'].forEach((s, i) => {
      const bp = prog(t, sc.end - 1.6 + i * 0.15, 0.4);
      if (bp <= 0) return;
      ctx.save();
      ctx.translate(W / 2 + (i - 1) * 260, 660);
      ctx.scale(backOut(bp), backOut(bp));
      roundRect(-110, -50, 220, 100, 50);
      fillStroke(i === 2 ? C.melon : C.red, 6);
      text(s, 0, 2, 52, { font: FONT.display, color: C.white });
      ctx.restore();
    });
    ctx.restore();
  }

  function watermark(t) {
    text('华强买瓜2026 · 二创', W - 40, 50, 28, { align: 'right', color: 'rgba(255,255,255,0.75)', stroke: 'rgba(0,0,0,0.4)', strokeW: 5 });
    void t;
  }

  // ---------- composition ----------
  const SET = { title: 'title', arrive: 'stall', price: 'stall', ripe: 'stall', scale: 'stall', cut: 'stall', dance: 'stall', tour: 'stage', outro: 'stall' };
  const DRAW = { title: drawTitle, stall: drawStallWorld, stage: drawStage };

  function sceneIndex(t) {
    const i = TL.scenes.findIndex((s) => t < s.end);
    return i < 0 ? TL.scenes.length - 1 : i;
  }

  function seek(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);
    const S = TL.scenes, half = TL.transition / 2;
    const i = sceneIndex(t);
    const set = SET[S[i].id];
    let other = null, b = 0;
    if (i + 1 < S.length && SET[S[i + 1].id] !== set && t > S[i].end - half) { other = SET[S[i + 1].id]; b = S[i].end; }
    if (i > 0 && SET[S[i - 1].id] !== set && t < S[i].start + half) { other = set; b = S[i].start; }
    if (!other) {
      DRAW[set](t);
    } else {
      const from = t < b ? set : SET[S[i - 1].id];
      const to = t < b ? other : set;
      const p = easeInOut(prog(t, b - half, TL.transition));
      DRAW[from](t);
      const edge = lerp(-500, W + 500, p);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(edge + 250, -10);
      ctx.lineTo(edge - 250, H + 10);
      ctx.lineTo(-10, H + 10);
      ctx.closePath();
      ctx.clip();
      DRAW[to](t);
      ctx.restore();
      ctx.save();
      ctx.lineCap = 'butt';
      for (const [off, col, w] of [[0, C.ink, 60], [0, C.yellow, 40], [0, C.ink, 8]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(edge + 250 + off, -10);
        ctx.lineTo(edge - 250 + off, H + 10);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (set !== 'title') watermark(t);
    danmaku(t);
    captions(t);
    subtitles(t);
    endCard(t);
  }

  function cues() {
    const out = [];
    const S = TL.scenes;
    for (let i = 1; i < S.length; i++) if (SET[S[i].id] !== SET[S[i - 1].id]) out.push({ t: S[i].start - TL.transition / 2, type: 'whoosh' });
    out.push({ t: SC('title').start + 0.2, type: 'boom' });
    out.push({ t: SC('arrive').start, type: 'scooter' });
    out.push({ t: LN('outro', 1).end + 0.6, type: 'scooter' });
    for (const l of LINES) if (l.caption) out.push({ t: Math.max(l.start, l.end - 0.9), type: 'boing' });
    out.push({ t: atPhrase(LN('arrive', 1), '词元'), type: 'coins' });
    out.push({ t: LN('ripe', 3).start + 0.1, type: 'glitch' });
    out.push({ t: LN('scale', 3).start + 0.3, type: 'sparkle' });
    out.push({ t: LN('cut', 3).start - 0.05, type: 'scratch' });
    DIR.chops.forEach((c) => out.push({ t: c, type: 'chop' }));
    out.push({ t: LN('dance', 1).start + 0.15, type: 'kick' });
    out.push({ t: LN('tour', 0).end + 0.5, type: 'faint' });
    out.push({ t: LN('tour', 1).start, type: 'cheer' });
    out.push({ t: SC('outro').end - 1.6, type: 'pop' });
    out.push({ t: SC('outro').end - 1.45, type: 'pop' });
    out.push({ t: SC('outro').end - 1.3, type: 'pop' });
    const music = [
      { from: 0, to: SC('dance').start, style: 'comic' },
      { from: SC('dance').start, to: SC('dance').end, style: 'disco' },
      { from: SC('tour').start, to: SC('tour').end, style: 'stage' },
      { from: SC('outro').start, to: TL.duration, style: 'comic' },
    ];
    return { sfx: out.sort((a, b) => a.t - b.t).map((c) => Object.assign(c, { t: Math.round(c.t * 1000) / 1000 })), music };
  }

  async function init(timeline) {
    TL = timeline;
    LINES = TL.scenes.flatMap((s) => s.lines);
    buildDirector();
    for (const [fam, file] of [['Kuaile', 'kuaile'], ['HuangYou', 'huangyou']]) {
      const f = new FontFace(fam, `url(../build/fonts/${file}.ttf)`);
      document.fonts.add(await f.load());
    }
    await document.fonts.ready;
    seek(0);
    return { duration: TL.duration, fps: TL.fps };
  }

  window.scene = { init, seek, cues };
})();
