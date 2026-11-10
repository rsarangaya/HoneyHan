// Performance and the rounder props: draw-call budget, merged furniture, baked creatures, culling, chest models.
// Run on its own: node tests/game.perf.test.js
const { run } = require('./lib');
run('Performance, round props and chest grades', async ({ open, check }) => {
  let page = await open(7);

  // 1. Draw calls: it was 1,000 to 1,400 a frame on floors 1 to 3. The budget is far below that on every floor and theme.
  const calls = await page.evaluate(async () => {
    const out = [];
    for (const n of [1, 2, 3, 4, 5]) { game.startFloor(n); await T.sleep(120); const i = game.renderInfo(); out.push({ n, calls: i.calls, tris: i.tris }); }
    // and standing in the middle of the busiest room, looking round
    game.startFloor(3); await T.sleep(100);
    const room = [...game.floor.rooms].filter(r => !r.locked).sort((a, b) => b.w * b.h - a.w * a.h)[0], P = game.player;
    P.x = (room.cx + 0.5) * TILE; P.z = (room.cy + 0.5) * TILE; let worst = 0;
    for (let a = 0; a < 8; a++) { P.yaw = a * Math.PI / 4; worst = Math.max(worst, game.renderInfo().calls); }
    return { out, worst };
  });
  check('draw calls stay under 400 at the start of every floor', calls.out.every(r => r.calls < 400), calls.out.map(r => `f${r.n}: ${r.calls}`).join(', '));
  check('and under 500 in the middle of the busiest room, looking every way', calls.worst < 500, 'worst ' + calls.worst);
  check('triangle counts stay modest (under 150k)', calls.out.every(r => r.tris < 150000), calls.out.map(r => r.tris).join(', '));

  // 2. Furniture is merged: far fewer meshes than decor pieces, and the merged geometry is not lost.
  const merged = await page.evaluate(async () => {
    game.startFloor(2); await T.sleep(120);
    let meshes = 0, tris = 0; for (const c of cullChunks) c.group.traverse(o => { if (o.isMesh) { meshes++; tris += o.geometry.attributes.position.count / 3; } });
    return { decor: game.floor.decor.length, chunks: cullChunks.length, meshes, tris };
  });
  check('a floor\'s furniture and torches are merged into about 4 meshes per chunk (it was over a thousand meshes)', merged.meshes <= merged.chunks * 6 && merged.meshes < 220 && merged.chunks >= 3, JSON.stringify(merged));
  check('merging keeps the geometry (plenty of triangles)', merged.tris > 8000, merged.tris.toFixed(0) + ' triangles');

  // 3. Creatures are baked into fewer meshes but still animate (their groups still move) and still flash on a hit.
  const bake = await page.evaluate(async () => {
    const out = {}, f = game.floor;
    const count = o => { let n = 0; o.traverse(c => { if (c.isMesh) n++; }); return n; };
    for (const type of ['goblin', 'archer', 'bouncer', 'wolf', 'rat', 'wisp', 'book', 'golem']) {
      const e = new Enemy({ x: 5, y: 5, route: [{ x: 5, y: 5 }, { x: 5, y: 5 }], seed: 9, type }, f);
      out[type] = count(e.mesh);
    }
    const g = new Enemy({ x: 5, y: 5, route: [{ x: 5, y: 5 }, { x: 5, y: 5 }], seed: 9, type: 'goblin' }, f);
    const rot0 = g.arms[1].rotation.x; g.state = 'alerted'; g.sync(0.5); g.sync(0.5); out.armMoves = g.arms[1].rotation.x !== rot0;
    g.hitT = 0.14; g.sync(0.001); out.flashed = g.mats.some(m => m.emissive.getHex() !== 0);
    return out;
  });
  const biggest = Math.max(...Object.entries(bake).filter(([k]) => typeof bake[k] === 'number').map(([, v]) => v));
  check('a creature is a few dozen meshes, not sixty or more', biggest < 42, JSON.stringify(bake));
  check('baked creatures still animate and flash when hit', bake.armMoves && bake.flashed);

  // 4. Culling: things past the fog are not drawn, and come back when you walk up.
  const cull = await page.evaluate(async () => {
    game.startFloor(3); await T.sleep(150);
    const P = game.player, f = game.floor, en = game.enemies;
    const far = en.map(e => ({ e, d: Math.hypot(e.x - P.x, e.z - P.z) })).sort((a, b) => b.d - a.d)[0];
    updateCulling(P, cullChunks, propObjs, en);
    const farHidden = far.d > PERF.cull ? !far.e.mesh.visible : null, nearShown = en.filter(e => Math.hypot(e.x - P.x, e.z - P.z) < PERF.cull - 3).every(e => e.mesh.visible);
    const visibleChunks = cullChunks.filter(c => c.group.visible).length;
    P.x = far.e.x + 2; P.z = far.e.z; updateCulling(P, cullChunks, propObjs, en);
    return { farD: far.d, farHidden, nearShown, visibleChunks, total: cullChunks.length, shownAgain: far.e.mesh.visible };
  });
  check('creatures within the fog distance are drawn', cull.nearShown);
  check('creatures past the fog are hidden, and shown again when you get close', (cull.farHidden === null || cull.farHidden) && cull.shownAgain, `farthest ${cull.farD.toFixed(0)} m`);
  check('distant furniture chunks are culled', cull.visibleChunks < cull.total || cull.total <= 6, `${cull.visibleChunks} of ${cull.total} chunks drawn`);

  // 5. The adaptive resolution exists and can only move within sane bounds.
  const q = await page.evaluate(() => { const start = quality.cur; for (let i = 0; i < 400; i++) adaptQuality(0.06, () => {}); const low = quality.cur; for (let i = 0; i < 800; i++) adaptQuality(0.008, () => {}); return { start, low, high: quality.cur, max: quality.max }; });
  check('adaptive resolution drops when slow (not below 0.6) and recovers when fast', q.low < q.start && q.low >= 0.6 && q.high > q.low && q.high <= q.max, JSON.stringify(q));

  // 5b. Game logic is cheap: with every enemy on the floor alerted and swarming, a frame's logic costs a few milliseconds at most.
  const logic = await page.evaluate(async () => {
    const out = [];
    for (const n of [1, 4]) {
      game.startFloor(n); await T.sleep(300);
      const P = game.player; game.inv.hp = 1e9;
      for (const e of game.enemies) { e.x = P.x + (Math.random() - 0.5) * 12; e.z = P.z + (Math.random() - 0.5) * 12; e.last = { x: P.x, z: P.z }; e.set('alerted'); }
      await T.sleep(2500); out.push({ floor: n, enemies: game.enemies.length, ms: game.perfStats.logic });
    }
    return out;
  });
  check('game logic stays under 8 ms a frame with every enemy alerted', logic.every(r => r.ms < 8), logic.map(r => `floor ${r.floor}: ${r.enemies} enemies, ${r.ms.toFixed(2)} ms`).join('; '));

  // 6. Props are round: barrels are lathes with hoops, chests have domed lids, and the five chest grades look different.
  const props = await page.evaluate(() => {
    const out = { tiers: [] }, kinds = o => { const k = {}; o.mesh.traverse(c => { if (c.isMesh) k[c.geometry.type] = (k[c.geometry.type] || 0) + 1; }); return k; };
    const barrel = makeProp({ kind: 'barrel', x: 3, y: 3, seed: 5, opened: false, yaw: 0 });
    out.barrel = kinds(barrel);
    for (let t = 0; t <= 4; t++) {
      const c = makeProp({ kind: 'chest', x: 3, y: 3, seed: 5, opened: false, yaw: 0, tier: t });
      let body = null; c.mesh.traverse(m => { if (m.isMesh && !body) body = m.material.color.getHex(); });
      out.tiers.push({ t, lid: !!c.lid, body, kinds: kinds(c), mats: c.mats.length });
    }
    for (const kind of ['table', 'bed', 'hearth', 'cauldron', 'sacks', 'statue', 'urn', 'altar', 'crates', 'barrels', 'bookshelf']) {
      const d = makeDecor({ kind, x: 3, y: 3, seed: 7, edge: false, yaw: 0 }); const k = kinds(d);
      out[kind] = { box: k.BoxGeometry || 0, round: (k.CylinderGeometry || 0) + (k.LatheGeometry || 0) + (k.SphereGeometry || 0) + (k.TorusGeometry || 0) + (k.ExtrudeGeometry || 0) };
    }
    return out;
  });
  check('a barrel is a lathe with iron hoops, not a box', (props.barrel.LatheGeometry || 0) >= 1 && (props.barrel.TorusGeometry || 0) >= 2 && !props.barrel.BoxGeometry, JSON.stringify(props.barrel));
  check('every chest has a hinged lid, and the five grades have different bodies', props.tiers.every(t => t.lid) && new Set(props.tiers.map(t => t.body)).size === 5, props.tiers.map(t => t.body.toString(16)).join(' '));
  check('a chest lid is a half cylinder (domed)', props.tiers.every(t => (t.kinds.CylinderGeometry || 0) >= 1));
  check('the golden chest has an aura and the wooden one does not', (props.tiers[4].kinds.ConeGeometry || 0) >= 1 && !props.tiers[0].kinds.ConeGeometry);
  const boxy = ['table', 'bed', 'hearth', 'cauldron', 'sacks', 'statue', 'urn', 'altar', 'crates', 'barrels', 'bookshelf'].filter(k => props[k].round <= props[k].box * 0.15 && props[k].round < 3);
  check('furniture is built from rounded pieces (no piece is mostly plain boxes)', boxy.length === 0, 'still boxy: ' + boxy.join(', '));

  // 6b. The chest prompt names its grade and takes longer for better chests; the minimap dot has the grade colour.
  const prompt = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(100);
    const o = { p: { kind: 'chest', tier: 3, opened: false, x: 3, y: 3, seed: 1 } }, w = { p: { kind: 'chest', tier: 0, opened: false, x: 3, y: 3, seed: 1 } };
    return { ornate: targetInfo(o), wooden: targetInfo(w), tierColor: TIERS[3].color };
  });
  check('the chest prompt names its grade, and better chests take longer', /Ornate Chest/.test(prompt.ornate.label) && /Wooden Chest/.test(prompt.wooden.label) && prompt.ornate.time > prompt.wooden.time, JSON.stringify([prompt.ornate, prompt.wooden]));
  await page.close();
});
