// Hunger rules, plain Node: node tests/hunger.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/hunger.js'), 'utf8'), ctx, { filename: 'js/hunger.js' });
const { Hunger, HUNGER } = vm.runInContext('({ Hunger, HUNGER })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const walk = { sprinting: false, still: false, crouching: false };
const half = () => 0.5;   // rnd that makes the growl timer exactly growlEvery

let h = new Hunger();
for (let i = 0; i < 900; i++) h.update(1, walk, half);
check('100 to 0 in 15 minutes of normal play', h.v < 0.5, h.v.toFixed(2));
h = new Hunger(); h.update(10, { ...walk, sprinting: true }, half); check('sprinting drains twice as fast', near(100 - h.v, HUNGER.drainPerSec * 10 * 2));
h = new Hunger(); h.update(10, { ...walk, still: true }, half); check('standing still drains slower', near(100 - h.v, HUNGER.drainPerSec * 10 * 0.6));
h = new Hunger(); h.update(10, { ...walk, crouching: true }, half); check('crouching drains slower', near(100 - h.v, HUNGER.drainPerSec * 10 * 0.6));
h = new Hunger(); h.fight = 3; h.update(1, walk, half); check('fighting drains faster', near(100 - h.v, HUNGER.drainPerSec * 1.6));
h = new Hunger(); h.fight = 3; h.update(1, { ...walk, sprinting: true }, half); check('sprinting wins over fighting', near(100 - h.v, HUNGER.drainPerSec * 2));

h = new Hunger();
check('starts fed', h.stage === 'fed' && h.regenMul() === 1 && h.maxStaminaMul() === 1 && h.canSprint());
h.v = 49.9; check('hungry below 50', h.stage === 'hungry' && h.regenMul() === HUNGER.regenHungry && h.maxStaminaMul() === 1);
h.v = 24.9; check('weak below 25', h.stage === 'weak' && h.regenMul() === HUNGER.regenWeak && h.maxStaminaMul() === HUNGER.maxStamWeak && h.canSprint());
h.v = 0; check('starving at 0: no sprint', h.stage === 'starving' && !h.canSprint());

h = new Hunger(); h.v = 50.05; let changes = [];
for (let i = 0; i < 60; i++) { const r = h.update(1, walk, half); if (r.stage) changes.push(r.stage); }
check('a stage change is reported once', changes.join() === 'hungry', changes.join());

h = new Hunger(); h.v = 40; h.growlT = 0.5; let g = h.update(1, { ...walk, still: true }, half);
check('hungry stomach growls faintly', g.growl === HUNGER.growlHungry, String(g.growl));
check('the next growl is about 20 s away', near(h.growlT, HUNGER.growlEvery, 0.01), h.growlT.toFixed(1));
h.v = 10; h.growlT = 0.1; g = h.update(1, { ...walk, still: true }, half); check('weak stomach growls louder', g.growl === HUNGER.growlWeak);
h = new Hunger(); h.growlT = 0.1; check('a fed player never growls', h.update(1, walk, half).growl === 0);

h = new Hunger(); h.v = 0; let hp = 0; for (let i = 0; i < 40; i++) hp += h.update(1, { ...walk, still: true }, half).hp;
check('starving costs 1 HP every 4 s', hp === 10, hp + ' HP in 40 s');
h = new Hunger(); h.v = 30; hp = 0; for (let i = 0; i < 40; i++) hp += h.update(1, walk, half).hp; check('no HP loss before starving', hp === 0);
h = new Hunger(); h.v = 90; h.feed(30); check('food cannot overfill', h.v === 100);
h = new Hunger(); h.v = 0; h.update(1, walk, half); h.feed(25); check('eating ends starvation', h.stage === 'weak' || h.stage === 'hungry');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
