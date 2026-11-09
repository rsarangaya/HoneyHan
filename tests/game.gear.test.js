// Bow, shield and other gear
// Run on its own: node tests/game.gear.test.js   (all of them in parallel: node tests/run-all.js)
const { run } = require('./lib');
run('Bow, shield and other gear', async ({ open, check }) => {
    let page = await open(7);
    // ---- bow and shield ----
    // 20. The bow: draw and release fires one arrow, an early release does nothing, headshots and sneak shots hit hard,
    //     leg shots slow, arrows can be picked up again, no arrows means no shot.
    const bow = await page.evaluate(async () => {
      const out = {};
      const pitchFor = (d, y) => { const dist = d - 0.5, t = dist / BOW.speedMax; return Math.atan((y - (eyeY() - 0.1) + 0.5 * BOW.gravity * t * t) / dist); };
      const shoot = async (d, y, hold = 1.0) => {
        T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 5;
        const e = T.guard(d, 'away', false); e.hp = e.maxHp = 500; e.resist = { head: 1, body: 1, legs: 1 };
        game.player.pitch = pitchFor(d, y); await T.sleep(150);
        game.player.keys[KEYS.attack] = true; game.cb.press = true;
        await T.until(() => !!game.cb.draw, 2000);
        await T.until(() => game.cb.draw && game.cb.draw.t >= hold, 4000);
        game.player.keys[KEYS.attack] = false;
        await T.until(() => e.hp < 500 || game.arrows.some(a => a.stuck), 4000); await T.sleep(100);
        return e;
      };
      let e = await shoot(8, 1.65);                                  // a sneak headshot
      out.headDamage = 500 - e.hp; out.arrowsLeft = game.inv.arrows;
      e = await shoot(8, 1.0); out.bodyDamage = 500 - e.hp;
      e = await shoot(5, 0.4); out.legSlow = e.st.has('slow');
      // an early release does nothing
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 5;
      game.player.keys[KEYS.attack] = true; game.cb.press = true; await T.until(() => !!game.cb.draw, 2000);
      game.cb.draw.t = -5; game.player.keys[KEYS.attack] = false; await T.sleep(500);
      out.earlyArrows = game.inv.arrows; out.earlyFlying = game.arrows.length;
      // no arrows
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 0;
      game.player.keys[KEYS.attack] = true; game.cb.press = true; await T.sleep(400); game.player.keys[KEYS.attack] = false;
      out.noArrowsDraw = !!game.cb.draw;
      // pick an arrow back up (the recovery roll is pinned to succeed)
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.arrows = 5; Math.random = () => 0;
      game.player.keys[KEYS.attack] = true; game.cb.press = true; await T.until(() => game.cb.draw && game.cb.draw.t > 0.9, 4000); game.player.keys[KEYS.attack] = false;
      await T.until(() => game.arrows.some(a => a.stuck), 5000);
      const st = game.arrows.find(a => a.stuck); out.stuck = !!st; const before = game.inv.arrows;
      if (st) { game.player.x = st.x; game.player.z = st.z; await T.until(() => game.inv.arrows > before, 3000); }
      out.recovered = game.inv.arrows - before; out.gone = !game.arrows.includes(st);
      return out;
    });
    check('a sneak headshot with a bow is a big hit', bow.headDamage > 40, bow.headDamage.toFixed(0) + ' damage');
    check('a full draw uses exactly one arrow', bow.arrowsLeft === 4, 'left ' + bow.arrowsLeft);
    check('a sneak body shot hits for less than a headshot', bow.bodyDamage > 15 && bow.bodyDamage < bow.headDamage, bow.bodyDamage.toFixed(0) + ' damage');
    check('a leg shot slows the target', bow.legSlow);
    check('releasing too early fires nothing', bow.earlyArrows === 5 && bow.earlyFlying === 0);
    check('no arrows, no draw', !bow.noArrowsDraw);
    check('a stuck arrow can be picked up again', bow.stuck && bow.recovered === 1 && bow.gone);

    // 21. The shield: a dagger can block with it, leg sweeps are mostly covered and do not slow, a bash stuns and shoves.
    const shl = await page.evaluate(async () => {
      const out = {};
      const duel = async (weapon, withShield, zone) => {
        T.reset(); game.inv.hp = 100; game.inv.equip.weapon = makeItem({ type: 'weapon', base: weapon, tier: 0 });
        game.inv.equip.offhand = withShield ? makeItem({ type: 'shield', tier: 0 }) : null;
        const e = T.guard(1.3, 'toward', true); e.weaponKind = 'sword';
        const upd = e.update; let landed = false;
        e.update = function (...a) { if (this.winding) { this.zone = zone; game.cb.want = true; if (game.cb.block) game.cb.blockT = 1; } const r = upd.apply(this, a); if (r) landed = true; return r; };
        await T.until(() => landed, 8000); await T.sleep(200);
        game.cb.want = false;
        return { hp: game.inv.hp, stam: game.cb.stamina, slow: game.pst.has('slow') };
      };
      out.noShield = await duel('dagger', false, 'body');
      out.shielded = await duel('dagger', true, 'body');
      out.legsNo = await duel('sword', false, 'legs');
      out.legsShield = await duel('sword', true, 'legs');
      // bash
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.equip.offhand = makeItem({ type: 'shield', tier: 0 });
      const e = T.guard(1.3, 'toward', true); e.hp = e.maxHp = 500; e.update = function () { this.sync(0); return null; };
      const x0 = Math.hypot(e.x - game.player.x, e.z - game.player.z);
      game.cb.want = true; await T.until(() => game.cb.block, 3000); const s0 = game.cb.stamina;
      game.cb.press = true; await T.until(() => e.st.has('stun') || game.cb.bashCd > 0, 3000); await T.sleep(100);
      out.bash = { stun: e.st.has('stun'), push: Math.hypot(e.x - game.player.x, e.z - game.player.z) - x0, hurt: 500 - e.hp, cd: game.cb.bashCd > 0, stam: s0 - game.cb.stamina };
      game.cb.bashCd = 5; game.cb.stamina = 50; game.cb.press = true; await T.sleep(300); out.bashCdHolds = game.cb.stamina >= 49;   // on cooldown: no second bash, so no 15 stamina spent
      game.cb.want = false;
      // a bow stows the shield
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'bow', tier: 0 }); game.inv.equip.offhand = makeItem({ type: 'shield', tier: 0 });
      out.stowed = shield() === null && !game.cb.draw;
      return out;
    });
    check('a dagger cannot block alone but can with a shield', shl.noShield.hp < 100 && shl.shielded.hp === 100, `hp ${shl.noShield.hp.toFixed(0)} vs ${shl.shielded.hp.toFixed(0)}`);
    check('a shield block costs stamina', shl.shielded.stam < 95, 'stamina ' + shl.shielded.stam.toFixed(0));
    check('a plain leg sweep hurts and slows', shl.legsNo.hp < 96 && shl.legsNo.slow, `hp ${shl.legsNo.hp.toFixed(1)}`);
    check('a shield covers most of a leg sweep, with no slow', shl.legsShield.hp > shl.legsNo.hp + 2 && shl.legsShield.hp < 100 && !shl.legsShield.slow, `hp ${shl.legsShield.hp.toFixed(1)}`);
    check('a shield bash stuns and shoves', shl.bash.stun && shl.bash.push > 0.5 && shl.bash.hurt > 0 && shl.bash.cd, `pushed ${shl.bash.push.toFixed(2)} m, stamina ${shl.bash.stam.toFixed(0)}`);
    check('bash has a cooldown', shl.bashCdHolds);
    check('the bow stows the shield', shl.stowed);

    // 22. Loot: bows and shields turn up.
    const loot = await page.evaluate(() => {
      const c = { bow: 0, shield: 0, other: 0 };
      for (let i = 1; i <= 600; i++) { const d = rollEquipment(2, makeRng(i), {}); if (d.type === 'shield') c.shield++; else if (d.type === 'weapon' && d.base === 'bow') c.bow++; else c.other++; }
      return c;
    });
    check('bows and shields drop as loot', loot.bow > 15 && loot.shield > 15, JSON.stringify(loot));

    await page.close();
});
