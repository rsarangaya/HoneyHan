// Floor drops: a dead enemy's loot lies on the floor as pickups (no lootable body), a full bag leaves the item, quest keys are never lost,
// and the dead body despawns after 30 s. Run on its own: node tests/game.drops.test.js
const { run } = require('./lib');

run('Floor drops and body despawn', async ({ open, check }) => {
  const page = await open(7);

  // 1. A kill drops its loot (stolen gold here, so the roll cannot come up empty) as floor items, and leaves no body prop to search.
  const a = await page.evaluate(() => {
    T.reset(); game.inv.gold = 0;
    const e = T.guard(6, 'away', false, 'goblin');
    e.loot = 40; e.dead = true; makeCorpse(e, false);
    const S = game.floor.items, gold = S && S.list.find(i => i.d.type === 'gold' && i.d.n === 40);
    const near = gold && Math.hypot(gold.x - e.x, gold.z - e.z);
    let inGroup = false; if (S) game.group.traverse(o => { if (S.m.coins && o === S.m.coins.mesh) inGroup = true; });
    return { n: S ? S.list.length : 0, count: S ? Object.values(S.m).reduce((n, M) => n + M.mesh.count, 0) : -1, haloCount: S ? S.halo.count : -1, near, inGroup, bodyProps: propObjs.filter(o => o.p.kind === 'corpse').length, gold: game.inv.gold };
  });
  check('a kill drops its loot as floor items near the body, drawn by one shared instanced mesh, with no lootable body', a.n >= 1 && a.count === a.n && a.haloCount === a.n && a.near <= 0.9 && a.inGroup && a.bodyProps === 0 && a.gold === 0, JSON.stringify(a));

  // 2. Walking over a drop picks it up and shows the pickup message.
  const b = await page.evaluate(async () => {
    const S = game.floor.items, it = S.list.find(i => i.d.type === 'gold' && i.d.n === 40);
    game.player.x = it.x + 1.2; game.player.z = it.z;
    const ok = await T.until(() => game.inv.gold === 40, 3000);
    return { ok, gone: !S.list.includes(it), count: Object.values(S.m).reduce((n, M) => n + M.mesh.count, 0), left: S.list.length, msg: document.getElementById('msg').textContent };
  });
  check('walking within 1.5 m picks a drop up (gold added, item gone, "Found" message)', b.ok && b.gone && b.count === b.left && /Found 40 gold/.test(b.msg), JSON.stringify(b));

  // 3. A full bag leaves the item on the floor; with room (and interact held) it is taken.
  const c = await page.evaluate(async () => {
    T.reset();
    const inv = game.inv; inv.pack = []; for (let i = 0; i < PACK_MAX; i++) inv.pack.push(makeItem({ type: 'weapon', base: 'sword', tier: 1 }));
    const e = T.guard(6, 'away', false, 'goblin');
    dropAll([{ type: 'weapon', base: 'mace', tier: 2 }], e, false);
    const S = game.floor.items, it = S.list[0];
    game.player.x = it.x + 1; game.player.z = it.z;
    await T.sleep(400);
    const stays = S.list.includes(it) && inv.pack.length === PACK_MAX;
    const msg = document.getElementById('msg').textContent;
    inv.pack.pop(); game.player.keys[KEYS.interact] = true;
    const taken = await T.until(() => !S.list.includes(it), 3000); game.player.keys[KEYS.interact] = false;
    return { stays, msg, taken, pack: inv.pack.length, mace: inv.pack.some(p => p.base === 'mace' && p.tier === 2) };
  });
  check('a full bag leaves the item on the floor (with a message) and it can be taken once there is room', c.stays && /Pack full/.test(c.msg) && c.taken && c.mace && c.pack === 20, JSON.stringify(c));

  // 4. Quest key: dropped by the guard that carries it, never evicted by the 60-item cap, and obtainable by walking over it.
  const d = await page.evaluate(async () => {
    T.reset(); game.inv.pack = [];
    const e = T.guard(8, 'away', false, 'goblin');
    e.spec.carry = { type: 'key', lock: 77, label: 'Cell Key' }; e.dead = true; makeCorpse(e, false);
    const S = game.floor.items, key = S.list.find(i => i.d.type === 'key');
    const dropped = !!key && key.q === true;
    const filler = T.guard(8, 'away', false, 'goblin');
    for (let i = 0; i < 100; i++) dropAll([{ type: 'gold', n: 1 }], filler, false);      // far more than the cap
    const capped = S.list.length <= DROPS.cap && Object.values(S.m).reduce((n, M) => n + M.mesh.count, 0) === S.list.length;
    const kept = S.list.includes(key);
    game.player.x = key.x + 1; game.player.z = key.z;
    const got = await T.until(() => game.inv.has('key', 77), 3000);
    return { dropped, capped, kept, got, n: S.list.length };
  });
  check('the quest key drops, survives the item cap (oldest non-quest items go first) and is picked up by walking over it', d.dropped && d.capped && d.kept && d.got, JSON.stringify(d));

  // 5. The body despawns 30 s after death (items stay); a living or just-dead one does not.
  const f = await page.evaluate(async () => {
    T.reset(); game.inv.gold = 0;
    const e = T.guard(8, 'away', false, 'goblin'); e.loot = 25;
    e.die();
    const made = await T.until(() => e.corpseDone, 3000);
    const items = game.floor.items ? game.floor.items.list.length : 0;
    e.deadT = 29; await T.sleep(150);
    const stillThere = game.enemies.includes(e) && !!e.mesh.parent;
    e.deadT = 30; const gone = await T.until(() => !game.enemies.includes(e), 3000);
    return { made, items, stillThere, gone, detached: !e.mesh.parent, itemsAfter: game.floor.items ? game.floor.items.list.length : 0 };
  });
  check('a dead enemy drops its loot, its body is still there at 29 s and is removed (mesh detached, off the update list) at 30 s, the items stay', f.made && f.items >= 1 && f.stillThere && f.gone && f.detached && f.itemsAfter === f.items, JSON.stringify(f));
  // 6. Different item kinds get different shapes, and every loot category resolves to a built shape.
  const g = await page.evaluate(() => {
    const ids = { gold: dropShape({ type: 'gold' }), potion: dropShape({ type: 'potion' }), food: dropShape({ type: 'food' }), key: dropShape({ type: 'key' }), mace: dropShape({ type: 'weapon', base: 'mace' }), bow: dropShape({ type: 'weapon', base: 'bow' }), blade: dropShape({ type: 'weapon', base: 'sword' }), wand: dropShape({ type: 'wand', kind: 'bust' }), helm: dropShape({ type: 'armor', slot: 'helmet' }), plate: dropShape({ type: 'armor', slot: 'chest' }), scroll: dropShape({ type: 'lockpick' }) };
    const cats = [{ type: 'gold' }, { type: 'potion' }, { type: 'food' }, { type: 'key' }, { type: 'wand' }, { type: 'rechargewand' }, { type: 'rage' }, { type: 'shield' }, { type: 'lockpick' }, { type: 'arrows' }, { type: 'armor', slot: 'boots' }, { type: 'weapon', base: 'spear' }, { type: 'weapon', base: 'dagger' }, { type: 'mystery' }];
    const built = cats.every(d => { const id = dropShape(d); return !!DROP_BUILD[id] && dropMerge(DROP_BUILD[id]()).attributes.position.count / 3 <= 60; });
    return { distinct: new Set([ids.gold, ids.potion, ids.food, ids.key, ids.mace, ids.bow, ids.wand, ids.helm, ids.scroll]).size, built, fallback: dropShape({ type: 'mystery' }) };
  });
  check('different item kinds map to different shape ids; every category resolves to a built shape of <= 60 triangles (unknown falls back to the gem)', g.distinct === 9 && g.built && g.fallback === 'gem', JSON.stringify(g));
  await page.close();
});
