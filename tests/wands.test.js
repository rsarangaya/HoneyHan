// Wand and rage data and helpers, plain Node: node tests/wands.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/wands.js'), 'utf8'), ctx, { filename: 'js/wands.js' });
const { WANDS, WAND, RAGE, newWand, rechargedTo, nearestOther, rageVictims } = vm.runInContext('({ WANDS, WAND, RAGE, newWand, rechargedTo, nearestOther, rageVictims })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

check('five ordinary wands plus the legendary Aj\'s Bust', Object.keys(WANDS).join() === 'fire,frost,lightning,force,sleep,bust' && WANDS.bust.legendary && !Object.values(WANDS).slice(0, 5).some(w => w.legendary));
check('every wand has a name, colour, charges, noise and description', Object.values(WANDS).every(w => w.name && /^#/.test(w.color) && w.charges > 0 && w.noise >= 0 && w.desc));
check('frost is near silent, lightning very loud', WANDS.frost.noise <= 1 && WANDS.lightning.noise >= 10 && WANDS.lightning.noise > WANDS.fire.noise);
check('a new wand starts full', newWand('frost').charges === WANDS.frost.charges && newWand('frost').type === 'wand');
let w = { kind: 'fire', charges: 0 };
check('a recharge wand adds 3 charges, even to an empty wand', rechargedTo(w, false) === WAND.rechargeGain);
check('recharging never goes over the maximum', rechargedTo({ kind: 'fire', charges: 4 }, false) === WANDS.fire.charges);
check('the rare recharge refills fully', rechargedTo({ kind: 'lightning', charges: 0 }, true) === WANDS.lightning.charges);

const e = (x, z, extra = {}) => ({ x, z, dead: false, boss: false, ...extra });
const me = e(0, 0), a = e(3, 0), b = e(1, 1), c = e(10, 0), d = e(0.5, 0, { dead: true });
check('nearest other enemy skips itself and the dead', nearestOther(me, [me, a, b, c, d], 20) === b);
check('nearest other respects the range', nearestOther(me, [me, c], 5) === null);
check('nearest other can skip kinds', nearestOther(me, [me, a, b], 20, o => o === b) === a);
check('rage reaches the living non-boss enemies in range', (() => { const v = rageVictims([a, b, c, d, e(2, 2, { boss: true }), e(13, 0), e(15, 0)], 0, 0); return v.length === 4 && v.includes(a) && v.includes(c) && !v.includes(d); })());
check('rage radius is exclusive of the far', rageVictims([e(14.5, 0)], 0, 0).length === 0 && rageVictims([e(13.9, 0)], 0, 0).length === 1);
check('rage numbers are sane', RAGE.dur >= 8 && RAGE.noise >= RAGE.radius && RAGE.charges >= 1);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
