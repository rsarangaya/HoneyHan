// Enemy type table (DESIGN.md section 17) and the rules that choose which types spawn where.
// Every number is a multiplier on the goblin guard's (TUNE) values, so the tuning panel's Enemy
// section still scales everything and each type has its own small section too.
//   model: 'biped' (the goblin rig) or 'quad' (rats, wolves).
//   hpMul, dmgMul, speed (chase speed), reach, windMul (wind-up), cdMul (cooldown): x the goblin's.
//   vis, hear: sense multipliers. smell: metres at which it notices a moving player through walls.
//   zones: attack zone odds [head, body, legs]. shout: x the alert shout radius.
//   sneakCap: the most a sneak attack can multiply damage (so a dagger cannot instakill it).
//   noStagger: ordinary hits do not interrupt it (only a parry does). r: body radius. scale: model size.
//   height: quad only, how tall it is for aiming.
const ENEMY_TYPES = {
  goblin:  { name: 'Goblin Guard', zones: [0.3, 0.5, 0.2] },
  cook:    { name: 'Goblin Cook',  zones: [0.3, 0.5, 0.2], weapon: 'sword', noGear: true, hpMul: 1.1, dmgMul: 0.9 },
  bandit:  { name: 'Drunk Bandit', zones: [0.2, 0.5, 0.3], weapon: 'dagger', hpMul: 0.9, dmgMul: 0.9, vis: 0.65, hear: 0.5, shout: 1.4, sway: true },
  rat:     { name: 'Giant Rat',    zones: [0, 0.2, 0.8], model: 'quad', hpMul: 0.2, dmgMul: 0.35, speed: 1.1, reach: 0.6, windMul: 0.6, r: 0.25, scale: 0.5, height: 0.45, vis: 0.8, hear: 1.4, fur: 0x6a5a48 },
  wolf:    { name: 'Tamed Wolf',   zones: [0, 0.5, 0.5], model: 'quad', hpMul: 0.7, dmgMul: 0.8, speed: 1.3, reach: 1.3, windMul: 0.6, cdMul: 0.85, r: 0.4, scale: 1, height: 0.95, vis: 0.6, smell: 7, shout: 1.4, sneakCap: 2, fur: 0x7a7e86 },
  bouncer: { name: 'Bouncer',      zones: [0.3, 0.5, 0.2], weapon: 'mace', hpMul: 2.2, dmgMul: 1.5, speed: 0.9, reach: 1.15, windMul: 1.3, r: 0.55, scale: 1.3, noStagger: true, sneakCap: 2.5, skin: 0x7d8672 },
};
for (const t of Object.values(ENEMY_TYPES)) {   // fill the defaults so the rest of the code never checks for undefined
  Object.assign(t, { model: 'biped', hpMul: 1, dmgMul: 1, speed: 1, reach: 1, windMul: 1, cdMul: 1, vis: 1, hear: 1, smell: 0, shout: 1, sneakCap: 99, r: 0.4, scale: 0, ...t });
}

// Natives per theme: common natives fill most of the population, the elite shows up on floors 3 and 4.
// Only the Sunken Tavern has natives so far. Every theme keeps goblins, and wolves go with any theme.
const THEME_NATIVES = {
  'The Sunken Tavern': { commons: ['cook', 'bandit', 'rat'], elite: 'bouncer', prefer: { cook: 'messhall', bandit: 'barracks', rat: 'storeroom' } },
};
// Share of a floor's guards that are natives: low on floor 1 so the basics are learned on plain goblins.
const NATIVE_SHARE = [0.3, 0.45, 0.6, 0.7, 0.7];
const MAX_NATIVE_TYPES = 3;

const roomOf = (f, x, y) => f.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const nearPoint = (f, x, y, k) => {   // an open tile beside (x, y)
  for (let j = 0; j < 8; j++) {
    const [dx, dy] = NEIGH8[(k + j) % 8], i = (y + dy) * f.w + x + dx;
    if (f.tiles[i] === T_FLOOR && !f.blocked[i]) return { x: x + dx, y: y + dy };
  }
  return { x, y };
};

// Turns some of a generated floor's plain guard specs into natives, adds rat packs and wolves with
// handlers. Works on the floor's `enemies` list in place and never touches the layout, so floors stay
// identical for a seed apart from who lives on them. Deterministic from the seed.
function assignEnemyTypes(f, seed, floorNum, themeName) {
  const rng = makeRng(((seed ^ 0x9e3779b9) >>> 0) + floorNum * 40503);
  const roster = THEME_NATIVES[themeName];
  const guards = f.enemies.filter(e => !e.boss);
  const seedOf = () => (rng() * 4294967296) >>> 0;
  // Wolves keep a goblin handler (from floor 2, up to 3). Reserve the handlers first so natives never take them.
  const wolves = floorNum >= 2 ? Math.min(3, floorNum - 1) : 0;
  const handlers = rng.shuffle(f.enemies.map((e, i) => i).filter(i => !f.enemies[i].boss)).slice(0, wolves);
  const reserved = new Set(handlers.map(i => f.enemies[i]));
  if (roster) {
    const commons = rng.shuffle(roster.commons.slice()).slice(0, MAX_NATIVE_TYPES - (roster.elite && floorNum >= 3 && floorNum <= 4 ? 1 : 0));
    const free = guards.filter(g => !reserved.has(g));
    const share = Math.min(1, NATIVE_SHARE[Math.min(floorNum, 5) - 1] * guards.length / Math.max(1, free.length));   // reserved handlers stay goblins, so the rest carry the share
    const solo = commons.filter(t => ENEMY_TYPES[t].model !== 'quad');
    let eliteLeft = roster.elite && floorNum >= 3 && floorNum <= 4 ? 1 : 0;
    for (const g of rng.shuffle(free.slice())) {
      if (eliteLeft && rng() < 0.35) { g.type = roster.elite; eliteLeft--; continue; }
      if (!solo.length || rng() > share) continue;
      const room = roomOf(f, g.x, g.y), weights = solo.map(t => roster.prefer[t] && room && room.theme === roster.prefer[t] ? 4 : 1);
      g.type = solo[weightedIndex(rng, weights)];
    }
    if (eliteLeft) { const g = free.find(e => e.type !== roster.elite); if (g) g.type = roster.elite; }   // the elite always turns up on floors 3 and 4
    if (!guards.some(g => !g.type)) { const g = guards.find(g => g.type !== roster.elite); if (g) delete g.type; }   // always leave at least one plain goblin
    if (commons.includes('rat')) {                                                           // rat packs of 3, in a storeroom if there is one
      const packs = floorNum >= 3 ? 2 : 1, homes = f.rooms.filter((r, i) => i > 0 && !r.locked && r.theme !== 'shop');
      for (let p = 0; p < packs && homes.length; p++) {
        const store = homes.filter(r => r.theme === 'storeroom'), home = rng.pick(store.length ? store : homes);
        for (let k = 0; k < 3; k++) {
          const a = roomPoint(f, home, k * 3 + p), b = roomPoint(f, home, k * 3 + p + 4);
          f.enemies.push({ x: a.x, y: a.y, route: [a, b], seed: seedOf(), type: 'rat' });
        }
      }
    }
  }
  // The wolves: same route as the handler, and they follow it around.
  handlers.forEach((hi, w) => {
    const h = f.enemies[hi], a = nearPoint(f, h.x, h.y, w * 3);
    f.enemies.push({ x: a.x, y: a.y, route: h.route.map(p => ({ ...p })), seed: seedOf(), type: 'wolf', handler: hi });
  });
  return f;
}
function weightedIndex(rng, w) { let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; }

// The type for a guard that turns up later (the floor 3+ respawns): mostly plain goblins, natives per the floor's share.
function respawnType(themeName, floorNum, rnd) {
  const roster = THEME_NATIVES[themeName];
  if (!roster || rnd() > NATIVE_SHARE[Math.min(floorNum, 5) - 1]) return 'goblin';
  const solo = roster.commons.filter(t => ENEMY_TYPES[t].model !== 'quad');
  return solo[Math.floor(rnd() * solo.length)];
}

// After the floor's enemies are built: point each wolf at its handler.
function linkHandlers(list) {
  list.forEach(e => { if (e.spec.handler !== undefined) e.handlerRef = list[e.spec.handler] || null; });
}
