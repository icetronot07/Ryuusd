/* _sprite.js - author + validate the pixel dragon.
   Rows are built from [col, "chars"] segments so columns can never be
   mis-counted; prints an ASCII preview and copy-pasteable JS arrays. */
const W = 24, H = 16, COLS = 34, SPRITE_X = 3;

function paint(segs) {
  const row = new Array(W).fill('.');
  for (let s = 0; s < segs.length; s++) {
    const col = segs[s][0], str = segs[s][1];
    if (col + str.length > W) throw new Error('row overflow at col ' + col + ': ' + str);
    for (let i = 0; i < str.length; i++) {
      if (row[col + i] !== '.' && row[col + i] !== str[i]) {
        throw new Error('overlap at col ' + (col + i) + ': ' + row[col + i] + ' -> ' + str[i]);
      }
      row[col + i] = str[i];
    }
  }
  return row.join('');
}

/* Layout (24 x 16, head faces RIGHT)
     horn ....... rows 1-2  cols 17-20  swept back over the skull
     head ....... rows 3-7  cols 16-23  eye 19/20, open mouth 21/22 (dark 'k')
     wing ....... rows 0-5  cols 2-14   bright 'r/R' leading edge, dark 'm' membrane
     shade ...... row  6    cols 6-15   outline under the wing, keeps the back read
     neck ....... row  7    cols 9-15   solid red: skull down onto the shoulders
     body ....... rows 8-12 cols 0-17   tail tapers to a point at the far left
     legs ....... rows 13-15 cols 4-7 and 9-12 */
const UP = [
  paint([[5, 'dm']]),
  paint([[3, 'drRmmd'], [18, 'dRd']]),
  paint([[2, 'drRRmmmd'], [17, 'dRRd']]),
  paint([[2, 'drRRmmmmmd'], [16, 'drRRRRRd']]),
  paint([[3, 'drRRmmmmmd'], [16, 'drRRRRkd']]),
  paint([[4, 'drRRmmmmmmd'], [16, 'drRwkRRd']]),
  paint([[6, 'dddddddddd'], [16, 'drRRRRRd']]),
  paint([[9, 'dRRRRRRRRRRRkk']]),
  paint([[4, 'drRRRRRRRRRRRd']]),
  paint([[2, 'drRRRRRRRRRRRRd']]),
  paint([[0, 'drRRRRRRRRRRRRRd']]),
  paint([[2, 'dRRRRRRRRRRRd']]),
  paint([[4, 'dmRRRRRRmd']]),
  paint([[4, 'dRRd'], [9, 'dRRd']]),
  paint([[4, 'dRRd'], [9, 'dRRd']]),
  paint([[4, 'dddd'], [9, 'dddd']])
];

/* ---- frame B: wing swept back and lowered (apex drops 2 rows, base 2 cols left) ---- */
const DOWN = [
  paint([]),
  paint([[18, 'dRd']]),
  paint([[9, 'dm'], [17, 'dRRd']]),
  paint([[7, 'drRmmd'], [16, 'drRRRRRd']]),
  paint([[5, 'drRRmmmmmd'], [16, 'drRRRRkd']]),
  paint([[3, 'drRRmmmmmmmd'], [16, 'drRwkRRd']]),
  paint([[5, 'ddddddddddd'], [16, 'drRRRRRd']]),
  paint([[9, 'dRRRRRRRRRRRkk']]),
  paint([[4, 'drRRRRRRRRRRRd']]),
  paint([[2, 'drRRRRRRRRRRRRd']]),
  paint([[0, 'drRRRRRRRRRRRRRd']]),
  paint([[2, 'dRRRRRRRRRRRd']]),
  paint([[4, 'dmRRRRRRmd']]),
  paint([[4, 'dRRd'], [9, 'dRRd']]),
  paint([[4, 'dRRd'], [9, 'dRRd']]),
  paint([[4, 'dddd'], [9, 'dddd']])
];

const MOUTH_CY = 7;   /* mouth row inside the sprite grid */

function preview(name, rows) {
  console.log('\n--- ' + name + ' (' + rows.length + ' rows x ' + W + ' cols) ---');
  console.log('    ' + '0123456789'.repeat(3).slice(0, W));
  rows.forEach((r, i) => console.log(String(i).padStart(2) + '  ' + r));
  console.log('    silhouette:');
  rows.forEach((r, i) => console.log(String(i).padStart(2) + '  ' + r.replace(/[^.]/g, '#')));
  const mouth = rows[MOUTH_CY].lastIndexOf('R');
  const used = new Set();
  rows.forEach((r) => r.split('').forEach((c) => { if (c !== '.') used.add(c); }));
  console.log('    tallest row: ' + Math.max(...rows.map((r) => r.replace(/\.+$/, '').length)) + ' cols used');
  console.log('    chars used: ' + [...used].sort().join(' '));
  console.log('    last red cell on mouth row ' + MOUTH_CY + ': col ' + mouth +
    '  -> fire starts at canvas col ' + (SPRITE_X + mouth + 1) + ' of ' + COLS);
}

if (UP.length !== H || DOWN.length !== H) throw new Error('need ' + H + ' rows');
preview('DRAGON_UP', UP);
preview('DRAGON_DOWN', DOWN);
UP.forEach((r) => { if (r.length !== W) throw new Error('bad width: ' + r.length); });
console.log('\nOK - both frames are ' + H + 'x' + W + '.\n');
