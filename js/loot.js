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
const BUFF_TIME = { vigor: 20, swift: 25, might: 25, stoneskin: 30, shadow: 25, hearty: 30 };
const POTION_BUFF = { stamina: 'vigor', swift: 'swift', might: 'might', stoneskin: 'stoneskin', shadow: 'shadow' };

// Food feeds the hunger meter (js/hunger.js). It never heals. time: seconds to eat. weight: how common. buff: a timed bonus.
const FOOD = {
  bread:  { name: 'Bread',     color: '#d9b57a', feed: 25, time: 1.2, weight: 30, desc: 'A hard loaf. Feeds 25.' },
  cheese: { name: 'Cheese',    color: '#f0d060', feed: 20, time: 1.0, weight: 20, desc: 'A wedge of sharp cheese. Feeds 20.' },
  jerky:  { name: 'Dried Meat', color: '#b0604a', feed: 30, time: 1.4, weight: 20, desc: 'Tough and salty. Feeds 30.' },
  apple:  { name: 'Apple',     color: '#c8493a', feed: 10, time: 0.6, weight: 25, desc: 'Quick to eat. Feeds 10.' },
  stew:   { name: 'Hot Stew',  color: '#e0883a', feed: 45, time: 2.0, weight: 0, buff: 'hearty', desc: 'A hot meal. Feeds 45 and stamina regenerates 50% faster for 30 s. Rare: cooks and pantries.' },
};
// Weighted food kind. stewWeight sets how likely the rare stew is.
const rollFoodKind = (rng, stewWeight = 0) => { const ks = Object.keys(FOOD); return ks[weighted(rng, ks.map(k => k === 'stew' ? stewWeight : FOOD[k].weight))]; };

// Interaction labels and hold times for everything you can search or use.
const PROP_INFO = {
  chest:     { label: 'Open chest',       time: 0.9 },
  barrel:    { label: 'Search barrel',    time: 1.5 },
  rubble:    { label: 'Search rubble',    time: 1.8 },
  corpse:    { label: 'Loot body',        time: 1.0 },
  rack:      { label: 'Take from rack',   time: 0.8 },
  potions:   { label: 'Take potions',     time: 1.0 },
  pantry:    { label: 'Take food',        time: 1.0 },
  vaultchest:{ label: 'Open vault chest', time: 1.2 },
  door:      { label: 'Unlock door',      time: 0.6 },
  merchant:  { label: 'Trade with the merchant', time: 0.35 },
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
    case 'wand':   return { id, type: 'wand', base: 'wand', kind: d.kind, charges: d.charges !== undefined ? d.charges : WANDS[d.kind].charges };
    case 'rechargewand': return { id, type: 'rechargewand', full: !!d.full };
    case 'rage':   return { id, type: 'rage', tier: 4, charges: d.charges !== undefined ? d.charges : RAGE.charges };
    case 'shield': return { id, type: 'shield', slot: 'offhand', tier: d.tier };
    case 'food':   return { id, type: 'food', kind: d.kind, n: d.n || 1 };
  }
}

function itemName(it) {
  if (it.type === 'weapon') return it.tier === 4 ? LEGENDARY_NAMES[it.base] : `${TIER_ADJ[it.tier]} ${WEAPON_NAMES[it.base]}`;
  if (it.type === 'armor') return `${it.tier === 4 ? 'Ancient' : TIER_ADJ[it.tier]} ${ARMOR_NAMES[it.slot][it.cls]}`;
  if (it.type === 'wand') return WANDS[it.kind].name;
  if (it.type === 'rechargewand') return it.full ? 'Grand Recharge Wand' : 'Recharge Wand';
  if (it.type === 'rage') return "Hanahan's Rage";
  if (it.type === 'shield') return it.tier === 4 ? 'Aegis of Dawn' : `${TIER_ADJ[it.tier]} Shield`;
  if (it.type === 'potion') return POTIONS[it.kind].name;
  if (it.type === 'food') return FOOD[it.kind].name;
  return it.label;
}
const itemColor = it => it.type === 'wand' ? WANDS[it.kind].color : it.type === 'rechargewand' ? '#7fe8d8' : it.type === 'potion' ? POTIONS[it.kind].color : it.type === 'food' ? FOOD[it.kind].color : it.type === 'key' ? '#e8c860' : TIERS[it.tier].color;
const tierName = it => it.tier === undefined ? '' : TIERS[it.tier].name;

// Weapon stats with the tier multiplier applied to damage.
function weaponStats(it) {
  if (it.type === 'wand') return { wand: true, ranged: false, dmg: 0, stam: WAND.stam, noise: WANDS[it.kind].noise, dur: WAND.cd, hitAt: 99, reach: 0, sneak: 1, parryWin: 0, blockCost: 0, spd: 1, atkSpd: 1 };
  const b = WSTATS[it.base];
  return b.ranged ? { ...b, dmg: b.dmg * TIERS[it.tier].mul } : { ...b, dmg: b.dmg * TIERS[it.tier].mul, atkSpd: b.spd * TUNE.playerAtkSpd, dur: b.dur / (b.spd * TUNE.playerAtkSpd) };   // dur is the real swing time
}
const armorStats = it => ({ red: Math.min(0.6, ARMOR_RED[it.cls] * TIERS[it.tier].mul), noise: ARMOR_NOISE[it.cls] });

// Lines of detail text for the inventory screen.
function itemLines(it) {
  if (it.type === 'weapon') {
    const s = weaponStats(it);
    if (s.ranged) return [`Damage ${s.dmg.toFixed(1)} at a full draw (a body hit, about 65% of a sword)`, `Hold attack to draw, release to fire. Full draw ${s.draw} s, and you move slowly while drawing`, `Uses an arrow per shot. Stamina ${s.stam}, noise ${s.noise} m`, `Sneak shot x${s.sneak}, headshots hit hard, leg hits slow`, 'Right click while drawing cancels. A shield is stowed while the bow is out.'];
    return [`Damage ${s.dmg.toFixed(1)}`, `Attack speed x${s.atkSpd.toFixed(2)} (swing ${s.dur.toFixed(2)} s), reach ${s.reach.toFixed(1)} m`, `Stamina ${s.stam}, noise ${s.noise} m`,
      s.sneak >= 99 ? 'Sneak attack: instant kill' : `Sneak attack x${s.sneak}`,
      s.blockCost > 0 ? `Block costs ${s.blockCost} stamina` : s.parryWin > 0 ? 'Parry only, no normal block' : 'Weak block']
      .concat(s.proc ? [`${STATUS[s.proc.status].name} on ${s.proc.zone} hits${s.proc.chance < 1 ? ` (${Math.round(s.proc.chance * 100)}% chance)` : ''}`] : []);
  }
  if (it.type === 'armor') {
    const a = armorStats(it);
    return [`Cuts ${Math.round(a.red * 100)}% of damage to the ${ARMOR_ZONE[it.slot]}`,
      a.noise ? `Makes you ${a.noise} m louder when moving` : 'Silent'];
  }
  if (it.type === 'wand') return [WANDS[it.kind].desc, `Charges ${it.charges}/${WANDS[it.kind].charges}. Breaks at 0.`, `Stamina ${WAND.stam} per cast, noise ${WANDS[it.kind].noise} m`, 'Equip it like a weapon and attack to fire. Ignores armor and hit zones. A recharge wand tops it up.'];
  if (it.type === 'rechargewand') return [it.full ? 'Refills a wand completely, then crumbles.' : `Restores ${WAND.rechargeGain} charges to a wand, then crumbles.`, 'Works on an empty wand too. Use it from a quickslot (it picks your held wand, or the emptiest in the pack) or choose a wand in the inventory.'];
  if (it.type === 'rage') return ['Plays a recording of Hanahan talking mad smack. Enemies get angry and ragebaited into attacking each other.', `Enemies within ${RAGE.radius} m fight each other for ${RAGE.dur} s, then come looking for you. Bosses ignore it. Very loud (${RAGE.noise} m).`, `Plays left: ${it.charges}. The recorder breaks after the last.`];
  if (it.type === 'shield') return [`Block costs ${Math.round(SHIELD.cost / TIERS[it.tier].mul)} stamina (less at higher tiers)`, `Parry window ${SHIELD.parryWin} s`, `Covers leg sweeps: only ${Math.round(SHIELD.legsTake * 100)}% of the hit gets through and no slow`, `Bash: attack while blocking. Stuns for ${SHIELD.bashStun} s and shoves, ${SHIELD.bashStam} stamina`, 'Lets a dagger block properly. Stowed while a bow is out.'];
  if (it.type === 'potion') return [POTIONS[it.kind].desc, `You have ${it.n}`];
  if (it.type === 'food') return [FOOD[it.kind].desc, `Takes ${FOOD[it.kind].time} s to eat. Food feeds you, it does not heal.`, `You have ${it.n}`];
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
  if (kind === 'weapon' || (!kind && rng() < 0.35)) {
    if (rng() < 0.2) return { type: 'shield', tier };                                       // shields come with the weapons
    return { type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace', 'bow']), tier };
  }
  return { type: 'armor', slot: rng.pick(ARMOR_SLOTS), cls: weighted(rng, [50, 35, 15]), tier };
}

// Returns a list of drop descriptors. rng is seeded per prop so a seed repeats.
// bonus raises drop chances (clean sneak kills leave intact gear).
function rollLoot(kind, floorNum, rng, bonus = 0, gear = [], type = 'goblin') {
  const out = [];
  const potion = () => ({ type: 'potion', kind: rollPotionKind(rng), n: 1 });
  if (kind === 'corpse') {
    if (type === 'cook' && rng() < 0.8) { out.push({ type: 'food', kind: rng() < 0.3 ? 'stew' : rollFoodKind(rng), n: 1 }); return out; }   // a cook carries food
    if (type === 'rat') { if (rng() < 0.25 + bonus) out.push({ type: 'gold', n: rng.int(1, 4) }); return out; }   // rats carry next to nothing
    if (type === 'wolf') return out;                                                                              // a wolf leaves no gear
    if (type === 'bouncer') { out.push(rollEquipment(floorNum, rng, { minTier: 1 }), { type: 'gold', n: rng.int(10, 25) }); return out; }   // the elite always pays
    if (type === 'bandit' && rng() < 0.85) { out.push({ type: 'gold', n: rng.int(8, 25) }); return out; }          // robbers carry gold
    // a guard drops at most ONE thing; one of the pieces it was visibly carrying is the likeliest
    if (rng() < 0.7 + bonus) {
      const opts = [[{ type: 'gold', n: rng.int(4, 14) }, 4], [{ type: 'arrows', n: rng.int(2, 5) }, 2], [potion(), 1.5], ...gear.map(g => [g, 3])];
      out.push(opts[weighted(rng, opts.map(o => o[1]))][0]);
    }
  } else if (kind === 'chest') {
    out.push({ type: 'gold', n: rng.int(10, 25) + floorNum * 4 });
    if (rng() < 0.65) out.push({ type: 'arrows', n: rng.int(4, 8) });
    if (rng() < 0.4) out.push(potion());
    if (rng() < 0.12) out.push({ type: 'food', kind: rollFoodKind(rng, 1), n: 1 });
    if (rng() < 0.05) out.push({ type: 'wand', kind: rollWandKind(rng) });
    if (rng() < 0.015) out.push({ type: 'rechargewand', full: rng() < WAND.rechargeFull });
    if (rng() < 0.006) out.push({ type: 'rage' });
    if (rng() < 0.4) out.push(rollEquipment(floorNum, rng));
  } else if (kind === 'vaultchest') {
    out.push({ type: 'gold', n: rng.int(40, 90) + floorNum * 10 });
    if (rng() < 0.7) out.push(potion());
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1 }));
    if (rng() < 0.3) out.push({ type: 'wand', kind: rollWandKind(rng) });
    if (rng() < 0.08) out.push({ type: 'rechargewand', full: rng() < WAND.rechargeFull });
    if (rng() < 0.04) out.push({ type: 'rage' });
  } else if (kind === 'rack') {
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1, kind: rng() < 0.5 ? 'weapon' : 'armor' }));   // armory: weapon or armor, nothing below uncommon
  } else if (kind === 'pantry') {
    for (let i = rng() < 0.25 ? 2 : 1; i > 0; i--) out.push({ type: 'food', kind: rollFoodKind(rng, 4), n: 1 });   // a food shelf: usually one meal, sometimes two, and a small chance of stew
  } else if (kind === 'potions') {
    out.push(potion());                                                      // one per shelf; a room has 1 to 3 shelves
  } else {   // barrel, rubble: smaller and less certain, the search time is the cost
    if (rng() < 0.45) out.push({ type: 'arrows', n: rng.int(2, 4) });
    if (rng() < 0.4) out.push({ type: 'gold', n: rng.int(3, 10) });
    if (rng() < 0.2) out.push(potion());
    if (rng() < (kind === 'barrel' ? 0.07 : 0.03)) out.push({ type: 'food', kind: rollFoodKind(rng), n: 1 });
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
    this.equip = { weapon: makeItem({ type: 'weapon', base: 'sword', tier: 0 }), helmet: null, chest: null, boots: null, offhand: null };
    this.quick = [null, null, null, null];                // item ids; the item stays in the pack (or is the old weapon after a swap)
    this.swapT = 0;
    this.buffs = {};                                      // name -> seconds left
    this.rageReq = null;                                  // Hanahan's Rage: main.js plays it
    this.eatReq = null;                                   // food the player wants to eat; main.js starts the eating
    this.refillStamina = false;                           // set by the vigor potion, read by main
  }

  get weapon() { const w = this.equip.weapon; return w.type === 'wand' ? 'wand:' + w.kind : w.base; }         // base id, so WSTATS lookups still work

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
    if (d.type === 'potion' || d.type === 'food') {                   // these stack
      const s = this.pack.find(i => i.type === d.type && i.kind === d.kind);
      if (s) { s.n += d.n || 1; return d.type === 'food' ? FOOD[d.kind].name : POTIONS[d.kind].name; }
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
    const slot = it.type === 'weapon' || it.type === 'wand' ? 'weapon' : it.slot;
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
      pst.clear('bleed');                                   // a healing potion closes wounds
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
    if (it.type === 'weapon' || it.type === 'wand') {
      const old = this.equip.weapon;
      this.equipItem(it);
      this.quick[i] = old.id;
      this.swapT = SWAP_TIME;
      return `Equipped ${itemName(it)}`;
    }
    if (it.type === 'potion') return this.drink(it);
    if (it.type === 'food') { this.eatReq = it; return ''; }
    if (it.type === 'rechargewand') return this.recharge(it);
    if (it.type === 'rage') { this.rageReq = it; return "Playing Hanahan's Rage..."; }
    return '';
  }

  // Use a recharge wand on target (default: the held wand, else the emptiest wand in the pack). Returns a message.
  recharge(it, target) {
    const frac = w => w.charges / WANDS[w.kind].charges;
    const t = target || (this.equip.weapon.type === 'wand' ? this.equip.weapon : this.pack.filter(i => i.type === 'wand').sort((a, b) => frac(a) - frac(b))[0]);
    if (!t) return 'You have no wand to recharge.';
    const max = WANDS[t.kind].charges;
    if (t.charges >= max) return `The ${itemName(t)} is already full.`;
    t.charges = rechargedTo(t, it.full);
    this.remove(it);
    return `Recharged the ${itemName(t)} (${t.charges}/${max}). The recharge wand crumbles.`;
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
