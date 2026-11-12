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
const WEAPON_NAMES = { dagger: 'Dagger', sword: 'Sword', mace: 'Mace', bow: 'Bow', spear: "Ian's Hog" };
const LEGENDARY_NAMES = { dagger: 'Nightfang', sword: 'Dawnsplitter', mace: 'Skullmaul', bow: 'Windsong', spear: "Ian's Hog" };

// ---- one-of-a-kind Legendaries: each exists once per run (a flag is set when one is rolled; main.js clears them on a new run) ----
//   Ian's Hog (spear), Aj's Bust (wand), AK's Dumbass (helmet).
const UNIQUES = { hog: false, bust: false, dunce: false };
const resetUniques = () => { for (const k in UNIQUES) UNIQUES[k] = false; };
const UNIQUE_NAMES = { dunce: "AK's Dumbass" };
// AK's Dumbass, worn: Fool's Fortune (more gold), Corner Time (crouch still and unaware guards stop noticing you) and
// Cone of Shame (the first guard on a floor to spot you is stunned by laughter).
const DUNCE = { gold: 1.5, hideStill: 3, hideMax: 12, hideCd: 20, laugh: 1 };
const wearingDunce = inv => !!(inv.equip.helmet && inv.equip.helmet.unique === 'dunce');
// Flavour text for the three one-of-a-kind pieces.
function itemLore(it) {
  if (it.type === 'weapon' && it.base === 'spear') return "Ian's hog is 3 days long, as represented by this spear. Refractory period sucks.";
  if (it.type === 'wand' && it.kind === 'bust') return "Aj's coming on that ass.";
  if (it.type === 'armor' && it.unique === 'dunce') return 'You feel yourself becoming stupider.';
  return '';
}
// Ian's Hog can also be recharged by sacrificing other gear to it: Common and Uncommon +1 kill, Rare and Epic +2, Legendary full.
const SACRIFICE_GAIN = [1, 1, 2, 2, 3];
const sacrificable = it => (it.type === 'weapon' || it.type === 'armor' || it.type === 'shield') && it.base !== 'spear' && !it.unique;
// A Legendary weapon or helmet roll may turn into a unique (about one in three) if it has not turned up yet this run.
let uniqueDry = false;                                                                 // a dry run (does this body hold anything?) must not use a unique up
const dryRoll = fn => { uniqueDry = true; try { return fn(); } finally { uniqueDry = false; } };
function rollUniqueGear(rng, isWeapon) {
  const r = rng(), key = isWeapon ? 'hog' : 'dunce';
  if (r >= 0.35 || UNIQUES[key] || uniqueDry) return null;
  UNIQUES[key] = true;
  return isWeapon ? { type: 'weapon', base: 'spear', tier: 4 } : { type: 'armor', slot: 'helmet', cls: 0, tier: 4, unique: 'dunce' };
}
// The wand is rolled apart from ordinary loot: a small chance per container (p), once per run.
function rollBust(rng, p) {
  if (rng() >= p || UNIQUES.bust || uniqueDry) return null;
  UNIQUES.bust = true;
  return { type: 'wand', kind: 'bust' };
}
// Charges: a wand's remaining casts, or Ian's Hog's remaining kills (chargeMax is in wands.js). A limp Hog is a spear at 0.
const isLimp = it => !!it && it.type === 'weapon' && it.base === 'spear' && it.charges <= 0;
const rechargeable = it => it.type === 'wand' || (it.type === 'weapon' && it.base === 'spear');

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
  heal:      { name: 'Healing Potion',   color: '#e8434b', weight: 22, desc: `Restores ${POTION_HEAL} HP.` },
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

// Chests come in five grades. A better chest holds more gold, more of everything and better gear: the Silver chest
// never has gear below Uncommon, the Ornate below Rare, the Golden below Epic (with a chance of Legendary).
const CHEST_NAMES = ['Wooden Chest', 'Iron-bound Chest', 'Silver Chest', 'Ornate Chest', 'Golden Chest'];
const CHEST_BLURB = [
  'A plain wooden chest. Gold and a little of this and that.',
  'Iron bands: more gold, and a better chance of a potion or a piece of gear.',
  'Silver trim: more of everything, and any gear inside is Uncommon or better.',
  'Purple and gold: lots of gold, gear is always there and is Rare or better (sometimes a tier higher), and wands turn up.',
  'Gold and glowing: a hoard. Gear is Epic or better, with a chance of Legendary, plus gold, potions and wands.',
];

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
  altar:     { label: 'Kneel at the altar', time: 0.5 },
  questnpc:  { label: 'Talk', time: 0.4 },                                  // the wanted-guard quest-giver (js/quests.js gives the live label)
};

// Locked and trapped chests (js/gen.js CHEST_ODDS places them; main.js runs them). A lockpick picks a lock (hold E, quiet, may
// break); otherwise smash it (loud, potions inside may break). Loot from a locked chest is one grade better (gradeUp).
const LOCKPICK = { time: 3, noise: 1, breakChance: 0.3, drop: 0.06, corpseDrop: 0.25 };   // seconds, metres; drop: barrel/rubble share, corpseDrop: bandit and thief share
const LOCKED = { hits: 3, maceHits: 2, noise: 10, potionBreak: 0.5, gradeUp: 1 };         // weapon hits to smash (mace needs fewer), metres per hit, share of potions lost
const TRAP = { dart: 12, bleed: 4, gasRadius: 3, gasDaze: 4, gasSlow: 4, alarmNoise: 18, disarmMul: 2, fx: 0.9 };   // dart damage, bleed seconds, cloud metres and seconds, bell metres, disarm time multiplier, cloud fade seconds

// ---- item construction and display ----
let nextItemId = 1;
// A drop descriptor (what loot tables return) becomes a real item with an id once picked up.
function makeItem(d) {
  const id = nextItemId++;
  switch (d.type) {
    case 'weapon': return d.base === 'spear' ? { id, type: 'weapon', base: 'spear', tier: 4, charges: d.charges !== undefined ? d.charges : WSTATS.spear.kills } : { id, type: 'weapon', base: d.base, tier: d.tier };
    case 'armor':  return { id, type: 'armor', slot: d.slot, cls: d.cls, tier: d.tier, ...(d.unique ? { unique: d.unique } : {}) };
    case 'potion': return { id, type: 'potion', kind: d.kind, n: d.n || 1 };
    case 'key':    return { id, type: 'key', lock: d.lock, label: d.label };
    case 'wand':   return { id, type: 'wand', base: 'wand', kind: d.kind, charges: d.charges !== undefined ? d.charges : WANDS[d.kind].charges };
    case 'rechargewand': return { id, type: 'rechargewand', full: !!d.full };
    case 'rage':   return { id, type: 'rage', tier: 4, charges: d.charges !== undefined ? d.charges : RAGE.charges };
    case 'shield': return { id, type: 'shield', slot: 'offhand', tier: d.tier };
    case 'food':   return { id, type: 'food', kind: d.kind, n: d.n || 1 };
    case 'lockpick': return { id, type: 'lockpick', n: d.n || 1 };
  }
}

function itemName(it) {
  if (it.type === 'weapon') return it.tier === 4 ? LEGENDARY_NAMES[it.base] : `${TIER_ADJ[it.tier]} ${WEAPON_NAMES[it.base]}`;
  if (it.type === 'armor' && it.unique) return UNIQUE_NAMES[it.unique];
  if (it.type === 'armor') return `${it.tier === 4 ? 'Ancient' : TIER_ADJ[it.tier]} ${ARMOR_NAMES[it.slot][it.cls]}`;
  if (it.type === 'wand') return WANDS[it.kind].name;
  if (it.type === 'rechargewand') return it.full ? 'Grand Recharge Wand' : 'Recharge Wand';
  if (it.type === 'rage') return "Hanahan's Rage";
  if (it.type === 'shield') return it.tier === 4 ? 'Aegis of Dawn' : `${TIER_ADJ[it.tier]} Shield`;
  if (it.type === 'potion') return POTIONS[it.kind].name;
  if (it.type === 'food') return FOOD[it.kind].name;
  if (it.type === 'lockpick') return 'Lockpick';
  return it.label;
}
const itemColor = it => it.type === 'wand' ? (WANDS[it.kind].legendary ? TIERS[4].color : WANDS[it.kind].color) : it.type === 'rechargewand' ? '#7fe8d8' : it.type === 'potion' ? POTIONS[it.kind].color : it.type === 'food' ? FOOD[it.kind].color : it.type === 'key' ? '#e8c860' : it.type === 'lockpick' ? '#c8ccd4' : TIERS[it.tier].color;
const tierName = it => it.tier === undefined ? '' : TIERS[it.tier].name;

// Weapon stats with the tier multiplier applied to damage.
function weaponStats(it) {
  if (it.type === 'wand') return { wand: true, ranged: false, dmg: 0, stam: WAND.stam, noise: WANDS[it.kind].noise, dur: WAND.cd, hitAt: 99, reach: 0, sneak: 1, parryWin: 0, blockCost: 0, spd: 1, atkSpd: 1 };
  const b = WSTATS[it.base];
  if (it.base === 'spear') return { ...b, dmg: b.dmg * TIERS[it.tier].mul, atkSpd: b.spd * TUNE.playerAtkSpd, dur: b.dur / (b.spd * TUNE.playerAtkSpd), limp: it.charges <= 0 };
  return b.ranged ? { ...b, dmg: b.dmg * TIERS[it.tier].mul } : { ...b, dmg: b.dmg * TIERS[it.tier].mul, atkSpd: b.spd * TUNE.playerAtkSpd, dur: b.dur / (b.spd * TUNE.playerAtkSpd) };   // dur is the real swing time
}
const armorStats = it => ({ red: Math.min(0.6, ARMOR_RED[it.cls] * TIERS[it.tier].mul), noise: ARMOR_NOISE[it.cls] });

// Lines of detail text for the inventory screen.
function itemLines(it) {
  if (it.type === 'weapon') {
    const s = weaponStats(it);
    if (s.ranged) return [`Damage ${s.dmg.toFixed(1)} at a full draw (a body hit, about 65% of a sword)`, `Hold attack to draw, release to fire. Full draw ${s.draw} s, and you move slowly while drawing`, `Uses an arrow per shot. Stamina ${s.stam}, noise ${s.noise} m`, `Sneak shot x${s.sneak}, headshots hit hard, leg hits slow`, 'Right click while drawing cancels. A shield is stowed while the bow is out.'];
    if (it.base === 'spear') return [it.charges <= 0 ? "LIMP. It has gone soft and cannot attack. A Recharge Wand stiffens it again." : `Kills left before it goes limp: ${it.charges}/${s.kills}`,
      `Damage ${s.dmg.toFixed(1)} (the same as a Legendary sword), thrust speed x${s.atkSpd.toFixed(2)}`, `Reach ${s.reach.toFixed(1)} m: three times the sword's ${WSTATS.sword.reach} m`, `Stamina ${s.stam}, noise ${s.noise} m`, `Sneak attack x${s.sneak}`, 'No block of its own (a shield lets it block). Only kills tire it, not misses.', 'Recharge it with a Recharge Wand, or sacrifice other gear to it (Common/Uncommon +1 kill, Rare/Epic +2, Legendary full).', 'One of a kind: only one Ian\'s Hog exists per run.'];
    return [`Damage ${s.dmg.toFixed(1)}`, `Attack speed x${s.atkSpd.toFixed(2)} (swing ${s.dur.toFixed(2)} s), reach ${s.reach.toFixed(1)} m`, `Stamina ${s.stam}, noise ${s.noise} m`,
      s.sneak >= 99 ? 'Sneak attack: instant kill' : `Sneak attack x${s.sneak}`,
      s.blockCost > 0 ? `Block costs ${s.blockCost} stamina` : s.parryWin > 0 ? 'Parry only, no normal block' : 'Weak block']
      .concat(s.proc ? [`${STATUS[s.proc.status].name} on ${s.proc.zone} hits${s.proc.chance < 1 ? ` (${Math.round(s.proc.chance * 100)}% chance)` : ''}`] : []);
  }
  if (it.type === 'armor') {
    const a = armorStats(it);
    if (it.unique === 'dunce') return [`Cuts ${Math.round(a.red * 100)}% of damage to the head`, 'Silent', "Fool's Fortune: you find 50% more gold.", `Corner Time: crouch perfectly still for ${DUNCE.hideStill} s and guards that have not noticed you stop noticing you (until you move, a guard is alerted, or ${DUNCE.hideMax} s pass; then ${DUNCE.hideCd} s before it works again).`, 'Cone of Shame: the first guard on each floor to spot you bursts out laughing and is stunned for 1 s.', 'A tall, floppy paper cone with a big letter D on it.', 'One of a kind: only one exists per run.'];
    return [`Cuts ${Math.round(a.red * 100)}% of damage to the ${ARMOR_ZONE[it.slot]}`,
      a.noise ? `Makes you ${a.noise} m louder when moving` : 'Silent'];
  }
  if (it.type === 'wand') return [WANDS[it.kind].desc, `Charges ${it.charges}/${WANDS[it.kind].charges}. Breaks at 0.`, `Stamina ${WAND.stam} per cast, noise ${WANDS[it.kind].noise} m`, 'Equip it like a weapon and attack to fire. Ignores armor and hit zones. A recharge wand tops it up.'].concat(WANDS[it.kind].legendary ? ['One of a kind: only one exists per run.'] : []);
  if (it.type === 'rechargewand') return [it.full ? 'Refills a wand completely, then crumbles.' : `Restores ${WAND.rechargeGain} charges to a wand, then crumbles.`, 'Also stiffens a limp Ian\'s Hog. Works on an empty wand too. Use it from a quickslot (it picks your held wand, or the emptiest in the pack) or choose a wand in the inventory.'];
  if (it.type === 'rage') return ['Plays a recording of Hanahan talking mad smack. Enemies get angry and ragebaited into attacking each other.', `Enemies within ${RAGE.radius} m fight each other for ${RAGE.dur} s, then come looking for you. Bosses ignore it. Very loud (${RAGE.noise} m).`, `Plays left: ${it.charges}. The recorder breaks after the last.`];
  if (it.type === 'shield') return [`Block costs ${Math.round(SHIELD.cost / TIERS[it.tier].mul)} stamina (less at higher tiers)`, `Parry window ${SHIELD.parryWin} s`, `Covers leg sweeps: only ${Math.round(SHIELD.legsTake * 100)}% of the hit gets through and no slow`, `Bash: attack while blocking. Stuns for ${SHIELD.bashStun} s and shoves, ${SHIELD.bashStam} stamina`, 'Lets a dagger block properly. Stowed while a bow is out.'];
  if (it.type === 'potion') return [POTIONS[it.kind].desc, `You have ${it.n}`];
  if (it.type === 'food') return [FOOD[it.kind].desc, `Takes ${FOOD[it.kind].time} s to eat. Food feeds you, it does not heal.`, `You have ${it.n}`];
  if (it.type === 'lockpick') return [`Picks a locked chest: hold the interact key for about ${LOCKPICK.time} s. Quiet (${LOCKPICK.noise} m).`, `Each attempt has a ${Math.round(LOCKPICK.breakChance * 100)}% chance to snap the pick.`, `You have ${it.n}`];
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
  const isWeapon = kind === 'weapon' || (!kind && rng() < 0.35);
  if (tier === 4 && (isWeapon || kind === 'armor' || !kind)) {                          // Legendary: maybe one of the one-of-a-kind pieces
    const slot = isWeapon ? null : rng.pick(ARMOR_SLOTS);
    const u = (isWeapon || slot === 'helmet') ? rollUniqueGear(rng, isWeapon) : null;
    if (u) return u;
    if (!isWeapon) return { type: 'armor', slot, cls: weighted(rng, [50, 35, 15]), tier };
  } else if (!isWeapon) return { type: 'armor', slot: rng.pick(ARMOR_SLOTS), cls: weighted(rng, [50, 35, 15]), tier };
  if (isWeapon) {
    if (rng() < 0.2) return { type: 'shield', tier };                                       // shields come with the weapons
    return { type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace', 'bow']), tier };
  }
}

// Returns a list of drop descriptors. rng is seeded per prop so a seed repeats.
// bonus raises drop chances (clean sneak kills leave intact gear).
function rollLoot(kind, floorNum, rng, bonus = 0, gear = [], type = 'goblin', tier = 0) {
  const out = rollLootBase(kind, floorNum, rng, bonus, gear, type, tier);
  // the lockpick roll comes last so the rest of every table keeps its seeded results
  if (kind === 'barrel' || kind === 'rubble' ? rng() < LOCKPICK.drop : kind === 'corpse' && (type === 'bandit' || type === 'thief') && rng() < LOCKPICK.corpseDrop) out.push({ type: 'lockpick', n: 1 });
  return out;
}
function rollLootBase(kind, floorNum, rng, bonus, gear, type, tier) {
  const out = [];
  const potion = () => ({ type: 'potion', kind: rollPotionKind(rng), n: 1 });
  if (kind === 'corpse') {
    if (type === 'cook' && rng() < 0.8) { out.push({ type: 'food', kind: rng() < 0.3 ? 'stew' : rollFoodKind(rng), n: 1 }); return out; }   // a cook carries food
    if (type === 'rat') { if (rng() < 0.25 + bonus) out.push({ type: 'gold', n: rng.int(1, 4) }); return out; }   // rats carry next to nothing
    if (type === 'archer' && rng() < 0.7) { out.push({ type: 'arrows', n: rng.int(3, 6) }); return out; }                  // archers carry arrows
    if (type === 'shaman') { if (rng() < 0.1) out.push({ type: 'wand', kind: rollWandKind(rng) }); else if (rng() < 0.5) out.push(potion()); return out; }
    if (type === 'brute') { if (rng() < 0.6) out.push(rollEquipment(floorNum, rng, { minTier: 2 })); out.push({ type: 'gold', n: rng.int(5, 12) }); return out; }
    if (type === 'miniboss') {                                                                                    // guaranteed Rare or better gear plus gold, richer deeper down (QUESTS.miniboss)
      const q = QUESTS.miniboss;
      out.push(rollEquipment(floorNum, rng, { minTier: q.minTier }), { type: 'gold', n: rng.int(q.goldMin, q.goldMax) + q.goldPerFloor * floorNum });
      if (rng() < q.potion) out.push(potion());
      return out;
    }
    if (type === 'sackthief') {                                                                                   // the loot sack: gold plus one Uncommon or better item (QUESTS.thief)
      const q = QUESTS.thief;
      out.push({ type: 'gold', n: rng.int(q.goldMin, q.goldMax) + q.goldPerFloor * floorNum }, rollEquipment(floorNum, rng, { minTier: q.minTier }));
      return out;
    }
    if (type === 'wolf') return out;                                                                            // a wolf leaves no gear
    if (type === 'bouncer') { out.push(rollEquipment(floorNum, rng, { minTier: 1 }), { type: 'gold', n: rng.int(6, 15) }); return out; }   // the elite always pays
    if (type === 'bandit' && rng() < 0.85) { out.push({ type: 'gold', n: rng.int(5, 15) }); return out; }          // robbers carry gold
    // a guard drops at most ONE thing; one of the pieces it was visibly carrying is the likeliest
    if (rng() < 0.7 + bonus) {
      const opts = [[{ type: 'gold', n: rng.int(3, 9) }, 4], [{ type: 'arrows', n: rng.int(2, 5) }, 2], [potion(), 1], ...gear.map(g => [g, 3])];
      out.push(opts[weighted(rng, opts.map(o => o[1]))][0]);
    }
  } else if (kind === 'chest') {
    const t = Math.max(0, Math.min(4, tier | 0));                                      // the chest's grade, 0 (wooden) to 4 (golden)
    out.push({ type: 'gold', n: Math.round(Math.round((rng.int(10, 25) + floorNum * 4) * (1 + 0.6 * t)) * 0.6) });
    if (rng() < 0.65) out.push({ type: 'arrows', n: rng.int(4, 8) });
    if (rng() < 0.20 + 0.05 * t) out.push(potion());
    if (rng() < 0.08) out.push({ type: 'food', kind: rollFoodKind(rng, 1), n: 1 });
    if (rng() < 0.05 + 0.05 * t) out.push({ type: 'wand', kind: rollWandKind(rng) });
    if (rng() < 0.015 + 0.012 * t) out.push({ type: 'rechargewand', full: rng() < WAND.rechargeFull });
    if (rng() < 0.006 + (t >= 3 ? 0.03 : 0)) out.push({ type: 'rage' });
    const bust = rollBust(rng, 0.004 + (t >= 3 ? 0.02 : 0)); if (bust) out.push(bust);
    if (rng() < [0.4, 0.5, 0.75, 1, 1][t]) out.push(rollEquipment(floorNum, rng, { boost: t >= 3 ? 1 : 0, minTier: t >= 2 ? t - 1 : 0 }));
  } else if (kind === 'vaultchest') {
    out.push({ type: 'gold', n: rng.int(25, 55) + floorNum * 6 });
    if (rng() < 0.7) out.push(potion());
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1 }));
    if (rng() < 0.3) out.push({ type: 'wand', kind: rollWandKind(rng) });
    if (rng() < 0.08) out.push({ type: 'rechargewand', full: rng() < WAND.rechargeFull });
    if (rng() < 0.04) out.push({ type: 'rage' });
    const bust = rollBust(rng, 0.03); if (bust) out.push(bust);
  } else if (kind === 'rack') {
    out.push(rollEquipment(floorNum, rng, { boost: 1, minTier: 1, kind: rng() < 0.5 ? 'weapon' : 'armor' }));   // armory: weapon or armor, nothing below uncommon
  } else if (kind === 'pantry') {
    for (let i = rng() < 0.25 ? 2 : 1; i > 0; i--) out.push({ type: 'food', kind: rollFoodKind(rng, 4), n: 1 });   // a food shelf: usually one meal, sometimes two, and a small chance of stew
  } else if (kind === 'potions') {
    out.push(potion());                                                      // one per shelf; a room has 1 to 2 shelves
  } else {   // barrel, rubble: smaller and less certain, the search time is the cost
    if (rng() < 0.45) out.push({ type: 'arrows', n: rng.int(2, 4) });
    if (rng() < 0.4) out.push({ type: 'gold', n: rng.int(2, 6) });
    if (rng() < 0.1) out.push(potion());
    if (rng() < (kind === 'barrel' ? 0.04 : 0.02)) out.push({ type: 'food', kind: rollFoodKind(rng), n: 1 });
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
    this.stamBonus = 0;                                   // permanent stamina regen bonus for the run (shrine bargain), as a fraction
    this.refillStamina = false;                           // set by the vigor potion, read by main
  }

  get weapon() { const w = this.equip.weapon; return w.type === 'wand' ? 'wand:' + w.kind : w.base; }         // base id, so WSTATS lookups still work

  find(id) { return this.pack.find(i => i.id === id) || null; }
  quickItem(i) { const it = this.quick[i] && this.find(this.quick[i]); if (!it) this.quick[i] = null; return it || null; }
  full() { return this.pack.length >= PACK_MAX; }

  // Adds a drop descriptor. Returns text for the pickup message, or null if it did not fit.
  add(d) {
    discoverItem(d);                                      // glossary entry (controls.js)
    if (d.type === 'gold') { const n = wearingDunce(this) ? Math.round(d.n * DUNCE.gold) : d.n; this.gold += n; return `${n} gold${n !== d.n ? " (Fool's Fortune)" : ''}`; }
    if (d.type === 'arrows') {
      const got = Math.min(d.n, QUIVER_MAX - this.arrows);
      if (got <= 0) return null;
      this.arrows += got; return `${got} arrows`;
    }
    if (d.type === 'potion' || d.type === 'food' || d.type === 'lockpick') {   // these stack
      const s = this.pack.find(i => i.type === d.type && i.kind === d.kind);
      if (s) { s.n += d.n || 1; return itemName(s); }
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
      if (typeof allyHeal === 'function') allyHeal();       // and heals a recruited ally standing close (js/quests.js)
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
    const frac = w => w.charges / chargeMax(w);
    const t = target || (rechargeable(this.equip.weapon) ? this.equip.weapon : this.pack.filter(rechargeable).sort((a, b) => frac(a) - frac(b))[0]);
    if (!t) return 'You have no wand or spear to recharge.';
    const max = chargeMax(t), wasLimp = isLimp(t);
    if (t.charges >= max) return `The ${itemName(t)} is already full.`;
    t.charges = rechargedTo(t, it.full);
    this.remove(it);
    if (t.type === 'weapon') return `${itemName(t)} stiffens and stands tall again (${t.charges}/${max} kills).${wasLimp ? ' It is ready to fight.' : ''} The recharge wand crumbles.`;
    return `Recharged the ${itemName(t)} (${t.charges}/${max}). The recharge wand crumbles.`;
  }

  // Feed a piece of gear to Ian's Hog. Returns a message. `hog` is the Hog (equipped or in the pack), `gear` a pack item.
  sacrifice(hog, gear) {
    if (!hog || hog.base !== 'spear') return "You have no Ian's Hog.";
    if (!sacrificable(gear) || !this.pack.includes(gear)) return 'The Hog will not take that.';
    const max = WSTATS.spear.kills;
    if (hog.charges >= max) return "Ian's Hog is already full.";
    const gain = SACRIFICE_GAIN[gear.tier], was = isLimp(hog), name = itemName(gear);
    hog.charges = Math.min(max, hog.charges + gain);
    this.remove(gear);
    return `You feed the ${name} to Ian's Hog (+${gain}, ${hog.charges}/${max} kills).${was ? ' It stiffens and is ready to fight.' : ''}`;
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
