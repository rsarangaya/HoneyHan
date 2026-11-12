// Shop (DESIGN.md section 14): prices, the seeded stock, and the buy and sell rules. Pure logic with no DOM, so it
// is tested in plain Node (tests/shop.test.js). The screen is in js/shopui.js and the merchant's room in js/gen.js.
//   price = base x tier multiplier, rounded to the nearest 5 gold (minimum 5). The merchant buys your pack items
//   back at 35% of the buy price, rounded down. Keys, gold and arrows are not sold.
const TIER_PRICE = [1, 2, 3.5, 6, 12];                              // Common to Legendary (price rises faster than power)
const WEAPON_PRICE = { dagger: 30, sword: 45, mace: 50, bow: 40, spear: 120 };
const ARMOR_CLASS_PRICE = [20, 45, 80];                             // light, medium, heavy
const ARMOR_SLOT_FACTOR = { helmet: 0.8, chest: 1.4, boots: 0.8 };
const POTION_PRICE = { heal: 45, stamina: 40, swift: 50, might: 65, stoneskin: 65, shadow: 70 };
const FOOD_PRICE = { bread: 12, cheese: 15, jerky: 20, apple: 8, stew: 45 };
const WAND_PRICE = { fire: 90, frost: 80, lightning: 110, force: 95, sleep: 85, bust: 700 };   // for a full wand
const OTHER_PRICE = { shield: 40, rechargewand: 60, grandrecharge: 140, rage: 1200, arrows: 2, lockpick: 25 };
const SELL_SHARE = 0.35, FEATURED_MARKUP = 1.25, ARROW_PACK = 5;
const MAX_SHOP_TIER = 3;                                            // the shop never stocks Legendary (Epic is the top)

const round5 = n => Math.max(5, Math.round(n / 5) * 5);

// Buy price of ONE unit of an item or drop descriptor.
function priceOf(it) {
  const t = TIER_PRICE[it.tier === undefined ? 0 : it.tier];
  switch (it.type) {
    case 'weapon': return round5(WEAPON_PRICE[it.base] * t);
    case 'armor':  return round5(ARMOR_CLASS_PRICE[it.cls] * ARMOR_SLOT_FACTOR[it.slot] * t);
    case 'shield': return round5(OTHER_PRICE.shield * t);
    case 'potion': return round5(POTION_PRICE[it.kind]);
    case 'food':   return round5(FOOD_PRICE[it.kind]);
    case 'wand':   return round5(WAND_PRICE[it.kind] * (it.charges === undefined ? 1 : Math.max(0.25, it.charges / WANDS[it.kind].charges)));   // a used wand is worth less
    case 'rechargewand': return round5(it.full ? OTHER_PRICE.grandrecharge : OTHER_PRICE.rechargewand);
    case 'rage':   return OTHER_PRICE.rage;
    case 'arrows': return OTHER_PRICE.arrows * ARROW_PACK;
    case 'lockpick': return OTHER_PRICE.lockpick;
  }
  return 0;
}
// What the merchant pays for ONE unit from your pack, or 0 if it will not buy it.
const sellValue = it => ['key', 'gold', 'arrows'].includes(it.type) ? 0 : Math.max(1, Math.floor(priceOf(it) * SELL_SHARE));

// The merchant's stock for a floor, the same every time for a seed. Each entry: { item (a drop descriptor),
// qty, price (per unit), featured }. Gear is one of a kind. One piece of gear is featured (a tier higher, +25%).
function makeStock(seed, floorNum) {
  const rng = makeRng(((seed ^ 0x5407e) >>> 0) + floorNum * 7717);
  const tier = () => Math.min(MAX_SHOP_TIER, rollTier(floorNum, rng));
  const stock = [];
  const add = (item, qty = 1) => stock.push({ item, qty, price: priceOf(item), featured: false });
  for (let i = 0; i < 2; i++) {                                           // two weapons (a bow or a shield sometimes)
    const r = rng();
    if (r < 0.2) add({ type: 'shield', tier: tier() });
    else add({ type: 'weapon', base: rng.pick(['dagger', 'sword', 'mace', 'bow']), tier: tier() });
  }
  const slots = rng.shuffle(['helmet', 'chest', 'boots']);
  for (let i = 0; i < 2 + (rng() < 0.5 ? 1 : 0); i++) add({ type: 'armor', slot: slots[i], cls: weighted(rng, [50, 35, 15]), tier: tier() });
  const kinds = new Set();
  for (let i = 0; i < 2 + (rng() < 0.4 ? 1 : 0); i++) { let k, guard = 0; do { k = rollPotionKind(rng); } while (kinds.has(k) && ++guard < 20); kinds.add(k); add({ type: 'potion', kind: k }, rng.int(1, 3)); }
  const foods = new Set();
  for (let i = 0; i < 1 + (rng() < 0.5 ? 1 : 0); i++) { const k = rollFoodKind(rng, 1); if (!foods.has(k)) { foods.add(k); add({ type: 'food', kind: k }, rng.int(1, 3)); } }
  if (rng() < 0.35) add({ type: 'wand', kind: rollWandKind(rng) });
  else if (rng() < 0.2) add({ type: 'rechargewand', full: false });
  add({ type: 'arrows' }, 1);                                              // one pack of 5
  const gear = stock.filter(s => ['weapon', 'armor', 'shield'].includes(s.item.type) && s.item.tier < MAX_SHOP_TIER);
  if (gear.length) { const f = rng.pick(gear); f.item = { ...f.item, tier: f.item.tier + 1 }; f.featured = true; f.price = round5(priceOf(f.item) * FEATURED_MARKUP); }
  add({ type: 'lockpick' }, rng.int(1, 3));                                // drawn last so the rest of the stock is unchanged
  return stock;
}

// Buy one unit of stock[idx] into inv. Returns { ok, msg }.
function buyFromStock(inv, stock, idx) {
  const s = stock[idx];
  if (!s || s.qty <= 0) return { ok: false, msg: 'Sold out.' };
  if (inv.gold < s.price) return { ok: false, msg: `Not enough gold (${s.price} needed).` };
  const d = s.item.type === 'arrows' ? { type: 'arrows', n: ARROW_PACK } : { ...s.item, n: 1 };
  const text = inv.add(d);
  if (!text) return { ok: false, msg: s.item.type === 'arrows' ? 'Your quiver is full.' : 'Your pack is full.' };
  inv.gold -= s.price; s.qty--;
  return { ok: true, msg: `Bought ${text} for ${s.price} gold.` };
}
// Sell one unit of a pack item. Returns { ok, msg }.
function sellToMerchant(inv, it) {
  const v = sellValue(it);
  if (!v) return { ok: false, msg: it.type === 'key' ? 'The merchant does not buy keys.' : 'The merchant will not buy that.' };
  if (it.n > 1) it.n--; else inv.remove(it);
  inv.gold += v;
  return { ok: true, msg: `Sold ${itemName(it)} for ${v} gold.` };
}
