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
//   moves: [{ id, name, shape: 'cone'|'circle'|'line'|'leap'|'projectile'|'summon'|'blink'|'charge',
//     wind (telegraph s; 0 = the legacy TUNE formula, only the cave swing), dmg (x e.hitMul), zone ('head'|'body'|'legs'|'rand'), reach (cone; 0 = e.reach), arc (cone/fan, degrees),
//     r (circle/leap), stop (leap: lands this many m short of you), len, width (line), at ('self'|'target': a circle or line aimed where the player stood), lock ('start'|'end': when the target point is fixed),
//     cd (this move's cooldown), gcd (cooldown before ANY move; -1 = e.cooldown), rec (stand still after), next (move id chained straight after), minD/maxD (selection range),
//     weight, phase, parry (a parry staggers; false = a block only), ground (red telegraph, wind >= 0.8), blockTake (share of the damage a block lets through, 0.5), knock (metres),
//     status/statusDur, kind/n/speed (projectile), spawn/n/cap (summon), dur/h (leap flight time, arc height),
//     ring (projectile: n shots spaced round the full circle, `off` degrees turned), gap (projectile: metres between shots lined up behind the muzzle), lane {dur} (a line leaves an ice lane: you slide on it),
//     blink ('blink' shape: it vanishes and reappears `behind` metres behind you, a marker shows where; chain a quick strike with `next`; tele: true shows the marker),
//     n/spread (line: n lines fanned `spread` degrees apart), chain (true: only ever started by another move's `next`), cloud {dur, daze} (a circle at 'target' that leaves a daze cloud
//     instead of hitting: spawnCloud), expose {t, mul, all} (after the strike the boss takes mul x body damage, or x damage anywhere when `all`, for t s: put the same t in rec) }]
//   next may be a list of ids: the first whose phase range fits the current phase is chained (the Innkeeper's combo grows a 4th hit in phase 2).
//   charge ('charge' shape: it runs along the locked line at `speed` m/s up to `len` m, stops at you (hit: circle of `r`), or at a wall or prop: selfStun s of stagger, the only stun it can get), ticks/spin (a circle that hits `ticks` times
//   over `spin` s after the strike: the Whirlwind), puddle {dur, r, slow} + splash (projectile: a bottle that lands within `splash` m of you still hurts and leaves a slowing puddle of radius r for dur s).
//   blurb: one line for the glossary card (replaces the plate text).
//   FLYING BOSS (the Cinder Wyrm): fly { radii (orbit radius candidates, the first one clear of walls and pillars wins), alt, bob, speed, cyc: [[air s, land s] per phase], early (share of maxHp lost in one landing that sends it up) },
//   lowBands (bands while its head is down for a Bite: lowHead moves), moves flagged air:true are only picked in the air and the others only on the ground; 'land' and 'buffet' (chain: true) are started by the cycle.
//   'dive' (it locks a line to you, then flies along it at speed, skimming low m over you: width/r/exit), 'sweep' (a cone that turns sweep degrees over spin s, a tick every tick s, leaving flame patches: flame {dur, r, n}),
//   'land' (it glides down onto the spot it locked and the touchdown is a circle), after: 'fly' (the move ends with the take-off), muzzle/front (projectile: mouth height above alt, metres ahead), flight/spread (projectile: every shot
//   lands flight s after it is fired, spread m apart, each with a ground ring of radius r; kind fire), phases[].gcdMul (more attacks).
const BOSS_DEFS = {};
const BOSS_SHAPES = ['cone', 'circle', 'line', 'leap', 'projectile', 'summon', 'blink', 'charge', 'dive', 'sweep', 'land'];
const BOSS_BASE_ID = 'cave';

BOSS_DEFS.cave = {
  id: 'cave', name: 'Cave Warlord', theme: null, color: '#e0a070', model: null, scale: null, r: null, hpMul: 1, dmgMul: 1, speedMul: 1, resist: null, summonCap: 4, bands: null, meleeAlt: 2.5, phases: [],
  moves: [{ id: 'swing', name: 'Swing', shape: 'cone', wind: 0, dmg: 1, zone: 'rand', reach: 0, arc: 0, cd: 0, gcd: -1, rec: 0, minD: 0, maxD: 0, weight: 1, parry: true, ground: false }],
};
// Any theme without its own def shares the cave fight; each keeps its own name and look.
if (typeof THEME_DEFS !== 'undefined') for (const t of THEME_DEFS) if (t.boss) BOSS_DEFS[t.id] = { ...BOSS_DEFS.cave, id: t.id, name: t.boss.name, theme: t.name };

// Damage multiplier on a hit to the boss: a Spore Burst leaves its cap deflated for a moment (body hits x expMul), a Shatter Nova opens the Frost Giant's core (any hit, expAll). Pure.
function bossTakeMul(e, zone) { const bs = e.bs; return bs && bs.exp > 0 && (zone === 'body' || bs.expAll) ? bs.expMul : 1; }

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
// ---- Librarian Lich (Clockwork Library): a robed skeleton with a floating tome. It blinks behind you; no ground moves, so the answer is a block and a parry. ----
BOSS_DEFS.lich = {
  id: 'lich', name: 'Librarian Lich', theme: 'The Clockwork Library', color: '#80e0b0', model: 'lich', scale: 1.7, r: 0.6, hpMul: 0.9, dmgMul: 1, speedMul: 1,
  resist: { head: 0.7, body: 0.6, legs: 0.8 }, summonCap: 4, bands: [1.1, 2.6, 3.6], meleeAlt: 2.5,
  blurb: 'A robed skeleton with a glowing skull and a floating tome. It slams the book, fires fans of pages, and blinks to appear behind you; when it opens the tome it rains pages and calls books to its side.',
  phases: [{ at: 0.5, dur: 1.4, add: ['book', 'book'] }],   // Open Tome: the Tome Barrage and two books
  moves: [
    { id: 'slam', name: 'Book Slam', shape: 'cone', wind: 0.8, dmg: 1.2, zone: 'head', reach: 2.8, arc: 70, weight: 3, parry: true },
    { id: 'pages', name: 'Page Volley', shape: 'projectile', kind: 'page', n: 3, arc: 24, speed: 14, wind: 0.7, dmg: 0.5, zone: 'body', minD: 4, maxD: 18, cd: 3, weight: 2 },
    { id: 'bookmark', name: 'Bookmark', shape: 'blink', tele: true, behind: 3.2, wind: 0.8, dmg: 0, zone: 'body', lock: 'end', next: 'bookslam', minD: 4, maxD: 16, cd: 7, weight: 2 },   // it vanishes (fades) and reappears behind you (3.2 m: just inside a slam)
    { id: 'bookslam', name: 'Book Slam', shape: 'cone', wind: 0.6, dmg: 1.2, zone: 'head', reach: 2.8, arc: 70, chain: true, parry: true },
    { id: 'barrage', name: 'Tome Barrage', shape: 'projectile', kind: 'page', n: 8, ring: true, speed: 12, wind: 1.0, dmg: 0.4, zone: 'body', next: 'spiral', minD: 3, maxD: 18, cd: 7, weight: 2, phase: [1, 99] },   // a ring of 8 pages, then a spiral behind it
    { id: 'spiral', name: 'Tome Barrage', shape: 'projectile', kind: 'page', n: 4, ring: true, off: 22, speed: 12, wind: 0.5, dmg: 0.4, zone: 'body', chain: true, phase: [1, 99] },
  ],
};
// ---- Frost Giant (Frozen Chapel): a hovering mass of ice shards round a glowing core. Its Ground Freeze leaves a lane of ice; its Shatter Nova opens the core. ----
BOSS_DEFS.giant = {
  id: 'giant', name: 'Frost Giant', theme: 'The Frozen Chapel', color: '#9adcff', model: 'giant', scale: 2.0, r: 1.0, hpMul: 1.1, dmgMul: 1, speedMul: 0.85,
  resist: { head: 0.75, body: 0.6, legs: 0.8 }, summonCap: 4, bands: [1.0, 2.4, 4.2], meleeAlt: 2.5,
  blurb: 'A giant made of ice shards, hovering round a pale blue core. It punches with a shard fist, throws lines of icicles that slow you and freezes a lane of the floor to slide on. Below half health it shatters and a nova opens its core to be hit.',
  phases: [{ at: 0.5, dur: 1.4 }],   // Shatter: four shards orbit it and the Shatter Nova starts
  moves: [
    { id: 'fist', name: 'Shard Fist', shape: 'cone', wind: 0.85, dmg: 1.15, zone: 'body', reach: 3.2, arc: 70, weight: 3, parry: true },
    { id: 'icicles', name: 'Icicle Volley', shape: 'projectile', kind: 'shard', n: 3, arc: 4, gap: 2, speed: 16, wind: 0.7, dmg: 0.45, zone: 'body', status: 'slow', statusDur: 3, minD: 4, maxD: 18, cd: 3.5, weight: 2 },
    { id: 'freeze', name: 'Ground Freeze', shape: 'line', wind: 1.0, dmg: 0.8, zone: 'legs', len: 14, width: 2.4, ground: true, knock: 1, status: 'slow', statusDur: 3, lane: { dur: 6 }, minD: 2, maxD: 15, cd: 6, weight: 2 },
    { id: 'nova', name: 'Shatter Nova', shape: 'circle', wind: 1.3, dmg: 1.3, zone: 'body', r: 7, ground: true, knock: 4, rec: 2, expose: { t: 2, mul: 1.25, all: true }, maxD: 7.4, cd: 8, weight: 3, phase: [1, 99] },
  ],
};
// ---- Moonfang (Overgrown Ruin): a werewolf. Fast and hunched, it leaps from far away; the 1.2 s after a pounce is the time to hit it. ----
BOSS_DEFS.werewolf = {
  id: 'werewolf', name: 'Moonfang', theme: 'The Overgrown Ruin', color: '#d8a060', model: 'werewolf', scale: 1.7, r: 0.7, hpMul: 1, dmgMul: 1, speedMul: 1.05,
  resist: { head: 0.75, body: 0.62, legs: 0.7 }, summonCap: 4, bands: [0.9, 1.9, 2.9], meleeAlt: 2.5,
  blurb: 'A werewolf, hunched and shaggy, quick on its feet. It rakes with both claws, bites at the head, pounces from across the room and howls for wolves. After a pounce it is open for a moment; below half health it goes into a moon rage.',
  phases: [{ at: 0.5, speedMul: 1.2, dur: 1.4 }],   // Moon rage: faster, two pounces in a row, a howl every cycle
  moves: [
    { id: 'rake', name: 'Claw Rake', shape: 'cone', wind: 0.55, dmg: 0.7, zone: 'body', reach: 2.6, arc: 100, next: 'rake2', weight: 3, parry: true },   // two claws in a row
    { id: 'rake2', name: 'Claw Rake', shape: 'cone', wind: 0.4, dmg: 0.7, zone: 'body', reach: 2.6, arc: 100, chain: true, parry: true },
    { id: 'bite', name: 'Bite', shape: 'cone', wind: 0.7, dmg: 1.4, zone: 'head', reach: 2.0, arc: 70, weight: 2, parry: true },
    { id: 'pounce', name: 'Pounce', shape: 'leap', wind: 0.9, dmg: 1.3, zone: 'body', r: 2.2, dur: 0.7, h: 2.6, lock: 'end', stop: 1.2, ground: true, knock: 3, minD: 3.5, maxD: 10, cd: 3, rec: 1.2, next: 'pounce2', weight: 3 },   // the landing spot locks as the crouch ends
    { id: 'pounce2', name: 'Pounce', shape: 'leap', wind: 0.8, dmg: 1.3, zone: 'body', r: 2.2, dur: 0.7, h: 2.6, lock: 'end', stop: 1.2, ground: true, knock: 3, maxD: 10, rec: 1.2, chain: true, phase: [1, 99] },
    { id: 'howl', name: 'Howl', shape: 'summon', spawn: 'wolf', n: 2, cap: 4, wind: 1.2, dmg: 0, zone: 'head', rec: 1.5, minD: 3, maxD: 20, cd: 14, weight: 1, phase: [0, 0] },
    { id: 'howl2', name: 'Howl', shape: 'summon', spawn: 'wolf', n: 2, cap: 4, wind: 1.2, dmg: 0, zone: 'head', rec: 1.5, minD: 3, maxD: 20, cd: 6, weight: 3, phase: [1, 99] },
  ],
};
// ---- Giant Innkeeper (Sunken Tavern): a fat bartender with a tankard and a keg on his back. Combos, bottles that leave slowing puddles, a rolling keg. ----
BOSS_DEFS.innkeeper = {
  id: 'innkeeper', name: 'Giant Innkeeper', theme: 'The Sunken Tavern', color: '#e0b070', model: null, scale: 1.7, r: 0.8, hpMul: 1, dmgMul: 1, speedMul: 1,
  resist: { head: 0.8, body: 0.65, legs: 0.8 }, summonCap: 4, bands: null, meleeAlt: 2.5,
  blurb: 'A huge bartender in an apron, a tankard in one fist and a keg on his back. He smashes the mug down, brawls in combos, lobs bottles that leave slippery puddles and rolls the keg across the floor. Below half health he calls last orders and two drunks join in.',
  phases: [{ at: 0.5, speedMul: 1.15, dur: 1.4, add: ['bandit', 'bandit'] }],   // Last Call: faster, a 4th hit in the combo, two bandits
  moves: [
    { id: 'smash', name: 'Mug Smash', shape: 'cone', wind: 0.7, dmg: 1.1, zone: 'head', reach: 3.0, arc: 70, weight: 3, parry: true },
    { id: 'combo', name: 'Brawl Combo', shape: 'cone', wind: 0.55, dmg: 0.6, zone: 'body', reach: 2.5, arc: 100, next: 'combo2', weight: 3, parry: false },   // body, body, (body,) head: only the head finisher can be parried, and that staggers the whole combo
    { id: 'combo2', name: 'Brawl Combo', shape: 'cone', wind: 0.4, dmg: 0.7, zone: 'body', reach: 2.5, arc: 100, next: ['combo3', 'fin'], chain: true, parry: false },
    { id: 'combo3', name: 'Brawl Combo', shape: 'cone', wind: 0.4, dmg: 0.7, zone: 'body', reach: 2.5, arc: 100, next: 'fin', chain: true, parry: false, phase: [1, 99] },
    { id: 'fin', name: 'Brawl Combo', shape: 'cone', wind: 0.8, dmg: 1.3, zone: 'head', reach: 2.6, arc: 90, chain: true, parry: true },
    { id: 'bottles', name: 'Bottle Toss', shape: 'projectile', kind: 'bottle', n: 3, arc: 22, speed: 12, wind: 0.7, dmg: 0.5, zone: 'body', splash: 1.2, puddle: { dur: 5, r: 1.2, slow: 0.7 }, minD: 4, maxD: 16, cd: 5, weight: 2 },
    { id: 'keg', name: 'Keg Roll', shape: 'line', wind: 1.0, dmg: 1.2, zone: 'legs', len: 12, width: 1.4, ground: true, knock: 3, minD: 3, maxD: 13, cd: 6, weight: 2 },
  ],
};
// ---- Goblin Warlord (Goblin Market): the old goblin look, its own moves. A shield charge that stuns it against a wall, thrown cleavers, a banner that calls guards. ----
BOSS_DEFS.warlord = {
  id: 'warlord', name: 'Goblin Warlord', theme: 'The Goblin Market', color: '#a0d060', model: null, scale: null, r: null, hpMul: 1.1, dmgMul: 1, speedMul: 1,
  resist: { head: 0.7, body: 0.65, legs: 0.75 }, summonCap: 4, bands: null, meleeAlt: 2.5,
  blurb: 'A goblin warlord in plate and a red cape. He cleaves, charges behind his shield (and stuns himself if he hits a wall or a pillar), throws cleavers and rallies guards with his banner. Below half health he spins in a whirlwind.',
  phases: [{ at: 0.5, dur: 1.4 }],   // the Whirlwind joins
  moves: [
    { id: 'cleave', name: 'War Cleave', shape: 'cone', wind: 0.75, dmg: 1.1, zone: 'head', reach: 3.2, arc: 80, weight: 3, parry: true },
    { id: 'charge', name: 'Shield Charge', shape: 'charge', wind: 0.9, dmg: 1.3, zone: 'legs', speed: 11, len: 18, width: 1.6, r: 1.3, lock: 'end', ground: true, knock: 3, selfStun: 1.2, rec: 0.6, minD: 6, maxD: 14, cd: 7, weight: 3 },
    { id: 'cleaver', name: 'Cleaver Throw', shape: 'projectile', kind: 'axe', n: 1, speed: 15, wind: 0.8, dmg: 0.9, zone: 'body', minD: 4, maxD: 18, cd: 3.5, weight: 2 },
    { id: 'rally', name: 'Banner Rally', shape: 'summon', spawn: 'goblin', n: 2, cap: 4, wind: 1.2, dmg: 0, zone: 'head', rec: 0.6, minD: 3, maxD: 20, cd: 14, weight: 1 },
    { id: 'whirl', name: 'Whirlwind', shape: 'circle', wind: 1.0, dmg: 0.5, zone: 'body', r: 3.4, ticks: 3, spin: 1.6, ground: true, knock: 3, maxD: 4, cd: 6, weight: 3, phase: [1, 99] },
  ],
};
// ---- Cinder Wyrm (the Final Chamber): a dragon. It flies in circles (arrows, wands and spells hit it up there at full damage, melee cannot reach), strafes, sweeps fire and lobs fireballs, then lands for 12 s of
// bites, claws, tail sweeps and breath. Hp = bossHp x hpMul x finalBossHp (3x the first boss). Cycle (air s / land s) by phase: 12/12, 10/12, 8/14; below a third it is enraged (x1.2 speed). ----
BOSS_DEFS.dragon = {
  id: 'dragon', name: 'Cinder Wyrm', theme: 'The Final Chamber', color: '#ff8a3a', model: 'dragon', scale: 1.7, r: 2.2, hpMul: 1, dmgMul: 1, speedMul: 1,
  resist: { head: 0.75, body: 0.62, legs: 0.75 }, summonCap: 4, bands: [1.2, 2.6, 4.6], lowBands: [0.9, 1.6, 2.4], meleeAlt: 2.5,
  fly: { radii: [16.75, 16.5, 17, 17.25, 20, 23, 14.5], alt: 6.4, bob: 0.6, speed: 9, cyc: [[12, 12], [10, 12], [8, 14]], early: 0.18 },
  blurb: 'A huge dragon of charcoal and ember. It circles the chamber under the open sky, strafes you along a line of shadow, sweeps a stream of fire and lobs fireballs, then lands in a shockwave to bite, claw, lash its tail and breathe fire. Arrows and spells hit it in the air at full damage; melee reaches it on the ground or when it dives low. It takes off again if you hurt it badly while it is down. Below two thirds and a third of its health it fights harder.',
  phases: [{ at: 0.66, dur: 1.4, gcdMul: 0.7 }, { at: 0.33, dur: 1.4, gcdMul: 0.7, enrage: 1.2 }],   // the air time shortens (10 s, 8 s) and the land time stretches (14 s); the last third is enraged
  moves: [
    { id: 'bite', name: 'Bite', shape: 'cone', wind: 0.8, dmg: 1.4, zone: 'head', reach: 4.5, arc: 40, lowHead: true, rec: 0.5, maxD: 5.2, cd: 1.5, weight: 3, parry: true },   // the head drops while it bites: that is the counter window
    { id: 'claw', name: 'Claw Swipe', shape: 'cone', wind: 0.7, dmg: 1.0, zone: 'body', reach: 5, arc: 120, rec: 0.3, maxD: 5.7, weight: 3, parry: true },
    { id: 'tail', name: 'Tail Sweep', shape: 'circle', wind: 1.0, dmg: 1.0, zone: 'legs', r: 6, ground: true, knock: 5, rec: 0.4, maxD: 6.4, cd: 5, weight: 2 },   // low guard (legs), a block still hurts
    { id: 'breath', name: 'Close Breath', shape: 'cone', wind: 1.1, dmg: 1.1, zone: 'body', reach: 12, arc: 50, ground: true, knock: 3, status: 'bleed', statusDur: 3, rec: 0.6, minD: 4, maxD: 12.5, cd: 6, weight: 2 },   // go behind it
    { id: 'buffet', name: 'Takeoff Buffet', shape: 'circle', wind: 0.9, dmg: 0.5, zone: 'body', r: 7, ground: true, knock: 3, after: 'fly', chain: true },
    { id: 'strafe', name: 'Strafe Run', shape: 'dive', air: true, wind: 1.0, dmg: 1.3, zone: 'body', width: 3, r: 2.2, speed: 22, low: 1.6, exit: 12, ground: true, knock: 3, gcd: 1.3, rec: 0.5, minD: 9, maxD: 80, cd: 4, weight: 3 },   // a shadow strip for 1.0 s, then it dives along it: sidestep
    { id: 'sweep', name: 'Fire Sweep', shape: 'sweep', air: true, wind: 1.2, dmg: 0.45, zone: 'body', reach: 24, arc: 40, sweep: 70, spin: 2.0, tick: 0.4, flame: { dur: 4, r: 1.8, n: 6 }, ground: true, gcd: 1.3, rec: 0.6, minD: 5, maxD: 30, cd: 6, weight: 2 },
    { id: 'volley', name: 'Fireball Volley', shape: 'projectile', kind: 'fire', air: true, n: 3, spread: 5, flight: 1.1, r: 2.5, muzzle: 3.2, front: 2.6, wind: 0.8, dmg: 1.0, zone: 'body', lock: 'end', ground: true, knock: 2, status: 'bleed', statusDur: 3, gcd: 1.3, rec: 1.2, minD: 6, maxD: 60, cd: 5, weight: 3 },
    { id: 'land', name: 'Landing', shape: 'land', air: true, at: 'target', wind: 1.5, dmg: 1.2, zone: 'body', r: 7, ground: true, knock: 5, rec: 0.6, chain: true },   // a shadow circle grows for 1.5 s, then the shockwave
  ],
};
// The Orchard, Cellar, Library, Chapel, Tavern, Market and Jungle fight their own bosses (bossId is the theme id); the final arena fights the dragon (its bossId is 'final').
BOSS_DEFS.final = BOSS_DEFS.dragon;
BOSS_DEFS.orchard = BOSS_DEFS.scarecrow; BOSS_DEFS.cellar = BOSS_DEFS.mushroom; BOSS_DEFS.library = BOSS_DEFS.lich; BOSS_DEFS.chapel = BOSS_DEFS.giant;
BOSS_DEFS.jungle = BOSS_DEFS.werewolf; BOSS_DEFS.tavern = BOSS_DEFS.innkeeper; BOSS_DEFS.market = BOSS_DEFS.warlord;
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
    for (const nx of [].concat(mv.next || [])) if (!def.moves.some(m => m.id === nx)) err.push(mv.id + ': next ' + nx + ' does not exist');
    if (mv.phase && mv.phase[0] > mv.phase[1]) err.push(mv.id + ': phase range reversed');
  }
  if (def.fly) {
    if (!def.byId || !def.byId.land || !def.byId.buffet) err.push('a flying boss needs land and buffet moves');
    if (!def.fly.cyc || def.fly.cyc.length !== (def.phases || []).length + 1) err.push('fly.cyc needs one [air, land] pair per phase');
    if (!def.bands || !def.lowBands) err.push('a flying boss needs bands and lowBands');
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
  return { st: 'idle', t: 0, mv: null, nx: null, combo: 0, phase: 0, spd: 1, windMul: 1, gcdMul: 1, tx: 0, tz: 0, dx: 0, dz: -1, ox: 0, oz: 0, exp: 0, expMul: 1, expAll: false, cd, cand: new Array(def.moves.length).fill(0),
    air: false, cyc: 0, hp0: 0, hx: 0, hz: 0, R: def.fly ? def.fly.radii[0] : 0, cw: 1, fp: 0, a0: 0, dd: 0, dl: 0, hit: false, lowT: 0, y0: 0, sg: 1, tk: 0, run: 0 };   // air .. fp: a flying boss (cycle clock, home point, orbit radius and direction, flap clock); a0 .. hit: a dive or a landing; lowT: head down; y0, sg, tk: a sweep
}

// ---- hit tests (pure: plain objects with x, z, yaw, zone, reach, bs; no globals) ----
// Does move mv, striking now, hit the player? Returns the zone or null. Projectiles and summons never hit directly.
function moveHits(mv, boss, player) {
  const bs = boss.bs || BOSS_NO_BS, pr = player.radius || 0.35;
  const zone = mv.zone && mv.zone !== 'rand' ? mv.zone : boss.zone;
  switch (mv.shape) {
    case 'cone': case 'sweep': {
      const dx = player.x - boss.x, dz = player.z - boss.z, d = Math.hypot(dx, dz);
      if (d > (mv.reach || boss.reach) + (mv.slack === undefined ? 0.5 : mv.slack)) return null;
      if (mv.arc > 0 && mv.arc < 360 && d > 0.5 && (dx * -Math.sin(boss.yaw) + dz * -Math.cos(boss.yaw)) / d < Math.cos(mv.arc * Math.PI / 360)) return null;
      return zone;
    }
    case 'charge': return Math.hypot(player.x - boss.x, player.z - boss.z) <= mv.r + pr ? zone : null;   // the shield and the body ploughing into you
    case 'circle': case 'leap': case 'land': {
      const target = mv.shape === 'leap' || mv.shape === 'land' || mv.at === 'target', cx = target ? bs.tx : boss.x, cz = target ? bs.tz : boss.z;
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
// A dive (Strafe Run) from (ox, oz) along the unit line (dx, dz), the boss run m along it at height alt: hits when it passes over you (within mv.r along the line, inside the strip width) and is low enough. Pure.
function diveHit(mv, ox, oz, dx, dz, run, alt, player) {
  const rx = player.x - ox, rz = player.z - oz, along = rx * dx + rz * dz, across = Math.abs(rx * dz - rz * dx);
  return alt <= (mv.hitAlt || 3.4) && Math.abs(run - along) <= (mv.r || 2.2) && across <= mv.width / 2 + (player.radius || 0.35) ? (mv.zone || 'body') : null;
}

// Hit zone for a non-biped boss: y is the world height of the swing or arrow (e.alt lifts the body), d the melee distance (omit for arrows).
// Returns 'head' | 'body' | 'legs' or null. A swing cannot reach a body flying above def.meleeAlt.
function bossZone(y, e, d) {
  const B = e.bs && e.bs.lowT > 0 && e.def.lowBands || e.def.bands, a = e.alt || 0;   // lowBands: the head is down for a Bite (a counter window)
  if (d !== undefined && a > (e.def.meleeAlt || 2.5)) return null;
  const h = y - a;
  if (h < 0 || h > B[2]) return null;
  return h > B[1] ? 'head' : h > B[0] ? 'body' : 'legs';
}

// ---- state machine ----
// Where a blink lands: `dist` m behind the player (opposite his facing), nearer if a wall or prop is there, else in front of him, else it stays put. Writes bs.tx / bs.tz.
function bossBlinkSpot(e, player, dist) {
  const bs = e.bs, sx = Math.sin(player.yaw), sz = Math.cos(player.yaw); collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = e.r || r0;   // test with the boss own radius, not the shared 0.4 m
  for (let i = 0; i < 6; i++) {
    const d = dist * (i < 3 ? 1 - i * 0.25 : -(1 - (i - 3) * 0.25)), x = player.x + sx * d, z = player.z + sz * d;
    if (!Player.prototype.blocked.call(collider, e.floor, x, z)) { bs.tx = x; bs.tz = z; collider.radius = r0; return; }
  }
  collider.radius = r0; bs.tx = e.x; bs.tz = e.z;
}
function bossLock(e, player) {
  const bs = e.bs, mv = bs.mv; if (mv.shape === 'blink') { bossBlinkSpot(e, player, mv.behind || 3); return; }
  if (mv.shape === 'land') { bossLandSpot(e, player); return; }
  let dx = player.x - e.x, dz = player.z - e.z; const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d; bs.dx = dx; bs.dz = dz;
  const k = mv.shape === 'leap' && mv.maxD > 0 ? (d > mv.maxD ? mv.maxD : Math.max(0, d - (mv.stop || 0))) : d;   // a leap lands `stop` m short of you (so it never lands on top of you), or 10 m out at most
  bs.tx = e.x + dx * k; bs.tz = e.z + dz * k;
  if (mv.shape === 'dive') bossDiveLine(e, d);
}
// ---- the flying boss (the Cinder Wyrm): x, z are logical as ever, e.alt is its height. It orbits its home point (the arena centre), dives, lands and takes off on a clock (bs.cyc). ----
// Where it lands: on you if that spot is open for its body, else the nearest open spot toward home (the dais). Writes bs.tx / bs.tz and the glide origin.
function bossLandSpot(e, player) {
  const bs = e.bs; collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = e.r || r0;
  let x = player.x, z = player.z;
  for (let i = 0; i < 16 && Player.prototype.blocked.call(collider, e.floor, x, z); i++) { const dx = bs.hx - x, dz = bs.hz - z, d = Math.hypot(dx, dz) || 1; x += dx / d * 1.5; z += dz / d * 1.5; }
  if (Player.prototype.blocked.call(collider, e.floor, x, z)) { x = bs.hx; z = bs.hz; }
  collider.radius = r0; bs.tx = x; bs.tz = z; bs.ox = e.x; bs.oz = e.z; bs.a0 = e.alt;
  bs.y0 = Math.hypot(x - e.x, z - e.z) > 1 ? Math.atan2(-(x - e.x), -(z - e.z)) : e.yaw;
}
// The line of a dive: d m to you plus mv.exit beyond, cut short where a wall or pillar would be in the way (bs.dl); bs.dd is where it skims lowest (over you).
function bossDiveLine(e, d) {
  const bs = e.bs, mv = bs.mv; collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = 2;
  let L = d + (mv.exit || 12);
  for (let s = 3; s < L; s += 2) if (Player.prototype.blocked.call(collider, e.floor, e.x + bs.dx * s, e.z + bs.dz * s)) { L = Math.max(4, s - 2); break; }
  collider.radius = r0; bs.dl = L; bs.dd = Math.max(3, Math.min(d, L - 2)); bs.ox = e.x; bs.oz = e.z; bs.a0 = e.alt;
}
// The orbit radius for this flight: the first of def.fly.radii whose ring is clear of walls and pillars (else the one with the fewest blocked samples). Runs once per take-off.
function bossOrbitR(e) {
  const bs = e.bs, f = e.def.fly; collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = 2.4;
  let best = f.radii[0], bn = 1e9;
  for (let k = 0; k < f.radii.length && bn > 0; k++) {
    const R = f.radii[k]; let n = 0;
    for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24; if (Player.prototype.blocked.call(collider, e.floor, bs.hx + Math.cos(a) * R, bs.hz + Math.sin(a) * R)) n++; }
    if (n < bn) { bn = n; best = R; }
  }
  collider.radius = r0; return best;
}
const bossCyc = (e, air) => { const c = e.def.fly.cyc[Math.min(e.bs.phase, e.def.fly.cyc.length - 1)]; return air ? c[0] : c[1]; };   // seconds of this stance in the current phase
// One frame of the orbit: ease the radius toward bs.R (5 m/s), go round at fly.speed, face the way it flies, and ease the height to fly.alt (bobbing).
function bossOrbit(e, dt) {
  const bs = e.bs, f = e.def.fly, sp = f.speed * bs.spd * e.st.moveMul(), ax = e.x - bs.hx, az = e.z - bs.hz, rad = Math.hypot(ax, az) || 1, ang = Math.atan2(az, ax);
  const nr = rad + Math.max(-5 * dt, Math.min(5 * dt, bs.R - rad)), na = ang + bs.cw * sp * dt / Math.max(nr, 6);
  e.yaw = turnToward(e.yaw, Math.atan2(bs.cw * Math.sin(na), -bs.cw * Math.cos(na)), 3 * dt);   // along the tangent
  e.x = bs.hx + Math.cos(na) * nr; e.z = bs.hz + Math.sin(na) * nr; e.walkT += sp * dt;
  e.alt += (f.alt + f.bob * Math.sin(bs.fp * 1.1) - e.alt) * (1 - Math.exp(-2.2 * dt));
}
// The glide of a landing: k 0..1 over the wind-up, from where it was (bs.ox, oz, a0) onto the locked spot, easing in and out.
function bossGlide(e, k) { const bs = e.bs, s = k * k * (3 - 2 * k); e.x = bs.ox + (bs.tx - bs.ox) * s; e.z = bs.oz + (bs.tz - bs.oz) * s; e.alt = bs.a0 * (1 - s); }
// The dive: along the locked line at mv.speed, height easing from where it was down to mv.low over you and back up to the orbit height. Returns the zone when it passes over you (once).
function bossDive(e, dt, player) {
  const bs = e.bs, mv = bs.mv, f = e.def.fly, sp = (mv.speed || 22) * bs.spd, lo = mv.low || 1.6;
  bs.run = Math.min(bs.dl, bs.run + sp * dt);
  const run = bs.run, D = bs.dd, L = bs.dl, u = run <= D ? run / D : (run - D) / Math.max(0.01, L - D), c = (1 - Math.cos(Math.PI * Math.min(1, u))) * 0.5;
  e.x = bs.ox + bs.dx * run; e.z = bs.oz + bs.dz * run; e.alt = run <= D ? bs.a0 + (lo - bs.a0) * c : lo + (f.alt - lo) * c;
  e.yaw = Math.atan2(-bs.dx, -bs.dz); e.walkT += sp * dt * 0.2;
  let attack = null;
  if (!bs.hit) { const z = diveHit(mv, bs.ox, bs.oz, bs.dx, bs.dz, run, e.alt, player); if (z) { bs.hit = true; attack = z; } }
  if (run >= L) { bossTeleHide(); bossAfter(e, mv, player); }
  return attack;
}
function bossTakeoff(e) { const bs = e.bs; bs.air = true; bs.cyc = bossCyc(e, true); bs.R = bossOrbitR(e); bs.cw = -bs.cw; e.atkCd = Math.max(e.atkCd, 1.2); }
function bossLand(e) { const bs = e.bs; e.x = bs.tx; e.z = bs.tz; e.alt = 0; bs.air = false; bs.cyc = bossCyc(e, false); bs.hp0 = e.hp; e.pk = ''; e.rp = 0; e.stuckT = 0; }   // touchdown: the land stance starts, and the early take-off counts damage from here
// The flying boss's chase step. Returns true when it handled the frame (orbiting, or starting the landing / the take-off), false to walk after you like the others.
function bossFly(e, dt, player, dist) {
  const bs = e.bs, f = e.def.fly;
  if (!bs.air) { if (bs.cyc > 0) return false; bossStart(e, e.def.byId.buffet, player); return true; }
  bossOrbit(e, dt);
  if (bs.cyc <= 0) { bossStart(e, e.def.byId.land, player); return true; }
  if (e.atkCd <= 0 && e.alt > f.alt - 1.2) { const mv = bossPick(e, dist); if (mv) bossStart(e, mv, player); }
  return true;
}
function bossLive(e) { let live = 0; const all = Enemy.all; for (let i = 0; i < all.length; i++) if (all[i].minion === e && !all[i].dead) live++; return live; }
function bossPick(e, dist) {
  const bs = e.bs, mvs = e.def.moves, cand = bs.cand; let n = 0, tot = 0;
  for (let i = 0; i < mvs.length; i++) {
    const mv = mvs[i];
    if (mv.chain || bs.phase < mv.phase[0] || bs.phase > mv.phase[1] || bs.cd[mv.id] > 0 || !!mv.air !== bs.air) continue;   // (air moves only in the air, the others only on the ground)
    if (dist < (mv.minD || 0) || dist >= (mv.maxD || mv.reach || e.reach)) continue;
    if (mv.shape === 'summon' && bossLive(e) >= (mv.cap || e.def.summonCap || 4)) continue;   // the cap is full: no howl
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
  if (mv.lowHead) bs.lowT = mv.wind * bs.windMul + STRIKE_T + (mv.lowT || 0.6);   // the head drops for the strike and just after it
  bossLock(e, player);
}
function bossAfter(e, mv, player) {
  const bs = e.bs, by = e.def.byId; let nx = null;
  if (mv.next) { if (typeof mv.next === 'string') nx = by[mv.next]; else for (let i = 0; i < mv.next.length && !nx; i++) { const c = by[mv.next[i]]; if (c && bs.phase >= c.phase[0] && bs.phase <= c.phase[1]) nx = c; } }
  if (nx && bs.phase >= nx.phase[0] && bs.phase <= nx.phase[1]) { bs.nx = nx; bs.st = 'chain'; bs.combo++; return; }   // started next frame, after this hit is resolved
  bs.combo = 0;
  if (mv.after === 'fly') bossTakeoff(e);
  if (mv.expose) { bs.exp = mv.expose.t; bs.expMul = mv.expose.mul; bs.expAll = !!mv.expose.all; }
  if (mv.rec > 0) { bs.st = 'recover'; bs.t = mv.rec; } else bs.st = 'chase';
}
function bossPhase(e, i) {
  const bs = e.bs, p = e.def.phases[i - 1];
  bs.phase = i; bs.spd = (p.speedMul || 1) * (p.enrage || 1); bs.windMul = p.windMul || 1; bs.gcdMul = p.gcdMul || 1;
  bs.st = 'phase'; bs.t = p.dur === undefined ? 1.2 : p.dur; e.winding = false; e.atkCd = Math.max(e.atkCd, 0.5);
  if (p.add) for (let k = 0; k < p.add.length; k++) bossSummon(e, p.add[k], 1, e.def.summonCap || 4);
}
// A parry staggered it (enemy.js update sees stun > 0): drop the move, hide its telegraph, stand on the ground.
function bossStagger(e) {
  const bs = e.bs; if (bs.st === 'stagger') return;
  if (e.mv && e.mv.lowHead) bs.lowT = 1.0;                // a parried Bite leaves the head down for the stagger
  bs.st = 'stagger'; bs.combo = 0; bs.nx = null; bs.exp = 0; e.mv = null; if (!bs.air) e.alt = 0; bossTeleHide();
}
function bossFire(e, mv, noise) {
  const n = mv.n || 1, bs = e.bs, gap = mv.gap || 0, y = mv.muzzle ? e.alt + mv.muzzle : 1.35 * e.scaleK;
  if (mv.flight) {                                         // lobbed fire: every shot lands mv.flight s from now on its own spot (you, and mv.spread m either side), each with a ground ring from the telegraph pool
    const mx = e.x - Math.sin(e.yaw) * (mv.front || 0), mz = e.z - Math.cos(e.yaw) * (mv.front || 0); collider.props = e.floor.solids;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * (mv.spread || 0); let tx = bs.tx - bs.dz * o, tz = bs.tz + bs.dx * o;
      if (o && Player.prototype.blocked.call(collider, e.floor, tx, tz)) { tx = bs.tx; tz = bs.tz; }   // not into a wall: then on you
      if (noise.shoot({ from: e, kind: mv.kind, x: mx, y, z: mz, speed: 12, dmg: mv.dmg, mv, fan: 0, tx, tz, time: mv.flight, ring: i }) !== false) bossTeleShow(i, 'disc', tx, tz, 0, mv.r, mv.r);
    }
    if (BOSS_TELE_MAT) BOSS_TELE_MAT.opacity = 0.5;
    return;
  }
  for (let i = 0; i < n; i++) noise.shoot({ from: e, kind: mv.kind, x: e.x - bs.dx * gap * i, y, z: e.z - bs.dz * gap * i, speed: mv.speed || 12, dmg: mv.dmg, mv,   // gap: lined up one behind another
    fan: mv.ring ? (i / n * 360 + (mv.off || 0)) * Math.PI / 180 : n > 1 && mv.arc ? (i / (n - 1) - 0.5) * mv.arc * Math.PI / 180 : 0 });   // ring: spread round the whole circle
}
function bossStrike(e, mv, player, noise, los) {
  const bs = e.bs;
  e.winding = false; e.atkCd = mv.gcd >= 0 ? mv.gcd * bs.gcdMul : e.cooldown; bs.cd[mv.id] = mv.cd;
  noise.emit(e.x, e.z, CLASH_R, e);                       // a fight is loud
  if (mv.shape !== 'leap' && mv.shape !== 'dive' && mv.shape !== 'sweep' && !mv.ticks) bossTeleHide();   // a leap keeps its landing mark until it lands, a whirlwind its circle until it stops, a dive its strip and a sweep its fan
  if (mv.shape === 'leap' || mv.shape === 'charge' || mv.shape === 'dive') { bs.st = 'special'; bs.t = 0; bs.run = 0; bs.ox = e.x; bs.oz = e.z; bs.hit = false; bs.a0 = e.alt; return null; }
  if (mv.shape === 'sweep') { bs.st = 'sweep'; bs.t = 0; bs.tk = 1; bs.y0 = e.yaw; bs.sg = -bs.sg; bossSweepTick(e, mv, 0); return hasLOS(e.floor, e.x, e.z, player.x, player.z) ? moveHits(mv, e, player) : null; }   // the first tick lands with the strike, the beam turns the other way each time
  if (mv.shape === 'land') bossLand(e);
  if (mv.ticks > 1) { bs.st = 'spin'; bs.t = 0; bs.tk = 1; return moveHits(mv, e, player); }   // the first tick lands with the strike, the rest while it spins
  let attack = null;
  if (mv.shape === 'blink') { e.x = bs.tx; e.z = bs.tz; e.yaw = Math.atan2(-(player.x - e.x), -(player.z - e.z)); }   // gone, and there behind you
  else if (mv.shape === 'projectile') bossFire(e, mv, noise);
  else if (mv.shape === 'summon') bossSummon(e, mv.spawn, mv.n || 1, mv.cap || e.def.summonCap || 4);
  else if (mv.cloud) { if (typeof spawnCloud === 'function') spawnCloud(bs.tx, bs.tz, mv.r, mv.cloud.dur, mv.cloud.daze, true); }   // a spore lob: a daze cloud where you stood, no damage
  else if (mv.shape !== 'cone' || los) attack = moveHits(mv, e, player);   // no swings through a wall corner
  if (mv.lane) bossLaneAdd(e, mv);
  bossAfter(e, mv, player);
  return attack;
}
// The Shield Charge: run along the locked line at mv.speed. Reaching you ends it with the hit (the caller resolves it); a wall or prop ends it with a stagger of mv.selfStun s (e.stun, the one
// stun the boss can get: the Enemy.update stun branch then stands it still and poses it staggered); running out of line just stops it. Returns the hit zone or null.
function bossCharge(e, dt, player) {
  const bs = e.bs, mv = bs.mv, sp = mv.speed || 11, step = sp * dt, nx = e.x + bs.dx * step, nz = e.z + bs.dz * step;
  collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = e.r || r0;
  const free = !Player.prototype.blocked.call(collider, e.floor, nx, nz); collider.radius = r0;
  e.yaw = Math.atan2(-bs.dx, -bs.dz); e.walkT += sp * dt * 5;
  if (free) { e.x = nx; e.z = nz; bs.run += step; }
  const hit = moveHits(mv, e, player);
  if (hit) { bossAfter(e, mv, player); return hit; }
  if (!free && mv.selfStun) { bs.st = 'recover'; bs.t = 0; bs.combo = 0; e.stun = mv.selfStun; e.atkCd = Math.max(e.atkCd, 0.6); }   // it hit the stonework: a free window
  else if (!free || bs.run >= (mv.len || 16)) bossAfter(e, mv, player);
  return null;
}
// One frame of an alerted boss. Returns the zone of a hit that lands this frame, else null (main.js resolves it). dist/los: to the player, from Enemy.update.
function bossUpdate(e, dt, player, noise, dist, los) {
  const bs = e.bs, def = e.def, cd = bs.cd, mvs = def.moves, dx = player.x - e.x, dz = player.z - e.z;
  let attack = null;
  e.atkCd -= dt;
  for (let i = 0; i < mvs.length; i++) { const id = mvs[i].id; if (cd[id] > 0) cd[id] -= dt; }
  if (bs.exp > 0) bs.exp -= dt;
  if (bs.lowT > 0) bs.lowT -= dt;
  if (e.mv && bs.st !== 'telegraph' && bs.st !== 'attack' && bs.st !== 'special' && bs.st !== 'spin' && bs.st !== 'sweep') e.mv = null;   // a finished move stops being the boss's move (its hit was resolved last frame)
  if (bs.st === 'idle') { if (def.fly) { bs.hx = e.x; bs.hz = e.z; bs.hp0 = e.hp; bs.cyc = bossCyc(e, false); } bs.st = 'chase'; }   // a flying boss wakes on its landing pad: that is its home point
  else if (bs.st === 'stagger') bs.st = 'chase';
  if (def.fly) { bs.cyc -= dt; bs.fp += dt; if (!bs.air && bs.cyc > 0 && bs.hp0 - e.hp >= def.fly.early * e.maxHp) bs.cyc = 0; }   // the stance clock; badly hurt on the ground: up it goes
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
        e.yaw = turnToward(e.yaw, mv.shape === 'dive' ? Math.atan2(-bs.dx, -bs.dz) : mv.shape === 'land' ? bs.y0 : Math.atan2(-dx, -dz), 4 * dt);   // locked once the swing starts (a dive and a landing face their own line)
        if (mv.lock === 'end') bossLock(e, player);
      } else bs.st = 'attack';
      if (mv.shape === 'land') bossGlide(e, Math.min(1, e.windT / w));
      if (mv.ground || mv.tele) bossTeleDraw(e, mv, Math.min(1, e.windT / w));
      if (e.windT >= w + STRIKE_T) attack = bossStrike(e, mv, player, noise, los);
      break;
    }
    case 'spin': {                                                      // the Whirlwind: it stays put and spins; a tick every spin / (ticks - 1) s after the first
      const mv = bs.mv, n = mv.ticks; bs.t += dt;
      e.yaw += 9 * dt; bossTeleDraw(e, mv, 1);
      if (bs.tk < n && bs.t >= bs.tk * (mv.spin || 1.6) / (n - 1)) {
        bs.tk++; e.hitMul = mv.dmg; attack = moveHits(mv, e, player);
        if (bs.tk >= n) { bossTeleHide(); bossAfter(e, mv, player); }
      }
      break;
    }
    case 'sweep': {                                                     // the Fire Sweep: the beam turns mv.sweep degrees over mv.spin s, a tick every mv.tick s (the first came with the strike), flames where it falls
      const mv = bs.mv, n = Math.round(mv.spin / mv.tick); bs.t += dt;
      e.yaw = bs.y0 + bs.sg * mv.sweep * Math.PI / 180 * Math.min(1, bs.t / mv.spin); bossTeleDraw(e, mv, 1);
      if (bs.tk < n && bs.t >= bs.tk * mv.tick) { bossSweepTick(e, mv, bs.tk); bs.tk++; e.hitMul = mv.dmg; if (hasLOS(e.floor, e.x, e.z, player.x, player.z)) attack = moveHits(mv, e, player); }
      if (bs.t >= mv.spin) { bossSweepTick(e, mv, n); bossTeleHide(); bossAfter(e, mv, player); }
      break;
    }
    case 'special': {                                                   // a leap: slide from the take-off point to the locked landing point, arcing up, then the landing circle hits
      const mv = bs.mv, dur = mv.dur || 0.6;
      if (mv.shape === 'charge') { attack = bossCharge(e, dt, player); break; }
      if (mv.shape === 'dive') { attack = bossDive(e, dt, player); break; }
      bs.t += dt;
      let k = Math.min(1, bs.t / dur);
      const nx = bs.ox + (bs.tx - bs.ox) * k, nz = bs.oz + (bs.tz - bs.oz) * k;
      collider.props = e.floor.solids; const r0 = collider.radius; collider.radius = e.r || r0;   // the boss's own body radius, not the shared 0.4 m
      if (!Player.prototype.blocked.call(collider, e.floor, nx, nz)) { e.x = nx; e.z = nz; } else { k = 1; bs.tx = e.x; bs.tz = e.z; }   // a wall or pillar ends the leap there
      collider.radius = r0;
      e.alt = Math.sin(Math.PI * k) * (mv.h || 2.5);
      e.yaw = Math.atan2(-(bs.tx - bs.ox), -(bs.tz - bs.oz));
      if (k >= 1) { e.alt = 0; bossTeleHide(); noise.emit(e.x, e.z, CLASH_R, e); attack = moveHits(mv, e, player); bossAfter(e, mv, player); }
      break;
    }
    default: {                                                          // chase, same movement as every alerted guard
      if (def.fly && bossFly(e, dt, player, dist)) break;              // (a flying boss orbits while it is up, and starts its landing and take-off on the clock)
      if (dist > 1.0 || !e.seen) { if (e.goTo(e.last.x, e.last.z, e.chase, dt) < 0.8 && !e.seen) e.lostT += dt; }
      else e.yaw = turnToward(e.yaw, Math.atan2(-dx, -dz), TUNE.enemyTurnAlert * dt);
      if (!e.seen) e.lostT += dt * 0.5;
      if (los && e.atkCd <= 0) { const mv = bossPick(e, dist); if (mv) bossStart(e, mv, player); }
      if (e.lostT > 3 && !def.fly) { e.aware = 0.6; e.set('searching'); }   // (the dragon never loses you: it keeps its cycle going and hunts from the air)
    }
  }
  return attack;
}

// Tick i of a Fire Sweep: a flame patch on the beam (8 m out, then 3 m farther each tick), mv.flame = { dur, r, n }.
function bossSweepTick(e, mv, i) {
  const d = 8 + 3 * i; bossFlameAdd(e.x - Math.sin(e.yaw) * d, e.z - Math.cos(e.yaw) * d, mv.flame.r, mv.flame.dur);
}

// Summon up to n of enemy type `type` round the boss, never more than cap alive from this boss. Returns how many appeared. Main.js builds them (Enemy.summon).
function bossSummon(e, type, n, cap) {
  if (!Enemy.summon) return 0;
  let live = bossLive(e), made = 0;
  while (made < n && live < cap) { if (!Enemy.summon(e, type)) break; made++; live++; }
  return made;
}

// ---- pools (per floor group: group.userData.bossFx; the meshes are children of the group, so they are freed with it) ----
const BOSS_TELE_N = 4, BOSS_POOL_N = 12;
const BOSS_SHOT = { crow: { color: 0x221a1a, r: 0.16, g: 0, bird: true }, page: { color: 0xe8e0c0, r: 0.15, g: 0, geo: 'page', both: true }, shard: { color: 0x9ad8ff, r: 0.14, g: 0, geo: 'shard' }, bottle: { color: 0x6aa04a, r: 0.14, g: 6, geo: 'bottle', spin: true }, axe: { color: 0xa0a0aa, r: 0.17, g: 4, geo: 'axe', spin: true }, fire: { color: 0xff7a20, r: 0.45, g: 5 } };
const BOSS_SHOT_MATS = {};
let BOSS_TELE_MAT = null;
const bossFxFor = g => g.userData.bossFx || (g.userData.bossFx = { tele: [], shots: {}, lane: [], pud: [], flame: [] });

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
  while (pool.length <= i) { const m = new THREE.Mesh(bossTeleGeo('disc'), BOSS_TELE_MAT); m.visible = false; m.renderOrder = 2; m.position.y = group.userData.fxY || 0.03; m.frustumCulled = false; group.add(m); pool.push(m); }   // (fxY: the final arena's dais is 0.18 m high, the marks must sit above it)
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
  if (mv.shape === 'blink') bossTeleShow(0, 'disc', bs.tx, bs.tz, 0, 1.1, 1.1);                  // the marker where it will appear
  else if (mv.shape === 'dive') bossTeleShow(0, 'strip', bs.ox, bs.oz, Math.atan2(-bs.dx, -bs.dz), mv.width, bs.dl);              // the shadow it will dive along
  else if (mv.shape === 'land') { const s = mv.r * (0.35 + 0.65 * k); bossTeleShow(0, 'disc', bs.tx, bs.tz, 0, s, s); }          // the landing shadow grows
  else if (mv.shape === 'projectile') return;                                                                                       // fireballs: their rings come with the shots
  else if (mv.shape === 'charge') bossTeleShow(0, 'strip', e.x, e.z, Math.atan2(-bs.dx, -bs.dz), mv.width, mv.len);
  else if (mv.shape === 'circle' || mv.shape === 'leap') { const t = mv.shape === 'leap' || mv.at === 'target'; bossTeleShow(0, 'disc', t ? bs.tx : e.x, t ? bs.tz : e.z, 0, mv.r, mv.r); }
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
  const mat = BOSS_SHOT_MATS[kind] || (BOSS_SHOT_MATS[kind] = Object.assign(new THREE.MeshBasicMaterial({ color: S.color, side: S.bird || S.both ? THREE.DoubleSide : THREE.FrontSide }), { userData: { shared: true } }));
  const m = new THREE.Mesh(cachedGeo('bshot' + kind, () => S.bird ? bossBirdGeo() : S.geo === 'page' ? bossPageGeo() : S.geo === 'shard' ? bossShardGeo() : S.geo === 'axe' ? bossAxeGeo() : S.geo === 'bottle' ? bossBottleGeo() : new THREE.SphereGeometry(S.r, 8, 6)), mat);
  m.userData = { busy: true, pooled: true }; group.add(m); pool.push(m);
  return m;
}
// A crow: body, tail and two raised wings in a few triangles, nose along +z (Object3D.lookAt points +z at the target). One shared geometry.
function bossBirdGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.08, 0, -0.1, 0.08, 0, -0.1,   -0.08, 0, -0.1, 0.08, 0, -0.1, 0, 0, -0.38,   -0.07, 0, 0.1, -0.42, 0.14, -0.05, -0.07, 0, -0.14,   0.07, 0, 0.1, 0.07, 0, -0.14, 0.42, 0.14, -0.05], 3));
  return g;
}
// A page: a flat sheet turned a little about its flight line and tipped, so it shows from the front (placeholder). A shard: a four-sided spike, tip forward (+z).
function bossPageGeo() { const g = new THREE.PlaneGeometry(0.3, 0.4); g.rotateX(-0.6); g.rotateZ(0.5); return g; }
// A cleaver (a handle and a broad blade, tumbling end over end in flight) and a bottle (a fat body and a neck), each one shared geometry, nose along +z.
function bossAxeGeo() {
  const a = new THREE.BoxGeometry(0.05, 0.05, 0.55), b = new THREE.BoxGeometry(0.035, 0.3, 0.22); b.translate(0, 0.12, 0.2);
  const g = new THREE.BufferGeometry(), n = a.attributes.position.count;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, i => i + n)]);
  a.dispose(); b.dispose(); return g;
}
function bossBottleGeo() {
  const a = new THREE.CylinderGeometry(0.08, 0.08, 0.26, 7), b = new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6); b.translate(0, 0.2, 0);
  const g = new THREE.BufferGeometry(), n = a.attributes.position.count;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, i => i + n)]);
  g.rotateX(Math.PI / 2); a.dispose(); b.dispose(); return g;
}
function bossShardGeo() { const g = new THREE.CylinderGeometry(0, 0.1, 0.65, 4, 1); g.rotateX(Math.PI / 2); return g; }

// ---- ice lanes (Ground Freeze): up to 4 strips of ice on the floor for mv.lane.dur s. bossLaneAt(x, z) says whether a point is on one (main.js makes the player slide).
// The decals are 4 pooled strips (one material each, so each fades on its own); the lane state is 4 preallocated records. ----
const BOSS_LANE = { n: 0, items: [0, 1, 2, 3].map(() => ({ t: 0, dur: 1, x: 0, z: 0, dx: 0, dz: -1, len: 1, w: 1, m: null })) };
function bossLaneAdd(e, mv) {
  const L = BOSS_LANE.items; let it = null;
  for (let i = 0; i < 4 && !it; i++) if (L[i].t <= 0) it = L[i];
  if (!it) { it = L[0]; for (let i = 1; i < 4; i++) if (L[i].t < it.t) it = L[i]; }          // all four in use: replace the one about to melt
  if (it.t <= 0) BOSS_LANE.n++;
  it.t = it.dur = mv.lane.dur; it.x = e.x; it.z = e.z; it.dx = -Math.sin(e.yaw); it.dz = -Math.cos(e.yaw); it.len = mv.len; it.w = mv.width;
  const pool = bossFxFor(group).lane, i = L.indexOf(it);
  if (!pool[i]) { const m = new THREE.Mesh(laneGeo(), new THREE.MeshBasicMaterial({ color: 0xe4f6ff, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })); m.position.y = 0.025; m.renderOrder = 1; m.frustumCulled = false; m.visible = false; group.add(m); pool[i] = m; }
  const m = it.m = pool[i]; m.position.x = it.x; m.position.z = it.z; m.rotation.y = e.yaw; m.scale.set(it.w, 1, it.len); m.material.opacity = 0.5; m.visible = true;
}
function bossLaneAt(x, z) {
  if (!BOSS_LANE.n) return false;
  const L = BOSS_LANE.items;
  for (let i = 0; i < 4; i++) {
    const l = L[i]; if (l.t <= 0) continue;
    const rx = x - l.x, rz = z - l.z, along = rx * l.dx + rz * l.dz;
    if (along >= 0 && along <= l.len && Math.abs(rx * l.dz - rz * l.dx) <= l.w / 2 + 0.1) return true;
  }
  return false;
}
function bossLanesUpdate(dt) {
  if (!BOSS_LANE.n) return;
  const L = BOSS_LANE.items;
  for (let i = 0; i < 4; i++) {
    const l = L[i]; if (l.t <= 0) continue;
    if ((l.t -= dt) <= 0) { l.t = 0; BOSS_LANE.n--; if (l.m) l.m.visible = false; } else if (l.t < 1 && l.m) l.m.material.opacity = 0.5 * l.t;   // it melts over the last second
  }
}
function bossLanesClear() { const L = BOSS_LANE.items; for (let i = 0; i < 4; i++) { L[i].t = 0; if (L[i].m) { L[i].m.visible = false; L[i].m = null; } } BOSS_LANE.n = 0; }
// ---- ale puddles (Bottle Toss): up to 6 pooled discs on the floor for mv.puddle.dur s; bossPuddleMul(x, z) is the speed multiplier you wade at (1 = dry). The same cost model as the ice lanes: preallocated records, one decal each. ----
const BOSS_PUD_N = 6, BOSS_PUD = { n: 0, k: 0, items: Array.from({ length: BOSS_PUD_N }, () => ({ t: 0, dur: 1, x: 0, z: 0, r: 1, slow: 1, m: null })) };
function bossPuddleAdd(x, z, mv) {
  const L = BOSS_PUD.items; let it = null;
  for (let i = 0; i < BOSS_PUD_N && !it; i++) if (L[i].t <= 0) it = L[i];
  if (!it) { it = L[0]; for (let i = 1; i < BOSS_PUD_N; i++) if (L[i].t < it.t) it = L[i]; }       // all in use: replace the one about to dry
  if (it.t <= 0) BOSS_PUD.n++;
  const P = mv.puddle; it.t = it.dur = P.dur; it.x = x; it.z = z; it.r = P.r; it.slow = P.slow;
  const pool = bossFxFor(group).pud, i = L.indexOf(it);
  if (!pool[i]) { const m = new THREE.Mesh(blobGeo(0, 0), new THREE.MeshBasicMaterial({ color: 0xe0a238, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })); m.position.y = 0.022; m.renderOrder = 1; m.frustumCulled = false; m.visible = false; group.add(m); pool[i] = m; }
  const m = it.m = pool[i], k = BOSS_PUD.k++; m.geometry = blobGeo(k % 7, 0); m.position.x = x; m.position.z = z; m.rotation.y = k * 2.4; m.scale.set(it.r, 1, it.r * (0.75 + (k % 3) * 0.12)); m.material.opacity = 0.55; m.visible = true;   // a different splash outline each time (a counter, not the RNG)
}
function bossPuddleMul(x, z) {
  if (!BOSS_PUD.n) return 1;
  const L = BOSS_PUD.items; let k = 1;
  for (let i = 0; i < BOSS_PUD_N; i++) { const p = L[i]; if (p.t > 0 && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) <= (p.r + 0.1) * (p.r + 0.1) && p.slow < k) k = p.slow; }
  return k;
}
function bossPuddlesUpdate(dt) {
  if (!BOSS_PUD.n) return;
  const L = BOSS_PUD.items;
  for (let i = 0; i < BOSS_PUD_N; i++) {
    const p = L[i]; if (p.t <= 0) continue;
    if ((p.t -= dt) <= 0) { p.t = 0; BOSS_PUD.n--; if (p.m) p.m.visible = false; } else if (p.t < 1 && p.m) p.m.material.opacity = 0.55 * p.t;   // it dries up over the last second
  }
}
function bossPuddlesClear() { const L = BOSS_PUD.items; for (let i = 0; i < BOSS_PUD_N; i++) { L[i].t = 0; if (L[i].m) { L[i].m.visible = false; L[i].m = null; } } BOSS_PUD.n = 0; }
// ---- flame patches (Fire Sweep, fireball impacts): up to 6 pooled discs on the floor for dur s; standing in one makes you bleed (bossFlameAt, main.js applies it). Same cost model as the puddles. ----
const BOSS_FLAME_N = 6, BOSS_FLAME = { n: 0, items: Array.from({ length: BOSS_FLAME_N }, () => ({ t: 0, dur: 1, x: 0, z: 0, r: 1, m: null })) };
function bossFlameAdd(x, z, r, dur) {
  const L = BOSS_FLAME.items; let it = null;
  for (let i = 0; i < BOSS_FLAME_N && !it; i++) if (L[i].t <= 0) it = L[i];
  if (!it) { it = L[0]; for (let i = 1; i < BOSS_FLAME_N; i++) if (L[i].t < it.t) it = L[i]; }       // all in use: replace the one about to burn out
  if (it.t <= 0) BOSS_FLAME.n++;
  it.t = it.dur = dur; it.x = x; it.z = z; it.r = r;
  const pool = bossFxFor(group).flame, i = L.indexOf(it);
  if (!pool[i]) { const m = new THREE.Mesh(bossTeleGeo('disc'), new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.7, depthWrite: false })); m.position.y = (group.userData.fxY || 0.025) + 0.003; m.renderOrder = 1; m.frustumCulled = false; m.visible = false; group.add(m); pool[i] = m; }
  const m = it.m = pool[i]; m.position.x = x; m.position.z = z; m.scale.set(r, 1, r); m.material.opacity = 0.7; m.visible = true;
}
function bossFlameAt(x, z) {
  if (!BOSS_FLAME.n) return false;
  const L = BOSS_FLAME.items;
  for (let i = 0; i < BOSS_FLAME_N; i++) { const p = L[i]; if (p.t > 0 && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) <= (p.r + 0.1) * (p.r + 0.1)) return true; }
  return false;
}
function bossFlamesUpdate(dt) {
  if (!BOSS_FLAME.n) return;
  const L = BOSS_FLAME.items;
  for (let i = 0; i < BOSS_FLAME_N; i++) {
    const p = L[i]; if (p.t <= 0) continue;
    if ((p.t -= dt) <= 0) { p.t = 0; BOSS_FLAME.n--; if (p.m) p.m.visible = false; } else if (p.m) p.m.material.opacity = (0.55 + 0.15 * Math.sin(p.t * 13 + i * 2)) * Math.min(1, p.t * 1.2);   // it flickers and dies down over the last second
  }
}
function bossFlamesClear() { const L = BOSS_FLAME.items; for (let i = 0; i < BOSS_FLAME_N; i++) { L[i].t = 0; if (L[i].m) { L[i].m.visible = false; L[i].m = null; } } BOSS_FLAME.n = 0; }
// One ring of the telegraph pool goes out (a fireball landed).
function bossTeleOff(i) { if (typeof group === 'undefined' || !group || !group.userData.bossFx) return; const m = group.userData.bossFx.tele[i]; if (m) m.visible = false; }
function bossFxRelease(m) { m.visible = false; m.userData.busy = false; }

// ---- HUD and glossary text from the defs ----
function bossMoveText(mv) {
  const wind = mv.wind > 0 ? `${mv.wind.toFixed(1)} s warning` : 'short warning';
  const how = mv.ground ? 'a red mark on the floor; blocking still hurts, so dodge' + (mv.lane ? ', and the floor stays icy' : '') + (mv.selfStun ? ', and it stuns itself on a wall or pillar' : '') : mv.shape === 'projectile' ? 'blockable shots' + (mv.puddle ? ' that leave slowing puddles' : '') : mv.shape === 'summon' ? 'calls help' : mv.shape === 'blink' ? 'it vanishes and appears behind you, then strikes' : mv.parry === false ? 'block it, no parry' : 'parry it to stagger';
  return `${mv.name || mv.id} (${wind}, ${how})`;
}
function bossCardLines(def, hp) {
  return [
    def.blurb ? `Boss of floor 5. ${hp} HP. ${def.blurb}` : `Boss of floor 5. ${hp} HP in heavy plate, and it hits much harder than a guard.`,
    'Sleeps in the middle of the arena until you get close. Cannot be sneak-killed and is not staggered by normal hits.',
    'Moves: ' + def.moves.filter(m => !m.chain).map(bossMoveText).join('; ') + '.',
    'A parry still staggers it.',
    'Drops an Epic piece of equipment (with a small chance of Legendary), more equipment and gold. The stairs stay sealed until it falls. The safe room behind it leads to the next stage.'];
}
