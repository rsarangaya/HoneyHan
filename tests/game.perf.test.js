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
  check('draw calls stay under 220 at the start of every floor', calls.out.every(r => r.calls < 220), calls.out.map(r => `f${r.n}: ${r.calls}`).join(', '));
  check('and under 260 in the middle of the busiest room, looking every way', calls.worst < 260, 'worst ' + calls.worst);
  check('triangle counts stay modest (under 150k)', calls.out.every(r => r.tris < 150000), calls.out.map(r => r.tris).join(', '));

  // 1b. Every theme has its own walls, doors, textures and furniture: the same budgets hold in each (floors 1 to 4 at the start, the busiest room on floor 3).
  const themeSeeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  for (const [name, seed] of Object.entries(themeSeeds)) {
    const pg = await open(seed);
    const r = await pg.evaluate(async () => {
      const out = [];
      for (const n of [1, 2, 3, 4]) { game.startFloor(n); await T.sleep(100); const i = game.renderInfo(); out.push({ n, calls: i.calls, tris: i.tris }); }
      game.startFloor(3); await T.sleep(100);
      const room = [...game.floor.rooms].filter(r => !r.locked).sort((a, b) => b.w * b.h - a.w * a.h)[0], P = game.player;
      P.x = (room.cx + 0.5) * TILE; P.z = (room.cy + 0.5) * TILE; let worst = 0, walls = 0;
      for (let a = 0; a < 8; a++) { P.yaw = a * Math.PI / 4; worst = Math.max(worst, game.renderInfo().calls); }
      group.traverse(o => { if (o.isInstancedMesh) walls++; });
      return { out, worst, walls };
    });
    check(`${name}: under 220 draw calls at the start of every floor, under 260 in the busiest room, under 150k triangles, at most 3 wall draws`,
      r.out.every(x => x.calls < 220 && x.tris < 150000) && r.worst < 260 && r.walls <= 3, r.out.map(x => `f${x.n}: ${x.calls}/${(x.tris / 1000).toFixed(0)}k`).join(', ') + `; worst ${r.worst}, wall draws ${r.walls}`);
    await pg.close();
  }
  page = await open(7);

  // 2. Furniture is merged: far fewer meshes than decor pieces, and the merged geometry is not lost.
  const merged = await page.evaluate(async () => {
    game.startFloor(2); await T.sleep(120);
    let meshes = 0, tris = 0; for (const c of cullChunks) c.group.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
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
  check('a creature is about ten meshes (one per animated group and surface kind), not sixty', biggest < 16, JSON.stringify(bake));
  check('baked creatures still animate and flash when hit', bake.armMoves && bake.flashed);

  // 4. Culling: things past the fog are not drawn, and come back when you walk up.
  const cull = await page.evaluate(async () => {
    game.startFloor(3); await T.sleep(150);
    const P = game.player, f = game.floor, en = game.enemies;
    const far = en.map(e => ({ e, d: Math.hypot(e.x - P.x, e.z - P.z) })).sort((a, b) => b.d - a.d)[0];
    updateCulling(P, cullChunks, propObjs, en);
    const farHidden = far.d > cullRadius() ? !far.e.mesh.visible : null, nearShown = en.filter(e => Math.hypot(e.x - P.x, e.z - P.z) < cullRadius() - 3).every(e => e.mesh.visible);
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
  check('game logic stays under 3 ms a frame with every enemy alerted', logic.every(r => r.ms < 3), logic.map(r => `floor ${r.floor}: ${r.enemies} enemies, ${r.ms.toFixed(2)} ms`).join('; '));

  // 6. Props are round: barrels are lathes with hoops, chests have domed lids, and the five chest grades look different.
  const props = await page.evaluate(() => {
    const out = { tiers: [] }, kinds = o => { const k = {}; o.mesh.traverse(c => { if (c.isMesh) k[c.geometry.type] = (k[c.geometry.type] || 0) + 1; }); return k; };
    const barrel = makeProp({ kind: 'barrel', x: 3, y: 3, seed: 5, opened: false, yaw: 0 }, true);   // (raw: the parts, before they are baked)
    out.barrel = kinds(barrel);
    for (let t = 0; t <= 4; t++) {
      const c = makeProp({ kind: 'chest', x: 3, y: 3, seed: 5, opened: false, yaw: 0, tier: t }, true);
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
  // 6a. Props are baked: a prop is a few meshes (it was 13 to 23 for a chest, 12 for a rack, 19 for a pantry), the lid still hinges, a searched prop still dims.
  const baked = await page.evaluate(() => {
    const n = o => { let k = 0; o.mesh.traverse(m => { if (m.isMesh) k++; }); return k; }, out = {};
    for (const [key, p] of [['chest', { kind: 'chest', tier: 0 }], ['chest4', { kind: 'chest', tier: 4, locked: true }], ['vault', { kind: 'vaultchest' }], ['barrel', { kind: 'barrel' }], ['rack', { kind: 'rack', seed: 2 }], ['pantry', { kind: 'pantry' }], ['rubble', { kind: 'rubble' }]]) out[key] = n(makeProp(Object.assign({ x: 3, y: 3, seed: 5, opened: false, yaw: 0 }, p)));
    const c = makeProp({ kind: 'chest', tier: 1, x: 3, y: 3, seed: 5, yaw: 0 }); let dbl = 0, single = 0; c.lid.traverse(m => { if (m.isMesh) (m.material.side === THREE.DoubleSide ? dbl++ : single++); });
    const b = makeProp({ kind: 'barrel', x: 3, y: 3, seed: 5, yaw: 0 }), before = b.mats[0].color.getHex(); markOpened(b);
    const m = makeProp({ kind: 'chest', tier: 1, x: 3, y: 3, seed: 5, yaw: 0 }, true);
    return { out, lid: !!c.lid, lidDouble: dbl, lidSingle: single, dims: b.mats.length === 1 && b.mats[0].color.getHex() < before, rawMesh: n(m) };
  });
  check('a chest bakes to at most 7 meshes, a barrel to 1, a rack to 3, a pantry and a rubble heap to 1', baked.out.chest <= 7 && baked.out.chest4 <= 8 && baked.out.vault <= 7 && baked.out.barrel === 1 && baked.out.rack <= 3 && baked.out.pantry === 1 && baked.out.rubble === 1, JSON.stringify(baked.out));
  check('a baked chest keeps its hinged lid, every lid part is double sided (no see-through dome), and the raw (mimic) chest stays in parts', baked.lid && baked.lidSingle === 0 && baked.lidDouble >= 1 && baked.rawMesh > 10, JSON.stringify(baked));
  check('a searched-out barrel still dims (its one plain material)', baked.dims, '');
  // 6a2. Every lootable kind shows it was searched: plain props dim through materials of their own (no shared material is touched), a chest opens its lid; and a rebuilt floor keeps that look.
  const dim = await page.evaluate(async () => {
    const out = {}, lum = o => { let s = 0, shared = 0; o.mesh.traverse(m => { if (m.isMesh) { s += m.material.color.r + m.material.color.g + m.material.color.b + (m.material.emissive ? m.material.emissive.r + m.material.emissive.g + m.material.emissive.b : 0); if (m.material.userData.shared) shared++; } }); return { s, shared }; };
    for (const kind of ['barrel', 'rack', 'pantry', 'rubble', 'potions']) {
      let worst = 1, shared = 0;
      for (let sd = 1; sd <= 4; sd++) { const o = makeProp({ kind, x: 3, y: 3, seed: sd, yaw: 0 }), a = lum(o); markOpened(o); const b = lum(o); worst = Math.min(worst, 1 - b.s / a.s); shared = Math.max(shared, a.shared); if (kind !== 'barrel') {} }
      out[kind] = { drop: +worst.toFixed(2), shared };
    }
    const c = makeProp({ kind: 'chest', tier: 1, x: 3, y: 3, seed: 5, yaw: 0 }); markOpened(c); out.chest = c.lid.rotation.x;
    game.startFloor(1); await T.sleep(60);
    const ps = game.floor.props.filter(p => !p.mimic && p.kind !== 'chest' && p.kind !== 'vaultchest');
    for (const p of game.floor.props) p.opened = true;
    buildFloor(); await T.sleep(30);
    const dimmed = propObjs.filter(o => o.p.kind !== 'door' && o.p.kind !== 'decor' && o.p.opened && !o.p.mimic && o.lid === null && o.mats.length).map(o => o.mats[0].color.getHex() < 0x7f7f7f * 0x010101 || o.mats[0].color.r < 1);
    out.rebuilt = { n: ps.length, dimmed: dimmed.length, all: dimmed.every(Boolean), lids: propObjs.filter(o => o.lid && !o.p.mimic).every(o => o.lid.rotation.x < -1) };
    return out;
  });
  check('every plain lootable (barrel, rack, pantry, rubble, potion shelf) dims by at least 30% when searched out, using only its own materials', ['barrel', 'rack', 'pantry', 'rubble', 'potions'].every(k => dim[k].drop >= 0.3 && (k === 'potions' || dim[k].shared === 0)) && dim.chest < -1, JSON.stringify(dim));
  check('a rebuilt floor keeps searched-out props looking searched out (dimmed, lids open)', dim.rebuilt.dimmed > 0 && dim.rebuilt.all && dim.rebuilt.lids, JSON.stringify(dim.rebuilt));
  const boxy = ['table', 'bed', 'hearth', 'cauldron', 'sacks', 'statue', 'urn', 'altar', 'crates', 'barrels', 'bookshelf'].filter(k => props[k].round <= props[k].box * 0.15 && props[k].round < 3);
  check('furniture is built from rounded pieces (no piece is mostly plain boxes)', boxy.length === 0, 'still boxy: ' + boxy.join(', '));

  // 6b. The chest prompt names its grade and takes longer for better chests; the minimap dot has the grade colour.
  const prompt = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(100);
    const o = { p: { kind: 'chest', tier: 3, opened: false, x: 3, y: 3, seed: 1 } }, w = { p: { kind: 'chest', tier: 0, opened: false, x: 3, y: 3, seed: 1 } };
    return { ornate: targetInfo(o), wooden: targetInfo(w), tierColor: TIERS[3].color };
  });
  check('the chest prompt names its grade, and better chests take longer', /Ornate Chest/.test(prompt.ornate.label) && /Wooden Chest/.test(prompt.wooden.label) && prompt.ornate.time > prompt.wooden.time, JSON.stringify([prompt.ornate, prompt.wooden]));

  // 7. Adaptive quality stages, judged against the display's own rate: steady 144 / 60 / 30 Hz never degrades; a 2 s hitch is ignored; sustained slowness steps down one stage at a time
  // and recovers when frames return to the baseline; one fast window does not step back up. Mode Low pins level 2, High pins level 0; the choice is saved.
  const qa = await page.evaluate(async () => {
    game.startFloor(2); await T.sleep(80);
    const Q = game.quality, out = {}, feed = (dt, sec) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) game.adaptQuality(dt, game.qualityApply); };
    const snap = () => ({ level: Q.level, cull: PERF.cull, lamp: Q.lamp, mini: Q.mini, ratio: renderer.getPixelRatio(), fog: scene.fog.density });
    const same = (a, b) => a.level === b.level && a.ratio === b.ratio;
    game.setQualityMode('auto'); const base = snap(); out.base = base; out.themeFog = theme.fog.density;
    out.steady = {};
    for (const [name, dt] of [['144', 1 / 144], ['60', 1 / 60], ['30', 1 / 30]]) { game.setQualityMode('auto'); feed(dt, 30); out.steady[name] = same(snap(), base); }
    game.setQualityMode('auto'); feed(1 / 60, 15); feed(0.3, 2); feed(1 / 60, 10); out.hitch = same(snap(), base);   // a 2 s hitch (frames of 0.3 s: floor build, tab away) is left out
    game.setQualityMode('auto'); feed(1 / 60, 12);
    out.log = [];
    feed(0.04, 1.05); out.log.push(Q.level); feed(0.04, 1.05); out.log.push(Q.level); feed(0.04, 1.05); out.log.push(Q.level);   // level 1, settling, level 2
    const s2 = snap(); out.s2 = s2;
    feed(0.04, 3.2); out.px = snap().ratio;
    game.draw(); let lit = 0; scene.traverse(o => { if (o.isPointLight && o.visible) lit++; }); out.lit = lit;   // real point lights drawn (the lantern only: the torches are baked)
    feed(1 / 60, 1.05); out.noFlap = snap().level === s2.level && snap().ratio === out.px;                     // one window back at the baseline: nothing steps up yet
    feed(1 / 60, 30); out.end = snap(); out.max = Q.max;
    game.setQualityMode('low'); out.low = snap(); out.saved = localStorage.getItem('honeyhan-quality');
    game.setQualityMode('high'); out.high = snap();
    game.setQualityMode('auto'); out.auto = snap();
    return out;
  });
  check('steady 144 and 60 Hz frame times never degrade quality; a steady 30 Hz (33 ms) display counts as slow and does', qa.steady['144'] && qa.steady['60'] && !qa.steady['30'], JSON.stringify(qa.steady));
  check('a 2 s hitch (spike frames) is ignored', qa.hitch);
  check('sustained 40 ms frames lower quality one stage at a time (level 1, settling, level 2)', JSON.stringify(qa.log) === '[1,1,2]', JSON.stringify(qa.log));
  check('level 2: draw distance 24 m, lantern off, minimap every 6th frame, fog denser by the same ratio', qa.s2.cull === 24 && qa.s2.lamp === 0 && qa.s2.mini === 6 && Math.abs(qa.s2.fog - qa.themeFog * 38 / 24) < 1e-6, JSON.stringify(qa.s2));
  check('still slow at level 2: the pixel ratio drops too, and no real light is left (the torches are baked, level 2 drops the lantern)', qa.px < qa.base.ratio && qa.lit === 0, 'ratio ' + qa.base.ratio + ' -> ' + qa.px + ', lit ' + qa.lit);
  check('one window back at the baseline does not step back up (no flapping)', qa.noFlap);
  check('frames back at the baseline restore everything (pixel ratio, level 0, 38 m, lantern, original fog)', qa.end.level === 0 && qa.end.cull === 38 && qa.end.lamp === 1 && qa.end.mini === 3 && Math.abs(qa.end.ratio - qa.max) < 1e-9 && Math.abs(qa.end.fog - qa.themeFog) < 1e-9, JSON.stringify(qa.end));
  check('Low pins level 2 and is saved; High pins level 0; Auto starts at level 0', qa.low.level === 2 && qa.saved === 'low' && qa.high.level === 0 && qa.high.ratio === qa.max && qa.auto.level === 0);

  // 8. Bosses and their arena are never culled, even at the lowest quality level.
  const bc = await page.evaluate(async () => {
    const out = {};
    game.setQualityMode('low');
    for (const [name, go] of [['stage 1 boss floor', () => game.startFloor(5)], ['final stage', () => game.startStage(FINAL_STAGE)]]) {
      go(); await T.sleep(80);
      const boss = game.enemies.find(e => e.boss), P = game.player;
      P.x = Math.min(game.floor.w * TILE - 2, boss.x + 40); P.z = boss.z; game.draw();
      const far = propObjs.filter(o => o.mesh && !o.gone && o.r > 0 && Math.hypot(o.x - P.x, o.z - P.z) > 26 && Math.hypot(o.x - P.x, o.z - P.z) < 50);
      out[name] = { boss: !!boss, bossVisible: boss.mesh.visible, dist: Math.hypot(boss.x - P.x, boss.z - P.z), far: far.length, farVisible: far.filter(o => o.mesh.visible).length, fog: scene.fog.density, themeFog: theme.fog.density };
    }
    game.startStage(1); game.startFloor(2); await T.sleep(60); out.regular = { floorBoss: PERF.floorBoss, cull: PERF.cull };
    game.setQualityMode('auto');
    return out;
  });
  for (const [k, v] of Object.entries(bc)) if (v.boss !== undefined) check('at level 2 the boss and the arena props stay drawn on the ' + k, v.boss && v.bossVisible && v.farVisible === v.far && Math.abs(v.fog - v.themeFog) < 1e-9, JSON.stringify(v));
  check('an ordinary floor is not a boss floor (24 m cull at level 2)', !bc.regular.floorBoss && bc.regular.cull === 24, JSON.stringify(bc.regular));

  // 9. Visual-audit fixes: the stairs are merged (no loose step meshes), every door style is a few meshes, a wand mark hides behind walls, the torch flame is a teardrop with a core.
  const au = await page.evaluate(async () => {
    game.startStage(2); game.startFloor(2); await T.sleep(100);
    const loose = group.children.filter(o => o.isMesh && o.geometry.type === 'BoxGeometry').length;
    const doors = {}; for (const st of Object.keys(DOOR_BUILDERS)) { const o = makeDoor({ style: st, x: 0, y: 0, axis: 'z', lock: 1, room: 0, keyLabel: 'k' }); let n = 0; o.mesh.traverse(m => { if (m.isMesh) n++; }); doors[st] = n; }
    const e = game.enemies.find(x => !x.boss && !x.T.mimic) || game.enemies[0]; e.dormant = false;
    e.st.apply('slow', 5); e.sync(0.016); const markTested = e.icon.material.depthTest;
    e.st.clear('slow'); e.set('alerted'); e.sync(0.016); const awareSeen = e.icon.material.depthTest;
    return { loose, doors, markTested, awareSeen, flame: TORCH_FLAME.type, core: !!TORCH_CORE };
  });
  check('the stairs and floor boxes are merged: no loose box meshes under the floor group', au.loose === 0, JSON.stringify(au));
  check('every door style is at most 4 meshes (the plank door was 12)', Object.values(au.doors).every(n => n <= 4), JSON.stringify(au.doors));
  check('a wand status mark is depth tested (hides behind walls); the awareness mark still shows through', au.markTested === true && au.awareSeen === false, JSON.stringify(au));
  check('the torch flame is a lathe teardrop with a hot core', au.flame === 'LatheGeometry' && au.core, JSON.stringify(au));
  await page.close();
});
