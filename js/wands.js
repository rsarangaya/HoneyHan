// Wands, recharge wands and Hanahan's Rage (DESIGN.md sections 7 and 13). Data plus a few pure helpers so the
// rules can be tested in plain Node (tests/wands.test.js). main.js fires the bolts and applies the effects.
//   A wand has one fixed effect and limited charges, is fired with attack, ignores armor and hit zones, and breaks at 0.
//   A recharge wand tops up a wand and breaks after one use. Hanahan's Rage turns nearby enemies on each other.
const WANDS = {
  fire:      { name: 'Fire Wand',      color: '#ff7a2a', charges: 5, noise: 6,  dmg: 22, desc: 'A fire bolt: 22 damage that ignores armor. Loud-ish (6 m).' },
  frost:     { name: 'Frost Wand',     color: '#7fd8ff', charges: 6, noise: 1,  dmg: 8,  slow: 8, desc: 'A frost bolt: 8 damage and Slow for 8 s. Nearly silent (1 m), so it is a good opener.' },
  lightning: { name: 'Lightning Wand', color: '#ffe84a', charges: 4, noise: 12, dmg: 14, stun: 1.6, chain: 4, chainDmg: 8, chainStun: 1, desc: 'Lightning: 14 damage and a 1.6 s Stun, and it arcs to another enemy within 4 m (8 damage, 1 s). Very loud (12 m).' },
  force:     { name: 'Force Wand',     color: '#c58aff', charges: 5, noise: 8,  dmg: 6,  push: 4, wallDmg: 8, desc: 'A blast of force: 6 damage and it throws the target 4 m away, 8 more damage if it hits a wall. Bosses are only damaged. 8 m noise.' },
  sleep:     { name: 'Sleep Wand',     color: '#8a9aff', charges: 3, noise: 1,  sleep: 10, desc: 'Puts an enemy to sleep for 10 s, silently (1 m). A sleeper cannot see or hear you, so it is an easy sneak kill, but any damage wakes it. Bosses do not sleep.' },
  // Legendary, one per run (never in the ordinary wand roll): a bolt of thick white goo that glues ONE enemy in place.
  bust:      { name: "Aj's Bust",      color: '#f4f4ee', charges: 3, noise: 3,  legendary: true, desc: "Legendary. A bolt of thick white goo that coats one enemy and glues it where it stands. It cannot move at all until it dies, though it can still swing at anything in reach (and archers still shoot). One target. Does not work on elites or bosses. 3 charges. Quiet (3 m)." },
};
const WAND = {
  stam: 8,                 // stamina per cast
  cd: 0.5,                 // seconds between casts
  speed: 38, range: 30,    // bolt speed in m/s and how far it flies
  rechargeGain: 3,         // charges a recharge wand restores
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
function makeBoltMesh(color) {
  const g = new THREE.Group(), c = new THREE.Color(color);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: c })));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 })));
  return g;
}
