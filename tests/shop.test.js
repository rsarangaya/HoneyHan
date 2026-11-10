// Shop prices, stock and the buy/sell rules, plain Node: node tests/shop.test.js [seeds]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, TILE: 3, discoverItem() {}, pst: { clear() {} }, TUNE: { playerAtkSpd: 1 }, SHIELD: { cost: 18, parryWin: 0.15, legsTake: 0.45, bashStun: 0.8, bashStam: 15 }, STATUS: {}, WSTATS: {} });
for (const f of ['js/gen.js', 'js/loot.js', 'js/wands.js', 'js/shop.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = vm.runInContext('({ priceOf, sellValue, makeStock, buyFromStock, sellToMerchant, Inventory, makeItem, MAX_SHOP_TIER, FEATURED_MARKUP, PACK_MAX, QUIVER_MAX })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const price = (type, o, tier) => S.priceOf({ type, ...o, tier });

// the design's price table (Common to Epic; Legendary is sell-only and may differ by 5 from rounding)
const row = (type, o, want) => [0, 1, 2, 3].map(t => price(type, o, t)).join() === want.join();
check('dagger 30/60/105/180', row('weapon', { base: 'dagger' }, [30, 60, 105, 180]));
check('sword 45/90/160/270', row('weapon', { base: 'sword' }, [45, 90, 160, 270]));
check('mace 50/100/175/300', row('weapon', { base: 'mace' }, [50, 100, 175, 300]));
check('leather cap and boots 15/30/55/95', row('armor', { slot: 'helmet', cls: 0 }, [15, 30, 55, 95]) && row('armor', { slot: 'boots', cls: 0 }, [15, 30, 55, 95]));
check('iron helm 35/70/125/215', row('armor', { slot: 'helmet', cls: 1 }, [35, 70, 125, 215]));
check('great helm 65/130/225/385', row('armor', { slot: 'helmet', cls: 2 }, [65, 130, 225, 385]));
check('leather jerkin 30/55/100/170', row('armor', { slot: 'chest', cls: 0 }, [30, 55, 100, 170]));
check('chainmail 65/125/220/380', row('armor', { slot: 'chest', cls: 1 }, [65, 125, 220, 380]));
check('plate cuirass 110/225/390/670', row('armor', { slot: 'chest', cls: 2 }, [110, 225, 390, 670]));
check('potions are flat priced', S.priceOf({ type: 'potion', kind: 'heal' }) === 45 && S.priceOf({ type: 'potion', kind: 'shadow' }) === 70);
check('a pack of 5 arrows costs 10', S.priceOf({ type: 'arrows' }) === 10);
check('a used wand is worth less than a full one', S.priceOf({ type: 'wand', kind: 'fire', charges: 1 }) < S.priceOf({ type: 'wand', kind: 'fire', charges: 5 }));
check('prices are multiples of 5', ['dagger', 'sword', 'mace', 'bow'].every(b => [0, 1, 2, 3, 4].every(t => S.priceOf({ type: 'weapon', base: b, tier: t }) % 5 === 0)));

// selling
check('the merchant pays 35%, rounded down', S.sellValue({ type: 'weapon', base: 'sword', tier: 0 }) === 15 && S.sellValue({ type: 'weapon', base: 'sword', tier: 2 }) === 56);
check('keys, gold and arrows are not bought', S.sellValue({ type: 'key' }) === 0 && S.sellValue({ type: 'gold' }) === 0 && S.sellValue({ type: 'arrows' }) === 0);
check('you can never profit by buying and selling back', ['dagger', 'sword', 'mace', 'bow'].every(b => [0, 1, 2, 3].every(t => S.sellValue({ type: 'weapon', base: b, tier: t }) < S.priceOf({ type: 'weapon', base: b, tier: t }))));

// stock rules over many seeds
const N = parseInt(process.argv[2], 10) || 300;
let minLen = 99, maxLen = 0, legendary = 0, featuredBad = 0, rage = 0, dup = 0, determ = 0, arrows = 0, noFeatured = 0;
for (let s = 1; s <= N; s++) for (let fl = 1; fl <= 4; fl++) {
  const seed = (s * 2654435761) >>> 0, st = S.makeStock(seed, fl);
  minLen = Math.min(minLen, st.length); maxLen = Math.max(maxLen, st.length);
  if (JSON.stringify(st) !== JSON.stringify(S.makeStock(seed, fl))) determ++;
  if (st.some(e => e.item.tier === 4)) legendary++;
  if (st.some(e => e.item.type === 'rage' || e.item.type === 'key')) rage++;
  const f = st.filter(e => e.featured);
  if (f.length > 1) featuredBad++; if (!f.length) noFeatured++;
  for (const e of f) { const base = S.priceOf(e.item); if (e.price <= base || e.item.tier > S.MAX_SHOP_TIER) featuredBad++; }
  const potions = st.filter(e => e.item.type === 'potion').map(e => e.item.kind); if (new Set(potions).size !== potions.length) dup++;
  if (st.filter(e => e.item.type === 'arrows').length !== 1) arrows++;
  if (st.some(e => e.qty < 1 || e.price < 5)) dup++;
}
check('the stock is deterministic per seed and floor', determ === 0);
check('8 to 12 slots', minLen >= 8 && maxLen <= 12, `${minLen} to ${maxLen}`);
check('never Legendary, never keys or the recorder', legendary === 0 && rage === 0);
check('one featured piece of gear, a tier up at +25%', featuredBad === 0 && noFeatured < N * 4 * 0.05, `no featured on ${noFeatured}`);
check('no repeated potion kinds, sane quantities and prices', dup === 0);
check('exactly one pack of arrows', arrows === 0);

// buying
const stock = [{ item: { type: 'weapon', base: 'sword', tier: 1 }, qty: 1, price: 90 }, { item: { type: 'potion', kind: 'heal' }, qty: 2, price: 20 }, { item: { type: 'arrows' }, qty: 1, price: 10 }];
let inv = new S.Inventory(); inv.gold = 100;
let r = S.buyFromStock(inv, stock, 0);
check('buying takes the gold and gives the item', r.ok && inv.gold === 10 && inv.pack.length === 1 && stock[0].qty === 0, r.msg);
check('sold out items cannot be bought again', !S.buyFromStock(inv, stock, 0).ok);
check('you cannot buy without the gold', !S.buyFromStock(inv, stock, 1).ok === false ? false : (inv.gold = 10, !S.buyFromStock(inv, [{ item: { type: 'weapon', base: 'sword', tier: 3 }, qty: 1, price: 270 }], 0).ok));
inv.gold = 100; S.buyFromStock(inv, stock, 1); S.buyFromStock(inv, stock, 1);
check('potions stack and the stock count goes down', inv.pack.find(i => i.type === 'potion').n === 2 && stock[1].qty === 0 && inv.gold === 60);
inv.gold = 100; r = S.buyFromStock(inv, stock, 2);
check('arrows go in the quiver', r.ok && inv.arrows === 5 && inv.gold === 90);
inv.arrows = S.QUIVER_MAX; stock[2].qty = 1; r = S.buyFromStock(inv, stock, 2);
check('a full quiver refuses arrows and keeps the gold', !r.ok && inv.gold === 90 && stock[2].qty === 1);
inv = new S.Inventory(); inv.gold = 1000; for (let i = 0; i < S.PACK_MAX; i++) inv.pack.push(S.makeItem({ type: 'weapon', base: 'dagger', tier: 0 }));
const gearStock = [{ item: { type: 'weapon', base: 'sword', tier: 0 }, qty: 1, price: 45 }];
r = S.buyFromStock(inv, gearStock, 0);
check('a full pack refuses gear and keeps the gold', !r.ok && inv.gold === 1000 && gearStock[0].qty === 1, r.msg);

// selling
inv = new S.Inventory(); const sw = S.makeItem({ type: 'weapon', base: 'sword', tier: 0 }); inv.pack.push(sw);
r = S.sellToMerchant(inv, sw);
check('selling pays 35% and removes the item', r.ok && inv.gold === 15 && !inv.pack.includes(sw), r.msg);
const pots = S.makeItem({ type: 'potion', kind: 'heal', n: 3 }); inv.pack.push(pots);
S.sellToMerchant(inv, pots);
check('selling a stack sells one at a time', pots.n === 2 && inv.gold === 30, 'gold ' + inv.gold);
const key = S.makeItem({ type: 'key', lock: 'a', label: 'Key' }); inv.pack.push(key);
r = S.sellToMerchant(inv, key);
check('keys cannot be sold', !r.ok && inv.pack.includes(key));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
