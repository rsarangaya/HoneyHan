// Wands, recharge wands and Hanahan's Rage (DESIGN.md sections 7 and 13). Data plus a few pure helpers so the
// rules can be tested in plain Node (tests/wands.test.js). main.js fires the bolts and applies the effects.
//   A wand is a consumable: it sits in the pack, is assigned to a quickslot and zapped from there (the equipped weapon stays in hand).
//   It has one fixed effect and limited charges, ignores armor and hit zones, and breaks at 0.
//   A recharge wand tops up a wand and breaks after one use. Hanahan's Rage turns nearby enemies on each other.
const WANDS = {
  fire:      { name: 'Fire Wand',      color: '#ff7a2a', charges: 5, noise: 6,  dmg: 22, get desc() { return `A fire bolt: 22 damage that ignores armor, and a ${Math.round(WAND.burnChance * 100)}% chance to set the target Burning (6 damage a second for 3 s, armor ignored; bosses take half). Loud-ish (6 m).`; } },
  frost:     { name: 'Frost Wand',     color: '#7fd8ff', charges: 6, noise: 1,  dmg: 8,  slow: 8, get desc() { return `A frost bolt: 8 damage and Slow for 8 s, and a ${Math.round(WAND.freezeChance * 100)}% chance to Freeze the target solid for about 1.75 s (bosses are only slowed). Nearly silent (1 m), so it is a good opener.`; } },
  lightning: { name: 'Lightning Wand', color: '#ffe84a', charges: 4, noise: 12, dmg: 14, stun: 1.6, chain: 4, chainDmg: 8, chainStun: 1, desc: 'Lightning: 14 damage and a 1.6 s Stun, and it arcs to another enemy within 4 m (8 damage, 1 s). Very loud (12 m).' },
  force:     { name: 'Force Wand',     color: '#c58aff', charges: 5, noise: 8,  dmg: 6,  push: 4, wallDmg: 8, desc: 'A blast of force: 6 damage and it throws the target 4 m away, 8 more damage if it hits a wall. Bosses are only damaged. 8 m noise.' },
  sleep:     { name: 'Sleep Wand',     color: '#8a9aff', charges: 3, noise: 1,  sleep: 10, desc: 'Puts an enemy to sleep for 10 s, silently (1 m). A sleeper cannot see or hear you, so it is an easy sneak kill, but any damage wakes it. Bosses do not sleep.' },
  // Legendary, one per run (never in the ordinary wand roll): a bolt of thick white goo that glues ONE enemy in place.
  bust:      { name: "Aj's Bust",      color: '#f4f4ee', charges: 3, noise: 3,  legendary: true, desc: "Legendary. A bolt of thick white goo that coats one enemy and glues it where it stands. It cannot move at all until it dies, though it can still swing at anything in reach (and archers still shoot). One target. Does not work on elites or bosses. 3 charges. Quiet (3 m)." },
};
const WAND = {
  stam: 8,                 // stamina per zap (a zap never needs it: with less you zap at exhausted speed, see TUNE.exhaustedAtkMul)
  cd: 0.5,                 // seconds the zap animation and recovery take (no second zap, melee or block meanwhile)
  speed: 38, range: 30,    // bolt speed in m/s and how far it flies
  rechargeGain: 3,         // charges a recharge wand restores
  burnChance: 0.4,         // chance a fire bolt sets the target burning (status burn, js/status.js)
  freezeChance: 0.25,      // chance a frost bolt freezes the target solid (status freeze); it always slows
  rechargeFull: 0.15,      // chance a recharge wand found is the rare kind that refills completely
};
const RAGE = {
  charges: 2,              // plays; the recorder breaks at 0
  radius: 14,              // metres: enemies this close to you are enraged
  dur: 12,                 // seconds they fight each other
  noise: 16,               // metres: it is loud, and draws other guards in
  cd: 3,                   // seconds before it can be played again
};
const RAGE_LINES = [
  'Hey! Goblins! You call that guarding? My grandmother patrols better than you!',
  'Your mother was a mushroom and your father smelled of cabbage!',
  'Oh look, the great dungeon guards. All tusks and no brains!',
  'I have seen sleepier rocks. Wake up, you pathetic gobbos!',
  'Is that a club or are you just happy to see me? Come on then!',
];

// The most charges an item can hold: a wand's own, or Ian's Hog's kills (js/combat.js).
const chargeMax = it => it.kind ? WANDS[it.kind].charges : WSTATS.spear.kills;
// A fresh wand item descriptor.
const newWand = kind => ({ type: 'wand', kind, charges: WANDS[kind].charges });
// Recharge: how many charges a wand has afterwards. full: the rare refill-everything recharge wand.
const rechargedTo = (wand, full) => full ? chargeMax(wand) : Math.min(chargeMax(wand), wand.charges + WAND.rechargeGain);
// The nearest living enemy to e within maxD (or null), optionally skipping some.
function nearestOther(e, list, maxD, skip) {
  let best = null, bd = maxD;
  for (const o of list) {
    if (o === e || o.dead || (o.dormant && o.T.mimic) || (skip && skip(o))) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d < bd) { best = o; bd = d; }
  }
  return best;
}
// Who gets enraged when the recorder plays at (x, z): living, non-boss enemies within the radius.
const rageVictims = (list, x, z) => list.filter(o => !o.dead && !o.boss && Math.hypot(o.x - x, o.z - z) <= RAGE.radius);

const rollWandKind = rng => { const ks = Object.keys(WANDS).filter(k => !WANDS[k].legendary), w = [25, 25, 15, 20, 15]; let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < ks.length; i++) { r -= w[i]; if (r < 0) return ks[i]; } return ks[0]; };
// A simple glowing orb for enemy bolts (hex, thorn, curse, dart): one shared geometry and one shared material pair per colour, so a shot allocates only its two meshes.
const BOLT_SHARED = {};
function makeBoltMesh(color) {
  const g = new THREE.Group();
  let s = BOLT_SHARED[color];
  if (!s) {
    const c = new THREE.Color(color), sg = new THREE.SphereGeometry(0.11, 8, 6), hg = new THREE.SphereGeometry(0.2, 8, 6), cm = new THREE.MeshBasicMaterial({ color: c }), hm = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 });
    for (const o of [sg, hg, cm, hm]) o.userData.shared = true;
    s = BOLT_SHARED[color] = { sg, hg, cm, hm };
  }
  g.add(new THREE.Mesh(s.sg, s.cm)); g.add(new THREE.Mesh(s.hg, s.hm));
  return g;
}

// ---- wand visuals: pooled bolts, impact flashes and one expanding ring (per floor group, see main.js castWand / updateArrows) ----
// Bolts: a glowing core, a soft halo and a comet tail, built once per wand kind and reused; the group is turned to face its flight direction when it is
// fired and its core spins / halo pulses each frame (no allocation). Geometry and bolt materials are shared (userData.shared), so a floor change frees nothing it should not.
// Flashes: a few additive spheres that swell and fade where a bolt lands. The ring: a flat disc that races outward (Rage's shout, a Force slam).
const WFX_STYLE = {   // oct: octahedron core; spin: core rad/s; pulse: halo size swing; tail: tail length (x); size: bolt scale; flash: impact radius (m); life: impact seconds
  fire:      { oct: false, spin: 0,  pulse: 0.30, tail: 1.3, size: 1.0, flash: 1.5, life: 0.30 },
  frost:     { oct: true,  spin: 5,  pulse: 0.08, tail: 0.8, size: 1.0, flash: 1.2, life: 0.35 },
  lightning: { oct: true,  spin: 26, pulse: 0.35, tail: 1.6, size: 0.9, flash: 1.9, life: 0.22 },
  force:     { oct: false, spin: 0,  pulse: 0.15, tail: 0.5, size: 1.3, flash: 2.2, life: 0.30 },
  sleep:     { oct: false, spin: 0,  pulse: 0.25, tail: 0.9, size: 1.1, flash: 1.3, life: 0.50 },
  bust:      { oct: false, spin: 0,  pulse: 0.10, tail: 0.7, size: 1.2, flash: 1.1, life: 0.35 },
};
const WFX = { geo: null, mats: {}, cols: {} };
const wandFxFor = g => g.userData.wandFx || (g.userData.wandFx = { bolts: {}, flashes: [], fi: 0, live: 0, ring: null, ringT: 0, ringLife: 0, ringR: 0 });
function wandFxGeo() {
  if (WFX.geo) return WFX.geo;
  const tail = new THREE.ConeGeometry(0.09, 1, 8); tail.rotateX(-Math.PI / 2); tail.translate(0, 0, -0.5);   // base at the bolt, tip trailing along -z (Object3D.lookAt points +z at the target)
  const ring = new THREE.RingGeometry(0.93, 1, 48); ring.rotateX(-Math.PI / 2);
  WFX.geo = { sph: new THREE.SphereGeometry(0.1, 8, 6), oct: new THREE.OctahedronGeometry(0.13, 0), halo: new THREE.SphereGeometry(0.2, 8, 6), tail, flash: new THREE.SphereGeometry(1, 10, 8), ring };
  for (const k in WFX.geo) WFX.geo[k].userData.shared = true;
  return WFX.geo;
}
function wandFxMats(kind) {
  let m = WFX.mats[kind]; if (m) return m;
  const hex = kind === 'rage' ? '#ff3a2a' : WANDS[kind].color, c = new THREE.Color(hex); WFX.cols[kind] = c;
  m = WFX.mats[kind] = { core: new THREE.MeshBasicMaterial({ color: c }), halo: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false }), tail: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }) };
  for (const k in m) m[k].userData.shared = true;
  return m;
}
// A bolt for this wand kind from the pool (built on first use), visible and flagged busy. Returns the group.
function wandFxBolt(g, kind) {
  const fx = wandFxFor(g), pool = fx.bolts[kind] || (fx.bolts[kind] = []);
  for (let i = 0; i < pool.length; i++) { const m = pool[i]; if (!m.userData.busy) { m.userData.busy = true; m.visible = true; return m; } }
  const G = wandFxGeo(), M = wandFxMats(kind), S = WFX_STYLE[kind], m = new THREE.Group();
  const core = new THREE.Mesh(S.oct ? G.oct : G.sph, M.core), halo = new THREE.Mesh(G.halo, M.halo), tail = new THREE.Mesh(G.tail, M.tail);
  tail.scale.z = S.tail; m.add(tail); m.add(halo); m.add(core); m.scale.setScalar(S.size);
  m.userData = { busy: true, core, halo, style: S, phase: pool.length * 1.7 };
  g.add(m); pool.push(m);
  return m;
}
const wandFxRelease = m => { m.visible = false; m.userData.busy = false; };
// Per-frame look of a flying bolt: spinning core, pulsing halo. t: any steadily growing clock in seconds.
function wandBoltAnim(m, t) {
  const u = m.userData, S = u.style;
  if (S.spin) { u.core.rotation.y = t * S.spin; u.core.rotation.x = t * S.spin * 0.7; }
  u.halo.scale.setScalar(1 + S.pulse * Math.sin(t * 30 + u.phase));
}
// An impact flash of this wand kind at (x, y, z): a sphere that swells to the style radius and fades.
function wandImpact(g, kind, x, y, z, scale) {
  const fx = wandFxFor(g), S = WFX_STYLE[kind] || WFX_STYLE.fire, fl = fx.flashes; wandFxMats(kind);
  let f;
  if (fl.length < 6) { const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); f = new THREE.Mesh(wandFxGeo().flash, mat); f.renderOrder = 4; f.userData = { t: 1, life: 1, r: 1 }; g.add(f); fl.push(f); }
  else { f = fl[fx.fi]; fx.fi = (fx.fi + 1) % fl.length; }
  f.material.color.copy(WFX.cols[kind]); f.position.set(x, y, z);
  f.userData.t = 0; f.userData.life = S.life; f.userData.r = S.flash * (scale || 1); f.visible = true; f.scale.setScalar(0.1); f.material.opacity = 0.85;
  fx.live++;
}
// An expanding floor ring (Rage's shout, a Force slam), reusing one mesh per floor.
function wandRing(g, kind, x, z, radius, life) {
  const fx = wandFxFor(g); wandFxMats(kind);
  if (!fx.ring) { const m = new THREE.Mesh(wandFxGeo().ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); m.renderOrder = 4; m.frustumCulled = false; g.add(m); fx.ring = m; }
  fx.ring.material.color.copy(WFX.cols[kind]); fx.ring.position.set(x, 0.12, z); fx.ringT = 0; fx.ringLife = life; fx.ringR = radius; fx.ring.visible = true; fx.ring.scale.set(0.1, 1, 0.1);
}
// Advance the flashes and the ring of floor group g. Cheap when nothing is live.
function wandFxUpdate(g, dt) {
  const fx = g && g.userData.wandFx; if (!fx) return;
  if (fx.live > 0) {
    let live = 0;
    for (let i = 0; i < fx.flashes.length; i++) {
      const f = fx.flashes[i], u = f.userData; if (!f.visible) continue;
      u.t += dt; const k = u.t / u.life;
      if (k >= 1) { f.visible = false; continue; }
      live++; f.scale.setScalar(u.r * (0.15 + 0.85 * (1 - (1 - k) * (1 - k)))); f.material.opacity = 0.85 * (1 - k);
    }
    fx.live = live;
  }
  if (fx.ring && fx.ring.visible) {
    fx.ringT += dt; const k = fx.ringT / fx.ringLife;
    if (k >= 1) fx.ring.visible = false; else { const r = fx.ringR * (1 - (1 - k) * (1 - k)); fx.ring.scale.set(r, 1, r); fx.ring.material.opacity = 0.8 * (1 - k); }
  }
}
// Hide every bolt, flash and ring of g (a floor change or a restart).
function wandFxClear(g) {
  const fx = g && g.userData.wandFx; if (!fx) return;
  for (const k in fx.bolts) for (const m of fx.bolts[k]) wandFxRelease(m);
  for (const f of fx.flashes) f.visible = false;
  fx.live = 0; if (fx.ring) fx.ring.visible = false;
}
