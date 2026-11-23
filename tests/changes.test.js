// Round "CT1-CT5" rules, plain Node: node tests/changes.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const ctx = vm.createContext({ console, Math });
for (const f of ['js/status.js', 'js/combat.js', 'js/wands.js']) vm.runInContext(src(f).replace(/^const (\w+) =/mg, 'var $1 ='), ctx, { filename: f });   // (var: visible to the other files)
const g = e => vm.runInContext(e, ctx);

// CT1: a quad lies on its side, centre over its spot, resting on the floor
const enemySrc = src('js/enemy.js');
const fn = enemySrc.match(/const QUAD_C[^\n]*\r?\nfunction deadQuadPose[\s\S]*?\r?\n}\r?\n/);
check('CT1: deadQuadPose exists in enemy.js', !!fn);
const pose = vm.runInNewContext(fn[0] + '; ({ deadQuadPose, QUAD_C, QUAD_W })', { Math });
for (const side of [1, -1]) for (const yaw of [0, 1.1, 2.9]) {
  const e = { scaleK: 0.5, deadSide: side, yaw, x: 10, z: 7, deadOx: undefined }, m = { rotation: {}, position: {} };
  let prevY = -1; for (const k of [0, 0.5, 1, 1]) pose.deadQuadPose(e, m, k);
  const c = pose.QUAD_C * 0.5, th = m.rotation.z;
  // the body centre (0, c, 0) after the roll, in world space
  const lx = -c * Math.sin(th), ly = c * Math.cos(th), wx = m.position.x + lx * Math.cos(yaw), wz = m.position.z - lx * Math.sin(yaw), wy = m.position.y + ly;
  check(`CT1: side ${side} yaw ${yaw}: rolled 90 degrees, centre over the death spot, torso on the floor`, near(Math.abs(th), Math.PI / 2) && Math.sign(th) === side && near(wx, 10, 1e-9) && near(wz, 7, 1e-9) && near(wy, pose.QUAD_W * 0.5, 1e-9) && m.rotation.x === 0, `${wx.toFixed(3)},${wz.toFixed(3)},${wy.toFixed(3)}`);
}
{ const e = { scaleK: 1, deadSide: 1, yaw: 0.4, x: 0, z: 0 }, m = { rotation: {}, position: {} };
  let minY = 9; for (let i = 0; i <= 20; i++) { pose.deadQuadPose(e, m, i / 20); const c = pose.QUAD_C, th = m.rotation.z; minY = Math.min(minY, m.position.y + c * Math.cos(th) - 0); }
  check('CT1: the centre never sinks below the settled height while falling', minY >= pose.QUAD_W - 1e-9, minY.toFixed(3)); }
check('CT1: biped corpses keep the backward tip and only quads use the side roll', /this\.T\.model === 'quad'\) \{ deadQuadPose/.test(enemySrc));

// CT2: one turn rate
const turnUses = enemySrc.split(/\r?\n/).filter(l => /turnToward\(/.test(l) && !/^const turnToward/.test(l)).join('\n');
check('CT2: no TUNE.enemyTurn (walking) rate left, one alert rate', g('TUNE.enemyTurn') === undefined && g('TUNE.enemyTurnAlert') >= 9 && !/TUNE\.enemyTurn\b(?!Alert)/.test(enemySrc));
check('CT2: look-around turns at the alert rate (no free yaw drift)', /lookAround\(dt, k = 1\)[^\n]*enemyTurnAlert/.test(enemySrc) && !/this\.yaw \+= Math\.cos\(this\.lookT/.test(enemySrc));
check('CT2: only telegraph/charge/ranged-aim rates remain as literals', (turnUses.match(/turnToward\([^\n]*?, (\d+) \* dt\)/g) || []).every(s => /, (4|5|6) \* dt/.test(s)));

// CT3: 20% faster attacks
check('CT3: attack speed stats x1.2', near(g('TUNE.enemyAtkSpd'), 1.68) && near(g('TUNE.bossAtkSpd'), 0.84));

// CT4: bag
check('CT4: the backpack holds 20 (4 more)', /^const PACK_MAX = 20;/m.test(src('js/loot.js')));

// CT5: burn and freeze
const { Statuses, STATUS, WANDS, WAND } = g('({ Statuses, STATUS, WANDS, WAND })');
let s = new Statuses(); s.apply('burn');
let d = 0; for (let i = 0; i < 10; i++) d += s.update(0.1);
check('CT5: burn deals its dps (6/s) as damage over time', near(d, STATUS.burn.dps * 1, 1e-6) && s.has('burn'), d.toFixed(2));
s.apply('burn'); check('CT5: burn refreshes, never stacks', near(s.t.burn, STATUS.burn.dur) && near(s.update(0.1), STATUS.burn.dps * 0.1));
s = new Statuses(); s.burnMul = STATUS.burn.bossMul; s.apply('burn'); check('CT5: a boss takes burn at the reduced rate', near(s.update(1), STATUS.burn.dps * STATUS.burn.bossMul));
s = new Statuses(); s.apply('burn'); for (let i = 0; i < 40; i++) s.update(0.1); check('CT5: burn ends by itself', !s.has('burn') && s.update(1) === 0);
s = new Statuses(); s.apply('freeze'); check('CT5: freeze means no movement at all', s.moveMul() === 0);
s.update(STATUS.freeze.dur + 0.01); check('CT5: after the freeze a brief slow follows', !s.has('freeze') && s.has('slow') && near(s.moveMul(), STATUS.slow.move));
check('CT5: immunity right after a freeze, then it works again', s.apply('freeze') === false && (s.update(STATUS.freeze.immune + 0.1), s.apply('freeze') === true));
s = new Statuses(); s.apply('burn'); check('CT5: tints differ for burn (orange) and freeze (blue)', s.tint() === 0x7a3200 && (s.clear(), s.apply('freeze'), s.tint()) === 0x2a6a9a);
check('CT5: chances are tunable data, 40% burn / 25% freeze, lightning has no chance', WAND.burnChance === 0.4 && WAND.freezeChance === 0.25 && !('burn' in WANDS.lightning) && !('freeze' in WANDS.lightning));
check('CT5: wand descriptions quote the chances (and follow tuning)', /40%/.test(WANDS.fire.desc) && /25%/.test(WANDS.frost.desc) && (WAND.burnChance = 0.5, /50%/.test(WANDS.fire.desc)));
const mainSrc = src('js/main.js');
check('CT5: main applies them with the seeded gameRng', /gameRng\(\) < WAND\.burnChance/.test(mainSrc) && /gameRng\(\) < WAND\.freezeChance/.test(mainSrc));
check('CT5: tune panel has the chance rows, key bumped', /burnChance/.test(src('js/tune.js')) && /freezeChance/.test(src('js/tune.js')) && /tune-35/.test(src('js/tune.js')));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nall changes checks passed');
