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
    out.hps = [1, 2, 3, 4].map(s => { game.startStage(s); game.startFloor(5); const x = game.enemies.find(e => e.boss); return [x.maxHp, x.dmgMul, x.def.name, x.def.id]; });
    game.startStage(1);
    return out;
  });
  check('the first stage boss is the cave def: one swing move, no phases, named by its theme, with a name tag', g.id !== undefined && g.moves === 1 && g.phases === 0 && g.name === g.hps[0][2] && g.tag, `${g.id} ${g.name}`);
  check('swing windT_ is the old formula (about 0.48 s) and reach 2.38 m', Math.abs(g.wind - g.windExp) < 1e-9 && Math.abs(g.wind - 0.48) < 0.01 && Math.abs(g.reach - 2.38) < 1e-9, `${g.wind.toFixed(4)} s, ${g.reach} m`);
  check('stage 1 hp 220, damage x1.4, radius 0.65, scale 1.6', g.hp1 === 220 && Math.abs(g.dmg - 1.4) < 1e-9 && g.r === 0.65 && Math.abs(g.scale - 1) < 1e-9, `${g.hp1} ${g.dmg}`);
  check('hp by stage 220 / 330 / 440 / 550 and damage x1.4 / 1.68 / 1.96 / 2.24', g.hps.map(h => h[0]).join() === '220,330,440,550' && g.hps.every((h, i) => Math.abs(h[1] - 1.4 * (1 + 0.2 * i)) < 1e-9), JSON.stringify(g.hps.map(h => h.slice(0, 2))));
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
      b = BT.setup(2.0); game.cb.block = !!block; game.cb.blockT = 1; game.cb.stamina = 100; knock.m = 0;
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
});
