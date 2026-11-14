// Boss framework (BOSS1): data-driven bosses (BOSS_DEFS), the boss state machine Enemy.updateBoss runs, the pure hit test moveHits
// (plain Node tests: tests/boss.test.js), pooled ground telegraphs and pooled projectile meshes, summons and the non-biped hit-zone hook.
// Nothing here allocates per frame: the state (enemy.bs) is built once per boss, the pools are built lazily once per floor group.
//
// BOSS_DEFS[id] schema (all numbers metres / seconds; moves are listed in selection order):
//   name, theme (name of its theme or null), color (name tag), model (BOSS_MODELS key, later tasks), scale (null = BOSS_SCALE), r (body radius, null = 0.65),
//   hpMul, dmgMul, speedMul (on TUNE.bossHp / bossDmgMul / bossSpeed), resist (null = from its plate gear), summonCap (live minions at once, default 4),
//   bands: null for a biped (aimZone) or [legsTop, headBottom, top] in WORLD metres for other bodies (bossZone), meleeAlt: highest alt a swing still reaches (2.5),
//   phases: [{ at, speedMul, windMul, enrage, add: [enemy types], dur }] with `at` the HP fraction, strictly DESCENDING in list order (phase i starts when hp <= at * maxHp);
//     phase 0 is the base fight. Moves list phase: [from, to] (inclusive, default [0, 99]).
//   moves: [{ id, name, shape: 'cone'|'circle'|'line'|'leap'|'projectile'|'summon',
//     wind (telegraph s; 0 = the legacy TUNE formula, only the cave swing), dmg (x e.hitMul), zone ('head'|'body'|'legs'|'rand'), reach (cone; 0 = e.reach), arc (cone/fan, degrees),
//     r (circle/leap), len, width (line), at ('self'|'target': a circle or line aimed where the player stood), lock ('start'|'end': when the target point is fixed),
//     cd (this move's cooldown), gcd (cooldown before ANY move; -1 = e.cooldown), rec (stand still after), next (move id chained straight after), minD/maxD (selection range),
//     weight, phase, parry (a parry staggers; false = a block only), ground (red telegraph, wind >= 0.8), blockTake (share of the damage a block lets through, 0.5), knock (metres),
//     status/statusDur, kind/n/speed (projectile), spawn/n/cap (summon), dur/h (leap flight time, arc height),
//     n/spread (line: n lines fanned `spread` degrees apart), chain (true: only ever started by another move's `next`), cloud {dur, daze} (a circle at 'target' that leaves a daze cloud
//     instead of hitting: spawnCloud), expose {t, mul} (after the strike the boss takes mul x body damage for t s: put the same t in rec) }]
//   blurb: one line for the glossary card (replaces the plate text).
const BOSS_DEFS = {};
const BOSS_SHAPES = ['cone', 'circle', 'line', 'leap', 'projectile', 'summon'];
const BOSS_BASE_ID = 'cave';

BOSS_DEFS.cave = {
  id: 'cave', name: 'Cave Warlord', theme: null, color: '#e0a070', model: null, scale: null, r: null, hpMul: 1, dmgMul: 1, speedMul: 1, resist: null, summonCap: 4, bands: null, meleeAlt: 2.5, phases: [],
  moves: [{ id: 'swing', name: 'Swing', shape: 'cone', wind: 0, dmg: 1, zone: 'rand', reach: 0, arc: 0, cd: 0, gcd: -1, rec: 0, minD: 0, maxD: 0, weight: 1, parry: true, ground: false }],
};
// The other themes and the final arena share the cave fight until their own defs replace these (BOSS2 to BOSS5); each keeps its own name and look.
if (typeof THEME_DEFS !== 'undefined') for (const t of THEME_DEFS) if (t.boss) BOSS_DEFS[t.id] = { ...BOSS_DEFS.cave, id: t.id, name: t.boss.name, theme: t.name };
if (typeof FINAL_BOSS !== 'undefined') BOSS_DEFS.final = { ...BOSS_DEFS.cave, id: 'final', name: FINAL_BOSS.name, theme: null, tag: FINAL_BOSS.tag, color: '#c060ff' };

// Damage multiplier on a hit to the boss: a Spore Burst leaves its cap deflated for a moment (body hits x expMul). Pure.
function bossTakeMul(e, zone) { const bs = e.bs; return bs && bs.exp > 0 && zone === 'body' ? bs.expMul : 1; }

// Fill in move defaults and the id lookup (idempotent). Returns the def.
function bossNormalize(def) {
  def.byId = {}; def.phases = def.phases || [];
  for (const mv of def.moves) {
    if (mv.wind === undefined) mv.wind = 0.8; if (mv.dmg === undefined) mv.dmg = 1; if (mv.zone === undefined) mv.zone = 'body';
    if (mv.cd === undefined) mv.cd = 0; if (mv.gcd === undefined) mv.gcd = -1; if (mv.rec === undefined) mv.rec = 0;
    if (mv.weight === undefined) mv.weight = 1; if (!mv.phase) mv.phase = [0, 99]; if (mv.parry === undefined) mv.parry = !mv.ground && mv.shape === 'cone';
    mv.ground = !!mv.ground; if (mv.lock === undefined) mv.lock = 'start';
    def.byId[mv.id] = mv;
  }
  return def;
}

// ---- Harvest King (Moonlit Orchard): a scarecrow on a pole. Tall and thin; the wind-up lifts the pitchfork. ----
BOSS_DEFS.scarecrow = {
  id: 'scarecrow', name: 'Harvest King', theme: 'The Moonlit Orchard', color: '#e0c060', model: 'scarecrow', scale: 1.8, r: 0.55, hpMul: 0.9, dmgMul: 1, speedMul: 1,
  resist: { head: 0.75, body: 0.65, legs: 0.8 }, summonCap: 4, bands: [1.1, 2.3, 3.6], meleeAlt: 2.5,
  blurb: 'A scarecrow on a pole, stuffed with straw and rot. Tall and thin, with a long reach and a murder of crows.',
  phases: [{ at: 0.5, dur: 1.4 }],   // Murder: volleys of 7 crows and the Hay Toss
  moves: [
    { id: 'jab', name: 'Pitchfork Jab', shape: 'cone', wind: 0.7, dmg: 1.1, zone: 'body', reach: 3.4, arc: 50, weight: 3, parry: true },
    { id: 'sweep', name: 'Hay Sweep', shape: 'circle', wind: 0.9, dmg: 1.0, zone: 'legs', r: 3.2, ground: true, knock: 2, maxD: 3.6, cd: 3, weight: 2 },
    { id: 'crows', name: 'Crow Swarm', shape: 'projectile', kind: 'crow', n: 5, arc: 40, speed: 9, wind: 0.8, dmg: 0.35, zone: 'body', minD: 4, maxD: 18, cd: 3.5, weight: 2, phase: [0, 0] },
    { id: 'murder', name: 'Murder', shape: 'projectile', kind: 'crow', n: 7, arc: 55, speed: 9, wind: 0.8, dmg: 0.35, zone: 'body', minD: 4, maxD: 18, cd: 3, weight: 2, phase: [1, 99] },
    { id: 'toss', name: 'Hay Toss', shape: 'circle', at: 'target', r: 2, wind: 1.0, dmg: 0.8, zone: 'body', ground: true, next: 'toss2', minD: 3, maxD: 14, cd: 6, weight: 2, phase: [1, 99] },   // three bales, each landing where you stood when it was thrown
    { id: 'toss2', name: 'Hay Toss', shape: 'circle', at: 'target', r: 2, wind: 0.8, dmg: 0.8, zone: 'body', ground: true, next: 'toss3', chain: true, phase: [1, 99] },
    { id: 'toss3', name: 'Hay Toss', shape: 'circle', at: 'target', r: 2, wind: 0.8, dmg: 0.8, zone: 'body', ground: true, chain: true, rec: 0.4, phase: [1, 99] },
  ],
};
// ---- Fungal Warden (Mushroom Cellar): an evil mushroom with a face. Slow; its cap deflates after a Spore Burst (a window to hit it). ----
BOSS_DEFS.mushroom = {
  id: 'mushroom', name: 'Fungal Warden', theme: 'The Mushroom Cellar', color: '#c080e0', model: 'mushroom', scale: 1.6, r: 1.0, hpMul: 1.2, dmgMul: 1, speedMul: 0.7,
  resist: { head: 0.85, body: 0.7, legs: 0.7 }, summonCap: 4, bands: [0.8, 1.8, 3.1], meleeAlt: 2.5,
  blurb: 'A huge mushroom with a face, slow and heavy. It slams its cap, lobs spore clouds and bursts them around itself, then its cap sags and its body is easier to hit.',
  phases: [{ at: 0.5, dur: 1.4, add: ['puffer', 'puffer', 'puffer'] }],   // Mycelium roots and three spore puffers
  moves: [
    { id: 'slam', name: 'Cap Slam', shape: 'circle', wind: 1.0, dmg: 1.2, zone: 'body', r: 3.0, ground: true, knock: 2, maxD: 3.8, cd: 2, weight: 3 },
    { id: 'lob', name: 'Spore Lob', shape: 'circle', at: 'target', r: 3.5, wind: 0.9, dmg: 0, zone: 'body', ground: true, cloud: { dur: 6, daze: 2.5 }, minD: 5, maxD: 16, cd: 7, weight: 2 },
    { id: 'burst', name: 'Spore Burst', shape: 'circle', wind: 1.2, dmg: 0.8, zone: 'body', r: 6, ground: true, knock: 3, status: 'daze', statusDur: 2.5, rec: 1.5, expose: { t: 1.5, mul: 1.3 }, maxD: 6.4, cd: 8, weight: 2 },
    { id: 'roots', name: 'Mycelium Roots', shape: 'line', wind: 1.0, dmg: 0.9, zone: 'legs', len: 10, width: 1.2, n: 3, spread: 28, ground: true, knock: 1, minD: 2, maxD: 11, cd: 5, weight: 2, phase: [1, 99] },
  ],
};
// The Orchard and the Cellar fight their own bosses (bossId is the theme id).
BOSS_DEFS.orchard = BOSS_DEFS.scarecrow; BOSS_DEFS.cellar = BOSS_DEFS.mushroom;
for (const k in BOSS_DEFS) bossNormalize(BOSS_DEFS[k]);

// Problems with a def (empty = valid): unique move ids, known shapes, a telegraph of at least 0.5 s for a hit of 1.0 or more (0.8 s for ground moves), phases in order.
function validateBossDef(def) {
  const err = [], ids = {};
  if (!def.name) err.push('no name');
  if (!def.moves || !def.moves.length) err.push('no moves');
  for (const mv of def.moves || []) {
    if (ids[mv.id]) err.push('duplicate move id ' + mv.id); ids[mv.id] = 1;
    if (!BOSS_SHAPES.includes(mv.shape)) err.push(mv.id + ': unknown shape ' + mv.shape);
    if (mv.wind > 0 && mv.dmg >= 1.0 && mv.wind < 0.5) err.push(mv.id + ': wind ' + mv.wind + ' < 0.5 s for a hit of ' + mv.dmg);   // wind 0 = the TUNE formula (the cave swing, 0.48 s)
    if (mv.ground && mv.wind > 0 && mv.wind < 0.8) err.push(mv.id + ': ground telegraph ' + mv.wind + ' < 0.8 s');
    if (mv.next && !(def.byId ? def.byId[mv.next] : def.moves.some(m => m.id === mv.next))) err.push(mv.id + ': next ' + mv.next + ' does not exist');
    if (mv.phase && mv.phase[0] > mv.phase[1]) err.push(mv.id + ': phase range reversed');
  }
  let prev = 1;
  for (const p of def.phases || []) { if (!(p.at > 0 && p.at < prev)) err.push('phases must have descending at in (0, 1): ' + p.at); prev = p.at; }
  return err;
}

const bossDefOf = spec => BOSS_DEFS[spec.bossId] || BOSS_DEFS[BOSS_BASE_ID];
const bossDefByTheme = themeName => { const t = typeof THEME_BY_NAME !== 'undefined' && THEME_BY_NAME[themeName]; return t && BOSS_DEFS[t.id] || null; };

// The per-boss state, built once (enemy.bs). cd: seconds left on each move's own cooldown; cand: scratch list for move selection.
function bossState(def) {
  const cd = {}; for (const mv of def.moves) cd[mv.id] = 0;
  return { st: 'idle', t: 0, mv: null, nx: null, combo: 0, phase: 0, spd: 1, windMul: 1, tx: 0, tz: 0, dx: 0, dz: -1, ox: 0, oz: 0, exp: 0, expMul: 1, cd, cand: new Array(def.moves.length).fill(0) };
}

// ---- hit tests (pure: plain objects with x, z, yaw, zone, reach, bs; no globals) ----
// Does move mv, striking now, hit the player? Returns the zone or null. Projectiles and summons never hit directly.
function moveHits(mv, boss, player) {
  const bs = boss.bs || BOSS_NO_BS, pr = player.radius || 0.35;
  const zone = mv.zone && mv.zone !== 'rand' ? mv.zone : boss.zone;
  switch (mv.shape) {
    case 'cone': {
      const dx = player.x - boss.x, dz = player.z - boss.z, d = Math.hypot(dx, dz);
      if (d > (mv.reach || boss.reach) + (mv.slack === undefined ? 0.5 : mv.slack)) return null;
      if (mv.arc > 0 && mv.arc < 360 && d > 0.5 && (dx * -Math.sin(boss.yaw) + dz * -Math.cos(boss.yaw)) / d < Math.cos(mv.arc * Math.PI / 360)) return null;
      return zone;
    }
    case 'circle': case 'leap': {
      const target = mv.shape === 'leap' || mv.at === 'target', cx = target ? bs.tx : boss.x, cz = target ? bs.tz : boss.z;
      return Math.hypot(player.x - cx, player.z - cz) <= mv.r + pr ? zone : null;
    }
    case 'line': {
      const target = mv.at === 'target', rx = player.x - boss.x, rz = player.z - boss.z;
      if (mv.n > 1) {                                                                   // n lines fanned `spread` degrees apart, centred on the facing
        const base = target ? Math.atan2(-bs.dx, -bs.dz) : boss.yaw;
        for (let i = 0; i < mv.n; i++) {
          const a = base + (i - (mv.n - 1) / 2) * mv.spread * Math.PI / 180, dx = -Math.sin(a), dz = -Math.cos(a), along = rx * dx + rz * dz;
          if (along >= 0 && along <= mv.len && Math.abs(rx * dz - rz * dx) <= mv.width / 2 + pr) return zone;
        }
        return null;
      }
      const dx = target ? bs.dx : -Math.sin(boss.yaw), dz = target ? bs.dz : -Math.cos(boss.yaw), along = rx * dx + rz * dz, across = Math.abs(rx * dz - rz * dx);
      return along >= 0 && along <= mv.len && across <= mv.width / 2 + pr ? zone : null;
    }
    default: return null;
  }
}
const BOSS_NO_BS = { tx: 0, tz: 0, dx: 0, dz: -1 };

// Hit zone for a non-biped boss: y is the world height of the swing or arrow (e.alt lifts the body), d the melee distance (omit for arrows).
// Returns 'head' | 'body' | 'legs' or null. A swing cannot reach a body flying above def.meleeAlt.
function bossZone(y, e, d) {
  const B = e.def.bands, a = e.alt || 0;
  if (d !== undefined && a > (e.def.meleeAlt || 2.5)) return null;
  const h = y - a;
  if (h < 0 || h > B[2]) return null;
  return h > B[1] ? 'head' : h > B[0] ? 'body' : 'legs';
}

// ---- state machine ----
function bossLock(e, player) {
  const bs = e.bs, mv = bs.mv; let dx = player.x - e.x, dz = player.z - e.z; const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d; bs.dx = dx; bs.dz = dz;
  const k = mv.shape === 'leap' && mv.maxD > 0 ? Math.min(d, mv.maxD) : d;
  bs.tx = e.x + dx * k; bs.tz = e.z + dz * k;
}
function bossPick(e, dist) {
  const bs = e.bs, mvs = e.def.moves, cand = bs.cand; let n = 0, tot = 0;
  for (let i = 0; i < mvs.length; i++) {
    const mv = mvs[i];
    if (mv.chain || bs.phase < mv.phase[0] || bs.phase > mv.phase[1] || bs.cd[mv.id] > 0) continue;
    if (dist < (mv.minD || 0) || dist >= (mv.maxD || mv.reach || e.reach)) continue;
    cand[n++] = i; tot += mv.weight;
  }
  if (n === 0) return null;
  if (n === 1) return mvs[cand[0]];                       // no random draw for a single choice (keeps seeded runs identical to the old single swing)
  let r = gameRng() * tot;
  for (let i = 0; i < n; i++) { r -= mvs[cand[i]].weight; if (r < 0) return mvs[cand[i]]; }
  return mvs[cand[n - 1]];
}
function bossStart(e, mv, player) {
  const bs = e.bs;
  bs.mv = e.mv = mv; bs.st = 'telegraph'; e.winding = true; e.windT = 0;
  e.zone = mv.zone === 'rand' ? pickZone(e.T.zones) : mv.zone; e.hitMul = mv.dmg;
  bossLock(e, player);
}
function bossAfter(e, mv, player) {
  const bs = e.bs, nx = mv.next && e.def.byId[mv.next];
  if (nx && bs.phase >= nx.phase[0] && bs.phase <= nx.phase[1]) { bs.nx = nx; bs.st = 'chain'; bs.combo++; return; }   // started next frame, after this hit is resolved
  bs.combo = 0;
  if (mv.expose) { bs.exp = mv.expose.t; bs.expMul = mv.expose.mul; }
  if (mv.rec > 0) { bs.st = 'recover'; bs.t = mv.rec; } else bs.st = 'chase';
}
function bossPhase(e, i) {
  const bs = e.bs, p = e.def.phases[i - 1];
  bs.phase = i; bs.spd = (p.speedMul || 1) * (p.enrage || 1); bs.windMul = p.windMul || 1;
  bs.st = 'phase'; bs.t = p.dur === undefined ? 1.2 : p.dur; e.winding = false; e.atkCd = Math.max(e.atkCd, 0.5);
  if (p.add) for (let k = 0; k < p.add.length; k++) bossSummon(e, p.add[k], 1, e.def.summonCap || 4);
}
// A parry staggered it (enemy.js update sees stun > 0): drop the move, hide its telegraph, stand on the ground.
function bossStagger(e) {
  const bs = e.bs; if (bs.st === 'stagger') return;
  bs.st = 'stagger'; bs.combo = 0; bs.nx = null; bs.exp = 0; e.mv = null; e.alt = 0; bossTeleHide();
}
function bossFire(e, mv, noise) {
  const n = mv.n || 1, y = 1.35 * e.scaleK;
  for (let i = 0; i < n; i++) noise.shoot({ from: e, kind: mv.kind, x: e.x, y, z: e.z, speed: mv.speed || 12, dmg: mv.dmg, mv, fan: n > 1 && mv.arc ? (i / (n - 1) - 0.5) * mv.arc * Math.PI / 180 : 0 });
}
function bossStrike(e, mv, player, noise, los) {
  const bs = e.bs;
  e.winding = false; e.atkCd = mv.gcd >= 0 ? mv.gcd : e.cooldown; bs.cd[mv.id] = mv.cd;
  noise.emit(e.x, e.z, CLASH_R, e);                       // a fight is loud
  if (mv.shape !== 'leap') bossTeleHide();                // a leap keeps its landing mark until it lands
  if (mv.shape === 'leap') { bs.st = 'special'; bs.t = 0; bs.ox = e.x; bs.oz = e.z; return null; }
  let attack = null;
  if (mv.shape === 'projectile') bossFire(e, mv, noise);
  else if (mv.shape === 'summon') bossSummon(e, mv.spawn, mv.n || 1, mv.cap || e.def.summonCap || 4);
  else if (mv.cloud) { if (typeof spawnCloud === 'function') spawnCloud(bs.tx, bs.tz, mv.r, mv.cloud.dur, mv.cloud.daze, true); }   // a spore lob: a daze cloud where you stood, no damage
  else if (mv.shape !== 'cone' || los) attack = moveHits(mv, e, player);   // no swings through a wall corner
  bossAfter(e, mv, player);
  return attack;
}
// One frame of an alerted boss. Returns the zone of a hit that lands this frame, else null (main.js resolves it). dist/los: to the player, from Enemy.update.
function bossUpdate(e, dt, player, noise, dist, los) {
  const bs = e.bs, def = e.def, cd = bs.cd, mvs = def.moves, dx = player.x - e.x, dz = player.z - e.z;
  let attack = null;
  e.atkCd -= dt;
  for (let i = 0; i < mvs.length; i++) { const id = mvs[i].id; if (cd[id] > 0) cd[id] -= dt; }
  if (bs.exp > 0) bs.exp -= dt;
  if (e.mv && bs.st !== 'telegraph' && bs.st !== 'attack' && bs.st !== 'special') e.mv = null;   // a finished move stops being the boss's move (its hit was resolved last frame)
  if (bs.st === 'idle' || bs.st === 'stagger') bs.st = 'chase';
  if ((bs.st === 'chase' || bs.st === 'recover') && bs.phase < def.phases.length && e.hp <= def.phases[bs.phase].at * e.maxHp) bossPhase(e, bs.phase + 1);
  switch (bs.st) {
    case 'phase': case 'recover':
      e.yaw = turnToward(e.yaw, Math.atan2(-dx, -dz), TUNE.enemyTurnAlert * dt);
      if ((bs.t -= dt) <= 0) bs.st = 'chase';
      break;
    case 'chain': bossStart(e, bs.nx, player); break;
    case 'telegraph': case 'attack': {
      const mv = bs.mv, w = e.windT_; e.windT += dt;
      if (e.windT < w) {
        e.yaw = turnToward(e.yaw, Math.atan2(-dx, -dz), 4 * dt);   // locked once the swing starts
        if (mv.lock === 'end') bossLock(e, player);
      } else bs.st = 'attack';
      if (mv.ground) bossTeleDraw(e, mv, Math.min(1, e.windT / w));
      if (e.windT >= w + STRIKE_T) attack = bossStrike(e, mv, player, noise, los);
      break;
    }
    case 'special': {                                                   // a leap: slide from the take-off point to the locked landing point, arcing up, then the landing circle hits
      const mv = bs.mv, dur = mv.dur || 0.6; bs.t += dt;
      let k = Math.min(1, bs.t / dur);
      const nx = bs.ox + (bs.tx - bs.ox) * k, nz = bs.oz + (bs.tz - bs.oz) * k;
      collider.props = e.floor.solids;
      if (!Player.prototype.blocked.call(collider, e.floor, nx, nz)) { e.x = nx; e.z = nz; } else { k = 1; bs.tx = e.x; bs.tz = e.z; }   // a wall or pillar ends the leap there
      e.alt = Math.sin(Math.PI * k) * (mv.h || 2.5);
      e.yaw = Math.atan2(-(bs.tx - bs.ox), -(bs.tz - bs.oz));
      if (k >= 1) { e.alt = 0; bossTeleHide(); noise.emit(e.x, e.z, CLASH_R, e); attack = moveHits(mv, e, player); bossAfter(e, mv, player); }
      break;
    }
    default: {                                                          // chase, same movement as every alerted guard
      if (dist > 1.0 || !e.seen) { if (e.goTo(e.last.x, e.last.z, e.chase, dt) < 0.8 && !e.seen) e.lostT += dt; }
      else e.yaw = turnToward(e.yaw, Math.atan2(-dx, -dz), TUNE.enemyTurnAlert * dt);
      if (!e.seen) e.lostT += dt * 0.5;
      if (los && e.atkCd <= 0) { const mv = bossPick(e, dist); if (mv) bossStart(e, mv, player); }
      if (e.lostT > 3) { e.aware = 0.6; e.set('searching'); }
    }
  }
  return attack;
}

// Summon up to n of enemy type `type` round the boss, never more than cap alive from this boss. Returns how many appeared. Main.js builds them (Enemy.summon).
function bossSummon(e, type, n, cap) {
  if (!Enemy.summon) return 0;
  let live = 0; const all = Enemy.all;
  for (let i = 0; i < all.length; i++) if (all[i].minion === e && !all[i].dead) live++;
  let made = 0;
  while (made < n && live < cap) { if (!Enemy.summon(e, type)) break; made++; live++; }
  return made;
}

// ---- pools (per floor group: group.userData.bossFx; the meshes are children of the group, so they are freed with it) ----
const BOSS_TELE_N = 4, BOSS_POOL_N = 12;
const BOSS_SHOT = { crow: { color: 0x221a1a, r: 0.16, g: 0, bird: true }, page: { color: 0xe8e0c0, r: 0.15, g: 0 }, shard: { color: 0x9ad8ff, r: 0.14, g: 0 }, bottle: { color: 0x6aa04a, r: 0.14, g: 6 }, axe: { color: 0xa0a0aa, r: 0.17, g: 4 }, fire: { color: 0xff7a20, r: 0.2, g: 5 } };
const BOSS_SHOT_MATS = {};
let BOSS_TELE_MAT = null;
const bossFxFor = g => g.userData.bossFx || (g.userData.bossFx = { tele: [], shots: {} });

function bossTeleGeo(kind, arc) {
  if (kind === 'disc') return cachedGeo('tdisc', () => { const g = new THREE.CircleGeometry(1, 32); g.rotateX(-Math.PI / 2); return g; });
  if (kind === 'strip') return cachedGeo('tstrip', () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5); return g; });   // starts at the boss and runs forward (-z)
  return cachedGeo('tfan' + arc, () => { const a = arc * Math.PI / 180, g = new THREE.CircleGeometry(1, 24, Math.PI / 2 - a / 2, a); g.rotateX(-Math.PI / 2); return g; });
}
// Slot i of the telegraph pool (built on first use, hidden). null past BOSS_TELE_N.
function bossTeleSlot(i) {
  if (i >= BOSS_TELE_N) return null;
  const pool = bossFxFor(group).tele;
  if (!BOSS_TELE_MAT) { BOSS_TELE_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }); BOSS_TELE_MAT.userData.shared = true; }
  while (pool.length <= i) { const m = new THREE.Mesh(bossTeleGeo('disc'), BOSS_TELE_MAT); m.visible = false; m.renderOrder = 2; m.position.y = 0.03; m.frustumCulled = false; group.add(m); pool.push(m); }
  return pool[i];
}
// Show slot i: kind 'disc' | 'strip' | 'fan', at (x, z) facing yaw, scaled sx (radius or width) by sz (radius or length). Reuses the mesh, no allocation.
function bossTeleShow(i, kind, x, z, yaw, sx, sz, arc) {
  const m = bossTeleSlot(i); if (!m) return;
  const g = bossTeleGeo(kind, arc); if (m.geometry !== g) m.geometry = g;
  m.position.x = x; m.position.z = z; m.rotation.y = yaw; m.scale.set(sx, 1, sz); m.visible = true;
}
function bossTeleDraw(e, mv, k) {
  const bs = e.bs;
  if (mv.shape === 'circle' || mv.shape === 'leap') { const t = mv.shape === 'leap' || mv.at === 'target'; bossTeleShow(0, 'disc', t ? bs.tx : e.x, t ? bs.tz : e.z, 0, mv.r, mv.r); }
  else if (mv.shape === 'line') {
    const base = mv.at === 'target' ? Math.atan2(-bs.dx, -bs.dz) : e.yaw, n = mv.n || 1;
    for (let i = 0; i < n; i++) bossTeleShow(i, 'strip', e.x, e.z, base + (n > 1 ? (i - (n - 1) / 2) * mv.spread * Math.PI / 180 : 0), mv.width, mv.len);
  }
  else bossTeleShow(0, 'fan', e.x, e.z, e.yaw, mv.reach || e.reach, mv.reach || e.reach, mv.arc || 90);
  if (BOSS_TELE_MAT) BOSS_TELE_MAT.opacity = 0.16 + 0.34 * k;       // one shared material: the fill is its opacity growing toward the strike
}
function bossTeleHide() {
  if (typeof group === 'undefined' || !group || !group.userData.bossFx) return;
  const pool = group.userData.bossFx.tele; for (let i = 0; i < pool.length; i++) pool[i].visible = false;
}

// Projectile meshes by kind: 12 each, built on first use (a sphere for now), flagged busy while in flight. null when all 12 are flying.
function bossFxAcquire(kind) {
  const fx = bossFxFor(group), pool = fx.shots[kind] || (fx.shots[kind] = []);
  for (let i = 0; i < pool.length; i++) { const m = pool[i]; if (!m.userData.busy) { m.userData.busy = true; m.visible = true; return m; } }
  if (pool.length >= BOSS_POOL_N) return null;
  const S = BOSS_SHOT[kind];
  const mat = BOSS_SHOT_MATS[kind] || (BOSS_SHOT_MATS[kind] = Object.assign(new THREE.MeshBasicMaterial({ color: S.color, side: S.bird ? THREE.DoubleSide : THREE.FrontSide }), { userData: { shared: true } }));
  const m = new THREE.Mesh(cachedGeo('bshot' + kind, () => S.bird ? bossBirdGeo() : new THREE.SphereGeometry(S.r, 8, 6)), mat);
  m.userData = { busy: true, pooled: true }; group.add(m); pool.push(m);
  return m;
}
// A crow: body, tail and two raised wings in a few triangles, nose along +z (Object3D.lookAt points +z at the target). One shared geometry.
function bossBirdGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.08, 0, -0.1, 0.08, 0, -0.1,   -0.08, 0, -0.1, 0.08, 0, -0.1, 0, 0, -0.38,   -0.07, 0, 0.1, -0.42, 0.14, -0.05, -0.07, 0, -0.14,   0.07, 0, 0.1, 0.07, 0, -0.14, 0.42, 0.14, -0.05], 3));
  return g;
}
function bossFxRelease(m) { m.visible = false; m.userData.busy = false; }

// ---- HUD and glossary text from the defs ----
function bossMoveText(mv) {
  const wind = mv.wind > 0 ? `${mv.wind.toFixed(1)} s warning` : 'short warning';
  const how = mv.ground ? 'a red mark on the floor; blocking still hurts, so dodge' : mv.shape === 'projectile' ? 'blockable shots' : mv.shape === 'summon' ? 'calls help' : mv.parry === false ? 'block it, no parry' : 'parry it to stagger';
  return `${mv.name || mv.id} (${wind}, ${how})`;
}
function bossCardLines(def, hp) {
  return [
    def.blurb ? `Boss of floor 5. ${hp} HP. ${def.blurb}` : `Boss of floor 5. ${hp} HP in heavy plate, and it hits much harder than a guard.`,
    'Sleeps in the middle of the arena until you get close. Cannot be sneak-killed and is not staggered by normal hits.',
    'Moves: ' + def.moves.filter(m => !m.chain).map(bossMoveText).join('; ') + '.',
    'A parry still staggers it, and a sprinting player can outrun it.',
    'Drops an Epic piece of equipment (with a small chance of Legendary), more equipment and gold. The stairs stay sealed until it falls. The safe room behind it leads to the next stage.'];
}
