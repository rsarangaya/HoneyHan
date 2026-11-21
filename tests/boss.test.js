// Boss framework, plain Node: node tests/boss.test.js. Pure moveHits per shape, def validation, zone bands, move selection.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, THREE: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/boss.js'), 'utf8'), ctx, { filename: 'js/boss.js' });
const { BOSS_DEFS, moveHits, validateBossDef, bossZone, bossNormalize, bossTakeMul, bossCardLines, BOSS_LANE, bossLaneAt, bossLanesUpdate, BOSS_SHOT, BOSS_PUD, bossPuddleMul, bossPuddlesUpdate, diveHit } = vm.runInContext('({ BOSS_DEFS, moveHits, validateBossDef, bossZone, bossNormalize, bossTakeMul, bossCardLines, BOSS_LANE, bossLaneAt, bossLanesUpdate, BOSS_SHOT, BOSS_PUD, bossPuddleMul, bossPuddlesUpdate, diveHit })', ctx);
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

// the Harvest King and the Fungal Warden: the move tables from the spec (numbers live in the defs)
const sc = BOSS_DEFS.scarecrow, mu = BOSS_DEFS.mushroom, mvOf = (d, id) => d.byId[id];
check('Orchard and Cellar themes use the scarecrow and mushroom defs, named Harvest King and Fungal Warden', BOSS_DEFS.orchard === sc && BOSS_DEFS.cellar === mu && sc.name === 'Harvest King' && mu.name === 'Fungal Warden' && sc.theme === 'The Moonlit Orchard' && mu.theme === 'The Mushroom Cellar');
check('scarecrow: scale 1.8, hp x0.9, 50% phase with no adds; mushroom: scale 1.6, hp x1.2, speed x0.7, 50% phase adds 3 puffers', sc.scale === 1.8 && sc.hpMul === 0.9 && sc.phases.length === 1 && sc.phases[0].at === 0.5 && !sc.phases[0].add && mu.scale === 1.6 && mu.hpMul === 1.2 && mu.speedMul === 0.7 && mu.phases[0].at === 0.5 && mu.phases[0].add.join() === 'puffer,puffer,puffer');
const j = mvOf(sc, 'jab'), sw = mvOf(sc, 'sweep'), cr = mvOf(sc, 'crows'), mdr = mvOf(sc, 'murder'), ts = mvOf(sc, 'toss');
check('Pitchfork Jab: cone 3.4 m 50 deg, wind 0.7, dmg 1.1, body, parry', j.shape === 'cone' && j.reach === 3.4 && j.arc === 50 && j.wind === 0.7 && j.dmg === 1.1 && j.zone === 'body' && j.parry === true);
check('Hay Sweep: ground circle r 3.2, wind 0.9, dmg 1.0, legs, knock 2 m', sw.shape === 'circle' && sw.r === 3.2 && sw.wind === 0.9 && sw.dmg === 1 && sw.zone === 'legs' && sw.ground && sw.knock === 2);
check('Crow Swarm: 5 crows, 40 deg fan, speed 9, wind 0.8, 0.35 each, phase 1 only; Murder: 7 crows from phase 2', cr.n === 5 && cr.arc === 40 && cr.speed === 9 && cr.wind === 0.8 && cr.dmg === 0.35 && cr.kind === 'crow' && cr.phase[1] === 0 && mdr.n === 7 && mdr.phase[0] === 1);
check('Hay Toss: three ground circles r 2 on the player, 0.8 each, chained, only in phase 2, chained moves are never picked directly', ts.r === 2 && ts.at === 'target' && ts.dmg === 0.8 && ts.next === 'toss2' && mvOf(sc, 'toss2').next === 'toss3' && mvOf(sc, 'toss2').chain && mvOf(sc, 'toss3').chain && ts.phase[0] === 1 && !mvOf(sc, 'toss3').next);
const sl = mvOf(mu, 'slam'), lb = mvOf(mu, 'lob'), bu = mvOf(mu, 'burst'), rt = mvOf(mu, 'roots');
check('Cap Slam: ground circle r 3.0, wind 1.0, dmg 1.2, knock 2 m', sl.r === 3 && sl.wind === 1 && sl.dmg === 1.2 && sl.ground && sl.knock === 2);
check('Spore Lob: circle r 3.5 at the player, wind 0.9, a 6 s cloud with 2.5 s daze, no damage', lb.r === 3.5 && lb.at === 'target' && lb.wind === 0.9 && lb.dmg === 0 && lb.cloud.dur === 6 && lb.cloud.daze === 2.5);
check('Spore Burst: circle r 6 around itself, wind 1.2, dmg 0.8, daze, knock 3 m, then 1.5 s with the cap deflated (body hits x1.3)', bu.r === 6 && bu.wind === 1.2 && bu.dmg === 0.8 && bu.status === 'daze' && bu.knock === 3 && bu.rec === 1.5 && bu.expose.t === 1.5 && bu.expose.mul === 1.3);
check('Mycelium Roots: 3 lines 10 x 1.2, wind 1.0, 0.9, knock 1 m, phase 2 only', rt.shape === 'line' && rt.n === 3 && rt.len === 10 && rt.width === 1.2 && rt.wind === 1 && rt.dmg === 0.9 && rt.knock === 1 && rt.phase[0] === 1);
check('bands: scarecrow legs/body/head by metre, mushroom legs < 0.8, body 0.8-1.8, head above', sc.bands.length === 3 && mu.bands[0] === 0.8 && mu.bands[1] === 1.8 && bossZone(0.5, { alt: 0, def: mu }) === 'legs' && bossZone(1.2, { alt: 0, def: mu }) === 'body' && bossZone(2.0, { alt: 0, def: mu }) === 'head');
// fanned lines
const fan = { shape: 'line', zone: 'legs', len: 10, width: 1.2, n: 3, spread: 28 }, a28 = 28 * Math.PI / 180;
check('fanned lines: the middle one along the facing, the side ones 28 degrees off; between two lines is safe, behind is safe', moveHits(fan, boss(), pl(0, -6)) === 'legs' && moveHits(fan, boss(), pl(-6 * Math.sin(a28), -6 * Math.cos(a28))) === 'legs' && moveHits(fan, boss(), pl(6 * -Math.sin(-a28), -6 * Math.cos(a28))) === 'legs' && moveHits(fan, boss(), pl(-6 * Math.sin(a28 / 2), -6 * Math.cos(a28 / 2))) === null && moveHits(fan, boss(), pl(0, 3)) === null && moveHits(fan, boss(), pl(0, -10.6)) === null);
// the cap-deflated window
check('bossTakeMul: body hits x1.3 only while the window runs, never head or legs', bossTakeMul({ bs: { exp: 1, expMul: 1.3 } }, 'body') === 1.3 && bossTakeMul({ bs: { exp: 1, expMul: 1.3 } }, 'head') === 1 && bossTakeMul({ bs: { exp: 0, expMul: 1.3 } }, 'body') === 1 && bossTakeMul({ bs: null }, 'body') === 1);
const txt = bossCardLines(sc, 200).join(' ');
check('the glossary card text names every unchained move and each def validates', sc.moves.filter(m => !m.chain).every(m => txt.includes(m.name)) && !txt.includes('heavy plate') && validateBossDef(sc).length === 0 && validateBossDef(mu).length === 0);

// the Librarian Lich and the Frost Giant (numbers live in the defs)
const li = BOSS_DEFS.lich, gi = BOSS_DEFS.giant;
check('Library and Chapel themes use the lich and giant defs, named Librarian Lich and Frost Giant', BOSS_DEFS.library === li && BOSS_DEFS.chapel === gi && li.name === 'Librarian Lich' && gi.name === 'Frost Giant' && li.theme === 'The Clockwork Library' && gi.theme === 'The Frozen Chapel');
check('lich: scale 1.7, hp x0.9, 50% phase adds 2 books; giant: scale 2.0, hp x1.1, speed x0.85, 50% phase with no adds', li.scale === 1.7 && li.hpMul === 0.9 && li.phases.length === 1 && li.phases[0].at === 0.5 && li.phases[0].add.join() === 'book,book' && gi.scale === 2 && gi.hpMul === 1.1 && gi.speedMul === 0.85 && gi.phases.length === 1 && gi.phases[0].at === 0.5 && !gi.phases[0].add);
const bs1 = mvOf(li, 'slam'), pv = mvOf(li, 'pages'), bk = mvOf(li, 'bookmark'), bk2 = mvOf(li, 'bookslam'), tb = mvOf(li, 'barrage'), sp = mvOf(li, 'spiral');
check('Book Slam: cone 2.8 m, wind 0.8, dmg 1.2, head, parry', bs1.shape === 'cone' && bs1.reach === 2.8 && bs1.wind === 0.8 && bs1.dmg === 1.2 && bs1.zone === 'head' && bs1.parry === true);
check('Page Volley: 3 pages fanned, speed 14, wind 0.7, 0.5 each', pv.kind === 'page' && pv.n === 3 && pv.arc > 0 && pv.speed === 14 && pv.wind === 0.7 && pv.dmg === 0.5);
check('Bookmark: a blink with a 0.8 s telegraph and marker, chained to a quick Book Slam (wind 0.6, head, parry)', bk.shape === 'blink' && bk.tele && bk.wind === 0.8 && bk.next === 'bookslam' && bk2.chain && bk2.wind === 0.6 && bk2.zone === 'head' && bk2.parry === true && bk2.dmg === 1.2);
check('Tome Barrage: phase 2 only, a ring of 8 pages (wind 1.0, 0.4 each) then a chained spiral; the pool of 12 holds both (8 + 4)', tb.phase[0] === 1 && tb.ring && tb.n === 8 && tb.wind === 1 && tb.dmg === 0.4 && tb.next === 'spiral' && sp.chain && sp.ring && sp.off > 0 && tb.n + sp.n <= 12);
check('the lich has no ground moves (a block and a parry are the answer)', li.moves.every(m => !m.ground) && li.bands.join() === '1.1,2.6,3.6');
const fi = mvOf(gi, 'fist'), ic = mvOf(gi, 'icicles'), fz = mvOf(gi, 'freeze'), nv = mvOf(gi, 'nova');
check('Shard Fist: cone 3.2 m, wind 0.85, dmg 1.15, body, parry', fi.shape === 'cone' && fi.reach === 3.2 && fi.wind === 0.85 && fi.dmg === 1.15 && fi.zone === 'body' && fi.parry === true);
check('Icicle Volley: 3 shards in a line, speed 16, wind 0.7, 0.45 each, slow on hit', ic.kind === 'shard' && ic.n === 3 && ic.gap > 0 && ic.speed === 16 && ic.wind === 0.7 && ic.dmg === 0.45 && ic.status === 'slow');
check('Ground Freeze: line 14 x 2.4, wind 1.0, 0.8, ground, slow, knock 1 m, an ice lane for 6 s', fz.shape === 'line' && fz.len === 14 && fz.width === 2.4 && fz.wind === 1 && fz.dmg === 0.8 && fz.ground && fz.status === 'slow' && fz.knock === 1 && fz.lane.dur === 6);
check('Shatter Nova: phase 2 only, circle r 7, wind 1.3, 1.3, ground, knock 4 m, then exposed 2 s with x1.25 on any hit', nv.shape === 'circle' && nv.r === 7 && nv.wind === 1.3 && nv.dmg === 1.3 && nv.ground && nv.knock === 4 && nv.phase[0] === 1 && nv.expose.t === 2 && nv.expose.mul === 1.25 && nv.expose.all === true && nv.rec === 2);
check('giant bands: legs < 1.0, body 1.0-2.4, head above', bossZone(0.5, { alt: 0, def: gi }) === 'legs' && bossZone(1.5, { alt: 0, def: gi }) === 'body' && bossZone(3, { alt: 0, def: gi }) === 'head');
check('bossTakeMul: an open window with expAll is x mul on every zone, without it body only', bossTakeMul({ bs: { exp: 1, expMul: 1.25, expAll: true } }, 'head') === 1.25 && bossTakeMul({ bs: { exp: 1, expMul: 1.25, expAll: true } }, 'legs') === 1.25 && bossTakeMul({ bs: { exp: 0, expMul: 1.25, expAll: true } }, 'head') === 1 && bossTakeMul({ bs: { exp: 1, expMul: 1.3, expAll: false } }, 'head') === 1);
check('the blink shape is valid, page and shard shots exist', validateBossDef(li).length === 0 && validateBossDef(gi).length === 0 && BOSS_SHOT.page && BOSS_SHOT.shard);
check('the glossary cards name every move, the lane and the blink', (t => li.moves.filter(m => !m.chain).every(m => t.includes(m.name)) && t.includes('appears behind you'))(bossCardLines(li, 200).join(' ')) && (t => gi.moves.every(m => t.includes(m.name)) && t.includes('icy'))(bossCardLines(gi, 200).join(' ')));
// ice lanes: pure point test
const L0 = BOSS_LANE.items[0]; Object.assign(L0, { t: 6, dur: 6, x: 0, z: 0, dx: 0, dz: -1, len: 14, w: 2.4 }); BOSS_LANE.n = 1;
check('bossLaneAt: on the strip yes; beside it, behind it and past its end no', bossLaneAt(0, -7) && bossLaneAt(1.2, -3) && !bossLaneAt(1.6, -3) && !bossLaneAt(0, 1) && !bossLaneAt(0, -14.5));
bossLanesUpdate(5.5); check('a lane melts after its time and then nothing is on ice', bossLaneAt(0, -7) && (bossLanesUpdate(1), !bossLaneAt(0, -7) && BOSS_LANE.n === 0));

// Moonfang, the Giant Innkeeper and the Goblin Warlord (numbers live in the defs)
const ww = BOSS_DEFS.werewolf, ik = BOSS_DEFS.innkeeper, wl = BOSS_DEFS.warlord;
check('Jungle, Tavern and Market themes use the werewolf, innkeeper and warlord defs, named Moonfang, Giant Innkeeper and Goblin Warlord; the generic cave def keeps its own name', BOSS_DEFS.jungle === ww && BOSS_DEFS.tavern === ik && BOSS_DEFS.market === wl && ww.name === 'Moonfang' && ik.name === 'Giant Innkeeper' && wl.name === 'Goblin Warlord' && ww.theme === 'The Overgrown Ruin' && ik.theme === 'The Sunken Tavern' && wl.theme === 'The Goblin Market' && BOSS_DEFS.cave.name === 'Cave Warlord' && Object.keys(BOSS_DEFS).every(k => BOSS_DEFS[k] === ww || BOSS_DEFS[k].name !== 'Cave Warlord' || BOSS_DEFS[k] === BOSS_DEFS.cave || k === 'final'));
check('werewolf: scale 1.7, hp x1.0, speed x1.05, bands 0.9 / 1.9, model werewolf; phase 2 at 50% with speed x1.2; innkeeper: scale 1.7, hp x1.0, speed x1.15 in phase 2 with two bandits; warlord: scale 1.6 (default), hp x1.1, no adds', ww.scale === 1.7 && ww.hpMul === 1 && ww.speedMul === 1.05 && ww.bands[0] === 0.9 && ww.bands[1] === 1.9 && ww.model === 'werewolf' && ww.phases.length === 1 && ww.phases[0].at === 0.5 && ww.phases[0].speedMul === 1.2 && ik.scale === 1.7 && ik.hpMul === 1 && ik.bands === null && ik.phases[0].at === 0.5 && ik.phases[0].speedMul === 1.15 && ik.phases[0].add.join() === 'bandit,bandit' && wl.scale === null && wl.hpMul === 1.1 && wl.phases[0].at === 0.5 && !wl.phases[0].add);
const rk = mvOf(ww, 'rake'), rk2 = mvOf(ww, 'rake2'), bi = mvOf(ww, 'bite'), po = mvOf(ww, 'pounce'), po2 = mvOf(ww, 'pounce2'), ho = mvOf(ww, 'howl'), ho2 = mvOf(ww, 'howl2');
check('Claw Rake: cone 2.6 m, two hits (wind 0.55 then 0.4, 0.7 each), both parryable, the second only ever chained', rk.shape === 'cone' && rk.reach === 2.6 && rk.wind === 0.55 && rk.dmg === 0.7 && rk.next === 'rake2' && rk2.wind === 0.4 && rk2.dmg === 0.7 && rk2.reach === 2.6 && rk2.chain && rk.parry && rk2.parry);
check('Bite: cone 2.0 m, wind 0.7, 1.4, head, parry', bi.shape === 'cone' && bi.reach === 2 && bi.wind === 0.7 && bi.dmg === 1.4 && bi.zone === 'head' && bi.parry === true);
check('Pounce: a leap with a 0.9 s crouch, the landing locks at the end of it, up to 10 m, ground circle r 2.2, 1.3, knock 3 m, recovers 1.2 s; the second pounce is chained in phase 2 only', po.shape === 'leap' && po.wind === 0.9 && po.lock === 'end' && po.maxD === 10 && po.r === 2.2 && po.dmg === 1.3 && po.ground && po.knock === 3 && po.rec === 1.2 && po.next === 'pounce2' && po2.chain && po2.phase[0] === 1 && po2.rec === 1.2 && po2.knock === 3);
check('Howl: summons 2 wolves (cap 4), wind 1.2, recovers 1.5 s; from phase 2 a quicker, likelier howl', ho.shape === 'summon' && ho.spawn === 'wolf' && ho.n === 2 && ho.cap === 4 && ho.wind === 1.2 && ho.rec === 1.5 && ho.phase[1] === 0 && ho2.phase[0] === 1 && ho2.cd < ho.cd && ho2.weight > ho.weight && ho2.spawn === 'wolf');
const ms = mvOf(ik, 'smash'), cb1 = mvOf(ik, 'combo'), cb2 = mvOf(ik, 'combo2'), cb3 = mvOf(ik, 'combo3'), cbf = mvOf(ik, 'fin'), bo = mvOf(ik, 'bottles'), kg = mvOf(ik, 'keg');
check('Mug Smash: cone 3.0 m 70 deg, wind 0.7, 1.1, head, parry', ms.reach === 3 && ms.arc === 70 && ms.wind === 0.7 && ms.dmg === 1.1 && ms.zone === 'head' && ms.parry === true);
check('Brawl Combo: winds 0.55 / 0.4 / 0.8, damage 0.6 / 0.7 / 1.3, body / body / head; only the finisher is parryable; phase 2 chains a 4th hit before the finisher', [cb1.wind, cb2.wind, cbf.wind].join() === '0.55,0.4,0.8' && [cb1.dmg, cb2.dmg, cbf.dmg].join() === '0.6,0.7,1.3' && [cb1.zone, cb2.zone, cbf.zone].join() === 'body,body,head' && cb1.parry === false && cb2.parry === false && cbf.parry === true && cb1.next === 'combo2' && cb2.next.join() === 'combo3,fin' && cb3.phase[0] === 1 && cb3.next === 'fin' && cb2.chain && cb3.chain && cbf.chain);
check('Bottle Toss: 3 bottles, wind 0.7, 0.5 each, splash r 1.2, a 5 s puddle that slows; Keg Roll: line 12 x 1.4, wind 1.0, 1.2, legs, ground, knock 3 m', bo.kind === 'bottle' && bo.n === 3 && bo.wind === 0.7 && bo.dmg === 0.5 && bo.splash === 1.2 && bo.puddle.dur === 5 && bo.puddle.slow < 1 && kg.shape === 'line' && kg.len === 12 && kg.width === 1.4 && kg.wind === 1 && kg.dmg === 1.2 && kg.zone === 'legs' && kg.ground && kg.knock === 3);
const cl = mvOf(wl, 'cleave'), cg = mvOf(wl, 'charge'), cv = mvOf(wl, 'cleaver'), ry = mvOf(wl, 'rally'), wh = mvOf(wl, 'whirl');
check('War Cleave: cone 3.2 m, wind 0.75, 1.1, parry; Shield Charge: wind 0.9, speed 11, range 6-14 m, 1.3 on the legs, ground, knock 3 m, stuns itself 1.2 s on stonework', cl.reach === 3.2 && cl.wind === 0.75 && cl.dmg === 1.1 && cl.parry === true && cg.shape === 'charge' && cg.wind === 0.9 && cg.speed === 11 && cg.minD === 6 && cg.maxD === 14 && cg.dmg === 1.3 && cg.zone === 'legs' && cg.ground && cg.knock === 3 && cg.selfStun === 1.2);
check('Cleaver Throw: an axe, wind 0.8, 0.9; Banner Rally: 2 goblins (cap 4), wind 1.2; Whirlwind: phase 2 only, circle r 3.4, 3 ticks of 0.5 over 1.6 s, wind 1.0, ground, knock 3 m', cv.kind === 'axe' && cv.wind === 0.8 && cv.dmg === 0.9 && BOSS_SHOT.axe && BOSS_SHOT.bottle && ry.shape === 'summon' && ry.spawn === 'goblin' && ry.n === 2 && ry.cap === 4 && ry.wind === 1.2 && wh.phase[0] === 1 && wh.r === 3.4 && wh.ticks === 3 && wh.dmg === 0.5 && wh.spin === 1.6 && wh.wind === 1 && wh.ground && wh.knock === 3);
check('the three new defs validate (every telegraph >= 0.5 s for hits of 1.0+, ground >= 0.8 s, chains and next lists exist)', [ww, ik, wl].every(d => validateBossDef(d).length === 0), [ww, ik, wl].map(d => validateBossDef(d).join()).join('|'));
check('validation: a next list with a missing id is caught', validateBossDef(mk({ moves: [{ id: 'a', shape: 'cone', wind: 1, next: ['a', 'zz'] }] })).length === 1);
check('werewolf bands: legs < 0.9, body 0.9-1.9, head above', bossZone(0.5, { alt: 0, def: ww }) === 'legs' && bossZone(1.4, { alt: 0, def: ww }) === 'body' && bossZone(2.2, { alt: 0, def: ww }) === 'head' && bossZone(3.2, { alt: 0, def: ww }) === null);
// charge: the hit is a circle round the boss; the leap and the whirlwind are the existing shapes
check('charge hits only within its r of the boss (a body ploughing into you), direction irrelevant', moveHits(cg, boss(), pl(1.5, 0)) === 'legs' && moveHits(cg, boss(), pl(0, 1.6)) === 'legs' && moveHits(cg, boss(), pl(0, -1.9)) === null && moveHits(cg, boss(), pl(5, 0)) === null);
check('whirlwind circle: hits within r 3.4 round the boss, not beyond', moveHits(wh, boss(), pl(3.3, 0)) === 'body' && moveHits(wh, boss(), pl(0, 3.7)) === 'body' && moveHits(wh, boss(), pl(0, 3.9)) === null);
check('pounce landing circle follows the locked target, not the boss', moveHits(po, boss({ bs: { tx: 8, tz: 0 } }), pl(8, 1)) === 'body' && moveHits(po, boss({ bs: { tx: 8, tz: 0 } }), pl(0, 1)) === null);
// puddles: the speed multiplier and drying
const PD = BOSS_PUD.items[0]; Object.assign(PD, { t: 5, dur: 5, x: 0, z: 0, r: 1.2, slow: 0.7 }); BOSS_PUD.n = 1;
check('bossPuddleMul: 0.7 inside the puddle (radius + 0.1), 1 beside it; it dries after its time and nothing is slow after', bossPuddleMul(1, 0) === 0.7 && bossPuddleMul(1.3, 0) === 0.7 && bossPuddleMul(1.5, 0) === 1 && (bossPuddlesUpdate(4.9), bossPuddleMul(0, 0) === 0.7) && (bossPuddlesUpdate(0.2), bossPuddleMul(0, 0) === 1 && BOSS_PUD.n === 0));
const ct = [ww, ik, wl].map(d => bossCardLines(d, 220).join(' '));
check('the glossary cards name every unchained move, say the charge stuns itself, the bottles leave puddles, and a block still hurts on ground moves', [ww, ik, wl].every((d, i) => d.moves.filter(m => !m.chain).every(m => ct[i].includes(m.name))) && ct[2].includes('stuns itself') && ct[1].includes('puddles') && ct[0].includes('blocking still hurts') && !ct.join(' ').includes('Cave Warlord'));
// Cinder Wyrm (the final boss): the def, its moves, the flight cycle table, and the pure hit tests of its new shapes
const dr = BOSS_DEFS.dragon, dm = id => dr.byId[id];
check('the final arena\'s def (bossId final) is the dragon: Cinder Wyrm, scale 1.7, hp x1.0, model dragon, bands 1.2 / 2.6 / 4.6 with a lower head band for the Bite, melee reaches up to 2.5 m', BOSS_DEFS.final === dr && dr.name === 'Cinder Wyrm' && dr.scale === 1.7 && dr.hpMul === 1 && dr.model === 'dragon' && dr.bands.join() === '1.2,2.6,4.6' && dr.lowBands.join() === '0.9,1.6,2.4' && dr.meleeAlt === 2.5 && dr.theme === 'The Final Chamber');
check('the dragon def validates (telegraphs, ground winds >= 0.8 s, a land and a buffet move, one cycle pair per phase)', validateBossDef(dr).length === 0, validateBossDef(dr).join('; '));
check('phases at 66% and 33% (descending), each a roar of 1.4 s with 30% more attacks; the last third is enraged x1.2', dr.phases.length === 2 && dr.phases[0].at === 0.66 && dr.phases[1].at === 0.33 && dr.phases.every(p => p.dur === 1.4 && p.gcdMul === 0.7) && dr.phases[1].enrage === 1.2 && !dr.phases[0].enrage);
check('flight: fly 12 / land 12 in the first phase, 10 / 12 in the second, 8 / 14 in the third; it orbits at 6.4 m, 9 m/s, on a clear ring (about 16.5 to 17 m is the gap between the two pillar rings; farther ones are fallbacks), and takes off early after 18% of its health lost in one landing', JSON.stringify(dr.fly.cyc) === '[[12,12],[10,12],[8,14]]' && dr.fly.alt === 6.4 && dr.fly.speed === 9 && dr.fly.radii.every(r => r >= 14.5 && r <= 23) && dr.fly.radii[0] >= 16.5 && dr.fly.radii[0] <= 17 && dr.fly.early === 0.18);
const [bite, claw, tail, breath, buf, strafe, sweep, volley, land] = ['bite', 'claw', 'tail', 'breath', 'buffet', 'strafe', 'sweep', 'volley', 'land'].map(dm);
check('landed moves: Bite cone 4.5 m 40 deg wind 0.8 x1.4 head parry (head drops); Claw Swipe cone 5 m 120 deg wind 0.7 x1.0 body parry; Tail Sweep circle r 6 wind 1.0 x1.0 legs ground knock 5; Close Breath cone 12 m 50 deg wind 1.1 ground; Takeoff Buffet circle r 7 wind 0.9 x0.5, chained, ends in the take-off',
  bite.shape === 'cone' && bite.reach === 4.5 && bite.arc === 40 && bite.wind === 0.8 && bite.dmg === 1.4 && bite.zone === 'head' && bite.parry === true && bite.lowHead === true && claw.reach === 5 && claw.arc === 120 && claw.wind === 0.7 && claw.dmg === 1 && claw.zone === 'body' && claw.parry === true
  && tail.shape === 'circle' && tail.r === 6 && tail.wind === 1 && tail.dmg === 1 && tail.zone === 'legs' && tail.ground && tail.knock === 5 && breath.reach === 12 && breath.arc === 50 && breath.wind === 1.1 && breath.ground && buf.r === 7 && buf.wind === 0.9 && buf.dmg === 0.5 && buf.chain && buf.after === 'fly');
check('air moves: Strafe Run a 3 m strip, wind 1.0, x1.3, 22 m/s, ground, knock 3; Fire Sweep cone 24 m 40 deg wind 1.2 turning 70 deg over 2.0 s, 0.45 per 0.4 s, 6 flame patches of 4 s; Fireball Volley 3 fire shots landing 1.1 s after, rings r 2.5, wind 0.8, x1.0; Landing circle r 7, wind 1.5, x1.2, ground, knock 5',
  strafe.air && strafe.shape === 'dive' && strafe.width === 3 && strafe.wind === 1 && strafe.dmg === 1.3 && strafe.speed === 22 && strafe.ground && strafe.knock === 3 && sweep.air && sweep.reach === 24 && sweep.arc === 40 && sweep.wind === 1.2 && sweep.sweep === 70 && sweep.spin === 2 && sweep.tick === 0.4 && sweep.dmg === 0.45 && sweep.flame.n === 6 && sweep.flame.dur === 4
  && volley.air && volley.kind === 'fire' && volley.n === 3 && volley.flight === 1.1 && volley.r === 2.5 && volley.wind === 0.8 && volley.dmg === 1 && land.air && land.chain && land.r === 7 && land.wind === 1.5 && land.dmg === 1.2 && land.ground && land.knock === 5);
check('every ground move is telegraphed at least 0.8 s; the air moves are strafe, sweep, volley and land; Buffet and Landing are only ever started by the cycle (chain)', dr.moves.filter(m => m.ground).every(m => m.wind >= 0.8) && dr.moves.filter(m => m.air).map(m => m.id).join() === 'strafe,sweep,volley,land' && land.chain && buf.chain);
// pure hit tests of the new shapes
check('sweep is a cone (24 m + 0.5, 40 deg): ahead hits, 15 deg off hits, 30 deg off and beyond 24.6 m miss', moveHits(sweep, boss(), pl(0, -20)) === 'body' && moveHits(sweep, boss(), pl(-20 * Math.sin(0.26), -20 * Math.cos(0.26))) === 'body' && moveHits(sweep, boss(), pl(-20 * Math.sin(0.52), -20 * Math.cos(0.52))) === null && moveHits(sweep, boss(), pl(0, -24.6)) === null);
check('land is a circle on the locked spot (r 7 + the player radius), not on the boss', moveHits(land, boss({ bs: { tx: 20, tz: 0 } }), pl(26, 0)) === 'body' && moveHits(land, boss({ bs: { tx: 20, tz: 0 } }), pl(27.5, 0)) === null && moveHits(land, boss({ bs: { tx: 20, tz: 0 } }), pl(0, 1)) === null);
check('breath and tail: the cone reaches 12 m ahead only; the tail circle all round at 6 m', moveHits(breath, boss(), pl(0, -11)) === 'body' && moveHits(breath, boss(), pl(0, 11)) === null && moveHits(tail, boss(), pl(0, 6)) === 'legs' && moveHits(tail, boss(), pl(-6, 0)) === 'legs' && moveHits(tail, boss(), pl(0, 6.5)) === null);
{
  const dv = (px, pz, run, alt) => diveHit(strafe, 0, 0, 0, -1, run, alt, pl(px, pz));
  check('diveHit: it hits as it passes over you (within 2.2 m along the line, inside the 3 m strip + your radius, low enough); sideways, too high, well before or well after do not', dv(0, -10, 10, 1.6) === 'body' && dv(0, -10, 8.0, 1.6) === 'body' && dv(0, -10, 7.5, 1.6) === null && dv(1.8, -10, 10, 1.6) === 'body' && dv(2.0, -10, 10, 1.6) === null && dv(0, -10, 10, 3.5) === null && dv(0, -10, 13, 1.6) === null);
}
check('bossZone while the Bite has the head down: the lower bands (head 1.6 to 2.4 m), nothing above; a flying dragon lifts them; a swing cannot reach it above 2.5 m', bossZone(2.0, { alt: 0, bs: { lowT: 1 }, def: dr }) === 'head' && bossZone(2.0, { alt: 0, bs: { lowT: 0 }, def: dr }) === 'body' && bossZone(2.6, { alt: 0, bs: { lowT: 1 }, def: dr }) === null && bossZone(9, { alt: 6.4, def: dr }) === 'body' && bossZone(11, { alt: 6.4, def: dr }) === 'head' && bossZone(2.5, { alt: 3, def: dr }, 3) === null && bossZone(3.5, { alt: 2, def: dr }, 3) === 'body');
check('the glossary text from the def names Bite, Claw Swipe, Tail Sweep, Close Breath, Strafe Run, Fire Sweep and Fireball Volley and says a block still hurts on ground moves', (t => ['Bite', 'Claw Swipe', 'Tail Sweep', 'Close Breath', 'Strafe Run', 'Fire Sweep', 'Fireball Volley'].every(n => t.includes(n)) && t.includes('blocking still hurts'))(bossCardLines(dr, 660).join(' ')));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
