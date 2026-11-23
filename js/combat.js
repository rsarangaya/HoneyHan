// Melee tables and hit-zone helpers (stage 4 of the build order). All numbers are untested guesses.
const ZONE_MUL = { head: 1.75, body: 1.0, legs: 0.65 };
// Global combat numbers, editable live from the dev tuning panel (js/tune.js).
const TUNE = {
  enemyHp: 55, enemyDmg: 13, floorHpScale: 0.12, floorDmgScale: 0.06, windup: 0.35, enemyCooldown: 0.6,
  enemyAtkSpd: 1.68,                   // attack speed stat: x its weapon's spd. Cooldown / this, wind-up / sqrt(this)
  enemyReach: 1.7,                    // how close an alerted guard must be to start a swing
  chaseSpeed: 5.0,                    // alerted guards run faster than a sprinting player
  playerAtkSpd: 1,                    // attack speed stat: x the weapon's spd. Swing time / this
  walkSpeed: 3.0, sprintSpeed: 4.6, crouchSpeed: 1.4,
  enemyTurnAlert: 12,                  // rad/s a guard turns in EVERY state (walking, patrol look-around, searching, alerted); wind-up and charge telegraphs stay slower on purpose
  patrolSpeed: 1.1,                   // unaware patrol pace: slower than a crouching player (1.4), so a sneaker can catch up
  patrolWaitMin: 3, patrolWaitMax: 7, patrolRestChance: 0.25, patrolRestMin: 8, patrolRestMax: 12,   // seconds a guard stands at a waypoint; sometimes a long rest
  bossHp: 220, bossDmgMul: 1.4,       // the boss wears Rare plate, so its real toughness is higher than its HP
  bossWake: 12,                       // metres: the boss stays asleep until you are this close
  bossSpeed: 4.2,                     // a sprinting player (4.6) can outrun it
  bossWindMul: 1.35, bossReachMul: 1.4, bossAtkSpd: 0.84, bossWeaponTier: 3,   // wind-up x (longer telegraph), reach x, own attack-speed stat, mace tier
  bossLegendary: 0.10,                // chance its guaranteed Epic drop upgrades to Legendary
  // Stages (js/main.js): per stage past the first, enemies get HP x (1 + stageHpScale) and damage x (1 + stageDmgScale) on top of the per-floor scaling;
  // stage bosses HP x (1 + stageBossHp) and damage x (1 + stageBossDmg). The final boss (the Cinder Wyrm) is the stage 1 boss x finalBossHp / finalBossDmg.
  // stageLootDepth: loot, shop and chest tiers use floor + this x (stage - 1).
  stageHpScale: 0.35, stageDmgScale: 0.20, stageBossHp: 0.5, stageBossDmg: 0.2, finalBossHp: 3.0, finalBossDmg: 1.8, stageLootDepth: 1.5,
  damageCap: 2,                       // zone multiplier cap, as in Test1
  staminaRegen: 28, staminaDelay: 0.8, sprintDrain: 14,
  exhaustedAtkMul: 0.4,               // below a weapon's stamina cost you can still attack, but the swing, draw, bash recovery and zap recovery run at this speed (x2.5 time); stamina never goes below 0
  dashStam: 25, dashDist: 6, dashTime: 0.18, dashCd: 1.2, dashNoise: 10, dashFov: 9,   // the dash (js/main.js tryDash): stamina, metres, seconds, cooldown, noise metres, and the FOV kick in degrees
  respawnMin: 60, respawnSpan: 60,    // a killed guard is replaced after respawnMin + rnd * respawnSpan seconds (js/main.js updateRespawn)
  respawnMinDist: 24,                 // metres: a replacement appears at least this far from you (and out of sight)
  roomCapTiles: 15,                   // a room holds max(2, floor(area in tiles / this)) enemies at spawn (js/enemytypes.js spreadEnemies)
  parryRestore: 30, blockRefund: 0.5,   // stamina a parry gives back, and the fraction of a normal block's cost that comes back (rewards blocking)
};

// dmg: base damage. dur: swing time. hitAt: fraction of the swing where the hit lands.
// sneak: damage multiplier on an unaware enemy. parryWin: seconds after RMB that count as a parry.
// blockCost: stamina per blocked hit (0 means the weapon cannot block normally).
// spd: attack speed stat. Swing time is dur / (spd x the wielder's attack speed), so 1.35 swings 35% faster.
const WSTATS = {
  sword:  { proc: { zone: 'legs', status: 'cripple', chance: 0.25 }, dmg: 20, dur: 0.50, spd: 1.0,  hitAt: 0.45, reach: 2.3, stam: 12, sneak: 3,   noise: 6, parryWin: 0.20, blockCost: 15 },
  dagger: { proc: { zone: 'body', status: 'bleed', chance: 1 }, dmg: 12, dur: 0.30, spd: 1.35, hitAt: 0.40, reach: 1.8, stam: 7,  sneak: 99,  noise: 3, parryWin: 0.15, blockCost: 0 },
  mace:   { proc: { zone: 'head', status: 'stun', chance: 1, dur: 1.6 }, dmg: 32, dur: 0.85, spd: 0.8,  hitAt: 0.55, reach: 2.1, stam: 22, sneak: 2.5, noise: 8, parryWin: 0.0,  blockCost: 25 },
  // bow: dmg is a full-draw body hit (about 65% of a same-tier sword hit). draw: seconds to full draw. A sneak shot is x2.5.
  // Ian's Hog (Legendary only, one per run): a spear three times as long as the sword, with a sword's Legendary damage
  // (20 x 1.75). `kills`: it goes limp after that many kills and only a recharge wand stiffens it again.
  spear:  { kills: 3, dmg: 20, dur: 0.60, spd: 0.9,  hitAt: 0.50, reach: 6.9, stam: 14, sneak: 3,   noise: 5, parryWin: 0.0,  blockCost: 0 },
  bow:    { ranged: true, proc: { zone: 'legs', status: 'slow', chance: 1 }, dmg: 13, draw: 0.8, stam: 10, noise: 4, sneak: 2.5, parryWin: 0, blockCost: 0 },
};

const STAMINA_MAX = 100;

// Which part of an enemy the crosshair ray crosses at this distance. null = over or under it.
function aimZone(eyeY, pitch, dist, scale = 1) {
  const y = (eyeY + Math.tan(pitch) * dist) / scale;      // a big target (the boss) has its zones stretched
  if (y > 2.05 || y < -0.1) return null;
  return y > 1.4 ? 'head' : y > 0.7 ? 'body' : 'legs';
}

// Hitbox tuning for low and floating enemies (quad, float, mimic). Melee tolerance grows with distance because a level swing
// from eye height (1.6 m) passes over a wolf or rat; arrows are tighter. Biped bands are untouched.
const HIT = {
  meleeTop: 0.25, meleeTopPerM: 0.65, meleeBottom: -0.3,   // a swing hits up to height + top + perM x distance, down to bottom
  rangedTop: 0.15, rangedBottom: -0.05,                    // arrows and bolts
  legsFrac: 0.4,                                           // below this share of its height is the legs
  legsPitchDeg: 25,                                        // aiming down this steeply is always a leg hit
  floatBelow: 0.3, floatAbove: 0.5,                        // floating types: band is hover - below .. hover + height x above
  reachRadius: 0.5,                                        // share of the target's radius that counts toward melee reach
};

// Hit zone at height y for a low or floating enemy, or null (over or under it). d = melee distance (omit for arrows),
// pitch = the swinger's pitch (melee only). Pure: no globals besides HIT.
function quadZone(y, e, d, pitch) {
  const h = e.T.height, melee = d !== undefined, hover = e.T.model === 'float' ? e.T.hover || 0 : 0;
  if (hover) {
    if (y < hover - HIT.floatBelow || y > hover + h * HIT.floatAbove + (melee ? HIT.meleeTopPerM * d : 0)) return null;
    return y >= hover ? 'body' : 'legs';
  }
  const top = h + (melee ? HIT.meleeTop + HIT.meleeTopPerM * d : HIT.rangedTop), bottom = melee ? HIT.meleeBottom : HIT.rangedBottom;
  if (y > top || y < bottom) return null;
  if (melee && pitch !== undefined && pitch <= -HIT.legsPitchDeg * Math.PI / 180) return 'legs';
  return y < h * HIT.legsFrac ? 'legs' : 'body';
}

// Best living enemy in the swing cone, or null. Walls block the swing. Nearest candidate whose zone is not null wins;
// if none qualifies the nearest one is returned with zone null (aim off).
function findMeleeTarget(player, eyeY, enemies, floor, reach) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), tp = Math.tan(player.pitch);
  let best = null, bestD = 1e9, bestZ = null, near = null, nearD = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
    if (d - (e.r || 0) * HIT.reachRadius > reach + 0.3 || (d > 0.8 && (dx * fx + dz * fz) / d < 0.82)) continue;
    if (d >= bestD) continue;                                  // cannot beat the current pick (a null near one is tracked below)
    if (!hasLOS(floor, player.x, player.z, e.x, e.z)) continue;
    const y = eyeY + tp * d;
    const zone = e.quad ? quadZone(y, e, d, player.pitch) : e.boss && e.def && e.def.bands ? bossZone(y, e, d) : aimZone(eyeY, player.pitch, d, e.boss ? e.scaleK : e.T.scale || 1);
    if (zone) { best = e; bestD = d; bestZ = zone; }
    else if (d < nearD) { near = e; nearD = d; }
  }
  if (best) return { e: best, zone: bestZ, dist: bestD };
  return near ? { e: near, zone: null, dist: nearD } : null;
}

// ---- Procedural first-person weapon models (stand-ins until real art). Each weapon is a handful of MERGED geometries (one per material),
// built once per weapon id and shared: userData.shared keeps freeObject from disposing them, and the materials are shared too, so swapping
// weapons allocates and leaks nothing. Tier tint: a gem on the pommel / grip in the item's TIERS colour. Sizes: metres, the model's +y is the blade, +z is toward the player. ----
const WM_MATS = {}, WM_GEOS = {};
const wmMat = (key, make) => WM_MATS[key] || (WM_MATS[key] = Object.assign(make(), { userData: { shared: true } }));
const WM = {
  steel: () => wmMat('steel', () => new THREE.MeshPhongMaterial({ color: 0xc6ccd8, shininess: 110, specular: 0xe0e0e8, flatShading: true })),   // faceted metal that catches the lantern
  dark: () => wmMat('dark', () => new THREE.MeshPhongMaterial({ color: 0x4a4e58, shininess: 40, specular: 0x555560, flatShading: true })),
  leather: () => wmMat('leather', () => new THREE.MeshLambertMaterial({ color: 0x4a2c16 })),
  wood: () => wmMat('wood', () => new THREE.MeshPhongMaterial({ color: 0x7a5230, shininess: 14, specular: 0x222222 })),
  brass: () => wmMat('brass', () => new THREE.MeshPhongMaterial({ color: 0xd2a634, shininess: 70, specular: 0x886622 })),
  string: () => wmMat('string', () => new THREE.MeshLambertMaterial({ color: 0xe8e2c4 })),
  accent: t => wmMat('acc' + t, () => { const c = new THREE.Color(TIERS[t].color); return new THREE.MeshPhongMaterial({ color: c, emissive: c.clone().multiplyScalar(0.4), shininess: 90 }); }),
};
const wp = (g, x, y, z, rx, ry, rz, sx, sy, sz) => [g, partM(x, y, z, rx, ry, rz, sx, sy, sz)];     // a part: geometry + placement (partM, js/props.js)
const wgeo = (key, make) => WM_GEOS[key] || (WM_GEOS[key] = Object.assign(make(), { userData: { shared: true } }));
// A flat blade: bevelled hexagonal section (a bright flat between two edge bevels), half width w, half thickness t, narrowing to `taper` at the shoulder, then a point.
function bladeGeo(w, t, len, tip, taper) {
  const sec = [[-1, 0], [-0.5, 1], [0.5, 1], [1, 0], [0.5, -1], [-0.5, -1]], y1 = len - tip, P = [], n = sec.length;
  const ring = (y, k) => sec.map(([a, b]) => [a * w * k, y, b * t]), r0 = ring(0, 1), r1 = ring(y1, taper), apex = [0, len, 0];
  const tri = (a, b, c) => P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(r0[i], r0[j], r1[j]); tri(r0[i], r1[j], r1[i]); tri(r1[i], r1[j], apex); }
  for (let i = 1; i < n - 1; i++) tri(r0[0], r0[i + 1], r0[i]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;   // non-indexed: flat faces
}
// A leather-wrapped grip: a lathe with `n` raised wraps between y0 and y1.
function gripGeo(r, y0, y1, n) {
  const pts = [new THREE.Vector2(0, y0)]; for (let i = 0; i <= n * 2; i++) pts.push(new THREE.Vector2(r + (i % 2 ? 0.004 : 0), y0 + (y1 - y0) * i / (n * 2)));
  pts.push(new THREE.Vector2(0, y1)); return new THREE.LatheGeometry(pts, 8);
}
const wcyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg), wsph = (r, a = 8, b = 6) => new THREE.SphereGeometry(r, a, b);
// Per-weapon part lists, by material slot. Built once.
const WM_BUILD = {
  sword() {
    const blade = bladeGeo(0.042, 0.011, 0.82, 0.18, 0.72), full = new THREE.BoxGeometry(0.012, 0.5, 0.003);
    return {
      steel: [wp(blade, 0, 0.1, 0)],
      dark: [wp(full, 0, 0.4, 0.0125), wp(full, 0, 0.4, -0.0125)],                                                               // the fuller (a darker groove down each face)
      leather: [wp(gripGeo(0.024, -0.14, 0.085, 4), 0, 0, 0)],
      brass: [wp(wcyl(0.016, 0.016, 0.34, 6), 0, 0.1, 0, 0, 0, Math.PI / 2), wp(wsph(0.026, 6, 4), -0.17, 0.1, 0), wp(wsph(0.026, 6, 4), 0.17, 0.1, 0), wp(new THREE.BoxGeometry(0.07, 0.05, 0.05), 0, 0.1, 0), wp(wsph(0.04), 0, -0.16, 0)],   // crossguard with ball ends, pommel
      accent: [wp(wsph(0.02, 6, 4), 0, 0.1, 0.03), wp(wsph(0.018, 6, 4), 0, -0.16, 0.036)],
    };
  },
  dagger() {
    const blade = bladeGeo(0.03, 0.009, 0.36, 0.13, 0.8), full = new THREE.BoxGeometry(0.008, 0.2, 0.003);
    return {
      steel: [wp(blade, 0, 0.08, 0)],
      dark: [wp(full, 0, 0.2, 0.0095), wp(full, 0, 0.2, -0.0095)],
      leather: [wp(gripGeo(0.021, -0.1, 0.07, 4), 0, 0, 0)],
      brass: [wp(wcyl(0.013, 0.013, 0.15, 6), 0, 0.08, 0, 0, 0, Math.PI / 2), wp(wsph(0.018, 6, 4), -0.075, 0.08, 0), wp(wsph(0.018, 6, 4), 0.075, 0.08, 0), wp(wsph(0.03), 0, -0.12, 0)],
      accent: [wp(wsph(0.014, 6, 4), 0, -0.12, 0.026)],
    };
  },
  mace() {                                                                                  // spikes point along the 12 corners of an icosahedron
    const spike = new THREE.ConeGeometry(0.026, 0.1, 5), pos = new THREE.IcosahedronGeometry(1, 0).attributes.position, steel = [], seen = [], up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
    const spikeAt = (dx, dy, dz) => {                                                      // base on the head's surface, point outward
      d.set(dx, dy, dz).normalize(); q.setFromUnitVectors(up, d);
      steel.push([spike, new THREE.Matrix4().compose(new THREE.Vector3().copy(d).multiplyScalar(0.135).add(new THREE.Vector3(0, 0.72, 0)), q.clone(), new THREE.Vector3(1, 1, 1))]);
    };
    for (let i = 0; i < pos.count; i++) { const k = pos.getX(i).toFixed(2) + pos.getY(i).toFixed(2) + pos.getZ(i).toFixed(2); if (!seen.includes(k)) { seen.push(k); spikeAt(pos.getX(i), pos.getY(i), pos.getZ(i)); } }   // the 12 corners of an icosahedron
    return {
      wood: [wp(wcyl(0.022, 0.026, 0.8, 7), 0, 0.3, 0)],
      leather: [wp(gripGeo(0.03, -0.14, 0.2, 4), 0, 0, 0)],
      dark: [wp(new THREE.IcosahedronGeometry(0.1, 1), 0, 0.72, 0), wp(wcyl(0.075, 0.032, 0.07, 8), 0, 0.6, 0), wp(wcyl(0.05, 0.05, 0.02, 8), 0, 0.535, 0), wp(wcyl(0.044, 0.044, 0.02, 8), 0, 0.5, 0)],   // the ball, a flanged collar and two rings
      steel,
      brass: [wp(wsph(0.034), 0, -0.16, 0)],
      accent: [wp(wsph(0.016, 6, 4), 0, -0.16, 0.03), wp(wsph(0.014, 6, 4), 0, 0.535, 0.05)],
    };
  },
  bow() {                                                                                   // limbs curve away from the string; the string is the straight line between the nocks
    const pts = []; for (let i = -4; i <= 4; i++) { const t = i / 4; pts.push(new THREE.Vector3(0, 0.52 * t, -0.17 * (1 - t * t) + 0.02 * Math.abs(t) ** 4)); }
    const limb = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.017, 5, false);
    const tipY = 0.52, tipZ = pts[0].z;
    return {
      wood: [wp(limb, 0, 0, 0)],
      leather: [wp(gripGeo(0.03, -0.09, 0.09, 4), 0, 0, -0.17)],
      brass: [wp(wsph(0.022, 6, 4), 0, tipY, tipZ), wp(wsph(0.022, 6, 4), 0, -tipY, tipZ)],
      string: [wp(wcyl(0.004, 0.004, tipY * 2, 3), 0, 0, tipZ)],
      accent: [wp(wcyl(0.034, 0.034, 0.02, 8), 0, 0.1, -0.17)],
    };
  },
  wand() {
    return {
      wood: [wp(wcyl(0.008, 0.014, 0.55, 7), 0, 0.22, 0)],                                   // a slim shaft
      leather: [wp(gripGeo(0.018, -0.06, 0.1, 3), 0, 0, 0)],
      brass: [wp(wcyl(0.02, 0.02, 0.022, 8), 0, -0.07, 0), wp(wcyl(0.017, 0.017, 0.014, 8), 0, 0.12, 0), wp(new THREE.ConeGeometry(0.026, 0.06, 6), 0, 0.5, 0, Math.PI)],   // pommel band, a ring and a cup under the crystal
    };
  },
  shield() {                                                                                // a round shield: faces -z (the model is turned by rotateX below)
    const face = new THREE.CylinderGeometry(0.09, 0.285, 0.06, 16), studs = [], cross = [];
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; studs.push(wp(wsph(0.018, 5, 3), Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2)); }
    cross.push(wp(new THREE.BoxGeometry(0.56, 0.012, 0.045), 0, 0.058, 0), wp(new THREE.BoxGeometry(0.045, 0.012, 0.56), 0, 0.058, 0));
    const seam = new THREE.BoxGeometry(0.008, 0.004, 0.5), strap = new THREE.BoxGeometry(0.24, 0.026, 0.06), brk = new THREE.BoxGeometry(0.03, 0.05, 0.05), rim = new THREE.TorusGeometry(0.288, 0.03, 5, 20);
    // (what the player sees is the BACK: planks with dark seams, a steel-bound rim, a leather forearm strap and a grip bar on brackets)
    return {
      wood: [wp(wcyl(0.3, 0.3, 0.05, 16), 0, -0.025, 0)],
      accent: [wp(face, 0, 0.03, 0)],
      steel: [wp(rim, 0, -0.02, 0, Math.PI / 2), wp(wsph(0.085, 8, 5), 0, 0.055, 0, 0, 0, 0, 1, 0.55, 1), wp(brk, -0.09, -0.065, 0.02), wp(brk, 0.09, -0.065, 0.02)],   // rims, boss and the grip's brackets
      dark: cross.concat([wp(seam, -0.14, -0.052, 0), wp(seam, 0, -0.052, 0), wp(seam, 0.14, -0.052, 0)]),   // plank seams on the back
      leather: [wp(strap, 0, -0.07, 0.15), wp(strap, 0, -0.07, -0.15), wp(wcyl(0.017, 0.017, 0.2, 6), 0, -0.085, 0.02, 0, 0, Math.PI / 2)],   // two straps and the grip bar
      brass: studs,
    };
  },
};
const WM_SLOT = { steel: WM.steel, dark: WM.dark, leather: WM.leather, wood: WM.wood, brass: WM.brass, string: WM.string };
// Meshes for a part table: one per material slot. tier colours the accent gem.
function wmMeshes(parent, id, tier, rotate) {
  const g = WM_GEOS[id] || (WM_GEOS[id] = (() => { const set = {}, src = WM_BUILD[id](); for (const k in src) { const m = mergeParts(src[k]); if (rotate) m.rotateX(rotate); m.userData.shared = true; set[k] = m; } return set; })());
  for (const k in g) { const m = new THREE.Mesh(g[k], k === 'accent' ? WM.accent(tier) : WM_SLOT[k]()); m.frustumCulled = false; parent.add(m); }
}
// The off-hand shield (main.js buildShieldModel): the same shared geometries, tinted by tier.
function buildShieldMesh(tier) { const g = new THREE.Group(); wmMeshes(g, 'shield', tier, -Math.PI / 2); return g; }

// Ian's Hog's pole: beige skin with branching reddish-purple veins (paler and greyer when limp). Cached per state.
const VEIN_TEX = {};
function veinTexture(limp) {
  const key = limp ? 'limp' : 'ready';
  if (VEIN_TEX[key]) return VEIN_TEX[key];
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = limp ? '#cbbfa8' : '#e6d4ae'; g.fillRect(0, 0, 64, 256);
  const r = makeRng(limp ? 11 : 7);
  for (let i = 0; i < 9; i++) {                                    // a few long veins with side branches
    let x = r() * 64, y = r() * 256; g.strokeStyle = limp ? 'rgba(140,100,110,0.55)' : 'rgba(160,60,80,0.8)'; g.lineWidth = 1.2 + r() * 1.3;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 16; y += 14 + r() * 22; g.lineTo(x, y); if (r() < 0.4) { g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 22, y + 8 + r() * 10); g.moveTo(x, y); } }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return VEIN_TEX[key] = t;
}

// Ian's Hog "floppy mode": when the spear is limp its five joints are a soft chain of damped springs, driven by how the player moves, turns and walks.
// Numbers (angles in radians, rates per second): k stiffness, damp damping, couple how much a joint's swing whips the next one, bend the resting droop of each joint (gravity),
// turn / strafe / fwd / up / pitch how hard yaw, sideways, forward, vertical and pitch accelerations push, bob the footstep sway (grows with speed), idle the resting wobble.
const LIMP_PHYS = { k: 46, damp: 3.4, couple: 0.55, bend: -0.42, turn: 0.55, strafe: 0.45, fwd: 0.25, up: 0.5, pitch: 0.25, bob: 4.5, idle: 1.6, maxAng: 1.1, maxDrive: 200, maxDt: 1 / 30, step: 1 / 120 };
const LIMP_N = 5;
const LIMP = { ax: new Float32Array(LIMP_N), wx: new Float32Array(LIMP_N), az: new Float32Array(LIMP_N), wz: new Float32Array(LIMP_N), t: 0, phase: 0, have: false, yaw: 0, pitch: 0, y: 0, fy: 0, vf: 0, vr: 0, vy: 0, dX: 0, dZ: 0 };
function limpReset() {
  for (let i = 0; i < LIMP_N; i++) { LIMP.ax[i] = LIMP_PHYS.bend; LIMP.wx[i] = LIMP.az[i] = LIMP.wz[i] = 0; }
  LIMP.have = false; LIMP.fy = LIMP.vf = LIMP.vr = LIMP.vy = 0;
}
const _clampD = v => v > LIMP_PHYS.maxDrive ? LIMP_PHYS.maxDrive : v < -LIMP_PHYS.maxDrive ? -LIMP_PHYS.maxDrive : v;
// Advance the chain by dt seconds given the camera's yaw / pitch / height and the player's world velocity. No allocation; stable at any dt (clamped, fixed substeps).
function limpStep(dt, yaw, pitch, vx, vz, y) {
  const P = LIMP_PHYS, L = LIMP;
  if (!(dt > 0) || !isFinite(yaw + pitch + vx + vz + y)) return;   // (a bad input must never poison the chain state)
  const big = dt > 0.1 || !L.have;                                                           // a pause, a first frame or a debug jump: no fake rates from it
  dt = Math.min(dt, P.maxDt);
  const vf = -vx * Math.sin(yaw) - vz * Math.cos(yaw), rr = vx * Math.cos(yaw) - vz * Math.sin(yaw), speed = Math.hypot(vx, vz);   // forward and rightward speed (forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw))
  let dX = 0, dZ = 0;
  if (!big) {
    const a = Math.min(1, dt / 0.035), yawRate = (yaw - L.yaw) / dt;
    const fy = L.fy + (yawRate - L.fy) * a, yawAcc = (fy - L.fy) / dt;                        // smoothed turn rate and its change
    const af = (vf - L.vf) / dt, ar = (rr - L.vr) / dt, ay = ((y - L.y) / dt - L.vy) / dt;
    dZ += -P.turn * yawAcc + P.strafe * ar; dX += P.fwd * af - P.up * ay - P.pitch * (pitch - L.pitch) / dt * 4;   // (pitch: look up and it trails below, a rate rather than a rate of rate, scaled)
    L.fy = fy; L.vy = (y - L.y) / dt;
  }
  L.vf = vf; L.vr = rr; L.yaw = yaw; L.pitch = pitch; L.y = y; L.have = true;
  const s = Math.min(1.3, speed / 5);
  L.phase += dt * (7 + 6 * s); L.t += dt;
  dX += P.bob * s * Math.sin(L.phase) + P.idle * Math.sin(L.t * 4.4);
  dZ += P.bob * s * 0.6 * Math.cos(L.phase * 0.5) + P.idle * 0.7 * Math.sin(L.t * 3.1 + 1);
  dX = _clampD(dX); dZ = _clampD(dZ);
  let left = dt;
  while (left > 1e-6) {
    const h = Math.min(left, P.step); left -= h;
    let accX = dX, accZ = dZ;                                                                // the first joint feels the hand's motion, the rest what the joint before them does
    for (let i = 0; i < LIMP_N; i++) {
      const g = 1 + 0.2 * i;
      let ax = -P.k * (L.ax[i] - P.bend) - P.damp * L.wx[i] + accX * g, az = -P.k * L.az[i] - P.damp * L.wz[i] + accZ * g;
      L.wx[i] += ax * h; L.wz[i] += az * h;                                                  // semi-implicit Euler: velocity first
      L.ax[i] += L.wx[i] * h; L.az[i] += L.wz[i] * h;
      const ex = L.ax[i] - P.bend, M = P.maxAng;
      if (ex > M) { L.ax[i] = P.bend + M; if (L.wx[i] > 0) L.wx[i] = 0; } else if (ex < -M) { L.ax[i] = P.bend - M; if (L.wx[i] < 0) L.wx[i] = 0; }
      if (L.az[i] > M) { L.az[i] = M; if (L.wz[i] > 0) L.wz[i] = 0; } else if (L.az[i] < -M) { L.az[i] = -M; if (L.wz[i] < 0) L.wz[i] = 0; }
      accX = -P.couple * ax; accZ = -P.couple * az;                                          // the next joint is dragged against this one's acceleration
    }
  }
}
// Writes the chain's state to a limp spear model's joints (built by buildWeaponModel, model.userData.joints).
function limpApply(model) {
  const j = model.userData.joints; if (!j) return;
  for (let i = 0; i < LIMP_N; i++) { j[i].rotation.x = LIMP.ax[i]; j[i].rotation.z = LIMP.az[i]; }
}

// id: a weapon id ('sword', 'dagger', 'mace', 'bow', 'spear', 'spear:limp' or 'wand:<kind>'). tier tints the gem (TIERS colour).
function buildWeaponModel(id, tier = 0) {
  const g = new THREE.Group();
  if (id === 'sword' || id === 'dagger' || id === 'mace') wmMeshes(g, id, tier);
  else if (id === 'spear' || id === 'spear:limp') {
    // Ian's Hog. Held pointing forward (the viewmodel tilts it). Ready: a straight ash shaft, a long leaf blade and a red tassel.
    // Limp: the same spear gone soft, its shaft in 5 joints that sag and flop (limpStep) to a hanging, greyed-out tip.
    const limp = id === 'spear:limp', key = limp ? 'l' : 'r';
    const shaftMat = wmMat('hogshaft' + key, () => new THREE.MeshPhongMaterial({ map: veinTexture(limp), shininess: limp ? 2 : 22, specular: 0x333028 }));   // beige, with veins
    const bladeMat = wmMat('hogblade' + key, () => new THREE.MeshPhongMaterial({ color: limp ? 0x8e8a92 : 0xd8dce4, shininess: limp ? 4 : 120, specular: 0xffffff, flatShading: true }));
    const gold = wmMat('hoggold' + key, () => new THREE.MeshPhongMaterial({ color: limp ? 0x8a8068 : 0xd9a830, shininess: 60, specular: 0x886622 }));
    const red = wmMat('hogred' + key, () => new THREE.MeshLambertMaterial({ color: limp ? 0x8a6068 : 0xc02a2a }));
    const SEGS = limp ? LIMP_N : 1, LEN = 2.0 / SEGS, BEND = LIMP_PHYS.bend, joints = [];
    const shaftG = wgeo('hogshaft' + SEGS, () => wcyl(0.028, 0.03, LEN, 8)), collarG = wgeo('hogcollar', () => wcyl(0.045, 0.045, 0.06, 8)), bladeG = wgeo('hogblade', () => bladeGeo(0.06, 0.016, 0.5, 0.24, 0.62));
    const tasselG = wgeo('hogtassel', () => new THREE.ConeGeometry(0.05, 0.22, 6)), gripG = wgeo('hoggrip', () => gripGeo(0.036, 0, 0.3, 8)), buttG = wgeo('hogbutt', () => new THREE.ConeGeometry(0.03, 0.12, 6));
    let parent = g, y0 = -0.1;
    for (let i = 0; i < SEGS; i++) {                                                      // nested segments: each bends a little more
      const seg = new THREE.Group(); seg.position.y = y0; seg.rotation.x = i === 0 ? 0 : BEND; parent.add(seg); if (i > 0) joints.push(seg);
      const m = new THREE.Mesh(shaftG, shaftMat); m.position.y = LEN / 2; seg.add(m);
      parent = seg; y0 = LEN;
    }
    const tip = new THREE.Group(); tip.position.y = y0; tip.rotation.x = limp ? BEND : 0; parent.add(tip); if (limp) joints.push(tip);
    const collar = new THREE.Mesh(collarG, gold); collar.position.y = 0.02; tip.add(collar);
    const blade = new THREE.Mesh(bladeG, bladeMat); blade.position.y = 0.05; tip.add(blade);
    const tassel = new THREE.Mesh(tasselG, red); tassel.position.y = -0.1; tassel.rotation.x = Math.PI; tip.add(tassel);
    const grip = new THREE.Mesh(gripG, WM.leather()); grip.position.y = 0.05; g.add(grip);
    const butt = new THREE.Mesh(buttG, bladeMat); butt.rotation.x = Math.PI; butt.position.y = -0.16; g.add(butt);
    if (limp) { g.userData.joints = joints; limpReset(); limpApply(g); }
  } else if (id.startsWith('wand:')) {   // a wand with a glowing crystal in the wand's colour
    const kind = id.slice(5), c = new THREE.Color(WANDS[kind].color);
    wmMeshes(g, 'wand', tier);
    const core = new THREE.Mesh(wgeo('wandcore', () => new THREE.OctahedronGeometry(0.04, 0)), wmMat('wcore' + kind, () => new THREE.MeshBasicMaterial({ color: c }))); core.position.y = 0.55; core.scale.set(0.75, 1.35, 0.75); g.add(core);
    const halo = new THREE.Mesh(wgeo('wandhalo', () => new THREE.IcosahedronGeometry(0.06, 1)), wmMat('whalo' + kind, () => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false }))); halo.position.y = 0.55; halo.scale.set(0.9, 1.3, 0.9); g.add(halo);
    if (kind === 'bust') {                                                                  // drips of white goo
      const drips = wgeo('bustdrips', () => mergeParts([[wsph(0.045, 8, 6), partM(0.025, 0.42, 0.02)], [wsph(0.03, 8, 6), partM(0.025, 0.34, 0.02)], [wsph(0.022, 8, 6), partM(0.025, 0.27, 0.02)]]));
      g.add(new THREE.Mesh(drips, wmMat('white', () => new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 }))));
    }
  } else wmMeshes(g, 'bow', tier);   // bow
  if (id === 'bow') g.rotation.y = -0.75;                                                   // turned a little so its curve shows from behind
  return g;
}
