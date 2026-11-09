// Wands, recharge wands and Hanahan's Rage. Run on its own: node tests/game.magic.test.js
const { run } = require('./lib');
run('Wands and Hanahan\'s Rage', async ({ open, check }) => {
  let page = await open(7);

  // 1. Each wand does what it says. Armor and hit zones are ignored, and charges tick down.
  const fx = await page.evaluate(async () => {
    const out = {};
    const wand = (kind, charges) => { const w = makeItem({ type: 'wand', base: 'wand', kind }); if (charges !== undefined) w.charges = charges; return w; };
    const setup = (kind, d = 6, alerted = true, keepPlace = false) => {
      if (!keepPlace) T.reset(); game.inv.equip.weapon = wand(kind); game.cb.stamina = 100;
      const e = T.guard(d, 'toward', alerted); e.hp = e.maxHp = 500; e.resist = { head: 0.5, body: 0.5, legs: 0.5 }; e.update = function () { this.sync(0); return null; };
      return e;
    };
    const cast = async (until, ms = 4000) => { game.cb.press = true; return T.until(until, ms); };
    let e = setup('fire'); const w0 = game.inv.equip.weapon;
    await cast(() => e.hp < 500); out.fireDamage = 500 - e.hp; out.fireCharges = w0.charges;
    e = setup('frost'); await cast(() => e.st.has('slow')); out.frostDamage = 500 - e.hp; out.frostSlow = e.st.has('slow');
    // lightning: a stun, and an arc to a second enemy standing near the first
    e = setup('lightning'); const second = T.guard(8.5, 'toward', true); second.hp = second.maxHp = 500; second.update = function () { this.sync(0); return null; };
    await cast(() => e.st.has('stun') && second.hp < 500); out.lightning = { damage: 500 - e.hp, stun: e.st.has('stun'), chainDamage: 500 - second.hp, chainStun: second.st.has('stun') };
    // force: thrown away from the player
    T.reset(); { const room = [...game.floor.rooms].filter(r => !r.locked).sort((a, b) => b.w - a.w)[0], P = game.player; P.x = (room.x + 1.5) * TILE; P.z = (room.cy + 0.5) * TILE; P.yaw = -Math.PI / 2; P.pitch = 0; }
    e = setup('force', 4, true, true); const x0 = Math.hypot(e.x - game.player.x, e.z - game.player.z);
    await cast(() => 500 - e.hp > 0); await T.sleep(200); out.forcePush = Math.hypot(e.x - game.player.x, e.z - game.player.z) - x0; out.forceDamage = 500 - e.hp;
    // sleep: the target stops noticing you even though you stand right in front of it, and any damage wakes it
    e = setup('sleep', 3); delete e.update; await cast(() => e.sleepT > 0);
    out.sleeping = e.sleepT > 0; await T.sleep(1500); out.sleptThrough = e.state === 'unaware' && e.aware === 0;
    game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'dagger', tier: 0 }); e.x = game.player.x - Math.sin(game.player.yaw) * 1.2; e.z = game.player.z - Math.cos(game.player.yaw) * 1.2;
    await T.sleep(150); game.cb.press = true; await T.until(() => e.dead, 3000);
    out.sneakKilled = e.dead;
    return out;
  });
  check('a fire bolt does 22 damage whatever the armor', Math.abs(fx.fireDamage - 22) < 0.6, fx.fireDamage.toFixed(1));
  check('a cast uses a charge', fx.fireCharges === 4, 'charges ' + fx.fireCharges);
  check('a frost bolt does a little damage and slows', Math.abs(fx.frostDamage - 8) < 0.6 && fx.frostSlow, fx.frostDamage.toFixed(1));
  check('lightning stuns and arcs to a second enemy', fx.lightning.stun && Math.abs(fx.lightning.damage - 14) < 0.6 && Math.abs(fx.lightning.chainDamage - 8) < 0.6 && fx.lightning.chainStun, JSON.stringify(fx.lightning));
  check('force throws the target away', fx.forcePush > 2.5 && Math.abs(fx.forceDamage - 6) < 8.6, `pushed ${fx.forcePush.toFixed(1)} m`);
  check('sleep puts an enemy out without waking it', fx.sleeping && fx.sleptThrough);
  check('a sleeper dies to a dagger sneak attack', fx.sneakKilled);

  // 2. Noise: a fire bolt is heard 6 m away, a frost bolt is not.
  const noise = await page.evaluate(async () => {
    const out = {};
    for (const kind of ['frost', 'fire']) {
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'wand', base: 'wand', kind }); game.cb.stamina = 100;
      const ear = T.guard(-3, 'toward', false);   // behind you, looking away ear.update = Enemy.prototype.update;
      await T.sleep(300); game.cb.press = true; await T.sleep(1200);
      out[kind] = ear.aware >= 0.5 || ear.state !== 'unaware';
    }
    return out;
  });
  check('a frost wand is silent, a fire wand is heard', !noise.frost && noise.fire, JSON.stringify(noise));

  // 3. Force into a wall hurts more.
  const wall = await page.evaluate(async () => {
    const f = game.floor; let spot = null;
    for (let y = 2; y < f.h - 2 && !spot; y++) for (let x = 4; x < f.w - 2 && !spot; x++) {
      const open = (a, b) => f.tiles[b * f.w + a] === 1 && !f.blocked[b * f.w + a];
      if (open(x, y) && open(x - 1, y) && open(x - 2, y) && open(x - 3, y) && f.tiles[y * f.w + x + 1] === 0) spot = { x, y };
    }
    if (!spot) return null;
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'wand', base: 'wand', kind: 'force' }); game.cb.stamina = 100;
    const P = game.player; P.yaw = -Math.PI / 2; P.pitch = 0;
    const e = T.guard(2.3, 'toward', true); e.hp = e.maxHp = 500; e.update = function () { this.sync(0); return null; };
    e.x = (spot.x + 1) * TILE - 1.0; e.z = (spot.y + 0.5) * TILE; P.x = e.x - 2.3; P.z = e.z;     // the guard stands 1 m from the wall
    game.cb.press = true; await T.until(() => 500 - e.hp > 0, 4000); await T.sleep(200);
    return { damage: 500 - e.hp };
  });
  check('force into a wall adds damage', wall && wall.damage >= 12, wall ? wall.damage.toFixed(1) : 'no wall found');

  // 4. A wand breaks at 0 charges and the best weapon in the pack comes back; an empty pack gets a fallback.
  const brk = await page.evaluate(async () => {
    const out = {};
    T.reset(); game.inv.add({ type: 'weapon', base: 'mace', tier: 1 });
    const w = makeItem({ type: 'wand', base: 'wand', kind: 'frost' }); w.charges = 1; game.inv.equip.weapon = w; game.cb.stamina = 100;
    game.cb.press = true; await T.until(() => game.inv.equip.weapon.type !== 'wand', 4000);
    out.back = game.inv.equip.weapon.type === 'weapon' && game.inv.equip.weapon.base === 'mace'; out.packEmpty = game.inv.pack.every(i => i.type !== 'weapon');
    T.reset(); const w2 = makeItem({ type: 'wand', base: 'wand', kind: 'frost' }); w2.charges = 1; game.inv.equip.weapon = w2; game.cb.stamina = 100;
    game.cb.press = true; await T.until(() => game.inv.equip.weapon.type !== 'wand', 4000);
    out.fallback = game.inv.equip.weapon.type === 'weapon';
    return out;
  });
  check('a spent wand breaks and your weapon returns', brk.back && brk.packEmpty);
  check('with nothing in the pack you get a fallback weapon', brk.fallback);

  // 5. Recharge wands.
  const rc = await page.evaluate(async () => {
    const out = {};
    const rech = (full) => makeItem({ type: 'rechargewand', full });
    T.reset(); const w = makeItem({ type: 'wand', base: 'wand', kind: 'lightning' }); w.charges = 0; game.inv.equip.weapon = w;
    let r = rech(false); game.inv.pack.push(r); game.inv.assignQuick(0, r); out.msg1 = game.inv.use(0); out.plus3 = w.charges; out.used = !game.inv.pack.includes(r);
    w.charges = 3; r = rech(false); game.inv.pack.push(r); game.inv.assignQuick(0, r); game.inv.use(0); out.capped = w.charges;
    w.charges = 0; r = rech(true); game.inv.pack.push(r); game.inv.assignQuick(0, r); game.inv.use(0); out.full = w.charges;
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); r = rech(false); game.inv.pack.push(r); game.inv.assignQuick(0, r);
    out.msgNone = game.inv.use(0); out.keptNone = game.inv.pack.includes(r);
    T.reset(); const p = makeItem({ type: 'wand', base: 'wand', kind: 'fire' }); p.charges = 1; game.inv.pack.push(p);   // a wand in the pack is recharged when none is held
    r = rech(false); game.inv.pack.push(r); game.inv.assignQuick(0, r); game.inv.use(0); out.packWand = p.charges;
    return out;
  });
  check('a recharge wand restores 3 charges to an empty wand and is used up', rc.plus3 === 3 && rc.used, rc.msg1);
  check('recharging never goes over the maximum', rc.capped === 4, 'charges ' + rc.capped);
  check('the rare recharge refills fully', rc.full === 4);
  check('a recharge wand with no wand does nothing and is kept', rc.keptNone && /wand/i.test(rc.msgNone), rc.msgNone);
  check('it finds a wand in the pack when none is held', rc.packWand === 4, 'charges ' + rc.packWand);

  // 6. Hanahan's Rage: nearby enemies fight each other instead of the player, then calm down.
  const rage = await page.evaluate(async () => {
    const out = {};
    RAGE.dur = 4;                                                   // a short fight for the test
    T.reset(); game.inv.hp = 100;
    const rec = makeItem({ type: 'rage', charges: 2 }); game.inv.pack.push(rec); game.inv.assignQuick(0, rec);
    const A = T.guard(2.2, 'toward', true), B = T.guard(2.2, 'toward', true); B.x += 0.8; A.x -= 0.8; A.hp = A.maxHp = B.hp = B.maxHp = 500;
    const far = T.guard(25, 'away', false), boss = T.guard(4, 'toward', false); boss.boss = true;
    out.msg = game.inv.use(0); await T.until(() => A.rageT > 0 && B.rageT > 0, 3000);
    out.enraged = A.rageT > 0 && B.rageT > 0; out.bossImmune = !(boss.rageT > 0); out.farImmune = !(far.rageT > 0);
    out.charges = rec.charges;
    const hp0 = game.inv.hp;
    await T.until(() => A.hp < 500 || B.hp < 500, 40000); out.brawl = A.hp < 500 || B.hp < 500;
    out.playerSafe = game.inv.hp === hp0;
    await T.until(() => A.rageT <= 0 && B.rageT <= 0, 45000);   // guards advance at most 0.05 s per frame, so a slow machine needs real time
    out.calmed = A.rageT <= 0 && B.rageT <= 0;
    // second play breaks the recorder
    A.dead || (A.hp = 500); game.pst.clear(); game.cb.rageCd = 0;
    game.inv.use(0); await T.sleep(300); out.broke = !game.inv.pack.includes(rec);
    return out;
  });
  check('playing the recorder enrages nearby enemies', rage.enraged && /Hanahan|record/i.test(rage.msg), rage.msg);
  check('the boss and far away enemies are not enraged', rage.bossImmune && rage.farImmune);
  check('enraged enemies fight each other', rage.brawl);
  check('enraged enemies leave the player alone', rage.playerSafe);
  check('they calm down and come looking afterwards', rage.calmed);
  check('the recorder breaks after its last play', rage.broke);

  // 7. Wands and recorders turn up as loot.
  const loot = await page.evaluate(() => {
    const c = { wand: 0, recharge: 0, rage: 0, vaultWand: 0, vaultRage: 0 };
    for (let i = 1; i <= 2000; i++) {
      for (const d of rollLoot('chest', 3, makeRng(i))) { if (d.type === 'wand') c.wand++; if (d.type === 'rechargewand') c.recharge++; if (d.type === 'rage') c.rage++; }
      for (const d of rollLoot('vaultchest', 3, makeRng(i))) { if (d.type === 'wand') c.vaultWand++; if (d.type === 'rage') c.vaultRage++; }
    }
    return c;
  });
  check('chests hold the odd wand, vaults many more', loot.wand > 40 && loot.wand < 250 && loot.vaultWand > loot.wand, JSON.stringify(loot));
  check('recharge wands are rarer than wands', loot.recharge > 0 && loot.recharge < loot.wand, JSON.stringify(loot));
  check('Hanahan\'s Rage is rare', loot.vaultRage > 0 && loot.vaultRage < 200 && loot.rage < 60);
  await page.close();
});
