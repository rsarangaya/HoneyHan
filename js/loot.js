// Items, tiers, loot tables, and the player's inventory.
// Pickups go to the backpack only. Quickslots, equipping and dropping are the player's choice.
const QUIVER_MAX = 25;
const SWAP_TIME = 0.5;
const PACK_MAX = 16;
const POTION_HEAL = 40;

// ---- tiers: every weapon and armor piece has one. The multiplier scales damage or protection ----
const TIERS = [
  { name: 'Common',    color: '#c8c8c8', mul: 1.0 },
  { name: 'Uncommon',  color: '#5fd35f', mul: 1.15 },
  { name: 'Rare',      color: '#5a8cff', mul: 1.3 },
  { name: 'Epic',      color: '#b05cff', mul: 1.5 },
  { name: 'Legendary', color: '#ff9a2a', mul: 1.75 },
];
const TIER_ADJ = ['Worn', 'Sturdy', 'Fine', 'Masterwork', ''];
const WEAPON_NAMES = { dagger: 'Dagger', sword: 'Sword', mace: 'Mace', bow: 'Bow' };
const LEGENDARY_NAMES = { dagger: 'Nightfang', sword: 'Dawnsplitter', mace: 'Skullmaul', bow: 'Windsong' };

// Armor: three slots, three weight classes. Heavier protects more but is louder to move in.
const ARMOR_SLOTS = ['helmet', 'chest', 'boots'];
const ARMOR_NAMES = {
  helmet: ['Leather Cap', 'Iron Helm', 'Great Helm'],
  chest:  ['Leather Jerkin', 'Chainmail', 'Plate Cuirass'],
  boots:  ['Leather Boots', 'Iron Greaves', 'Plated Sabatons'],
};
const ARMOR_RED = [0.10, 0.20, 0.30];          // share of damage cut at tier 0, by weight class
const ARMOR_NOISE = [0, 1, 2];                 // extra noise radius in metres per piece
const ARMOR_ZONE = { helmet: 'head', chest: 'body', boots: 'legs' };
const ARMOR_LABEL = { helmet: 'Helmet', chest: 'Chest', boots: 'Boots' };

const POTIONS = {
  heal:      { name: 'Healing Potion',   color: '#e8434b', weight: 40, desc: `Restores ${POTION_HEAL} HP.` },
  stamina:   { name: 'Vigor Potion',     color: '#4cc36a', weight: 20, desc: 'Refills stamina and doubles its regen for 20 s.' },
  swift:     { name: 'Swiftness Potion', color: '#4cc3e8', weight: 12, desc: 'Move 35% faster for 25 s.' },
  might:     { name: 'Might Potion',     color: '#e8903a', weight: 10, desc: 'Deal 40% more damage for 25 s.' },
  stoneskin: { name: 'Stoneskin Potion', color: '#a8a8b8', weight: 10, desc: 'Take 25% less damage for 30 s.' },
  shadow:    { name: 'Shadow Potion',    color: '#8a5ae8', weight: 8,  desc: 'Guards see half as far and notice you slower for 25 s.' },
};
const BUFF_TIME = { vigor: 20, swift: 25, might: 25, stoneskin: 30, shadow: 25 };
const POTION_BUFF = { stamina: 'vigor', swift: 'swift', might: 'might', stoneskin: 'stoneskin', shadow: 'shadow' };

// Interaction labels and hold times for everything you can search or use.
const PROP_INFO = {
  chest:     { label: 'Open chest',       time: 0.9 },
  barrel:    { label: 'Search barrel',    time: 1.5 },
  rubble:    { label: 'Search rubble',    time: 1.8 },
  corpse:    { label: 'Loot body',        time: 1.0 },
  rack:      { label: 'Take from rack',   time: 0.8 },
  potions:   { label: 'Take potions',     time: 1.0 },
  vaultchest:{ label: 'Open vault chest', time: 1.2 },
  door:      { label: 'Unlock door',      time: 0.6 },
};

// ---- item construction and display ----
let nextItemId = 1;
// A drop descriptor (what loot tables return) becomes a real item with an id once picked up.
function makeItem(d) {
  const id = nextItemId++;
  switch (d.type) {
    case 'weapon': return { id, type: 'weapon', base: d.base, tier: d.tier };
    case 'armor':  return { id, type: 'armor', slot: d.slot, cls: d.cls, tier: d.tier };
    case 'potion': return { id, type: 'potion', kind: d.kind, n: d.n || 1 };
    case 'key':    return { id, type: 'key', lock: d.lock, label: d.label };
  }
}

function itemName(it) {
  if (it.type === 'weapon') return it.tier === 4 ? LEGENDARY_NAMES[it.base] : `${TIER_ADJ[it.tier]} ${WEAPON_NAMES[it.base]}`;
  if (it.type === 'armor') return `${it.tier === 4 ? 'Ancient' : TIER_ADJ[it.tier]} ${ARMOR_NAMES[it.slot][it.cls]}`;
  if (it.type === 'potion') return POTIONS[it.kind].name;
  return it.label;
}
const itemColor = it => it.type === 'potion' ? POTIONS[it.kind].color : it.type === 'key' ? '#e8c860' : TIERS[it.tier].color;
const tierName = it => it.tier === undefined ? '' : TIERS[it.tier].name;

// Weapon stats with the tier multiplier applied to damage.
function weaponStats(it) {
  const b = WSTATS[it.base];
  return b.ranged ? b : { ...b, dmg: b.dmg * TIERS[it.tier].mul, atkSpd: b.spd * TUNE.playerAtkSpd, dur: b.dur / (b.spd * TUNE.playerAtkSpd) };   // dur is the real swing time
}
const armorStats = it => ({ red: Math.min(0.6, ARMOR_RED[it.cls] * TIERS[it.tier].mul), noise: ARMOR_NOISE[it.cls] });

// Lines of detail text for the inventory screen.
function itemLines(it) {
  if (it.type === 'weapon') {
    const s = weaponStats(it);
    if (s.ranged) return ['Ranged. Not usable yet.'];
    return [`Damage ${s.dmg.toFixed(1)}`, `Attack speed x${s.atkSpd.toFixed(2)} (swing ${s.dur.toFixed(2)} s), reach ${s.reach.toFixed(1)} m`, `Stamina ${s.stam}, noise ${s.noise} m`,
      s.sneak >= 99 ? 'Sneak attack: instant kill' : `Sneak attack x${s.sneak}`,
      s.blockCost > 0 ? `Block costs ${s.blockCost} stamina` : s.parryWin > 0 ? 'Parry only, no normal block' : 'Weak block'];
  }
  if (it.type === 'armor') {
    const a = armorStats(it);
    return [`Cuts ${Math.round(a.red * 100)}% of damage to the ${ARMOR_ZONE[it.slot]}`,
      a.noise ? `Makes you ${a.noise} m louder when moving` : 'Silent'];
  }
  if (it.type === 'potion') return [POTIONS[it.kind].desc, `You have ${it.n}`];
  return ['Opens a locked door on this floor.'];
}

// ---- random generation ----
const weighted = (rng, weights) => {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
};
// Deeper floors push the odds toward higher tiers. boost adds whole tiers (vaults, armory).
function rollTier(floorNum, rng, boost = 0) {
  const f = floorNum;
  return Math.min(4, weighted(rng, [Math.max(10, 60 - 7 * f), 28 + 2 * f, 9 + 3 * f, 2.5 + 1.6 * f, 0.4 + 0.5 * f]) + boost);
}
const rollPotionKind = rng => Object.keys(POTIONS)[weighted(rng, Object.values(POTIONS).map(p => p.weight))];
function rollEquipment(floorNum, rng, { boost = 0, minTier = 0, kind } = {}) {
  const tier = Math.max(minTier, rollTier(floorNum, rng, boost));
  if (kind === 'weapon' || (!kind && rng() < 0.35)) return { type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace']), tier };
  return { type: 'armor', slot: rng.pick(ARMOR_SLOTS), cls: weighted(rng, [50, 35, 15]), tier };
}

// Returns a list of drop descriptors. rng is seeded per prop so a seed repeats.
// bonus raises drop chances (clean sneak kills leave intact gear).
function rollLoot(kind, floorNum, rng, bonus = 0, gear = []) {
  const out = [];
  const potion = () => ({ type: 'potion', kind: rollPotionKind(rng), n: 1 });
  if (kind === 'corpse') {
    // a guard drops at most ONE thing; one of the pieces it was visibly carrying is the likeliest
    if (rng() < 0.7 + bonus) {
      const opts = [[{ type: 'gold', n: rng.int(4, 14) }, 4], [{ type: 'arrows', n: rng.int(2, 5) }, 2], [potion(), 1.5], ...gear.map(g => [g, 3])];
      out.push(opts[weighted(rng, opts.map(o => o[1]))][0]);
    }
  } else if (kind === 'chest') {
    out.push({ type: 'gold', n: rng.int(10, 25) + floorNum * 4 });
    if (rng() < 0.65) out.push({ type: 'arrows', n: rng.int(4, 8) });
    if (rng() < 0.4) out.push(potion());
    if (rng() < 0.4) out.push(rollEquipment(floorNum, rng));
  } else if (kind === 'vaultchest') {
    out.push({ type: 'gold', n: rng.int(40, 90) + floorNum * 10 });
    if (rng() < 0.7) out.push(potion());
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1 }));
  } else if (kind === 'rack') {
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1, kind: rng() < 0.5 ? 'weapon' : 'armor' }));   // armory: weapon or armor, nothing below uncommon
  } else if (kind === 'potions') {
    out.push(potion());                                                      // one per shelf; a room has 1 to 3 shelves
  } else {   // barrel, rubble: smaller and less certain, the search time is the cost
    if (rng() < 0.45) out.push({ type: 'arrows', n: rng.int(2, 4) });
    if (rng() < 0.4) out.push({ type: 'gold', n: rng.int(3, 10) });
    if (rng() < 0.2) out.push(potion());
    if (kind === 'rubble' && rng() < 0.06) out.push(rollEquipment(floorNum, rng, { kind: 'weapon' }));
  }
  return out;
}

// ---- the inventory ----
class Inventory {
  constructor() {
    this.hp = 100; this.maxHp = 100;
    this.gold = 0; this.arrows = 0;
    this.pack = [];                                       // items, up to PACK_MAX
    this.equip = { weapon: makeItem({ type: 'weapon', base: 'sword', tier: 0 }), helmet: null, chest: null, boots: null };
    this.quick = [null, null, null, null];                // item ids; the item stays in the pack (or is the old weapon after a swap)
    this.swapT = 0;
    this.buffs = {};                                      // name -> seconds left
    this.refillStamina = false;                           // set by the vigor potion, read by main
  }

  get weapon() { return this.equip.weapon.base; }         // base id, so WSTATS lookups still work

  find(id) { return this.pack.find(i => i.id === id) || null; }
  quickItem(i) { const it = this.quick[i] && this.find(this.quick[i]); if (!it) this.quick[i] = null; return it || null; }
  full() { return this.pack.length >= PACK_MAX; }

  // Adds a drop descriptor. Returns text for the pickup message, or null if it did not fit.
  add(d) {
    discoverItem(d);                                      // glossary entry (controls.js)
    if (d.type === 'gold') { this.gold += d.n; return `${d.n} gold`; }
    if (d.type === 'arrows') {
      const got = Math.min(d.n, QUIVER_MAX - this.arrows);
      if (got <= 0) return null;
      this.arrows += got; return `${got} arrows`;
    }
    if (d.type === 'potion') {
      const s = this.pack.find(i => i.type === 'potion' && i.kind === d.kind);
      if (s) { s.n += d.n || 1; return POTIONS[d.kind].name; }
    }
    if (this.full()) return null;
    const it = makeItem(d);
    this.pack.push(it);
    return it.type === 'weapon' || it.type === 'armor' ? `[${tierName(it)}] ${itemName(it)}` : itemName(it);
  }

  has(type, lock) { return this.pack.some(i => i.type === type && (lock === undefined || i.lock === lock)); }
  remove(it) {
    this.pack = this.pack.filter(i => i !== it);
    this.quick = this.quick.map(id => id === it.id ? null : id);
  }

  // Equip from the pack. The item that was in that slot goes back to the pack, in the same spot.
  equipItem(it) {
    const slot = it.type === 'weapon' ? 'weapon' : it.slot;
    const idx = this.pack.indexOf(it);
    if (idx < 0 || !slot) return;
    const old = this.equip[slot];
    this.quick = this.quick.map(id => id === it.id ? null : id);
    this.equip[slot] = it;
    if (old) this.pack[idx] = old; else this.pack.splice(idx, 1);
  }
  unequip(slot) {
    const it = this.equip[slot];
    if (!it || slot === 'weapon' || this.full()) return false;
    this.pack.push(it); this.equip[slot] = null;
    return true;
  }
  assignQuick(i, it) {
    this.quick = this.quick.map(id => id === it.id ? null : id);
    this.quick[i] = it.id;
  }

  drink(it) {
    const k = it.kind;
    if (k === 'heal') {
      if (this.hp >= this.maxHp) return 'Already at full health';
      this.hp = Math.min(this.maxHp, this.hp + POTION_HEAL);
    } else {
      if (k === 'stamina') this.refillStamina = true;
      this.buffs[POTION_BUFF[k]] = BUFF_TIME[POTION_BUFF[k]];
    }
    if (--it.n <= 0) this.remove(it);
    return `Drank a ${POTIONS[k].name}`;
  }

  // Quickslot press: a weapon swaps with the equipped one (the old weapon takes the slot), a potion is drunk.
  use(i) {
    const it = this.quickItem(i);
    if (!it || this.swapT > 0) return '';
    if (it.type === 'weapon') {
      const old = this.equip.weapon;
      this.equipItem(it);
      this.quick[i] = old.id;
      this.swapT = SWAP_TIME;
      return `Equipped ${itemName(it)}`;
    }
    if (it.type === 'potion') return this.drink(it);
    return '';
  }

  // 0 to 0.8 share of damage cut for a body zone ('head' | 'body' | 'legs').
  armorRed(zone) {
    let r = this.buffs.stoneskin > 0 ? 0.25 : 0;
    for (const s of ARMOR_SLOTS) if (ARMOR_ZONE[s] === zone && this.equip[s]) r += armorStats(this.equip[s]).red;
    return Math.min(0.8, r);
  }
  armorNoise() { return ARMOR_SLOTS.reduce((n, s) => n + (this.equip[s] ? armorStats(this.equip[s]).noise : 0), 0); }

  update(dt) {
    if (this.swapT > 0) this.swapT = Math.max(0, this.swapT - dt);
    for (const k in this.buffs) if ((this.buffs[k] -= dt) <= 0) delete this.buffs[k];
  }
}
