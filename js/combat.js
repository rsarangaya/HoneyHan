// Melee tables and hit-zone helpers (stage 4 of the build order). All numbers are untested guesses.
const ZONE_MUL = { head: 1.75, body: 1.0, legs: 0.65 };
// Global combat numbers, editable live from the dev tuning panel (js/tune.js).
const TUNE = {
  enemyHp: 55, enemyDmg: 13, floorHpScale: 0.12, floorDmgScale: 0.06, windup: 0.35, enemyCooldown: 0.6,
  enemyAtkSpd: 1.4,                   // attack speed stat: x its weapon's spd. Cooldown / this, wind-up / sqrt(this)
  enemyReach: 1.7,                    // how close an alerted guard must be to start a swing
  chaseSpeed: 5.0,                    // alerted guards run faster than a sprinting player
  playerAtkSpd: 1,                    // attack speed stat: x the weapon's spd. Swing time / this
  walkSpeed: 3.0, sprintSpeed: 4.6, crouchSpeed: 1.4,
  bossHp: 220, bossDmgMul: 1.4,       // the boss wears Rare plate, so its real toughness is higher than its HP
  bossWake: 12,                       // metres: the boss stays asleep until you are this close
  bossSpeed: 4.2,                     // a sprinting player (4.6) can outrun it
  bossLegendary: 0.10,                // chance its guaranteed Epic drop upgrades to Legendary
  damageCap: 2,                       // zone multiplier cap, as in Test1
  staminaRegen: 28, staminaDelay: 0.8, sprintDrain: 14,
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

// Closest living enemy in the swing cone, or null. Walls block the swing.
function findMeleeTarget(player, eyeY, enemies, floor, reach) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let best = null, bestD = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
    if (d > reach + 0.3 || (d > 0.8 && (dx * fx + dz * fz) / d < 0.82)) continue;
    if (!hasLOS(floor, player.x, player.z, e.x, e.z)) continue;
    if (d < bestD) { best = e; bestD = d; }
  }
  if (!best) return null;
  let zone;
  if (best.quad) {                                  // rats and wolves are low: any aim at their height lands, low aim is a leg hit
    const y = eyeY + Math.tan(player.pitch) * bestD, h = best.T.height;
    zone = y > h || y < -0.1 ? null : y < h * 0.4 ? 'legs' : 'body';
  } else zone = aimZone(eyeY, player.pitch, bestD, best.boss ? BOSS_SCALE : best.T.scale || 1);
  return zone ? { e: best, zone, dist: bestD } : { e: best, zone: null, dist: bestD };
}

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

// Procedural first-person weapon models (stand-ins until real art).
function buildWeaponModel(id) {
  const g = new THREE.Group();
  const steel = new THREE.MeshPhongMaterial({ color: 0x9aa0aa, shininess: 70, specular: 0x9a9a9a });   // metal that catches the lantern
  const wood = new THREE.MeshPhongMaterial({ color: 0x5a3a20, shininess: 8, specular: 0x222222 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  if (id === 'sword') {
    add(new THREE.BoxGeometry(0.07, 0.8, 0.02), steel, 0, 0.5, 0);
    add(new THREE.BoxGeometry(0.28, 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0xc9a23a }), 0, 0.1, 0);
    add(new THREE.BoxGeometry(0.05, 0.22, 0.05), wood, 0, -0.04, 0);
  } else if (id === 'dagger') {
    add(new THREE.BoxGeometry(0.055, 0.38, 0.018), steel, 0, 0.3, 0);
    add(new THREE.BoxGeometry(0.16, 0.03, 0.04), wood, 0, 0.08, 0);
    add(new THREE.BoxGeometry(0.045, 0.16, 0.045), wood, 0, -0.03, 0);
  } else if (id === 'mace') {
    add(new THREE.BoxGeometry(0.06, 0.7, 0.06), wood, 0, 0.3, 0);
    add(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x6a6e76 }), 0, 0.72, 0);
  } else if (id === 'spear' || id === 'spear:limp') {
    // Ian's Hog. Held pointing forward (the viewmodel tilts it). Ready: a straight ash shaft, a long leaf blade and a red
    // tassel. Limp: the same spear gone soft, its shaft sagging in segments to a hanging, greyed-out tip.
    const limp = id === 'spear:limp';
    const shaftMat = new THREE.MeshPhongMaterial({ map: veinTexture(limp), shininess: limp ? 2 : 22, specular: 0x333028 });   // beige, with veins
    const bladeMat = new THREE.MeshPhongMaterial({ color: limp ? 0x8e8a92 : 0xd8dce4, shininess: limp ? 4 : 120, specular: 0xffffff });
    const gold = new THREE.MeshPhongMaterial({ color: limp ? 0x8a8068 : 0xd9a830, shininess: 60, specular: 0x886622 });
    const red = new THREE.MeshLambertMaterial({ color: limp ? 0x8a6068 : 0xc02a2a });
    const SEGS = limp ? 5 : 1, LEN = 2.0 / SEGS, BEND = -0.42;
    let parent = g, y0 = -0.1;
    for (let i = 0; i < SEGS; i++) {                                                      // nested segments: each bends a little more
      const seg = new THREE.Group(); seg.position.y = y0; seg.rotation.x = i === 0 ? 0 : BEND; parent.add(seg);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, LEN, 8), shaftMat); m.position.y = LEN / 2; seg.add(m);
      parent = seg; y0 = LEN;
    }
    const tip = new THREE.Group(); tip.position.y = y0; tip.rotation.x = limp ? BEND : 0; parent.add(tip);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), gold); collar.position.y = 0.02; tip.add(collar);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), bladeMat); blade.position.y = 0.25; blade.scale.set(1, 1, 0.35); tip.add(blade);
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), red); tassel.position.y = -0.1; tassel.rotation.x = Math.PI; tip.add(tassel);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x3a2412 })); grip.position.y = 0.2; g.add(grip);
    const butt = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), bladeMat); butt.rotation.x = Math.PI; butt.position.y = -0.16; g.add(butt);
  } else if (id.startsWith('wand:')) {   // a short wand with a glowing tip in the wand's colour
    const c = new THREE.Color(WANDS[id.slice(5)].color);
    if (id === 'wand:bust') for (const [dy, r] of [[0.42, 0.045], [0.34, 0.03], [0.27, 0.022]]) add(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 }), 0.025, dy, 0.02);   // drips of white goo
    add(new THREE.BoxGeometry(0.035, 0.5, 0.035), wood, 0, 0.2, 0);
    add(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: c }), 0, 0.5, 0);
    add(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 }), 0, 0.5, 0);
  } else {   // bow
    add(new THREE.BoxGeometry(0.04, 0.9, 0.04), wood, 0, 0.35, 0);
    add(new THREE.BoxGeometry(0.01, 0.9, 0.01), new THREE.MeshLambertMaterial({ color: 0xddd8c0 }), 0.05, 0.35, 0);
  }
  return g;
}
