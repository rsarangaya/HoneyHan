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
      game.startFloor(1);
      for (const e of game.enemies) e.mesh.parent && e.mesh.parent.remove(e.mesh);
      game.enemies.length = 0;
      game.inv.hp = game.inv.maxHp; game.cb.stamina = 100; game.cb.atk = null; game.cb.want = false;
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
    guard(d, facing, alerted) {
      const P = game.player, f = game.floor;
      const x = P.x - Math.sin(P.yaw) * d, z = P.z - Math.cos(P.yaw) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
      const e = new Enemy({ x: tx, y: ty, route: [{ x: tx, y: ty }, { x: tx, y: ty }], seed: 12345 }, f);
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

    const page = await open(7);

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
    await page.close();

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
