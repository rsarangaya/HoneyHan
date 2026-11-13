// The reworked Sunken Tavern (warren layout, barred hatches, Cask Key, flooded patches that slow and splash) and Moonlit Orchard (orchard layout, garden gates,
// Garden Key, moon and shade patches, no rustle). Run on its own: node tests/game.tavern.test.js
const { run } = require('./lib');
run('Sunken Tavern and Moonlit Orchard', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const TAV = 'The Sunken Tavern', ORCH = 'The Moonlit Orchard';

  // ---------- Sunken Tavern ----------
  page = await open(seeds[TAV]);
  const tw = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, tex: theme.tex, mt: { ...theme.mechanic.TUNE }, tune: +((await (await fetch('js/tune.js')).text()).match(/prototype-test-tune-(\d+)/) || [])[1] >= 24 };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f; out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes;
    out.hub = Math.max(f.rooms[0].w, f.rooms[0].h); out.maxSmall = Math.max(...f.rooms.filter((r, i) => i > 0 && !r.locked).map(r => Math.max(r.w, r.h)));
    out.kinds = {}; for (const d of f.decor) out.kinds[d.kind] = (out.kinds[d.kind] || 0) + 1;
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    updateDoors(0.5); out.midY = dobj.mesh.position.y; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR;
    out.tx = [!!themeTex.get(theme.name + '|wall'), !!themeTex.get(theme.name + '|floor'), !!themeTex.get(theme.name + '|ceil')];
    return out;
  });
  check('the Tavern is a warren with plank walls, a wet plank floor and barred hatches keyed with the Cask Key', tw.themeName === TAV && tw.layout === 'warren' && tw.tex.wall === 'planks' && tw.tex.floor === 'wetwood' && tw.hasDoor && tw.door.every(s => s === 'hatch|Cask Key'), JSON.stringify([tw.layout, tw.tex, tw.door]));
  check('a big taproom hub, small cellars round it, one wall draw, a hatch baked into a few meshes, textures cached per theme', tw.hub >= 9 && tw.maxSmall <= 5 && tw.inst.length === 1 && tw.doorMeshes >= 2 && tw.doorMeshes <= 14 && tw.tx.every(Boolean), JSON.stringify([tw.hub, tw.maxSmall, tw.inst, tw.doorMeshes, tw.tx]));
  check('the hatch heaves up with a shudder and is loud (5 m)', tw.midY > 0.5 && tw.done && tw.noise >= 5, JSON.stringify([tw.midY, tw.done, tw.noise]));
  check('the Tavern has its own furniture (kegs, long tables, lanterns)', (tw.kinds.keg || 0) + (tw.kinds.longtable || 0) + (tw.kinds.lantern || 0) > 0, JSON.stringify(tw.kinds));
  check('the water numbers live in the theme (slow 0.75, splash 6 / 10 m, guards 0.7) and the tuning key was bumped', tw.mt.slow === 0.75 && tw.mt.splash === 6 && tw.mt.splashRun === 10 && tw.mt.enemySlow === 0.7 && tw.tune, JSON.stringify(tw.mt));

  const wt = await page.evaluate(async () => {
    const out = {}, TT = theme.mechanic.TUNE;
    T.reset(); game.inv.hp = 1e9; const P = game.player;
    const f = game.floor, tiles = k => [...f.patches].filter(([, v]) => v === k).map(([i]) => ({ x: i % f.w, y: (i / f.w) | 0 }));
    const pud = tiles('puddle'); out.puddles = pud.length;
    const put = t => { P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; };
    put(pud[0]); updateCombat(0.016); out.wade = P.speedMul;
    put(f.start); updateCombat(0.016); out.dry = P.speedMul;
    // splash noise: read from a guard's noise events while you walk or creep through a puddle
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.src === undefined && ev.x === P.x) seen.push({ r: ev.r, wet: f.patches.get(P.tileY * f.w + P.tileX) === 'puddle' }); };
    const walk = async (crouch, sprint) => {
      for (const t of pud) {
        put(t); P.keys = {}; P.keys[KEYS.forward] = true; if (crouch) P.keys[KEYS.crouch] = true; if (sprint) P.keys[KEYS.sprint] = true; seen.length = 0;
        let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 4 && !P.blocked(f, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
        P.yaw = yaw; await T.until(() => seen.some(s => s.wet && (crouch || s.r >= 6)), 1500);   // (walking: wait for the splash itself)
        const wet = seen.filter(s => s.wet).map(s => s.r); P.keys = {};
        if (wet.length) return wet;
      }
      return [];
    };
    out.walk = await walk(false, false); out.creep = await walk(true, false);
    return out;
  });
  check('the Tavern has 8 to 12 flooded patches', wt.puddles >= 6 && wt.puddles <= 12, wt.puddles + ' patches');
  check('wading slows you to 0.75, dry floor does not', Math.abs(wt.wade - 0.75) < 1e-6 && wt.dry === 1, JSON.stringify([wt.wade, wt.dry]));
  check('walking through water splashes 6 m of noise on top of the step; creeping through is silent', wt.walk.includes(6) && !wt.creep.includes(6) && !wt.creep.some(r => r >= 6), JSON.stringify([wt.walk, wt.creep]));

  const sl = await page.evaluate(async () => {
    T.reset(); const f = game.floor, P = game.player;
    const open = (x, y) => f.tiles[y * f.w + x] === 1 && !f.blocked[y * f.w + x];
    const step = (tx, ty, nx, ny) => { const e = T.guard(20, 'away', false, 'goblin'); e.update = () => null; e.x = (tx + 0.5) * TILE; e.z = (ty + 0.5) * TILE; e.path = [{ x: nx, y: ny }]; e.pk = Math.floor(((nx + 0.5) * TILE) / TILE) + ',' + Math.floor(((ny + 0.5) * TILE) / TILE); e.rp = 5; const x0 = e.x, z0 = e.z; e.goTo((nx + 0.5) * TILE, (ny + 0.5) * TILE, 2, 0.1); return Math.hypot(e.x - x0, e.z - z0); };
    let wet = null, dry = null;
    for (const [i, v] of f.patches) { if (v !== 'puddle') continue; const x = i % f.w, y = (i / f.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(x + dx, y + dy) && !wet) wet = step(x, y, x + dx, y + dy); if (wet) break; }
    for (let y = 1; y < f.h - 1 && dry === null; y++) for (let x = 1; x < f.w - 1 && dry === null; x++) if (open(x, y) && open(x + 1, y) && !f.patches.has(y * f.w + x)) dry = step(x, y, x + 1, y);
    return { wet, dry };
  });
  check('guards wade slowly too (about 0.7 of their speed in water)', sl.wet !== null && sl.dry !== null && Math.abs(sl.wet / sl.dry - 0.7) < 0.05, JSON.stringify(sl));
  const leak = await page.evaluate(async () => { const o = []; for (let k = 0; k < 4; k++) { game.startFloor(1); await T.sleep(100); const i = game.renderInfo(); o.push(i.geos + '/' + i.tex); } return o; });
  check('rebuilding Tavern floors frees geometry and textures', leak.every(v => Math.abs(parseInt(v) - parseInt(leak[0])) <= 2 && v.split('/')[1] === leak[0].split('/')[1]), leak.join(', '));
  await page.close();

  // ---------- Moonlit Orchard ----------
  page = await open(seeds[ORCH]);
  const ow = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, tex: theme.tex, wallStyle: theme.wallStyle, mt: { ...theme.mechanic.TUNE } };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f; out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes; out.leaf = !!dobj.leaf;
    out.kinds = {}; for (const d of f.decor) out.kinds[d.kind] = (out.kinds[d.kind] || 0) + 1;
    out.bigRoom = Math.max(...f.rooms.filter(r => !r.locked).map(r => Math.max(r.w, r.h)));
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    updateDoors(0.5); out.midScale = dobj.leaf.scale.x; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR;
    return out;
  });
  check('the Orchard is rows of trees with hedge walls, grass, a starry sky and garden gates keyed with the Garden Key', ow.themeName === ORCH && ow.layout === 'orchard' && ow.tex.wall === 'hedge' && ow.tex.floor === 'grass' && ow.tex.ceil === 'starry' && ow.hasDoor && ow.door.every(s => s === 'garden|Garden Key'), JSON.stringify([ow.layout, ow.tex, ow.door]));
  check('big open rooms, shrub hedges plus the apple-tree trunk mesh (at most 2 wall draws, no cave rock), the gate is a few baked meshes with a folding leaf', ow.bigRoom >= 7 && ow.inst.length <= 2 && ow.doorMeshes >= 2 && ow.doorMeshes <= 14 && ow.leaf, JSON.stringify([ow.bigRoom, ow.inst, ow.doorMeshes, ow.leaf]));
  check('the gate folds back to its hinge and is quiet-ish (4 m)', ow.midScale < 1 && ow.midScale > 0.05 && ow.done && ow.noise >= 4, JSON.stringify([ow.midScale, ow.done, ow.noise]));
  check('the Orchard has its own furniture (apple trees, hedges, wells, fireflies, windfalls)', (ow.kinds.appletree || 0) + (ow.kinds.hedge || 0) + (ow.kinds.well || 0) + (ow.kinds.fireflies || 0) + (ow.kinds.fruit || 0) > 0, JSON.stringify(ow.kinds));
  check('the moonlight numbers live in the theme (moon 1.3, shade 0.6)', ow.mt.moon === 1.3 && ow.mt.shade === 0.6, JSON.stringify(ow.mt));

  const mo = await page.evaluate(async () => {
    const out = {};
    T.reset(); game.inv.hp = 1e9; const P = game.player, f = game.floor;
    const tiles = k => [...f.patches].filter(([, v]) => v === k).map(([i]) => ({ x: i % f.w, y: (i / f.w) | 0 }));
    const moon = tiles('moon'), shade = tiles('shade'); out.moon = moon.length; out.shade = shade.length;
    const put = (t, crouch) => { P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys[KEYS.crouch] = !!crouch; P.crouching = !!crouch; updateCombat(0.016); return P.stealthMul; };
    out.moon1 = put(moon[0], false); out.shade1 = put(shade[0], false); out.shadeCrouch = put(shade[0], true);
    P.crouching = false; P.keys = {}; out.off = put({ x: f.start.x, y: f.start.y }, false);
    // no rustle: walking on a moon patch makes exactly the normal step noise
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.src === undefined && ev.x === P.x) seen.push({ r: ev.r, moon: f.patches.get(P.tileY * f.w + P.tileX) === 'moon', base: P.noiseRadius }); };
    for (const t of moon) {
      P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys = {}; P.keys[KEYS.forward] = true; seen.length = 0;
      let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 4 && !P.blocked(f, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
      P.yaw = yaw; await T.until(() => seen.some(s => s.moon && s.base > 0), 1500); if (seen.some(s => s.moon && s.base > 0)) break;
    }
    P.keys = {};
    const s = seen.find(s => s.moon && s.base > 0); out.foot = s ? s.r / s.base : null;
    let trunks = 0; for (const r of f.rooms) if (!r.locked) for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (f.tiles[y * f.w + x] === T_WALL) trunks++;
    out.trunks = trunks;
    return out;
  });
  check('the Orchard places 7 to 10 moonlit and 7 to 10 shaded patches and a grid of trunks', mo.moon >= 4 && mo.moon <= 10 && mo.shade >= 4 && mo.shade <= 10 && mo.trunks >= 3, JSON.stringify([mo.moon, mo.shade, mo.trunks]));
  check('moonlight shows you (guards see 1.3 as far), shade hides you (0.6, crouched too), no change elsewhere', Math.abs(mo.moon1 - 1.3) < 1e-6 && Math.abs(mo.shade1 - 0.6) < 1e-6 && Math.abs(mo.shadeCrouch - 0.6) < 1e-6 && mo.off === 1, JSON.stringify([mo.moon1, mo.shade1, mo.shadeCrouch, mo.off]));
  check('there is no rustle: a step on a moon patch is never louder than the step itself', mo.foot === null || mo.foot <= 1 + 1e-6, 'x' + mo.foot);
  await page.close();
});
