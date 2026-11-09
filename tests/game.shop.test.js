// The shop: stage structure, the merchant's room, trading through the screen. Run on its own: node tests/game.shop.test.js
const { run } = require('./lib');
run('The shop', async ({ open, check }) => {
  let page = await open(7);

  // 1. Exactly one floor from 1 to 4 has a shop, never the boss arena.
  const layout = await page.evaluate(async () => {
    const out = { floors: [], shopFloor: game.shopFloor };
    for (let n = 1; n <= 5; n++) {
      game.startFloor(n); await T.sleep(100);
      out.floors.push({ n, shop: !!game.floor.shop, stock: game.floor.shopStock ? game.floor.shopStock.length : 0 });
    }
    return out;
  });
  const shops = layout.floors.filter(f => f.shop).map(f => f.n);
  check('exactly one floor has a shop, and it is not the boss floor', shops.length === 1 && shops[0] === layout.shopFloor && layout.shopFloor <= 4, `shop on floor ${shops.join()}`);
  check('the merchant has 8 to 12 things for sale', layout.floors.find(f => f.shop).stock >= 8 && layout.floors.find(f => f.shop).stock <= 12);

  // 2. The shop room has no guards, a counter and a merchant who is not an enemy.
  const room = await page.evaluate(async () => {
    game.startFloor(game.shopFloor); await T.sleep(150);
    const f = game.floor, r = f.shop.room, inR = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    const guards = game.enemies.filter(e => inR(Math.floor(e.x / TILE), Math.floor(e.z / TILE)) || e.route.some(p => inR(Math.floor(p.x / TILE), Math.floor(p.z / TILE)))).length;
    return { guards, counter: f.decor.some(d => d.kind === 'counter'), props: propObjs.filter(o => o.p.kind === 'merchant').length, shopRoom: f.rooms.find(q => q.theme === 'shop') && !f.rooms.find(q => q.theme === 'shop').locked, enemyMerchants: game.enemies.filter(e => e.type === 'cook' && e.x === (f.shop.merchant.x + 0.5) * TILE).length };
  });
  check('no guard spawns or patrols into the shop', room.guards === 0);
  check('the shop room is open, with a counter and a trading spot', room.shopRoom && room.counter && room.props === 1);
  check('the merchant is not an enemy', room.enemyMerchants === 0);

  // 3. Hold E at the counter: the screen opens and the game pauses.
  const talk = await page.evaluate(async () => {
    const out = {}, P = game.player, f = game.floor, sh = f.shop;
    const cx = (sh.counter.x + 0.5) * TILE, cz = (sh.counter.y + 0.5) * TILE;
    const mdx = sh.merchant.x - sh.counter.x, mdz = sh.merchant.y - sh.counter.y;
    // stand on the customer side if that is free, else any free side
    const sides = [[-mdx, -mdz], [mdz, mdx], [-mdz, -mdx]];
    let spot = null;
    for (const [dx, dz] of sides) { const x = cx + dx * 1.6, z = cz + dz * 1.6; if (!P.blocked(f, x, z)) { spot = { x, z }; break; } }
    if (!spot) return { noSpot: true };
    T.reset === undefined || 0;
    P.x = spot.x; P.z = spot.z; P.yaw = Math.atan2(-(cx - P.x), -(cz - P.z)); P.pitch = 0; P.vx = P.vz = 0;
    await T.sleep(300);
    out.seen = f.shopSeen; out.log = document.getElementById('log').textContent;
    P.keys[KEYS.interact] = true;
    out.opened = await T.until(() => game.state === 'shop', 5000);
    P.keys[KEYS.interact] = false;
    out.screen = getComputedStyle(document.getElementById('shopScreen')).display;
    out.promptWas = document.getElementById('promptText').textContent;
    // paused: hunger and guards do not move
    const h0 = game.hunger.v, e0 = game.enemies.map(e => e.x + e.z); await T.sleep(1000);
    out.paused = game.hunger.v === h0 && game.enemies.every((e, i) => e.x + e.z === e0[i]);
    return out;
  });
  check('you are told about the merchant when you see his counter', talk.seen && /merchant/i.test(talk.log), talk.noSpot ? 'no free spot' : '');
  check('holding E at the counter opens the shop screen', talk.opened && talk.screen === 'flex');
  check('the game is paused while shopping', talk.paused);

  // 4. Buying and selling through the screen.
  const trade = await page.evaluate(async () => {
    const out = {}; inv.gold = 1000; inv.pack = [];
    const sword = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); inv.pack.push(sword);
    shopUI.render();
    const btn = [...document.querySelectorAll('#shopScreen [data-buy]')].find(b => !b.disabled);
    const idx = +btn.dataset.buy, entry = floor.shopStock[idx], q0 = entry.qty, g0 = inv.gold, n0 = inv.pack.length;
    btn.click();
    out.bought = { gold: g0 - inv.gold, price: entry.price, qty: q0 - entry.qty, packGrew: inv.pack.length > n0 || inv.arrows > 0 };
    const sellBtn = document.querySelector(`#shopScreen [data-sell="${sword.id}"]`); const g1 = inv.gold; sellBtn.click();
    out.sold = { gold: inv.gold - g1, gone: !inv.pack.includes(sword) };
    out.noKeySell = (() => { const k = makeItem({ type: 'key', lock: 'x', label: 'Test Key' }); inv.pack.push(k); shopUI.render(); return document.querySelector(`#shopScreen [data-sell="${k.id}"]`).disabled; })();
    inv.gold = 0; shopUI.render(); out.brokeDisabled = [...document.querySelectorAll('#shopScreen [data-buy]')].every(b => b.disabled);
    return out;
  });
  check('buying costs the listed price and uses up stock', trade.bought.gold === trade.bought.price && trade.bought.qty === 1 && trade.bought.packGrew, JSON.stringify(trade.bought));
  check('selling a Worn Sword pays 15 gold', trade.sold.gold === 15 && trade.sold.gone);
  check('keys cannot be sold', trade.noKeySell);
  check('with no gold every Buy button is disabled', trade.brokeDisabled);

  // 5. Escape closes the shop and does not also open the pause menu.
  const esc = await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
    await T.sleep(100);
    return { state: game.state, shop: getComputedStyle(document.getElementById('shopScreen')).display, pause: getComputedStyle(document.getElementById('pauseMenu')).display };
  });
  check('Escape closes the shop without opening the pause menu', esc.state === 'play' && esc.shop === 'none' && esc.pause === 'none', JSON.stringify(esc));
  await page.close();
});
