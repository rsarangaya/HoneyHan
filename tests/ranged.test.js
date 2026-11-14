// Arrow flight and hit zones, plain Node: node tests/ranged.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const T = 3;
const ctx = vm.createContext({ console, Math, TILE: T, WALL_H: 3.6, BOSS_SCALE: 1.6, THREE: {},
  wallAt: (f, tx, ty) => tx < 0 || ty < 0 || tx >= f.w || ty >= f.h || f.tiles[ty * f.w + tx] === 0 });
for (const f of ['combat', 'ranged']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${f}.js`), 'utf8'), ctx, { filename: `js/${f}.js` });   // zoneAtHeight uses quadZone from combat.js
const { BOW, SHIELD, zoneAtHeight, stepArrow } = vm.runInContext('({ BOW, SHIELD, zoneAtHeight, stepArrow })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

// a 20 x 20 tile room with a wall column at x = 10
const f = { w: 20, h: 20, tiles: new Uint8Array(400).fill(1), solids: [{ x: 0, z: 0, r: 1.5 }] };
for (let y = 0; y < 20; y++) { f.tiles[y * 20] = 0; f.tiles[y * 20 + 19] = 0; f.tiles[y] = 0; f.tiles[19 * 20 + y] = 0; }
for (let y = 0; y < 20; y++) f.tiles[y * 20 + 10] = 0;
const goblin = (x, z, extra = {}) => ({ x, z, r: 0.4, dead: false, quad: false, boss: false, scaleK: 1.6, T: { scale: 0 }, ...extra });   // scaleK: the boss model scale (js/enemy.js BOSS_SCALE), read by zoneAtHeight
const fly = (a, e, secs, step = 1 / 30) => { let ev = null; for (let t = 0; t < secs && !ev; t += step) ev = stepArrow(a, step, f, e, null); return ev; };
const mk = (x, y, z, sp, pitch = 0, owner = 'player') => ({ x, y, z, vx: sp * Math.cos(pitch), vy: sp * Math.sin(pitch), vz: 0, owner });

// zones
const g = goblin(0, 0);
check('goblin zones by height', zoneAtHeight(1.7, g) === 'head' && zoneAtHeight(1.0, g) === 'body' && zoneAtHeight(0.4, g) === 'legs' && zoneAtHeight(2.3, g) === null && zoneAtHeight(-0.1, g) === null);
check('the boss zones stretch with its size', zoneAtHeight(1.7, goblin(0, 0, { boss: true })) === 'body' && zoneAtHeight(2.6, goblin(0, 0, { boss: true })) === 'head');
check('rats and wolves: low targets', zoneAtHeight(0.1, goblin(0, 0, { quad: true, T: { height: 0.45 } })) === 'legs' && zoneAtHeight(0.3, goblin(0, 0, { quad: true, T: { height: 0.45 } })) === 'body' && zoneAtHeight(1.0, goblin(0, 0, { quad: true, T: { height: 0.45 } })) === null);
check('a bouncer is taller (scale 1.3)', zoneAtHeight(1.7, goblin(0, 0, { T: { scale: 1.3 } })) === 'body' && zoneAtHeight(1.7, g) === 'head');

// flight
let a = mk(3, 1.6, 30, 30); let ev = fly(a, [], 3);
check('a level arrow drops and hits the ground', ev && ev.type === 'ground' && a.x > 3 + 20, `landed ${(a.x - 3).toFixed(1)} m out`);
a = mk(3, 1.6, 30, 30); const drop = (() => { for (let i = 0; i < 20; i++) stepArrow(a, 1 / 30, f, [], null); return 1.6 - a.y; })();
check('drop after 20 m of flight matches gravity', Math.abs(drop - 0.5 * BOW.gravity * (20 / 30) ** 2 / 1) < 0.15, drop.toFixed(2) + ' m');
a = mk(3, 1.6, 30, 30); ev = fly(a, [], 3, 1 / 5);
check('big time steps still hit the ground', ev && ev.type === 'ground');
a = mk(5, 1.5, 30, 40); ev = fly(a, [], 3);
check('an arrow stops at a wall and remembers where it was', ev && ev.type === 'wall' && a.px < 30 && a.px > 28.5, `px ${a.px && a.px.toFixed(2)}`);
a = mk(5, 1.5, 30, 40); ev = fly(a, [goblin(15, 30)], 3);
check('an arrow hits an enemy in its way, body at chest height', ev && ev.type === 'hit' && ev.zone === 'body', JSON.stringify(ev && ev.zone));
a = mk(5, 1.75, 30, 40); ev = fly(a, [goblin(15, 30)], 3);
check('a high arrow is a headshot', ev && ev.zone === 'head');
a = mk(5, 0.4, 30, 40, 0); ev = fly(a, [goblin(15, 30)], 3);
check('a low arrow is a leg hit', ev && ev.zone === 'legs');
a = mk(5, 2.8, 30, 40); ev = fly(a, [goblin(15, 30)], 3);
check('an arrow over its head misses', !ev || ev.type !== 'hit');
a = mk(5, 1.5, 30, 40); ev = fly(a, [goblin(15, 30, { dead: true })], 3);
check('arrows pass through the dead', !ev || ev.type !== 'hit');
a = mk(5, 1.5, 30, 40); ev = fly(a, [goblin(15, 31.2)], 3);
check('an arrow beside an enemy misses', !ev || ev.type !== 'hit');
a = mk(5, 1.0, 30, 40); f.solids.push({ x: 12, z: 30, r: 0.6 }); ev = fly(a, [], 3); f.solids.pop();
check('low furniture stops arrows', ev && ev.type === 'wall' && a.x < 12.5);
a = mk(5, 2.0, 30, 40); f.solids.push({ x: 12, z: 30, r: 0.6 }); ev = fly(a, [], 3); f.solids.pop();
check('arrows fly over low furniture at head height', ev && a.x > 12.5);
a = mk(4, 1.0, 4, 20); f.solids[0] = { x: 7, z: 4, r: 1.5 }; ev = fly(a, [], 2); f.solids[0] = { x: 0, z: 0, r: 1.5 };
check('the stairwell (solid 0) never blocks an arrow', ev && ev.type === 'ground', ev && ev.type);
a = { x: 5, y: 1.2, z: 30, vx: 25, vy: 0, vz: 0, owner: 'enemy' }; const pl = { x: 12, z: 30, radius: 0.35, eye: 1.6 };
ev = null; for (let t = 0; t < 2 && !ev; t += 1 / 30) ev = stepArrow(a, 1 / 30, f, [goblin(8, 30)], pl);
check('an enemy arrow flies through enemies and hits the player', ev && ev.type === 'player');
check('shield numbers are sane', SHIELD.legsTake < 1 && SHIELD.cost > 0 && SHIELD.bashStun > 0);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
