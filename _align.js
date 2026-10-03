/* _align.js - headless CDP diagnostic: is the fire plume attached to the mouth?
   Loads the real page, samples the #dragon canvas every ~35ms for a few
   seconds, keeps the frame with the MOST hot flame pixels, and prints a
   per-cell histogram so muzzle alignment is measured, not eyeballed.
   Usage: node _align.js [width] [searchMs]                                */
const { spawn } = require('child_process');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9335);
const PAGE = 'file:///C:/Xampp/htdocs/Trade_Ryuusd/index.html';
const HERE = __dirname;
const W = Number(process.argv[2]) || 390;
const SEARCH_MS = Number(process.argv[3]) || 6000;
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* Two flame masks, both bucketed into sprite cells so we can see exactly which
   columns light up:
     hot  = near-full-alpha white-hot core   #ffe066 (255,224,102)
     mid  = orange body                      #ff8a00 (255,138, 0)
   The white-hot core can start one cell right of the mouth while the orange
   body still covers it, so `warm` (hot OR mid) is what proves attachment.
   Sprite red #e10600 (g=6) and the eye #ffe6e6 (b=230) are both excluded. */
const FRAME = `(() => {
  const c = document.getElementById('dragon');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const cols = new Array(34).fill(0), warm = new Array(34).fill(0);
  const soft = new Array(34).fill(0), any = new Array(34).fill(0);
  const rows = new Array(16).fill(0);
  const sc = c.width / (34 * 8);
  /* Sprite anchor: the sprite sways +-10px with drift and the flame gets the
     same offset, so the mouth cells must be located from the drawing itself.
     On the mouth row the solid snout is the longest run of sprite red #e10600;
     its right end is the snout tip, so the mouth cells are snout+1 / snout+2. */
  const u = 8 * sc, myy = Math.round(7 * u + u / 2);
  let run = 0, best = 0, bestEnd = -1;
  for (let x = 0; x < c.width; x++) {
    const i = (myy * c.width + x) * 4;
    const red = d[i + 3] > 40 && d[i] > 150 && d[i + 1] < 60 && d[i + 2] < 60;
    if (red) { run++; if (run > best) { best = run; bestEnd = x; } } else { run = 0; }
  }
  const snout = bestEnd < 0 ? -1 : Math.floor(bestEnd / u);
  let hot = 0, mid = 0, ember = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (d[i + 3] <= 40) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const isHot = r > 235 && g > 150 && g < 245 && b < 130;   /* #ffe066 core */
    const isMid = r > 240 && g >= 100 && g < 205 && b < 60;   /* #ff8a00 body */
    const isSoft = r > 100 && g > 30 && b < 60;               /* 40%-alpha block */
    const col = Math.min(33, Math.floor(x / sc / 8));
    if (isHot) {
      hot++;
      cols[col]++;
      rows[Math.min(15, Math.floor(y / sc / 8))]++;
    }
    if (isHot || isMid) { if (isMid && !isHot) mid++; warm[col]++; any[col]++; }
    else if (isSoft) { soft[col]++; any[col]++; }
    else if (r > 140 && g < 90 && b < 90) { ember++; }
  }
  let fLo = -1, aLo = -1;
  for (let c = 0; c < 34; c++) {
    if (fLo < 0 && cols[c] > 0) fLo = c;
    if (aLo < 0 && any[c] > 0) aLo = c;
  }
  return { hot: hot, mid: mid, ember: ember, cols: cols, warm: warm, soft: soft,
           any: any, rows: rows, fLo: fLo, aLo: aLo, snout: snout,
           cw: c.width, ch: c.height };
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

function bar(n, scale) {
  const len = Math.round(n / scale);
  return len > 0 ? '#'.repeat(Math.min(len, 60)) : '';
}

(async function main() {
  const profile = path.join(HERE, '_cralign');
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
  await cdp.send('Page.navigate', { url: PAGE + '?align=' + Date.now() }, sid);
  await loaded;
  await sleep(600);

  const frames = [];                 /* every sampled frame that had flame */
  let samples = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < SEARCH_MS) {
    const r = await cdp.send('Runtime.evaluate', { expression: FRAME, returnByValue: true }, sid);
    const v = r.result.value;
    samples++;
    if (v && v.hot + v.mid + v.ember > 0) { v.t = Date.now() - t0; frames.push(v); }
    await sleep(35);
  }
  if (!frames.length) { console.log('FAIL: no flame frame captured'); child.kill(); process.exit(1); }

  /* a "puff" = a run of consecutive frames that actually contain hot pixels */
  const hot = frames.filter(function (f) { return f.hot > 0; });
  /* lit = any flame pixel at all (white-hot core or orange body); attachment
     is judged on this, because the core may sit one cell right of the mouth
     while the orange body still covers it. */
  const lit = frames.filter(function (f) { return f.warm.some(function (n) { return n > 0; }); });
  const agg = new Array(34).fill(0), cnt = new Array(34).fill(0);
  hot.forEach(function (f) {
    for (let c = 0; c < 34; c++) { if (f.cols[c] > agg[c]) agg[c] = f.cols[c]; if (f.cols[c] > 0) cnt[c]++; }
  });
  const wAgg = new Array(34).fill(0), wCnt = new Array(34).fill(0);
  lit.forEach(function (f) {
    for (let c = 0; c < 34; c++) { if (f.warm[c] > wAgg[c]) wAgg[c] = f.warm[c]; if (f.warm[c] > 0) wCnt[c]++; }
  });
  /* any = bright body OR faded block; soft = faded block only.  These run over
     the `lit` frames - puffs that still have a bright flame body - because an
     ember-only tail frame has no yellow flame anywhere and would fake a gap. */
  const aAgg = new Array(34).fill(0), aCnt = new Array(34).fill(0);
  lit.forEach(function (f) {
    for (let c = 0; c < 34; c++) { if (f.any[c] > aAgg[c]) aAgg[c] = f.any[c]; if (f.any[c] > 0) aCnt[c]++; }
  });
  const sAgg = new Array(34).fill(0), sCnt = new Array(34).fill(0);
  lit.forEach(function (f) {
    for (let c = 0; c < 34; c++) { if (f.soft[c] > sAgg[c]) sAgg[c] = f.soft[c]; if (f.soft[c] > 0) sCnt[c]++; }
  });
  const rowsAgg = new Array(16).fill(0);
  hot.forEach(function (f) { for (let r2 = 0; r2 < 16; r2++) if (f.rows[r2] > rowsAgg[r2]) rowsAgg[r2] = f.rows[r2]; });

  const colsSpan = function (f) {
    let lo = -1, hi = -1;
    for (let c = 0; c < 34; c++) if (f.cols[c] > 0) { if (lo < 0) lo = c; hi = c; }
    return lo < 0 ? '-' : lo + '..' + hi;
  };
  const gapOf = function (f) {
    let lo = -1;
    for (let c = 0; c < 34; c++) if (f.cols[c] > 0) { lo = c; break; }
    return lo < 0 ? 99 : Math.max(0, lo - 24);      /* col 24 = mouth pixel on the snout */
  };
  const gapWarmOf = function (f) {
    for (let c = 0; c < 34; c++) if (f.warm[c] > 0) return Math.max(0, c - 24);
    return 99;
  };
  const attached = hot.filter(function (f) { return f.cols[24] > 0; }).length;
  const welded = lit.filter(function (f) { return f.warm[24] > 0; }).length;
  const worstWarm = lit.reduce(function (m, f) { return Math.max(m, gapWarmOf(f)); }, -99);
  const gapAnyOf = function (f) {
    for (let c = 0; c < 34; c++) if (f.any[c] > 0) return Math.max(0, c - 24);
    return 99;
  };
  const contact = lit.filter(function (f) { return f.any[24] > 0; }).length;
  const worstAny = lit.reduce(function (m, f) { return Math.max(m, gapAnyOf(f)); }, -99);

  const last = frames[frames.length - 1];
  console.log('width=' + W + ' samples=' + samples + ' flame-frames=' + frames.length +
    ' hot-frames=' + hot.length);
  console.log('canvas backing=' + last.cw + 'x' + last.ch + ' css=272x128 (8px cells)');
  console.log('first hot frame at t=' + hot[0].t + 'ms, last at t=' + hot[hot.length - 1].t + 'ms');
  console.log('hotpx per frame: ' + hot.slice(0, 40).map(function (f, i) {
    return (i === 0 ? '' : ' ') + f.t + ':' + f.hot + '(' + colsSpan(f) + ' g' + gapOf(f) + ')';
  }).join(' '));
  console.log('\nwhite-hot core covering mouth col 24 (the cell touching the red snout at col 23): ' +
    attached + ' / ' + hot.length);
  console.log('flame BODY (core + orange #ff8a00) covering mouth col 24: ' + welded + ' / ' + lit.length +
    '   worst body gap from col 24: ' + (worstWarm > 0 ? worstWarm + ' cell(s)' : 'none'));
  console.log('ANY flame on mouth col 24 (bright body OR faded 40%-alpha block): ' + contact +
    ' / ' + lit.length + ' frames with a bright flame body' +
    '   worst gap from col 24: ' + (worstAny > 0 ? worstAny + ' cell(s)' : 'none'));

  /* Drift-proof verdict: the sprite sways +-10px (drift) together with the
     flame, so a fixed column is only right when the sway is mid-range.  Here the
     mouth cells are found from the drawing: distance 0 means the leftmost flame
     pixel sits on the mouth cell that touches the snout, >0 means that cell is
     bare and the flame has floated off the muzzle. */
  const relOf = function (f) { return (f.aLo < 0 || f.snout < 0) ? 99 : f.aLo - f.snout - 1; };
  const rels = lit.map(relOf);
  const weldedRel = rels.filter(function (g) { return g <= 0; }).length;
  const worstRel = rels.reduce(function (m, g) { return Math.max(m, g); }, -99);
  const seen = {};
  lit.forEach(function (f) { seen[f.snout] = (seen[f.snout] || 0) + 1; });
  console.log('snout tip column per lit frame (shows the sway): ' +
    Object.keys(seen).sort(function (a, b) { return a - b; }).map(function (k) {
      return 'col ' + k + ' x' + seen[k];
    }).join(', '));
  console.log('flame reaching the mouth cell next to the snout (sprite-anchored): ' +
    weldedRel + ' / ' + rels.length + ' lit frames   worst gap: ' +
    (worstRel > 0 ? worstRel + ' cell(s)' : 'none'));

  const maxCol = Math.max.apply(null, agg) || 1;
  console.log('\ncol : peak px  frames-lit   (red snout ends 23, mouth cells 24-25)');
  for (let c = 0; c < 34; c++) {
    if (agg[c] === 0) continue;
    console.log(String(c).padStart(3) + ' : ' + String(agg[c]).padStart(6) + ' ' +
      String(cnt[c]).padStart(9) + '   ' + bar(agg[c], maxCol / 40));
  }
  const wMax = Math.max.apply(null, wAgg) || 1;
  console.log('\nflame BODY (core + orange) col coverage   (mouth cells 24-25)');
  for (let c = 0; c < 34; c++) {
    if (wAgg[c] === 0) continue;
    console.log(String(c).padStart(3) + ' : ' + String(wAgg[c]).padStart(6) + ' ' +
      String(wCnt[c]).padStart(9) + '   ' + bar(wAgg[c], wMax / 40));
  }
  const rowsMax = Math.max.apply(null, rowsAgg) || 1;
  console.log('\nrow : peak px   (mouth row 7)');
  for (let r2 = 0; r2 < 16; r2++) {
    if (rowsAgg[r2] === 0) continue;
    console.log(String(r2).padStart(3) + ' : ' + String(rowsAgg[r2]).padStart(6) + '   ' + bar(rowsAgg[r2], rowsMax / 20));
  }
  const aggNear = agg.slice(24, 26).reduce(function (s, n) { return s + n; }, 0);
  const wNear = wAgg.slice(24, 26).reduce(function (s, n) { return s + n; }, 0);
  console.log('\npeak hot px in the mouth cells 24-25: ' + aggNear +
    (aggNear > 0 ? '  -> white-hot core DOES overlap the muzzle' : '  -> core sits right of the mouth'));
  console.log('peak flame-body px in the mouth cells 24-25: ' + wNear +
    (wNear > 0 ? '  -> flame body welds to the muzzle' : '  -> GAP: mouth stays bare'));

  const aMax = Math.max.apply(null, aAgg) || 1;
  console.log('\nANY flame per col: bright body + faded block   (mouth cells 24-25)');
  for (let c = 21; c < 34; c++) {
    if (aAgg[c] === 0 && sAgg[c] === 0) continue;
    console.log(String(c).padStart(3) + ' : ' + String(aAgg[c]).padStart(6) + ' ' +
      String(aCnt[c]).padStart(9) + '   faded' + String(sCnt[c]).padStart(5) + '   ' +
      bar(aAgg[c], aMax / 40));
  }
  console.log(aCnt[24] + ' / ' + lit.length + ' frames keep flame on mouth col 24 while the puff is lit ' +
    '(' + (frames.length - lit.length) + ' further frames are ember-only tail: no yellow flame anywhere)' +
    (aCnt[24] === lit.length && worstAny === 0
      ? '\n-> WELDED: the mouth cell is never bare while a puff still glows'
      : '\n-> worst gap ' + worstAny + ' cell(s) from col 24'));

  cdp.close();
  child.kill();
  setTimeout(function () { process.exit(0); }, 300);
})().catch(function (e) {
  console.error('FAIL: ' + (e && e.message));
  process.exit(1);
});
