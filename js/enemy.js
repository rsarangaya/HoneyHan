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
const ATTACK_RANGE = 1.4;            // hp, damage, windup and cooldown live in TUNE (combat.js)
const pickZone = w => { const r = Math.random() * (w[0] + w[1] + w[2]); return r < w[0] ? 'head' : r < w[0] + w[1] ? 'body' : 'legs'; };

const wallAt = (floor, tx, ty) => tx < 0 || ty < 0 || tx >= floor.w || ty >= floor.h || floor.tiles[ty * floor.w + tx] === T_WALL || floor.tiles[ty * floor.w + tx] === T_DOOR;

function hasLOS(floor, x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (wallAt(floor, Math.floor((x0 + (x1 - x0) * t) / TILE), Math.floor((z0 + (z1 - z0) * t) / TILE))) return false;
  }
  return true;
}

// 4-way BFS over open tiles (the stairwell tile is off limits). Returns tiles after the start tile.
function findPath(floor, sx, sy, tx, ty) {
  const { w, h } = floor, st = floor.stairs;
  const blocked = (x, y) => wallAt(floor, x, y) || (x === st.x && y === st.y) || floor.blocked[y * w + x] === 1;
  if (blocked(tx, ty)) {   // target is inside furniture or the stairwell: aim for an open tile beside it instead
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !blocked(tx + dx, ty + dy));
    if (!side) return [];
    tx += side[0]; ty += side[1];
  }
  const prev = new Int32Array(w * h).fill(-1);
  const q = [sy * w + sx]; prev[q[0]] = q[0];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % w, y = (i / w) | 0;
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (blocked(nx, ny) || prev[ny * w + nx] >= 0) continue;
      prev[ny * w + nx] = i; q.push(ny * w + nx);
    }
  }
  if (prev[ty * w + tx] < 0) return [];
  const path = [];
  for (let i = ty * w + tx; i !== sy * w + sx; i = prev[i]) path.push({ x: i % w, y: (i / w) | 0 });
  return path.reverse();
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

const collider = { radius: 0.4, props: [] };   // borrows Player.blocked for wall collision

// Bodies are circles: push overlapping living guards apart (half each) and push guards out of the
// player. A guard pinned against a wall pushes the player instead. Runs once a frame after the guards move.
function separateBodies(enemies, player, floor) {
  collider.props = floor.solids;
  const free = (x, z) => !Player.prototype.blocked.call(collider, floor, x, z);
  const live = enemies.filter(e => !e.dead);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const min = a.r + b.r;
      if (d >= min) continue;
      if (d < 1e-4) { const k = (i * 7 + j * 13) % 628 / 100; dx = Math.cos(k); dz = Math.sin(k); d = 1; }   // exactly stacked: split in a fixed direction
      else { dx /= d; dz /= d; }
      const push = (min - Math.min(d, min)) / 2;
      if (free(a.x - dx * push, a.z - dz * push)) { a.x -= dx * push; a.z -= dz * push; }
      if (free(b.x + dx * push, b.z + dz * push)) { b.x += dx * push; b.z += dz * push; }
    }
    for (const e of live) {
      let dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      const min = e.r + player.radius;
      if (d >= min) continue;
      if (d < 1e-4) { dx = -Math.sin(player.yaw); dz = -Math.cos(player.yaw); d = 0; }   // dead centre: step the guard out in front
      else { dx /= d; dz /= d; }
      const push = min - d;
      if (free(e.x + dx * push, e.z + dz * push)) { e.x += dx * push; e.z += dz * push; }
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
    this.quad = this.T.model === 'quad' || this.T.model === 'float';   // floating things aim and animate like animals
    this.handlerRef = null;             // a wolf's goblin handler (linkHandlers in enemytypes.js)
    this.boss = !!spec.boss;            // big, hits harder, no stagger, and asleep until the player gets within TUNE.bossWake
    this.dormant = this.boss || !!this.T.ambush;   // the boss and scarecrows wait, as scenery, until you come close
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
    this.chargeWind = 0; this.chargeT = 0; this.cdx = 0; this.cdz = 0; this.hitMul = 1;   // boars
    this.sleepT = 0;                    // asleep (a sleep wand): sees and hears nothing, any damage wakes it
    this.rageT = 0; this.rageFrom = null; this.rageTarget = null;   // Hanahan's Rage: fights other enemies instead of the player
    this.cause = 'died';
    this.seed = spec.seed;
    this.hp = this.maxHp = this.boss ? TUNE.bossHp : TUNE.enemyHp * this.T.hpMul; this.stun = 0; this.hitT = 0;
    this.winding = false; this.windT = 0; this.zone = 'body';
    this.dead = false; this.deadT = 0;
    this.build();
  }

  build() {
    if (!ICONS) ICONS = { q: iconTexture('?', '#ffd23a'), s: iconTexture('?', '#ff8a2a'), a: iconTexture('!', '#ff3a3a') };
    // Every guard rolls its own look from its seed: skin and cloth colours, size, headgear
    // (iron helmet, hood or bare with a tuft), a vest, shoulder pads, a sack, and a club or cleaver.
    const rg = makeRng(this.seed || 1);
    const pal = arr => arr[Math.floor(rg() * arr.length)];
    const lam = c => new THREE.MeshLambertMaterial({ color: c });
    const skin = lam(this.spec.skin || this.T.skin || pal([0x5f8a3c, 0x6a9244, 0x557a3a, 0x7b8f40]));
    const dark = lam(new THREE.Color(skin.color).multiplyScalar(0.65).getHex());     // hands, ear tips, warts, brow
    const cloth = lam(pal([0x6a3f2a, 0x5a3a46, 0x3a4a5a, 0x5a5230]));
    const leather = lam(0x3a2616), metal = lam(0x8a8e96), bone = lam(0xe6e0c8), black = lam(0x120c08);
    this.mats = [skin, dark, cloth, leather, metal, bone, black];
    // Random kit: each piece is a real item (same classes and tiers the player finds). What the
    // guard wears is drawn on the model, soaks up damage in that zone, and is what it can drop.
    const tierOf = () => rollTier(typeof floorNum === 'number' ? floorNum : 1, rg);
    const piece = (slot, chance) => rg() < chance ? { type: 'armor', slot, cls: weighted(rg, [50, 35, 15]), tier: tierOf() } : null;
    const heavy = slot => ({ type: 'armor', slot, cls: 2, tier: 2 });          // the boss, captains and ice knights wear full plate (Rare)
    const plate = this.boss || this.T.heavy;
    const bare = this.T.noGear || this.quad;     // cooks and animals wear no armor
    const helmet = plate ? heavy('helmet') : bare ? null : piece('helmet', 0.4), vest = plate ? heavy('chest') : bare ? null : piece('chest', 0.4), boots = plate ? heavy('boots') : bare ? null : piece('boots', 0.35);
    const hood = !helmet && rg() < 0.4;
    const kind = this.boss ? 'mace' : this.T.weapon || (rg.pick ? rg.pick(['dagger', 'sword', 'mace']) : 'mace');
    this.weaponKind = kind;
    const weapon = { type: 'weapon', base: kind, tier: this.boss ? 3 : tierOf() };
    this.spdRoll = this.boss ? 0.7 : (WSTATS[kind].spd || 1) * (0.9 + rg() * 0.2);   // the guard's own attack speed stat: weapon spd x a small roll
    this.gear = this.quad ? [] : [helmet, vest, boots, weapon].filter(Boolean);   // animals carry nothing
    const cut = it => it ? Math.min(0.5, ARMOR_RED[it.cls] * TIERS[it.tier].mul) : 0;
    this.resist = { head: 1 - cut(helmet), body: 1 - cut(vest), legs: 1 - cut(boots) };
    const metalFor = it => lam(it.tier >= 2 ? TIERS[it.tier].color : [0x6a4a2a, 0x8a8e96, 0x5a5e66][it.cls]);   // leather, iron, dark plate; rare+ gear is tinted by tier
    const m = this.mesh = new THREE.Group();
    m.rotation.order = 'YXZ';          // yaw first, so falling over tips backward
    m.scale.setScalar(this.boss ? BOSS_SCALE : this.T.scale || 0.92 + rg() * 0.2);
    this.scaleK = m.scale.x;
    if (this.T.model === 'float') this.buildFloat(m, lam);
    else if (this.quad) this.buildQuad(m, lam);
    else {
    const box = (w, h, d, mat, x, y, z, parent) => { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
    this.legs = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 0.15, 0.7, 0);
      box(0.2, 0.7, 0.22, skin, 0, -0.35, 0, g);
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
    part(0.55, 0.7, 0.32, cloth, 0, 0.35, 0);                                                    // torso
    part(0.58, 0.08, 0.35, leather, 0, 0.1, 0);                                                  // belt
    part(0.1, 0.08, 0.02, metal, 0, 0.1, -0.18);                                                 // buckle
    part(0.46, 0.3, 0.05, cloth, 0, -0.04, -0.17);                                               // loincloth
    if (vest) {
      const vm = metalFor(vest);
      part(0.5, 0.38, 0.05, vm, 0, 0.45, -0.19); part(0.58, 0.05, 0.34, leather, 0, 0.62, 0);   // jerkin / chainmail / plate front
      if (vest.cls >= 1) part(0.58, 0.5, 0.06, vm, 0, 0.4, 0.18);                                  // back piece
      if (vest.cls === 2) for (const s of [-1, 1]) part(0.22, 0.12, 0.3, vm, s * 0.38, 0.72, 0);   // pauldrons
    }
    if (rg() < 0.6) part(0.28, 0.12, 0.28, leather, -0.38, 0.74, 0);                             // shoulder pad
    if (rg() < 0.5) { part(0.04, 0.12, 0.04, bone, 0.38, 0.86, -0.05); part(0.04, 0.1, 0.04, bone, 0.38, 0.84, 0.07); }   // bone spikes
    if (rg() < 0.4) { part(0.36, 0.3, 0.2, leather, 0, 0.4, 0.28); part(0.08, 0.06, 0.08, bone, 0, 0.58, 0.28); }       // loot sack on the back
    // head: heavy brow, pointed ears, tusks, a big nose and two angry eyes
    part(0.36, 0.34, 0.34, skin, 0, 0.88, 0);
    part(0.34, 0.06, 0.06, dark, 0, 0.99, -0.17);                                                // brow
    part(0.09, 0.13, 0.14, skin, 0, 0.84, -0.23);                                                // nose
    for (const s of [-1, 1]) {
      const ear = part(0.2, 0.07, 0.04, skin, s * 0.27, 0.95, 0); ear.rotation.z = s * 0.45;      // ears
      part(0.06, 0.05, 0.04, dark, s * 0.36, 1.0, 0);
      part(0.075, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: 0xffe060 }), s * 0.085, 0.935, -0.175);   // eyes
      part(0.03, 0.04, 0.02, new THREE.MeshBasicMaterial({ color: 0x000000 }), s * 0.085, 0.935, -0.186);    // pupils
      part(0.035, 0.08, 0.035, bone, s * 0.075, 0.77, -0.18);                                    // tusks
    }
    part(0.2, 0.03, 0.02, black, 0, 0.78, -0.175);                                               // mouth
    for (let i = 0; i < 2; i++) part(0.03, 0.03, 0.03, dark, (rg() - 0.5) * 0.25, 0.8 + rg() * 0.15, -0.175);   // warts
    if (helmet) {
      const hm = metalFor(helmet);
      if (helmet.cls === 0) { part(0.4, 0.12, 0.4, hm, 0, 1.07, 0); part(0.41, 0.05, 0.41, hm, 0, 1.0, 0); }   // leather cap
      else {
        part(0.4, 0.13, 0.4, hm, 0, 1.08, 0); part(0.41, 0.06, 0.41, hm, 0, 1.0, 0);
        part(0.04, 0.16, 0.03, hm, 0, 0.92, -0.2); part(0.05, 0.08, 0.05, leather, 0, 1.17, 0);              // dome, rim, nasal guard, crest
        if (helmet.cls === 2) { part(0.42, 0.3, 0.42, hm, 0, 0.95, 0); part(0.2, 0.04, 0.03, black, 0, 0.93, -0.22); part(0.06, 0.2, 0.06, bone, 0, 1.25, 0); }   // great helm: full face, visor slit, plume
      }
    } else if (hood) {
      part(0.41, 0.16, 0.41, cloth, 0, 1.06, 0); part(0.4, 0.34, 0.07, cloth, 0, 0.9, 0.2);
    } else part(0.1, 0.13, 0.26, black, 0, 1.1, 0);                                               // tuft
    this.arms = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 0.38, 0.68, 0);
      box(0.16, 0.6, 0.18, skin, 0, -0.3, 0, g);
      box(0.17, 0.14, 0.17, dark, 0, -0.64, 0, g);                                                // hand
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
      part(0.4, 0.09, 0.4, lam(0x8a1f1f), 0, 1.04, 0); part(0.1, 0.12, 0.05, lam(0x8a1f1f), 0.18, 0.99, 0.2);   // red bandana
      box(0.1, 0.3, 0.1, lam(0x2f6a3a), 0, -0.58, -0.1, this.arms[0]); box(0.06, 0.1, 0.06, lam(0x2f6a3a), 0, -0.4, -0.1, this.arms[0]);   // a bottle in the off hand
    } else if (this.type === 'archer') {
      part(0.42, 0.3, 0.42, lam(0x3a5a2a), 0, 1.04, 0); part(0.4, 0.34, 0.07, lam(0x3a5a2a), 0, 0.9, 0.2);                    // a green hood
      part(0.13, 0.42, 0.13, leather, 0.18, 0.55, 0.22); for (const x of [0.14, 0.19, 0.24]) part(0.03, 0.12, 0.03, bone, x, 0.8, 0.22);   // a quiver of arrows
    } else if (this.T.robe) {                                                                                                   // casters: shaman, scholar, warden, librarian, cultist
      const robe = lam(this.T.robe);
      part(0.6, 0.78, 0.38, robe, 0, 0.35, 0); part(0.64, 0.5, 0.38, robe, 0, -0.18, 0);                                          // a purple robe over the torso and down the legs
      part(0.44, 0.34, 0.44, robe, 0, 1.0, 0); part(0.4, 0.34, 0.07, robe, 0, 0.9, 0.2);                                          // a deep hood
      part(0.3, 0.06, 0.04, new THREE.MeshBasicMaterial({ color: this.T.orb || 0xb060ff }), 0, 0.9, -0.2);                                       // glowing eyes in the hood
    } else if (this.type === 'brute') {
      part(0.95, 0.24, 0.5, lam(0x4a3a28), 0, 0.64, 0);                                                                           // a fur mantle
      part(0.2, 0.2, 0.06, bone, 0, 0.12, -0.2);                                                                                  // a skull on the belt
      for (const s of [-1, 1]) { part(0.05, 0.2, 0.05, bone, s * 0.42, 0.9, 0); part(0.05, 0.14, 0.05, bone, s * 0.34, 0.9, 0.1); }  // shoulder spikes
    } else if (this.type === 'scarecrow') {
      part(0.55, 0.06, 0.55, lam(0x6a4a24), 0, 1.1, 0); part(0.3, 0.26, 0.3, lam(0x6a4a24), 0, 1.24, 0);          // a floppy hat
      part(0.08, 1.7, 0.08, lam(0x4a3018), 0, 0.2, 0.22);                                                          // the pole it is tied to
      for (const s of [-1, 1]) part(0.1, 0.22, 0.04, lam(0xe0c870), s * 0.3, 0.66, -0.17);                          // straw sticking out
    } else if (this.type === 'skeleton') {
      for (let i = 0; i < 3; i++) part(0.5, 0.04, 0.34, bone, 0, 0.25 + i * 0.14, 0);                              // ribs
      part(0.1, 0.1, 0.04, black, -0.08, 0.92, -0.18); part(0.1, 0.1, 0.04, black, 0.08, 0.92, -0.18);            // empty eye sockets
    } else if (this.type === 'thief') {
      part(0.42, 0.34, 0.42, lam(0x20302a), 0, 1.0, 0); part(0.4, 0.34, 0.07, lam(0x20302a), 0, 0.9, 0.2);        // a dark hood
      part(0.4, 0.2, 0.2, lam(0x6a4a2a), 0, 0.4, 0.25);                                                            // a swag bag
    } else if (this.type === 'captain') {
      part(0.08, 0.3, 0.1, lam(0xc02020), 0, 1.3, 0); part(0.4, 0.7, 0.06, lam(0xc02020), 0, 0.35, 0.22);         // a plume and a red cape
    } else if (this.type === 'iceknight') {
      for (const x of [-0.12, 0, 0.12]) part(0.05, 0.22, 0.05, lam(0xd8f0ff), x, 1.28, 0);                          // icicle crest
    } else if (this.type === 'golem') {
      for (const [x, y] of [[-0.12, 0.5], [0.15, 0.3], [0, 0.9]]) part(0.05, 0.16, 0.02, new THREE.MeshBasicMaterial({ color: 0xff8a30 }), x, y, -0.18);   // glowing cracks
    } else if (this.type === 'fungbrute') {
      for (const [x, y, z] of [[-0.4, 0.85, 0], [0.4, 0.8, 0.1], [0.1, 1.1, 0.1]]) { part(0.1, 0.12, 0.1, lam(0xd8c8f0), x, y, z); part(0.26, 0.08, 0.26, lam(0xa05ad0), x, y + 0.1, z); }   // mushrooms
    } else if (this.type === 'bouncer') {
      part(0.9, 0.22, 0.46, lam(0x202020), 0, 0.62, 0); part(0.7, 0.55, 0.38, lam(0x2a2a2e), 0, 0.38, 0);        // wide shoulders and a black jacket
      part(0.38, 0.1, 0.38, metal, 0, 0.76, 0);                                                                     // spiked collar
      for (const sx of [-0.3, -0.1, 0.1, 0.3]) part(0.05, 0.1, 0.05, bone, sx, 0.84, -0.18);
    }
    if (this.boss && this.spec.dress) {                                                                                           // each theme's boss has its own look
      const d = this.spec.dress, gold = lam(0xe8c040);
      if (d === 'innkeeper') { part(0.56, 0.7, 0.06, lam(0xf2efe6), 0, 0.35, -0.2); part(0.42, 0.26, 0.42, lam(0xf2efe6), 0, 1.3, 0); part(0.2, 0.2, 0.06, gold, 0, 0.2, -0.24); }
      else if (d === 'king') { part(0.4, 0.14, 0.4, gold, 0, 1.12, 0); for (const x of [-0.14, 0, 0.14]) part(0.06, 0.14, 0.06, gold, x, 1.24, 0); part(0.7, 0.9, 0.06, lam(0x8a2a2a), 0, 0.3, 0.22); }
      else if (d === 'golem') { for (const [x, y] of [[-0.15, 0.5], [0.18, 0.3], [0, 0.85], [-0.1, 0.1]]) part(0.06, 0.2, 0.02, new THREE.MeshBasicMaterial({ color: 0xff8a30 }), x, y, -0.19); part(0.7, 0.3, 0.5, lam(0x6a6a70), 0, 0.7, 0); }
      else if (d === 'fungus') { for (const [x, y, z] of [[-0.4, 0.9, 0], [0.4, 0.85, 0.1], [0.1, 1.2, 0.1], [-0.2, 1.15, 0.1]]) { part(0.14, 0.16, 0.14, lam(0xd8c8f0), x, y, z); part(0.34, 0.1, 0.34, lam(0xa05ad0), x, y + 0.12, z); } }
      else if (d === 'warlord') { part(0.4, 0.14, 0.4, gold, 0, 1.12, 0); for (const s of [-1, 1]) part(0.06, 0.3, 0.06, bone, s * 0.22, 1.28, 0); part(0.5, 0.6, 0.06, lam(0xa02020), 0, 0.45, 0.22); }
      else if (d === 'frost') { for (const x of [-0.18, -0.06, 0.06, 0.18]) part(0.06, 0.3, 0.06, lam(0xd8f0ff), x, 1.26, 0); for (const s of [-1, 1]) part(0.1, 0.35, 0.1, lam(0xd8f0ff), s * 0.4, 0.95, 0); }
    }
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
    const box = (w, h, d, mat, x, y, z, parent) => { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
    const body = this.body = new THREE.Group(); body.position.y = 0.5; m.add(body);
    box(0.4, 0.38, 0.9, fur, 0, 0.15, 0, body);                                  // torso
    box(0.3, 0.1, 0.8, belly, 0, -0.02, 0, body);                                // pale belly
    box(0.3, 0.28, 0.32, fur, 0, 0.3, -0.62, body);                              // head
    box(0.16, 0.13, 0.24, belly, 0, 0.23, -0.84, body);                          // snout
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
      const g = new THREE.Group(); g.position.set(sx * 0.15, 0.42, z); box(0.1, 0.42, 0.1, fur, 0, -0.21, 0, g); box(0.11, 0.05, 0.14, dark, 0, -0.42, -0.02, g); m.add(g); return g;
    });
    this.arms = [new THREE.Group(), new THREE.Group()];                          // unused, keeps shared code safe
    this.qp = [0, 0];                                                            // eased pose: [body pitch, lunge offset]
  }

  // Floating creatures (animated books, frost wisps): a body that hovers and bobs, with no legs.
  buildFloat(m, lam) {
    const T = this.T, c = new THREE.Color(T.fur);
    const glow = new THREE.MeshBasicMaterial({ color: c });
    this.mats = [lam(T.fur)];
    const body = this.body = new THREE.Group(); body.position.y = T.hover; m.add(body);
    const box = (w, h, d, mat, x, y, z, parent = body) => { const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); p.position.set(x, y, z); parent.add(p); return p; };
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
    if (this.T.hover) {                                                                                         // hover and flap
      this.body.position.y = this.T.hover + Math.sin(this.walkT * 0.25 + this.seed) * 0.08 + Math.sin(performance.now() / 400 + this.seed) * 0.06;
      if (this.wings) this.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.sin(performance.now() / 70 + this.seed) * 0.6; });
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

  get r() { return this.boss ? 0.65 : this.T.r; }   // body radius: guards keep this far apart and out of the player

  get atkSpd() { return TUNE.enemyAtkSpd * this.spdRoll; }
  get windT_() { if (this.T.ranged) return this.cast === 'heal' ? this.T.ranged.healWind : this.T.ranged.wind; return TUNE.windup / Math.sqrt(this.atkSpd) * (this.boss ? 1.35 : this.T.windMul); }   // wind-up shrinks slower than the cooldown so the zone stays readable; the boss telegraphs longer
  get reach() { return TUNE.enemyReach * (this.boss ? 1.4 : this.T.reach); }
  get chase() { return this.boss ? TUNE.bossSpeed : TUNE.chaseSpeed * this.T.speed; }
  get dmgMul() { return this.boss ? TUNE.bossDmgMul : this.T.dmgMul; }
  get cooldown() { return TUNE.enemyCooldown / this.atkSpd * this.T.cdMul; }

  lookAround(dt) { this.lookT += dt; this.yaw += Math.cos(this.lookT * 2.2) * 1.4 * dt; }

  set(state) { this.state = state; this.wait = 0; this.lookT = 0; this.rp = 0; if (state === 'alerted') { this.aware = 1; this.atkCd = 0.5; } }

  die() {
    this.dead = true; this.winding = false; this.chargeT = 0; this.chargeWind = 0; this.icon.visible = false; this.cone.visible = false;
    if (this.T.onDeath === 'spores' && Enemy.burst) Enemy.burst(this);   // a spore puffer bursts
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

  updateRage(dt, noise) {
    this.rageT -= dt;
    if (this.rageT <= 0) {                                              // calm again, and curious about the noise
      this.rageT = 0; this.rageTarget = null; this.winding = false; this.shouted = false;
      this.last = this.rageFrom; this.aware = 0.6; this.set('suspicious');
      this.sync(dt); return null;
    }
    if (!this.rageTarget || this.rageTarget.dead) this.rageTarget = nearestOther(this, Enemy.all, 30);
    const t = this.rageTarget;
    if (!t) { this.lookAround(dt); this.sync(dt); return null; }
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz) || 0.001;
    this.atkCd -= dt;
    if (this.winding) {
      this.windT += dt;
      if (this.windT < this.windT_) this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), 4 * dt);
      if (this.windT >= this.windT_ + STRIKE_T) {
        this.winding = false; this.atkCd = this.cooldown;
        noise.emit(this.x, this.z, CLASH_R, this);
        if (dist <= this.reach + 0.5) {                                 // the blow lands on the other enemy
          const zone = this.zone, dmg = TUNE.enemyDmg * this.dmgMul * ZONE_MUL[zone] * (t.resist[zone] || 1);
          if (t.hurt(dmg, this)) t.cause = 'was beaten down by its own side';
          else if (t.rageT <= 0 && t.enrage(this.rageT, this.rageFrom.x, this.rageFrom.z)) t.rageTarget = this;   // and it hits back
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
    this.hp -= dmg; this.hitT = 0.14; this.sleepT = 0; if (!this.boss) this.dormant = false;
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
    if (this.sleepT > 0) { this.sleepT -= dt; this.aware = 0; this.seen = false; this.sync(dt); return null; }
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

    let attack = null;
    const hd = this.handlerRef;
    if (hd && !hd.dead && hd.state === 'alerted' && this.state !== 'alerted') { this.last = hd.last || { x: player.x, z: player.z }; this.aware = 1; }
    if (this.state !== 'alerted' && this.aware >= 1) this.set('alerted');
    if (this.state === 'alerted' && !this.shouted) { this.shouted = true; noise.emit(this.x, this.z, SHOUT_R * this.T.shout, this); }   // calls nearby guards
    if (this.state !== 'alerted') this.shouted = false;
    if (this.stun > 0) { this.stun -= dt; this.winding = false; this.sync(dt); return null; }

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
        if (this.goTo(this.last.x, this.last.z, SPEED.investigate, dt) < 0.8) this.wait = 3;
        break;
      }
      case 'alerted': {
        if (this.T.ranged) { this.updateRanged(dt, player, noise, dist, los, dx, dz); break; }
        this.atkCd -= dt;
        if (this.T.thief && this.stolen) { this.startFlee(player); break; }       // already robbed you: run
        const C = this.T.charge;
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
            this.winding = false; this.atkCd = this.cooldown;
            noise.emit(this.x, this.z, CLASH_R, this);                  // a fight is loud
            if (dist <= this.reach + 0.5 && los) {                       // no hits through a wall corner
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

  sync(dt) {
    const m = this.mesh;
    m.position.set(this.x, 0, this.z); m.rotation.y = this.yaw;
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
    let target = [0, 0, this.state === 'alerted' ? 0.7 : sw * 0.8, -sw * 0.8, 0];
    if (this.dormant && this.T.ambush) target = [0, 0, 1.57, 1.57, 0];                // a scarecrow stands with its arms out
    let snap = false;
    if (this.stun > 0) target = [0.35, 0, -0.3, -0.3, 0];
    else if (this.winding) {
      const [A, B] = ATTACK_POSES[this.zone], w = this.windT_;
      if (this.windT < w) {
        const k = easeInOut(Math.min(1, this.windT / (w * 0.75)));
        target = A.map(v => v * k);
      } else {
        const s = 1 - Math.pow(1 - Math.min(1, (this.windT - w) / STRIKE_T), 2);
        target = A.map((v, i) => v + (B[i] - v) * s);
        snap = true;
      }
    }
    const e = snap ? 1 : 1 - Math.exp(-14 * dt);
    for (let i = 0; i < 5; i++) this.pose[i] += (target[i] - this.pose[i]) * e;
    const p = this.pose;
    this.upper.rotation.x = p[0]; this.upper.rotation.y = p[1]; this.upper.position.y = 0.7 - p[4];
    this.arms[1].rotation.x = p[2]; this.arms[0].rotation.x = p[3];
    }
    m.rotation.x = this.sleepT > 0 ? 0.35 : 0;                                                              // slumped while asleep
    if (this.T.sway && !this.stun) m.rotation.z = Math.sin(this.walkT * 0.5 + this.seed) * (this.state === 'alerted' ? 0.04 : 0.1);   // a drunk's roll
    // hit flash
    this.hitT = Math.max(0, this.hitT - dt); this.healFx = Math.max(0, this.healFx - dt);
    for (const mat of this.mats) mat.emissive.setHex(this.hitT > 0 ? 0xaa2010 : this.healFx > 0 ? 0x1a6a2a : this.rageT > 0 ? 0x701010 : this.st.tint());

    const show = this.state !== 'unaware' || this.aware > 0.2;
    this.icon.visible = show;
    if (show) {
      const alerted = this.state === 'alerted';
      this.icon.material.map = alerted ? ICONS.a : this.state === 'searching' ? ICONS.s : ICONS.q;
      this.icon.material.opacity = alerted ? 1 : 0.35 + 0.65 * this.aware;
      this.icon.scale.setScalar((alerted ? 0.9 : 0.5 + 0.3 * this.aware) * (this.quad ? 1 / this.scaleK : 1));
    }
    this.cone.material.color.setHex(this.state === 'alerted' ? 0xff4030 : this.state === 'unaware' ? 0xffd23a : 0xff9a30);
  }
}

Enemy.all = [];   // the current floor's enemies (set by main.js), for rage targeting
