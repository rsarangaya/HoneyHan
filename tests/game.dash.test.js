// Attacking at 0 stamina (slow, never below 0) and the dash. Run on its own: node tests/game.dash.test.js
const { run } = require('./lib');
run('Exhausted attacks and the dash', async ({ open, check }) => {
  const page = await open(7);
  // 1. Exhausted attacks: possible at 0 stamina, x2.5 slower, stamina never below 0.
  const ex = await page.evaluate(async () => {
    const out = {};
    const swing = async stam => {
      T.reset(); game.inv.equip.weapon = makeItem({ type: 'weapon', base: 'sword', tier: 0 }); game.cb.stamina = stam; game.cb.delay = 0;
      game.cb.press = true; const t0 = performance.now();
      await T.until(() => !!game.cb.atk, 2000); const started = !!game.cb.atk; const min = [game.cb.stamina];
      const t1 = performance.now(); let gt = 0;
      await T.until(() => { min.push(game.cb.stamina); return !game.cb.atk; }, 8000);
      return { started, slow: game.cb.atk === null, min: Math.min(...min), dur: performance.now() - t1 };
    };
    const full = await swing(100), none = await swing(0), part = await swing(5);
    out.full = full; out.none = none; out.part = part;
    // the swing clock itself: attack t advances at exhaustedAtkMul of real time
    T.reset(); game.cb.stamina = 0; game.cb.press = true; await T.until(() => !!game.cb.atk, 2000);
    out.slowFlag = game.cb.atk.slow === true; out.hint = document.getElementById('hitmark').textContent;
    T.reset(); game.cb.stamina = 100; game.cb.press = true; await T.until(() => !!game.cb.atk, 2000); out.fastFlag = game.cb.atk.slow === false;
    return out;
  });
  check('an attack at 0 stamina still starts', ex.none.started);
  check('stamina never goes below 0', ex.none.min >= 0 && ex.part.min >= 0, `${ex.none.min} ${ex.part.min}`);
  check('the exhausted swing is much slower than a normal one', ex.none.dur > ex.full.dur * 1.8, `${ex.none.dur.toFixed(0)} ms vs ${ex.full.dur.toFixed(0)} ms`);
  check('a normal swing is not flagged slow, a tired one is, and EXHAUSTED shows', ex.slowFlag && ex.fastFlag && ex.hint === 'EXHAUSTED', ex.hint);
  // 2. Dash.
  const dash = await page.evaluate(async () => {
    const out = {}, P = game.player;
    const room = () => { const f = game.floor; for (let y = 2; y < f.h - 2; y++) for (let x = 6; x < f.w - 8; x++) {
      const open = k => f.tiles[y * f.w + x + k] === 1 && !f.blocked[y * f.w + x + k];
      if ([0, 1, 2, 3, 4].every(open) && f.tiles[y * f.w + x + 5] === 0) return { x, y }; } return null; };
    T.reset();
    const f = game.floor; let spot = null;
    for (let y = 2; y < f.h - 2 && !spot; y++) for (let x = 3; x < f.w - 10 && !spot; x++) {
      const op = k => f.tiles[y * f.w + x + k] === 1 && !f.blocked[y * f.w + x + k] && f.tiles[(y + 1) * f.w + x + k] === 1 && f.tiles[(y - 1) * f.w + x + k] === 1;
      if ([0, 1, 2, 3, 4, 5, 6].every(op)) spot = { x, y };
    }
    out.spot = !!spot; if (!spot) return out;
    const place = () => { P.x = (spot.x + 0.5) * TILE; P.z = (spot.y + 0.5) * TILE; P.yaw = -Math.PI / 2; P.pitch = 0; P.vx = P.vz = 0; P.keys = {}; game.cb.dashCd = 0; game.cb.stamina = 100; game.cb.delay = 0; game.pst.clear(); game.cb.eat = null; game.cb.draw = null; };
    const go = async () => { game.cb.dashReq = true; await T.until(() => P.dashS.on, 2000); await T.until(() => !P.dashS.on, 3000); await T.sleep(100); };
    // distance, stamina, noise, cooldown
    place(); const x0 = P.x, z0 = P.z;
    const ear = T.guard(-12, 'away', false); let heard = 0;   // an unaware guard far behind: record the loudest noise event it is offered
    ear.update = function (dt, pl, noise) { for (const n of noise.events) heard = Math.max(heard, n.r); this.sync(0); return null; };
    game.cb.dashReq = true; await T.until(() => P.dashS.on, 2000);
    out.cost = 100 - game.cb.stamina; out.cdSet = game.cb.dashCd > 0.5; 
    await T.until(() => !P.dashS.on, 3000); await T.sleep(150); out.loud = heard >= TUNE.dashNoise - 0.01; game.enemies.splice(game.enemies.indexOf(ear), 1);
    out.dist = Math.hypot(P.x - x0, P.z - z0); out.straight = Math.abs(P.z - z0) < 0.3;
    // a second press during the cooldown does nothing
    const s1 = game.cb.stamina; game.cb.dashReq = true; await T.sleep(150); out.cdBlocked = game.cb.stamina >= s1 - 0.01 && !P.dashS.on;
    await T.until(() => game.cb.dashCd <= 0, 5000); game.cb.stamina = 100; game.cb.dashReq = true; out.again = await T.until(() => P.dashS.on, 2000);
    await T.until(() => !P.dashS.on, 3000);
    // sideways with a key held
    place(); P.x += 4.5; P.keys[KEYS.back] = true; const bx = P.x; await go(); P.keys = {}; out.backward = P.x < bx - 4;
    // blocked states
    const refused = async setup => { place(); setup(); const s = game.cb.stamina, px = P.x; game.cb.dashReq = true; await T.sleep(250); return !P.dashS.on && Math.abs(P.x - px) < 0.3 && game.cb.dashCd <= 0.01; };
    out.noStam = await refused(() => { game.cb.stamina = 10; });
    out.stunned = await refused(() => { game.pst.apply('stun', 2); });
    out.dazed = await refused(() => { game.pst.apply('daze', 2); });
    out.eating = await refused(() => { const it = game.inv.add({ type: 'food', kind: 'bread', n: 1 }); game.cb.eat = { it: game.inv.pack.find(i => i.type === 'food'), t: 0, dur: 99 }; });
    out.bow = await refused(() => { game.cb.draw = { t: 0 }; });
    game.cb.eat = null; game.cb.draw = null; game.pst.clear();
    // walls: facing a wall 1.5 m ahead
    // stand 1.2 m before the first wall tile east of the strip
    let wallX = null; for (let k = 0; k < 30 && spot.x + k < f.w; k++) if (f.tiles[spot.y * f.w + spot.x + k] !== 1) { wallX = f.tiles[spot.y * f.w + spot.x + k] === 0 ? (spot.x + k) * TILE : null; break; }
    if (wallX !== null) { place(); P.x = wallX - 1.2; await go(); out.wallOk = !Player.wallHit(f, P.x, P.z, P.radius) && P.x <= wallX - P.radius + 0.01; out.wallDist = wallX - P.x; }
    // a prop and a guard in the way: it stops short of them
    place(); { const c = { x: P.x + 2.6, z: P.z, r: 0.8 }, keep = P.props; P.props = [c]; const x1 = P.x; await go(); out.propStop = Math.hypot(P.x - c.x, P.z - c.z) >= c.r + P.radius - 0.03 && P.x < c.x && P.x > x1 + 0.5; P.props = keep; }
    place(); { const e = T.guard(2.8, 'toward', false); e.update = function () { this.sync(0); return null; }; await go(); out.guardStop = Math.hypot(P.x - e.x, P.z - e.z) >= e.r + P.radius - 0.05 && P.x < e.x; }
    return out;
  });
  check('a clear strip of floor was found', dash.spot);
  check('a dash covers about 6 m straight ahead', Math.abs(dash.dist - 6) < 0.9 && dash.straight, dash.dist && dash.dist.toFixed(2));
  check('it costs 25 stamina and starts the cooldown', Math.abs(dash.cost - 25) < 1.5 && dash.cdSet, String(dash.cost));
  check('it is loud', dash.loud);
  check('a second dash waits for the cooldown, then works', dash.cdBlocked && dash.again);
  check('it follows the movement keys (back dashes backward)', dash.backward);
  check('no dash without the stamina, or while stunned, dazed, eating or drawing a bow', dash.noStam && dash.stunned && dash.dazed && dash.eating && dash.bow, JSON.stringify([dash.noStam, dash.stunned, dash.dazed, dash.eating, dash.bow]));
  check('a dash stops at a wall', dash.wallOk === true, String(dash.wallDist));
  check('a dash stops at a prop and at a guard', dash.propStop && dash.guardStop, JSON.stringify([dash.propStop, dash.guardStop]));
  await page.close();
});
