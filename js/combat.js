// Melee tables and hit-zone helpers (stage 4 of the build order). All numbers are untested guesses.
const ZONE_MUL = { head: 1.75, body: 1.0, legs: 0.65 };
// Global combat numbers, editable live from the dev tuning panel (js/tune.js).
const TUNE = {
  enemyHp: 40, enemyDmg: 10, windup: 0.35, enemyCooldown: 0.6,
  damageCap: 2,                       // zone multiplier cap, as in Test1
  staminaRegen: 28, staminaDelay: 0.8, sprintDrain: 14,
};

// dmg: base damage. dur: swing time. hitAt: fraction of the swing where the hit lands.
// sneak: damage multiplier on an unaware enemy. parryWin: seconds after RMB that count as a parry.
// blockCost: stamina per blocked hit (0 means the weapon cannot block normally).
const WSTATS = {
  sword:  { dmg: 20, dur: 0.50, hitAt: 0.45, reach: 2.3, stam: 12, sneak: 3,   noise: 6, parryWin: 0.20, blockCost: 15 },
  dagger: { dmg: 12, dur: 0.30, hitAt: 0.40, reach: 1.8, stam: 7,  sneak: 99,  noise: 3, parryWin: 0.15, blockCost: 0 },
  mace:   { dmg: 32, dur: 0.85, hitAt: 0.55, reach: 2.1, stam: 22, sneak: 2.5, noise: 8, parryWin: 0.0,  blockCost: 25 },
  bow:    { ranged: true },
};

const STAMINA_MAX = 100;

// Which part of an enemy the crosshair ray crosses at this distance. null = over or under it.
function aimZone(eyeY, pitch, dist) {
  const y = eyeY + Math.tan(pitch) * dist;
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
  const zone = aimZone(eyeY, player.pitch, bestD);
  return zone ? { e: best, zone, dist: bestD } : { e: best, zone: null, dist: bestD };
}

// Procedural first-person weapon models (stand-ins until real art).
function buildWeaponModel(id) {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
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
  } else {   // bow
    add(new THREE.BoxGeometry(0.04, 0.9, 0.04), wood, 0, 0.35, 0);
    add(new THREE.BoxGeometry(0.01, 0.9, 0.01), new THREE.MeshLambertMaterial({ color: 0xddd8c0 }), 0.05, 0.35, 0);
  }
  return g;
}
