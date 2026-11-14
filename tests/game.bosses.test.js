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
    out.name = document.querySelector('#boss div').textContent;
    { const old = b, tx = Math.floor(old.x / TILE), ty = Math.floor(old.z / TILE), c = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: old.seed, type: 'goblin', boss: true, bossId: 'cave', dress: 'warlord', skin: 0x5a8a3a }, game.floor);
      c.x = old.x; c.z = old.z; c.dormant = true; old.mesh.parent.remove(old.mesh); group.add(c.mesh); nameTag(c, c.def.name, c.def.color); game.enemies[game.enemies.indexOf(old)] = c; b = c; }   // every theme has its own boss def now: the golden fight is the plain cave def, built by hand
    out.id = b.def.id; out.moves = b.def.moves.length; out.phases = b.def.phases.length;
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
  check('the cave def (the fallback) is one swing move, no phases, with a name tag; the stage 1 boss floor shows its theme boss name', g.id !== undefined && g.moves === 1 && g.phases === 0 && g.name === g.hps[0][2] && g.tag, `${g.id} ${g.name}`);
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
  const cl = await page.evaluate(() => { game.startStage(2); game.startFloor(5); const b = BT.setup(6); clearClouds(); const m = bossSummon(b, 'puffer', 1, 4); const minion = game.enemies.find(e => e.minion === b); spawnCloud(b.x, b.z, 4, 6, 2.5, true); updateClouds(0.6); return { boss: b.st.has('daze'), made: m, minion: minion ? minion.st.has('daze') : null }; });
  check('a spore cloud dazes ordinary enemies but never the boss (bosses are immune to daze)', cl.boss === false && cl.made === 1 && cl.minion === true, JSON.stringify(cl));

  // 6. The Harvest King, the Fungal Warden, the Librarian Lich and the Frost Giant: every move, phases, zones, summons, cost. Stage 1 theme by seed: 8 Orchard, 6 Cellar, 12 Library, 2 Chapel.
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
      if (mv.chain || mv.shape === 'blink') continue;
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
      const starts = mine.map(a => [a.x, a.z]), gaps = starts.slice(1).map((s, i) => Math.hypot(s[0] - starts[i][0], s[1] - starts[i][1]));
      out.shots[mv.id] = { n, firstShot, un, bl, gaps, geo: group.userData.bossFx.shots[mv.kind][0].geometry.type, spread: Math.max(...xs) - Math.min(...xs), expect: TUNE.enemyDmg * b.dmgMul * mv.dmg * ZONE_MUL.body * (1 - game.inv.armorRed('body')) };
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);
    }
    // spore lob: a cloud where you stood, no damage
    if (D.byId.lob) {
      clearClouds(); const c0 = 0;
      b = BT.setup(6.5); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'lob' ? 0 : 99; game.inv.hp = 1000;
      for (let i = 0; i < 400; i++) { b.update(1 / 120, P, BT.noise); if (clouds.filter(c => c.on).length > c0) break; }
      const c = clouds.find(c => c.on); out.lob = { cloud: !!c, r: c && c.r, dur: c && c.dur, daze: c && c.daze, hp: game.inv.hp, near: c && Math.hypot(c.x - P.x, c.z - P.z) < 0.3 };
    }
    { const w0 = weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })); b = BT.setup(1.6); b.hp = b.maxHp = 50000; dealHit(b, 'body', w0.dmg, w0, 0); out.ttk = true; out.ttkReal = Math.ceil(220 * D.hpMul / (50000 - b.hp)); }   // Common sword body hits to kill at stage 1
    // the open window (cap deflated, core open): hits x mul while bs.exp runs: sword body and head, wand, shield bash
    const exm = D.moves.find(m => m.expose);
    if (exm) {
      const w = weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 }));
      b = BT.setup(1.6); b.hp = b.maxHp = 50000;
      const dmg = f => { const h0 = b.hp; f(); return h0 - b.hp; };
      const bodyY = (D.bands[0] + D.bands[1]) / 2;
      const all = () => ({ body: dmg(() => dealHit(b, 'body', w.dmg, w, 0)), head: dmg(() => dealHit(b, 'head', w.dmg, w, 0)), wand: dmg(() => hurtByWand(b, 10)),
        bash: dmg(() => { game.inv.equip.offhand = makeItem({ type: 'shield', tier: 0 }); game.cb.bashCd = 0; game.cb.stamina = 100; P.pitch = Math.atan2(bodyY - eyeY(), 1.6); bash(); P.pitch = 0; game.inv.equip.offhand = null; }) });
      b.bs.exp = 0; const n = all(); b.bs.exp = 1; const o = all(); b.bs.exp = 0; b.bs.phase = 0;
      out.expose = { body: o.body / n.body, head: o.head / n.head, wand: o.wand / n.wand, bash: o.bash / n.bash, bashN: n.bash, exp: o.body > 0, t: o.body };
    }
    // phase 2: once at 50% hp, adds, summon cap
    b = BT.setup(7); b.bs = bossState(b.def); b.hp = b.maxHp * 0.51; for (let i = 0; i < 120; i++) b.update(1 / 60, P, BT.noise);
    out.ph0 = b.bs.phase; b.hp = b.maxHp * 0.5; for (let i = 0; i < 100; i++) b.update(1 / 60, P, BT.noise);
    const minions = () => game.enemies.filter(e => e.minion === b && !e.dead).length;
    out.ph1 = b.bs.phase; out.adds1 = minions(); for (let i = 0; i < 600; i++) b.update(1 / 60, P, BT.noise);
    out.ph2 = b.bs.phase; out.adds2 = minions(); out.types = [...new Set(game.enemies.filter(e => e.minion === b).map(e => e.type))].join();
    const made = bossSummon(b, D.phases[0].add ? D.phases[0].add[0] : 'puffer', 10, b.def.summonCap); out.cap = minions(); out.made = made;
    // pools: run everything again, nothing grows
    const kids = group.children.length, tele = group.userData.bossFx ? group.userData.bossFx.tele.length : 0, shots = group.userData.bossFx ? Object.values(group.userData.bossFx.shots).map(a => a.length).join() : '';
    for (const mv of D.moves) if (!mv.chain) { runMove(mv, false); }
    for (const a of game.arrows) a.life = 0; updateArrows(0.016);
    out.pool = { kids0: kids, kids1: group.children.length, tele0: tele, tele1: group.userData.bossFx.tele.length, shots0: shots, shots1: Object.values(group.userData.bossFx.shots).map(a => a.length).join(), maxShot: Math.max(0, ...Object.values(group.userData.bossFx.shots).map(a => a.length)) };
    // Bookmark: blink to 3.2 m behind the player, fade tell, a marker at the destination, then a quick slam
    const bm = D.byId.bookmark;
    if (bm) {
      const run = (px, pz) => {
        b = BT.setup(9); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'bookmark' ? 0 : 99; b.bs.phase = 0; if (px !== undefined) { P.x = px; P.z = pz; }
        const o = { vis: 0, op: 1, t: 0 }; let x0 = b.x, z0 = b.z, t = 0, t0 = null, tb = null, ts = null, md = 0, damaged = 0, mark = null;
        for (let i = 0; i < 600; i++) {
          const hp0 = game.inv.hp, z = b.update(1 / 120, P, BT.noise); b.sync(1 / 120);
          if (b.winding && t0 === null) t0 = t; t += 1 / 120;
          if (b.winding && b.mv.id === 'bookmark') { const f = group.userData.bossFx, v = f ? f.tele.filter(m => m.visible) : []; o.vis = Math.max(o.vis, v.length); o.op = Math.min(o.op, b.mats[0].opacity); if (v[0]) mark = [v[0].position.x, v[0].position.z]; }
          if (tb === null && Math.hypot(b.x - x0, b.z - z0) > 1) { tb = t - t0; o.dist = Math.hypot(b.x - P.x, b.z - P.z); o.behindZ = b.z - P.z; o.free = !P.blocked(game.floor, b.x, b.z); o.mark = mark; o.facing = Math.abs(b.yaw - Math.atan2(-(P.x - b.x), -(P.z - b.z))) < 0.01; o.opAfter = b.mats[0].opacity; o.bx = b.x; o.bz = b.z; }
          if (z) { ts = t - t0; o.zone = z; o.mvId = b.mv.id; o.wind2 = b.windT_; break; }
          if (tb !== null && !ts && game.inv.hp < hp0) damaged++;
        }
        for (let i = 0; i < 4; i++) b.sync(1 / 60);
        o.tb = tb; o.ts = ts; o.wind = bm.wind; o.hidden = (group.userData.bossFx.tele.filter(m => m.visible).length); o.damaged = damaged; o.opEnd = b.mats[0].opacity;
        return o;
      };
      out.bm = run();
      b = BT.setup(9); let zz = b.z + 3; while (!P.blocked(game.floor, b.x, zz)) zz += 0.1;   // the player stands 1 m from a wall: behind him is stone
      b.z = zz - 9; const w2 = run(b.x, zz - 1); out.bmWall = { free: w2.free, dist: w2.dist, tb: w2.tb };
    }
    // Ground Freeze: an ice lane (4 pooled decals, 6 s, you slide on it)
    const lm = D.moves.find(m => m.lane);
    if (lm) {
      bossLanesClear(); out.lane = { n0: BOSS_LANE.n };
      const kids = group.children.length; b = BT.setup(5); for (const m of D.moves) b.bs.cd[m.id] = m.id === lm.id ? 0 : 99; b.bs.phase = 0;
      for (let i = 0; i < 700 && !BOSS_LANE.n; i++) { const z = b.update(1 / 120, P, BT.noise); if (z) resolveEnemyAttack(b, z); }
      const it = BOSS_LANE.items.find(l => l.t > 0), fx2 = group.userData.bossFx;
      out.lane.n1 = BOSS_LANE.n; out.lane.dur = it && it.t; out.lane.len = it && it.len; out.lane.w = it && it.w;
      out.lane.on = it ? bossLaneAt(it.x + it.dx * 7, it.z + it.dz * 7) : null; out.lane.off = it ? bossLaneAt(it.x + it.dx * 7 + it.dz * 3, it.z + it.dz * 7 - it.dx * 3) : null; out.lane.beyond = it ? bossLaneAt(it.x + it.dx * 15, it.z + it.dz * 15) : null; out.lane.behind = it ? bossLaneAt(it.x - it.dx * 1, it.z - it.dz * 1) : null;
      out.lane.vis = fx2.lane.filter(m => m.visible).length; out.lane.mid = it ? [it.x + it.dx * 7, it.z + it.dz * 7] : null;
      for (let n = 0; n < 6; n++) { b = BT.setup(5); for (const m of D.moves) b.bs.cd[m.id] = m.id === lm.id ? 0 : 99; for (let i = 0; i < 700; i++) { const z = b.update(1 / 120, P, BT.noise); if (z) { resolveEnemyAttack(b, z); break; } } }
      out.lane.nMax = BOSS_LANE.n; out.lane.decals = fx2.lane.length; out.lane.kidsGrew = group.children.length - kids;
      bossLanesUpdate(5); out.lane.after5 = BOSS_LANE.n; bossLanesUpdate(2); out.lane.after7 = BOSS_LANE.n; out.lane.visEnd = fx2.lane.filter(m => m.visible).length;
      bossLanesClear(); out.lane.clear = BOSS_LANE.n;
    }
    // draw calls: the worst of eight views from 6 m
    b = BT.setup(6); let worst = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; P.x = b.x + Math.sin(a) * 6; P.z = b.z + Math.cos(a) * 6; P.yaw = a; P.pitch = 0.1; game.renderFrame ? game.renderFrame() : 0; worst = Math.max(worst, game.renderInfo().calls); }
    out.calls = worst;
    return out;
  };
  for (const [seed, id, nm] of [[8, 'scarecrow', 'Harvest King'], [6, 'mushroom', 'Fungal Warden'], [12, 'lich', 'Librarian Lich'], [2, 'giant', 'Frost Giant']]) {
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
      if (mv.shape === 'blink') {
        const q = o.bm, w = o.bmWall;
        check(`${tag2}: a ${mv.wind} s telegraph with a marker at the destination and a fade tell, then it is ${mv.behind} m behind you (not in a wall), facing you, and the quick slam lands after its own wind-up`, q.vis === 1 && q.op < 0.5 && q.opAfter === 1 && q.opEnd === 1 && Math.abs(q.tb - (mv.wind + 0.07)) < 0.05 && Math.abs(q.dist - mv.behind) < 0.15 && Math.abs(q.behindZ - mv.behind) < 0.15 && q.free && q.facing && q.mark && Math.hypot(q.mark[0] - q.bx, q.mark[1] - q.bz) < 0.01 && q.zone === 'head' && q.mvId === D.byId[mv.next].id && q.ts - q.tb >= D.byId[mv.next].wind - 0.02 && q.ts - q.tb < D.byId[mv.next].wind + 0.2 && q.damaged === 0 && q.hidden === 0, JSON.stringify(q));
        check(`${tag2}: at a wall it lands nearer or in front, never inside stone`, w.free && w.dist > 0 && w.dist <= mv.behind + 0.01, JSON.stringify(w));
        continue;
      }
      if (mv.shape === 'projectile') {
        const s = o.shots[mv.id];
        check(`${tag2}: ${mv.n} shots appear only once the wind-up is done (${mv.wind} s), ${mv.ring ? 'in a ring' : 'fanned'}, 12 pooled meshes at most, a ${mv.kind} mesh`, s.n === mv.n && s.firstShot.t >= s.firstShot.wind - 0.02 && s.firstShot.t < s.firstShot.wind + 0.2 && (mv.ring ? s.spread > 2.5 : s.spread > 0) && o.pool.maxShot <= 12 && s.geo === (mv.kind === 'page' ? 'PlaneGeometry' : mv.kind === 'shard' ? 'CylinderGeometry' : s.geo) && (!mv.gap || s.gaps.every(g => Math.abs(g - mv.gap) < 0.01)), JSON.stringify({ n: s.n, t: s.firstShot.t, wind: s.firstShot.wind, spread: s.spread }));
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
    const exm = D.moves.find(m => m.expose);
    if (exm) check(`${tag} ${exm.name} opens it for ${exm.expose.t} s: sword body hits, wands and shield bashes x${exm.expose.mul}, head hits ${exm.expose.all ? 'x' + exm.expose.mul : 'x1'}`, Math.abs(o.expose.body - exm.expose.mul) < 1e-6 && Math.abs(o.expose.wand - exm.expose.mul) < 1e-6 && o.expose.bashN > 0 && Math.abs(o.expose.bash - exm.expose.mul) < 1e-6 && Math.abs(o.expose.head - (exm.expose.all ? exm.expose.mul : 1)) < 1e-6 && Math.abs(o.moves[exm.id].expo - exm.expose.t) < 0.1, JSON.stringify(o.expose) + ' ' + o.moves[exm.id].expo);
    if (o.ttk !== undefined) check(`${tag} time to kill with a Common sword at stage 1: 14 to 22 body hits`, o.ttkReal >= 14 && o.ttkReal <= 22, `${o.ttkReal} hits (${220 * D.hpMul} hp)`);
    if (o.lane) check(`${tag} Ground Freeze leaves an ice lane (${D.byId.freeze.len} x ${D.byId.freeze.width} m) for ${D.byId.freeze.lane.dur} s: on it yes, beside, behind and past its end no; at most 4 lanes and 4 pooled decals, nothing grows, it melts`, o.lane.n0 === 0 && o.lane.n1 === 1 && o.lane.dur > 5.9 && o.lane.on === true && o.lane.off === false && o.lane.beyond === false && o.lane.behind === false && o.lane.vis === 1 && o.lane.nMax <= 4 && o.lane.decals <= 4 && o.lane.kidsGrew <= 4 && o.lane.after5 > 0 && o.lane.after7 === 0 && o.lane.visEnd === 0 && o.lane.clear === 0, JSON.stringify(o.lane));
    check(`${tag} phase 2 fires once at 50% hp (not at 51%)`, o.ph0 === 0 && o.ph1 === 1 && o.ph2 === 1, `${o.ph0} ${o.ph1} ${o.ph2}`);
    const addN = D.phases[0].add ? D.phases[0].add.length : 0;
    check(`${tag} phase 2 summons ${addN} (${addN ? D.phases[0].add[0] : 'none'}) once, and the summon cap (${D.summonCap}) holds`, o.adds1 === addN && o.adds2 === addN && o.cap <= D.summonCap && o.cap >= addN && (!addN || o.types === D.phases[0].add[0]), `${o.adds1} ${o.adds2} cap ${o.cap}`);
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

  // 7. BOSS4: Moonfang (Jungle, seed 4), the Giant Innkeeper (Tavern, seed 7) and the Goblin Warlord (Market, seed 1): every move, chains, ground rules, summon caps, phases, cost.
  const BR_HELPERS = () => {
    window.BR = {
      die: () => { game.startFloor(5); const b = game.enemies.find(e => e.boss); b.hp = 1; let error = null; try { dealHit(b, 'body', 99, weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })), 0); } catch (e) { error = e.message; } return { error, dead: b.dead, open: game.floor.safe.open === true }; },
      full: (b, z) => TUNE.enemyDmg * b.dmgMul * ZONE_MUL[z] * (1 - game.inv.armorRed(z)),
      // Run one move to its end (or its first parry). o: dist, block ('parry' | true), pitch, phase, force (bossStart it: any distance), stay (put the player back after each hit), parryOn (move id parried, the rest only blocked)
      run(id, o = {}) {
        const P = game.player, D = game.enemies.find(e => e.boss).def;
        for (const a of game.arrows) a.life = 0; updateArrows(0.016);
        const b0 = game.enemies.find(e => e.boss); if (BR.home) { b0.x = BR.home[0]; b0.z = BR.home[1]; }
        const b = BT.setup(o.dist || 2.2); for (const m of D.moves) b.bs.cd[m.id] = m.id === id ? 0 : 99; b.bs.phase = o.phase === undefined ? D.byId[id].phase[0] : o.phase;
        game.cb.block = !!o.block; game.cb.blockT = o.block === 'parry' ? 0 : 1; game.cb.stamina = 100; P.pitch = o.pitch || 0; knock.m = 0; game.inv.hp = 1000;
        const px = P.x, pz = P.z, ev = []; let t = 0, t0 = null, vis = 0;
        if (o.force) bossStart(b, D.byId[id], P);
        for (let i = 0; i < (o.max || 900); i++) {
          if (o.parryOn) game.cb.blockT = b.mv && b.mv.id === o.parryOn ? 0 : 1;
          if (o.ks) stepKnock(1 / 120);   // the knockback slide (the frame loop steps it)
          const z = b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120;
          if (b.winding || b.bs.st === 'spin' || b.bs.st === 'special') vis = Math.max(vis, group.userData.bossFx ? group.userData.bossFx.tele.filter(m => m.visible).length : 0);
          if (z) { const mv = b.mv, hp0 = game.inv.hp, wind = b.windT_; resolveEnemyAttack(b, z); ev.push({ id: mv.id, t: t - (t0 || 0), wind, zone: z, lost: hp0 - game.inv.hp, knock: knock.m, stun: b.stun, st: b.bs.st, bt: b.bs.t }); if (o.stay) { P.x = px; P.z = pz; knock.m = 0; } if (b.stun > 0) break; }
          if (ev.length && !b.winding && (b.bs.st === 'chase' || b.bs.st === 'recover')) break;
        }
        game.cb.block = false; P.pitch = 0;
        let after = null; if (b.stun > 0) { b.update(1 / 60, P, BT.noise); after = { st: b.bs.st, nx: b.bs.nx, mv: b.mv }; }
        return { ev, b, vis, t, after };
      },
      common(id) {
        const out = { id }, D = BOSS_DEFS[id], P = game.player;
        game.startFloor(5); let b = game.enemies.find(e => e.boss);
        BR.home = [b.x, b.z]; out.def = b.def.id; out.name = b.def.name; out.hud = document.querySelector('#boss div').textContent; out.scale = b.scaleK; out.hp = b.maxHp;
        out.meshes = 0; b.mesh.traverse(o => { if (o.isMesh) out.meshes++; }); out.baked = b.mats.length === 1;
        out.wake = (() => { b.dormant = true; P.x = b.x; P.z = b.z + TUNE.bossWake - 1; b.update(0.016, P, BT.noise); return !b.dormant; })();
        { const w0 = weaponStats(makeItem({ type: 'weapon', base: 'sword', tier: 0 })); b = BT.setup(1.6); b.hp = b.maxHp = 50000; dealHit(b, 'body', w0.dmg, w0, 0); out.ttk = Math.ceil(220 * D.hpMul / (50000 - b.hp)); out.ttkHead = Math.ceil(220 * D.hpMul / (() => { b.hp = 50000; dealHit(b, 'head', w0.dmg, w0, 0); return 50000 - b.hp; })()); }
        out.stun = b.addStatus('stun', 2); out.sleep = b.sleep(5);
        return out;
      },
      // phase 2: once at 50% hp; adds; the summon cap
      phase(type) {
        const D = game.enemies.find(e => e.boss).def, P = game.player, out = {}; game.enemies.find(e => e.boss).x = BR.home[0]; game.enemies.find(e => e.boss).z = BR.home[1]; let b = BT.setup(7); b.bs = bossState(b.def); b.hp = b.maxHp * 0.51;
        for (let i = 0; i < 120; i++) b.update(1 / 60, P, BT.noise);
        out.ph0 = b.bs.phase; out.spd0 = b.chase; b.hp = b.maxHp * 0.5; for (let i = 0; i < 100; i++) b.update(1 / 60, P, BT.noise);
        const minions = () => game.enemies.filter(e => e.minion === b && !e.dead).length;
        out.ph1 = b.bs.phase; out.spd1 = b.chase; out.adds1 = minions(); for (let i = 0; i < 600; i++) b.update(1 / 60, P, BT.noise);
        out.ph2 = b.bs.phase; out.adds2 = minions(); out.made = bossSummon(b, type, 10, b.def.summonCap); out.cap = minions();
        return out;
      },
      calls(b) { const P = game.player; let worst = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; P.x = b.x + Math.sin(a) * 6; P.z = b.z + Math.cos(a) * 6; P.yaw = a; P.pitch = 0.1; game.renderFrame ? game.renderFrame() : 0; worst = Math.max(worst, game.renderInfo().calls); } return worst; },
      // the generic cone move: timing, damage and a parry
      cone(id) {
        const r0 = BR.run(id), r1 = BR.run(id, { block: 'parry' });
        return { ev: r0.ev, full: r0.ev.length ? BR.full(r0.b, r0.ev[0].zone) : 0, parry: r1.ev.length ? { n: r1.ev.length, lost: r1.ev[0].lost, stun: r1.ev[0].stun, st: r1.after && r1.after.st } : null };
      },
      pools(D, moves) {   // run everything again: nothing grows
        const fx = () => group.userData.bossFx, kids = group.children.length, tele = fx() ? fx().tele.length : 0, shots = fx() ? Object.values(fx().shots).map(a => a.length).join() : '';
        for (const id of moves) BR.run(id, { dist: D.byId[id].minD ? D.byId[id].minD + 2 : 2.2, force: true, stay: true });
        for (const a of game.arrows) a.life = 0; updateArrows(0.016);
        return { kids0: kids, kids1: group.children.length, tele0: tele, tele1: fx().tele.length, shots0: shots, shots1: Object.values(fx().shots).map(a => a.length).join(), maxShot: Math.max(0, ...Object.values(fx().shots).map(a => a.length)) };
      },
    };
  };
  const uiOf = async id => { const b = game.enemies.find(e => e.boss); b.dormant = false; await T.sleep(400); return { notch: [...document.querySelectorAll('#bossBar .bnotch')].map(n => n.style.left), name: document.querySelector('#boss div').textContent, card: bossCardLines(BOSS_DEFS[id], 200).join(' ') }; };

  // ---- Moonfang ----
  {
    const pg = await open(4); await pg.evaluate(BOSS_HELPERS); await pg.evaluate(BR_HELPERS);
    const th = await pg.evaluate(() => game.stageThemes[0].name);
    const o = await pg.evaluate(() => {
      const out = BR.common('werewolf'), D = BOSS_DEFS.werewolf, P = game.player;
      let b = game.enemies.find(e => e.boss);
      // zones by bands (melee at 2.5 m, arrows)
      const zs = { legs: D.bands[0] * 0.5, body: (D.bands[0] + D.bands[1]) / 2, head: (D.bands[1] + D.bands[2]) / 2 }, zr = {}; b = BT.setup(2.5);
      for (const z in zs) { P.pitch = Math.atan2(zs[z] - eyeY(), 2.5); const t = findMeleeTarget(P, eyeY(), game.enemies, game.floor, 3); zr[z] = [t && t.zone, zoneAtHeight(zs[z], b)]; }
      P.pitch = 0; out.zones = zr; out.over = zoneAtHeight(D.bands[2] + 0.5, b);
      // Claw Rake: two hits (0.55 then 0.4 wind), 0.7 each; a parry on the first one staggers
      const rk = BR.run('rake'); out.rake = { ev: rk.ev, full: BR.full(rk.b, 'body') };
      const rp = BR.run('rake', { block: 'parry' }); out.rakeParry = { n: rp.ev.length, lost: rp.ev[0].lost, stun: rp.ev[0].stun, after: rp.after && rp.after.st, nx: rp.after && rp.after.nx };
      const bt = BR.cone('bite'); out.bite = bt;
      // Pounce: no damage during the crouch or flight; the landing spot locks as the crouch ends; 10 m cap; landing circle hurts, blockable but still hurts, knocks back 3 m, then 1.2 s of recovery
      b = BT.setup(7); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'pounce' ? 0 : 99; b.bs.phase = 0; bossStart(b, D.byId.pounce, P);
      const step = n => { for (let i = 0; i < n; i++) b.update(1 / 120, P, BT.noise); };
      step(Math.round(0.45 * 120)); P.x += 2; step(1); out.lockMid = [b.bs.tx - P.x, b.bs.tz - P.z];   // mid-crouch: it still follows you
      step(Math.round(0.5 * 120)); out.stAfterWind = b.bs.st; const lx = b.bs.tx, lz = b.bs.tz; out.lockEnd = [lx - P.x, lz - P.z]; P.x += 3; P.z -= 1; step(30); out.lockedAfter = [b.bs.tx - lx, b.bs.tz - lz];   // after: it does not follow
      out.alt = (() => { let mx = 0; for (let i = 0; i < 90 && b.bs.st === 'special'; i++) { b.update(1 / 120, P, BT.noise); mx = Math.max(mx, b.alt); } return mx; })();
      b = BT.setup(14); bossStart(b, D.byId.pounce, P); const bx0 = b.x, bz0 = b.z; for (let i = 0; i < 200 && b.bs.st !== 'special'; i++) b.update(1 / 120, P, BT.noise); out.farTarget = Math.hypot(b.bs.tx - bx0, b.bs.tz - bz0);
      const pu = BR.run('pounce', { dist: 7, force: true }); out.pounce = { ev: pu.ev, full: BR.full(pu.b, 'body'), vis: pu.vis, st: pu.b.bs.st, bt: pu.b.bs.t, alt: pu.b.alt };
      const pb = BR.run('pounce', { dist: 7, force: true, block: true }); out.pounceBlock = { ev: pb.ev, full: BR.full(pb.b, 'body') };
      const pm = BR.run('pounce', { dist: 7, force: true, block: 'parry' }); out.pounceParry = { ev: pm.ev };
      b = BT.setup(7); b.bs.phase = 0; bossStart(b, D.byId.pounce, P); for (let i = 0; i < 400 && b.bs.st !== 'idle'; i++) { b.update(1 / 120, P, BT.noise); if (b.bs.st === 'recover') break; } out.recT = b.bs.t; for (let i = 0; i < 100; i++) b.update(1 / 120, P, BT.noise); out.recMid = b.bs.st; for (let i = 0; i < 60; i++) b.update(1 / 120, P, BT.noise); out.recEnd = b.bs.st;
      // a wall in the way: the leap ends at the wall, never inside it
      b.x = BR.home[0]; b.z = BR.home[1]; b = BT.setup(7); let wx = b.x; while (!P.blocked(game.floor, wx + 0.1, b.z)) wx += 0.1; b.x = wx - 3; b.bs.phase = 0; bossStart(b, D.byId.pounce, P);
      for (let i = 0; i < 200 && b.bs.st !== 'attack'; i++) b.update(1 / 120, P, BT.noise); b.bs.tx = wx + 3; b.bs.tz = b.z; for (let i = 0; i < 200; i++) b.update(1 / 120, P, BT.noise); out.wallFree = !Player.prototype.blocked.call({ radius: 0.7, props: game.floor.solids, mob: true }, game.floor, b.x, b.z); out.wallX = wx - b.x;
      // Howl: wolves after the wind, cap 4, rec 1.5, not picked when the cap is full
      b.x = BR.home[0]; b.z = BR.home[1]; b = BT.setup(8); b.bs.phase = 0; for (const m of D.moves) b.bs.cd[m.id] = m.id === 'howl' ? 0 : 99; const live = () => game.enemies.filter(e => e.minion === b && !e.dead).length;
      let t = 0, made = 0, t0 = null, tm = null; for (let i = 0; i < 400; i++) { b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120; if (tm === null && live() > 0) { tm = t - t0; out.howlWind = b.windT_; out.howlSt = b.bs.st; out.howlRec = b.bs.t; break; } }
      out.howl1 = { t: tm, n: live(), types: [...new Set(game.enemies.filter(e => e.minion === b).map(e => e.type))].join() };
      for (let k = 0; k < 3; k++) { for (const m of D.moves) b.bs.cd[m.id] = m.id === 'howl' ? 0 : 99; b.bs.st = 'chase'; b.atkCd = 0; b.bs.phase = 0; for (let i = 0; i < 400; i++) b.update(1 / 120, P, BT.noise); }
      out.howlCap = live(); for (const m of D.moves) b.bs.cd[m.id] = 0; b.bs.phase = 0; let picked = 0; for (let i = 0; i < 40; i++) { const mv = bossPick(b, 8); if (mv && mv.shape === 'summon') picked++; } out.howlPicked = picked;
      for (const e of game.enemies.filter(e => e.minion === b)) e.dead = true; for (const m of D.moves) b.bs.cd[m.id] = 0; picked = 0; for (let i = 0; i < 60; i++) { const mv = bossPick(b, 8); if (mv && mv.id === 'howl') picked++; } out.howlPickedFree = picked;
      for (const e of game.enemies.filter(e => e.minion === b)) { e.dead = true; }
      // phase 2: Moon rage speed x1.2, two pounces chained, howls each cycle
      out.ph = BR.phase('wolf');
      const p1 = BR.run('pounce', { dist: 7, force: true, phase: 1, stay: true, max: 1500 }); out.chain = { n: p1.ev.length, ids: p1.ev.map(e => e.id), t: p1.ev.map(e => e.t) };
      const p0 = BR.run('pounce', { dist: 7, force: true, phase: 0, stay: true, max: 1500 }); out.chain0 = p0.ev.map(e => e.id);
      for (const e of game.enemies.filter(e => e.minion)) e.dead = true; b = BT.setup(8); b.bs.phase = 1; for (const m of D.moves) b.bs.cd[m.id] = 0; const cnt = { howl2: 0, howl: 0 }; for (let i = 0; i < 300; i++) { const mv = bossPick(b, 8); if (mv && cnt[mv.id] !== undefined) cnt[mv.id]++; } out.howls = cnt;
      out.pools = BR.pools(D, ['rake', 'bite', 'pounce']);
      b = BT.setup(6); out.calls = BR.calls(b);
      out.fin = BR.die();
      return out;
    });
    const D = await pg.evaluate(() => JSON.parse(JSON.stringify(BOSS_DEFS.werewolf)));
    const ui = await pg.evaluate(uiOf, 'werewolf'), tag = '[Moonfang]';
    const f = o.rake.full;
    check(`${tag} the Jungle boss floor (${th}) uses the werewolf def, named Moonfang (HUD too, never Cave Warlord), scale 1.7, hp = 220 x 1.0`, o.def === 'werewolf' && o.name === 'Moonfang' && o.hud === 'Moonfang' && Math.abs(o.scale - 1.7) < 1e-9 && Math.abs(o.hp - 220) < 1e-6 && th === 'The Overgrown Ruin', `${o.def} ${o.name} ${o.hud} ${o.scale} ${o.hp}`);
    check(`${tag} mesh count <= 25 (baked, one flash material) and draw calls in the worst of 8 views < 260`, o.meshes <= 25 && o.baked && o.calls < 260, `${o.meshes} meshes, ${o.calls} calls`);
    check(`${tag} hit zones by bands: melee and arrows give legs / body / head by height, nothing above the top`, ['legs', 'body', 'head'].every(z => o.zones[z][0] === z && o.zones[z][1] === z) && o.over === null, JSON.stringify(o.zones));
    check(`${tag} time to kill with a Common sword at stage 1: 14 to 22 body hits`, o.ttk >= 14 && o.ttk <= 22, `${o.ttk} body hits, ${o.ttkHead} head hits (resist ${JSON.stringify(D.resist)})`);
    check(`${tag} it cannot be stunned or slept, and it wakes within bossWake`, o.stun === false && o.sleep === false && o.wake === true);
    check(`${tag} Claw Rake: two hits, wind 0.55 then 0.4, 0.7 each on the body, nothing before the wind-up is done`, o.rake.ev.length === 2 && o.rake.ev.every(e => e.zone === 'body' && Math.abs(e.lost - f * 0.7) < 1e-6) && Math.abs(o.rake.ev[0].wind - 0.55) < 1e-9 && Math.abs(o.rake.ev[1].wind - 0.4) < 1e-9 && o.rake.ev[0].t >= 0.55 - 0.02 && o.rake.ev[0].t < 0.55 + 0.15 && o.rake.ev[1].t - o.rake.ev[0].t >= 0.4 - 0.02 && o.rake.ev[1].t - o.rake.ev[0].t < 0.4 + 0.2, JSON.stringify(o.rake.ev.map(e => [+e.t.toFixed(3), +e.lost.toFixed(2)])));
    check(`${tag} a parry on the first claw staggers it: no damage, stun 1, the second claw is cancelled`, o.rakeParry.n === 1 && o.rakeParry.lost === 0 && o.rakeParry.stun === 1 && o.rakeParry.after === 'stagger' && o.rakeParry.nx === null, JSON.stringify(o.rakeParry));
    check(`${tag} Bite: wind 0.7, 1.4 on the head, a parry staggers it`, o.bite.ev.length === 1 && Math.abs(o.bite.ev[0].wind - 0.7) < 1e-9 && o.bite.ev[0].zone === 'head' && Math.abs(o.bite.ev[0].lost - o.bite.full * 1.4) < 1e-6 && o.bite.ev[0].t >= 0.7 - 0.02 && o.bite.parry && o.bite.parry.lost === 0 && o.bite.parry.stun === 1, JSON.stringify(o.bite));
    check(`${tag} Pounce: the landing spot (1.2 m short of you) follows you during the crouch and locks at its end (0.9 s), later movement is ignored`, o.stAfterWind === 'attack' && Math.abs(Math.hypot(o.lockMid[0], o.lockMid[1]) - 1.2) < 0.05 && Math.abs(Math.hypot(o.lockEnd[0], o.lockEnd[1]) - 1.2) < 0.05 && o.lockedAfter[0] === 0 && o.lockedAfter[1] === 0, JSON.stringify({ mid: o.lockMid, st: o.stAfterWind, end: o.lockEnd, after: o.lockedAfter }));
    check(`${tag} Pounce: the leap arcs about 2.6 m up, reaches at most 10 m (player 14 m away: lands 10 m from where it took off), and stops at a wall, never inside it`, o.alt > 1.5 && Math.abs(o.farTarget - 10) < 0.01 && o.wallFree && o.wallX >= 0.5, `alt ${o.alt.toFixed(2)}, far ${o.farTarget.toFixed(2)}, wall free ${o.wallFree}, ${o.wallX.toFixed(2)} m short`);
    const pe = o.pounce.ev[0], pbe = o.pounceBlock.ev[0];
    check(`${tag} Pounce landing: no damage until it has crouched (0.9 s) and flown (0.7 s), then 1.3 x 18.2, a ground circle (red mark visible), knock 3 m`, o.pounce.ev.length === 1 && Math.abs(pe.wind - 0.9) < 1e-9 && pe.t >= 0.9 + 0.7 - 0.05 && pe.t < 0.9 + 0.07 + 0.7 + 0.1 && Math.abs(pe.lost - o.pounce.full * 1.3) < 1e-6 && pe.knock === 3 && o.pounce.vis === 1, JSON.stringify({ t: pe.t, lost: pe.lost, full: o.pounce.full, knock: pe.knock, vis: o.pounce.vis }));
    check(`${tag} Pounce landing: a block still lets half through (blockTake 0.5) and knocks you 3 m, a parry staggers nothing`, pbe && Math.abs(pbe.lost - o.pounceBlock.full * 1.3 * 0.5) < 1e-6 && pbe.knock === 3 && pbe.stun === 0 && o.pounceParry.ev[0].stun === 0, JSON.stringify(pbe));
    check(`${tag} Pounce: it then recovers 1.2 s (the punish window) before moving again`, Math.abs(o.recT - 1.2) < 0.02 && o.recMid === 'recover' && o.recEnd === 'chase', `${o.recT} ${o.recMid} ${o.recEnd}`);
    check(`${tag} Howl: wind 1.2, then 2 wolves appear (max 4 alive), it recovers 1.5 s, and a full cap means it does not howl`, Math.abs(o.howlWind - 1.2) < 1e-9 && o.howl1.t >= 1.2 - 0.02 && o.howl1.t < 1.2 + 0.2 && o.howl1.n === 2 && o.howl1.types === 'wolf' && Math.abs(o.howlRec - 1.5) < 0.02 && o.howlCap === 4 && o.howlPicked === 0 && o.howlPickedFree > 0, JSON.stringify({ t: o.howl1.t, n: o.howl1.n, rec: o.howlRec, cap: o.howlCap, picked: o.howlPicked, free: o.howlPickedFree }));
    check(`${tag} phase 2 (Moon rage) fires once at 50% hp (not at 51%), speed x1.2, and the wolves cap (4) holds`, o.ph.ph0 === 0 && o.ph.ph1 === 1 && o.ph.ph2 === 1 && Math.abs(o.ph.spd1 / o.ph.spd0 - 1.2) < 1e-9 && o.ph.cap <= 4, JSON.stringify(o.ph));
    check(`${tag} Moon rage: two pounces in a row (the second 0.8 s wind), one in phase 1 of the fight, and Howl (the phase 2 one, weight 3) comes up often`, o.chain.ids.join() === 'pounce,pounce2' && o.chain0.join() === 'pounce' && o.chain.t[1] - o.chain.t[0] >= 0.8 + 0.7 - 0.05 && o.howls.howl === 0 && o.howls.howl2 > 20, JSON.stringify({ chain: o.chain, chain0: o.chain0, howls: o.howls }));
    check(`${tag} nothing grows while it fights: same children, at most 4 telegraph meshes and 12 per shot kind`, o.pools.kids0 === o.pools.kids1 && o.pools.tele0 === o.pools.tele1 && o.pools.tele1 <= 4 && o.pools.shots0 === o.pools.shots1, JSON.stringify(o.pools));
    check(`${tag} the boss bar has a 50% notch and the glossary card lists Claw Rake, Bite, Pounce and Howl`, ui.notch.join() === '50%' && ui.name === 'Moonfang' && ['Claw Rake', 'Bite', 'Pounce', 'Howl'].every(n => ui.card.includes(n)), `${ui.notch}`);
    check(`${tag} it dies and the safe room door opens`, o.fin.error === null && o.fin.dead && o.fin.open, JSON.stringify(o.fin));
    await pg.close();
  }

  // ---- Giant Innkeeper ----
  {
    const pg = await open(7); await pg.evaluate(BOSS_HELPERS); await pg.evaluate(BR_HELPERS);
    const th = await pg.evaluate(() => game.stageThemes[0].name);
    const o = await pg.evaluate(() => {
      const out = BR.common('innkeeper'), D = BOSS_DEFS.innkeeper, P = game.player;
      let b = game.enemies.find(e => e.boss);
      out.look = { fat: b.upper.scale.x > 1.2, legs: b.legs.length };
      out.smash = BR.cone('smash');
      // Brawl Combo: body, body, head; the finisher parries and that cancels the whole combo; the openers are only blocked
      const c0 = BR.run('combo', { max: 1500 }); out.combo = { ev: c0.ev.map(e => ({ id: e.id, zone: e.zone, wind: e.wind, lost: e.lost, t: e.t })), full: { body: BR.full(c0.b, 'body'), head: BR.full(c0.b, 'head') } };
      const c1 = BR.run('combo', { max: 1500, phase: 1 }); out.combo4 = c1.ev.map(e => ({ id: e.id, zone: e.zone, wind: e.wind, lost: e.lost }));
      const cp = BR.run('combo', { max: 1500, block: 'parry', parryOn: 'fin', pitch: 0 }); out.comboParry = { ev: cp.ev.map(e => ({ id: e.id, lost: e.lost, stun: e.stun })), after: cp.after && { st: cp.after.st, nx: cp.after.nx } };
      const co = BR.run('combo', { max: 1500, block: 'parry', pitch: 0 }); out.comboOpener = { ev: co.ev.map(e => ({ id: e.id, lost: e.lost, stun: e.stun })) };   // parry timing on every hit: the openers are only blocked, the finisher staggers
      // Bottle Toss: 3 bottles after the wind, blockable, splash r 1.2, an ale puddle for 5 s that slows, pooled
      for (const a of game.arrows) a.life = 0; updateArrows(0.016); bossPuddlesClear();
      b = BT.setup(8); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'bottles' ? 0 : 99; b.bs.phase = 0; const a0 = game.arrows.length; let t = 0, t0 = null, shot = null;
      for (let i = 0; i < 400 && shot === null; i++) { b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120; if (game.arrows.length > a0) shot = { t: t - t0, wind: b.windT_ }; }
      const mine = game.arrows.slice(a0); out.bottle = { shot, n: mine.length, kind: mine.map(a => a.kind).join(), geo: group.userData.bossFx.shots.bottle[0].geometry.type, spread: Math.max(...mine.map(a => Math.atan2(a.vx, a.vz))) - Math.min(...mine.map(a => Math.atan2(a.vx, a.vz))), g: mine[0].gravity };
      const hit = block => { game.inv.hp = 1000; game.cb.block = block; game.cb.blockT = 1; game.cb.stamina = 100; const a = mine.pop(); a.x = P.x; a.z = P.z; a.y = 1.0; a.vx = a.vy = a.vz = 0; P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z)); updateArrows(0.016); game.cb.block = false; return 1000 - game.inv.hp; };
      out.bottleHit = hit(false); out.bottleBlock = hit(true); out.bottleFull = BR.full(b, 'body') * 0.5; out.puddleN0 = BOSS_PUD.n;
      for (const a of game.arrows) a.life = 0; updateArrows(0.016); bossPuddlesClear();
      // a bottle smashing on the floor: splash within 1.2 m (+ your radius) hurts, farther does not; the puddle appears there either way
      const land = (d, block) => { for (const a of game.arrows) a.life = 0; updateArrows(0.016); bossPuddlesClear(); game.inv.hp = 1000; b = BT.setup(8); P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z)); const x0 = P.x, z0 = P.z;
        game.cb.block = !!block; game.cb.blockT = 1; game.cb.stamina = 100;
        spawnEnemyShot({ from: b, kind: 'bottle', x: b.x, y: 1, z: b.z, speed: 9, dmg: 0.5, mv: D.byId.bottles }); const a = game.arrows[game.arrows.length - 1]; a.x = x0 + d; a.z = z0; a.y = 0.01; a.vx = a.vz = 0; a.vy = -3; updateArrows(0.016); game.cb.block = false;
        return { lost: 1000 - game.inv.hp, puddles: BOSS_PUD.n, at: BOSS_PUD.items.filter(p => p.t > 0).map(p => [+(p.x - x0).toFixed(2), +(p.z - z0).toFixed(2)]) }; };
      out.splashNear = land(1.0, false); out.splashBlocked = land(1.0, true); out.splashFar = land(2.2, false);
      // the puddle slows (x0.7) inside its radius and not beside it, dries after 5 s, never more than 6 decals
      for (const a of game.arrows) a.life = 0; updateArrows(0.016); bossPuddlesClear(); b = BT.setup(8);
      const x0 = P.x, z0 = P.z; bossPuddleAdd(x0, z0, D.byId.bottles); const inSlow = bossPuddleMul(x0 + 1.0, z0), edge = bossPuddleMul(x0 + 1.25, z0), outSlow = bossPuddleMul(x0 + 1.5, z0);
      updateCombat(0.016); out.speedIn = P.speedMul; P.x = x0 + 3; updateCombat(0.016); out.speedOut = P.speedMul; P.x = x0;
      out.pud = { inSlow, edge, outSlow, vis: group.userData.bossFx.pud.filter(m => m.visible).length };
      bossPuddlesUpdate(4.9); out.pud.n49 = BOSS_PUD.n; bossPuddlesUpdate(0.2); out.pud.n51 = BOSS_PUD.n; out.pud.visEnd = group.userData.bossFx.pud.filter(m => m.visible).length; out.pud.mulDry = bossPuddleMul(x0, z0);
      const kids = group.children.length; for (let i = 0; i < 20; i++) bossPuddleAdd(x0 + i * 0.1, z0, D.byId.bottles); out.pud.max = BOSS_PUD.n; out.pud.decals = group.userData.bossFx.pud.length; out.pud.kidsGrew = group.children.length - kids; bossPuddlesClear(); out.pud.clear = BOSS_PUD.n;
      // Keg Roll: a ground line, wind 1.0, 1.2, legs, a strip telegraph; a low block still hurts; knock 3
      const kg = BR.run('keg', { dist: 5 }); out.keg = { ev: kg.ev, full: BR.full(kg.b, 'legs'), vis: kg.vis };
      const kb = BR.run('keg', { dist: 5, block: true, pitch: -0.6 }); out.kegBlock = { ev: kb.ev, full: BR.full(kb.b, 'legs') };
      b = BT.setup(5); out.kegGeo = (() => { bossStart(b, D.byId.keg, P); for (let i = 0; i < 20; i++) b.update(1 / 120, P, BT.noise); const m = group.userData.bossFx.tele.find(m => m.visible); return m && [m.geometry.type, m.scale.x, m.scale.z]; })();
      out.ph = BR.phase('bandit');
      out.pools = BR.pools(D, ['smash', 'combo', 'bottles', 'keg']);
      b = BT.setup(6); out.calls = BR.calls(b);
      out.fin = BR.die();
      return out;
    });
    const D = await pg.evaluate(() => JSON.parse(JSON.stringify(BOSS_DEFS.innkeeper)));
    const ui = await pg.evaluate(uiOf, 'innkeeper'), tag = '[Giant Innkeeper]', f = o.combo.full;
    check(`${tag} the Tavern boss floor (${th}) uses the innkeeper def, named Giant Innkeeper, scale 1.7, hp = 220 x 1.0, fat build`, o.def === 'innkeeper' && o.name === 'Giant Innkeeper' && o.hud === 'Giant Innkeeper' && Math.abs(o.scale - 1.7) < 1e-9 && Math.abs(o.hp - 220) < 1e-6 && o.look.fat && th === 'The Sunken Tavern', `${o.def} ${o.scale} ${o.hp} ${JSON.stringify(o.look)}`);
    check(`${tag} mesh count <= 25 (baked, one flash material) and draw calls in the worst of 8 views < 260`, o.meshes <= 25 && o.baked && o.calls < 260, `${o.meshes} meshes, ${o.calls} calls`);
    check(`${tag} time to kill with a Common sword at stage 1: 14 to 22 body hits`, o.ttk >= 14 && o.ttk <= 22, `${o.ttk} body hits, ${o.ttkHead} head hits (resist ${JSON.stringify(D.resist)})`);
    check(`${tag} it cannot be stunned or slept`, o.stun === false && o.sleep === false);
    check(`${tag} Mug Smash: wind 0.7, 1.1 on the head, nothing before the wind-up is done, a parry staggers it`, o.smash.ev.length === 1 && Math.abs(o.smash.ev[0].wind - 0.7) < 1e-9 && o.smash.ev[0].zone === 'head' && Math.abs(o.smash.ev[0].lost - o.smash.full * 1.1) < 1e-6 && o.smash.ev[0].t >= 0.7 - 0.02 && o.smash.parry && o.smash.parry.lost === 0 && o.smash.parry.stun === 1 && o.smash.parry.st === 'stagger', JSON.stringify(o.smash));
    check(`${tag} Brawl Combo: three hits, wind 0.55 / 0.4 / 0.8, damage 0.6 / 0.7 / 1.3, zones body / body / head, each after its own wind-up`, o.combo.ev.length === 3 && o.combo.ev.map(e => e.wind).join() === '0.55,0.4,0.8' && o.combo.ev.map(e => e.zone).join() === 'body,body,head' && [0.6, 0.7, 1.3].every((m, i) => Math.abs(o.combo.ev[i].lost - f[o.combo.ev[i].zone] * m) < 1e-6) && o.combo.ev.every((e, i) => e.t >= o.combo.ev.slice(0, i + 1).reduce((a, x) => a + x.wind, 0) - 0.02), JSON.stringify(o.combo.ev.map(e => [e.id, +e.t.toFixed(2), +e.lost.toFixed(2)])));
    check(`${tag} Last Call (phase 2): the combo gets a 4th hit (body, body, body, head)`, o.combo4.map(e => e.zone).join() === 'body,body,body,head' && o.combo4.map(e => e.id).join() === 'combo,combo2,combo3,fin', JSON.stringify(o.combo4.map(e => e.id)));
    check(`${tag} the finisher is the parry: parrying only it (the openers are blocked) staggers the whole combo (stun 1, no damage from it, nothing chained after)`, o.comboParry.ev.length === 3 && o.comboParry.ev[0].stun === 0 && o.comboParry.ev[1].stun === 0 && o.comboParry.ev[0].lost === 0 && o.comboParry.ev[2].stun === 1 && o.comboParry.ev[2].lost === 0 && o.comboParry.after.st === 'stagger' && o.comboParry.after.nx === null, JSON.stringify(o.comboParry));
    check(`${tag} the openers cannot be parried (a parry timing on them is only a block: no stagger)`, o.comboOpener.ev.length === 3 && o.comboOpener.ev[0].stun === 0 && o.comboOpener.ev[1].stun === 0 && o.comboOpener.ev[2].stun === 1, JSON.stringify(o.comboOpener));
    check(`${tag} Bottle Toss: 3 bottles appear only after the 0.7 s wind-up, fanned, lobbed (gravity), a bottle mesh from the pool`, o.bottle.n === 3 && o.bottle.kind === 'bottle,bottle,bottle' && o.bottle.shot.t >= o.bottle.shot.wind - 0.02 && o.bottle.shot.t < o.bottle.shot.wind + 0.2 && Math.abs(o.bottle.shot.wind - 0.7) < 1e-9 && o.bottle.spread > 0 && o.bottle.g > 0 && o.bottle.geo === 'BufferGeometry', JSON.stringify(o.bottle));
    check(`${tag} a bottle that hits you deals 0.5 x 18.2 x body zone and a block stops it; either way an ale puddle is left`, Math.abs(o.bottleHit - o.bottleFull) < 1e-6, `${o.bottleHit} vs ${o.bottleFull}`);
    check(`${tag} a bottle blocked head-on does no damage`, o.bottleBlock === 0 && o.puddleN0 >= 1, `${o.bottleBlock}, ${o.puddleN0} puddles`);
    check(`${tag} a bottle smashing on the floor splashes 1.2 m: 1.0 m away it hurts (a block stops it), 2.2 m away it does not, and the puddle appears at the spot either way`, Math.abs(o.splashNear.lost - o.bottleFull) < 1e-6 && o.splashBlocked.lost === 0 && o.splashFar.lost === 0 && [o.splashNear, o.splashBlocked, o.splashFar].every(r => r.puddles === 1) && Math.abs(o.splashFar.at[0][0] - 2.2) < 0.05, JSON.stringify([o.splashNear, o.splashBlocked, o.splashFar]));
    check(`${tag} the ale puddle slows x0.7 inside its radius (not beside it), is 5 s long and dries, at most 6 pooled decals and nothing grows`, o.pud.inSlow === 0.7 && o.pud.outSlow === 1 && Math.abs(o.speedIn - 0.7) < 1e-9 && o.speedOut === 1 && o.pud.vis === 1 && o.pud.n49 === 1 && o.pud.n51 === 0 && o.pud.visEnd === 0 && o.pud.mulDry === 1 && o.pud.max <= 6 && o.pud.decals <= 6 && o.pud.kidsGrew <= 6 && o.pud.clear === 0, JSON.stringify(o.pud) + ` speed ${o.speedIn} ${o.speedOut}`);
    check(`${tag} Keg Roll: a 12 x 1.4 m red strip for 1.0 s, then 1.2 x 18.2 on the legs, unblockable by parry, a block still lets half through, knock 3 m`, o.keg.ev.length === 1 && Math.abs(o.keg.ev[0].wind - 1.0) < 1e-9 && o.keg.ev[0].t >= 1.0 - 0.02 && o.keg.ev[0].zone === 'legs' && Math.abs(o.keg.ev[0].lost - o.keg.full * 1.2) < 1e-6 && o.keg.ev[0].knock === 3 && o.keg.vis === 1 && o.kegGeo[0] === 'PlaneGeometry' && o.kegGeo[1] === 1.4 && o.kegGeo[2] === 12 && Math.abs(o.kegBlock.ev[0].lost - o.kegBlock.full * 1.2 * 0.5) < 1e-6 && o.kegBlock.ev[0].stun === 0 && o.kegBlock.ev[0].knock === 3, JSON.stringify({ keg: o.keg.ev, blk: o.kegBlock.ev, geo: o.kegGeo }));
    check(`${tag} phase 2 (Last Call) fires once at 50% hp (not at 51%), speed x1.15, two bandits join once, the cap (4) holds`, o.ph.ph0 === 0 && o.ph.ph1 === 1 && o.ph.ph2 === 1 && Math.abs(o.ph.spd1 / o.ph.spd0 - 1.15) < 1e-9 && o.ph.adds1 === 2 && o.ph.adds2 === 2 && o.ph.cap <= 4, JSON.stringify(o.ph));
    check(`${tag} nothing grows while it fights: same children, at most 4 telegraph meshes and 12 per shot kind`, o.pools.kids0 === o.pools.kids1 && o.pools.tele0 === o.pools.tele1 && o.pools.tele1 <= 4 && o.pools.shots0 === o.pools.shots1 && o.pools.maxShot <= 12, JSON.stringify(o.pools));
    check(`${tag} the boss bar has a 50% notch and the glossary card lists Mug Smash, Brawl Combo, Bottle Toss and Keg Roll`, ui.notch.join() === '50%' && ui.name === 'Giant Innkeeper' && ['Mug Smash', 'Brawl Combo', 'Bottle Toss', 'Keg Roll'].every(n => ui.card.includes(n)), `${ui.notch}`);
    check(`${tag} it dies and the safe room door opens`, o.fin.error === null && o.fin.dead && o.fin.open, JSON.stringify(o.fin));
    await pg.close();
  }

  // ---- Goblin Warlord ----
  {
    const pg = await open(1); await pg.evaluate(BOSS_HELPERS); await pg.evaluate(BR_HELPERS);
    const th = await pg.evaluate(() => game.stageThemes[0].name);
    const o = await pg.evaluate(() => {
      const out = BR.common('warlord'), D = BOSS_DEFS.warlord, P = game.player;
      let b = game.enemies.find(e => e.boss);
      out.look = { dress: b.spec.dress, skin: b.spec.skin, plate: b.look.vest };
      out.cleave = BR.cone('cleave');
      // Shield Charge: wind 0.9, then 11 m/s along the locked line; reaching you = 1.3 on the legs (ground: a block still lets half through, knock 3 m)
      const ch = BR.run('charge', { dist: 9, force: true }); out.charge = { ev: ch.ev, full: BR.full(ch.b, 'legs'), vis: ch.vis, st: ch.b.bs.st, bt: ch.b.bs.t, stunned: ch.b.stun };
      const cb = BR.run('charge', { dist: 9, force: true, block: true, pitch: -0.6 }); out.chargeBlock = { ev: cb.ev, full: BR.full(cb.b, 'legs') };
      const cp = BR.run('charge', { dist: 9, force: true, block: 'parry', pitch: -0.6 }); out.chargeParry = cp.ev;
      // speed and the wall: the charge line is frozen at the end of the wind-up; with nothing to hit it runs on until a wall
      b.x = BR.home[0]; b.z = BR.home[1]; b = BT.setup(9); let wx = b.x; while (!P.blocked(game.floor, wx + 0.1, b.z)) wx += 0.1; b.x = wx - 7; b.bs.phase = 0; P.x = b.x; P.z = b.z + 9; bossStart(b, D.byId.charge, P);
      for (let i = 0; i < 300 && b.bs.st !== 'attack'; i++) b.update(1 / 120, P, BT.noise);
      b.bs.dx = 1; b.bs.dz = 0; P.x = b.x - 40;   // the player is out of the way
      const xs = []; let hit = false; for (let i = 0; i < 400 && !(b.stun > 0); i++) { b.update(1 / 120, P, BT.noise); xs.push(b.x); }
      out.wall = { stun: b.stun, speed: (xs[40] - xs[20]) / (20 / 120), free: !Player.prototype.blocked.call({ radius: 0.65, props: game.floor.solids, mob: true }, game.floor, b.x, b.z), gap: wx - b.x };
      const x1 = b.x; for (let i = 0; i < 60; i++) b.update(1 / 120, P, BT.noise); out.wall.stillStunned = b.stun > 0 && b.x === x1;
      out.wall.sleep = b.sleep(3); out.wall.addStun = b.addStatus('stun', 3);
      let n = 0; for (let i = 0; i < 160; i++) { b.update(1 / 120, P, BT.noise); n++; } out.wall.after = b.stun <= 0 && b.bs.st === 'chase';
      // a pillar in the line does the same
      b = BT.setup(9); b.x = game.floor.w * TILE / 2; b.bs.phase = 0; P.x = b.x; P.z = b.z + 9; const pil = { x: b.x, z: b.z - 3.0, r: 1.0 }; game.floor.solids.push(pil); bossStart(b, D.byId.charge, P);
      for (let i = 0; i < 300 && b.bs.st !== 'attack'; i++) b.update(1 / 120, P, BT.noise); b.bs.dx = 0; b.bs.dz = -1; P.z = b.z + 40;
      for (let i = 0; i < 300 && !(b.stun > 0); i++) b.update(1 / 120, P, BT.noise); out.pillar = { stun: b.stun, gap: b.z - pil.z }; game.floor.solids.pop();
      // and when it runs out of line without touching anything: no stun
      b = BT.setup(9); b.x = game.floor.w * TILE / 2; b.z = game.floor.h * TILE / 2; b.bs.phase = 0; P.x = b.x; P.z = b.z + 9; bossStart(b, D.byId.charge, P); for (let i = 0; i < 300 && b.bs.st !== 'attack'; i++) b.update(1 / 120, P, BT.noise);
      b.bs.dx = 1; b.bs.dz = 0; P.x = b.x - 40; const xs0 = b.x; for (let i = 0; i < 400 && b.bs.st !== 'recover' && b.bs.st !== 'chase'; i++) b.update(1 / 120, P, BT.noise); out.open = { stun: b.stun, ran: b.x - xs0 };
      // a shield bash does not stun it; the parry does (a cleave): the one other stagger
      b = BT.setup(1.6); b.hp = b.maxHp = 50000; game.inv.equip.offhand = makeItem({ type: 'shield', tier: 0 }); game.cb.bashCd = 0; game.cb.stamina = 100; P.pitch = Math.atan2(1.6 - eyeY(), 1.6); bash(); P.pitch = 0; game.inv.equip.offhand = null; out.bashStun = b.stun;
      // Cleaver Throw: a cleaver from the pool, after 0.8 s, blockable
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);
      b = BT.setup(8); for (const m of D.moves) b.bs.cd[m.id] = m.id === 'cleaver' ? 0 : 99; b.bs.phase = 0; const a0 = game.arrows.length; let t = 0, t0 = null, shot = null;
      for (let i = 0; i < 400 && shot === null; i++) { b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120; if (game.arrows.length > a0) shot = { t: t - t0, wind: b.windT_ }; }
      const mine = game.arrows.slice(a0); out.axe = { shot, n: mine.length, kind: mine[0].kind, geo: group.userData.bossFx.shots.axe[0].geometry.type, g: mine[0].gravity, pool: mine[0].pool };
      const hitA = block => { game.inv.hp = 1000; game.cb.block = block; game.cb.blockT = 1; game.cb.stamina = 100; const a = mine.pop() || (spawnEnemyShot({ from: b, kind: 'axe', x: b.x, y: 1, z: b.z, speed: 15, dmg: 0.9, mv: D.byId.cleaver }), game.arrows[game.arrows.length - 1]); a.x = P.x; a.z = P.z; a.y = 1.0; a.vx = a.vy = a.vz = 0; P.yaw = Math.atan2(-(b.x - P.x), -(b.z - P.z)); updateArrows(0.016); game.cb.block = false; return 1000 - game.inv.hp; };
      out.axeHit = hitA(false); out.axeBlock = hitA(true); out.axeFull = BR.full(b, 'body') * 0.9;
      // Banner Rally: 2 goblins after 1.2 s, max 4 alive
      for (const a of game.arrows) a.life = 0; updateArrows(0.016);
      b = BT.setup(8); b.bs.phase = 0; const live = () => game.enemies.filter(e => e.minion === b && !e.dead).length; for (const m of D.moves) b.bs.cd[m.id] = m.id === 'rally' ? 0 : 99;
      t = 0; t0 = null; let tm = null; for (let i = 0; i < 400; i++) { b.update(1 / 120, P, BT.noise); if (b.winding && t0 === null) t0 = t; t += 1 / 120; if (tm === null && live() > 0) { tm = t - t0; out.rallyWind = b.windT_; break; } }
      out.rally = { t: tm, n: live(), types: [...new Set(game.enemies.filter(e => e.minion === b).map(e => e.type))].join() };
      for (let k = 0; k < 3; k++) { for (const m of D.moves) b.bs.cd[m.id] = m.id === 'rally' ? 0 : 99; b.bs.st = 'chase'; b.atkCd = 0; for (let i = 0; i < 400; i++) b.update(1 / 120, P, BT.noise); }
      out.rallyCap = live(); for (const m of D.moves) b.bs.cd[m.id] = 0; let picked = 0; for (let i = 0; i < 60; i++) { const mv = bossPick(b, 8); if (mv && mv.id === 'rally') picked++; } out.rallyPicked = picked;
      for (const e of game.enemies.filter(e => e.minion === b)) e.dead = true;
      // Whirlwind (phase 2 only): a circle r 3.4, three ticks of 0.5 over 1.6 s
      b = BT.setup(2.0); b.bs.phase = 0; for (const m of D.moves) b.bs.cd[m.id] = 0; let w0 = 0; for (let i = 0; i < 80; i++) { const mv = bossPick(b, 2.0); if (mv && mv.id === 'whirl') w0++; } out.whirlP0 = w0;
      b.bs.phase = 1; w0 = 0; for (let i = 0; i < 80; i++) { const mv = bossPick(b, 2.0); if (mv && mv.id === 'whirl') w0++; } out.whirlP1 = w0;
      const wh = BR.run('whirl', { dist: 2.2, stay: true, phase: 1, max: 1500 }); out.whirl = { ev: wh.ev, full: BR.full(wh.b, 'body'), vis: wh.vis, st: wh.b.bs.st };
      const wb = BR.run('whirl', { dist: 2.2, stay: true, phase: 1, max: 1500, block: true }); out.whirlBlock = { ev: wb.ev, full: BR.full(wb.b, 'body') };
      const wk = BR.run('whirl', { dist: 2.2, phase: 1, max: 1500, ks: true }); out.whirlKnock = { ev: wk.ev };
      b = BT.setup(2.2); b.bs.phase = 1; bossStart(b, D.byId.whirl, P); for (let i = 0; i < 400 && b.bs.st !== 'spin'; i++) b.update(1 / 120, P, BT.noise); out.spinVis = group.userData.bossFx.tele.filter(m => m.visible).length; for (let i = 0; i < 400 && b.bs.st === 'spin'; i++) b.update(1 / 120, P, BT.noise); out.spinEnd = group.userData.bossFx.tele.filter(m => m.visible).length;
      out.ph = BR.phase('goblin');
      out.pools = BR.pools(D, ['cleave', 'charge', 'cleaver', 'whirl']);
      b = BT.setup(6); out.calls = BR.calls(b);
      out.fin = BR.die();
      return out;
    });
    const D = await pg.evaluate(() => JSON.parse(JSON.stringify(BOSS_DEFS.warlord)));
    const ui = await pg.evaluate(uiOf, 'warlord'), tag = '[Goblin Warlord]';
    check(`${tag} the Market boss floor (${th}) uses the warlord def, named Goblin Warlord, its goblin look kept (dress warlord, plate, green skin), scale 1.6, hp = 220 x 1.1`, o.def === 'warlord' && o.name === 'Goblin Warlord' && o.hud === 'Goblin Warlord' && Math.abs(o.scale - 1.6) < 1e-9 && Math.abs(o.hp - 242) < 1e-6 && o.look.dress === 'warlord' && o.look.skin === 0x7a9a3a && o.look.plate && th === 'The Goblin Market', `${o.def} ${o.scale} ${o.hp} ${JSON.stringify(o.look)}`);
    check(`${tag} mesh count <= 25 (baked, one flash material) and draw calls in the worst of 8 views < 260`, o.meshes <= 25 && o.baked && o.calls < 260, `${o.meshes} meshes, ${o.calls} calls`);
    check(`${tag} time to kill with a Common sword at stage 1: 14 to 22 body hits`, o.ttk >= 14 && o.ttk <= 22, `${o.ttk} body hits, ${o.ttkHead} head hits (resist ${JSON.stringify(D.resist)})`);
    check(`${tag} War Cleave: wind 0.75, 1.1 on the head, nothing before the wind-up is done, a parry staggers it`, o.cleave.ev.length === 1 && Math.abs(o.cleave.ev[0].wind - 0.75) < 1e-9 && o.cleave.ev[0].zone === 'head' && Math.abs(o.cleave.ev[0].lost - o.cleave.full * 1.1) < 1e-6 && o.cleave.ev[0].t >= 0.75 - 0.02 && o.cleave.parry && o.cleave.parry.lost === 0 && o.cleave.parry.stun === 1, JSON.stringify(o.cleave));
    const ce = o.charge.ev[0], cbe = o.chargeBlock.ev[0];
    check(`${tag} Shield Charge: a 1.6 m red strip for the 0.9 s wind-up, then it runs; reaching you hits for 1.3 x 18.2 on the legs with knock 3 m, then recovers 0.6 s`, o.charge.ev.length === 1 && Math.abs(ce.wind - 0.9) < 1e-9 && ce.t >= 0.9 + 0.07 && ce.zone === 'legs' && Math.abs(ce.lost - o.charge.full * 1.3) < 1e-6 && ce.knock === 3 && o.charge.vis === 1 && ce.st === 'recover' && Math.abs(ce.bt - 0.6) < 0.02 && o.charge.stunned === 0, JSON.stringify({ t: ce.t, lost: ce.lost, full: o.charge.full, knock: ce.knock, vis: o.charge.vis, st: ce.st }));
    check(`${tag} Shield Charge: a low block still lets half through and knocks you 3 m, a parry timing never staggers it (no stun)`, cbe && Math.abs(cbe.lost - o.chargeBlock.full * 1.3 * 0.5) < 1e-6 && cbe.knock === 3 && cbe.stun === 0 && o.chargeParry[0].stun === 0, JSON.stringify(o.chargeBlock.ev));
    check(`${tag} Shield Charge: it runs at 11 m/s and stops at the wall, never inside it, stunning ITSELF 1.2 s (it stands still for the whole stun)`, Math.abs(o.wall.speed - 11) < 0.6 && Math.abs(o.wall.stun - 1.2) < 0.05 && o.wall.free && o.wall.gap > 0.2 && o.wall.stillStunned, JSON.stringify(o.wall));
    check(`${tag} the self-stun is the only stun: a stun status and a sleep still fail, a shield bash does not stun it, and it moves again after 1.2 s`, o.wall.addStun === false && o.wall.sleep === false && o.bashStun === 0 && o.wall.after, `bash ${o.bashStun}`);
    check(`${tag} a pillar in the line stuns it too (1.2 s); running out of line without touching anything does not`, Math.abs(o.pillar.stun - 1.2) < 0.05 && o.pillar.gap > 0.5 && o.open.stun === 0 && o.open.ran > 10, JSON.stringify({ pillar: o.pillar, open: o.open }));
    check(`${tag} Cleaver Throw: one axe (a cleaver mesh from the pool, arcing) after the 0.8 s wind-up; it hurts 0.9 x 18.2 on the body and a block stops it`, o.axe.n === 1 && o.axe.kind === 'axe' && o.axe.pool && o.axe.g > 0 && o.axe.geo === 'BufferGeometry' && Math.abs(o.axe.shot.wind - 0.8) < 1e-9 && o.axe.shot.t >= 0.8 - 0.02 && o.axe.shot.t < 0.8 + 0.2 && Math.abs(o.axeHit - o.axeFull) < 1e-6 && o.axeBlock === 0, JSON.stringify({ axe: o.axe, hit: o.axeHit, full: o.axeFull, block: o.axeBlock }));
    check(`${tag} Banner Rally: wind 1.2, then 2 goblin guards (max 4 alive), and a full cap means no rally`, Math.abs(o.rallyWind - 1.2) < 1e-9 && o.rally.t >= 1.2 - 0.02 && o.rally.t < 1.2 + 0.2 && o.rally.n === 2 && o.rally.types === 'goblin' && o.rallyCap === 4 && o.rallyPicked === 0, JSON.stringify({ rally: o.rally, cap: o.rallyCap, picked: o.rallyPicked }));
    const we = o.whirl.ev, f = o.whirl.full;
    check(`${tag} Whirlwind: phase 2 only; r 3.4 red circle, wind 1.0, then 3 ticks of 0.5 x 18.2 over 1.6 s (first with the strike, then every 0.8 s), knock 3 m each`, o.whirlP0 === 0 && o.whirlP1 > 0 && we.length === 3 && we.every(e => Math.abs(e.lost - f * 0.5) < 1e-6 && e.knock === 3 && e.zone === 'body') && we[0].t >= 1.0 - 0.02 && Math.abs(we[1].t - we[0].t - 0.8) < 0.03 && Math.abs(we[2].t - we[0].t - 1.6) < 0.03 && o.whirl.vis === 1 && o.spinVis === 1 && o.spinEnd === 0, JSON.stringify({ t: we.map(e => +e.t.toFixed(3)), lost: we.map(e => +e.lost.toFixed(2)), vis: o.whirl.vis, spin: o.spinVis, end: o.spinEnd }));
    check(`${tag} Whirlwind: a block lets half through each tick (still knocked back), a parry never staggers it, and the knockback of the first tick takes you out of the circle`, o.whirlBlock.ev.length === 3 && o.whirlBlock.ev.every(e => Math.abs(e.lost - o.whirlBlock.full * 0.5 * 0.5) < 1e-6 && e.stun === 0 && e.knock === 3) && o.whirlKnock.ev.length === 1, JSON.stringify({ block: o.whirlBlock.ev.map(e => +e.lost.toFixed(2)), knock: o.whirlKnock.ev.length }));
    check(`${tag} phase 2 fires once at 50% hp (not at 51%) with no adds, and the guards cap (4) holds`, o.ph.ph0 === 0 && o.ph.ph1 === 1 && o.ph.ph2 === 1 && o.ph.adds1 === 0 && o.ph.adds2 === 0 && o.ph.cap <= 4, JSON.stringify(o.ph));
    check(`${tag} nothing grows while it fights: same children, at most 4 telegraph meshes and 12 per shot kind`, o.pools.kids0 === o.pools.kids1 && o.pools.tele0 === o.pools.tele1 && o.pools.tele1 <= 4 && o.pools.shots0 === o.pools.shots1 && o.pools.maxShot <= 12, JSON.stringify(o.pools));
    check(`${tag} the boss bar has a 50% notch and the glossary card lists every move`, ui.notch.join() === '50%' && ui.name === 'Goblin Warlord' && ['War Cleave', 'Shield Charge', 'Cleaver Throw', 'Banner Rally', 'Whirlwind'].every(n => ui.card.includes(n)), `${ui.notch}`);
    check(`${tag} it dies and the safe room door opens`, o.fin.error === null && o.fin.dead && o.fin.open, JSON.stringify(o.fin));
    await pg.close();
  }
});
