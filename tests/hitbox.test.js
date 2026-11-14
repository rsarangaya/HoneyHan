// Hit zones for low, floating and tall enemies, plain Node: node tests/hitbox.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, TILE: 3, WALL_H: 3.6, THREE: {}, hasLOS: () => true, wallAt: () => false });
for (const f of ['combat', 'ranged']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${f}.js`), 'utf8'), ctx, { filename: `js/${f}.js` });
const { HIT, quadZone, aimZone, findMeleeTarget, zoneAtHeight } = vm.runInContext('({ HIT, quadZone, aimZone, findMeleeTarget, zoneAtHeight })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

const mk = (x, z, T, extra = {}) => ({ x, z, r: T.r, dead: false, quad: T.model !== 'biped', boss: false, scaleK: 1.6, T, ...extra });
const RAT = { model: 'quad', height: 0.45, r: 0.25, scale: 0.5 }, WOLF = { model: 'quad', height: 0.95, r: 0.4, scale: 1 };
const BOOK = { model: 'float', height: 1.8, hover: 1.1, r: 0.3, scale: 0.7 }, GOB = { model: 'biped', height: 1.8, r: 0.4, scale: 0 };
const pl = pitch => ({ x: 0, z: 0, yaw: 0, pitch });          // faces -z
const hit = (enemies, eye, pitch, reach = 2.3) => findMeleeTarget(pl(pitch), eye, enemies, {}, reach);

// melee, standing eye 1.6, level
let t = hit([mk(0, -2, WOLF)], 1.6, 0); check('a level standing swing hits a wolf at d=2', t && t.zone === 'body', JSON.stringify(t && t.zone));
t = hit([mk(0, -1.5, RAT)], 1.6, 0); check('a level standing swing hits a rat at d=1.5', t && t.zone === 'body', JSON.stringify(t && t.zone));
t = hit([mk(0, -1.5, RAT)], 1.6, -0.5); check('steep downward aim is a leg hit', t && t.zone === 'legs');
t = hit([mk(0, -1.5, RAT)], 1.6, -0.3); check('a mild downward aim is a body hit (rat)', t && t.zone === 'body', t && t.zone);
t = hit([mk(0, -1.5, RAT)], 1.0, 0); check('a crouching swing still hits the rat', t && t.zone);
t = hit([mk(0, -1.5, RAT)], 1.0, -0.3); check('a crouching low aim: body below pitch 25', t && t.zone === 'body');
t = hit([mk(0, -1, RAT)], 1.6, 1.4); check('aiming at the ceiling is aim off', t && t.zone === null);
t = hit([mk(0, -2, WOLF)], 1.6, 0.9); check('aiming well above a wolf is aim off', t && t.zone === null);
t = hit([mk(0, -0.5, RAT)], 1.6, -1.0); check('a rat at the feet, aimed straight down, is hit', t && t.zone === 'legs');
// selection
const g = mk(0, -2, GOB), r = mk(0, -1.2, RAT);
t = hit([r, g], 1.6, 0); check('a goblin behind a rat is hit by a level swing', t && t.e === g && t.zone === 'head', t && t.zone);
t = hit([r, g], 1.6, -0.5); check('a steep down swing prefers the near rat', t && t.e === r && t.zone === 'legs');
// reach with radius
t = hit([mk(0, -2.5, WOLF)], 1.6, 0); check('radius extends reach (wolf centre 2.5 with reach 2.3)', t && t.zone, '2.5-0.2 <= 2.6');
t = hit([mk(0, -2.9, WOLF)], 1.6, 0); check('but not by much', t === null);
// goblin bands unchanged
const z = (eye, p, d) => aimZone(eye, p, d, 1);
check('goblin bands unchanged', z(1.6, 0, 1) === 'head' && z(1.0, 0, 1) === 'body' && z(0.5, 0, 1) === 'legs' && z(2.2, 0, 1) === null && z(-0.2, 0, 1) === null);
t = hit([mk(0, -1, GOB)], 1.6, 0); check('goblin level swing is a head hit as before', t.zone === 'head');
t = hit([mk(0, -1, GOB)], 1.6, -Math.atan(0.9)); check('goblin body hit as before', t.zone === 'body');
// float
check('a float type is hittable at its hover height', quadZone(1.1, mk(0, 0, BOOK), 1.5, 0) === 'body');
t = hit([mk(0, -1.5, BOOK)], 1.6, 0); check('a level swing hits a hovering book', t && t.zone === 'body');
t = hit([mk(0, -1.5, BOOK)], 1.6, -1.3); check('aiming at the floor under a hovering book misses', t && t.zone === null);
check('float below the band is null for arrows', zoneAtHeight(0.5, mk(0, 0, BOOK)) === null && zoneAtHeight(1.1, mk(0, 0, BOOK)) === 'body' && zoneAtHeight(0.9, mk(0, 0, BOOK)) === 'legs');
// arrows
const w = mk(0, 0, WOLF), ra = mk(0, 0, RAT);
check('arrow at y=0.1 on a wolf is legs, 1.0 on a wolf is body', zoneAtHeight(0.1, w) === 'legs' && zoneAtHeight(1.0, w) === 'body');
check('arrow at 1.1 is over a rat (top h+0.15)', zoneAtHeight(1.1, ra) === null && zoneAtHeight(0.55, ra) === 'body' && zoneAtHeight(0.62, ra) === null);
check('arrow lower bound -0.05', zoneAtHeight(-0.04, w) === 'legs' && zoneAtHeight(-0.06, w) === null);
check('arrow goblin bands unchanged', zoneAtHeight(1.7, mk(0, 0, GOB)) === 'head' && zoneAtHeight(1.0, mk(0, 0, GOB)) === 'body' && zoneAtHeight(0.4, mk(0, 0, GOB)) === 'legs');
console.log(fails ? `\n${fails} FAILED` : '\nall hitbox checks passed');
process.exit(fails ? 1 : 0);
