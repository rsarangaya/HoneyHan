// Status rules, plain Node: node tests/status.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/status.js'), 'utf8'), ctx, { filename: 'js/status.js' });
const { Statuses, STATUS } = vm.runInContext('({ Statuses, STATUS })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

let s = new Statuses();
check('starts clean', s.moveMul() === 1 && s.list().length === 0);
s.apply('slow'); check('slow cuts speed', near(s.moveMul(), STATUS.slow.move));
s.update(STATUS.slow.dur + 0.01); check('slow returns instantly when it ends', s.moveMul() === 1 && !s.has('slow'));

s = new Statuses(); s.apply('slow'); s.apply('cripple');
check('strongest movement effect wins, no stacking', near(s.moveMul(), STATUS.cripple.move));
s = new Statuses(); s.apply('slow', 3); s.apply('slow', 5); check('re-applying keeps the longer duration', near(s.t.slow, 5));
s.apply('slow', 2); check('a shorter re-apply does not shorten it', near(s.t.slow, 5));

s = new Statuses(); s.apply('cripple', 2);
check('cripple is full strength at first', near(s.moveMul(), STATUS.cripple.move));
s.update(1.5);   // 0.5 s left of 2, recovery is the last half (1 s): a quarter of the way back... 0.5/1 left => halfway
const mid = s.moveMul();
check('cripple recovers gradually', mid > STATUS.cripple.move + 0.1 && mid < 1, mid.toFixed(2));
s.update(0.6);
check('cripple ends', !s.has('cripple') && s.moveMul() === 1);
check('cripple cannot be chained (immunity)', s.apply('cripple') === false);
s.update(STATUS.cripple.immune + 0.1);
check('cripple works again after the immunity', s.apply('cripple') === true);

s = new Statuses(); s.apply('bleed', 2);
const dmg = s.update(1);
check('bleed deals damage over time', near(dmg, STATUS.bleed.dps), dmg.toFixed(2));
s = new Statuses(); s.apply('cripple', 2);
check('cripple adds a light bleed', near(s.update(1), STATUS.cripple.bleed));
s.clear('cripple'); check('clear removes one status', !s.has('cripple'));
s = new Statuses(); s.apply('bleed'); s.apply('daze'); s.clear(); check('clear() removes all', s.list().length === 0);

s = new Statuses(); s.apply('stun'); check('stun roots', s.moveMul() <= 0.15);
s.update(STATUS.stun.dur + 0.01); check('stun cannot be chained', s.apply('stun') === false);
check('unknown status is ignored', new Statuses().apply('nope') === false);
check('tint priority: stun first', (() => { const t = new Statuses(); t.apply('bleed'); t.apply('stun'); return t.tint() === 0x555500; })());
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
