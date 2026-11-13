// The other five themes: their natives and gimmicks. Run on its own: node tests/game.themes.test.js
const { run } = require('./lib');
run('The five other themes', async ({ open, check }) => {
  // find a seed for each theme (the theme is picked from the seed)
  let page = await open(7);
  const seeds = await page.evaluate(() => { const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < THEMES.length; s++) { const n = makeRng(s).pick(THEMES).name; if (!out[n]) out[n] = s; } return out; });
  await page.close();
  const ORCH = 'The Moonlit Orchard', LIB = 'The Clockwork Library', CELL = 'The Mushroom Cellar', MARK = 'The Goblin Market', CHAP = 'The Frozen Chapel';
  check('every theme can be reached from some seed (seven themes with the Jungle)', Object.keys(seeds).length === 7, Object.keys(seeds).length + ' themes');

  // ---------- natives ----------
  page = await open(seeds[ORCH]);
  const orch = await page.evaluate(async () => {
    const out = {}, quiet = { events: [], emit() {}, shoot() {} };
    T.reset(); game.inv.hp = 1e9;
    // scarecrow: scenery until you are within 4 m, easy to sneak-kill while dormant
    const d = Math.min(7, T.reset() - 0.5);
    let sc = T.guard(d, 'toward', false, 'scarecrow'); out.dormant = sc.dormant;
    for (let i = 0; i < 10; i++) sc.update(0.03, game.player, quiet);
    out.stillAsleep = sc.dormant && sc.state === 'unaware';
    game.player.x -= Math.sin(game.player.yaw) * (d - 3); game.player.z -= Math.cos(game.player.yaw) * (d - 3);
    for (let i = 0; i < 10; i++) sc.update(0.03, game.player, quiet);
    out.woke = !sc.dormant && sc.state === 'alerted';
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'dagger', tier: 0 });
    sc = T.guard(1.9, 'toward', false, 'scarecrow'); game.player.keys[KEYS.crouch] = true; await T.sleep(400); game.cb.press = true; await T.until(() => sc.dead, 3000); game.player.keys[KEYS.crouch] = false;
    out.sneakKilled = sc.dead;
    // warden: thorns make you bleed
    T.reset(); game.inv.hp = 1e9; game.cb.stamina = 100;
    const w = T.guard(Math.min(7, T.reset() - 0.5), 'toward', true, 'warden'); w.hp = w.maxHp = 900;
    out.bleed = await T.until(() => game.pst.has('bleed'), 25000);
    return out;
  });
  check('a dormant scarecrow stands still until you are within 4 m, then wakes', orch.dormant && orch.stillAsleep && orch.woke);
  check('a crouching player can dagger-kill a dormant scarecrow before it wakes', orch.sneakKilled);
  check('an Orchard warden\'s thorns make you bleed', orch.bleed);
  await page.close();

  page = await open(seeds[LIB]);
  const lib = await page.evaluate(async () => {
    const out = {}, quiet = { events: [], emit() {}, shoot() {} };
    T.reset(); game.inv.hp = 1e9;
    // a book hears footsteps from 2.5x as far; a goblin does not
    const hear = (type, d, r) => { const e = T.guard(d, 'away', false, type); e.update(0.03, game.player, { events: [{ x: game.player.x, z: game.player.z, r }], emit() {}, shoot() {} }); const h = e.aware >= 0.5; game.enemies.pop(); e.mesh.parent.remove(e.mesh); return h; };
    out.book = hear('book', 7, 3); out.goblin = hear('goblin', 7, 3);
    // golem stats
    const g = T.guard(5, 'toward', false, 'golem'); out.golem = { hp: g.maxHp, chase: g.chase, reach: g.reach, noStagger: g.T.noStagger };
    // a book floats: aiming at the floor misses, aiming level hits
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    const b = T.guard(1.5, 'toward', false, 'book'); b.mesh.visible = true;
    game.player.pitch = 0; const hi = findMeleeTarget(game.player, game.player.eye, game.enemies, game.floor, 2.3); out.bookAimed = !!(hi && hi.zone);
    // scholar: hexes
    T.reset(); game.inv.hp = 1e9; const sc = T.guard(Math.min(7, T.reset() - 0.5), 'toward', true, 'scholar'); sc.hp = sc.maxHp = 900;
    out.hexed = await T.until(() => game.pst.has('slow') || game.pst.has('daze'), 25000);
    // the library hush: your noise carries 40% farther
    out.hush = HUSH;
    return out;
  });
  check('a book hears footsteps from far off, a goblin does not', lib.book && !lib.goblin);
  check('a stone golem is slow, huge-reaching and cannot be staggered', lib.golem.hp > 90 && lib.golem.chase < 3.5 && lib.golem.reach > 2 && lib.golem.noStagger, JSON.stringify(lib.golem));
  check('a floating book is hit by a level swing', lib.bookAimed);
  check('a scholar hexes you', lib.hexed);
  check('the Library\'s hush makes noise carry 40% farther', lib.hush === 1.4);
  await page.close();

  page = await open(seeds[CELL]);
  const cell = await page.evaluate(async () => {
    const out = {}, quiet = { events: [], emit() {}, shoot() {} };
    T.reset(); game.inv.hp = 1e9;
    const sk = T.guard(6, 'away', false, 'skeleton');
    sk.update(0.03, game.player, { events: [{ x: game.player.x, z: game.player.z, r: 30 }], emit() {}, shoot() {} });
    out.deaf = sk.aware === 0; out.noBleed = sk.addStatus('bleed') === false;
    // a puffer bursts: slows and dazes within 3 m, not at range
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.hp = 1e9;
    let p = T.guard(1.4, 'away', false, 'puffer'); game.player.pitch = -0.55; await T.sleep(150); game.cb.press = true; await T.until(() => p.dead, 3000); await T.sleep(100);
    out.near = game.pst.has('slow') && game.pst.has('daze');
    T.reset(); game.pst.clear(); p = T.guard(6, 'away', false, 'puffer'); p.hit = p.hurt(9999, game.player); await T.sleep(150);
    out.far = !game.pst.has('slow') && !game.pst.has('daze');
    return out;
  });
  check('skeletons are deaf and immune to bleed', cell.deaf && cell.noBleed);
  check('a puffer\'s spores slow and daze you when you kill it up close', cell.near);
  check('and do nothing when it dies at range', cell.far);
  await page.close();

  page = await open(seeds[MARK]);
  const mark = await page.evaluate(async () => {
    const out = {};
    // market guard: frontal hits do a quarter damage, side hits do not
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.hp = 1e9;
    const hit = async (face) => { T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); const g = T.guard(1.3, face, true, 'mguard'); g.hp = g.maxHp = 900; g.resist = { head: 1, body: 1, legs: 1 }; g.update = function () { this.sync(0); return null; }; g.stun = 0; game.player.pitch = -0.3; await T.sleep(150); game.cb.press = true; await T.until(() => g.hp < 900, 3000); return 900 - g.hp; };
    out.front = await hit('toward'); out.back = await hit('away');
    // boar: paws, then charges at more than sprinting speed
    T.reset(); game.inv.hp = 1e9; const best = T.reset();
    const b = T.guard(Math.min(8, best - 0.5), 'toward', true, 'boar'); b.hp = b.maxHp = 900;
    let top = 0, last = { x: b.x, z: b.z }, t0 = performance.now();
    await T.until(() => { const dt = (performance.now() - t0) / 1000; t0 = performance.now(); const sp = Math.hypot(b.x - last.x, b.z - last.z) / Math.max(dt, 0.001); last = { x: b.x, z: b.z }; if (b.chargeT > 0) top = Math.max(top, sp); return game.inv.hp < 100 || b.atkCd > 1; }, 15000);
    out.charged = b.hitMul === 1; out.topSpeed = top;
    // thief: steals gold, flees, drops it when killed
    T.reset(); game.inv.hp = 1e9; game.inv.gold = 100; game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    const th = T.guard(1.3, 'toward', true, 'thief');
    out.stole = await T.until(() => th.stolen, 10000); out.goldAfter = game.inv.gold; out.thiefHas = th.loot;
    out.flees = await T.until(() => th.fleeT > 0 || th.state !== 'alerted', 2000);
    th.hp = 1; th.hurt(10, game.player); makeCorpse(th, false); await T.sleep(100);
    const corpse = propObjs.find(o => o.p.kind === 'corpse' && o.p.extra); out.dropped = !!corpse && corpse.p.extra[0].n === th.loot;
    // captain: its bellow alerts everyone in earshot
    T.reset(); game.inv.hp = 1e9;
    const cap = T.guard(4, 'toward', true, 'captain'), far = T.guard(-12, 'toward', false, 'goblin');
    const q = { events: [], emit(x, z, r, src) { q.events.push({ x, z, r, src }); }, shoot() {} };
    cap.shouted = false; cap.update(0.03, game.player, { events: [], emit: q.emit, shoot() {} });
    far.update(0.03, game.player, { events: q.events, emit() {}, shoot() {} });
    out.alarm = far.aware >= 1 || far.state === 'alerted';
    // tripwire bell: the gimmick exists and stepping on one rings once
    out.bells = [...game.floor.patches.values()].filter(k => k === 'bell').length;
    // swinging at a bell cuts it: no ring, no noise
    const bo = decorObjs.find(o => o.kind === 'bell' && game.floor.patches.get(o.p.y * game.floor.w + o.p.x) === 'bell'), key = bo && bo.p.y * game.floor.w + bo.p.x;
    out.cut = null;
    if (bo) for (const [dx, dz, yaw] of [[0, 1.5, 0], [0, -1.5, Math.PI], [1.5, 0, -Math.PI / 2], [-1.5, 0, Math.PI / 2]]) {
      const bx = (bo.p.x + 0.5) * 3, bz = (bo.p.y + 0.5) * 3;
      game.player.x = bx + dx; game.player.z = bz + dz; game.player.yaw = yaw; pulse = 0;
      playerHit();
      if (!game.floor.patches.has(key)) { out.cut = { noise: pulse, hidden: !bo.mesh.visible }; break; }
    }
    return out;
  });
  check('a market guard takes a quarter damage from the front, full from behind', mark.front > 0 && mark.back > 0 && mark.front < mark.back * 0.5, `front ${mark.front.toFixed(1)}, back ${mark.back.toFixed(1)}`);
  check('a boar charges faster than a sprinting player', mark.topSpeed > 7, 'top speed ' + mark.topSpeed.toFixed(1) + ' m/s');
  check('a thief steals gold and runs', mark.stole && mark.goldAfter === 100 - mark.thiefHas && mark.thiefHas > 0 && mark.flees, `took ${mark.thiefHas}`);
  check('a thief drops the stolen gold when it dies', mark.dropped);
  check('a captain\'s bellow turns far-off enemies alerted', mark.alarm);
  check('attacking a tripwire bell cuts it silently', mark.cut && mark.cut.noise === 0 && mark.cut.hidden, JSON.stringify(mark.cut));
  check('the Market floors have tripwire bells', mark.bells > 0, mark.bells + ' bells');
  await page.close();

  page = await open(seeds[CHAP]);
  const chap = await page.evaluate(async () => {
    const out = {};
    // frost wisp: its touch slows
    T.reset(); game.inv.hp = 1e9; const w = T.guard(1.2, 'toward', true, 'wisp'); w.hp = w.maxHp = 900;
    out.slowed = await T.until(() => game.pst.has('slow'), 15000);
    // cultist: a curse slows
    T.reset(); game.inv.hp = 1e9; game.pst.clear(); const c = T.guard(Math.min(7, T.reset() - 0.5), 'toward', true, 'cultist'); c.hp = c.maxHp = 900;
    out.cursed = await T.until(() => game.pst.has('slow'), 25000);
    // ice knight blocks frontal hits like a guard
    T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.inv.hp = 1e9;
    const k = T.guard(1.3, 'toward', true, 'iceknight'); k.hp = k.maxHp = 900; k.resist = { head: 1, body: 1, legs: 1 }; k.update = function () { this.sync(0); return null; };
    game.player.pitch = -0.3; await T.sleep(150); game.cb.press = true; await T.until(() => k.hp < 900, 3000); out.knightDamage = 900 - k.hp;
    // ice: you slide. Compare how far you coast after letting go of forward.
    const coast = async (ice) => {
      T.reset(); const P = game.player;
      let ok = false; for (let a = 0; a < 16 && !ok; a++) { P.yaw = a * Math.PI / 8; ok = [1, 2, 3, 4, 5].every(m => !P.blocked(game.floor, P.x - Math.sin(P.yaw) * m, P.z - Math.cos(P.yaw) * m)); }
      P.slippery = ice; P.keys[KEYS.forward] = true; for (let i = 0; i < 90; i++) P.step(game.floor); P.keys[KEYS.forward] = false;
      const x0 = P.x, z0 = P.z; for (let i = 0; i < 60; i++) P.step(game.floor); return Math.hypot(P.x - x0, P.z - z0);
    };
    out.coastDry = await coast(false); out.coastIce = await coast(true);
    out.patches = [...game.floor.patches.values()].filter(k => k === 'ice').length;
    return out;
  });
  check('a frost wisp\'s touch slows you', chap.slowed);
  check('a cultist\'s curse slows you', chap.cursed);
  check('an ice knight\'s guard cuts frontal hits to 30%', chap.knightDamage > 0 && chap.knightDamage < 12, 'damage ' + chap.knightDamage.toFixed(1));
  check('ice makes you slide much farther', chap.coastIce > chap.coastDry * 3, `dry ${chap.coastDry.toFixed(2)} m, ice ${chap.coastIce.toFixed(2)} m`);
  check('the Chapel floors have ice', chap.patches > 0, chap.patches + ' patches');
  await page.close();

  // ---------- gimmicks that need the Orchard and the Cellar, and every boss ----------
  page = await open(seeds[ORCH]);
  const grass = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(150);
    const k = [...game.floor.patches.entries()].find(([, v]) => v === 'shade'); if (!k) return { none: true };
    const P = game.player; P.x = ((k[0] % game.floor.w) + 0.5) * TILE; P.z = (Math.floor(k[0] / game.floor.w) + 0.5) * TILE;
    P.keys[KEYS.crouch] = true; await T.sleep(200); const crouched = P.stealthMul; P.keys[KEYS.crouch] = false; await T.sleep(200); const standing = P.stealthMul;
    P.x += 3 * 4; await T.sleep(150);
    return { crouched, standing };
  });
  check('the shade under the trees hides a player (crouched or not: 0.6)', Math.abs(grass.crouched - 0.6) < 1e-6 && Math.abs(grass.standing - 0.6) < 1e-6, JSON.stringify(grass));
  // open sky (Orchard night, Jungle day): no ceiling plane, one unlit sky dome, same draw-call budget, nothing leaks over rebuilds
  const skyProbe = async pg => pg.evaluate(async () => {
    const out = { leak: [] };
    for (let k = 0; k < 3; k++) {
      game.startFloor(1); await T.sleep(100);
      const i = game.renderInfo(); out.leak.push(i.geos + '/' + i.tex);
      let planes = 0, skies = 0, basic = false;
      game.group.traverse(o => { if (!o.isMesh) return; if (o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width >= game.floor.w * TILE * 0.9) planes++; if (o.userData.sky) { skies++; basic = o.material.type === 'MeshBasicMaterial' && !o.material.fog && !!o.material.map; } });
      out.planes = planes; out.skies = skies; out.basic = basic;
    }
    const room = [...game.floor.rooms].filter(r => !r.locked).sort((a, b) => b.w * b.h - a.w * a.h)[0], P = game.player;
    P.x = (room.cx + 0.5) * TILE; P.z = (room.cy + 0.5) * TILE; let worst = 0;
    for (let a = 0; a < 8; a++) { P.yaw = a * Math.PI / 4; worst = Math.max(worst, game.renderInfo().calls); }
    out.worst = worst;
    return out;
  });
  const skyOrch = await skyProbe(page);
  check('an Orchard floor has no ceiling plane and exactly one unlit sky dome', skyOrch.planes === 0 && skyOrch.skies === 1 && skyOrch.basic, JSON.stringify(skyOrch));
  check('Orchard draw calls stay under 260 in the busiest room', skyOrch.worst < 260, 'worst ' + skyOrch.worst);
  check('rebuilding Orchard floors keeps geometry and texture counts flat', skyOrch.leak.every(v => v === skyOrch.leak[0]), skyOrch.leak.join(', '));
  await page.close();
  page = await open(seeds['The Overgrown Ruin']);
  const skyJung = await skyProbe(page);
  check('a Jungle floor has no ceiling plane and exactly one unlit sky dome', skyJung.planes === 0 && skyJung.skies === 1 && skyJung.basic, JSON.stringify(skyJung));
  check('Jungle draw calls stay under 260 in the busiest room, and its counts stay flat over rebuilds', skyJung.worst < 260 && skyJung.leak.every(v => v === skyJung.leak[0]), 'worst ' + skyJung.worst + ', ' + skyJung.leak.join(', '));
  await page.close();

  page = await open(seeds[CELL]);
  const glow = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(150);
    const k = [...game.floor.patches.entries()].find(([, v]) => v === 'glowcap'); if (!k) return { none: true };
    const P = game.player; P.x = ((k[0] % game.floor.w) + 0.5) * TILE; P.z = (Math.floor(k[0] / game.floor.w) + 0.5) * TILE; await T.sleep(200);
    return { lit: P.stealthMul };
  });
  check('glowing spores make you easier to see', glow.lit > 1.3, JSON.stringify(glow));
  await page.close();

  const bosses = {};
  for (const [name, seed] of Object.entries(seeds)) {
    const pg = await open(seed);
    bosses[name] = await pg.evaluate(async () => { game.startFloor(5); await T.sleep(250); const b = game.enemies.find(e => e.boss); return { name: document.querySelector('#boss div').textContent, dress: b && b.spec.dress, theme: document.getElementById('theme').textContent }; });
    await pg.close();
  }
  const want = { 'The Sunken Tavern': 'Giant Innkeeper', 'The Moonlit Orchard': 'Harvest King', 'The Clockwork Library': 'Librarian Golem', 'The Mushroom Cellar': 'Fungal Warden', 'The Goblin Market': 'Goblin Warlord', 'The Frozen Chapel': 'Frost Giant' };
  check('every theme has its own boss', Object.entries(want).every(([t, n]) => bosses[t] && bosses[t].name === n && bosses[t].dress), JSON.stringify(Object.fromEntries(Object.entries(bosses).map(([k, v]) => [k, v.name]))));
});
