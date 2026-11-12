// Mimic chests and bomb goblins: placement, the bite, the blast, the chain, Rage and the seeded layout. Also locked chests (lockpick, smash), trapped chests (dart, gas, alarm, crouched disarm), the lockpick in shop stock. Run on its own: node tests/game.traps.test.js
// Seed 2654435761 has one mimic chest on floor 2 (found with generateFloor; floor 2 is never the shop or armory floor for it).
const { run } = require('./lib');
const SEED = 2654435761;

// Page-side helpers for these checks: keep only some enemies, place guards, aim, and record blasts on a game clock.
const QHELP = () => {
  const realBomb = window.updateBombs, realBlast = window.explodeAt;
  window.Q = {
    clock: 0,        // bomb seconds: the dt the bomb fuses see (not clamped), counted in updateBombs
    blasts: [],      // every explodeAt: where, who lit it, the clock, the player's distance, and the source's own fuse clock
    only(...keep) {  // remove every other enemy from the floor (the list is kept in place: Enemy.all shares it)
      for (const e of game.enemies) if (!keep.includes(e) && e.mesh.parent) e.mesh.parent.remove(e.mesh);
      game.enemies.length = 0; game.enemies.push(...keep);
    },
    // A bomb goblin, guard or mimic at (x, z). toward: faces the player. hp: the health it starts with (default 500, so it survives a blast).
    at(x, z, type, { toward = false, hp = 500 } = {}) {
      const P = game.player, f = game.floor, tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
      const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: 12345, type }, f);
      e.x = x; e.z = z; e.wait = 1e9; e.hp = e.maxHp = hp;
      e.yaw = toward ? P.yaw + Math.PI : P.yaw;
      e.mesh.visible = true; scene.add(e.mesh); game.enemies.push(e); e.sync(0);
      return e;
    },
    // Count the enemy's own fuse seconds (its update gets the clamped frame dt, so this is its game time).
    track(e) { e.tE = 0; const up = e.update; e.update = function (dt, ...r) { this.tE += dt; return up.call(this, dt, ...r); }; return e; },
    // The point d metres in front of the player, and the open run from (x, z) along yaw a (up to 12 m).
    ahead(d) { const P = game.player; return [P.x - Math.sin(P.yaw) * d, P.z - Math.cos(P.yaw) * d]; },
    run(x, z, a) { const P = game.player; let d = 0; while (d < 12 && !P.blocked(game.floor, x - Math.sin(a) * (d + 0.5), z - Math.cos(a) * (d + 0.5))) d += 0.5; return d; },
    // A fresh floor 1 for a bomb check: no enemies, the player at the start, and no blast noise left over from the last check.
    fresh() { const best = T.reset(); pending.length = 0; Q.blasts.length = 0; return best; },
    // Stand the player at (x, z) looking along yaw a.
    stand(x, z, a) { const P = game.player; P.x = x; P.z = z; P.yaw = a; P.pitch = 0; P.vx = P.vz = 0; },
    // Stand beside a chest prop, about 1.1 m off, facing it, so the search prompt picks it up.
    faceProp(o) {
      const P = game.player, f = game.floor;
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, x = o.x + Math.sin(a) * 1.1, z = o.z + Math.cos(a) * 1.1;
        if (!P.blocked(f, x, z)) { P.x = x; P.z = z; P.yaw = Math.atan2(-(o.x - x), -(o.z - z)); P.pitch = 0; P.vx = P.vz = 0; return true; }
      }
      return false;
    },
  };
  window.updateBombs = function (dt) { Q.clock += dt; return realBomb.call(this, dt); };
  window.explodeAt = function (x, z, src) {
    const P = game.player;
    Q.blasts.push({ x, z, src, clock: Q.clock, dp: Math.hypot(P.x - x, P.z - z), tE: src && src.tE });
    return realBlast.call(this, x, z, src);
  };
};

// Page-side helpers for the locked and trapped chest checks. CHESTHELP is installed once per page: it records each search as it
// finishes (how long it was held, the noise, HP and statuses straight after) and the hold time just before.
const CHESTHELP = () => {
  if (window.Q.fin !== undefined) return;
  const realUS = window.updateSearch, realFS = window.finishSearch;
  Q.fin = null; Q.prevT = 0;
  window.updateSearch = function (dt) { Q.prevT = search ? search.t : 0; return realUS.call(this, dt); };
  window.finishSearch = function (o, smashed) {
    const at = search ? search.t : null, prev = Q.prevT;
    const r = realFS.call(this, o, smashed);
    Q.fin = {
      o, at, prev, smashed: !!smashed, crouch: game.player.crouching, pulse, hp: game.inv.hp, state,
      bleed: pst.t.bleed || 0, daze: pst.t.daze || 0, slow: pst.t.slow || 0, gas: gasFx.on,
      enemies: game.enemies.map(e => ({ dc: Math.hypot(e.x - o.x, e.z - o.z), daze: e.st.t.daze || 0, slow: e.st.t.slow || 0 })),
    };
    return r;
  };
  // A chest prop to work on: not a mimic, not a key holder, not opened.
  Q.chest = () => propObjs.find(o => o.p.kind === 'chest' && !o.p.mimic && !o.p.holdsKey && !o.p.opened);
  // A spot d metres from o with a clear line to it, 2.6 m or more from the player and clear of furniture (the game pushes
  // guards out of solids, so a spot inside one would not stay put); null if none of 16 directions works.
  Q.spotNear = (o, d) => {
    const P = game.player, f = game.floor;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, x = o.x + Math.sin(a) * d, z = o.z + Math.cos(a) * d;
      if (!P.blocked(f, x, z) && hasLOS(f, o.x, o.z, x, z) && Math.hypot(x - P.x, z - P.z) > 2.6
        && f.solids.every(s => Math.hypot(x - s.x, z - s.z) > s.r + 0.6)) return [x, z];
    }
    return null;
  };
  Q.keys = on => { game.player.keys[KEYS.interact] = on; };
  Q.crouchKey = on => { game.player.keys[KEYS.crouch] = on; };
};

run('Mimic, locked and trapped chests and bomb goblins', async ({ open, check }) => {
  let page = await open(SEED);
  await page.evaluate(QHELP);

  // 1. Placement: no mimic on floor 1, and this seed has one on floor 2 that is a real dormant enemy standing on its chest.
  const place = await page.evaluate(() => {
    game.startFloor(1);
    const f1 = game.enemies.some(e => e.T.mimic) || propObjs.some(o => o.p.mimic);
    game.startFloor(2);
    const o = propObjs.find(q => q.p.mimic), e = o && o.mimic;
    const lid = e && e.lid;
    let inMesh = false; if (e && lid) { let p = lid; while (p && p !== e.mesh) p = p.parent; inMesh = p === e.mesh; }
    return {
      f1, found: !!e, dormant: !!(e && e.dormant), type: e && e.type, sameSpot: !!(e && Math.hypot(e.x - o.x, e.z - o.z) < 0.01),
      tier: e && e.spec.tier, lidInMesh: inMesh, propMeshEmpty: !!(o && o.mesh.children.length === 0), shadowOff: !!(e && (e.sync(0), !e.shadow.visible)),
    };
  });
  check('no mimic on floor 1', place.f1 === false);
  check('a floor 2 mimic is dormant, sits on its chest and is drawn by its enemy', place.found && place.dormant && place.type === 'mimic' && place.sameSpot && place.lidInMesh && place.propMeshEmpty && place.shadowOff, JSON.stringify(place));

  // 2. Seeded: the same ?seed puts the mimic on the same chest, floor after floor.
  const layout = await page.evaluate(() => { const out = []; for (const n of [2, 3, 4]) { game.startFloor(n); out.push(game.enemies.filter(e => e.T.mimic).map(e => [e.spec.x, e.spec.y, e.spec.tier])); } return out; });
  const again = await open(SEED);
  const layout2 = await again.evaluate(() => { const out = []; for (const n of [2, 3, 4]) { game.startFloor(n); out.push(game.enemies.filter(e => e.T.mimic).map(e => [e.spec.x, e.spec.y, e.spec.tier])); } return out; });
  await again.close();
  check('the same seed gives the same mimic placement on floors 2 to 4', JSON.stringify(layout) === JSON.stringify(layout2) && layout[0].length >= 1, JSON.stringify(layout));

  // 3. Searching springs it: the lid yawns, the bite comes only after the 0.45 s warning, and backing out of reach avoids it.
  const spring = await page.evaluate(async () => {
    game.startFloor(2); const o = propObjs.find(q => q.p.mimic), e = o.mimic; Q.only(e);
    game.inv.hp = 100; game.cb.stamina = 100; game.pst.clear();
    const bites = []; const real = window.resolveEnemyAttack;
    window.resolveEnemyAttack = function (en, zone, r) { if (en === e) bites.push({ windT: en.windT, hp: game.inv.hp }); return real.apply(this, arguments); };
    const out = { faced: Q.faceProp(o) };
    game.player.keys[KEYS.interact] = true;
    out.sprung = await T.until(() => !e.dormant, 12000);
    game.player.keys[KEYS.interact] = false;
    out.state = e.state; out.winding = e.winding; out.wind = e.windT_; out.opened = o.p.opened; out.msg = document.getElementById('msg').textContent;
    out.backAt = e.windT;
    // back out of reach during the warning: 3.5 m off, on the far side of an open tile
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, x = o.x + Math.sin(a) * 3.5, z = o.z + Math.cos(a) * 3.5;
      if (!game.player.blocked(game.floor, x, z)) { Q.stand(x, z, Math.atan2(-(o.x - x), -(o.z - z))); out.backed = true; break; }
    }
    out.backedAt = e.windT;
    await T.until(() => !e.winding, 6000);
    out.hpAfterBackOff = game.inv.hp; out.bitesAfterBackOff = bites.length;
    window.resolveEnemyAttack = real;
    return out;
  });
  check('searching a mimic springs it and says so', spring.faced && spring.sprung && spring.state === 'alerted' && spring.winding && spring.wind === 0.45 && spring.opened && /MIMIC/.test(spring.msg), JSON.stringify({ state: spring.state, wind: spring.wind, msg: spring.msg }));
  check('backing out of reach during the 0.45 s warning avoids the bite', spring.backed && spring.backAt < 0.45 && spring.backedAt < 0.45 && spring.bitesAfterBackOff === 0 && spring.hpAfterBackOff === 100, JSON.stringify({ backAt: spring.backAt, bites: spring.bitesAfterBackOff, hp: spring.hpAfterBackOff }));

  const bite = await page.evaluate(async () => {
    game.startFloor(2); const o = propObjs.find(q => q.p.mimic), e = o.mimic; Q.only(e);
    game.inv.hp = 100; game.cb.stamina = 100; game.pst.clear();
    const bites = []; const real = window.resolveEnemyAttack;
    window.resolveEnemyAttack = function (en, zone, r) { if (en === e) bites.push({ windT: en.windT, hp: game.inv.hp }); return real.apply(this, arguments); };
    Q.faceProp(o); game.player.keys[KEYS.interact] = true;
    await T.until(() => !e.dormant, 12000); game.player.keys[KEYS.interact] = false;
    const woke = e.windT;                                                                   // the warning starts at the wake
    await T.until(() => bites.length > 0 || game.inv.hp < 100, 6000);
    window.resolveEnemyAttack = real;
    return { woke, bites, hp: game.inv.hp };
  });
  check('a bite that stays in reach lands after the 0.45 s warning', bite.bites.length === 1 && bite.bites[0].windT >= 0.45 && bite.hp < 100, JSON.stringify({ windT: bite.bites[0] && bite.bites[0].windT, hp: bite.hp }));

  // 4. Hitting it first wakes it with no free bite.
  const hit = await page.evaluate(async () => {
    game.startFloor(2); const o = propObjs.find(q => q.p.mimic), e = o.mimic; Q.only(e);
    game.inv.hp = 100; game.cb.stamina = 100; game.pst.clear();
    Q.faceProp(o);
    dealHit(e, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
    const out = { dormant: e.dormant, winding: e.winding, windOvr: e.windOvr, atkCd: e.atkCd, state: e.state, opened: o.p.opened, hp: game.inv.hp };
    out.bitten = await T.until(() => game.inv.hp < 100, 400);                              // at most 0.4 s of game time: the first swing is 0.5 s away
    return out;
  });
  check('hitting a mimic first wakes it with no free bite', !hit.dormant && hit.state === 'alerted' && hit.opened && hit.winding === false && hit.windOvr === 0 && hit.atkCd >= 0.5 && !hit.bitten, JSON.stringify(hit));

  // 5. Killing it leaves loot one grade up, with gear guaranteed.
  const kill = await page.evaluate(async () => {
    game.startFloor(2); const o = propObjs.find(q => q.p.mimic), e = o.mimic; Q.only(e);
    game.inv.hp = 1e9; const tier = e.spec.tier | 0;
    dealHit(e, 'body', 500, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
    await T.until(() => e.corpseDone, 3000);
    const body = propObjs.find(q => q.p.kind === 'corpse' && q.mesh === e.mesh);
    const gold = body ? body.p.left.find(d => d.type === 'gold') : null;
    const want = rollLoot('chest', 2, makeRng((e.seed ^ 0x31c1c) >>> 0), 0, [], undefined, Math.min(4, tier + 1)).find(d => d.type === 'gold');
    const sameGrade = rollLoot('chest', 2, makeRng((e.seed ^ 0x31c1c) >>> 0), 0, [], undefined, tier).find(d => d.type === 'gold');
    return { tier, dead: e.dead, body: !!body, gear: body ? body.p.left.some(d => d.type === 'weapon' || d.type === 'armor' || d.type === 'shield') : false, gold: gold && gold.n, wantGold: want && want.n, sameGold: sameGrade && sameGrade.n };
  });
  check('killing a mimic leaves a body with gear and the loot of a chest one grade up', kill.dead && kill.body && kill.gear && kill.gold === kill.wantGold && (kill.tier >= 4 || kill.wantGold !== kill.sameGold), JSON.stringify(kill));

  // 6. Not merged: the mimic's model is its own animated meshes (never in a perf.js chunk) and its chest prop is an empty group.
  const merged = await page.evaluate(() => {
    game.startFloor(2); const e = game.enemies.find(x => x.T.mimic);
    const inChunk = new Set(); for (const c of cullChunks) c.group.traverse(x => inChunk.add(x));
    let meshes = 0; e.mesh.traverse(x => { if (x.isMesh) meshes++; });
    return { meshes, inChunk: inChunk.has(e.mesh) || inChunk.has(e.lid) || inChunk.has(e.body), chunks: cullChunks.length };
  });
  check('the mimic is not part of a merged static chunk (its parts stay animated)', merged.inChunk === false && merged.meshes >= 5 && merged.meshes < 60, JSON.stringify(merged));

  // 7. Bomb goblins: spawn counts per floor, from the same floor generator the game uses.
  const spawn = await page.evaluate(() => {
    const by = [[], [], [], []];
    for (let s = 1; s <= 60; s++) {
      const seed = (s * 2654435761) >>> 0, th = makeRng(seed).pick(THEMES).name;
      for (let n = 1; n <= 4; n++) by[n - 1].push(assignEnemyTypes(generateFloor(seed, n, { armory: false, boss: false, shop: false, themeName: th }), seed, n, th).enemies.filter(e => e.type === 'bomber').length);
    }
    return by;
  });
  const cnt = a => `${Math.min(...a)} to ${Math.max(...a)}`;
  check('no bomb goblins on floor 1', spawn[0].every(c => c === 0));
  check('floors 2 and 3 have 0 or 1 bomb goblins', spawn[1].every(c => c <= 1) && spawn[2].every(c => c <= 1), `f2 ${cnt(spawn[1])}, f3 ${cnt(spawn[2])}`);
  check('floor 4 has 1 or 2 bomb goblins', spawn[3].every(c => c >= 1 && c <= 2), `f4 ${cnt(spawn[3])}`);

  // 8. Alerted, it rushes you and blows up within 1.5 m; the fuse was lit when it was alerted.
  const rush = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const b = Q.track(Q.at(...Q.ahead(Math.min(4, best - 0.5)), 'bomber', { toward: true }));
    b.last = { x: P.x, z: P.z }; b.set('alerted');                  // what a guard does when it spots you
    const out = { lit: b.fuse, fuse: BOMB.fuse };
    out.boom = await T.until(() => Q.blasts.some(x => x.src === b), 9000);
    const r = Q.blasts.find(x => x.src === b) || {};
    out.dp = r.dp; out.tE = r.tE; out.dead = b.dead; out.hpLeft = game.inv.hp;
    return out;
  });
  check('an alerted bomb goblin lights its fuse at 2.5 s', rush.lit === rush.fuse && rush.fuse === 2.5, JSON.stringify(rush));
  check('it rushes you and blows up within 1.5 m, well before the fuse ends', rush.boom && rush.dp < 1.5 && rush.tE < 2.5, `at ${rush.dp && rush.dp.toFixed(2)} m, fuse ${rush.tE && rush.tE.toFixed(2)} s`);

  // 9. A fuse that runs out blows up where it stands, even far from you.
  const fuse = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const b = Q.track(Q.at(...Q.ahead(Math.min(4, best - 0.5)), 'bomber', { toward: false }));   // unaware, facing away: it does not come for you
    b.fuse = 1.0;
    await T.until(() => Q.blasts.some(x => x.src === b), 9000);
    const r = Q.blasts.find(x => x.src === b) || {};
    return { tE: r.tE, dp: r.dp };
  });
  check('a bomb whose fuse runs out goes off at the end of the fuse, away from you', fuse.tE !== undefined && fuse.tE >= 1.0 && fuse.tE < 1.1 && fuse.dp > 1.5, JSON.stringify(fuse));

  // 10. The blast: 55 at the centre, 25% of that at 3.5 m, nothing beyond, and the player and every enemy in range take their share.
  const blast = await page.evaluate(() => {
    const best = Q.fresh(), P = game.player, out = { best };
    const want = d => BOMB.dmg * (1 - BOMB.falloff * d / BOMB.radius) * (1 - game.inv.armorRed('body'));
    const playerDmg = d => { game.inv.hp = 100; const [x, z] = Q.ahead(d); explodeAt(x, z, null); return 100 - game.inv.hp; };
    out.player = [0.5, 2, 3.4, 3.6].filter(d => d < best - 0.5).map(d => ({ d, got: +playerDmg(d).toFixed(2), want: +want(d).toFixed(2) }));
    out.edge = BOMB.dmg * (1 - BOMB.falloff);
    // guards along the same line, from a blast 1 m ahead of the player: their distances from the blast are 0.5, 2, 3.4 and 3.6 m
    const [cx, cz] = Q.ahead(1); const dists = [0.5, 2, 3.4, 3.6]; const gs = [];
    for (const d of dists) { const [gx, gz] = Q.ahead(1 + d); gs.push(Q.at(gx, gz, 'goblin', { hp: 500 })); }
    game.inv.hp = 1e9; explodeAt(cx, cz, null);
    out.guards = gs.map((g, i) => ({ d: dists[i], got: +(500 - g.hp).toFixed(2), want: +want(dists[i]).toFixed(2) }));
    return out;
  });
  const near = blast.player.filter(r => r.d <= 3.4);
  check('the blast does more damage the closer you are (55 at the centre, 25% at 3.5 m)', near.length >= 3 && near.every(r => Math.abs(r.got - r.want) < 0.2) && near[0].got > near[near.length - 1].got, JSON.stringify(blast.player));
  check('the blast does nothing beyond 3.5 m', blast.player.some(r => r.d === 3.6) ? blast.player.find(r => r.d === 3.6).got === 0 : true);
  check('the blast hurts other enemies by distance too, and nothing outside 3.5 m', blast.guards.slice(0, 3).every(r => Math.abs(r.got - r.want) < 0.2) && blast.guards[3].got === 0, JSON.stringify(blast.guards));

  // 11. Blast noise: a guard 10 m away with a clear line hears it and turns (a control run, with no blast, does not).
  const noise = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player, out = { run: 0 };
    const [cx, cz] = Q.ahead(1);
    let a = null;                                                              // any way with 10.5 m of open floor from the blast
    for (let k = 0; k < 16 && a === null; k++) { const t = P.yaw + k * Math.PI / 8; if (Q.run(cx, cz, t) >= 10.5) a = t; }
    if (a === null) return out;
    out.run = Q.run(cx, cz, a);
    const [gx, gz] = [cx - Math.sin(a) * 10, cz - Math.cos(a) * 10];
    const g = Q.at(gx, gz, 'goblin', { hp: 500 }); g.yaw = a; g.aware = 0;     // facing away from the blast and from you
    const quiet = await T.until(() => g.state !== 'unaware' || g.aware >= 0.5, 400);
    out.quietAlert = quiet;
    explodeAt(cx, cz, null);
    out.heard = await T.until(() => g.state !== 'unaware' || g.aware >= 0.5, 1500);
    out.dist = Math.hypot(g.x - cx, g.z - cz);
    return out;
  });
  check('a blast 10 m away alerts a guard with a clear line (and quiet does not)', noise.run >= 10.5 && noise.heard && !noise.quietAlert && noise.dist > 9.5 && noise.dist < 14, JSON.stringify(noise));

  // 12. Killing it drops its bomb, which goes off about 1.5 s later and hurts whatever is nearby.
  const drop = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const b = Q.at(...Q.ahead(3), 'bomber', { hp: 40 }); b.yaw = P.yaw;
    const g = Q.at(...Q.ahead(2), 'goblin', { hp: 500 });
    const c0 = Q.clock;
    dealHit(b, 'body', 200, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0);
    const out = { dead: b.dead, exploded: b.exploded, bombOn: bombs.some(x => x.on), bombT: (bombs.find(x => x.on) || {}).t };
    await T.until(() => Q.blasts.some(x => x.src === null), 6000);
    const r = Q.blasts.find(x => x.src === null) || {};
    out.delay = r.clock !== undefined ? +(r.clock - c0).toFixed(3) : null;
    out.guardDmg = +(500 - g.hp).toFixed(2); out.want = +(BOMB.dmg * (1 - BOMB.falloff * 1 / BOMB.radius)).toFixed(2);
    return out;
  });
  check('a killed bomb goblin drops a lit bomb that goes off about 1.5 s later', drop.dead && !drop.exploded && drop.bombOn && drop.delay >= 1.45 && drop.delay <= 1.9, JSON.stringify(drop));
  check('the dropped bomb hurts an enemy beside it', Math.abs(drop.guardDmg - drop.want) < 0.2, `hurt ${drop.guardDmg}, want ${drop.want}`);

  // 13. Chain: a lit bomb goblin caught in a blast goes off within 0.3 s.
  const chain = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const b = Q.track(Q.at(...Q.ahead(3.5), 'bomber', { toward: false, hp: 500 }));
    b.fuse = 2.5;                                                              // lit, but unaware, so only the blast moves it
    const [cx, cz] = Q.ahead(2); explodeAt(cx, cz, null);
    const t1 = b.tE;
    const out = { fuse: b.fuse };
    out.boom = await T.until(() => b.exploded, 3000);
    out.wait = +(b.tE - t1).toFixed(3);
    return out;
  });
  check('a lit bomb goblin caught in a blast goes off within 0.3 s', chain.boom && chain.fuse <= 0.3 && chain.wait <= 0.3 + 0.05, JSON.stringify(chain));

  // 14. Chain, lethal: when the blast kills the lit goblin it drops a bomb instead, so it should still go off within 0.3 s.
  const chainKill = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const b = Q.track(Q.at(...Q.ahead(3.5), 'bomber', { toward: false, hp: 1 }));
    b.fuse = 2.5;
    const [cx, cz] = Q.ahead(2); explodeAt(cx, cz, null);
    const c1 = Q.clock;
    await T.until(() => Q.blasts.length >= 2 && Q.blasts.slice(1).some(x => x.src === null || x.src === b), 6000);
    const second = Q.blasts[1] || {};
    return { dead: b.dead, delay: second.clock !== undefined ? +(second.clock - c1).toFixed(3) : null };
  });
  check('a lit bomb goblin killed by a blast still goes off within 0.3 s', chainKill.dead && chainKill.delay !== null && chainKill.delay <= 0.35, JSON.stringify(chainKill));

  // 15. Hanahan's Rage: an enraged bomb goblin rushes the enemy it is set on, not you.
  const rage = await page.evaluate(async () => {
    const best = Q.fresh(), P = game.player; game.inv.hp = 1e9; Q.blasts.length = 0;
    const far = Math.min(7, best - 0.5);
    if (far < 5) return { skip: true, far };
    const t = Q.at(...Q.ahead(far), 'goblin', { hp: 500 });
    const b = Q.track(Q.at(...Q.ahead(2), 'bomber', { hp: 500 }));
    b.enrage(4, P.x, P.z);
    const hp0 = game.inv.hp;
    const out = { lit: b.fuse };
    await T.until(() => Q.blasts.some(x => x.src === b), 9000);
    const r = Q.blasts.find(x => x.src === b) || {};
    out.toTarget = Math.hypot(r.x - t.x, r.z - t.z); out.toPlayer = r.dp; out.targetHurt = +(500 - t.hp).toFixed(2); out.playerHit = hp0 - game.inv.hp;
    return out;
  });
  check('under Hanahan\'s Rage a bomb goblin rushes the other enemy and blows up beside it', rage.skip || (rage.toTarget < 1.5 && rage.toPlayer > 2.5 && rage.targetHurt > 0), JSON.stringify(rage));

  // ---- Locked and trapped chests, the lockpick and the shop's lockpicks (numbers: LOCKPICK, LOCKED, TRAP in js/loot.js) ----
  await page.evaluate(CHESTHELP);

  // 16. A lockpick picks a locked chest after a 3 s hold: quiet (1 m), the loot one grade up, and the lockpicks stack.
  const pick = await page.evaluate(async () => {
    T.reset(); Q.only();
    game.inv.add({ type: 'lockpick', n: 1 }); game.inv.add({ type: 'lockpick', n: 1 });
    const stacks = game.inv.pack.filter(i => i.type === 'lockpick');
    const o = Q.chest(); o.p.locked = true; Q.faceProp(o);
    Q.fin = null; Q.keys(true);
    const opened = await T.until(() => o.p.opened, 12000); Q.keys(false);
    const f = Q.fin || {};
    return { stacks: stacks.length, n: stacks[0] && stacks[0].n, opened, at: f.at, prev: f.prev, noise: f.pulse, lockedAfter: o.p.locked, grade: o.p.grade };
  });
  check('a lockpick picks a locked chest after a 3 s hold, and two lockpicks stack', pick.opened && pick.at >= 3 && pick.prev < 3 && pick.at < 3.5 && pick.stacks === 1 && pick.n === 2, JSON.stringify({ at: pick.at, prev: pick.prev, stacks: pick.stacks, n: pick.n }));
  check('picking is quiet (1 m) and the chest is unlocked one grade up', pick.noise === 1 && !pick.lockedAfter && pick.grade === 1, JSON.stringify({ noise: pick.noise, grade: pick.grade }));

  // 17. No lockpick: holding E on a locked chest does nothing, and the prompt says what is needed.
  const nopick = await page.evaluate(async () => {
    T.reset(); Q.only();
    const o = Q.chest(); o.p.locked = true; Q.faceProp(o);
    const info = targetInfo(o);
    Q.keys(true); const opened = await T.until(() => o.p.opened, 4000); Q.keys(false);
    return { opened, locked: o.p.locked, needs: !!info.locked, label: info.label };
  });
  check('no lockpick: a locked chest cannot be picked by holding E', !nopick.opened && nopick.locked && nopick.needs && /lockpick/.test(nopick.label), JSON.stringify(nopick));

  // 18. Smashing: 3 sword blows (2 with a mace) open it, each blow is 10 m of noise, and the potions inside break about half the time.
  const smash = await page.evaluate(() => {
    T.reset(); Q.only();
    const out = { sword: [], mace: [] };
    const o = Q.chest();                                                       // one chest, locked again before each case
    const lockIt = () => { o.p.locked = true; o.p.opened = false; o.p.hits = 0; o.p.grade = 0; delete o.p.left; Q.faceProp(o); };
    lockIt();
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    for (let i = 0; i < 3; i++) { pulse = 0; playerHit(); out.sword.push({ noise: pulse, opened: o.p.opened, hits: o.p.hits }); }
    lockIt();
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'mace', tier: 0 });
    for (let i = 0; i < 2; i++) { pulse = 0; playerHit(); out.mace.push({ noise: pulse, opened: o.p.opened, hits: o.p.hits }); }
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    // the potions: 400 of one kind inside the chest, so the kept share is measured
    lockIt(); game.inv.pack = []; o.p.extra = [{ type: 'potion', kind: 'heal', n: 400 }];
    for (let i = 0; i < 3; i++) playerHit();
    out.kept = game.inv.pack.filter(i => i.type === 'potion' && i.kind === 'heal').reduce((a, i) => a + i.n, 0);
    out.potionsOpened = o.p.opened;
    return out;
  });
  check('three sword blows open a locked chest, each blow 10 m of noise', smash.sword.slice(0, 2).every(b => !b.opened && b.noise === 10) && smash.sword[2].opened && smash.sword[2].hits === 3, JSON.stringify(smash.sword));
  check('a mace opens it in two blows', smash.mace[0] && !smash.mace[0].opened && smash.mace[1].opened && smash.mace[1].noise === 10, JSON.stringify(smash.mace));
  check('smashing breaks about half the potions inside (400 in, 40% to 60% kept)', smash.kept >= 160 && smash.kept <= 240 && smash.potionsOpened, `kept ${smash.kept} of 400`);

  // 19. A smash blow alerts a guard 6 m away (it is heard, though it is behind the player and unaware).
  const blow = await page.evaluate(async () => {
    T.reset(); Q.only(); const P = game.player;
    const o = Q.chest(); o.p.locked = true; o.p.hits = 0; Q.faceProp(o);
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    let a = null;                                                              // a clear 6.5 m line behind the player
    for (let k = 6; k <= 10 && a === null; k++) { const t = P.yaw + k * Math.PI / 8; if (Q.run(P.x, P.z, t) >= 6.5) a = t; }
    if (a === null) return { skip: true };
    const g = Q.at(P.x - Math.sin(a) * 6, P.z - Math.cos(a) * 6, 'goblin', { hp: 500 }); g.yaw = a; g.aware = 0;
    pulse = 0; playerHit(); const noise = pulse;
    const heard = await T.until(() => g.state !== 'unaware' || g.aware >= 0.5, 1500);
    return { skip: false, noise, heard, dist: Math.hypot(g.x - P.x, g.z - P.z) };
  });
  check('a smash blow alerts a guard 6 m away', !blow.skip && blow.noise === 10 && blow.heard, JSON.stringify(blow));

  // 20. Loot from a locked chest is one grade up: checked against the same chest's table at tier + 1 (gear and gold), on floor 1.
  const grade = await page.evaluate(() => {
    T.reset(); Q.only();
    const sig = list => list.filter(d => ['weapon', 'armor', 'shield', 'wand', 'rechargewand', 'rage'].includes(d.type)).map(d => [d.type, d.tier, d.base, d.kind, d.cls, d.unique].join(':')).sort().join('|');
    const gold = list => list.filter(d => d.type === 'gold').reduce((a, d) => a + d.n, 0);
    const chests = propObjs.filter(o => o.p.kind === 'chest' && !o.p.mimic && !o.p.holdsKey && (o.p.tier | 0) < 4).slice(0, 12);
    const out = { checked: 0, discriminating: 0, bad: [] };
    for (const o of chests) {
      o.p.locked = true; o.p.hits = 0; o.p.grade = 0; o.p.opened = false; delete o.p.left; delete o.p.extra;
      game.inv.pack = [makeItem({ type: 'lockpick', n: 1000 })]; game.inv.gold = 0;
      finishSearch(o);
      const base = o.p.tier | 0, rolled = t => rollLoot('chest', floorNum, makeRng(o.p.seed), o.p.bonus || 0, o.p.gear || [], o.p.type, t);
      const plain = rolled(base), up = rolled(Math.min(4, base + 1));
      const got = game.inv.pack.filter(i => i.type !== 'lockpick');
      out.checked++;
      if (sig(got) !== sig(up) || game.inv.gold !== gold(up)) out.bad.push(base);
      if (sig(plain) !== sig(up) || gold(plain) !== gold(up)) out.discriminating++;
    }
    return { checked: out.checked, discriminating: out.discriminating, bad: out.bad };
  });
  check('a locked chest pays out its table one grade up', grade.checked > 0 && grade.bad.length === 0 && grade.discriminating > 0, JSON.stringify(grade));

  // 21. Trapped chest, normal search: a dart does 12 damage and bleeds you; the loot is still given and the trap is gone.
  const dart = await page.evaluate(async () => {
    T.reset(); Q.only(); game.inv.hp = 100;
    const o = Q.chest(); o.p.trap = 'dart'; o.p.extra = [{ type: 'potion', kind: 'heal', n: 1 }]; Q.faceProp(o);
    Q.fin = null; Q.keys(true);
    await T.until(() => Q.fin && Q.fin.o === o, 9000); Q.keys(false);
    const f = Q.fin || {};
    return { hp: f.hp, bleed: f.bleed, trapLeft: o.p.trap, loot: game.inv.pack.some(i => i.type === 'potion' && i.kind === 'heal'), opened: o.p.opened, noise: f.pulse };
  });
  check('a trap dart does 12 damage, bleeds you, still gives the loot, and the trap is gone', dart.hp === 88 && dart.bleed === 4 && !dart.trapLeft && dart.loot && dart.opened, JSON.stringify(dart));

  // 22. Gas: daze and slow on you and on an enemy within 3 m (with a line to the chest); an enemy 4.6 m away gets nothing.
  const gas = await page.evaluate(async () => {
    T.reset(); Q.only(); game.inv.hp = 100;
    const o = Q.chest(); o.p.trap = 'gas'; o.p.extra = [{ type: 'potion', kind: 'heal', n: 1 }]; Q.faceProp(o);
    const near = Q.spotNear(o, 2), far = Q.spotNear(o, 4.6);
    if (!near || !far) return { skip: true };
    Q.at(near[0], near[1], 'goblin', { hp: 500 }); Q.at(far[0], far[1], 'goblin', { hp: 500 });
    Q.fin = null; Q.keys(true);
    await T.until(() => Q.fin && Q.fin.o === o, 9000); Q.keys(false);
    // classified by the distance the game actually recorded (a guard can be nudged a little after it is placed)
    const f = Q.fin || {}, [nearE = {}, farE = {}] = f.enemies || [];
    return { skip: false, playerDaze: f.daze, playerSlow: f.slow, gasOn: f.gas, nearDc: nearE.dc, nearDaze: nearE.daze, nearSlow: nearE.slow, farDc: farE.dc, farDaze: farE.daze, farSlow: farE.slow, trapLeft: o.p.trap };
  });
  check('gas dazes and slows you and an enemy within 3 m, not one 4.6 m away', !gas.skip && gas.playerDaze === 4 && gas.playerSlow === 4 && gas.gasOn && gas.nearDc < 3 && gas.nearDaze === 4 && gas.nearSlow === 4 && gas.farDc > 3 && gas.farDaze === 0 && gas.farSlow === 0 && !gas.trapLeft, JSON.stringify(gas));

  // 23. Alarm: a 18 m bell, and a guard 10 m away hears it.
  const alarm = await page.evaluate(async () => {
    T.reset(); Q.only(); const P = game.player;
    const o = Q.chest(); o.p.trap = 'alarm'; o.p.extra = [{ type: 'potion', kind: 'heal', n: 1 }]; Q.faceProp(o);
    let a = null;
    for (let k = 6; k <= 10 && a === null; k++) { const t = P.yaw + k * Math.PI / 8; if (Q.run(P.x, P.z, t) >= 10.5) a = t; }
    if (a === null) return { skip: true };
    const g = Q.at(P.x - Math.sin(a) * 10, P.z - Math.cos(a) * 10, 'goblin', { hp: 500 }); g.yaw = a; g.aware = 0;
    Q.fin = null; Q.keys(true);
    await T.until(() => Q.fin && Q.fin.o === o, 9000); Q.keys(false);
    const noise = Q.fin ? Q.fin.pulse : null;
    const heard = await T.until(() => g.state !== 'unaware' || g.aware >= 0.5, 2500);
    return { skip: false, noise, heard, trapLeft: o.p.trap, opened: o.p.opened };
  });
  check('an alarm rings 18 m and alerts a guard 10 m away; the trap is gone', !alarm.skip && alarm.noise === 18 && alarm.heard && !alarm.trapLeft && alarm.opened, JSON.stringify(alarm));

  // 24. Crouched search disarms: silent, no damage, no status, no gas, and the loot is still given.
  const disarm = await page.evaluate(async () => {
    T.reset(); Q.only(); game.inv.hp = 100;
    const o = Q.chest(); o.p.trap = 'gas'; o.p.extra = [{ type: 'potion', kind: 'heal', n: 1 }]; Q.faceProp(o);
    const near = Q.spotNear(o, 2);
    if (near) Q.at(near[0], near[1], 'goblin', { hp: 500 });
    Q.fin = null; Q.keys(true); Q.crouchKey(true);
    await T.until(() => Q.fin && Q.fin.o === o, 15000); Q.keys(false); Q.crouchKey(false);
    const f = Q.fin || {};
    return {
      crouch: f.crouch, noise: f.pulse, hp: f.hp, bleed: f.bleed, daze: f.daze, slow: f.slow, gas: f.gas,
      enemyDazed: (f.enemies || []).some(e => e.daze > 0), trapLeft: o.p.trap, opened: o.p.opened,
      loot: game.inv.pack.some(i => i.type === 'potion' && i.kind === 'heal'),
    };
  });
  check('crouched search disarms a trapped chest silently: no damage, status, gas or noise, and loot is still given', disarm.crouch && disarm.noise === 0 && disarm.hp === 100 && !disarm.bleed && !disarm.daze && !disarm.slow && !disarm.gas && !disarm.enemyDazed && !disarm.trapLeft && disarm.opened && disarm.loot, JSON.stringify(disarm));

  // 25. Real placement: a chest the game built with a padlock (locked) or a wire (trapped) loses that tell when it is opened or disarmed.
  // This part runs on its own page with seed 1: no encounter on floors 1 to 4 there (SEED's floor 3 holds the mini-boss, which
  // re-lays the floor and leaves no locked chest on it). Seed 1 has a locked chest on floors 2 and 4 and two trapped ones.
  const built7 = await open(1);
  await built7.evaluate(QHELP); await built7.evaluate(CHESTHELP);
  const built = await built7.evaluate(async () => {
    const found = { lock: null, traps: [] };
    for (const n of [1, 2, 3, 4]) {
      game.startFloor(n);
      propObjs.forEach((o, idx) => {
        if (o.p.kind !== 'chest' || !o.tell || !o.tell.parent) return;
        if (o.p.locked && !found.lock) found.lock = [n, idx];
        if (o.p.trap && n >= 2) found.traps.push([n, idx]);
      });
    }
    const out = { lockFound: !!found.lock, trapsFound: found.traps.length };
    if (found.lock) {
      game.startFloor(found.lock[0]); Q.only(); game.inv.hp = 100; game.inv.pack = [];
      game.inv.add({ type: 'lockpick', n: 5 });
      const o = propObjs[found.lock[1]];
      Q.faceProp(o); Q.keys(true);
      out.lockOpened = await T.until(() => o.p.opened, 12000); Q.keys(false);
      out.padlockGone = !o.tell.parent;
    }
    if (found.traps.length >= 2) {
      const [n1, i1] = found.traps[0], [n2, i2] = found.traps[1];
      game.startFloor(n1); Q.only(); game.inv.hp = 100;
      const o = propObjs[i1];
      Q.faceProp(o); Q.fin = null; Q.keys(true); Q.crouchKey(true);
      await T.until(() => Q.fin && Q.fin.o === o, 15000); Q.keys(false); Q.crouchKey(false);
      out.disarmHp = game.inv.hp; out.disarmTrapLeft = o.p.trap; out.disarmTellGone = !o.tell.parent;
      game.startFloor(n2); Q.only(); game.inv.hp = 100;
      const t = propObjs[i2];
      Q.faceProp(t); Q.fin = null; Q.keys(true);
      await T.until(() => Q.fin && Q.fin.o === t, 9000); Q.keys(false);
      out.triggerTellGone = !t.tell.parent; out.triggerTrapLeft = t.p.trap;
    }
    return out;
  });
  await built7.close();
  check('a built padlock comes off when the chest is picked', built.lockFound && built.lockOpened && built.padlockGone, JSON.stringify(built));
  check('a built trap wire comes off when the trap is disarmed or sprung', built.trapsFound >= 2 && built.disarmTellGone && !built.disarmTrapLeft && built.disarmHp === 100 && built.triggerTellGone && !built.triggerTrapLeft, JSON.stringify(built));

  // 26. The shop stocks lockpicks at 25 gold, one entry per shop, 1 to 3 of them.
  const shop = await page.evaluate(() => {
    let seeds = 0, withPick = 0, badPrice = 0, badQty = 0;
    for (let s = 1; s <= 100; s++) for (let fl = 1; fl <= 4; fl++) {
      seeds++;
      const e = makeStock((s * 2654435761) >>> 0, fl).filter(x => x.item.type === 'lockpick');
      if (e.length === 1) withPick++;
      for (const x of e) { if (x.price !== 25) badPrice++; if (x.qty < 1 || x.qty > 3) badQty++; }
    }
    return { price: priceOf({ type: 'lockpick' }), seeds, withPick, badPrice, badQty };
  });
  check('the shop stocks one lockpick stack at 25 gold, 1 to 3 picks', shop.price === 25 && shop.withPick === shop.seeds && shop.badPrice === 0 && shop.badQty === 0, JSON.stringify(shop));

  // 27. Seeded snap chance: 1000 picks, each attempt snaps the pick about 30% of the time. Run twice: the same count.
  const snap = await page.evaluate(() => {
    const runOnce = () => {
      T.reset(); Q.only(); game.inv.pack = [makeItem({ type: 'lockpick', n: 2000 })];
      const pk = game.inv.pack[0], o = Q.chest();
      let tries = 0, snaps = 0;
      for (let i = 0; i < 1000 && pk.n > 0; i++) {
        o.p.locked = true; o.p.opened = false; o.p.grade = 0; o.p.hits = 0; delete o.p.left;
        const before = pk.n; finishSearch(o); tries++;
        if (pk.n < before) snaps++;
      }
      return { tries, snaps };
    };
    const a = runOnce(), b = runOnce();
    return { tries: a.tries, snaps: a.snaps, rate: a.snaps / a.tries, same: a.snaps === b.snaps };
  });
  check('a lockpick snaps about 30% of the time (seeded, repeatable)', snap.tries === 1000 && snap.rate >= 0.25 && snap.rate <= 0.35 && snap.same, JSON.stringify(snap));

  await page.close();
});
