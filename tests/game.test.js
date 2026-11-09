// In-browser game checks: loads index.html in headless Chromium and drives the game through the
// window.game debug hook.
//   node tests/game.test.js
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
// Covers: every floor builds with no page errors, the stairs lead down, guards keep apart and out
// of the player, the player cannot walk through a guard, a dagger sneak kill, a sword parry, and death.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };

// Page-side helpers, installed once per page.
const HELPERS = () => {
  const realRandom = Math.random;
  window.T = {
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    // Wait until test() is true, checked every animation frame; false after maxMs. Game-time
    // conditions instead of fixed sleeps, because headless rendering runs at a low frame rate.
    until: (test, maxMs) => new Promise(done => {
      const t0 = performance.now();
      const tick = () => test() ? done(true) : performance.now() - t0 > maxMs ? done(false) : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    }),
    // Fresh floor 1 with no guards, the player at the start facing the longest open line, full HP.
    reset() {
      Math.random = realRandom;                               // some tests pin Math.random
      game.startFloor(1);
      for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh);
      game.enemies.length = 0;
      game.inv.hp = game.inv.maxHp; game.cb.stamina = 100; game.cb.atk = null; game.cb.want = false; game.pst.clear();
      const P = game.player, f = game.floor;
      let best = 0, yaw = 0;
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8; let d = 0;
        while (d < 8 && !P.blocked(f, P.x - Math.sin(a) * (d + 0.5), P.z - Math.cos(a) * (d + 0.5))) d += 0.5;
        if (d > best) { best = d; yaw = a; }
      }
      P.yaw = yaw; P.pitch = 0; P.vx = P.vz = 0; P.keys = {};
      return best;
    },
    // A guard d metres straight ahead. facing: 'away' (back to the player) or 'toward'.
    guard(d, facing, alerted, type) {
      const P = game.player, f = game.floor;
      const x = P.x - Math.sin(P.yaw) * d, z = P.z - Math.cos(P.yaw) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
      const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: 12345, type }, f);
      e.x = x; e.z = z; e.wait = 1e9;
      e.yaw = facing === 'away' ? P.yaw : P.yaw + Math.PI;
      if (alerted) { e.last = { x: P.x, z: P.z }; e.set('alerted'); }
      e.mesh.visible = true; scene.add(e.mesh); game.enemies.push(e); e.sync(0);
      return e;
    },
  };
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async seed => {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });   // small, so software rendering keeps a playable frame rate
    page.on('pageerror', e => errors.push(`seed ${seed}: ${e.message}`));
    await page.goto(`${base}?seed=${seed}`);
    await page.waitForFunction(() => window.game && game.floor);
    await page.click('#overlay', { position: { x: 5, y: 5 } });           // start the run (pointer lock is refused headless; play goes on)
    await page.waitForFunction(() => game.state === 'play');
    await page.evaluate(HELPERS);
    return page;
  };

  try {
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
    check('stairs lead to floor 2', /^Floor 2/.test(floorText), floorText);

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
    check('guards keep apart', swarm.pair >= 0.7, `closest pair ${swarm.pair.toFixed(2)} m`);
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
      const staggered = await T.until(() => e.stun > 0.5, 15000);
      game.cb.want = false;
      return { staggered, hp: game.inv.hp };
    });
    check('sword parry staggers the guard', parry.staggered && parry.hp === 100, `hp ${parry.hp}`);

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
        game.player.pitch = pitch; Math.random = () => 0;       // chance rolls always succeed
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
    check('aiming at head height misses a rat, aiming low hits', !rat.highAim && !!rat.lowAim, `${rat.highAim}/${rat.lowAim}`);
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

    await page.close();

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
