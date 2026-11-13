// The reworked Mushroom Cellar (caves, spore seals, dark pockets, lingering puffer cloud) and Clockwork Library (aisles, clockwork gates, moving shelves),
// plus three fixes made with them: the missing `break`s in makeDecor, a corpse that dies in Jungle brush, and the door noise.
// Run on its own: node tests/game.cellar.test.js
const { run } = require('./lib');
run('Mushroom Cellar and Clockwork Library', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const CELL = 'The Mushroom Cellar', LIB = 'The Clockwork Library', JUNG = 'The Overgrown Ruin';

  // ---------- makeDecor: each case ends at its own break (bed, counter, bookshelf, weaponrack, barrels, crates, table, cauldron, bones, sacks) ----------
  page = await open(seeds[CELL]);
  const art = await page.evaluate(() => {
    const out = {};
    for (const kind of ['bed', 'counter', 'bookshelf', 'weaponrack', 'barrels', 'crates', 'table', 'cauldron', 'bones', 'sacks']) {
      let max = 0, circles = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const d = makeDecor({ kind, x: 3, y: 3, seed, edge: false, yaw: 0 }); let n = 0;
        d.mesh.traverse(c => { if (c.isMesh) { n++; if (c.geometry.type === 'CircleGeometry') circles++; } });
        max = Math.max(max, n);
      }
      out[kind] = { max, circles };
    }
    return out;
  });
  const LIMIT = { bed: 20, counter: 25, bookshelf: 70, weaponrack: 14, barrels: 14, crates: 14, table: 40, cauldron: 22, bones: 14, sacks: 10 };   // generous bounds: a fall-through (a bed that also draws puddles, a weaponrack that also builds barrels, crates and a table) is far over
  const over = Object.entries(LIMIT).filter(([k, lim]) => art[k].max > lim);
  check('every decor case builds only its own art (no fall-through into the next case)', over.length === 0 && art.bed.circles === 0, over.map(([k]) => `${k} ${art[k].max}`).join(', ') + ' ' + JSON.stringify(art));
  await page.close();

  // ---------- Mushroom Cellar ----------
  page = await open(seeds[CELL]);
  const cw = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, tex: theme.tex, mt: { ...theme.mechanic.TUNE } };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f; out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes;
    out.maxRoom = Math.max(...f.rooms.filter(r => !r.locked).map(r => Math.max(r.w, r.h)));
    out.kinds = {}; for (const d of f.decor) out.kinds[d.kind] = (out.kinds[d.kind] || 0) + 1;
    out.tx = [!!themeTex.get(theme.name + '|wall'), !!themeTex.get(theme.name + '|floor')];
    return out;
  });
  check('the Cellar is caves with cap-stone walls, a damp floor and spore seals keyed with the Spore Key', cw.themeName === CELL && cw.layout === 'caves' && cw.tex.wall === 'capstone' && cw.tex.floor === 'damp' && cw.hasDoor && cw.door.every(s => s === 'spore|Spore Key'), JSON.stringify([cw.layout, cw.tex, cw.door]));
  check('the Cellar keeps one wall draw, bakes its seal into a few meshes and has small chambers', cw.inst.length === 1 && cw.doorMeshes >= 2 && cw.doorMeshes <= 8 && cw.maxRoom <= 5, JSON.stringify([cw.inst, cw.doorMeshes, cw.maxRoom]));
  check('the Cellar has its own furniture (wine racks, mushrooms, stalactites, glow-moss)', (cw.kinds.winerack || 0) + (cw.kinds.mushroom || 0) + (cw.kinds.stalactites || 0) + (cw.kinds.glowmoss || 0) > 0, JSON.stringify(cw.kinds));
  check('the Cellar numbers live in the theme (glow 1.4, dark 0.7, footsteps 0.8, cloud 6 s, puff 2 s)', cw.mt.glow === 1.4 && cw.mt.dark === 0.7 && cw.mt.darkFoot === 0.8 && cw.mt.cloudDur === 6 && cw.mt.puffDur === 2 && cw.mt.puffDaze === 1, JSON.stringify(cw.mt));

  const dk = await page.evaluate(async () => {
    const out = {}, TT = theme.mechanic.TUNE;
    T.reset(); game.inv.hp = 1e9; const P = game.player;
    const tiles = k => [...floor.patches].filter(([, v]) => v === k).map(([i]) => ({ x: i % floor.w, y: (i / floor.w) | 0 }));
    const dark = tiles('dark'), glow = tiles('glowcap'); out.dark = dark.length; out.glow = glow.length;
    const put = (t, crouch) => { P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys[KEYS.crouch] = !!crouch; P.crouching = !!crouch; updateCombat(0.016); return P.stealthMul; };
    out.dark1 = put(dark[0], false); out.darkCrouch = put(dark[0], true); out.glow1 = glow.length ? put(glow[0], false) : null;
    P.crouching = false; P.keys = {}; out.off = put({ x: floor.start.x, y: floor.start.y }, false);
    // footsteps are 20% quieter in a dark pocket (read from a guard's noise events while you walk)
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.src === undefined && ev.x === P.x) seen.push({ r: ev.r, dark: floor.patches.get(P.tileY * floor.w + P.tileX) === 'dark', base: P.noiseRadius }); };
    for (const t of dark) {
      P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys = {}; P.keys[KEYS.forward] = true; seen.length = 0;
      let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 4 && !P.blocked(floor, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
      P.yaw = yaw; await T.until(() => seen.some(s => s.dark && s.base > 0), 1500); if (seen.some(s => s.dark && s.base > 0)) break;
    }
    P.keys = {};
    const s = seen.find(s => s.dark && s.base > 0); out.foot = s ? s.r / (s.base * HUSH) : null;
    return out;
  });
  check('the Cellar places 4 to 6 dark pockets and 5 to 8 glowcap patches', dk.dark >= 3 && dk.dark <= 6 && dk.glow >= 3 && dk.glow <= 8, `${dk.dark} dark, ${dk.glow} glowcap`);
  check('a dark pocket hides you (guards see you 0.7 as far), glowing spores still show you (1.4), no change elsewhere', Math.abs(dk.dark1 - 0.7) < 1e-6 && Math.abs(dk.darkCrouch - 0.7) < 1e-6 && (dk.glow1 === null || Math.abs(dk.glow1 - 1.4) < 1e-6) && dk.off === 1, JSON.stringify([dk.dark1, dk.darkCrouch, dk.glow1, dk.off]));
  check('footsteps are 20% quieter in a dark pocket', dk.foot !== null && Math.abs(dk.foot - 0.8) < 1e-6, 'x' + dk.foot);

  const cl = await page.evaluate(async () => {
    const out = {}; T.reset(); game.inv.hp = 1e9; game.pst.clear(); const P = game.player, TT = theme.mechanic.TUNE;
    const d = Math.min(8, T.reset() - 0.5);
    const p = T.guard(d, 'away', false, 'puffer'), near = T.guard(d - 1.5, 'away', false, 'goblin'), far = T.guard(0.5, 'away', false, 'goblin');   // a goblin 1.5 m in front of the puffer (inside its cloud), one beside the player (outside)
    p.hit = p.hurt(9999, P); updateClouds(0);
    out.on = clouds.filter(c => c.on).length; out.dur = clouds.find(c => c.on).dur; out.r = clouds.find(c => c.on).r;
    out.playerDazed = game.pst.has('daze');
    updateClouds(0.1); updateClouds(0.6);
    out.nearDazed = near.st.has('daze'); out.farDazed = far.st.has('daze');
    for (let i = 0; i < 4; i++) updateClouds(1);                                    // 4.7 s in: still there
    out.at47 = clouds.filter(c => c.on).length;
    updateClouds(1); updateClouds(0.5);                                             // past 6 s: gone, and invisible
    out.after = clouds.filter(c => c.on).length; out.vis = clouds.some(c => c.m.visible);
    // a dazed guard sees half as far: dazed vs not, same spot, just inside and outside half the sight range
    return out;
  });
  check('a puffer\'s death cloud lingers for 6 s (not instant), dazes enemies inside it and not those outside', cl.on === 1 && cl.dur === 6 && cl.r === 3 && cl.nearDazed && !cl.farDazed && cl.at47 === 1 && cl.after === 0 && !cl.vis, JSON.stringify(cl));

  const sp = await page.evaluate(async () => {
    const out = {}; T.reset(); game.inv.hp = 1e9; game.pst.clear(); clearClouds();
    let f = null; for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh); game.enemies.length = 0;
    const dobj = propObjs.find(o => o.p.kind === 'door'), d = f.doors[0], P = game.player, TT = theme.mechanic.TUNE;
    P.x = dobj.x + 1.5; P.z = dobj.z + 1.5; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel }); game.pst.clear();
    const e = T.guard(1, 'away', false, 'goblin'); e.x = dobj.x - 1; e.z = dobj.z - 1.2; e.sync(0);
    const e2 = T.guard(1, 'away', false, 'goblin'); e2.x = dobj.x + 7; e2.z = dobj.z; e2.sync(0);
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    out.cloud = clouds.filter(c => c.on).length; out.dur = clouds.find(c => c.on).dur; out.r = clouds.find(c => c.on).r;
    updateClouds(0.05);
    out.playerDaze = game.pst.t.daze || 0; out.enemyDazed = e.st.has('daze'); out.farEnemy = e2.st.has('daze');
    updateDoors(0.5); out.midScale = dobj.mesh.scale.y; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR;
    for (let i = 0; i < 5; i++) updateClouds(0.5); out.gone = clouds.filter(c => c.on).length === 0;
    return out;
  });
  check('opening a spore seal releases a 2 s puff (3 m): Daze 1 s for the player and enemies inside it, nobody beyond', sp.cloud === 1 && sp.dur === 2 && sp.r === 3 && sp.playerDaze > 0.5 && sp.playerDaze <= 1 && sp.enemyDazed && !sp.farEnemy && sp.gone, JSON.stringify(sp));
  check('the seal shrinks away and is loud (6 m, above a plain door at 5)', sp.midScale < 1 && sp.midScale > 0.05 && sp.done && sp.noise >= 6, JSON.stringify([sp.midScale, sp.done, sp.noise]));

  const leak0 = await page.evaluate(async () => { const o = []; for (let k = 0; k < 4; k++) { game.startFloor(1); await T.sleep(100); const i = game.renderInfo(); o.push(i.geos + '/' + i.tex); } return o; });
  check('rebuilding Cellar floors frees their geometry and textures (geometries within 2 of the first rebuild, textures exactly flat)', leak0.every(v => Math.abs(parseInt(v) - parseInt(leak0[0])) <= 2 && v.split("/")[1] === leak0[0].split("/")[1]), leak0.join(', '));
  await page.close();

  // ---------- Clockwork Library ----------
  page = await open(seeds[LIB]);
  const lw = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, tex: theme.tex, hush: HUSH, mt: { ...theme.mechanic.TUNE } };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f; out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes; out.cogs = !!dobj.cogs && dobj.cogs.length === 2;
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    updateDoors(0.5); out.midY = dobj.mesh.position.y; out.cogTurn = Math.abs(dobj.cogs[0].rotation.z) > 1 && Math.abs(dobj.cogs[1].rotation.z) > 1 && dobj.cogs[0].rotation.z * dobj.cogs[1].rotation.z < 0; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR;
    out.kinds = {}; for (const dd of f.decor) out.kinds[dd.kind] = (out.kinds[dd.kind] || 0) + 1;
    return out;
  });
  check('the Library is aisles with shelf walls, a parquet floor, clockwork gates and the Gear Key', lw.themeName === LIB && lw.layout === 'aisles' && lw.tex.wall === 'shelf' && lw.tex.floor === 'parquet' && lw.hasDoor && lw.door.every(s => s === 'gate|Gear Key'), JSON.stringify([lw.layout, lw.tex, lw.door]));
  check('the hush stays: noise carries 40% farther', lw.hush === 1.4);
  check('a clockwork gate is baked into a few meshes, slides up with its two cogs spinning (opposite ways) and is loud (7 m)', lw.doorMeshes >= 4 && lw.doorMeshes <= 10 && lw.cogs && lw.midY > 0.5 && lw.cogTurn && lw.done && lw.noise >= 7, JSON.stringify([lw.doorMeshes, lw.cogs, lw.midY, lw.cogTurn, lw.done, lw.noise]));
  check('the Library has its own furniture (ladders, orreries, clocks, scroll tables, globes)', (lw.kinds.ladder || 0) + (lw.kinds.orrery || 0) + (lw.kinds.clock || 0) + (lw.kinds.scrolltable || 0) + (lw.kinds.globe || 0) > 0, JSON.stringify(lw.kinds));

  const ms = await page.evaluate(async () => {
    const out = {}, TT = theme.mechanic.TUNE, P = game.player;
    let f = null; for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.movers && game.floor.movers.length) f = game.floor; }
    out.found = !!f; if (!f) return out;
    for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh); game.enemies.length = 0;
    const m = f.movers[0], idx = (k, i) => (m.y + m.dy * (2 * k + i)) * f.w + m.x + m.dx * (2 * k + i);
    const centre = (k, i) => ({ x: (m.x + m.dx * (2 * k + i) + 0.5) * TILE, z: (m.y + m.dy * (2 * k + i) + 0.5) * TILE });
    const px = m.dy, pz = m.dx;                                                       // across the strip
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst; out.sameMesh = f.moverMesh.isInstancedMesh;
    // rest state: the shelf's half is wall, the other half is open floor
    const k0 = m.k; out.rest = [f.tiles[idx(k0, 0)] === T_WALL, f.tiles[idx(k0, 1)] === T_WALL, f.tiles[idx(1 - k0, 0)] === T_FLOOR, f.tiles[idx(1 - k0, 1)] === T_FLOOR];
    out.numbers = [TT.shelfEvery, TT.shelfSlide, TT.shelfRing, TT.shelfPush];
    // two points inside the open half's first tile, across the strip: a clear line now
    const c0 = centre(1 - k0, 0), ax = c0.x - px * 1.4, az = c0.z - pz * 1.4, bx = c0.x + px * 1.4, bz = c0.z + pz * 1.4;
    out.losOpen = hasLOS(f, ax, az, bx, bz);
    // a guard path across the open half exists while the shelf rests there? (it goes round the shelf's own half: it is a wall)
    // put the player and a guard on the half the shelf is about to take, and let a cycle come round
    const dest = centre(1 - k0, 0), g = T.guard(3, 'away', false, 'goblin'); g.x = dest.x + px * 0.5; g.z = dest.z + pz * 0.5; g.sync(0);
    P.x = dest.x; P.z = dest.z; P.vx = P.vz = 0; P.keys = {};
    m.t = TT.shelfEvery - TT.shelfSlide - 0.001; pending.length = 0;
    const before = { x: P.x, z: P.z };
    updateMovers(0.01);
    out.sliding = m.sliding; out.strip = [0, 1, 2, 3].map(i => f.tiles[(m.y + m.dy * i) * f.w + m.x + m.dx * i] === T_WALL).every(Boolean);
    out.ring = pending.filter(n => n.r === TT.shelfRing).length;
    out.playerOut = !Player.wallHit(f, P.x, P.z, P.radius);
    const u = (P.x - (m.x + 0.5) * TILE) * px + (P.z - (m.y + 0.5) * TILE) * pz; out.pushed = Math.hypot(P.x - before.x, P.z - before.z); out.clear = Math.abs(u) - TILE / 2;   // metres beyond the shelf's edge
    out.guardOut = !Player.wallHit(f, g.x, g.z, 0.4);
    out.losBlocked = !hasLOS(f, ax, az, bx, bz);
    // while it slides: the whole strip is a wall to a guard's path finder (no path tile on it)
    const open = (x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && f.tiles[y * f.w + x] === T_FLOOR && !f.blocked[y * f.w + x];
    out.pathOk = null;                                                                // two open tiles on either side of the strip: the path between them must not use a strip tile
    for (let i = 0; i < 4 && out.pathOk === null; i++) for (let d = 1; d <= 2 && out.pathOk === null; d++) {
      const A = { x: m.x + m.dx * i - px * d, y: m.y + m.dy * i - pz * d }, B = { x: m.x + m.dx * i + px * d, y: m.y + m.dy * i + pz * d };
      if (open(A.x, A.y) && open(B.x, B.y)) { const path = findPath(f, A.x, A.y, B.x, B.y); out.pathOk = path.length > 0 ? path.every(t => ![0, 1, 2, 3].some(k => t.x === m.x + m.dx * k && t.y === m.y + m.dy * k)) : 'nopath'; }
    }
    // it arrives after the slide: the old half opens, the new half stays wall
    for (let i = 0; i < 25; i++) updateMovers(0.05);
    out.after = [f.tiles[idx(k0, 0)] === T_FLOOR, f.tiles[idx(k0, 1)] === T_FLOOR, f.tiles[idx(1 - k0, 0)] === T_WALL, f.tiles[idx(1 - k0, 1)] === T_WALL, m.k === 1 - k0, !m.sliding];
    const a = f.moverMesh.instanceMatrix.array, o = (f.moverBase) * 16, want = centre(1 - k0, 0);
    out.pose = Math.abs(a[o + 12] - want.x) < 1e-3 && Math.abs(a[o + 14] - want.z) < 1e-3;
    // a full cycle: exactly one flip per shelfEvery seconds, one grinding noise per flip
    pending.length = 0; const flips0 = m.k; let flips = 0, last = m.k;
    for (let i = 0; i < 360; i++) { updateMovers(0.05); if (m.k !== last) { flips++; last = m.k; } }   // 18 s
    out.flips = flips; out.noises = pending.filter(n => n.r === TT.shelfRing).length;
    // a floor rebuilt in the middle of a slide finishes it
    m.t = TT.shelfEvery - TT.shelfSlide + 0.5; updateMovers(0.01); const kMid = m.k; out.midSliding = m.sliding;
    return out;
  });
  check('this seed has a Library floor with sliding shelves', ms.found);
  if (ms.found) {
    check('the shelves are extra instances of the wall mesh (no extra draw call), at rest the shelf half is wall and the other half open', ms.inst.length === 1 && ms.sameMesh && ms.rest.every(Boolean), JSON.stringify([ms.inst, ms.rest]));
    check('the numbers: 6 s cycle, 1 s slide, 6 m ring, 0.4 m shove', JSON.stringify(ms.numbers) === JSON.stringify([6, 1, 6, 0.4]), JSON.stringify(ms.numbers));
    check('when a slide starts the whole strip turns solid, the grinding rings out (6 m) and sight across it is blocked', ms.losOpen && ms.sliding && ms.strip && ms.ring === 1 && ms.losBlocked, JSON.stringify([ms.losOpen, ms.sliding, ms.strip, ms.ring, ms.losBlocked]));
    check('whoever stands where the shelf is heading is shoved clear (past its edge by 0.4 m), player and guard alike', ms.playerOut && ms.guardOut && ms.pushed > 0 && ms.clear >= 0.4 - 1e-6, JSON.stringify([ms.playerOut, ms.guardOut, ms.pushed, ms.clear]));
    check('guards path around the moving shelf as around a wall (no path tile on the strip)', ms.pathOk === true || ms.pathOk === 'nopath' || ms.pathOk === null, 'path ' + ms.pathOk);
    check('after the slide the old half opens, the new half stays wall, and the instances sit on it', ms.after.every(Boolean) && ms.pose, JSON.stringify([ms.after, ms.pose]));
    check('one flip and one grinding noise every 6 s', ms.flips === 3 && ms.noises === 3, `${ms.flips} flips, ${ms.noises} noises in 18 s`);
  }
  const leak1 = await page.evaluate(async () => { const o = []; for (let k = 0; k < 4; k++) { game.startFloor(1); await T.sleep(100); const i = game.renderInfo(); o.push(i.geos + '/' + i.tex); } return o; });
  check('rebuilding Library floors frees their geometry and textures (geometries within 2 of the first rebuild, textures exactly flat)', leak1.every(v => Math.abs(parseInt(v) - parseInt(leak1[0])) <= 2 && v.split("/")[1] === leak1[0].split("/")[1]), leak1.join(', '));
  // standing just OUTSIDE the heading tile (0.1 m from its edge, so the collider overlaps it once it turns solid): you and a guard must be able to walk away
  const edge = await page.evaluate(async () => {
    const P = game.player, TT = theme.mechanic.TUNE, out = { tried: 0 };
    for (let n = 1; n <= 4; n++) {
    game.startFloor(n); await T.sleep(80); const f = floor;
    for (const m of f.movers || []) {
      updateMovers(3); updateMovers(3);                                           // let any slide finish
      for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh); game.enemies.length = 0;
      const px = m.dy, pz = m.dx, dest = { x: (m.x + m.dx * 2 * (1 - m.k) + 0.5) * TILE, z: (m.y + m.dy * 2 * (1 - m.k) + 0.5) * TILE };
      for (const s of [1, -1]) {
        const x = dest.x + px * s * (TILE / 2 + 0.1), z = dest.z + pz * s * (TILE / 2 + 0.1);
        if (Player.wallHit(f, x, z, P.radius) || Player.wallHit(f, x, z, 0.4)) continue;
        const g = T.guard(3, 'away', false, 'goblin'); g.x = x; g.z = z - pz * 0 + 0; g.sync(0);
        P.x = x + px * s * 0 + (m.dx ? 0 : 0); P.z = z; P.vx = P.vz = 0;
        g.x = x; g.z = z + (m.dx ? 0 : 0.0);
        out.tried++; m.t = TT.shelfEvery - TT.shelfSlide - 0.001; updateMovers(0.01);
        const away = (o, r) => { const nx = o.x + px * s * 0.05, nz = o.z + pz * s * 0.05; return !Player.wallHit(f, nx, nz, r); };
        out.sliding = m.sliding; out.playerFree = !Player.wallHit(f, P.x, P.z, P.radius) && away(P, P.radius); out.guardFree = !Player.wallHit(f, g.x, g.z, 0.4) && away(g, 0.4);
        return out;
      }
    }
    }
    return out;
  });
  check('standing 0.1 m outside the heading tile when the shelf turns solid: the player and a guard are moved clear and can walk away', edge.tried > 0 && edge.playerFree && edge.guardFree && edge.sliding, JSON.stringify(edge));
  // the shelf blocks movement too: the player cannot walk onto its tiles while it rests there
  const wk = await page.evaluate(() => {
    const f = floor, m = f.movers && f.movers[0]; if (!m) return null;
    const c = { x: (m.x + m.dx * (2 * m.k) + 0.5) * TILE, z: (m.y + m.dy * (2 * m.k) + 0.5) * TILE };
    return Player.wallHit(f, c.x, c.z, game.player.radius);
  });
  check('a shelf at rest blocks movement', wk === null || wk === true);
  await page.close();

  // ---------- a corpse that dies in brush is not faint (Jungle) ----------
  page = await open(seeds[JUNG]);
  const br = await page.evaluate(async () => {
    const out = {}; T.reset(); const P = game.player;
    const b = [...floor.patches].find(([k, v]) => v === 'brush')[0], bx = b % floor.w, by = (b / floor.w) | 0;
    const e = T.guard(3, 'away', false, 'goblin'); e.x = (bx + 0.5) * TILE; e.z = (by + 0.5) * TILE; e.sync(0);
    updateBrush(); out.faint = e.mats[0].opacity < 1 && e.mats[0].transparent;
    e.hp = 0; e.dead = true; e.hurt(1, P); updateBrush();
    out.dead = e.dead; out.solid = e.mats[0].opacity === 1 && !e.mats[0].transparent && !e.inBrush;
    return out;
  });
  check('an enemy that dies in brush is drawn solid again (its corpse is not faint)', br.faint && br.dead && br.solid, JSON.stringify(br));
  await page.close();
});
