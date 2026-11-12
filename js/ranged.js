// Bow, arrows and the shield (DESIGN.md sections 5.3, 5.4 and "Arrow damage and supply"). The flight and
// hit-zone maths is pure so it can be tested in plain Node (tests/ranged.test.js). main.js owns the state.
const BOW = {
  speedMin: 16, speedMax: 30,     // arrow speed in m/s, from a quick release to a full draw
  gravity: 5,                     // m/s^2 of drop
  minDraw: 0.3,                   // releasing before this share of a full draw does nothing
  recoverWorld: 0.65,             // chance an arrow that hit the world can be picked up again
  recoverHit: 0.4,                // chance one that hit an enemy can
  impactNoise: 3,                 // metres: an arrow hitting something is heard
  maxStuck: 40,                   // stuck arrows kept per floor
};
const SHIELD = {
  cost: 18,                       // stamina per blocked hit, divided by the tier multiplier
  parryWin: 0.15,                 // seconds after raising it that count as a parry
  legsTake: 0.45,                 // share of a leg sweep that gets through (it covers low hits partly)
  legsCost: 0.6,                  // stamina share for blocking a leg sweep
  bashStam: 15, bashCd: 1.2, bashStun: 0.8, bashDmg: 4, bashReach: 1.9, bashPush: 0.9, noise: 5,
};

// Which hit zone an arrow at height y (metres) is in for this enemy, or null if it flies over or under it.
function zoneAtHeight(y, e) {
  if (e.quad) return y > e.T.height || y < 0 ? null : y < e.T.height * 0.4 ? 'legs' : 'body';
  const yy = y / (e.boss ? BOSS_SCALE : e.T.scale || 1);
  return yy > 2.05 || yy < 0 ? null : yy > 1.4 ? 'head' : yy > 0.7 ? 'body' : 'legs';
}

// Advance an arrow { x, y, z, vx, vy, vz, owner } by dt seconds. Returns the first thing it hits:
// { type: 'hit', e, zone } (an enemy), { type: 'player' } (an enemy's arrow), { type: 'wall' } or { type: 'ground' }, else null.
// It also records the last free spot in a.px / a.pz so a stuck arrow can lie in front of the wall.
function stepArrow(a, dt, floor, enemies, player, ally) {
  const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.2)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    a.px = a.x; a.pz = a.z;
    a.vy -= (a.gravity === undefined ? BOW.gravity : a.gravity) * h; a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
    if (a.y <= 0) { a.y = 0; return { type: 'ground' }; }
    if (a.y >= WALL_H || wallAt(floor, Math.floor(a.x / TILE), Math.floor(a.z / TILE))) return { type: 'wall' };
    if (a.owner === 'player') {
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = a.x - e.x, dz = a.z - e.z;
        if (dx * dx + dz * dz > (e.r + 0.05) ** 2) continue;
        const zone = zoneAtHeight(a.y, e);
        if (zone) return { type: 'hit', e, zone };
      }
      for (let k = 1; k < (floor.solids || []).length; k++) {          // furniture and props (index 0 is the stairwell)
        const s = floor.solids[k];
        if (s.r > 0.3 && a.y < 1.3 && (a.x - s.x) ** 2 + (a.z - s.z) ** 2 < s.r * s.r) return { type: 'wall' };
      }
    } else if (player) {
      if (ally && !ally.dead && a.y > 0) {                                                    // the player's ally standing in the line of fire
        const ax = a.x - ally.x, az = a.z - ally.z;
        if (ax * ax + az * az <= (ally.r + 0.05) ** 2 && zoneAtHeight(a.y, ally)) return { type: 'ally', e: ally, zone: zoneAtHeight(a.y, ally) };
      }
      const dx = a.x - player.x, dz = a.z - player.z;
      if (dx * dx + dz * dz < (player.radius + 0.05) ** 2 && a.y < player.eye + 0.2 && a.y > 0) return { type: 'player' };
    }
  }
  return null;
}

function makeArrowMesh() {
  const g = new THREE.Group();
  const part = (w, h, d, c, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.z = z; g.add(m); };
  part(0.025, 0.025, 0.75, 0x8a6a3a, 0);          // shaft
  part(0.05, 0.05, 0.1, 0xc8ccd4, 0.4);           // head
  part(0.07, 0.01, 0.16, 0xe8e0d0, -0.3);         // fletching
  part(0.01, 0.07, 0.16, 0xe8e0d0, -0.3);
  return g;
}
