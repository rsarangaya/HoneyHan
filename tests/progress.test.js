// XP curve, point grants, stat formulas, skills, floor XP budget and dash charges, plain Node: node tests/progress.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
const combat = fs.readFileSync(path.join(__dirname, '../js/combat.js'), 'utf8');
const tuneSrc = combat.slice(combat.indexOf('const TUNE = {'), combat.indexOf('\n};', combat.indexOf('const TUNE = {')) + 3);   // just the TUNE block (the rest of combat.js needs THREE)
vm.runInContext(tuneSrc, ctx, { filename: 'js/combat.js (TUNE)' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/progress.js'), 'utf8'), ctx, { filename: 'js/progress.js' });
const G = vm.runInContext('({ TUNE, PROG, STATS, SKILLS, Progress, xpNeed, killXp, xpBudget, stageFactor, floorKey, derive, chargeTick })', ctx);
const { TUNE, PROG, SKILLS, Progress, xpNeed, killXp, xpBudget, floorKey, derive, chargeTick } = G;
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const near = (a, b, e = 0.001) => Math.abs(a - b) < e;
const goblin = {}, rat = { hpMul: 0.2, dmgMul: 0.35 }, brute = { hpMul: 3, dmgMul: 2 };

// curve
check('need(1) is 60 and need(2) is 81', xpNeed(1) === 60 && xpNeed(2) === 81, xpNeed(1) + ' ' + xpNeed(2));
check('the curve is round(60 x 1.35^(l-1))', [1, 5, 10, 19].every(l => xpNeed(l) === Math.round(60 * Math.pow(1.35, l - 1))));
let p = new Progress();
check('59 xp is still level 1, 60 is level 2', p.addXp(59) === 0 && p.level === 1 && p.addXp(1) === 1 && p.level === 2 && p.xp === 0);
// grants: +3 stat points a level, +1 skill point on every 3rd level
p = new Progress(); p.addXp(1e9);
check('level cap is 20 and extra xp is dropped', p.level === 20 && p.xp === 0 && p.need === 0 && p.addXp(500) === 0 && p.level === 20);
check('19 levels give 57 stat points and 6 skill points', p.pts === 57 && p.skp === 6, `${p.pts} ${p.skp}`);
p = new Progress(); p.addXp(60); check('level 2: 3 stat points, no skill point', p.pts === 3 && p.skp === 0);
p.addXp(81); check('level 3: 6 stat points and 1 skill point', p.level === 3 && p.pts === 6 && p.skp === 1);
p = new Progress(); p.addXp(60 + 81 + 109 + 148 + 200); check('one big gain crosses several levels', p.level === 6 && p.skp === 2 && p.pts === 15, `${p.level} ${p.pts} ${p.skp}`);

// kill values
check('a goblin on floor 1 stage 1 is worth 11', near(killXp(goblin, 1, 1, TUNE), 11));
check('later floors and stages pay more', killXp(goblin, 1, 5, TUNE) > killXp(goblin, 1, 1, TUNE) && near(killXp(goblin, 2, 1, TUNE) / killXp(goblin, 1, 1, TUNE), 1.35));
check('rats pay little, brutes a lot', killXp(rat, 1, 1, TUNE) < 4 && killXp(brute, 1, 1, TUNE) > 20);

// floor budget: ordinary kills stop paying, exempt ones do not
p = new Progress(); const key = floorKey(1, 1), bud = xpBudget(1, 1, TUNE);
let paid = 0, n = 0; while (n < 1000) { const r = p.award(11, key, bud, false, TUNE); if (r.capped) break; paid += r.xp; n++; }
check('ordinary XP is paid up to the budget', paid >= bud && paid < bud + 11, `${paid} vs ${bud}`);
const r2 = p.award(11, key, bud, false, TUNE);
check('past the budget a kill pays only the trickle', r2.capped && r2.xp === Math.round(11 * TUNE.xpOverCap));
const lvl = p.total; p.award(500, key, bud, true, TUNE); check('bosses and quests ignore the cap (and do not count toward it)', p.total === lvl + 500 && p.floorXp[key] >= bud && p.floorXp[key] < bud + 11);
check('another floor has its own budget', !p.award(11, floorKey(1, 2), xpBudget(1, 2, TUNE), false, TUNE).capped);
check('the budget grows with floor and stage', xpBudget(1, 5, TUNE) > xpBudget(1, 1, TUNE) && xpBudget(3, 1, TUNE) > xpBudget(1, 1, TUNE) && xpBudget(4, 4, TUNE) > xpBudget(2, 4, TUNE));

// stats
p = new Progress(); let d = derive(p, TUNE, {});
check('no points: all neutral (2 charges, 6 s, 6 m)', d.dmgMul === 1 && d.atkSpd === 1 && d.stamMax === 100 && d.noiseMul === 1 && d.senseMul === 1 && d.dashMax === 2 && d.dashRecharge === 6 && d.dashDist === 6 && d.dashIframe === 0 && d.stamDelay === TUNE.staminaDelay);
p.pts = 50; for (let i = 0; i < 3; i++) p.spendStat('vig'); for (let i = 0; i < 5; i++) p.spendStat('str'); for (let i = 0; i < 4; i++) p.spendStat('end'); for (let i = 0; i < 5; i++) p.spendStat('agi'); for (let i = 0; i < 6; i++) p.spendStat('ste');
d = derive(p, TUNE, {});
check('Vigor +8 HP a point', d.hpBonus === 24);
check('Strength +4% damage a point', near(d.dmgMul, 1.2));
check('Endurance +6 stamina and +4% regen a point', d.stamMax === 124 && near(d.regenMul, 1.16));
check('Agility +3% attack speed and -4% dash recharge a point', near(d.atkSpd, 1.15) && near(d.dashRecharge, 6 * 0.8));
check('Stealth -4% noise and -3% sight a point', near(d.noiseMul, 0.76) && near(d.senseMul, 0.82));
for (let i = 0; i < 20; i++) p.stat.ste++; d = derive(p, TUNE, {});
check('Stealth never goes below 60%', d.noiseMul === 0.6 && d.senseMul === 0.6);
check('a point cannot be spent without points, and not on an unknown stat', !new Progress().spendStat('vig') && !p.spendStat('luck'));

// skills
p = new Progress(); p.skp = 20;
for (let i = 0; i < 3; i++) check(`dash charges rank ${i + 1} spends a point`, p.spendSkill('dashCh'));
check('a skill stops at its max rank and keeps the point', !p.spendSkill('dashCh') && p.skp === 17);
p.spendSkill('dashRe'); p.spendSkill('dashRe'); p.spendSkill('dashDi'); p.spendSkill('silent'); p.spendSkill('wind'); p.spendSkill('wind');
d = derive(p, TUNE, {});
check('+1 charge a rank', d.dashMax === 5);
check('-15% recharge a rank', near(d.dashRecharge, 6 * 0.7));
check('+1 m and 0.12 s invulnerable a rank', d.dashDist === 7 && near(d.dashIframe, 0.12));
check('Silent step -25% crouch noise a rank', near(d.crouchNoise, 0.75));
check('Second wind -0.2 s regen delay a rank', near(d.stamDelay, TUNE.staminaDelay - 0.4));
check('every skill in the table has a positive cap and text', SKILLS.every(k => k.max > 0 && k.desc && k.per > 0));

// dash charges: one comes back at a time
let ch = { n: 0, t: 0 };
chargeTick(ch, 5.9, 2, 6); check('nothing back before 6 s', ch.n === 0);
chargeTick(ch, 0.2, 2, 6); check('one charge after 6 s, the next clock keeps the 0.1 s over', ch.n === 1 && near(ch.t, 0.1));
chargeTick(ch, 5.9, 2, 6); check('the second one 6 s later, then it stops at max', ch.n === 2 && ch.t === 0);
chargeTick(ch, 100, 2, 6); check('never above max', ch.n === 2);
ch = { n: 0, t: 0 }; chargeTick(ch, 100, 3, 6); check('a long gap refills but not past max', ch.n === 3);
ch = { n: 1, t: 0 }; chargeTick(ch, 3, 2, 6); ch.n--; chargeTick(ch, 3, 2, 6); check('spending a charge mid-recharge does not reset the clock', ch.n === 1 && near(ch.t, 0));

// balance notes: a floor of about 12 guards pays about 70-80% of its budget
const clear = 85;   // measured: the 8 guards of seed 3 floor 1 pay 85 xp (see STATUS.md)
check('a full clear of floor 1 is about 65-80% of its budget', clear / bud > 0.65 && clear / bud < 0.8, (clear / bud).toFixed(2));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
