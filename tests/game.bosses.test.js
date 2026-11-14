// Boss framework in the browser: the cave boss behaves exactly as before (golden numbers), the pooled ground telegraph and boss shots never grow,
// and ground moves are blockable only for a share (blockTake) with an eased knockback that never passes a wall. Run on its own: node tests/game.bosses.test.js
const { run } = require('./lib');

// Page-side helpers: put the player `d` metres south of the boss facing it, boss awake and alerted, no cooldown.
const BOSS_HELPERS = () => {
  window.BT = {
    noise: { events: [], emit() {}, shoot: spawnEnemyShot, steal() {} },
    setup(d, sword = true) {
      const b = game.enemies.find(e => e.boss), P = game.player;
      if (sword) game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      P.x = b.x; P.z = b.z + d; P.yaw = 0; P.pitch = 0; P.vx = P.vz = 0; P.keys = {};
      b.dormant = false; b.x0 = b.x; b.last = { x: P.x, z: P.z }; b.set('alerted'); b.atkCd = 0; b.stun = 0; b.yaw = Math.atan2(-(P.x - b.x), -(P.z - b.z));
      game.inv.hp = game.inv.maxHp = 1000; game.cb.stamina = 100; game.cb.block = false; game.cb.blockT = 1; game.pst.clear(); knock.m = 0;
      return b;
    },
    // Step the boss until its attack lands (returns { zone, t, wind }): t is the time from the start of the telegraph to the hit.
    swing(b, max = 5, dt = 1 / 60, resolve = false) {   // resolve: run the hit through resolveEnemyAttack like the frame loop
      const P = game.player; let t = 0, w0 = null, wind = 0;
      for (let i = 0; i < max / dt; i++) {
        const z = b.update(dt, P, BT.noise);
        if (b.winding && w0 === null) { w0 = t; wind = b.windT_; } t += dt;
        if (z && resolve) resolveEnemyAttack(b, z);
        if (z) return { zone: z, t: t - (w0 === null ? 0 : w0), wind };
      }
      return null;
    },
  };
};

run('Boss framework: golden cave boss, pooled telegraph and shots, blockTake and knock', async ({ open, check }) => {
  const page = await open(7);
  await page.evaluate(BOSS_HELPERS);

  // 1. Golden numbers: the cave boss' fight is the old one.
  const g = await page.evaluate(() => {
    const out = {};
    game.startFloor(5);
    let b = game.enemies.find(e => e.boss);
    out.id = b.def.id; out.moves = b.def.moves.length; out.phases = b.def.phases.length; out.name = document.querySelector('#boss div').textContent;
    out.wind = b.windT_; out.windExp = TUNE.windup / Math.sqrt(TUNE.enemyAtkSpd * TUNE.bossAtkSpd) * TUNE.bossWindMul;
    out.reach = b.reach; out.dmg = b.dmgMul; out.r = b.r; out.hp1 = b.maxHp; out.scale = b.scaleK / BOSS_SCALE;
    out.stun = b.addStatus('stun', 2); out.sleep = b.sleep(5); out.rage = b.enrage(5, 0, 0);
    out.tag = !!(b.tag && b.tag.parent === b.mesh);
    // wake distance
    const P = game.player, noise = BT.noise;
    P.x = b.x; P.z = b.z + TUNE.bossWake + 1; b.update(0.016, P, noise); out.sleepFar = b.dormant;
    P.z = b.z + TUNE.bossWake - 1; b.update(0.016, P, noise); out.wakeNear = !b.dormant && b.state === 'alerted';
    // timing and damage of one swing
    b = BT.setup(2.0);
    const r = BT.swing(b); out.swing = r;
    out.hitMul = b.hitMul;
    const hp0 = game.inv.hp; b.zone = 'body'; resolveEnemyAttack(b, 'body'); out.dealt = hp0 - game.inv.hp; out.expect = TUNE.enemyDmg * b.dmgMul * ZONE_MUL.body * (1 - game.inv.armorRed('body'));
    // the parry
    b = BT.setup(2.0); BT.swing(b, 0.3);   // 0.3 s: not yet started? run to the telegraph instead
    b = BT.setup(2.0); for (let i = 0; i < 200 && !b.winding; i++) b.update(1 / 60, P, noise);
    out.windingBefore = b.winding; out.stBefore = b.bs.st;
    game.cb.block = true; game.cb.blockT = 0; game.cb.stamina = 100; game.inv.hp = 1000;
    resolveEnemyAttack(b, 'body');
    out.parryStun = b.stun; out.parryWinding = b.winding; out.parryHp = game.inv.hp;
    game.cb.block = false;
    b.update(1 / 60, P, noise); out.stStagger = b.bs.st;
    for (let i = 0; i < 70; i++) b.update(1 / 60, P, noise);
    out.stAfter = b.bs.st;
    // hp by stage
    out.hps = [1, 2, 3, 4].map(s => { game.startStage(s); game.startFloor(5); const x = game.enemies.find(e => e.boss); return [x.maxHp, x.dmgMul, x.def.name, x.def.id, x.def.hpMul]; });
    game.startStage(1);
    return out;
  });
  check('the first stage boss is the cave def: one swing move, no phases, named by its theme, with a name tag', g.id !== undefined && g.moves === 1 && g.phases === 0 && g.name === g.hps[0][2] && g.tag, `${g.id} ${g.name}`);
  check('swing windT_ is the old formula (about 0.48 s) and reach 2.38 m', Math.abs(g.wind - g.windExp) < 1e-9 && Math.abs(g.wind - 0.48) < 0.01 && Math.abs(g.reach - 2.38) < 1e-9, `${g.wind.toFixed(4)} s, ${g.reach} m`);
  check('stage 1 hp 220, damage x1.4, radius 0.65, scale 1.6', g.hp1 === 220 && Math.abs(g.dmg - 1.4) < 1e-9 && g.r === 0.65 && Math.abs(g.scale - 1) < 1e-9, `${g.hp1} ${g.dmg}`);
  check('hp by stage 220 / 330 / 440 / 550 (x the boss\'s own hpMul) and damage x1.4 / 1.68 / 1.96 / 2.24', g.hps.every((h, i) => Math.abs(h[0] - 220 * h[4] * (1 + 0.5 * i)) < 1e-6 && Math.abs(h[1] - 1.4 * (1 + 0.2 * i)) < 1e-9), JSON.stringify(g.hps.map(h => h.slice(0, 2))));
  check('it cannot be stunned, put to sleep or raged', g.stun === false && g.sleep === false && g.rage === false);
  check('it sleeps until you are within bossWake and then wakes alerted', g.sleepFar === true && g.wakeNear === true);
  check('a swing lands wind + 0.07 s after it starts, for 13 x 1.4 body damage, and the hit multiplier is 1', g.swing && Math.abs(g.swing.t - (g.wind + 0.07)) < 0.03 && g.hitMul === 1 && Math.abs(g.dealt - g.expect) < 1e-6 && Math.abs(g.expect - 18.2) < 0.01, JSON.stringify(g.swing) + ` dealt ${g.dealt}`);
  check('a parry staggers the swing (stun 1, wind cancelled, no damage), the state machine says stagger and then chases again', g.windingBefore && g.stBefore !== 'chase' && g.parryStun === 1 && g.parryWinding === false && g.parryHp === 1000 && g.stStagger === 'stagger' && g.stAfter === 'chase', `${g.stBefore} ${g.parryStun} ${g.stStagger} ${g.stAfter}`);

  // 2. Killing the stage boss opens the safe room, as before.
  const fall = await page.evaluate(() => {
    game.startFloor(5); const b = game.enemies.find(e => e.boss); b.hp = 1; let error = null;
    try { dealHit(b, 'body', 20, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0); } catch (e) { error = e.message; }
    return { error, dead: b.dead, open: game.floor.safe.open === true };
  });
  check('killing the boss: no error, it dies and the safe room door opens', fall.error === null && fall.dead && fall.open, JSON.stringify(fall));

  // 3. A test def with one ground move: pooled telegraph, blockTake and knock.
  const gm = await page.evaluate(() => {
    const out = {};
    game.startStage(2); game.startFloor(5);   // stage 2: its boss is still alive (stage 1's fell above)
    const D = BOSS_DEFS.test = bossNormalize({ ...BOSS_DEFS.cave, id: 'test', name: 'Test', moves: [{ id: 'slam', name: 'Slam', shape: 'circle', r: 3, wind: 1.0, dmg: 1.0, zone: 'legs', ground: true, blockTake: 0.5, knock: 3, maxD: 6 }] });
    out.valid = validateBossDef(D).join();
    let b = game.enemies.find(e => e.boss); b.def = D; b.bs = bossState(D);
    const P = game.player, fx = () => group.userData.bossFx, vis = () => fx() ? fx().tele.filter(m => m.visible).length : 0;
    b = BT.setup(2.0);
    out.hiddenBefore = vis(); out.children0 = group.children.length;
    // run to the middle of the telegraph, then to the strike
    let started = false;
    for (let i = 0; i < 200 && !b.winding; i++) b.update(1 / 60, P, BT.noise);
    out.windMv = b.windT_; out.mvId = b.mv && b.mv.id;
    for (let i = 0; i < 30; i++) b.update(1 / 60, P, BT.noise);
    out.visMid = vis(); out.teleN = fx().tele.length; out.children1 = group.children.length; out.geo = fx().tele[0].geometry.type; out.sx = fx().tele[0].scale.x; out.op = BOSS_TELE_MAT.opacity;
    // damage unblocked
    const strike = (block) => {
      b = BT.setup(2.0); game.cb.block = !!block; game.cb.blockT = 1; game.cb.stamina = 100; knock.m = 0; P.pitch = block ? -0.6 : 0;   // a legs-zone ground move is only covered by a low guard
      const hp0 = game.inv.hp, s0 = game.cb.stamina, x0 = P.x, z0 = P.z;
      const r = BT.swing(b, 5, 1 / 60, true);
      game.cb.block = false;
      return { r, lost: hp0 - game.inv.hp, stam: s0 - game.cb.stamina, parry: b.stun, knock: knock.m, status: game.pst.has('cripple') || game.pst.has('slow') };
    };
    const un = strike(false), bl = strike(true);
    out.un = un; out.bl = bl; out.full = TUNE.enemyDmg * b.dmgMul * ZONE_MUL.legs * (1 - game.inv.armorRed('legs'));
    out.visAfter = vis();
    // the knock: an eased slide of 3 m through an open arena
    b = BT.setup(2.0); applyKnock(0, 1, 3); const x0 = P.x, z0 = P.z, steps = [];
    for (let i = 0; i < 80; i++) { stepKnock(1 / 60); steps.push(Math.hypot(P.x - x0, P.z - z0)); }
    out.k3 = steps[79]; out.kFirst = steps[0]; out.kMono = steps.every((v, i) => i === 0 || v >= steps[i - 1] - 1e-9); out.kEase = steps[4] > steps[0] * 3 && steps[9] < steps[79];
    // knock into a wall: never through it
    b = BT.setup(2.0); let wx = b.x; while (!P.blocked(game.floor, wx + 0.1, b.z)) wx += 0.1;
    P.x = wx; P.z = b.z; applyKnock(1, 0, 3); for (let i = 0; i < 80; i++) stepKnock(1 / 60);
    out.wallFree = !P.blocked(game.floor, P.x, P.z); out.wallMoved = P.x - wx;
    // repeated slams: the pool stays the same
    for (let n = 0; n < 4; n++) { b = BT.setup(2.0); BT.swing(b, 5, 1 / 60, true); }
    out.teleN2 = fx().tele.length; out.children2 = group.children.length; out.visEnd = vis();
    return out;
  });
  check('the test def validates', gm.valid === '', gm.valid);
  check('the telegraph pool is empty/hidden before a ground move, shows one red disc during it and builds no more than 4 meshes', gm.hiddenBefore === 0 && gm.mvId === 'slam' && Math.abs(gm.windMv - 1.0) < 1e-9 && gm.visMid === 1 && gm.teleN <= 4 && gm.geo === 'CircleGeometry' && Math.abs(gm.sx - 3) < 1e-9, JSON.stringify({ vis: gm.visMid, n: gm.teleN, geo: gm.geo, sx: gm.sx }));
  check('the telegraph fades in with the wind-up (opacity between 0.16 and 0.5)', gm.op > 0.16 && gm.op < 0.5, String(gm.op));
  check('repeated ground moves reuse the pool: same mesh count, nothing visible after the strike', gm.teleN2 === gm.teleN && gm.children2 === gm.children1 && gm.visEnd === 0 && gm.visAfter === 0, `${gm.teleN2} meshes, ${gm.children1} -> ${gm.children2} children`);
  check('an unblocked ground hit deals full damage with no parry stagger', gm.un.r && Math.abs(gm.un.lost - gm.full) < 1e-6 && gm.un.parry === 0, `${gm.un.lost} of ${gm.full}`);
  check('a block lets only blockTake (50%) through, costs stamina, still knocks back and never staggers', gm.bl.r && Math.abs(gm.bl.lost - gm.full * 0.5) < 1e-6 && gm.bl.stam > 0 && gm.bl.parry === 0 && gm.bl.knock === 3 && gm.un.knock === 3, `${gm.bl.lost} lost, ${gm.bl.stam} stamina, knock ${gm.bl.knock}`);
  check('knockback is an eased slide of the full 3 m (not a teleport)', Math.abs(gm.k3 - 3) < 0.05 && gm.kFirst < 0.5 && gm.kMono && gm.kEase, `${gm.k3.toFixed(2)} m, first step ${gm.kFirst.toFixed(2)}`);
  check('knockback never carries the player through a wall', gm.wallFree && gm.wallMoved < 0.3, `moved ${gm.wallMoved.toFixed(2)} m into the wall`);

  // 4. Boss shots: a 12-mesh pool per kind, returned after flight, blockable through resolveEnemyAttack.
  const sh = await page.evaluate(() => {
    const out = {};
    game.startStage(2); game.startFloor(5);
    const b = BT.setup(6.0), P = game.player, mv = { id: 'peck', shape: 'projectile', dmg: 0.35, ground: false };
    const kids0 = group.children.length;
    for (let i = 0; i < 14; i++) spawnEnemyShot({ from: b, kind: 'crow', x: b.x, y: 2, z: b.z, speed: 9, dmg: 0.35, mv, fan: (i - 7) * 0.05 });
    const live = game.arrows.filter(a => a.pool).length, pool = group.userData.bossFx.shots.crow;
    out.live = live; out.pool = pool.length; out.kids1 = group.children.length - kids0;
    for (const a of game.arrows) a.life = 0;
    updateArrows(0.016);
    out.left = game.arrows.length; out.busy = pool.filter(m => m.userData.busy).length; out.hidden = pool.every(m => !m.visible);
    for (let i = 0; i < 12; i++) spawnEnemyShot({ from: b, kind: 'crow', x: b.x, y: 2, z: b.z, speed: 9, dmg: 0.35, mv });
    out.kids2 = group.children.length - kids0; for (const a of game.arrows) a.life = 0; updateArrows(0.016);
    // a hit: damage = move dmg x body zone, no knock; blocked: nothing
    const hit = (block) => {
      game.inv.hp = 1000; game.cb.block = block; game.cb.blockT = 1; game.cb.stamina = 100;
      spawnEnemyShot({ from: b, kind: 'crow', x: b.x, y: 1, z: b.z, speed: 9, dmg: 0.35, mv });
      const a = game.arrows[game.arrows.length - 1]; a.x = P.x; a.z = P.z; a.y = 1.0; a.vx = a.vy = a.vz = 0;
      P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z));
      updateArrows(0.016); game.cb.block = false;
      return 1000 - game.inv.hp;
    };
    out.hit = hit(false); out.blocked = hit(true); out.expect = TUNE.enemyDmg * b.dmgMul * 0.35 * ZONE_MUL.body * (1 - game.inv.armorRed('body'));
    return out;
  });
  check('14 crow shots use at most 12 pooled meshes, which go back to the pool (hidden, not busy) after flight', sh.live === 12 && sh.pool === 12 && sh.kids1 === 12 && sh.left === 0 && sh.busy === 0 && sh.hidden && sh.kids2 === 12, JSON.stringify(sh));
  check('a boss shot that reaches you deals the move\'s damage and a block stops it', Math.abs(sh.hit - sh.expect) < 1e-6 && sh.blocked === 0, `${sh.hit} (expected ${sh.expect}), blocked ${sh.blocked}`);

  // 5. Cost: logic time with the boss alerted, and the arena's draw calls (pools hidden).
  const pf = await page.evaluate(async () => {
    game.startStage(2); game.startFloor(5); const b = BT.setup(5.0); await T.sleep(1500);
    const i = game.renderInfo();
    return { logic: game.perfStats.logic, calls: i.calls, alerted: b.state === 'alerted' };
  });
  check('logic stays cheap with the boss alerted (under 3 ms in software rendering) and the arena draws under 220 calls', pf.alerted && pf.logic < 3 && pf.calls < 220, `${pf.logic.toFixed(2)} ms, ${pf.calls} calls`);
  // 3b. Framework fixes (review): a shot landing mid-telegraph, the low guard rule, a broken guard, knock cleared, e.mv cleared.
  const fx = await page.evaluate(() => {
    const out = {};
    game.startStage(2); game.startFloor(5);
    const D = BOSS_DEFS.test2 = bossNormalize({ ...BOSS_DEFS.cave, id: 'test2', name: 'Test2', moves: [{ id: 'slam', name: 'Slam', shape: 'circle', r: 3, wind: 1.0, dmg: 1.0, zone: 'legs', ground: true, knock: 3, maxD: 6 }, { id: 'body', name: 'Body', shape: 'circle', r: 3, wind: 1.0, dmg: 1.0, zone: 'body', ground: true, knock: 2, maxD: 6, cd: 9 }] });
    let b = game.enemies.find(e => e.boss); b.def = D; b.bs = bossState(D);
    const P = game.player, mvc = { id: 'peck', shape: 'projectile', dmg: 0.35, ground: false };
    // 1. a crow lands while the slam is winding up: the boss's own move and hit multiplier are untouched
    b = BT.setup(2.0); b.bs.cd.body = 99;
    for (let i = 0; i < 200 && !b.winding; i++) b.update(1 / 60, P, BT.noise);
    for (let i = 0; i < 20; i++) b.update(1 / 60, P, BT.noise);
    out.mv0 = b.mv.id; out.w0 = b.windT_; out.hm0 = b.hitMul;
    spawnEnemyShot({ from: b, kind: 'crow', x: b.x, y: 1, z: b.z, speed: 9, dmg: 0.35, mv: mvc });
    const a = game.arrows[game.arrows.length - 1]; a.x = P.x; a.z = P.z; a.y = 1.0; a.vx = a.vy = a.vz = 0;
    game.inv.hp = 1000; updateArrows(0.016);
    out.shotLost = 1000 - game.inv.hp; out.mv1 = b.mv && b.mv.id; out.w1 = b.windT_; out.hm1 = b.hitMul;
    knock.m = 0; const r = BT.swing(b, 5, 1 / 60, true);
    out.knockAfter = knock.m; out.parried = b.stun; out.mvAtStrike = r && r.zone;
    // e.mv is cleared one frame after the strike
    b = BT.setup(2.0); b.bs.cd.body = 99; const r2 = BT.swing(b); out.mvKept = !!b.mv; b.update(1 / 60, P, BT.noise); out.mvCleared = b.mv === null;
    // 2. the low guard rule for ground moves: legs-zone moves need a low guard, body-zone ones a high guard
    const hit = (zone, pitch, block, stam = 100) => {
      b = BT.setup(2.0); b.mv = D.byId[zone === 'legs' ? 'slam' : 'body']; b.hitMul = 1;
      game.cb.block = block; game.cb.blockT = 1; game.cb.stamina = stam; P.pitch = pitch; game.inv.hp = 1000; knock.m = 0;
      resolveEnemyAttack(b, zone); game.cb.block = false; b.mv = null; P.pitch = 0;
      return 1000 - game.inv.hp;
    };
    const full = z => TUNE.enemyDmg * b.dmgMul * ZONE_MUL[z] * (1 - game.inv.armorRed(z));
    out.full = { legs: full('legs'), body: full('body') };
    out.high = { legsHigh: hit('legs', 0, true), legsLow: hit('legs', -0.6, true), bodyHigh: hit('body', 0, true), bodyLow: hit('body', -0.6, true), none: hit('body', 0, false) };
    out.broken = hit('body', 0, true, 0);   // block raised with no stamina: the guard breaks, half damage
    // 3. knock cleared by a floor change
    knock.m = 3; game.startFloor(5); out.knockFloor = knock.m;
    return out;
  });
  check('a boss shot landing mid-telegraph leaves the boss\'s own move and hit multiplier alone, and the slam still strikes as a ground move (knock 3)', fx.mv0 === 'slam' && fx.mv1 === 'slam' && Math.abs(fx.w1 - fx.w0) < 1e-9 && fx.hm1 === fx.hm0 && fx.shotLost > 0 && fx.knockAfter === 3 && fx.parried === 0, JSON.stringify({ mv: [fx.mv0, fx.mv1], w: [fx.w0, fx.w1], hm: [fx.hm0, fx.hm1], knock: fx.knockAfter }));
  check('e.mv is cleared on the frame after the strike (kept while the hit resolves)', fx.mvKept && fx.mvCleared);
  check('ground moves follow the low guard rule: a legs move is only braced by a low guard, a body move only by a high one', Math.abs(fx.high.legsHigh - fx.full.legs) < 1e-6 && Math.abs(fx.high.legsLow - fx.full.legs * 0.5) < 1e-6 && Math.abs(fx.high.bodyHigh - fx.full.body * 0.5) < 1e-6 && Math.abs(fx.high.bodyLow - fx.full.body) < 1e-6 && Math.abs(fx.high.none - fx.full.body) < 1e-6, JSON.stringify(fx.high) + ' ' + JSON.stringify(fx.full));
  check('a broken guard on a ground move deals half damage, like a normal hit', Math.abs(fx.broken - fx.full.body * 0.5) < 1e-6, `${fx.broken} of ${fx.full.body}`);
  check('knockback is cleared by a floor change', fx.knockFloor === 0);

  // 6. The Harvest King and the Fungal Warden: every move, phases, zones, summons, cost. seed 8 opens on the Orchard, seed 6 on the Cellar.
  const BOSS2 = id => {
    const out = { id, moves: {} }, D = BOSS_DEFS[id], P = game.player;
    game.startFloor(5);
    let b = game.enemies.find(e => e.boss);
    out.def = b.def.id; out.name = b.def.name; out.scale = b.scaleK; out.hp = b.maxHp; out.hpMul = D.hpMul;
    out.meshes = 0; b.mesh.traverse(o => { if (o.isMesh) out.meshes++; }); out.baked = !!b.mats.length && b.mats.length === 1;
    // zones by metre bands: melee at 2.5 m and arrows
    const zs = { legs: D.bands[0] * 0.5, body: (D.bands[0] + D.bands[1]) / 2, head: (D.bands[1] + D.bands[2]) / 2 }, zr = {};
    b = BT.setup(2.5); P.pitch = 0;
    for (const z in zs) { P.pitch = Math.atan2(zs[z] - eyeY(), 2.5); const t = findMeleeTarget(P, eyeY(), game.enemies, game.floor, 3); zr[z] = [t && t.zone, zoneAtHeight(zs[z], b)]; }
    P.pitch = 0; out.zones = zr; out.over = zoneAtHeight(D.bands[2] + 0.5, b);
    // each move: timing, damage, block, knock
    const runMove = (mv, block) => {
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);   // shots from the last run go back to their pool
      for (const m of D.moves) b.bs.cd[m.id] = m.id === mv.id ? 0 : 99;
      b.bs.phase = mv.phase[0]; b.atkCd = 0;
      const ev = [], dist = mv.minD ? mv.minD + 1.5 : 2.2;
      b = BT.setup(dist); for (const m of D.moves) b.bs.cd[m.id] = m.id === mv.id ? 0 : 99; b.bs.phase = mv.phase[0];
      const zone0 = mv.zone === 'rand' ? 'body' : mv.zone;
      game.cb.block = !!block; game.cb.blockT = block === 'parry' ? 0 : 1; game.cb.stamina = 100; P.pitch = block && zone0 === 'legs' ? -0.6 : 0;
      let t = 0, t0 = null, vis = 0, arrows0 = game.arrows.length;
      for (let i = 0; i < 700; i++) {
        const z = b.update(1 / 120, P, BT.noise);
        if (b.winding && t0 === null) t0 = t; t += 1 / 120;
        if (b.winding && mv.ground) { const f = group.userData.bossFx; vis = Math.max(vis, f ? f.tele.filter(m => m.visible).length : 0); }
        if (game.arrows.length > arrows0) { ev.push({ shots: game.arrows.length - arrows0, t: t - t0, wind: b.windT_ }); arrows0 = game.arrows.length; }
        if (z) {
          const mid = b.mv.id, wind = b.windT_, hp0 = game.inv.hp, k0 = knock.m;
          resolveEnemyAttack(b, z);
          ev.push({ id: mid, t: t - t0, wind, zone: z, lost: hp0 - game.inv.hp, knock: knock.m, stun: b.stun, dmgMv: b.def.byId[mid].dmg, kmv: b.def.byId[mid].knock || 0 });
          if (b.stun > 0) break;
        }
        if (ev.length && !b.winding && (b.bs.st === 'chase' || b.bs.st === 'recover')) break;
      }
      game.cb.block = false; P.pitch = 0;
      const full = zn => TUNE.enemyDmg * b.dmgMul * ZONE_MUL[zn] * (1 - game.inv.armorRed(zn));
      for (const e of ev) if (e.zone) e.full = full(e.zone);
      return { ev, vis, exp: b.bs.exp, hp: b.hp };
    };
    for (const mv of D.moves) {
      if (mv.chain) continue;
      const r0 = runMove(mv, false), r1 = runMove(mv, mv.shape === 'cone' ? 'parry' : true);
      let kd = null;
      if (mv.knock) {   // the slide: 1 m or more, away from the boss, through open floor
        b = BT.setup(2.0); const x0 = P.x, z0 = P.z; applyKnock(0, 1, mv.knock); for (let i = 0; i < 90; i++) stepKnock(1 / 60); kd = Math.hypot(P.x - x0, P.z - z0);
      }
      out.moves[mv.id] = { un: r0, bl: r1, kd, expo: r0.exp };
    }
    // projectiles: the shots exist when the strike lands, a block stops them, a hit deals dmg x zone
    out.shots = {};
    for (const mv of D.moves) if (mv.shape === 'projectile') {
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);
      b = BT.setup(8); for (const m of D.moves) b.bs.cd[m.id] = m.id === mv.id ? 0 : 99; b.bs.phase = mv.phase[0];
      const before = game.arrows.length; let t = 0, firstShot = null, t0 = null;
      for (let i = 0; i < 400 && firstShot === null; i++) { b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120; if (game.arrows.length > before) firstShot = { t: t - t0, wind: b.windT_ }; }
      const mine = game.arrows.slice(before), n = mine.length, xs = mine.map(a => Math.atan2(a.vx, a.vz));
      const hit = block => { game.inv.hp = 1000; game.cb.block = block; game.cb.blockT = 1; game.cb.stamina = 100; const a = mine.pop(); a.x = P.x; a.z = P.z; a.y = 1.0; a.vx = a.vy = a.vz = 0; P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z)); updateArrows(0.016); game.cb.block = false; return 1000 - game.inv.hp; };
      const un = hit(false), bl = hit(true);
      out.shots[mv.id] = { n, firstShot, un, bl, spread: Math.max(...xs) - Math.min(...xs), expect: TUNE.enemyDmg * b.dmgMul * mv.dmg * ZONE_MUL.body * (1 - game.inv.armorRed('body')) };
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);
    }
    // spore lob: a cloud where you stood, no damage
    if (D.byId.lob) {
      clearClouds(); const c0 = 0;
      b = BT.setup(6.5); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'lob' ? 0 : 99; game.inv.hp = 1000;
      for (let i = 0; i < 400; i++) { b.update(1 / 120, P, BT.noise); if (clouds.filter(c => c.on).length > c0) break; }
      const c = clouds.find(c => c.on); out.lob = { cloud: !!c, r: c && c.r, dur: c && c.dur, daze: c && c.daze, hp: game.inv.hp, near: c && Math.hypot(c.x - P.x, c.z - P.z) < 0.3 };
    }
    // the cap-deflated window: body hits x1.3 while bs.exp runs
    if (D.byId.burst) {
      const w = weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 }));
      b = BT.setup(3); b.hp = b.maxHp = 5000; b.bs.exp = 0; let h0 = b.hp; dealHit(b, 'body', 20, w, 0); const normal = h0 - b.hp;
      b.bs.exp = 1; h0 = b.hp; dealHit(b, 'body', 20, w, 0); const open = h0 - b.hp; h0 = b.hp; dealHit(b, 'head', 20, w, 0); const head = h0 - b.hp; b.bs.exp = 0; h0 = b.hp; dealHit(b, 'head', 20, w, 0);
      out.expose = { ratio: open / normal, headRatio: head / (h0 - b.hp) };
    }
    // phase 2: once at 50% hp, adds, summon cap
    b = BT.setup(7); b.bs = bossState(b.def); b.hp = b.maxHp * 0.51; for (let i = 0; i < 120; i++) b.update(1 / 60, P, BT.noise);
    out.ph0 = b.bs.phase; b.hp = b.maxHp * 0.5; for (let i = 0; i < 100; i++) b.update(1 / 60, P, BT.noise);
    const minions = () => game.enemies.filter(e => e.minion === b && !e.dead).length;
    out.ph1 = b.bs.phase; out.adds1 = minions(); for (let i = 0; i < 600; i++) b.update(1 / 60, P, BT.noise);
    out.ph2 = b.bs.phase; out.adds2 = minions(); out.types = [...new Set(game.enemies.filter(e => e.minion === b).map(e => e.type))].join();
    const made = bossSummon(b, 'puffer', 10, b.def.summonCap); out.cap = minions(); out.made = made;
    // pools: run everything again, nothing grows
    const kids = group.children.length, tele = group.userData.bossFx ? group.userData.bossFx.tele.length : 0, shots = group.userData.bossFx ? Object.values(group.userData.bossFx.shots).map(a => a.length).join() : '';
    for (const mv of D.moves) if (!mv.chain) { runMove(mv, false); }
    for (const a of game.arrows) a.life = 0; updateArrows(0.016);
    out.pool = { kids0: kids, kids1: group.children.length, tele0: tele, tele1: group.userData.bossFx.tele.length, shots0: shots, shots1: Object.values(group.userData.bossFx.shots).map(a => a.length).join(), maxShot: Math.max(0, ...Object.values(group.userData.bossFx.shots).map(a => a.length)) };
    // draw calls: the worst of eight views from 6 m
    b = BT.setup(6); let worst = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; P.x = b.x + Math.sin(a) * 6; P.z = b.z + Math.cos(a) * 6; P.yaw = a; P.pitch = 0.1; game.renderFrame ? game.renderFrame() : 0; worst = Math.max(worst, game.renderInfo().calls); }
    out.calls = worst;
    return out;
  };
  for (const [seed, id, nm] of [[8, 'scarecrow', 'Harvest King'], [6, 'mushroom', 'Fungal Warden']]) {
    const pg = await open(seed);
    await pg.evaluate(BOSS_HELPERS);
    const th = await pg.evaluate(() => game.stageThemes[0].name);
    const o = await pg.evaluate(BOSS2, id);
    const D = await pg.evaluate(id => JSON.parse(JSON.stringify(BOSS_DEFS[id])), id);
    const tag = `[${nm}]`;
    check(`${tag} the boss floor of stage 1 uses this def (${th}), named ${nm}, scale ${D.scale}, hp = 220 x ${D.hpMul}`, o.def === id && o.name === nm && Math.abs(o.scale - D.scale) < 1e-9 && Math.abs(o.hp - 220 * D.hpMul) < 1e-6, `${o.def} ${o.name} ${o.scale} ${o.hp}`);
    check(`${tag} mesh count <= 25 (baked, one flash material) and draw calls in the worst of 8 views < 260`, o.meshes <= 25 && o.baked && o.calls < 260, `${o.meshes} meshes, ${o.calls} calls`);
    check(`${tag} hit zones by bands: melee and arrows give legs / body / head by height, nothing above the top`, ['legs', 'body', 'head'].every(z => o.zones[z][0] === z && o.zones[z][1] === z) && o.over === null, JSON.stringify(o.zones));
    for (const mv of D.moves) {
      if (mv.chain) continue;
      const m = o.moves[mv.id], tag2 = `${tag} ${mv.name}`;
      if (mv.shape === 'projectile') {
        const s = o.shots[mv.id];
        check(`${tag2}: ${mv.n} shots appear only once the wind-up is done (${mv.wind} s), fanned, 12 pooled meshes at most`, s.n === mv.n && s.firstShot.t >= s.firstShot.wind - 0.02 && s.firstShot.t < s.firstShot.wind + 0.2 && s.spread > 0 && o.pool.maxShot <= 12, JSON.stringify({ n: s.n, t: s.firstShot.t, wind: s.firstShot.wind, spread: s.spread }));
        check(`${tag2}: a shot hits for ${mv.dmg} x 18.2 x body zone and a block stops it`, Math.abs(s.un - s.expect) < 1e-6 && s.bl === 0, `${s.un} vs ${s.expect}, blocked ${s.bl}`);
        continue;
      }
      if (mv.cloud) {
        check(`${tag2}: leaves a ${mv.cloud.dur} s daze cloud of radius ${mv.r} where you stood, with no damage, after a ${mv.wind} s ground telegraph`, o.lob.cloud && o.lob.r === mv.r && o.lob.dur === mv.cloud.dur && o.lob.daze === mv.cloud.daze && o.lob.hp === 1000 && o.lob.near && m.un.vis === 1, JSON.stringify(o.lob));
        continue;
      }
      const ev = m.un.ev.filter(e => e.zone), evb = m.bl.ev.filter(e => e.zone);
      check(`${tag2}: no damage before windT >= wind - 0.02 (wind ${mv.wind}), the strike lands at wind + 0.07 s`, ev.length >= 1 && ev.every((e, i) => { const c = ev.slice(0, i + 1).reduce((a, x) => a + x.wind, 0); return e.t >= c - 0.02 && e.t <= c + 0.1 * (i + 1) + 0.1; }), JSON.stringify(ev.map(e => [e.id, +e.t.toFixed(3), +e.wind.toFixed(3)])));
      check(`${tag2}: damage = 18.2 x ${mv.dmg} x zone multiplier (x armor), nothing hurts twice`, ev.every(e => Math.abs(e.lost - e.full * e.dmgMv) < 1e-6) && Math.abs(18.2 - 13 * 1.4) < 1e-9, JSON.stringify(ev.map(e => [e.id, +e.lost.toFixed(3), +(e.full * e.dmgMv).toFixed(3)])));
      if (mv.ground) {
        const bt = mv.blockTake === undefined ? 0.5 : mv.blockTake;
        check(`${tag2}: a ground move is blockable but still hurts (x${bt}), never staggers on a parry, knocks back ${mv.knock || 0} m, and shows ${mv.n || 1} red mark(s)`, evb.length >= 1 && evb.every(e => Math.abs(e.lost - e.full * e.dmgMv * bt) < 1e-6 && e.stun === 0 && e.knock === (mv.knock || 0)) && ev.every(e => e.knock === (mv.knock || 0)) && m.un.vis === (mv.n || 1), JSON.stringify(evb.map(e => [e.id, +e.lost.toFixed(3), e.knock, e.stun])) + ` vis ${m.un.vis}`);
        if (mv.knock) check(`${tag2}: the knockback is an eased slide of ${mv.knock} m through open floor`, Math.abs(m.kd - mv.knock) < 0.06, `${m.kd}`);
      } else {
        check(`${tag2}: a parry staggers it (stun 1, wind cancelled, no damage)`, m.bl.ev.length === 1 && m.bl.ev[0].lost === 0 && m.bl.ev[0].stun === 1 || m.bl.ev.length === 0, JSON.stringify(m.bl.ev));
      }
    }
    if (o.expose) check(`${tag} after a Spore Burst the cap is deflated: body hits x1.3, head hits x1`, Math.abs(o.expose.ratio - 1.3) < 1e-6 && Math.abs(o.expose.headRatio - 1) < 1e-6 && Math.abs(o.moves.burst.expo - 1.5) < 0.1, JSON.stringify(o.expose) + ' ' + o.moves.burst.expo);
    check(`${tag} phase 2 fires once at 50% hp (not at 51%)`, o.ph0 === 0 && o.ph1 === 1 && o.ph2 === 1, `${o.ph0} ${o.ph1} ${o.ph2}`);
    const addN = D.phases[0].add ? D.phases[0].add.length : 0;
    check(`${tag} phase 2 summons ${addN} (${addN ? D.phases[0].add[0] : 'none'}) once, and the summon cap (${D.summonCap}) holds`, o.adds1 === addN && o.adds2 === addN && o.cap <= D.summonCap && o.cap >= addN && (!addN || o.types === 'puffer'), `${o.adds1} ${o.adds2} cap ${o.cap}`);
    check(`${tag} nothing grows while it fights: same children, at most 4 telegraph meshes and 12 per shot kind`, o.pool.kids0 === o.pool.kids1 && o.pool.tele0 === o.pool.tele1 && o.pool.tele1 <= 4 && o.pool.shots0 === o.pool.shots1 && o.pool.maxShot <= 12, JSON.stringify(o.pool));
    const ui = await pg.evaluate(async id => {
      const b = game.enemies.find(e => e.boss); b.dormant = false; await T.sleep(400);
      const notch = [...document.querySelectorAll('#bossBar .bnotch')].map(n => n.style.left);
      return { notch, name: document.querySelector('#boss div').textContent, card: bossCardLines(BOSS_DEFS[id], 200).join(' ') };
    }, id);
    check(`${tag} the boss bar has one notch at 50% and the glossary card lists every move`, ui.notch.join() === '50%' && ui.name === nm && D.moves.filter(m => !m.chain).every(m => ui.card.includes(m.name)), `${ui.notch} ${ui.name}`);
    const fin = await pg.evaluate(() => { game.startFloor(5); const b = game.enemies.find(e => e.boss); b.hp = 1; let error = null; try { dealHit(b, 'body', 99, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0); } catch (e) { error = e.message; } return { error, dead: b.dead, open: game.floor.safe.open === true }; });
    check(`${tag} it dies and the safe room door opens`, fin.error === null && fin.dead && fin.open, JSON.stringify(fin));
    await pg.close();
  }
});
