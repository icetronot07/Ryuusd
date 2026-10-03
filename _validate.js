/* Validation harness: runs the page's real inline JS against a stubbed DOM/canvas
   and renders the canvas calls as ASCII so sprite alignment can be eyeballed. */
const fs = require('fs');
const path = 'c:/Xampp/htdocs/Trade_Ryuusd/index.html';
const html = fs.readFileSync(path, 'utf8');

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: no inline <script> found'); process.exit(1); }
const code = scriptMatch[1];

const CHARS = { '#e10600': 'R', '#ff1a1a': 'r', '#8a0f0f': 'm', '#4a0808': 'd', '#140000': 'k', '#ffe6e6': 'w', '#ffe066': 'y', '#ff8a00': 'o' };

function makeCtx(name) {
  const rects = [];
  return {
    _name: name,
    fillStyle: '#000',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    arc() {},
    fill() { rects.push({ kind: 'circle' }); },
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, c: this.fillStyle, a: this.globalAlpha }); },
    _rects: rects
  };
}

function makeCanvasEl(id, w, h) {
  const el = { id, style: {}, width: w, height: h, _ctx: null };
  el.getContext = () => (el._ctx = el._ctx || makeCtx(id));
  return el;
}
const logoEl = makeCanvasEl('logo', 56, 52);
const dragonEl = makeCanvasEl('dragon', 272, 128);

let rafCallback = null;
const sandboxDocument = {
  readyState: 'complete',
  hidden: false,
  getElementById: (id) => (id === 'logo' ? logoEl : id === 'dragon' ? dragonEl : null),
  querySelector: (sel) => (sel === '.stage' ? { clientWidth: 432 } : null),
  addEventListener: () => {}
};
const sandboxWindow = {
  devicePixelRatio: 2,
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
  cancelAnimationFrame: () => { rafCallback = null; },
  addEventListener: () => {},
  setTimeout, clearTimeout
};

new Function('window', 'document', 'performance', code)(sandboxWindow, sandboxDocument, { now: () => 0 });
if (!rafCallback) { console.error('FAIL: animation loop never started'); process.exit(1); }
console.log('OK: script parsed and rAF loop started');

function renderAt(t) {
  dragonEl._ctx._rects.length = 0;
  rafCallback(t);
  return dragonEl._ctx._rects.slice();
}

function dump(rects, label) {
  const CELL = 8, COLS = 34, ROWS = 16;
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill('.'));
  let fire = 0;
  for (const r of rects) {
    if (r.kind === 'circle') continue;
    const ch = CHARS[r.c];
    if (!ch) continue;
    if (ch === 'y' || ch === 'o') fire++;
    const cells = Math.max(1, Math.round(r.w / CELL));
    const cx = Math.round(r.x / CELL), cy = Math.round(r.y / CELL);
    for (let dy = 0; dy < cells; dy++) for (let dx = 0; dx < cells; dx++) {
      const y = cy + dy, x = cx + dx;
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y][x] = ch;
    }
  }
  let lastCol = 0;
  grid.forEach((row) => row.forEach((c, i) => { if (c !== '.') lastCol = Math.max(lastCol, i); }));
  console.log('\n--- ' + label + ' (flame cells: ' + fire + ') ---');
  grid.forEach((row) => console.log('|' + row.slice(0, lastCol + 1).join('') + '|'));
}

dump(renderAt(0), 't=0 wing frame A');
dump(renderAt(200), 't=200 wing frame B');
dump(renderAt(700), 't=700 bob + muzzle glow');
dump(renderAt(820), 't=820 puff ignites');
dump(renderAt(880), 't=880 leading jet');
dump(renderAt(960), 't=960 bright plume');
dump(renderAt(1040), 't=1040 plume widened');
dump(renderAt(1150), 't=1150 cooling');
dump(renderAt(1600), 't=1600 spent');
/* --- render the header logo ASCII --- */
const LCELL = 4, LOGO_ROWS = 13, LOGO_COLS = 14;
const lg = Array.from({ length: LOGO_ROWS }, () => new Array(LOGO_COLS).fill('.'));
for (const r of logoEl._ctx._rects) {
  const ch = CHARS[r.c]; if (!ch) continue;
  const cx = Math.round(r.x / LCELL), cy = Math.round(r.y / LCELL);
  if (cy >= 0 && cy < LOGO_ROWS && cx >= 0 && cx < LOGO_COLS) lg[cy][cx] = ch;
}
console.log('\n--- header logo ---');
lg.forEach((row) => console.log('|' + row.join('') + '|'));

/* --- static HTML checks --- */
const checks = [
  ['charset', /<meta charset="utf-8">/],
  ['viewport', /name="viewport" content="width=device-width/],
  ['title', /<title>[^<]+<\/title>/],
  ['favicon emoji', /rel="icon" href="data:image\/svg\+xml,[^"]*%F0%9F%90%89/],
  ['og:title', /property="og:title"/],
  ['og:description', /property="og:description"/],
  ['og:image', /property="og:image"/],
  ['twitter card', /name="twitter:card"/],
  ['pixel font link', /family=Press\+Start\+2P/],
  ['canvas dragon', /id="dragon"/],
  ['canvas logo', /id="logo"/],
  ['telegram btn new tab', /href="https:\/\/t\.me\/[^"]+"[\s\S]{0,80}?target="_blank" rel="noopener noreferrer"/],
  ['broker btn new tab', /href="https:\/\/[^"]*BROKER[^"]*"[\s\S]{0,80}?target="_blank" rel="noopener noreferrer"/],
  ['broker button label', /Open a Broker Account/],
  ['community note', /free signals/],
  ['risk disclaimer', /Trading involves risk\. Not financial advice\. Only trade with money you can afford to lose\./],
  ['max-width 480', /max-width:480px/],
  ['no <img> tags', /^(?![\s\S]*<img)/],
  ['reduced motion', /prefers-reduced-motion/],
  ['no external images', /^(?![\s\S]*url\(http)/],
  ['grid glow', /rgba\(225,6,0/]
];
let bad = 0;
console.log('\n--- static checks ---');
for (const [name, re] of checks) {
  const ok = re.test(html);
  if (!ok) bad++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}
const opens = (html.match(/<(div|main|header|nav|footer|p|span|a|h1)\b/g) || []).length;
const closes = (html.match(/<\/(div|main|header|nav|footer|p|span|a|h1)>/g) || []).length;
const balanced = opens === closes;
if (!balanced) bad++;
console.log((balanced ? 'PASS  ' : 'FAIL  ') + 'tag balance (' + opens + ' open / ' + closes + ' close)');
console.log(bad ? '\n' + bad + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
