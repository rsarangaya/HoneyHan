// Core gameplay: floors, stairs, collision, combat basics, statuses
// Run on its own: node tests/game.core.test.js   (all of them in parallel: node tests/run-all.js)
const { run } = require('./lib');
run('Core gameplay: floors, stairs, collision, combat basics, statuses', async ({ open, check }) => {
    // 1. Every floor builds and runs for a moment, on a few seeds.
    for (const seed of [7, 12345, 424242]) {
      const page = await open(seed);
      const counts = await page.evaluate(async () => {
        const out = [];
        for (let n = 1; n <= 5; n++) { game.startFloor(n); await T.sleep(400); out.push(game.enemies.length); }
        return out;
      });
      check(`seed ${seed}: floors 1-5 build`, counts.length === 5 && counts.every(c => c > 0), `guards ${counts.join(',')}`);
      await page.close();
    }

    let page = await open(7);

    // 2. The stairwell leads to the next floor.
    const floorText = await page.evaluate(async () => {
      T.reset(); const f = game.floor, P = game.player;
      P.x = (f.stairs.x + 0.5) * TILE; P.z = (f.stairs.y + 0.5) * TILE + 1.1;
      await T.sleep(800);
      return document.getElementById('floor').textContent;
    });
    check('stairs lead to floor 2', /Floor 2 \//.test(floorText), floorText);

    // 3. A swarm of alerted guards spreads out round the player instead of stacking on one spot.
    const swarm = await page.evaluate(async () => {
      T.reset(); const P = game.player;
      for (let i = 0; i < 8; i++) { const e = T.guard(0.5 + (i % 3) * 0.3, 'toward', true); e.x += (i % 2) * 0.1; }
      game.inv.hp = 1e9;
      await T.until(() => game.enemies.filter(e => e.winding).length >= 3, 10000);   // the swarm has closed in and is swinging
      await T.sleep(500);
      const L = game.enemies; let pair = 99, toPlayer = 99;
      for (let i = 0; i < L.length; i++) {
        toPlayer = Math.min(toPlayer, Math.hypot(L[i].x - P.x, L[i].z - P.z));
        for (let j = i + 1; j < L.length; j++) pair = Math.min(pair, Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z));
      }
      return { pair, toPlayer };
    });
    check('guards keep apart', swarm.pair >= 0.6, `closest pair ${swarm.pair.toFixed(2)} m`);
    check('guards stay out of the player', swarm.toPlayer >= 0.7, `closest ${swarm.toPlayer.toFixed(2)} m`);

    // 4. Walking into an idle guard does not pass through it.
    const walk = await page.evaluate(async () => {
      T.reset(); const P = game.player, e = T.guard(2.5, 'away', false);
      e.update = function () { this.sync(0); return null; };                  // a statue-still guard for this check
      const ex = e.x, ez = e.z, sx = P.x, sz = P.z;
      let gap = 99, held = 0;
      P.keys[KEYS.forward] = true;
      await T.until(() => {                                   // walk at it for a good while, recording the closest approach
        gap = Math.min(gap, Math.hypot(e.x - P.x, e.z - P.z));
        held += 1;
        return Math.hypot(P.x - sx, P.z - sz) > 4 || held > 400;
      }, 15000);
      P.keys[KEYS.forward] = false;
      return { gap, moved: Math.hypot(e.x - ex, e.z - ez) };
    });
    check('player cannot walk through a guard', walk.gap >= 0.7 && walk.moved < 0.3, `gap ${walk.gap.toFixed(2)} m, guard pushed ${walk.moved.toFixed(2)} m`);

    // 5. A dagger from behind kills an unaware guard outright.
    const sneak = await page.evaluate(async () => {
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'dagger', tier: 0 });
      const e = T.guard(1.4, 'away', false);
      await T.sleep(150); game.cb.press = true;
      await T.until(() => e.dead, 5000);
      return { dead: e.dead, hp: e.hp };
    });
    check('dagger sneak kill', sneak.dead, `guard hp ${Math.round(sneak.hp)}`);

    // 6. Raising the sword just before a guard's strike lands parries it: no damage, guard staggered.
    const parry = await page.evaluate(async () => {
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      const e = T.guard(1.3, 'toward', true);
      // Perfect timing regardless of frame rate: once the guard winds up, hold block and keep the
      // block fresh (blockT 0) right before each guard update, so the strike lands inside the parry window.
      const update = e.update;
      e.update = function (...a) {
        if (this.winding) { this.zone = 'body'; game.cb.want = true; if (game.cb.block) game.cb.blockT = 0; }
        return update.apply(this, a);
      };
      game.cb.stamina = 40; game.cb.delay = 999;   // freeze regeneration so only the parry can raise stamina
      const staggered = await T.until(() => e.stun > 0.5, 15000);
      game.cb.want = false;
      return { staggered, hp: game.inv.hp, stam: game.cb.stamina };
    });
    check('sword parry staggers the guard', parry.staggered && parry.hp === 100, `hp ${parry.hp}`);
    check('a parry gives stamina back', Math.abs(parry.stam - (40 + 30)) < 0.01, `stamina ${parry.stam}`);

    // 7. Running out of HP ends the run with the death screen.
    const death = await page.evaluate(async () => {
      T.reset(); game.inv.hp = 1; T.guard(1.3, 'toward', true);
      await T.until(() => game.state === 'dead', 15000);
      return { state: game.state, text: document.getElementById('overlayText').innerText };
    });
    check('death ends the run', death.state === 'dead' && /You died/.test(death.text), death.state);

    // ---- statuses (a fresh page: the death test above leaves the game stopped) ----
    await page.close(); page = await open(7);
    // 8. Weapon passives: a mace head hit stuns, a sword leg hit cripples, a dagger body hit bleeds.
    const procs = await page.evaluate(async () => {
      const out = {};
      const swing = async (base, pitch, status) => {
        T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base, tier: 0 });
        const e = T.guard(1.2, 'toward', true); e.hp = e.maxHp = 500;
        game.player.pitch = pitch; Math.random = () => 0; gameRng = () => 0;       // chance rolls always succeed
        await T.sleep(100); game.cb.press = true;
        const got = await T.until(() => e.st.has(status), 4000);
        return { got, hp: e.hp, e };
      };
      out.mace = (await swing('mace', 0, 'stun')).got;
      const sw = await swing('sword', -0.95, 'cripple'); out.sword = sw.got;
      const dg = await swing('dagger', -0.3, 'bleed'); out.dagger = dg.got;
      const hp0 = dg.e.hp; await T.sleep(1500); out.bleedLoss = hp0 - dg.e.hp;
      return out;
    });
    check('mace head hit stuns', procs.mace);
    check('sword leg hit cripples', procs.sword);
    check('dagger body hit bleeds', procs.dagger);
    check('bleed drains health over time', procs.bleedLoss > 1, procs.bleedLoss.toFixed(1) + ' HP in 1.5 s');

    // 9. A slowed or crippled guard moves slower; a guard that bleeds to death leaves a body.
    const move = await page.evaluate(async () => {
      T.reset(); game.inv.hp = 1e9;
      const run = async (status) => {
        const e = T.guard(5, 'toward', false); e.update = Enemy.prototype.update;
        e.route = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
        if (status) e.st.apply(status, 30);
        const x0 = e.x, z0 = e.z; e.last = { x: game.player.x, z: game.player.z };
        const t0 = performance.now(); let walked = 0;
        const px = e.x, pz = e.z;
        for (let i = 0; i < 30; i++) { e.goTo(game.player.x - Math.sin(game.player.yaw) * 20, game.player.z - Math.cos(game.player.yaw) * 20, 4, 0.05); }
        return Math.hypot(e.x - px, e.z - pz);
      };
      const normal = await run(null), slow = await run('slow'), crip = await run('cripple');
      T.reset();
      const e = T.guard(3, 'away', false); e.hp = 2; e.addStatus('bleed', 10);
      await T.until(() => e.dead, 5000); await T.sleep(100);
      return { normal, slow, crip, dead: e.dead, body: e.corpseDone };
    });
    check('slow moves a guard slower', move.slow < move.normal * 0.85, `${move.slow.toFixed(2)} vs ${move.normal.toFixed(2)} m`);
    check('cripple nearly stops a guard', move.crip < move.normal * 0.4, `${move.crip.toFixed(2)} m`);
    check('a guard can bleed to death and leaves a body', move.dead && move.body);

    // 10. Hits on the player: a leg hit slows, a head hit dazes, a dagger body hit bleeds, a stun locks out attacking.
    const hurt = await page.evaluate(async () => {
      const out = {};
      const take = async (zone, kind) => {
        T.reset(); game.inv.hp = 1e9;
        const e = T.guard(1.3, 'toward', true); if (kind) e.weaponKind = kind;
        const upd = e.update; e.update = function (...a) { if (this.winding) this.zone = zone; return upd.apply(this, a); };
        const names = zone === 'legs' ? 'slow' : zone === 'head' ? 'daze' : 'bleed';
        return await T.until(() => game.pst.has(names), 8000);
      };
      out.slow = await take('legs'); await T.sleep(150); out.mulSlow = game.player.speedMul;
      out.daze = await take('head');
      out.bleed = await take('body', 'dagger');
      T.reset(); game.pst.apply('stun', 5); game.cb.press = true; await T.sleep(300);
      out.stunSwing = !!game.cb.atk;
      T.reset(); game.inv.hp = 50; game.pst.apply('bleed', 30); await T.sleep(2500);
      out.hpAfterBleed = game.inv.hp;
      game.inv.hp = 1; await T.sleep(1500); out.floor = game.inv.hp;
      T.reset(); game.inv.hp = 50; game.pst.apply('bleed', 30);
      game.inv.pack.push(makeItem({ type: 'potion', kind: 'heal', n: 1 })); game.inv.drink(game.inv.pack[game.inv.pack.length - 1]);
      out.cured = !game.pst.has('bleed');
      return out;
    });
    check('a leg hit slows the player', hurt.slow && hurt.mulSlow < 1, 'speed x' + (hurt.mulSlow || 0).toFixed(2));
    check('a head hit dazes the player', hurt.daze);
    check('a dagger body hit makes the player bleed', hurt.bleed);
    check('a stunned player cannot swing', !hurt.stunSwing);
    check('bleeding costs HP but never kills', hurt.hpAfterBleed < 50 && hurt.floor >= 1, `hp ${hurt.hpAfterBleed.toFixed(1)}, floor ${hurt.floor}`);
    check('a healing potion stops bleeding', hurt.cured);


    // 11. Low guard: blocking with the view tipped down covers the legs (not head/body); level, legs go under the block.
    const lowg = await page.evaluate(async () => {
      const run = async (zone, pitch) => {
        T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.hp = 1e9; game.player.pitch = pitch;
        const e = T.guard(1.3, 'toward', true); const hp0 = game.inv.hp; let landed = false, struck = false;
        const upd = e.update; e.update = function (...a) { game.player.pitch = pitch; if (this.winding) { this.zone = zone; game.cb.want = true; if (game.cb.block) game.cb.blockT = 1; } const r = upd.apply(this, a); if (r) struck = true; return r; };
        await T.until(() => game.inv.hp < hp0 || struck, 8000); await T.sleep(100);
        return game.inv.hp < hp0;
      };
      const o = {};
      o.lowLegs = await run('legs', -0.8); o.levelLegs = await run('legs', 0); o.lowBody = await run('body', -0.8); o.levelBody = await run('body', 0);
      return o;
    });
    check('low guard blocks a leg hit', !lowg.lowLegs);
    check('level guard lets a leg hit land', lowg.levelLegs);
    check('low guard lets a body hit land', lowg.lowBody);
    check('level guard blocks a body hit', !lowg.levelBody);

    await page.close();
});
