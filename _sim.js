/* _sim.js - offline replica of the index.html fire-breath particle maths.
   No browser: just the formulas, so muzzle alignment can be tuned in
   milliseconds.  Prints the sprite (lowercase/dark) with the flame on top in
   the real palette, so a gap between the mouth and the plume is obvious.
   Usage: node _sim.js [seed] [--fixed]                                   */
const COLS = 34, ROWS = 16, CELL = 8, SPRITE_X = 3;

const UP = [
  '.....dm.................',
  '...drRmmd.........dRd...',
  '..drRRmmmd.......dRRd...',
  '..drRRmmmmmd....drRRRRRd',
  '...drRRmmmmmd...drRRRRkd',
  '....drRRmmmmmmd.drRwkRRd',
  '......dddddddddddrRRRRRd',
  '.........dRRRRRRRRRRRkk.',
  '....drRRRRRRRRRRRd......',
  '..drRRRRRRRRRRRRd.......',
  'drRRRRRRRRRRRRRd........',
  '..dRRRRRRRRRRRd.........',
  '....dmRRRRRRmd..........',
  '....dRRd.dRRd...........',
  '....dRRd.dRRd...........',
  '....dddd.dddd...........'
];

/* --- tunables: mirror of spawnFire() / drawFrame() --------------------- */
/* three tiers, exactly as in the real spawnFire():
   t0 = tight white-hot jet, t1 = cone embers, t2 = muzzle emitters that
   stay white-hot ON the mouth so the plume can never look detached. */
const CFG = {
  count: 34,
  jet: 12,                  /* i < jet                -> tier 0            */
  muzzle: 2,                /* i >= count - muzzle    -> tier 2            */
  dist: [[1.4, 2.2], [0.6, 4.4], [0.0, 0.8]],   /* [base, spread] sprite cells */
  dur: [[840, 420], [700, 400], [900, 380]],    /* [base, spread] ms of life   */
  dy: [1.2, 3.2, 1.0],
  rise: [[0.1, 0.4], [0.3, 1.0], [0.05, 0.25]],
  born: 55,                 /* pre-roll (ms) so the jet exists at once */
  originX: 21.4,            /* sprite col the flame leaves from = first mouth
                               cell; +SPRITE_X(3) -> canvas col 24, which is the
                               mouth pixel that touches the solid snout (col 23) */
  originY: 7.4,
  centre: false,            /* subtract size/2 so blocks sit on the row */
  fade: 0.6,
  /* Absolute cooling clock (ms).  Every particle shares it, so nothing can be
     left white-hot on its own once the rest of the puff has cooled. */
  cool: [340, 640, 860],    /* < yellow | < orange | < red | else smoke   */
  drift: 10                 /* worst-case sway, counted by the clip check */
};

/* --- reference columns of the sprite grid ------------------------------
   solid red snout ends at canvas col 23 ('R' at sprite col 20)
   mouth cells           = canvas cols 24-25 (dark 'k', sprite cols 21-22)
   -> the plume is welded to the dragon only if a lit block covers col 24,
      because col 24 is the mouth pixel that touches the red snout.        */
const SNOUT = 23, MOUTH = 24;

function tier(i) { return i < CFG.jet ? 0 : (i >= CFG.count - CFG.muzzle ? 2 : 1); }

function easeOut(p) { return 1 - (1 - p) * (1 - p); }
/* cooling is driven by absolute age, as in the real flameColor(age) */
function flameColor(age) {
  if (age < CFG.cool[0]) return 'y';
  if (age < CFG.cool[1]) return 'o';
  if (age < CFG.cool[2]) return 'R';
  return 'd';
}

function makeParticles(now) {
  const ps = [];
  for (let i = 0; i < CFG.count; i++) {
    const t = tier(i), d = CFG.dist[t], u = CFG.dur[t], r = CFG.rise[t];
    const dist = d[0] + Math.random() * d[1];
    /* Pre-roll scaled by distance: the jet was "already travelling" when the
       puff ignites, while the muzzle particles are the youngest of the puff.
       They therefore cool last, so the white-hot core always keeps the mouth
       lit and the plume can never pop free of the snout. */
    const pre = Math.random() * CFG.born * Math.min(1, dist / 4.4);
    ps.push({
      born: now - pre,
      dur: u[0] + Math.random() * u[1],
      dist: dist,
      dy: (Math.random() - 0.5) * CFG.dy[t],
      rise: r[0] + Math.random() * r[1],
      size: t === 1 ? (dist < 2.4 || Math.random() < 0.32 ? 2 : 1) : 2,
      tier: t
    });
  }
  return ps;
}

function paint(ps, now) {
  const g = [];
  for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill('.'));
  for (let y = 0; y < UP.length; y++) {
    for (let x = 0; x < UP[y].length; x++) {
      const ch = UP[y][x];
      if (ch === '.') continue;
      const cx = SPRITE_X + x;
      if (cx >= 0 && cx < COLS) g[y][cx] = ch;
    }
  }
  let maxX = 0, maxY = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const age = now - p.born;
    if (age < 0 || age > p.dur) continue;
    const prog = age / p.dur, e = easeOut(prog);
    const px = Math.round((SPRITE_X + CFG.originX + p.dist * e) * CELL);
    let py = (CFG.originY + p.dy * e - p.rise * prog) * CELL;
    if (CFG.centre) py -= p.size * CELL / 2;
    py = Math.round(py);
    const c = flameColor(age);
    const sx = Math.floor(px / CELL), sy = Math.floor(py / CELL);
    for (let b = 0; b < p.size; b++) {
      for (let a = 0; a < p.size; a++) {
        const gx = sx + a, gy = sy + b;
        if (gy < 0 || gy >= ROWS || gx < 0 || gx >= COLS) continue;
        g[gy][gx] = c;
      }
    }
    if (px + p.size * CELL + CFG.drift > maxX) maxX = px + p.size * CELL + CFG.drift;
    if (py + p.size * CELL > maxY) maxY = py + p.size * CELL;
  }
  /* Count the CELLS that survive compositing: overlapping blocks merge, so this
     matches what the per-pixel browser probe sees (1 cell = CELL*CELL px). */
  let hotN = 0, bodyN = 0, lo = -1, hi = -1, bodyLo = -1, bodyHi = -1;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = g[y][x];
      if (ch !== 'y' && ch !== 'o') continue;
      bodyN++;
      if (bodyLo < 0 || x < bodyLo) bodyLo = x;
      if (x > bodyHi) bodyHi = x;
      if (ch === 'y') { hotN++; if (lo < 0 || x < lo) lo = x; if (x > hi) hi = x; }
    }
  }
  return { g: g, hotN: hotN, bodyN: bodyN, lo: lo, hi: hi,
           bodyLo: bodyLo, bodyHi: bodyHi, maxX: maxX, maxY: maxY };
}

const seed = Number(process.argv[2]) || 1;
let s = seed;
Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

const ps = makeParticles(0);
const CANW = COLS * CELL, CANH = ROWS * CELL;
console.log('seed=' + seed + '  canvas ' + CANW + 'x' + CANH +
  '  red snout ends col ' + SNOUT + ', mouth cells ' + MOUTH + '-' + (MOUTH + 1) + ' row 7');
console.log('tiers: jet x' + CFG.jet + '  embers x' + (CFG.count - CFG.jet - CFG.muzzle) +
  '  muzzle x' + CFG.muzzle + '  (count ' + CFG.count + ')');

const ages = [];
for (let a = 0; a <= 1500; a += 30) ages.push(a);
const rows = [];
let peakHot = 0, peakBody = 0, hotFrames = 0, hotAtMouth = 0;
let bodyFrames = 0, bodyAtMouth = 0, worstGap = -99, worstAge = 0, clip = 0, maxCol = 0, gone = 0;
ages.forEach(function (a) {
  const r = paint(ps, a);
  if (r.maxX > CANW || r.maxY > CANH) clip++;
  if (r.maxX > maxCol) maxCol = r.maxX;
  if (r.bodyN > 0) gone = a;
  if (r.hotN > peakHot) peakHot = r.hotN;
  if (r.bodyN > peakBody) peakBody = r.bodyN;
  if (r.hotN > 0) {
    hotFrames++;
    if (r.lo <= MOUTH) hotAtMouth++;
    if (r.lo - MOUTH > worstGap) { worstGap = r.lo - MOUTH; worstAge = a; }
  }
  if (r.bodyN > 0) { bodyFrames++; if (r.bodyLo <= MOUTH) bodyAtMouth++; }
  if (a % 60 === 0) rows.push([a, r]);
});
console.log('\n age  hot  px~    white-hot  gap    body span   cells');
rows.forEach(function (e) {
  const r = e[1];
  console.log(String(e[0]).padStart(4) + String(r.hotN).padStart(5) +
    String(r.hotN * CELL * CELL).padStart(7) + '   ' +
    (r.lo < 0 ? '   -       -' : (r.lo + '..' + r.hi).padEnd(7) + String(r.lo - MOUTH).padStart(3)) +
    '   ' + (r.bodyLo < 0 ? '    -   ' : (r.bodyLo + '..' + r.bodyHi).padEnd(8)) + String(r.bodyN).padStart(5));
});
console.log('\nwhite-hot (probe "hot") phase: ' + hotFrames + ' samples, peak ' + peakHot +
  ' cells (' + peakHot * CELL * CELL + ' px), covering mouth col ' + MOUTH + ' in ' +
  hotAtMouth + '/' + hotFrames);
console.log('yellow+orange body: peak ' + peakBody + ' cells (' + peakBody * CELL * CELL +
  ' px), at the mouth in ' + bodyAtMouth + '/' + bodyFrames + ', plume gone by t=' + gone + 'ms');
console.log('rightmost lit pixel ' + maxCol + ' of ' + CANW + ' -> ' +
  (clip ? clip + ' CLIPPED samples' : 'no clipping'));
console.log('worst mouth gap ' + (worstGap > 0 ? worstGap + ' cell(s) at t=' + worstAge +
  'ms' : 'none: every lit block covers mouth col ' + MOUTH + ', which touches the snout'));
console.log(clip === 0 && worstGap <= 0
  ? 'PASS: the white-hot core always overlaps the muzzle and the plume fits the canvas'
  : 'FAIL: retune CFG (worst gap ' + worstGap + ', clipped ' + clip + ')');

const f = paint(ps, Number(process.argv[3]) || 240);
console.log('\n--- frame at t=' + (Number(process.argv[3]) || 240) + 'ms (y/o = flame, k = mouth) ---');
f.g.forEach(function (row, i) { console.log(String(i).padStart(2) + ' |' + row.join('') + '|'); });
