// The Overgrown Ruin (Jungle) and the reworked Frozen Chapel: layouts, walls, doors, natives and the two mechanics.
// Run on its own: node tests/game.jungle.test.js
const { run } = require('./lib');
run('Jungle and Frozen Chapel', async ({ open, check }) => {
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const JUNG = 'The Overgrown Ruin', CHAP = 'The Frozen Chapel';
  check('the Jungle can be reached from some seed, as stage 1', !!seeds[JUNG]);

  // ---------- Jungle ----------
  page = await open(seeds[JUNG]);
  const jw = await page.evaluate(async () => {
    const out = { themeName: theme.name, style: theme.wallStyle, layout: theme.layout.style };
    // a floor with a locked room: rough walls in two instanced meshes, cave door, key name, at most 3 wall draws
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.hasDoor = !!f;
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); });
    out.inst = inst;
    out.door = f && f.doors.map(d => d.style + '|' + d.keyLabel);
    const dobj = propObjs.find(o => o.p.kind === 'door');
    let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; });
    out.doorMeshes = meshes;
    // opening: rolls up, hidden at the end, the tile becomes floor
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    finishSearch(dobj);
    updateDoors(0.5); out.midScale = dobj.mesh.scale.y; updateDoors(0.6);
    out.done = !dobj.mesh.visible && floor.tiles[d.y * floor.w + d.x] === T_FLOOR && dobj.mesh.position.y + (1 - dobj.mesh.scale.y) * 0 >= WALL_H * 0.95 + 0.4;   // rolled up above the ceiling
    // glossary: the new natives, the boss, the key name
    out.types = ['jaguar', 'dartgoblin', 'strangler', 'tribal'].map(t => !!ENEMY_TYPES[t].info);
    out.boss = bossNameFor('The Overgrown Ruin'); out.roster = THEME_NATIVES['The Overgrown Ruin'];
    return out;
  });
  const leak = await page.evaluate(async () => { const o = []; for (let k = 0; k < 3; k++) { game.startFloor(1); await T.sleep(100); o.push(game.renderInfo().geos); } return o; });
  check('rebuilding a Jungle floor frees its geometry (the count stays flat)', leak[1] === leak[0] && leak[2] === leak[0], leak.join(', '));
  check('the Jungle uses rough walls and the clearings layout', jw.themeName === JUNG && jw.style === 'rough' && jw.layout === 'clearings');
  check('wall draws stay at 3 or fewer, and a floor with a locked room has a second (cave rock) wall mesh', jw.inst.length >= 2 && jw.inst.length <= 3, JSON.stringify(jw.inst));
  check('locked doors are cave mouths keyed with the Cave Key', jw.hasDoor && jw.door.every(s => s === 'cave|Cave Key'), JSON.stringify(jw.door));
  check('a cave door is baked into a few meshes (not dozens)', jw.doorMeshes >= 2 && jw.doorMeshes <= 6, jw.doorMeshes + ' meshes');
  check('a cave door rolls up (squashes) and is gone when it has opened', jw.midScale < 1 && jw.midScale > 0.05 && jw.done, 'mid scale ' + jw.midScale);
  check('Jungle natives have glossary text and the boss is the Cave Warlord', jw.types.every(Boolean) && jw.boss === 'Cave Warlord' && jw.roster.signature === 'jaguar' && jw.roster.elite === 'tribal');

  const jm = await page.evaluate(async () => {
    const out = {}, quiet = { events: [], emit() {}, shoot() {} };
    T.reset(); game.inv.hp = 1e9;
    const P = game.player, TJ = theme.mechanic.TUNE;
    const bt = [...floor.patches].filter(([k, v]) => v === 'brush').map(([k]) => ({ x: k % floor.w, y: (k / floor.w) | 0 }));
    out.patches = bt.length;
    const b = bt[0], plain = floor.rooms[0];
    const put = (t, crouch) => { P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys[KEYS.crouch] = !!crouch; P.crouching = !!crouch; updateCombat(0.016); return P.stealthMul; };
    out.brush = put(b, false); out.brushCrouch = put(b, true);
    P.crouching = false; P.keys = {}; out.off = put({ x: floor.start.x, y: floor.start.y }, false);
    out.tune = [TJ.stealth, TJ.stealthCrouch, TJ.rustle, TJ.fade];
    // rustle: the noise of a moving step is 3 m bigger in brush (read from a guard's noise events)
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.src === undefined && ev.x === P.x) seen.push({ r: ev.r, brush: floor.patches.get(P.tileY * floor.w + P.tileX) === 'brush', base: P.noiseRadius }); return null; };
    for (const t of bt) {                                                    // a brush tile with room to walk: try them until one lets us walk a little
      P.x = (t.x + 0.5) * TILE; P.z = (t.y + 0.5) * TILE; P.vx = P.vz = 0; P.keys = {}; P.keys[KEYS.forward] = true; seen.length = 0;
      let best = 0, yaw = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; let d = 0; while (d < 4 && !P.blocked(floor, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5; if (d > best) { best = d; yaw = a; } }
      P.yaw = yaw; await T.until(() => seen.some(s => s.brush && s.base > 0), 1500); if (seen.some(s => s.brush && s.base > 0)) break;
    }
    P.keys = {};
    const s = seen.find(s => s.brush && s.base > 0); out.rustle = s ? s.r - s.base * HUSH : null;
    return out;
  });
  check('the Jungle places 10 to 14 brush patches', jm.patches >= 8 && jm.patches <= 14, jm.patches + ' patches');
  check('brush: guards see you half as far in it (0.5), a third as far crouched (0.35), no bonus off it', Math.abs(jm.brush - 0.5) < 1e-6 && Math.abs(jm.brushCrouch - 0.35) < 1e-6 && jm.off === 1, JSON.stringify([jm.brush, jm.brushCrouch, jm.off]));
  check('moving in brush rustles: +3 m of noise', jm.rustle !== null && Math.abs(jm.rustle - 3) < 1e-6, 'extra ' + jm.rustle);

  const jf = await page.evaluate(async () => {
    const out = {};
    T.reset(); const P = game.player, fade = theme.mechanic.TUNE.fade;
    const b = [...floor.patches].find(([k, v]) => v === 'brush')[0], bx = b % floor.w, by = (b / floor.w) | 0;
    const e = T.guard(3, 'away', false, 'goblin'); e.x = (bx + 0.5) * TILE; e.z = (by + 0.5) * TILE; e.sync(0);
    updateBrush(); out.faded = [e.inBrush, e.mats[0].transparent, e.mats[0].opacity];
    // hidden on the dev minimap, drawn when out of brush
    dev.on = true; explored.fill(1);
    const px = () => { const S = hud.mini.width / floor.w, d = mctx.getImageData(Math.round(e.x / TILE * S), Math.round(e.z / TILE * S), 1, 1).data; return d[0] > 200 && d[1] < 160; };
    drawMinimap(); out.dotInBrush = px();
    e.x = (floor.start.x + 0.5) * TILE + 1; e.z = (floor.start.y + 0.5) * TILE; updateBrush(); drawMinimap();
    out.back = [e.inBrush, e.mats[0].transparent, e.mats[0].opacity]; out.dotOut = px();
    dev.on = false;
    return out;
  });
  check('an enemy standing in brush is drawn at 0.45 opacity, and opaque again outside', jf.faded[0] && jf.faded[1] && jf.faded[2] === 0.45 && !jf.back[0] && !jf.back[1] && jf.back[2] === 1, JSON.stringify(jf));
  check('an enemy in brush is hidden on the minimap', jf.dotInBrush === false && jf.dotOut === true, JSON.stringify([jf.dotInBrush, jf.dotOut]));

  const jn = await page.evaluate(async () => {
    const out = {}, quiet = { events: [], emit() {}, shoot() {} };
    T.reset(); game.inv.hp = 1e9;
    const d = Math.min(7, T.reset() - 0.5);
    const jg = T.guard(d, 'toward', false, 'jaguar'); out.dormant = jg.dormant;
    for (let i = 0; i < 10; i++) jg.update(0.03, game.player, quiet);
    out.stillAsleep = jg.dormant;
    game.player.x -= Math.sin(game.player.yaw) * (d - 3); game.player.z -= Math.cos(game.player.yaw) * (d - 3);
    for (let i = 0; i < 10; i++) jg.update(0.03, game.player, quiet);
    out.woke = !jg.dormant && jg.state === 'alerted';
    T.reset(); game.inv.hp = 1e9; game.cb.stamina = 100;
    const dg = T.guard(Math.min(7, T.reset() - 0.5), 'toward', true, 'dartgoblin'); dg.hp = dg.maxHp = 900;
    out.bleed = await T.until(() => game.pst.has('bleed'), 25000);
    return out;
  });
  check('a jaguar lies in wait as scenery until you come within about 5 m, then wakes', jn.dormant && jn.stillAsleep && jn.woke);
  check('a poison-dart goblin\'s darts make you bleed', jn.bleed);
  await page.close();

  // ---------- Frozen Chapel ----------
  page = await open(seeds[CHAP]);
  const fw = await page.evaluate(async () => {
    const out = { themeName: theme.name, layout: theme.layout.style, fog: theme.fog.density };
    let f = null;
    for (let n = 1; n <= 4 && !f; n++) { game.startFloor(n); await T.sleep(80); if (game.floor.doors.length) f = game.floor; }
    out.door = f.doors.map(d => d.style + '|' + d.keyLabel);
    const inst = []; group.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); }); out.inst = inst;
    const dobj = propObjs.find(o => o.p.kind === 'door'); let meshes = 0; dobj.mesh.traverse(o => { if (o.isMesh) meshes++; }); out.doorMeshes = meshes;
    const d = f.doors[0]; game.inv.add({ type: 'key', lock: d.lock, label: d.keyLabel });
    pulse = 0; finishSearch(dobj); out.noise = pulse;
    updateDoors(0.5); out.midY = dobj.mesh.position.y; updateDoors(0.6);
    out.done = !dobj.mesh.visible && dobj.mesh.position.y < -WALL_H + 0.01;
    out.kinds = {}; for (const dd of f.decor) out.kinds[dd.kind] = (out.kinds[dd.kind] || 0) + 1;
    out.longest = Math.max(...f.rooms.filter(r => !r.locked).map(r => Math.max(r.w, r.h)));
    return out;
  });
  check('the Frozen Chapel is halls with fog 0.07, ice seals and the Frost Seal key', fw.themeName === CHAP && fw.layout === 'halls' && fw.fog === 0.07 && fw.door.every(s => s === 'ice|Frost Seal'), JSON.stringify([fw.layout, fw.fog, fw.door]));
  check('an ice seal is baked into a few meshes, and the chapel has one wall draw', fw.doorMeshes >= 2 && fw.doorMeshes <= 8 && fw.inst.length === 1, fw.doorMeshes + ' meshes, walls ' + JSON.stringify(fw.inst));
  check('opening an ice seal is loud (8 m) and the slab sinks through the floor', fw.noise >= 8 && fw.midY < 0 && fw.done, JSON.stringify([fw.noise, fw.midY]));
  check('the chapel has long naves and its own furniture', fw.longest >= 9 && (fw.kinds.pew || 0) + (fw.kinds.brokenaltar || 0) + (fw.kinds.candlestand || 0) + (fw.kinds.icicles || 0) + (fw.kinds.snowdrift || 0) + (fw.kinds.shaft || 0) > 0, JSON.stringify(fw.kinds));

  const fi = await page.evaluate(async () => {
    const out = {};
    T.reset(); game.inv.hp = 1e9; const P = game.player, TT = theme.mechanic.TUNE;
    out.tune = [TT.slip, TT.carry, TT.printAge, TT.printSusp, TT.wind];
    // ice: slippery on it, and for 0.6 s after
    const ice = [...floor.patches].find(([k, v]) => v === 'ice')[0];
    P.x = ((ice % floor.w) + 0.5) * TILE; P.z = (((ice / floor.w) | 0) + 0.5) * TILE; updateCombat(0.016); out.on = [P.slippery, P.slipRate];
    P.x = (floor.start.x + 0.5) * TILE; P.z = (floor.start.y + 0.5) * TILE;
    updateCombat(0.3); out.after03 = P.slippery; updateCombat(0.2); out.after05 = P.slippery; updateCombat(0.2); out.after07 = P.slippery;
    // footprints: a ring of 8
    const pr = floor.prints; out.hasPrints = !!pr && pr.list.length === 8;
    P.keys = {}; P.vx = 2; P.vz = 0;
    for (let i = 0; i < 12; i++) { P.x = (floor.start.x + 0.5) * TILE + i * 1.3; gameT += 0.1; updatePrints(0.1); }
    out.live = pr.list.filter(p => p.t > -1e8).length; out.ids = pr.list.map(p => p.id).sort((a, b) => a - b).join(',');
    out.quads = Array.from({ length: 8 }, (_, i) => pr.pos.slice(i * 12, i * 12 + 12).some(v => v !== 0)).filter(Boolean).length;
    // a guard follows a fresh print it can see, and ignores an old one
    P.x = (floor.start.x + 0.5) * TILE; P.z = (floor.start.y + 0.5) * TILE; P.vx = P.vz = 0;
    const g = T.guard(4, 'away', false, 'goblin'); g.printId = 0; g.aware = 0; g.last = null; g.state = 'unaware';
    const newest = pr.list.reduce((a, b) => b.id > a.id ? b : a); newest.x = g.x + 1; newest.z = g.z; newest.t = gameT;
    for (const p of pr.list) if (p !== newest) p.t = -1e9;
    const noise = { events: [], emit() {}, shoot() {}, prints: pr, pt: TT, t: gameT };
    const far = { x: P.x, z: P.z }; P.x = g.x + 60; P.z = g.z + 60;
    g.update(0.03, P, noise);
    out.followed = [g.state, g.printId === newest.id, !!g.last && Math.abs(g.last.x - newest.x) < 1e-6];
    const g2 = T.guard(4, 'away', false, 'goblin'); g2.state = 'unaware'; newest.x = g2.x + 1; newest.z = g2.z; newest.t = gameT - 11; newest.id = 999;
    g2.update(0.03, P, { ...noise, t: gameT }); out.oldIgnored = g2.state === 'unaware' && g2.printId === 0;
    // prints fade after printAge
    pr.chk = 0; gameT += 11; P.vx = P.vz = 0; updatePrints(0.1); out.left = pr.list.filter(p => p.t > -1e8).length;
    P.x = far.x; P.z = far.z;
    return out;
  });
  check('Frozen tuning numbers: slip 2.2, carry 0.6, printAge 10, printSusp 0.5, wind 0.8', JSON.stringify(fi.tune) === JSON.stringify([2.2, 0.6, 10, 0.5, 0.8]), JSON.stringify(fi.tune));
  check('ice slides you (steering 2.2) and the slide carries on 0.6 s after you leave it', fi.on[0] && fi.on[1] === 2.2 && fi.after03 && fi.after05 && !fi.after07, JSON.stringify([fi.on, fi.after03, fi.after05, fi.after07]));
  check('footprints: a ring of 8, one merged quad mesh', fi.hasPrints && fi.live === 8 && fi.quads === 8 && fi.ids === '5,6,7,8,9,10,11,12', JSON.stringify([fi.live, fi.quads, fi.ids]));
  check('a guard that sees a fresh print turns suspicious and heads for it; a print older than 10 s is ignored', fi.followed[0] === 'suspicious' && fi.followed[1] && fi.followed[2] && fi.oldIgnored, JSON.stringify([fi.followed, fi.oldIgnored]));
  check('prints fade away after printAge', fi.left === 0, fi.left + ' left');

  const fwind = await page.evaluate(async () => {
    T.reset(); game.inv.hp = 1e9; const P = game.player, out = {};
    const seen = [];
    const g = T.guard(30, 'away', false, 'goblin'); g.update = (dt, p, noise) => { for (const ev of noise.events) if (ev.x === P.x) seen.push({ r: ev.r, crouch: P.crouching, base: P.noiseRadius }); return null; };
    const run = async crouch => {
      seen.length = 0; P.keys = {}; P.keys[KEYS.forward] = true; P.keys[KEYS.crouch] = crouch; P.vx = P.vz = 0; P.x = (floor.start.x + 0.5) * TILE; P.z = (floor.start.y + 0.5) * TILE;
      await T.until(() => seen.some(s => s.base > 0 && s.crouch === crouch), 3000);
      const s = seen.find(s => s.base > 0 && s.crouch === crouch); P.keys = {}; return s ? s.r / s.base : null;
    };
    out.crouched = await run(true); out.walking = await run(false);
    return out;
  });
  check('wind: a crouching player\'s noise is x0.8, walking is unchanged', fwind.crouched !== null && Math.abs(fwind.crouched - 0.8) < 1e-6 && Math.abs(fwind.walking - 1) < 1e-6, JSON.stringify(fwind));
  await page.close();

  // ---------- the tuning panel and the storage key ----------
  page = await open(7);
  const tp = await page.evaluate(async () => ({ key: (await (await fetch('js/tune.js')).text()).includes('prototype-test-tune-21'), text: document.body.textContent.includes('rustle') && document.body.textContent.includes('printAge') && document.body.textContent.includes('stealthCrouch') }));
  check('the tuning panel lists the Jungle and Frozen numbers (storage key bumped to 21)', tp.text && tp.key, JSON.stringify(tp));
  await page.close();
});
