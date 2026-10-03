/* _zoom.js - wait for a fire puff, then capture a zoomed PNG of just the
   #dragon canvas so the sprite can be reviewed by eye.
   Usage: node _zoom.js [width] [scale] [hot|gap]   (defaults: 390 5 hot)
   hot = shoot while the white-hot core is on screen
   gap = shoot at the worst case for attachment: a burning puff (>=120 bright
         px) with no bright block on mouth cell 24                              */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9334);
const PAGE = 'file:///C:/Xampp/htdocs/Trade_Ryuusd/index.html';
const HERE = __dirname;
const W = Number(process.argv[2]) || 390;
const SCALE = Number(process.argv[3]) || 5;
const MODE = (process.argv[4] || 'hot').toLowerCase();   /* hot | gap */
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* flames are the only yellow/orange pixels on the canvas.  Two masks:
     hot = white-hot core  #ffe066, mid = orange body #ff8a00.
   `m` (bright) is the union of both, `m24` counts bright pixels in canvas
   col 24 - the mouth cell that touches the red snout (sprite red stops at
   col 23).  Returns the pixel counts plus the column span, so the muzzle gap
   is measured at shot time.  mode=gap hunts for the worst case instead:
   a real puff burning while nothing bright sits on the mouth cell. */
const SPAN = `(() => {
  const c = document.getElementById('dragon');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const cell = c.width / 34;                 /* CELL can be 4..8px, stay generic */
  let n = 0, m = 0, m24 = 0, lo = -1, hi = -1;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 40) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const hot = r > 235 && g > 150 && g < 245 && b < 130;
    const mid = r > 240 && g >= 100 && g < 205 && b < 60;
    if (!hot && !mid) continue;
    const col = Math.floor(((i / 4) % c.width) / cell);
    if (hot) n++;
    m++;
    if (col === 24) m24++;
    if (lo < 0 || col < lo) lo = col;
    if (col > hi) hi = col;
  }
  return { n: n, m: m, m24: m24, lo: lo, hi: hi };
})()`;

const BOX = `(() => {
  const c = document.getElementById('dragon');
  c.scrollIntoView({ block: 'center' });
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width, ch: c.height };
})()`;

/* Raw RGB of the mouth band (canvas rows 7-9) column by column, anchored on the
   sprite itself.  The sprite sways +-10px with `drift` and the flame gets the
   same offset, so a fixed column would compare the flame against the wrong cell
   - instead we locate the snout tip (longest run of sprite red #e10600 on the
   mouth row) and count flame pixels relative to it.  Masks match _align.js:
   hot = #ffe066 core, body = #ff8a00, soft = a block at 40% alpha (over the dark
   mouth pixel k=#140000 that is ~(114,55,0)), which the bright masks cannot see. */
const RAW = `(() => {
  const c = document.getElementById('dragon');
  const cell = c.width / 34;
  const y0 = Math.round(7 * cell), h = Math.round(3 * cell);
  const d = c.getContext('2d').getImageData(0, y0, c.width, h).data;
  const my = Math.round(cell / 2);
  let run = 0, best = 0, bestEnd = -1;
  for (let x = 0; x < c.width; x++) {
    const i = (my * c.width + x) * 4;
    const red = d[i + 3] > 40 && d[i] > 150 && d[i + 1] < 60 && d[i + 2] < 60;
    if (red) { run++; if (run > best) { best = run; bestEnd = x; } } else { run = 0; }
  }
  const snout = bestEnd < 0 ? -1 : Math.floor(bestEnd / cell);
  const out = [];
  for (let col = 19; col <= 31; col++) {
    const x0 = Math.floor(col * cell), x1 = Math.floor((col + 1) * cell);
    let mr = 0, mg = 0, hot = 0, body = 0, soft = 0;
    for (let y = 0; y < h; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] <= 40) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r > mr) mr = r;
        if (g > mg) mg = g;
        if (r > 235 && g > 150 && g < 245 && b < 130) hot++;
        else if (r > 240 && g >= 100 && g < 205 && b < 60) body++;
        else if (r > 100 && g > 30 && b < 60) soft++;
      }
    }
    out.push({ col: col, maxR: mr, maxG: mg, hot: hot, body: body, soft: soft,
               flame: hot + body + soft });
  }
  const fLo = out.reduce(function (m, b2) { return (m < 0 && b2.flame > 0) ? b2.col : m; }, -1);
  return { snout: snout, fLo: fLo, cols: out };
})()`;

function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.addEventListener('message', function (ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
        return;
      }
      if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].method === msg.method) { const w = waiters.splice(i, 1)[0]; w.res(msg.params); }
        }
      }
    });
    ws.addEventListener('error', function () { reject(new Error('websocket error')); });
    ws.addEventListener('open', function () {
      resolve({
        send: function (method, params, sessionId) {
          return new Promise(function (res, rej) {
            const m = { id: ++id, method: method, params: params || {} };
            if (sessionId) m.sessionId = sessionId;
            pending.set(m.id, { res: res, rej: rej });
            ws.send(JSON.stringify(m));
          });
        },
        waitFor: function (method, ms) {
          return new Promise(function (res, rej) {
            const w = { method: method, res: res };
            waiters.push(w);
            setTimeout(function () {
              const i = waiters.indexOf(w);
              if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout: ' + method)); }
            }, ms || 12000);
          });
        },
        close: function () { try { ws.close(); } catch (e) {} }
      });
    });
  });
}

async function waitForPort() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('DevTools port ' + PORT + ' never came up');
}


(async function main() {
  const profile = path.join(HERE, '_crzoom');
  const child = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--allow-file-access-from-files', '--disable-extensions',
    '--force-device-scale-factor=1',
    'about:blank'
  ], { stdio: 'ignore' });

  const ver = await waitForPort();
  const cdp = await connect(ver.webSocketDebuggerUrl);
  const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const a = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: Math.round(W * 2.05), deviceScaleFactor: 1, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 }
  }, sid);

  const loaded = cdp.waitFor('Page.loadEventFired', 20000).catch(function () {});
  await cdp.send('Page.navigate', { url: PAGE + '?zoom=' + Date.now() }, sid);
  await loaded;
  await sleep(900);

  /* Poll fast: the white-hot phase only lasts ~340ms per puff, so waiting
     after a hit would photograph the cooled tail instead of the flame.
     mode=gap instead waits for a puff that is genuinely burning (>=120 bright
     px) while the mouth cell 24 holds no bright block at all - the worst case
     for attachment - so the PNG shows whether that reads as a real gap. */
  let hit = { n: 0, m: 0, m24: 0, lo: -1, hi: -1 }, tries = 0, atShot = null;
  for (; tries < 60; tries++) {
    const r = await cdp.send('Runtime.evaluate', { expression: SPAN, returnByValue: true }, sid);
    hit = r.result.value || { n: 0, m: 0, m24: 0, lo: -1, hi: -1 };
    if (MODE === 'gap' ? (hit.m > 120 && hit.m24 === 0) : hit.n > 60) break;
    await sleep(MODE === 'gap' ? 90 : 150);
  }
  await sleep(40);                                /* let the jet stretch a touch */

  const box = await cdp.send('Runtime.evaluate', { expression: BOX, returnByValue: true }, sid);
  const b = box.result.value;
  const chk = await cdp.send('Runtime.evaluate', { expression: SPAN, returnByValue: true }, sid);
  atShot = chk.result.value || { n: 0, m: 0, m24: 0, lo: -1, hi: -1 };
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true,
    clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: SCALE }
  }, sid);
  const file = path.join(HERE, MODE === 'gap' ? '_dragon-gap.png' : '_dragon.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('width=' + W + ' scale=' + SCALE + ' mode=' + MODE + ' polls=' + tries +
    ' corePx=' + hit.n + ' brightPx=' + hit.m + '   at shot: brightPx=' + atShot.m +
    ' mouthCellPx=' + atShot.m24);
  console.log('bright columns at shot: ' + atShot.lo + '..' + atShot.hi +
    '   (red snout ends col 23, mouth cells 24-25) -> ' +
    (atShot.lo >= 0 && atShot.lo <= 24 ? 'core on the 1st mouth cell: welded'
      : atShot.lo === 25 ? 'core on the 2nd mouth cell: still inside the mouth'
        : 'core starts at col ' + atShot.lo + ': detached'));
  if (MODE === 'gap') {
    console.log(atShot.m24 === 0
      ? 'worst case captured: NO bright block on mouth cell 24 -> check the raw band'
      : 'the mouth cell was covered again (' + atShot.m24 + 'px) -> poll rate too slow');
  }

  /* Decisive test: anchor on the sprite's snout tip and measure how far right
     the flame starts, so the sprite's sway cannot fake a gap. */
  const raw = await cdp.send('Runtime.evaluate', { expression: RAW, returnByValue: true }, sid);
  const rr = raw.result.value || { snout: -1, fLo: -1, cols: [] };
  console.log('raw mouth band, rows 7-9   (hot/body = bright masks, soft = faded 40%-alpha block)');
  rr.cols.forEach(function (b) {
    console.log('  col ' + b.col + '  maxR=' + b.maxR + '  maxG=' + b.maxG +
      '  hot=' + b.hot + '  body=' + b.body + '  soft=' + b.soft);
  });
  const relGap = rr.fLo - rr.snout - 1;
  console.log('sprite snout tip col ' + rr.snout + ' -> mouth cells ' + (rr.snout + 1) + '-' +
    (rr.snout + 2) + ', leftmost flame col ' + rr.fLo + ' -> flame starts ' + relGap +
    ' cell(s) right of the snout tip');
  console.log(rr.fLo >= 0 && relGap <= 0
    ? 'WELDED: flame covers the mouth cell that touches the snout'
    : 'GAP: the mouth cell next to the snout is bare');
  console.log('canvas css=' + b.w + 'x' + b.h + ' backing=' + b.cw + 'x' + b.ch + ' -> ' + file);

  cdp.close();
  child.kill();
  setTimeout(function () { process.exit(0); }, 300);
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message));
  process.exit(1);
});
