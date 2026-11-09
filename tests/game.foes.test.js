// Archer, shaman, brute and the Sunken Tavern's gimmick. Run on its own: node tests/game.foes.test.js
const { run } = require('./lib');
run('Archer, shaman, brute and the Tavern', async ({ open, check }) => {
  let page = await open(7);

  // 1. Archers shoot from a distance, back away when you close in, and arrows can be blocked.
  const arch = await page.evaluate(async () => {
    const out = {};
    const best = T.reset(), d = Math.min(7, best - 0.5); game.inv.hp = 100; game.cb.stamina = 100;
    let a = T.guard(d, 'toward', true, 'archer'); a.hp = a.maxHp = 500;
    let shots = 0; const orig = window.spawnEnemyShot; // count the arrows it looses
    out.shot = await T.until(() => game.arrows.some(q => q.owner === 'enemy' && q.kind === 'arrow'), 15000);
    out.hit = await T.until(() => game.inv.hp < 100, 15000);
    out.dist = Math.hypot(a.x - game.player.x, a.z - game.player.z);
    // too close: it backs off
    T.reset(); game.inv.hp = 1e9; a = T.guard(2.2, 'toward', true, 'archer'); a.hp = a.maxHp = 500;
    const d0 = Math.hypot(a.x - game.player.x, a.z - game.player.z);
    await T.until(() => Math.hypot(a.x - game.player.x, a.z - game.player.z) > 4, 8000);
    out.backedOff = Math.hypot(a.x - game.player.x, a.z - game.player.z) > 4 && d0 < 3;
    // a shield stops arrows
    T.reset(); game.inv.hp = 100; game.cb.stamina = 100; game.inv.equip.offhand = makeItem({ type: 'shield', tier: 0 });
    a = T.guard(Math.min(7, best - 0.5), 'toward', true, 'archer'); a.hp = a.maxHp = 500;
    let hits = 0; const real = window.enemyShotHit; window.enemyShotHit = function (q) { hits++; return real(q); };
    const upd = a.update; a.update = function (...r) { game.cb.want = true; if (game.cb.block) game.cb.blockT = 1; return upd.apply(this, r); };
    await T.until(() => hits >= 2, 20000); await T.sleep(100);
    window.enemyShotHit = real; game.cb.want = false;
    out.blocked = { hits, hp: game.inv.hp, stam: game.cb.stamina };
    return out;
  });
  check('an archer looses arrows at you from range', arch.shot && arch.hit, `kept ${arch.dist.toFixed(1)} m away`);
  check('an archer keeps its distance (backs away when you close in)', arch.backedOff);
  check('a raised shield blocks arrows, at a stamina cost', arch.blocked.hits >= 2 && arch.blocked.hp === 100 && arch.blocked.stam < 100, JSON.stringify(arch.blocked));

  // 2. A shaman hexes you (slow or daze) and heals a badly hurt ally.
  const sham = await page.evaluate(async () => {
    const out = {};
    const best = T.reset(); game.inv.hp = 1e9; game.cb.stamina = 100;
    let s = T.guard(Math.min(7, best - 0.5), 'toward', true, 'shaman'); s.hp = s.maxHp = 500;
    out.hexed = await T.until(() => game.pst.has('slow') || game.pst.has('daze'), 25000);
    T.reset(); game.inv.hp = 1e9;
    s = T.guard(Math.min(7, best - 0.5), 'toward', true, 'shaman');
    const ally = T.guard(Math.min(7, best - 0.5) - 1.5, 'toward', false, 'goblin'); ally.hp = 10; ally.maxHp = 40; ally.update = function () { this.sync(0); return null; };
    out.healed = await T.until(() => ally.hp > 10, 20000); out.allyHp = ally.hp;
    return out;
  });
  check('a shaman hexes you with a slow or a daze', sham.hexed);
  check('a shaman heals a badly hurt ally', sham.healed && sham.allyHp <= 40, 'ally hp ' + sham.allyHp);

  // 3. The brute: tough, hits hard, cannot be staggered by an ordinary hit.
  const brute = await page.evaluate(async () => {
    const out = {};
    T.reset(); game.inv.hp = 1e9; game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 });
    const b = T.guard(1.2, 'toward', true, 'brute'); out.hp = b.maxHp; out.dmgMul = b.dmgMul; out.noStagger = b.T.noStagger; out.chase = b.chase;
    b.hp = b.maxHp = 900;
    game.cb.press = true; await T.until(() => b.hp < 900, 4000); await T.sleep(100);
    out.stun = b.stun; out.stunStatus = b.addStatus('stun');
    return out;
  });
  check('a brute has 3x health, hits twice as hard and is slower than a sprint', brute.hp === 120 && brute.dmgMul === 2 && brute.chase < 4.6, `hp ${brute.hp}, chase ${brute.chase.toFixed(1)}`);
  check('a brute is not staggered or stunned by ordinary hits', brute.stun === 0 && brute.stunStatus === false);

  // 4. The floors mix the new types in.
  const mix = await page.evaluate(async () => {
    const seen = {};
    for (const n of [2, 3, 4]) { game.startFloor(n); await T.sleep(250); for (const e of game.enemies) (seen[n] = seen[n] || {})[e.type] = ((seen[n] || {})[e.type] || 0) + 1; }
    return seen;
  });
  check('archers from floor 2, a shaman from floor 3, a brute on floor 4', (mix[2].archer || 0) >= 1 && (mix[3].shaman || 0) === 1 && (mix[4].brute || 0) === 1 && (mix[4].archer || 0) >= 1, JSON.stringify(mix));

  // 5. The Sunken Tavern: shallow water splashes, even when you creep, and the boss is the Giant Innkeeper.
  const splash = await page.evaluate(async () => {
    game.startFloor(1); await T.sleep(200);
    const f = game.floor; if (!f.puddles.size) return { none: true };
    const P = game.player;
    const trial = async (tx, ty) => {
      T.reset(); P.x = (tx + 0.5) * TILE; P.z = (ty + 0.5) * TILE; P.vx = P.vz = 0;
      let ok = false;
      for (let k = 0; k < 16 && !ok; k++) {                                   // face a direction with 4 m of open floor
        P.yaw = k * Math.PI / 8; const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
        ok = [1, 2, 3, 4].every(m => !P.blocked(game.floor, P.x + fx * m, P.z + fz * m));
      }
      if (!ok) return null;
      const ear = T.guard(3.6, 'away', false); ear.update = Enemy.prototype.update;
      P.keys[KEYS.crouch] = true; P.keys[KEYS.forward] = true;
      await T.sleep(700); P.keys[KEYS.forward] = false; P.keys[KEYS.crouch] = false;
      return ear.aware >= 0.5 || ear.state !== 'unaware';
    };
    // the T.reset inside trial reloads floor 1 with the same seed, so the puddle tiles are the same
    const pud = [...game.floor.puddles].map(k => ({ x: k % game.floor.w, y: Math.floor(k / game.floor.w) }));
    let wet = null, dry = null;
    for (const p of pud) { wet = await trial(p.x, p.y); if (wet !== null) break; }
    for (const r of game.floor.rooms) { for (let y = r.y; y < r.y + r.h && dry === null; y++) for (let x = r.x; x < r.x + r.w && dry === null; x++) { if (game.floor.tiles[y * game.floor.w + x] === 1 && !game.floor.blocked[y * game.floor.w + x] && !game.floor.puddles.has(y * game.floor.w + x)) { const t = await trial(x, y); if (t !== null) dry = t; } } if (dry !== null) break; }
    return { wet, dry, puddles: pud.length };
  });
  check('puddles carry a creeping player\'s steps; dry floor does not', splash.wet === true && splash.dry === false, JSON.stringify(splash));

  const boss = await page.evaluate(async () => {
    game.startFloor(5); await T.sleep(250);
    const b = game.enemies.find(e => e.boss);
    return { name: document.querySelector('#boss div').textContent, innkeeper: !!(b && b.spec.innkeeper) };
  });
  check('the Tavern\'s boss is the Giant Innkeeper', boss.name === 'Giant Innkeeper' && boss.innkeeper, boss.name);
  await page.close();
});
