// Boss framework, plain Node: node tests/boss.test.js. Pure moveHits per shape, def validation, zone bands, move selection.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, THREE: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/boss.js'), 'utf8'), ctx, { filename: 'js/boss.js' });
const { BOSS_DEFS, moveHits, validateBossDef, bossZone, bossNormalize } = vm.runInContext('({ BOSS_DEFS, moveHits, validateBossDef, bossZone, bossNormalize })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

// A boss at the origin facing -z (yaw 0), zone 'body'; the player at (px, pz).
const boss = (extra = {}) => ({ x: 0, z: 0, yaw: 0, zone: 'body', reach: 2.38, bs: { tx: 0, tz: 0, dx: 0, dz: -1 }, ...extra });
const pl = (x, z) => ({ x, z, radius: 0.35 });

// cone
const cone = { shape: 'cone', zone: 'rand', reach: 0, arc: 0 };
check('cone with no arc: hit inside reach + 0.5, miss outside, any direction (the old swing)', moveHits(cone, boss(), pl(0, -2.8)) === 'body' && moveHits(cone, boss(), pl(0, 2.8)) === 'body' && moveHits(cone, boss(), pl(0, -2.9)) === null);
check('a fixed zone wins over the one the boss rolled', moveHits({ ...cone, zone: 'head' }, boss(), pl(0, -2)) === 'head');
const arc = { shape: 'cone', zone: 'body', reach: 3, arc: 70 };
check('cone with an arc: ahead hits, 30 degrees off hits, 60 degrees off and behind miss', moveHits(arc, boss(), pl(0, -2)) === 'body' && moveHits(arc, boss(), pl(-2 * Math.sin(0.5), -2 * Math.cos(0.5))) === 'body' && moveHits(arc, boss(), pl(-2 * Math.sin(1.05), -2 * Math.cos(1.05))) === null && moveHits(arc, boss(), pl(0, 2)) === null);
check('cone reach comes from the move, else the boss', moveHits({ ...cone, reach: 5 }, boss(), pl(0, -5)) === 'body' && moveHits(cone, boss({ reach: 1 }), pl(0, -2)) === null);

// circle
const circ = { shape: 'circle', zone: 'legs', r: 3 };
check('circle round the boss: inside (plus the player radius) hits, outside misses, direction is irrelevant', moveHits(circ, boss(), pl(3, 0)) === 'legs' && moveHits(circ, boss(), pl(0, 3.3)) === 'legs' && moveHits(circ, boss(), pl(0, 3.5)) === null);
check('circle at a locked target hits there, not round the boss', moveHits({ ...circ, at: 'target' }, boss({ bs: { tx: 10, tz: 0 } }), pl(10, 1)) === 'legs' && moveHits({ ...circ, at: 'target' }, boss({ bs: { tx: 10, tz: 0 } }), pl(0, 1)) === null);

// line
const line = { shape: 'line', zone: 'legs', len: 12, width: 1.4 };
check('line along the facing: along its length and inside half the width hits', moveHits(line, boss(), pl(0, -11)) === 'legs' && moveHits(line, boss(), pl(0.9, -5)) === 'legs' && moveHits(line, boss(), pl(1.2, -5)) === null);
check('line misses behind the boss and past its end', moveHits(line, boss(), pl(0, 1)) === null && moveHits(line, boss(), pl(0, -12.6)) === null);
check('a target line follows the locked direction', moveHits({ ...line, at: 'target' }, boss({ bs: { dx: 1, dz: 0 } }), pl(6, 0.3)) === 'legs' && moveHits({ ...line, at: 'target' }, boss({ bs: { dx: 1, dz: 0 } }), pl(0, -6)) === null);

// leap, projectile, summon
check('leap hits in its landing circle only', moveHits({ shape: 'leap', zone: 'body', r: 2.2 }, boss({ bs: { tx: 6, tz: 6 } }), pl(7, 7)) === 'body' && moveHits({ shape: 'leap', zone: 'body', r: 2.2 }, boss({ bs: { tx: 6, tz: 6 } }), pl(0, 0)) === null);
check('projectiles and summons never hit directly', moveHits({ shape: 'projectile' }, boss(), pl(0, -1)) === null && moveHits({ shape: 'summon' }, boss(), pl(0, -1)) === null);

// bands (bossZone)
const bd = (alt, def = {}) => ({ alt, def: { bands: [1.2, 2.6, 4], meleeAlt: 2.5, ...def } });
check('bossZone: legs, body, head by world metre; null above the top and under the floor', bossZone(0.5, bd(0)) === 'legs' && bossZone(2, bd(0)) === 'body' && bossZone(3, bd(0)) === 'head' && bossZone(4.5, bd(0)) === null && bossZone(-0.1, bd(0)) === null);
check('bossZone: alt lifts the bands (an arrow under a flying boss misses, one level with it hits)', bossZone(3, bd(6)) === null && bossZone(9, bd(6)) === 'head' && bossZone(8, bd(6)) === 'body');
check('bossZone: a swing cannot reach a boss above meleeAlt, a low one can', bossZone(1, bd(3), 2) === null && bossZone(3.5, bd(2), 2) === 'body');

// defs
const errs = id => ctx.validateBossDef(BOSS_DEFS[id]);
for (const id of Object.keys(BOSS_DEFS)) check(`def ${id} is valid`, errs(id).length === 0, errs(id).join('; '));
const mk = o => bossNormalize({ name: 'T', moves: [{ id: 'a', shape: 'cone', wind: 0.7, dmg: 1.1 }], phases: [], ...o });
check('validation: a hit of 1.0+ needs a 0.5 s wind', validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 0.4, dmg: 1.0 }] })).length === 1 && validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 0.4, dmg: 0.6 }] })).length === 0 && validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 0.5, dmg: 1.2 }] })).length === 0);
check('validation: ground moves need a 0.8 s telegraph', validateBossDef(mk({ moves: [{ id: 'a', shape: 'circle', r: 3, wind: 0.7, dmg: 0.5, ground: true }] })).length === 1);
check('validation: duplicate move ids and unknown shapes are caught', validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 1 }, { id: 'a', shape: 'cone', wind: 1 }] })).length === 1 && validateBossDef(mk({ moves: [{ id: 'a', shape: 'wave', wind: 1 }] })).length === 1);
check('validation: phases must come in descending HP order', validateBossDef(mk({ phases: [{ at: 0.66 }, { at: 0.33 }] })).length === 0 && validateBossDef(mk({ phases: [{ at: 0.33 }, { at: 0.66 }] })).length === 1 && validateBossDef(mk({ phases: [{ at: 1.2 }] })).length === 1);
check('validation: a chained move must exist', validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 1, next: 'zz' }] })).length === 1);
const cave = BOSS_DEFS.cave;
check('the cave def is one swing: cone, wind from TUNE (0), parry, not ground, no phases', cave.moves.length === 1 && cave.moves[0].shape === 'cone' && cave.moves[0].wind === 0 && cave.moves[0].parry === true && !cave.moves[0].ground && cave.phases.length === 0 && cave.hpMul === 1 && cave.dmgMul === 1);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
