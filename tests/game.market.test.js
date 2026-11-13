// The reworked Goblin Market (bazaar layout, shuttered stalls, Stall Key, crowd patches that muffle and hide you, watching guards, more thieves) and the Final Chamber
// (rune pillars, dais, rune circle that swells and flares). Run on its own: node tests/game.market.test.js
const { run } = require('./lib');
run('Goblin Market and Final Chamber', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const MARK = 'The Goblin Market';

  // ---------- Goblin Market ----------
  page = await open(seeds[MARK]);
  const mw = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, tex: theme.tex, mt: { ...theme.mechanic.TUNE }, tune: +((await (await fetch('js/tune.js')).text()).match(/prototype-test-tune-(\d+)/) || [])[1] >= 24 };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f; out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes;
    out.kinds = {}; for (const d of f.decor) out.kinds[d.kind] = (out.kinds[d.kind] || 0) + 1;
    let stallWalls = 0; for (const r of f.rooms) if (!r.locked) for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (f.tiles[y * f.w + x] === T_WALL) stallWalls++;
    out.stallWalls = stallWalls;
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    updateDoors(0.5); out.midY = dobj.mesh.position.y; out.midScale = dobj.mesh.scale.y; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR;
    out.tx = [!!themeTex.get(theme.name + '|wall'), !!themeTex.get(theme.name + '|floor'), !!themeTex.get(theme.name + '|ceil')];
    return out;
  });
  check('the Market is a bazaar with canvas walls, a cobbled floor, a patchwork ceiling and shuttered stalls keyed with the Stall Key', mw.themeName === MARK && mw.layout === 'bazaar' && mw.tex.wall === 'canvas' && mw.tex.floor === 'cobble' && mw.tex.ceil === 'patchwork' && mw.hasDoor && mw.door.every(s => s === 'shutter|Stall Key'), JSON.stringify([mw.layout, mw.tex, mw.door]));
  check('stall blocks stand inside the squares, one wall draw, a shutter baked into a few meshes, textures cached per theme', mw.stallWalls >= 4 && mw.inst.length === 1 && mw.doorMeshes >= 2 && mw.doorMeshes <= 14 && mw.tx.every(Boolean), JSON.stringify([mw.stallWalls, mw.inst, mw.doorMeshes, mw.tx]));
  check('the shutter rolls up (shrinking) and clatters (5 m)', mw.midY > 0.5 && mw.midScale < 1 && mw.done && mw.noise >= 5, JSON.stringify([mw.midY, mw.midScale, mw.done, mw.noise]));
  check('the Market has its own furniture (stalls, awnings, festoons, crowd patches)', (mw.kinds.stall || 0) + (mw.kinds.awning || 0) + (mw.kinds.festoon || 0) > 0 && (mw.kinds.crowd || 0) >= 12, JSON.stringify(mw.kinds));
  check('the crowd numbers live in the theme (blend 0.8, din 0.6, watch 10 m, awareness 0.5) and the tuning key was bumped', mw.mt.blend === 0.8 && mw.mt.din === 0.6 && mw.mt.watchR === 10 && mw.mt.watchAware === 0.5 && mw.tune, JSON.stringify(mw.mt));

  // crowd patches: blend in (guards see you 0.8 x as far) and footsteps 0.6 x as loud
  const cw = await page.evaluate(async () => {
    const out = {};
    T.reset(); pulse = 0; game.inv.hp = 1e9; const P = game.player, f = game.floor;   // (pulse: the shutter's clatter from the test above is still waiting to be heard)
    const crowd = [...f.patches].filter(([, v]) => v === 'crowd').map(([i]) => ({ x: i % f.w, y: (i / f.w) | 0 }));
    out.n = crowd.length;
    const put = t => { P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; };
    put(crowd[0]); updateCombat(0.016); out.onCrowd = P.stealthMul; out.disc = discovered.has('item:crowd');
    put(f.start); updateCombat(0.016); out.off = P.stealthMul;
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.src === undefined && ev.x === P.x) seen.push({ r: ev.r, crowd: f.patches.get(P.tileY * f.w + P.tileX) === 'crowd' }); };
    const walk = async t => {
      put(t); P.keys = {}; P.keys[KEYS.forward] = true; seen.length = 0;
      let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 4 && !P.blocked(f, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
      P.yaw = yaw; await T.until(() => seen.some(s => s.crowd === (t !== f.start)), 1500); P.keys = {};
      const m = seen.filter(s => s.crowd === (t !== f.start)); return m.length ? Math.max(...m.map(s => s.r)) : 0;
    };
    let on = 0; for (const t of crowd) { on = await walk(t); if (on) break; }
    out.noiseOn = on; out.noiseOff = await walk(f.start);
    return out;
  });
  check('the Market floor has 12 to 20 crowd patches', cw.n >= 12 && cw.n <= 20, cw.n + ' patches');
  check('on a crowd patch guards see you 0.8 x as far, off it 1 x, and the first time is logged in the glossary', Math.abs(cw.onCrowd - 0.8) < 1e-6 && cw.off === 1 && cw.disc, JSON.stringify([cw.onCrowd, cw.off, cw.disc]));
  check('the din covers your footsteps on a crowd patch (0.6 x the noise)', cw.noiseOn > 0 && cw.noiseOff > 0 && Math.abs(cw.noiseOn / cw.noiseOff - 0.6) < 0.05, JSON.stringify([cw.noiseOn, cw.noiseOff]));

  // watching guards: rifling a chest in sight of a guard puts it on notice
  const wg = await page.evaluate(async () => {
    const out = {};
    T.reset(); game.inv.hp = 1e9; const P = game.player, f = game.floor;
    const chest = propObjs.find(o => o.p.kind === 'chest' && !o.p.mimic && !o.p.locked && !o.p.trap);
    const d = Math.min(6, T.reset() - 0.5);
    const near = T.guard(d, 'away', false, 'goblin'), far = T.guard(0.5 + 15, 'away', false, 'goblin'), hunting = T.guard(d, 'away', true, 'goblin');
    far.x = P.x - Math.sin(P.yaw) * 14; far.z = P.z - Math.cos(P.yaw) * 14;   // beyond the 10 m watch range, in the same corridor
    hunting.hp = hunting.maxHp = 1e9; hunting.aware = 1;
    near.aware = 0; far.aware = 0;
    finishSearch(chest);
    out.near = [near.aware, !!near.last]; out.far = far.aware; out.hunting = hunting.state;
    out.flash = document.getElementById('log').textContent;
    return out;
  });
  check('a guard in sight within 10 m that sees you rifle a chest is put on notice (awareness 0.5, knows where), one out of range is not', wg.near[0] >= 0.5 && wg.near[1] && wg.far === 0, JSON.stringify(wg));
  check('the stallkeeper alarm is announced', /stallkeeper/i.test(wg.flash), wg.flash);

  // thieves are more common than the signature rule alone gives
  const th = await page.evaluate(() => {
    const cnt = (name, n) => { let t = 0; for (let s = 1; s <= 30; s++) { const f = generateFloor(s * 977, n, { themeName: name }); assignEnemyTypes(f, s * 977, n, name); t += f.enemies.filter(e => e.type === 'thief' || e.type === 'puffer' || e.type === 'wisp' || e.type === 'jaguar' || e.type === 'golem').length; } return t / 30; };
    return { market2: cnt('The Goblin Market', 2), market4: cnt('The Goblin Market', 4), library2: cnt('The Clockwork Library', 2), library4: cnt('The Clockwork Library', 4) };
  });
  check('the Market has about one more thief than a plain signature native (2 on floors 2 and 3, 3 on floor 4)', th.market2 >= th.library2 + 0.8 && th.market4 >= th.library4 + 0.8 && th.market2 >= 1.8 && th.market4 >= 2.6, JSON.stringify(th));
  const leak = await page.evaluate(async () => { const o = []; for (let k = 0; k < 4; k++) { game.startFloor(1); await T.sleep(100); const i = game.renderInfo(); o.push(i.geos + '/' + i.tex); } return o; });
  check('rebuilding Market floors frees geometry and textures', leak.every(v => Math.abs(parseInt(v) - parseInt(leak[0])) <= 2 && v.split('/')[1] === leak[0].split('/')[1]), leak.join(', '));
  const tp = await page.evaluate(() => ({ crowd: document.body.textContent.includes('watchAware'), runes: document.body.textContent.includes('flareSeen') }));
  check('the tuning panel lists the Market and Final Chamber numbers', tp.crowd && tp.runes, JSON.stringify(tp));
  await page.close();

  // ---------- Final Chamber ----------
  page = await open(seeds[MARK]);
  const fw = await page.evaluate(async () => {
    const out = {};
    game.startStage(5); await T.sleep(250);
    const f = game.floor, P = game.player; out.themeName = theme.name; out.tex = theme.tex; out.boss = !!f.boss;
    out.kinds = {}; for (const d of f.decor) out.kinds[d.kind] = (out.kinds[d.kind] || 0) + 1;
    out.runes = f.runes; out.keysTx = [!!themeTex.get(theme.name + '|wall'), !!themeTex.get(theme.name + '|floor'), !!themeTex.get(theme.name + '|ceil')];
    const pil = propObjs.filter(o => o.kind === 'rpillar'); out.pillars = pil.length; out.pillarBlocks = pil.every(o => o.r >= 0.6);
    let runeMeshes = 0; group.traverse(o => { if (o.material === RUNE_MAT || o.material === MIST_MAT) runeMeshes++; }); out.runeMeshes = runeMeshes;
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst.length;
    const T_ = theme.mechanic.TUNE; out.mt = { ...T_ };
    // the circle's pulse: calm, building up, flaring
    const centre = f.runes; P.x = centre.x + 10; P.z = centre.z; P.vx = P.vz = 0;
    gameT = 0; out.calm = [updateRunes(), RUNE_MAT.opacity];
    gameT = T_.flareEvery - T_.flareLen - T_.flareWarn * 0.5; out.warn = [updateRunes(), RUNE_MAT.opacity];
    gameT = T_.flareEvery - T_.flareLen * 0.5; out.flare = [updateRunes(), RUNE_MAT.opacity];
    P.x = centre.x + T_.flareR + 5; out.flareOutside = updateRunes();
    // seen x flareSeen inside the circle during a flare (in the frame's stealth rule), x 1 outside it
    P.x = centre.x + 10; gameT = T_.flareEvery - T_.flareLen * 0.5; updateCombat(0.016); out.seenIn = P.stealthMul; out.disc = discovered.has('item:runes');
    P.x = centre.x + T_.flareR + 5; gameT = T_.flareEvery - T_.flareLen * 0.5; updateCombat(0.016); out.seenOut = P.stealthMul;
    gameT = 0;
    // the arena and its calls
    P.x = centre.x; P.z = centre.z + 6; let worst = 0; for (let a = 0; a < 8; a++) { P.yaw = a * Math.PI / 4; worst = Math.max(worst, game.renderInfo().calls); }
    out.worst = worst; out.calls = game.renderInfo().calls;
    return out;
  });
  check('the Final Chamber has its own stone, obsidian floor and ceiling void, textures cached per theme, one wall draw', fw.themeName === 'The Final Chamber' && fw.boss && fw.tex.wall === 'voidstone' && fw.tex.floor === 'obsidian' && fw.tex.ceil === 'void' && fw.keysTx.every(Boolean) && fw.inst === 1, JSON.stringify([fw.tex, fw.keysTx, fw.inst]));
  check('rune pillars ring the arena (at least 14 of 22, blocking), with a dais and one rune circle', fw.pillars >= 14 && fw.pillarBlocks && fw.kinds.dais === 1 && fw.kinds.runes === 1 && fw.runes && fw.runeMeshes === 3, JSON.stringify([fw.pillars, fw.kinds, fw.runeMeshes]));
  check('the rune circle idles at about half glow, builds up in the warning and is fully lit in the flare', fw.calm[1] > 0.4 && fw.calm[1] < 0.65 && fw.warn[1] > fw.calm[1] + 0.1 && fw.warn[1] < 1 && fw.flare[1] === 1, JSON.stringify([fw.calm, fw.warn, fw.flare]));
  check('during a flare, standing inside the circle shows you up (x1.4 as far), calm or outside it does not', fw.calm[0] === 1 && fw.warn[0] === 1 && fw.flare[0] === 1.4 && fw.flareOutside === 1 && Math.abs(fw.seenIn - 1.4) < 1e-6 && fw.seenOut === 1 && fw.disc, JSON.stringify([fw.calm, fw.warn, fw.flare, fw.flareOutside, fw.seenIn, fw.seenOut, fw.disc]));
  check('the final arena stays inside the draw budget (under 220 at the start, under 260 looking round the middle)', fw.calls < 220 && fw.worst < 260, `start ${fw.calls}, worst ${fw.worst}`);

  const ow = await page.evaluate(async () => {
    game.startStage(1); game.startFloor(5); await T.sleep(150);
    const out = { runes: game.floor.runes, kinds: game.floor.decor.filter(d => d.kind === 'rpillar' || d.kind === 'dais' || d.kind === 'runes').length };
    game.startStage(5); await T.sleep(150); out.back = !!game.floor.runes;
    game.startStage(1); await T.sleep(150); out.gone = game.floor.runes;
    return out;
  });
  check('the ordinary boss arenas have no rune circle, pillars or dais, and the circle is rebuilt and dropped with the stage', ow.runes === null && ow.kinds === 0 && ow.back && ow.gone === null, JSON.stringify(ow));
  await page.close();
});
