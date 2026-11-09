// Shared setup for the in-browser tests (tests/game.*.test.js): a tiny static server, headless Chromium through
// Playwright (npm i -D playwright && npx playwright install chromium), the page-side helpers `T`, and run().
// Each test file calls run(title, body) and gets { open, check } in its body.
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
      game.inv.hp = game.inv.maxHp; game.cb.stamina = 100; game.cb.atk = null; game.cb.want = false; game.pst.clear(); game.inv.pack = []; game.inv.quick = [null, null, null, null]; game.hunger.v = 100; game.hunger.fight = 0; game.hunger.growlT = 10; game.hunger.starveT = 0; game.cb.eat = null;
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


// run(title, async ({ open, check }) => {...}): opens the server and browser, runs the body, closes up, sets the exit code.
async function run(title, body) {
  let failures = 0;
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  // A fresh page on the given seed, started and with the helpers installed. 320 x 180 keeps software rendering playable.
  const open = async seed => {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    page.on('pageerror', e => errors.push(`seed ${seed}: ${e.message}`));
    await page.goto(`${base}?seed=${seed}&norender=1`);
    await page.waitForFunction(() => window.game && game.floor);
    await page.click('#overlay', { position: { x: 5, y: 5 } });           // start the run (pointer lock is refused headless; play goes on)
    await page.waitForFunction(() => game.state === 'play');
    await page.evaluate(HELPERS);
    return page;
  };
  try {
    await body({ open, check });
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
}
module.exports = { run };
