#!/usr/bin/env node
/*
 * Frame-by-frame renderer.
 *   node tools/render.js                 full video -> build/video.mp4 (+ build/cues.json)
 *   node tools/render.js --stills 3,40   PNG stills -> build/stills/
 *   node tools/render.js --check         determinism + non-static gates
 * Options: --workers N  --fps N  --from S --to S
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.wav': 'audio/wav' };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/scene/index.html`);
  const info = await page.evaluate(() => window.ready);
  if (errors.length) throw new Error(errors.join('\n'));
  // Playwright's page.screenshot PNG path is ~5x slower than CDP's speed-optimized lossless PNG.
  page.cdp = await page.context().newCDPSession(page);
  return { page, info, errors };
}

async function frame(page, t) {
  await page.evaluate((tt) => window.scene.seek(tt), t);
  const { data } = await page.cdp.send('Page.captureScreenshot', {
    format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

function encoder(out, fps) {
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error(`ffmpeg ${c}`)) : res())));
  return { ff, done };
}

async function renderChunk(browser, port, fps, a, b, out, onFrame) {
  const { page } = await openPage(browser, port);
  const { ff, done } = encoder(out, fps);
  for (let f = a; f < b; f++) {
    const png = await frame(page, f / fps);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    onFrame();
  }
  ff.stdin.end();
  await done;
  await page.close();
}

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function main() {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const { page, info } = await openPage(browser, port);
    const fps = Number(opt('fps', info.fps));
    const cues = await page.evaluate(() => window.scene.cues());
    fs.writeFileSync(path.join(BUILD, 'cues.json'), JSON.stringify(cues, null, 1));

    if (args.includes('--stills')) {
      const dir = path.join(BUILD, 'stills');
      fs.mkdirSync(dir, { recursive: true });
      for (const s of opt('stills', '').split(',').filter(Boolean)) {
        const file = path.join(dir, `t${Number(s).toFixed(2).padStart(7, '0')}.png`);
        fs.writeFileSync(file, await frame(page, Number(s)));
        console.log(file);
      }
      return;
    }

    if (args.includes('--check')) {
      const src = fs.readFileSync(path.join(ROOT, 'scene', 'melon.js'), 'utf8');
      const banned = ['Date.now', 'performance.now', 'requestAnimationFrame', 'Math.random', 'setTimeout', 'setInterval'];
      const hits = banned.filter((b) => src.includes(b));
      if (hits.length) throw new Error(`non-deterministic APIs in scene: ${hits.join(', ')}`);
      const probes = [0.5, 9.7, 27.3, 61.2, info.duration * 0.62, info.duration - 2];
      const first = [];
      for (const t of probes) first.push(sha(await frame(page, t)));
      for (let i = probes.length - 1; i >= 0; i--) {
        const again = sha(await frame(page, probes[i]));
        if (again !== first[i]) throw new Error(`frame at ${probes[i]}s differs on re-render`);
      }
      if (new Set(first).size !== first.length) throw new Error('distinct timestamps produced identical frames');
      const a = sha(await frame(page, 30)), b = sha(await frame(page, 30 + 1 / fps));
      if (a === b) throw new Error('adjacent frames identical: scene is static');
      console.log(`check ok: ${probes.length} probes deterministic, scene animates, no banned APIs`);
      return;
    }
    await page.close();

    const from = Number(opt('from', 0)), to = Number(opt('to', info.duration));
    const total = Math.ceil((to - from) * fps);
    const first = Math.round(from * fps);
    const workers = Number(opt('workers', 4));
    const per = Math.ceil(total / workers);
    const chunkDir = path.join(BUILD, 'chunks');
    fs.rmSync(chunkDir, { recursive: true, force: true });
    fs.mkdirSync(chunkDir, { recursive: true });
    let doneFrames = 0;
    const t0 = Date.now();
    const tick = () => {
      doneFrames++;
      if (doneFrames % 150 === 0 || doneFrames === total) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${doneFrames}/${total} frames  ${(doneFrames / el).toFixed(1)} fps  eta ${((total - doneFrames) / (doneFrames / el)).toFixed(0)}s`);
      }
    };
    const chunks = [];
    const jobs = [];
    for (let w = 0; w < workers; w++) {
      const a = first + w * per, b = Math.min(first + total, a + per);
      if (a >= b) continue;
      const out = path.join(chunkDir, `c${w}.mp4`);
      chunks.push(out);
      jobs.push(renderChunk(browser, port, fps, a, b, out, tick));
    }
    await Promise.all(jobs);
    const list = path.join(chunkDir, 'list.txt');
    fs.writeFileSync(list, chunks.map((c) => `file '${c}'`).join('\n'));
    await new Promise((res, rej) => {
      const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(BUILD, 'video.mp4')], { stdio: 'inherit' });
      ff.on('close', (c) => (c ? rej(new Error('concat failed')) : res()));
    });
    console.log(`video: build/video.mp4 (${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
