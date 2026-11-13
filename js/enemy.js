// Guard enemy: vision cone, hearing, awareness meter and the unaware / suspicious /
// alerted / searching state machine (stage 3 of the build order).
const FOV_HALF = 50;                    // degrees either side of straight ahead (was 55)
const COS_HALF_FOV = Math.cos(FOV_HALF * Math.PI / 180);
const VIS_RANGE = 10;                   // metres (was 12)
const BOSS_SCALE = 1.6;                 // model size; combat.js divides the aim height by it
const SHOUT_R = 11;                    // a guard that spots you yells; guards in range come to its spot
const CLASH_R = 5;                      // each swing of an alerted guard carries this far
const HEAR_THROUGH_WALLS = 0.5;      // noise radius multiplier when there is no line of sight
const SPEED = { patrol: 1.6, investigate: 2.4, search: 3.0 };      // the alerted chase speed is TUNE.chaseSpeed
const STRIKE_T = 0.07;               // the fast swing after the wind-up; the hit lands at its end
const easeInOut = t => t * t * (3 - 2 * t);
// Per zone: [raise pose, strike-end pose], each [upper x, upper y, right arm x, left arm x, dip].
// Head = overhead chop, body = horizontal swing from the side, legs = low sweep from a crouch.
const ATTACK_POSES = {
  head: [[0.35, 0, 2.8, 1.2, 0],   [-0.55, 0, 0.25, 0.4, 0.08]],
  body: [[0, -1.0, 1.45, 0.3, 0],  [0, 0.9, 1.45, 0.3, 0]],
  legs: [[-0.5, 0, -0.7, 0, 0.2],  [-0.85, 0, 1.4, 0, 0.3]],
  shoot: [[0, 0, 1.5, 1.5, 0],     [0, 0, 1.5, 1.5, 0]],       // archers and shamans: both arms out in front
};
const TARGET_POSE = [0, 0, 0, 0, 0];
const setPose = (t, a, b, c, d, e) => { t[0] = a; t[1] = b; t[2] = c; t[3] = d; t[4] = e; };
const ATTACK_RANGE = 1.4;            // hp, damage, windup and cooldown live in TUNE (combat.js)
let gameRng = makeRng(1);   // gameplay RNG, re-seeded per floor in main.js (separate from the generator's, so floors are unchanged)
const pickZone = w => { const r = gameRng() * (w[0] + w[1] + w[2]); return r < w[0] ? 'head' : r < w[0] + w[1] ? 'body' : 'legs'; };

const wallAt = (floor, tx, ty) => {
  if (tx < 0 || ty < 0 || tx >= floor.w || ty >= floor.h) return true;
  const t = floor.tiles[ty * floor.w + tx];
  return t === T_WALL || t === T_DOOR || t === T_SAFEDOOR;   // the safe room's open door is a wall to guards: no path, sight or arrow goes through
};

function hasLOS(floor, x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (wallAt(floor, Math.floor((x0 + (x1 - x0) * t) / TILE), Math.floor((z0 + (z1 - z0) * t) / TILE))) return false;
  }
  return true;
}

// 4-way BFS over open tiles (the stairwell tile is off limits). Returns tiles after the start tile.
const DIR_X = [1, -1, 0, 0], DIR_Y = [0, 0, 1, -1];
let PATH_PREV = null, PATH_Q = null;   // BFS scratch, reused between calls (re-made only when the floor size changes)
const pathBlocked = (floor, x, y) => {   // the stairwell and the stairs up are off limits
  const st = floor.stairs, up = floor.up;
  return wallAt(floor, x, y) || (x === st.x && y === st.y) || (up && x === up.x && y === up.y) || floor.blocked[y * floor.w + x] === 1;
};
function findPath(floor, sx, sy, tx, ty) {
  const { w, h } = floor;
  if (pathBlocked(floor, tx, ty)) {   // target is inside furniture or the stairwell: aim for an open tile beside it instead
    let k = 0; while (k < 4 && pathBlocked(floor, tx + DIR_X[k], ty + DIR_Y[k])) k++;
    if (k === 4) return [];
    tx += DIR_X[k]; ty += DIR_Y[k];
  }
  if (!PATH_PREV || PATH_PREV.length !== w * h) { PATH_PREV = new Int32Array(w * h); PATH_Q = new Int32Array(w * h); }
  const prev = PATH_PREV, q = PATH_Q;
  prev.fill(-1);
  let qs = 0, qe = 0; q[qe++] = sy * w + sx; prev[q[0]] = q[0];
  while (qs < qe) {
    const i = q[qs++], x = i % w, y = (i / w) | 0;
    if (x === tx && y === ty) break;
    for (let k = 0; k < 4; k++) {
      const nx = x + DIR_X[k], ny = y + DIR_Y[k];
      if (pathBlocked(floor, nx, ny) || prev[ny * w + nx] >= 0) continue;
      prev[ny * w + nx] = i; q[qe++] = ny * w + nx;
    }
  }
  if (prev[ty * w + tx] < 0) return [];
  const path = [];
  for (let i = ty * w + tx; i !== sy * w + sx; i = prev[i]) path.push({ x: i % w, y: (i / w) | 0 });
  return path.reverse();
}

// Path distance in tiles from (sx, sy) to every open tile into `out` (-1 = unreachable), blocking like findPath. Fills the shared
// FLEE_Q queue and allocates nothing after the first call on a floor size. Used by the sack thief to pick where to run.
let FLEE_Q = null;
function floodDist(floor, sx, sy, out) {
  const { w, h } = floor, st = floor.stairs, up = floor.up;
  if (!FLEE_Q || FLEE_Q.length !== w * h) FLEE_Q = new Int32Array(w * h);
  const q = FLEE_Q;
  out.fill(-1);
  let qs = 0, qe = 0; q[qe++] = sy * w + sx; out[q[0]] = 0;
  while (qs < qe) {
    const i = q[qs++], x = i % w, y = (i / w) | 0, d = out[i] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), ni = ny * w + nx;
      if (wallAt(floor, nx, ny) || out[ni] >= 0 || floor.blocked[ni] === 1 || (nx === st.x && ny === st.y) || (up && nx === up.x && ny === up.y)) continue;
      out[ni] = d; q[qe++] = ni;
    }
  }
}

const turnToward = (a, b, max) => {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + Math.max(-max, Math.min(max, d));
};

function iconTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 32, 34);
  g.fillStyle = color; g.fillText(text, 32, 34);
  return new THREE.CanvasTexture(c);
}
let ICONS = null;

// Rounded body parts (the goblin rig used to be all boxes): a tapered cylinder for limbs, an ellipsoid for heads and
// hands, and an elliptical cylinder for a torso. Armor and clothing stay boxy, like plates and cloth.
const ROUND_SEGS = 12;
// Primitive geometries and the plain lit materials are cached and shared by every creature: parts are only read by bakeMeshes
// (the baked meshes own their own buffers), so the cache is never disposed with a floor (userData.shared, see freeObject in main.js).
const GEO_CACHE = new Map(), LAM_CACHE = new Map();
const cachedGeo = (key, make) => { let g = GEO_CACHE.get(key); if (!g) { g = make(); g.userData.shared = true; GEO_CACHE.set(key, g); } return g; };
const boxGeo = (w, h, d) => cachedGeo('b' + w + ',' + h + ',' + d, () => new THREE.BoxGeometry(w, h, d));
const lamMat = c => { const k = c.isColor ? c.getHex() : c; let m = LAM_CACHE.get(k); if (!m) LAM_CACHE.set(k, m = new THREE.MeshLambertMaterial({ color: c })); return m; };   // build-time colour source only, never drawn
function cylPart(rTop, rBot, h, mat, x, y, z, parent) { const p = new THREE.Mesh(cachedGeo('c' + rTop + ',' + rBot + ',' + h, () => new THREE.CylinderGeometry(rTop, rBot, h, ROUND_SEGS)), mat); p.position.set(x, y, z); parent.add(p); return p; }
function ellPart(w, h, d, mat, x, y, z, parent) { const p = new THREE.Mesh(cachedGeo('s', () => new THREE.SphereGeometry(0.5, ROUND_SEGS, 9)), mat); p.scale.set(w, h, d); p.position.set(x, y, z); parent.add(p); return p; }
function torsoPart(w, h, d, mat, x, y, z, parent) { const p = new THREE.Mesh(cachedGeo('t', () => new THREE.CylinderGeometry(0.5, 0.44, 1, 14)), mat); p.scale.set(w, h, d); p.position.set(x, y, z); parent.add(p); return p; }
let SHADOW_GEO = null, SHADOW_MAT = null, SPARK_GEO = null, TOOTH_GEO = null;   // a soft dark disc under each creature, so it sits on the floor instead of floating

const NO_SKIP = new Set(), LIVE = [];   // separateBodies scratch list
let sepFloor = null;
const sepFree = (x, z) => !Player.prototype.blocked.call(collider, sepFloor, x, z);
const collider = { radius: 0.4, props: [], mob: true };   // borrows Player.blocked for wall collision

// Bodies are circles: push overlapping living guards apart (half each) and push guards out of the
// player. A guard pinned against a wall pushes the player instead. Runs once a frame after the guards move.
function separateBodies(enemies, player, floor) {
  collider.props = floor.solids;
  sepFloor = floor;
  const live = LIVE; live.length = 0;
  for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead) live.push(enemies[i]);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const min = a.r + b.r;
      if (d >= min) continue;
      if (d < 1e-4) { const k = (i * 7 + j * 13) % 628 / 100; dx = Math.cos(k); dz = Math.sin(k); d = 1; }   // exactly stacked: split in a fixed direction
      else { dx /= d; dz /= d; }
      const sa = a.st.has('stuck'), sb = b.st.has('stuck');                                  // a glued enemy is immovable: the other gives way
      if (sa && sb) continue;
      const push = (min - Math.min(d, min)) / (sa || sb ? 1 : 2);
      if (!sa && sepFree(a.x - dx * push, a.z - dz * push)) { a.x -= dx * push; a.z -= dz * push; }
      if (!sb && sepFree(b.x + dx * push, b.z + dz * push)) { b.x += dx * push; b.z += dz * push; }
    }
    for (const e of live) {
      let dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      const min = e.r + player.radius;
      if (d >= min) continue;
      if (d < 1e-4) { dx = -Math.sin(player.yaw); dz = -Math.cos(player.yaw); d = 0; }   // dead centre: step the guard out in front
      else { dx /= d; dz /= d; }
      const push = min - d;
      if (!e.st.has('stuck') && sepFree(e.x + dx * push, e.z + dz * push)) { e.x += dx * push; e.z += dz * push; }
      else if (!Player.wallHit(floor, player.x - dx * push, player.z - dz * push, player.radius)) { player.x -= dx * push; player.z -= dz * push; }
    }
  }
  for (const e of live) e.mesh.position.set(e.x, e.mesh.position.y, e.z);
}

class Enemy {
  constructor(spec, floor) {
    this.floor = floor;
    this.spec = spec;
    this.type = spec.type || 'goblin';
    this.T = ENEMY_TYPES[this.type];
    this.quad = this.T.model === 'quad' || this.T.model === 'float' || this.T.model === 'mimic';   // floating things aim and animate like animals
    this.handlerRef = null;             // a wolf's goblin handler (linkHandlers in enemytypes.js)
    this.boss = !!spec.boss;            // big, hits harder, no stagger, and asleep until the player gets within TUNE.bossWake
    this.dormant = this.boss || !!this.T.ambush || this.T.mimic;   // the boss and scarecrows wait, as scenery, until you come close
    this.x = (spec.x + 0.5) * TILE; this.z = (spec.y + 0.5) * TILE;
    this.route = spec.route.map(p => ({ x: (p.x + 0.5) * TILE, z: (p.y + 0.5) * TILE }));
    this.ri = 1;
    this.yaw = (spec.seed % 628) / 100;
    this.state = 'unaware'; this.aware = 0;
    this.last = null; this.path = []; this.pk = ''; this.rp = 0;
    this.wait = 0; this.lookT = 0; this.lostT = 0; this.atkCd = 0; this.walkT = 0; this.stuckT = 0;
    this.seen = false;
    this.st = new Statuses();           // slow, cripple, bleed, stun (js/status.js)
    this.healCd = 3; this.healFx = 0; this.cast = null; this.castTarget = null;   // shaman: heals wounded allies
    this.fleeT = 0; this.fleeTo = null; this.stolen = false; this.loot = 0;   // thieves
    this.fgoal = -1; this.fre = 0; this.cower = false; this.escaped = false;   // sack thief (fleer): index of its flee spot, seconds to the next think, cornered, gone down the stairs
    this.chargeWind = 0; this.chargeT = 0; this.cdx = 0; this.cdz = 0; this.hitMul = 1;   // boars
    this.sleepT = 0;                    // asleep (a sleep wand): sees and hears nothing, any damage wakes it
    this.rageT = 0; this.rageFrom = null; this.rageTarget = null;   // Hanahan's Rage: fights other enemies instead of the player
    this.fuse = -1; this.exploded = false; this.spark = null; this.keep = null;   // bomb goblins: seconds left on the fuse (-1 = not lit yet)
    this.printId = 0;                                               // the newest footprint this guard has followed (Frozen Chapel)
    this.windOvr = 0; this.propObj = null;                          // mimics: a fixed wind-up for the first bite, and the chest prop it stands in for
    this.cause = 'died';
    this.foe = null; this.isAlly = this.type === 'ally';             // foe: the ally this enemy is fighting instead of the player (js/quests.js sets it)
    this.seed = spec.seed;
    const fl = this.boss ? 0 : Math.max(0, (typeof floorNum === 'number' ? floorNum : 1) - 1);   // floor scaling, once at spawn (boss excluded)
    const sg = Math.max(0, (typeof stage === 'number' ? stage : 1) - 1);   // stage scaling, once at spawn (js/main.js: stage 1..4, 5 is the final boss arena)
    this.final = !!spec.final;
    this.dmgScale = (1 + TUNE.floorDmgScale * fl) * (1 + TUNE.stageDmgScale * sg);
    this.bossDmg = this.final ? TUNE.finalBossDmg : 1 + TUNE.stageBossDmg * sg;
    this.hp = this.maxHp = this.boss ? TUNE.bossHp * (this.final ? TUNE.finalBossHp : 1 + TUNE.stageBossHp * sg) : TUNE.enemyHp * this.T.hpMul * (1 + TUNE.floorHpScale * fl) * (1 + TUNE.stageHpScale * sg); this.stun = 0; this.hitT = 0;
    this.winding = false; this.windT = 0; this.zone = 'body';
    this.dead = false; this.deadT = 0;
    this.build();
  }

  build() {
    if (!ICONS) { ICONS = { q: iconTexture('?', '#ffd23a'), s: iconTexture('?', '#ff8a2a'), a: iconTexture('!', '#ff3a3a') }; for (const k in ICONS) ICONS[k].userData = { shared: true }; }
    // Every guard rolls its own look from its seed: skin and cloth colours, size, headgear
    // (iron helmet, hood or bare with a tuft), a vest, shoulder pads, a sack, and a club or cleaver.
    const rg = makeRng(this.seed || 1);
    const pal = arr => arr[Math.floor(rg() * arr.length)];
    const lam = lamMat;
    const skin = lam(this.spec.skin || this.T.skin || pal([0x5f8a3c, 0x6a9244, 0x557a3a, 0x7b8f40]));
    const dark = lam(new THREE.Color(skin.color).multiplyScalar(0.65).getHex());     // hands, ear tips, warts, brow
    const cloth = lam(pal([0x6a3f2a, 0x5a3a46, 0x3a4a5a, 0x5a5230]));
    const leather = lam(0x3a2616), metal = lam(0x8a8e96), bone = lam(0xe6e0c8), black = lam(0x120c08);
    this.mats = [skin, dark, cloth, leather, metal, bone, black];
    // Random kit: each piece is a real item (same classes and tiers the player finds). What the
    // guard wears is drawn on the model, soaks up damage in that zone, and is what it can drop.
    const tierOf = () => rollTier(typeof effFloor === 'function' ? effFloor() : typeof floorNum === 'number' ? floorNum : 1, rg);   // effFloor: floor + stage loot depth (js/main.js)
    const piece = (slot, chance) => rg() < chance ? { type: 'armor', slot, cls: weighted(rg, [50, 35, 15]), tier: tierOf() } : null;
    const heavy = slot => ({ type: 'armor', slot, cls: 2, tier: 2 });          // the boss, captains and ice knights wear full plate (Rare)
    const plate = this.boss || this.T.heavy;
    const bare = this.T.noGear || this.quad;     // cooks and animals wear no armor
    const helmet = plate ? heavy('helmet') : bare ? null : piece('helmet', 0.4), vest = plate ? heavy('chest') : bare ? null : piece('chest', 0.4), boots = plate ? heavy('boots') : bare ? null : piece('boots', 0.35);
    const hood = !helmet && rg() < 0.4;
    // Armor goes over clothing, never under it: a helmet replaces any hat, hood or bandana, a vest covers the torso cloth
    // and its trimmings, and bosses whose dress is a crown or hat wear that instead of showing the helmet (it still protects).
    const crowned = this.boss && ['innkeeper', 'king', 'warlord', 'frost', 'fungus'].includes(this.spec.dress);
    const kind = this.boss ? 'mace' : this.T.weapon || (rg.pick ? rg.pick(['dagger', 'sword', 'mace']) : 'mace');
    this.weaponKind = kind;
    const weapon = { type: 'weapon', base: kind, tier: this.boss ? TUNE.bossWeaponTier : tierOf() };
    this.spdRoll = this.boss ? TUNE.bossAtkSpd : (WSTATS[kind].spd || 1) * (0.9 + rg() * 0.2);   // the guard's own attack speed stat: weapon spd x a small roll
    this.gear = this.quad ? [] : [helmet, vest, boots, weapon].filter(Boolean);   // animals carry nothing
    const cut = it => it ? Math.min(0.5, ARMOR_RED[it.cls] * TIERS[it.tier].mul) : 0;
    this.resist = { head: 1 - cut(helmet), body: 1 - cut(vest), legs: 1 - cut(boots) };
    const metalFor = it => lam(it.tier >= 2 ? TIERS[it.tier].color : [0x6a4a2a, 0x8a8e96, 0x5a5e66][it.cls]);   // leather, iron, dark plate; rare+ gear is tinted by tier
    const m = this.mesh = new THREE.Group();
    m.rotation.order = 'YXZ';          // yaw first, so falling over tips backward
    m.scale.setScalar(this.boss ? BOSS_SCALE * (this.final ? TUNE.finalBossScale : 1) : this.T.scale || 0.92 + rg() * 0.2);
    this.scaleK = m.scale.x;
    if (this.T.model === 'float') this.buildFloat(m, lam);
    else if (this.T.model === 'mimic') this.buildMimic(m);
    else if (this.quad) this.buildQuad(m, lam);
    else {
    const box = (w, h, d, mat, x, y, z, parent) => { const p = new THREE.Mesh(boxGeo(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
    this.legs = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 0.15, 0.7, 0);
      cylPart(0.115, 0.095, 0.7, skin, 0, -0.35, 0, g);
      box(0.25, 0.2, 0.32, boots ? metalFor(boots) : leather, 0, -0.6, -0.04, g);                // boot
      if (boots && boots.cls >= 1) box(0.23, 0.3, 0.25, metalFor(boots), 0, -0.4, 0, g);          // greave
      if (boots && boots.cls === 2) box(0.27, 0.1, 0.27, metalFor(boots), 0, -0.12, 0, g);        // knee plate
      box(0.26, 0.05, 0.3, black, 0, -0.69, -0.04, g);                                           // sole
      m.add(g); return g;
    });
    // Torso, head and arms hang off a hip pivot so the whole upper body can lean and twist.
    // Rotation signs (model faces -z): arm x > 0 swings forward, upper x > 0 leans back,
    // upper y > 0 turns the right shoulder forward.
    const up = this.upper = new THREE.Group(); up.position.y = 0.7; m.add(up);
    const part = (w, h, d, mat, x, y, z) => box(w, h, d, mat, x, y, z, up);
    torsoPart(0.56, 0.7, 0.34, cloth, 0, 0.35, 0, up);                                           // torso
    part(0.58, 0.08, 0.35, leather, 0, 0.1, 0);                                                  // belt
    part(0.1, 0.08, 0.02, metal, 0, 0.1, -0.18);                                                 // buckle
    if (this.spec.carry) { const gold = lam(0xe8c040); part(0.035, 0.14, 0.02, gold, 0.2, -0.02, -0.19); part(0.1, 0.07, 0.02, gold, 0.2, 0.07, -0.19); part(0.06, 0.025, 0.02, gold, 0.23, -0.07, -0.19); }   // a small gold key hanging on the belt (the quest key, see QUEST_TYPES.prisoner)
    part(0.46, 0.3, 0.05, cloth, 0, -0.04, -0.17);                                               // loincloth
    if (vest) {
      const vm = metalFor(vest);
      part(0.62, 0.46, 0.4, vm, 0, 0.46, 0);                                                      // the armor wraps the whole chest, over the cloth torso
      part(0.5, 0.38, 0.05, vm, 0, 0.45, -0.21); part(0.58, 0.05, 0.34, leather, 0, 0.66, 0);   // jerkin / chainmail / plate front
      if (vest.cls >= 1) part(0.58, 0.5, 0.06, vm, 0, 0.4, 0.18);                                  // back piece
      if (vest.cls === 2) for (const s of [-1, 1]) part(0.22, 0.12, 0.3, vm, s * 0.38, 0.72, 0);   // pauldrons
    }
    this.look = { helmet: !!helmet && !crowned, hat: (!helmet && (hood || ['bandit', 'archer', 'dartgoblin'].includes(this.type))) || crowned, vest: !!vest, clothOverArmor: false };   // what is drawn, for the tests
    const pad = rg() < 0.6;
    if (pad && !vest) part(0.28, 0.12, 0.28, leather, -0.38, 0.74, 0);                            // shoulder pad (clothing, so not under armor)
    if (rg() < 0.5) { part(0.04, 0.12, 0.04, bone, 0.38, 0.86, -0.05); part(0.04, 0.1, 0.04, bone, 0.38, 0.84, 0.07); }   // bone spikes
    if (rg() < 0.4) { part(0.36, 0.3, 0.2, leather, 0, 0.4, 0.28); part(0.08, 0.06, 0.08, bone, 0, 0.58, 0.28); }       // loot sack on the back
    // head: heavy brow, pointed ears, tusks, a big nose and two angry eyes
    ellPart(0.4, 0.38, 0.38, skin, 0, 0.88, 0, up);                                               // head
    part(0.34, 0.06, 0.06, dark, 0, 0.99, -0.17);                                                // brow
    ellPart(0.1, 0.14, 0.15, skin, 0, 0.84, -0.22, up);                                          // nose
    for (const s of [-1, 1]) {
      const ear = part(0.2, 0.07, 0.04, skin, s * 0.27, 0.95, 0); ear.rotation.z = s * 0.45;      // ears
      part(0.06, 0.05, 0.04, dark, s * 0.36, 1.0, 0);
      part(0.075, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: 0xffe060 }), s * 0.085, 0.935, -0.175);   // eyes
      part(0.03, 0.04, 0.02, new THREE.MeshBasicMaterial({ color: 0x000000 }), s * 0.085, 0.935, -0.186);    // pupils
      part(0.035, 0.08, 0.035, bone, s * 0.075, 0.77, -0.18);                                    // tusks
    }
    part(0.2, 0.03, 0.02, black, 0, 0.78, -0.175);                                               // mouth
    for (let i = 0; i < 2; i++) part(0.03, 0.03, 0.03, dark, (rg() - 0.5) * 0.25, 0.8 + rg() * 0.15, -0.175);   // warts
    if (helmet && !crowned) {
      const hm = metalFor(helmet);
      if (helmet.cls === 0) { part(0.4, 0.12, 0.4, hm, 0, 1.07, 0); part(0.41, 0.05, 0.41, hm, 0, 1.0, 0); }   // leather cap
      else {
        part(0.4, 0.13, 0.4, hm, 0, 1.08, 0); part(0.41, 0.06, 0.41, hm, 0, 1.0, 0);
        part(0.04, 0.16, 0.03, hm, 0, 0.92, -0.2); part(0.05, 0.08, 0.05, leather, 0, 1.17, 0);              // dome, rim, nasal guard, crest
        if (helmet.cls === 2) { part(0.42, 0.3, 0.42, hm, 0, 0.95, 0); part(0.2, 0.04, 0.03, black, 0, 0.93, -0.22); part(0.06, 0.2, 0.06, bone, 0, 1.25, 0); }   // great helm: full face, visor slit, plume
      }
    } else if (hood && !helmet) {
      part(0.41, 0.16, 0.41, cloth, 0, 1.06, 0); part(0.4, 0.34, 0.07, cloth, 0, 0.9, 0.2);
    } else if (!helmet) part(0.1, 0.13, 0.26, black, 0, 1.1, 0);                                  // tuft
    this.arms = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 0.38, 0.68, 0);
      cylPart(0.09, 0.075, 0.6, skin, 0, -0.3, 0, g);
      ellPart(0.19, 0.17, 0.19, dark, 0, -0.65, 0, g);                                            // hand
      box(0.19, 0.1, 0.2, leather, 0, -0.5, 0, g);                                                // wristband
      up.add(g); return g;
    });
    if (rg() < 0.3 || this.T.shield) { const sh = box(0.06, 0.46, 0.46, leather, -0.14, -0.4, -0.14, this.arms[0]); box(0.07, 0.1, 0.1, metal, -0.17, -0.4, -0.14, this.arms[0]); sh.rotation.x = 0; }   // small shield
    // weapon in the right hand: a knobbed club or a chipped cleaver
    const wpn = new THREE.Group(); wpn.position.set(0, -0.62, -0.04);
    const blade = lam(weapon.tier >= 2 ? TIERS[weapon.tier].color : 0x8a8e96);
    const look = this.T.look || kind;
    if (look === 'bow') {
      box(0.04, 0.85, 0.05, lam(0x6a4a24), 0.02, -0.3, -0.05, wpn); box(0.01, 0.8, 0.01, bone, 0.02, -0.3, 0.0, wpn);                         // a bow and its string
    } else if (look === 'staff') {
      box(0.045, 1.25, 0.045, lam(0x4a3018), 0, -0.4, 0, wpn);
      box(0.12, 0.12, 0.12, new THREE.MeshBasicMaterial({ color: this.T.orb || 0xb060ff }), 0, -1.05, 0, wpn);                                             // a glowing orb on the staff
    } else if (look === 'mace') {
      box(0.07, 0.6, 0.07, lam(0x4a3018), 0, -0.22, 0, wpn);
      box(0.17, 0.2, 0.17, blade, 0, -0.52, 0, wpn);
      for (let i = 0; i < 3; i++) box(0.04, 0.04, 0.04, metal, (i - 1) * 0.07, -0.5, -0.09, wpn);   // spikes
    } else if (look === 'sword') {
      box(0.06, 0.3, 0.06, leather, 0, -0.1, 0, wpn);
      box(0.22, 0.05, 0.08, metal, 0, -0.27, 0, wpn);                                             // crossguard
      box(0.05, 0.62, 0.12, blade, 0, -0.6, -0.04, wpn);
    } else {
      box(0.05, 0.22, 0.05, leather, 0, -0.08, 0, wpn);
      box(0.14, 0.04, 0.06, metal, 0, -0.2, 0, wpn);
      box(0.04, 0.3, 0.1, blade, 0, -0.38, -0.04, wpn);                                           // short dagger blade
    }
    this.arms[1].add(wpn);
    // type dressing: what makes a cook, a bandit or a bouncer look like one
    if (this.type === 'cook') {
      part(0.5, 0.62, 0.05, lam(0xf2efe6), 0, 0.35, -0.2); part(0.36, 0.3, 0.36, lam(0xf2efe6), 0, 1.2, 0); part(0.4, 0.06, 0.4, lam(0xf2efe6), 0, 1.04, 0);   // apron and chef's hat
    } else if (this.type === 'bandit') {
      if (!helmet) { part(0.4, 0.09, 0.4, lam(0x8a1f1f), 0, 1.04, 0); part(0.1, 0.12, 0.05, lam(0x8a1f1f), 0.18, 0.99, 0.2); }   // red bandana (a helmet replaces it)
      box(0.1, 0.3, 0.1, lam(0x2f6a3a), 0, -0.58, -0.1, this.arms[0]); box(0.06, 0.1, 0.06, lam(0x2f6a3a), 0, -0.4, -0.1, this.arms[0]);   // a bottle in the off hand
    } else if (this.type === 'archer' || this.type === 'dartgoblin') {
      if (!helmet) { const lf = this.type === 'archer' ? 0x3a5a2a : 0x4a8a2a; part(0.42, 0.3, 0.42, lam(lf), 0, 1.04, 0); part(0.4, 0.34, 0.07, lam(lf), 0, 0.9, 0.2); }  // a green hood (a helmet replaces it); the dart goblin's is leaf-bright
      part(0.13, 0.42, 0.13, leather, 0.18, 0.55, 0.22); for (const x of [0.14, 0.19, 0.24]) part(0.03, 0.12, 0.03, bone, x, 0.8, 0.22);   // a quiver of arrows
    } else if (this.T.robe) {                                                                                                   // casters: shaman, scholar, warden, librarian, cultist
      const robe = lam(this.T.robe);
      part(0.6, 0.78, 0.38, robe, 0, 0.35, 0); part(0.64, 0.5, 0.38, robe, 0, -0.18, 0);                                          // a purple robe over the torso and down the legs
      part(0.44, 0.34, 0.44, robe, 0, 1.0, 0); part(0.4, 0.34, 0.07, robe, 0, 0.9, 0.2);                                          // a deep hood
      part(0.3, 0.06, 0.04, new THREE.MeshBasicMaterial({ color: this.T.orb || 0xb060ff }), 0, 0.9, -0.2);                                       // glowing eyes in the hood
    } else if (this.type === 'brute') {
      if (!vest) part(0.95, 0.24, 0.5, lam(0x4a3a28), 0, 0.64, 0);                                                                // a fur mantle (not over armor)
      part(0.2, 0.2, 0.06, bone, 0, 0.12, -0.2);                                                                                  // a skull on the belt
      for (const s of [-1, 1]) { part(0.05, 0.2, 0.05, bone, s * 0.42, 0.9, 0); part(0.05, 0.14, 0.05, bone, s * 0.34, 0.9, 0.1); }  // shoulder spikes
    } else if (this.type === 'scarecrow') {
      part(0.55, 0.06, 0.55, lam(0x6a4a24), 0, 1.1, 0); part(0.3, 0.26, 0.3, lam(0x6a4a24), 0, 1.24, 0);          // a floppy hat
      part(0.08, 1.7, 0.08, lam(0x4a3018), 0, 0.2, 0.22);                                                          // the pole it is tied to
      for (const s of [-1, 1]) part(0.1, 0.22, 0.04, lam(0xe0c870), s * 0.3, 0.66, -0.17);                          // straw sticking out
    } else if (this.type === 'skeleton') {
      if (!vest) for (let i = 0; i < 3; i++) part(0.5, 0.04, 0.34, bone, 0, 0.25 + i * 0.14, 0);                  // ribs (hidden under armor)
      part(0.1, 0.1, 0.04, black, -0.08, 0.92, -0.18); part(0.1, 0.1, 0.04, black, 0.08, 0.92, -0.18);            // empty eye sockets
    } else if (this.type === 'thief') {
      part(0.42, 0.34, 0.42, lam(0x20302a), 0, 1.0, 0); part(0.4, 0.34, 0.07, lam(0x20302a), 0, 0.9, 0.2);        // a dark hood
      part(0.4, 0.2, 0.2, lam(0x6a4a2a), 0, 0.4, 0.25);                                                            // a swag bag
    } else if (this.type === 'sackthief') {
      part(0.42, 0.34, 0.42, lam(0x2a2a20), 0, 1.0, 0); part(0.4, 0.34, 0.07, lam(0x2a2a20), 0, 0.9, 0.2);        // a dark hood
      part(0.66, 0.62, 0.42, lam(0x8a6a34), 0, 0.3, 0.34); part(0.34, 0.16, 0.3, lam(0x8a6a34), 0, 0.72, 0.34);    // a big sack on its back, tied at the neck
      part(0.4, 0.07, 0.34, lam(0xe0b830), 0, 0.64, 0.34); part(0.12, 0.12, 0.05, new THREE.MeshBasicMaterial({ color: 0xffd84a }), 0.25, 0.3, 0.56);   // a gold cord and a coin peeking out
    } else if (this.type === 'defector') {
      part(0.44, 0.34, 0.44, lam(0x3a3a4a), 0, 1.0, 0); part(0.4, 0.34, 0.07, lam(0x3a3a4a), 0, 0.9, 0.2);        // a grey hood
      part(0.6, 0.78, 0.38, lam(0x4a4a58), 0, 0.35, 0); part(0.64, 0.5, 0.38, lam(0x4a4a58), 0, -0.18, 0);        // a long travelling cloak
    } else if (this.type === 'prisoner') {
      for (const a of this.arms) box(0.21, 0.08, 0.21, metal, 0, -0.55, 0, a);                                                    // iron shackles on both wrists
      part(0.6, 0.18, 0.37, lam(0x5a4a34), 0, 0.5, 0); part(0.34, 0.08, 0.34, lam(0x5a4a34), 0, 1.08, 0);                         // a ragged shirt and a tattered rag on the head
    } else if (this.type === 'ally') {
      part(0.6, 0.09, 0.38, lam(0x3a6aa8), 0, 0.42, 0); part(0.44, 0.07, 0.44, lam(0xe8e4d8), 0, 1.02, 0);                           // a blue sash across the chest and a white head bandage (so it never passes for a guard)
    } else if (this.type === 'bomber') {
      ellPart(0.3, 0.3, 0.3, black, 0, -0.8, -0.12, this.arms[0]); cylPart(0.03, 0.03, 0.07, metal, 0, -0.63, -0.12, this.arms[0]); cylPart(0.014, 0.014, 0.12, leather, 0, -0.58, -0.12, this.arms[0]);   // a round black bomb in the off hand with a fuse
      const sp = this.spark = new THREE.Mesh(SPARK_GEO || (SPARK_GEO = cachedGeo('spark', () => new THREE.SphereGeometry(0.055, 6, 5))), new THREE.MeshBasicMaterial({ color: 0xffa030 })); sp.position.set(0, -0.5, -0.12); this.arms[0].add(sp); this.keep = [sp];   // the spark flickers, so it stays a mesh of its own
      part(0.62, 0.07, 0.4, leather, 0, 0.5, 0); for (const x of [-0.18, 0, 0.18]) ellPart(0.1, 0.1, 0.1, black, x, 0.44, -0.2, up);                                                  // a bandolier of spare bombs
      part(0.4, 0.14, 0.4, lam(0x2a2a2a), 0, 1.06, 0); for (const s of [-1, 1]) part(0.12, 0.08, 0.04, lam(0xa0d8e8), s * 0.085, 0.95, -0.2);                                       // goggles on a leather cap
    } else if (this.type === 'captain') {
      part(0.08, 0.3, 0.1, lam(0xc02020), 0, 1.3, 0); part(0.4, 0.7, 0.06, lam(0xc02020), 0, 0.35, 0.22);         // a plume and a red cape
    } else if (this.type === 'tribal') {
      for (const [x, c] of [[-0.14, 0xc83a2a], [0, 0xe8c040], [0.14, 0x2a8a4a]]) part(0.06, 0.34, 0.04, lam(c), x, 1.26, 0.02);        // a feather crest
      part(0.34, 0.06, 0.02, lam(0xe8e0c8), 0, 0.9, -0.2);                                                                              // war paint across the eyes
    } else if (this.type === 'strangler') {
      for (const [x, y, z, h] of [[-0.3, 0.4, -0.15, 0.9], [0.3, 0.3, -0.12, 0.8], [0, 0.55, 0.2, 1.0], [0.12, 0.9, -0.14, 0.5]]) part(0.07, h, 0.07, lam(0x4a8a2a), x, y, z);   // vines wrapped round it
      for (const s of [-1, 1]) part(0.22, 0.05, 0.22, lam(0x2a5a1a), s * 0.2, 1.12, 0);                                                  // a leafy crown
    } else if (this.type === 'iceknight') {
      for (const x of [-0.12, 0, 0.12]) part(0.05, 0.22, 0.05, lam(0xd8f0ff), x, 1.28, 0);                          // icicle crest
    } else if (this.type === 'golem') {
      for (const [x, y] of [[-0.12, 0.5], [0.15, 0.3], [0, 0.9]]) part(0.05, 0.16, 0.02, new THREE.MeshBasicMaterial({ color: 0xff8a30 }), x, y, -0.18);   // glowing cracks
    } else if (this.type === 'fungbrute') {
      for (const [x, y, z] of [[-0.4, 0.85, 0], [0.4, 0.8, 0.1], [0.1, 1.1, 0.1]]) { part(0.1, 0.12, 0.1, lam(0xd8c8f0), x, y, z); part(0.26, 0.08, 0.26, lam(0xa05ad0), x, y + 0.1, z); }   // mushrooms
    } else if (this.type === 'bouncer') {
      if (!vest) { part(0.9, 0.22, 0.46, lam(0x202020), 0, 0.62, 0); part(0.7, 0.55, 0.38, lam(0x2a2a2e), 0, 0.38, 0); }   // wide shoulders and a black jacket (not over armor)
      part(0.38, 0.1, 0.38, metal, 0, 0.76, 0);                                                                     // spiked collar
      for (const sx of [-0.3, -0.1, 0.1, 0.3]) part(0.05, 0.1, 0.05, bone, sx, 0.84, -0.18);
    }
    if (this.boss && this.spec.dress) {                                                                                           // each theme's boss has its own look
      const d = this.spec.dress, gold = lam(0xe8c040);
      if (d === 'innkeeper') { part(0.42, 0.26, 0.42, lam(0xf2efe6), 0, 1.3, 0); part(0.2, 0.2, 0.06, gold, 0, 0.2, -0.24); }   // a chef's hat in place of the helm (and no apron over his plate)
      else if (d === 'king') { part(0.4, 0.14, 0.4, gold, 0, 1.12, 0); for (const x of [-0.14, 0, 0.14]) part(0.06, 0.14, 0.06, gold, x, 1.24, 0); part(0.7, 0.9, 0.06, lam(0x8a2a2a), 0, 0.3, 0.22); }
      else if (d === 'golem') { for (const [x, y] of [[-0.15, 0.5], [0.18, 0.3], [0, 0.85], [-0.1, 0.1]]) part(0.06, 0.2, 0.02, new THREE.MeshBasicMaterial({ color: 0xff8a30 }), x, y, -0.19); part(0.7, 0.3, 0.5, lam(0x6a6a70), 0, 0.7, 0); }
      else if (d === 'fungus') { for (const [x, y, z] of [[-0.4, 0.9, 0], [0.4, 0.85, 0.1], [0.1, 1.2, 0.1], [-0.2, 1.15, 0.1]]) { part(0.14, 0.16, 0.14, lam(0xd8c8f0), x, y, z); part(0.34, 0.1, 0.34, lam(0xa05ad0), x, y + 0.12, z); } }
      else if (d === 'warlord') { part(0.4, 0.14, 0.4, gold, 0, 1.12, 0); for (const s of [-1, 1]) part(0.06, 0.3, 0.06, bone, s * 0.22, 1.28, 0); part(0.5, 0.6, 0.06, lam(0xa02020), 0, 0.45, 0.22); }
      else if (d === 'frost') { for (const x of [-0.18, -0.06, 0.06, 0.18]) part(0.06, 0.3, 0.06, lam(0xd8f0ff), x, 1.26, 0); for (const s of [-1, 1]) part(0.1, 0.35, 0.1, lam(0xd8f0ff), s * 0.4, 0.95, 0); }
    }
    }
    if (!SHADOW_GEO) { SHADOW_GEO = cachedGeo('shadow', () => new THREE.CircleGeometry(1, 20)); SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }); SHADOW_MAT.userData.shared = true; }
    this.shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.015; this.shadow.scale.setScalar((this.quad ? this.T.r * 1.5 : 0.5) * 1.25);
    this.shadow.renderOrder = 1; m.add(this.shadow);
    // Merge the parts inside each animated group (torso and head, each arm, each leg): about 60 meshes become about 25
    // per creature, and the pose code still moves the same groups.
    if (!this.T.mimic) {
      const ctx = { flash: null };   // one lit material for the whole creature: vertex colours carry the paint, its emissive carries the hit flash   // a mimic is a handful of animated meshes: never baked or merged
      if (this.quad) { bakeMeshes(this.body, new Set(this.wings || []), ctx); for (const w of this.wings || []) bakeMeshes(w, NO_SKIP, ctx); }
      else { bakeMeshes(this.upper, new Set(this.arms), ctx); for (const a of this.arms) bakeMeshes(a, this.keep ? new Set(this.keep) : NO_SKIP, ctx); }
      for (const l of this.legs) bakeMeshes(l, NO_SKIP, ctx);
      this.mats = ctx.flash ? [ctx.flash] : [];   // the flash material (a wisp, all glow, has none)
    }
    this.pose = [0, 0, 0, 0, 0];       // eased pose: [upper x, upper y, right arm x, left arm x, dip]
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: ICONS.q, transparent: true, depthTest: false }));
    this.icon.position.y = this.quad ? (this.T.height + 0.55) / this.scaleK : 2.25; this.icon.scale.set(0.7, 0.7, 1); this.icon.renderOrder = 10; this.icon.visible = false;
    m.add(this.icon);

    // flat fan showing the vision cone, only visible in dev mode
    const segs = 18, verts = [0, 0.04, 0];
    for (let i = 0; i <= segs; i++) {
      const a = (-FOV_HALF + 2 * FOV_HALF * i / segs) * Math.PI / 180;
      verts.push(Math.sin(a) * VIS_RANGE, 0.04, -Math.cos(a) * VIS_RANGE);
    }
    const idx = []; for (let i = 1; i <= segs; i++) idx.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx);
    this.cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    this.cone.visible = false;
    m.add(this.cone);
  }

  // Four-legged model for rats and wolves. The body group pitches and lunges for attacks (poseQuad).
  buildQuad(m, lam) {
    const T = this.T, fur = lam(T.fur), belly = lam(new THREE.Color(T.fur).multiplyScalar(1.35).getHex()), dark = lam(0x1c1612);
    const bone = lam(0xf0ead0), pink = lam(0xc99a9a), eye = new THREE.MeshBasicMaterial({ color: this.type === 'wolf' ? 0xffd060 : 0xff3030 });
    this.mats = [fur, belly, dark, pink];
    const box = (w, h, d, mat, x, y, z, parent) => { const p = new THREE.Mesh(boxGeo(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
    const body = this.body = new THREE.Group(); body.position.y = 0.5; m.add(body);
    ellPart(0.46, 0.4, 1.0, fur, 0, 0.15, 0, body);                              // torso
    box(0.3, 0.1, 0.8, belly, 0, -0.02, 0, body);                                // pale belly
    ellPart(0.32, 0.3, 0.36, fur, 0, 0.3, -0.62, body);                          // head
    ellPart(0.17, 0.14, 0.26, belly, 0, 0.23, -0.84, body);                      // snout
    box(0.06, 0.05, 0.04, dark, 0, 0.3, -0.97, body);                            // nose
    for (const s of [-1, 1]) {
      box(0.07, 0.15, 0.05, fur, s * 0.1, 0.5, -0.56, body);                     // ears
      box(0.05, 0.05, 0.03, eye, s * 0.09, 0.34, -0.78, body);                   // eyes
      box(0.025, 0.06, 0.025, bone, s * 0.05, 0.16, -0.92, body);                // fangs
    }
    if (this.type === 'boar') for (const s of [-1, 1]) box(0.04, 0.04, 0.16, bone, s * 0.07, 0.12, -0.96, body);   // tusks
    if (this.type === 'puffer') { box(0.5, 0.2, 0.5, lam(0xd05a9a), 0, 0.42, 0.05, body); for (const [x, z] of [[-0.15, 0], [0.15, 0.15]]) box(0.12, 0.12, 0.12, lam(0xf0c0e0), x, 0.58, z, body); }   // mushroom caps on its back
    const tail = box(0.07, 0.07, this.type === 'rat' ? 0.75 : 0.5, this.type === 'rat' ? pink : fur, 0, 0.26, 0.7, body); tail.rotation.x = -0.45;
    this.legs = [[-1, -0.32], [1, -0.32], [-1, 0.32], [1, 0.32]].map(([sx, z]) => {   // front pair, then back pair
      const g = new THREE.Group(); g.position.set(sx * 0.15, 0.42, z); cylPart(0.06, 0.045, 0.42, fur, 0, -0.21, 0, g); ellPart(0.12, 0.06, 0.16, dark, 0, -0.41, -0.02, g); m.add(g); return g;
    });
    this.arms = [new THREE.Group(), new THREE.Group()];                          // unused, keeps shared code safe
    this.qp = [0, 0];                                                            // eased pose: [body pitch, lunge offset]
  }

  // The mimic: the real chest model (makeProp in js/props.js) so it looks exactly like the chest it replaces, plus the tells and,
  // once awake, teeth and a tongue. Parts animate (the lid, the lunge), so it is never baked or merged into a static chunk.
  buildMimic(m) {
    const o = makeProp({ kind: 'chest', tier: this.spec.tier | 0, seed: this.seed, x: 0, y: 0, yaw: 0 });
    const inner = o.mesh.children[0]; o.mesh.remove(inner); inner.position.set(0, 0, 0);
    const body = this.body = new THREE.Group(); body.rotation.y = Math.PI; body.add(inner); m.add(body);   // the chest faces +z, an enemy faces -z
    this.lid = o.lid; this.mats = o.mats; this.baseEm = o.mats.map(x => x.emissive.getHex());
    const pink = new THREE.MeshLambertMaterial({ color: 0xc8506a, emissive: 0x3a0a14 }), white = new THREE.MeshLambertMaterial({ color: 0xf0ead0 });
    this.mats.push(pink); this.baseEm.push(0x3a0a14);
    const tg = TOOTH_GEO || (TOOTH_GEO = cachedGeo('tooth', () => new THREE.BoxGeometry(0.06, 0.12, 0.04)));
    const tongue = this.tongue = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.07), pink); tongue.position.set(0, 0.49, 0.31); inner.add(tongue);   // the faint tongue edge at the seam: the tell
    const teeth = this.teeth = new THREE.Group(); teeth.visible = false; inner.add(teeth);
    this.upTeeth = [];
    for (let i = 0; i < 6; i++) {
      const x = -0.38 + i * 0.152, up = new THREE.Mesh(tg, white), dn = new THREE.Mesh(tg, white);
      up.position.set(x, -0.05, 0.63); up.visible = false; this.lid.add(up); this.upTeeth.push(up);       // upper teeth hang from the lid's front edge
      dn.position.set(x + 0.07, 0.55, 0.31); dn.rotation.z = Math.PI; teeth.add(dn);                       // lower teeth point up from the rim
    }
    this.legs = []; this.arms = [new THREE.Group(), new THREE.Group()]; this.qp = [-0.07, 0];
  }
  poseMimic(dt) {
    const lidM = this.lid, t = performance.now() / 1000;
    if (this.dormant) { lidM.rotation.x = -(0.08 + 0.035 * Math.sin(t * 2.1 + this.seed)); return; }   // the tell: a lid ajar that breathes
    if (!this.teeth.visible) { this.showTeeth(); }
    let lid = -0.35 + 0.07 * Math.sin(t * 6), lunge = 0, snap = false;                                  // awake: the mouth gapes
    if (this.stun > 0) lid = -0.15;
    else if (this.winding) {
      const w = this.windT_;
      if (this.windT < w) { const k = easeInOut(Math.min(1, this.windT / (w * 0.85))); lid = -0.35 - 0.85 * k; lunge = 0.12 * k; }   // the lid yawns wide: the cue to back off
      else { lid = 0; lunge = -0.35; snap = true; }                                                    // and slams shut on you
    }
    const k = snap ? 1 : 1 - Math.exp(-14 * dt);
    this.qp[0] += (lid - this.qp[0]) * k; this.qp[1] += (lunge - this.qp[1]) * k;
    lidM.rotation.x = this.qp[0]; this.body.position.z = this.qp[1];
  }
  showTeeth() { this.teeth.visible = true; for (const u of this.upTeeth) u.visible = true; this.tongue.scale.z = 3; this.tongue.position.set(0, 0.45, 0.4); }

  // A mimic wakes (you searched it: bite = true, or you hit it): the chest prop stops being a chest and it fights.
  wake(bite, player) {
    if (!this.dormant) return;
    this.dormant = false;
    if (this.propObj) { this.propObj.p.opened = true; this.propObj.r = 0; }
    if (player) this.last = { x: player.x, z: player.z };
    this.set('alerted');
    if (bite) { this.winding = true; this.windT = 0; this.zone = 'body'; this.windOvr = MIMIC.springWind; this.atkCd = 0; }
  }

  // A bomb goblin goes off (its fuse ran out or it reached its target). The blast itself is main.js (Enemy.explode).
  blow() {
    if (this.exploded || this.dead) return;
    this.exploded = true; this.corpseDone = true; this.die();
    if (Enemy.explode) Enemy.explode(this);
  }

  // Floating creatures (animated books, frost wisps): a body that hovers and bobs, with no legs.
  buildFloat(m, lam) {
    const T = this.T, c = new THREE.Color(T.fur);
    const glow = new THREE.MeshBasicMaterial({ color: c });
    this.mats = [lam(T.fur)];
    const body = this.body = new THREE.Group(); body.position.y = T.hover; m.add(body);
    const box = (w, h, d, mat, x, y, z, parent = body) => { const p = new THREE.Mesh(boxGeo(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
    this.wings = [];
    if (this.type === 'book') {
      const cover = lam(0x6a3a1a), pages = lam(0xe8dcc0);
      box(0.34, 0.06, 0.46, cover, 0, 0, 0); box(0.3, 0.05, 0.42, pages, 0, 0.055, 0);                      // the book
      for (const s of [-1, 1]) { const g = new THREE.Group(); g.position.set(s * 0.18, 0.06, 0); box(0.3, 0.02, 0.4, pages, s * 0.15, 0, 0, g); body.add(g); this.wings.push(g); }   // pages that flap
      box(0.05, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: 0xffd060 }), -0.07, 0.03, -0.24); box(0.05, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: 0xffd060 }), 0.07, 0.03, -0.24);
    } else {
      box(0.34, 0.34, 0.34, glow, 0, 0, 0);                                                                  // a wisp: a bright core, a pale halo and a tail
      box(0.5, 0.5, 0.5, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3 }), 0, 0, 0);
      box(0.16, 0.5, 0.16, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5 }), 0, -0.4, 0.05);
      box(0.06, 0.06, 0.02, new THREE.MeshBasicMaterial({ color: 0x103a5a }), -0.08, 0.04, -0.18); box(0.06, 0.06, 0.02, new THREE.MeshBasicMaterial({ color: 0x103a5a }), 0.08, 0.04, -0.18);
    }
    this.legs = [0, 1, 2, 3].map(() => new THREE.Group());                                                       // none, but the shared pose code swings them
    this.arms = [new THREE.Group(), new THREE.Group()];
    this.qp = [0, 0];
  }

  poseQuad(dt) {
    if (this.T.mimic) return this.poseMimic(dt);
    if (this.T.hover) {                                                                                         // hover and flap
      this.body.position.y = this.T.hover + Math.sin(this.walkT * 0.25 + this.seed) * 0.08 + Math.sin(performance.now() / 400 + this.seed) * 0.06;
      if (this.wings) { const fl = Math.sin(performance.now() / 70 + this.seed) * 0.6; for (let i = 0; i < this.wings.length; i++) this.wings[i].rotation.z = (i ? -1 : 1) * fl; }
    }
    const sw = Math.sin(this.walkT * 0.9) * 0.75, l = this.legs;
    l[0].rotation.x = sw; l[1].rotation.x = -sw; l[2].rotation.x = -sw; l[3].rotation.x = sw;
    let pitch = this.state === 'alerted' ? -0.08 : 0, lunge = 0, snap = false;       // alerted: head low
    if (this.chargeWind > 0) { pitch = 0.45; lunge = 0.25; }                          // pawing the ground
    else if (this.chargeT > 0) { pitch = -0.25; lunge = -0.2; }                      // head down, charging
    if (this.stun > 0) { pitch = 0.4; lunge = 0.15; }
    else if (this.winding) {
      const w = this.windT_;
      if (this.windT < w) { const k = easeInOut(Math.min(1, this.windT / (w * 0.75))); pitch = 0.4 * k; lunge = 0.28 * k; }       // rears back
      else { const s = 1 - Math.pow(1 - Math.min(1, (this.windT - w) / STRIKE_T), 2); pitch = 0.4 - 0.85 * s; lunge = 0.28 - 0.85 * s; snap = true; }   // springs forward
    }
    const k = snap ? 1 : 1 - Math.exp(-14 * dt);
    this.qp[0] += (pitch - this.qp[0]) * k; this.qp[1] += (lunge - this.qp[1]) * k;
    this.body.rotation.x = this.qp[0]; this.body.position.z = this.qp[1];
  }

  // Walk toward a world point along a BFS path. Returns the straight-line distance left.
  goTo(tx, tz, speed, dt) {
    speed *= this.st.moveMul();                  // slow and cripple
    const T = TILE, key = Math.floor(tx / T) + ',' + Math.floor(tz / T);
    if (key !== this.pk || this.rp <= 0) {
      this.path = findPath(this.floor, Math.floor(this.x / T), Math.floor(this.z / T), Math.floor(tx / T), Math.floor(tz / T));
      this.pk = key; this.rp = 0.5;
    }
    this.rp -= dt;
    let gx = tx, gz = tz;
    if (this.path.length) {
      gx = (this.path[0].x + 0.5) * T; gz = (this.path[0].y + 0.5) * T;
      if (Math.hypot(gx - this.x, gz - this.z) < 0.4) { this.path.shift(); return Math.hypot(tx - this.x, tz - this.z); }
    }
    let dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz) || 1;
    // Stuck on a corner or prop: after a moment, re-path from here; if that fails too, steer to the
    // centre of the current tile (always open floor) and finally snap there.
    if (this.stuckT > 0.3) {
      this.rp = 0;
      const cx = (Math.floor(this.x / T) + 0.5) * T, cz = (Math.floor(this.z / T) + 0.5) * T;
      if (this.stuckT > 1.2) { this.x = cx; this.z = cz; this.stuckT = 0; }
      else { dx = cx - this.x; dz = cz - this.z; d = Math.hypot(dx, dz) || 1; }
    }
    const step = Math.min(speed * dt, d);
    const nx = this.x + dx / d * step, nz = this.z + dz / d * step, ox = this.x, oz = this.z;
    collider.props = this.floor.solids;           // stairwell and furniture, set when the floor is built
    if (!Player.prototype.blocked.call(collider, this.floor, nx, this.z)) this.x = nx;
    if (!Player.prototype.blocked.call(collider, this.floor, this.x, nz)) this.z = nz;
    if (step > 0.005 && Math.hypot(this.x - ox, this.z - oz) < step * 0.3) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 7 * dt);
    this.walkT += step * 5;
    return Math.hypot(tx - this.x, tz - this.z);
  }

  get elite() { return this.boss || !!this.T.elite; }
  get r() { return this.boss ? 0.65 : this.T.r; }   // body radius: guards keep this far apart and out of the player

  get atkSpd() { return TUNE.enemyAtkSpd * this.spdRoll; }
  get windT_() { if (this.windOvr) return this.windOvr; if (this.T.ranged) return this.cast === 'heal' ? this.T.ranged.healWind : this.T.ranged.wind; return TUNE.windup / Math.sqrt(this.atkSpd) * (this.boss ? TUNE.bossWindMul : this.T.windMul); }   // wind-up shrinks slower than the cooldown so the zone stays readable; the boss telegraphs longer
  get reach() { return TUNE.enemyReach * (this.boss ? TUNE.bossReachMul : this.T.reach); }
  get chase() { return this.boss ? TUNE.bossSpeed : TUNE.chaseSpeed * this.T.speed; }
  get dmgMul() { return this.boss ? TUNE.bossDmgMul * this.bossDmg : this.T.dmgMul * this.dmgScale; }
  get cooldown() { return TUNE.enemyCooldown / this.atkSpd * this.T.cdMul; }

  lookAround(dt) { this.lookT += dt; this.yaw += Math.cos(this.lookT * 2.2) * 1.4 * dt; }

  set(state) { this.state = state; this.wait = 0; this.lookT = 0; this.rp = 0; if (state === 'alerted') { this.aware = 1; this.atkCd = 0.5; if (this.T.bomb && this.fuse < 0) this.fuse = BOMB.fuse; } }   // a bomb goblin lights up when it is alerted

  die() {
    if (this.tag) this.tag.visible = false;                                                           // a mini-boss's name tag goes with it
    this.dead = true; this.winding = false; this.chargeT = 0; this.chargeWind = 0; this.icon.visible = false; this.cone.visible = false;
    if (this.T.onDeath === 'spores' && Enemy.burst) Enemy.burst(this);   // a spore puffer bursts
    if (this.T.bomb) { if (this.spark) this.spark.visible = false; if (!this.exploded && Enemy.dropBomb) Enemy.dropBomb(this); }   // killed first: the bomb falls and goes off on the floor
  }

  // Aj's Bust: a thick white coat of goo over the whole body, a puddle underneath and a few drips. Built once, on demand.
  buildGoo() {
    const g = this.goo = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color: 0xf6f6f0, shininess: 110, specular: 0xffffff, emissive: 0x34342e, transparent: true, opacity: 0.88 });
    const h = this.quad ? this.T.height / this.scaleK : 1.4, w = this.quad ? 0.42 : 0.44;
    const blob = (rx, ry, rz, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat); m.scale.set(rx, ry, rz); m.position.set(x, y, z); g.add(m); return m; };
    blob(w, h * 0.5, w * 0.9, 0, h * 0.5, 0);                                   // the main coat
    if (!this.quad) { blob(w * 0.62, h * 0.17, w * 0.62, 0, h * 0.92, 0); blob(w * 0.4, h * 0.2, w * 0.4, w * 0.9, h * 0.62, 0); blob(w * 0.4, h * 0.2, w * 0.4, -w * 0.9, h * 0.62, 0); }   // head and arms
    else blob(w * 0.55, h * 0.3, w * 0.55, 0, h * 0.7, -w * 0.9);               // an animal's head
    blob(w * 1.7, 0.035, w * 1.7, 0, 0.03, 0);                                  // the puddle
    for (const [x, z, s] of [[0.2, 0.3, 1], [-0.25, 0.2, 0.7], [0.05, -0.35, 0.85]]) blob(0.05 * s, 0.14 * s, 0.05 * s, x * w * 2, h * 0.28, z * w * 2);   // drips
    this.mesh.add(g);
  }

  // Is the player in front of it (within about 60 degrees of where it faces)? Used for shields and guards.
  facesPlayer(p) {
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
    return (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d > 0.5;
  }

  // Start a status. The boss cannot be stunned (only a parry staggers it). Returns whether it took hold.
  addStatus(n, dur) {
    if (n === 'stun' && (this.boss || this.T.noStagger)) return false;
    if (n === 'bleed' && this.T.resistBleed) return false;
    const ok = this.st.apply(n, dur);
    if (ok && n === 'stun') { this.stun = Math.max(this.stun, dur || STATUS.stun.dur); this.winding = false; }
    return ok;
  }

  // A sleep wand: it drops to unaware, blind and deaf, for sec seconds or until it is damaged. Bosses never sleep.
  sleep(sec) {
    if (this.boss || this.dead) return false;
    this.sleepT = sec; this.winding = false; this.stun = 0; this.rageT = 0;
    this.set('unaware'); this.aware = 0; this.last = null; this.seen = false;
    return true;
  }

  // Hanahan's Rage: for dur seconds it hunts the nearest other enemy and ignores the player, then comes looking
  // for where the recording was played. Bosses are immune.
  enrage(dur, fx, fz) {
    if (this.boss || this.dead) return false;
    this.rageT = dur; this.rageFrom = { x: fx, z: fz }; this.rageTarget = null;
    this.sleepT = 0; this.winding = false; this.stun = 0;
    this.set('alerted'); this.shouted = true;
    return true;
  }

  // A thief runs to the room farthest from the player.
  startFlee(player) {
    let best = null, bd = -1;
    for (const r of this.floor.rooms) { if (r.locked || r.theme === 'shop') continue; const d = Math.hypot((r.cx + 0.5) * TILE - player.x, (r.cy + 0.5) * TILE - player.z); if (d > bd) { bd = d; best = r; } }
    this.fleeTo = best ? { x: (best.cx + 0.5) * TILE, z: (best.cy + 0.5) * TILE } : null;
    this.fleeT = 9; this.winding = false;
  }

  // The sack thief, once it has noticed you (or been hurt): it never fights. Every QUESTS.thief.think seconds it floods the floor's
  // path distances from you and from itself (two shared BFS, no allocation) and picks the open spot (a room centre, or beside the
  // stairs) that it can reach before you, farthest from you; goTo then walks there (goTo re-paths only when the goal moves or twice a
  // second). No such spot means a dead end: it cowers (stops and faces you). Reaching the stairs while running it escapes.
  updateFleer(dt, player) {
    const F = this.floor, Q = QUESTS.thief, T = TILE, w = F.w;
    if (!this.cower && Math.hypot(this.x - (F.stairs.x + 0.5) * T, this.z - (F.stairs.y + 0.5) * T) < Q.escapeDist) { this.escape(); return; }
    if ((this.fre -= dt) <= 0) {
      this.fre = Q.think;
      if (!F.fleeSpots) {                                                                 // once per floor: the open tile at each ordinary room's centre, and one beside the stairs
        F.fleeSpots = [];
        for (const r of F.rooms) if (!r.locked && r.theme !== 'shop') { const i = r.cy * w + r.cx, p = F.tiles[i] === T_FLOOR && !F.blocked[i] ? { x: r.cx, y: r.cy } : nearPoint(F, r.cx, r.cy, 0); F.fleeSpots.push({ x: p.x, y: p.y, stairs: false }); }
        const sp = nearPoint(F, F.stairs.x, F.stairs.y, 0); F.fleeSpots.push({ x: sp.x, y: sp.y, stairs: true });
        F.fleeA = new Int32Array(w * F.h); F.fleeB = new Int32Array(w * F.h);
      }
      const A = F.fleeA, B = F.fleeB, spots = F.fleeSpots;
      floodDist(F, Math.floor(player.x / T), Math.floor(player.z / T), A);
      floodDist(F, Math.floor(this.x / T), Math.floor(this.z / T), B);
      let best = -1, bs = -1e9, cur = -1e9;
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i], k = s.y * w + s.x, dp = A[k], dm = B[k];
        if (dp < 0 || dm < 0 || dm <= 1 || dm > dp) continue;                             // unreachable, already here, or the player gets there first
        const sc = dp + (s.stairs ? Q.stairsBonus : 0);
        if (i === this.fgoal) cur = sc;
        if (sc > bs) { bs = sc; best = i; }
      }
      if (best >= 0 && cur > -1e9 && bs < cur + Q.keep) best = this.fgoal;               // keep the old goal unless the new one is clearly better
      this.fgoal = best; this.cower = best < 0;
    }
    if (this.cower) this.yaw = turnToward(this.yaw, Math.atan2(-(player.x - this.x), -(player.z - this.z)), 5 * dt);
    else { const g = F.fleeSpots[this.fgoal]; this.goTo((g.x + 0.5) * T, (g.y + 0.5) * T, this.chase, dt); }
    if (this.seen) this.lostT = 0;
    else if ((this.lostT += dt) > Q.giveUp) { this.aware = 0; this.last = null; this.fgoal = -1; this.cower = false; this.fre = 0; this.set('unaware'); }   // lost you: back to wandering
  }
  escape() {
    this.escaped = true; this.dead = true; this.corpseDone = true; this.winding = false; this.icon.visible = false; this.cone.visible = false;
    if (Enemy.escaped) Enemy.escaped(this);                                               // js/quests.js: message and quest state
  }

  // Archers and shamans: keep their distance, aim at you while they draw or chant, then loose an arrow or a hex.
  // A shaman heals a badly hurt ally in sight before it attacks.
  updateRanged(dt, player, noise, dist, los, dx, dz) {
    const R = this.T.ranged;
    this.atkCd -= dt; this.healCd -= dt;
    if (this.winding) {
      this.windT += dt;
      const tgt = this.cast === 'heal' && this.castTarget ? this.castTarget : player;
      this.yaw = turnToward(this.yaw, Math.atan2(-(tgt.x - this.x), -(tgt.z - this.z)), 5 * dt);
      if (this.windT >= this.windT_) {
        this.winding = false;
        if (this.cast === 'heal') {
          const a = this.castTarget;
          if (a && !a.dead) { a.hp = Math.min(a.maxHp, a.hp + R.healAmt); a.healFx = 0.7; noise.emit(this.x, this.z, 3, this); }
          this.healCd = R.healCd; this.atkCd = Math.max(this.atkCd, 1);
        } else { this.atkCd = R.cd; this.fire(noise, R); }
        this.cast = null; this.castTarget = null;
      }
      return;
    }
    if (R.healAt && this.healCd <= 0) {
      const ally = nearestOther(this, Enemy.all, R.healR, o => o.boss || o.hp >= o.maxHp * R.healAt || !hasLOS(this.floor, this.x, this.z, o.x, o.z));
      if (ally) { this.winding = true; this.windT = 0; this.cast = 'heal'; this.castTarget = ally; this.zone = 'shoot'; return; }
    }
    if (this.seen && los && dist < R.min) {                                  // too close: back away, still facing you
      this.goTo(this.x - dx / dist * 4, this.z - dz / dist * 4, this.chase, dt);
      this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 9 * dt);
    } else if (!this.seen || !los || dist > R.max) {
      if (this.goTo(this.last.x, this.last.z, this.chase, dt) < 0.8 && !this.seen) this.lostT += dt;
    } else this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 7 * dt);
    if (!this.seen) this.lostT += dt * 0.5;
    if (this.seen && los && dist <= R.max && this.atkCd <= 0) { this.winding = true; this.windT = 0; this.cast = null; this.zone = 'shoot'; }
    if (this.lostT > 3) { this.aware = 0.6; this.set('searching'); }
  }
  fire(noise, R) {
    noise.shoot({ from: this, kind: R.kind, x: this.x, y: 1.35 * this.scaleK, z: this.z, speed: R.speed });
    noise.emit(this.x, this.z, R.kind === 'arrow' ? 4 : 2, this);
  }

  // A bomb goblin rushes where it last saw you and blows up on reaching about 1.5 m (or when the fuse ends, see update).
  updateBomber(dt, dist, los) {
    if (this.seen && los && dist < BOMB.trigger) { this.blow(); return; }
    if (this.goTo(this.last.x, this.last.z, this.chase, dt) < 0.8 && !this.seen) this.lostT += dt;
    if (!this.seen) this.lostT += dt * 0.5;
    if (this.lostT > 3) { this.aware = 0.6; this.set('searching'); }
  }

  updateRage(dt, noise) {
    this.rageT -= dt;
    if (this.rageT <= 0) {                                              // calm again, and curious about the noise
      this.rageT = 0; this.rageTarget = null; this.winding = false; this.shouted = false;
      this.last = this.rageFrom; this.aware = 0.6; this.set('suspicious');
      this.sync(dt); return null;
    }
    if (!this.rageTarget || this.rageTarget.dead) {
      this.rageTarget = nearestOther(this, Enemy.all, 30);
      const al = Enemy.ally;                                            // the player's ally (js/quests.js) is a fair target too
      if (al && !al.dead && al.floor === this.floor && Math.hypot(al.x - this.x, al.z - this.z) < (this.rageTarget ? Math.hypot(this.rageTarget.x - this.x, this.rageTarget.z - this.z) : 30)) this.rageTarget = al;
    }
    const t = this.rageTarget;
    if (!t) { this.lookAround(dt); this.sync(dt); return null; }
    return this.fightOther(t, dt, noise);
  }

  // Melee against another creature t (an enemy under Rage, an enemy fighting the player's ally, or the ally itself fighting an enemy), with the guard's own
  // numbers: walk up, wind-up, strike with the zone armour of t. Always returns null (it never hits the player).
  fightOther(t, dt, noise) {
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz) || 0.001;
    if (this.T.bomb) {                                                  // under Rage a bomb goblin rushes the other enemies
      if (dist < BOMB.trigger) { this.blow(); return null; }
      this.goTo(t.x, t.z, this.chase, dt); this.sync(dt); return null;
    }
    this.atkCd -= dt;
    if (this.winding) {
      this.windT += dt;
      if (this.windT < this.windT_) this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 4 * dt);
      if (this.windT >= this.windT_ + STRIKE_T) {
        this.winding = false; this.atkCd = this.cooldown;
        noise.emit(this.x, this.z, CLASH_R, this);
        if (dist <= this.reach + 0.5) {                                 // the blow lands on the other enemy
          const zone = this.zone, dmg = TUNE.enemyDmg * this.dmgMul * ZONE_MUL[zone] * (t.resist[zone] || 1);
          if (t.hurt(dmg, this)) t.cause = this.isAlly ? 'was cut down by the ally' : t.isAlly ? 'killed the ally' : 'was beaten down by its own side';
          else if (this.isAlly) { if (!t.boss) t.foe = this; }                                                       // the ally's target fights back
          else if (this.rageT > 0 && !t.isAlly && t.rageT <= 0 && t.enrage(this.rageT, this.rageFrom.x, this.rageFrom.z)) t.rageTarget = this;   // and it hits back
        }
      }
    } else {
      if (dist > this.reach * 0.8) this.goTo(t.x, t.z, this.chase, dt); else this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 7 * dt);
      if (dist < this.reach && this.atkCd <= 0) { this.winding = true; this.windT = 0; this.zone = pickZone(this.T.zones); }
    }
    this.sync(dt); return null;
  }

  // Returns true if the enemy died from this hit.
  hurt(dmg, player) {
    if (this.foe && player && !player.T) this.foe = null;                      // hit by the player (or a blast): back to fighting the player
    this.hp -= dmg; this.hitT = 0.14; this.sleepT = 0; if (!this.boss) { if (this.T.mimic && this.dormant) this.wake(false, player); this.dormant = false; }
    if (this.hp <= 0) { this.die(); return true; }
    if (!this.boss && !this.T.noStagger) { this.stun = 0.35; this.winding = false; }     // the boss and the bouncer shrug hits off (only a parry staggers them)
    this.last = { x: player.x, z: player.z };
    if (this.state !== 'alerted') this.set('alerted');
    return false;
  }

  // noise: { r } radius of what the player is making right now.
  // Returns the zone ('head' | 'body' | 'legs') of an attack that lands this frame, else null.
  update(dt, player, noise) {
    if (this.dead) { this.deadT += dt; this.sync(dt); return null; }
    const bleed = this.st.update(dt);
    if (bleed > 0) { this.hp -= bleed; if (this.hp <= 0) { this.cause = 'bled out'; this.die(); this.sync(dt); return null; } }   // bled out: main.js leaves the body
    if (this.T.mimic && this.dormant) { this.sync(dt); return null; }                // a chest until it is searched or hit
    if (this.sleepT > 0) { this.sleepT -= dt; this.aware = 0; this.seen = false; this.sync(dt); return null; }
    if (this.fuse > 0 && (this.fuse -= dt) <= 0) { this.blow(); this.sync(dt); return null; }   // the bomb's fuse burns whatever else it is doing (but not while asleep)
    if (this.rageT > 0) return this.updateRage(dt, noise);
    if (this.fleeT > 0 && this.stun <= 0) {                                    // a thief running off with your gold
      this.fleeT -= dt;
      if (this.fleeTo) this.goTo(this.fleeTo.x, this.fleeTo.z, 6.2, dt);
      if (this.fleeT <= 0) { this.set('unaware'); this.aware = 0; this.last = null; }
      this.sync(dt); return null;
    }
    const f = this.floor;
    const dx = player.x - this.x, dz = player.z - this.z, dist = Math.hypot(dx, dz) || 0.001;
    if (this.dormant) {   // the boss waits in the middle of the arena, a scarecrow stands in the field: both ignore sights and sounds until you are close
      if (dist >= (this.boss ? TUNE.bossWake : this.T.ambush * (player.crouching ? 0.4 : 1))) { this.sync(dt); return null; }   // creep up on a scarecrow and it wakes much later
      this.dormant = false; this.justWoke = true; this.last = { x: player.x, z: player.z }; this.set('alerted');
    }
    const los = hasLOS(f, this.x, this.z, player.x, player.z);
    let range = (player.crouching ? VIS_RANGE * 0.55 : player.sprinting ? VIS_RANGE * 1.25 : VIS_RANGE) * player.stealthMul * this.T.vis;
    const cosA = (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / dist;
    this.seen = los && dist < range && cosA > COS_HALF_FOV;
    // Smell (wolves): a moving player is noticed through walls and while crouching, but not a still one.
    if (!this.seen && this.T.smell && dist < this.T.smell && Math.hypot(player.vx, player.vz) > 0.4) { this.seen = true; range = this.T.smell; }

    if (this.seen) {
      this.aware = Math.min(1, this.aware + (0.6 + 1.6 * (1 - dist / range)) * (player.stealthMul < 1 ? 0.6 : 1) * dt);
      this.last = { x: player.x, z: player.z }; this.lostT = 0;
    } else if (this.state === 'unaware') this.aware = Math.max(0, this.aware - 0.25 * dt);
    else if (this.state === 'suspicious') this.aware = Math.max(0, this.aware - 0.08 * dt);

    // Noise events: { x, z, r, src }. Walls halve how far a sound carries; a guard ignores its own noise.
    if (this.state !== 'alerted') {
      for (const n of noise.events) {
        if (n.src === this) continue;
        const nd = Math.hypot(n.x - this.x, n.z - this.z);
        if (nd < n.r * this.T.hear * (hasLOS(f, this.x, this.z, n.x, n.z) ? 1 : HEAR_THROUGH_WALLS)) {
          this.aware = Math.max(this.aware, n.src && n.src.T && n.src.T.callAll ? 1 : 0.5);   // a captain's shout turns everyone alerted
          this.last = { x: n.x, z: n.z };
        }
      }
    }

    if (noise.prints && this.state !== 'alerted') this.followPrints(noise);   // fresh footprints in the snow: investigate them, newest first
    let attack = null;
    const hd = this.handlerRef;
    if (hd && !hd.dead && hd.state === 'alerted' && this.state !== 'alerted') { this.last = hd.last || { x: player.x, z: player.z }; this.aware = 1; }
    if (this.state !== 'alerted' && this.aware >= 1) this.set('alerted');
    if (this.state === 'alerted' && !this.shouted) { this.shouted = true; noise.emit(this.x, this.z, SHOUT_R * this.T.shout, this); }   // calls nearby guards
    if (this.state !== 'alerted') this.shouted = false;
    if (this.stun > 0) { this.stun -= dt; this.winding = false; this.sync(dt); return null; }

    if (this.foe) {                                                              // fighting the player's ally (set from js/quests.js on its think tick)
      const fo = this.foe;
      if (fo.dead || this.state !== 'alerted' || fo.floor !== this.floor || (this.seen && dist < 2.5 && dist < Math.hypot(fo.x - this.x, fo.z - this.z))) this.foe = null;   // the player stepping up closer than the ally takes its attention back
      if (this.foe) return this.fightOther(this.foe, dt, noise);
    }
    switch (this.state) {
      case 'unaware': {
        if (this.aware >= 0.35 && this.last) { this.set('suspicious'); break; }
        if (hd) {                                   // a wolf trots after its handler, and just waits if the handler is gone
          if (hd.dead) { this.lookAround(dt * 0.4); break; }
          if (Math.hypot(hd.x - this.x, hd.z - this.z) > 2.6) this.goTo(hd.x + 1.1, hd.z + 0.8, SPEED.patrol * 1.6, dt); else this.lookAround(dt * 0.4);
          break;
        }
        if (this.wait > 0) { this.wait -= dt; this.lookAround(dt * 0.4); break; }
        const p = this.route[this.ri];
        if (this.goTo(p.x, p.z, SPEED.patrol, dt) < 0.7) { this.ri = (this.ri + 1) % this.route.length; this.wait = 2; }
        break;
      }
      case 'suspicious': {
        if (this.wait > 0) {
          this.wait -= dt; this.lookAround(dt);
          if (this.wait <= 0) { this.aware = 0; this.last = null; this.set('unaware'); }
          break;
        }
        if (this.T.fleer || this.goTo(this.last.x, this.last.z, SPEED.investigate, dt) < 0.8) this.wait = 3;   // a thief never investigates toward you: it freezes and looks around instead
        break;
      }
      case 'alerted': {
        if (this.T.fleer) { this.updateFleer(dt, player); break; }
        if (this.T.ranged) { this.updateRanged(dt, player, noise, dist, los, dx, dz); break; }
        if (this.T.bomb) { this.updateBomber(dt, dist, los); break; }
        this.atkCd -= dt;
        if (this.T.thief && this.stolen) { this.startFlee(player); break; }       // already robbed you: run
        const C = this.st.has('stuck') ? null : this.T.charge;                         // a glued boar cannot charge
        if (C && !this.winding) {                                                  // a boar paws the ground, then charges in a straight line
          if (this.chargeT > 0) {
            this.chargeT -= dt;
            const nx = this.x + this.cdx * C.speed * dt, nz = this.z + this.cdz * C.speed * dt;
            collider.props = this.floor.solids;
            if (!Player.prototype.blocked.call(collider, this.floor, nx, nz)) { this.x = nx; this.z = nz; this.walkT += C.speed * dt * 5; } else this.chargeT = 0;
            this.yaw = Math.atan2(-this.cdx, -this.cdz);
            if (Math.hypot(player.x - this.x, player.z - this.z) < 1.15) { this.chargeT = 0; this.atkCd = 1.8; this.zone = 'legs'; this.hitMul = C.dmgMul; attack = 'legs'; noise.emit(this.x, this.z, CLASH_R, this); }
            break;
          }
          if (this.chargeWind > 0) {
            this.chargeWind -= dt; this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 6 * dt);
            if (this.chargeWind <= 0) { const d = Math.hypot(player.x - this.x, player.z - this.z) || 1; this.cdx = (player.x - this.x) / d; this.cdz = (player.z - this.z) / d; this.chargeT = 1.1; }
            break;
          }
          if (this.seen && los && dist >= C.min && dist <= C.max && this.atkCd <= 0) { this.chargeWind = C.wind; break; }
        }
        if (this.winding) {
          this.windT += dt;
          if (this.windT < this.windT_) this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 4 * dt);   // locked once the swing starts
          if (this.windT >= this.windT_ + STRIKE_T) {
            this.winding = false; this.atkCd = this.cooldown; const spr = this.windOvr; this.windOvr = 0;
            noise.emit(this.x, this.z, CLASH_R, this);                  // a fight is loud
            if (dist <= (spr ? MIMIC.springReach : this.reach + 0.5) && los) {   // no hits through a wall corner; the spring bite reaches whoever searched it
              if (this.T.thief) { if (noise.steal) noise.steal(this); this.stolen = true; this.startFlee(player); } else attack = this.zone;
            }
          }
          break;
        }
        if (dist > 1.0 || !this.seen) {
          if (this.goTo(this.last.x, this.last.z, this.chase, dt) < 0.8 && !this.seen) this.lostT += dt;
        } else this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 7 * dt);
        if (!this.seen) this.lostT += dt * 0.5;
        if (dist < this.reach && los && this.atkCd <= 0) { this.winding = true; this.windT = 0; this.zone = pickZone(this.T.zones); }
        if (this.lostT > 3) { this.aware = 0.6; this.set('searching'); }
        break;
      }
      case 'searching': {
        if (this.wait > 0) {
          this.wait -= dt; this.lookAround(dt);
          if (this.wait <= 0) { this.aware = 0; this.last = null; this.set('unaware'); }
          break;
        }
        if (this.goTo(this.last.x, this.last.z, SPEED.search, dt) < 0.8) this.wait = 4;
        break;
      }
    }
    this.sync(dt);
    return attack;
  }

  // The Frozen Chapel's footprints (js/main.js: floor.prints, a ring of 8 with ids that count up). A guard that is not alerted and can see a print newer than the last
  // one it followed, within pt.printSight metres and pt.printAge seconds old, turns suspicious and heads for it (and on to the next, newer one). No allocation unless it finds one.
  followPrints(noise) {
    const P = noise.prints, pt = noise.pt, f = this.floor;
    let best = null;
    for (let i = 0; i < P.list.length; i++) {
      const p = P.list[i];
      if (p.id <= this.printId || noise.t - p.t > pt.printAge || (best && p.id < best.id)) continue;
      if (Math.abs(p.x - this.x) > pt.printSight || Math.abs(p.z - this.z) > pt.printSight || Math.hypot(p.x - this.x, p.z - this.z) > pt.printSight) continue;
      best = p;
    }
    if (!best || !hasLOS(f, this.x, this.z, best.x, best.z)) return;
    this.printId = best.id; this.last = { x: best.x, z: best.z };
    this.aware = Math.max(this.aware, pt.printSusp);
    if (this.state === 'suspicious' || this.state === 'searching') { this.wait = 0; this.set('suspicious'); }
  }

  sync(dt) {
    const m = this.mesh;
    m.position.set(this.x, 0, this.z); m.rotation.y = this.yaw;
    this.shadow.visible = !this.dead && !this.T.mimic;                   // a chest casts no disc: that would give a mimic away
    if (this.dead && this.T.mimic) { this.lid.rotation.x = -1.0; if (!this.teeth.visible) this.showTeeth(); return; }   // the mimic stays put, lid hanging open
    if (this.dead) {   // tip over backward, then stay down
      const k = Math.min(1, this.deadT / 0.4);
      m.rotation.x = k * Math.PI / 2; m.position.y = k * 0.18;
      return;
    }
    if (this.quad) this.poseQuad(dt);
    else {
    const sw = Math.sin(this.walkT) * 0.6;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;

    // Target pose: [upper x, upper y, right arm x, left arm x, dip].
    // Alerted guards hold the club forward; a staggered one rocks back; an attack goes
    // raise (zone readable) -> strike (fast) -> recover, using ATTACK_POSES.
    const target = TARGET_POSE;   // a shared scratch array, filled each call (no per-frame arrays)
    let snap = false;
    if (this.dormant && this.T.ambush) setPose(target, 0, 0, 1.57, 1.57, 0);                // a scarecrow stands with its arms out
    else setPose(target, 0, 0, this.state === 'alerted' ? 0.7 : sw * 0.8, -sw * 0.8, 0);
    if (this.stun > 0) setPose(target, 0.35, 0, -0.3, -0.3, 0);
    else if (this.winding) {
      const A = ATTACK_POSES[this.zone][0], B = ATTACK_POSES[this.zone][1], w = this.windT_;
      if (this.windT < w) {
        const k = easeInOut(Math.min(1, this.windT / (w * 0.75)));
        for (let i = 0; i < 5; i++) target[i] = A[i] * k;
      } else {
        const s = 1 - Math.pow(1 - Math.min(1, (this.windT - w) / STRIKE_T), 2);
        for (let i = 0; i < 5; i++) target[i] = A[i] + (B[i] - A[i]) * s;
        snap = true;
      }
    }
    const e = snap ? 1 : 1 - Math.exp(-14 * dt);
    for (let i = 0; i < 5; i++) this.pose[i] += (target[i] - this.pose[i]) * e;
    const p = this.pose;
    this.upper.rotation.x = p[0]; this.upper.rotation.y = p[1]; this.upper.position.y = 0.7 - p[4];
    this.arms[1].rotation.x = p[2]; this.arms[0].rotation.x = p[3];
    }
    if (this.st.has('stuck') && !this.goo) this.buildGoo();
    m.rotation.x = this.sleepT > 0 ? 0.35 : 0;                                                              // slumped while asleep
    if (this.T.sway && !this.stun) m.rotation.z = Math.sin(this.walkT * 0.5 + this.seed) * (this.state === 'alerted' ? 0.04 : 0.1);   // a drunk's roll
    // hit flash
    this.hitT = Math.max(0, this.hitT - dt); this.healFx = Math.max(0, this.healFx - dt);
    let warn = false;
    if (this.spark) {                                                                                        // the fuse fizzes; in the last 0.8 s it flashes red and the spark flares
      warn = this.fuse > 0 && this.fuse < BOMB.warn && ((this.fuse * 14) | 0) % 2 === 0;
      this.spark.scale.setScalar(warn ? 2.4 : 0.8 + 0.5 * Math.sin(performance.now() / 40 + this.seed));
      this.spark.material.color.setHex(warn ? 0xffffff : 0xffa030);
    }
    const fl = this.hitT > 0 ? 0xaa2010 : this.healFx > 0 ? 0x1a6a2a : this.rageT > 0 ? 0x701010 : warn ? 0xdd3a10 : this.st.tint();
    for (let i = 0; i < this.mats.length; i++) this.mats[i].emissive.setHex(fl || (this.baseEm ? this.baseEm[i] : 0));

    const show = this.state !== 'unaware' || this.aware > 0.2;
    this.icon.visible = show;
    if (show) {
      const alerted = this.state === 'alerted';
      this.icon.material.map = alerted ? ICONS.a : this.state === 'searching' ? ICONS.s : ICONS.q;
      this.icon.material.opacity = alerted ? 1 : 0.35 + 0.65 * this.aware;
      this.icon.scale.setScalar((alerted ? 0.9 : 0.5 + 0.3 * this.aware) * (this.quad ? 1 / this.scaleK : 1));
    }
    if (this.cone.visible) this.cone.material.color.setHex(this.state === 'alerted' ? 0xff4030 : this.state === 'unaware' ? 0xffd23a : 0xff9a30);
  }
}

Enemy.all = [];   // the current floor's enemies (set by main.js), for rage targeting
Enemy.ally = null;   // the player's live ally, if any (js/quests.js): Rage may pick it as a target
