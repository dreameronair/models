/*
 * 《我们的太阳系》scene. Every pixel is a pure function of (timeline, t):
 * no clocks, no frame callbacks, no unseeded randomness.
 */
(function () {
  'use strict';

  const W = 1920, H = 1080, TAU = Math.PI * 2;

  const T = {
    color: {
      bgTop: '#1D2259', bgBottom: '#0B0E2B', fg: '#FFF8EC', muted: '#BAC0E8',
      accent: '#FFC94A', accent2: '#FF7E8E', mint: '#7FE0C4',
      card: 'rgba(255,255,255,0.075)', cardLine: 'rgba(255,255,255,0.16)',
      ink: '#2A2145', blush: 'rgba(255,128,156,0.45)', subBg: 'rgba(12,14,46,0.62)',
    },
    font: '"Kuaile", "WenQuanYi Micro Hei", sans-serif',
    type: { hero: 136, h1: 116, h2: 64, body: 48, small: 34 },
    dur: { fast: 0.22, base: 0.45, slow: 0.8 },
    stagger: 0.09,
    transition: 0.9,
  };

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
    const c1 = 1.9, c3 = c1 + 1, q = p - 1;
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

  // ---------- data ----------
  const PLANETS = [
    { id: 'mercury', name: '水星', short: '水', km: 2440, base: '#BDAF9F', dark: '#7A6E63', light: '#E6DCCF', r: 190 },
    { id: 'venus', name: '金星', short: '金', km: 6052, base: '#F2C879', dark: '#C98F43', light: '#FFE7B0', r: 230, glow: 'rgba(255,214,140,0.5)' },
    { id: 'earth', name: '地球', short: '地', km: 6371, base: '#3F8FE0', dark: '#1F4FA8', light: '#8CCBFF', r: 230, glow: 'rgba(120,190,255,0.55)' },
    { id: 'mars', name: '火星', short: '火', km: 3390, base: '#E3703F', dark: '#A8402A', light: '#FFA97A', r: 210 },
    { id: 'jupiter', name: '木星', short: '木', km: 69911, base: '#E6C49A', dark: '#B07848', light: '#F7E6CC', r: 270 },
    { id: 'saturn', name: '土星', short: '土', km: 58232, base: '#EBD39A', dark: '#B99350', light: '#FFF0C8', r: 170, rings: true },
    { id: 'uranus', name: '天王星', short: '天', km: 25362, base: '#9BE3E6', dark: '#5AAFC2', light: '#D6FBFB', r: 220, rings: true, glow: 'rgba(160,240,240,0.4)' },
    { id: 'neptune', name: '海王星', short: '海', km: 24622, base: '#4F74E3', dark: '#2A3F9E', light: '#8FB0FF', r: 220, glow: 'rgba(110,150,255,0.5)' },
  ];
  const BY_ID = Object.fromEntries(PLANETS.map((p, i) => [p.id, Object.assign(p, { index: i })]));

  const CHIPS = {
    mercury: [['离太阳', '最近', 0], ['一年', '只有 88 天', 1]],
    venus: [['亮度', '夜空中最亮', 0], ['表面温度', '400°C 以上', 1]],
    earth: [['身份', '我们的家', 0], ['特点', '有生命', 1], ['好朋友', '月球', 2]],
    mars: [['颜色', '红红的', 0], ['火山', '太阳系最高', 1]],
    jupiter: [['大小', '行星里最大', 0], ['大红斑', '超级大风暴', 1]],
    saturn: [['标志', '漂亮的光环', 0], ['光环', '冰块 + 石头', 1]],
    uranus: [['颜色', '蓝绿色', 0], ['转圈', '躺着转', 1]],
    neptune: [['离太阳', '最远', 0], ['风', '太阳系最猛', 1]],
  };
  const STATION = ['第一站', '第二站', '第三站', '第四站', '第五站', '第六站', '第七站', '最后一站'];

  // ---------- canvas ----------
  const canvas = document.getElementById('stage');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  function font(size) { return `${size}px ${T.font}`; }

  function text(str, x, y, size, o = {}) {
    ctx.save();
    ctx.font = font(size);
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    if (o.shadow !== false) {
      ctx.shadowColor = 'rgba(5,6,30,0.55)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
    }
    ctx.fillStyle = o.color || T.color.fg;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function measure(str, size) {
    ctx.save();
    ctx.font = font(size);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  /** Letters pop in one by one with a springy scale. */
  function popText(str, cx, cy, size, t0, t, o = {}) {
    const chars = [...str];
    const widths = chars.map((c) => measure(c, size));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    chars.forEach((c, i) => {
      const p = prog(t, t0 + i * (o.stagger || T.stagger), T.dur.base);
      const s = backOut(p);
      const w = widths[i];
      if (p > 0) {
        ctx.save();
        ctx.translate(x + w / 2, cy + (1 - easeOut(p)) * size * 0.4);
        ctx.scale(s, s);
        text(c, 0, 0, size, { color: o.colors ? o.colors[i % o.colors.length] : o.color, alpha: clamp(p * 3) });
        ctx.restore();
      }
      x += w;
    });
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

  // ---------- background ----------
  const STARS = (() => {
    const R = rng(7), out = [];
    for (let i = 0; i < 340; i++) {
      out.push({ x: R() * W, y: R() * H, s: 0.6 + R() * R() * 2.4, w: 0.6 + R() * 2.2, ph: R() * TAU, layer: R() < 0.7 ? 0 : 1 });
    }
    return out;
  })();
  const NEBULAE = [
    { x: 0.18, y: 0.28, r: 0.42, c: '120,90,220' },
    { x: 0.82, y: 0.72, r: 0.46, c: '60,150,220' },
    { x: 0.62, y: 0.12, r: 0.3, c: '220,100,170' },
  ];

  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, T.color.bgTop);
    g.addColorStop(1, T.color.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (const n of NEBULAE) {
      const x = n.x * W + Math.sin(t * 0.05 + n.x * 9) * 40, y = n.y * H;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, n.r * W);
      rg.addColorStop(0, `rgba(${n.c},0.16)`);
      rg.addColorStop(1, `rgba(${n.c},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    for (const s of STARS) {
      const drift = t * (s.layer ? 9 : 4);
      const x = ((s.x - drift) % W + W) % W;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.w + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#FFFBEA';
      ctx.beginPath();
      ctx.arc(x, s.y, s.s, 0, TAU);
      ctx.fill();
      if (s.s > 2.3) {
        ctx.globalAlpha = a * 0.5;
        ctx.fillRect(x - s.s * 3, s.y - 0.6, s.s * 6, 1.2);
        ctx.fillRect(x - 0.6, s.y - s.s * 3, 1.2, s.s * 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  function vignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(5,6,24,0)');
    g.addColorStop(1, 'rgba(5,6,24,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- faces ----------
  function blink(t, seed) {
    const period = 3.1 + (seed % 7) * 0.23;
    const ph = frac((t + seed * 0.37) / period) * period;
    const d = 0.16;
    return ph < d ? Math.abs(Math.cos((ph / d) * Math.PI)) : 1;
  }

  function face(r, t, o = {}) {
    if (r < 16) return;
    const seed = o.seed || 1;
    const lx = (o.look ? o.look[0] : 0) * r * 0.05, ly = (o.look ? o.look[1] : 0) * r * 0.05;
    const ex = r * 0.3, ey = r * 0.06, er = Math.max(2, r * 0.1);
    const open = blink(t, seed);
    ctx.save();
    ctx.fillStyle = T.color.blush;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.5 + lx, r * 0.27 + ly, r * 0.12, r * 0.065, 0, 0, TAU);
      ctx.fill();
    }
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * ex + lx, ey + ly);
      ctx.scale(1, Math.max(0.12, open));
      ctx.fillStyle = T.color.ink;
      ctx.beginPath();
      ctx.ellipse(0, 0, er, er * 1.18, 0, 0, TAU);
      ctx.fill();
      if (open > 0.4) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(-er * 0.32, -er * 0.38, er * 0.38, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(er * 0.35, er * 0.35, er * 0.16, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.strokeStyle = T.color.ink;
    ctx.fillStyle = T.color.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, r * 0.035);
    const my = r * 0.25 + ly;
    if (o.mouth === 'open') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.12 + lx, my - r * 0.02);
      ctx.quadraticCurveTo(lx, my + r * 0.2, r * 0.12 + lx, my - r * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FF8FA0';
      ctx.beginPath();
      ctx.ellipse(lx, my + r * 0.08, r * 0.06, r * 0.035, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(lx, my - r * 0.06, r * 0.12, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- planets ----------
  function project(r, lon0, lat, size, rot) {
    let lon = lon0 + rot * TAU;
    lon = ((lon + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const c = Math.cos(lon);
    return { vis: c > -0.05, x: r * Math.sin(lon) * Math.cos(lat), y: -r * Math.sin(lat), sx: size * r * Math.max(0.04, c), sy: size * r, c };
  }

  function blob(r, lon, lat, size, rot, color) {
    const s = project(r, lon, lat, size, rot);
    if (!s.vis) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.sx, s.sy, 0, 0, TAU);
    ctx.fill();
  }

  const FEATURES = (() => {
    const R = rng(42);
    const craters = [];
    for (let i = 0; i < 16; i++) craters.push([R() * TAU, (R() - 0.5) * 2.2, 0.05 + R() * 0.11]);
    const continents = [
      [[0.2, 0.5, 0.26], [0.5, 0.35, 0.2], [0.05, 0.25, 0.18], [0.4, 0.62, 0.16]],
      [[1.6, -0.2, 0.22], [1.8, 0.15, 0.2], [1.5, -0.5, 0.14]],
      [[3.2, 0.45, 0.3], [3.6, 0.3, 0.22], [3.0, 0.2, 0.18], [3.9, 0.55, 0.16]],
      [[4.6, -0.45, 0.18], [4.9, -0.3, 0.14]],
      [[5.4, 0.1, 0.12]],
    ];
    const clouds = [];
    for (let i = 0; i < 9; i++) clouds.push([R() * TAU, (R() - 0.5) * 2, 0.08 + R() * 0.1]);
    const patches = [];
    for (let i = 0; i < 8; i++) patches.push([R() * TAU, (R() - 0.5) * 1.6, 0.12 + R() * 0.16]);
    const ice = [];
    for (let i = 0; i < 90; i++) ice.push([R() * TAU, 1.3 + R() * 0.8, 0.6 + R() * 1.6, R()]);
    return { craters, continents, clouds, patches, ice };
  })();

  const SPOT = [0, -0.52, 0.2];

  function bands(r, list, rot, wave) {
    for (const [a, b, color] of list) {
      ctx.fillStyle = color;
      ctx.beginPath();
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const x = -r + (2 * r * i) / steps;
        const y = r * a + Math.sin(x / r * 4 + rot * TAU * 2 + a * 9) * r * wave;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const x = -r + (2 * r * i) / steps;
        const y = r * b + Math.sin(x / r * 4 + rot * TAU * 2 + b * 9) * r * wave;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const SURFACE = {
    mercury(r, rot) {
      for (const [lon, lat, s] of FEATURES.craters) {
        const p = project(r, lon, lat * 0.6, s, rot);
        if (!p.vis) continue;
        ctx.fillStyle = 'rgba(110,98,88,0.55)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.sx, p.sy, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(240,232,220,0.35)';
        ctx.beginPath();
        ctx.ellipse(p.x + p.sx * 0.15, p.y + p.sy * 0.2, p.sx * 0.7, p.sy * 0.6, 0, 0, TAU);
        ctx.fill();
      }
    },
    venus(r, rot) {
      ctx.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const y0 = -r + (k + 0.5) * (2 * r / 7);
        ctx.strokeStyle = k % 2 ? 'rgba(255,240,205,0.4)' : 'rgba(200,140,70,0.28)';
        ctx.lineWidth = r * 0.14;
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
          const x = -r * 1.1 + (2.2 * r * i) / 30;
          const y = y0 + Math.sin(x / r * 3 + rot * TAU + k * 1.7) * r * 0.08;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    },
    earth(r, rot) {
      for (const c of FEATURES.continents) {
        for (const [lon, lat, s] of c) blob(r, lon, lat, s, rot, '#5FBF62');
        for (const [lon, lat, s] of c) blob(r, lon + 0.05, lat + 0.05, s * 0.55, rot, '#86D46F');
      }
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.96, r * 0.5, r * 0.16, 0, 0, TAU);
      ctx.ellipse(0, r * 0.97, r * 0.42, r * 0.13, 0, 0, TAU);
      ctx.fill();
      for (const [lon, lat, s] of FEATURES.clouds) blob(r, lon, lat * 0.7, s, rot * 1.35, 'rgba(255,255,255,0.55)');
    },
    mars(r, rot) {
      for (const [lon, lat, s] of FEATURES.patches) blob(r, lon, lat * 0.7, s, rot, 'rgba(150,52,32,0.3)');
      ctx.fillStyle = 'rgba(255,250,245,0.92)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.95, r * 0.36, r * 0.13, 0, 0, TAU);
      ctx.fill();
    },
    jupiter(r, rot) {
      bands(r, [
        [-0.82, -0.62, 'rgba(176,118,74,0.55)'], [-0.42, -0.22, 'rgba(196,132,82,0.7)'],
        [-0.08, 0.06, 'rgba(250,236,214,0.55)'], [0.16, 0.36, 'rgba(184,114,68,0.7)'],
        [0.52, 0.66, 'rgba(206,150,100,0.5)'], [0.8, 0.95, 'rgba(160,104,66,0.5)'],
      ], rot, 0.025);
      const s = project(r, ...SPOT, rot);
      if (s.vis) {
        ctx.fillStyle = '#D4583C';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.sx, s.sy * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,170,130,0.55)';
        ctx.beginPath();
        ctx.ellipse(s.x - s.sx * 0.12, s.y - s.sy * 0.1, s.sx * 0.55, s.sy * 0.3, 0, 0, TAU);
        ctx.fill();
      }
    },
    saturn(r, rot) {
      bands(r, [
        [-0.7, -0.5, 'rgba(200,160,90,0.45)'], [-0.25, -0.1, 'rgba(214,176,108,0.5)'],
        [0.15, 0.3, 'rgba(196,150,84,0.45)'], [0.55, 0.72, 'rgba(210,170,100,0.4)'],
      ], rot, 0.015);
    },
    uranus(r, rot) {
      bands(r, [[-0.5, -0.3, 'rgba(110,190,205,0.3)'], [0.2, 0.4, 'rgba(110,190,205,0.25)']], rot, 0.02);
    },
    neptune(r, rot) {
      bands(r, [[-0.55, -0.38, 'rgba(40,62,160,0.4)'], [0.1, 0.22, 'rgba(120,160,255,0.3)'], [0.5, 0.68, 'rgba(40,62,160,0.35)']], rot, 0.03);
      blob(r, 0.6, 0.28, 0.17, rot, 'rgba(26,36,120,0.75)');
      blob(r, 0.75, 0.12, 0.12, rot, 'rgba(235,245,255,0.6)');
    },
  };

  function rings(p, r, half, t) {
    const vertical = p.id === 'uranus';
    const rx = r * (vertical ? 1.75 : 2.15), ry = r * (vertical ? 0.42 : 0.5);
    const a0 = half === 'back' ? Math.PI : 0, a1 = a0 + Math.PI;
    const list = vertical
      ? [[1.0, 'rgba(210,250,250,0.35)', 0.05]]
      : [[1.0, 'rgba(232,212,160,0.85)', 0.16], [0.86, 'rgba(250,234,190,0.9)', 0.1], [0.72, 'rgba(200,170,110,0.75)', 0.08]];
    for (const [k, color, w] of list) {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * w;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * k, ry * k, 0, a0, a1);
      ctx.stroke();
    }
    if (!vertical) {
      for (const [a, k, s, ph] of FEATURES.ice) {
        const ang = a + t * (0.5 / k);
        const sn = Math.sin(ang);
        if ((half === 'back') !== (sn < 0)) continue;
        const kk = 0.62 + (k - 1.3) * 0.55;
        const x = Math.cos(ang) * rx * kk, y = sn * ry * kk;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + ph * TAU);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, s * r / 170, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPlanet(p, x, y, r, t, o = {}) {
    if (r <= 0) return;
    const rot = o.rot == null ? t * 0.03 : o.rot;
    ctx.save();
    ctx.translate(x, y);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    const tilt = p.id === 'uranus' ? -1.5 : p.id === 'saturn' ? -0.22 : 0;
    ctx.rotate(tilt);
    if (p.glow) {
      const g = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.25);
      g.addColorStop(0, p.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.25, 0, TAU);
      ctx.fill();
    }
    if (p.rings) rings(p, r, 'back', t);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const base = ctx.createLinearGradient(0, -r, 0, r);
    base.addColorStop(0, p.light);
    base.addColorStop(0.45, p.base);
    base.addColorStop(1, p.dark);
    ctx.fillStyle = base;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    SURFACE[p.id](r, rot);
    const sh = ctx.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.05, -r * 0.1, -r * 0.1, r * 1.25);
    sh.addColorStop(0, 'rgba(255,255,255,0.32)');
    sh.addColorStop(0.4, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(14,10,50,0.5)');
    ctx.fillStyle = sh;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
    if (p.rings) rings(p, r, 'front', t);
    if (o.face !== false) face(r, t, { seed: p.index + 3, look: o.look, mouth: o.mouth });
    ctx.restore();
  }

  function drawSun(x, y, r, t, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    const glow = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 2.6);
    glow.addColorStop(0, 'rgba(255,200,90,0.45)');
    glow.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, TAU);
    ctx.fill();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.18;
      const len = r * (0.26 + 0.07 * Math.sin(t * 2.2 + i * 1.3));
      const w = r * 0.16;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? 'rgba(255,190,70,0.9)' : 'rgba(255,214,90,0.9)';
      ctx.beginPath();
      ctx.moveTo(r * 0.9, -w);
      ctx.quadraticCurveTo(r + len * 0.6, -w * 0.4, r + len, 0);
      ctx.quadraticCurveTo(r + len * 0.6, w * 0.4, r * 0.9, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const core = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    core.addColorStop(0, '#FFF6C2');
    core.addColorStop(0.55, '#FFD24A');
    core.addColorStop(1, '#FF9A2E');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    face(r, t, { seed: 11, mouth: o.mouth, look: o.look });
    ctx.restore();
  }

  function drawRocket(x, y, s, ang, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(s, s);
    const fl = 46 + 12 * Math.sin(t * 37) + 8 * Math.sin(t * 53 + 1);
    const fg = ctx.createLinearGradient(-50, 0, -50 - fl, 0);
    fg.addColorStop(0, '#FFF2A8');
    fg.addColorStop(0.35, '#FFB038');
    fg.addColorStop(1, 'rgba(255,90,60,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-46, -15);
    ctx.quadraticCurveTo(-50 - fl * 0.7, -10, -50 - fl, 0);
    ctx.quadraticCurveTo(-50 - fl * 0.7, 10, -46, 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FF6B7A';
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-22, sy * 20);
      ctx.quadraticCurveTo(-40, sy * 48, -56, sy * 50);
      ctx.lineTo(-46, sy * 14);
      ctx.closePath();
      ctx.fill();
    }
    const body = ctx.createLinearGradient(0, -28, 0, 28);
    body.addColorStop(0, '#FFFFFF');
    body.addColorStop(1, '#C9C6E8');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.bezierCurveTo(48, -30, -20, -30, -48, -20);
    ctx.lineTo(-48, 20);
    ctx.bezierCurveTo(-20, 30, 48, 30, 64, 0);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#FF6B7A';
    ctx.fillRect(36, -40, 40, 80);
    ctx.restore();
    ctx.fillStyle = '#B8C3E8';
    ctx.beginPath();
    ctx.arc(8, 0, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6FD3FF';
    ctx.beginPath();
    ctx.arc(8, 0, 10.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(5, -4, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---------- UI pieces ----------
  function chip(x, y, w, label, value, color, p) {
    if (p <= 0) return;
    const e = backOut(p);
    ctx.save();
    ctx.globalAlpha *= clamp(p * 2.5);
    ctx.translate(x + (1 - easeOut(p)) * 60, y);
    ctx.scale(lerp(0.9, 1, e), lerp(0.9, 1, e));
    roundRect(0, -50, w, 100, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.strokeStyle = T.color.cardLine;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(46, 0, 16, 0, TAU);
    ctx.fill();
    text(label, 82, 0, T.type.small, { align: 'left', color: T.color.muted, shadow: false });
    text(value, w - 34, 0, T.type.body, { align: 'right', color: T.color.fg, shadow: false });
    ctx.restore();
  }

  function badge(str, x, y, p, color) {
    if (p <= 0) return;
    const w = measure(str, 40) + 56;
    ctx.save();
    ctx.globalAlpha *= clamp(p * 2);
    ctx.translate(x, y);
    ctx.scale(backOut(p), backOut(p));
    roundRect(0, -32, w, 64, 32);
    ctx.fillStyle = color || T.color.accent;
    ctx.fill();
    text(str, w / 2, 2, 40, { color: T.color.ink, shadow: false });
    ctx.restore();
  }

  function journeyBar(current, lt) {
    const gap = 96, x0 = W / 2 - (gap * 7) / 2, y = 92;
    const p = prog(lt, 0, 0.6);
    ctx.save();
    ctx.globalAlpha *= easeOut(p);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.setLineDash([6, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + gap * 7, y);
    ctx.stroke();
    ctx.setLineDash([]);
    PLANETS.forEach((pl, i) => {
      const active = i === current;
      const visited = i < current;
      const r = active ? 22 : 13;
      ctx.globalAlpha = easeOut(p) * (active || visited ? 1 : 0.4);
      drawPlanet(pl, x0 + i * gap, y, r, lt, { face: false, rot: 0.1 });
      if (active) {
        ctx.strokeStyle = T.color.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x0 + i * gap, y, r + 9 + Math.sin(lt * 4) * 2, 0, TAU);
        ctx.stroke();
      }
    });
    ctx.restore();
    const from = Math.max(0, current - 1);
    const m = easeInOut(prog(lt, 0.15, 0.9));
    const rx = lerp(x0 + from * gap, x0 + current * gap, current === 0 ? 1 : m);
    drawRocket(rx, y - 46 + Math.sin(lt * 3) * 3, 0.32, 0, lt);
  }

  // ---------- timeline helpers ----------
  let TL = null;
  const sceneById = (id) => TL.scenes.find((s) => s.id === id);

  /** Approximate moment a phrase is spoken inside a narration line (by character position). */
  function atPhrase(line, phrase, end = false) {
    const i = line.text.indexOf(phrase);
    if (i < 0) return line.start;
    const n = [...line.text].length;
    const k = [...line.text.slice(0, i + (end ? phrase.length : 0))].length;
    return lerp(line.start, line.end, k / n);
  }

  // ---------- scenes (each receives local time lt and absolute time t) ----------
  const SCENES = {};

  SCENES.intro = (sc, lt, t) => {
    const float = (k) => Math.sin(t * 0.9 + k) * 12;
    const enter = (d) => easeOut(prog(lt, d, T.dur.slow));
    drawPlanet(BY_ID.jupiter, 1620, 250 + float(1), 110, t, { alpha: enter(0.2), scale: lerp(0.6, 1, enter(0.2)), look: [-1, 0.5] });
    drawPlanet(BY_ID.saturn, 300, 800 + float(2), 72, t, { alpha: enter(0.35), scale: lerp(0.6, 1, enter(0.35)), look: [1, -0.5] });
    drawPlanet(BY_ID.earth, 330, 250 + float(3), 62, t, { alpha: enter(0.5), scale: lerp(0.6, 1, enter(0.5)), look: [1, 0.5] });
    drawPlanet(BY_ID.neptune, 1600, 820 + float(4), 56, t, { alpha: enter(0.65), scale: lerp(0.6, 1, enter(0.65)), look: [-1, -0.5] });
    popText('我们的太阳系', W / 2, 420, T.type.hero, 0.5, lt, { colors: ['#FFD86B', '#FF9E7A', '#8FD8FF', '#9EE6A8', '#FFB4D0', '#FFD86B'] });
    const sp = prog(lt, 1.6, T.dur.slow);
    text('一起去宇宙旅行吧！', W / 2, 560 + (1 - easeOut(sp)) * 30, T.type.h2, { alpha: easeOut(sp), color: T.color.muted });
    const rp = easeOut(prog(lt, 1.0, 1.6));
    const xp = easeIn(prog(t, sc.end - 1.6, 1.0));
    const rx = lerp(-200, 960, rp) + xp * 1300, ry = lerp(900, 735, rp) + Math.sin(t * 2.4) * 8 - xp * 420;
    drawRocket(rx, ry, 1.15, lerp(-0.5, -0.06, rp) - xp * 0.35, t);
  };

  SCENES.sun = (sc, lt, t) => {
    const [l1, l2] = sc.lines;
    const grow = backOut(prog(lt, 0.1, 1.0));
    const shift = easeInOut(prog(t, l2.start - 0.2, 1.0));
    const sx = lerp(820, 700, shift), sy = 500;
    const sr = 300 * grow;
    if (sr > 1) drawSun(sx, sy + Math.sin(t * 0.8) * 6, sr, t, { mouth: lt < l1.end ? 'open' : 'smile' });
    const cx = 1240;
    badge('恒星', cx, 300, prog(t, atPhrase(l1, '恒星') - 0.2, T.dur.base), T.color.accent);
    text('太阳', cx, 410, T.type.h1, { align: 'left', alpha: easeOut(prog(lt, 0.4, T.dur.base)) });
    chip(cx, 540, 560, '本领', '发光发热', '#FFB938', prog(t, atPhrase(l1, '发光'), T.dur.base));
    const ep = prog(t, l2.start + 0.2, T.dur.slow);
    if (ep > 0) {
      const ex = sx - 440, ey = sy + 250;
      ctx.save();
      ctx.globalAlpha = easeOut(ep);
      drawPlanet(BY_ID.earth, ex, ey, 9 * backOut(ep), t, { face: false });
      ctx.strokeStyle = T.color.mint;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ex, ey, 22 + Math.sin(t * 5) * 3, 0, TAU);
      ctx.stroke();
      text('地球在这里', ex, ey + 62, T.type.small, { color: T.color.mint });
      ctx.restore();
    }
    const cp = prog(t, atPhrase(l2, '一百三十万') - 0.3, 1.6);
    if (cp > 0) {
      const n = Math.round(easeOut(cp) * 130);
      chip(cx, 680, 560, '能装下', `${n} 万个地球`, '#5FBF62', clamp(cp * 3));
    }
  };

  function orbitSystem(cx, cy, scale, t, o) {
    const rxs = [150, 215, 285, 355, 480, 600, 715, 830];
    const sizes = [11, 16, 17, 13, 36, 30, 22, 21];
    // Angles at o.refT, hand-placed so name labels never collide around that moment.
    const start = [-0.6, 1.7, -1.75, 2.9, 0.9, 0.1, -2.3, 2.15];
    const items = PLANETS.map((p, i) => {
      const rx = rxs[i] * scale, ry = rx * 0.4;
      const ang = start[i] + (t - o.refT) * (1.1 / Math.pow(i + 1, 0.85));
      return { p, i, rx, ry, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, s: sizes[i] * scale * (o.sizeBoost || 1), depth: Math.sin(ang) };
    });
    ctx.save();
    ctx.lineWidth = 2;
    items.forEach((it) => {
      const hl = o.highlight ? o.highlight(it.i) : 0;
      ctx.strokeStyle = `rgba(255,255,255,${0.14 + hl * 0.4})`;
      ctx.globalAlpha = o.orbitAlpha;
      ctx.beginPath();
      ctx.ellipse(cx, cy, it.rx, it.ry, 0, 0, TAU);
      ctx.stroke();
    });
    ctx.restore();
    const drawItem = (it) => {
      const a = o.appear(it.i);
      if (a <= 0) return;
      drawPlanet(it.p, it.x, it.y, it.s * backOut(a), t, { alpha: clamp(a * 2), look: [(cx - it.x) / 800, (cy - it.y) / 400] });
      const lp = o.label ? o.label(it.i) : 0;
      if (lp > 0) text(it.p.name, it.x, it.y - it.s - 34 + (1 - easeOut(lp)) * 12, 38, { alpha: easeOut(lp) });
    };
    items.filter((it) => it.depth < 0).forEach(drawItem);
    drawSun(cx, cy, 64 * scale * (o.sunScale || 1), t, { alpha: o.sunAlpha });
    items.filter((it) => it.depth >= 0).forEach(drawItem);
  }

  SCENES.family = (sc, lt, t) => {
    const [l1, l2] = sc.lines;
    const sp = easeOut(prog(lt, 0, 0.9));
    orbitSystem(W / 2, 520, 1, t, {
      refT: l2.start + 2,
      orbitAlpha: easeOut(prog(lt, 0.3, 1.2)),
      sunAlpha: sp,
      sunScale: lerp(1.6, 1, sp),
      appear: (i) => prog(t, l1.start + 0.4 + i * 0.28, T.dur.base),
      label: (i) => prog(t, l2.start + 0.5 + i * 0.42, T.dur.base),
      highlight: (i) => {
        const at = l2.start + 0.5 + i * 0.42;
        return clamp(1 - Math.abs(t - at - 0.2) / 0.5);
      },
    });
  };

  function planetScene(sc, lt, t) {
    const p = BY_ID[sc.id];
    const L = sc.lines;
    const enter = prog(lt, 0.15, 0.9);
    let px = 640 + (1 - easeOut(enter)) * 380, py = 520 + Math.sin(t * 1.1) * 10;
    let pr = p.r;
    let rot = lt * 0.035;
    const extraBack = [], extraFront = [];

    if (p.id === 'mercury') {
      const sp = prog(t, L[1].start, 0.6) * (1 - prog(t, L[1].end + 0.4, 0.6));
      rot = lt * 0.035 + easeInOut(prog(t, L[1].start, L[1].end - L[1].start)) * 1.5;
      extraBack.push(() => {
        if (sp <= 0) return;
        ctx.save();
        ctx.lineCap = 'round';
        const R = rng(5);
        for (let i = 0; i < 9; i++) {
          const yy = py + (R() - 0.5) * pr * 1.6;
          const len = 120 + R() * 220;
          const off = frac(t * 1.6 + R()) * 180;
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * sp})`;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(px - pr * 0.6 - off, yy);
          ctx.lineTo(px - pr * 0.6 - off - len * sp, yy);
          ctx.stroke();
        }
        ctx.restore();
      });
    }
    if (p.id === 'venus') {
      extraFront.push(() => {
        const tp = prog(t, L[1].start + 0.2, 0.5);
        if (tp <= 0) return;
        const fill = easeOut(prog(t, atPhrase(L[1], '表面') - 0.2, 1.6));
        const x = 940, top = 300, bot = 700;
        ctx.save();
        ctx.globalAlpha = easeOut(tp);
        roundRect(x - 22, top, 44, bot - top, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, bot + 14, 42, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FF5E57';
        ctx.beginPath();
        ctx.arc(x, bot + 14, 32, 0, TAU);
        ctx.fill();
        const h = (bot - top - 20) * fill;
        roundRect(x - 12, bot - h, 24, h + 10, 12);
        ctx.fill();
        text(`${Math.round(lerp(20, 460, fill))}°C`, x, top - 46, T.type.h2, { color: '#FFB0A0' });
        ctx.restore();
      });
    }
    if (p.id === 'earth') {
      const mp = prog(t, L[2].start, T.dur.slow);
      if (mp > 0) {
        const ang = (t - L[2].start) * 1.4 - 0.8;
        const mx = Math.cos(ang) * pr * 1.6, my = Math.sin(ang) * pr * 0.38 - pr * 0.1;
        const draw = () => {
          ctx.save();
          ctx.globalAlpha = easeOut(mp);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 2;
          ctx.restore();
          drawPlanet({ id: 'mercury', index: 20, base: '#D9D6CF', dark: '#8E8A84', light: '#F4F2EC' }, px + mx, py + my, pr * 0.26 * backOut(mp), t, { look: [-Math.cos(ang), 0] });
        };
        (Math.sin(ang) < 0 ? extraBack : extraFront).push(draw);
      }
    }
    if (p.id === 'jupiter') {
      rot = -(lt - (L[1].start - sc.start) - 0.5) * 0.01 - 0.08;
      extraFront.push(() => {
        const hp = prog(t, atPhrase(L[1], '大红斑') - 0.1, T.dur.slow);
        if (hp <= 0) return;
        const s = project(pr, ...SPOT, rot);
        const sx = px + s.x, sy = py + s.y;
        ctx.save();
        ctx.globalAlpha = easeOut(hp);
        ctx.strokeStyle = T.color.accent;
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.ellipse(sx, sy, s.sx + 18, s.sy * 0.62 + 18, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        const ep = prog(t, atPhrase(L[1], '比地球') - 0.1, T.dur.slow);
        if (ep > 0) {
          const ex = px - pr - 70, ey = sy + 10;
          drawPlanet(BY_ID.earth, ex, ey, (s.sy / 1.3) * backOut(ep), t, { face: false });
          text('地球', ex, ey + s.sy / 1.3 + 36, T.type.small, { color: T.color.mint, alpha: easeOut(ep) });
        }
        ctx.restore();
      });
    }
    if (p.id === 'uranus') {
      extraFront.push(() => {
        const ap = prog(t, atPhrase(L[1], '躺着') - 0.2, T.dur.slow);
        if (ap <= 0) return;
        ctx.save();
        ctx.globalAlpha = easeOut(ap);
        ctx.strokeStyle = T.color.mint;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        const a0 = -Math.PI * 0.85, a1 = a0 + Math.PI * 0.7 * easeOut(ap);
        ctx.beginPath();
        ctx.arc(px, py, pr + 60, a0 + t * 0.6, a1 + t * 0.6);
        ctx.stroke();
        const ae = a1 + t * 0.6;
        const hx = px + Math.cos(ae) * (pr + 60), hy = py + Math.sin(ae) * (pr + 60);
        ctx.translate(hx, hy);
        ctx.rotate(ae + Math.PI / 2);
        ctx.fillStyle = T.color.mint;
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(-12, -16);
        ctx.lineTo(-12, 16);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      rot = lt * 0.08;
    }
    if (p.id === 'neptune') {
      const wp = 0.35 + 0.65 * prog(t, atPhrase(L[1], '风') - 0.2, 0.6);
      const streaks = (front) => () => {
        ctx.save();
        ctx.lineCap = 'round';
        const R = rng(17);
        for (let i = 0; i < 10; i++) {
          const k = 1.12 + R() * 0.45, tilt = (R() - 0.5) * 0.5, speed = 1.2 + R() * 1.6, len = 0.5 + R() * 0.7;
          const a = frac(t * speed * 0.25 * wp + R()) * TAU;
          const isFront = Math.sin(a) > 0;
          if (isFront !== front) continue;
          ctx.strokeStyle = `rgba(220,235,255,${0.55 * wp})`;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.ellipse(px, py, pr * k, pr * k * 0.32, tilt, a - len, a);
          ctx.stroke();
        }
        ctx.restore();
      };
      extraBack.push(streaks(false));
      extraFront.push(streaks(true));
      rot = lt * 0.06;
    }

    extraBack.forEach((f) => f());
    drawPlanet(p, px, py, pr, t, { rot, alpha: clamp(enter * 2), scale: lerp(0.55, 1, backOut(enter)), look: [0.6, 0.1] });
    extraFront.forEach((f) => f());

    journeyBar(p.index, lt);
    const cx = 1100;
    badge(STATION[p.index], cx, 250, prog(lt, 0.5, T.dur.base), T.color.accent);
    const np = prog(lt, 0.7, T.dur.base);
    text(p.name, cx + (1 - easeOut(np)) * 40, 370, T.type.h1, { align: 'left', alpha: easeOut(np), color: p.light });
    const chips = CHIPS[p.id];
    const perLine = {};
    chips.forEach(([label, value, li], k) => {
      const nth = (perLine[li] = (perLine[li] || 0) + 1) - 1;
      const at = L[li].start + 0.3 + nth * 0.35;
      chip(cx, 490 + k * 126, 640, label, value, p.base, prog(t, at, T.dur.base));
    });

    if (p.id === 'mars') {
      const mp = prog(t, atPhrase(L[1], '珠穆朗玛峰') - 0.6, T.dur.slow);
      if (mp > 0) {
        const base = 872, x1 = cx + 150, x2 = cx + 430;
        const grow = easeOut(mp);
        const mountain = (x, h, w, color, label) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x - w / 2, base);
          ctx.quadraticCurveTo(x - w * 0.1, base - h * grow * 1.05, x, base - h * grow);
          ctx.quadraticCurveTo(x + w * 0.1, base - h * grow * 1.05, x + w / 2, base);
          ctx.closePath();
          ctx.fill();
          text(label, x, base - h * grow - 30, T.type.small, { alpha: grow });
        };
        ctx.save();
        ctx.globalAlpha = clamp(mp * 2);
        mountain(x1, 56, 150, '#8FA3C8', '珠峰');
        mountain(x2, 140, 330, '#E3703F', '奥林匹斯山');
        ctx.restore();
      }
    }
  }
  for (const p of PLANETS) SCENES[p.id] = planetScene;

  SCENES.compare = (sc, lt, t) => {
    const [l1, l2] = sc.lines;
    const maxR = 150;
    const rs = PLANETS.map((p) => Math.max(8, (p.km / 69911) * maxR));
    const extra = PLANETS.map((p) => (p.id === 'saturn' ? rs[5] * 0.75 : 0));
    const gap = 40;
    const slot = rs.map((r, i) => Math.max(2 * r + 2 * extra[i], 120));
    const total = slot.reduce((a, b) => a + b, 0) + gap * 7;
    let x = W / 2 - total / 2;
    const baseY = 470;
    const bigAt = atPhrase(l1, '木星最大');
    const smallAt = atPhrase(l1, '水星最小');
    const chars = [...'水金地火木土天海'];
    const charAt = chars.map((c) => atPhrase(l2, c + (c === '海' ? '' : '、')));
    PLANETS.forEach((p, i) => {
      x += slot[i] / 2;
      const a = prog(t, sc.start + 0.4 + i * 0.16, T.dur.base);
      let bounce = 0;
      const hit = (at) => {
        const d = t - at;
        return d > 0 && d < 0.6 ? Math.sin((d / 0.6) * Math.PI) : 0;
      };
      bounce = hit(charAt[i]) * 30;
      if (i === 4) bounce += hit(bigAt) * 40;
      if (i === 0) bounce += hit(smallAt) * 40;
      const y = baseY - bounce;
      drawPlanet(p, x, y, rs[i] * backOut(a), t, { alpha: clamp(a * 2), look: [0, 0.5] });
      text(p.name, x, baseY + maxR + 50, 40, { alpha: easeOut(a) });
      if (i === 4) {
        const cp = prog(t, bigAt, T.dur.slow);
        if (cp > 0) badge('最大', x - 60, y - rs[i] - 60, cp, T.color.accent);
      }
      if (i === 0) {
        const cp = prog(t, smallAt, T.dur.slow);
        if (cp > 0) {
          ctx.save();
          ctx.globalAlpha = easeOut(cp);
          ctx.strokeStyle = T.color.mint;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(x, y, 34 + Math.sin(t * 5) * 3, 0, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + 24, y + 24);
          ctx.lineTo(x + 58, y + 58);
          ctx.stroke();
          ctx.restore();
          badge('最小', x - 50, y - 100, cp, T.color.mint);
        }
      }
      x += slot[i] / 2 + gap;
    });
    const cw = 120, cx0 = W / 2 - (cw * 7) / 2;
    chars.forEach((c, i) => {
      const p = prog(t, charAt[i] - 0.15, T.dur.base);
      if (p <= 0) return;
      ctx.save();
      ctx.translate(cx0 + i * cw, 800);
      ctx.scale(backOut(p), backOut(p));
      ctx.fillStyle = PLANETS[i].base;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, 54, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      text(c, 0, 2, 70, { color: T.color.ink, shadow: false });
      ctx.restore();
    });
  };

  SCENES.outro = (sc, lt, t) => {
    const [l1, l2] = sc.lines;
    orbitSystem(W / 2, 560, 0.62, t, {
      refT: sc.start,
      orbitAlpha: easeOut(prog(lt, 0, 0.8)),
      sunAlpha: 1,
      sizeBoost: 1.5,
      appear: (i) => prog(lt, 0.1 + i * 0.08, T.dur.base),
    });
    popText('太阳系真奇妙！', W / 2, 210, T.type.hero, 0.3, lt, { colors: ['#FFD86B', '#FF9E7A', '#8FD8FF', '#9EE6A8', '#FFB4D0', '#FFD86B', '#8FD8FF'] });
    const bp = prog(t, atPhrase(l2, '再见') - 0.3, T.dur.slow);
    if (bp > 0) {
      ctx.save();
      ctx.translate(W / 2, 800);
      ctx.scale(backOut(bp), backOut(bp));
      text('下次见！', 0, 0, T.type.h2, { color: T.color.accent });
      ctx.restore();
    }
    const rp = prog(t, l2.start, 4);
    const a = rp * TAU * 1.2 - Math.PI / 2;
    drawRocket(W / 2 + Math.cos(a) * 700, 560 + Math.sin(a) * 300, 0.7, a + Math.PI / 2, t);
    const fade = easeIn(prog(t, sc.end - 1.4, 1.4));
    if (fade > 0) {
      ctx.fillStyle = `rgba(11,14,43,${fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  // ---------- subtitles ----------
  function wrapLines(str, size, maxW) {
    if (measure(str, size) <= maxW) return [str];
    const chars = [...str];
    let best = Math.floor(chars.length / 2), bestScore = Infinity;
    chars.forEach((c, i) => {
      if (i < 4 || i > chars.length - 4) return;
      const punct = '，。！？：、'.includes(chars[i - 1]) ? 0 : 6;
      const score = Math.abs(i - chars.length / 2) + punct;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return [chars.slice(0, best).join(''), chars.slice(best).join('')];
  }

  function subtitles(t) {
    const lines = TL.scenes.flatMap((s) => s.lines);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const next = lines[i + 1];
      const end = Math.min(l.end + 0.35, next ? next.start - 0.12 : Infinity);
      if (t < l.start - 0.15 || t > end) continue;
      const a = Math.min(prog(t, l.start - 0.15, T.dur.fast), 1 - prog(t, end - T.dur.fast, T.dur.fast));
      const rows = wrapLines(l.text, T.type.body, 1500);
      const w = Math.max(...rows.map((r) => measure(r, T.type.body))) + 96;
      const h = rows.length * 66 + 30;
      const cy = 962 - (rows.length - 1) * 33;
      ctx.save();
      ctx.globalAlpha = easeOut(a);
      roundRect(W / 2 - w / 2, cy - h / 2 + (rows.length - 1) * 33, w, h, 40);
      ctx.fillStyle = T.color.subBg;
      ctx.fill();
      rows.forEach((r, k) => text(r, W / 2, cy + k * 66 + (rows.length - 1) * 33 - (rows.length - 1) * 33 + 2, T.type.body, { shadow: false }));
      ctx.restore();
    }
  }

  // ---------- transitions ----------
  function sceneAt(t) {
    const S = TL.scenes;
    let i = S.findIndex((s) => t < s.end);
    if (i < 0) i = S.length - 1;
    return i;
  }

  function drawScene(i, t) {
    const s = TL.scenes[i];
    SCENES[s.id](s, t - s.start, t);
  }

  function seek(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const S = TL.scenes;
    const half = T.transition / 2;
    const i = sceneAt(t);
    let prev = -1, next = -1;
    if (i + 1 < S.length && t > S[i].end - half) { prev = i; next = i + 1; }
    else if (i > 0 && t < S[i].start + half) { prev = i - 1; next = i; }

    drawBackground(t);
    if (prev < 0) {
      drawScene(i, t);
    } else {
      const b = S[next].start;
      const p = easeInOut(prog(t, b - half, T.transition));
      const edge = lerp(-260, W + 260, p);
      const ry = 540 + Math.sin(p * Math.PI * 2) * 120;
      drawScene(prev, t);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      for (let y = -10; y <= H + 10; y += 30) ctx.lineTo(edge - 60 - Math.abs(y - ry) * 0.35 + Math.sin(y * 0.03 + t * 8) * 14, y);
      ctx.lineTo(-10, H + 10);
      ctx.closePath();
      ctx.clip();
      drawBackground(t);
      drawScene(next, t);
      ctx.restore();
      const R = rng(next * 31 + 3);
      for (let k = 0; k < 26; k++) {
        const y = R() * H;
        const x = edge - 60 - Math.abs(y - ry) * 0.35 - R() * 60;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 20 + k);
        ctx.fillStyle = k % 3 ? '#FFF2B0' : '#9FE8FF';
        ctx.beginPath();
        ctx.arc(x, y, 2 + R() * 4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const slope = Math.cos(p * Math.PI * 2) * 0.35;
      drawRocket(edge, ry, 1.3, slope, t);
    }
    vignette();
    subtitles(t);
  }

  /** Sound cues derived from the same timeline, consumed by the audio mixer. */
  function cues() {
    const out = [];
    const S = TL.scenes;
    for (let i = 1; i < S.length; i++) out.push({ t: S[i].start - T.transition / 2, type: 'whoosh' });
    out.push({ t: 0.5, type: 'chime' });
    out.push({ t: S[0].start + 1.0, type: 'whoosh' });
    const sun = sceneById('sun');
    out.push({ t: sun.start + 0.2, type: 'chime' });
    out.push({ t: atPhrase(sun.lines[1], '一百三十万') - 0.3, type: 'sparkle' });
    const fam = sceneById('family');
    PLANETS.forEach((p, i) => out.push({ t: fam.lines[0].start + 0.4 + i * 0.28, type: 'pop', pitch: i }));
    for (const p of PLANETS) {
      const sc = sceneById(p.id);
      out.push({ t: sc.start + 0.2, type: 'chime', pitch: p.index });
      const perLine = {};
      CHIPS[p.id].forEach(([, , li]) => {
        const nth = (perLine[li] = (perLine[li] || 0) + 1) - 1;
        out.push({ t: sc.lines[li].start + 0.3 + nth * 0.35, type: 'sparkle' });
      });
    }
    const cmp = sceneById('compare');
    PLANETS.forEach((p, i) => out.push({ t: cmp.start + 0.4 + i * 0.16, type: 'pop', pitch: i }));
    [...'水金地火木土天海'].forEach((c, i) => out.push({ t: atPhrase(cmp.lines[1], c + (c === '海' ? '' : '、')) - 0.15, type: 'pop', pitch: i }));
    const outro = sceneById('outro');
    out.push({ t: outro.start + 0.3, type: 'chime' });
    out.push({ t: atPhrase(outro.lines[1], '再见') - 0.3, type: 'sparkle' });
    return out.sort((a, b) => a.t - b.t).map((c) => Object.assign(c, { t: Math.round(c.t * 1000) / 1000 }));
  }

  async function init(timeline) {
    TL = timeline;
    const f = new FontFace('Kuaile', 'url(fonts/ZCOOLKuaiLe-Regular.ttf)');
    document.fonts.add(await f.load());
    await document.fonts.ready;
    seek(0);
    return { duration: TL.duration, fps: TL.fps };
  }

  window.solar = { init, seek, cues };
})();
