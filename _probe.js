/* _probe.js - headless Chrome (CDP) probe.
   Sets an EXACT CSS viewport via Emulation.setDeviceMetricsOverride,
   measures every element that overflows, and writes a true DPR-1 PNG.
   Usage: node _probe.js [width ...]                                    */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const PAGE = 'file:///C:/Xampp/htdocs/Trade_Ryuusd/index.html';
const HERE = __dirname;

const argSizes = process.argv.slice(2).map(Number).filter(function (n) { return n > 0; });
const SIZES = (argSizes.length ? argSizes : [320, 360, 390, 414, 768, 1280]).map(function (w) {
  return { name: String(w), w: w, h: w >= 768 ? 900 : Math.round(w * 2.05), mobile: w < 768 };
});

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ---------- minimal CDP client over the built-in WebSocket ---------- */
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

/* ---------- measurement script (runs in the page) ---------- */
const MEASURE = `(async () => {
  try { await document.fonts.ready; } catch (e) {}
  const de = document.documentElement;
  const vw = de.clientWidth;
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/) : [];
    cls.forEach((c) => { if (c) s += '.' + c; });
    return s;
  };
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: desc(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      w: +r.width.toFixed(1), scrollW: el.scrollWidth,
      font: cs.fontSize, family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      white: cs.whiteSpace
    };
  };
  const over = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 0.5 || r.left < -0.5) over.push(info(el));
  });
  const key = {};
  ['.card', '.profile', '.name', '.tagline', '.stage', '#dragon', '.status',
   '.links', '.btn', '.btn--primary', '.btn__label', '.note', '.disclaimer'].forEach((s) => {
    const el = document.querySelector(s);
    if (el) key[s] = info(el);
  });
  return {
    viewport: { innerWidth: innerWidth, clientWidth: vw, scrollWidth: de.scrollWidth, bodyScrollW: document.body.scrollWidth },
    pixelFontLoaded: document.fonts.check('12px "Press Start 2P"'),
    overflowing: over.slice(0, 12),
    key: key
  };
})()`;

(async function main() {
  const profile = path.join(HERE, '_crprobe');
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

  for (const s of SIZES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.mobile,
      screenOrientation: { type: 'portraitPrimary', angle: 0 }
    }, sid);
    const loaded = cdp.waitFor('Page.loadEventFired', 20000).catch(function () {});
    await cdp.send('Page.navigate', { url: PAGE + '?probe=' + Date.now() }, sid);
    await loaded;
    await sleep(1000);
    const r = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true, awaitPromise: true }, sid);
    const out = r.result.value;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
    const file = path.join(HERE, '_shot-' + s.name + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('=== ' + s.name + 'px (request ' + s.w + 'x' + s.h + ') -> ' + file);
    console.log('SUMMARY ' + s.name + ' vw=' + out.viewport.clientWidth + ' scrollW=' + out.viewport.scrollWidth +
      ' dpr=' + (s.w) + ' overs=' + out.overflowing.length +
      (out.overflowing.length ? ' [' + out.overflowing.map(function (o) { return o.sel + ' L' + o.left + ' R' + o.right; }).join(' | ') + ']' : ''));
    fs.appendFileSync(path.join(HERE, '_probe.log'), '=== ' + s.name + '\n' + JSON.stringify(out, null, 1) + '\n');
  }

  cdp.close();
  child.kill();
  setTimeout(function () { process.exit(0); }, 300);
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message));
  process.exit(1);
});
