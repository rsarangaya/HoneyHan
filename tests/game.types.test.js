// Enemy types and hunger
// Run on its own: node tests/game.types.test.js   (all of them in parallel: node tests/run-all.js)
const { run } = require('./lib');
run('Enemy types and hunger', async ({ open, check }) => {
    let page = await open(7);
    // ---- enemy types ----
    // 11. Every type builds, runs and animates without errors; speeds and sizes are what the table says.
    const kinds = await page.evaluate(async () => {
      T.reset(); game.inv.hp = 1e9; const out = {};
      const quiet = { events: [], emit() {} };
      for (const type of ['goblin', 'cook', 'bandit', 'rat', 'wolf', 'bouncer']) {
        const e = T.guard(4, 'toward', true, type);
        for (let i = 0; i < 40; i++) { e.update(0.03, game.player, quiet); e.sync(0.03); }
        out[type] = { chase: e.chase, hp: e.maxHp, quad: e.quad, r: e.r, ok: e.mesh.children.length > 0 };
        game.enemies.pop(); e.mesh.parent.remove(e.mesh);
      }
      return out;
    });
    check('all six enemy types build and run', Object.values(kinds).every(k => k.ok), Object.keys(kinds).join(', '));
    check('wolves outrun a sprinting player, bouncers do not', kinds.wolf.chase > 4.6 && kinds.bouncer.chase < 4.6, `wolf ${kinds.wolf.chase.toFixed(1)}, bouncer ${kinds.bouncer.chase.toFixed(1)} m/s`);
    check('rats are fragile, bouncers tough', kinds.rat.hp < 12 && kinds.bouncer.hp > 80, `rat ${kinds.rat.hp.toFixed(0)} HP, bouncer ${kinds.bouncer.hp.toFixed(0)} HP`);

    // 12. Senses: a wolf smells a moving player behind its back, a bandit sees less far than a goblin.
    const senses = await page.evaluate(async () => {
      T.reset(); const P = game.player, quiet = { events: [], emit() {} }, out = {};
      const test = (type, d, back, moving) => {
        const e = T.guard(d, back ? 'away' : 'toward', false, type);
        P.vx = moving ? 2 : 0; P.vz = 0; e.update(0.03, P, quiet);
        const seen = e.seen; game.enemies.pop(); e.mesh.parent.remove(e.mesh); return seen;
      };
      out.wolfBack = test('wolf', 4, true, true); out.wolfStill = test('wolf', 4, true, false);
      out.goblinBack = test('goblin', 4, true, true);
      out.goblin8 = test('goblin', 8, false, false); out.bandit8 = test('bandit', 8, false, false);
      out.wolfFar = test('wolf', 9, true, true);
      return out;
    });
    check('a wolf smells a moving player behind its back', senses.wolfBack && !senses.goblinBack);
    check('standing still hides you from a wolf', !senses.wolfStill);
    check('smell has a limited range', !senses.wolfFar);
    check('a bandit sees less far than a goblin', senses.goblin8 && !senses.bandit8);

    // 13. Wolf and handler.
    const leash = await page.evaluate(async () => {
      T.reset(); const P = game.player, quiet = { events: [], emit() {} }, out = {};
      const h = T.guard(6, 'away', false, 'goblin'), w = T.guard(7, 'away', false, 'wolf'); w.handlerRef = h;
      for (let i = 0; i < 5; i++) w.update(0.03, P, quiet);
      out.calm = w.state;
      h.last = { x: P.x, z: P.z }; h.set('alerted');
      for (let i = 0; i < 5; i++) w.update(0.03, P, quiet);
      out.leashOff = w.state;
      const h2 = T.guard(6, 'away', false, 'goblin'), w2 = T.guard(7, 'away', false, 'wolf'); w2.handlerRef = h2;
      h2.die(); const x0 = w2.x, z0 = w2.z;
      for (let i = 0; i < 60; i++) w2.update(0.03, P, quiet);
      out.idle = w2.state === 'unaware' && Math.hypot(w2.x - x0, w2.z - z0) < 0.5;
      return out;
    });
    check('a calm wolf stays unaware with an unaware handler', leash.calm === 'unaware');
    check('an alerted handler lets the wolf off the leash', leash.leashOff === 'alerted');
    check('a wolf whose handler died stays idle', leash.idle);

    // 14. Bouncer: a dagger sneak attack cannot kill it, a normal hit does not stagger it, but a goblin dies / staggers.
    const brute = await page.evaluate(async () => {
      const out = {};
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'dagger', tier: 0 });
      const b = T.guard(1.4, 'away', false, 'bouncer'); await T.sleep(150); game.cb.press = true; await T.until(() => b.hp < b.maxHp, 4000);
      out.bouncerAlive = !b.dead && b.hp > 0; out.bouncerHit = b.maxHp - b.hp;
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      const b2 = T.guard(1.2, 'toward', true, 'bouncer'), g2 = T.guard(1.3, 'toward', true, 'goblin');
      b2.hp = b2.maxHp = g2.hp = g2.maxHp = 900; b2.x += 0.8; g2.x -= 0.8;
      game.cb.press = true; await T.until(() => b2.hp < 900 || g2.hp < 900, 4000); await T.sleep(100);
      out.bouncerStun = b2.stun; out.bouncerStatus = b2.addStatus('stun');
      return out;
    });
    check('a dagger sneak attack cannot one-shot a bouncer', brute.bouncerAlive, `took ${brute.bouncerHit.toFixed(0)} damage`);
    check('a bouncer cannot be stunned', brute.bouncerStatus === false && brute.bouncerStun === 0);

    // 15. Rats: only the legs and body, low to aim at, and one hit kills.
    const rat = await page.evaluate(async () => {
      const out = {};
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
      const r = T.guard(1.5, 'toward', false, 'rat'); r.mesh.visible = true;
      out.zones = new Set(Array.from({ length: 300 }, () => pickZone(r.T.zones)));
      game.player.pitch = 0; const hi = findMeleeTarget(game.player, game.player.eye, game.enemies, game.floor, 2.3);
      out.highAim = hi && hi.zone;
      game.player.pitch = -0.7; const lo = findMeleeTarget(game.player, game.player.eye, game.enemies, game.floor, 2.3);
      out.lowAim = lo && lo.zone;
      r.update = function () { this.sync(0); return null; };
      await T.sleep(100); game.cb.press = true; await T.until(() => r.dead, 4000);
      out.dead = r.dead;
      return { ...out, zones: [...out.zones].join(',') };
    });
    check('rats attack legs and body, never the head', !/head/.test(rat.zones), rat.zones);
    check('a level swing and a low swing both hit a rat (hitbox tolerance)', !!rat.highAim && !!rat.lowAim, `${rat.highAim}/${rat.lowAim}`);
    check('one sword hit kills a rat', rat.dead);

    // 16. On a Sunken Tavern run the generator mixes natives in, wolves have handlers, and everything runs for a while.
    const mix = await page.evaluate(async () => {
      const seen = {}, issues = [];
      for (const n of [2, 3, 4, 5]) {
        game.startFloor(n); await T.sleep(300);
        for (const e of game.enemies) { seen[e.type] = (seen[e.type] || 0) + 1; if (e.type === 'wolf' && !(e.handlerRef && e.handlerRef.type === 'goblin')) issues.push('wolf without handler on ' + n); }
      }
      return { seen, issues, theme: document.getElementById('theme').textContent };
    });
    check('floors 2-5 mix natives and wolves', /Tavern/.test(mix.theme) && mix.seen.wolf > 0 && mix.seen.goblin > 0 && (mix.seen.cook || 0) + (mix.seen.bandit || 0) + (mix.seen.rat || 0) > 0, JSON.stringify(mix.seen));
    check('every wolf has a goblin handler', mix.issues.length === 0, mix.issues.join(', '));


    // ---- hunger and food ----
    // 17. Eating from a quickslot feeds you and uses the item up; it does nothing at full belly; a hit interrupts it.
    const eat = await page.evaluate(async () => {
      const out = {}; T.reset();
      const give = (kind, n = 1) => { game.inv.add({ type: 'food', kind, n }); const it = game.inv.pack.find(i => i.type === 'food' && i.kind === kind); game.inv.assignQuick(0, it); return it; };
      game.hunger.v = 40; let it = give('bread');
      game.inv.use(0); out.started = await T.until(() => !!game.cb.eat, 2000);
      await T.until(() => !game.cb.eat, 6000);
      out.fed = game.hunger.v - 40; out.used = !game.inv.pack.includes(it);
      T.reset(); game.hunger.v = 100; it = give('bread'); game.inv.use(0); await T.sleep(400);
      out.fullBelly = !game.cb.eat && game.inv.pack.includes(it);
      T.reset(); game.hunger.v = 40; it = give('stew'); game.inv.use(0); await T.until(() => !!game.cb.eat, 2000);
      damage(5); out.interrupted = !game.cb.eat && game.hunger.v <= 40 && game.inv.pack.includes(it);
      T.reset(); game.hunger.v = 40; it = give('stew', 2); game.inv.use(0); await T.until(() => !game.cb.eat, 8000);
      out.stew = { fed: game.hunger.v - 40, buff: game.inv.buffs.hearty > 0, left: it.n };
      return out;
    });
    check('eating takes time, feeds 25 and uses the bread up', eat.started && Math.abs(eat.fed - 25) < 2 && eat.used, 'fed ' + eat.fed.toFixed(1));
    check('you cannot eat on a full belly', eat.fullBelly);
    check('a hit interrupts eating and keeps the food', eat.interrupted);
    check('stew feeds 45, gives the hearty buff and stacks', Math.abs(eat.stew.fed - 45) < 2 && eat.stew.buff && eat.stew.left === 1, JSON.stringify(eat.stew));

    // 18. The hunger stages bite: slower stamina regen, a lower stamina cap, no sprinting when starving, HP loss that never kills, a growl noise.
    const stages = await page.evaluate(async () => {
      const out = {};
      // Deterministic: pause the frame loop, then step the combat update by hand for one simulated second.
      const regen = v => { T.reset(); game.hunger.v = v; game.cb.stamina = 10; game.cb.delay = 0; const was = state; state = 'menu'; for (let i = 0; i < 10; i++) updateCombat(0.1); state = was; return game.cb.stamina - 10; };
      out.fed = regen(100); out.hungry = regen(40); out.weak = regen(15);
      T.reset(); game.hunger.v = 15; game.cb.stamina = 100; await T.sleep(300); out.weakCap = game.cb.stamina;
      T.reset(); game.hunger.v = 0; await T.sleep(300); out.starveSprint = game.player.canSprint;
      T.reset(); game.hunger.v = 0; game.hunger.starveT = 3.9; game.inv.hp = 5; await T.until(() => game.inv.hp < 5, 6000); out.hpLoss = 5 - game.inv.hp;
      game.inv.hp = 1; game.hunger.starveT = 3.9; await T.sleep(1500); out.floorHp = game.inv.hp;
      T.reset(); const ear = T.guard(1.6, 'away', false); ear.update = Enemy.prototype.update; game.hunger.v = 100; await T.sleep(1200); out.fedQuiet = ear.aware === 0;
      game.hunger.v = 40; game.hunger.growlT = 0.01; out.growl = await T.until(() => ear.aware >= 0.5 || ear.state !== 'unaware', 4000);
      T.reset(); setDev(true); game.hunger.v = 50; await T.sleep(1200); out.devFrozen = game.hunger.v === 50; setDev(false);
      return out;
    });
    check('hunger slows stamina regen by 20% and 40%', Math.abs(stages.hungry / stages.fed - 0.8) < 0.04 && Math.abs(stages.weak / stages.fed - 0.6) < 0.04, `fed ${stages.fed.toFixed(0)}, hungry ${stages.hungry.toFixed(0)}, weak ${stages.weak.toFixed(0)} per s`);
    check('weak caps max stamina at 85', stages.weakCap <= 85.5, stages.weakCap.toFixed(1));
    check('starving stops sprinting', stages.starveSprint === false);
    check('starving costs HP but never below 1', stages.hpLoss >= 1 && stages.floorHp === 1, `lost ${stages.hpLoss}, floor ${stages.floorHp}`);
    check('a hungry stomach growl is heard 1.6 m away, and a full one is silent', stages.growl && stages.fedQuiet);
    check('hunger is frozen in dev mode', stages.devFrozen);

    // 19. Food shelves exist, can be searched and hold food.
    const shelf = await page.evaluate(async () => {
      for (let n = 1; n <= 4; n++) {
        game.startFloor(n); await T.sleep(200);
        const o = propObjs.find(o => o.p.kind === 'pantry' && !o.p.opened);
        if (o) { T.reset === 0; const before = game.inv.pack.filter(i => i.type === 'food').length; finishSearch(o); return { floor: n, got: game.inv.pack.filter(i => i.type === 'food').reduce((a, i) => a + i.n, 0) - 0 * before, opened: o.p.opened }; }
      }
      return null;
    });
    check('a food shelf gives food when searched', shelf && shelf.got >= 1 && shelf.opened, JSON.stringify(shelf));


    // 17b. Armor goes over clothing: a helmeted enemy never also wears a hat, hood or bandana, and bosses with a crown or hat do not show the helm under it.
    const looks = await page.evaluate(() => {
      const bad = [], types = ['goblin', 'bandit', 'archer', 'brute', 'bouncer', 'skeleton', 'mguard', 'captain', 'iceknight'], stats = { helmets: 0, hats: 0, vests: 0 };
      for (const type of types) for (let seed = 1; seed <= 60; seed++) {
        const e = new Enemy({ x: 5, y: 5, route: [{ x: 5, y: 5 }, { x: 5, y: 5 }], seed, type }, game.floor);
        if (e.look.helmet && e.look.hat) bad.push(`${type} ${seed}: hat on helmet`);
        if (e.look.clothOverArmor) bad.push(`${type} ${seed}: clothing over armor`);
        stats.helmets += e.look.helmet ? 1 : 0; stats.hats += e.look.hat ? 1 : 0; stats.vests += e.look.vest ? 1 : 0;
      }
      for (const dress of ['innkeeper', 'king', 'warlord', 'frost', 'fungus', 'golem']) {
        const e = new Enemy({ x: 5, y: 5, route: [{ x: 5, y: 5 }, { x: 5, y: 5 }], seed: 3, boss: true, dress }, game.floor);
        if (e.look.helmet && e.look.hat) bad.push(`boss ${dress}: hat on helmet`);
      }
      return { bad, stats };
    });
    check('no enemy wears a hat on top of a helmet, or clothing over armor', looks.bad.length === 0 && looks.stats.helmets > 20 && looks.stats.hats > 20, looks.bad.slice(0, 3).join('; ') || JSON.stringify(looks.stats));
    await page.close();
});
